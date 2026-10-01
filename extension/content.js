// content script：从 arXiv abs 页 DOM 提取元数据（journal_ref / comments / DOI / subjects
// 都在页面里，零请求），发给 background 解析，把结果插到摘要上方。
(async () => {
  const ID_RE = /\/abs\/([^/?#]+)/;
  const m = location.pathname.match(ID_RE);
  if (!m) return;
  const arxivId = decodeURIComponent(m[1]);
  if (!/^\d{4}\.\d{4,5}(v\d+)?$|^[a-z-]+\/\d{7}(v\d+)?$/.test(arxivId)) {
    return; // 非标准 id（如老式带点子库）不支持
  }

  const $ = (sel) => document.querySelector(sel);

  // meta 行（Comments:/Journal ref:）在 .tablecell 单元格里；无该行返回空
  const td = (label) => {
    for (const c of document.querySelectorAll(".tablecell, td")) {
      const t = (c.textContent || "").trim();
      if (t.startsWith(label)) return t.slice(label.length).replace(/^\s*/, "");
    }
    return "";
  };

  // 元信息从 <meta> 标签拿最稳（arXiv abs 页有 citation_* meta）
  // categories 从 subjects 单元格的 "(cs.SE)" 括号形式提取，首个为主分类
  const subjText = $("td.subjects")?.textContent || "";
  const cats = [...subjText.matchAll(/\(([a-z-]+(?:\.[A-Z]{2})?)\)/g)].map((x) => x[1]);
  const meta = {
    id: arxivId,
    title: ($('meta[name="citation_title"]')?.content || $("h1.title")?.textContent?.replace(/^\s*Title:\s*/, "") || "").trim(),
    authors: [...document.querySelectorAll('meta[name="citation_author"]')].map((e) => e.content),
    year: ($('meta[name="citation_date"]')?.content || "").slice(0, 4),
    categories: cats.length ? cats : [$("td.subjects")?.textContent?.trim().split(/\s+/)[0] || ""].filter(Boolean),
    comments: td("Comments:").trim(),
    journalRef: (td("Journal ref:") || "").trim(),
    doi: ($('meta[name="citation_doi"]')?.content || "").trim(),
  };
  if (!meta.title) return; // 页面结构大变时静默退出，别报错

  // 渲染容器（插在摘要正文之前）
  const abstractDiv = $(".abstract");
  if (!abstractDiv) return;
  const box = document.createElement("div");
  box.className = "avc-box";
  box.id = "avc-venue-box";
  abstractDiv.parentNode.insertBefore(box, abstractDiv);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  box.innerHTML =
    '<div class="avc-row avc-loading"><span class="avc-spin"></span> 正在解析发表去向…</div>';

  let res = null;
  try {
    const r = await chrome.runtime.sendMessage({ type: "resolve", id: arxivId, meta });
    if (r?.ok) res = r.result;
    else throw new Error(r?.error || "resolver error");
  } catch (e) {
    box.innerHTML = `<div class="avc-row avc-error">解析失败: ${esc(e.message)}</div>`;
    return;
  }

  // ---- 渲染 ----
  const rank = res.ccf?.rank;
  const rankCls = rank ? `avc-rank-${rank.toLowerCase()}` : "";
  const tagCats = (meta.categories || []).filter(Boolean).slice(0, 4);
  const catBtns = tagCats.map((c) => `<span class="avc-tag avc-tag-cat">${esc(c)}</span>`).join("");
  const kindBtn = res.ccf
    ? `<span class="avc-tag avc-tag-kind">${esc(res.ccf.kind)}</span>`
    : res.venueType
      ? `<span class="avc-tag avc-tag-kind">${esc(res.venueType)}</span>`
      : "";
  const rankBadge = res.ccf
    ? `<span class="avc-badge ${rankCls}" title="CCF ${rank} 类">CCF-${rank}</span>`
    : "";
  const srcTag = res.venueSource
    ? `<span class="avc-src">${esc(res.venueSource)}</span>`
    : "";

  // venue 有 CCF 匹配时显示缩写按钮 + 全称；无匹配显示原名
  const abbr = res.ccf?.abbr;
  const venueMain = abbr
    ? `<span class="avc-venue-abbr" title="${esc(res.venue)}">${esc(abbr)}</span>
       <span class="avc-venue-full">${esc(res.venue)}</span>`
    : `<span class="avc-venue">${esc(res.venue)}</span>`;

  let html = "";
  if (res.venue) {
    html = `<div class="avc-row">
      <span class="avc-label">发表</span>
      ${venueMain}
    </div>
    <div class="avc-row avc-tags">
      ${rankBadge}${kindBtn}${catBtns}
      <a class="avc-linkbtn" href="${esc(res.link)}" target="_blank" rel="noopener">DOI ↗</a>
    </div>
    <div class="avc-row avc-sub">${srcTag}</div>`;
  } else if (res.offline) {
    html = `<div class="avc-row">
      <span class="avc-label">发表</span>
      <span class="avc-none">解析失败（Semantic Scholar 限流/网络不可用）——稍后刷新重试</span>
    </div>
    <div class="avc-row avc-tags">${catBtns}</div>
    <div class="avc-row avc-sub">${srcTag}</div>`;
  } else {
    html = `<div class="avc-row">
      <span class="avc-label">发表</span>
      <span class="avc-none">未见正式发表（预印本）</span>
    </div>
    <div class="avc-row avc-tags">${catBtns}</div>
    <div class="avc-row avc-sub">${srcTag}</div>`;
  }

  // BibTeX 折叠区
  if (res.bibtex) {
    const bt = esc(res.bibtex);
    html += `<div class="avc-row">
      <button class="avc-btbtn" id="avc-copy-bibtex" type="button">复制 BibTeX</button>
      <details class="avc-btdetails"><summary>BibTeX</summary><pre class="avc-bt">${bt}</pre></details>
    </div>`;
  }

  box.innerHTML = html;

  const btn = $("#avc-copy-bibtex");
  if (btn) {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(res.bibtex);
        btn.textContent = "已复制 ✓";
        setTimeout(() => (btn.textContent = "复制 BibTeX"), 1500);
      } catch {
        btn.textContent = "复制失败";
      }
    });
  }
})();
