// Modules that scroll into view DURING a pan / touch pan / wheel zoom must
// appear while the gesture is still held (pan-popin-1), and the gesture must
// keep its frame rate. Scripted gestures across a large patch; reports frame
// times and how many on-screen modules are still blank mid-gesture.
//   node scripts/perf_pan_popin.mjs            (checks + numbers)
//   node scripts/perf_pan_popin.mjs --report   (numbers only, never fails)
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");
const shotDir = process.env.PAN_POPIN_SHOTS || "";
let bad = 0;
const check = (ok, msg) => { if (!ok && !reportOnly) bad += 1; console.log(`${ok ? "ok  " : (reportOnly ? "note" : "FAIL")} ${msg}`); };

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const { chromium } = await import("playwright");
let server = null;
let browser = null;
let baseUrl = process.env.SANDBOX_URL || "";
const W = 1600;
const H = 1000;
try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
  }
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: Number(process.env.DPR || 1) });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(500);

  // 10 x 6 grid of mixed modules (displays, graph faces, hand-written faces).
  const count = await page.evaluate(async () => {
    const types = ["polyBlep", "stepGraph", "smoothGraph", "blit"].filter((t) => nodeGraphModuleDefinitions?.[t]);
    const nodes = [];
    for (let r = 0; r < 6; r += 1) {
      for (let c = 0; c < 10; c += 1) {
        nodes.push(createNodeGraphPatchNode(types[(r * 10 + c) % types.length], { id: `p${r}_${c}`, gx: 4 + c * 26, gy: 4 + r * 34 }));
      }
    }
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    commitNodeGraphPatch({ ...base, nodes, cables: [] }, { status: "pan pop-in perf" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    await new Promise((r) => setTimeout(r, 1500));
    return nodes.length;
  });
  console.log(`patch: ${count} modules`);

  const home = (zoom = 1) => page.evaluate(async (zoom) => {
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(zoom);
    nodeGraphMvp.pan = { x: 0, y: 0 };
    flushNodeGraphViewportImmediate();
    await new Promise((r) => setTimeout(r, 900));
  }, zoom);

  // On-screen modules (inside the workspace by 24px) and how many are blank:
  // still culled (viewport-asleep) or missing from the GL plates / face mesh.
  const sample = () => page.evaluate(() => {
    const ws = document.getElementById("nodeGraphWorkspace");
    const box = ws.getBoundingClientRect();
    const zoom = nodeGraphZoom();
    const o = nodeGraphRenderedOriginOffset();
    const inset = 24;
    const L = (inset - o.x) / zoom; const T = (inset - o.y) / zoom;
    const R = (box.width - inset - o.x) / zoom; const B = (box.height - inset - o.y) / zoom;
    const plates = new Set((nodeGraphGlGraphState.plates || []).map((p) => p.id));
    const meshFresh = Boolean(nodeGraphGlGraphState.mesh && nodeGraphGlGraphState.mesh.gen === nodeGraphGlGraphState.gen);
    const out = { onScreen: 0, asleep: 0, unplated: 0, ids: [], partial: typeof nodeGraphViewportPopIn !== "undefined" ? Boolean(nodeGraphViewportPopIn.partial) : null, lastPresent: (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState.lastPresent) || null, presentCounts: (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState.presentCounts) || null };
    for (const el of document.querySelectorAll(".dsp-node[data-node^='p']")) {
      const x = Number.parseFloat(el.style.getPropertyValue("--node-x")) || 0;
      const y = Number.parseFloat(el.style.getPropertyValue("--node-y")) || 0;
      const w = el._viewportCullW || el.offsetWidth || 0;
      const h = el._viewportCullH || el.offsetHeight || 0;
      if (!(w > 1 && h > 1)) continue;
      if (!(x < R && x + w > L && y < B && y + h > T)) continue;
      out.onScreen += 1;
      const asleep = el.classList.contains("viewport-asleep");
      const plated = plates.has(el.dataset.node);
      if (asleep) out.asleep += 1;
      if (!plated) out.unplated += 1;
      // HTML may stay asleep mid-zoom; the module shows if its GL plate is
      // in the mesh (chrome cache). Only unplated modules are blank.
      if (!plated) out.ids.push(el.dataset.node);
    }
    out.meshFresh = meshFresh;
    const cam = typeof nodeGraphViewCamera === "object" ? nodeGraphViewCamera : null;
    const zooming = Boolean(cam && cam.lastZoomChangeT && ((performance.now() - cam.lastZoomChangeT) < 250));
    out.gesture = Boolean(nodeGraphMvp?.workspacePanning || nodeGraphMvp?.smoothZoomDragging || nodeGraphMvp?.workspacePinchZooming || cam?.dirty || zooming);
    return out;
  });
  const frames = {
    start: () => page.evaluate(() => {
      window.__panFrames = [];
      window.__panLong = [];
      window.__panPopMax = 0;
      window.__panPopWoke = 0;
      window.__panPopModes = {};
      try {
        window.__panLongObs?.disconnect();
        window.__panLongObs = new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__panLong.push(e.duration); });
        window.__panLongObs.observe({ type: "longtask", buffered: false });
      } catch { /* no longtask API */ }
      let last = performance.now();
      let seen = -1;
      const tick = (t) => {
        window.__panFrames.push(t - last); last = t;
        if (typeof nodeGraphViewportPopIn !== "undefined" && nodeGraphViewportPopIn.lastMs !== seen) {
          seen = nodeGraphViewportPopIn.lastMs;
          if (nodeGraphViewportPopIn.lastWoke > 0) { window.__panPopMax = Math.max(window.__panPopMax, seen); window.__panPopWoke += nodeGraphViewportPopIn.lastWoke; const m = nodeGraphViewportPopIn.lastMode || "full"; window.__panPopModes[m] = (window.__panPopModes[m] || 0) + 1; }
        }
        if (window.__panFramesOn) requestAnimationFrame(tick);
      };
      window.__panFramesOn = true;
      requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
    }),
    stop: () => page.evaluate(() => {
      window.__panFramesOn = false;
      const d = window.__panFrames.slice(1).sort((a, b) => a - b);
      const n = d.length;
      const mean = d.reduce((s, v) => s + v, 0) / Math.max(1, n);
      window.__panLongObs?.disconnect();
      const longs = window.__panLong;
      return { longTasks: longs.length, longestTask: +(Math.max(0, ...longs)).toFixed(1), popInWoke: window.__panPopWoke, popInModes: Object.entries(window.__panPopModes).map(([k, v]) => `${k} ${v}`).join(", ") || "none", popInPassMaxMs: +window.__panPopMax.toFixed(2), n, mean: +mean.toFixed(2), p50: +(d[Math.floor(n * 0.5)] || 0).toFixed(2), p95: +(d[Math.floor(n * 0.95)] || 0).toFixed(2), max: +(d[n - 1] || 0).toFixed(2), over33: d.filter((v) => v > 33.4).length, over50: d.filter((v) => v > 50).length };
    }),
  };
  const emptyPoint = (prefer) => page.evaluate(({ px, py }) => {
    const ws = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
    let best = null;
    for (let y = ws.top + 20; y < ws.bottom - 20; y += 10) {
      for (let x = ws.left + 20; x < ws.right - 20; x += 10) {
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest("#nodeGraphWorkspace") || el.closest(".dsp-node, .node-port, button, input")) continue;
        const d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best;
  }, { px: prefer.x, py: prefer.y });
  const shot = async (name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) }); };

  const results = {};
  // PAN_POPIN_PROFILE=1: time the pop-in pass parts (wrappers, no source edits).
  const profile = process.env.PAN_POPIN_PROFILE === "1";
  if (profile) {
    await page.evaluate(() => {
      window.__prof = {};
      for (const name of ["nodeGraphViewportGesturePopIn", "nodeGraphViewportCullApply", "nodeGraphViewportCullWakePainters", "nodeGraphModuleGeometryPublishFromDom", "nodeGraphGlGraphRebuildPlates", "nodeGraphGlGraphPresent", "nodeGraphViewportPopInCandidates"]) {
        const fn = window[name];
        if (typeof fn !== "function") continue;
        window[name] = function wrapped(...args) {
          const t = performance.now();
          try { return fn.apply(this, args); } finally {
            const d = performance.now() - t;
            const s = window.__prof[name] || (window.__prof[name] = { n: 0, total: 0, max: 0 });
            s.n += 1; s.total += d; s.max = Math.max(s.max, d);
          }
        };
      }
    });
  }
  const dumpProfile = async (label) => {
    if (!profile) return;
    const prof = await page.evaluate(() => { const p = window.__prof; window.__prof = {}; return p; });
    console.log(`profile ${label}: ${Object.entries(prof).map(([k, v]) => `${k.replace(/^nodeGraph/, "")} n${v.n} total ${v.total.toFixed(1)} max ${v.max.toFixed(1)}`).join(" | ")}`);
  };

  // ---- middle-mouse pan ----
  await home(1);
  let p = await emptyPoint({ x: W - 60, y: H - 60 });
  const steps = 75;
  const dx = -(p.x - 60) / steps;
  const dy = -(p.y - 60) / steps;
  await frames.start();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button: "middle" });
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(p.x + dx * i, p.y + dy * i);
    await page.waitForTimeout(16);
  }
  const panFrames = await frames.stop();
  const panNow = await sample();
  await page.waitForTimeout(350);
  const panHeld = await sample();
  await shot("pan-held");
  await dumpProfile("pan held");
  await frames.start();
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(600);
  const panRelease = await frames.stop();
  const panAfter = await sample();
  await dumpProfile("pan release");
  results.pan = { frames: panFrames, release: panRelease, endOfMove: panNow, held350ms: panHeld, afterRelease: panAfter };

  // ---- touch pan ----
  await home(1);
  p = await emptyPoint({ x: W - 60, y: H - 60 });
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await frames.start();
  await touch("touchStart", p.x, p.y);
  for (let i = 1; i <= steps; i += 1) {
    await touch("touchMove", p.x + dx * i, p.y + dy * i);
    await page.waitForTimeout(16);
  }
  const touchFrames = await frames.stop();
  const touchNow = await sample();
  await page.waitForTimeout(350);
  const touchHeld = await sample();
  await shot("touch-held");
  await dumpProfile("touch held");
  await frames.start();
  await touch("touchEnd", 0, 0);
  await page.waitForTimeout(600);
  const touchRelease = await frames.stop();
  await dumpProfile("touch release");
  results.touch = { frames: touchFrames, release: touchRelease, endOfMove: touchNow, held350ms: touchHeld, afterRelease: await sample() };

  // ---- wheel zoom out (continuous: the settle never fires mid-run) ----
  await home(1);
  p = await emptyPoint({ x: 200, y: 150 });
  await page.mouse.move(p.x, p.y);
  const cpuProfile = process.env.PAN_POPIN_CPUPROFILE === "1";
  if (cpuProfile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
  await frames.start();
  let wheelMid = null;
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(30);
    if (i === 30) wheelMid = await sample();
  }
  const wheelEnd = await sample();
  await shot("wheel-mid");
  const wheelFrames = await frames.stop();
  if (cpuProfile) {
    const { profile: prof } = await cdp.send("Profiler.stop");
    const self = new Map();
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const dt = prof.timeDeltas || [];
    for (let i = 0; i < prof.samples.length; i += 1) {
      const n = byId.get(prof.samples[i]);
      const f = n.callFrame;
      const key = `${f.functionName || "(anon)"} ${String(f.url).split("/").pop().split("?")[0]}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) || 0) + (dt[i] || 0) / 1000);
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    console.log("cpu self time (wheel held, ms):\n" + top.map(([k, v]) => `  ${v.toFixed(1).padStart(7)}  ${k}`).join("\n"));
  }
  await dumpProfile("wheel held");
  await frames.start();
  await page.waitForTimeout(600);
  const wheelSettle = await frames.stop();
  await dumpProfile("wheel settle");
  results.wheel = { frames: wheelFrames, release: wheelSettle, zoom: await page.evaluate(() => nodeGraphZoom()), mid: wheelMid, endOfWheel: wheelEnd, afterSettle: await sample() };

  console.log(JSON.stringify(results, null, 1));
  for (const [name, r] of Object.entries(results)) {
    const held = r.held350ms || r.mid || r.endOfWheel;
    check(held.gesture, `${name}: gesture still active at the sample`);
    check(held.onScreen > 0 && held.unplated === 0, `${name}: every on-screen module shows mid-gesture (${held.onScreen} on screen, ${held.asleep} html-asleep, ${held.unplated} without a plate${held.ids.length ? `: ${held.ids.slice(0, 6).join(",")}` : ""})`);
    const after = r.afterRelease || r.afterSettle;
    check(after.asleep === 0 && after.unplated === 0, `${name}: all on-screen modules after the gesture ends (${after.onScreen} on screen)`);
    check(after.partial !== true, `${name}: settle did the full plate rebuild after incremental pop-ins`);
    console.log(`  ${name} frames: n ${r.frames.n}, mean ${r.frames.mean} ms, p50 ${r.frames.p50}, p95 ${r.frames.p95}, max ${r.frames.max}, >33ms ${r.frames.over33}, >50ms ${r.frames.over50}; long tasks ${r.frames.longTasks} (longest ${r.frames.longestTask} ms); pop-in woke ${r.frames.popInWoke} (passes: ${r.frames.popInModes}), slowest pass ${r.frames.popInPassMaxMs} ms`);
    console.log(`  ${name} release/settle: max frame ${r.release.max} ms, >33ms ${r.release.over33}, longest task ${r.release.longestTask} ms`);
  }
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
