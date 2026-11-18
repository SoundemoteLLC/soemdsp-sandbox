import assert from "node:assert/strict";
import fs from "node:fs";

const bytes = fs.readFileSync(new URL("../native_modules/combined/soemdsp_combined.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes, { env: { emo_process_block() {} } });
const x = instance.exports;
const N = 128;
const latency = x.soemdsp_convolution_resonator_latency();

function run(inputPorts, outputPorts, expected) {
  const h = x.soemdsp_graph_create();
  assert.ok(h);
  x.soemdsp_graph_set_sample_rate(h, 48000);
  for (const [id, type] of [[1, 132], [2, 268], [3, 6]])
    assert.equal(x.soemdsp_graph_add_node(h, id, type), 0);
  x.soemdsp_graph_set_param(h, 2, 40, 0);
  x.soemdsp_graph_snap_controls(h);
  for (const port of inputPorts) assert.equal(x.soemdsp_graph_connect(h, 1, port, 2, port), 0);
  for (const port of outputPorts) assert.equal(x.soemdsp_graph_connect(h, 2, port, 3, port), 0);
  assert.equal(x.soemdsp_graph_compile(h), 0);
  assert.equal(x.soemdsp_graph_type_uses_pool(268), 1);
  for (let block = 0; block <= latency / N; ++block) {
    for (const port of [0, 1, 2]) {
      const ptr = x.soemdsp_graph_node_port_ptr(h, 1, port);
      const buffer = new Float64Array(x.memory.buffer, ptr, N);
      buffer.fill(0);
      if (block === 0) buffer[0] = port === 0 ? 0.25 : port === 1 ? 2 : -3;
    }
    assert.equal(x.soemdsp_graph_process_block(h, N), N);
    for (let port = 0; port < 3; ++port) {
      const ptr = x.soemdsp_graph_node_port_ptr(h, 2, port);
      const buffer = new Float64Array(x.memory.buffer, ptr, N);
      for (let frame = 0; frame < N; ++frame)
        assert.equal(buffer[frame], block === latency / N && frame === 0 ? expected[port] : 0);
    }
  }
  x.soemdsp_graph_destroy(h);
}

run([1, 2], [1, 2], [-0.5, 2, -3]);
run([1, 2], [0], [-0.5, 2, -3]);
run([1], [0], [2, 2, 2]);
run([2], [0], [-3, -3, -3]);
run([0], [1, 2], [0.25, 0.25, 0.25]);
run([0, 1, 2], [1, 2], [-0.25, 2.25, -2.75]);
run([1, 2], [1], [2, 2, 2]);
run([1, 2], [2], [-3, -3, -3]);
console.log("Convolution Resonator graph: eight stereo routing cases and exact latency pass.");

function wetResponse(wiredHz) {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, 48000);
  for (const [id, type] of [[1, 132], [2, 268], [3, 6]])
    assert.equal(x.soemdsp_graph_add_node(h, id, type), 0);
  assert.equal(x.soemdsp_graph_connect(h, 1, 1, 2, 0), 0);
  if (wiredHz) assert.equal(x.soemdsp_graph_connect(h, 1, 0, 2, 16), 0);
  assert.equal(x.soemdsp_graph_connect(h, 2, 0, 3, 1), 0);
  x.soemdsp_graph_set_param(h, 2, 10, 110);
  x.soemdsp_graph_set_param(h, 2, 22, 4);
  x.soemdsp_graph_set_param(h, 2, 40, 1);
  x.soemdsp_graph_snap_controls(h);
  assert.equal(x.soemdsp_graph_compile(h), 0);
  let energy = 0, count = 0;
  for (let b = 0; b < 60; ++b) {
    const tone = new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(h, 1, 1), N);
    const frequency = new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(h, 1, 0), N);
    for (let i = 0; i < N; ++i) tone[i] = Math.sin(2 * Math.PI * 110 * (b * N + i) / 48000);
    frequency.fill(wiredHz || 0);
    x.soemdsp_graph_process_block(h, N);
    const out = new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(h, 2, 0), N);
    if (b >= 50) for (const sample of out) { energy += sample * sample; count++; }
  }
  x.soemdsp_graph_destroy(h);
  return Math.sqrt(energy / count);
}
const knob = wetResponse(0);
const jack = wetResponse(220);
assert.ok(knob > 0.8, `Buzz body must be audible in graph: ${knob}`);
assert.ok(jack < knob * 0.02, `wired f must replace Frequency: ${jack} vs ${knob}`);
console.log(`Graph Buzz RMS ${knob.toFixed(4)}, wired-f inter-tooth RMS ${jack.toFixed(6)}.`);

function bodyTail(decay, body) {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, 48000);
  for (const [id, type] of [[1, 132], [2, 268], [3, 6]])
    assert.equal(x.soemdsp_graph_add_node(h, id, type), 0);
  assert.equal(x.soemdsp_graph_connect(h, 1, 0, 2, 0), 0);
  assert.equal(x.soemdsp_graph_connect(h, 2, 0, 3, 1), 0);
  x.soemdsp_graph_set_param(h, 2, 13, body);
  x.soemdsp_graph_set_param(h, 2, 52, decay); // Decay
  x.soemdsp_graph_snap_controls(h);
  assert.equal(x.soemdsp_graph_compile(h), 0);
  let energy = 0;
  for (let b = 0; b < 150; ++b) {
    const input = new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(h, 1, 0), N);
    input.fill(0);
    if (b === 0) input[0] = 1;
    x.soemdsp_graph_process_block(h, N);
    const out = new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(h, 2, 0), N);
    for (const sample of out) {
      assert.ok(Number.isFinite(sample));
      if (b >= 100) energy += sample * sample;
    }
  }
  x.soemdsp_graph_destroy(h);
  return energy;
}
for (const body of [0.5, 1])
  assert.ok(bodyTail(0.2, body) > 100 * bodyTail(0.01, body),
    `Body ${body} and Decay must reach native DSP through the graph`);
console.log("Graph String/Tube Body/Decay controls and ringing tails pass.");
