// Spectral Oscillator: exact shapes (incl. Asym Sine, Glass, Bell), Gibbs control,
// no overshoot at Gibbs 0, monotone Center Edge ramps, Sine max = pure sine,
// alias-free table choice (3 tables per octave, every partial below Nyquist),
// rebuild crossfade, Cycle / Reset trigger, CPU and memory.
// Runs the real combined wasm headless; no browser.
//
//   node scripts/test_spectral_osc.mjs [path/to/soemdsp_combined.wasm] [path/to/baseline.wasm]
//
// With a baseline wasm (an earlier build) the alias measurement is printed for it
// too ("before"). Exit code 1 if anything fails.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
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

// JS twin (the face's bake).
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "public", "modules", "spectralOsc", "spectral-osc-math.js"), "utf8")
    + "\nthis.M = { SPECTRAL_OSC_SHAPES, SPECTRAL_OSC_TABLE_K, spectralOscShapeCoef, spectralOscSpectrum, spectralOscHarmonics, spectralOscCycle, spectralOscDc, spectralOscBakeCycle, spectralOscGain, spectralOscTaper, spectralOscFft, spectralOscAsymValue, spectralOscAsymSkewK };",
  ctx,
);
const M = ctx.M;

const SR = 48000;
const SPECTRAL = 180, BIAS = 12;
const P_FREQ = 10, P_WAVE = 11, P_AMP = 12, P_SHAPE = 13, P_PHASE = 14, P_RES = 20, P_WIDTH = 31, P_TIMING = 54, P_OFFSET = 71;
const PORT_MONO = 0, PORT_SAW = 3, PORT_RESET = 19;

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const peakOf = (a) => { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; };
const dB = (v) => (v > 0 ? 20 * Math.log10(v) : -400);

// ---- graph helpers -------------------------------------------------------
function makeGraph({ shape = 0, A = 0.5, B = 0, G = 0, freq = 220, amp = 1, cycle = 0, reset = false } = {}, ex = x) {
  const h = ex.soemdsp_graph_create();
  ex.soemdsp_graph_set_sample_rate(h, SR);
  if (reset) {
    ex.soemdsp_graph_add_node(h, 1, BIAS);
    ex.soemdsp_graph_set_smooth_type(h, 1, P_OFFSET, 3);
    ex.soemdsp_graph_set_smooth_time(h, 1, P_OFFSET, 0);
  }
  ex.soemdsp_graph_add_node(h, 2, SPECTRAL);
  for (const k of [P_FREQ, P_WAVE, P_AMP, P_SHAPE, P_PHASE, P_RES, P_WIDTH, P_TIMING]) {
    ex.soemdsp_graph_set_smooth_type(h, 2, k, 3);
    ex.soemdsp_graph_set_smooth_time(h, 2, k, 0);
  }
  const set = (k, v) => ex.soemdsp_graph_set_param(h, 2, k, v);
  set(P_WAVE, shape); set(P_SHAPE, A); set(P_RES, B); set(P_WIDTH, G); set(P_FREQ, freq); set(P_AMP, amp); set(P_TIMING, cycle);
  if (reset) ex.soemdsp_graph_connect(h, 1, PORT_MONO, 2, PORT_RESET);
  ex.soemdsp_graph_compile(h);
  return { h, ex, set, handle: () => ex.soemdsp_graph_node_native_handle(h, 2) };
}
function run(g, frames, blk = 128, port = PORT_MONO, onBlock = null) {
  const ex = g.ex;
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += blk) {
    if (onBlock) onBlock(f);
    const n = Math.min(blk, frames - f);
    ex.soemdsp_graph_process_block(g.h, n);
    const q = ex.soemdsp_graph_node_port_ptr(g.h, 2, port) / 8;
    out.set(new Float64Array(ex.memory.buffer).subarray(q, q + n), f);
  }
  return out;
}
const TABLES = x.soemdsp_spectral_osc_table_count();
const KS = Array.from({ length: TABLES }, (_, j) => x.soemdsp_spectral_osc_table_harmonics(j));
const LENS = Array.from({ length: TABLES }, (_, j) => x.soemdsp_spectral_osc_table_len(j));
function tables(g) {
  const hd = g.handle();
  const out = [];
  for (let j = 0; j < TABLES; j++) {
    const p = x.soemdsp_spectral_osc_table_ptr(hd, j) / 4;
    out.push(Float64Array.from(new Float32Array(x.memory.buffer).subarray(p, p + LENS[j])));
  }
  return { tabs: out, gain: x.soemdsp_spectral_osc_gain(hd) };
}
const builtCache = new Map();
function built(shape, A, B, G = 0, cycle = 0) {
  const key = `${shape}|${A}|${B}|${G}|${cycle}`;
  if (builtCache.has(key)) return builtCache.get(key);
  const g = makeGraph({ shape, A, B, G, cycle });
  run(g, 128);
  const t = tables(g);
  x.soemdsp_graph_destroy(g.h);
  builtCache.set(key, t);
  return t;
}
function fftMag(y) {
  const re = Float64Array.from(y), im = new Float64Array(y.length);
  M.spectralOscFft(re, im);
  return Array.from({ length: y.length / 2 }, (_, k) => Math.hypot(re[k], im[k]) * 2 / y.length);
}

