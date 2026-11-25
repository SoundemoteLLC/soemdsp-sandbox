// Text survives the settled-zoom remesh above 1.0 zoom (MAS-3 text flicker).
// Stage 6 rebakes the glyph atlas at the settled zoom and remeshes text. The
// atlas used to restart from the base characters and grow mid-remesh; each
// growth retired the texture that earlier text runs in the kept mesh were
// recorded with, so after one drawn frame every camera replay skipped them
// (text flashed, then vanished until the module was culled and woken).
// Checks, without any pan or cull cycle: after each settle at 1.25, 1.5, 2,
// 3, back down and up again, no text run in the GL mesh points at a deleted
// texture, glyph counts stay nonzero and stable across settle cycles, and
// each font atlas carries its own bake size. Starts its own server.py on a
// free port; never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const srcLines = fs.readFileSync(path.join(ROOT, "public/lib/visual/gl-line-renderer.js"), "utf8");
const srcGl = fs.readFileSync(path.join(ROOT, "public/node-graph-gl-graph.js"), "utf8");

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

check(srcLines.includes("nodeGraphGlLinesTextAtlasGen"), "renderer exposes the glyph atlas generation");
check(!/glyphBakePx\s*=\s*bakePx/.test(srcLines), "bakeAtlas does not rewrite the shared bake size");
check(srcGl.includes("nodeGraphGlGraphPresentOnce"), "Present re-records when an atlas is retired mid-present");
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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_text_survives_settle" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    await new Promise((r) => setTimeout(r, 2000));
    window.__textStats = () => {
      let runs = 0; let dead = 0; let glyphs = 0; let deadGlyphs = 0;
      const walk = (b) => {
        if (!b) return;
        for (const t of b.texts || []) {
          if (t.color) continue;
          const q = (t.end - t.start) / 48;
          runs += 1; glyphs += q;
          if (t.texture?.__glDeleted) { dead += 1; deadGlyphs += q; }
        }
        for (const l of b.layers || []) walk(l);
      };
      for (const b of nodeGraphGlGraphState.mesh?.batches || []) walk(b);
      const atlas = nodeGraphGlLinesTextAtlas(undefined, 600, "");
      return {
        runs, dead, glyphs, deadGlyphs,
        live: glyphs - deadGlyphs,
        bake: nodeGraphGlGraphState.lastTextBake?.px || 0,
        atlasBake: atlas?.bakePx || 0,
        sleepers: document.querySelectorAll(".dsp-node.viewport-asleep").length,
      };
    };
  }, patch);

  const start = await page.evaluate(() => window.__textStats());
  check(start.live > 0 && start.dead === 0, `zoom 1: text in the mesh (${start.live} glyphs, ${start.dead} dead runs)`);
  const liveAt = new Map();
  for (const z of [1.25, 1.5, 2, 3, 1.5, 2, 0.8, 2.5, 2]) {
    const r = await page.evaluate(async (zoom) => {
      setNodeGraphZoom(zoom);
      const out = [];
      // Three settle cycles: the quality pass runs once (view-8-lazy: the
      // sharpen job then re-records module groups over a few frames; wait
      // until it is done), then camera replays must keep the same glyphs
      // (no wake/sleep in between). Test-side wait; the app does not poll.
      for (let i = 0; i < 3; i += 1) {
        await new Promise((res) => setTimeout(res, 350));
        if (i === 0) {
          for (let k = 0; k < 60 && (nodeGraphGlGraphState.sharpen?.want || (typeof nodeGraphViewSettleRaf !== "undefined" && nodeGraphViewSettleRaf)); k += 1) {
            await new Promise((res) => setTimeout(res, 50));
          }
        }
        out.push(window.__textStats());
      }
      return out;
    }, z);
    const [a, b, c] = r;
    check(a.dead === 0 && b.dead === 0 && c.dead === 0, `zoom ${z}: no text run points at a deleted atlas (dead ${a.dead}/${b.dead}/${c.dead}, ${a.deadGlyphs} glyphs)`);
    check(a.live > 0 && a.live === b.live && b.live === c.live, `zoom ${z}: glyphs nonzero and stable across settles (${a.live}/${b.live}/${c.live})`);
    check(a.atlasBake > 0 && (z <= 1 || a.atlasBake >= Math.round(64 * z) - 1), `zoom ${z}: atlas baked at ${a.atlasBake}px (target ${a.bake})`);
    check(a.sleepers === c.sleepers, `zoom ${z}: no cull cycling during the check (${a.sleepers} -> ${c.sleepers} asleep)`);
    if (liveAt.has(z)) check(liveAt.get(z) === a.live, `zoom ${z}: same glyph count on the second visit (${liveAt.get(z)} vs ${a.live})`);
    liveAt.set(z, a.live);
  }
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

if (bad) {
  console.error(`${bad} check(s) failed`);
  process.exit(1);
}
console.log("test_text_survives_settle passed");