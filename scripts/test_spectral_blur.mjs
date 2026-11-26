import assert from 'node:assert/strict';
import fs from 'node:fs';
const compiled = await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/spectral_blur/spectral_blur.wasm', import.meta.url)));
const x = (await WebAssembly.instantiate(compiled, {})).exports;
const latency = x.soemdsp_spectral_blur_latency();
assert.equal(latency, 4096);
const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,
  x.soemdsp_spectral_blur_metadata_json(), x.soemdsp_spectral_blur_metadata_json_size())));
assert.deepEqual(meta.parameters.map(p => p.key), ['fftSize', 'smearSeconds', 'blurHz', 'blurCents', 'diffusion', 'stereoSpread', 'phaseSmoothMs', 'amplitudeSmoothMs', 'swarm', 'swarmLevel', 'swarmRate', 'swarmDrift', 'swarmSeed', 'swarmCharacter', 'swarmFuzz', 'cloudWander', 'swarmVoices', 'mix']);
assert.equal(meta.parameters.find(p => p.key === 'swarmCharacter').defaultValue, '0');
assert.equal(meta.parameters.find(p => p.key === 'swarmFuzz').defaultValue, '0');
assert.equal(meta.parameters.find(p => p.key === 'swarmFuzz').unit, '\u00a2');
assert.equal(meta.parameters.find(p => p.key === 'swarmVoices').defaultValue, '3');
assert.equal(meta.parameters.find(p => p.key === 'swarm').unit, '°');
assert.equal(meta.parameters.find(p => p.key === 'swarmLevel').unit, 'dB');
assert.equal(meta.parameters.find(p => p.key === 'swarmDrift').unit, 'Hz');
assert.equal(meta.parameters.find(p => p.key === 'swarm').defaultValue, '0');
assert.equal(meta.parameters.find(p => p.key === 'swarmDrift').defaultValue, '0');
assert.equal(meta.parameters.find(p => p.key === 'swarmSeed').kind, 'seed');
assert.equal(meta.parameters.find(p => p.key === 'swarmRate').unit, 'Hz');
assert.equal(x.soemdsp_spectral_blur_version(), 8);
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
  // Test shorthand: swarm 1 = 180 degrees of phase wobble and 6 dB of level wobble, drift 1 = 3 Hz of pitch wander (the real units go to the module).
  const swarmSet = (h, swarm, rate, drift, seed) => x.soemdsp_spectral_blur_set_swarm(h, swarm * 180, swarm * 6, rate, drift * 3, seed);
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
    // (the 16384-sample core pool holds about six handles at once, so free the ones already used)
    for (const h of [reference, wide, rateSlow, big]) x.soemdsp_spectral_blur_destroy(h);
    const more = fresh(); swarmSet(more, 1, 5, 0, 1); const one = render(more, n, sr, [0, 0, 0, 1], tone);
    const twice = fresh(); swarmSet(twice, 2, 5, 0, 1); const two = render(twice, n, sr, [0, 0, 0, 1], tone);
    assert.ok(diffEnergy(one, two) > 0, 'Swarm 2 is used as given, not clamped to 1');
    const seedA = fresh(); swarmSet(seedA, 1, 5, 0, 16777215); const seedB = fresh(); swarmSet(seedB, 1, 5, 0, 16777216);
    assert.ok(diffEnergy(render(seedA, n, sr, [0, 0, 0, 1], tone), render(seedB, n, sr, [0, 0, 0, 1], tone)) > 0, 'Seeds past 16777215 are different seeds');
    for (const h of [more, twice, seedA, seedB]) x.soemdsp_spectral_blur_destroy(h);
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

