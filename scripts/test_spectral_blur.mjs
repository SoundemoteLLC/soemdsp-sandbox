import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_blur/spectral_blur.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const latency = x.soemdsp_spectral_blur_latency();
assert.equal(latency, 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,
  x.soemdsp_spectral_blur_metadata_json(), x.soemdsp_spectral_blur_metadata_json_size())));
assert.deepEqual(meta.parameters.map(p => p.key), ['fftSize', 'smearSeconds', 'blurHz', 'diffusion', 'stereoSpread', 'phaseSmoothMs', 'amplitudeSmoothMs', 'swarm', 'swarmRate', 'swarmDrift', 'swarmSeed', 'mix']);
assert.equal(meta.parameters.find(p => p.key === 'swarm').defaultValue, '0');
assert.equal(meta.parameters.find(p => p.key === 'swarmDrift').defaultValue, '0');
assert.equal(meta.parameters.find(p => p.key === 'swarmSeed').kind, 'seed');
assert.equal(meta.parameters.find(p => p.key === 'swarmRate').unit, 'Hz');
assert.equal(x.soemdsp_spectral_blur_version(), 5);
assert.equal(meta.parameters.find(p => p.key === 'smearSeconds').unit, 's');
assert.equal(meta.parameters.find(p => p.key === 'blurHz').unit, 'Hz');
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
  x.soemdsp_spectral_blur_set_stereo_spread(h, 0);
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
  x.soemdsp_spectral_blur_set_stereo_spread(h, 1);
  const wide = render(h, sr, sr, [0.46, 490.89, 0.402, 1], i => {
    const v = 0.1 * Math.sin(2 * Math.PI * 440 * i / sr); return [v, v];
  });
  let sideEnergy = 0;
  for (let i = 0; i < wide[0].length; ++i) sideEnergy += (wide[0][i] - wide[1][i]) ** 2;
  assert.ok(sideEnergy > energy(wide[0]) * 0.01, 'mono input can produce a stereo wash');
  x.soemdsp_spectral_blur_set_stereo_spread(h, 0);
  x.soemdsp_spectral_blur_reset(h);
  x.soemdsp_spectral_blur_set_smoothing(h, 30, 50);
  const soft = render(h, sr, sr, [0.46, 490.89, 0.402, 1], i => [i < sr / 10 ? 0.2 : 0, 0]);
  assert.ok(energy(soft[0]) > 1e-6);
  assert.equal(energy(soft[1]), 0);
  x.soemdsp_spectral_blur_set_smoothing(h, 10, 0);
  const step = i => [i >= sr / 4 ? 0.1 : 0, 0];
  const stepSlope = values => {
    let peak = 0;
    for (let i = 1; i < values.length; ++i) peak = Math.max(peak, Math.abs(values[i] - values[i - 1]));
    return peak;
  };
  x.soemdsp_spectral_blur_reset(h);
  x.soemdsp_spectral_blur_set_smoothing(h, 0, 0);
  const sharpStep = render(h, sr, sr, [0, 0, 0, 1], step);
  x.soemdsp_spectral_blur_reset(h);
  x.soemdsp_spectral_blur_set_smoothing(h, 0, 50);
  const softStep = render(h, sr, sr, [0, 0, 0, 1], step);
  assert.ok(stepSlope(softStep[0]) < stepSlope(sharpStep[0]) * 0.8,
    `Amplitude Smooth softens magnitude steps: ${stepSlope(softStep[0])} vs ${stepSlope(sharpStep[0])}`);
  assert.ok(Math.abs(softStep[0].at(-1) - 0.1) < 1e-4, 'Amplitude Smooth retains steady level');
  x.soemdsp_spectral_blur_set_smoothing(h, 10, 0);
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
for (const sr of [44100, 48000, 96000]) for (const length of [512, 1024, 2048, 4096, 8192, 16384]) {
  const h = x.soemdsp_spectral_blur_create();
  assert.equal(x.soemdsp_spectral_blur_set_fft_size(h, length), 0);
  const input = i => [Math.sin(i * 0.13) * 0.1, Math.cos(i * 0.07) * 0.02];
  const out = render(h, length + 16000, sr, [0, 0, 0, 1], input);
  let error = 0;
  for (let i = length; i < out[0].length; ++i) for (let c = 0; c < 2; ++c)
    error = Math.max(error, Math.abs(out[c][i] - input(i - length)[c]));
  assert.ok(error < 2e-5, `${sr}/${length} neutral and selected latency: ${error}`);
  assert.equal(x.soemdsp_spectral_blur_fft_size(h), length);
  assert.equal(x.soemdsp_spectral_blur_latency_for_handle(h), length);
  x.soemdsp_spectral_blur_destroy(h);
}
{
  const h = x.soemdsp_spectral_blur_create();
  render(h, 12000, 48000, [0, 0, 0, 1], () => [0.1, 0.1]);
  const memory = x.memory.buffer.byteLength;
  for (const length of [512, 2048, 8192, 16384, 1024, 4096, 512]) {
    x.soemdsp_spectral_blur_set_fft_size(h, length);
    const out = render(h, 24000, 48000, [0, 0, 0, 1], () => [0.1, 0.1]);
    assert.ok(out[0].every(v => Math.abs(v - 0.1) < 2e-6), 'warm aligned switch stays neutral without gaps');
    assert.equal(x.soemdsp_spectral_blur_fft_size(h), length);
  }
  for (const length of [4096, 512, 2048]) {
    x.soemdsp_spectral_blur_set_fft_size(h, length);
    render(h, 256, 48000, [0.46, 490.89, 0.402, 1], () => [0.1, 0.1]);
  }
  render(h, 24000, 48000, [0.46, 490.89, 0.402, 1], () => [0.1, 0.1]);
  assert.equal(x.soemdsp_spectral_blur_fft_size(h), 2048, 'latest queued size wins');
  assert.equal(x.soemdsp_spectral_blur_set_fft_size(h, 123), -1, 'invalid sizes are rejected');
  assert.equal(x.memory.buffer.byteLength, memory, 'switching uses preallocated cores');
  x.soemdsp_spectral_blur_destroy(h);
}
const h = x.soemdsp_spectral_blur_create();
const referenceInput = i => [0.05 * Math.sin(i * 0.17) * (i % 6000 < 3000 ? 1 : 0.1), 0];
const original = render(h, 48000, 48000, [0.46, 490.89, 0.402, 1], referenceInput);
x.soemdsp_spectral_blur_reset(h);
const louder = render(h, 48000, 48000, [0.46, 490.89, 0.402, 1], i => referenceInput(i).map(v => v * 10));
let scalingError = 0;
for (let i = 0; i < louder[0].length; ++i) scalingError += (louder[0][i] - 10 * original[0][i]) ** 2;
assert.ok(scalingError / energy(louder[0]) < 1e-5, 'no new compression/limiting at the user partial-diffusion settings');
x.soemdsp_spectral_blur_reset(h);
const start = performance.now();
render(h, 48000, 48000, [2, 1000, 1, 1], i => [Math.sin(i * 0.3) * 0.1, 0]);
console.log(`One audio second: ${(performance.now() - start).toFixed(1)} ms including JS test overhead (not a DAW CPU reading).`);
x.soemdsp_spectral_blur_destroy(h);

