import assert from "node:assert/strict";
import fs from "node:fs";
const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL(
  "../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url)));
const x = instance.exports, sr = 48000;
function impulse(body, decay, amplitude = 1, frequency = 110) {
  const h = x.soemdsp_convolution_resonator_create();
  const out = new Float64Array(sr / 2);
  for (let i = 0; i < out.length; ++i) {
    out[i] = x.soemdsp_convolution_resonator_sample(h, i === 0 ? amplitude : 0,
      0, frequency, 4, 1, sr, 0, body, decay, 0, 0);
    assert.ok(Number.isFinite(out[i]));
    assert.equal(x.soemdsp_convolution_resonator_right(h), 0, "no stereo crosstalk");
  }
  x.soemdsp_convolution_resonator_destroy(h);
  return out;
}
function energy(out, start, end) {
  let sum = 0;
  for (let i = Math.floor(start * sr); i < end * sr; ++i) sum += out[i] * out[i];
  return sum;
}
const buzz = impulse(0, 0.08), string = impulse(0.5, 0.08);
assert.ok(energy(string, 0.15, 0.25) > 100 * energy(buzz, 0.15, 0.25),
  "String must ring beyond Buzz (including its gentle input DC blocker)");
const short = impulse(0.5, 0.01), long = impulse(0.5, 0.2);
assert.ok(energy(long, 0.3, 0.4) > energy(short, 0.3, 0.4) * 100, "Decay must control the ring");
const loud = impulse(0.5, 0.08, 10);
let linearError = 0;
for (let i = 0; i < string.length; ++i) linearError = Math.max(linearError, Math.abs(loud[i] - 10 * string[i]));
assert.ok(linearError < 1.e-5, `no level-dependent loop damping: error ${linearError}`);
for (const f of [10, 55, 110.7, 880, 4000, 12000, 20000]) impulse(0.5, 0.08, 1, f);

// Estimate the low/mid string fundamental from the complex spectrum of its tail.
for (const frequency of [55, 110.7, 440, 880]) {
  const out = impulse(0.5, 0.2, 1, frequency);
  let best = 0, estimate = 0;
  for (let step = -100; step <= 100; ++step) {
    const hz = frequency * 2 ** (step / 12000);
    let re = 0, im = 0;
    for (let i = Math.floor(0.1 * sr); i < out.length; ++i) {
      const phase = 2 * Math.PI * hz * i / sr;
      re += out[i] * Math.cos(phase); im += out[i] * Math.sin(phase);
    }
    const power = re * re + im * im;
    if (power > best) { best = power; estimate = hz; }
  }
  const cents = 1200 * Math.log2(estimate / frequency);
  console.log(`String ${frequency} Hz: measured ${estimate.toFixed(4)} Hz (${cents.toFixed(2)} cents)`);
  assert.ok(Math.abs(cents) < 6, "string pitch should track f, not the integer delay grid");
}
const h = x.soemdsp_convolution_resonator_create();
for (let i = 0; i < sr; ++i) {
  const body = 0.25 + 0.25 * Math.sin(i / 200);
  const frequency = i % 4000 < 2000 ? 55 : 880;
  assert.ok(Number.isFinite(x.soemdsp_convolution_resonator_sample(h,
    Math.sin(i / 30), 0, frequency, 4, 1, sr, 20, body, 0.2, 0, 0)));
}
x.soemdsp_convolution_resonator_reset(h);
for (let i = 0; i < 4096; ++i)
  assert.equal(x.soemdsp_convolution_resonator_sample(h, 0, 0, 55, 4, 1, sr, 0, 0.5, 0.2, 0, 0), 0,
    "reset must clear the string tail and pending latency");
x.soemdsp_convolution_resonator_destroy(h);
console.log(`String body: ringing, decay, stereo, range, modulation, reset and linearity pass (max error ${linearError.toExponential(2)}).`);
