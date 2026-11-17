// Graph engine regression suite. Runs the real combined wasm headless; no browser.
//
//   node scripts/test_graph_engine.mjs [path/to/soemdsp_combined.wasm]
//
// These are properties, not golden files, so they need no baseline build:
//   1. Order independence: a loop-free patch sounds the same whatever order its
//      modules were created in.
//   2. Feedback order: a node downstream of a feedback loop hears it with no
//      delay, whatever order the nodes were created in.
//   3. In place == rewire: removing or adding a cable or modulation wire by
//      touching only that edge gives the same audio as clearing every
//      connection, re-adding the survivors and recompiling.
//   4. Hard limits are never silent: each one is recorded, compile refuses, and
//      clear recovers; a feedback ring through every node runs.
// Exit code 1 if anything fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = process.argv[2] || path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const mod = await WebAssembly.compile(fs.readFileSync(wasmPath));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) {
  imports[i.module] ??= {};
  imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined;
}
const x = (await WebAssembly.instantiate(mod, imports)).exports;

const SR = 48000;
const BLK = 128;
const SINE = 5; // polyBLEP "Sine" output port
const PORT_F = 16; // frequency CV input port
const OSC = 1, LADDER = 2, CLIP = 3, BIAS = 12; // native node type ids used below

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}
const fresh = () => {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  return h;
};
const mem = () => new Float64Array(x.memory.buffer);
const port = (h, node, p) => {
  const q = x.soemdsp_graph_node_port_ptr(h, node, p) / 8;
  return mem().slice(q, q + BLK);
};
const sameBits = (a, b) => a.every((arr, i) => arr.every((v, k) => Object.is(v, b[i][k]) || (v !== v && b[i][k] !== b[i][k])));
let seed = 1;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const shuffled = (n) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------------------------------------------------------------- 1. order independence
{
  seed = 4242;
  let dependent = 0;
  const graphs = 60;
  for (let g = 0; g < graphs; g++) {
    const n = 4 + Math.floor(rnd() * 9);
    const types = Array.from({ length: n }, () => [OSC, LADDER, CLIP][Math.floor(rnd() * 3)]);
    const edges = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rnd() < 0.3) edges.push([i, j]);
    const mods = edges.filter(() => rnd() < 0.25);
    const run = (order) => {
      const h = fresh();
      order.forEach((rank) => {
        x.soemdsp_graph_add_node(h, 100 + rank, types[rank]);
        if (types[rank] === OSC) x.soemdsp_graph_set_param(h, 100 + rank, 10, 110 + 37 * rank);
      });
      for (const [i, j] of edges) x.soemdsp_graph_connect(h, 100 + i, SINE, 100 + j, 0);
      for (const [i, j] of mods) {
        x.soemdsp_graph_set_param_domain(h, 100 + j, 10, 20, 2000, 0);
        x.soemdsp_graph_add_param_mod_edge(h, 100 + i, 0, 100 + j, 10);
      }
      x.soemdsp_graph_compile(h);
      const out = [];
      for (let b = 0; b < 10; b++) {
        x.soemdsp_graph_process_block(h, BLK);
        for (let r = 0; r < n; r++) out.push(port(h, 100 + r, 0));
      }
      x.soemdsp_graph_destroy(h);
      return out;
    };
    const base = run(Array.from({ length: n }, (_, i) => i));
    for (let t = 0; t < 3; t++) if (!sameBits(base, run(shuffled(n)))) { dependent += 1; break; }
  }
  check(dependent === 0, `order independence: ${graphs} random loop-free patches x 4 creation orders, ${dependent} sounded different`);
}

// ---------------------------------------------------------------- 2. feedback order
{
  // osc -> L1a <-> L1b -> D1 -> L2a <-> L2b -> D2 (two loops in series, each with a downstream node)
  const NODES = { osc: OSC, L1a: LADDER, L1b: CLIP, D1: CLIP, L2a: LADDER, L2b: CLIP, D2: CLIP };
  const keys = Object.keys(NODES);
  const N = BLK * 40;
  // D = f(L) for some monotone f when D hears L with no delay, so D plotted against L is a clean curve.
  // Roughness = how far D wanders between neighbours when sorted by L, at lag 0.
  const roughness = (l, d) => {
    const pts = [];
    for (let i = N / 2; i < N - 4; i++) pts.push([l[i], d[i]]);
    pts.sort((p, q) => p[0] - q[0]);
    let r = 0;
    for (let i = 1; i < pts.length; i++) r += Math.abs(pts[i][1] - pts[i - 1][1]);
    return r / pts.length;
  };
  const run = (order) => {
    const h = fresh();
    const id = {};
    order.forEach((k, i) => { id[k] = 100 + i; x.soemdsp_graph_add_node(h, id[k], NODES[k]); });
    x.soemdsp_graph_set_param(h, id.osc, 10, 220);
    const c = (a, ap, b, bp) => x.soemdsp_graph_connect(h, id[a], ap, id[b], bp);
    c("osc", SINE, "L1a", 0); c("L1a", 0, "L1b", 0); c("L1b", 0, "L1a", 0); c("L1b", 0, "D1", 0);
    c("D1", 0, "L2a", 0); c("L2a", 0, "L2b", 0); c("L2b", 0, "L2a", 0); c("L2b", 0, "D2", 0);
    x.soemdsp_graph_compile(h);
    const rec = { L1b: new Float64Array(N), D1: new Float64Array(N), L2b: new Float64Array(N), D2: new Float64Array(N) };
    for (let b = 0; b < N / BLK; b++) {
      x.soemdsp_graph_process_block(h, BLK);
      for (const k of Object.keys(rec)) rec[k].set(port(h, id[k], 0), b * BLK);
    }
    x.soemdsp_graph_destroy(h);
    return [roughness(rec.L1b, rec.D1), roughness(rec.L2b, rec.D2)];
  };
  seed = 7919;
  const reference = run(keys); // creation order = signal order
  let off = 0;
  const trials = 24;
  for (let t = 0; t < trials; t++) {
    const r = run(shuffled(keys.length).map((i) => keys[i]));
    if (Math.abs(r[0] - reference[0]) > 1e-12 || Math.abs(r[1] - reference[1]) > 1e-12) off += 1;
  }
  check(off === 0, `feedback order: ${trials} random creation orders, ${off} had a downstream node out of step with its loop`);
  // A block of lateness (128 samples) is far rougher than a clean curve.
  check(reference[0] < 0.01 && reference[1] < 0.01, `feedback order: downstream nodes are a clean function of their loop (roughness ${reference[0].toExponential(1)}, ${reference[1].toExponential(1)})`);
}