// ---- ideal waves (time domain) -------------------------------------------
const frac = (t) => t - Math.floor(t);
const saw = (t) => 2 * frac(t + 0.5) - 1;
const ideal = {
  0: (A) => (t) => { const p = A; t = frac(t); return t < p ? t / p : -1 + (t - p) / (1 - p); },
  1: (A) => { const w = A, peak = Math.max(2 - 2 * w, 2 * w), dc = 2 * w - 1; return (t) => ((frac(t) < w ? 1 : -1) - dc) / peak; },
  2: (A) => { const p = A; return (t) => { t = frac(t); if (t < p / 2) return 2 * t / p; if (t < 1 - p / 2) return 1 - 2 * (t - p / 2) / (1 - p); return -1 + 2 * (t - 1 + p / 2) / p; }; },
  4: (A, B) => { const S = 2 ** (1 + 4 * A); return (t) => saw(t) * (1 - B / 2) - (B / 4) * (saw(t + 1 / S) + saw(t - 1 / S)); },
};
function dft(fn, n, Mpts = 1 << 16) {
  let a = 0, b = 0;
  for (let j = 0; j < Mpts; j++) {
    const t = (j + 0.5) / Mpts;
    const y = fn(t);
    a += y * Math.cos(2 * Math.PI * n * t);
    b += y * Math.sin(2 * Math.PI * n * t);
  }
  return { a: (2 * a) / Mpts, b: (2 * b) / Mpts };
}

// ---- 1. formulas -------------------------------------------------------------
{
  let worst = 0;
  for (const shape of [0, 1, 2, 4]) {
    for (const A of [0.1, 0.37, 0.5, 0.8]) {
      const B = shape === 4 ? 0.7 : 0;
      const fn = ideal[shape](A, B);
      for (const n of [1, 2, 3, 5, 8, 13]) {
        const c = M.spectralOscShapeCoef(shape, A, B, n);
        const d = dft(fn, n);
        worst = Math.max(worst, Math.abs(c.a - d.a), Math.abs(c.b - d.b));
      }
    }
  }
  check(worst < 2e-4, `closed-form harmonics match the ideal waves' DFT (Center Edge, Pulse, Trisaw, Comb): max err ${worst.toExponential(2)}`);
  const f = M.spectralOscShapeCoef(3, 4 / 7, 0.3, 16);
  check(Math.abs(f.a - 1) < 1e-12 && f.b === 0 && M.spectralOscShapeCoef(3, 4 / 7, 0.3, 32).a < f.a, "Formant peaks at harmonic 2^(7A) with cosine phase");
  // Asym Sine: Sharp 0 / Skew centre is the parabola 0.5 - 6u^2 = (6/pi^2) sum (-1)^(n+1) cos / n^2.
  const s0 = M.spectralOscSpectrum(5, 0, 0.5);
  let e0 = 0; for (let n = 1; n <= 1024; n++) e0 = Math.max(e0, Math.abs(s0.a[n] - 6 * (n % 2 ? 1 : -1) / (Math.PI ** 2 * n * n)), Math.abs(s0.b[n]));
  check(e0 < 1e-7, `Asym Sine Sharp 0: harmonics = 6(-1)^(n+1)/(pi^2 n^2), the old Wavetable 2D frame (max err ${e0.toExponential(2)})`);
  const s1 = M.spectralOscSpectrum(5, 1, 0.5);
  let e1 = 0; for (let n = 1; n <= 1024; n++) e1 = Math.max(e1, Math.abs(s1.a[n] - 6 / (Math.PI ** 2 * n * n)), Math.abs(s1.b[n]));
  const sc = M.spectralOscSpectrum(5, 0.5, 0.5);
  let ec = Math.abs(sc.a[1] - 1); for (let n = 2; n <= 1024; n++) ec = Math.max(ec, Math.abs(sc.a[n]), Math.abs(sc.b[n]));
  check(e1 < 1e-7 && ec < 1e-12, `Asym Sine Sharp 1 = flipped parabola (err ${e1.toExponential(2)}); Sharp 0.5 Skew 0.5 = pure cosine (err ${ec.toExponential(2)})`);
  // Skewed: the 8192-point analysis vs a 65536-point one of the same exact formula.
  let es = 0;
  for (const [A, B] of [[0, 0], [0.25, 0.9], [0.8, 0.1], [1, 1]]) {
    const lo = M.spectralOscSpectrum(5, A, B), hi = M.spectralOscSpectrum(5, A, B, 1 << 16);
    for (let n = 1; n <= 1024; n++) es = Math.max(es, Math.hypot(lo.a[n] - hi.a[n], lo.b[n] - hi.b[n]));
  }
  check(es < 1e-6, `Asym Sine skewed: harmonics 1..1024 from the 8192-point formula FFT match a 65536-point one (max err ${es.toExponential(2)})`);
  // Glass / Bell: partials where the formula puts them.
  const gl = M.spectralOscSpectrum(6, 1, 0);
  const mag = (sp, n) => Math.hypot(sp.a[n], sp.b[n]);
  const squares = [1, 4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144];
  let off = 0; for (let n = 1; n <= 1024; n++) if (!squares.includes(n)) off = Math.max(off, mag(gl, n));
  check(off < 1e-9 && Math.abs(mag(gl, 1) - 1) < 1e-12 && Math.abs(mag(gl, 4) - 0.6 * 2 ** -0.35) < 1e-9, "Glass Stretch 1: partials exactly at k^2 (1, 4, 9, ... 144), fundamental 1, 0.6 k^-0.35 above");
  const be = M.spectralOscSpectrum(7, 0, 0);
  // Stretch 0: hum 1, prime 2, tierce 2.4 (split 2 / 3), quint 3, nominal 4, 5, 6, 8.4 (8 / 9), 10.8 (10 / 11).
  const want = new Map([[1, 0.55], [4, 0.9], [5, 0.5], [6, 0.45], [7, 0], [12, 0]]);
  let eb = 0; for (const [n, v] of want) eb = Math.max(eb, Math.abs(mag(be, n) - v));
  check(eb < 1e-9 && [2, 3, 8, 9, 10, 11].every((n) => mag(be, n) > 0.05), "Bell Stretch 0: hum 1, nominal 4, 5, 6 exact; tierce 2.4 and 4.2 / 5.4 ratios split across their neighbours, nothing else");
  const be1 = M.spectralOscSpectrum(7, 1, 0);
  check([1, 5, 9, 13, 17, 21].every((n) => mag(be1, n) > 0.05) && [2, 3, 4, 8, 10, 12].every((n) => mag(be1, n) === 0), "Bell Stretch 1: partials spread to 5, 6.6, 9, 13, 17, 21, 30.6, 40.2 (wide gaps above the hum)");
}

