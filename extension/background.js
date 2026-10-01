// background service worker：带节流的网络层 + chrome.storage.local 持久缓存（含负缓存）。
// content script 只发消息（{type:'resolve', id, meta}），网络与缓存都在这里，
// 避免 abs 页并发打开多篇时撞 S2 公共限流。
import { resolveVenue } from "./resolver.js";
import { loadCcf } from "./ccf.js";

const S2_HOST = "https://api.semanticscholar.org";
const S2_MIN_INTERVAL = 1200; // 公共限流 ~1 rps，留余量；失败指数退避
let lastS2 = 0;
let queue = Promise.resolve();
let s2Key = null; // 可选 Semantic Scholar API key（storage.local: s2key）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// S2 限流退避 fetch：429/403 指数退避重试最多 3 次（2s/4s/8s），失败返回 null 走降级
async function fetchJson(url, { api = "generic" } = {}) {
  const timeout = api === "s2" ? 20000 : 15000;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = { "Accept": "application/json" };
      if (api === "s2" && s2Key) headers["x-api-key"] = s2Key; // 可选 key（popup 里设置）
      const res = await fetch(url, { signal: ctrl.signal, headers });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

// S2 专用节流（串行队列 + 最小间隔）
function s2Fetcher(url) {
  const run = async () => {
    const wait = lastS2 + S2_MIN_INTERVAL - Date.now();
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
// MV3 SW 随时被杀重启：顶层 await 保证每次冷启动都读 key（不只 onInstalled）
s2Key = (await chrome.storage.local.get("s2key")).s2key || null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.s2key) s2Key = changes.s2key.newValue || null;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove("s2cache_v0");
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "setKey") {
    s2Key = msg.key || null;
    chrome.storage.local.set({ s2key: s2Key }).then(() => sendResponse({ ok: true }));
  }
  if (msg?.type !== "resolve") return false;
  (async () => {
    try {
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
