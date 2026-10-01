// CCF 推荐目录匹配（数据由 scripts/build_ccf_json.py 从 ccf_v7.tsv 生成，见 data/ccf.json）
// 与 arxiv-venue-resolver 的 Python 版保持同一套规则：norm 相等 → ALIAS → 全称包含 → 撞名按领域/级别消歧。
export const PREPRINT_VENUES = new Set(["", "arxiv", "arxiv.org", "corr", "preprint", "ssrn"]);

// 少数官方名/S2 名与 CCF 目录名对不上的硬映射（norm 后 venue → CCF abbr），遇到再加
export const ALIAS = {
  advancesinneuralinformationprocessingsystems: "NeurIPS",
  // PACMSE / FSE 的各种写法（FSE 论文自 2024 起发表在该期刊包裹层里）
  proceedingsoftheacmonsoftwareengineering: "FSE",
  pacmse: "FSE",
  pacmonsoftwareengineering: "FSE",
  procacmsoftweng: "FSE",
  pacmsoftweng: "FSE",
  proceedingsoftheacmsoftweng: "FSE",
};

// arXiv 主分类 → CCF 领域名子串（撞名消歧，如 FSE 既是加密 B 会又是软工 A 会）
// 值必须与 ccf.json 的 area 列字面对齐（子串匹配）
export const CS_AREA_HINT = {
  "cs.SE": "软件工程", "cs.PL": "软件工程", "cs.OS": "体系结构",
  "cs.AR": "体系结构", "cs.DC": "体系结构", "cs.NI": "计算机网络",
  "cs.CR": "网络与信息安全", "cs.DB": "数据库", "cs.DS": "理论",
  "cs.LG": "人工智能", "cs.AI": "人工智能", "cs.CL": "人工智能", "cs.CV": "人工智能",
  "cs.IR": "数据库", "cs.HC": "人机交互", "cs.MM": "图形学与多媒体", "cs.GR": "图形学与多媒体",
};

export const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export const isPreprintVenue = (v) => PREPRINT_VENUES.has((v || "").trim().toLowerCase());

export const realDoi = (d) => (d && !d.startsWith("10.48550/") ? d : null); // 10.48550 是 arXiv 自有 DOI

// 标题匹配：前缀/后缀匹配且长度相近（防 'Spectral properties of' 误配长标题）
export function titleMatch(a, b) {
  if (a.length < 15 || b.length < 15) return false;
  if (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.6;
  }
  return false;
}

export function loadCcf(json) {
  const rows = [];
  for (const p of json) {
    if (p.length >= 6) {
      rows.push({ abbr: p[0], name: p[1], rank: p[2], kind: p[3], area: p[4], pub: p[5], url: p[6] || "" });
    }
  }
  return rows;
}

// areaHint: arXiv 分类推出的 CCF 领域子串，无则落回 A 级优先
export function ccfMatch(venue, rows, areaHint = null) {
  const v = norm(venue);
  if (!v) return null;
  const want = ALIAS[v];
  const cands = rows.filter(
    (r) => norm(r.abbr) === v || (want && r.abbr.toUpperCase() === want.toUpperCase())
  );
  if (cands.length) {
    if (areaHint) {
      for (const r of cands) if (r.area.includes(areaHint)) return r;
    }
    cands.sort((a, b) => (a.rank !== "A") - (b.rank !== "A") || (a.rank !== "B") - (b.rank !== "B"));
    return cands[0];
  }
  for (const r of rows) {
    // 全称包含（双向），太短的防误伤
    const n = norm(r.name);
    if (v.length >= 10 && (v.includes(n) || (n.length >= 10 && n.includes(v)))) return r;
  }
  return null;
}

export function csAreaHint(categories) {
  for (const k of categories || []) {
    if (CS_AREA_HINT[k]) return CS_AREA_HINT[k];
  }
  return null;
}
