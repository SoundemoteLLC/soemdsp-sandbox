// Modal Snare display Cycles = hits (Argi 2026-11-16): the snare's own strikes
// (__Strike face tap) drive the display window, not edges of the noisy audio.
//   node scripts/test_modal_snare_cycles.mjs
// 1. modal_snare.wasm: strike tap = velocity on each struck sample, else 0
//    (Trigger hits of either sign, Reset re-strikes; silent Reset is no hit).
// 2. Combined graph engine: the modalSnare node's Phase01 port carries exactly
//    the standalone module's strikes for the same trigger stream.
// 3. Display pen (lib/visual/scope-sync.js + 1D burn paint helpers): Sync on,
//    Cycles = N starts every sweep on a hit, N hits apart (fractional N
//    continuous), survives swing / drift, holds with no hits; Free wraps.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };
const load = async (rel) => {
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, rel)));
  const imports = {};
  for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
  const x = (await WebAssembly.instantiate(mod, imports)).exports;
  if (typeof x.soemdsp_memory_set_budget_mb === "function") x.soemdsp_memory_set_budget_mb(256);
  return x;
};
const SR = 48000;

// ------------------------------------------------------------ 1. strike tap
const sn = await load("native_modules/modal_snare/modal_snare.wasm");
check(sn.soemdsp_modal_snare_version() >= 8, `modal_snare version ${sn.soemdsp_modal_snare_version()}`);
const snareStrikes = (trig, reset = null) => {
  const h = sn.soemdsp_modal_snare_create();
  const out = new Float64Array(trig.length);
  for (let i = 0; i < trig.length; i += 1) {
    sn.soemdsp_modal_snare_sample(h, trig[i], reset ? reset[i] : 0, 180, 0.5, 0.5, 0.25, 0.2, 0, 1, 3000, 1, 0.3, 2, 0, SR, 0, 0);
    out[i] = sn.soemdsp_modal_snare_strike(h);
  }
  sn.soemdsp_modal_snare_destroy(h);
  return out;
};
{
  const n = 4000;
  const trig = new Float64Array(n);
  const reset = new Float64Array(n);
  reset[50] = 1; // before any Trigger: silent, no hit
  for (let i = 100; i < 110; i += 1) trig[i] = 0.7; // one 10-sample gate = one hit at 0.7
  trig[1000] = -0.4; // negative height rectifies: a hit at 0.4
  reset[2000] = 1; // re-strike at the last velocity
  const s = snareStrikes(trig, reset);
  const hitsAt = [...s.keys()].filter((i) => s[i] !== 0);
  check(JSON.stringify(hitsAt) === JSON.stringify([100, 1000, 2000]), `strikes land on samples 100, 1000, 2000 (got ${hitsAt})`);
  check(Math.abs(s[100] - 0.7) < 1e-12 && Math.abs(s[1000] - 0.4) < 1e-12 && Math.abs(s[2000] - 0.4) < 1e-12, "strike value = velocity (0.7, rectified 0.4, Reset re-strike 0.4)");
}

// ------------------------------------------------------------ 2. graph engine tap
{
  const x = await load("native_modules/combined/soemdsp_combined.wasm");
  const BLK = 128, OSC = 1, SNARE = 228, OUT_PORT = 5, TRIGGER_IN = 20, PHASE01 = 10;
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  x.soemdsp_graph_add_node(h, 1, OSC);
  x.soemdsp_graph_set_param(h, 1, 10, 37);
  x.soemdsp_graph_add_node(h, 2, SNARE);
  x.soemdsp_graph_connect(h, 1, OUT_PORT, 2, TRIGGER_IN);
  check(x.soemdsp_graph_compile(h) === 0, "engine: Osc -> Modal Snare Trigger compiles");
  const port = (node, p) => { const q = x.soemdsp_graph_node_port_ptr(h, node, p) / 8; return new Float64Array(x.memory.buffer).slice(q, q + BLK); };
  const trig = [], tap = [];
  for (let b = 0; b < 400; b += 1) {
    x.soemdsp_graph_process_block(h, BLK);
    trig.push(...port(1, OUT_PORT));
    tap.push(...port(2, PHASE01));
  }
  const ref = snareStrikes(Float64Array.from(trig));
  let same = true;
  for (let i = 0; i < ref.length; i += 1) if (!(Math.abs(ref[i] - tap[i]) < 1e-12)) { same = false; break; }
  const count = tap.filter((v) => v > 0).length;
  check(same && count > 0, `engine: Phase01 (__Strike) == standalone strikes for the same trigger stream (${count} struck samples)`);
}

// ------------------------------------------------------------ 3. display pen
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
};
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public/lib/visual/scope-sync.js"), "utf8"), ctx);
const helpers = fs.readFileSync(path.join(root, "public/node-graph-module-scope-paint-helpers.js"), "utf8");
vm.runInContext(helpers + "\n;globalThis.__frame = nodeGraphOneDimensionalBurnFramePoints;", ctx);

const H = 200;
const sampleOfY = (y) => (H * 0.5 - y) / (H * 0.44);
/**
 * Stream `hitAt` (sorted absolute hit samples) through the face 800 samples
 * per frame. The trace is a ramp that is -0.4 exactly on each hit sample, so
 * the first point of each sweep tells whether that sweep started on a hit.
 */
