// Squeezed GL labels scale with zoom like every other label (view-8-lazy).
// Bug: on Chroma Color the "Lightness" (and "Saturation") parameter labels
// are wider than their cell, so the shared label path squeezes them with
// maxWidth. 1948595a re-baked a squeezed run at its fitted screen size
// (wantBake = px x zoom x dpr x fit) so it stays 1:1, but the camera bake
// size is clamped to TEXT_CAM_BAKE_MAX (256 px). Past that zoom the re-bake
// still divided by the clamped bake size, so the fitted width stopped growing
// with zoom: the word held ~1320 screen px from zoom 24 to 48 while the
// module grew, i.e. it "shrank to stay in view". Hue (not squeezed) was fine.
// Fix: a capped size never takes the fitted re-bake (it scales like any
// other run). This checks the world-space ink width of the squeezed labels
// stays the same from zoom 4 to 48 (so the screen width grows with zoom).
// Starts its own server.py on a free port; never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const ZOOMS = (process.env.ZOOMS || "4,8,16,24,32,48").split(",").map(Number);
const DPR = Number(process.env.DPR || 1);
const LABELS = /^(Lightness|Saturation|Hue)$/;

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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: DPR });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function" && typeof flushNodeGraphViewportImmediate === "function" && typeof scheduleNodeGraphLivePlanSync === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.evaluate(async (p) => { commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_text_squeeze_zoom" }); setNodeGraphZoom(1); flushNodeGraphViewportImmediate({ persist: false }); await new Promise((r) => setTimeout(r, 2500)); }, patch);
  const nodeId = await page.evaluate(() => document.querySelector('#nodeGraphWorkspace .dsp-node[data-node^="chromaColor"]')?.dataset.node || "");
  check(Boolean(nodeId), `fixture has a Chroma Color module (${nodeId || "none"})`);
  // Record every label draw for one full present, centred on (wx, wy) at zoom.
  const record = (zoom, centre) => page.evaluate(async ({ zoom, centre, src }) => {
    const LABELS = new RegExp(src);
    const ws = document.getElementById("nodeGraphWorkspace");
    setNodeGraphZoom(zoom);
    flushNodeGraphViewportImmediate({ persist: false });
    if (centre) {
      for (let it = 0; it < 3; it += 1) {
        const cam = nodeGraphWireCameraViewBox(ws); const z = nodeGraphZoom();
        const dx = (centre.x - ws.clientWidth / (2 * z)) - cam.x; const dy = (centre.y - ws.clientHeight / (2 * z)) - cam.y;
        nodeGraphMvp.pan = { x: nodeGraphMvp.pan.x - dx * z, y: nodeGraphMvp.pan.y - dy * z };
        viewCameraSet({ immediate: true, persist: false });
        flushNodeGraphViewportImmediate({ persist: false });
      }
    }
    await new Promise((res) => setTimeout(res, 400));
    const calls = [];
    const orig = window.nodeGraphGlLinesText;
    window.nodeGraphGlLinesText = function (batch, text, x, y, o = {}) {
      const b = batch?.textLayer || batch; const t0 = b?.tn;
      const ret = orig.apply(this, arguments);
      if (LABELS.test(String(text)) && batch?.camera && b?.tdata && b.tn > t0) {
        let x0 = Infinity; let x1 = -Infinity;
        for (let j = t0; j < b.tn; j += 48) { x0 = Math.min(x0, b.tdata[j]); x1 = Math.max(x1, b.tdata[j + 8]); }
        calls.push({ text: String(text), x: +x, y: +y, squeezed: o.maxWidth != null, inkW: x1 - x0 });
      }
      return ret;
    };
    try { nodeGraphGlGraphPresent({ resharpenText: true }); } finally { window.nodeGraphGlLinesText = orig; }
    return { zoom: nodeGraphZoom(), calls };
  }, { zoom, centre, src: LABELS.source });
  const first = await record(ZOOMS[0], null);
  const light0 = first.calls.find((c) => c.text === "Lightness");
  check(Boolean(light0), `Lightness label is drawn by the camera mesh at zoom ${ZOOMS[0]}`);
  const centre = light0 ? { x: light0.x, y: light0.y } : null;
  const base = new Map();
  const rows = [];
  for (const zoom of ZOOMS) {
    const r = await record(zoom, centre);
    for (const c of r.calls) {
      if (!base.has(c.text)) base.set(c.text, c);
      rows.push({ zoom: +r.zoom.toFixed(2), ...c });
    }
  }
  for (const text of ["Lightness", "Saturation", "Hue"]) {
    const list = rows.filter((c) => c.text === text);
    if (!list.length) { check(text === "Hue", `${text} drawn`); continue; }
    const w0 = list[0].inkW;
    console.log(`  ${text}${list[0].squeezed ? " (squeezed by maxWidth)" : ""}: world ink width by zoom ` + list.map((c) => `${c.zoom}:${c.inkW.toFixed(2)} (${(c.inkW * c.zoom).toFixed(0)} screen px)`).join(", "));
    const worst = list.reduce((m, c) => Math.max(m, Math.abs(c.inkW - w0) / w0), 0);
    // Glyph quads carry a few device px of padding (smaller in world units as zoom grows): allow 12%; the bug lost 50-60%.
    check(worst <= 0.12, `${text}: world width constant across zoom ${ZOOMS[0]}-${ZOOMS[ZOOMS.length - 1]} (worst drift ${(worst * 100).toFixed(1)}%), so it scales with zoom and fits its module`);
  }
  check(rows.some((c) => c.text === "Lightness" && c.squeezed), "Lightness is a squeezed label (exercises the maxWidth fit)");
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log("test_text_squeeze_zoom passed");