// ---- 2. native tables = the formula ------------------------------------------
const cases = [];
for (const shape of [0, 1, 2]) for (const A of [0.02, 0.5, 0.9]) for (const B of [0, 0.7, 1]) cases.push([shape, A, B]);
for (const A of [0, 0.4, 1]) for (const B of [0, 1]) { cases.push([3, A, B]); cases.push([4, A, B]); }
for (const [A, B] of [[0, 0.5], [0.5, 0.5], [1, 0.5], [0.2, 0], [0.7, 1], [0, 1]]) cases.push([5, A, B]);
for (const A of [0, 0.5, 1]) for (const B of [0, 0.5, 1]) { cases.push([6, A, B]); cases.push([7, A, B]); }
{
  let worst = 0;
  const spots = [0, 3, 9, 15, 21, 27];
  for (const G of [0, 0.5, 1]) {
    for (const [s, A, B] of cases) {
      if (G !== 0 && cases.indexOf(cases.find((c) => c[0] === s)) % 2) continue;
      const t = built(s, A, B, G);
      const sp = M.spectralOscSpectrum(s, A, B);
      for (const j of spots) {
        const ref = M.spectralOscCycle(s, A, B, KS[j], LENS[j], G, sp);
        const pk = peakOf(ref);
        if (pk > 1e-9) worst = Math.max(worst, maxDiff(ref, t.tabs[j]) / pk);
      }
    }
  }
  check(worst < 1e-4, `native tables equal the JS formula (8 shapes, Gibbs 0 / 0.5 / 1, 6 tables each): max err ${worst.toExponential(2)} of peak`);
  const kOk = JSON.stringify(KS) === JSON.stringify([...M.SPECTRAL_OSC_TABLE_K]);
  const lenOk = LENS.every((L, j) => L >= Math.max(256, 4 * KS[j]) && (L & (L - 1)) === 0);
  check(TABLES === 28 && kOk && lenOk, `28 tables, 3 per octave: K = ${KS.slice(0, 9).join(",")} ... ${KS.slice(-3).join(",")}; length >= max(256, 4K)`);
  // No harmonic above K in any table (Gibbs 1, the brightest).
  let above = 0;
  for (const [s, A, B] of [[0, 0.5, 0], [1, 0.3, 0], [6, 1, 0], [7, 1, 0], [5, 0, 0]]) {
    const t = built(s, A, B, 1);
    t.tabs.forEach((tab, j) => {
      const m = fftMag(tab);
      const pk = Math.max(...m);
      for (let k = KS[j] + 1; k < m.length; k++) above = Math.max(above, m[k] / pk);
    });
  }
  check(above < 1e-6, `every table holds harmonics 1..K only (largest above K: ${dB(above).toFixed(1)} dB, float noise)`);
}

