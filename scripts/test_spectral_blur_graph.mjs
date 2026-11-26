// Graph-engine routing for the three STFT modules: Spectral Blur (272), Spectral Warble (281), Spectral Smear (282).
// The graph's parameter slots must drive the native module exactly like calling the native module directly.
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
const x = (await WebAssembly.instantiate(fs.readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url)),
  { env: { emo_process_block() {} } })).instance.exports;
const N = 128, rate = 48000;
// slots: 22 fft size, 30 Cloud fuzz (cents), 51 Cloud grain (dB), 1 stereo spread, 10 mono bass (Hz; Cloud and Warble), 48 seed, 13 warble depth (cents), 57 rate (Hz), 47 drunk, 10 mono bass (Hz, Warble), 52 time smear (s), 10 blur (cents),
// 42 diffusion, 41 amplitude smooth (ms), 31 frequency blur (Hz), 1 stereo spread, 55 phase smooth (ms), 32 voices, 57 diffusion speed (Hz, Smear), 46 mono bass (Hz, Smear), 21 hop (Smear), 40 mix
const modules = [
  {
    name: "spectral_blur", type: 272,
    specs: [[[22, 4096]], [[22, 2048], [30, 300], [51, 3], [1, 0.5], [10, 200], [32, 4], [48, 5], [40, 0.8]], [[22, 512], [30, 0], [51, 0], [32, 2], [48, 1]]],
    sync: (ref, p) => { x.soemdsp_spectral_blur_set_cloud(ref, p(30, 100), p(51, 1), p(32, 3), p(48, 0)); x.soemdsp_spectral_blur_set_stereo(ref, p(1, 1), p(10, 0)); },
    sample: (ref, a, z, p) => x.soemdsp_spectral_blur_sample(ref, a, z, p(40, 1), rate),
  },
  {
    name: "spectral_warble", type: 281,
    specs: [[[22, 4096]], [[22, 2048], [13, 60], [57, 6], [47, 0.8], [32, 4], [1, 0.5], [10, 200], [48, 3], [40, 0.6]]],
    sync: (ref, p) => { x.soemdsp_spectral_warble_set_warble(ref, p(13, 25), p(57, 4), p(47, 0.5), p(32, 3), p(48, 0)); x.soemdsp_spectral_warble_set_stereo(ref, p(1, 1), p(10, 120)); },
    sample: (ref, a, z, p) => x.soemdsp_spectral_warble_sample(ref, a, z, p(40, 1), rate),
  },
  {
    name: "spectral_smear", type: 282,
    specs: [[[22, 4096], [52, 2], [31, 100], [10, 0], [42, 1], [1, 1], [55, 10], [41, 0]], [[22, 512], [52, 0.46], [31, 490.89], [10, 150], [42, 0.402], [57, 12], [46, 200], [21, 8], [48, 7], [1, 0.3], [55, 30], [41, 20], [40, 0.7]]],
    sync: (ref, p) => { x.soemdsp_spectral_smear_set_smoothing(ref, p(55, 10), p(41, 0)); x.soemdsp_spectral_smear_set_stereo(ref, p(1, 1), p(46, 120), p(57, 30)); x.soemdsp_spectral_smear_set_seed(ref, p(48, 0)); x.soemdsp_spectral_smear_set_overlap(ref, p(21, 4)); x.soemdsp_spectral_smear_set_blur_cents(ref, p(10, 0)); },
    sample: (ref, a, z, p) => x.soemdsp_spectral_smear_sample(ref, a, z, p(52, 2), p(31, 100), p(42, 1), p(40, 1), rate),
  },
];
for (const mod of modules) for (const params of mod.specs) for (const sides of [[0], [1], [2], [1, 2], [0, 1, 2]]) {
  const prefix = `soemdsp_${mod.name}_`;
  const g = x.soemdsp_graph_create(), ref = x[prefix + "create"]();
  x.soemdsp_graph_set_sample_rate(g, rate);
  for (const [id, kind] of [[1, 132], [2, mod.type], [3, 6]]) assert.equal(x.soemdsp_graph_add_node(g, id, kind), 0);
  for (const p of sides) x.soemdsp_graph_connect(g, 1, p, 2, p);
  for (const p of [1, 2]) x.soemdsp_graph_connect(g, 2, p, 3, p);
  for (const [id, v] of params) x.soemdsp_graph_set_param(g, 2, id, v);
  x.soemdsp_graph_snap_controls(g); assert.equal(x.soemdsp_graph_compile(g), 0);
  assert.equal(x.soemdsp_graph_type_uses_pool(mod.type), 1);
  const p = (id, fallback) => (params.find(([i]) => i === id) ?? [id, fallback])[1];
  const buffer = (id, port) => new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(g, id, port), N);
  x[prefix + "set_fft_size"](ref, p(22, 4096));
  for (let b = 0; b < 100; ++b) {
    const src = [];
    for (const port of [0, 1, 2]) {
      const a = buffer(1, port);
      for (let i = 0; i < N; ++i) a[i] = (b < 60 ? 0.1 : 0.001) * Math.sin((b * N + i) * (0.07 + port * 0.03));
      src.push(a.slice());
    }
    x.soemdsp_graph_process_block(g, N);
    const out = [buffer(2, 0).slice(), buffer(2, 1).slice(), buffer(2, 2).slice()];
    for (let i = 0; i < N; ++i) {
      const m = sides.includes(0) ? src[0][i] : 0, l = sides.includes(1) ? src[1][i] : 0, r = sides.includes(2) ? src[2][i] : 0;
      const stereo = sides.includes(1) && sides.includes(2);
      const a = stereo ? l + m : m + l + r, z = stereo ? r + m : a;
      mod.sync(ref, p);
      const expected = mod.sample(ref, a, z, p);
      const expectedR = x[prefix + "right"](ref);
      assert.ok(Math.abs(out[1][i] - expected) < 1e-10 && Math.abs(out[2][i] - expectedR) < 1e-10, `${mod.name} graph/native routing and params`);
      assert.ok(Math.abs(out[0][i] - 0.5 * (expected + expectedR)) < 1e-10);
    }
  }
  const start = performance.now();
  for (let b = 0; b < 500; ++b) x.soemdsp_graph_process_block(g, N);
  if (sides.length === 2) console.log(`${mod.name}: warm graph ${(performance.now() - start).toFixed(1)} ms for ${(500 * N / rate * 1000).toFixed(1)} ms audio.`);
  x[prefix + "destroy"](ref); x.soemdsp_graph_destroy(g);
}
console.log("Spectral Blur / Warble / Smear: graph slots match the native modules.");
