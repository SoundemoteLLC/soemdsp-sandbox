// Dark Velvet Reverb (velvet_reverb): continuous Darkness / Tail Darkness and
// Decay as the tail length (RT60, the tail always fades out, never gated).
// Loads native_modules/velvet_reverb/velvet_reverb.wasm and checks impulse responses.
//   node scripts/test_velvet_reverb.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };

const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules", "velvet_reverb", "velvet_reverb.wasm")));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
const x = (await WebAssembly.instantiate(mod, imports)).exports;
if (typeof x.soemdsp_memory_set_budget_mb === "function") x.soemdsp_memory_set_budget_mb(256);

const FS = 48000;
check(x.soemdsp_velvet_reverb_version() >= 2, `velvet_reverb version ${x.soemdsp_velvet_reverb_version()}`);

// Wet impulse response (Mix 1): impulse on both channels at sample 0.
function ir({ density = 2500, taps = 64, dark = 1, spread = 1, decay = 0.025, tail = 0, seed = 1, n } = {}) {
  const h = x.soemdsp_velvet_reverb_create();
  if (!h) throw new Error("create failed");
  x.soemdsp_velvet_reverb_set_seed(h, seed);
  const len = n ?? Math.ceil(decay * FS) + 2048;
  const L = new Float64Array(len), R = new Float64Array(len);
  for (let i = 0; i < len; i += 1) {
    const v = i === 0 ? 1 : 0;
    L[i] = x.soemdsp_velvet_reverb_sample(h, v, v, density, taps, dark, spread, 1, FS, decay, tail);
    R[i] = x.soemdsp_velvet_reverb_right(h);
  }
  x.soemdsp_velvet_reverb_destroy(h);
  return { L, R };
}
const energy = (a, from = 0, to = a.length) => { let e = 0; for (let i = from; i < to; i += 1) e += a[i] * a[i]; return e; };
// Brightness: energy of the first difference over energy (higher = brighter).
const bright = (a) => { let d = 0; for (let i = 1; i < a.length; i += 1) d += (a[i] - a[i - 1]) ** 2; return d / energy(a); };
const dist = (a, b) => { let e = 0; for (let i = 0; i < a.length; i += 1) e += (a[i] - b[i]) ** 2; return Math.sqrt(e); };
const db = (v) => 10 * Math.log10(v);

// ---- Fractional Darkness: 1.66 is its own colour, between 1 and 2
{
  const opts = { decay: 0.1, taps: 256 };
  const a = ir({ ...opts, dark: 1 }).L, b = ir({ ...opts, dark: 1.66 }).L, c = ir({ ...opts, dark: 2 }).L;
  check(dist(a, b) > 1e-3 && dist(b, c) > 1e-3, `Darkness 1.66 differs from 1 (${dist(a, b).toFixed(4)}) and from 2 (${dist(b, c).toFixed(4)})`);
  const ba = bright(a), bb = bright(b), bc = bright(c);
  check(ba > bb && bb > bc, `brightness falls 1 -> 1.66 -> 2: ${ba.toFixed(4)} > ${bb.toFixed(4)} > ${bc.toFixed(4)}`);
}

// ---- Sweeping Darkness is continuous (no jump at whole numbers)
{
  const steps = [];
  let prev = null, prevB = null;
  const bs = [];
  for (let k = 0; k <= 300; k += 1) {
    const d = 1 + k * 0.01;
    const r = ir({ decay: 0.05, taps: 128, dark: d, n: 4000 }).L;
    if (prev) steps.push({ d, s: dist(prev, r) });
    bs.push(bright(r));
    prev = r;
  }
  const sorted = steps.map((s) => s.s).sort((p, q) => p - q);
  const median = sorted[sorted.length >> 1];
  const max = sorted[sorted.length - 1];
  const atInt = steps.filter((s) => Math.abs(s.d - Math.round(s.d)) < 1e-9).map((s) => s.s);
  check(max < 8 * median, `Darkness sweep 1..4 in 0.01 steps: largest step ${max.toFixed(5)} vs median ${median.toFixed(5)}`);
  check(atInt.every((v) => v < 4 * median), `no jump crossing 2, 3, 4: ${atInt.map((v) => v.toFixed(5)).join(", ")} (median ${median.toFixed(5)})`);
  let mono = 0;
  for (let i = 1; i < bs.length; i += 1) if (bs[i] > bs[i - 1] * 1.02) mono += 1;
  check(mono === 0, `brightness keeps falling as Darkness rises (${mono} rises over 2%)`);
}

// ---- Tail Darkness: continuous too; 0 = off (same as Darkness everywhere)
{
  const base = ir({ dark: 3, tail: 0, decay: 0.2, taps: 128 }).L;
  const same = ir({ dark: 3, tail: 3, decay: 0.2, taps: 128 }).L;
  check(dist(base, same) < 1e-12, "Tail Darkness 0 is off (same as Tail Darkness = Darkness)");
  const t1 = ir({ dark: 3, tail: 20, decay: 0.2, taps: 128 }).L, t2 = ir({ dark: 3, tail: 20.5, decay: 0.2, taps: 128 }).L, t3 = ir({ dark: 3, tail: 21, decay: 0.2, taps: 128 }).L;
  check(dist(t1, t2) > 1e-6 && dist(t2, t3) > 1e-6, "Tail Darkness 20.5 differs from 20 and 21");
}

