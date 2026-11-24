// Additive Generator shape 10 "CenterSaw" (Center Saw): ramp 0 -> 1 over [0, p), hard edge
// 1 -> -1 at p, ramp -1 -> 0 over [p, 1). Morph = edge position p (like PWM; the
// Pulse shapes' duty, clamped 0.001..0.999). p = 0.5 is Trisaw at Morph 1.0.
// Checks the native partials (combined wasm) and the JS mirror against the exact
// Fourier coefficients of the naive waveform (DC dropped), the summed waveform
// against the naive one, the Trisaw match, morph extremes, and the definition.
//
//   node scripts/test_additive_center_saw.mjs [path/to/soemdsp_combined.wasm]
// Exit code 1 if anything fails.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = process.argv[2] || path.join(root, "native_modules", "combined", "soemdsp_combined.wasm");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures += 1;
}

const mod = await WebAssembly.compile(fs.readFileSync(wasmPath));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
const x = (await WebAssembly.instantiate(mod, imports)).exports;

const SR = 48000, ADD_GEN = 111, GEN = 3;
const P_WAVE = 11, P_SHAPE = 13, P_STAGES = 22;
const G = 0.1 * Math.PI * Math.PI; // shared level: Trisaw's 0.2 ~ 2/pi^2
const H = 64;

// Native Graph partials of one Generator setting -> [{ratio, amp, phase}].
function nativePartials(waveform, morph, harmonics = H) {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  x.soemdsp_graph_add_node(h, GEN, ADD_GEN);
  for (const [k, v] of [[P_WAVE, waveform], [P_SHAPE, morph], [P_STAGES, harmonics]]) {
    x.soemdsp_graph_set_smooth_type(h, GEN, k, 3);
    x.soemdsp_graph_set_smooth_time(h, GEN, k, 0);
    x.soemdsp_graph_set_param(h, GEN, k, v);
  }
  x.soemdsp_graph_compile(h);
  x.soemdsp_graph_process_block(h, 128);
  const n = x.soemdsp_graph_yellow_harmonics(h, GEN);
  const f32 = (ptr) => Array.from(new Float32Array(x.memory.buffer, ptr, n));
  const ratio = f32(x.soemdsp_graph_yellow_ratio_ptr(h, GEN));
  const amp = f32(x.soemdsp_graph_yellow_amplitude_ptr(h, GEN));
  const phase = f32(x.soemdsp_graph_yellow_phase_ptr(h, GEN));
  x.soemdsp_graph_destroy(h);
  return ratio.map((r, i) => ({ ratio: r, amp: amp[i], phase: phase[i] }));
}

// JS mirror (public/modules/additiveGraph/additive-graph-math.js).
const bag = { console, Math, Number, Object, Array, String, Boolean, JSON, Float32Array, Float64Array, isFinite, isNaN, Infinity, NaN, undefined };
const ctx = new Proxy(bag, {
  has: () => true,
  get(t, p) { if (p === Symbol.unscopables) return undefined; if (p in t) return t[p]; const fn = function stub(...a) { return a.length ? a[0] : undefined; }; t[p] = fn; return fn; },
  set(t, p, v) { t[p] = v; return true; },
});
bag.globalThis = ctx;
vm.createContext(ctx);
bag.nodeGraphFiniteNumber = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
vm.runInContext(read("public/modules/additiveGraph/additive-graph-math.js") + "\nthis.__wp = additiveGraphWaveformPartial;", ctx);
const jsPartial = bag.__wp;

// Naive Center Saw, DC removed (the additive shapes carry no DC).
const naive = (t, p) => (t < p ? t / p : (t - 1) / (1 - p)) - (p - 0.5);
// Exact coefficients by fine midpoint integration: f = sum a_n cos(2 pi n t) + b_n sin(2 pi n t).
function naiveCoeffs(p, N, M = 400000) {
  const a = new Float64Array(N + 1), b = new Float64Array(N + 1);
  for (let j = 0; j < M; j++) {
    const t = (j + 0.5) / M, f = naive(t, p);
    for (let n = 1; n <= N; n++) { const w = 2 * Math.PI * n * t; a[n] += f * Math.cos(w); b[n] += f * Math.sin(w); }
  }
  for (let n = 1; n <= N; n++) { a[n] *= 2 / M; b[n] *= 2 / M; }
  return { a, b };
}
// Partial amp*sin(2 pi (n t + phase)) -> (a_n, b_n) at unit level.
const ab = (amp, phase) => ({ a: amp * Math.sin(2 * Math.PI * phase) / G, b: amp * Math.cos(2 * Math.PI * phase) / G });

