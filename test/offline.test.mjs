// 离线单测：comments 提取 / id 解析 / CCF 匹配 / 撞名消歧 / 标题匹配（不打网络）
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { parseArxivId, commentsVenue } from "../src/resolver.js";
import { loadCcf, ccfMatch, norm, titleMatch, csAreaHint } from "../src/ccf.js";

const rows = loadCcf(JSON.parse(await readFile(new URL("../data/ccf.json", import.meta.url), "utf8")));

// ---- parseArxivId ----
assert.equal(parseArxivId("https://arxiv.org/abs/2407.01489"), "2407.01489");
assert.equal(parseArxivId("https://arxiv.org/abs/2407.01489v2"), "2407.01489");
assert.equal(parseArxivId("arXiv:1706.03762"), "1706.03762");
assert.equal(parseArxivId("https://arxiv.org/pdf/2310.06825v3"), "2310.06825");
assert.equal(parseArxivId("not-a-url"), null);

// ---- commentsVenue ----
assert.equal(commentsVenue({ comments: "Accepted at ASE 2026" }), "ASE");
assert.equal(commentsVenue({ comments: "accepted to CIKM 2026 as a full paper" }), "CIKM 2026 as a full paper"); // 尾部噪声由 CCF 全称兜底过滤
assert.equal(commentsVenue({ comments: "To appear in Proc. ACM Softw. Eng." }), "Proc"); // 句号断词截断，由 S2/DBLP 兜底（Python 版同样行为）
assert.equal(commentsVenue({ comments: "accepted at NeurIPS 2026 (spotlight)" }), "NeurIPS");
assert.equal(commentsVenue({ comments: "Accepted at arXiv" }), null);

// ---- ccfMatch 基本匹配 ----
const fse = ccfMatch("FSE", rows, "软件工程");
assert.equal(fse.rank, "A");
assert.equal(fse.abbr, "FSE");
// FSE 无领域提示 → 加密 B 会与软工 A 会撞名，退回 A 级优先
const fseNoHint = ccfMatch("FSE", rows);
assert.equal(fseNoHint.rank, "A");
const fseCrypto = ccfMatch("FSE", rows, "网络与信息安全");
assert.equal(fseCrypto.rank, "B");

// ---- ALIAS：PACMSE → FSE ----
const pacm = ccfMatch("PACMSE", rows, "软件工程");
assert.equal(pacm.abbr, "FSE");
assert.equal(pacm.rank, "A");
const full = ccfMatch("Proceedings of the ACM on Software Engineering", rows, "软件工程");
assert.equal(full.abbr, "FSE");

// ---- NeurIPS 别名 ----
const nip = ccfMatch("Advances in Neural Information Processing Systems", rows, "人工智能");
assert.equal(nip.abbr, "NeurIPS");

// ---- 全称包含 ----
// ---- 全称包含：注意 PR(Pattern Recognition) 会先于 CVPR 被包含规则匹配（Python 版同样行为），
// S2 真实返回一般是 "CVPR" 缩写或完整正式名。缩写路径最常见。
assert.equal(ccfMatch("CVPR", rows, "人工智能").abbr, "CVPR");
assert.equal(ccfMatch("Proceedings of the IEEE International Conference on Computer Vision", rows, "人工智能").abbr, "ICCV");

// ---- 期刊 ----
const tocs = ccfMatch("ACM Transactions on Computer Systems", rows, "体系结构");
assert.equal(tocs.abbr, "TOCS");
assert.equal(tocs.kind, "期刊");

// ---- 非目录 venue 不误配 ----
assert.equal(ccfMatch("Some Unknown Workshop", rows), null);
assert.equal(ccfMatch("", rows), null);

// ---- titleMatch：去前缀副标题（Agentless 正式版 "Demystifying..." 是 "Agentless: Demystifying..." 的后缀） ----
assert.ok(titleMatch(norm("Agentless: Demystifying LLM-based Software Engineering Agents"),
                     norm("Demystifying LLM-Based Software Engineering Agents")));
// 防误伤：短前缀不匹配长标题
assert.ok(!titleMatch(norm("Spectral properties of"), norm("Spectral properties of some very long title here beyond threshold")));
// 长度比低于 0.6 不匹配
assert.ok(!titleMatch(norm("A short prefix title matching thing"), norm("A short prefix title matching thing plus a whole lot of extra words appended here")));

// ---- csAreaHint ----
assert.equal(csAreaHint(["cs.SE", "cs.LG"]), "软件工程");
assert.equal(csAreaHint(["cs.LG"]), "人工智能");
assert.equal(csAreaHint(["math.AG"]), null);

// ---- 数据完整性 ----
assert.equal(rows.length, 681);
for (const r of rows) {
  assert.ok(["A", "B", "C"].includes(r.rank), `rank 异常: ${r.abbr}`);
  assert.ok(["会议", "期刊"].includes(r.kind), `kind 异常: ${r.abbr}`);
}

console.log("all offline tests passed");
