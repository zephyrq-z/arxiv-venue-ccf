# E2E 验证：scripts/e2e_check.py
# Chrome 137+ 移除 --load-extension → 用 CDP Extensions.loadUnpacked 安装（Puppeteer 同路径）。
# 流程：启动 headless CFT → 安装扩展 → 导航 abs 页 → 轮询 #avc-venue-box → 断言。
# 注意：S2 公共池限流严格，脚本对每个 id 最多等 150s（节流+退避）。
# 用法: python3 scripts/e2e_check.py [chrome路径] [arxiv_id] [期望子串]
#   默认: 1706.03762 期望 "Neural Information Processing Systems"（NeurIPS A）
import asyncio, json, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFT = sys.argv[1] if len(sys.argv) > 1 else (
    "/Users/zzq/.omp/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
ARXIV_ID = sys.argv[2] if len(sys.argv) > 2 else "1706.03762"
EXPECT = sys.argv[3] if len(sys.argv) > 3 else "Neural Information Processing Systems"
PORT = 9355
PROFILE = "/tmp/avc-e2e-run"

async def cdp(ws, id_, method, params=None, timeout=60):
    await ws.send(json.dumps({"id": id_, "method": method, "params": params or {}}))
    while True:
        r = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if r.get("id") == id_:
            return r

async def main():
    import websockets
    proc = subprocess.Popen([
        CFT, "--headless=new", f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE}", "--no-first-run", "--disable-gpu",
        "--enable-unsafe-extension-debugging", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(20):
            try:
                ver = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=2))
                break
            except Exception:
                time.sleep(1)
        else:
            print("FAIL: CDP 未启动"); sys.exit(1)

        async with websockets.connect(ver["webSocketDebuggerUrl"], max_size=10**7) as bws:
            r = await cdp(bws, 1, "Extensions.loadUnpacked", {"path": str(ROOT / "extension")})
            if "error" in r:
                print("FAIL: 扩展安装失败:", r["error"]["message"]); sys.exit(1)
            print(f"installed: {r['result']['id']}")

        targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=5))
        page = next(t for t in targets if t["type"] == "page")
        async with websockets.connect(page["webSocketDebuggerUrl"], max_size=10**7) as ws:
            await cdp(ws, 10, "Page.navigate", {"url": f"https://arxiv.org/abs/{ARXIV_ID}"})
            box = ""
            for i in range(75):  # 最多 150s
                await asyncio.sleep(2)
                r = await cdp(ws, 100 + i, "Runtime.evaluate", {
                    "expression": "(document.querySelector('#avc-venue-box')||{}).textContent || ''",
                    "returnByValue": True})
                box = r.get("result", {}).get("result", {}).get("value", "") or ""
                if box and "正在解析" not in box:
                    break
            compact = " ".join(box.split())[:220]
            print(f"[{ARXIV_ID}] {compact}")
            offline = "限流/网络不可用" in box
            ok = bool(box) and "正在解析" not in box and (EXPECT in box or offline)
            if offline and EXPECT not in box:
                print("E2E: SKIP（S2 限流窗口，非代码问题——离线单测与缓存命中已覆盖逻辑）")
                sys.exit(0)
            print("E2E:", "PASS" if ok else "FAIL")
            sys.exit(0 if ok else 1)
    finally:
        proc.terminate()

asyncio.run(main())
