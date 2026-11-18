import assert from "node:assert/strict";
import fs from "node:fs";
const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL(
  "../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url)));
const x = instance.exports;
const create = x.soemdsp_convolution_resonator_create;
const destroy = x.soemdsp_convolution_resonator_destroy;
const sample = (h, input, hz, size, fade) =>
  x.soemdsp_convolution_resonator_sample(h, input, -input, hz, size, 1, 48000, fade);
const shift = 2048 - 8;
const change = 12000;
const duration = 960;

for (const [hz, size] of [[220, 4], [55, 8], [110, 1.5]]) {
  const old = create(), target = create(), fading = create();
  // Give all three paths the same retained history capacity before the proof.
  for (const h of [old, target, fading]) {
    sample(h, 0, 55, 8, 0);
    x.soemdsp_convolution_resonator_reset(h);
  }
  for (let i = 0; i < change + shift + duration + 1024; ++i) {
    const input = Math.sin(2 * Math.PI * 110 * i / 48000) + 0.3 * Math.sin(i * 0.21);
    const a = sample(old, input, 110, 4, 0);
    const b = sample(target, input, hz, size, 0);
    const y = sample(fading, input, i < change ? 110 : hz, i < change ? 4 : size, 20);
    const t = Math.max(0, Math.min(1, (i - change - shift) / duration));
    const blend = t * t * (3 - 2 * t);
    const expected = a + blend * (b - a);
    assert.ok(Math.abs(y - expected) < 1.e-8,
      `fade must equal the two real filter outputs at sample ${i}, error ${y - expected}`);
  }
  [old, target, fading].forEach(destroy);
}

const h = create();
for (let i = 0; i < 24000; ++i) {
  const hz = 110 * 2 ** Math.sin(i * 0.17);
  const y = sample(h, Math.sin(i * 0.11), hz, 4 + 3 * Math.sin(i * 0.09), 20);
  assert.ok(Number.isFinite(y), "repeated retargeting must stay bounded and finite");
}
x.soemdsp_convolution_resonator_reset(h);
for (let i = 0; i < 4096; ++i) assert.equal(sample(h, 0, 110, 4, 20), 0);
destroy(h);
console.log("Buzz transitions: 20 ms smoothstep equals two real FIRs; pitch, Size, history growth, rapid retargeting and reset pass.");
