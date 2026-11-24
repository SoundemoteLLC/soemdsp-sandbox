// Additive Cycle option and Reset trigger (on Additive Out, where the partial
// phases live), checked against PolyBLEP's semantics. Runs the real combined wasm
// headless; no browser.
//
//   node scripts/test_additive_cycle.mjs [path/to/soemdsp_combined.wasm] [path/to/baseline_combined.wasm]
//
// Reset is a trigger: a hit of height h (-1..1) moves the master (fundamental) phase
// |h| of the way to the cycle start (h < 0 the long way; |h| = 1 = hard reset, every
// partial to 0). A partial hit shifts every partial by the master's move times its
// ratio, so the bank stays coherent: the waveform after the hit is the same waveform
// at the moved phase. Cycle (timingMode): 0 Free run, 1 Single trigger = one
// fundamental cycle per Reset hit, silent before the first hit and after the cycle,
// phases held while stopped. With a baseline wasm, default output must be
// bit-identical to it.
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
const POLYBLEP = 1, BIAS = 12, ADD_GEN = 111, ADD_OUT = 113;
const P_FREQ = 10, P_WAVE = 11, P_AMP = 12, P_SHAPE = 13, P_PHASE = 14, P_STAGES = 22, P_TIMING = 54, P_OFFSET = 71;
const PORT_MONO = 0, PORT_LEFT = 1, PORT_RIGHT = 2, PORT_RESET = 19, PORT_GRAPH = 23;
const GEN = 3, OUT = 2, SRC = 1;

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}
const instant = (ex, h, id, keys) => { for (const k of keys) { ex.soemdsp_graph_set_smooth_type(h, id, k, 3); ex.soemdsp_graph_set_smooth_time(h, id, k, 0); } };

