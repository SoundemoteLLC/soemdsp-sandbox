// Scope Window = Beats (Argi 2026-11-16): every syncing scope's Window has
// Cycles / Beats / Time; Beats is a number of beats at the transport tempo and,
// with Sync, each sweep starts on a beat, so a rhythm sits in a steady frame.
//   node scripts/test_scope_window_beats.mjs
// 1. Combined graph engine: soemdsp_graph_project_beats / soemdsp_graph_tempo_bpm
//    report the shared beat position after a block and its tempo.
// 2. Shared settings (lib/visual/scope-sync.js): "beats" is a Window mode, the
//    default stays Cycles, pass samples = Beats x samples per beat.
// 3. Pen scopes (1D Phosphor paint helper): Sync starts every sweep on every
//    ceil(Beats)-th transport beat (fractional Beats waits at the right edge);
//    the frame never moves with the rhythm; Free wraps; no clock = patch tempo.
// 4. Plots (nodeGraphScopeSyncWindow): the window starts on a sweep-start beat
//    and stays on it frame to frame.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };
const SR = 48000;

// ------------------------------------------------------------ 1. engine
{
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")));
  const imports = {};
  for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
  const x = (await WebAssembly.instantiate(mod, imports)).exports;
  if (typeof x.soemdsp_memory_set_budget_mb === "function") x.soemdsp_memory_set_budget_mb(256);
  check(typeof x.soemdsp_graph_project_beats === "function" && typeof x.soemdsp_graph_tempo_bpm === "function", "engine exports soemdsp_graph_project_beats / soemdsp_graph_tempo_bpm");
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  x.soemdsp_graph_add_node(h, 1, 1);
  check(x.soemdsp_graph_compile(h) === 0, "engine: graph compiles");
  check(Math.abs(x.soemdsp_graph_tempo_bpm(h) - 120) < 1e-9, `engine: tempo defaults to 120 (got ${x.soemdsp_graph_tempo_bpm(h)})`);
  x.soemdsp_graph_set_host_transport(h, 140, 0, 1);
  for (let b = 0; b < 100; b += 1) x.soemdsp_graph_process_block(h, 128);
  const want = (100 * 128 * 140) / (60 * SR);
  check(Math.abs(x.soemdsp_graph_project_beats(h) - want) < 1e-9 && Math.abs(x.soemdsp_graph_tempo_bpm(h) - 140) < 1e-9, `engine: 100 blocks at 140 BPM = beat ${want.toFixed(4)} (got ${x.soemdsp_graph_project_beats(h).toFixed(4)})`);
  x.soemdsp_graph_rewind_master(h);
  check(x.soemdsp_graph_project_beats(h) === 0, "engine: rewind puts the beat back to 0");
}

