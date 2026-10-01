// popup：手动输入 arXiv id/URL 解析（background 里没有 DOM/页面 meta，走 arXiv API 取元数据）
const $ = (s) => document.querySelector(s);

// S2 API key 设置（存 storage.local，background 启动时读取）
chrome.storage.local.get("s2key").then((o) => {
  $("#s2key").value = o.s2key || "";
});
$("#savekey").addEventListener("click", async () => {
  const key = $("#s2key").value.trim();
  const r = await chrome.runtime.sendMessage({ type: "setKey", key: key || null });
  $("#keystatus").textContent = r?.ok ? "已保存 ✓" : "保存失败";
  setTimeout(() => ($("#keystatus").textContent = ""), 1500);
});

async function arxivMeta(aid) {
  const xml = await (await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(aid)}`)).text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const e = doc.querySelector("entry");
  if (!e || e.querySelector("title")?.textContent?.trim().startsWith("Error")) return null;
  const t = (tag) => e.getElementsByTagName(tag)[0]?.textContent?.trim() || "";
  return {
    id: aid,
    title: t("title"),
    authors: [...e.getElementsByTagName("author")].map((a) => a.getElementsByTagName("name")[0].textContent),
    year: t("published").slice(0, 4),
    categories: [...e.getElementsByTagName("category")].map((c) => c.getAttribute("term")).filter(Boolean),
    comments: t("arxiv:comment"),
    journalRef: t("arxiv:journal_ref"),
    doi: t("arxiv:doi"),
  };
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function render(res) {
  const out = $("#out");
  if (!res) {
    out.innerHTML = '<span class="err">未找到该 arXiv ID</span>';
    return;
  }
  const rank = res.ccf?.rank;
  const badge = res.ccf ? `<span class="badge ${rank.toLowerCase()}">${rank}</span>` : "";
  let h = `<div><b>${esc(res.title)}</b></div>`;
  if (res.venue) {
    h += `<div class="row">发表: ${esc(res.venue)} ${badge}
      <span class="muted">${esc(res.ccf?.kind || "")} ${esc(res.ccf?.area || "")}</span></div>`;
    h += `<div class="muted">来源: ${esc(res.venueSource)}</div>`;
  } else if (res.offline) {
    h += '<div class="row">解析失败（S2 限流/网络不可用），稍后重试</div>';
  } else {
    h += '<div class="row">未见正式发表（预印本）</div>';
  }
  if (res.link && res.link !== `https://arxiv.org/abs/${res.arxivId}`) {
    h += `<div><a href="${esc(res.link)}" target="_blank" rel="noopener">${esc(res.link)}</a></div>`;
  }
  if (res.bibtex) {
    h += `<details><summary>BibTeX</summary><pre>${esc(res.bibtex)}</pre></details>`;
  }
  out.innerHTML = h;
}

$("#go").addEventListener("click", async () => {
  const raw = $("#aid").value.trim();
  const m = raw.match(/arxiv\.org\/(?:abs|pdf|html)\/([^/#?]+)/) || raw.match(/^(?:arxiv:)?([\d.]{9,10}|[a-z-]+\/\d{7})/i);
  const id = m ? m[1].replace(/v\d+$/i, "") : null;
  const status = $("#status");
  if (!id) {
    $("#out").innerHTML = '<span class="err">无法识别 arXiv ID</span>';
    return;
  }
  status.textContent = "解析中…";
  try {
    const meta = await arxivMeta(id);
    if (!meta) throw new Error("arXiv API 未返回该 ID");
    const r = await chrome.runtime.sendMessage({ type: "resolve", id, meta });
    status.textContent = "";
    if (r?.ok) render(r.result);
    else $("#out").innerHTML = `<span class="err">${esc(r?.error || "解析失败")}</span>`;
  } catch (e) {
    status.textContent = "";
    $("#out").innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
});

// 当前标签页是 abs 页时自动填充
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const m = (tab?.url || "").match(/arxiv\.org\/abs\/([^/?#]+)/);
  if (m) $("#aid").value = decodeURIComponent(m[1]);
});