// ---------------------------------------------------------------- 3. in place == rewire
{
  const scenarios = {
    cableChain:  { nodes: [[1, OSC, 200], [2, LADDER, 800], [3, CLIP, 0]], cables: [[1, SINE, 2, 0], [2, 0, 3, 0]], mods: [], remove: [[2, 0, 3, 0]], add: [] },
    cableFan:    { nodes: [[1, OSC, 200], [2, LADDER, 800], [3, CLIP, 0], [4, OSC, 330]], cables: [[1, SINE, 2, 0], [1, SINE, 3, 0], [4, SINE, 3, 0]], mods: [], remove: [[1, SINE, 3, 0]], add: [] },
    liveCable:   { nodes: [[1, OSC, 4], [2, OSC, 220], [3, LADDER, 900]], cables: [[1, SINE, 2, PORT_F], [2, SINE, 3, 0]], mods: [], remove: [[1, SINE, 2, PORT_F]], add: [] },
    cableLoop:   { nodes: [[1, OSC, 150], [2, LADDER, 700], [3, CLIP, 0]], cables: [[1, SINE, 2, 0], [2, 0, 3, 0], [3, 0, 2, 0]], mods: [], remove: [[3, 0, 2, 0]], add: [] },
    modFan:      { nodes: [[1, OSC, 3], [2, OSC, 220], [3, OSC, 330], [4, OSC, 440]], cables: [], mods: [[1, 2, 10], [1, 3, 10], [1, 4, 10]], remove: [], add: [], removeMods: [[1, 3, 10]] },
    modCycle:    { nodes: [[1, OSC, 90], [2, OSC, 130]], cables: [], mods: [[1, 2, 10], [2, 1, 10]], remove: [], add: [], removeMods: [[2, 1, 10]] },
    addChainEnd: { nodes: [[1, OSC, 200], [2, LADDER, 800], [3, CLIP, 0]], cables: [[1, SINE, 2, 0]], mods: [], remove: [], add: [[2, 0, 3, 0]] },
    addNewNode:  { nodes: [[1, OSC, 200], [2, LADDER, 800]], late: [[3, CLIP, 0]], cables: [[1, SINE, 2, 0]], mods: [], remove: [], add: [[2, 0, 3, 0]] },
    addLoop:     { nodes: [[1, OSC, 150], [2, LADDER, 700], [3, CLIP, 0]], cables: [[1, SINE, 2, 0], [2, 0, 3, 0]], mods: [], remove: [], add: [[3, 0, 2, 0]] },
    addLiveF:    { nodes: [[1, OSC, 4], [2, OSC, 220], [3, LADDER, 900]], cables: [[2, SINE, 3, 0]], mods: [], remove: [], add: [[1, SINE, 2, PORT_F]] },
  };
  const key = (c) => c.join();
  for (const [name, sc] of Object.entries(scenarios)) {
    const late = sc.late || [];
    const hashes = sc.nodes.concat(late).map((n) => n[0]);
    const build = () => {
      const h = fresh();
      for (const [n, t, f] of sc.nodes) { x.soemdsp_graph_add_node(h, n, t); if (f) x.soemdsp_graph_set_param(h, n, 10, f); }
      for (const [s, d, p] of sc.mods) {
        x.soemdsp_graph_set_param_domain(h, d, p, 20, 2000, d % 2 ? 16 : 0);
        x.soemdsp_graph_add_param_mod_edge(h, s, 0, d, p);
      }
      for (const c of sc.cables) x.soemdsp_graph_connect(h, ...c);
      x.soemdsp_graph_compile(h);
      return h;
    };
    const A = build(); // old path: clear, re-add survivors, recompile
    const B = build(); // in place: touch only the changed edges
    let identical = true;
    for (let blk = 0; blk < 200; blk++) {
      if (blk === 80) {
        for (const [n, t, f] of late) for (const h of [A, B]) { x.soemdsp_graph_add_node(h, n, t); if (f) x.soemdsp_graph_set_param(h, n, 10, f); }
        const removeMods = sc.removeMods || [];
        const keepCables = sc.cables.filter((c) => !sc.remove.some((r) => key(r) === key(c))).concat(sc.add);
        const keepMods = sc.mods.filter((m) => !removeMods.some((r) => key(r) === key(m)));
        x.soemdsp_graph_clear_connections(A);
        for (const c of keepCables) x.soemdsp_graph_connect(A, ...c);
        for (const [s, d, p] of keepMods) x.soemdsp_graph_add_param_mod_edge(A, s, 0, d, p);
        x.soemdsp_graph_compile(A);
        let compile = late.length > 0 && false;
        for (const c of sc.remove) x.soemdsp_graph_disconnect(B, ...c);
        for (const [s, d, p] of removeMods) x.soemdsp_graph_disconnect_param_mod(B, s, 0, d, p);
        for (const c of sc.add) { const rc = x.soemdsp_graph_connect_live(B, ...c); if (rc < 0) identical = false; if (rc === 1) compile = true; }
        if (compile) x.soemdsp_graph_compile(B);
      }
      x.soemdsp_graph_process_block(A, BLK);
      x.soemdsp_graph_process_block(B, BLK);
      const active = blk < 80 ? sc.nodes.map((n) => n[0]) : hashes;
      if (!sameBits(active.map((h) => port(A, h, 0)), active.map((h) => port(B, h, 0)))) identical = false;
    }
    x.soemdsp_graph_destroy(A);
    x.soemdsp_graph_destroy(B);
    check(identical, `in place == rewire: ${name}`);
  }
}

