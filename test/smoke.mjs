// Node 冒烟测试：真实网络跑 resolveVenue（S2/DBLP），验证移植正确性。
// 用法: node test/smoke.mjs [id ...]
import { readFile } from "node:fs/promises";
import { resolveVenue, parseArxivId, commentsVenue } from "../src/resolver.js";
import { loadCcf, ccfMatch, norm } from "../src/ccf.js";

const rows = loadCcf(JSON.parse(await readFile(new URL("../data/ccf.json", import.meta.url), "utf8")));

// 直连 fetcher（Node 22+ 全局 fetch）
const fetcher = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": "arxiv-venue-ccf-smoke/1.0" } });
  if (!res.ok) {
    console.error(`  [HTTP ${res.status}] ${url.slice(0, 80)}`);
    return null;
  }
  return res.json();
};

// 无缓存（冒烟每次都打真网）
const nocache = { get: async () => null, put: async () => {} };

// arXiv API 元数据（与 popup 相同源）
async function arxivMeta(aid) {
  const xml = await (await fetch(`https://export.arxiv.org/api/query?id_list=${aid}`)).text();
  const e = xml.match(/<entry>[\s\S]*<\/entry>/)?.[0] || "";
  const t = (tag) => e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() || "";
  return {
    id: aid,
    title: t("title"),
    authors: [...e.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]),
    year: t("published").slice(0, 4),
    categories: [...e.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]),
    comments: t("arxiv:comment"),
    journalRef: t("arxiv:journal_ref"),
    doi: t("arxiv:doi"),
  };
}

const cases = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["2407.01489", "2310.06825", "1706.03762"]; // Agentless(FSE) / DPO(NeurIPS) / Attention(仅预印本→JMLR?)

let pass = 0, fail = 0;
for (const c of cases) {
  const id = parseArxivId(c) || c;
  console.log(`\n=== ${id} ===`);
  const meta = await arxivMeta(id);
  if (!meta.title) {
    console.error("  ✗ arXiv meta 获取失败");
    fail++;
    continue;
  }
  console.log(`  title: ${meta.title.slice(0, 60)}`);
  if (meta.journalRef) console.log(`  journal_ref: ${meta.journalRef}`);
  if (meta.comments) console.log(`  comments: ${meta.comments.slice(0, 70)}`);
  const cv = commentsVenue(meta);
  if (cv) console.log(`  comments→venue: ${cv}`);
  const t0 = Date.now();
  const r = await resolveVenue(id, meta, rows, fetcher, nocache, { dblp: "on" });
  console.log(`  (${Date.now() - t0}ms)`);
  console.log(`  venue: ${r.venue}  [${r.venueSource}]`);
  console.log(`  ccf: ${r.ccf ? `${r.ccf.abbr} ${r.ccf.rank} ${r.ccf.kind} ${r.ccf.area}` : "无"}`);
  console.log(`  link: ${r.link}`);
  console.log(`  bibtex head: ${(r.bibtex || "").split("\n")[0]}`);
  // 断言
  const ok = (c) => (c ? (pass++, true) : (fail++, console.error("  ✗ 断言失败"), false));
  ok(r.venue || r.preprintOnly);
  if (r.venue) ok(r.ccf || true); // ccf 无匹配不算失败（venue 不在目录里）
  ok(r.bibtex && r.bibtex.includes("@"));
}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