// ---- 2b. Single trigger keeps the DC; Free run is DC-free ----------------------
const meanOf = (a) => { let s = 0; for (const v of a) s += v; return s / a.length; };
const EDGES = [0, 0.001, 0.01, 0.03, 0.1, 0.25, 0.5, 0.75, 0.9, 0.97, 0.99, 0.999, 1];
const pickFor = (hz) => { const H = SR / 2 / hz; let j = 0; while (j + 1 < TABLES && KS[j + 1] <= H) j++; return j; };
{
  // Free run: every table of every shape has zero mean.
  let worstMean = 0;
  for (const [s, A, B] of cases) {
    const t = built(s, A, B, 0);
    t.tabs.forEach((tab) => { worstMean = Math.max(worstMean, Math.abs(meanOf(tab)) * t.gain); });
  }
  check(worstMean < 1e-6, `Free run stays DC-free: every table of all 8 shapes has mean ${worstMean.toExponential(1)} (x gain)`);
  // Single trigger tables = the JS formula with its DC.
  let worst = 0;
  for (const G of [0, 0.5, 1]) for (const [s, A, B] of cases.filter((c, i) => i % 3 === 0)) {
    const t = built(s, A, B, G, 1);
    const sp = M.spectralOscSpectrum(s, A, B);
    for (const j of [0, 4, 9, 15, 21, 27]) {
      const ref = M.spectralOscCycle(s, A, B, KS[j], LENS[j], G, sp, true);
      const pk = peakOf(ref);
      if (pk > 1e-9) worst = Math.max(worst, maxDiff(ref, t.tabs[j]) / pk);
    }
  }
  check(worst < 1e-4, `Single trigger: native tables equal the JS formula incl. DC (Gibbs 0 / 0.5 / 1): max err ${worst.toExponential(2)} of peak`);
  // Center Edge: the start (= the end, t = 1) of every table, scaled to the output.
  const startStep = (B, G, js) => {
    let w = 0, at = "";
    for (const A of EDGES) {
      const t = built(0, A, B, G, 1);
      for (const j of js) { const v = Math.abs(t.tabs[j][0] * t.gain); if (v > w) { w = v; at = `Edge ${A}, K ${KS[j]}`; } }
    }
    return { w, at };
  };
  const all = [...Array(TABLES).keys()];
  const s0 = startStep(0, 0, all), s0g = startStep(0, 1, all);
  check(s0.w < 1e-6 && s0g.w < 1e-6, `Single trigger, Center Edge, Sine 0: every table starts and ends at 0 for Edge 0..1 (worst ${s0.w.toExponential(1)} at Gibbs 0, ${s0g.w.toExponential(1)} at Gibbs 1; float rounding)`);
  console.log(`STEP  Center Edge, Sine 0: <= ${s0.w.toExponential(1)} at every pitch, Edge 0..1`);
  for (const B of [0.25, 0.5, 0.75, 1]) {
    const r = startStep(B, 0, all);
    const at100 = startStep(B, 0, [pickFor(100), pickFor(100) - 1]);
    const at1k = startStep(B, 0, [pickFor(1000), pickFor(1000) - 1]);
    console.log(`STEP  Center Edge, Sine ${B}: start/end step <= ${r.w.toFixed(4)} over all pitches (${r.at}); ${at100.w.toFixed(4)} at 100 Hz, ${at1k.w.toFixed(4)} at 1 kHz (Edge 0..1)`);
  }
  // Rendered: a hit starts at exactly 0; the cycle's last sample is one sample short of the end.
  {
    const freq = 480; // 100-sample cycle
    let first = 0, last = 0;
    for (const A of EDGES) {
      const gr = makeGraph({ shape: 0, A, B: 0, freq, cycle: 1, reset: true });
      const y = run(gr, 400, 1, PORT_MONO, (f) => { if (f === 199) x.soemdsp_graph_set_param(gr.h, 1, P_OFFSET, 0); if (f === 200) x.soemdsp_graph_set_param(gr.h, 1, P_OFFSET, 1); });
      x.soemdsp_graph_destroy(gr.h);
      first = Math.max(first, Math.abs(y[200]));
      last = Math.max(last, Math.abs(y[299]));
    }
    check(first < 1e-6, `rendered Single trigger, Center Edge Sine 0: the hit's first sample is 0 for every Edge (worst ${first.toExponential(1)})`);
    console.log(`STEP  rendered at 480 Hz (100-sample cycle): last sample before silence <= ${last.toFixed(4)} (the ramp one sample before it reaches 0, not an offset)`);
  }
  // True DC kept: the top table's mean is the shape's mean.
  let dcErr = 0;
  for (const A of [0.1, 0.3, 0.5, 0.7, 0.9]) dcErr = Math.max(dcErr, Math.abs(meanOf(built(0, A, 0, 0, 1).tabs[TABLES - 1]) - (A - 0.5)));
  const asymMean = (() => { let s = 0; const k = M.spectralOscAsymSkewK(0.85); for (let i = 0; i < 65536; i++) s += M.spectralOscAsymValue(0.2, k, i / 65536); return s / 65536; })();
  const asymErr = Math.abs(meanOf(built(5, 0.2, 0.85, 0, 1).tabs[TABLES - 1]) - asymMean);
  check(dcErr < 3e-3 && asymErr < 1e-6, `Single trigger keeps the true DC: Center Edge mean -> Edge - 0.5 (err ${dcErr.toExponential(1)} at K 1024, ~2/K from the start correction), Asym Sine = formula mean ${asymMean.toFixed(4)} (err ${asymErr.toExponential(1)})`);
  // Sine 1 is still a pure sine; peak <= 1 (scale only).
  let sineDc = 0, over = 0;
  for (const s of [0, 1, 2]) for (const A of [0.05, 0.5, 0.95]) { const t = built(s, A, 1, 0, 1); t.tabs.forEach((tab) => { sineDc = Math.max(sineDc, Math.abs(meanOf(tab))); }); }
  for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) for (const A of [0, 0.03, 0.5, 0.97, 1]) { const t = built(s, A, 0, 0, 1); t.tabs.forEach((tab) => { over = Math.max(over, peakOf(tab) * t.gain - 1); }); }
  check(sineDc < 1e-7 && over < 1e-6, `Single trigger: Sine 1 stays a pure sine (DC ${sineDc.toExponential(1)}); every shape peak <= 1 (excess ${Math.max(0, over).toExponential(1)})`);
  // Switching Cycle mode rebuilds with the usual crossfade.
  {
    const gs = makeGraph({ shape: 0, A: 0.2, B: 0, cycle: 0 });
    run(gs, 128);
    gs.set(P_TIMING, 1);
    let sawBusy = false, settle = -1;
    for (let b = 0; b < 40; b++) { run(gs, 128); const busy = x.soemdsp_spectral_osc_busy(gs.handle()); if (busy) sawBusy = true; if (sawBusy && !busy && settle < 0) settle = b + 1; }
    const tS = tables(gs), ref = built(0, 0.2, 0, 0, 1);
    gs.set(P_TIMING, 0);
    run(gs, 128 * 40);
    const tF = tables(gs), refF = built(0, 0.2, 0, 0, 0);
    x.soemdsp_graph_destroy(gs.h);
    const same = (p, q) => p.tabs.every((tab, j) => maxDiff(tab, q.tabs[j]) === 0) && p.gain === q.gain;
    check(sawBusy && settle > 0 && same(tS, ref) && same(tF, refF), `switching Cycle mode rebuilds the tables with the crossfade, also while idle and silent (settled after ${settle} blocks) and back`);
  }
}
// ---- 3. no overshoot at Gibbs 0 --------------------------------------------
{
  let worstIdeal = 0;
  let worstUnit = 0;
  for (const [s, A, B] of cases) {
    const t = built(s, A, B, 0);
    const dc = s === 0 ? Math.min(0.999, Math.max(0.001, A)) - 0.5 : 0;
    let lo = -1 - dc, hi = 1 - dc;
    if (s === 1) { const w = Math.min(0.999, Math.max(0.001, A)), peak = Math.max(2 - 2 * w, 2 * w); hi = (2 - 2 * w) / peak; lo = -2 * w / peak; }
    // Sine weights harmonic n by r^(n-1) = r^n / r: table x r is the smoothed ideal wave.
    const r = 1 - B * B * B;
    for (const tab of t.tabs) {
      for (const v of tab) {
        if (s <= 2) worstIdeal = Math.max(worstIdeal, v * r - hi, lo - v * r);
        worstUnit = Math.max(worstUnit, Math.abs(v * t.gain) - 1);
      }
    }
  }
  check(worstIdeal <= 2e-4, `Gibbs 0, Center Edge / Pulse / Trisaw: every table inside the ideal wave's range (worst ${Math.max(0, worstIdeal).toExponential(2)}, from stopping the taper at K)`);
  check(worstUnit <= 1e-6, `every shape, every table: |table x gain| <= 1 (excess ${Math.max(0, worstUnit).toExponential(2)})`);
  let peak = 0;
  for (const G of [0, 1]) for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const g = makeGraph({ shape: s, A: 0.15, B: 0.4, G, amp: 0.8 });
    let f = 30;
    run(g, SR, 128, PORT_MONO, () => { f *= 1.03; g.set(P_FREQ, Math.min(f, 23000)); }).forEach((v) => { peak = Math.max(peak, Math.abs(v)); });
    x.soemdsp_graph_destroy(g.h);
  }
  check(peak <= 0.8 + 1e-6, `rendered sweep 30 Hz..23 kHz, all 8 shapes, Gibbs 0 and 1, Amp 0.8: peak ${peak.toFixed(6)}`);
}