// ---------------------------------------------------------------- 4. hard limits are never silent
{
  const limit = (bit) => x.soemdsp_graph_limit(bit);
  const nodesMax = limit(1), connMax = limit(4), modMax = limit(16);
  {
    const h = fresh();
    const rcs = [];
    for (let i = 0; i < nodesMax + 2; i++) rcs.push(x.soemdsp_graph_add_node(h, 1000 + i, BIAS));
    check(rcs.slice(0, nodesMax).every((r) => r === 0) && rcs[nodesMax] === -4, `limits: node ${nodesMax + 1} is refused`);
    check((x.soemdsp_graph_overflow(h) & 1) === 1, "limits: the node overflow is recorded");
    check(x.soemdsp_graph_compile(h) === -10, "limits: compile refuses an overflowed graph");
    check(x.soemdsp_graph_process_block(h, BLK) < 1, "limits: the engine produces nothing while overflowed");
    x.soemdsp_graph_clear(h);
    x.soemdsp_graph_add_node(h, 1, OSC);
    check(x.soemdsp_graph_overflow(h) === 0 && x.soemdsp_graph_compile(h) === 0, "limits: clear recovers once the graph fits");
    x.soemdsp_graph_destroy(h);
  }
  {
    const h = fresh();
    for (let i = 0; i < 4; i++) x.soemdsp_graph_add_node(h, 10 + i, BIAS);
    let last = 0;
    for (let i = 0; i < connMax + 1; i++) last = x.soemdsp_graph_connect(h, 10 + (i % 3), 0, 13, 0);
    check(last === -3 && (x.soemdsp_graph_overflow(h) & 4) === 4 && x.soemdsp_graph_compile(h) === -10, `limits: connection ${connMax + 1} is refused and stops compile`);
    x.soemdsp_graph_destroy(h);
  }
  {
    const h = fresh();
    for (let i = 0; i < 2; i++) x.soemdsp_graph_add_node(h, 10 + i, OSC);
    let last = 0;
    for (let i = 0; i < modMax + 1; i++) last = x.soemdsp_graph_add_param_mod_edge(h, 10, 0, 11, 10);
    check(last === -4 && (x.soemdsp_graph_overflow(h) & 16) === 16 && x.soemdsp_graph_compile(h) === -10, `limits: modulation edge ${modMax + 1} is refused and stops compile`);
    x.soemdsp_graph_destroy(h);
  }
  {
    // Any module type whose own instance pool is smaller than the node cap (found by asking the engine).
    let small = 0;
    for (let t = 1; t < 300 && !small; t++) if (x.soemdsp_graph_type_capacity(t) < nodesMax) small = t;
    if (!small) {
      check(true, "limits: every module type can have as many instances as the node cap (no per-type pool is smaller)");
    } else {
      const h = fresh();
      let n = 0;
      let rc = 0;
      while (n < nodesMax + 2 && (rc = x.soemdsp_graph_add_node(h, 100 + n, small)) === 0) n += 1;
      check(rc === -5 && (x.soemdsp_graph_overflow(h) & 2) === 2 && x.soemdsp_graph_compile(h) === -10, `limits: module type ${small}'s instance pool (${n}) is a loud limit`);
      x.soemdsp_graph_destroy(h);
    }
  }
  {
    const h = fresh();
    for (let i = 0; i < nodesMax; i++) x.soemdsp_graph_add_node(h, 2000 + i, BIAS);
    for (let i = 0; i < connMax; i++) x.soemdsp_graph_connect(h, 2000 + (i % (nodesMax - 1)), 0, 2000 + nodesMax - 1, 0);
    check(x.soemdsp_graph_overflow(h) === 0 && x.soemdsp_graph_compile(h) === 0, `limits: exactly ${nodesMax} nodes and ${connMax} connections is fine`);
    x.soemdsp_graph_destroy(h);
  }
  for (const size of [49, nodesMax]) {
    const h = fresh();
    x.soemdsp_graph_add_node(h, 5000, OSC);
    x.soemdsp_graph_set_param(h, 5000, 10, 220);
    const ring = [];
    for (let i = 0; i < size - 1; i++) { ring.push(6000 + i); x.soemdsp_graph_add_node(h, 6000 + i, BIAS); }
    x.soemdsp_graph_connect(h, 5000, SINE, ring[0], 0);
    for (let i = 0; i + 1 < ring.length; i++) x.soemdsp_graph_connect(h, ring[i], 0, ring[i + 1], 0);
    x.soemdsp_graph_connect(h, ring[ring.length - 1], 0, ring[0], 0);
    const rc = x.soemdsp_graph_compile(h);
    let finite = true;
    let energy = 0;
    for (let b = 0; b < 40; b++) {
      x.soemdsp_graph_process_block(h, BLK);
      for (const v of port(h, ring[ring.length - 1], 0)) { if (!Number.isFinite(v)) finite = false; energy += v * v; }
    }
    check(rc === 0 && finite && energy > 0, `limits: one feedback loop through ${size} nodes compiles and runs`);
    x.soemdsp_graph_destroy(h);
  }
}

// ---------------------------------------------------------------- 5. module identity and latching
{
  // Two module types must never share an engine type id: the second one would silently run the first one's DSP
  // (Amp<->dB and Wavetable 2D both used 180).
  const source = fs.readFileSync(path.join(root, "native_modules", "graph_engine", "graph_engine.cpp"), "utf8");
  const byId = new Map();
  for (const m of source.matchAll(/static const int (kType\w+) = (\d+);/g)) {
    const id = Number(m[2]);
    byId.set(id, (byId.get(id) || []).concat(m[1]));
  }
  const shared = [...byId].filter(([, names]) => names.length > 1);
  check(shared.length === 0, `type ids: every engine module type has its own id${shared.length ? " (shared: " + shared.map(([id, n]) => `${id}=${n.join("/")}`).join(", ") + ")" : ""}`);

  // Amp<->dB runs its own code: its output is a clean function of its input.
  {
    const AMP_DB = 264;
    const N = BLK * 20;
    const h = fresh();
    x.soemdsp_graph_add_node(h, 1, OSC);
    x.soemdsp_graph_set_param(h, 1, 10, 220);
    x.soemdsp_graph_add_node(h, 2, AMP_DB);
    x.soemdsp_graph_connect(h, 1, SINE, 2, 0);
    x.soemdsp_graph_compile(h);
    const inp = new Float64Array(N);
    const out = new Float64Array(N);
    for (let b = 0; b < N / BLK; b++) {
      x.soemdsp_graph_process_block(h, BLK);
      inp.set(port(h, 1, SINE), b * BLK);
      out.set(port(h, 2, 0), b * BLK);
    }
    x.soemdsp_graph_destroy(h);
    const pts = [];
    for (let i = N / 2; i < N; i++) pts.push([inp[i], out[i]]);
    pts.sort((p, q) => p[0] - q[0]);
    let rough = 0;
    let finite = true;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < pts.length; i++) {
      rough += Math.abs(pts[i][1] - pts[i - 1][1]);
      if (!Number.isFinite(pts[i][1])) finite = false;
      lo = Math.min(lo, pts[i][1]);
      hi = Math.max(hi, pts[i][1]);
    }
    // Varies (an engine that does not know the type gives a constant) and is a clean function of the input
    // (the wavetable oscillator it used to run is not).
    check(finite && hi - lo > 0.1 && rough / pts.length < 0.05, `Amp<->dB: its output follows its input (does not run the wavetable code; range ${(hi - lo).toFixed(2)}, roughness ${(rough / pts.length).toExponential(1)})`);
  }

  // Pluck Envelope with Update On Trigger latches Amplitude, like the times, curves and input mode:
  // turning the knob down while an envelope sounds changes nothing until the next trigger.
  {
    const PLUCK = 198, ATT_OFFSET = 71, AMP = 12, TIMING = 54, REL = 55;
    const level = (latch, change) => {
      const h = fresh();
      x.soemdsp_graph_add_node(h, 1, BIAS);
      x.soemdsp_graph_add_node(h, 2, PLUCK);
      x.soemdsp_graph_set_smooth_type(h, 1, ATT_OFFSET, 3); x.soemdsp_graph_set_smooth_time(h, 1, ATT_OFFSET, 0); // gate: instant
      x.soemdsp_graph_set_smooth_type(h, 2, AMP, 3); x.soemdsp_graph_set_smooth_time(h, 2, AMP, 0);               // amplitude: instant, so a step is visible
      x.soemdsp_graph_set_param(h, 2, TIMING, latch ? 1 : 0);
      x.soemdsp_graph_set_param(h, 2, REL, 0.6);
      x.soemdsp_graph_set_param(h, 2, AMP, 1);
      x.soemdsp_graph_connect(h, 1, 0, 2, 0);
      x.soemdsp_graph_compile(h);
      const mean = [];
      for (let b = 0; b < 24; b++) {
        if (b === 5) x.soemdsp_graph_set_param(h, 1, ATT_OFFSET, 1);
        if (b === 12) x.soemdsp_graph_set_param(h, 1, ATT_OFFSET, 0);
        if (b === 20 && change) x.soemdsp_graph_set_param(h, 2, AMP, 0.2);
        x.soemdsp_graph_process_block(h, BLK);
        let sum = 0;
        for (const v of port(h, 2, 0)) sum += Math.abs(v);
        mean.push(sum / BLK);
      }
      x.soemdsp_graph_destroy(h);
      return mean;
    };
    const scale = (latch) => { const a = level(latch, true); const base = level(latch, false); return (a[20] / a[19]) / (base[20] / base[19]); };
    const on = scale(true);
    const off = scale(false);
    check(Math.abs(on - 1) < 0.05, `pluck envelope: Update On Trigger latches Amplitude (knob 1.0 -> 0.2 mid-envelope scaled it x${on.toFixed(2)}, expected x1.00)`);
    check(Math.abs(off - 0.2) < 0.05, `pluck envelope: without Update On Trigger the knob is live (x${off.toFixed(2)}, expected x0.20)`);
  }
}

