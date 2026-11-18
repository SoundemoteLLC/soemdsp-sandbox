import assert from "node:assert/strict";
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
