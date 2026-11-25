// Real-patch view test (Stage 0 of docs/MODULE_DISPLAY_REWRITE_PLAN.md).
// Loads a captured patch (tests/fixtures), zooms in so most modules are off
// screen, then drives REAL input events: middle-mouse drag, mouse wheel
// (continuous and slow single ticks), Q / E held, and D held (WASD control).
// The in-page probe (public/node-graph-view-probe.js, __viewDump) records
// every frame: frame time, and for each module that enters the view whether
// it shows (awake + GL plate + its chrome) DURING the gesture or only after
// release / settle. Never touches 8765 / 8766 / 8080: it starts its own
// server.py on a free port.
//   node scripts/perf_view_real.mjs                 (checks + numbers)
//   node scripts/perf_view_real.mjs --report        (numbers only, never fails)
// Env:
//   VIEW_PATCH=path        patch JSON (default tests/fixtures/view-real-guitar-pluck.json;
//                          Argi's working circuit is tests/fixtures/view-real-acoustic-bass.json,
//                          a copy of patches/acoustic/bass.json)
//   VIEW_TILE=n            add n copies of the patch's ordinary modules to the right (bigger patch)
//   VIEW_CPU=n             CDP CPU throttle (default 1; 4 approximates a busy machine)
//   VIEW_ZOOM=z            zoom for the start view (default 2)
//   VIEW_W / VIEW_H        window size (default 1600 x 1000)
//   VIEW_HEADED=1          headed Chrome
//   SANDBOX_URL=url        use an already running server instead (never 8766 with a test patch)
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-guitar-pluck.json");
const tile = Math.max(0, Number(process.env.VIEW_TILE || 0) | 0);
const cpu = Math.max(1, Number(process.env.VIEW_CPU || 1));
const startZoom = Number(process.env.VIEW_ZOOM || 2);
const W = Number(process.env.VIEW_W || 1600);
const H = Number(process.env.VIEW_H || 1000);
// A module that enters the view mid-gesture must show within this long
// (Argi: pop-in is fine, "never popping in until I stop moving" is not).
const MAX_WAIT_MS = Number(process.env.VIEW_MAX_WAIT_MS || 40);
const MAX_P95_MS = Number(process.env.VIEW_MAX_P95_MS || 20);

let bad = 0;
const check = (ok, msg) => { if (!ok && !reportOnly) bad += 1; console.log(`${ok ? "ok  " : (reportOnly ? "note" : "FAIL")} ${msg}`); };