// ---------------------------------------------------------------- 5a. Comb Pluck / Mode Resonator / Comb Resonator
// docs/COMB_PLUCK_PLAN.md: Comb Pluck and Mode Resonator fire the shared exciter on a Trigger
// rising edge (> 0.5, re-arm < 0.4, height = velocity); Comb Resonator is a strict effect.
{
  const COMB = 66, MODE = 67, CPLUCK = 266, ATT_OFFSET = 71;
  const P_FREQ = 10, P_SHAPE_SEL = 11, P_AMP = 12, P_DAMP = 13, P_RETRIG = 21, P_DECAY = 52;
  const PORT_TRIG = 20, PORT_PEAK = 3, PORT_VEL = 4, PORT_HITS = 5, PORT_ELAPSED = 10;
  // gates: [[block, level], ...] on a Bias into the chosen input port of node 2.
  const run = (type, gates, { blocks = 60, inPort = PORT_TRIG, params = [] } = {}) => {
    const h = fresh();
    x.soemdsp_graph_add_node(h, 1, BIAS);
    x.soemdsp_graph_add_node(h, 2, type);
    x.soemdsp_graph_set_smooth_type(h, 1, ATT_OFFSET, 3); x.soemdsp_graph_set_smooth_time(h, 1, ATT_OFFSET, 0);
    for (const [k, v] of params) x.soemdsp_graph_set_param(h, 2, k, v);
    x.soemdsp_graph_connect(h, 1, 0, 2, inPort);
    x.soemdsp_graph_compile(h);
    let peak = 0;
    const last = {};
    for (let b = 0; b < blocks; b++) {
      for (const [gb, lv] of gates) if (gb === b) x.soemdsp_graph_set_param(h, 1, ATT_OFFSET, lv);
      x.soemdsp_graph_process_block(h, BLK);
      for (const v of port(h, 2, 0)) peak = Math.max(peak, Math.abs(v));
      if (type !== COMB) {
        last.hits = port(h, 2, PORT_HITS)[BLK - 1];
        last.vel = port(h, 2, PORT_VEL)[BLK - 1];
        last.elapsed = port(h, 2, PORT_ELAPSED)[BLK - 1];
        last.tapPeak = port(h, 2, PORT_PEAK)[BLK - 1];
      }
    }
    x.soemdsp_graph_destroy(h);
    return { peak, ...last };
  };
  const held = [[5, 1], [40, 0]];
  const cp = run(CPLUCK, held);
  check(cp.hits === 1 && cp.peak > 0.9 && cp.peak < 1.1, `comb pluck: a held gate fires one hit (hits ${cp.hits}, peak ${cp.peak.toFixed(3)}, expected 1 and about 1)`);
  const elapsedWant = (60 - 5) * BLK / SR;
  check(Math.abs(cp.elapsed - elapsedWant) < 2 * BLK / SR, `comb pluck: __Elapsed counts from the edge (${cp.elapsed.toFixed(4)} s, expected about ${elapsedWant.toFixed(4)})`);
  const soft = run(CPLUCK, [[5, 0.7], [40, 0]]);
  check(Math.abs(soft.peak - 0.7) < 0.08 && Math.abs(soft.vel - 0.7) < 0.01, `comb pluck: trigger height is velocity (peak ${soft.peak.toFixed(3)}, __Vel ${soft.vel.toFixed(3)}, expected 0.7)`);
  const hyst = run(CPLUCK, [[5, 1], [15, 0.45], [25, 1], [35, 0.3], [45, 1]]);
  check(hyst.hits === 2, `comb pluck: re-arms only below 0.4 (dip to 0.45 then 0.3 gave ${hyst.hits} hits, expected 2)`);
  const lvl = run(CPLUCK, held, { params: [[P_AMP, 0.5]] });
  check(Math.abs(lvl.peak - 0.5) < 0.06, `comb pluck: Level 0.5 peaks at ${lvl.peak.toFixed(3)} (expected about 0.5)`);
  const choke = run(CPLUCK, [[5, 1], [10, 0], [12, 1]], { params: [[P_RETRIG, 1], [P_DECAY, 4]] });
  const stack = run(CPLUCK, [[5, 1], [10, 0], [12, 1]], { params: [[P_RETRIG, 0], [P_DECAY, 4]] });
  check(choke.hits === 2 && stack.hits === 2 && stack.peak > choke.peak, `comb pluck: Stack adds into the ring (peak ${stack.peak.toFixed(3)}), Choke restarts it (peak ${choke.peak.toFixed(3)})`);
  let shapesOk = true;
  for (let s = 0; s < 4; s++) {
    const r = run(CPLUCK, held, { params: [[P_SHAPE_SEL, s], [P_DAMP, 0.4], [P_FREQ, 220]] });
    if (!(r.hits === 1 && r.peak > 0.5 && r.peak < 1.3)) shapesOk = false;
  }
  check(shapesOk, "comb pluck: every Shape (Bump / Triangle / Saw / Noise) rings once near full level");
  // The ring decays at Decay (1/e per Decay seconds): about 0.37 of the hit 1 s after it.
  const ringAt = (type) => {
    const h = fresh();
    x.soemdsp_graph_add_node(h, 1, BIAS);
    x.soemdsp_graph_add_node(h, 2, type);
    x.soemdsp_graph_set_smooth_type(h, 1, ATT_OFFSET, 3); x.soemdsp_graph_set_smooth_time(h, 1, ATT_OFFSET, 0);
    x.soemdsp_graph_connect(h, 1, 0, 2, PORT_TRIG);
    x.soemdsp_graph_compile(h);
    const blocksPerSec = Math.round(SR / BLK);
    let first = 0, later = 0;
    for (let b = 0; b < blocksPerSec + 8; b++) {
      if (b === 2) x.soemdsp_graph_set_param(h, 1, ATT_OFFSET, 1);
      x.soemdsp_graph_process_block(h, BLK);
      let pk = 0;
      for (const v of port(h, 2, 0)) pk = Math.max(pk, Math.abs(v));
      if (b >= 2 && b < 6) first = Math.max(first, pk);
      if (b >= blocksPerSec + 2 - 4 && b < blocksPerSec + 2 + 4) later = Math.max(later, pk);
    }
    x.soemdsp_graph_destroy(h);
    return later / first;
  };
  const cpRing = ringAt(CPLUCK);
  const mdRing = ringAt(MODE);
  check(cpRing > 0.25 && cpRing < 0.45 && mdRing > 0.3 && mdRing < 0.45, `comb pluck / mode resonator: 1 s after a hit with Decay 1 s the ring is at ${cpRing.toFixed(3)} / ${mdRing.toFixed(3)} of its start (expected about 0.37)`);
  const md = run(MODE, held);
  check(md.hits === 1 && md.peak > 0.85 && md.peak <= 1.0, `mode resonator: a held gate fires one hit (hits ${md.hits}, peak ${md.peak.toFixed(3)})`);
  const mdAudio = run(MODE, [[5, 1]], { inPort: 0 });
  check(mdAudio.peak === 0, `mode resonator: strictly triggered, audio on the old In port does nothing (peak ${mdAudio.peak})`);
  const combTrig = run(COMB, held);
  check(combTrig.peak === 0, `comb resonator: strict effect, Trigger no longer feeds the comb (peak ${combTrig.peak})`);
  const combIn = run(COMB, [[5, 1], [6, 0]], { inPort: 0 });
  check(combIn.peak > 0.5, `comb resonator: audio In still rings the comb (peak ${combIn.peak.toFixed(3)})`);
}

