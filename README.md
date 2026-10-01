<div align="center">

# arXiv Venue & CCF

**See where an arXiv preprint was actually published, its CCF rank, DOI & BibTeX — right on the abstract page**

Chrome MV3 extension · Zero dependencies · Resolution pipeline ported from [arxiv-venue-resolver](https://github.com/zephyrq-z/arxiv-venue-resolver)

[English](README.md) | [中文](README.zh-CN.md)

![preview](docs/screenshot.png)

</div>

## What it does

Open any `arxiv.org/abs/…` page and a card appears above the abstract:

| Field | Description |
|---|---|
| **[NeurIPS]** + full name | The formal publication venue (abbr badge + full name, hover for details) |
| **CCF-A** | Rank from the CCF recommended catalog (A red / B orange / C gray), 681 venues |
| **Conference / Journal** | Venue type |
| **cs.CL cs.LG** | The paper's arXiv categories |
| **DOI ↗** | Direct link to the published version (falls back to S2/DBLP link) |
| **Copy BibTeX** | One-click copy; prefers S2's ready-made BibTeX, auto-rebuilds preprint-form entries with the formal venue |

If the paper is unpublished, the card says "no formal publication found (preprint)" and writes a 90-day negative cache — reopening the page costs zero network requests.

## Install

### From source (developer mode)

```bash
git clone https://github.com/zephyrq-z/arxiv-venue-ccf.git
```

1. Open `chrome://extensions`, enable **Developer mode** (top right)
2. **Load unpacked** → select the `extension/` directory

### Recommended: set a Semantic Scholar API key

The public pool is rate-limited aggressively (~1 request per minute). Get a [free key](https://www.semanticscholar.org/product/api#api-key-form) (1 req/s, cumulative across endpoints), then:

> **Application notes**: apply with an **academic institution email** (.edu / .ac.* etc.) — approval criteria and final interpretation rights belong to Semantic Scholar (AI2); requests from personal mailboxes may be rejected. The key only raises your rate-limit quota; this extension collects no user data.

Click the extension icon → paste into **S2 Key** → **Save Key** (stored in `chrome.storage.local`, sent as the `x-api-key` header).

> Chrome extensions cannot read shell environment variables (`SemanticScholar_API_KEY` in `~/.zshrc`); pasting once is the equivalent — it persists locally in the browser.

## Resolution pipeline (cheapest first, stops at first hit)

```
① journal_ref / DOI on the page    zero requests, author-claimed
①' comments "Accepted at X"        zero requests, author-claimed
② Semantic Scholar by-id           authoritative, cached in chrome.storage
③ S2 title search                  when S2 hasn't merged the venue
                                   (retries without the arXiv preprint title prefix)
④ DBLP API fallback                when S2 finds no formal version
⑤ CCF catalog match                abbr / alias / full name; name collisions
                                   disambiguated by arXiv category
```

**Rate limiting** (aligned with S2's official spec):

- Throttle: serial queue — 1100ms/request with a key (1 rps + 10% margin), 65s without
- Backoff: on 429/403, honor the `Retry-After` header first, else exponential backoff, up to 5 S2 retries
- Cache: results persist; negative cache (confirmed unpublished) expires after 90 days; rate-limited/offline results are **never cached** — refresh retries immediately

## How it differs from Super arXiv & similar extensions

| | Super arXiv | This extension |
|---|---|---|
| CCF rank | none | 681-venue catalog + alias mapping (PACMSE→FSE) + collision disambiguation (FSE is both a crypto B-conference and the SE A-conference) |
| Source trust | undifferentiated | journal_ref / comments marked author-claimed; S2 / DBLP authoritative |
| Rate limiting | — | official-spec throttle + Retry-After backoff + negative cache; each paper fully resolved at most once |
| Fallbacks | — | S2 by-id → S2 title search → DBLP |
| Unpublished detection | — | CoRR / arXiv mirror venues treated as unpublished, keeps looking for the formal version; rate-limited ≠ unpublished (semantics separated) |
| Source attribution | — | the card shows `Semantic Scholar` / `arXiv comments (author-claimed)` etc. |

## Development

```bash
python3 scripts/build_ccf_json.py  # regenerate data/ccf.json (source: arxiv-venue-resolver/ccf_v7.tsv)
npm run build                      # sync src/ + data/ into extension/ (run after editing src/)
npm run test:offline               # offline tests (no network): CCF matching/disambiguation, comments extraction, data integrity
node test/one.mjs                  # network smoke test: real S2 resolution
python3 scripts/e2e_check.py       # end-to-end: headless Chrome + CDP extension install + abs page assertion
```

No dependencies: Node ≥ 22 (for tests), Python 3 (build scripts only). The extension itself needs no build step and has zero dependencies.

## File layout

```
extension/            ← load this directory into Chrome
  manifest.json         MV3 manifest (storage permission + S2/DBLP/arXiv hosts)
  content.js            abs-page metadata extraction (zero requests) + card rendering
  background.js         SW: S2 throttle/backoff, DBLP fallback, cache, API key
  popup.{html,js}       resolve any arXiv ID manually + S2 key settings
  style.css             card styling
  data/ccf.json         CCF catalog (681 entries, generated)
src/                  ← logic source (synced into extension/, testable in Node)
  resolver.js           resolution pipeline
  ccf.js                CCF matching / disambiguation
scripts/              ← build / E2E
test/                 ← offline tests + network smoke test
docs/screenshot.png   ← preview image
```

## Known limitations

- S2's public pool is strictly rate-limited: without a key, the first resolution may wait 1–2 minutes in backoff (the card shows "resolution failed (rate limit) — refresh to retry"; refresh retries, nothing is cached).
- The DBLP API may be blocked by Anubis bot protection (network-dependent); S2 covers then.
- Legacy arXiv IDs (`math.AG/0701001` dotted subarchives) are skipped silently.
- Venue strings extracted from comments may carry trailing noise ("CIKM 2026 as a full paper"); CCF full-name matching and the S2/DBLP fallbacks correct this.

## License

MIT