// ---------------------------------------------------------------------------------------------------------------------------------
// Swarm (+ Rate, Drift, Seed): fuzzy per-bin wobble that stays in place in time. Separate from Diffusion, which is not touched.
{
  const sr = 48000;
  const swarmSet = (h, swarm, rate, drift, seed) => x.soemdsp_spectral_blur_set_swarm(h, swarm, rate, drift, seed);
  const fresh = (stereoSpread = 0) => { const h = x.soemdsp_spectral_blur_create(); x.soemdsp_spectral_blur_set_stereo_spread(h, stereoSpread); x.soemdsp_spectral_blur_set_smoothing(h, 10, 0); return h; };
  const tone = i => { const v = 0.1 * Math.sin(2 * Math.PI * 440 * i / sr) + 0.05 * Math.sin(2 * Math.PI * 1234 * i / sr); return [v, 0.4 * v]; };
  const sameArrays = (a, b) => { for (let c = 0; c < 2; ++c) for (let i = 0; i < a[c].length; ++i) if (a[c][i] !== b[c][i]) return false; return true; };
  const diffEnergy = (a, b) => { let e = 0; for (let i = 0; i < a[0].length; ++i) e += (a[0][i] - b[0][i]) ** 2; return e; };
  const n = sr;
  // the old settings, the module's defaults and a few other old-style settings
  for (const params of [[2, 100, 1, 1], [0.46, 490.89, 0.402, 1], [0, 0, 0, 1], [0, 0, 0, 0.5]]) {
    const old = fresh(1); // the module as it was: set_swarm never called
    const a = render(old, n, sr, params, tone);
    const off = fresh(1); swarmSet(off, 0, 5, 0, 1);
    const b = render(off, n, sr, params, tone);
    assert.ok(sameArrays(a, b), `Swarm 0 / Drift 0 is bit-identical to the old module at ${params}`);
    const seeded = fresh(1); swarmSet(seeded, 0, 33, 0, 987654);
    assert.ok(sameArrays(a, render(seeded, n, sr, params, tone)), 'Seed and Rate do not change the output while Swarm and Drift are 0');
    for (const h of [old, off, seeded]) x.soemdsp_spectral_blur_destroy(h);
  }
  // determinism: same Seed + input + params -> same output, a different Seed changes the wobble, a reset reseeds cleanly
  {
    const run = (seed) => { const h = fresh(); swarmSet(h, 0.8, 5, 0.3, seed); const out = render(h, n, sr, [0, 0, 0, 1], tone); x.soemdsp_spectral_blur_destroy(h); return out; };
    const one = run(1), again = run(1), other = run(2);
    assert.ok(sameArrays(one, again), 'same Seed, same input, same params: identical output');
    assert.ok(diffEnergy(one, other) > energy(one[0]) * 0.01, 'a different Seed changes the wobble');
    const h = fresh(); swarmSet(h, 0.8, 5, 0.3, 1);
    render(h, 20000, sr, [0, 0, 0, 1], tone);
    x.soemdsp_spectral_blur_reset(h);
    assert.ok(sameArrays(one, render(h, n, sr, [0, 0, 0, 1], tone)), 'a reset reseeds the Swarm stream');
    swarmSet(h, 0.8, 5, 0.3, 7); swarmSet(h, 0.8, 5, 0.3, 1);
    x.soemdsp_spectral_blur_reset(h);
    assert.ok(sameArrays(one, render(h, n, sr, [0, 0, 0, 1], tone)), 'changing the Seed back and resetting returns the same sound');
    x.soemdsp_spectral_blur_destroy(h);
  }
  // it swarms: Swarm up really changes the sound, Drift alone too, and more Swarm moves further
  {
    const base = fresh(); const a = render(base, n, sr, [0, 0, 0, 1], tone);
    const low = fresh(); swarmSet(low, 0.2, 5, 0, 1); const b = render(low, n, sr, [0, 0, 0, 1], tone);
    const high = fresh(); swarmSet(high, 1, 5, 0, 1); const c = render(high, n, sr, [0, 0, 0, 1], tone);
    const drift = fresh(); swarmSet(drift, 0, 5, 1, 1); const d = render(drift, n, sr, [0, 0, 0, 1], tone);
    assert.ok(diffEnergy(a, b) > 0 && diffEnergy(a, c) > diffEnergy(a, b), 'more Swarm moves the sound further');
    assert.ok(diffEnergy(a, d) > 0, 'Drift alone changes the sound');
    for (const h of [base, low, high, drift]) x.soemdsp_spectral_blur_destroy(h);
  }
  // in place: with Time Smear, Frequency Blur, Diffusion and Amplitude Smooth at 0 an impulse leaves no tail past the window, and a tone
  // does not spread into far frequencies (a smear / wash would)
  {
    const h = fresh(); swarmSet(h, 1, 5, 0, 1);
    const size = x.soemdsp_spectral_blur_fft_size(h) || 4096;
    const imp = render(h, size * 6, sr, [0, 0, 0, 1], i => [i === 0 ? 1 : 0, 0]);
    const inEnergy = energy(imp[0]);
    assert.ok(inEnergy > 0.2 && inEnergy < 4, `an impulse keeps a comparable energy (${inEnergy})`);
    assert.ok(energy(imp[0], size * 2 + 64) < inEnergy * 1e-6, 'no tail past the analysis window after the impulse');
    x.soemdsp_spectral_blur_destroy(h);
    const t = fresh(); swarmSet(t, 1, 5, 0, 1);
    const m = 32768, out = render(t, m + size, sr, [0, 0, 0, 1], i => { const v = 0.1 * Math.sin(2 * Math.PI * 1000 * i / sr); return [v, v]; })[0].slice(size);
    // one DFT bin per 1.46 Hz: count energy within +-150 Hz of 1 kHz against the total
    const power = (f0) => { let re = 0, im = 0; for (let i = 0; i < m; ++i) { const ph = 2 * Math.PI * f0 * i / sr; re += out[i] * Math.cos(ph); im += out[i] * Math.sin(ph); } return re * re + im * im; };
    let near = 0, far = 0;
    for (let f0 = 300; f0 <= 1700; f0 += 20) { const p = power(f0); if (Math.abs(f0 - 1000) <= 150) near += p; else far += p; }
    assert.ok(far < near * 0.05, `Swarm keeps the energy around the partial (far ${far.toExponential(2)} vs near ${near.toExponential(2)})`);
    x.soemdsp_spectral_blur_destroy(t);
  }
  // stereo: a mono input, Stereo Spread 0, Swarm and Drift up -> Left and Right match
  {
    const h = fresh(0); swarmSet(h, 1, 9, 1, 5);
    const out = render(h, n, sr, [0, 0, 0, 1], i => { const v = 0.1 * Math.sin(i * 0.11) + 0.03 * Math.sin(i * 0.37); return [v, v]; });
    let worst = 0;
    for (let i = 0; i < n; ++i) worst = Math.max(worst, Math.abs(out[0][i] - out[1][i]));
    assert.ok(worst < 1e-9, `mono in, Stereo Spread 0: Left and Right match (${worst})`);
    x.soemdsp_spectral_blur_destroy(h);
  }
  // no NaN / Inf: silence, loud bursts, rapid parameter edits and size changes; the local reset still recovers
  {
    const h = fresh(1); swarmSet(h, 1, 40, 1, 3);
    const silence = render(h, 12000, sr, [0, 0, 0, 1], () => [0, 0]);
    assert.equal(energy(silence[0]) + energy(silence[1]), 0, 'silence stays silent under Swarm');
    let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 60000; ++i) {
      if (i % 64 === 0) { swarmSet(h, rnd() * 1.4 - 0.2, rnd() * 60, rnd() * 1.4 - 0.2, Math.floor(rnd() * 20000000)); x.soemdsp_spectral_blur_set_fft_size(h, [512, 1024, 2048, 4096][Math.floor(rnd() * 4)]); }
      const burst = i % 9000 < 300 ? 8 : 0.1;
      const l = x.soemdsp_spectral_blur_sample(h, burst * Math.sin(i * 0.2), -burst * Math.sin(i * 0.31), rnd() * 3, rnd() * 3000, rnd(), 1, sr);
      assert.ok(Number.isFinite(l) && Number.isFinite(x.soemdsp_spectral_blur_right(h)), 'finite output under rapid edits');
    }
    assert.equal(x.soemdsp_spectral_blur_sample(h, NaN, 0, 1, 200, 1, 1, sr), 0);
    swarmSet(h, NaN, NaN, Infinity, NaN);
    const recovery = render(h, 12000, sr, [0, 0, 0, 1], () => [0, 0]);
    assert.equal(energy(recovery[0]) + energy(recovery[1]), 0, 'non-finite settings and input recover to silence');
    x.soemdsp_spectral_blur_destroy(h);
  }
  // the parameter definitions own the ranges: nothing in the DSP clamps Rate, Swarm, Drift or Seed (values past the old suggested ranges run and stay finite)
  {
    const reference = fresh(); swarmSet(reference, 1, 40, 1, 7); const atOld = render(reference, n, sr, [0, 0, 0, 1], tone);
    const wide = fresh(); swarmSet(wide, 1, 400, 1, 7); const atWide = render(wide, n, sr, [0, 0, 0, 1], tone);
    assert.ok(diffEnergy(atOld, atWide) > 0, 'Rate 400 Hz is used as given, not clamped to the old 40 Hz');
    const rateSlow = fresh(); swarmSet(rateSlow, 1, 0.01, 1, 7);
    assert.ok(diffEnergy(atOld, render(rateSlow, n, sr, [0, 0, 0, 1], tone)) > 0, 'Rate 0.01 Hz is used as given, not floored to the old 0.1 Hz');
    const big = fresh(); swarmSet(big, 3, 5000, 4, 4000000000);
    const out = render(big, n, sr, [0, 0, 0, 1], tone);
    assert.ok(out[0].every(Number.isFinite), 'Swarm 3, Drift 4, Rate 5000 and a 32-bit Seed stay finite');
    const more = fresh(); swarmSet(more, 1, 5, 0, 1); const one = render(more, n, sr, [0, 0, 0, 1], tone);
    const twice = fresh(); swarmSet(twice, 2, 5, 0, 1); const two = render(twice, n, sr, [0, 0, 0, 1], tone);
    assert.ok(diffEnergy(one, two) > 0, 'Swarm 2 is used as given, not clamped to 1');
    const seedA = fresh(); swarmSet(seedA, 1, 5, 0, 16777215); const seedB = fresh(); swarmSet(seedB, 1, 5, 0, 16777216);
    assert.ok(diffEnergy(render(seedA, n, sr, [0, 0, 0, 1], tone), render(seedB, n, sr, [0, 0, 0, 1], tone)) > 0, 'Seeds past 16777215 are different seeds');
    for (const h of [reference, wide, rateSlow, big, more, twice, seedA, seedB]) x.soemdsp_spectral_blur_destroy(h);
  }
  // CPU: Swarm adds a few per-bin poles and randoms per hop and no FFT; compare against the same module with Swarm off at 16384
  {
    const time = (swarm) => { const h = fresh(1); x.soemdsp_spectral_blur_set_fft_size(h, 16384); swarmSet(h, swarm, 5, swarm, 1); render(h, 20000, sr, [1, 300, 1, 1], tone); const t0 = performance.now(); render(h, sr, sr, [1, 300, 1, 1], tone); const dt = performance.now() - t0; x.soemdsp_spectral_blur_destroy(h); return dt; };
    const off = time(0), on = time(1);
    console.log(`Swarm CPU at 16384, one audio second: off ${off.toFixed(1)} ms, on ${on.toFixed(1)} ms (JS harness numbers, not a DAW CPU reading).`);
    assert.ok(on < off * 2.5 + 50, 'no large CPU regression with Swarm on');
  }
  console.log('Swarm: off is bit-identical, deterministic, reseeds, in place, linked stereo, finite and recovers.');
}