// Copies of the ordinary modules (not the one-per-patch ones), shifted right.
function tiled(patch, n) {
  if (!n) return patch;
  const single = new Set(["output", "input", "viewOut", "viewIn", "screenOut", "screenBend", "audioPlayer"]);
  const nodes = patch.nodes || [];
  const xs = nodes.map((node) => Number(node.gx) || 0);
  const span = Math.max(...xs) - Math.min(...xs) + 40;
  const out = { ...patch, nodes: [...nodes], connections: [...(patch.connections || [])], modulations: [...(patch.modulations || [])] };
  for (let k = 1; k <= n; k += 1) {
    const ids = new Map();
    for (const node of nodes) {
      if (single.has(String(node.type))) continue;
      const id = `${node.id}~t${k}`;
      ids.set(node.id, id);
      out.nodes.push({ ...JSON.parse(JSON.stringify(node)), id, gx: (Number(node.gx) || 0) + span * k });
    }
    for (const c of patch.connections || []) {
      if (ids.has(c.sourceNode) && ids.has(c.destinationNode)) out.connections.push({ ...c, sourceNode: ids.get(c.sourceNode), destinationNode: ids.get(c.destinationNode) });
    }
    for (const m of patch.modulations || []) {
      if (ids.has(m.sourceNode) && ids.has(m.destinationNode)) out.modulations.push({ ...m, sourceNode: ids.get(m.sourceNode), destinationNode: ids.get(m.destinationNode) });
    }
  }
  return out;
}

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const { chromium } = await import("playwright");
let server = null;
let browser = null;
let baseUrl = process.env.SANDBOX_URL || "";
if (/:(8765|8766|8080)\b/.test(baseUrl)) {
  console.log("refusing to load a test patch onto 8765 / 8766 / 8080");
  process.exit(2);
}
const results = {};
try {
  const patch = tiled(JSON.parse(fs.readFileSync(patchPath, "utf8")), tile);
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
  }
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: process.env.VIEW_HEADED !== "1", channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function" && typeof flushNodeGraphViewportImmediate === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  const probeOk = await page.waitForFunction(() => typeof window.__viewDump === "function", null, { timeout: 30000 }).then(() => true).catch(() => false);
  check(probeOk, "view probe loaded (__viewDump)");
  if (!probeOk) throw new Error("no __viewDump: is public/node-graph-view-probe.js in index.html?");
  const cdp = await context.newCDPSession(page);
  const loaded = await page.evaluate(async (p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "perf_view_real" });
    await new Promise((r) => setTimeout(r, 2500));
    return document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)").length;
  }, patch);
  console.log(`patch: ${path.relative(ROOT, patchPath)}${tile ? ` x${tile + 1} tiles` : ""}, ${patch.nodes.length} modules (${loaded} in the DOM), cpu throttle ${cpu}x, window ${W}x${H}, start zoom ${startZoom}`);
  // Jack census used to FAIL when zoomed out: it required getBoundingClientRect
  // (CSS-zoomed screen px) >= 2, so a 7.25x14.5 layout jack at 0.25x measured
  // 1.8x3.6 and looked "unpainted". Layout size (offsetWidth) is the real check.
  const jackAtZoomOut = await page.evaluate(async () => {
    const prev = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(0.25);
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    await new Promise((r) => setTimeout(r, 400));
    const report = typeof nodeGraphJackVisibilityCensus === "function" ? nodeGraphJackVisibilityCensus() : null;
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(prev);
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    const sample = report?.hidden?.[0] || report?.sample?.[0] || null;
    return report ? {
      ok: report.ok,
      painted: report.paintedCount,
      considered: report.consideredCount,
      sample: sample && { node: sample.node, layout: `${sample.layoutW || 0}x${sample.layoutH || 0}`, screen: `${sample.screenW || 0}x${sample.screenH || 0}`, reasons: sample.reasons },
    } : { ok: false, missing: true };
  });
  console.log(`jack census at 0.25x: ok=${jackAtZoomOut.ok} painted=${jackAtZoomOut.painted}/${jackAtZoomOut.considered} sample=${JSON.stringify(jackAtZoomOut.sample || null)}`);
  // HTML jack census is informational; Stage 3 judges GL mesh chrome.
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });

  // Start view: zoom in, put the patch's left edge near the left of the screen
  // so moving right / zooming out brings new modules in.
  const home = (zoom) => page.evaluate(async (zoom) => {
    const pinLeft = (zoom) => {
      if (Math.abs((typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1) - zoom) > 0.001) {
        setNodeGraphZoom(zoom);
      }
      let best = null;
      for (const el of document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)")) {
        const x = Number.parseFloat(el.style.getPropertyValue("--node-x"));
        const y = Number.parseFloat(el.style.getPropertyValue("--node-y"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const geo = typeof nodeGraphModuleGeometryGet === "function" ? nodeGraphModuleGeometryGet(el.dataset.node) : null;
        const h = Number(geo?.box?.h) || Number(el._viewportCullH) || el.offsetHeight || 140;
        const w = Number(geo?.box?.w) || Number(el._viewportCullW) || 220;
        if (!best || x < best.x || (x === best.x && y < best.y)) best = { x, y, w, h };
      }
      if (!best) return;
      const z = nodeGraphZoom();
      const o = nodeGraphRenderedOriginOffset();
      // Top-left of the leftmost module at 80,80 in the workspace.
      const wantX = 80 - best.x * z;
      const wantY = 80 - best.y * z;
      nodeGraphMvp.pan = {
        x: nodeGraphMvp.pan.x + (wantX - o.x),
        y: nodeGraphMvp.pan.y + (wantY - o.y),
      };
      if (typeof viewCameraSet === "function") {
        viewCameraSet({ immediate: true, persist: false });
      } else if (typeof applyNodeGraphViewportCssLight === "function") {
        applyNodeGraphViewportCssLight({ zoom: true, pan: true, readouts: false });
      }
    };
    setNodeGraphZoom(zoom);
    pinLeft(zoom);
    if (typeof flushNodeGraphViewportImmediate === "function") {
      flushNodeGraphViewportImmediate({ persist: false });
    }
    pinLeft(zoom);
    await new Promise((r) => setTimeout(r, 1200));
    pinLeft(zoom);
    window.__viewDump({ reset: true });
    return { zoom: nodeGraphZoom(), dump: window.__viewDump().modules };
  }, zoom);
  const afterCullInvalidate = () => page.evaluate(() => {
    if (typeof nodeGraphModuleGeometryInvalidateAll === "function") nodeGraphModuleGeometryInvalidateAll();
    if (typeof drawNodeGraphWires === "function") drawNodeGraphWires();
    else if (typeof nodeGraphGlGraphPaint === "function") nodeGraphGlGraphPaint();
    const st = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState : null;
    let mesh = 0;
    for (const g of (st?.mesh?.plateGroupLayers || [])) mesh += (g.ids || []).length;
    const asleep = document.querySelectorAll("#nodeGraphWorkspace .dsp-node.viewport-asleep:not(.removed)").length;
    return { plates: st?.plates?.length || 0, mesh, geo: typeof nodeGraphModuleGeometryById !== "undefined" ? nodeGraphModuleGeometryById.size : 0, chrome: typeof nodeGraphGlGraphChromeCache !== "undefined" ? nodeGraphGlGraphChromeCache.size : 0, asleep, patch: nodeGraphMvp?.patch?.nodes?.length || 0 };
  });
  const dump = () => page.evaluate(() => window.__viewDump({ frames: 0 }));
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
  const summarize = (name, mid, after) => {
    results[name] = {
      movingFrames: mid.movingFrames,
      frames: mid.frames,
      midBlank: mid.modules ? { inView: mid.modules.inView, blank: mid.modules.blank, ids: mid.modules.blankIds, chromeGaps: mid.modules.chromeGaps || [] } : null,
      midPresent: mid.present || mid.modules?.lastPresent || null,
      midFrozen: Boolean(mid.gesture?.frozen),
      gestureAtMid: mid.gesture?.active || mid.gesture?.panning || false,
      entered: after.entered,
      popIns: { n: after.popIns.n, whileMoving: after.popIns.shownWhileMoving, onlyAfterStop: after.popIns.shownOnlyAfterStop, waitP50: after.popIns.waitP50, waitMax: after.popIns.waitMax, stillBlank: after.popIns.stillBlank.length },
      blankFramesWhileMoving: after.blankFrames.whileMoving,
      longTasks: after.longTasks.n,
      longestTask: after.longTasks.longest,
      afterBlank: after.modules ? after.modules.blank : null,
    };
  };

  // ---- middle-mouse drag: content moves left, modules enter from the right ----
  let h = await home(startZoom);
  console.log(`start view: ${h.dump?.inView} of ${h.dump?.total} modules in view at zoom ${h.zoom.toFixed(2)}`);
  let invalidated = await afterCullInvalidate();
  console.log(`after cull-invalidate: plates ${invalidated.plates}, mesh ${invalidated.mesh}, geo ${invalidated.geo}, chrome ${invalidated.chrome}, asleep ${invalidated.asleep}, patch ${invalidated.patch}`);
  let p = await emptyPoint({ x: W - 80, y: H / 2 });
  await page.mouse.move(p.x, p.y);
  // Real held middle-button gesture via CDP (not a synthetic gesture flag).
  const steps = 90;
  const dragDx = -(W * 0.85) / steps;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "middle", buttons: 4, clickCount: 1 });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: p.x + dragDx * i,
      y: p.y,
      button: "middle",
      buttons: 4,
    });
  }
  let mid = await dump(); // still held
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: p.x + dragDx * steps,
    y: p.y,
    button: "middle",
    buttons: 0,
    clickCount: 1,
  });
  await page.waitForTimeout(200);
  summarize("middleDrag", mid, await dump());

  // ---- wheel, continuous zoom out (ticks 40 ms apart: one gesture) ----
  h = await home(startZoom);
  await afterCullInvalidate();
  p = await emptyPoint({ x: W / 2, y: H / 2 });
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 24; i += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: p.x,
      y: p.y,
      deltaX: 0,
      deltaY: 60,
    });
    await page.waitForTimeout(40);
  }
  mid = await dump(); // during the continuous wheel gesture, no settle wait
  await page.waitForTimeout(200);
  summarize("wheelContinuous", mid, await dump());

  // ---- wheel, slow single ticks (each tick its own gesture + settle) ----
  h = await home(startZoom);
  await afterCullInvalidate();
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 8; i += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: p.x,
      y: p.y,
      deltaX: 0,
      deltaY: 60,
    });
    await page.waitForTimeout(80);
  }
  mid = await dump();
  await page.waitForTimeout(200);
  summarize("wheelSlowTicks", mid, await dump());

  // ---- Q held (zoom out toward the mouse) ----
  h = await home(startZoom);
  await afterCullInvalidate();
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down("q");
  await page.waitForTimeout(1600);
  mid = await dump(); // Q is still held
  await page.keyboard.up("q");
  await page.waitForTimeout(200);
  summarize("qHold", mid, await dump());

  // ---- E held (zoom in; frame times only: nothing new enters) ----
  h = await home(startZoom / 2);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down("e");
  await page.waitForTimeout(1200);
  mid = await dump(); // E is still held
  await page.keyboard.up("e");
  await page.waitForTimeout(200);
  summarize("eHold", mid, await dump());

  // ---- D held (WASD control: the path that already works) ----
  h = await home(startZoom);
  await afterCullInvalidate();
  await page.mouse.move(p.x, p.y);
  await page.keyboard.down("d");
  await page.waitForTimeout(1600);
  mid = await dump(); // D is still held
  await page.keyboard.up("d");
  await page.waitForTimeout(200);
  summarize("dHold", mid, await dump());

  console.log(JSON.stringify(results, null, 1));
  for (const [name, r] of Object.entries(results)) {
    const g = r.movingFrames;
    console.log(`  ${name}: moving frames n ${g.n || 0}, mean ${g.mean}, p50 ${g.p50}, p95 ${g.p95}, max ${g.max}, >33ms ${g.over33}, >50ms ${g.over50}; long tasks ${r.longTasks} (longest ${r.longestTask} ms)`);
    console.log(`  ${name}: pop-ins ${r.popIns.n} (while moving ${r.popIns.whileMoving}, only after stop/release ${r.popIns.onlyAfterStop}), wait p50 ${r.popIns.waitP50} ms, max ${r.popIns.waitMax} ms; blank frames while moving ${r.blankFramesWhileMoving}; blank at mid sample ${r.midBlank?.blank}/${r.midBlank?.inView}`);
    if (name === "eHold") {
      check(!(g.p95 > MAX_P95_MS), `${name}: moving frame p95 ${g.p95} ms <= ${MAX_P95_MS} ms`);
      continue;
    }
    check(r.entered.whileMoving > 0, `${name}: the gesture brought modules into view (${r.entered.whileMoving}; ${r.popIns.n} of them blank at first)`);
    check(r.popIns.onlyAfterStop === 0, `${name}: no module waited for stop/release/settle to appear (${r.popIns.onlyAfterStop})`);
    check(!(r.popIns.waitMax > MAX_WAIT_MS), `${name}: slowest pop-in ${r.popIns.waitMax} ms <= ${MAX_WAIT_MS} ms (1-2 frames)`);
    check((r.midBlank?.blank || 0) === 0, `${name}: nothing blank while still held (${r.midBlank?.blank}/${r.midBlank?.inView})`);
    check(r.midPresent?.ok !== false, `${name}: present ok while held (path=${r.midPresent?.path || "none"})`);
    if ((r.midBlank?.blank || 0) > 0 && r.midBlank?.chromeGaps) {
      console.log(`  ${name} chrome gaps: ${JSON.stringify(r.midBlank.chromeGaps)}`);
    }
    check(!r.midFrozen, `${name}: HTML was not frozen while held`);
    check(r.afterBlank === 0, `${name}: nothing blank after the gesture (${r.afterBlank})`);
    check(!(g.p95 > MAX_P95_MS), `${name}: moving frame p95 ${g.p95} ms <= ${MAX_P95_MS} ms`);
  }
  const camCounts = await page.evaluate(() => (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState.presentCounts) || {});
  console.log("presentCounts", JSON.stringify(camCounts));
  check(!(camCounts.replayFailDuringCamera > 0), `no replayFail during camera moves (replayFailDuringCamera=${camCounts.replayFailDuringCamera || 0}, fails=${JSON.stringify(camCounts.fails || {})})`);
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
