# E2E 验证：scripts/e2e_check.py
# Chrome 137+ 移除 --load-extension → 用 CDP Extensions.loadUnpacked 安装（Puppeteer 同路径）。
# 流程：启动 headless CFT → 安装扩展 → 导航 abs 页 → 轮询 #avc-venue-box → 断言 venue/CCF。
# 用法: python3 scripts/e2e_check.py [arxiv_id ...]（默认 Agentless，应得 FSE·A）
import asyncio, json, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFT = ("/Users/zzq/.omp/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/"
       "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = 9345
PROFILE = "/tmp/avc-e2e"
IDS = sys.argv[1:] or ["2407.01489"]

async def cdp(ws, id_, method, params=None, timeout=45):
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
    ok_all = True
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
            ext_id = r["result"]["id"]
            print(f"installed: {ext_id}")

            targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=5))
            page = next(t for t in targets if t["type"] == "page")
            async with websockets.connect(page["webSocketDebuggerUrl"], max_size=10**7) as ws:
                for n, aid in enumerate(IDS):
                    await cdp(ws, 10 + n, "Page.navigate", {"url": f"https://arxiv.org/abs/{aid}"})
                    box = ""
                    for i in range(60):  # 最多 120s（S2 退避 2+4+8s ×2 请求 + DBLP 兜底）
                        await asyncio.sleep(2)
                        r = await cdp(ws, 1000 + i, "Runtime.evaluate", {
                            "expression": "(document.querySelector('#avc-venue-box')||{}).textContent || ''",
                            "returnByValue": True})
                        box = r.get("result", {}).get("result", {}).get("value", "") or ""
                        if box and "正在解析" not in box:
                            break
                    compact = " ".join(box.split())[:220]
                    print(f"[{aid}] {compact}")
                    ok = bool(box) and "正在解析" not in box and "解析失败" not in box
                    if aid == "2407.01489":
                        ok = ok and "FSE" in box and "A" in box
                    print(f"[{aid}] {'PASS' if ok else 'FAIL'}")
                    ok_all = ok_all and ok
        print("E2E:", "PASS" if ok_all else "FAIL")
        sys.exit(0 if ok_all else 1)
    finally:
        proc.terminate()

asyncio.run(main())
