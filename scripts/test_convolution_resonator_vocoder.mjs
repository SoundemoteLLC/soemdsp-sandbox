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
    ...["reset", "tick", "right", "re", "im", "fft"].map(key => `-Wl,--export=test_${key}`),
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
  colaError = Math.max(colaError, Math.abs(flat[i] - (i >= 512 ? signal(i - 512) : 0)));
assert.ok(colaError < 2e-6, `Hann overlap/add must preserve samples at exact 512 latency: ${colaError}`);
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
