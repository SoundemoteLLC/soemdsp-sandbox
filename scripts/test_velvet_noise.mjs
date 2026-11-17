// Velvet Noise generator: shapes (Trigger, Sinc, PolyBLEP Saw, Half Sine, Sine, Rect Sine) and Sign.
// Loads the native module (native_modules/velvet_noise/velvet_noise.wasm) and checks the output.
//   node scripts/test_velvet_noise.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.error("FAIL", msg); } else console.log("ok  ", msg); };

const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules", "velvet_noise", "velvet_noise.wasm")));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) { imports[i.module] ??= {}; imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined; }
const x = (await WebAssembly.instantiate(mod, imports)).exports;

const FS = 48000;
const TRIG = 0, SINC = 1, SAW = 2, HALF = 3, SINE = 4, RECT = 5;
const RANDOM = 0, BIPOLAR = 1;

// Renders n samples: left, right and the two trigger outputs.
function render(shape, sign, density, n, { spread = 1, gain = 1, seed = 1, cutoff = 24000, lobes = 16 } = {}) {
  const h = x.soemdsp_velvet_noise_create();
  x.soemdsp_velvet_noise_set_seed(h, seed);
  const L = new Float64Array(n), R = new Float64Array(n), P = new Uint8Array(n), N = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    L[i] = x.soemdsp_velvet_noise_sample(h, shape, sign, density, spread, gain, FS, cutoff, lobes);
    R[i] = x.soemdsp_velvet_noise_right(h);
    P[i] = x.soemdsp_velvet_noise_trigger_pos(h);
    N[i] = x.soemdsp_velvet_noise_trigger_neg(h);
  }
  x.soemdsp_velvet_noise_destroy(h);
  return { L, R, P, N };
}
const eventsOf = (r) => { const e = []; for (let i = 0; i < r.P.length; i += 1) { if (r.P[i]) e.push([i, 1]); if (r.N[i]) e.push([i, -1]); } return e; };

// ---- Trigger: one event per period, random signs
{
  const n = FS * 4, r = render(TRIG, RANDOM, 1000, n);
  const ev = eventsOf(r);
  check(Math.abs(ev.length - 4000) <= 2, `trigger: 1000 Hz for 4 s gives ${ev.length} events (one per period)`);
  let pos = 0, neg = 0, bad = 0;
  for (let i = 0; i < n; i += 1) { if (r.L[i] > 0) pos += 1; else if (r.L[i] < 0) neg += 1; if (r.L[i] !== 0 && Math.abs(Math.abs(r.L[i]) - 1) > 1e-12) bad += 1; }
  check(pos > 1500 && neg > 1500 && bad === 0, `trigger: random signs (${pos} +, ${neg} -), every impulse is exactly 1`);
  check(ev.every(([i, s]) => r.L[i] === s), "trigger: the Trigger outputs fire on the same samples as the impulses");
  const b = render(TRIG, BIPOLAR, 1000, n);
  let allPos = true, anyNegTrig = false;
  for (let i = 0; i < n; i += 1) { if (b.L[i] < 0) allPos = false; if (b.N[i]) anyNegTrig = true; }
  check(allPos && !anyNegTrig && eventsOf(b).length === ev.length, "trigger: Bipolar makes every event +1 and Trigger - never fires, same event times");
  const a = render(TRIG, RANDOM, 1000, 5000, { seed: 7 }), c = render(TRIG, RANDOM, 1000, 5000, { seed: 7 }), d = render(TRIG, RANDOM, 1000, 5000, { seed: 8 });
  check(a.L.every((v, i) => v === c.L[i]) && !a.L.every((v, i) => v === d.L[i]), "trigger: same seed repeats, another seed differs");
  const m = render(TRIG, RANDOM, 1000, 20000, { spread: 0 });
  check(m.L.every((v, i) => v === m.R[i]), "trigger: Stereo Spread 0 makes Left and Right identical");
}

// ---- Pause: density 0 holds still and is silent
{
  const h = x.soemdsp_velvet_noise_create();
  let quiet = true;
  for (let i = 0; i < 2000; i += 1) if (x.soemdsp_velvet_noise_sample(h, SAW, RANDOM, 0, 1, 1, FS, 2000, 8) !== 0) quiet = false;
  x.soemdsp_velvet_noise_destroy(h);
  check(quiet, "density 0 pauses (silent, no hidden floor)");
}

