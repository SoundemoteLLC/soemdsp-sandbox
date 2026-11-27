// Diagnostic: GL text vs HTML text sharpness (MAS-3 text-sharp). Not a test.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patch = JSON.parse(fs.readFileSync(path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json"), "utf8"));
const OUT = process.env.OUT_DIR || path.join(process.env.TEMP || "/tmp", "textsharp-out");
fs.mkdirSync(OUT, { recursive: true });
const DPRS = (process.env.DPRS || "1,1.25,1.5").split(",").map(Number);
const ZOOMS = (process.env.ZOOMS || "1,1.5,2").split(",").map(Number);
const TAG = process.env.TAG || "before";
let WANT = process.env.LABEL || "";
const HTML_AA = process.env.HTML_AA || "gray";

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.unref(); s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
});
const { chromium } = await import("playwright");
let server = null; let browser = null;
const results = [];
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error("reserved port");
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const dpr of DPRS) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const startBtn = page.locator("#nodeBootStartButton");
    if (await startBtn.count()) await startBtn.click().catch(() => {});
    await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
    await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
    await page.evaluate(async (p) => {
      commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "text_sharp" });
      setNodeGraphZoom(1);
      flushNodeGraphViewportImmediate({ persist: false });
      await new Promise((r) => setTimeout(r, 2000));
    }, patch);
    await page.evaluate(() => { document.body.innerHTML = '<div id="host" style="position:fixed;left:0;top:0;background:#202050;width:900px;height:700px;z-index:99999"></div>'; document.body.style.background = "#202050"; });
    const sizes = [13, 21.08];
    for (const zoom of ZOOMS) {
      const layout = await page.evaluate(async ({ zoom, sizes }) => {
        const bg = [0x20 / 255, 0x20 / 255, 0x50 / 255, 1];
        const fam = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
        const host = document.getElementById("host"); host.innerHTML = "";
        const dpr = devicePixelRatio;
        const text = "Comb Resonator Frequency 0.00 Hz";
        await document.fonts.ready;
        let top = 4; const rows = [];
        for (const css of sizes) {
          const hCss = Math.ceil(css * zoom * 1.5);
          const box = document.createElement("div"); box.style.cssText = `position:absolute;left:8px;top:${top}px;will-change:transform;`;
          const sp = document.createElement("span"); sp.textContent = text; sp.style.cssText = `font:400 ${css * zoom}px ${fam};color:#fff;line-height:1;white-space:pre`;
          box.appendChild(sp); host.appendChild(box);
          rows.push({ kind: "html", css, top, hCss }); top += hCss + 6;
          const cv = document.createElement("canvas");
          cv.width = Math.round(880 * dpr); cv.height = Math.round(hCss * dpr);
          cv.style.cssText = `position:absolute;left:8px;top:${top}px;width:${cv.width / dpr}px;height:${cv.height / dpr}px`;
          host.appendChild(cv);
          const batch = nodeGraphGlLinesBegin(cv, bg, { scale: dpr, camera: { x: 0, y: 0, zoom }, keepMesh: false });
          nodeGraphGlLinesText(batch, text, 0, hCss / zoom / 2, { px: css, rgba: [1, 1, 1, 1], align: "left", baseline: "middle", weight: 400 });
          nodeGraphGlLinesEnd(batch, "alpha");
          rows.push({ kind: "gl", css, top, hCss }); top += hCss + 6;
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { rows, dpr };
      }, { zoom, sizes });
      const png = await page.screenshot({ path: path.join(OUT, `iso_dpr${DPRS[0]}_z${zoom}.png`), clip: { x: 0, y: 0, width: 900, height: 700 } });
      fs.writeFileSync(path.join(OUT, `iso_dpr${DPRS[0]}_z${zoom}.json`), JSON.stringify(layout));
    }    await context.close();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
fs.writeFileSync(path.join(OUT, `${TAG}_results.json`), JSON.stringify(results, null, 1));
console.log("saved", OUT);