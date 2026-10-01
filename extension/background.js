// background service worker：带节流的网络层 + chrome.storage.local 持久缓存（含负缓存）。
// content script 只发消息（{type:'resolve', id, meta}），网络与缓存都在这里，
// 避免 abs 页并发打开多篇时撞 S2 公共限流。
import { resolveVenue } from "./resolver.js";
import { loadCcf } from "./ccf.js";

const S2_HOST = "https://api.semanticscholar.org";
// S2 官方限流：有 key = 1 req/s（全端点累计）；公共池实测约每分钟 1 个请求。
// 有 key 走 1100ms（留 10% 余量），无 key 走 65s。
const S2_MIN_INTERVAL = () => (s2Key ? 1100 : 65000);
let lastS2 = 0;
let queue = Promise.resolve();
let s2Key = null; // 可选 Semantic Scholar API key（storage.local: s2key，header x-api-key）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// S2 限流退避 fetch：429/403 尊重 Retry-After，否则指数退避；S2 最多 5 次、其他 1 次
async function fetchJson(url, { api = "generic" } = {}) {
  const isS2 = api === "s2";
  const timeout = isS2 ? 20000 : 15000;
  const maxAttempts = isS2 ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // 有 key 限流窗口 1s（短退避够）；公共池退避更长
      await sleep(isS2 && s2Key ? 1100 * 2 ** (attempt - 1) : 5000 * 2 ** (attempt - 1));
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = { "Accept": "application/json" };
      if (isS2 && s2Key) headers["x-api-key"] = s2Key; // key 走官方 x-api-key header
      const res = await fetch(url, { signal: ctrl.signal, headers });
      if (res.status === 429 || res.status === 403) {
        const ra = parseInt(res.headers.get("retry-after") || "", 10);
        if (ra > 0) await sleep(ra * 1000); // 服务器明示的等待时间优先
        continue; // 退避后重试
      }
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null; // 网络错误/超时不重试（走降级）
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

// S2 专用节流（串行队列 + 最小间隔）
function s2Fetcher(url) {
  const run = async () => {
    const wait = lastS2 + S2_MIN_INTERVAL() - Date.now();
    if (wait > 0) await sleep(wait);
    lastS2 = Date.now();
    return fetchJson(url, { api: "s2" });
  };
  queue = queue.then(run, run);
  return queue;
}

// DBLP fetcher（独立限流域）
function dblpFetcher(url) {
  return fetchJson(url);
}

// ---------- 缓存层：chrome.storage.local ----------
// 结构 {v1:<id>:{ts, result}}，负缓存（resolved:false）也持久化，避免重复请求
const CACHE_KEY = "s2cache_v1";
let memCache = null;

async function loadCache() {
  if (memCache) return memCache;
  const o = await chrome.storage.local.get(CACHE_KEY);
  memCache = o[CACHE_KEY] || {};
  return memCache;
}

async function persistCache() {
  // storage.local 10MB 上限，防溢出：只保留最近 2000 条
  const entries = Object.entries(memCache);
  if (entries.length > 2000) {
    entries.sort((a, b) => b[1].ts - a[1].ts);
    memCache = Object.fromEntries(entries.slice(0, 2000));
  }
  await chrome.storage.local.set({ [CACHE_KEY]: memCache });
}

const cacheGet = async (aid) => {
  const c = await loadCache();
  const e = c[aid];
  if (!e) return null;
  // 负缓存 90 天有效（论文可能后来被接收）；正缓存长期有效（venue 事实基本不变）
  const maxAge = e.result?.resolved ? Infinity : 90 * 86400e3;
  if (Date.now() - e.ts > maxAge) {
    delete c[aid];
    await persistCache();
    return null;
  }
  return e.result;
};

const cachePut = async (aid, result) => {
  const c = await loadCache();
  c[aid] = { ts: Date.now(), result };
  await persistCache();
};

// ---------- CCF 目录 ----------
let ccfRows = null;
async function getCcf() {
  if (ccfRows) return ccfRows;
  const url = chrome.runtime.getURL("data/ccf.json");
  const j = await (await fetch(url)).json();
  ccfRows = loadCcf(j);
  return ccfRows;
}

// ---------- 入口 ----------
// MV3 SW 随时被杀重启：key 用惰性读取（每次用时从 storage 拿，带内存缓存）
let s2KeyLoaded = false;
async function ensureKey() {
  if (!s2KeyLoaded) {
    s2Key = (await chrome.storage.local.get("s2key")).s2key || null;
    s2KeyLoaded = true;
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.s2key) { s2Key = changes.s2key.newValue || null; s2KeyLoaded = true; }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove("s2cache_v0");
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "setKey") {
    s2Key = msg.key || null;
    chrome.storage.local.set({ s2key: s2Key }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type !== "resolve") return false;
  (async () => {
    try {
      await ensureKey();
      const rows = await getCcf();
      const r = await resolveVenue(
        msg.id, msg.meta, rows,
        (url) => (url.includes(S2_HOST) ? s2Fetcher(url) : dblpFetcher(url)),
        { get: cacheGet, put: cachePut },
        { dblp: "on" }
      );
      sendResponse({ ok: true, result: r });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // async sendResponse
});