// ---- Sinc: a band-limited impulse centred on the event
{
  // Isolated events at a low density, mono, Bipolar: each one is the same kind of kernel at a different fractional position.
  const n = FS * 3, r = render(SINC, BIPOLAR, 20, n, { spread: 0 });
  const ev = eventsOf(r).filter(([i]) => i > 100 && i < n - 100);
  check(ev.length >= 40, `sinc: ${ev.length} isolated events at 20 Hz`);
  let worstPeak = 0, worstSum = 0, worstCentroid = 0, worstFlat = 0;
  for (const [i] of ev) {
    // Event time within the sample: the kernel's centre of mass of |y| tells where the peak really is.
    let s = 0, m1 = 0, m0 = 0, peak = 0;
    for (let k = -20; k <= 20; k += 1) { const v = r.L[i + k]; s += v; m0 += v * v; m1 += k * v * v; peak = Math.max(peak, Math.abs(v)); }
    const centroid = m1 / m0;
    worstCentroid = Math.max(worstCentroid, Math.abs(centroid - 0.5)); // true time sits in [0, 1) of sample i
    worstSum = Math.max(worstSum, Math.abs(s - 1));
    worstPeak = Math.max(worstPeak, Math.abs(peak - 1) > 0.5 ? 1 : 0);
    // Flat response: the DFT magnitude of the kernel stays near 1 to 0.8 Nyquist.
    for (let q = 1; q <= 20; q += 1) {
      const w = Math.PI * 0.8 * q / 20; let re = 0, im = 0;
      for (let k = -20; k <= 20; k += 1) { re += r.L[i + k] * Math.cos(w * k); im -= r.L[i + k] * Math.sin(w * k); }
      worstFlat = Math.max(worstFlat, Math.abs(Math.sqrt(re * re + im * im) - 1));
    }
  }
  check(worstSum < 0.02, `sinc: kernel sums to 1 (worst ${worstSum.toExponential(2)})`);
  check(worstFlat < 0.03, `sinc: flat magnitude to 0.8 Nyquist (worst deviation ${worstFlat.toFixed(4)})`);
  check(worstPeak === 0, "sinc: peak height about 1 (no peak off by more than half)");
  check(worstCentroid < 0.5, `sinc: energy centred on the event sample (worst offset ${worstCentroid.toFixed(2)})`);
  // The peak lands on the event: no added latency, trigger and sinc are aligned.
  let aligned = 0;
  for (const [i] of ev) { let bi = i - 3, bv = 0; for (let k = -3; k <= 3; k += 1) if (Math.abs(r.L[i + k]) > bv) { bv = Math.abs(r.L[i + k]); bi = i + k; } if (Math.abs(bi - i) <= 1) aligned += 1; }
  check(aligned === ev.length, `sinc: peak within one sample of its trigger for all ${ev.length} events`);
}

// ---- Sinc with a low cutoff: wide lobes that ring before and after the tick
{
  const fc = 1500, n = FS * 3, r = render(SINC, BIPOLAR, 10, n, { spread: 0, cutoff: fc, lobes: 8 });
  const ev = eventsOf(r).filter(([i]) => i > 600 && i < n - 600);
  const spacing = FS / (2 * fc); // samples between zero crossings
  let pre = 0, post = 0, peakOk = 0, zeroOk = 0, total = 0, offGrid = 0;
  for (const [i] of ev) {
    total += 1;
    let bi = i; for (let k = -3; k <= 3; k += 1) if (Math.abs(r.L[i + k]) > Math.abs(r.L[bi])) bi = i + k;
    if (Math.abs(r.L[bi]) > 0.9) peakOk += 1;
    // The first side lobe sits about 1.43 x spacing from the peak and has the opposite sign (about -0.217).
    const d = Math.round(1.43 * spacing);
    const before = r.L[bi - d], after = r.L[bi + d];
    if (before * r.L[bi] < 0 && Math.abs(before) > 0.1) pre += 1;
    if (after * r.L[bi] < 0 && Math.abs(after) > 0.1) post += 1;
    // ringing extends many samples either side (several lobes), not just one
    let wide = 0; for (let k = 2; k <= 4 * spacing; k += 1) if (Math.abs(r.L[bi - k]) > 0.02 && Math.abs(r.L[bi + k]) > 0.02) wide += 1;
    if (wide > 4 * spacing * 0.5) zeroOk += 1;
    if (r.P[bi] === 0 && r.P[bi - 1] === 0 && r.P[bi + 1] === 0) offGrid += 1;
  }
  check(total > 20 && peakOk === total, `sinc 1500 Hz: unit peak on every one of ${total} events`);
  check(pre === total && post === total, `sinc 1500 Hz: side lobes of opposite sign before (${pre}) and after (${post}) the peak`);
  check(zeroOk === total, "sinc 1500 Hz: ringing spreads over several lobes, not just a tick");
  void offGrid;
  const t = render(TRIG, BIPOLAR, 10, n, { spread: 0 });
  let sincEnergyBetween = 0, trigBetween = 0;
  for (const [i] of ev) for (let k = 3; k <= 40; k += 1) { sincEnergyBetween += r.L[i + k] ** 2; trigBetween += t.L[i + k] ** 2; }
  check(sincEnergyBetween > 0.1 && trigBetween === 0, "sinc has energy between the ticks, trigger has none");
}

