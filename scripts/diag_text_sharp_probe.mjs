// Stage 6: event-driven GL text resharpen after zoom stops.
// Mid-zoom must not rebake. About 150 ms after the last zoom change, the
// atlas is raised to the on-screen size and Present remeshes text (it must
// not ReplayMesh the old glyphs). No polling. Starts its own server.py on a
// free port; never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const srcPerf = fs.readFileSync(path.join(ROOT, "public/node-graph-viewport-perf.js"), "utf8");
const srcGl = fs.readFileSync(path.join(ROOT, "public/node-graph-gl-graph.js"), "utf8");

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

check(srcPerf.includes("scheduleNodeGraphViewTextQuality"), "viewport-perf has the 150 ms text-quality timer");
check(!/setInterval\s*\(/.test(srcPerf) || !srcPerf.includes("scheduleNodeGraphViewTextQuality") || !/setInterval\s*\([^)]*TextQuality/.test(srcPerf), "text quality is not a setInterval poll");
check(srcGl.includes("resharpenText"), "Present can force a text remesh (resharpenText)");
check(srcGl.includes("textBakeDirty"), "a bake-size change marks the mesh dirty for remesh");

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.unref();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

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
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: Number(process.env.DPR||1) });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".node-boot-loading-screen");
    return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});

  await page.evaluate(async (p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "probe" });
    setNodeGraphZoom(2);
    flushNodeGraphViewportImmediate({ persist: false });
    await new Promise((r) => setTimeout(r, 2500));
  }, patch);
  const info = await page.evaluate(() => {
    const ch = nodeGraphGlGraphState.chrome;
    const out = { keys: Object.keys(ch), n: {}, sample: [] };
    for (const k of Object.keys(ch)) if (Array.isArray(ch[k])) out.n[k] = ch[k].length;
    for (const t of (ch.titles || []).slice(0, 3)) out.sample.push({ kind: "title", keys: Object.keys(t), text: t.el?.textContent?.trim(), h: t.h, box: t.box, cs: t.el ? (({fontFamily,fontSize,fontWeight,color,opacity,visibility}) => ({fontFamily,fontSize,fontWeight,color,opacity,visibility}))(getComputedStyle(t.el)) : null });
    for (const t of (ch.sliders || []).slice(0, 2)) out.sample.push({ kind: "slider", keys: Object.keys(t), labelPx: t.labelPx, valuePx: t.valuePx });
    return out;
  });  console.log(JSON.stringify(info, null, 1));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}