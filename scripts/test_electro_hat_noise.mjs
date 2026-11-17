// Electro Hat noise source: Modal Snare Freq / Q / Tilt shaper, mixed by Metal.
//   node scripts/test_electro_hat_noise.mjs
// 1. version >= 4
// 2. Metal 1 (808): L == R, and Freq / Q / Tilt do not change the voice
//    (existing default / Metal-1 patches stay bit-identical).
// 3. Metal 0: Tilt +1 is brighter than Tilt -1; Noise Freq 500 vs 12000 differs.
// 4. Reset reseeds the noise (a repeated hit+reset sequence matches).
// 5. No NaN / Inf on a closed hit.
import fs from "node:fs";
import path from "node:path";
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
const finite = (xs) => xs.every((v) => Number.isFinite(v));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hfEnergy = (xs) => {
  let e = 0;
  for (let i = 1; i < xs.length; i += 1) { const d = xs[i] - xs[i - 1]; e += d * d; }
  return e;
};
const rms = (xs) => {
  let e = 0;
  for (let i = 0; i < xs.length; i += 1) e += xs[i] * xs[i];
  return Math.sqrt(e / xs.length);
};

const hat = await load("native_modules/electro_hat/electro_hat.wasm");
check(hat.soemdsp_electro_hat_version() >= 4, `electro_hat version ${hat.soemdsp_electro_hat_version()}`);

// sample(handle, closed, open, reset, algorithm, tune, tone, closedDecay,
//   openDecay, metal, amplitude, sampleRate, recalc, noiseFreq, noiseQ, noiseTilt)
const render = (opts = {}) => {
  const {
    n = 4000,
    algorithm = 0,
    metal = 1,
    noiseFreq = 3000,
    noiseQ = 1,
    noiseTilt = 0,
    hitAt = 10,
    vel = 1,
  } = opts;
  const h = hat.soemdsp_electro_hat_create();
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const closed = i === hitAt ? vel : 0;
    L[i] = hat.soemdsp_electro_hat_sample(
      h, closed, 0, 0, algorithm, 1, 0.5, 0.05, 0.5, metal, 1, SR, 0,
      noiseFreq, noiseQ, noiseTilt
    );
    R[i] = hat.soemdsp_electro_hat_right(h);
  }
  hat.soemdsp_electro_hat_destroy(h);
  return { L, R };
};

{
  const a = render({ metal: 1, noiseFreq: 3000, noiseQ: 1, noiseTilt: 0 });
  const b = render({ metal: 1, noiseFreq: 500, noiseQ: 10, noiseTilt: 1 });
  const c = render({ metal: 1, noiseFreq: 12000, noiseQ: 0.5, noiseTilt: -1 });
  check(finite([...a.L, ...a.R]), "Metal 1: finite L/R");
  check(same(a.L, a.R), "Metal 1 808: L == R (shared metal bank, no noise)");
  check(same(a.L, b.L) && same(a.L, c.L), "Metal 1 808: Freq / Q / Tilt do not change the voice");
  check(rms(a.L) > 1e-4, "Metal 1 808: closed hit produces audio");
}

{
  const bright = render({ metal: 0, noiseTilt: 1 });
  const dark = render({ metal: 0, noiseTilt: -1 });
  const low = render({ metal: 0, noiseFreq: 500, noiseQ: 2, noiseTilt: 0 });
  const high = render({ metal: 0, noiseFreq: 12000, noiseQ: 2, noiseTilt: 0 });
  check(finite([...bright.L, ...dark.L, ...low.L, ...high.L]), "Metal 0: finite");
  check(!same(bright.L, dark.L), "Metal 0: Tilt +1 and -1 differ");
  check(hfEnergy(bright.L) > hfEnergy(dark.L) * 1.05, `Metal 0: Tilt +1 brighter than -1 (hf ${hfEnergy(bright.L).toFixed(4)} vs ${hfEnergy(dark.L).toFixed(4)})`);
  check(!same(low.L, high.L), "Metal 0: Noise Freq 500 vs 12000 differs");
  check(hfEnergy(high.L) > hfEnergy(low.L) * 1.05, `Metal 0: 12 kHz brighter than 500 Hz (hf ${hfEnergy(high.L).toFixed(4)} vs ${hfEnergy(low.L).toFixed(4)})`);
  check(bright.L.some((v, i) => v !== bright.R[i]), "Metal 0: L and R are decorrelated (per-channel noise)");
}

{
  const seq = (h) => {
    const n = 800;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const closed = i === 10 || i === 400 ? 1 : 0;
      const reset = i === 400 ? 1 : 0;
      out[i] = hat.soemdsp_electro_hat_sample(
        h, closed, 0, reset, 0, 1, 0.5, 0.05, 0.5, 0, 1, SR, 0, 3000, 1, 0
      );
    }
    return out;
  };
  const h1 = hat.soemdsp_electro_hat_create();
  const h2 = hat.soemdsp_electro_hat_create();
  const a = seq(h1);
  const b = seq(h2);
  hat.soemdsp_electro_hat_destroy(h1);
  hat.soemdsp_electro_hat_destroy(h2);
  check(same(a, b) && finite([...a]), "Reset: two identical hit+reset sequences match (noise reseeded)");
  // Sample 400 is Reset + Closed on the same sample; the post-reset slice should
  // match the first hit's tail (same seed, same velocity).
  const first = a.slice(10, 200);
  const second = a.slice(400, 590);
  check(same(first, second), "Reset + Closed on the same sample repeats the first hit exactly");
}

{
  const x = await load("native_modules/combined/soemdsp_combined.wasm");
  check(typeof x.soemdsp_electro_hat_sample === "function", "combined wasm exports soemdsp_electro_hat_sample");
  check(x.soemdsp_electro_hat_version() >= 4, `combined electro_hat version ${x.soemdsp_electro_hat_version()}`);
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
