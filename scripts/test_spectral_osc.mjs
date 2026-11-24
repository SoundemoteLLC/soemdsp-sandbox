// Spectral Oscillator: exact shapes, no Gibbs overshoot, monotone Center Edge ramps,
// Sine max = pure sine, rebuild crossfade (no snapshots), Cycle / Reset trigger, CPU.
// Runs the real combined wasm headless; no browser.
//
//   node scripts/test_spectral_osc.mjs [path/to/soemdsp_combined.wasm]
//
// Exit code 1 if anything fails.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = process.argv[2] || path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");

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
    + "\nthis.M = { SPECTRAL_OSC_SHAPES, spectralOscShapeCoef, spectralOscHarmonics, spectralOscCycle, spectralOscBakeCycle, spectralOscGain };",
  ctx,
);
const M = ctx.M;

const SR = 48000;
const SPECTRAL = 180, BIAS = 12;
const P_FREQ = 10, P_WAVE = 11, P_AMP = 12, P_SHAPE = 13, P_PHASE = 14, P_RES = 20, P_TIMING = 54, P_OFFSET = 71;
const PORT_MONO = 0, PORT_SAW = 3, PORT_RESET = 19;
const MIPS = 11;

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

// ---- graph helpers -------------------------------------------------------
function makeGraph({ shape = 0, A = 0.5, B = 0, freq = 220, amp = 1, cycle = 0, reset = false } = {}) {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  if (reset) {
    x.soemdsp_graph_add_node(h, 1, BIAS);
    x.soemdsp_graph_set_smooth_type(h, 1, P_OFFSET, 3);
    x.soemdsp_graph_set_smooth_time(h, 1, P_OFFSET, 0);
  }
  x.soemdsp_graph_add_node(h, 2, SPECTRAL);
  for (const k of [P_FREQ, P_WAVE, P_AMP, P_SHAPE, P_PHASE, P_RES, P_TIMING]) {
    x.soemdsp_graph_set_smooth_type(h, 2, k, 3);
    x.soemdsp_graph_set_smooth_time(h, 2, k, 0);
  }
  const set = (k, v) => x.soemdsp_graph_set_param(h, 2, k, v);
  set(P_WAVE, shape); set(P_SHAPE, A); set(P_RES, B); set(P_FREQ, freq); set(P_AMP, amp); set(P_TIMING, cycle);
  if (reset) x.soemdsp_graph_connect(h, 1, PORT_MONO, 2, PORT_RESET);
  x.soemdsp_graph_compile(h);
  return { h, set, handle: () => x.soemdsp_graph_node_native_handle(h, 2) };
}
function run(g, frames, blk = 128, port = PORT_MONO, onBlock = null) {
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += blk) {
    if (onBlock) onBlock(f);
    const n = Math.min(blk, frames - f);
    x.soemdsp_graph_process_block(g.h, n);
    const q = x.soemdsp_graph_node_port_ptr(g.h, 2, port) / 8;
    out.set(new Float64Array(x.memory.buffer).subarray(q, q + n), f);
  }
  return out;
}
function tables(g) {
  const hd = g.handle();
  const out = [];
  for (let m = 0; m < MIPS; m++) {
    const p = x.soemdsp_spectral_osc_table_ptr(hd, m) / 4;
    const len = x.soemdsp_spectral_osc_table_len(m);
    out.push(Float64Array.from(new Float32Array(x.memory.buffer).subarray(p, p + len)));
  }
  return { mips: out, gain: x.soemdsp_spectral_osc_gain(hd) };
}
function built(shape, A, B) {
  const g = makeGraph({ shape, A, B });
  run(g, 128);
  const t = tables(g);
  x.soemdsp_graph_destroy(g.h);
  return t;
}

// ---- ideal waves (time domain) -------------------------------------------
const frac = (t) => t - Math.floor(t);
const saw = (t) => 2 * frac(t + 0.5) - 1; // -1..1 rising, jump at 0.5
const ideal = {
  0: (A) => (t) => { const p = A; t = frac(t); return t < p ? t / p : -1 + (t - p) / (1 - p); },
  1: (A) => { const w = A, peak = Math.max(2 - 2 * w, 2 * w), dc = 2 * w - 1; return (t) => ((frac(t) < w ? 1 : -1) - dc) / peak; },
  2: (A) => { const p = A; return (t) => { t = frac(t); if (t < p / 2) return 2 * t / p; if (t < 1 - p / 2) return 1 - 2 * (t - p / 2) / (1 - p); return -1 + 2 * (t - 1 + p / 2) / p; }; },
  4: (A, B) => { const S = 2 ** (1 + 4 * A); return (t) => saw(t) * (1 - B / 2) - (B / 4) * (saw(t + 1 / S) + saw(t - 1 / S)); },
};
function dft(fn, n, M = 1 << 16) {
  let a = 0, b = 0;
  for (let j = 0; j < M; j++) {
    const t = (j + 0.5) / M;
    const y = fn(t);
    a += y * Math.cos(2 * Math.PI * n * t);
    b += y * Math.sin(2 * Math.PI * n * t);
  }
  return { a: (2 * a) / M, b: (2 * b) / M };
}

