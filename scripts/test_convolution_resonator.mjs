import assert from "node:assert/strict";
import fs from "node:fs";

const file = new URL("../native_modules/convolution_resonator/convolution_resonator.wasm", import.meta.url);
const { instance } = await WebAssembly.instantiate(fs.readFileSync(file));
const x = instance.exports;
const create = x.soemdsp_convolution_resonator_create;
const destroy = x.soemdsp_convolution_resonator_destroy;
const sample = (h, l, r, frequency = 110, periods = 4, mix = 0, sr = 48000) =>
  x.soemdsp_convolution_resonator_sample(h, l, r, frequency, periods, mix, sr, 0, 0, 0.08, 0, 0);
const right = x.soemdsp_convolution_resonator_right;
const reset = x.soemdsp_convolution_resonator_reset;
const latency = x.soemdsp_convolution_resonator_latency();
assert.equal(latency, 2048);
const a = create();
const b = create();
assert.ok(a && b && a !== b);
for (let i = 0; i < latency + 1; ++i) {
  assert.equal(sample(a, i === 0 ? 2 : 0, i === 0 ? -3 : 0), i === latency ? 2 : 0);
  assert.equal(right(a), i === latency ? -3 : 0);
  assert.equal(sample(b, 0, 0), 0, "instances must not share signal history");
}
reset(a);
for (let i = 0; i < latency + 64; ++i) {
  const input = Math.sin(i * 0.37) * 4;
  const out = sample(a, input, -input);
  assert.equal(out, i < latency ? 0 : Math.sin((i - latency) * 0.37) * 4);
  assert.ok(right(a) === -out);
}
assert.equal(sample(a, NaN, 0), 0);
for (let i = 0; i <= latency; ++i) assert.equal(sample(a, 0, 0), 0);
assert.equal(sample(a, 0, Infinity), 0);
destroy(a);
destroy(a);
assert.equal(sample(a, 1, 1), 0);
destroy(b);
const handles = Array.from({ length: 64 }, create);
assert.equal(new Set(handles).size, 64);
assert.ok(handles.every(Boolean));
assert.equal(create(), 0, "capacity failure is explicit");
handles.forEach(destroy);
for (let pass = 0; pass < 100; ++pass) {
  const h = create();
  assert.ok(h, "released pooled storage must be reusable");
  destroy(h);
}
console.log("Convolution Resonator stage 1: latency, stereo, isolation, reset, capacity and reuse pass.");
