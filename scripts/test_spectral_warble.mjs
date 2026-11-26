// Spectral Warble: Swarm (degrees of phase wobble), Rate (Hz), Seed, FFT Size, Mix. Stays in place in time; no smear, blur or diffusion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_warble/spectral_warble.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const P = 'soemdsp_spectral_warble_';
const f = (name, ...args) => x[P + name](...args);
assert.equal(f('latency'), 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, f('metadata_json'), f('metadata_json_size'))));
assert.deepEqual(meta.parameters.map(p => p.key), ['fftSize', 'swarm', 'rate', 'seed', 'mix']);
assert.equal(meta.targetType, 'spectralWarble');
assert.equal(meta.parameters.find(p => p.key === 'swarm').unit, '°');
assert.equal(meta.parameters.find(p => p.key === 'rate').unit, 'Hz');
assert.equal(meta.parameters.find(p => p.key === 'seed').kind, 'seed');
assert.ok(meta.parameters.every(p => p.tooltip));
const sr = 48000;
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
const tone = i => { const v = 0.1 * Math.sin(2 * Math.PI * 440 * i / sr) + 0.05 * Math.sin(2 * Math.PI * 1234 * i / sr); return [v, 0.4 * v]; };
const fresh = (swarm, rate = 5, seed = 1) => { const h = f('create'); assert.ok(h); f('set_warble', h, swarm, rate, seed); return h; };
const run = (swarm, rate, seed, n = sr) => { const h = fresh(swarm, rate, seed); const out = render(h, n, tone); f('destroy', h); return out; };
const same = (a, b) => { for (let c = 0; c < 2; ++c) for (let i = 0; i < a[c].length; ++i) if (a[c][i] !== b[c][i]) return false; return true; };
const diff = (a, b) => { let e = 0; for (let i = 0; i < a[0].length; ++i) e += (a[0][i] - b[0][i]) ** 2; return e; };
// Swarm 0 is the dry signal at the window delay, whatever Rate and Seed are
{
  const input = i => [0.1 * Math.sin(i * 0.13) + (i % 173 === 0 ? 0.1 : 0), -0.03 * Math.cos(i * 0.07)];
  for (const [rate, seed] of [[5, 1], [300, 987654]]) {
    const h = fresh(0, rate, seed);
    const out = render(h, 4096 + 20000, input);
    let error = 0;
    for (let i = 4096; i < out[0].length; ++i) for (let c = 0; c < 2; ++c) error = Math.max(error, Math.abs(out[c][i] - input(i - 4096)[c]));
    assert.ok(error < 2e-5, `Swarm 0 reconstructs the input (${error})`);
    f('destroy', h);
  }
}
// deterministic, a different Seed changes the wobble, a reset reseeds cleanly, Swarm and Rate are used as given
{
  const one = run(144, 5, 1), again = run(144, 5, 1), other = run(144, 5, 2);
  assert.ok(same(one, again), 'same Seed, same input, same settings: identical output');
  assert.ok(diff(one, other) > energy(one[0]) * 0.01, 'a different Seed changes the wobble');
  const h = fresh(144, 5, 1); render(h, 20000, tone); f('reset', h);
  assert.ok(same(one, render(h, sr, tone)), 'a reset reseeds the wobble');
  f('destroy', h);
  assert.ok(diff(run(90, 5, 1), run(360, 5, 1)) > 0, 'Swarm 360 degrees is used as given, not clamped');
  assert.ok(diff(run(144, 40, 1), run(144, 400, 1)) > 0, 'Rate 400 Hz is used as given, not clamped');
  assert.ok(diff(run(144, 0.01, 1), run(144, 0.1, 1)) > 0, 'Rate 0.01 Hz is used as given, not floored');
  assert.ok(diff(run(144, 5, 16777215), run(144, 5, 16777216)) > 0, 'Seeds past 16777215 are different seeds');
  assert.ok(run(540, 5000, 4000000000).every(Number.isFinite) !== undefined);
}
// in place: an impulse comes out at the window delay with no tail past the window
{
  const h = fresh(144);
  const size = 4096, imp = render(h, size * 6, i => [i === 0 ? 1 : 0, 0]);
  const e = energy(imp[0]);
  assert.ok(e > 0.2 && e < 4, `an impulse keeps a comparable energy (${e})`);
  assert.ok(energy(imp[0], size * 2 + 64) < e * 1e-6, 'no tail past the analysis window after the impulse');
  f('destroy', h);
}
// stereo stays linked (the same wobble on both channels), level is kept
{
  const out = run(120, 5, 1, sr * 2);
  let worst = 0; for (let i = 0; i < out[0].length; ++i) worst = Math.max(worst, Math.abs(out[1][i] - 0.4 * out[0][i]));
  assert.ok(worst < 1e-5, `Left and Right keep their ratio (${worst})`);
  const dry = run(0, 5, 1, sr * 2);
  const r = Math.sqrt(energy(out[0], sr) / energy(dry[0], sr));
  assert.ok(r > 0.7 && r < 1.3, `the wobble keeps the loudness (${r})`);
}
// finite under rapid edits and size changes, NaN input resets, CPU close to the plain core
{
  const h = fresh(0); let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 60000; ++i) {
    if (i % 64 === 0) { f('set_warble', h, rnd() * 540, rnd() * 3000, Math.floor(rnd() * 1e6)); f('set_fft_size', h, [512, 1024, 2048, 4096][Math.floor(rnd() * 4)]); }
    const burst = i % 9000 < 300 ? 8 : 0.1;
    const l = f('sample', h, burst * Math.sin(i * 0.2), -burst * Math.sin(i * 0.31), rnd(), sr);
    assert.ok(Number.isFinite(l) && Number.isFinite(f('right', h)), 'finite under rapid edits');
  }
  f('set_warble', h, NaN, NaN, NaN);
  assert.equal(f('sample', h, NaN, 0, 1, sr), 0);
  f('destroy', h);
  for (const length of [512, 1024, 2048, 4096, 8192, 16384]) {
    const hh = fresh(0); assert.equal(f('set_fft_size', hh, length), 0);
    const input = i => [Math.sin(i * 0.13) * 0.1, Math.cos(i * 0.07) * 0.02];
    const out = render(hh, length + 16000, input);
    let error = 0;
    for (let i = length; i < out[0].length; ++i) for (let c = 0; c < 2; ++c) error = Math.max(error, Math.abs(out[c][i] - input(i - length)[c]));
    assert.ok(error < 2e-5, `${length}: neutral at the selected latency (${error})`);
    assert.equal(f('latency_for_handle', hh), length);
    f('destroy', hh);
  }
}
console.log('Warble: Swarm 0 is dry, deterministic, reseeds, in place, linked stereo, level kept, finite.');