// ---- 1. formula = ideal wave's Fourier series ------------------------------
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
  // Formant: Gaussian in log2 n centred on 2^(7A).
  const f = M.spectralOscShapeCoef(3, 4 / 7, 0.3, 16);
  const off = M.spectralOscShapeCoef(3, 4 / 7, 0.3, 32);
  check(Math.abs(f.a - 1) < 1e-12 && f.b === 0 && off.a < f.a, "Formant peaks at harmonic 2^(7A) with cosine phase");
}

// ---- 2. native tables = exact formula (inverse FFT of the tapered series) ---
const cases = [];
for (const shape of [0, 1, 2]) for (const A of [0.02, 0.25, 0.5, 0.9]) for (const B of [0, 0.3, 0.7, 1]) cases.push([shape, A, B]);
for (const A of [0, 0.4, 1]) for (const B of [0, 0.5, 1]) { cases.push([3, A, B]); cases.push([4, A, B]); }
const builtCache = new Map();
const getBuilt = (s, A, B) => { const k = `${s}|${A}|${B}`; if (!builtCache.has(k)) builtCache.set(k, built(s, A, B)); return builtCache.get(k); };
{
  let worst = 0;
  for (const [s, A, B] of cases) {
    const t = getBuilt(s, A, B);
    for (const m of [0, 2, 5, 8, 10]) {
      const N = 2 ** m;
      const ref = M.spectralOscCycle(s, A, B, N, t.mips[m].length);
      let peak = 0; for (const v of ref) peak = Math.max(peak, Math.abs(v));
      if (peak > 1e-9) worst = Math.max(worst, maxDiff(ref, t.mips[m]) / peak);
    }
  }
  // Native uses the engine's dsp_ln / dsp_exp2 approximations (Formant / Comb): ~1e-5 of peak.
  check(worst < 1e-4, `native mips equal the JS formula cycle (${cases.length} settings x 5 mips): max err ${worst.toExponential(2)} of peak`);
  check(x.soemdsp_spectral_osc_table_harmonics(10) === 1536 && x.soemdsp_spectral_osc_table_len(10) === 4096, "top mip: Nyquist harmonic 1024, harmonics to 1536 (taper < 2e-7), 4096 points");
}

// ---- 3. no overshoot -------------------------------------------------------
{
  let worstIdeal = 0;
  let worstUnit = 0;
  for (const [s, A, B] of cases) {
    const t = getBuilt(s, A, B);
    // The series has no DC: Center Edge's ideal range shifts by its mean (Edge - 0.5).
    const dc = s === 0 ? Math.min(0.999, Math.max(0.001, A)) - 0.5 : 0;
    let lo = -1 - dc, hi = 1 - dc;
    if (s === 1) { const w = Math.min(0.999, Math.max(0.001, A)), peak = Math.max(2 - 2 * w, 2 * w); hi = (2 - 2 * w) / peak; lo = -2 * w / peak; }
    // Sine weights harmonic n by r^(n-1) = r^n / r: the positive Poisson kernel r^|n| times 1/r,
    // so the table times r is the smoothed ideal wave (gain then scales it to peak 1).
    const r = 1 - B * B * B;
    for (const tab of t.mips) {
      for (const v of tab) {
        if (s <= 2) worstIdeal = Math.max(worstIdeal, v * r - hi, lo - v * r);
        worstUnit = Math.max(worstUnit, Math.abs(v * t.gain) - 1);
      }
    }
  }
  check(worstIdeal <= 1e-6, `Center Edge / Pulse / Trisaw: every mip stays inside the ideal (DC-free) wave's range (overshoot ${Math.max(0, worstIdeal).toExponential(2)})`);
  check(worstUnit <= 1e-6, `every shape, every mip: |table x gain| <= 1 (excess ${Math.max(0, worstUnit).toExponential(2)})`);
  // Rendered output over a pitch sweep never exceeds Amplitude.
  let peak = 0;
  for (const s of [0, 1, 2, 3, 4]) {
    const g = makeGraph({ shape: s, A: 0.15, B: 0.4, amp: 0.8 });
    let f = 30;
    run(g, SR, 128, PORT_MONO, () => { f *= 1.03; g.set(P_FREQ, Math.min(f, 20000)); }).forEach((v) => { peak = Math.max(peak, Math.abs(v)); });
    x.soemdsp_graph_destroy(g.h);
  }
  check(peak <= 0.8 + 1e-6, `rendered sweep 30 Hz..20 kHz, all shapes, Amp 0.8: peak ${peak.toFixed(6)}`);
}