// ---- 4. Center Edge ramps are monotone at every Sine (Gibbs 0) -----------------
function turns(tab, tol) {
  let n = 0, dir = 0;
  const L = tab.length;
  for (let i = 0; i < 2 * L; i++) {
    const d = tab[(i + 1) % L] - tab[i % L];
    if (Math.abs(d) <= tol) continue;
    const s = d > 0 ? 1 : -1;
    if (dir && s !== dir && i >= L) n++;
    dir = s;
  }
  return n;
}
{
  const bad = [];
  for (const A of [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98]) {
    for (const B of [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1]) {
      const sp = M.spectralOscSpectrum(0, A, B);
      for (const j of [0, 2, 5, 9, 15, 19]) {
        const ref = M.spectralOscCycle(0, A, B, KS[j], LENS[j], 0, sp);
        const k = turns(ref, 1e-12);
        if (k !== 2) bad.push(`js A${A} B${B} K${KS[j]}:${k}`);
      }
      built(0, A, B, 0).tabs.forEach((tab, j) => { const k = turns(tab, 1e-6); if (k !== 2) bad.push(`native A${A} B${B} K${KS[j]}:${k}`); });
      builtCache.clear();
    }
  }
  check(bad.length === 0, `Center Edge, Gibbs 0: one rise and one fall at 7 Edges x 8 Sines, every table${bad.length ? " -- " + bad.slice(0, 6).join(", ") : ""}`);
}

// ---- 5. Sine max = pure sine -------------------------------------------------
{
  let worst = 0;
  for (const s of [0, 1, 2, 6, 7]) {
    for (const A of [0.1, 0.5, 0.85]) {
      const t = built(s, A, 1, 0);
      const c = M.spectralOscSpectrum(s, A, 1);
      t.tabs.forEach((tab, j) => {
        const g1 = M.spectralOscTaper(1, KS[j], 0);
        const L = tab.length;
        for (let i = 0; i < L; i++) {
          const th = (2 * Math.PI * i) / L;
          worst = Math.max(worst, Math.abs(tab[i] - g1 * (c.a[1] * Math.cos(th) + c.b[1] * Math.sin(th))));
        }
      });
    }
  }
  check(worst < 1e-6, `Sine = 1 leaves only the fundamental (Center Edge, Pulse, Trisaw, Glass, Bell; every table): max err ${worst.toExponential(2)}`);
  const f = (SR / 8192) * 64;
  const g = makeGraph({ shape: 7, A: 0.6, B: 1, freq: f });
  run(g, 4096);
  const y = run(g, 8192);
  x.soemdsp_graph_destroy(g.h);
  const m = fftMag(y);
  let rest = 0; for (let k = 1; k < m.length; k++) if (k !== 64) rest = Math.max(rest, m[k]);
  check(Math.abs(m[64] - 1) < 3e-3 && rest < 1e-5, `rendered Bell, Sine = 1: a unit sine (fundamental ${m[64].toFixed(5)}, everything else ${dB(rest).toFixed(0)} dB)`);
}

