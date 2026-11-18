import assert from 'node:assert/strict';
import fs from 'node:fs';
const x = (await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/spectral_freeze/spectral_freeze.wasm', import.meta.url)), {})).instance.exports;
const latency = x.soemdsp_spectral_freeze_latency();
assert.equal(latency, 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,
  x.soemdsp_spectral_freeze_metadata_json(), x.soemdsp_spectral_freeze_metadata_json_size())));
assert.ok(meta.parameters.every(p => p.tooltip));
function render(h, n, rate, input, control) {
  const out = [new Float64Array(n), new Float64Array(n)];
  for (let i = 0; i < n; ++i) {
    const [l, r] = input(i), [gate, capture, decay, diffusion, spread, mix] = control(i);
    out[0][i] = x.soemdsp_spectral_freeze_sample(h, l, r, gate, capture, decay, diffusion, spread, mix, rate);
    out[1][i] = x.soemdsp_spectral_freeze_right(h);
    assert.ok(Number.isFinite(out[0][i]) && Number.isFinite(out[1][i]));
  }
  return out;
}
const energy = (a, lo, hi) => a.slice(lo, hi).reduce((e, v) => e + v * v, 0);
function pitch(a, sr, lo, hi) {
  let crossings = 0;
  for (let i = lo + 1; i < hi; ++i) if (a[i - 1] <= 0 && a[i] > 0) ++crossings;
  return crossings * sr / (hi - lo);
}
for (const sr of [44100, 48000, 96000]) {
  const h = x.soemdsp_spectral_freeze_create(); assert.ok(h > 0);
  const live = render(h, 20000, sr, i => [0.1 * Math.sin(i * 0.11), 0.02 * Math.cos(i * 0.07)], () => [0, 0, 0, 0, 1, 1]);
  for (let i = latency; i < live[0].length; ++i) {
    assert.ok(Math.abs(live[0][i] - 0.1 * Math.sin((i - latency) * 0.11)) < 1e-8);
    assert.ok(Math.abs(live[1][i] - 0.02 * Math.cos((i - latency) * 0.07)) < 1e-8);
  }
  x.soemdsp_spectral_freeze_reset(h);
  const held = render(h, sr * 3, sr, i => {
    const v = i < sr / 2 ? 0.1 * Math.sin(2 * Math.PI * 440.1 * i / sr) : 0;
    return [v, v * 0.5];
  }, i => [i >= sr / 4 ? 1 : 0, 0, 0, 0, 0, 1]);
  assert.equal(x.soemdsp_spectral_freeze_held(h), 1);
  const e1 = energy(held[0], sr, sr * 2), e2 = energy(held[0], sr * 2, sr * 3);
  assert.ok(e1 > 0.01 && Math.abs(e2 / e1 - 1) < 0.05, 'infinite hold sustains after input stops');
  const measured = pitch(held[0], sr, sr, sr * 3);
  assert.ok(Math.abs(measured - 440.1) < 2, `phase advance retains pitch ${measured}`);
  let stereoError = 0;
  for (let i = sr; i < sr * 3; ++i) stereoError = Math.max(stereoError, Math.abs(held[1][i] - 0.5 * held[0][i]));
  assert.ok(stereoError < 1e-5, 'linked capture preserves stereo scaling');
  const release = render(h, latency + 10000, sr, () => [0, 0], () => [0, 0, 0, 0, 0, 1]);
  assert.equal(x.soemdsp_spectral_freeze_held(h), 0);
  assert.equal(energy(release[0], latency + 8000, release[0].length), 0);
  x.soemdsp_spectral_freeze_reset(h);
  const recapture = render(h, sr * 3, sr, i => {
    const hz = i < sr ? 220 : 660, v = Math.sin(2 * Math.PI * hz * i / sr) * 0.1;
    return [v, 0];
  }, i => [i >= sr / 4 ? 1 : 0, i === Math.floor(sr * 1.5) ? 1 : 0, 0, 0, 0, 1]);
  assert.ok(Math.abs(pitch(recapture[0], sr, sr * 2, sr * 3) - 660) < 3, 'one-sample Recapture is retained until hop');
  assert.equal(energy(recapture[1], 0, recapture[1].length), 0, 'no cross-channel leakage');
  x.soemdsp_spectral_freeze_reset(h);
  const decay = render(h, sr * 3, sr, i => [i < sr / 2 ? 0.1 * Math.sin(i * 0.13) : 0, 0],
    i => [i >= sr / 4 ? 1 : 0, 0, 0.5, 0, 0, 1]);
  assert.ok(energy(decay[0], sr * 2, sr * 3) < energy(decay[0], sr, sr * 2) * 0.05, 'positive decay releases held magnitudes');
  x.soemdsp_spectral_freeze_reset(h);
  const silence = render(h, 20000, sr, () => [0, 0], () => [1, 0, 0, 1, 1, 1]);
  assert.equal(energy(silence[0], 0, 20000) + energy(silence[1], 0, 20000), 0);
  const memory = x.memory.buffer.byteLength;
  render(h, 12000, sr, i => [Math.sin(i), 0], () => [1, 0, 5000, 0.4, 1, 1]);
  assert.equal(x.memory.buffer.byteLength, memory);
  assert.equal(x.soemdsp_spectral_freeze_sample(h, NaN, 0, 1, 0, 0, 0, 0, 1, sr), 0);
  assert.equal(x.soemdsp_spectral_freeze_held(h), 0);
  x.soemdsp_spectral_freeze_destroy(h);
  console.log(`${sr}: Live latency, infinite capture, ${measured.toFixed(2)} Hz phase continuation, stereo, release, recapture, decay, silence and recovery pass.`);
}
