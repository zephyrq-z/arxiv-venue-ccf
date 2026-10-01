// 解析链路（从 arxiv-venue-resolver/resolve.py 移植）：
// ①页面 journal_ref / DOI（0 请求，作者自报）→ ①' comments "accepted at X" →
// ② S2 by-id（权威，带缓存含负缓存）→ ③ S2 标题搜索 → ④ DBLP API 兜底 → ⑤ CCF 目录匹配。
// fetcher 由宿主注入（扩展里走 background 的节流 fetch，Node 测试直接传 fetch）。
import { ccfMatch, csAreaHint, isPreprintVenue, norm, realDoi, titleMatch } from "./ccf.js";

// comments 自报接收信息提取（"Accepted at ASE 2026" / "accepted to CIKM 2026" / "to appear in X"）
// 词序列贪婪匹配——逗号/句号断句，长全称会议名能吃到但截到 80 字符；罕见 "Proc. of X" 会截在 Proc，由 S2/DBLP 兜底
const COMMENTS_RE = /(?:(?:accepted|publish\w*)\s+(?:at|in|to|by|as)\s+|to\s+appear\s+(?:at|in)\s+)(?:an?\s+)?(?:oral|spotlight|poster)?\s*(?:the\s+)?[\w\-&']+(?:\s+[\w\-&']+){0,11}/i;

export function commentsVenue(meta) {
  const c = meta.comments || "";
  if (!c) return null;
  const m = c.match(COMMENTS_RE);
  if (!m) return null;
  let v = m[0];
  v = v.replace(/^(accepted|published|to\s+appear)\s+(at|in|to|by|as)\s*/i, "").replace(/[.,\s]+$/, "");
  v = v.replace(/^(an?\s+|the\s+)?(oral|spotlight|poster)\s*/i, "").replace(/[.,\s]+$/, "");
  v = v.replace(/\s+\d{4}$/, "").replace(/[.,\s]+$/, "");            // 尾部年份剥掉, "ASE 2026" → "ASE"
  v = v.replace(/\s+vol\.?\s*\d+.*$/i, "").replace(/[.,\s]+$/, "");  // "PACMSE Vol 2" → "PACMSE"
  if (!v || isPreprintVenue(v)) return null;
  return v.slice(0, 80);
}

