// Robin Sinepulse anti-aliasing (v16): voices at 4x, slot-averaged waves, Robin's
// elliptic quarter-band before decimation. Clocked at audio rates the kick used to
// alias badly (hard phase resets, the Morph-1 step in SawSine / SawTri, voice cuts).
//
// Aliasing is measured against the same kick rendered at 16 x 48 kHz (the module
// is rate-independent by design, so that render is the continuous signal), with
// the triggers on the same 48 kHz sample instants the Clock gives. Error = Hann-
// windowed magnitude spectrum of the 48 kHz render minus the reference, 0..20 kHz,
// relative to the reference energy. Magnitude only: the filter's phase is not an
// alias. TriSine is measured at Morph 0.1, where its corner floor (tent_k, set
// from the host rate) does not differ between the two rates.
//   node scripts/test_robin_sinepulse_antialias.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bytes = fs.readFileSync(path.join(root, "native_modules/robin_sinepulse/robin_sinepulse.wasm"));
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };

async function inst() { const { instance } = await WebAssembly.instantiate(bytes, { env: {} }); return instance.exports; }
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len; const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
async function render(os, n48, trigs, p) {
  const e = await inst();
  const h = e.soemdsp_robin_sinepulse_create();
  const sr = 48000 * os, y = new Float64Array(n48 * os);
  const at = new Set(trigs.map((t) => t * os));
  for (let i = 0; i < y.length; i++) {
    y[i] = e.soemdsp_robin_sinepulse_sample(h, at.has(i) ? 1 : 0, p.hi, p.lo, p.sweep, p.chirp, p.shape, p.wave, p.morph, p.phase, p.decay, p.amp, sr, 0, p.voices, p.fade);
    // One hit: hold the T60 envelope to its exact law (dsp_exp rounding compounds differently per rate).
    if (trigs.length === 1) { const en = e.soemdsp_robin_sinepulse_env(h); if (en > 0) y[i] *= Math.pow(1000, -(i / sr) / p.decay) / en; }
  }
  return y;
}
function mag(y, os, L, start) {
  const N = L * os, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = y[start * os + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / N));
  fft(re, im);
  const m = new Float64Array(L / 2 + 1);
  for (let k = 0; k <= L / 2; k++) m[k] = Math.hypot(re[k], im[k]) / os;
  return m;
}
const OS = 16, L = 8192;
async function aliasDb(trigs, p, start) {
  const lo = await render(1, start + L, trigs, p), hi = await render(OS, start + L, trigs, p);
  const a = mag(lo, 1, L, start), b = mag(hi, OS, L, start);
  let err = 0, ref = 0;
  for (let k = 0; k <= Math.floor(L * 20 / 48); k++) { err += (a[k] - b[k]) ** 2; ref += b[k] ** 2; }
  return 10 * Math.log10(err / ref);
}
const base = { hi: 10000, lo: 0, sweep: 0.2, chirp: 0, shape: 0, wave: 0, morph: 1, phase: 0, decay: 0.5, amp: 1, voices: 1, fade: 2 };
const e0 = await inst();
check(e0.soemdsp_robin_sinepulse_version() === 16, "version 16 (anti-aliased)");

// Before v16 (same metric): single kick -29 / -72 / -27 dB, clocked 2 kHz -15 / -41 / -13,
// 5 kHz -13 / -15 / -13, 10 kHz -16 / -22 / -14 (SawSine / TriSine / SawTri).
const limits = { single: -45, 2000: -38, 5000: -26, 10000: -27 };
for (const wave of [0, 1, 2]) {
  const p = { ...base, wave, morph: wave === 1 ? 0.1 : 1 };
  const db = await aliasDb([0], p, 0);
  check(db <= limits.single, `single kick, wave ${wave}: alias ${db.toFixed(1)} dB <= ${limits.single}`);
  for (const rate of [2000, 5000, 10000]) {
    const trigs = [];
    for (let t = 0; t < 4096 + L; t += 48000 / rate) trigs.push(Math.floor(t));
    const d = await aliasDb(trigs, p, 4096);
    check(d <= limits[rate], `Clock ${rate} Hz -> Trigger, wave ${wave}: alias ${d.toFixed(1)} dB <= ${limits[rate]}`);
  }
}

// A kick body is untouched: a steady 200 Hz sine (SawSine Morph 0, High = Low) has the
// level v15 had against the exact T60 law (-0.130 dB, the envelope's own dsp_exp step
// rounding, which v16 keeps by stepping Decay once per host sample).
{
  const e = await inst();
  const h = e.soemdsp_robin_sinepulse_create();
  const f = 200, n = 48000, y = [];
  for (let i = 0; i < n; i++) y.push(e.soemdsp_robin_sinepulse_sample(h, i === 0 ? 1 : 0, f, f, 0.2, 0, 0, 0, 0, 0, 4, 1, 48000, 0, 1, 2));
  let re = 0, im = 0, envSum = 0;
  for (let i = 4800; i < n; i++) { const env = Math.pow(1000, -(i / 48000) / 4); re += y[i] * Math.cos(2 * Math.PI * f * i / 48000); im += y[i] * Math.sin(2 * Math.PI * f * i / 48000); envSum += env; }
  const level = 20 * Math.log10(2 * Math.hypot(re, im) / envSum);
  check(Math.abs(level - -0.1304) < 0.02, `200 Hz body level ${level.toFixed(4)} dB (v15: -0.1304)`);
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("all passed");