const PS = [0.5, 0.3, 0.8, 0.1, 0.95];
// ---------------------------------------------------------------- 1. series = exact Fourier coefficients
for (const p of PS) {
  const ref = naiveCoeffs(p, 24);
  const nat = nativePartials(10, p);
  let wn = 0, wj = 0, ratiosOk = nat.length === H;
  for (let n = 1; n <= 24; n++) {
    const q = nat[n - 1];
    if (Math.abs(q.ratio - n) > 1e-6) ratiosOk = false;
    const c = ab(q.amp, q.phase);
    wn = Math.max(wn, Math.abs(c.a - ref.a[n]), Math.abs(c.b - ref.b[n]));
    const jp = jsPartial(10, n, p);
    const cj = ab(jp.amplitude, jp.phase);
    wj = Math.max(wj, Math.abs(cj.a - ref.a[n]), Math.abs(cj.b - ref.b[n]));
  }
  check(ratiosOk && wn < 2e-5, `Center Saw p=${p}: native partials 1..24 = exact Fourier coefficients of the naive shape (worst ${wn.toExponential(2)}, float32)`);
  check(wj < 1e-8, `Center Saw p=${p}: JS mirror = exact Fourier coefficients (worst ${wj.toExponential(2)})`);
}

// ---------------------------------------------------------------- 2. summed waveform = naive waveform
for (const p of PS) {
  let worst = 0;
  const N = 3000;
  const parts = []; for (let n = 1; n <= N; n++) parts.push(jsPartial(10, n, p));
  for (let s = 0; s < 40; s++) {
    const t = (s + 0.5) / 40;
    if (Math.abs(t - p) < 0.05 || t < 0.05 || t > 0.95) continue; // away from the edge and the wrap
    let sum = 0; for (let n = 1; n <= N; n++) sum += parts[n - 1].amplitude * Math.sin(2 * Math.PI * (n * t + parts[n - 1].phase));
    worst = Math.max(worst, Math.abs(sum / G - naive(t, p)));
  }
  check(worst < 2e-3, `Center Saw p=${p}: 3000-partial sum matches the naive ramp/edge/ramp (minus DC ${(p - 0.5).toFixed(2)}) away from the edges (worst ${worst.toExponential(2)})`);
  // Native 64-partial waveform vs the same partial sum from the JS mirror.
  const nat = nativePartials(10, p);
  let wv = 0;
  for (let s = 0; s < 200; s++) {
    const t = s / 200;
    let a = 0, b = 0;
    for (let n = 1; n <= H; n++) {
      a += nat[n - 1].amp * Math.sin(2 * Math.PI * (n * t + nat[n - 1].phase));
      const j = jsPartial(10, n, p); b += j.amplitude * Math.sin(2 * Math.PI * (n * t + j.phase));
    }
    wv = Math.max(wv, Math.abs(a - b));
  }
  check(wv < 1e-4, `Center Saw p=${p}: native 64-partial waveform = JS mirror (worst ${wv.toExponential(2)})`);
}

