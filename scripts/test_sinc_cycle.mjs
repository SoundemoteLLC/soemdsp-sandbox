// Sinc Cycle option and Reset trigger, checked against PolyBLEP's (same semantics).
// Runs the real combined wasm headless; no browser.
//
//   node scripts/test_sinc_cycle.mjs [path/to/soemdsp_combined.wasm] [path/to/baseline_combined.wasm]
//
// Reset is a trigger: a hit of height h (-1..1) moves the phase |h| of the way to the
// cycle start (h < 0 the long way; |h| = 1 = hard reset). Cycle (timingMode):
// 0 Free run, 1 Single trigger = one cycle per Reset hit, silent before the first
// hit and after the cycle. With a baseline wasm (e.g. the previous build), default
// Sinc and PolyBLEP output must be bit-identical to it.
// Exit code 1 if anything fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = process.argv[2] || path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const baselinePath = process.argv[3] || "";

async function load(p) {
  const mod = await WebAssembly.compile(fs.readFileSync(p));
  const imports = {};
  for (const i of WebAssembly.Module.imports(mod)) {
    imports[i.module] ??= {};
    imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined;
  }
  return (await WebAssembly.instantiate(mod, imports)).exports;
}
const x = await load(wasmPath);

const SR = 48000;
const POLYBLEP = 1, BIAS = 12, SINC = 48;
const P_FREQ = 10, P_WAVE = 11, P_PHASE = 14, P_MODE = 21, P_STAGES = 22, P_TIMING = 54, P_LFO_STYLE = 56, P_OFFSET = 71;
const PORT_MONO = 0, PORT_RESET = 19;

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}

// One oscillator (node 2), optionally with a Bias (node 1) into Reset. Renders one
// frame per block so a Reset edge can land on any sample.
// opts: { type, params: [[id, v]], reset: bool, gates: Map(frame -> level), frames }
function render(ex, { type, params = [], reset = false, gates = new Map(), frames = 2000, blk = 1 }) {
  const h = ex.soemdsp_graph_create();
  ex.soemdsp_graph_set_sample_rate(h, SR);
  if (reset) {
    ex.soemdsp_graph_add_node(h, 1, BIAS);
    ex.soemdsp_graph_set_smooth_type(h, 1, P_OFFSET, 3);
    ex.soemdsp_graph_set_smooth_time(h, 1, P_OFFSET, 0);
  }
  ex.soemdsp_graph_add_node(h, 2, type);
  // Every knob set here jumps at once (Freq / Phase are smoothed by default).
  for (const [k] of [[P_FREQ], ...params]) {
    ex.soemdsp_graph_set_smooth_type(h, 2, k, 3);
    ex.soemdsp_graph_set_smooth_time(h, 2, k, 0);
  }
  for (const [k, v] of params) ex.soemdsp_graph_set_param(h, 2, k, v);
  if (reset) ex.soemdsp_graph_connect(h, 1, PORT_MONO, 2, PORT_RESET);
  ex.soemdsp_graph_compile(h);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += blk) {
    if (gates.has(f)) ex.soemdsp_graph_set_param(h, 1, P_OFFSET, gates.get(f));
    const n = Math.min(blk, frames - f);
    ex.soemdsp_graph_process_block(h, n);
    const q = ex.soemdsp_graph_node_port_ptr(h, 2, PORT_MONO) / 8;
    out.set(new Float64Array(ex.memory.buffer).subarray(q, q + n), f);
  }
  ex.soemdsp_graph_destroy(h);
  return out;
}