// ---- 6. Gibbs ------------------------------------------------------------------
{
  const j = KS.indexOf(64);
  const over = [];
  for (const G of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
    const t = built(1, 0.5, 0, G);
    over.push(Math.max(0, peakOf(t.tabs[j]) - 1));
  }
  const mono = over.every((v, i) => i === 0 || v >= over[i - 1] - 1e-9);
  check(over[0] < 2e-4 && over[5] > 0.17 && over[5] < 0.19 && mono,
    `Gibbs 0 -> 1 on a square (K = 64): overshoot ${over.map((v) => (v * 100).toFixed(2) + "%").join(" -> ")} of its height (1 = brick wall, 9 % of the jump)`);
  const t1 = built(1, 0.5, 0, 1);
  const brick = M.spectralOscCycle(1, 0.5, 0, 64, LENS[j], 1);
  let plain = 0; const sp = M.spectralOscSpectrum(1, 0.5, 0);
  for (let i = 0; i < LENS[j]; i += 97) { let v = 0; for (let n = 1; n <= 64; n++) { const th = 2 * Math.PI * n * i / LENS[j]; v += sp.a[n] * Math.cos(th) + sp.b[n] * Math.sin(th); } plain = Math.max(plain, Math.abs(v - t1.tabs[j][i])); }
  check(maxDiff(brick, t1.tabs[j]) < 1e-5 && plain < 1e-5, "Gibbs 1: the plain partial sum up to K (brick wall)");
  // A Gibbs move rebuilds like any other parameter.
  const g = makeGraph({ shape: 0, A: 0.5, B: 0, G: 0 });
  run(g, 128 * 4);
  g.set(P_WIDTH, 1);
  run(g, 128 * 30);
  const after = tables(g);
  x.soemdsp_graph_destroy(g.h);
  check(maxDiff(after.tabs[j], built(0, 0.5, 0, 1).tabs[j]) === 0, "moving Gibbs rebuilds the tables (equal to a fresh Gibbs 1 build)");
}

// ---- 7. rebuild: exact new shape after a short crossfade, no snapshots --------
{
  const blk = 128, change = 128 * 20, frames = 128 * 80;
  const oldP = { shape: 0, A: 0.5, B: 0.1 }, newP = { shape: 5, A: 0.2, B: 0.8 };
  const gC = makeGraph(oldP), gO = makeGraph(oldP), gN = makeGraph(newP);
  const yC = run(gC, frames, blk, PORT_MONO, (f) => { if (f === change) { gC.set(P_WAVE, newP.shape); gC.set(P_SHAPE, newP.A); gC.set(P_RES, newP.B); } });
  const yO = run(gO, frames), yN = run(gN, frames);
  let settle = -1;
  for (let i = frames - 1; i >= change; i--) { if (Math.abs(yC[i] - yN[i]) > 1e-12) { settle = i + 1; break; } }
  const fadeLen = settle - change;
  let outside = 0;
  for (let i = change; i < settle; i++) { const lo = Math.min(yO[i], yN[i]) - 1e-9, hi = Math.max(yO[i], yN[i]) + 1e-9; if (yC[i] < lo || yC[i] > hi) outside++; }
  let pre = 0; for (let i = 0; i < change; i++) pre = Math.max(pre, Math.abs(yC[i] - yO[i]));
  check(pre === 0, "before the move: identical to the old shape");
  check(settle > change && fadeLen <= 128 * 10 + Math.ceil(0.02 * SR) + 128, `after the move: bit-exact new shape after ${fadeLen} samples (${(fadeLen / SR * 1000).toFixed(1)} ms: spectrum + tables + 20 ms fade)`);
  check(outside === 0, "during the crossfade every sample lies between the old and new shapes (no snapshot, no jump)");
  const tC = tables(gC), tN = tables(gN);
  check(tC.tabs.every((tab, j) => maxDiff(tab, tN.tabs[j]) === 0) && tC.gain === tN.gain, "rebuilt tables are identical to a fresh build from the parameters");
  for (const g of [gC, gO, gN]) x.soemdsp_graph_destroy(g.h);
}

// ---- 8. display bake = the formula ----------------------------------------
{
  let ok = true;
  for (const [s, A, B, G] of [[1, 0.3, 0.25, 0], [5, 0.2, 0.8, 0], [6, 0.5, 0.2, 0.5], [7, 1, 0, 1]]) {
    const bake = M.spectralOscBakeCycle({ shape: s, shapeA: A, shapeB: B, gibbs: G }, 255);
    const ref = M.spectralOscCycle(s, A, B, 85, 255, G);
    let mn = 0, mx = 0; for (const v of ref) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const g = M.spectralOscGain(s, mn, mx);
    if (!(maxDiff(bake, ref.map((v) => v * g)) < 1e-12 && peakOf(bake) <= 1 + 1e-12)) ok = false;
  }
  check(ok, "face bake is the exact formula cycle incl. Gibbs (no clipping: peak <= 1)");
  let okS = true;
  for (const [s, A, B, G] of [[0, 0.2, 0, 0], [0, 0.9, 0.5, 0], [1, 0.3, 0, 0.5], [5, 0.2, 0.8, 0]]) {
    const bake = M.spectralOscBakeCycle({ shape: s, shapeA: A, shapeB: B, gibbs: G, cycleMode: 1 }, 255);
    const ref = M.spectralOscCycle(s, A, B, 85, 255, G, null, true);
    let mn = 0, mx = 0; for (const v of ref) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const g = M.spectralOscGain(s, mn, mx);
    if (!(maxDiff(bake, ref.map((v) => v * g)) < 1e-12 && peakOf(bake) <= 1 + 1e-12)) okS = false;
  }
  const ce = M.spectralOscBakeCycle({ shape: 0, shapeA: 0.2, shapeB: 0, gibbs: 0, cycleMode: 1 }, 255);
  check(okS && Math.abs(ce[0]) < 1e-12 && Math.abs(meanOf(M.spectralOscBakeCycle({ shape: 0, shapeA: 0.2, shapeB: 0, gibbs: 0 }, 255))) < 1e-9,
    `face bake shows the true shape per mode: Single trigger keeps the DC (Center Edge starts at ${ce[0].toExponential(1)}), Free run DC-free`);
}