// ---- 4. Center Edge ramps are monotone at every Sine -----------------------
function turns(tab, tol) {
  let n = 0, dir = 0;
  const L = tab.length;
  for (let i = 0; i < L; i++) {
    const d = tab[(i + 1) % L] - tab[i];
    if (Math.abs(d) <= tol) continue;
    const s = d > 0 ? 1 : -1;
    if (dir && s !== dir) n++;
    dir = s;
  }
  // close the loop
  for (let i = 0; i < L; i++) { const d = tab[(i + 1) % L] - tab[i]; if (Math.abs(d) > tol) { if ((d > 0 ? 1 : -1) !== dir) n++; break; } }
  return n;
}
{
  let bad = [];
  for (const A of [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98]) {
    for (const B of [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1]) {
      // float64 twin: strict
      for (const m of [0, 1, 3, 6, 8]) {
        const N = 2 ** m;
        const len = x.soemdsp_spectral_osc_table_len(m);
        const ref = M.spectralOscCycle(0, A, B, N, len);
        if (turns(ref, 0) !== 2) bad.push(`js A${A} B${B} m${m}:${turns(ref, 0)}`);
      }
      const t = built(0, A, B);
      t.mips.forEach((tab, m) => { const k = turns(tab, 1e-6); if (k !== 2) bad.push(`native A${A} B${B} m${m}:${k}`); });
    }
  }
  check(bad.length === 0, `Center Edge: one rise and one fall (one max, one min) at 7 Edges x 8 Sines, every mip${bad.length ? " -- " + bad.slice(0, 6).join(", ") : ""}`);
}

// ---- 5. Sine max = pure sine -----------------------------------------------
{
  let worst = 0;
  for (const s of [0, 1, 2]) {
    for (const A of [0.1, 0.5, 0.85]) {
      const t = getBuilt(s, A, 1) ?? built(s, A, 1);
      for (const [m, tab] of t.mips.entries()) {
        const N = 2 ** m;
        const c = M.spectralOscShapeCoef(s, A, 1, 1);
        const g1 = Math.exp(-Math.log(1000) / (N * N));
        const L = tab.length;
        for (let j = 0; j < L; j++) {
          const th = (2 * Math.PI * j) / L;
          worst = Math.max(worst, Math.abs(tab[j] - g1 * (c.a * Math.cos(th) + c.b * Math.sin(th))));
        }
      }
    }
  }
  check(worst < 1e-6, `Sine = 1 leaves only the fundamental (Center Edge / Pulse / Trisaw, every mip): max err ${worst.toExponential(2)}`);
  // Rendered: a pure sine, peak normalised by gain (max 1).
  const g = makeGraph({ shape: 0, A: 0.3, B: 1, freq: 375 });
  const y = run(g, 4096);
  x.soemdsp_graph_destroy(g.h);
  let re = 0, im = 0, e = 0;
  for (let i = 0; i < 4096; i++) { const th = (2 * Math.PI * 375 * i) / SR; re += y[i] * Math.cos(th); im += y[i] * Math.sin(th); e += y[i] * y[i]; }
  re *= 2 / 4096; im *= 2 / 4096;
  let res = 0;
  for (let i = 0; i < 4096; i++) { const th = (2 * Math.PI * 375 * i) / SR; res = Math.max(res, Math.abs(y[i] - re * Math.cos(th) - im * Math.sin(th))); }
  check(res < 2e-4 && Math.abs(Math.hypot(re, im) - 1) < 3e-3, `rendered Sine = 1 at 375 Hz is a unit sine (residual ${res.toExponential(2)}, amp ${Math.hypot(re, im).toFixed(5)})`);
}

// ---- 6. rebuild: exact new shape after a short crossfade, no snapshots ------
{
  const blk = 128, change = 128 * 20, frames = 128 * 80;
  const oldP = { shape: 0, A: 0.5, B: 0.1 }, newP = { shape: 2, A: 0.3, B: 0.2 };
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
  check(settle > change && fadeLen <= 128 * 4 + Math.ceil(0.02 * SR) + 128, `after the move: bit-exact new shape after ${fadeLen} samples (${(fadeLen / SR * 1000).toFixed(1)} ms build + 20 ms fade)`);
  check(outside === 0, "during the crossfade every sample lies between the old and new shapes (no snapshot, no jump)");
  const tC = tables(gC), tN = tables(gN);
  check(tC.mips.every((tab, m) => maxDiff(tab, tN.mips[m]) === 0) && tC.gain === tN.gain, "rebuilt tables are identical to a fresh build from the parameters");
  for (const g of [gC, gO, gN]) x.soemdsp_graph_destroy(g.h);
}

