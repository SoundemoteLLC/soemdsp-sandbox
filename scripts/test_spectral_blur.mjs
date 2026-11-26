// Spectral Blur (the Cloud engine): Fuzz in cents, Wander in Hz, Seed, FFT Size, Mix. Four voices of one analysis, 8x overlap.
// Smear is the time/frequency smear, Warble the phase wobble: separate modules (test_spectral_smear.mjs, test_spectral_warble.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_blur/spectral_blur.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const P = 'soemdsp_spectral_blur_';
const f = (name, ...args) => x[P + name](...args);
assert.equal(f('latency'), 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, f('metadata_json'), f('metadata_json_size'))));
assert.deepEqual(meta.parameters.map(p => p.key), ['fftSize', 'fuzz', 'wander', 'voices', 'seed', 'mix']);
assert.equal(meta.targetType, 'spectralBlur');
assert.equal(meta.parameters.find(p => p.key === 'fuzz').unit, '¢');
assert.equal(meta.parameters.find(p => p.key === 'wander').unit, 'Hz');
assert.equal(meta.parameters.find(p => p.key === 'seed').kind, 'seed');
assert.ok(meta.parameters.every(p => p.tooltip));
const sr = 48000;
// sample(h, l, r, mix, rate)
const render = (h, n, input) => {
  const left = new Float64Array(n), right = new Float64Array(n);
  for (let i = 0; i < n; ++i) {
    const a = input(i);
    left[i] = f('sample', h, a[0], a[1], 1, sr); right[i] = f('right', h);
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
  }
  return [left, right];
};
const energy = (a, lo = 0, hi = a.length) => a.slice(lo, hi).reduce((e, v) => e + v * v, 0);
const rms = a => Math.sqrt(energy(a) / a.length);
const fresh = (fuzz, wander = 0.5, seed = 1, voices = 3) => { const h = f('create'); assert.ok(h); f('set_cloud', h, fuzz, wander, voices, seed); return h; };
const sine = f0 => i => { const v = 0.1 * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; };
const settle = 20000, m = 24576;
const run = (fuzz, wander, f0, seed = 1) => { const h = fresh(fuzz, wander, seed); const out = render(h, settle + m, sine(f0))[0].slice(settle); f('destroy', h); return out; };
// spectral spread of a sine's output in cents RMS around the fundamental
const spreadCents = (out, f0) => {
  let num = 0, den = 0;
  for (let c = -600; c <= 600; c += 6) {
    const fr = f0 * 2 ** (c / 1200); let re = 0, im = 0;
    for (let i = 0; i < out.length; ++i) { const ph = 2 * Math.PI * fr * i / sr; re += out[i] * Math.cos(ph); im += out[i] * Math.sin(ph); }
    const p = re * re + im * im; num += p * c * c; den += p;
  }
  return Math.sqrt(num / den);
};
// Fuzz 0 is dry (the delayed input, to float precision)
{
  const h = fresh(0);
  const input = i => [0.1 * Math.sin(i * 0.13) + (i % 173 === 0 ? 0.1 : 0), -0.03 * Math.cos(i * 0.07)];
  const out = render(h, 4096 + 30000, input);
  let error = 0;
  for (let i = 4096 + 12000; i < out[0].length; ++i) for (let c = 0; c < 2; ++c) error = Math.max(error, Math.abs(out[c][i] - input(i - 4096)[c]));
  assert.ok(error < 1e-4, `Fuzz 0 is dry at the usual window delay (${error})`);
  f('destroy', h);
}
// the spread is in cents: about the same width at 500 Hz and 2 kHz, and more Fuzz is wider
{
  const low = spreadCents(run(50, 0.5, 500), 500), high = spreadCents(run(50, 0.5, 2000), 2000);
  console.log(`Fuzz 50 cents: 500 Hz spreads ${low.toFixed(1)} cents, 2 kHz ${high.toFixed(1)} cents.`);
  assert.ok(low > 5 && high > 5, `Fuzz spreads both (${low}, ${high})`);
  assert.ok(high / low > 0.4 && high / low < 2.5, `the width is about the same in cents at 500 Hz and 2 kHz (${low} vs ${high})`);
  const narrow = spreadCents(run(10, 0.5, 2000), 2000), wide = spreadCents(run(100, 0.5, 2000), 2000);
  assert.ok(narrow < high && high < wide, `more Fuzz is wider (${narrow} < ${high} < ${wide})`);
}
// in place: an impulse leaves no tail past the window
{
  const h = fresh(100);
  const size = 4096, imp = render(h, size * 6, i => [i === 0 ? 1 : 0, 0]);
  const e = energy(imp[0]);
  assert.ok(e > 0.2 && e < 4, `an impulse keeps a comparable energy (${e})`);
  assert.ok(energy(imp[0], size * 2 + 64) < e * 1e-6, 'no tail past the analysis window after the impulse');
  f('destroy', h);
}
// level: a slow, moderate detune keeps the loudness of the input (within a dB); no clamp, no makeup beyond the per-frame match
{
  const dry = rms(run(0, 0.5, 1000));
  for (const [fuzz, wander] of [[10, 0.5], [50, 0.5], [50, 2]]) {
    const ratio = rms(run(fuzz, wander, 1000)) / dry;
    assert.ok(ratio > 0.75 && ratio < 1.15, `Fuzz ${fuzz} cents at ${wander} Hz keeps the level (${ratio})`);
  }
}
// determinism and Seed; Wander 0 freezes the detune
{
  const a = run(80, 0.5, 1000, 1), b = run(80, 0.5, 1000, 1), c = run(80, 0.5, 1000, 2);
  let same = true, diff = 0;
  for (let i = 0; i < a.length; ++i) { if (a[i] !== b[i]) same = false; diff += (a[i] - c[i]) ** 2; }
  assert.ok(same, 'same Seed, same input, same settings: identical output');
  assert.ok(diff > energy(a) * 0.01, 'a different Seed changes the fur');
  const still = run(80, 0, 1000, 1);
  assert.ok(still.every(Number.isFinite) && rms(still) > 0.01, 'Wander 0 is finite and sounds');
}
// stereo is linked: mono in gives matching Left and Right
{
  const h = fresh(100);
  const out = render(h, 30000, i => { const v = 0.1 * Math.sin(i * 0.11) + 0.03 * Math.sin(i * 0.37); return [v, v]; });
  let worst = 0; for (let i = 0; i < out[0].length; ++i) worst = Math.max(worst, Math.abs(out[0][i] - out[1][i]));
  assert.ok(worst < 1e-9, `Left and Right stay linked (${worst})`);
  f('destroy', h);
}
// FFT size changes (warm core + crossfade): neutral at Fuzz 0 without gaps, invalid sizes rejected
{
  const h = fresh(0);
  render(h, 12000, () => [0.1, 0.1]);
  for (const length of [512, 2048, 8192, 16384, 1024, 4096]) {
    f('set_fft_size', h, length);
    const out = render(h, 24000, () => [0.1, 0.1]);
    assert.ok(out[0].every(v => Math.abs(v - 0.1) < 2e-6), 'warm aligned switch stays neutral without gaps');
    assert.equal(f('fft_size', h), length);
  }
  assert.equal(f('set_fft_size', h, 123), -1);
  f('destroy', h);
}
// finite under rapid edits, NaN input and a local reset; CPU does not depend on the pitch
{
  const h = fresh(0); let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 60000; ++i) {
    if (i % 64 === 0) { f('set_cloud', h, rnd() * 400, rnd() * 30, 1 + Math.floor(rnd() * 6), Math.floor(rnd() * 1e6)); f('set_fft_size', h, [512, 1024, 2048, 4096][Math.floor(rnd() * 4)]); }
    const burst = i % 9000 < 300 ? 8 : 0.1;
    const l = f('sample', h, burst * Math.sin(i * 0.2), -burst * Math.sin(i * 0.31), rnd(), sr);
    assert.ok(Number.isFinite(l) && Number.isFinite(f('right', h)), 'finite under rapid edits');
  }
  f('set_cloud', h, NaN, NaN, NaN, NaN);
  assert.equal(f('sample', h, NaN, 0, 1, sr), 0);
  f('destroy', h);
  const time = f0 => { const hh = fresh(200); f('set_fft_size', hh, 16384); render(hh, 20000, sine(f0)); const t0 = performance.now(); render(hh, sr, sine(f0)); const dt = performance.now() - t0; f('destroy', hh); return dt; };
  const lowCost = time(100), highCost = time(8000);
  console.log(`CPU at 16384, 8x hop, 4 voices, one audio second: 100 Hz ${lowCost.toFixed(1)} ms, 8 kHz ${highCost.toFixed(1)} ms (JS harness numbers, not a DAW CPU reading).`);
  assert.ok(Math.abs(lowCost - highCost) < Math.max(lowCost, highCost) * 0.5 + 20, 'cost does not depend on the input pitch');
}
console.log('Blur: dry at Fuzz 0, cents-wide at every pitch, in place, level kept, deterministic, linked stereo, finite.');