// ---- Ramp shapes: a cycle runs event to event
const RAMP = { [SAW]: [(x) => 2 * x - 1, "saw"], [HALF]: [(x) => -Math.cos(Math.PI * x), "half sine"], [SINE]: [(x) => Math.sin(2 * Math.PI * x), "sine"], [RECT]: [(x) => 2 * Math.sin(Math.PI * x) - 1, "rect sine"] };
for (const shape of [SAW, HALF, SINE, RECT]) {
  const [f, name] = RAMP[shape];
  const n = FS * 3, r = render(shape, BIPOLAR, 20, n, { spread: 0 });
  const ev = eventsOf(r);
  let worst = 0, checked = 0;
  for (let k = 1; k + 1 < ev.length; k += 1) {
    const [a] = ev[k], [b] = ev[k + 1];
    if (b - a < 500) continue;
    // The shape is sampled at integer times between the events; true event times are fractional, so compare with a tolerance
    // from the phase uncertainty of one sample (slope * 1/length) plus the anti-aliasing correction near the edges.
    for (let i = a + 4; i < b - 4; i += Math.max(1, Math.floor((b - a) / 40))) {
      const x0 = (i - a) / (b - a);
      const slope = Math.max(2, 2 * Math.PI);
      worst = Math.max(worst, Math.abs(r.L[i] - f(x0)) - slope * 1.5 / (b - a));
      checked += 1;
    }
  }
  check(checked > 50 && worst < 0.02, `${name}: follows its curve between events (${checked} points, worst excess ${worst.toFixed(4)})`);
}

// A cycle completes before the next event: right before an event the saw is at +1, right after it at -1.
{
  const r = render(SAW, BIPOLAR, 20, FS * 3, { spread: 0 });
  const ev = eventsOf(r);
  let endHigh = 0, startLow = 0, n = 0;
  for (let k = 1; k + 1 < ev.length; k += 1) {
    const [a] = ev[k], [b] = ev[k + 1];
    if (b - a < 1000) continue;
    n += 1;
    if (r.L[b - 3] > 0.99) endHigh += 1;
    if (r.L[a + 3] < -0.99) startLow += 1;
  }
  check(n > 20 && endHigh === n && startLow === n, `saw: completes the full ramp (${n} cycles: ends at +1, restarts at -1)`);
}

// ---- Random sign flips whole cycles; Bipolar never does
{
  const r = render(SAW, RANDOM, 20, FS * 6, { spread: 0 });
  const ev = eventsOf(r);
  let up = 0, down = 0;
  for (let k = 1; k + 1 < ev.length; k += 1) { const [a] = ev[k], [b] = ev[k + 1]; if (b - a < 1000) continue; const mid = r.L[Math.floor((a + b) / 2)], late = r.L[b - 5]; if (late > 0.9) up += 1; else if (late < -0.9) down += 1; void mid; }
  check(up > 5 && down > 5, `random sign: saw cycles run both ways (${up} up, ${down} down)`);
}

// ---- Stability: every shape, from sparse to above the sample rate, stays finite and bounded
for (const shape of [TRIG, SINC, SAW, HALF, SINE, RECT]) {
  for (const sign of [RANDOM, BIPOLAR]) {
    let peak = 0, finite = true;
    for (const density of [3, 100, 2500, 20000, 47000, 96000]) {
      const r = render(shape, sign, density, 30000, { seed: 3 });
      for (let i = 0; i < r.L.length; i += 1) { if (!Number.isFinite(r.L[i]) || !Number.isFinite(r.R[i])) finite = false; peak = Math.max(peak, Math.abs(r.L[i]), Math.abs(r.R[i])); }
    }
    check(finite && peak < (shape === SINC ? 12 : shape === TRIG ? 1.01 : 1.5), `shape ${shape} sign ${sign}: finite and bounded over 3 Hz to 96 kHz (peak ${peak.toFixed(2)})`);
  }
}

// ---- Density swept hard while playing never breaks the stream
{
  const h = x.soemdsp_velvet_noise_create();
  let finite = true, peak = 0;
  for (let i = 0; i < 200000; i += 1) {
    const density = 1 + 30000 * (0.5 + 0.5 * Math.sin(i * 0.0007)) ** 4 + (i % 9000 < 5 ? 0 : 0);
    const shape = Math.floor(i / 20000) % 6;
    const y = x.soemdsp_velvet_noise_sample(h, shape, i & 4096 ? 1 : 0, density, 0.5 + 0.5 * Math.sin(i * 0.0003), 1, FS, 100 + 20000 * (0.5 + 0.5 * Math.sin(i * 0.0011)), 1 + (i % 40));
    if (!Number.isFinite(y)) finite = false;
    peak = Math.max(peak, Math.abs(y));
  }
  x.soemdsp_velvet_noise_destroy(h);
  check(finite && peak < 500, `swept density, switching shape and sign every 20000 samples: finite (peak ${peak.toFixed(2)})`);
}

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log("velvet noise: all ok");