export function parseArxivId(s) {
  if (!s) return null;
  let t = String(s);
  const m = t.match(/arxiv\.org\/(?:abs|pdf|html)\/([^/#?]+)/);
  if (m) t = m[1];
  t = t.trim().replace(/^arxiv:/i, "");
  for (const p of [/^(\d{4}\.\d{4,5})(?:v\d+)?$/, /^([a-z-]+\/\d{7})(?:v\d+)?$/]) {
    const g = t.match(p);
    if (g) return g[1];
  }
  return null;
}

// ---------- 网络步（S2 / DBLP）----------

export async function resolveS2(aid, meta, fetcher) {
  const p = await fetcher(
    `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(aid)}` +
      "?fields=title,year,venue,publicationVenue,externalIds,citationStyles,paperId"
  );
  if (p == null) return { resolved: false, offline: true };
  const doi = realDoi((p.externalIds || {}).DOI);
  const bibtex = (p.citationStyles || {}).bibtex || null;
  const year = p.year || null;
  const s2Link = p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : null;
  const v = p.venue || "";
  if (v && !isPreprintVenue(v)) {
    // ② S2 已合并出正式 venue
    return {
      resolved: true, venue: v, vtype: (p.publicationVenue || {}).type || null,
      source: "Semantic Scholar", doi, bibtex, year, s2Link,
    };
  }
  // ③ S2 没标 → 按标题搜已发表版本
  const q = encodeURIComponent(meta.title);
  const d = await fetcher(
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${q}` +
      "&fields=title,year,venue,publicationVenue,externalIds,paperId&limit=20"
  );
  if (d == null) return { resolved: false, offline: true, doi, bibtex, year, s2Link };
  const tn = norm(meta.title);
  const ty = parseInt(meta.year, 10) || 0;
  for (const c of d.data || []) {
    const cv = c.venue || "";
    const cy = c.year || 0;
    if (!cv || isPreprintVenue(cv) || cy < ty) continue;
    if (!titleMatch(tn, norm(c.title || ""))) continue;
    return {
      resolved: true, venue: cv, vtype: (c.publicationVenue || {}).type || null,
      source: "Semantic Scholar (title match)",
      doi: realDoi((c.externalIds || {}).DOI) || doi, bibtex, year,
      s2Link: c.paperId ? `https://www.semanticscholar.org/paper/${c.paperId}` : s2Link,
    };
  }
  // S2 也没找到 → 负缓存（resolved:false 表示已确认未发表）
  return { resolved: false, venue: null, vtype: null, source: null, doi, bibtex, year, s2Link };
}

export async function dblpLookup(meta, fetcher) {
  // DBLP 兜底：网络 API（可能撞 bot 防护）
  const q = encodeURIComponent(meta.title.slice(0, 120));
  try {
    const d = await fetcher(`https://dblp.org/search/publ/api?q=${q}&format=json&h=10`);
    if (d == null) return null;
    const tn = norm(meta.title);
    const ty = parseInt(meta.year, 10) || 0;
    for (const h of (d.result || {}).hits?.hit || []) {
      const i = h.info || {};
      if (i.year && ty && Math.abs(i.year - ty) > 1) continue;
      if (!titleMatch(tn, norm(i.title || ""))) continue;
      if (isPreprintVenue(i.venue)) continue;
      return { venue: i.venue, doi: i.doi, key: i.key, year: i.year };
    }
  } catch (e) {
    return null;
  }
  return null;
}

// ---------- 主链路 ----------

// meta: {id, title, authors[], year, categories[], comments, journalRef, doi}
// fetcher: async (url) => json | null（null = 请求失败/超时，走降级）
// cache: {get(aid), put(aid, obj)}（负缓存含在内）
// 返回 {arxivId, title, venue, venueSource, venueType, doi, ccf, link, bibtex, year, preprintOnly}
export async function resolveVenue(aid, meta, ccfRows, fetcher, cache, opts = {}) {
  const out = {
    arxivId: aid, title: meta.title,
    venue: null, venueSource: null, venueType: null, doi: realDoi(meta.doi),
    ccf: null, link: null, bibtex: null, year: meta.year, preprintOnly: false,
  };
  let { venue, vtype, source, doi, bibtex, year } = { ...out };
  let s2Link = null;

  if (meta.journalRef) {
    // ① 作者自报 journal_ref，零请求
    venue = meta.journalRef;
    source = "arXiv metadata (journal_ref)";
  } else {
    const cv = commentsVenue(meta); // ①' comments 自报（作者声称，非权威）
    if (cv) {
      venue = cv;
      source = "arXiv comments (author-claimed)";
    } else {
      let s2c = cache ? await cache.get(aid) : null;
      if (s2c == null) {
        s2c = await resolveS2(aid, meta, fetcher); // ② by-id + ③ 标题搜索，网络步
        if (cache && !s2c.offline) await cache.put(aid, s2c); // offline（限流/断网）不写缓存，避免污染
      }
      if (s2c.resolved) {
        venue = s2c.venue;
        vtype = s2c.vtype;
        source = s2c.source;
      } else if (!s2c.offline && opts.dblp !== "off") {
        // ④ S2 未命中 → DBLP 兜底
        const dv = await dblpLookup(meta, fetcher);
        if (dv) {
          venue = dv.venue;
          vtype = "conference";
          source = "DBLP";
          doi = dv.doi || doi;
          s2Link = dv.key ? `https://dblp.org/rec/${dv.key}.html` : null;
        }
      }
      doi = s2c.doi || doi;
      bibtex = s2c.bibtex;
      year = s2c.year || year;
      s2Link = s2c.resolved ? s2Link || s2c.s2Link : s2c.s2Link;
    }
  }

  out.venue = venue;
  out.venueSource = source;
  out.venueType = vtype;
  out.doi = doi;
  out.year = year;
  out.preprintOnly = !venue;
  const hint = csAreaHint(meta.categories); // 缩写撞名（FSE 双义）时消歧
  if (venue) {
    const r = ccfMatch(venue, ccfRows, hint);
    out.ccf = r
      ? { abbr: r.abbr, rank: r.rank, kind: r.kind, area: r.area, name: r.name, url: r.url }
      : null;
  }

  if (doi) out.link = `https://doi.org/${doi}`;
  else if (s2Link && !venue) out.link = s2Link;
  else if (venue && s2Link) out.link = s2Link;
  else out.link = `https://arxiv.org/abs/${aid}`;

  // BibTeX：S2 现成的优先；它还是 arXiv preprint 形态而我们已经解析出 venue 时才自己拼
  if (venue && bibtex && /arxiv\s*preprint|eprint|journal\s*=\s*\{?\s*arxiv|volume\s*=\s*\{?\s*abs\//i.test(bibtex)) {
    bibtex = null; // S2 给的还是预印本形态，我们已经知道真 venue，自己拼
  }
  if (!bibtex) {
    const first = meta.authors?.[0];
    const key = (first ? first.split(/\s+/).pop() : "anon") +
      String(year).replace(/\D/g, "") +
      (meta.title.split(/\s+/)[0] || "").toLowerCase().replace(/\W+/g, "");
    let typ, body;
    const journalish =
      vtype === "journal" || (vtype == null && out.ccf && out.ccf.kind === "期刊");
    if (venue && journalish) {
      typ = "article";
      body = `journal = {${venue}}`;
    } else if (venue) {
      typ = "inproceedings";
      body = `booktitle = {${venue}}`;
    } else {
      typ = "misc";
      body = `eprint = {${aid}},\n  archiveprefix = {arXiv}`;
    }
    const lines = [
      `@${typ}{${key},`,
      `  title = {${meta.title}},`,
      `  author = {${(meta.authors || []).join(" and ")}},`,
      `  ${body},`,
      `  year = {${year}},`,
    ];
    if (doi) lines.push(`  doi = {${doi}},`);
    lines.push(`  note = {arXiv:${aid}}`);
    bibtex = lines.join("\n") + "\n}";
  }
  out.bibtex = bibtex;
  return out;
}
