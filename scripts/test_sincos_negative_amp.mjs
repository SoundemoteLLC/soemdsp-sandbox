// HP-22: sincos negative Amplitude outputs the inverted signal at that size (it used to floor to 0 = silence in the native
// level). The param definition is the only limit: SinCos Amplitude runs -1..1.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasm = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules/sine_wavetable/sine_wavetable.wasm")));
const x = (await WebAssembly.instantiate(wasm, {})).exports;

const render = (amp, method) => {
  const h = x.soemdsp_sine_wavetable_create();
  assert.ok(h > 0, "instance");
  x.soemdsp_sine_wavetable_set_method(h, method);
  const sin = new Float64Array(512);
  const cos = new Float64Array(512);
  for (let i = 0; i < sin.length; i += 1) {
    x.soemdsp_sine_wavetable_sample(h, 0, 440, amp, 48000, 0);
    sin[i] = x.soemdsp_sine_wavetable_sin(h);
    cos[i] = x.soemdsp_sine_wavetable_cos(h);
  }
  x.soemdsp_sine_wavetable_destroy(h);
  return { sin, cos };
};
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

for (const method of [0, 1, 2, 3]) {
  const pos = render(0.5, method);
  const neg = render(-0.5, method);
  assert.ok(peak(neg.sin) > 0.49, `method ${method}: -0.5 is not silent (peak ${peak(neg.sin)})`);
  for (let i = 0; i < pos.sin.length; i += 1) {
    assert.ok(Math.abs(neg.sin[i] + pos.sin[i]) < 1e-12, `method ${method}: sin at -0.5 is the inverse of +0.5 (sample ${i})`);
    assert.ok(Math.abs(neg.cos[i] + pos.cos[i]) < 1e-12, `method ${method}: cos at -0.5 is the inverse of +0.5 (sample ${i})`);
  }
}

const ctx = { window: {} };
vm.createContext(ctx);
const defs = fs.readFileSync(path.join(root, "public/node-graph-module-definitions.js"), "utf8");
const block = defs.slice(defs.indexOf("\n  sinCos: {"), defs.indexOf("\n  archimedes: {"));
assert.match(block, /key: "amp",[\s\S]*?min: "-1"/, "SinCos Amplitude definition reaches -1");

console.log("test_sincos_negative_amp: ok (all four methods: -0.5 is +0.5 inverted, not silence)");
