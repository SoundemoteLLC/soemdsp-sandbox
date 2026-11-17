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
