import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
const x = (await WebAssembly.instantiate(fs.readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url)),
  { env: { emo_process_block() {} } })).instance.exports;
const N = 128, rate = 48000;
const specs = [
  [270, "spectral_contrast", [[13, -0.35], [31, 1], [30, -24], [20, 2], [55, 10], [42, 100], [50, 18], [51, 0], [40, 1]]],
  [271, "spectral_gate", [[21, 0], [30, -60], [31, 3], [50, 60], [55, 5], [42, 100], [13, 0.5], [40, 1], [20, 6], [41, 0]]],
  [270, "spectral_contrast", [[13, 0.6], [31, 0.2], [30, -40], [20, 4], [55, 0], [42, 0], [50, 24], [51, 3], [40, 0.75]], true],
  [271, "spectral_gate", [[21, 0], [30, -45], [31, 9], [50, 24], [55, 0], [42, 0], [13, 1], [40, 0.75], [20, 0], [41, 200]], true],
];
for (const [type, name, params, configure = false] of specs) {
  for (const sides of [[0], [1], [2], [1, 2], [0, 1, 2]]) {
    const g = x.soemdsp_graph_create(), prefix = `soemdsp_${name}_`, ref = x[prefix + "create"]();
    x.soemdsp_graph_set_sample_rate(g, rate);
    for (const [id, kind] of [[1, 132], [2, type], [3, 6]]) assert.equal(x.soemdsp_graph_add_node(g, id, kind), 0);
    for (const p of sides) x.soemdsp_graph_connect(g, 1, p, 2, p);
    for (const p of [1, 2]) x.soemdsp_graph_connect(g, 2, p, 3, p);
    // Exercise native defaults as well as the authoring parameter route.
    if (sides.length > 1 || configure)
      for (const [id, v] of params) x.soemdsp_graph_set_param(g, 2, id, v);
    x.soemdsp_graph_snap_controls(g); assert.equal(x.soemdsp_graph_compile(g), 0);
    assert.equal(x.soemdsp_graph_type_uses_pool(type), 1);
    const buffer = (id, p) => new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(g, id, p), N);
    for (let b = 0; b < 100; ++b) {
      const src = [];
      for (const p of [0, 1, 2]) {
        const a = buffer(1, p);
        for (let i = 0; i < N; ++i) a[i] = (b < 60 ? 0.1 : 0.001) * Math.sin((b * N + i) * (0.07 + p * 0.03));
        src.push(a.slice());
      }
      x.soemdsp_graph_process_block(g, N);
      const out = [buffer(2, 0).slice(), buffer(2, 1).slice(), buffer(2, 2).slice()];
      for (let i = 0; i < N; ++i) {
        const m = sides.includes(0) ? src[0][i] : 0, l = sides.includes(1) ? src[1][i] : 0, r = sides.includes(2) ? src[2][i] : 0;
        const stereo = sides.includes(1) && sides.includes(2);
        const a = stereo ? l + m : m + l + r, z = stereo ? r + m : a;
        if (type === 271) {
          x.soemdsp_spectral_gate_set_knee(ref, params.find(([id]) => id === 20)[1]);
          x.soemdsp_spectral_gate_set_hold(ref, params.find(([id]) => id === 41)[1]);
        }
        const args = params.filter(([id]) => type !== 271 || (id !== 20 && id !== 41)).map(p => p[1]);
        const expected = x[prefix + "sample"](ref, a, z, ...args, rate);
        const expectedR = x[prefix + "right"](ref);
        assert.ok(Math.abs(out[1][i] - expected) < 1e-10 && Math.abs(out[2][i] - expectedR) < 1e-10, `${name} graph/native routing and params`);
        assert.ok(Math.abs(out[0][i] - 0.5 * (expected + expectedR)) < 1e-10);
      }
    }
    const start = performance.now();
    for (let b = 0; b < 500; ++b) x.soemdsp_graph_process_block(g, N);
    if (sides.length === 2) console.log(`${name}: warm graph ${(performance.now() - start).toFixed(1)} ms for ${(500 * N / rate * 1000).toFixed(1)} ms audio.`);
    x[prefix + "destroy"](ref); x.soemdsp_graph_destroy(g);
  }
}
// Ready is a native graph output, not a UI-only Learn light.
const g = x.soemdsp_graph_create(); x.soemdsp_graph_set_sample_rate(g, rate);
for (const [id, kind] of [[1, 132], [2, 271], [3, 6]]) x.soemdsp_graph_add_node(g, id, kind);
x.soemdsp_graph_connect(g, 1, 0, 2, 0);
assert.equal(x.soemdsp_graph_connect(g, 2, 10, 3, 0), 0);
x.soemdsp_graph_set_param(g, 2, 21, 1); x.soemdsp_graph_snap_controls(g); x.soemdsp_graph_compile(g);
for (let b = 0; b < 16; ++b) {
  const input = new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(g, 1, 0), N); input.fill(0.01);
  x.soemdsp_graph_process_block(g, N);
}
const ready = new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(g, 2, 10), N);
assert.equal(ready[N - 1], 1); x.soemdsp_graph_destroy(g);
console.log("STFT graph: mono/lone-side/stereo/summed routing, native defaults, controls, pooled state and Ready pass.");
