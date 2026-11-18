import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-stft-test-"));
let h;
try {
  const output = path.join(temporary, "harness.wasm");
  execFileSync(process.env.CLANGXX || "C:/Program Files/LLVM/bin/clang++.exe", [
    "--target=wasm32", "-O3", "-msimd128", "-nostdlib", "-fno-exceptions", "-fno-rtti",
    "-Ilibrary/include", "-Wl,--no-entry", "-Wl,--export-memory",
    ...["reset", "tick", "right", "re", "im", "fft", "crunch_reset", "crunch_tick", "envelope", "smooth", "reference_reset", "reference_tick", "os_reset", "os_tick", "os_right", "os_stereo"].map(key => `-Wl,--export=test_${key}`),
    "scripts/fixtures/convolution_vocoder_harness.cpp", "-o", output,
  ], { cwd: root, stdio: "pipe" });
  h = (await WebAssembly.instantiate(fs.readFileSync(output))).instance.exports;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
const re = new Float32Array(h.memory.buffer, h.test_re(), 512);
const im = new Float32Array(h.memory.buffer, h.test_im(), 512);
for (let i = 0; i < 512; ++i) { re[i] = Math.sin(i * 0.53); im[i] = Math.cos(i * 0.17); }
const originalRe = re.slice(), originalIm = im.slice();
h.test_fft(0); h.test_fft(1);
let fftError = 0;
for (let i = 0; i < 512; ++i)
  fftError = Math.max(fftError, Math.abs(re[i] - originalRe[i]), Math.abs(im[i] - originalIm[i]));
assert.ok(fftError < 2e-6, `FFT roundtrip: ${fftError}`);

const sr = 48000, frames = sr / 2;
function render(voice, carrier, shift = 0, unity = false) {
  h.test_reset();
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; ++i) {
    out[i] = h.test_tick(voice(i), 0, carrier(i), shift, unity ? 1 : 0);
    assert.ok(Number.isFinite(out[i]));
    assert.equal(h.test_right(), unity ? out[i] : 0, "independent per-channel envelopes");
  }
  return out;
}
const signal = i => Math.sin(i * 0.37) + 0.2 * Math.cos(i * 0.013) + 0.1;
const flat = render(() => 0, signal, 0, true);
let colaError = 0;
for (let i = 0; i < frames; ++i)
  colaError = Math.max(colaError, Math.abs(flat[i] - (i >= 2048 ? signal(i - 2048) : 0)));
assert.ok(colaError < 2e-6, `Hann overlap/add must preserve samples at exact 2048 reference: ${colaError}`);
const tone = (hz, i) => Math.sin(2 * Math.PI * hz * i / sr);
const carrier = i => tone(375, i) + tone(750, i) + tone(1500, i);
const voice = i => tone(375, i);
const zeroShift = render(voice, carrier), shifted = render(voice, carrier, 12);
const reversed = render(i => -voice(i), carrier);
for (let i = 0; i < frames; ++i) assert.equal(zeroShift[i], reversed[i], "voice phase must not replace carrier phase");
function magnitude(out, hz) {
  let a = 0, b = 0;
  for (let i = 4096; i < out.length; ++i) {
    const phase = 2 * Math.PI * hz * i / sr;
    a += out[i] * Math.cos(phase); b += out[i] * Math.sin(phase);
  }
  return Math.hypot(a, b);
}
assert.ok(magnitude(zeroShift, 375) > 10 * magnitude(zeroShift, 750), "unshifted envelope favors 375 Hz");
assert.ok(magnitude(shifted, 750) > 10 * magnitude(shifted, 375), "+12 st moves envelope to 750 Hz without moving carrier bins");
const silence = render(() => 0, carrier);
assert.ok(silence.every(sample => sample === 0), "silent voice must not leak carrier");
const burst = render(i => i < 512 ? voice(i) : 0, carrier);
let pendingTail = 0;
for (let i = 2560; i < 2944; ++i) pendingTail += burst[i] * burst[i];
assert.ok(pendingTail > 1e-5, "silent input frames must not clear already scheduled OLA tails");
assert.ok(burst.slice(3072).every(value => value === 0), "scheduled tail should eventually finish");
for (const shift of [-120, 120])
  assert.ok(render(voice, carrier, shift).every(sample => sample === 0), "out-of-spectrum envelopes must not wrap");