// Additive Generator (3) -> Graph -> Additive Out (2), optionally a Bias (1) into
// Out's Reset. One frame per block so a Reset edge can land on any sample.
// opts: { gen: [[id, v]], out: [[id, v]], reset, gates: Map(frame -> level), frames, blk, port }
function renderAdd(ex, { gen = [], out = [], reset = false, gates = new Map(), frames = 2000, blk = 1, port = PORT_MONO }) {
  const h = ex.soemdsp_graph_create();
  ex.soemdsp_graph_set_sample_rate(h, SR);
  if (reset) { ex.soemdsp_graph_add_node(h, SRC, BIAS); instant(ex, h, SRC, [P_OFFSET]); }
  ex.soemdsp_graph_add_node(h, GEN, ADD_GEN);
  ex.soemdsp_graph_add_node(h, OUT, ADD_OUT);
  instant(ex, h, GEN, gen.map(([k]) => k));
  instant(ex, h, OUT, [P_FREQ, ...out.map(([k]) => k)]);
  for (const [k, v] of gen) ex.soemdsp_graph_set_param(h, GEN, k, v);
  for (const [k, v] of out) ex.soemdsp_graph_set_param(h, OUT, k, v);
  ex.soemdsp_graph_connect(h, GEN, PORT_GRAPH, OUT, PORT_GRAPH);
  if (reset) ex.soemdsp_graph_connect(h, SRC, PORT_MONO, OUT, PORT_RESET);
  ex.soemdsp_graph_compile(h);
  const res = new Float64Array(frames);
  for (let f = 0; f < frames; f += blk) {
    if (gates.has(f)) ex.soemdsp_graph_set_param(h, SRC, P_OFFSET, gates.get(f));
    const n = Math.min(blk, frames - f);
    ex.soemdsp_graph_process_block(h, n);
    const q = ex.soemdsp_graph_node_port_ptr(h, OUT, port) / 8;
    res.set(new Float64Array(ex.memory.buffer).subarray(q, q + n), f);
  }
  ex.soemdsp_graph_destroy(h);
  return res;
}
function renderPb(ex, { params = [], gates = new Map(), frames = 2000 }) {
  const h = ex.soemdsp_graph_create();
  ex.soemdsp_graph_set_sample_rate(h, SR);
  ex.soemdsp_graph_add_node(h, SRC, BIAS); instant(ex, h, SRC, [P_OFFSET]);
  ex.soemdsp_graph_add_node(h, OUT, POLYBLEP);
  instant(ex, h, OUT, [P_FREQ, ...params.map(([k]) => k)]);
  for (const [k, v] of params) ex.soemdsp_graph_set_param(h, OUT, k, v);
  ex.soemdsp_graph_connect(h, SRC, PORT_MONO, OUT, PORT_RESET);
  ex.soemdsp_graph_compile(h);
  const res = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    if (gates.has(f)) ex.soemdsp_graph_set_param(h, SRC, P_OFFSET, gates.get(f));
    ex.soemdsp_graph_process_block(h, 1);
    res[f] = new Float64Array(ex.memory.buffer)[ex.soemdsp_graph_node_port_ptr(h, OUT, PORT_MONO) / 8];
  }
  ex.soemdsp_graph_destroy(h);
  return res;
}
function gatesFor(hits) {
  const g = new Map();
  for (const [frame, height] of hits) { if (!g.has(frame - 1)) g.set(frame - 1, 0); g.set(frame, height); }
  return g;
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const sameBits = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// 480 Hz = 100 samples per fundamental cycle.
const FREQ = 480;
const saw = (extra = []) => [[P_WAVE, 1], [P_STAGES, 16], ...extra];

// ---------------------------------------------------------------- 1. defaults unchanged
{
  const cases = [
    { gen: [[P_WAVE, 0]], out: [[P_FREQ, 100]] },
    { gen: saw(), out: [[P_FREQ, 330]] },
    { gen: [[P_WAVE, 3], [P_SHAPE, 0.3], [P_STAGES, 40]], out: [[P_FREQ, 1234.5]] },
    { gen: [[P_WAVE, 8], [P_PHASE, 0.25]], out: [[P_FREQ, 55]] },
  ];
  let quiet = 0;
  for (const c of cases) {
    const plain = renderAdd(x, { ...c, frames: 2048, blk: 128 });
    const wired = renderAdd(x, { ...c, frames: 2048, blk: 128, reset: true });
    if (sameBits(plain, wired) && peak(plain) > 0) quiet += 1;
  }
  check(quiet === cases.length, `additive: a Reset cable that never fires changes nothing (${quiet}/${cases.length} settings bit-identical, all sounding)`);
  if (baselinePath) {
    const base = await load(baselinePath);
    let same = 0;
    for (const c of cases) {
      for (const port of [PORT_MONO, PORT_LEFT, PORT_RIGHT]) {
        if (sameBits(renderAdd(x, { ...c, frames: 4096, blk: 128, port }), renderAdd(base, { ...c, frames: 4096, blk: 128, port }))) same += 1;
      }
    }
    check(same === cases.length * 3, `additive: default Free run output bit-identical to the baseline build (${same}/${cases.length * 3} settings x ports)`);
    // Full-height Reset hits (the only kind that existed) still zero every partial, bit for bit.
    const hard = { gen: saw(), out: [[P_FREQ, 437.3]], reset: true, gates: gatesFor([[120, 1], [700, 1], [1100, -1]]), frames: 1500 };
    check(sameBits(renderAdd(x, hard), renderAdd(base, hard)), "additive: full-height Reset hits bit-identical to the baseline build");
    const pbCase = { params: [[P_FREQ, 500], [P_WAVE, 3], [P_TIMING, 1]], gates: gatesFor([[50, 1], [400, 1], [450, -0.5]]), frames: 1500 };
    check(sameBits(renderPb(x, pbCase), renderPb(base, pbCase)), "polyblep: Single trigger bit-identical to the baseline build");
  } else {
    console.log("skip  baseline comparison (pass a baseline wasm as the 2nd argument)");
  }
}

// ---------------------------------------------------------------- 2. partial Reset = coherent master-phase move
// After a hard hit at 100 the master phase runs 0.01 per sample, so sample 100+j
// sits at phase j/100. A hit of height h at frame 100+j moves it |h| of the
// shortest way to 0 (h<0 the long way); the whole bank must follow, so the output
// from then on equals the reference shifted to the moved phase.
{
  const ref = renderAdd(x, { gen: saw(), out: [[P_FREQ, FREQ]], reset: true, gates: gatesFor([[100, 1]]), frames: 1400 });
  const cases = [
    { j: 40, h: 0.5, lands: 20, what: "h=0.5 at phase 0.40 -> 0.20" },
    { j: 40, h: -0.5, lands: 70, what: "h=-0.5 at 0.40 -> 0.70 (long way)" },
    { j: 70, h: 0.5, lands: 85, what: "h=0.5 at 0.70 -> 0.85 (shortest way is up)" },
    { j: 60, h: 0.25, lands: 70, what: "h=0.25 at 0.60 -> 0.70" },
  ];
  for (const c of cases) {
    // Gate rises 0 -> 1 at 100 (hard), drops to 0, then rises to h at 100+j.
    const gates = new Map([[99, 0], [100, 1], [101, 0], [100 + c.j, c.h]]);
    const got = renderAdd(x, { gen: saw(), out: [[P_FREQ, FREQ]], reset: true, gates, frames: 1000 });
    const a = got.subarray(100 + c.j, 900);
    const b = ref.subarray(100 + c.lands, 100 + c.lands + a.length);
    const d = maxDiff(a, b);
    check(d < 1e-4 && peak(a) > 0.1, `additive Reset ${c.what}: every partial follows the master phase (worst ${d.toExponential(2)})`);
  }
  // A second shape (Pulse, odd + even partials).
  const refP = renderAdd(x, { gen: [[P_WAVE, 3], [P_SHAPE, 0.3], [P_STAGES, 24]], out: [[P_FREQ, FREQ]], reset: true, gates: gatesFor([[100, 1]]), frames: 1400 });
  const gotP = renderAdd(x, { gen: [[P_WAVE, 3], [P_SHAPE, 0.3], [P_STAGES, 24]], out: [[P_FREQ, FREQ]], reset: true, gates: new Map([[99, 0], [100, 1], [101, 0], [130, 0.5]]), frames: 1000 });
  const dP = maxDiff(gotP.subarray(130, 900), refP.subarray(115, 885));
  check(dP < 1e-4 && peak(gotP.subarray(130, 900)) > 0.05, `additive Reset (Pulse 0.3, 24 partials, peak ${peak(gotP.subarray(130, 900)).toFixed(3)}) h=0.5 at 0.30 -> 0.15 coherent (worst ${dP.toExponential(2)})`);
}

// ---------------------------------------------------------------- 3. hard reset restarts the cycle exactly
{
  const a = renderAdd(x, { gen: saw([[P_PHASE, 0.2]]), out: [[P_FREQ, 300]], reset: true, gates: gatesFor([[200, 1]]), frames: 1200 });
  const b = renderAdd(x, { gen: saw([[P_PHASE, 0.2]]), out: [[P_FREQ, 300]], reset: true, gates: gatesFor([[517, 1]]), frames: 1517 });
  check(maxDiff(a.subarray(200, 1200), b.subarray(517, 1517)) < 1e-9, "additive: after a hard Reset the output is the same whenever the hit came");
}

// ---------------------------------------------------------------- 4. Cycle = Single trigger
{
  const n = Math.ceil((1 - 1e-9) * SR / FREQ);
  const out = [[P_FREQ, FREQ], [P_TIMING, 1]];
  const hits = [[100, 1], [600, 1], [650, 1]]; // third hit retriggers mid-cycle
  const gates = gatesFor(hits);
  const single = renderAdd(x, { gen: saw(), out, reset: true, gates, frames: 1200 });
  const free = renderAdd(x, { gen: saw(), out: [[P_FREQ, FREQ]], reset: true, gates: gatesFor([[100, 1]]), frames: 300 });
  check(single.subarray(0, 100).every((v) => v === 0), "additive Single trigger: silent before the first Reset hit");
  check(sameBits(single.subarray(100, 100 + n), free.subarray(100, 100 + n)) && single.subarray(100 + n, 600).every((v) => v === 0),
    `additive Single trigger: one hit plays exactly one fundamental cycle (${n} samples, same as Free run after a hard Reset) then stays silent`);
  check(single.subarray(650, 650 + n).some((v) => v !== 0) && single.subarray(650 + n).every((v) => v === 0)
    && sameBits(single.subarray(650, 650 + n), single.subarray(100, 100 + n)),
    "additive Single trigger: a hit mid-cycle restarts the cycle from the top");
  // Same gating window as PolyBLEP Single trigger.
  const pb = renderPb(x, { params: [[P_FREQ, FREQ], [P_WAVE, 5], [P_TIMING, 1], [P_PHASE, 0.1]], gates, frames: 1200 });
  const span = (arr) => { const o = []; let on = false; for (let i = 0; i < arr.length; i++) { const now = arr[i] !== 0; if (now !== on) { o.push(i); on = now; } } return o.join(","); };
  // Saw sits at exactly 0 at phase 0; compare windows on a shape that never does (Phase 0.25 = cosine start).
  const singleCos = renderAdd(x, { gen: saw([[P_PHASE, 0.1]]), out, reset: true, gates, frames: 1200 });
  check(span(singleCos) === span(pb), `additive Single trigger: plays on exactly the samples PolyBLEP Single trigger plays (${span(pb)} vs ${span(singleCos)})`);
  // Phases held while stopped: after the cycle (master back at 0) wait a non-whole
  // number of cycles, then a small partial hit (0.3 of ~0 = no move) plays the same
  // cycle again. A free-running phase would have drifted 0.37 cycles.
  const held = renderAdd(x, { gen: saw(), out, reset: true, gates: new Map([[99, 0], [100, 1], [101, 0], [437, 0.3]]), frames: 800 });
  const dh = maxDiff(held.subarray(437, 437 + n - 1), held.subarray(100, 100 + n - 1));
  check(dh < 1e-4 && held.subarray(437 + n).every((v) => v === 0), `additive Single trigger: phases hold while stopped (replay after 3.37 cycles of silence, worst ${dh.toExponential(2)})`);
  // Free run (default) keeps running.
  const fr = renderAdd(x, { gen: saw(), out: [[P_FREQ, FREQ]], reset: true, gates, frames: 1200 });
  check(peak(fr.subarray(0, 100)) > 0.1 && peak(fr.subarray(300, 600)) > 0.1, "additive Free run: plays before and between hits");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;