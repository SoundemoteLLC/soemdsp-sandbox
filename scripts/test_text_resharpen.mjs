// Stage 6 / view-8-lazy: event-driven GL text resharpen after zoom stops.
// Mid-zoom must not rebake. Once the camera has been idle ~150 ms (a rAF
// settle loop that runs only while work is pending, no setTimeout), the
// lazy sharpen job bakes the on-screen atlas sizes a few glyphs per frame and
// re-records module groups nearest the centre first; the old atlases keep
// drawing until each group swaps. Starts its own server.py on a free port;
// never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-guitar-pluck.json");
const srcPerf = fs.readFileSync(path.join(ROOT, "public/node-graph-viewport-perf.js"), "utf8");
const srcGl = fs.readFileSync(path.join(ROOT, "public/node-graph-gl-graph.js"), "utf8");

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

check(srcPerf.includes("scheduleNodeGraphViewTextQuality"), "viewport-perf schedules the text-quality settle");
check(!/nodeGraphViewTextQualityTimer\s*=\s*(window\.)?setTimeout/.test(srcPerf), "text-quality settle is not a setTimeout (rAF while pending)");
check(srcGl.includes("function nodeGraphGlGraphSharpenTick"), "lazy incremental sharpen job exists");
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
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => document.body.classList.contains("node-boot-ready")
    && typeof createNodeSliderReadout === "function" && typeof nodeGraphScopeWindowSettings !== "undefined", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".node-boot-loading-screen");
    return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});

  await page.evaluate(async (p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_text_resharpen" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    await new Promise((r) => setTimeout(r, 1500));
  }, patch);

  const before = await page.evaluate(() => ({
    zoom: typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1,
    bake: nodeGraphGlGraphState?.lastTextBake || null,
    emojiPx: nodeGraphGlGraphState?.emojiPx || 0,
    bakePx: nodeGraphGlGraphState?.chrome?.bakePx || 0,
    full: nodeGraphGlGraphState?.presentCounts?.full || 0,
    replay: nodeGraphGlGraphState?.presentCounts?.replay || 0,
  }));

  const mid = await page.evaluate(async () => {
    const startFull = nodeGraphGlGraphState?.presentCounts?.full || 0;
    const startBake = nodeGraphGlGraphState?.emojiPx || 0;
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(2);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      zoom: typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 0,
      emojiPx: nodeGraphGlGraphState?.emojiPx || 0,
      last: nodeGraphGlGraphState?.lastTextBake || null,
      fullDelta: (nodeGraphGlGraphState?.presentCounts?.full || 0) - startFull,
      startBake,
    };
  });

  check(Math.abs(mid.zoom - 2) < 0.05, `zoom is 2 during the gesture (got ${mid.zoom})`);
  check(mid.emojiPx === mid.startBake, `mid-zoom does not rebake (emojiPx ${mid.emojiPx} stayed ${mid.startBake})`);

  const after = await page.evaluate(async () => {
    const startFull = nodeGraphGlGraphState?.presentCounts?.full || 0;
    const startReplay = nodeGraphGlGraphState?.presentCounts?.replay || 0;
    // Test-side wait (the app itself does not poll): until the sharpen job finishes.
    const dev = window.devicePixelRatio || 1;
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      const rs = nodeGraphGlGraphState?.textRecordScale || 0;
      if (Math.abs(rs - nodeGraphZoom() * dev) < 1e-3) break;
    }
    return {
      recordScale: nodeGraphGlGraphState?.textRecordScale || 0,
      sharpenDone: nodeGraphGlGraphState?.sharpen?.done || 0,
      repaints: nodeGraphGlGraphState?.sharpen?.repaints || 0,
      zoom: typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 0,
      emojiPx: nodeGraphGlGraphState?.emojiPx || 0,
      last: nodeGraphGlGraphState?.lastTextBake || null,
      fullDelta: (nodeGraphGlGraphState?.presentCounts?.full || 0) - startFull,
      replayDelta: (nodeGraphGlGraphState?.presentCounts?.replay || 0) - startReplay,
      lastPresent: nodeGraphGlGraphState?.lastPresent?.path || "",
      settled: typeof nodeGraphViewTextQualitySettled === "function" ? nodeGraphViewTextQualitySettled() : null,
    };
  });

  const wantPx = Math.max(16, Math.min(384, Math.round((before.bakePx || before.emojiPx || 64) * 2)));
  check(after.settled === true, `text quality is settled (got ${after.settled})`);
  check(Boolean(after.last?.changed), `settle bake changed the atlas (last=${JSON.stringify(after.last)})`);
  check(after.emojiPx >= wantPx - 1, `settled bake px ${after.emojiPx} >= ~${wantPx} (zoom 2)`);
  check(Math.abs(after.recordScale - after.zoom) < 1e-3 && (after.fullDelta >= 1 || after.sharpenDone >= 1), `text remeshed at the settled scale (recordScale ${after.recordScale}, sharpen done ${after.sharpenDone}, group repaints ${after.repaints}, fullDelta ${after.fullDelta})`);
  // Idle afterwards: the sharpen job and the settle rAF loop stop (no frame loop while nothing is queued).
  const idle = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 800));
    const a = { steps: nodeGraphGlGraphState?.sharpen?.steps || 0, done: nodeGraphGlGraphState?.sharpen?.done || 0 };
    await new Promise((r) => setTimeout(r, 1000));
    return {
      stepsDelta: (nodeGraphGlGraphState?.sharpen?.steps || 0) - a.steps,
      doneDelta: (nodeGraphGlGraphState?.sharpen?.done || 0) - a.done,
      sharpenRaf: nodeGraphGlGraphState?.sharpen?.raf || 0,
      want: Boolean(nodeGraphGlGraphState?.sharpen?.want),
      settleRaf: typeof nodeGraphViewSettleRaf !== "undefined" ? nodeGraphViewSettleRaf : -1,
    };
  });
  check(idle.stepsDelta === 0 && idle.doneDelta === 0 && !idle.sharpenRaf && !idle.want && !idle.settleRaf, `sharpen job and settle loop are stopped once idle (${JSON.stringify(idle)})`);
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
  console.log(JSON.stringify({ before, mid, after }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

if (bad) {
  console.error(`${bad} check(s) failed`);
  process.exit(1);
}
console.log("test_text_resharpen passed");