// ---------------------------------------------------------------------------------------------------------------------------------
// Cloud: fuzz in CENTS (a log-frequency spray, so a high partial gets the same relative width as a low one), white per-hop scatter,
// voices from one analysis, 8x overlap. Warble (character 0) is the Swarm path above.
{
  const sr = 48000;
  const cloudSet = (h, fuzz, voices = 3) => x.soemdsp_spectral_blur_set_cloud(h, 1, fuzz, voices);
  const fresh = () => { const h = x.soemdsp_spectral_blur_create(); x.soemdsp_spectral_blur_set_stereo_spread(h, 0); x.soemdsp_spectral_blur_set_smoothing(h, 10, 0); return h; };
  const sine = (f0) => i => { const v = 0.1 * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; };
  // spectral spread of a sine's output, in cents RMS around the fundamental (a fine grid of DFT lines, +-600 cents)
  const spreadCents = (out, f0) => {
    let num = 0, den = 0;
    for (let c = -600; c <= 600; c += 6) {
      const f = f0 * 2 ** (c / 1200); let re = 0, im = 0;
      for (let i = 0; i < out.length; ++i) { const ph = 2 * Math.PI * f * i / sr; re += out[i] * Math.cos(ph); im += out[i] * Math.sin(ph); }
      const p = re * re + im * im; num += p * c * c; den += p;
    }
    return Math.sqrt(num / den);
  };
  const m = 24576, settle = 20000;
  const run = (setup, f0) => { const h = fresh(); setup(h); const out = render(h, settle + m, sr, [0, 0, 0, 1], sine(f0))[0].slice(settle); x.soemdsp_spectral_blur_destroy(h); return out; };

  // Fuzz 0 is dry: Cloud on with no Fuzz reconstructs the delayed input
  {
    const h = fresh(); cloudSet(h, 0);
    const input = i => [0.1 * Math.sin(i * 0.13) + (i % 173 === 0 ? 0.1 : 0), -0.03 * Math.cos(i * 0.07)];
    const lat = 4096, out = render(h, lat + 30000, sr, [0, 0, 0, 1], input);
    let error = 0;
    for (let i = lat + 12000; i < out[0].length; ++i) for (let c = 0; c < 2; ++c) error = Math.max(error, Math.abs(out[c][i] - input(i - lat)[c]));
    assert.ok(error < 1e-4, `Cloud with Fuzz 0 is dry at the usual window delay (${error})`);
    x.soemdsp_spectral_blur_destroy(h);
  }
  // constant in cents: the same Fuzz spreads a 2 kHz sine about as wide, in cents, as a 500 Hz sine (a 100 Hz sine is under one FFT bin of fuzz, below the analysis resolution); Warble leaves 2 kHz a tight line
  {
    const low = spreadCents(run(h => cloudSet(h, 50), 500), 500);
    const high = spreadCents(run(h => cloudSet(h, 50), 2000), 2000);
    const warbleHigh = spreadCents(run(h => x.soemdsp_spectral_blur_set_swarm(h, 90, 0, 5, 0, 1), 2000), 2000);
    console.log(`Cloud 50 cents: 500 Hz spreads ${low.toFixed(1)} cents, 2 kHz ${high.toFixed(1)} cents; Warble 2 kHz ${warbleHigh.toFixed(1)} cents.`);
    assert.ok(low > 5 && high > 5, `Cloud spreads both (${low}, ${high})`);
    assert.ok(high / low > 0.4 && high / low < 2.5, `the width is about the same in cents at 500 Hz and 2 kHz (${low} vs ${high})`);
    assert.ok(high > warbleHigh * 2, `Cloud at 2 kHz is much fuzzier than a Warble line (${high} vs ${warbleHigh})`);
    const narrow = spreadCents(run(h => cloudSet(h, 10), 2000), 2000), wide = spreadCents(run(h => cloudSet(h, 100), 2000), 2000);
    assert.ok(narrow < high && high < wide, `more Fuzz is wider (${narrow} < ${high} < ${wide})`);
  }
  // in place: a short impulse leaves no tail past the window (8x overlap compensated: comparable energy, delay unchanged)
  {
    const h = fresh(); cloudSet(h, 100);
    const size = 4096, imp = render(h, size * 6, sr, [0, 0, 0, 1], i => [i === 0 ? 1 : 0, 0]);
    const e = energy(imp[0]);
    assert.ok(e > 0.2 && e < 4, `an impulse keeps a comparable energy under Cloud (${e})`);
    assert.ok(energy(imp[0], size * 2 + 64) < e * 1e-6, 'no tail past the analysis window after the impulse');
    x.soemdsp_spectral_blur_destroy(h);
  }
  // overall level: the fur does not change the loudness (power-preserving)
  {
    const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const dry = rms(run(h => cloudSet(h, 0), 1000)), fur = rms(run(h => cloudSet(h, 100, 4), 1000));
    assert.ok(Math.abs(fur / dry - 1) < 0.25, `Cloud keeps the level (${fur} vs ${dry})`);
  }
  // determinism, Seed and voices
  {
    const go = (seed, voices) => { const h = fresh(); x.soemdsp_spectral_blur_set_swarm(h, 0, 0, 5, 0, seed); cloudSet(h, 80, voices); const o = render(h, 30000, sr, [0, 0, 0, 1], sine(1000)); x.soemdsp_spectral_blur_destroy(h); return o; };
    const a = go(1, 3), b = go(1, 3), c = go(2, 3), d = go(1, 2);
    let same = true, diffSeed = 0, diffVoices = 0;
    for (let i = 0; i < a[0].length; ++i) { if (a[0][i] !== b[0][i]) same = false; diffSeed += (a[0][i] - c[0][i]) ** 2; diffVoices += (a[0][i] - d[0][i]) ** 2; }
    assert.ok(same, 'same Seed, same input, same settings: identical output');
    assert.ok(diffSeed > energy(a[0]) * 0.01, 'a different Seed changes the fur');
    assert.ok(diffVoices > energy(a[0]) * 0.001, 'a different voice count changes the fur');
  }
  // stereo is linked: mono in, Stereo Spread 0, Cloud on -> Left and Right match
  {
    const h = fresh(); cloudSet(h, 100, 4);
    const out = render(h, 30000, sr, [0, 0, 0, 1], i => { const v = 0.1 * Math.sin(i * 0.11) + 0.03 * Math.sin(i * 0.37); return [v, v]; });
    let worst = 0; for (let i = 0; i < out[0].length; ++i) worst = Math.max(worst, Math.abs(out[0][i] - out[1][i]));
    assert.ok(worst < 1e-9, `Cloud keeps Left and Right linked (${worst})`);
    x.soemdsp_spectral_blur_destroy(h);
  }
  // Character switching (hop 4x <-> 8x, warm second core + crossfade): finite, no gaps, no jump on a steady tone
  {
    const h = fresh(); x.soemdsp_spectral_blur_set_cloud(h, 0, 0, 3);
    const tone = i => { const v = 0.1 * Math.sin(2 * Math.PI * 330 * i / sr); return [v, v]; };
    let max = 0; const out = [];
    for (let i = 0; i < 6 * sr; ++i) {
      if (i === sr) cloudSet(h, 0); // to Cloud with no fuzz: a switch that must be inaudible on a steady tone
      if (i === 3 * sr) x.soemdsp_spectral_blur_set_cloud(h, 0, 0, 3);
      const a = tone(i); const y = x.soemdsp_spectral_blur_sample(h, a[0], a[1], 0, 0, 0, 1, sr);
      assert.ok(Number.isFinite(y), 'finite through the switch'); out.push(y);
    }
    for (let i = 8000; i < out.length; ++i) max = Math.max(max, Math.abs(out[i]));
    assert.ok(max < 0.1 * 1.05, `no level jump at the 4x/8x switch (peak ${max})`);
    for (const [lo, hi, label] of [[sr + 3000, 2 * sr, 'Cloud'], [4 * sr, 5 * sr, 'Warble again']]) {
      let peak = 0; for (let i = lo; i < hi; ++i) peak = Math.max(peak, Math.abs(out[i]));
      assert.ok(peak > 0.09 && peak < 0.105, `steady tone keeps its level in ${label} (${peak})`);
    }
    x.soemdsp_spectral_blur_destroy(h);
  }
  // no NaN / Inf under rapid edits and size changes; local reset recovers; the CPU is bounded by the 8x hop, 4 voices and the cap, not by pitch
  {
    const h = fresh(); let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < 60000; ++i) {
      if (i % 64 === 0) { x.soemdsp_spectral_blur_set_cloud(h, rnd() < 0.7 ? 1 : 0, rnd() * 400, 1 + Math.floor(rnd() * 6)); x.soemdsp_spectral_blur_set_fft_size(h, [512, 1024, 2048, 4096][Math.floor(rnd() * 4)]); x.soemdsp_spectral_blur_set_swarm(h, rnd() * 200, rnd() * 12, rnd() * 50, rnd() * 20, Math.floor(rnd() * 99999)); }
      const burst = i % 9000 < 300 ? 8 : 0.1;
      const l = x.soemdsp_spectral_blur_sample(h, burst * Math.sin(i * 0.2), -burst * Math.sin(i * 0.31), rnd() * 2, rnd() * 3000, rnd(), 1, sr);
      assert.ok(Number.isFinite(l) && Number.isFinite(x.soemdsp_spectral_blur_right(h)), 'finite under rapid Cloud edits');
    }
    x.soemdsp_spectral_blur_set_cloud(h, NaN, NaN, NaN);
    assert.equal(x.soemdsp_spectral_blur_sample(h, NaN, 0, 1, 200, 1, 1, sr), 0);
    x.soemdsp_spectral_blur_destroy(h);
    const time = (f0) => { const hh = fresh(); x.soemdsp_spectral_blur_set_fft_size(hh, 16384); cloudSet(hh, 200, 4); render(hh, 20000, sr, [0, 0, 0, 1], sine(f0)); const t0 = performance.now(); render(hh, sr, sr, [0, 0, 0, 1], sine(f0)); const dt = performance.now() - t0; x.soemdsp_spectral_blur_destroy(hh); return dt; };
    const lowCost = time(100), highCost = time(8000);
    const warble = (() => { const hh = fresh(); x.soemdsp_spectral_blur_set_fft_size(hh, 16384); render(hh, 20000, sr, [0, 0, 0, 1], sine(100)); const t0 = performance.now(); render(hh, sr, sr, [0, 0, 0, 1], sine(100)); const dt = performance.now() - t0; x.soemdsp_spectral_blur_destroy(hh); return dt; })();
    console.log(`Cloud CPU at 16384, 8x hop, 4 voices, one audio second: 100 Hz ${lowCost.toFixed(1)} ms, 8 kHz ${highCost.toFixed(1)} ms; plain ${warble.toFixed(1)} ms (JS harness numbers, not a DAW CPU reading).`);
    assert.ok(Math.abs(lowCost - highCost) < Math.max(lowCost, highCost) * 0.5 + 20, 'Cloud cost does not depend on the input pitch');
    assert.ok(Math.max(lowCost, highCost) < warble * 12 + 100, 'Cloud at its worst case stays bounded');
  }
  console.log('Cloud: dry at Fuzz 0, cents-wide at every pitch, in place, level-preserving, deterministic, linked stereo, crossfaded hop switch, finite.');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pitch Blur (cents) next to Frequency Blur (Hz): a smooth, level-preserving kernel whose cents width is the same at every pitch.
{
  const sr = 48000, settle = 20000, m = 24576;
  const sine = f0 => i => { const v = 0.1 * Math.sin(2 * Math.PI * f0 * i / sr); return [v, v]; };
  const run = (f0, hz, cents) => {
    const h = x.soemdsp_spectral_blur_create(); x.soemdsp_spectral_blur_set_stereo_spread(h, 0); x.soemdsp_spectral_blur_set_smoothing(h, 10, 0);
    x.soemdsp_spectral_blur_set_blur_cents(h, cents);
    const out = render(h, settle + m, sr, [0, hz, 0, 1], sine(f0))[0].slice(settle); x.soemdsp_spectral_blur_destroy(h); return out;
  };
  const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const spreadCents = (out, f0) => {
    let num = 0, den = 0;
    for (let c = -900; c <= 900; c += 10) {
      const f = f0 * 2 ** (c / 1200); let re = 0, im = 0;
      for (let i = 0; i < out.length; ++i) { const ph = 2 * Math.PI * f * i / sr; re += out[i] * Math.cos(ph); im += out[i] * Math.sin(ph); }
      const p = re * re + im * im; num += p * c * c; den += p;
    }
    return Math.sqrt(num / den);
  };
  const dry = run(1000, 0, 0);
  for (const [hz, cents] of [[100, 0], [0, 200], [100, 200]]) {
    const wet = run(1000, hz, cents);
    assert.ok(wet.every(Number.isFinite), 'Pitch Blur output is finite');
    assert.ok(rms(wet) / rms(dry) > 0.2 && rms(wet) / rms(dry) < 1.25, `blur only loses the level a spread partial inherently loses, never gains (${hz} Hz, ${cents} cents: ${rms(wet) / rms(dry)})`);
  }
  // A blurred partial keeps its coherent line; what the blur takes is level, set by the kernel width in Hz. Frequency Blur is the same Hz at every
  // pitch (same loss), Pitch Blur is the same interval, so its width in Hz grows with pitch (more loss up high).
  const lvl = (f0, hz, cents) => rms(run(f0, hz, cents)) / rms(run(f0, 0, 0));
  const cLow = lvl(700, 0, 300), cHigh = lvl(2800, 0, 300), hLow = lvl(700, 100, 0), hHigh = lvl(2800, 100, 0);
  console.log(`Level kept with Pitch Blur 300 cents: 700 Hz ${cLow.toFixed(2)}, 2.8 kHz ${cHigh.toFixed(2)}. Frequency Blur 100 Hz: 700 Hz ${hLow.toFixed(2)}, 2.8 kHz ${hHigh.toFixed(2)}.`);
  assert.ok(cLow < 0.9 && cHigh < 0.9, 'Pitch Blur does something at both pitches');
  assert.ok(cHigh < cLow - 0.1, `Pitch Blur widens with pitch in Hz (${cLow} vs ${cHigh})`);
  assert.ok(Math.abs(hHigh - hLow) < 0.15, `Frequency Blur is the same width in Hz at every pitch (${hLow} vs ${hHigh})`);
  console.log('Pitch Blur: smooth kernel, power-matched per frame, cents scale with pitch and Hz does not.');
}
