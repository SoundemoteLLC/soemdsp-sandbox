// HP-23: gradient lanes in the native graph engine (headless, the real combined wasm).
//   - A Gradient node (type 286) puts its playhead (Playhead knob + summed In) on Phase01 every sample; Out passes In through.
//   - A lane (soemdsp_graph_add_param_lut_edge) maps that playhead through a LUT to a domain offset on one target param, added after
//     the target's smoother, every sample. The LUT is rewritten in place (no recompile). Playheads outside 0..1 hold the ends.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = await WebAssembly.compile(fs.readFileSync(path.join(root, "native_modules/combined/soemdsp_combined.wasm")));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) {
  imports[i.module] ??= {};
  imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined;
}
const x = (await WebAssembly.instantiate(mod, imports)).exports;
assert.equal(typeof x.soemdsp_graph_add_param_lut_edge, "function", "lane export");
assert.equal(typeof x.soemdsp_graph_param_lut_ptr, "function", "LUT pointer export");
assert.equal(typeof x.soemdsp_graph_clear_lut_edges, "function", "lane clear export");

const SR = 48000, BLK = 128;
const GRADIENT = 286, OSC = 1, BIAS = 12, OUTPUT = 6;
const P_FREQ = 10, P_OFFSET = 71, PORT_MONO = 0, PORT_PHASE01 = 10, SINE = 5;
const LUT_N = 257;

function graph({ knob = 0, input = null, lut }) {
  const h = x.soemdsp_graph_create();
  x.soemdsp_graph_set_sample_rate(h, SR);
  x.soemdsp_graph_add_node(h, 1, GRADIENT);
  x.soemdsp_graph_add_node(h, 2, OSC);
  x.soemdsp_graph_set_param(h, 2, P_FREQ, 100);
  x.soemdsp_graph_add_node(h, 9, OUTPUT); // only what reaches the Output runs
  x.soemdsp_graph_connect(h, 2, SINE, 9, 0);
  x.soemdsp_graph_set_param(h, 1, P_OFFSET, knob);
  if (input !== null) {
    x.soemdsp_graph_add_node(h, 3, BIAS);
    x.soemdsp_graph_set_param(h, 3, P_OFFSET, input);
    x.soemdsp_graph_connect(h, 3, PORT_MONO, 1, 0);
  }
  const index = x.soemdsp_graph_add_param_lut_edge(h, 1, PORT_PHASE01, 2, P_FREQ);
  assert.ok(index >= 0, `lane added (${index})`);
  new Float32Array(x.memory.buffer, x.soemdsp_graph_param_lut_ptr(h, index), LUT_N).set(lut);
  x.soemdsp_graph_compile?.(h);
  x.soemdsp_graph_snap_controls(h);
  return { h, index };
}
const port = (h, node, p) => { const q = x.soemdsp_graph_node_port_ptr(h, node, p) / 8; return new Float64Array(x.memory.buffer).slice(q, q + BLK); };
function hz(h, blocks = 60) {
  const s = [];
  for (let b = 0; b < blocks; b += 1) { x.soemdsp_graph_process_block(h, BLK); if (b >= 10) s.push(...port(h, 2, SINE)); }
  // Upward zero crossings, interpolated: cycles between the first and the last over the time between them.
  const at = [];
  for (let i = 1; i < s.length; i += 1) if (s[i - 1] < 0 && s[i] >= 0) at.push(i - 1 + -s[i - 1] / (s[i] - s[i - 1]));
  return at.length > 1 ? (at.length - 1) / ((at[at.length - 1] - at[0]) / SR) : 0;
}
const ramp = Float32Array.from({ length: LUT_N }, (_, i) => (i / (LUT_N - 1)) * 1000); // offset 0..1000 Hz across the playhead

let g = graph({ knob: 0.5, lut: ramp });
const mid = hz(g.h);
assert.ok(Math.abs(mid - 600) < 6, `knob 0.5 -> 100 + 500 Hz (got ${mid.toFixed(1)})`);
x.soemdsp_graph_process_block(g.h, BLK);
assert.ok(port(g.h, 1, PORT_PHASE01).every((v) => Math.abs(v - 0.5) < 1e-9), "Phase01 carries the playhead");

// Playhead past the ends holds the end values.
g = graph({ knob: 1.7, lut: ramp });
assert.ok(Math.abs(hz(g.h) - 1100) < 8, "a playhead above 1 holds the last stop");
g = graph({ knob: -0.4, lut: ramp });
assert.ok(Math.abs(hz(g.h) - 100) < 4, "a playhead below 0 holds the first stop");

// Playhead = knob + In (cables sum); Out passes In through.
g = graph({ knob: 0.25, input: 0.25, lut: ramp });
assert.ok(Math.abs(hz(g.h) - 600) < 6, "knob 0.25 + In 0.25 plays at 0.5");
x.soemdsp_graph_process_block(g.h, BLK);
assert.ok(port(g.h, 1, PORT_MONO).every((v) => Math.abs(v - 0.25) < 1e-9), "Out is In (thru)");

// Rewriting the LUT in place changes the sound with no recompile.
new Float32Array(x.memory.buffer, x.soemdsp_graph_param_lut_ptr(g.h, g.index), LUT_N).fill(200);
assert.ok(Math.abs(hz(g.h) - 300) < 5, "a rewritten LUT takes effect without recompiling");

// clear_lut_edges removes the lanes only (a plain MOD edge stays) and empties the LUT pool.
x.soemdsp_graph_clear_lut_edges(g.h);
x.soemdsp_graph_compile?.(g.h);
assert.ok(Math.abs(hz(g.h) - 100) < 4, "clear_lut_edges removes the lane");
const again = x.soemdsp_graph_add_param_lut_edge(g.h, 1, PORT_PHASE01, 2, P_FREQ);
assert.equal(again, 0, "the LUT pool starts over");
new Float32Array(x.memory.buffer, x.soemdsp_graph_param_lut_ptr(g.h, again), LUT_N).set(ramp);
x.soemdsp_graph_compile?.(g.h);
assert.ok(Math.abs(hz(g.h) - 600) < 6, "a re-added lane plays");
g.index = again;

// Clearing the MOD edges clears the lanes.
x.soemdsp_graph_clear_param_mod_edges(g.h);
x.soemdsp_graph_compile?.(g.h);
assert.ok(Math.abs(hz(g.h) - 100) < 4, "clear removes the lane");
assert.equal(x.soemdsp_graph_param_lut_ptr(g.h, g.index), 0, "and its LUT");

console.log("test_gradient_lane_engine: ok (audio-rate lane: per-sample playhead, LUT offset after the smoother, ends held, thru, in-place LUT)");
