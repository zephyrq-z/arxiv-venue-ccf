# scripts/build_ccf_json.py — ccf_v7.tsv → data/ccf.json（扩展打包用，字段与 ccf.js loadCcf 对齐）
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "/Users/zzq/Developer/paperSearcher/arxiv-venue-resolver/ccf_v7.tsv")
DST = ROOT / "data" / "ccf.json"

rows = []
for line in SRC.read_text(encoding="utf-8").splitlines():
    p = line.split("\t")
    if len(p) >= 6:
        rows.append(p[:7] if len(p) >= 7 else p + [""])

DST.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"OK {len(rows)} venues -> {DST}")
