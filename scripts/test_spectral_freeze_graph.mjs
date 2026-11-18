import assert from 'node:assert/strict';
import fs from 'node:fs';
const x = (await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/combined/soemdsp_combined.wasm', import.meta.url)),
  { env: { emo_process_block() {} } })).instance.exports;
const N = 128, sr = 48000;
for (const wiredGate of [false, true]) for (const fftSize of [512, 4096, 16384]) {
  const g = x.soemdsp_graph_create(), ref = x.soemdsp_spectral_freeze_create();
  x.soemdsp_graph_set_sample_rate(g, sr);
  for (const [id, kind] of [[1, 132], [2, 273], [3, 6]]) assert.equal(x.soemdsp_graph_add_node(g, id, kind), 0);
  for (const p of [1, 2]) {
    x.soemdsp_graph_connect(g, 1, p, 2, p);
    x.soemdsp_graph_connect(g, 2, p, 3, p);
  }
  if (wiredGate) x.soemdsp_graph_connect(g, 1, 10, 2, 24);
  x.soemdsp_graph_connect(g, 1, 3, 2, 19);
  const params = [[21, wiredGate ? 0 : 1], [52, 0], [42, 0], [1, 1], [40, 1],
    [22, fftSize], [55, 50], [31, 0.5], [11, 0]];
  for (const [id, value] of params) x.soemdsp_graph_set_param(g, 2, id, value);
  x.soemdsp_graph_snap_controls(g); assert.equal(x.soemdsp_graph_compile(g), 0);
  const buffer = (id, p) => new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(g, id, p), N);
  let heardHold = false;
  for (let b = 0; b < 700; ++b) {
    const count = b >= 300 ? 2 : b >= 200 ? 1 : 0;
    x.soemdsp_graph_set_param(g, 2, 11, count);
    const inputs = [];
    for (const p of [1, 2, 3, 10]) {
      const a = buffer(1, p);
      for (let i = 0; i < N; ++i) {
        const t = b * N + i;
        a[i] = p === 10 ? (b < 600 ? 1 : 0) : p === 3 ? (t === 45001 ? 1 : 0)
          : t < 50000 ? 0.1 * Math.sin(t * (p === 1 ? 0.07 : 0.11)) : 0;
      }
      inputs.push(a.slice());
    }
    x.soemdsp_graph_process_block(g, N);
    const out = [buffer(2, 1).slice(), buffer(2, 2).slice(), buffer(2, 10).slice()];
    for (let i = 0; i < N; ++i) {
      x.soemdsp_spectral_freeze_configure(ref, fftSize, 50, 0.5, count);
      const l = x.soemdsp_spectral_freeze_sample(ref, inputs[0][i], inputs[1][i],
        wiredGate ? inputs[3][i] : 1, inputs[2][i], 0, 0, 1, 1, sr);
      const r = x.soemdsp_spectral_freeze_right(ref), held = x.soemdsp_spectral_freeze_held(ref);
      assert.ok(Math.abs(out[0][i] - l) < 1e-10 && Math.abs(out[1][i] - r) < 1e-10);
      assert.equal(out[2][i], held, 'Held is a real native output');
      if (b > 420 && held && Math.abs(l) > 1e-5) heardHold = true;
    }
  }
  assert.ok(heardHold, 'held sound continues with silent input');
  assert.equal(x.soemdsp_graph_type_uses_pool(273), 1);
  x.soemdsp_spectral_freeze_destroy(ref); x.soemdsp_graph_destroy(g);
}
console.log('Spectral Freeze graph: switch/gate override, stereo, one-sample Recapture, Held and continued sound match direct native processing.');
