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
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-guitar-pluck.json");
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
    await new Promise((r) => setTimeout(r, 250));
    return {
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
  check(after.settled === true, `text quality is settled after 250 ms (got ${after.settled})`);
  check(Boolean(after.last?.changed), `settle bake changed the atlas (last=${JSON.stringify(after.last)})`);
  check(after.emojiPx >= wantPx - 1, `settled bake px ${after.emojiPx} >= ~${wantPx} (zoom 2)`);
  check(after.fullDelta >= 1, `quality pass remeshed text (fullDelta=${after.fullDelta}, path=${after.lastPresent})`);
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
