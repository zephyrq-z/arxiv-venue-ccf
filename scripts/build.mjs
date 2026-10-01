// scripts/build.mjs — 把 src/ 模块与 data/ 拷进 extension/（Chrome 加载目录自包含）
// ccf.json 由 scripts/build_ccf_json.py 生成
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXT = path.join(ROOT, "extension");

await mkdir(path.join(EXT, "data"), { recursive: true });
await cp(path.join(ROOT, "src", "resolver.js"), path.join(EXT, "resolver.js"));
await cp(path.join(ROOT, "src", "ccf.js"), path.join(EXT, "ccf.js"));
await cp(path.join(ROOT, "data", "ccf.json"), path.join(EXT, "data", "ccf.json"));
console.log("built: extension/ is loadable (chrome://extensions → 加载已解压)");