// ---- 7. display bake = the formula ----------------------------------------
{
  const p = { shape: 1, shapeA: 0.3, shapeB: 0.25 };
  const bake = M.spectralOscBakeCycle(p, 255);
  const ref = M.spectralOscCycle(1, 0.3, 0.25, 85, 255);
  let mn = 0, mx = 0; for (const v of ref) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const g = M.spectralOscGain(1, mn, mx);
  check(maxDiff(bake, ref.map((v) => v * g)) < 1e-12 && Math.max(...bake.map(Math.abs)) <= 1, "face bake is the exact formula cycle (no clipping: peak <= 1)");
}

// ---- 8. Cycle: Free run / Single trigger, Reset is a partial-reset trigger ---
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
  const silentBefore = single.slice(0, 200).every((v) => v === 0);
  const one = maxDiff(single.slice(200, 300), free.slice(200, 300));
  const silentAfter = single.slice(301, 700).every((v) => v === 0);
  check(silentBefore, "Single trigger: silent before the first Reset hit");
  check(one < 1e-12 && single.slice(200, 300).some((v) => Math.abs(v) > 0.5), "Single trigger: the hit plays exactly the free-run cycle from phase 0");
  check(silentAfter, "Single trigger: silent after one cycle until the next hit");
  const restart = renderGates({ ...opts, cycle: 0 }, [[740, 1]], frames);
  check(maxDiff(single.slice(740, 840), restart.slice(740, 840)) < 1e-12 && single.slice(841, 1200).every((v) => v === 0), "Single trigger: a hit mid-cycle restarts the cycle");
  check(free.slice(0, 200).some((v) => Math.abs(v) > 0.5) && free.slice(300, 1200).some((v) => Math.abs(v) > 0.5), "Free run: plays before and after hits");
  // Partial reset: height 0.5 at phase 0.4 moves half way to 0 -> 0.2.
  const ph = renderGates({ ...opts, cycle: 0 }, [[40, 0.5]], 100, PORT_SAW);
  check(Math.abs(ph[40] - 0.2) < 1e-9 && Math.abs(ph[39] - 0.39) < 1e-9, `Reset height 0.5 at phase 0.4 lands on 0.2 (got ${ph[40].toFixed(6)})`);
  const back = renderGates({ ...opts, cycle: 0 }, [[70, -0.5]], 100, PORT_SAW);
  // phase 0.7: shortest way to 0 is forward (+0.3); h < 0 goes the long way (-0.7): 0.7 - 0.35 = 0.35
  check(Math.abs(back[70] - 0.35) < 1e-9, `Reset height -0.5 at phase 0.7 goes the long way to 0.35 (got ${back[70].toFixed(6)})`);
}

// ---- 9. CPU ----------------------------------------------------------------
{
  const seconds = 10, blk = 128, frames = SR * seconds;
  const time = (setup, voices) => {
    const gs = Array.from({ length: voices }, () => makeGraph({ shape: 0, A: 0.4, B: 0.3, freq: 110 }));
    const t0 = process.hrtime.bigint();
    for (let f = 0; f < frames; f += blk) {
      for (const g of gs) { setup(g, f); x.soemdsp_graph_process_block(g.h, blk); }
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    gs.forEach((g) => x.soemdsp_graph_destroy(g.h));
    return ms / voices;
  };
  const steady = time(() => {}, 4);
  const moving = time((g, f) => g.set(P_SHAPE, 0.1 + 0.8 * (0.5 + 0.5 * Math.sin(f / 9000))), 4);
  const audioMs = seconds * 1000;
  console.log(`CPU  steady: ${(steady / audioMs * 100).toFixed(3)} % of one core per voice (${(audioMs / steady).toFixed(0)}x realtime)`);
  console.log(`CPU  Edge moving every block (rebuild + fade back to back): ${(moving / audioMs * 100).toFixed(3)} % per voice (${(audioMs / moving).toFixed(0)}x realtime)`);
  check(moving / audioMs < 0.05, "CPU: continuous rebuild stays under 5 % of a core per voice");
}

// ---- 10. 128 instances in one graph ------------------------------------------
{
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  let added = 0;
  for (let i = 0; i < 128; i++) {
    const id = 10 + i;
    if (x.soemdsp_graph_add_node(h, id, SPECTRAL) === 0) added++;
    x.soemdsp_graph_set_param(h, id, P_WAVE, i % 5);
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
    const handle = x.soemdsp_graph_node_native_handle(h, id);
    if (handle > 0 && y.some((v) => v !== 0)) live++;
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