// ---------------------------------------------------------------- 3. centred = Trisaw at Morph 1.0
{
  const cs = nativePartials(10, 0.5), tri = nativePartials(0, 1.0);
  let wc = 0, wv = 0;
  for (let n = 1; n <= H; n++) {
    const c = ab(cs[n - 1].amp, cs[n - 1].phase), t = ab(tri[n - 1].amp, tri[n - 1].phase);
    wc = Math.max(wc, Math.abs(c.a - t.a) * G, Math.abs(c.b - t.b) * G);
  }
  for (let s = 0; s < 400; s++) {
    const t = s / 400; let a = 0, b = 0;
    for (let n = 1; n <= H; n++) { a += cs[n - 1].amp * Math.sin(2 * Math.PI * (n * t + cs[n - 1].phase)); b += tri[n - 1].amp * Math.sin(2 * Math.PI * (n * t + tri[n - 1].phase)); }
    wv = Math.max(wv, Math.abs(a - b));
  }
  // Trisaw clamps its morph to 0.999, so it sits 0.1% short of the exact p -> 1 limit Center Saw hits.
  check(wc < 1e-3 && wv < 5e-3, `Center Saw Morph 0.5 = Trisaw Morph 1.0 (partials worst ${wc.toExponential(2)}, waveform worst ${wv.toExponential(2)} of peak ~1)`);
  let wl = 0;
  for (let n = 1; n <= H; n++) { const c = ab(cs[n - 1].amp, cs[n - 1].phase); wl = Math.max(wl, Math.abs(c.a), Math.abs(c.b * G - 0.2 * Math.PI * (n % 2 ? 1 : -1) / n)); }
  check(wl < 1e-5, `Center Saw Morph 0.5 = the exact Trisaw p->1 series 0.2*pi*(-1)^(n+1)/n (worst ${wl.toExponential(2)})`);
}

// ---------------------------------------------------------------- 4. morph extremes are safe
{
  let ok = true, worstAmp = 0;
  for (const m of [0, 1, -3, 4, 0.0005, 0.9995]) {
    for (const q of nativePartials(10, m, 1024)) {
      if (!Number.isFinite(q.amp) || !Number.isFinite(q.phase) || q.amp < 0) ok = false;
      worstAmp = Math.max(worstAmp, q.amp);
    }
  }
  check(ok && worstAmp <= 1, `Center Saw: Morph 0, 1 and out of range give finite partials (clamped to 0.001..0.999; largest amp ${worstAmp.toFixed(4)})`);
  const a = nativePartials(10, 0), b = nativePartials(10, 0.001);
  check(a.every((q, i) => Object.is(q.amp, b[i].amp) && Object.is(q.phase, b[i].phase)), "Center Saw: Morph 0 = Morph 0.001 (same clamp as the Pulse shapes)");
}

// ---------------------------------------------------------------- 5. definition + other shapes untouched
{
  const dbag = { console, Object, Math, Number, String, Boolean, Array, Map, Set, JSON, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined };
  const dctx = new Proxy(dbag, {
    has: () => true,
    get(t, p) { if (p === Symbol.unscopables) return undefined; if (p in t) return t[p]; const fn = function stub(...a) { return a.length ? a[0] : []; }; t[p] = fn; return fn; },
    set(t, p, v) { t[p] = v; return true; },
  });
  dbag.globalThis = dctx;
  dbag.window = dctx;
  vm.createContext(dctx);
  vm.runInContext(read("public/node-graph-module-definitions.js") + "\nthis.__exportedDefs = nodeGraphModuleDefinitions;", dctx);
  const defs = dbag.__exportedDefs;
  const wf = defs.additiveGenerator.parameters.find((p) => p.key === "waveform");
  const before = ["Trisaw", "Saw", "Square", "PulseCenter", "PulseLeft", "PulseRight", "Triangle", "RectSine", "Even", "Odd"];
  check(wf && wf.choices.length === 11 && wf.choices[10] === "CenterSaw" && wf.max === "10" && wf.defaultValue === "0"
    && wf.choices.slice(0, 10).join("|") === before.join("|"),
    `definition: Waveform appends "CenterSaw" as index 10 (max 10), the first ten unchanged (${wf ? wf.choices.join(" | ") : "missing"})`);
  // Waveform 11+ clamps to Center Saw in the engine.
  const c11 = nativePartials(11, 0.3), c10 = nativePartials(10, 0.3);
  check(c11.every((q, i) => Object.is(q.amp, c10[i].amp)), "engine: Waveform above 10 clamps to Center Saw");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;