import assert from "node:assert/strict";
import fs from "node:fs";
const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL(
  "../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url)));
const x = instance.exports, sr = 48000;

function impulse({ amplitude = 1, decay = 0.2, frequency = 110, body = 1, mix = 1 } = {}) {
  const h = x.soemdsp_convolution_resonator_create();
  assert.ok(h);
  const out = new Float64Array(sr);
  for (let i = 0; i < out.length; ++i) {
    out[i] = x.soemdsp_convolution_resonator_sample(h, i === 0 ? amplitude : 0,
      0, frequency, 4, mix, sr, 0, body, decay, 0, 0);
    assert.ok(Number.isFinite(out[i]));
    assert.equal(x.soemdsp_convolution_resonator_right(h), 0, "no stereo crosstalk");
  }
  x.soemdsp_convolution_resonator_destroy(h);
  return out;
}
function magnitude(out, hz, start = 0, end = out.length) {
  let re = 0, im = 0;
  for (let i = start; i < end; ++i) {
    const phase = 2 * Math.PI * hz * i / sr;
    re += out[i] * Math.cos(phase); im += out[i] * Math.sin(phase);
  }
  return Math.hypot(re, im);
}
function energy(out, start, end) {
  let sum = 0;
  for (let i = Math.floor(start * sr); i < end * sr; ++i) sum += out[i] ** 2;
  return sum;
}

const tube = impulse();
for (const harmonic of [1, 3, 5]) {
  const odd = magnitude(tube, 110 * harmonic);
  const even = magnitude(tube, 110 * (harmonic + 1));
  console.log(`Tube harmonic ${harmonic}: ${odd.toFixed(4)}, next even: ${even.toFixed(4)}`);
  assert.ok(odd > 10 * even, "closed-open tube must emphasize odd rather than even harmonics");
}
assert.ok(magnitude(tube, 0) < magnitude(tube, 110) * 0.01, "no DC resonance");
const loud = impulse({ amplitude: 10 });
let error = 0;
for (let i = 0; i < tube.length; ++i) error = Math.max(error, Math.abs(loud[i] - 10 * tube[i]));
assert.ok(error < 1e-5, `Tube must remain linear: ${error}`);
const short = impulse({ decay: 0.01 });
assert.ok(energy(tube, 0.3, 0.5) > 100 * energy(short, 0.3, 0.5), "Decay controls tube ringing");
const fundamentalLoss = magnitude(tube, 110, 24000, 28800) / magnitude(tube, 110, 4800, 9600);
const upperLoss = magnitude(tube, 550, 24000, 28800) / magnitude(tube, 550, 4800, 9600);
assert.ok(upperLoss < fundamentalLoss * 0.5, "wall losses must damp upper modes faster");
for (const boundary of [0.5, 1]) {
  const before = impulse({ body: boundary - 1e-7 });
  const at = boundary === 1 ? tube : impulse({ body: boundary });
  let jump = 0;
  for (let i = 0; i < at.length; ++i) jump = Math.max(jump, Math.abs(before[i] - at[i]));
  assert.ok(jump < 1e-5, `Body endpoint ${boundary} must be continuous: ${jump}`);
}
for (const body of [0.6, 0.75, 0.9]) {
  const middle = impulse({ body, decay: 0.08 });
  assert.ok(energy(middle, 0.8, 1) < 1e-7, `morphed body ${body} must settle`);
}
const dry = impulse({ mix: 0 });
for (let i = 0; i < dry.length; ++i) assert.equal(dry[i], i === 2048 ? 1 : 0, "dry latency unchanged");

const h = x.soemdsp_convolution_resonator_create();
for (const rate of [44100, 48000, 96000]) {
  for (const frequency of [10, 110.7, 4000, 20000, rate * 0.49999]) {
    for (let i = 0; i < 4096; ++i) {
      const body = 0.5 + 0.5 * i / 4095;
      const out = x.soemdsp_convolution_resonator_sample(h, i < 64 ? 1 : 0,
        0, frequency, 4, 1, rate, 0, body, 0.2, 0, 0);
      assert.ok(Number.isFinite(out), "finite morph and Nyquist-boundary output");
      assert.ok(Number.isFinite(x.soemdsp_convolution_resonator_carrier(h)), "finite body-tinted carrier");
    }
  }
}
// A driven melody, then silence at a fixed tuning: stored energy must settle.
for (let i = 0; i < sr; ++i) {
  const f = [55, 110, 330, 880][Math.floor(i / 3000) % 4];
  const value = x.soemdsp_convolution_resonator_sample(h, Math.sin(i / 17), 0, f, 4, 1, sr, 0, 1, 0.08, 0, 0);
  assert.ok(Number.isFinite(value));
}
let lateEnergy = 0;
for (let i = 0; i < 2 * sr; ++i) {
  const out = x.soemdsp_convolution_resonator_sample(h, 0, 0, 110, 4, 1, sr, 0, 1, 0.08, 0, 0);
  assert.ok(Number.isFinite(out));
  if (i > sr) lateEnergy += out * out;
}
assert.ok(lateEnergy < 1e-8, `tube must settle after excitation: ${lateEnergy}`);
x.soemdsp_convolution_resonator_reset(h);
for (let i = 0; i < 4096; ++i)
  assert.equal(x.soemdsp_convolution_resonator_sample(h, 0, 0, 110, 4, 1, sr, 0, 1, 0.2, 0, 0), 0);
x.soemdsp_convolution_resonator_destroy(h);
// Grow a partially filled String ring, then reset before it wraps around.
const grown = x.soemdsp_convolution_resonator_create();
for (const frequency of [440, 10])
  for (let i = 0; i < 64; ++i)
    x.soemdsp_convolution_resonator_sample(grown, 1, 0, frequency, 4, 1, sr, 0, 0.5, 0.2, 0, 0);
x.soemdsp_convolution_resonator_reset(grown);
for (let i = 0; i < 8192; ++i)
  assert.equal(x.soemdsp_convolution_resonator_sample(grown, 0, 0, 10, 4, 1, sr, 0, 0.5, 0.2, 0, 0), 0,
    "reset after ring growth must not leave old samples at the end of storage");
x.soemdsp_convolution_resonator_destroy(grown);
console.log(`Tube: odd modes, wall losses, DC, decay, linearity (${error.toExponential(2)}), latency, range, morph and reset pass.`);
