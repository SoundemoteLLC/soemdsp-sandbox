import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
const x = (await WebAssembly.instantiate(fs.readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url)),
  { env: { emo_process_block() {} } })).instance.exports;
const N = 128, rate = 48000;
const specs = [
  [272, "spectral_blur", [[52, 2], [31, 100], [42, 1], [40, 1], [55, 10], [41, 0], [1, 1], [22, 4096]]],
  [272, "spectral_blur", [[52, 0.46], [31, 490.89], [42, 0.402], [40, 1], [55, 10], [41, 20], [1, 0.7], [22, 512]], true],
  // Swarm slots: 13 = swarm (degrees), 12 = level (dB), 57 = rate (Hz), 47 = drift (Hz), 48 = seed
  [272, "spectral_blur", [[52, 0], [31, 0], [42, 0], [40, 1], [55, 10], [41, 0], [1, 0], [22, 2048], [13, 144], [12, 4], [57, 7], [47, 0.6], [48, 3]], true],
  // Cloud slots: 21 = character (1 = Cloud), 30 = fuzz (cents), 32 = voices
  [272, "spectral_blur", [[52, 0], [31, 0], [42, 0], [40, 1], [55, 10], [41, 0], [1, 0], [22, 2048], [21, 1], [30, 80], [32, 4], [12, 1.5], [48, 5]], true],
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
        x.soemdsp_spectral_blur_set_smoothing(ref, params.find(([id]) => id === 55)[1], params.find(([id]) => id === 41)[1]);
        x.soemdsp_spectral_blur_set_stereo_spread(ref, params.find(([id]) => id === 1)[1]);
        x.soemdsp_spectral_blur_set_fft_size(ref, params.find(([id]) => id === 22)[1]);
        // an unset Swarm slot is the native default: Swarm 0, Level 0, Rate 5, Drift 0, Seed 1
        const swarmOf = (id, fallback) => (params.find(([i]) => i === id) ?? [id, fallback])[1];
        x[prefix + "set_swarm"](ref, swarmOf(13, 0), swarmOf(12, 0), swarmOf(57, 5), swarmOf(47, 0), swarmOf(48, 1));
        x[prefix + "set_cloud"](ref, swarmOf(21, 0), swarmOf(30, 0), swarmOf(32, 3));
        const args = params.filter(([id]) => id !== 55 && id !== 41 && id !== 1 && id !== 22 && ![13, 12, 57, 47, 48, 21, 30, 32].includes(id)).map(p => p[1]);
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
