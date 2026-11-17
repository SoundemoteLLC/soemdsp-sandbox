// Bit-identity: process_block (tap-major SIMD) must match a sample() loop.
// process_block (128-sample SIMD path) must match a sample() loop bit-identically,
// including mid-block param changes (split runs) and crossfades.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules", "velvet_reverb", "velvet_reverb.wasm")));
const x = (await WebAssembly.instantiate(mod, {})).exports;
const FS = 48000;
const B = x.soemdsp_velvet_reverb_block_max_frames();

function heap() { return new Float64Array(x.memory.buffer); }
const offL = () => x.soemdsp_velvet_reverb_block_in_l() >> 3;
const offR = () => x.soemdsp_velvet_reverb_block_in_r() >> 3;
const offOL = () => x.soemdsp_velvet_reverb_block_out_l() >> 3;
const offOR = () => x.soemdsp_velvet_reverb_block_out_r() >> 3;
const offM = () => x.soemdsp_velvet_reverb_block_mix() >> 3;

function paramsAt(i, opts) {
  let t = opts.taps, d = opts.dark, dec = opts.decay, tl = opts.tail, m = opts.mix, spread = opts.spread;
  const mc = opts.midChange;
  if (mc && i >= mc.at) {
    if (mc.dark != null) d = mc.dark;
    if (mc.decay != null) dec = mc.decay;
    if (mc.taps != null) t = mc.taps;
    if (mc.mix != null) m = mc.mix;
    if (mc.tail != null) tl = mc.tail;
    if (mc.spread != null) spread = mc.spread;
  }
  return { t, d, dec, tl, m, spread };
}

function sameParams(a, b) {
  return a.t === b.t && a.d === b.d && a.dec === b.dec && a.tl === b.tl && a.m === b.m && a.spread === b.spread;
}

function runSample(opts) {
  const h = x.soemdsp_velvet_reverb_create(FS);
  x.soemdsp_velvet_reverb_set_seed(h, opts.seed);
  if (opts.display) x.soemdsp_velvet_reverb_set_display(h, 1);
  const L = new Float64Array(opts.n), R = new Float64Array(opts.n);
  for (let i = 0; i < opts.n; i += 1) {
    const p = paramsAt(i, opts);
    const v = opts.input(i);
    L[i] = x.soemdsp_velvet_reverb_sample(h, v, v, p.t, p.d, p.spread, p.m, FS, p.dec, p.tl, opts.amp, opts.skew, opts.gap, opts.tailRand, opts.tailCurve);
    R[i] = x.soemdsp_velvet_reverb_right(h);
  }
  x.soemdsp_velvet_reverb_destroy(h);
  return { L, R };
}

function runBlock(opts) {
  const h = x.soemdsp_velvet_reverb_create(FS);
  x.soemdsp_velvet_reverb_set_seed(h, opts.seed);
  if (opts.display) x.soemdsp_velvet_reverb_set_display(h, 1);
  const L = new Float64Array(opts.n), R = new Float64Array(opts.n);
  let i = 0;
  while (i < opts.n) {
    const p0 = paramsAt(i, opts);
    let n = 1;
    while (i + n < opts.n && n < B && sameParams(p0, paramsAt(i + n, opts))) n += 1;
    const H = heap();
    const iL = offL(), iR = offR(), iM = offM(), oL = offOL(), oR = offOR();
    for (let k = 0; k < n; k += 1) {
      const v = opts.input(i + k);
      H[iL + k] = v;
      H[iR + k] = v;
      H[iM + k] = p0.m;
    }
    x.soemdsp_velvet_reverb_process_block(
      h, x.soemdsp_velvet_reverb_block_in_l(), x.soemdsp_velvet_reverb_block_in_r(),
      x.soemdsp_velvet_reverb_block_out_l(), x.soemdsp_velvet_reverb_block_out_r(),
      n, p0.t, p0.d, p0.spread, x.soemdsp_velvet_reverb_block_mix(),
      FS, p0.dec, p0.tl, opts.amp, opts.skew, opts.gap, opts.tailRand, opts.tailCurve
    );
    const H2 = heap();
    for (let k = 0; k < n; k += 1) {
      L[i + k] = H2[oL + k];
      R[i + k] = H2[oR + k];
    }
    i += n;
  }
  x.soemdsp_velvet_reverb_destroy(h);
  return { L, R };
}

function eq(a, b) {
  if (a.length !== b.length) return { ok: false, at: -1 };
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return { ok: false, at: i, a: a[i], b: b[i] };
  }
  return { ok: true };
}

const base = { seed: 1, amp: -60, skew: 0, gap: 1, tailRand: 1, tailCurve: 0, mix: 1, spread: 1, tail: 0, display: false };
const cases = [
  { name: "default-ir-block", ...base, taps: 64, dark: 1, decay: 0.025, n: 4096, input: (i) => (i === 0 ? 1 : 0) },
  { name: "1024-1s-noise", ...base, taps: 1024, dark: 1, decay: 1, n: 4096, input: (i) => ((i * 17) % 11) / 11 - 0.5 },
  { name: "1024-6s-impulse-head", ...base, taps: 1024, dark: 1, decay: 6, n: 2048, input: (i) => (i === 0 ? 1 : 0) },
  { name: "300-d64-alt", ...base, taps: 300, dark: 64, decay: 1, n: 2048, input: (i) => (i & 1 ? 0.1 : -0.1) },
  { name: "silence-then-noise", ...base, taps: 64, dark: 8, decay: 0.2, n: 4096, input: (i) => (i < 1000 ? 0 : ((i * 13) % 7) / 7 - 0.4) },
  { name: "long-silence", ...base, taps: 128, dark: 1, decay: 0.5, n: 8192, input: (i) => (i < 20 ? 0.3 : 0) },
  { name: "midblock-dark", ...base, taps: 128, dark: 1, decay: 0.5, n: 2048, input: (i) => (i % 3 === 0 ? 0.2 : -0.1), midChange: { at: 200, dark: 16 } },
  { name: "midblock-mix", ...base, taps: 64, dark: 2, decay: 0.25, n: 1024, input: (i) => (i === 0 ? 1 : 0), midChange: { at: 67, mix: 0.3 } },
  { name: "midblock-length", ...base, taps: 256, dark: 1, decay: 0.4, n: 3072, input: (i) => Math.sin(i * 0.02), midChange: { at: 513, decay: 0.8 } },
  { name: "fade-then-stable", ...base, taps: 64, dark: 1, decay: 1, n: 4800, input: (i) => (i < 200 ? 0.5 : 0.1), midChange: { at: 128, dark: 32 } },
  { name: "display-on", ...base, taps: 64, dark: 4, decay: 0.2, n: 2048, display: true, input: (i) => (i < 4 ? 1 : 0) },
  { name: "odd-frames-via-mix-split", ...base, taps: 80, dark: 3, decay: 0.3, n: 1000, input: (i) => Math.sin(i * 0.1), midChange: { at: 3, mix: 0.9 } },
];

let failed = 0;
for (const c of cases) {
  const a = runSample(c);
  const b = runBlock(c);
  const L = eq(a.L, b.L);
  const R = eq(a.R, b.R);
  const ok = L.ok && R.ok;
  if (!ok) failed += 1;
  console.log(ok ? "ok  " : "FAIL", c.name, ok ? "" : `L@${L.at} ${L.a} vs ${L.b}  R@${R.at}`);
}
if (failed) { console.error(failed, "block/sample mismatch(es)"); process.exit(1); }
console.log("all process_block vs sample() checks passed");
