// Decramped bell regression: the Cookbook Filter Peak (and Graphic EQ bands, same design) must stay close to the
// analog bell all the way to Nyquist, and be at least as accurate as the bilinear RBJ bell.
//
//   node scripts/test_matched_bell.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { Math, Number, globalThis: {}, clampNodeSliderValue: (v, a, b) => Math.max(a, Math.min(b, v)), nodeGraphFiniteNumber: (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "public", "node-graph-cookbook-filter.js"), "utf8") + "\nglobalThis.__f = { c: nodeGraphCookbookFilterCoefficients, bell: nodeGraphMatchedBellCoefficients };", ctx);
const { c: coefficients, bell } = ctx.globalThis.__f;

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failed += 1; };
const fs0 = 44100;
const mag2 = (k, w) => {
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = k.b0 + k.b1 * c1 + k.b2 * c2, ni = -(k.b1 * s1 + k.b2 * s2), dr = 1 + k.a1 * c1 + k.a2 * c2, di = -(k.a1 * s1 + k.a2 * s2);
  return (nr * nr + ni * ni) / (dr * dr + di * di);
};
const analog2 = (w, w0, A, Q) => { const x = w / w0, d = 1 - x * x, nI = x * A / Q, dI = x / (A * Q); return (d * d + nI * nI) / (d * d + dI * dI); };
const worst = (k, f0, dB, Q) => {
  const A = 10 ** (dB / 40), w0 = 2 * Math.PI * f0 / fs0; let e = 0;
  for (let i = 1; i <= 80; i += 1) { const w = Math.PI * i / 81; e = Math.max(e, Math.abs(10 * Math.log10(mag2(k, w) / analog2(w, w0, A, Q)))); }
  return e;
};

// Cookbook mode 7 now returns the decramped bell.
const cases = [[1000, 12, 1], [5000, 12, 1], [10000, 12, 1], [15000, 12, 1], [15000, 12, 4], [18000, 12, 2], [10000, -12, 2], [15000, -12, 1], [18000, -18, 3], [200, 6, 4], [20, 12, 1]];
for (const [f0, dB, Q] of cases) {
  const k = coefficients(7, f0, Q, dB, fs0);
  const e = worst(k, f0, dB, Q);
  check(e < 1.6, `peak ${f0} Hz ${dB} dB Q ${Q}: worst error ${e.toFixed(2)} dB (limit 1.6)`);
  const stable = Math.abs(k.a2) < 1 && Math.abs(k.a1) < 1 + k.a2;
  check(stable, `peak ${f0} Hz ${dB} dB Q ${Q}: stable`);
}
// The old bilinear bell at 15 kHz / +12 dB was 7.6 dB off.
const old = (() => { const A = 10 ** (12 / 40), w0 = 2 * Math.PI * 15000 / fs0, al = Math.sin(w0) / 2, c = Math.cos(w0), a0 = 1 + al / A; return { b0: (1 + al * A) / a0, b1: -2 * c / a0, b2: (1 - al * A) / a0, a1: -2 * c / a0, a2: (1 - al / A) / a0 }; })();
check(worst(old, 15000, 12, 1) > 5 && worst(coefficients(7, 15000, 1, 12, fs0), 15000, 12, 1) < 1.6, "the bilinear bell is >5 dB off at 15 kHz, the decramped one under 1.6 dB");
// A cut is the exact reciprocal of the boost.
const up = coefficients(7, 12000, 2, 9, fs0), dn = coefficients(7, 12000, 2, -9, fs0);
let maxRecip = 0; for (let i = 1; i <= 80; i += 1) { const w = Math.PI * i / 81; maxRecip = Math.max(maxRecip, Math.abs(10 * Math.log10(mag2(up, w) * mag2(dn, w)))); }
check(maxRecip < 1e-6, `cut is the reciprocal of the boost (max ${maxRecip.toExponential(1)} dB)`);
check(bell(1000, 1, 0, fs0).b0 === 1, "0 dB is the identity");
check(bell(22000, 1, 6, fs0) === null || worst(bell(22000, 1, 6, fs0), 22000, 6, 1) < 3, "centre next to Nyquist falls back or stays sane");