// ---- 9. aliasing: sweep pitch, FFT, energy off the harmonic bins -------------
// Bin-exact tones (f = b SR / 8192, b odd): harmonics land on multiples of b, any
// partial above Nyquist folds onto a non-multiple. Level = largest non-harmonic bin
// relative to the fundamental.
const ALIAS_BINS = [23, 57, 131, 301, 517, 777, 1031, 1365, 1501, 2003, 2731, 3001, 3501];
function measureAlias(ex, shapes, Gs) {
  let worst = -400, at = "";
  for (const G of Gs) for (const s of shapes) for (const b of ALIAS_BINS) {
    const g = makeGraph({ shape: s, A: s === 5 ? 0.1 : 0.3, B: s === 5 ? 0.9 : (s === 4 ? 0.6 : 0), G, freq: (b * SR) / 8192 }, ex);
    run(g, 128 * 48);
    const y = run(g, 8192);
    ex.soemdsp_graph_destroy(g.h);
    const m = fftMag(y);
    const fund = m[b];
    if (!(fund > 1e-6)) continue;
    let al = 0;
    for (let k = 1; k < m.length; k++) if (k % b) al = Math.max(al, m[k]);
    const lvl = dB(al / fund);
    if (lvl > worst) { worst = lvl; at = `${M.SPECTRAL_OSC_SHAPES[s]} G${G} ${((b * SR) / 8192).toFixed(0)} Hz`; }
  }
  return { worst, at };
}
{
  const legacy = [0, 1, 2, 3, 4];
  if (baselinePath) {
    const base = await load(baselinePath);
    const b = measureAlias(base, legacy, [0]);
    console.log(`ALIAS before (baseline build, shapes 0-4): worst ${b.worst.toFixed(1)} dB re fundamental (${b.at})`);
  }
  const a0 = measureAlias(x, legacy, [0]);
  console.log(`ALIAS after  (shapes 0-4, Gibbs 0):        worst ${a0.worst.toFixed(1)} dB re fundamental (${a0.at})`);
  const aAll = measureAlias(x, [0, 1, 2, 3, 4, 5, 6, 7], [0]);
  const aG1 = measureAlias(x, [0, 1, 2, 3, 4, 5, 6, 7], [1]);
  console.log(`ALIAS after  (all 8 shapes, Gibbs 0):      worst ${aAll.worst.toFixed(1)} dB (${aAll.at})`);
  console.log(`ALIAS after  (all 8 shapes, Gibbs 1):      worst ${aG1.worst.toFixed(1)} dB (${aG1.at})`);
  check(aAll.worst < -95, `Gibbs 0: no alias above -95 dB re the fundamental, 135 Hz..20.5 kHz, all shapes (worst ${aAll.worst.toFixed(1)} dB)`);
  check(aG1.worst < -70, `Gibbs 1: no alias above -70 dB (worst ${aG1.worst.toFixed(1)} dB; only interpolation images of full-level top partials, no partial above Nyquist)`);
  const g = makeGraph({ shape: 0, freq: 24100 });
  const y = run(g, 2048);
  x.soemdsp_graph_destroy(g.h);
  check(y.every((v) => v === 0), "above Nyquist (24.1 kHz at 48 kHz): silent, nothing folds back");
}

