import assert from "node:assert/strict";
import fs from "node:fs";
const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL(
  "../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url)));
const x = instance.exports;
const sr = 48000;
const step = (h, input, frequency = 110, size = 4, mix = 1) =>
  x.soemdsp_convolution_resonator_sample(h, input, -input, frequency, size, mix, sr, 0, 0, 0.08, 0, 0);

function response(frequency, amplitude = 1, bodyFrequency = 110, size = 4) {
  const h = x.soemdsp_convolution_resonator_create();
  assert.ok(h);
  const output = [];
  for (let i = 0; i < sr / 2; ++i) {
    const value = step(h, amplitude * Math.sin(2 * Math.PI * frequency * i / sr), bodyFrequency, size);
    assert.ok(Number.isFinite(value));
    assert.ok(Math.abs(value + x.soemdsp_convolution_resonator_right(h)) < 1.e-10);
    if (i > sr / 4) output.push(value);
  }
  x.soemdsp_convolution_resonator_destroy(h);
  return { output, rms: Math.sqrt(output.reduce((a, b) => a + b * b, 0) / output.length) };
}
const tooth = response(110);
const gap = response(165);
assert.ok(tooth.rms > 0.8, `harmonic tooth ${tooth.rms}`);
assert.ok(gap.rms < tooth.rms * 0.02, `inter-tooth rejection ${gap.rms / tooth.rms}`);
const loud = response(110, 10);
for (let i = 0; i < tooth.output.length; ++i)
  assert.ok(Math.abs(loud.output[i] - 10 * tooth.output[i]) < 1.e-8, "body must remain linear");
const fractional = response(110.7, 1, 110.7);
assert.ok(fractional.rms > 0.8, "fractional pitch must not round to samples");
for (const f of [10, 1000, 12000, 20000]) response(f, 1, f, 1.5);

const h = x.soemdsp_convolution_resonator_create();
let dc = 0, carrierCrossings = 0, previous = 0;
for (let i = 0; i < sr; ++i) {
  const y = step(h, 1, 440);
  if (i >= sr * 0.75) dc = Math.max(dc, Math.abs(y));
  const carrier = x.soemdsp_convolution_resonator_carrier(h);
  if (previous <= 0 && carrier > 0 && i >= sr / 2) carrierCrossings++;
  previous = carrier;
}
assert.ok(dc < 1.e-8, `DC must decay away, peak ${dc}`);
assert.ok(Math.abs(carrierCrossings - 220) <= 1, `440 Hz carrier crossings ${carrierCrossings}`);
assert.equal(step(h, Infinity), 0);
for (let i = 0; i < 2400; ++i) assert.equal(step(h, 0), 0);
x.soemdsp_convolution_resonator_destroy(h);
const modulated = x.soemdsp_convolution_resonator_create();
for (let i = 0; i < 12000; ++i) {
  const frequency = 110 * 2 ** (2 * Math.sin(i * 0.013));
  const size = 4.5 + 3.5 * Math.sin(i * 0.007);
  const y = step(modulated, Math.sin(i * 0.09), frequency, size, 0.5 + 0.5 * Math.sin(i * 0.019));
  assert.ok(Number.isFinite(y), "audio-rate parameter changes must remain finite");
}
x.soemdsp_convolution_resonator_destroy(modulated);
console.log(`Buzz: harmonic RMS ${tooth.rms.toFixed(4)}, gap/tooth ${(gap.rms / tooth.rms).toExponential(2)}; linearity, fractional tuning, stereo, DC, carrier and range tests pass.`);