// ---- Decay = tail length: longer with more Decay, always fades out (no gate)
{
  const lens = [];
  for (const decay of [0.05, 0.2, 1]) {
    const r = ir({ decay, taps: 256, density: 2500 }).L;
    let last = 0;
    for (let i = 0; i < r.length; i += 1) if (Math.abs(r[i]) > 1e-12) last = i;
    lens.push(last / FS);
  }
  check(lens[0] < lens[1] && lens[1] < lens[2], `more Decay = longer tail: ${lens.map((v) => v.toFixed(3)).join(" < ")} s`);

  let worstEnd = -Infinity, worstMono = 0, cases = 0, after = 0;
  for (const taps of [8, 64, 256, 4096]) {
    for (const density of [50, 2500, 20000]) {
      for (const decay of [0.001, 0.025, 0.5, 2, 5]) {
        for (const dark of [1, 64]) {
          const len = Math.ceil(decay * FS);
          const r = ir({ taps, density, decay, dark, n: len + 2048 }).L;
          const seg = 10;
          const segE = [];
          for (let k = 0; k < seg; k += 1) segE.push(energy(r, Math.floor(k * len / seg), Math.floor((k + 1) * len / seg)));
          const first = Math.max(...segE.slice(0, 2));
          const endDb = db((segE[seg - 1] + 1e-300) / (first + 1e-300)) / 1; // energy ratio
          // Expected: last tenth of an RT60 tail is ~-54 dB below the first; sparse taps make it noisy.
          if (taps * 1 >= 8 && Math.min(taps, density * decay) >= 20) worstEnd = Math.max(worstEnd, endDb);
          // Energy per tenth should fall overall (allow sparse noise): compare halves.
          const h1 = segE.slice(0, 5).reduce((p, q) => p + q, 0), h2 = segE.slice(5).reduce((p, q) => p + q, 0);
          if (Math.min(taps, density * decay) >= 20 && !(h2 < h1 * 0.01)) worstMono += 1;
          // Nothing after the tail (plus the widest pulse and a sample of rounding).
          if (energy(r, len + 70) > 0) after += 1;
          cases += 1;
        }
      }
    }
  }
  check(worstEnd < -40, `last tenth of the tail is at most ${worstEnd.toFixed(1)} dB vs its start over ${cases} Taps/Density/Decay/Darkness cases (fades out, not gated)`);
  check(worstMono === 0, `second half of the tail is >20 dB below the first in every dense case (${worstMono} misses)`);
  check(after === 0, `no output past Decay + pulse width in any case (${after} misses)`);
}

// ---- Sweeping Decay, Density and Tap Count is continuous
{
  const sweep = (name, values, mk) => {
    let prev = null; const s = [];
    for (const v of values) { const r = ir({ ...mk(v), n: 30000 }).L; if (prev) s.push(dist(prev, r)); prev = r; }
    const sorted = [...s].sort((p, q) => p - q);
    const med = sorted[sorted.length >> 1], max = sorted[sorted.length - 1];
    check(max < 10 * med + 1e-9, `${name} sweep: largest step ${max.toFixed(5)} vs median ${med.toFixed(5)}`);
  };
  sweep("Decay 0.1..0.3 s (Density-limited, 256 taps)", Array.from({ length: 101 }, (_, i) => 0.1 + i * 0.002), (v) => ({ decay: v, taps: 256, density: 600 }));
  // Here the taps spread with the length, so a step must be under a sample at the last tap.
  sweep("Decay 0.2..0.201 s (Tap Count-limited)", Array.from({ length: 101 }, (_, i) => 0.2 + i * 0.00001), (v) => ({ decay: v, taps: 64, density: 2500 }));
  sweep("Density 300..301 Hz (last tap fades in/out)", Array.from({ length: 101 }, (_, i) => 300 + i * 0.01), (v) => ({ decay: 0.3, taps: 256, density: v }));
}

// ---- Wet level stays put across Darkness (energy normalization with fractional widths)
{
  const noiseIn = (n, seed) => { let s = seed >>> 0 || 1; const a = new Float64Array(n); for (let i = 0; i < n; i += 1) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; a[i] = (s / 4294967296) * 2 - 1; } return a; };
  const input = noiseIn(FS, 7);
  const level = (dark) => {
    const h = x.soemdsp_velvet_reverb_create(); x.soemdsp_velvet_reverb_set_seed(h, 3);
    let e = 0;
    for (let i = 0; i < input.length; i += 1) { const v = x.soemdsp_velvet_reverb_sample(h, input[i], input[i], 2500, 256, dark, 1, 1, FS, 0.1, 0); if (i > FS / 4) e += v * v; }
    x.soemdsp_velvet_reverb_destroy(h);
    return e;
  };
  const ref = level(1);
  const spreadDb = [1.5, 2, 4.33, 16.5, 64].map((d) => db(level(d) / ref));
  // Whiter noise through a lowpass loses its highs; the band below Darkness keeps the level.
  check(spreadDb.every((v) => v < 0.5 && v > -9), `wet level vs Darkness 1 at 1.5/2/4.33/16.5/64: ${spreadDb.map((v) => v.toFixed(2)).join(", ")} dB`);
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("all velvet reverb checks passed");