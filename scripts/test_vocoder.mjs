import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { loadConvolutionHarness } from "./fixtures/load-convolution-harness.mjs";

const root = new URL("../", import.meta.url);
const { instance } = await WebAssembly.instantiate(fs.readFileSync(new URL("native_modules/vocoder/vocoder.wasm", root)));
const x = instance.exports, rate = 48000;
const create = x.soemdsp_vocoder_create, destroy = x.soemdsp_vocoder_destroy;
const reset = x.soemdsp_vocoder_reset, right = x.soemdsp_vocoder_right;
const tick = (h, l, r, cl, cr, width = 0.75, follower = 0.00025, shift = 0, mix = 1) =>
  x.soemdsp_vocoder_sample(h, l, r, cl, cr, width, follower, shift, mix, rate);
assert.equal(x.soemdsp_vocoder_latency(), 128);
const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,
  x.soemdsp_vocoder_metadata_json(), x.soemdsp_vocoder_metadata_json_size())));
const definitions = fs.readFileSync(new URL("public/node-graph-module-definitions.js", root), "utf8");
assert.equal(definitions.match(/\n  vocoder: \{/g)?.length, 1, "no parked definition may override the native module");
const start = definitions.indexOf("\n  vocoder: {"), end = definitions.indexOf("\n  convolutionResonator: {", start);
assert.ok(start >= 0 && end > start);
const definition = vm.runInNewContext(`({${definitions.slice(start, end)}}).vocoder`);
assert.deepEqual(JSON.parse(JSON.stringify(definition.parameters)), metadata.parameters,
  "C++ metadata and the current UI definitions must agree, including tooltips");
assert.deepEqual(Array.from(definition.inputs), metadata.inputs);
assert.equal(definition.displayType, "scope1dTrace");
const h = create(), isolated = create();
assert.ok(h && isolated && h !== isolated);
for (let i = 0; i < 400; ++i) {
  assert.equal(tick(h, i === 0 ? 2 : 0, i === 0 ? -3 : 0, 0, 0, 0.75, 0, 0, 0), i === 128 ? 2 : 0);
  assert.equal(right(h), i === 128 ? -3 : 0);
  assert.equal(tick(isolated, 0, 0, 0, 0), 0);
}
destroy(isolated);
const fixture = await loadConvolutionHarness(["bank_reset", "bank_tick", "bank_right"]);
fixture.test_bank_reset(); reset(h);
let peak = 0;
for (let i = 0; i < 12000; ++i) {
  const mod = Math.sin(i * 0.07), car = Math.sin(i * 0.11);
  const expected = fixture.test_bank_tick(mod, mod * 0.25, car, rate, 0.75, 0.00025, 0);
  const actual = tick(h, mod, mod * 0.25, car, car);
  assert.ok(Math.abs(actual - expected) < 1e-12, "extraction retains comparison DSP");
  assert.ok(Math.abs(right(h) - fixture.test_bank_right()) < 1e-12);
  peak = Math.max(peak, Math.abs(actual));
}
assert.ok(peak > 0.001);
for (const which of ["mod", "carrier"]) {
  reset(h);
  for (let i = 0; i < 2048; ++i)
    assert.equal(tick(h, which === "mod" ? 0 : Math.sin(i * 0.1), 0,
      which === "carrier" ? 0 : Math.sin(i * 0.2), 0), 0, `missing ${which} is silent when wet`);
}
const scaled = create(); reset(h);
for (let i = 0; i < 4096; ++i) {
  const mod = Math.sin(i * 0.1), car = Math.sin(i * 0.17);
  const a = tick(h, mod, 0, car, -car);
  const b = tick(scaled, 10 * mod, 0, car, -car);
  assert.ok(Math.abs(b - 10 * a) < 1e-10, "no hidden amplitude limiter");
  assert.equal(right(h), 0, "no stereo crosstalk");
}
destroy(scaled); reset(h);
for (const width of [0.001, 0.01, 0.75, 4]) for (const follower of [0, 0.02]) {
  for (let i = 0; i < 4096; ++i) {
    const y = tick(h, Math.sin(i * 0.1), Math.cos(i * 0.13), Math.sin(i * 0.2), Math.cos(i * 0.21), width, follower, 24 * Math.sin(i / 1000));
    assert.ok(Number.isFinite(y) && Number.isFinite(right(h)), "narrow/wide and live controls remain finite");
  }
}
assert.equal(tick(h, NaN, 0, 0, 0), 0);
for (let i = 0; i < 400; ++i) assert.equal(tick(h, 0, 0, 0, 0), 0);
destroy(h); destroy(h);
assert.equal(tick(h, 1, 1, 1, 1), 0);
const handles = Array.from({ length: 64 }, create);
assert.equal(new Set(handles).size, 64); assert.ok(handles.every(Boolean)); assert.equal(create(), 0);
handles.forEach(destroy);
for (let i = 0; i < 100; ++i) { const id = create(); assert.ok(id); destroy(id); }
console.log("Vocoder: metadata/tooltips, exact extracted DSP, latency, isolation, silence, range, recovery and pool reuse pass.");

const g = (await WebAssembly.instantiate(fs.readFileSync(new URL("native_modules/combined/soemdsp_combined.wasm", root)),
  { env: { emo_process_block() {} } })).instance.exports;
const N = 128;
function graphCase(modPorts, carPorts, overrides = []) {
  const circuit = g.soemdsp_graph_create(), reference = g.soemdsp_vocoder_create();
  assert.ok(circuit && reference);
  g.soemdsp_graph_set_sample_rate(circuit, rate);
  for (const [id, type] of [[1, 132], [2, 132], [3, 269], [4, 6]])
    assert.equal(g.soemdsp_graph_add_node(circuit, id, type), 0);
  for (const p of modPorts) assert.equal(g.soemdsp_graph_connect(circuit, 1, p, 3, p), 0);
  for (const p of carPorts) assert.equal(g.soemdsp_graph_connect(circuit, 2, p, 3, p + 2), 0);
  for (const p of [1, 2]) assert.equal(g.soemdsp_graph_connect(circuit, 3, p, 4, p), 0);
  const params = new Map([[50, 0.75], [42, 0.25], [14, 0], [40, 1], ...overrides]);
  for (const [id, value] of params) g.soemdsp_graph_set_param(circuit, 3, id, value);
  g.soemdsp_graph_snap_controls(circuit);
  assert.equal(g.soemdsp_graph_compile(circuit), 0);
  assert.equal(g.soemdsp_graph_type_uses_pool(269), 1);
  const ptr = (id, port) => new Float64Array(g.memory.buffer, g.soemdsp_graph_node_port_ptr(circuit, id, port), N);
  for (let b = 0; b < 64; ++b) {
    const sources = [];
    for (const id of [1, 2]) for (const p of [1, 2]) {
      const buffer = ptr(id, p);
      for (let i = 0; i < N; ++i) buffer[i] = Math.sin((b * N + i) * (id * 0.07 + p * 0.013));
      sources.push(buffer.slice());
    }
    g.soemdsp_graph_process_block(circuit, N);
    const result = [ptr(3, 0).slice(), ptr(3, 1).slice(), ptr(3, 2).slice()];
    const feed = (ports, side, offset, i) => ports.includes(side) ? sources[offset + side - 1][i]
      : ports.length ? sources[offset + ports[0] - 1][i] : 0;
    for (let i = 0; i < N; ++i) {
      const l = g.soemdsp_vocoder_sample(reference, feed(modPorts, 1, 0, i), feed(modPorts, 2, 0, i),
        feed(carPorts, 1, 2, i), feed(carPorts, 2, 2, i), params.get(50), params.get(42) * 0.001,
        params.get(14), params.get(40), rate);
      const r = g.soemdsp_vocoder_right(reference);
      assert.ok(Math.abs(result[1][i] - l) < 1e-11 && Math.abs(result[2][i] - r) < 1e-11, "graph stereo routing/controls match native");
      assert.equal(result[0][i], 0.5 * (result[1][i] + result[2][i]));
    }
  }
  g.soemdsp_vocoder_destroy(reference);
  return circuit;
}
for (const [mod, car] of [[[1, 2], [1, 2]], [[1], [1]], [[2], [2]], [[1], [2]], [[1, 2], []], [[], [1, 2]]])
  g.soemdsp_graph_destroy(graphCase(mod, car));
g.soemdsp_graph_destroy(graphCase([1, 2], [1, 2], [[50, 0.01], [42, 0], [14, 7], [40, 0.6]]));
const circuit = graphCase([1, 2], [1, 2]);
const blocks = 1000, benchmarkStart = performance.now();
for (let i = 0; i < blocks; ++i) g.soemdsp_graph_process_block(circuit, N);
const elapsedMs = performance.now() - benchmarkStart, audioMs = blocks * N / rate * 1000;
g.soemdsp_graph_destroy(circuit);
console.log(`Vocoder graph: stereo/mono/missing inputs and controls pass. Warm WASM graph benchmark: ${elapsedMs.toFixed(1)} ms / ${audioMs.toFixed(1)} ms audio (${(100 * elapsedMs / audioMs).toFixed(1)}% of one realtime budget; not a DAW CPU measurement).`);
