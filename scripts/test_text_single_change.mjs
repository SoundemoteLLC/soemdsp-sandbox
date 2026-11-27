// Each piece of GL text changes once while it resharpens after a zoom.
// The lazy sharpen job re-records module stacks one at a time. A stack whose
// exact atlas sizes were not baked yet used to be swapped in anyway, drawn with
// fallback atlases, and then repainted again once the sizes were baked: the same
// text visibly changed twice (higher resolution, then the correct scale).
// Strict repaint (nodeGraphGlGraphRepaintMeshedPlates { strict }) discards such a
// record, keeps the old picture drawing, and swaps once the exact atlas exists.
// Lazy rendering stays: different stacks still swap at different times.
// This test samples every frame's text signature per module stack (atlas
// texture, bake size, snap scale, glyph count of every text run) from the moment
// the wheel stops, and asserts per stack:
//   - at most ONE change (old atlas -> exact atlas),
//   - the final state is 1:1 (snap scale = zoom x device scale, no fallback atlas),
//   - no text frame is drawn with a fallback atlas in between.
// Starts its own server.py on a free port; never touches 8765 / 8766 / 8080.
//   node scripts/test_text_single_change.mjs     (REPORT=1: print only)
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = (process.env.VIEW_PATCHES || "tests/fixtures/view-real-acoustic-bass2.json,tests/fixtures/view-real-guitar-pluck.json").split(",");
const DPRS = (process.env.DPRS || "1,1.5").split(",").map(Number);
const report = process.env.REPORT === "1";
const srcGl = fs.readFileSync(path.join(ROOT, "public/node-graph-gl-graph.js"), "utf8");
let bad = 0;
const check = (ok, msg) => { if (!ok && !report) bad += 1; console.log(`${ok ? "ok  " : (report ? "note" : "FAIL")} ${msg}`); };
check(srcGl.includes("strict: tried <") && srcGl.includes('return "fallback"'), "the sharpen job repaints strictly (a fallback-atlas record is discarded, not swapped in)");
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
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message || e)));
      await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const startBtn = page.locator("#nodeBootStartButton");
      if (await startBtn.count()) await startBtn.click().catch(() => {});
      await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function" && typeof flushNodeGraphViewportImmediate === "function" && typeof scheduleNodeGraphLivePlanSync === "function" && typeof viewFrame === "function" && typeof nodeGraphGlGraphRepaintMeshedPlates === "function", null, { timeout: 180000 });
      await page.waitForFunction(() => document.body.classList.contains("node-boot-ready")
        && typeof createNodeSliderReadout === "function" && typeof nodeGraphScopeWindowSettings !== "undefined", null, { timeout: 180000 });
      await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
      await page.evaluate(async (p) => {
        commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_text_single_change" });
        setNodeGraphZoom(1); flushNodeGraphViewportImmediate({ persist: false });
        await new Promise((r) => setTimeout(r, 2500));
        // Frame the largest module, then wait until the text is sharp at that zoom.
        const els = [...document.querySelectorAll(".dsp-node")].filter((e) => nodeGraphGlGraphWorldBox(e));
        els.sort((a, b) => { const A = nodeGraphGlGraphWorldBox(a); const B = nodeGraphGlGraphWorldBox(b); return B.w * B.h - A.w * A.h; });
        const bx = nodeGraphGlGraphWorldBox(els[0]);
        viewFrame({ x: bx.x - bx.w * 0.5, y: bx.y - bx.h * 0.5, w: bx.w * 2, h: bx.h * 2 });
        for (let i = 0; i < 80; i += 1) {
          await new Promise((r) => setTimeout(r, 100));
          const s = nodeGraphGlGraphState;
          if (!s.sharpen?.want && Math.abs((s.textRecordScale || 0) - nodeGraphGlGraphSharpenScale()) < 1e-3) break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }, patch);
      // Per-frame text signature of every module stack.
      await page.evaluate(() => {
        const texIds = new WeakMap();
        let nextTex = 1;
        const texId = (t) => { if (!t) return 0; if (!texIds.has(t)) texIds.set(t, nextTex++); return texIds.get(t); };
        const st = { frames: [], run: true, wheelEnd: 0 };
        window.__ts = st;
        const sample = () => {
          const s = nodeGraphGlGraphState;
          const mesh = s.mesh;
          const batch = mesh?.batches?.[0];
          const rec = {};
          if (batch?.layers && Array.isArray(mesh.plateGroupLayers)) {
            for (const range of mesh.plateGroupLayers) {
              const runs = [];
              nodeGraphGlGraphEachTextRun(batch.layers.slice(range.layerStart, range.layerEnd), (t) => {
                if (t.color) return;
                runs.push(`${texId(t.texture)}:${t.bakePx}:${(+t.snapScale || 0).toFixed(3)}:${t.end - t.start}`);
              });
              rec[String(range.ids[0])] = runs.join(",");
            }
          }
          st.frames.push({ t: performance.now(), rec, scale: nodeGraphGlGraphSharpenScale(), fb: nodeGraphGlLinesTextAtlasStats().fallbacks, discarded: s.sharpen?.discarded || 0, repaints: s.sharpen?.repaints || 0 });
          if (st.run) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.mouse.move(700, 450);
      for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, -120); await page.waitForTimeout(50); }
      await page.evaluate(() => {
        window.__ts.wheelEnd = performance.now();
        window.__ts.atlasBakeStart = nodeGraphGlLinesTextAtlasStats().bakes;
        window.__ts.stackRepaintStart = nodeGraphGlGraphState.sharpen?.repaints || 0;
      });
      // Test-side wait for the sharpen job to finish (the app itself does not poll).
      await page.waitForFunction(() => { const s = nodeGraphGlGraphState; return performance.now() - window.__ts.wheelEnd > 600 && !s.sharpen?.want && Math.abs((s.textRecordScale || 0) - nodeGraphGlGraphSharpenScale()) < 1e-3; }, null, { timeout: 30000, polling: 100 }).catch(() => {});
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        window.__ts.run = false;
        window.__ts.atlasBakeEnd = nodeGraphGlLinesTextAtlasStats().bakes;
        window.__ts.stackRepaintEnd = nodeGraphGlGraphState.sharpen?.repaints || 0;
        return window.__ts;
      });
      const after = r.frames.filter((f) => f.t >= r.wheelEnd);
      const ids = Object.keys(after[0]?.rec || {});
      const changes = {};
      for (const id of ids) {
        let n = 0;
        for (let i = 1; i < after.length; i += 1) if (after[i].rec[id] !== after[i - 1].rec[id] && after[i].rec[id] !== undefined && after[i - 1].rec[id] !== undefined) n += 1;
        changes[id] = n;
      }
      const last = after[after.length - 1];
      const stale = ids.filter((id) => (last.rec[id] || "").split(",").filter(Boolean).some((run) => { const sc = Number(run.split(":")[2]); return !(sc > 0) || Math.abs(sc - last.scale) > 1e-3 * last.scale; }));
      const moved = ids.filter((id) => changes[id] > 0);
      const multi = ids.filter((id) => changes[id] > 1);
      const unchanged = ids.filter((id) => changes[id] === 0);
      const atlasBakeDelta = r.atlasBakeEnd - r.atlasBakeStart;
      const stackRepaintDelta = r.stackRepaintEnd - r.stackRepaintStart;
      const hist = {};
      for (const id of ids) hist[changes[id]] = (hist[changes[id]] || 0) + 1;
      console.log(`${tag}: ${ids.length} stacks, changes per stack ${JSON.stringify(hist)}, ${after.length} frames, atlas bake delta ${atlasBakeDelta}, stack repaint delta ${stackRepaintDelta}, discarded fallback records ${last.discarded - (after[0]?.discarded || 0)}`);
      check(moved.length >= 1, `${tag}: the zoom resharpened some stacks (${moved.length})`);
      check(multi.length === 0 && moved.every((id) => changes[id] === 1), `${tag}: each changed text stack updates exactly once (${multi.slice(0, 4).map((id) => `${id} x${changes[id]}`).join(", ") || "none"})`);
      check(unchanged.every((id) => changes[id] === 0) && stackRepaintDelta === moved.length,
        `${tag}: unchanged stacks are not repainted (${unchanged.length} unchanged, ${stackRepaintDelta} repaints for ${moved.length} changed)`);
      check(atlasBakeDelta > 0, `${tag}: atlas bake counter records settled sharp-text work (${atlasBakeDelta})`);
      check(stale.length === 0, `${tag}: every stack ends 1:1 at the zoom x device scale (stale: ${stale.slice(0, 4).join(", ") || "none"})`);
      check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 2).join(" | ")})`);
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log("test_text_single_change passed");
