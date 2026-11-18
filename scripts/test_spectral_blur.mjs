import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_blur/spectral_blur.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const latency = x.soemdsp_spectral_blur_latency();
assert.equal(latency, 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,
  x.soemdsp_spectral_blur_metadata_json(), x.soemdsp_spectral_blur_metadata_json_size())));
assert.deepEqual(meta.parameters.map(p => p.key), ['smearSeconds', 'blurHz', 'diffusion', 'mix']);
assert.equal(meta.parameters[0].unit, 's'); assert.equal(meta.parameters[1].unit, 'Hz');
assert.ok(meta.parameters.every(p => p.tooltip));
function render(h, n, sr, params, input) {
  const left = new Float64Array(n), right = new Float64Array(n);
  for (let i = 0; i < n; ++i) {
    const a = input(i);
    left[i] = x.soemdsp_spectral_blur_sample(h, a[0], a[1], ...params, sr);
    right[i] = x.soemdsp_spectral_blur_right(h);
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
  }
  return [left, right];
}
const energy = (a, lo = 0, hi = a.length) => a.slice(lo, hi).reduce((e, v) => e + v * v, 0);
for (const sr of [44100, 48000, 96000]) {
  const h = x.soemdsp_spectral_blur_create(); assert.ok(h);
  const input = i => [0.1 * Math.sin(i * 0.13) + (i % 173 === 0 ? 0.1 : 0), -0.03 * Math.cos(i * 0.07)];
  const neutral = render(h, latency + 20000, sr, [0, 0, 0, 1], input);
  let error = 0;
  for (let i = latency; i < neutral[0].length; ++i) for (let c = 0; c < 2; ++c)
    error = Math.max(error, Math.abs(neutral[c][i] - input(i - latency)[c]));
  assert.ok(error < 2e-5, `neutral reconstruction ${sr}: ${error}`);
  x.soemdsp_spectral_blur_reset(h);
  const dry = render(h, latency + 10, sr, [2, 100, 1, 0], i => [i === 0 ? 1 : 0, 0]);
  assert.equal(dry[0][latency], 1); assert.equal(energy(dry[1]), 0);
  x.soemdsp_spectral_blur_reset(h);
  const silence = render(h, 12000, sr, [5, 2000, 1, 1], () => [0, 0]);
  assert.equal(energy(silence[0]) + energy(silence[1]), 0);
  x.soemdsp_spectral_blur_reset(h);
  const wash = render(h, sr * 2, sr, [0.5, 200, 1, 1], i => {
    const v = i < sr / 10 ? 0.2 * Math.sin(2 * Math.PI * 440 * i / sr) : 0;
    return [v, v * 0.4];
  });
  assert.ok(energy(wash[0], Math.floor(sr / 2), sr) > 1e-5, 'tail persists after excitation');
  let stereoError = 0;
  for (let i = 0; i < wash[0].length; ++i) stereoError = Math.max(stereoError, Math.abs(wash[1][i] - 0.4 * wash[0][i]));
  // Float FFT phase estimation in quiet bins accumulates small tail errors.
  assert.ok(stereoError < 5e-5, `matched stereo scaling ${stereoError}`);
  x.soemdsp_spectral_blur_reset(h);
  const isolated = render(h, 20000, sr, [1, 500, 1, 1], i => [i === 0 ? 1 : 0, 0]);
  assert.equal(energy(isolated[1]), 0, 'no cross-channel leakage');
  const memory = x.memory.buffer.byteLength;
  for (let i = 0; i < 12000; ++i) x.soemdsp_spectral_blur_sample(h, 0.1, -0.1,
    i % 3 ? 5 : 0, i % 2 ? 15000 : 0, (i % 100) / 100, 1, sr);
  assert.equal(x.memory.buffer.byteLength, memory, 'no processing-time memory growth');
  assert.equal(x.soemdsp_spectral_blur_sample(h, NaN, 0, 1, 200, 1, 1, sr), 0);
  const recovery = render(h, 12000, sr, [0, 0, 0, 1], () => [0, 0]);
  assert.equal(energy(recovery[0]) + energy(recovery[1]), 0);
  x.soemdsp_spectral_blur_destroy(h);
  console.log(`${sr} Hz: neutral ${error.toExponential(2)}, stereo ${stereoError.toExponential(2)}, dry latency, silence, sustained wash, stereo, modulation and recovery pass.`);
}
const start = performance.now();
const h = x.soemdsp_spectral_blur_create();
render(h, 48000, 48000, [2, 1000, 1, 1], i => [Math.sin(i * 0.3) * 0.1, 0]);
console.log(`One audio second: ${(performance.now() - start).toFixed(1)} ms including JS test overhead (not a DAW CPU reading).`);
x.soemdsp_spectral_blur_destroy(h);
