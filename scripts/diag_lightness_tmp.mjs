// GL text is as sharp as HTML text (MAS-3 text-sharp).
// Causes this guards (measured, see the commit message):
//  1. the workspace GL canvas was css-sized, so the browser stretched it by
//     devicePixelRatio (backing store must be css x dpr, shown 1:1);
//  2. one 64..384 px atlas was minified to 13-21 px text through mipmaps
//     (every size must be baked at its on-screen size: zoom x dpr x px);
//  3. glyph quads were rounded to whole *world* px, so at any zoom x dpr that
//     is not an integer they landed on fractional device pixels and were
//     resampled (1:1 runs must snap their corners to device pixels in the
//     vertex shader, and only while the camera matches the recorded scale);
//  4. titles squeezed by maxWidth were resampled (they bake the fitted size).
// Starts its own server.py on a free port; never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const srcLines = fs.readFileSync(path.join(ROOT, "public/lib/visual/gl-line-renderer.js"), "utf8");
const srcGl = fs.readFileSync(path.join(ROOT, "public/node-graph-gl-graph.js"), "utf8");
const DPRS = (process.env.DPRS || "1,1.25,1.5").split(",").map(Number);

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
const { chromium } = await import("playwright");
let server = null;
let browser = null;
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.evaluate(async (p) => { commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "diag" }); setNodeGraphZoom(1); flushNodeGraphViewportImmediate({ persist: false }); await new Promise((r) => setTimeout(r, 2500)); }, patch);
  for (const zoom of (process.env.ZOOMS || "4,8,16,20,24,32,48").split(",").map(Number)) {
    for (const shift of [0]) {
    const r = await page.evaluate(async ({ zoom, shift }) => {
      const el = document.querySelector('#nodeGraphWorkspace .dsp-node[data-node="chromaColor-1"]');
      const nx = parseFloat(el.style.getPropertyValue("--node-x")); const ny = parseFloat(el.style.getPropertyValue("--node-y"));
      const geo = nodeGraphModuleGeometryGet("chromaColor-1");
      const w = geo?.box?.w || 300; const h = geo?.box?.h || 400;
      setNodeGraphZoom(zoom);
      const ws = document.getElementById("nodeGraphWorkspace");
      // centre on the module's right third (lightness cell), optionally shift so the cell is half off the right edge
      flushNodeGraphViewportImmediate({ persist: false });
      for (let it = 0; it < 3; it += 1) {
        const cam = nodeGraphWireCameraViewBox(ws); const z2 = nodeGraphZoom();
        const wx = 770.5 + 32 * shift * 4; const wy = -363;
        const dx = (wx - ws.clientWidth / (2 * z2)) - cam.x; const dy = (wy - ws.clientHeight / (2 * z2)) - cam.y;
        nodeGraphMvp.pan = { x: nodeGraphMvp.pan.x - dx * z2, y: nodeGraphMvp.pan.y - dy * z2 };
        viewCameraSet({ immediate: true, persist: false });
        flushNodeGraphViewportImmediate({ persist: false });
      }
      await new Promise((res) => setTimeout(res, 600));
      const calls = [];
      const orig = window.nodeGraphGlLinesText;
      window.nodeGraphGlLinesText = function (batch, text, x, y, o = {}) {
        if (/^(Lightness|Saturation|Hue)$/.test(String(text))) calls.push({ text, x: +(+x).toFixed(1), y: +(+y).toFixed(1), px: +(+o.px).toFixed(2), maxW: o.maxWidth != null ? +(+o.maxWidth).toFixed(1) : null, cam: !!batch?.camera, stack: new Error().stack.split("\n").slice(2, 6).map((s) => s.trim().replace(/\(?https?:\/\/[^/]+\//, "").replace(/\?v=[^:]*/, "")).join(" < ") });
        const b = batch?.textLayer || batch; const t0 = b?.tn;
        const ret = orig.apply(this, arguments);
        if (/^(Lightness|Saturation|Hue)$/.test(String(text)) && b?.tdata) {
          let x0 = Infinity; let x1 = -Infinity;
          for (let j = t0; j < b.tn; j += 48) { x0 = Math.min(x0, b.tdata[j]); x1 = Math.max(x1, b.tdata[j + 8]); }
          const c = calls[calls.length - 1]; c.inkW = +(x1 - x0).toFixed(2); c.inkScreen = +((x1 - x0) * nodeGraphZoom()).toFixed(1); delete c.stack;
        }
        return ret;
      };
      nodeGraphGlGraphPresent({ resharpenText: true });
      window.nodeGraphGlLinesText = orig;
      return { zoom: nodeGraphZoom(), w, calls, cam: nodeGraphWireCameraViewBox(ws) };
    }, { zoom, shift });
    console.log(`zoom ${zoom} shift ${shift}: moduleW ${r.w} cam ${JSON.stringify(r.cam)}`);
    for (const c of r.calls) console.log("   ", JSON.stringify(c));
    if (zoom >= 16) await page.screenshot({ path: path.join(process.env.TEMP, `lightness_z${zoom}_s${shift}.png`) });
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}