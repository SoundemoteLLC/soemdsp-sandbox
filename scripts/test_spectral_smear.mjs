// Spectral Smear: Time Smear, Blur (cents), Diffusion, Amplitude Smooth, FFT Size, Mix. (The Cloud engine is Spectral Blur, the phase wobble Spectral Warble.)
import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_smear/spectral_smear.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const P = 'soemdsp_spectral_smear_';
const f = (name, ...args) => x[P + name](...args);
const latency = f('latency');
assert.equal(latency, 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, f('metadata_json'), f('metadata_json_size'))));
assert.deepEqual(meta.parameters.map(p => p.key), ['fftSize', 'smearSeconds', 'blurHz', 'blurCents', 'diffusion', 'stereoSpread', 'phaseSmoothMs', 'amplitudeSmoothMs', 'mix']);
assert.equal(meta.targetType, 'spectralSmear');
assert.equal(meta.parameters.find(p => p.key === 'smearSeconds').unit, 's');
assert.equal(meta.parameters.find(p => p.key === 'blurCents').unit, '¢');
assert.equal(meta.parameters.find(p => p.key === 'blurCents').defaultValue, '0');
assert.ok(meta.parameters.every(p => p.tooltip));
// sample(h, l, r, seconds, frequency blur Hz, diffusion, mix, rate)
function render(h, n, sr, params, input) {
  const left = new Float64Array(n), right = new Float64Array(n);
  for (let i = 0; i < n; ++i) {
    const a = input(i);
    left[i] = f('sample', h, a[0], a[1], ...params, sr);
    right[i] = f('right', h);
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
  }
  return [left, right];
}
const energy = (a, lo = 0, hi = a.length) => a.slice(lo, hi).reduce((e, v) => e + v * v, 0);
const rms = a => Math.sqrt(energy(a) / a.length);
for (const sr of [44100, 48000, 96000]) {
  const h = f('create'); assert.ok(h); f('set_stereo_spread', h, 0); // spread 0 links the diffusion of the two channels
  const input = i => [0.1 * Math.sin(i * 0.13) + (i % 173 === 0 ? 0.1 : 0), -0.03 * Math.cos(i * 0.07)];
  const neutral = render(h, latency + 20000, sr, [0, 0, 0, 1], input);
  let error = 0;
  for (let i = latency; i < neutral[0].length; ++i) for (let c = 0; c < 2; ++c)
    error = Math.max(error, Math.abs(neutral[c][i] - input(i - latency)[c]));
  assert.ok(error < 2e-5, `neutral reconstruction ${sr}: ${error}`);
  f('reset', h);
  const dry = render(h, latency + 10, sr, [2, 0, 1, 0], i => [i === 0 ? 1 : 0, 0]);
  assert.equal(dry[0][latency], 1); assert.equal(energy(dry[1]), 0);
  f('reset', h);
  const silence = render(h, 12000, sr, [5, 0, 1, 1], () => [0, 0]);
  assert.equal(energy(silence[0]) + energy(silence[1]), 0);
  f('reset', h);
  f('set_blur_cents', h, 100);
  const wash = render(h, sr * 2, sr, [0.5, 0, 1, 1], i => { const v = i < sr / 10 ? 0.2 * Math.sin(2 * Math.PI * 440 * i / sr) : 0; return [v, v * 0.4]; });
  assert.ok(energy(wash[0], Math.floor(sr / 2), sr) > 1e-5, 'tail persists after excitation');
  let stereoError = 0;
  for (let i = 0; i < wash[0].length; ++i) stereoError = Math.max(stereoError, Math.abs(wash[1][i] - 0.4 * wash[0][i]));
  assert.ok(stereoError < 5e-5, `matched stereo scaling (the channels share the diffusion) ${stereoError}`);
  f('set_blur_cents', h, 0);
  f('reset', h);
  const isolated = render(h, 20000, sr, [1, 0, 1, 1], i => [i === 0 ? 1 : 0, 0]);
  assert.equal(energy(isolated[1]), 0, 'no cross-channel leakage');
  // Amplitude Smooth softens steps and keeps the steady level
  const step = i => [i >= sr / 4 ? 0.1 : 0, 0];
  const slope = v => { let peak = 0; for (let i = 1; i < v.length; ++i) peak = Math.max(peak, Math.abs(v[i] - v[i - 1])); return peak; };
  f('reset', h); f('set_smoothing', h, 10, 0);
  const sharp = render(h, sr, sr, [0, 0, 0, 1], step);
  f('reset', h); f('set_smoothing', h, 10, 50);
  const soft = render(h, sr, sr, [0, 0, 0, 1], step);
  assert.ok(slope(soft[0]) < slope(sharp[0]) * 0.8, `Amplitude Smooth softens magnitude steps: ${slope(soft[0])} vs ${slope(sharp[0])}`);
  assert.ok(Math.abs(soft[0].at(-1) - 0.1) < 1e-4, 'Amplitude Smooth retains steady level');
  f('set_smoothing', h, 10, 0); f('reset', h);
  const memory = x.memory.buffer.byteLength;
  for (let i = 0; i < 12000; ++i) { f('set_blur_cents', h, i % 2 ? 900 : 0); f('sample', h, 0.1, -0.1, i % 3 ? 5 : 0, i % 2 ? 15000 : 0, (i % 100) / 100, 1, sr); }
  assert.equal(x.memory.buffer.byteLength, memory, 'no processing-time memory growth');
  assert.equal(f('sample', h, NaN, 0, 1, 200, 1, 1, sr), 0);
  const recovery = render(h, 12000, sr, [0, 0, 0, 1], () => [0, 0]);
  assert.equal(energy(recovery[0]) + energy(recovery[1]), 0);
  f('destroy', h);
  console.log(`${sr} Hz: neutral ${error.toExponential(2)}, dry latency, silence, wash, linked stereo, Amplitude Smooth, modulation and recovery pass.`);
}
for (const sr of [44100, 48000, 96000]) for (const length of [512, 1024, 2048, 4096, 8192, 16384]) {
  const h = f('create');
  assert.equal(f('set_fft_size', h, length), 0);
  const input = i => [Math.sin(i * 0.13) * 0.1, Math.cos(i * 0.07) * 0.02];
  const out = render(h, length + 16000, sr, [0, 0, 0, 1], input);
  let error = 0;
  for (let i = length; i < out[0].length; ++i) for (let c = 0; c < 2; ++c) error = Math.max(error, Math.abs(out[c][i] - input(i - length)[c]));
  assert.ok(error < 2e-5, `${sr}/${length} neutral and selected latency: ${error}`);
  assert.equal(f('fft_size', h), length);
  assert.equal(f('latency_for_handle', h), length);
  f('destroy', h);
}
{
  const h = f('create');
  render(h, 12000, 48000, [0, 0, 0, 1], () => [0.1, 0.1]);
  const memory = x.memory.buffer.byteLength;
  for (const length of [512, 2048, 8192, 16384, 1024, 4096, 512]) {
    f('set_fft_size', h, length);
    const out = render(h, 24000, 48000, [0, 0, 0, 1], () => [0.1, 0.1]);
    assert.ok(out[0].every(v => Math.abs(v - 0.1) < 2e-6), 'warm aligned switch stays neutral without gaps');
    assert.equal(f('fft_size', h), length);
  }
  assert.equal(f('set_fft_size', h, 123), -1, 'invalid sizes are rejected');
  assert.equal(x.memory.buffer.byteLength, memory, 'switching uses preallocated cores');
  f('destroy', h);
}
// Blur is in cents: smooth, never louder than the input, and a cents width costs more level at a higher pitch than the same width at a low one
{
  const sr = 48000, settle = 20000, m = 24576;
  const sine = f0 => i => { const v = 0.1 * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; };
  const run = (f0, cents) => { const h = f('create'); f('set_blur_cents', h, cents); const out = render(h, settle + m, sr, [0, 0, 0, 1], sine(f0))[0].slice(settle); f('destroy', h); return out; };
  const kept = (f0, cents) => rms(run(f0, cents)) / rms(run(f0, 0));
  const low = kept(700, 300), high = kept(2800, 300);
  console.log(`Level kept with Blur 300 cents: 700 Hz ${low.toFixed(2)}, 2.8 kHz ${high.toFixed(2)}.`);
  assert.ok(low < 0.9 && high < 0.9 && low < 1.25 && high < 1.25, 'Blur does something at both pitches and never gains level');
  assert.ok(high < low - 0.1, 'a cents width is more Hz at a higher pitch, so it takes more level there');
}
{
  const h = f('create');
  const t0 = performance.now();
  render(h, 48000, 48000, [2, 1000, 1, 1], i => [Math.sin(i * 0.3) * 0.1, 0]);
  console.log(`One audio second: ${(performance.now() - t0).toFixed(1)} ms including JS test overhead (not a DAW CPU reading).`);
  f('destroy', h);
}
// Stereo Spread: with Diffusion on, a mono input gets a stereo wash when Stereo Spread is above 0 and stays mono at 0
{
  const sr = 48000;
  const side = spread => { const h = f('create'); f('set_stereo_spread', h, spread); const o = render(h, sr, sr, [0.46, 490.89, 0.402, 1], i => { const v = 0.1 * Math.sin(2 * Math.PI * 440 * i / sr); return [v, v]; }); f('destroy', h); let e = 0; for (let i = 0; i < o[0].length; ++i) e += (o[0][i] - o[1][i]) ** 2; return e / energy(o[0]); };
  assert.ok(side(0) < 1e-9 && side(1) > 0.01, `Stereo Spread decorrelates a mono input (${side(0)} vs ${side(1)})`);
}
// Frequency Blur is in Hz: same Hz at every pitch (same level loss at 700 Hz and 2.8 kHz)
{
  const sr = 48000, settle = 20000, m = 24576;
  const run = (f0, hz) => { const h = f('create'); f('set_stereo_spread', h, 0); const o = render(h, settle + m, sr, [0, hz, 0, 1], i => { const v = 0.1 * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; })[0].slice(settle); f('destroy', h); return rms(o); };
  const lo = run(700, 100) / run(700, 0), hi = run(2800, 100) / run(2800, 0);
  assert.ok(Math.abs(lo - hi) < 0.15 && lo < 0.9, `Frequency Blur is the same width in Hz at every pitch (${lo} vs ${hi})`);
}