// JS twin of native_modules/sinc/sinc.cpp kernels (Math.sin; native uses dsp_sin).
function sincKernel(phase, lobes, bandLimit, freq) {
  const count = Math.max(1, lobes);
  if (!bandLimit) {
    const xx = (phase - 0.5) * 2 * Math.PI * count;
    if (Math.abs(xx) < 1e-9) return 1;
    return Math.max(-1, Math.min(1, Math.sin(xx) / xx));
  }
  const f = Math.max(freq, 1e-9);
  let maxH = Math.floor((SR * 0.5) / f) - 1;
  if (maxH < 1) maxH = 1;
  const harm = Math.max(1, Math.min(count, maxH));
  const order = 2 * harm + 1;
  const th = Math.PI * (phase - 0.5);
  const d = order * Math.sin(th);
  if (Math.abs(d) < 1e-9) return 1;
  return Math.max(-1, Math.min(1, Math.sin(order * th) / d));
}
const wrap01 = (p) => p - Math.floor(p);
// Phase each Reset model should land on (trigger.h partial_reset_phase, period 1).
function partialReset(phase, h) {
  if (h >= 1 || h <= -1) return 0;
  let d = (0 - phase);
  d -= Math.floor(d + 0.5);
  if (h < 0) { d = d >= 0 ? d - 1 : d + 1; h = -h; }
  return wrap01(phase + h * d);
}
const maxDiff = (a, b, from = 0, to = a.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const sameBits = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

const sincParams = (freq, lobes, bl, extra = []) => [[P_FREQ, freq], [P_STAGES, lobes], [P_MODE, bl], ...extra];
// Gate sequence: each hit is 0 for a frame then the height (gate_hit needs a rise).
function gatesFor(hits) {
  const g = new Map();
  for (const [frame, height] of hits) { if (!g.has(frame - 1)) g.set(frame - 1, 0); g.set(frame, height); }
  return g;
}
// Hit heights per frame from a gate sequence, as trigger.h gate_hit / gate_hit_height.
function hitHeights(gates, frames) {
  const out = new Map();
  let prev = 0, level = 0;
  for (let i = 0; i < frames; i++) {
    if (gates.has(i)) level = gates.get(i);
    const crossUp = prev <= 0 && level > 0;
    if (crossUp || Math.abs(level) > Math.abs(prev)) {
      let hgt = crossUp ? level : Math.abs(level) - Math.abs(prev);
      if (level < 0) hgt = -hgt;
      out.set(i, Math.max(-1, Math.min(1, hgt)));
    }
    prev = level;
  }
  return out;
}

// ---------------------------------------------------------------- 1. defaults unchanged
{
  const cases = [[100, 4, 1, 0], [440, 16, 1, 0.25], [1234.5, 7, 0, 0], [5000, 3, 0, 0.6], [0, 4, 1, 0]];
  let wiredQuiet = 0;
  for (const [f, l, b, ph] of cases) {
    const p = sincParams(f, l, b, [[P_PHASE, ph]]);
    const plain = render(x, { type: SINC, params: p, frames: 1024, blk: 128 });
    const wired = render(x, { type: SINC, params: p, frames: 1024, blk: 128, reset: true });
    if (sameBits(plain, wired)) wiredQuiet += 1;
  }
  check(wiredQuiet === cases.length, `sinc: a Reset cable that never fires changes nothing (${wiredQuiet}/${cases.length} settings bit-identical)`);
  if (baselinePath) {
    const base = await load(baselinePath);
    let same = 0, pbSame = 0;
    for (const [f, l, b, ph] of cases) {
      const p = sincParams(f, l, b, [[P_PHASE, ph]]);
      if (sameBits(render(x, { type: SINC, params: p, frames: 4096, blk: 128 }), render(base, { type: SINC, params: p, frames: 4096, blk: 128 }))) same += 1;
    }
    check(same === cases.length, `sinc: default Free run output bit-identical to the baseline build (${same}/${cases.length} settings)`);
    // PolyBLEP (its single-trigger code moved into shared helpers): Free run and Single trigger unchanged.
    const pbCases = [
      { params: [[P_FREQ, 220], [P_WAVE, 1]], reset: false },
      { params: [[P_FREQ, 330], [P_WAVE, 5]], reset: true, gates: gatesFor([[100, 1], [700, 0.5]]) },
      { params: [[P_FREQ, 500], [P_WAVE, 3], [P_TIMING, 1]], reset: true, gates: gatesFor([[50, 1], [400, 1], [450, -0.5]]) },
    ];
    for (const c of pbCases) {
      const o = { type: POLYBLEP, frames: 1500, ...c };
      if (sameBits(render(x, o), render(base, o))) pbSame += 1;
    }
    check(pbSame === pbCases.length, `polyblep: Free run, Reset and Single trigger bit-identical to the baseline build (${pbSame}/${pbCases.length})`);
  } else {
    console.log("skip  baseline comparison (pass a baseline wasm as the 2nd argument)");
  }
}

// ---------------------------------------------------------------- 2. Reset = PolyBLEP phase semantics
// PolyBLEP Ramp with Antialiasing Off is exactly -1 + 2*phase, so it shows the phase
// PolyBLEP renders each sample. Sinc fed the same Reset gates must render its kernel
// at that same phase, sample for sample (hard, partial and long-way hits), from the
// first hard hit on. (Before any hit the two free phases differ by one step: PolyBLEP
// renders then advances, Sinc advances then renders, as before this change.)
{
  const freq = 437.3, lobes = 5;
  // The last two land on back-to-back samples (0 -> 0.9 -> 1: a 0.9 hit, then a 0.1 hit).
  const hits = [[120, 1], [333, 0.5], [610, -0.5], [801, 0.25], [1002, -1], [1199, 0], [1200, 0.9], [1201, 1]];
  const gates = gatesFor(hits);
  const ramp = render(x, { type: POLYBLEP, params: [[P_FREQ, freq], [P_WAVE, 2], [P_LFO_STYLE, 0]], reset: true, gates, frames: 1500 });
  for (const bl of [1, 0]) {
    const sinc = render(x, { type: SINC, params: sincParams(freq, lobes, bl), reset: true, gates, frames: 1500 });
    let worst = 0;
    for (let i = 120; i < 1500; i++) worst = Math.max(worst, Math.abs(sinc[i] - sincKernel(wrap01((ramp[i] + 1) / 2), lobes, bl, freq)));
    check(worst < 2e-5, `sinc ${bl ? "Band Limit" : "Ideal"}: renders at PolyBLEP's phase through 8 hard/partial/long-way Reset hits (worst ${worst.toExponential(2)})`);
  }
  // Model check: the phase each hit lands on follows partial_reset_phase on the free phase.
  let p = 0, worst = 0;
  const hitAt = hitHeights(gates, 1500);
  for (let i = 0; i < 1500; i++) {
    if (hitAt.has(i)) p = partialReset(p, hitAt.get(i)); // the hit sample already renders at the moved phase
    worst = Math.max(worst, Math.abs(Math.sin(Math.PI * p) - Math.sin(Math.PI * (ramp[i] + 1) / 2)));
    p = wrap01(p + freq / SR);
  }
  check(worst < 1e-6, `polyblep reference: hits move the rendered phase |h| of the way to 0 (h<0 the long way) (worst ${worst.toExponential(2)})`);
}

// ---------------------------------------------------------------- 3. hard reset restarts the cycle exactly
{
  const p = sincParams(300, 6, 1, [[P_PHASE, 0.2]]);
  const a = render(x, { type: SINC, params: p, reset: true, gates: gatesFor([[200, 1]]), frames: 1200 });
  const b = render(x, { type: SINC, params: p, reset: true, gates: gatesFor([[517, 1]]), frames: 1517 });
  check(sameBits(a.subarray(200, 1200), b.subarray(517, 1517)), "sinc: after a hard Reset the output is the same whenever the hit came (bit-identical cycles)");
  check(Math.abs(a[200] - sincKernel(0.2, 6, 1, 300)) < 2e-5, `sinc: the hit sample renders at phase 0 + Phase (${a[200].toFixed(6)} vs ${sincKernel(0.2, 6, 1, 300).toFixed(6)})`);
}

// ---------------------------------------------------------------- 4. Cycle = Single trigger
{
  const freq = 480; // 100 samples per cycle
  const n = Math.ceil((1 - 1e-9) * SR / freq);
  const hits = [[100, 1], [600, 1], [650, 1]]; // third hit retriggers mid-cycle
  const gates = gatesFor(hits);
  const sinc = render(x, { type: SINC, params: sincParams(freq, 4, 1, [[P_TIMING, 1], [P_PHASE, 0.1]]), reset: true, gates, frames: 1200 });
  const pb = render(x, { type: POLYBLEP, params: [[P_FREQ, freq], [P_WAVE, 5], [P_TIMING, 1], [P_PHASE, 0.1]], reset: true, gates, frames: 1200 });
  const free = render(x, { type: SINC, params: sincParams(freq, 4, 1, [[P_PHASE, 0.1]]), reset: true, gates: gatesFor([[100, 1]]), frames: 300 });
  const silentBefore = sinc.subarray(0, 100).every((v) => v === 0);
  check(silentBefore, "sinc Single trigger: silent before the first Reset hit");
  check(sameBits(sinc.subarray(100, 100 + n), free.subarray(100, 100 + n)) && sinc.subarray(100 + n, 600).every((v) => v === 0),
    `sinc Single trigger: one hit plays exactly one cycle (${n} samples, same as Free run after a hard Reset) then stays silent`);
  check(sinc.subarray(650, 650 + n).some((v) => v !== 0) && sinc.subarray(650 + n).every((v) => v === 0)
    && sameBits(sinc.subarray(650, 650 + n), sinc.subarray(100, 100 + n)),
    "sinc Single trigger: a hit mid-cycle restarts the cycle from the top");
  // Same gating window as PolyBLEP Single trigger (Sine never sits at exactly 0 there with Phase 0.1).
  const span = (arr) => { const out = []; let on = false; for (let i = 0; i < arr.length; i++) { const now = arr[i] !== 0; if (now !== on) { out.push(i); on = now; } } return out.join(","); };
  check(span(sinc) === span(pb), `sinc Single trigger: plays on exactly the samples PolyBLEP Single trigger plays (${span(pb)})`);
  // Free run (default) keeps running after the cycle.
  const fr = render(x, { type: SINC, params: sincParams(freq, 4, 1), reset: true, gates, frames: 1200 });
  check(fr.subarray(0, 100).some((v) => v !== 0) && fr.subarray(300, 600).some((v) => v !== 0), "sinc Free run: plays before and between hits");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);