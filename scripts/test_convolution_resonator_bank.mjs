import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConvolutionHarness } from "./fixtures/load-convolution-harness.mjs";
const h = await loadConvolutionHarness(["bank_reset", "bank_tick", "bank_right"]);
const sr = 48000, tone = (f, i) => Math.sin(2 * Math.PI * f * i / sr);
function render(width, follower, amplitude = 1) {
  h.test_bank_reset();
  const out = new Float64Array(sr / 2);
  for (let i = 0; i < out.length; ++i) {
    out[i] = h.test_bank_tick(amplitude * tone(6000, i), 0, tone(6000, i), sr, width, follower, 0);
    assert.ok(Number.isFinite(out[i]));
    assert.equal(h.test_bank_right(), 0);
  }
  return out;
}
function level(out, hz) {
  let re = 0, im = 0;
  for (let i = 4800; i < out.length; ++i) {
    re += out[i] * Math.cos(2 * Math.PI * hz * i / sr);
    im += out[i] * Math.sin(2 * Math.PI * hz * i / sr);
  }
  return Math.hypot(re, im);
}
const fast = render(0.75, 0), slow = render(0.75, 0.02), loud = render(0.75, 0, 10);
const fastSideband = level(fast, 18000) / level(fast, 6000);
const slowSideband = level(slow, 18000) / level(slow, 6000);
assert.ok(fastSideband > 10 * slowSideband && fastSideband > 0.01, "fast followers must retain rectification ripple and create AM");
let linearError = 0;
for (let i = 0; i < fast.length; ++i) linearError = Math.max(linearError, Math.abs(loud[i] - 10 * fast[i]));
assert.ok(linearError < 1e-8, "no limiter or level-dependent envelope clamp");
const wide = render(2, 0);
assert.ok(Math.abs(level(wide, 6000) - level(fast, 6000)) > 0.1 * level(fast, 6000), "Band Width actually changes overlap");
h.test_bank_reset();
for (let i = 0; i < sr / 2; ++i) {
  const voice = tone(440, i);
  const out = h.test_bank_tick(voice, voice * 0.25, tone(110, i), sr, 0.75, 0.00025, 0);
  assert.ok(Math.abs(h.test_bank_right() - out * 0.25) < 1e-10, "separate stereo envelopes share the same carrier");
}
console.log(`Filter bank: 18k/6k ripple ${fastSideband.toFixed(4)} fast vs ${slowSideband.toExponential(2)} slow; overlap, stereo and amplitude scaling pass.`);
for (const rate of [44100, 96000]) for (const width of [0.05, 4]) for (const follower of [0, 0.02]) for (const shift of [-24, 24]) {
  h.test_bank_reset();
  for (let i = 0; i < 4096; ++i) {
    assert.ok(Number.isFinite(h.test_bank_tick(Math.sin(i * 0.1), 0, Math.sin(i * 0.3), rate, width, follower, shift)), "finite bank range endpoints");
    assert.equal(h.test_bank_right(), 0);
  }
}

const x = (await WebAssembly.instantiate(fs.readFileSync(new URL("../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url)))).instance.exports;
function moduleOutput(model, body) {
  const id = x.soemdsp_convolution_resonator_create();
  x.soemdsp_convolution_resonator_set_filter_bank(id, model, 0.75, 0.00025);
  x.soemdsp_convolution_resonator_reset(id);
  const out = new Float64Array(sr / 2);
  for (let i = 0; i < out.length; ++i) {
    out[i] = x.soemdsp_convolution_resonator_sample(id, tone(440, i), 0, 110, 4, 1, sr, 0, body, 0.08, 1, 0);
    assert.ok(Number.isFinite(out[i])); assert.equal(x.soemdsp_convolution_resonator_right(id), 0);
  }
  x.soemdsp_convolution_resonator_reset(id);
  for (let i = 0; i < 4096; ++i)
    assert.equal(x.soemdsp_convolution_resonator_sample(id, 0, 0, 110, 4, 1, sr, 0, body, 0.08, 1, 0), 0);
  x.soemdsp_convolution_resonator_destroy(id);
  return out;
}
for (const model of [1, 2]) {
  const bypassed = moduleOutput(model, 0), changedBody = moduleOutput(model, 1);
  assert.deepEqual(bypassed, changedBody, `comparison model ${model} bypasses Body on voice and carrier`);
  assert.ok(bypassed.some(value => Math.abs(value) > 1e-5), "comparison produces audio");
}
const id = x.soemdsp_convolution_resonator_create();
for (let i = 0; i < sr; ++i) {
  const model = Math.floor(i / 4000) % 3;
  x.soemdsp_convolution_resonator_set_filter_bank(id, model, 0.05 + 3.95 * (i % 4000) / 3999, 0.02 * (i % 4000) / 3999);
  const value = x.soemdsp_convolution_resonator_sample(id, tone(440, i), 0, 110, 4, 1, sr, 0, 0.5, 0.08, 1, 24 * Math.sin(i / 8000));
  assert.ok(Number.isFinite(value), "model switches and width/follower/shift changes remain finite");
}
x.soemdsp_convolution_resonator_sample(id, NaN, 0, 110, 4, 1, sr, 0, 0.5, 0.08, 1, 0);
for (let i = 0; i < 4096; ++i)
  assert.equal(x.soemdsp_convolution_resonator_sample(id, 0, 0, 110, 4, 1, sr, 0, 0.5, 0.08, 1, 0), 0);
x.soemdsp_convolution_resonator_destroy(id);
console.log("Filter-bank module: raw routing, reset, non-finite recovery and model/parameter changes pass.");
const unchanged = x.soemdsp_convolution_resonator_create(), switching = x.soemdsp_convolution_resonator_create();
const latency = x.soemdsp_convolution_resonator_latency();
for (let i = 0; i < 8000 + latency; ++i) {
  if (i === 8000) x.soemdsp_convolution_resonator_set_filter_bank(switching, 2, 0.75, 0.00025);
  const step = id => x.soemdsp_convolution_resonator_sample(id, tone(440, i), 0, 110, 4, 1, sr, 0, 0, 0.08, 1, 0);
  assert.equal(step(unchanged), step(switching), "switching preserves the old output while the new model warms");
}
x.soemdsp_convolution_resonator_destroy(unchanged); x.soemdsp_convolution_resonator_destroy(switching);
console.log("Filter-bank range endpoints and warm-before-crossfade contract pass.");
