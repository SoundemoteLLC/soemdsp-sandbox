// Noise Convolution Reverb: impulse decay, no NaN/denormal blowups, CPU bench.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "native_modules", "noise_conv_reverb", "noise_conv_reverb.wasm");
const defsPath = path.join(root, "public", "node-graph-module-definitions.js");
const x = (await WebAssembly.instantiate(await WebAssembly.compile(fs.readFileSync(wasmPath)), {})).exports;
const FS = 48000;
const B = x.soemdsp_noise_conv_reverb_block_max_frames();

let failed = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log("ok  ", name, extra);
  else { console.log("FAIL", name, extra); failed += 1; }
}

const defMax = (() => {
  try {
    const t = fs.readFileSync(defsPath, "utf8");
    const i = t.indexOf("noiseConvReverb:");
    if (i < 0) return null;
    const slice = t.slice(i, i + 8000);
    const m = slice.match(/key:\s*"decay"[\s\S]*?max:\s*"([0-9.]+)"/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
})();

ok("version 6", x.soemdsp_noise_conv_reverb_version() === 6, String(x.soemdsp_noise_conv_reverb_version()));
ok("max length 6 s", Math.abs(x.soemdsp_noise_conv_reverb_max_length() - 6) < 1e-12, String(x.soemdsp_noise_conv_reverb_max_length()));
if (defMax != null) {
  ok("definition Length max matches native max", defMax === x.soemdsp_noise_conv_reverb_max_length(), `def ${defMax}`);
}

function run(h, n, params, input) {
  const inL = x.soemdsp_noise_conv_reverb_block_in_l();
  const inR = x.soemdsp_noise_conv_reverb_block_in_r();
  const outL = x.soemdsp_noise_conv_reverb_block_out_l();
  const outR = x.soemdsp_noise_conv_reverb_block_out_r();
  const mixP = x.soemdsp_noise_conv_reverb_block_mix();
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  let i = 0;
  let nan = 0, inf = 0, maxAbs = 0;
  while (i < n) {
    const m = Math.min(B, n - i);
    const H = new Float64Array(x.memory.buffer);
    for (let k = 0; k < m; k += 1) {
      const v = input(i + k);
      H[(inL >> 3) + k] = v;
      H[(inR >> 3) + k] = v;
      H[(mixP >> 3) + k] = params.mix;
    }
    x.soemdsp_noise_conv_reverb_process_block(
      h, inL, inR, outL, outR, m, mixP,
      params.length, params.ampShape, params.spectralShape,
      params.endCutoffHz, params.startCutoffHz, params.decorrelate, FS
    );
    const H2 = new Float64Array(x.memory.buffer);
    for (let k = 0; k < m; k += 1) {
      const a = H2[(outL >> 3) + k];
      const b = H2[(outR >> 3) + k];
      L[i + k] = a; R[i + k] = b;
      if (!(a === a) || !(b === b)) nan += 1;
      if (!Number.isFinite(a) || !Number.isFinite(b)) inf += 1;
      const aa = Math.abs(a), ab = Math.abs(b);
      if (aa > maxAbs) maxAbs = aa;
      if (ab > maxAbs) maxAbs = ab;
    }
    i += m;
  }
  return { L, R, nan, inf, maxAbs };
}

const defaults = {
  length: 1.5, ampShape: 0, spectralShape: 0,
  endCutoffHz: 120, startCutoffHz: 1500, decorrelate: 1, mix: 1,
};

function settle(h, params, extra = 0) {
  const irNeed = Math.ceil(params.length * FS) + 2048 + extra;
  // Incremental build + 20 ms fade, plus a little slack.
  run(h, Math.max(irNeed, 64 * B), params, () => 0);
}

const h = x.soemdsp_noise_conv_reverb_create(FS);
ok("create", h > 0, String(h));
if (h <= 0) {
  console.log(failed ? `${failed} failed` : "all noise conv reverb checks passed");
  process.exit(failed ? 1 : 0);
}

const ir0 = x.soemdsp_noise_conv_reverb_ir_length(h);
ok("create built a default IR", ir0 >= Math.floor(1.5 * FS) - 1 && ir0 <= Math.ceil(1.5 * FS) + 1, String(ir0));

// Same seed => same IR
const a0 = x.soemdsp_noise_conv_reverb_ir_sample(h, 0, 100);
const a1 = x.soemdsp_noise_conv_reverb_ir_sample(h, 0, 1000);
ok("IR samples are finite", Number.isFinite(a0) && Number.isFinite(a1), `${a0} ${a1}`);
ok("IR is not all zero", a0 !== 0 || a1 !== 0 || x.soemdsp_noise_conv_reverb_ir_sample(h, 0, 10) !== 0);

// Impulse on the default 1.5 s IR (already built).
x.soemdsp_noise_conv_reverb_reset(h);
const imp = run(h, Math.ceil(2.2 * FS), { ...defaults, mix: 1 }, (i) => (i === 0 ? 1 : 0));
ok("impulse has no NaN", imp.nan === 0 && imp.inf === 0, `nan ${imp.nan} inf ${imp.inf}`);
ok("impulse peak is finite and modest", imp.maxAbs > 1e-6 && imp.maxAbs < 20, String(imp.maxAbs));

function energy(arr, lo, hi) {
  let e = 0;
  const a = Math.max(0, lo), b = Math.min(arr.length, hi);
  for (let i = a; i < b; i += 1) e += arr[i] * arr[i] + arr[i] * arr[i];
  return e;
}
const eEarly = energy(imp.L, 0, Math.floor(0.15 * FS));
const eMid = energy(imp.L, Math.floor(0.6 * FS), Math.floor(0.75 * FS));
const eLate = energy(imp.L, Math.floor(1.4 * FS), Math.floor(1.5 * FS));
const eAfter = energy(imp.L, Math.floor(1.55 * FS), Math.floor(1.7 * FS));
ok("tail energy falls over Length", eEarly > eMid && eMid > eLate, `early ${eEarly.toExponential(2)} mid ${eMid.toExponential(2)} late ${eLate.toExponential(2)}`);
ok("after Length the tail is essentially silent", eAfter < eLate * 0.05 + 1e-12, `after ${eAfter.toExponential(2)} late ${eLate.toExponential(2)}`);

// Mix 0 is dry.
x.soemdsp_noise_conv_reverb_reset(h);
const dry = run(h, 256, { ...defaults, mix: 0 }, (i) => (i === 0 ? 0.5 : 0));
ok("mix 0 is dry (impulse at 0 only)", dry.L[0] === 0.5 && dry.L[1] === 0 && dry.R[0] === 0.5, `${dry.L[0]} ${dry.L[1]}`);

// Seed change rebuilds to a different IR (settle first).
x.soemdsp_noise_conv_reverb_set_seed(h, 1);
settle(h, defaults, 2048);
const irA = [];
for (let i = 0; i < 64; i += 1) irA.push(x.soemdsp_noise_conv_reverb_ir_sample(h, 0, 20 + i * 40));
x.soemdsp_noise_conv_reverb_set_seed(h, 2);
settle(h, defaults, 2048);
const irB = [];
for (let i = 0; i < 64; i += 1) irB.push(x.soemdsp_noise_conv_reverb_ir_sample(h, 0, 20 + i * 40));
let same = 0;
for (let i = 0; i < irA.length; i += 1) if (irA[i] === irB[i]) same += 1;
ok("different Seed produces a different IR", same < irA.length / 2, `identical ${same}/${irA.length}`);
x.soemdsp_noise_conv_reverb_set_seed(h, 1);
settle(h, defaults, 2048);
let match = 0;
for (let i = 0; i < irA.length; i += 1) if (irA[i] === x.soemdsp_noise_conv_reverb_ir_sample(h, 0, 20 + i * 40)) match += 1;
ok("same Seed is deterministic", match === irA.length, `${match}/${irA.length}`);

// Decorrelate: 0 => L and R more similar than at 1.
function corr(params) {
  settle(h, params, 2048);
  const n = Math.min(4000, x.soemdsp_noise_conv_reverb_ir_length(h));
  let acc = 0, eL = 0, eR = 0;
  for (let i = 0; i < n; i += 1) {
    const l = x.soemdsp_noise_conv_reverb_ir_sample(h, 0, i);
    const r = x.soemdsp_noise_conv_reverb_ir_sample(h, 1, i);
    acc += l * r; eL += l * l; eR += r * r;
  }
  return acc / Math.sqrt((eL || 1) * (eR || 1));
}
const c0 = corr({ ...defaults, decorrelate: 0 });
const c1 = corr({ ...defaults, decorrelate: 1 });
ok("Decorrelate 0 is highly correlated L/R", c0 > 0.95, c0.toFixed(3));
ok("Decorrelate 1 is much less correlated", c1 < 0.2, c1.toFixed(3));

// Mid-flight param change does not NaN, and a 6 s IR can be built.
const longP = { ...defaults, length: 6, mix: 1 };
const chg = run(h, Math.ceil(0.5 * FS), longP, (i) => ((i * 17) % 11) / 11 - 0.5);
ok("param change mid-stream has no NaN", chg.nan === 0 && chg.inf === 0 && chg.maxAbs < 50, `max ${chg.maxAbs} nan ${chg.nan}`);
settle(h, longP, 2048);
const ir6 = x.soemdsp_noise_conv_reverb_ir_length(h);
ok("6 s Length builds a ~6 s IR", ir6 >= 6 * FS - 2 && ir6 <= 6 * FS + 2, String(ir6));

// 6 s impulse decay + silence after.
x.soemdsp_noise_conv_reverb_reset(h);
const imp6 = run(h, Math.ceil(6.3 * FS), { ...longP, mix: 1 }, (i) => (i === 0 ? 1 : 0));
ok("6 s impulse has no NaN or blowup", imp6.nan === 0 && imp6.inf === 0 && imp6.maxAbs > 1e-6 && imp6.maxAbs < 20, `max ${imp6.maxAbs}`);
let longIrError = 0;
let longIrErrorAt = 0;
for (let i = 0; i < imp6.L.length; ++i) {
  if (Math.abs(imp6.L[i] - x.soemdsp_noise_conv_reverb_ir_sample(h, 0, i)) > longIrError) longIrErrorAt = i;
  longIrError = Math.max(longIrError,
    Math.abs(imp6.L[i] - x.soemdsp_noise_conv_reverb_ir_sample(h, 0, i)),
    Math.abs(imp6.R[i] - x.soemdsp_noise_conv_reverb_ir_sample(h, 1, i)));
}
ok("6 s impulse equals the full generated IR", longIrError < 2e-6, `error ${longIrError} at ${longIrErrorAt}`);
const e6early = energy(imp6.L, 0, Math.floor(0.2 * FS));
const e6late = energy(imp6.L, Math.floor(5.7 * FS), Math.floor(6.0 * FS));
const e6after = energy(imp6.L, Math.floor(6.05 * FS), Math.floor(6.25 * FS));
ok("6 s tail still has energy near the end", e6late > 0, e6late.toExponential(2));
ok("6 s energy falls from early to late", e6early > e6late, `early ${e6early.toExponential(2)} late ${e6late.toExponential(2)}`);
ok("6 s is silent after Length", e6after < e6late * 0.05 + 1e-12, `after ${e6after.toExponential(2)}`);

// CPU bench
function bench(tag, params, inMode, seconds) {
  const frames = Math.max(B * 48, Math.floor(seconds * FS));
  // warmup / fill
  run(h, Math.ceil(params.length * FS) + 512, params, (i) => (inMode === 0 ? 0 : ((i & 1) ? 0.1 : -0.1)));
  const t0 = process.hrtime.bigint();
  run(h, frames, params, (i) => (inMode === 0 ? 0 : ((i & 1) ? 0.1 : -0.1)));
  const ns = Number(process.hrtime.bigint() - t0) / frames;
  const pct = (ns * FS / 1e9) * 100;
  console.log(`bench ${tag}: ${pct.toFixed(2)}% of one core @48 kHz (${ns.toFixed(1)} ns/sample)`);
  return pct;
}

x.soemdsp_noise_conv_reverb_reset(h);
const cpu = {};
cpu.hot025 = bench("0.025 s hot", { ...defaults, length: 0.025 }, 2, 0.4);
cpu.hot1 = bench("1 s hot", { ...defaults, length: 1 }, 2, 0.4);
cpu.hot6 = bench("6 s hot", { ...defaults, length: 6 }, 2, 0.4);
cpu.idle6 = bench("6 s idle", { ...defaults, length: 6 }, 0, 0.4);
ok("6 s hot stays well under a core", cpu.hot6 < 50, `${cpu.hot6.toFixed(2)}%`);
ok("6 s idle is cheap", cpu.idle6 < 5, `${cpu.idle6.toFixed(2)}%`);

x.soemdsp_noise_conv_reverb_destroy(h);
ok("destroy does not throw", true);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all noise conv reverb checks passed");