const doubled = render(i => 2 * voice(i), carrier);
for (let i = 0; i < frames; ++i) assert.equal(doubled[i], 2 * zeroShift[i], "no level-dependent envelope limiting");
h.test_reset();
for (let i = 0; i < frames; ++i) {
  const out = h.test_tick(voice(i), 0.25 * voice(i), carrier(i), 0, 0);
  assert.equal(h.test_right(), 0.25 * out, "independent stereo levels share carrier pitch, not envelope");
}
console.log(`FFT error ${fftError.toExponential(2)}; fixed STFT reconstruction error ${colaError.toExponential(2)}. Envelope shift, phase ownership, stereo and silence pass.`);

h.test_crunch_reset();
let sweepError = 0;
const started = performance.now();
for (let i = 0; i < sr; ++i) {
  const c = (i % 4001) / 4000;
  const result = h.test_crunch_tick(voice(i), signal(i), c, Math.sin(i / 5000), 0, 1);
  sweepError = Math.max(sweepError, Math.abs(result - (i < 2048 ? 0 : signal(i - 2048))));
}
const elapsed = performance.now() - started;
assert.ok(sweepError < 3e-6, `all sizes and live pair changes must stay delay/gain aligned: ${sweepError}`);
h.test_crunch_reset();
const reference = render(voice, carrier);
for (let i = 0; i < frames; ++i)
  assert.ok(Math.abs(h.test_crunch_tick(voice(i), carrier(i), 1 / 3, 0, -1 / 3, 0) - reference[i]) < 1e-7,
    "512-sample unsmoothed reference must remain available");
const env = new Float32Array(h.memory.buffer, h.test_envelope(), 257);
for (const width of [0, 0.01, 0.25, 0.75, 1]) {
  env.fill(1.75); h.test_smooth(width);
  for (let k = 1; k < 256; ++k) assert.ok(Math.abs(env[k] - 1.75) < 1e-6, "smoothing preserves a flat spectrum");
}
env.fill(0); env[20] = 1; h.test_smooth(1);
for (let k = 1; k < 256; ++k)
  assert.ok(Math.abs(env[k] - 1 / 255) < 1e-8, "full Bandwidth must be one shared mean envelope");
console.log(`Crunch sweep unity error ${sweepError.toExponential(2)}; 1 second took ${elapsed.toFixed(0)} ms in the test runtime. Reference, normalized smoothing and wide-band collapse pass.`);
h.test_crunch_reset(); h.test_reference_reset();
let activeError = 0;
for (let i = 0; i < frames; ++i) {
  const c = (i % 4001) / 4000, r = 0.2 * Math.sin(i / 1000), b = 0.2 * Math.cos(i / 700);
  const value = voice(i) + 0.2 * Math.sin(i * 0.19);
  const actual = h.test_crunch_tick(value, carrier(i), c, r, b, 0);
  const expected = h.test_reference_tick(value, carrier(i), c, r, b, 0);
  activeError = Math.max(activeError, Math.abs(actual - expected));
}
assert.ok(activeError < 2e-6, `active-pair reconstruction must match the warm-stream reference: ${activeError}`);
console.log(`Active-pair vs all-warm reference: max error ${activeError.toExponential(2)}.`);
function fastAm(c) {
  h.test_crunch_reset();
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; ++i) {
    const input = (1 + 0.75 * tone(1000, i)) * tone(3000, i);
    out[i] = h.test_crunch_tick(input, tone(6000, i), c, 0, 1, 0);
    assert.ok(Number.isFinite(out[i]));
  }
  return magnitude(out, 7000) / magnitude(out, 6000);
}
const slowAm = fastAm(0), shortAm = fastAm(1);
assert.ok(shortAm > 10 * slowAm, `short sliding frames should reveal fast AM: ${shortAm} vs ${slowAm}`);
console.log(`1 kHz AM sideband/carrier: long ${slowAm.toExponential(2)}, short ${shortAm.toExponential(2)}.`);

