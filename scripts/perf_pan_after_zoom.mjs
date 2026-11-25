// Pan right after a zoom (MAS-3 lazy resharpen). Real input via CDP: a short
// wheel zoom, then a held middle-button pan that starts before / right after
// the text-quality settle. Frame times come from a rAF recorder that only runs
// while the scenario is measured. After the pan the test also checks that text
// ends up sharp (recorded at zoom x dpr) and that no mesh run points at a
// deleted glyph texture. Starts its own server.py on a free port; never
// touches 8765 / 8766 / 8080.
//   node scripts/perf_pan_after_zoom.mjs            (checks)
//   node scripts/perf_pan_after_zoom.mjs --report   (numbers only)
// Window: zoom end .. last pan move (the pointer-up chrome flush is not panning).
// Env: VIEW_PATCH (default bass2), VIEW_TILE=n, DPR (default 1), PAZ_P95 (17.5), PAZ_MAX (34);
// debug: PAZ_TRACE=1 (timed app calls), PAZ_PROFILE=1 (CPU profile), PAZ_TT=1 (Chrome trace of long tasks).
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-acoustic-bass2.json");
const tile = Math.max(0, Number(process.env.VIEW_TILE || 0) | 0);
const DPR = Number(process.env.DPR || 1);
const W = 1600;
const H = 1000;
const MAX_P95 = Number(process.env.PAZ_P95 || 17.5);
const MAX_FRAME = Number(process.env.PAZ_MAX || 34);
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
const summary = [];
try {
  const patch = tiled(JSON.parse(fs.readFileSync(patchPath, "utf8")), tile);
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.addInitScript(() => {
    window.__paz = { on: false, t: [], long: [] };
    const loop = (ts) => { if (!window.__paz.on) return; window.__paz.t.push(ts); requestAnimationFrame(loop); };
    window.__pazStart = () => { window.__paz.t = []; window.__paz.long = []; if (window.__paz.facePaints) window.__paz.facePaints.length = 0; window.__paz.on = true; requestAnimationFrame(loop); };
    window.__pazMark = (name) => { try { performance.mark("paz:" + name); } catch { /* */ } (window.__paz.marks || (window.__paz.marks = {}))[name] = performance.now(); };
    window.__pazStop = () => { window.__paz.on = false; return window.__paz; };
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (window.__paz.on) window.__paz.long.push({ t: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: false });
    } catch { /* no longtask */ }
  });
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function" && typeof flushNodeGraphViewportImmediate === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.evaluate(async (p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "perf_pan_after_zoom" });
    await new Promise((r) => setTimeout(r, 2500));
  }, patch);
  const cdp = await context.newCDPSession(page);
  console.log(`patch ${path.relative(ROOT, patchPath)}${tile ? ` x${tile + 1}` : ""}: ${patch.nodes.length} modules, DPR ${DPR}`);
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
  const emptyPoint = () => page.evaluate(() => {
    const ws = document.getElementById("nodeGraphWorkspace").getBoundingClientRect();
    let best = null;
    const px = ws.left + ws.width * 0.6; const py = ws.top + ws.height / 2;
    for (let y = ws.top + 20; y < ws.bottom - 20; y += 10) {
      for (let x = ws.left + 20; x < ws.right - 20; x += 10) {
        const el = document.elementFromPoint(x, y);
        if (!el || !el.closest("#nodeGraphWorkspace") || el.closest(".dsp-node, .node-port, button, input")) continue;
        const d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best || { x: px, y: py };
  });
  const stats = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : 0);
    return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1), over33: s.filter((v) => v > 33.4).length };
  };
  const state = () => page.evaluate(() => {
    const st = nodeGraphGlGraphState;
    let stale = 0; let runs = 0; let snapped = 0; let glyphs = 0;
    const cam = st.frameCamera; const cv = st.canvas;
    const scale = cam ? cam.zoom * (cv.width / cv.getBoundingClientRect().width) : 0;
    const walk = (b) => {
      if (!b) return;
      for (const t of b.texts || []) {
        runs += 1;
        if (t.texture && t.texture.__glDeleted) stale += 1;
        if (!t.color) { const n = (t.end - t.start) / 48; glyphs += n; if (t.snapScale > 0 && Math.abs(t.snapScale - scale) < 1e-3 * scale) snapped += n; }
      }
      for (const l of b.layers || []) walk(l);
    };
    for (const b of st.mesh?.batches || []) walk(b);
    return { stale, runs, glyphs, snapped, scale: +scale.toFixed(4), recordScale: st.textRecordScale || 0, zoom: nodeGraphZoom() };
  });

  const scenarios = [
    { name: "pan 60ms after zoom-in", ticks: -60, gap: 60 },
    { name: "pan 160ms after zoom-out", ticks: 60, gap: 160 },
    { name: "pan 60ms after zoom-out", ticks: 60, gap: 60 },
    { name: "pan 160ms after zoom-in", ticks: -60, gap: 160 },
  ];
  // Controller faces (knob / slider / pitch wheel) paint their first picture
  // when a culled module comes into view (canvas 0x0 -> real size); that GL
  // present + raster costs 20-100 ms on its own, with or without any zoom, and
  // was measured at the same size before the lazy resharpen. It is not text
  // work: frames that overlap such a first paint are reported, not failed.
  await page.evaluate(() => {
    window.__paz.facePaints = [];
    for (const name of ["paintNodeGraphKnobFaceLive", "paintNodeGraphSliderFaceLive", "paintNodeGraphPitchModWheelFace"]) {
      const f = window[name]; if (typeof f !== "function") continue;
      window[name] = function (...a) {
        const c = a[0]?.querySelector?.("canvas");
        const first = !c || !(c.width > 0) || !(c.height > 0);
        const t0 = performance.now(); const r = f.apply(this, a); const t1 = performance.now();
        if (first && t1 - t0 > 8) window.__paz.facePaints.push({ t0, t1, id: a[0]?.dataset?.node || "" });
        return r;
      };
    }
  });
  const profile = process.env.PAZ_PROFILE === "1";
  if (process.env.PAZ_TRACE === "1") {
    await page.evaluate(() => {
      window.__pazT = []; const process_env_flush = true;
      const wrap = (name) => {
        const f = window[name]; if (typeof f !== "function") return;
        window[name] = function (...a) {
          const t0 = performance.now(); const r = f.apply(this, a); const d = performance.now() - t0;
          if (d > 8) window.__pazT.push(`@${(t0 - ((window.__paz.marks || {}).zoomEnd || t0)).toFixed(0)} ${name}${a[0] instanceof Element ? "<" + (a[0].dataset?.node || a[0].className) + " " + (a[0].querySelector?.("canvas")?.width || 0) + "x" + (a[0].querySelector?.("canvas")?.height || 0) + ">" : a[0] && typeof a[0] === "object" ? JSON.stringify(a[0]).slice(0, 40) : ""} ${d.toFixed(1)}`);
          if (process_env_flush && (name === "applyNodeGraphViewportCssLight" || name === "scheduleNodeGraphViewportCullRefresh" || name === "nodeGraphGlGraphSettleTextBake")) { const t1 = performance.now(); void document.documentElement.offsetHeight; const l = performance.now() - t1; if (l > 2) window.__pazT.push(`  layout-after-${name} ${l.toFixed(1)}`); }
          return r;
        };
      };
      for (const n of ["scheduleNodeGraphViewportCullRefresh", "nodeGraphGlGraphSettleTextBake", "applyNodeGraphViewportCssLight", "nodeGraphGlGraphPresent", "nodeGraphGlGraphPresentOnce", "nodeGraphGlLinesTextAtlas", "refreshNodeGraphViewportCull", "nodeGraphWriteInheritedZoomVar", "nodeGraphPositionGridHtml", "viewFrame", "syncNodeGraphWireSvgViewBox", "nodeGraphGlGraphSharpenTick", "nodeGraphGlGraphRepaintMeshedPlates", "flushNodeGraphViewportHeavyChrome", "nodeGraphGlLinesTextAtlasBakeNext", "nodeGraphViewSettleTick", "refreshNodeGraphViewportCullNow", "paintNodeGraphKnobFaceLive", "paintNodeGraphSliderFaceLive", "paintNodeGraphPitchModWheelFace"]) wrap(n);
    });
  }
  if (profile) await cdp.send("Profiler.enable");
  for (const sc of scenarios) {
    await home(1.5);
    await page.waitForTimeout(800);
    if (profile) { await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
    const tt = process.env.PAZ_TT === "1";
    const ttEvents = [];
    if (tt) {
      cdp.removeAllListeners("Tracing.dataCollected");
      cdp.on("Tracing.dataCollected", (e) => { for (const v of e.value) ttEvents.push(v); });
      await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "toplevel", "v8", "disabled-by-default-v8.gc", "gpu"] }, transferMode: "ReportEvents" });
    }    const p = await emptyPoint();
    await page.mouse.move(p.x, p.y);
    await page.evaluate(() => window.__pazStart());
    for (let i = 0; i < 6; i += 1) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: 0, deltaY: sc.ticks });
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => window.__pazMark("zoomEnd"));
    await page.waitForTimeout(Math.max(0, sc.gap - 40));
    await page.evaluate(() => window.__pazMark("panStart"));
    const steps = 50; const dx = -(W * 0.5) / steps;
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "middle", buttons: 4, clickCount: 1 });
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x + dx * i, y: p.y + (i % 2), button: "middle", buttons: 4 });
      await page.waitForTimeout(16);
    }
    // Window ends at the last move: the release (pointer-up chrome flush) is not part of "panning".
    await page.waitForTimeout(34);
    await page.evaluate(() => window.__pazMark("panEnd"));
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x + dx * steps, y: p.y, button: "middle", buttons: 0, clickCount: 1 });
    await page.waitForTimeout(250);
    const rec = await page.evaluate(() => window.__pazStop());
    if (tt) {
      const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
      await cdp.send("Tracing.end"); await done;
      const names = new Map(); for (const e of ttEvents) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
      const zm = ttEvents.find((e) => e.name === "paz:zoomEnd"); const pe = ttEvents.find((e) => e.name === "paz:panEnd");
      const main = zm ? `${zm.pid}:${zm.tid}` : null;
      const z0 = zm ? zm.ts : 0;
      const tasks = ttEvents.filter((e) => e.ph === "X" && e.name === "RunTask" && `${e.pid}:${e.tid}` === main && e.dur > 30000 && e.ts + e.dur >= z0 && (!pe || e.ts <= pe.ts));
      for (const t of tasks) {
        const kids = ttEvents.filter((e) => e.ph === "X" && `${e.pid}:${e.tid}` === main && e !== t && e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur && (e.dur || 0) > 2000)
          .map((e) => `${e.name}${e.args?.data?.functionName ? "(" + e.args.data.functionName + ")" : ""}${e.args?.data?.type ? "[" + e.args.data.type + "]" : ""}${e.args?.data?.url ? "<" + String(e.args.data.url).split("/").pop().replace(/\?.*/, "") + ":" + (e.args.data.lineNumber ?? "") + ">" : ""} ${(e.dur / 1000).toFixed(1)}`);
        console.log(`  TT task @${((t.ts - z0) / 1000).toFixed(0)} ${(t.dur / 1000).toFixed(1)}ms: ${kids.join(" | ")}`);
      }
      const other = ttEvents.filter((e) => e.ph === "X" && e.dur > 30000 && e.ts + e.dur >= z0 && (!pe || e.ts <= pe.ts) && `${e.pid}:${e.tid}` !== main && e.name === "RunTask");
      for (const t of other) console.log(`  TT other thread ${names.get(`${t.pid}:${t.tid}`)} @${((t.ts - z0) / 1000).toFixed(0)} ${(t.dur / 1000).toFixed(1)}ms`);
    }    if (profile) {
      const { profile: prof } = await cdp.send("Profiler.stop");
      // Inclusive time per function name (each sample counted once per distinct name on its stack).
      const byId = new Map(prof.nodes.map((n) => [n.id, n]));
      const parent = new Map();
      for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
      const incl = new Map(); const self = new Map();
      const dt = prof.timeDeltas || [];
      prof.samples.forEach((id, i) => {
        const d = (dt[i + 1] ?? dt[i] ?? 0) / 1000;
        const leaf = byId.get(id); const lname = `${leaf.callFrame.functionName || "(anon)"}`;
        self.set(lname, (self.get(lname) || 0) + d);
        const seen = new Set(); let cur = id;
        while (cur != null) { const n = byId.get(cur); const nm = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop().replace(/\?.*/, "")}:${n.callFrame.lineNumber + 1}`; if (!seen.has(nm)) { seen.add(nm); incl.set(nm, (incl.get(nm) || 0) + d); } cur = parent.get(cur); }
      });
      const top = [...incl.entries()].filter(([k]) => !/^\((root|program|idle|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 45);
      console.log(`  profile ${sc.name}: inclusive ms`);
      for (const [k, v] of top) console.log(`     ${v.toFixed(1).padStart(7)}  ${k}`);
      const topSelf = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
      console.log("  self: " + topSelf.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", "));
    }
    const midState = await state();
    if (process.env.PAZ_TRACE === "1") console.log("  atlas stats: " + JSON.stringify(await page.evaluate(() => { const s = nodeGraphGlLinesTextAtlasStats(); for (const k of Object.keys(s)) s[k] = +s[k].toFixed(1); return s; })));
    if (process.env.PAZ_TRACE === "1") { console.log("  marks: " + JSON.stringify(await page.evaluate(() => { const m = window.__paz.marks; const o = {}; for (const k in m) o[k] = +(m[k] - m.zoomEnd).toFixed(0); o.long = window.__paz.long.map((l) => `${(l.t - m.zoomEnd).toFixed(0)}+${l.d.toFixed(0)}`); return o; }))); console.log("  trace: " + (await page.evaluate(() => { const t = window.__pazT; window.__pazT = []; return t.join(" | "); }))); }
    // Frame deltas whose frame ends inside [zoomEnd, panEnd + 100]: covers the settle and the whole pan.
    const deltas = [];
    for (let i = 1; i < rec.t.length; i += 1) {
      if (rec.t[i] >= rec.marks.zoomEnd && rec.t[i] <= rec.marks.panEnd) deltas.push(rec.t[i] - rec.t[i - 1]);
    }
    // Frames overlapping a controller face's first paint (see above).
    const faceFrames = [];
    const otherDeltas = [];
    for (let i = 1; i < rec.t.length; i += 1) {
      if (!(rec.t[i] >= rec.marks.zoomEnd && rec.t[i] <= rec.marks.panEnd)) continue;
      const d = rec.t[i] - rec.t[i - 1];
      const fp = (rec.facePaints || []).find((p) => p.t1 + 20 > rec.t[i - 1] && p.t0 < rec.t[i]);
      if (fp) faceFrames.push(`${d.toFixed(1)} ms (${fp.id} first paint ${(fp.t1 - fp.t0).toFixed(0)} ms)`);
      else otherDeltas.push(d);
    }
    const panDeltas = [];
    for (let i = 1; i < rec.t.length; i += 1) {
      if (rec.t[i] >= rec.marks.panStart && rec.t[i] <= rec.marks.panEnd) panDeltas.push(rec.t[i] - rec.t[i - 1]);
    }
    const longs = rec.long.filter((l) => l.t + l.d >= rec.marks.zoomEnd && l.t <= rec.marks.panEnd);
    // Text ends up sharp without more input.
    let sharp = null;
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(100);
      sharp = await state();
      if (sharp.glyphs > 0 && sharp.snapped / sharp.glyphs >= 0.95) break;
    }
    const s = stats(deltas); const sp = stats(panDeltas); const so = stats(otherDeltas);
    const longest = longs.reduce((m, l) => Math.max(m, l.d), 0);
    summary.push({ name: sc.name, zoom: +midState.zoom.toFixed(3), window: s, pan: sp, maxNoFaceFirstPaint: so.max, faceFirstPaintFrames: faceFrames, longTasks: longs.length, longest: +longest.toFixed(0) });
    console.log(`  ${sc.name} (zoom ${midState.zoom.toFixed(3)}): zoomEnd..panEnd frames n ${s.n} p50 ${s.p50} p95 ${s.p95} max ${s.max} >33ms ${s.over33}; pan only p95 ${sp.p95} max ${sp.max}; long tasks ${longs.length} (longest ${longest.toFixed(0)} ms)${faceFrames.length ? `; face first-paint frames: ${faceFrames.join(", ")}` : ""}`);
    check(s.p95 <= MAX_P95, `${sc.name}: frame p95 ${s.p95} ms <= ${MAX_P95} ms`);
    check(so.max <= MAX_FRAME, `${sc.name}: no frame over ${MAX_FRAME} ms (max ${so.max}${faceFrames.length ? `; ${faceFrames.length} controller-face first-paint frame(s) reported above` : ""})`);
    check(midState.stale === 0 && sharp.stale === 0, `${sc.name}: no mesh run points at a deleted glyph texture (${midState.stale} after pan, ${sharp.stale} settled; ${sharp.runs} runs)`);
    check(sharp.glyphs > 0 && sharp.snapped / sharp.glyphs >= 0.95, `${sc.name}: text ends sharp at zoom x dpr (${sharp.snapped}/${sharp.glyphs} glyphs 1:1 at ${sharp.scale}; recorded ${sharp.recordScale})`);
  }
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
  console.log("SUMMARY " + JSON.stringify({ patch: path.basename(patchPath), tile, dpr: DPR, summary }));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log("perf_pan_after_zoom passed");