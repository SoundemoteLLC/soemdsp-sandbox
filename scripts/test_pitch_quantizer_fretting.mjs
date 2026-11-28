import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bytes = fs.readFileSync(path.join(root, "native_modules/pitch_quantizer/pitch_quantizer.wasm"));
const { instance } = await WebAssembly.instantiate(bytes);
const api = instance.exports;
assert.equal(typeof api.soemdsp_pitch_quantizer_sample, "function", "native quantizer export is present");
const major = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 11);

for (const fretting of [0, 0.5, 1]) {
  const handle = api.soemdsp_pitch_quantizer_create();
  let previous = -Infinity;
  for (let i = 0; i <= 1200; i += 1) {
    const pitch = 60 + i / 100;
    const out = api.soemdsp_pitch_quantizer_sample(handle, pitch, major, fretting);
    assert.ok(Number.isFinite(out), `finite output at fretting=${fretting}, pitch=${pitch}`);
    assert.ok(out + 1e-9 >= previous, `monotonic at fretting=${fretting}, pitch=${pitch}`);
    previous = out;
  }
  api.soemdsp_pitch_quantizer_destroy(handle);
}

const handle = api.soemdsp_pitch_quantizer_create();
const sample = (pitch, fretting) => api.soemdsp_pitch_quantizer_sample(handle, pitch, major, fretting);
assert.equal(sample(60.2, 0), 60, "zero fretting keeps strict hard steps");
assert.equal(sample(60.2, 1), 60.2, "full fretting passes input through exactly");
const epsilon = 1e-5;
const left = sample(60.5 - epsilon, 0.5);
const right = sample(60.5 + epsilon, 0.5);
assert.ok(Math.abs(right - left) < 0.001, "half fretting is continuous across the first scale-edge boundary");
api.soemdsp_pitch_quantizer_destroy(handle);
console.log("Pitch Quantizer Fretting: monotonic at 0, 0.5, 1; midpoint continuous; endpoints preserved.");