function highRender(os, unity = false, hz = 21000, modulation = 5000) {
  if (os) h.test_os_reset(); else h.test_crunch_reset();
  const tick = os ? h.test_os_tick : h.test_crunch_tick;
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; ++i) {
    const voice = (1 + 0.9 * tone(modulation, i)) * tone(6000, i);
    out[i] = tick(voice, tone(hz, i), 1, 0, 1, unity ? 1 : 0);
    assert.ok(Number.isFinite(out[i]));
    if (!unity && os) assert.equal(h.test_os_right(), 0);
  }
  return out;
}
function level(out, hz) {
  let re = 0, im = 0;
  const count = 19200;
  for (let i = out.length - count; i < out.length; ++i) {
    re += out[i] * Math.cos(2 * Math.PI * hz * i / sr);
    im += out[i] * Math.sin(2 * Math.PI * hz * i / sr);
  }
  return Math.hypot(re, im) * 2 / count;
}
const rawHigh = highRender(false), aaHigh = highRender(true);
const rawAlias = level(rawHigh, 22000) / level(rawHigh, 21000);
const aaAlias = level(aaHigh, 22000) / level(aaHigh, 21000);
console.log(`HF folded 26k -> 22k sideband/carrier: base ${rawAlias.toExponential(3)}, 2x ${aaAlias.toExponential(3)} (${(20 * Math.log10(aaAlias / rawAlias)).toFixed(1)} dB).`);
assert.ok(aaAlias < rawAlias * 0.01, "2x path should suppress the measured folded sideband by at least 40 dB");
for (const [hz, modulation] of [[22500, 2500], [23000, 3000]]) {
  const raw = highRender(false, false, hz, modulation), aa = highRender(true, false, hz, modulation);
  const folded = sr - hz - modulation;
  const base = level(raw, folded) / level(raw, hz), filtered = level(aa, folded) / level(aa, hz);
  console.log(`Fold ${hz + modulation} -> ${folded} Hz: base ${base.toExponential(3)}, 2x ${filtered.toExponential(3)} (${(20 * Math.log10(filtered / base)).toFixed(1)} dB).`);
  assert.ok(filtered < base * 0.1, "additional near-Nyquist fixtures should suppress folding by at least 20 dB");
}
for (const hz of [1000, 12000, 20000]) {
  const result = highRender(true, true, hz);
  const amplitude = level(result, hz);
  console.log(`2x unity carrier ${hz} Hz: amplitude ${amplitude.toFixed(6)}`);
  assert.ok(Math.abs(amplitude - 1) < 0.001, "resamplers must preserve the tested passband");
  let delayError = 0;
  for (let i = 4096; i < result.length; ++i)
    delayError = Math.max(delayError, Math.abs(result[i] - tone(hz, i - 2176)));
  assert.ok(delayError < 0.001, `2x reconstruction group delay must be 2176 base-rate samples: ${delayError}`);
}
for (const c of [0.25, 1]) {
  for (const [label, reset, tick] of [["all-warm 1x", h.test_reference_reset, h.test_reference_tick], ["active-pair 2x", h.test_os_reset, h.test_os_tick]]) {
    reset();
    const start = performance.now();
    for (let i = 0; i < sr; ++i) tick(voice(i), carrier(i), c, 0, 0, 0);
    console.log(`CPU fixture Crunch ${c}, ${label}: ${(performance.now() - start).toFixed(0)} ms/audio second.`);
  }
}
h.test_os_reset();
let osSweepError = 0;
for (let i = 0; i < frames; ++i) {
  const c = (i % 4001) / 4000;
  const out = h.test_os_tick(voice(i), tone(12000, i), c, Math.sin(i / 5000), 0, 1);
  if (i > 4096) osSweepError = Math.max(osSweepError, Math.abs(out - tone(12000, i - 2176)));
}
assert.ok(osSweepError < 0.001, `oversampled pair changes preserve filtered reconstruction and latency: ${osSweepError}`);
h.test_os_reset();
for (let i = 0; i < frames; ++i) {
  const out = h.test_os_stereo(voice(i), 0.25 * voice(i), carrier(i), (i % 4001) / 4000);
  assert.ok(Math.abs(h.test_os_right() - 0.25 * out) < 1e-7, "oversampling preserves independent stereo envelopes");
}
console.log(`2x size sweep reconstruction error ${osSweepError.toExponential(2)}; stereo scaling pass.`);