// Shelves (modes 8 low, 9 high). A high shelf centred above ~13 kHz has analog poles above Nyquist, so it is only
// partly matchable (3.3 dB at 15 kHz / +12 dB, against ~7 dB for the bilinear shelf).
const analogShelf2 = (mode, w, w0, A, Q) => { const x = w / w0, x2 = x * x, sA = Math.sqrt(A); let nr, ni, dr, di;
  if (mode === 8) { nr = A * (A - x2); ni = A * x * sA / Q; dr = 1 - A * x2; di = x * sA / Q; } else { nr = A * (1 - A * x2); ni = A * x * sA / Q; dr = A - x2; di = x * sA / Q; }
  return (nr * nr + ni * ni) / (dr * dr + di * di); };
for (const [mode, f0, dB, Q, limit] of [[8, 200, 12, 0.707, 0.2], [8, 5000, 12, 0.707, 0.3], [8, 10000, 12, 0.707, 0.6], [8, 15000, 12, 1, 0.8], [8, 15000, -12, 0.707, 0.8], [9, 5000, 12, 0.707, 0.3], [9, 10000, 12, 0.707, 0.8], [9, 8000, -9, 1.5, 1.2], [9, 15000, 12, 1, 3.5]]) {
  const k = coefficients(mode, f0, Q, dB, fs0), A = 10 ** (Math.abs(dB) / 40), w0 = 2 * Math.PI * f0 / fs0; let e = 0;
  for (let i = 1; i <= 80; i += 1) { const w = Math.PI * i / 81, t = analogShelf2(mode, w, w0, A, Q); e = Math.max(e, Math.abs(10 * Math.log10(mag2(k, w) / (dB >= 0 ? t : 1 / t)))); }
  check(e < limit, `${mode === 8 ? "low" : "high"} shelf ${f0} Hz ${dB} dB Q ${Q}: worst error ${e.toFixed(2)} dB (limit ${limit})`);
  check(Math.abs(k.a2) < 1 && Math.abs(k.a1) < 1 + k.a2, `${mode === 8 ? "low" : "high"} shelf ${f0} Hz ${dB} dB: stable`);
}

// The native C++ (cookbook_filter.wasm) must produce the same bell: measure its impulse response against the analog bell.
{
  const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules", "cookbook_filter", "cookbook_filter.wasm")));
  const imports = {};
  for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
  const x = (await WebAssembly.instantiate(mod, imports)).exports;
  for (const [f0, dB, Q] of [[5000, 12, 1], [15000, 12, 1], [18000, 12, 2], [10000, -12, 2]]) {
    const h = x.soemdsp_cookbook_filter_create(), N = 4096, ir = new Float64Array(N);
    for (let n = 0; n < N; n += 1) ir[n] = x.soemdsp_cookbook_filter_sample(h, n === 0 ? 1 : 0, 7, f0, Q, dB, 1, 0, fs0);
    x.soemdsp_cookbook_filter_destroy(h);
    const A = 10 ** (dB / 40), w0 = 2 * Math.PI * f0 / fs0; let e = 0;
    for (let i = 1; i <= 60; i += 1) { const w = Math.PI * i / 61; let re = 0, im = 0; for (let n = 0; n < N; n += 1) { re += ir[n] * Math.cos(w * n); im -= ir[n] * Math.sin(w * n); }
      e = Math.max(e, Math.abs(10 * Math.log10((re * re + im * im) / analog2(w, w0, A, Q)))); }
    check(e < 1.6, `native cookbook wasm peak ${f0} Hz ${dB} dB Q ${Q}: worst error ${e.toFixed(2)} dB`);
  }
}
if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("matched bell: all ok");