// ---------------------------------------------------------------- 5b. RMS Meter (stereo in, one set of outs)
{
  const RMS = 227;
  const P_AMPLITUDE = 12, P_ATTACK = 53, P_RELEASE = 31, P_THRESHOLD = 80;
  const MONO = 0, SAW = 3, SQUARE = 5; // RMS, dB, Gate
  const run = (setup, blocks = 400) => {
    const h = fresh();
    x.soemdsp_graph_add_node(h, 1, OSC); x.soemdsp_graph_set_param(h, 1, 10, 220); x.soemdsp_graph_set_param(h, 1, P_AMPLITUDE, 1);
    x.soemdsp_graph_add_node(h, 2, RMS);
    x.soemdsp_graph_set_param(h, 2, P_ATTACK, 50); x.soemdsp_graph_set_param(h, 2, P_RELEASE, 50);
    setup(h);
    x.soemdsp_graph_compile(h);
    let sumSq = 0, n = 0;
    for (let b = 0; b < blocks; b++) {
      x.soemdsp_graph_process_block(h, BLK);
      if (b >= blocks - 100) for (const v of port(h, 1, SINE)) { sumSq += v * v; n += 1; }
    }
    const last = (p) => port(h, 2, p)[BLK - 1];
    const out = { truth: Math.sqrt(sumSq / n), rms: last(MONO), db: last(SAW), gate: last(SQUARE) };
    x.soemdsp_graph_destroy(h);
    return out;
  };
  // Mono (Left only): the meter agrees with the sine's true RMS.
  const mono = run((h) => x.soemdsp_graph_connect(h, 1, SINE, 2, 0));
  check(Math.abs(mono.rms - mono.truth) < 0.02 * mono.truth && Math.abs(mono.db - 20 * Math.log10(mono.truth)) < 0.2, `rms meter: sine reads ${mono.rms.toFixed(3)} RMS / ${mono.db.toFixed(2)} dB (true ${mono.truth.toFixed(3)})`);
  // Stereo = average of the channel powers: the same sine on both sides reads the same as one side; sine + silence reads 1/sqrt(2) of it.
  const both = run((h) => { x.soemdsp_graph_connect(h, 1, SINE, 2, 0); x.soemdsp_graph_connect(h, 1, SINE, 2, 2); });
  check(Math.abs(both.rms - mono.rms) < 0.02 * mono.rms, `rms meter: the same signal on Left and Right reads ${both.rms.toFixed(3)} (one side ${mono.rms.toFixed(3)})`);
  const half = run((h) => { x.soemdsp_graph_add_node(h, 3, CLIP); x.soemdsp_graph_connect(h, 1, SINE, 2, 0); x.soemdsp_graph_connect(h, 3, SINE, 2, 2); });
  check(Math.abs(half.rms - mono.rms / Math.SQRT2) < 0.02 * mono.rms, `rms meter: Left sine, Right silent reads ${half.rms.toFixed(3)} (1/sqrt 2 of ${mono.rms.toFixed(3)})`);
  // Gate: threshold below the level = 1, above = 0.
  const level = mono.db;
  const gateOn = run((h) => { x.soemdsp_graph_connect(h, 1, SINE, 2, 0); x.soemdsp_graph_set_param(h, 2, P_THRESHOLD, level - 6); });
  const gateOff = run((h) => { x.soemdsp_graph_connect(h, 1, SINE, 2, 0); x.soemdsp_graph_set_param(h, 2, P_THRESHOLD, level + 3); });
  check(gateOn.gate === 1 && gateOff.gate === 0, `rms meter: Gate is ${gateOn.gate} 6 dB under the level and ${gateOff.gate} 3 dB over it`);
  check(x.soemdsp_graph_type_capacity(RMS) === x.soemdsp_graph_limit(1), "rms meter: holds the node cap of instances");
}