const x = (await WebAssembly.instantiate(fs.readFileSync(new URL(
  "../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url)))).instance.exports;
for (const body of [0, 0.5, 1]) {
  const id = x.soemdsp_convolution_resonator_create();
  let energy = 0;
  for (let i = 0; i < sr; ++i) {
    const out = x.soemdsp_convolution_resonator_sample(id, i < sr / 2 ? voice(i) : 0,
      0, 187.5, 4, 1, sr, 0, body, 0.08, 1, 0);
    assert.ok(Number.isFinite(out));
    assert.equal(x.soemdsp_convolution_resonator_right(id), 0);
    if (i > 8192 && i < sr / 2) energy += out * out;
  }
  assert.ok(energy > 1e-5, `vocoder must be audible through Body ${body}`);
  x.soemdsp_convolution_resonator_reset(id);
  for (let i = 0; i < 4096; ++i)
    assert.equal(x.soemdsp_convolution_resonator_sample(id, 0, 0, 187.5, 4, 1, sr, 0, body, 0.08, 1, 0), 0);
  x.soemdsp_convolution_resonator_destroy(id);
}
console.log("Native vocoder: Buzz/String/Tube, stereo isolation, audible output and reset pass.");
const id = x.soemdsp_convolution_resonator_create();
for (let i = 0; i < sr; ++i) {
  x.soemdsp_convolution_resonator_set_crunch(id, (i % 4001) / 4000, Math.sin(i / 1000), Math.cos(i / 1300));
  const out = x.soemdsp_convolution_resonator_sample(id, voice(i), 0, 187.5, 4, 1, sr, 0, 0.5, 0.08, 1, 0);
  assert.ok(Number.isFinite(out), "native Crunch and trim modulation must stay finite");
}
for (const rate of [44100, 96000])
  for (const frequency of [10, 110, 12000, 20000])
    for (const shift of [-24, 24])
      for (let i = 0; i < 4096; ++i) {
        const out = x.soemdsp_convolution_resonator_sample(id, Math.sin(i * 0.1), 0,
          frequency, 4, 1, rate, 0, 1, 0.08, 1, shift);
        assert.ok(Number.isFinite(out), "finite vocoder range endpoints across sample rates");
      }
x.soemdsp_convolution_resonator_sample(id, NaN, 0, 110, 4, 1, sr, 0, 1, 0.08, 1, 0);
for (let i = 0; i < 4096; ++i)
  assert.equal(x.soemdsp_convolution_resonator_sample(id, 0, 0, 110, 4, 1, sr, 0, 1, 0.08, 1, 0), 0,
    "non-finite recovery must clear spectral and body tails");
x.soemdsp_convolution_resonator_destroy(id);
console.log("Vocoder sample-rate/frequency/shift endpoints and non-finite recovery pass.");