// ---- 10. Cycle: Free run / Single trigger, Reset is a partial-reset trigger ---
// y = alpha x + beta (same cycle, DC kept and rescaled): worst residual of the least-squares fit.
function affineErr(y, xs) {
  const n = y.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += y[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * y[i]; }
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - a * sx) / n;
  let w = 0; for (let i = 0; i < n; i++) w = Math.max(w, Math.abs(y[i] - (a * xs[i] + b)));
  return w;
}
function gatesFor(hits) {
  const g = new Map();
  for (const [frame, height] of hits) { if (!g.has(frame - 1)) g.set(frame - 1, 0); g.set(frame, height); }
  return g;
}
function renderGates(opts, hits, frames, port = PORT_MONO) {
  const g = makeGraph({ ...opts, reset: true });
  const gates = gatesFor(hits);
  const y = run(g, frames, 1, port, (f) => { if (gates.has(f)) x.soemdsp_graph_set_param(g.h, 1, P_OFFSET, gates.get(f)); });
  x.soemdsp_graph_destroy(g.h);
  return y;
}
{
  const freq = 480; // 100-sample cycle
  const opts = { shape: 0, A: 0.5, B: 0.2, freq };
  const frames = 1200;
  const single = renderGates({ ...opts, cycle: 1 }, [[200, 1], [700, 1], [740, 1]], frames);
  const free = renderGates({ ...opts, cycle: 0 }, [[200, 1]], frames);
  check(single.slice(0, 200).every((v) => v === 0), "Single trigger: silent before the first Reset hit");
  check(affineErr(single.slice(200, 300), free.slice(200, 300)) < 1e-6 && single.slice(200, 300).some((v) => Math.abs(v) > 0.5), "Single trigger: the hit plays the free-run cycle from phase 0 (plus its DC, rescaled)");
  check(single.slice(301, 700).every((v) => v === 0), "Single trigger: silent after one cycle until the next hit");
  const restart = renderGates({ ...opts, cycle: 0 }, [[740, 1]], frames);
  check(affineErr(single.slice(740, 840), restart.slice(740, 840)) < 1e-6 && single.slice(841, 1200).every((v) => v === 0), "Single trigger: a hit mid-cycle restarts the cycle");
  check(free.slice(0, 200).some((v) => Math.abs(v) > 0.5) && free.slice(300, 1200).some((v) => Math.abs(v) > 0.5), "Free run: plays before and after hits");
  const ph = renderGates({ ...opts, cycle: 0 }, [[40, 0.5]], 100, PORT_SAW);
  check(Math.abs(ph[40] - 0.2) < 1e-9 && Math.abs(ph[39] - 0.39) < 1e-9, `Reset height 0.5 at phase 0.4 lands on 0.2 (got ${ph[40].toFixed(6)})`);
  const back = renderGates({ ...opts, cycle: 0 }, [[70, -0.5]], 100, PORT_SAW);
  check(Math.abs(back[70] - 0.35) < 1e-9, `Reset height -0.5 at phase 0.7 goes the long way to 0.35 (got ${back[70].toFixed(6)})`);
}

// ---- 11. CPU / memory ------------------------------------------------------------
{
  const seconds = 10, blk = 128, frames = SR * seconds;
  const time = (setup, voices, shape) => {
    const gs = Array.from({ length: voices }, () => makeGraph({ shape, A: 0.4, B: 0.3, freq: 110 }));
    const t0 = process.hrtime.bigint();
    for (let f = 0; f < frames; f += blk) {
      for (const g of gs) { setup(g, f); x.soemdsp_graph_process_block(g.h, blk); }
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    gs.forEach((g) => x.soemdsp_graph_destroy(g.h));
    return ms / voices;
  };
  const audioMs = seconds * 1000;
  const steady = time(() => {}, 4, 0);
  const moving = time((g, f) => g.set(P_SHAPE, 0.1 + 0.8 * (0.5 + 0.5 * Math.sin(f / 9000))), 4, 0);
  const movingAsym = time((g, f) => g.set(P_RES, 0.1 + 0.8 * (0.5 + 0.5 * Math.sin(f / 9000))), 4, 5);
  console.log(`CPU  steady: ${(steady / audioMs * 100).toFixed(3)} % of one core per voice (${(audioMs / steady).toFixed(0)}x realtime)`);
  console.log(`CPU  Center Edge, Edge moving every block (rebuild + fade back to back): ${(moving / audioMs * 100).toFixed(3)} % per voice`);
  console.log(`CPU  Asym Sine, Skew moving every block (8192-pt analysis per rebuild): ${(movingAsym / audioMs * 100).toFixed(3)} % per voice`);
  const floats = LENS.reduce((a, b) => a + b, 0);
  const perVoice = 2 * floats * 4 + 2 * 1025 * 8;
  console.log(`MEM  ${floats} floats per bank, 2 banks + spectrum = ${(perVoice / 1024).toFixed(1)} KB per voice, ${(perVoice * 128 / 1048576).toFixed(1)} MB for 128 voices`);
  check(moving / audioMs < 0.05 && movingAsym / audioMs < 0.05, "CPU: continuous rebuild stays under 5 % of a core per voice");
}

// ---- 12. 128 instances in one graph ------------------------------------------
{
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  let added = 0;
  for (let i = 0; i < 128; i++) {
    const id = 10 + i;
    if (x.soemdsp_graph_add_node(h, id, SPECTRAL) === 0) added++;
    x.soemdsp_graph_set_param(h, id, P_WAVE, i % 8);
    x.soemdsp_graph_set_param(h, id, P_FREQ, 50 + i);
  }
  x.soemdsp_graph_compile(h);
  for (let b = 0; b < 4; b++) x.soemdsp_graph_process_block(h, 128);
  const extra = x.soemdsp_graph_add_node(h, 10 + 128, SPECTRAL);
  x.soemdsp_graph_process_block(h, 128);
  let live = 0;
  for (let i = 0; i < 128; i++) {
    const id = 10 + i;
    const q = x.soemdsp_graph_node_port_ptr(h, id, PORT_MONO) / 8;
    const y = new Float64Array(x.memory.buffer).subarray(q, q + 128);
    if (x.soemdsp_graph_node_native_handle(h, id) > 0 && y.some((v) => v !== 0)) live++;
  }
  check(added === 128 && live === 128, `128 instances in one graph all play (${live})`);
  check(extra < 0, `a 129th instance is refused (add_node ${extra}), no crash, the graph keeps playing`);
  x.soemdsp_graph_destroy(h);
  const again = makeGraph({});
  check(again.handle() > 0 && run(again, 256).some((v) => v !== 0), "instances are recycled after the graph is destroyed");
  x.soemdsp_graph_destroy(again.h);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exitCode = failures ? 1 : 0;