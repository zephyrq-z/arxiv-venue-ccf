# arXiv Venue & CCF

在 arXiv abs 页直接看到论文**正式发表在哪**、CCF 评级、DOI 与可复制的 BibTeX。

Chrome MV3 扩展（Manifest V3，无需构建工具，纯原生 JS）。数据链路移植自
[arxiv-venue-resolver](../arxiv-venue-resolver)（Python CLI），全部在浏览器内运行。

## 功能

打开任意 `arxiv.org/abs/…` 页面，摘要上方插入一张卡片：

```
发表  Proc. ACM Softw. Eng.   [A]  会议 · 软件工程/系统软件/程序设计语言   DOI ↗
      Semantic Scholar (title match)
[复制 BibTeX]  ▸ BibTeX
```

- **venue + CCF 评级**（A/B/C 徽章，来自 CCF 推荐目录 681 个会议/期刊）
- **数据源标注**：作者自报（journal_ref / comments "Accepted at X"）与权威源
  （Semantic Scholar / DBLP）明确区分，不信自报
- **DOI 直链** + **BibTeX**（S2 现成优先；预印本形态自动重拼为带正式 venue 的条目）
- 未发表则明确显示"未见正式发表（预印本）"，负缓存 90 天避免重复请求
- popup 可手动解析任意 arXiv ID/URL（不打开页面也能查）

## 与 Super arXiv 的差异

| | Super arXiv | 本扩展 |
|---|---|---|
| CCF 评级 | 无 | 681 venue 目录 + 撞名消歧（FSE 双义按 arXiv 分类消歧）+ 别名映射（PACMSE→FSE） |
| 数据源可信度 | 不区分 | journal_ref/comments 标注 author-claimed；S2/DBLP 权威 |
| 限流处理 | — | S2 串行节流 + 429 指数退避 + 负缓存（90 天）不重复打 |
| S2 未收录 | — | DBLP API 兜底 + S2 标题搜索（含 arXiv preprint 去前缀重投） |
| 未发表判定 | — | CoRR/arXiv 镜像 venue 视为未发表，继续找正式版 |

## 解析链路（从最便宜到最权威，命中即停）

```
① 页面 journal_ref / DOI       （0 请求，作者自报）
①' comments "Accepted at X"    （0 请求，作者自报）
② Semantic Scholar by-id       （权威，chrome.storage 持久缓存）
③ S2 标题搜索                   （S2 未合并 venue 时）
④ DBLP API 兜底                 （S2 查不到正式版时）
⑤ CCF 目录匹配                  （缩写/别名/全称，撞名按 arXiv 分类消歧）
```

## 安装（开发者模式）

1. `chrome://extensions` → 打开"开发者模式"
2. "加载已解压的扩展程序" → 选本仓库的 `extension/` 目录

可选（推荐）：点扩展图标 → popup 里填 Semantic Scholar API key（免费申请
[此处](https://www.semanticscholar.org/product/api#api-key-form)），绕过公共池限流。

## 开发

```bash
python3 scripts/build_ccf_json.py  # 重新生成 data/ccf.json（源：arxiv-venue-resolver/ccf_v7.tsv）
npm run build                      # 同步 src/ + data/ 到 extension/
npm run test:offline               # 离线单测（无网络）：CCF 匹配/消歧/comments 提取
node test/one.mjs                  # 网络冒烟：真实 S2 解析
python3 scripts/e2e_check.py       # 端到端：headless Chrome + CDP 安装扩展 + abs 页断言
```

无依赖：Node ≥ 22（测试用）、Python 3（仅构建脚本用）。扩展本身零构建零依赖。

## 文件

| 文件 | 作用 |
|---|---|
| `extension/manifest.json` | MV3 清单（storage 权限 + S2/DBLP/arXiv host 权限） |
| `extension/content.js` | abs 页元数据提取（零请求）+ 卡片渲染 |
| `extension/background.js` | SW：S2 节流退避、DBLP 兜底、chrome.storage 缓存、可选 API key |
| `src/resolver.js` `src/ccf.js` | 解析链路与 CCF 匹配（与 extension/ 同步，Node 可测） |
| `extension/popup.{html,js}` | 手动解析 + S2 key 设置 |
| `data/ccf.json` | CCF 目录（681 行，由 ccf_v7.tsv 生成） |

## 已知限制

- DBLP API 可能被 Anubis bot 防护拦截（本机网络下实测发生）；此时依赖 S2。
- S2 公共池限流严格（~1 rps）：无 key 时多篇连续打开会退避重试，首次较慢；
  设 key 后恢复正常。负缓存保证每篇最多完整解析一次。
- 老式 arXiv ID（`math.AG/0701001` 带点子库）不解析，静默跳过。
- comments 提取的 venue 可能带尾部噪声（"CIKM 2026 as a full paper"），
  由 CCF 全称匹配与 S2/DBLP 兜底修正。

## License

MIT