// ---------------------------------------------------------------- 5c. Hyperbolic Decay (attack, speed is a rate)
{
  const HYP = 209;
  const P_SHAPE = 13, P_MODE = 21, P_ATT = 52, P_DEC = 53, P_OFFSET = 71, P_ATTSHAPE = 80;
  const OUT = 0, POS = 10;
  // A Bias node is the trigger: its offset goes 0 -> 1 at block 40. Returns per-block { out (last sample), pos }.
  const run = (setup, seconds, atBlock = null) => {
    const h = fresh();
    x.soemdsp_graph_add_node(h, 1, BIAS);
    x.soemdsp_graph_set_smooth_mode(h, 1, P_OFFSET, 3); // a step, not a ramp (every rising sample is a hit)
    x.soemdsp_graph_add_node(h, 2, HYP);
    x.soemdsp_graph_connect(h, 1, 0, 2, 0);
    x.soemdsp_graph_set_param(h, 2, P_SHAPE, 0);
    x.soemdsp_graph_set_param(h, 2, P_MODE, 0); // Free: live Decay
    setup(h);
    x.soemdsp_graph_compile(h);
    const blocks = Math.ceil((seconds * SR) / BLK);
    const rows = [];
    for (let b = 0; b < blocks; b++) {
      if (b === 40) x.soemdsp_graph_set_param(h, 1, P_OFFSET, 1); // after the param glides have settled
      if (atBlock && b === atBlock.block) atBlock.fn(h);
      x.soemdsp_graph_process_block(h, BLK);
      const o = port(h, 2, OUT);
      let peak = 0;
      for (const v of o) peak = Math.max(peak, v);
      rows.push({ out: o[BLK - 1], peak, pos: port(h, 2, POS)[BLK - 1] });
    }
    x.soemdsp_graph_destroy(h);
    return rows;
  };
  const startBlock = (rows) => rows.findIndex((r) => r.peak > 1e-4);
  const endBlock = (rows, from) => { for (let i = rows.length - 1; i > from; i--) if (rows[i].peak > 1e-4) return i; return -1; };
  const sec = (blocks) => (blocks * BLK) / SR;

  // 1. No attack: the first sample is the trigger height.
  const plain = run((h) => { x.soemdsp_graph_set_param(h, 2, P_DEC, 1); x.soemdsp_graph_set_param(h, 2, P_ATT, 0); }, 2);
  const s0 = startBlock(plain);
  check(s0 > 0 && plain[s0].peak > 0.9, `hyperbolic: with Attack 0 the envelope starts at the trigger height (${plain[s0]?.peak.toFixed(3)})`);

  // 2. Attack 0.5 s: it rises from near zero to the height at the end of the attack, then decays.
  const att = run((h) => { x.soemdsp_graph_set_param(h, 2, P_DEC, 1); x.soemdsp_graph_set_param(h, 2, P_ATT, 0.5); }, 2.5);
  const a0 = startBlock(att);
  let peakAt = att.findIndex((r, i) => i >= a0 && r.peak > 0.99);
  check(att[a0].peak < 0.05 && peakAt > a0 && Math.abs(sec(peakAt - a0) - 0.5) < 0.03,
    `hyperbolic: Attack 0.5 s rises from ${att[a0].peak.toFixed(3)} to ${att[peakAt]?.peak.toFixed(3)} peaking ${sec(peakAt - a0).toFixed(2)} s after the start`);
  check(att[a0 + 3].pos >= 0 && att[a0 + 3].pos < 1 && att[peakAt + 20].pos > 1, "hyperbolic: position reads 0..1 in the attack and 1..2 in the decay");

  // 2b. The attack is the decay run backwards: the same time and shape on both sides are symmetrical about the peak.
  {
    const h = fresh();
    x.soemdsp_graph_add_node(h, 1, BIAS);
    x.soemdsp_graph_set_smooth_mode(h, 1, P_OFFSET, 3);
    x.soemdsp_graph_add_node(h, 2, HYP);
    x.soemdsp_graph_connect(h, 1, 0, 2, 0);
    for (const [id, v] of [[P_MODE, 0], [P_ATT, 1], [P_DEC, 1], [P_SHAPE, 1.5], [P_ATTSHAPE, 1.5]]) x.soemdsp_graph_set_param(h, 2, id, v);
    x.soemdsp_graph_compile(h);
    const series = [];
    const blocks = Math.ceil((2.6 * SR) / BLK);
    for (let b = 0; b < blocks; b++) {
      if (b === 40) x.soemdsp_graph_set_param(h, 1, P_OFFSET, 1);
      x.soemdsp_graph_process_block(h, BLK);
      for (const v of port(h, 2, OUT)) series.push(v);
    }
    x.soemdsp_graph_destroy(h);
    const first = series.findIndex((v) => v > 1e-4);
    let peak = first;
    for (let i = first; i < series.length; i++) if (series[i] > series[peak]) peak = i;
    let worst = 0;
    for (const k of [20000, 10000, 5000]) {
      const l = series[peak - k], r = series[peak + k];
      worst = Math.max(worst, Math.abs(l - r) / Math.max(l, r));
    }
    check(worst < 0.05, `hyperbolic: same Attack, Decay and shape (1 s, w 1.5) are symmetrical about the peak (worst difference ${(worst * 100).toFixed(2)}%)`);
  }

  // 3. Speed is a rate: halfway through a 2 s decay, set Decay to 4 s. It finishes 3 s after the start (not 4).
  const base = run((h) => { x.soemdsp_graph_set_param(h, 2, P_DEC, 2); x.soemdsp_graph_set_param(h, 2, P_ATT, 0); }, 5);
  const bs = startBlock(base);
  const sw = bs + Math.round((1.0 * SR) / BLK);
  const slow = run((h) => { x.soemdsp_graph_set_param(h, 2, P_DEC, 2); x.soemdsp_graph_set_param(h, 2, P_ATT, 0); }, 6, { block: sw, fn: (h) => x.soemdsp_graph_set_param(h, 2, P_DEC, 4) });
  const sStart = startBlock(slow);
  const sEnd = endBlock(slow, sStart);
  const finishes = sec(sEnd - sStart);
  check(Math.abs(finishes - 3.0) < 0.1 && Math.abs(sec(endBlock(base, bs) - bs) - 2.0) < 0.1,
    `hyperbolic: doubling Decay halfway finishes at ${finishes.toFixed(2)} s (expected 3.0; plain 2 s decay ends at ${sec(endBlock(base, bs) - bs).toFixed(2)} s)`);
}

