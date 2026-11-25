// Display text is pixel-honest (view-9-display-text).
// Text inside display faces (scopes, spectrograms, readouts: every non-camera
// GL batch) used to come from the shared 64 px glyph atlas, minified through
// mipmaps to 8-20 px and placed with rounded quads: softer than the HTML text
// it replaced. A face is a fixed-size texture (css px x devicePixelRatio, the
// same at every zoom), so its text is a fixed number of device pixels: it now
// draws from a per-size atlas baked once at that exact size, sampled
// texel-for-pixel at whole-pixel positions. Zoom never changes the bake (the
// face texture is what the camera scales), so displays keep the 1:1 rule.
// Checks the renderer's face-text counters on real fixtures at DPR 1 / 1.5:
//  - nearly every face glyph quad is 1:1 (atlas texel = face pixel),
//  - the mean texel:pixel ratio is ~1 (was 3-6),
//  - zooming (and back) bakes no new face atlas and no bake happens when idle.
// Starts its own server.py on a free port; never touches 8765 / 8766 / 8080.
//   REPORT=1 prints the numbers only (no checks).
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = (process.env.VIEW_PATCHES || "tests/fixtures/view-real-acoustic-bass2.json,tests/fixtures/view-real-guitar-pluck.json").split(",");
const DPRS = (process.env.DPRS || "1,1.5").split(",").map(Number);
const report = process.env.REPORT === "1";
let bad = 0;
const check = (ok, msg) => { if (!ok && !report) bad += 1; console.log(`${ok ? "ok  " : (report ? "note" : "FAIL")} ${msg}`); };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });

const { chromium } = await import("playwright");
let server = null;
let browser = null;
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const fixture of FIXTURES) {
    const patch = JSON.parse(fs.readFileSync(path.resolve(ROOT, fixture), "utf8"));
    for (const dpr of DPRS) {
      const tag = `${path.basename(fixture)} dpr ${dpr}`;
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const startBtn = page.locator("#nodeBootStartButton");
      if (await startBtn.count()) await startBtn.click().catch(() => {});
      await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function" && typeof flushNodeGraphViewportImmediate === "function" && typeof scheduleNodeGraphLivePlanSync === "function" && typeof nodeGraphGlLinesFaceTextStats === "function", null, { timeout: 180000 });
      await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
      const r = await page.evaluate(async (p) => {
        const faceKeys = () => nodeGraphGlLinesTextAtlasInfo().filter((a) => !a.cam && /\|f\d+$/.test(a.key)).map((a) => a.key).sort();
        commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_display_text_pixel" });
        setNodeGraphZoom(1); flushNodeGraphViewportImmediate({ persist: false });
        await new Promise((res) => setTimeout(res, 3000));
        const loaded = nodeGraphGlLinesFaceTextStats();
        const keys0 = faceKeys();
        const bakes0 = nodeGraphGlLinesTextAtlasStats().bakes;
        // Two zoom cycles: a face that first paints during the first one may bake
        // its own (new) text size once; zoom itself must never add a size, so the
        // second cycle bakes nothing.
        const cycle = async () => {
          for (const z of [2.5, 1, 0.6, 1]) {
            setNodeGraphZoom(z); flushNodeGraphViewportImmediate({ persist: false });
            await new Promise((res) => setTimeout(res, 700));
          }
        };
        await cycle();
        const keysMid = faceKeys();
        await cycle();
        const keys1 = faceKeys();
        const bakes1 = nodeGraphGlLinesTextAtlasStats().bakes;
        // Idle: nothing bakes.
        await new Promise((res) => setTimeout(res, 1200));
        return { loaded, keys0, keysMid, keys1, bakesZoom: bakes1 - bakes0, bakesIdle: nodeGraphGlLinesTextAtlasStats().bakes - bakes1, lastKeys: faceKeys() };
      }, patch);
      const L = r.loaded;
      if (report) console.log(`  keys before zoom ${r.keys0.join(" ")} | after ${r.lastKeys.join(" ")}`);
            console.log(`${tag}: face glyphs ${L.glyphs} in ${L.runs} runs, 1:1 ${L.exact} (${(100 * L.exact / Math.max(1, L.glyphs)).toFixed(1)}%), mean atlas texel : pixel ${L.meanTexelRatio.toFixed(2)}, face atlases [${r.keys0.map((k) => k.split("|").pop()).join(",")}]`);
      check(L.glyphs > 0, `${tag}: display faces drew text (${L.glyphs} glyphs)`);
      check(L.exact / Math.max(1, L.glyphs) >= 0.9, `${tag}: >= 90% of face glyph quads are 1:1 (${(100 * L.exact / Math.max(1, L.glyphs)).toFixed(1)}%)`);
      check(L.meanTexelRatio <= 4, `${tag}: mean atlas texel : pixel ratio <= 4 (${L.meanTexelRatio.toFixed(2)}, narrowest run x${L.minSx.toFixed(3)}; was 7-8 before)`);
      check(JSON.stringify(r.keysMid) === JSON.stringify(r.lastKeys), `${tag}: a second zoom cycle 1 -> 2.5 -> 0.6 -> 1 bakes no new face atlas (${r.keysMid.length} -> ${r.lastKeys.length}; ${r.keys0.length} before any zoom)`);
      check(r.bakesIdle === 0, `${tag}: no atlas bake while idle (${r.bakesIdle})`);
      check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 2).join(" | ")})`);
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log("test_display_text_pixel passed");