// ------------------------------------------------------------ shared code in a vm
const ctx = {
  console, Math, Number, Boolean, String, Array, Object, Float64Array, Float32Array, JSON,
  performance: { now: () => ctx.__now },
  __now: 1000,
  nodeGraphFiniteNumber: (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb),
  nodeGraphScopeSampleRate: () => SR,
  nodeGraphModuleScopeSimFps: () => 60,
  nodeGraphDisplaySettingsToggleIsOn: (v) => v === true || v === "on" || v === 1,
  nodeGraphDisplaySettingsAmplitudeScale: () => 1,
  nodeGraphTraceDisplayValue: (v, amp) => v * amp,
  nodeGraphMvp: { patch: { timing: { tempoBpm: 100 } } },
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public/lib/visual/scope-sync.js"), "utf8"), ctx);
const helpers = fs.readFileSync(path.join(root, "public/node-graph-module-scope-paint-helpers.js"), "utf8");
vm.runInContext(helpers + "\n;globalThis.__frame = nodeGraphOneDimensionalBurnFramePoints;", ctx);
const trace1d = fs.readFileSync(path.join(root, "public/node-graph-module-scope-1d-trace.js"), "utf8");
vm.runInContext(trace1d + "\n;globalThis.__frame1d = (c, b, s) => nodeGraphScope1dTraceFrameChannels(c, [{ buffer: b }], s, null).channels[0];", ctx);

// ------------------------------------------------------------ 2. settings
{
  const ws = ctx.nodeGraphScopeWindowSettings;
  check(ws({ windowMode: "beats", windowCycles: 2.5 }).windowMode === "beats" && ws({ windowMode: "beats", windowCycles: 2.5 }).windowCycles === 2.5, "Window mode \"beats\" is kept, Beats 2.5 stays fractional");
  check(ws({}).windowMode === "cycles" && ws({ windowMode: "nope" }).windowMode === "cycles", "default Window stays Cycles");
  check(ctx.nodeGraphScopeWindowCycles({ windowMode: "beats", windowCycles: 4 }) === 0 && ctx.nodeGraphScopeWindowBeats({ windowMode: "beats", windowCycles: 4 }) === 4, "Beats does not measure a period (no Cycles), Beats count = the stepper value");
  const per = 120 / (60 * SR);
  check(Math.abs(ctx.nodeGraphScopePassSamples({}, { windowMode: "beats", windowCycles: 4 }, SR, per) - 4 * SR / 2) < 1e-6, "pass = Beats x samples per beat (4 beats at 120 BPM = 96000 samples)");
  check(Math.abs(ctx.nodeGraphScopePassSamples({}, { windowMode: "beats", windowCycles: 1 }, SR) - SR * 60 / 100) < 1e-6, "no transport clock: the patch tempo (100 BPM)");
}

// ------------------------------------------------------------ 3. pen scopes
const H = 200;
const sampleOfY = (y) => (H * 0.5 - y) / (H * 0.44);
/**
 * Stream a transport at `bpm` through a 1D Phosphor face 800 samples per frame.
 * The trace encodes the beat position: -0.4 + 0.8 * (beat mod `mark`) / mark,
 * so a point's sample value tells the beat it was drawn at. An irregular
 * "rhythm" is irrelevant to the window, so the trace is the clock itself.
 */
function run({ face = "__frame", bpm = 120, beats, sync = true, total, clock = true, mark = Math.max(1, Math.ceil(beats - 1e-9)), startBeat = 0.37 }) {
  const RING = 48000, CHUNK = 800;
  const per = bpm / (60 * SR);
  const trace = new Float64Array(RING);
  const canvas = { width: 400, height: H };
  const settings = { windowMode: "beats", windowCycles: beats, timeMs: 20, sourceSync: sync };
  const sweeps = []; // { beat, x } of the first point after each stroke break
  const xs = []; // [beatPhase in sweep, x] of all points
  let done = 0, lastX = NaN;
  const beatOf = (i) => startBeat + (i + 1) * per; // beat at the end of sample i
  while (done < total) {
    trace.copyWithin(0, CHUNK);
    for (let k = 0; k < CHUNK; k += 1) {
      const b = beatOf(done + k) - per;
      trace[RING - CHUNK + k] = -0.4 + 0.8 * (((b % mark) + mark) % mark) / mark;
    }
    done += CHUNK;
    trace.nodeGraphScopeAbsoluteFrame = done;
    trace.nodeGraphScopeRetainedSampleCount = Math.min(done, RING);
    trace.nodeGraphScopeRecentSampleCount = CHUNK;
    if (clock) {
      trace.nodeGraphScopeBeatEnd = startBeat + done * per;
      trace.nodeGraphScopeBeatsPerSample = per;
    }
    ctx.__now += 1000 / 60;
    const pts = ctx[face](canvas, trace, settings, null);
    canvas._nodeGraphOneDimensionalBurnLastDrawnFrame = done;
    for (const p of pts) {
      if (!p) continue;
      // A sweep start: the pen jumped back to the left (a wrap or a new sweep).
      if (Number.isFinite(lastX) && p.x < lastX - 200) sweeps.push({ v: sampleOfY(p.y), x: p.x });
      xs.push([sampleOfY(p.y), p.x]);
      lastX = p.x;
    }
  }
  return { sweeps, xs, lastX, per, done };
}
{
  for (const [bpm, beats] of [[120, 4], [120, 1], [93, 3], [140, 2.5], [120, 0.5]]) {
    const total = 48000 * 20;
    const r = run({ bpm, beats, total });
    const every = Math.max(1, Math.ceil(beats - 1e-9));
    const totalBeats = total * r.per;
    const expect = Math.floor((0.37 + totalBeats) / every) - Math.floor(0.37 / every);
    const tol = 0.8 / (every / r.per) * 2; // two samples of the marker ramp
    // The marker ramp wraps on the sweep-start beat itself (either side of it within float rounding).
    const onBeat = r.sweeps.every((s) => Math.min(Math.abs(s.v + 0.4), Math.abs(s.v - 0.4)) <= tol && s.x < 400 * (2 * r.per / beats) + 1e-9);
    check(onBeat && Math.abs(r.sweeps.length - expect) <= 1, `Sync, ${bpm} BPM, Beats ${beats}: ${r.sweeps.length} sweeps (want ~${expect}, one per ${every} beat${every > 1 ? "s" : ""}), each starts at the left edge on a sweep-start beat`);
    // Steady frame: the same point of the beat grid lands on the same x every sweep.
    let worst = 0;
    for (const [v, x] of r.xs) {
      const phaseBeats = ((v + 0.4) / 0.8) * every; // beats since the sweep start
      if (phaseBeats >= beats) continue;
      let d = Math.abs(x - (phaseBeats / beats) * 400);
      // Whole Beats: a sample on the sweep-start beat may land either end of the face.
      if (every === beats) d = Math.min(d, Math.abs(400 - d));
      worst = Math.max(worst, d);
    }
    check(worst < 0.05, `Sync, ${bpm} BPM, Beats ${beats}: x = beats since the sweep start / Beats exactly (worst ${worst.toFixed(4)} px)`);
    if (beats % 1) {
      let maxX = 0;
      for (const [, x] of r.xs) maxX = Math.max(maxX, x);
      check(maxX <= 400 && r.xs.some(([v]) => ((v + 0.4) / 0.8) * every >= beats - 0.01), `Beats ${beats}: the pen reaches the right edge then waits for the next sweep start`);
    }
  }
}
{
  // 1D Trace: the same shared pen.
  const r = run({ face: "__frame1d", bpm: 120, beats: 4, total: 48000 * 20 });
  let worst = 0;
  for (const [v, x] of r.xs) {
    let d = Math.abs(x - ((v + 0.4) / 0.8) * 400);
    d = Math.min(d, Math.abs(400 - d));
    worst = Math.max(worst, d);
  }
  check(Math.abs(r.sweeps.length - 10) <= 1 && worst < 0.05, `1D Trace, Sync, Beats 4: ${r.sweeps.length} sweeps, one per bar, steady frame (worst ${worst.toFixed(4)} px)`);
}
{
  // Free: back-to-back passes of Beats from wherever it started (no beat lock).
  const r = run({ beats: 2, sync: false, total: 48000 * 10 });
  const wraps = r.sweeps.length;
  const expect = (48000 * 10 * r.per) / 2;
  check(Math.abs(wraps - expect) <= 1.5 && r.lastX < 400, `Free, Beats 2: the pen wraps every 2 beats (${wraps} passes, want ~${expect.toFixed(1)})`);
}
{
  // No transport clock (older worklet): the patch tempo (100 BPM) sets the length; Sync runs free.
  const r = run({ bpm: 100, beats: 1, total: 48000 * 6, clock: false });
  const expect = 6 * 100 / 60;
  check(Math.abs(r.sweeps.length - expect) <= 1.5, `no clock: Beats 1 at the patch tempo (100 BPM) wraps ~${expect} times (got ${r.sweeps.length})`);
}

// ------------------------------------------------------------ 4. plots
{
  // A 10 s ring (the scope rings' size): room for a sweep start and a whole window.
  const length = 480000;
  const edge = new Float32Array(length);
  const state = {};
  const bpm = 128, per = bpm / (60 * SR), beats = 2;
  let ok = true, steady = true, prevStartBeat = NaN, jumps = 0, frames = 0;
  for (let frame = 0; frame < 300; frame += 1) {
    const total = length + frame * 800;
    edge.nodeGraphScopeTotalSampleCount = total;
    edge.nodeGraphScopeBeatEnd = 5.21 + total * per;
    edge.nodeGraphScopeBeatsPerSample = per;
    ctx.__now += 1000 / 60;
    const win = ctx.nodeGraphScopeSyncWindow(state, edge, length, { settings: { windowMode: "beats", windowCycles: beats }, sampleRate: SR, sync: true, trigger: false });
    const startBeat = edge.nodeGraphScopeBeatEnd - (length - win.start) * per;
    if (Math.abs(startBeat - Math.round(startBeat / 2) * 2) > 1e-6) ok = false;
    if (Math.abs(win.n - beats / per) > 1) ok = false;
    if (win.start + win.n > length - 2 + 1e-9 || win.start < 0) ok = false;
    if (Number.isFinite(prevStartBeat) && Math.abs(startBeat - prevStartBeat) > 1e-6) {
      jumps += 1;
      if (Math.abs(startBeat - prevStartBeat - 2) > 1e-6) steady = false;
    }
    prevStartBeat = startBeat;
    frames += 1;
  }
  const expectJumps = (299 * 800 * per) / 2;
  check(ok, "plot Sync, Beats 2 at 128 BPM: every window starts exactly on an even beat, n = 2 beats, inside the ring");
  check(steady && Math.abs(jumps - expectJumps) <= 1, `plot: the window holds its start beat and steps exactly 2 beats at a time (${jumps} steps in ${frames} frames, want ~${expectJumps.toFixed(1)})`);
  const free = ctx.nodeGraphScopeSyncWindow({}, edge, length, { settings: { windowMode: "beats", windowCycles: beats }, sampleRate: SR, sync: false, trigger: false });
  check(Math.abs(free.n - beats / per) <= 1, "plot Free, Beats 2: window = 2 beats long");
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