function run({ hitAt, total, cycles, sync = true, withHits = true, run = 1 }) {
  const RING = 48000, CHUNK = 800;
  const trace = new Float64Array(RING), hits = new Float64Array(RING);
  const hitSet = new Set(hitAt);
  const canvas = { width: 400, height: H };
  const settings = { windowMode: "cycles", windowCycles: cycles, timeMs: 20, sourceSync: sync };
  const starts = [];
  let prevHit = -Infinity, nextIdx = 0, done = 0, lastX = NaN, lastPointAt = -1;
  const value = (i) => {
    while (nextIdx < hitAt.length && hitAt[nextIdx] <= i) { prevHit = hitAt[nextIdx]; nextIdx += 1; }
    const next = nextIdx < hitAt.length ? hitAt[nextIdx] : prevHit + 4800;
    return Number.isFinite(prevHit) ? -0.4 + 0.8 * (i - prevHit) / Math.max(1, next - prevHit) : 0;
  };
  while (done < total) {
    trace.copyWithin(0, CHUNK); hits.copyWithin(0, CHUNK);
    for (let k = 0; k < CHUNK; k += 1) {
      const i = done + k;
      trace[RING - CHUNK + k] = value(i);
      // run > 1: each hit is a run of struck samples (a trigger rising over a few samples).
      let struck = false;
      for (let q = 0; q < run; q += 1) if (hitSet.has(i - q)) struck = true;
      hits[RING - CHUNK + k] = struck ? 0.8 - 0.1 * (run > 1 ? 1 : 0) : 0;
    }
    done += CHUNK;
    for (const b of [trace, hits]) {
      b.nodeGraphScopeAbsoluteFrame = done;
      b.nodeGraphScopeRetainedSampleCount = Math.min(done, RING);
      b.nodeGraphScopeRecentSampleCount = CHUNK;
    }
    ctx.__now += 1000 / 60;
    const pts = ctx.__frame(canvas, trace, settings, null, withHits ? hits : null);
    canvas._nodeGraphOneDimensionalBurnLastDrawnFrame = done;
    let prev = null;
    for (const p of pts) {
      // Sweep starts once the hits begin (the pen's very first pass starts at 0 before any hit).
      if (p && p.x === 0 && done > hitAt[0] && (prev === null || !(prev.x < 1e-9))) starts.push(sampleOfY(p.y));
      if (p) { lastX = p.x; lastPointAt = done; }
      prev = p;
    }
  }
  return { starts, lastX, lastPointAt, done };
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const regular = (period, count, first = 2000) => Array.from({ length: count }, (_, k) => first + k * period);
{
  const hitAt = regular(4800, 30);
  for (const cycles of [1, 3, 2.5, 0.5]) {
    const r = run({ hitAt, total: 2000 + 30 * 4800, cycles });
    const need = Math.max(1, Math.ceil(cycles - 1e-9));
    const expect = Math.floor((30 - 1) / need) + 1;
    const onHit = r.starts.every((s) => near(s, -0.4));
    check(onHit && Math.abs(r.starts.length - expect) <= 1, `Sync, Cycles ${cycles}: ${r.starts.length} sweeps (want ~${expect}, one per ${need} hits), every one starts on a hit`);
  }
}
{
  // 120 BPM 16ths at 44.1 kHz style drift: intervals alternate 5512 / 5513, plus swing.
  const drift = [2000]; for (let k = 1; k < 30; k += 1) drift.push(drift[k - 1] + (k % 2 ? 5512 : 5513));
  const swing = [2000]; for (let k = 1; k < 30; k += 1) swing.push(swing[k - 1] + (k % 2 ? 6000 : 3600));
  for (const [name, hitAt] of [["drifting", drift], ["swung", swing]]) {
    const r = run({ hitAt, total: hitAt[29] + 4000, cycles: 3 });
    check(r.starts.length === 10 && r.starts.every((s) => near(s, -0.4)), `Sync, Cycles 3, ${name} hits: 10 sweeps, each on a hit, none skipped (got ${r.starts.length})`);
  }
}
{
  // A trigger that rises over 3 samples strikes on each: still one hit per trigger.
  const hitAt = regular(4800, 30);
  const r = run({ hitAt, total: 2000 + 30 * 4800, cycles: 3, run: 3 });
  check(r.starts.length === 10 && r.starts.every((s) => near(s, -0.4)), `Sync, Cycles 3, 3-sample strike runs: one hit each, 10 sweeps (got ${r.starts.length})`);
}
{
  // Hits stop: the pen parks at the right edge and draws nothing new (last sweep holds).
  const hitAt = regular(4800, 6);
  const r = run({ hitAt, total: 2000 + 6 * 4800 + 48000, cycles: 2 });
  const lastHit = hitAt[hitAt.length - 1];
  check(r.lastX > 395 && r.lastPointAt <= lastHit + 2 * 4800 + 1600, `no hits: pen parks at the right edge and holds (last ink by sample ${r.lastPointAt}, last hit ${lastHit})`);
}
{
  // Free (Sync off): the pen wraps every Cycles x hit period, not tied to hits.
  const hitAt = regular(4800, 30);
  const r = run({ hitAt, total: 2000 + 30 * 4800, cycles: 3, sync: false });
  check(r.lastPointAt === r.done && r.starts.length === 0, `Free: the pen keeps drawing to the newest sample and wraps without restarting on hits (${r.starts.length} hit starts)`);
}
{
  // No hit stream (other lineBurn modules): unchanged Schmitt path still syncs on the trace.
  const hitAt = regular(4800, 30);
  const r = run({ hitAt, total: 2000 + 30 * 4800, cycles: 1, withHits: false });
  check(r.starts.length > 0, `no hit stream: the audio-edge path still sweeps (${r.starts.length} sweeps)`);
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