// ---------------------------------------------------------------- 5d. Ellipsoid AD (attack, morphs, speed is a rate)
{
  const ELL = 212;
  const P_MORPH = 13, P_MODE = 21, P_ATT = 52, P_DEC = 53, P_OFFSET = 71, P_ATTMORPH = 80, P_DECMORPH = 81;
  const OUT = 0, POS = 10;
  // Returns every output sample. A Bias node is the trigger (offset 0 -> 1 at block 40, after param glides settle).
  const run = (params, seconds, change = null) => {
    const h = fresh();
    x.soemdsp_graph_add_node(h, 1, BIAS);
    x.soemdsp_graph_set_smooth_mode(h, 1, P_OFFSET, 3);
    x.soemdsp_graph_add_node(h, 2, ELL);
    x.soemdsp_graph_connect(h, 1, 0, 2, 0);
    x.soemdsp_graph_set_param(h, 2, P_MODE, 0);
    x.soemdsp_graph_set_param(h, 2, P_ATTMORPH, 0); // engine defaults for these slots are not 0; the page pushes 0
    x.soemdsp_graph_set_param(h, 2, P_DECMORPH, 0);
    for (const [id, v] of Object.entries(params)) x.soemdsp_graph_set_param(h, 2, Number(id), v);
    x.soemdsp_graph_compile(h);
    const series = [], pos = [];
    const blocks = Math.ceil((seconds * SR) / BLK);
    for (let b = 0; b < blocks; b++) {
      if (b === 40) x.soemdsp_graph_set_param(h, 1, P_OFFSET, 1);
      if (change && b === change.block) x.soemdsp_graph_set_param(h, 2, change.id, change.value);
      x.soemdsp_graph_process_block(h, BLK);
      for (const v of port(h, 2, OUT)) series.push(v);
      pos.push(port(h, 2, POS)[BLK - 1]);
    }
    x.soemdsp_graph_destroy(h);
    return { series, pos };
  };
  const first = (r) => r.series.findIndex((v) => v > 1e-4);
  const last = (r) => { for (let i = r.series.length - 1; i > 0; i--) if (r.series[i] > 1e-4) return i; return -1; };

  const plain = run({ [P_DEC]: 1, [P_ATT]: 0, [P_MORPH]: 0 }, 2);
  check(plain.series[first(plain)] > 0.99, `ellipsoid: with Attack 0 it starts at the trigger height (${plain.series[first(plain)].toFixed(3)})`);

  const att = run({ [P_DEC]: 1, [P_ATT]: 0.5, [P_MORPH]: 0 }, 2.5);
  const a0 = first(att);
  const peakAt = att.series.findIndex((v, i) => i >= a0 && v > 0.999);
  check(att.series[a0] < 0.05 && peakAt > a0 && Math.abs((peakAt - a0) / SR - 0.5) < 0.03,
    `ellipsoid: Attack 0.5 s rises from ${att.series[a0].toFixed(3)} to the height at ${((peakAt - a0) / SR).toFixed(2)} s`);

  // Morph moves both sides; AtkMrph / DecMrph are trims. Morph 0.5 = trim 0.5 on a Morph 0 module.
  const viaMorph = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: 0.5 }, 3);
  const viaTrims = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: 0, [P_ATTMORPH]: 0.5, [P_DECMORPH]: 0.5 }, 3);
  const n = Math.min(viaMorph.series.length, viaTrims.series.length);
  let dm = 0;
  for (let i = 0; i < n; i += 97) dm = Math.max(dm, Math.abs(viaMorph.series[i] - viaTrims.series[i]));
  check(dm < 1e-6, `ellipsoid: Morph 0.5 and both trims at 0.5 give the same envelope (max difference ${dm.toExponential(1)})`);
  const circle = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: 0 }, 3);
  let dc = 0;
  for (let i = 0; i < n; i += 97) dc = Math.max(dc, Math.abs(viaMorph.series[i] - circle.series[i]));
  check(dc > 0.05, `ellipsoid: Morph 0.5 changes the curve (max difference from Morph 0 is ${dc.toFixed(2)})`);

  // The trims use the remaining room: Morph 0.6 with both trims +1 is Morph +1, with -1 it is Morph -1.
  const sq = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: 1 }, 3);
  const late = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: -1 }, 3);
  const trimUp = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: 0.6, [P_ATTMORPH]: 1, [P_DECMORPH]: 1 }, 3);
  const trimDown = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: 0.6, [P_ATTMORPH]: -1, [P_DECMORPH]: -1 }, 3);
  let du = 0, dd = 0;
  for (let i = 0; i < n; i += 97) { du = Math.max(du, Math.abs(sq.series[i] - trimUp.series[i])); dd = Math.max(dd, Math.abs(late.series[i] - trimDown.series[i])); }
  check(du < 1e-6 && dd < 1e-6, `ellipsoid: with Morph 0.6, trims +1 reach Morph +1 and -1 reach Morph -1 (differences ${du.toExponential(1)}, ${dd.toExponential(1)})`);
  // Morph -1 is a late drop: a decay of 1 s is still near the height halfway; Morph +1 has already dropped.
  const lateDecay = run({ [P_DEC]: 1, [P_ATT]: 0, [P_MORPH]: -1 }, 2);
  const earlyDecay = run({ [P_DEC]: 1, [P_ATT]: 0, [P_MORPH]: 1 }, 2);
  const f0 = first(lateDecay), mid = Math.round(0.5 * SR);
  check(lateDecay.series[f0 + mid] > 0.9 && earlyDecay.series[first(earlyDecay) + mid] < 0.05,
    `ellipsoid: halfway through the decay Morph -1 is at ${lateDecay.series[f0 + mid].toFixed(2)} (late drop) and Morph +1 at ${earlyDecay.series[first(earlyDecay) + mid].toFixed(3)} (early drop)`);

  // Both orientations on the attack: at a quarter of a 1 s attack the level is 0.25 for a ramp (Morph 0),
  // 1 - cos(pi/8) = 0.076 for Morph +0.5 (slow up) and sin(pi/8) = 0.383 for Morph -0.5 (fast up).
  const quarter = (m) => {
    const r = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: m }, 2.5);
    return r.series[first(r) + Math.round(0.25 * SR)];
  };
  const qRamp = quarter(0), qSlow = quarter(0.5), qFast = quarter(-0.5);
  check(Math.abs(qRamp - 0.25) < 0.01 && Math.abs(qSlow - 0.0761) < 0.01 && Math.abs(qFast - 0.3827) < 0.01,
    `ellipsoid: attack at a quarter: ramp ${qRamp.toFixed(3)} (0.25), Morph +0.5 slow up ${qSlow.toFixed(3)} (0.076), Morph -0.5 fast up ${qFast.toFixed(3)} (0.383)`);

  // Equal Attack, Decay and Morph are symmetrical about the peak.
  const sym = run({ [P_DEC]: 1, [P_ATT]: 1, [P_MORPH]: 0.4 }, 2.6);
  const s0 = first(sym);
  let sp = s0;
  for (let i = s0; i < sym.series.length; i++) if (sym.series[i] > sym.series[sp]) sp = i;
  let worst = 0;
  for (const k of [20000, 10000, 5000]) {
    const l = sym.series[sp - k], r = sym.series[sp + k];
    worst = Math.max(worst, Math.abs(l - r) / Math.max(l, r));
  }
  check(worst < 0.05, `ellipsoid: equal Attack, Decay and Morph are symmetrical about the peak (worst difference ${(worst * 100).toFixed(2)}%)`);

  // Speed is a rate: halfway through a 2 s decay, set Decay to 4 s: it finishes 3 s after the start (not 4).
  const base = run({ [P_DEC]: 2, [P_ATT]: 0, [P_MORPH]: 0 }, 5);
  const slow = run({ [P_DEC]: 2, [P_ATT]: 0, [P_MORPH]: 0 }, 6, { block: 40 + Math.round(SR / BLK), id: P_DEC, value: 4 });
  const baseLen = (last(base) - first(base)) / SR;
  const slowLen = (last(slow) - first(slow)) / SR;
  check(Math.abs(baseLen - 2) < 0.1 && Math.abs(slowLen - 3) < 0.1, `ellipsoid: doubling Decay halfway finishes at ${slowLen.toFixed(2)} s (expected 3.0; plain 2 s decay ends at ${baseLen.toFixed(2)} s)`);
}

// ---------------------------------------------------------------- 6. limits the console prints
{
  check(x.soemdsp_graph_limit(32) === 12, `limits: ${x.soemdsp_graph_limit(32)} channel slots per module (the startup print reports this)`);
  const h = fresh();
  for (let i = 0; i < 10; i++) x.soemdsp_graph_add_node(h, 100 + i, CLIP);
  const capacity = x.soemdsp_graph_type_capacity(CLIP);
  const nodesCap = x.soemdsp_graph_limit(1);
  let more = 0;
  while (x.soemdsp_graph_add_node(h, 200 + more, CLIP) === 0) more += 1;
  check(capacity === 10 + more && capacity >= nodesCap, `limits: type capacity counts slots in use plus free (soft clipper ${capacity}; 10 in use, ${more} more fit), and asking changes nothing`);
  x.soemdsp_graph_destroy(h);
  check(x.soemdsp_graph_type_capacity(BIAS) === x.soemdsp_graph_limit(1), "limits: a module with no native instance is limited only by the node count");
}

// ---------------------------------------------------------------- 7. shared memory pool
{
  const VELVET = 265; // Velvet Reverb: ~8.8 MB of buffers per instance, taken from the pool
  check(x.soemdsp_graph_type_uses_pool(VELVET) === 1 && x.soemdsp_graph_type_uses_pool(263) === 1 && x.soemdsp_graph_type_uses_pool(CLIP) === 0, "pool: Velvet Noise and Velvet Reverb are pool modules, Soft Clipper is not");
  const before = x.soemdsp_memory_stat(0);
  const cap = x.soemdsp_graph_type_capacity(VELVET);
  check(cap === x.soemdsp_graph_limit(1) && x.soemdsp_memory_stat(0) === before, `pool: capacity of a pool module is the node count (${cap}) and asking allocates nothing`);
  const h = fresh();
  for (let i = 0; i < 3; i++) x.soemdsp_graph_add_node(h, 300 + i, VELVET);
  const used = x.soemdsp_memory_stat(0) - before;
  check(used > 20e6 && used < 30e6, `pool: 3 Velvet Reverb instances took ${(used / 1048576).toFixed(1)} MB`);
  x.soemdsp_graph_destroy(h);
  const committed = x.soemdsp_memory_stat(1);
  const h2 = fresh();
  for (let i = 0; i < 3; i++) x.soemdsp_graph_add_node(h2, 300 + i, VELVET);
  check(x.soemdsp_memory_stat(1) === committed, "pool: a destroyed graph's blocks are reused, memory does not keep growing");
  x.soemdsp_graph_destroy(h2);
  // Budget: loud failure, not a silent one.
  x.soemdsp_memory_set_budget_mb(Math.ceil(x.soemdsp_memory_stat(0) / 1048576) + 12);
  const h3 = fresh();
  const rcs = [0, 1, 2].map((i) => x.soemdsp_graph_add_node(h3, 400 + i, VELVET));
  check(rcs[0] === 0 && rcs[2] === -5 && (x.soemdsp_graph_overflow(h3) & 256) === 256, `pool: past the memory budget add_node fails (${rcs.join(",")}) and records the memory overflow`);
  check(x.soemdsp_graph_compile(h3) === -10, "pool: compile refuses while out of memory");
  x.soemdsp_graph_destroy(h3);
  x.soemdsp_memory_set_budget_mb(0);
  // Every module type holds as many instances as the node count; heavy ones are limited by memory only.
  const under = [];
  for (let t = 1; t < 300; t++) if (x.soemdsp_graph_type_capacity(t) < x.soemdsp_graph_limit(1)) under.push(t);
  check(under.length === 0, `limits: every module type holds ${x.soemdsp_graph_limit(1)} instances (types under: ${under.join(",") || "none"})`);
  // A different-sized module reuses released space instead of growing memory (blocks split and merge).
  const SABRINA = 215; // ~10.7 MB each, after Velvet's ~8.8 MB
  const hv = fresh();
  for (let i = 0; i < 4; i++) x.soemdsp_graph_add_node(hv, 500 + i, VELVET);
  x.soemdsp_graph_destroy(hv);
  const grown = x.soemdsp_memory_stat(1);
  const hs = fresh();
  for (let i = 0; i < 3; i++) x.soemdsp_graph_add_node(hs, 600 + i, SABRINA);
  check(x.soemdsp_memory_stat(1) === grown, "pool: freed blocks are split and reused by a different module, memory does not grow");
  x.soemdsp_graph_destroy(hs);
  check(x.soemdsp_memory_stat(0) === before, "pool: everything is given back when the graphs are destroyed");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll graph engine checks passed");
process.exit(failures ? 1 : 0);
