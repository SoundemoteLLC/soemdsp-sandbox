// HP-09e: the Pitch Mutator knob lane in the NATIVE engine (graph_engine.cpp), loaded from the shipped wasm.
// The lane offset is added to the target Control AFTER the target's own smoother, from the Mutator's (smoothed) playhead:
//   - the target steps with the playhead even when the target's own smoothing is very long (nothing chases the offset);
//   - with playhead smoothing ON the target glides with the PLAYHEAD's time, not its own;
//   - the target's stored base value never changes; clearing the lane (or removing the Mutator) puts the target back.
// Target: a Pitch<->Hz node in "to Hz" mode with no input, so out = tuning * 2^(-69/12): the block output is proportional to the
// target's effective tuning Control (0..1000 here, so a slider offset of 0.2 is +200).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = process.env.NATIVE_WASM || path.join(root, "native_modules/combined/soemdsp_combined.wasm");
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), { env: { emo_process_block: () => 0 } }); // only the scripting module needs this import
const ex = instance.exports;
assert.equal(typeof ex.soemdsp_graph_set_mutator_lane, "function", "the wasm exports the Mutator lane API (rebuild native modules)");

const kTypePitchHz = 170, kTypePitchMutator = 280, kParamFrequency = 10;
const kSmoothNone = 3, kSmoothOnePole = 0;
const SR = 48000, BLOCK = 128, K = 2 ** (-69 / 12);
const M = 0x1001, T = 0x1002;
const noteHz = (n) => 440 * 2 ** ((n - 69) / 12);
const kPortF = 16; // Pitch In (MIDI-note units) lands on the F bus

const h = ex.soemdsp_graph_create();
ex.soemdsp_graph_set_sample_rate(h, SR);
assert.ok(ex.soemdsp_graph_add_node(h, M, kTypePitchMutator) >= 0, "Mutator node");
assert.ok(ex.soemdsp_graph_add_node(h, T, kTypePitchHz) >= 0, "target node");
// target: tuning 0..1000, base 500, a very long smoother of its own (5 s one-pole)
ex.soemdsp_graph_set_param_domain(h, T, kParamFrequency, 0, 1000, 0);
ex.soemdsp_graph_set_param(h, T, kParamFrequency, 500);
ex.soemdsp_graph_snap_param(h, T, kParamFrequency);
ex.soemdsp_graph_set_smooth_type(h, T, kParamFrequency, kSmoothOnePole);
ex.soemdsp_graph_set_smooth_time(h, T, kParamFrequency, 5 * SR);
// playhead: the knob, in keys (0..127), no smoothing
ex.soemdsp_graph_set_param_domain(h, M, kParamFrequency, 0, 127, 0);
const setPlayhead = (key) => { ex.soemdsp_graph_set_param(h, M, kParamFrequency, key); };
ex.soemdsp_graph_set_smooth_type(h, M, kParamFrequency, kSmoothNone);
setPlayhead(60);
ex.soemdsp_graph_snap_param(h, M, kParamFrequency);
// lane: +0.2 at C4, -0.2 at C5, linear between (slider units)
assert.equal(ex.soemdsp_graph_set_mutator_lane(h, M, kParamFrequency, 1, T), 1, "lane set");
const lut = () => new Float32Array(ex.memory.buffer, ex.soemdsp_graph_mutator_lane_lut_ptr(h, M), 128);
for (let n = 0; n < 128; n++) lut()[n] = n <= 60 ? 0.2 : n >= 72 ? -0.2 : 0.2 - (0.4 * (n - 60)) / 12;
assert.ok(ex.soemdsp_graph_compile(h) >= 0, "compile");

const run = (blocks = 1) => {
  for (let i = 0; i < blocks; i++) assert.ok(ex.soemdsp_graph_process_block(h, BLOCK) >= 0, "process");
  const out = new Float64Array(ex.memory.buffer, ex.soemdsp_graph_node_port_ptr(h, T, 0), BLOCK);
  return out[BLOCK - 1] / K; // the effective tuning
};
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;

// the lane is evaluated each block, the target sees it the next one at the latest
run(2);
let tuning = run(2);
assert.ok(near(tuning, 700), `C4: tuning = base 500 + 0.2 * 1000, got ${tuning}`);
setPlayhead(72);
run(2);
tuning = run(1);
assert.ok(near(tuning, 300), `C5 steps at once although the target's own smoother is 5 s long, got ${tuning}`);
setPlayhead(66);
run(2);
tuning = run(1);
assert.ok(near(tuning, 500), `F#4 is halfway between the pins, got ${tuning}`);

// the engine reports the playhead it evaluated the lane from (the page paints the knob and chip with it)
assert.ok(Math.abs(ex.soemdsp_graph_mutator_playhead_hz(h, M) - noteHz(66)) < 1e-6 * noteHz(66), "reported playhead Hz is the smoothed playhead (66)");

// playhead smoothing ON (one-pole, 0.5 s): the target glides with the PLAYHEAD's time, not its own 5 s
ex.soemdsp_graph_set_smooth_type(h, M, kParamFrequency, kSmoothOnePole);
ex.soemdsp_graph_set_smooth_time(h, M, kParamFrequency, 0.5 * SR);
setPlayhead(60);
const t1 = run(1);
const t0 = 500;
assert.ok(t1 > 300 && t1 < 700, `mid-glide the target is between the pins (${t1})`);
const glidingHz = ex.soemdsp_graph_mutator_playhead_hz(h, M);
assert.ok(glidingHz > noteHz(60) && glidingHz < noteHz(66), `mid-glide the reported playhead is between the notes (${glidingHz})`);
const t2 = run(Math.round((0.5 * SR) / BLOCK) * 3);
assert.ok(near(t2, 700, 25), `after about 3 playhead time constants the target is at the C4 value (${t2}), well before its own 5 s smoother could`);
void t0;
ex.soemdsp_graph_set_smooth_type(h, M, kParamFrequency, kSmoothNone);

// clearing the lane puts the target back on its base; the base was never touched
assert.equal(ex.soemdsp_graph_set_mutator_lane(h, M, kParamFrequency, 0, 0), 1, "lane cleared");
tuning = run(3);
assert.ok(near(tuning, 500), `no lane: the target is back on its base value, got ${tuning}`);

// idempotent re-sync (the host calls this on every param sync) keeps a running lane without a glitch
ex.soemdsp_graph_set_mutator_lane(h, M, kParamFrequency, 1, T);
for (let n = 0; n < 128; n++) lut()[n] = 0.1;
run(3);
const before = run(1);
ex.soemdsp_graph_set_mutator_lane(h, M, kParamFrequency, 1, T);
assert.ok(near(run(1), before, 1e-6), "an unchanged lane re-sync does not drop the offset for a block");
assert.ok(near(before, 600), `0.1 flat gives base + 100, got ${before}`);

// Pitch In mixes with the Playhead knob: a cable of 12 keys + the knob at 60 is the playhead at 72 (C5) -> the lane says -0.2 there
{
  const B = 0x1003, kTypeBias = 12, kParamOffset = 71; // a Bias node is a constant source: its Offset param is the number it sends
  assert.ok(ex.soemdsp_graph_add_node(h, B, kTypeBias) >= 0, "bias source node");
  ex.soemdsp_graph_set_param_domain(h, B, kParamOffset, -1000, 1000, 0);
  ex.soemdsp_graph_set_param(h, B, kParamOffset, 12);
  ex.soemdsp_graph_snap_param(h, B, kParamOffset);
  ex.soemdsp_graph_set_mutator_lane(h, M, kParamFrequency, 1, T);
  for (let n = 0; n < 128; n++) lut()[n] = n <= 60 ? 0.2 : n >= 72 ? -0.2 : 0.2 - (0.4 * (n - 60)) / 12;
  setPlayhead(60);
  ex.soemdsp_graph_snap_param(h, M, kParamFrequency);
  assert.equal(ex.soemdsp_graph_connect(h, B, 0, M, kPortF), 0, "cable into Pitch In");
  assert.ok(ex.soemdsp_graph_compile(h) >= 0, "recompile");
  run(3);
  tuning = run(2);
  assert.ok(near(tuning, 300), `Pitch In (12 keys) + knob (60) = C5: tuning 300, got ${tuning}`);
  // outputs: Saw = pitch in note units (the mixed playhead), Phase01 = the bound knob's lane value normalized (base 500/1000 + offset)
  const portOf = (n) => new Float64Array(ex.memory.buffer, ex.soemdsp_graph_node_port_ptr(h, M, n), BLOCK)[BLOCK - 1];
  assert.ok(Math.abs(portOf(3) - 72) < 1e-9, `pitch out is 72, got ${portOf(3)}`);
  assert.ok(Math.abs(portOf(10) - 0.3) < 1e-6, `0-1 out is 0.5 - 0.2 = 0.3 at C5, got ${portOf(10)}`);
  assert.ok(Math.abs(portOf(0) - noteHz(72)) < 1e-6 * noteHz(72), `f out is still Hz (${portOf(0)})`);
  ex.soemdsp_graph_set_param(h, B, kParamOffset, 0);
  ex.soemdsp_graph_snap_param(h, B, kParamOffset);
  run(3);
  tuning = run(2);
  assert.ok(near(tuning, 700), `Pitch In 0 + knob 60 = C4: tuning 700, got ${tuning}`);
  assert.ok(Math.abs(portOf(3) - 60) < 1e-9 && Math.abs(portOf(10) - 0.7) < 1e-6, `at C4 pitch out 60 and 0-1 out 0.7, got ${portOf(3)} / ${portOf(10)}`);
  // a huge cable value is clamped to the keyboard, never past it
  ex.soemdsp_graph_set_param(h, B, kParamOffset, 900);
  ex.soemdsp_graph_snap_param(h, B, kParamOffset);
  run(3);
  tuning = run(2);
  assert.ok(near(tuning, 300), `clamped at the top key: tuning 300, got ${tuning}`);
  assert.ok(Math.abs(ex.soemdsp_graph_mutator_playhead_hz(h, M) - noteHz(127)) < 1e-6 * noteHz(127), "reported playhead Hz is the clamped top key");
  ex.soemdsp_graph_set_param(h, B, kParamOffset, 0);
  ex.soemdsp_graph_snap_param(h, B, kParamOffset);
}

// removing the Mutator releases the target
assert.ok(ex.soemdsp_graph_remove_node(h, M) >= 0, "remove Mutator");
tuning = run(3);
assert.ok(near(tuning, 500), `Mutator removed: the target is back on its base, got ${tuning}`);

ex.soemdsp_graph_destroy(h);
console.log("test_pitch_mutator_lane_native: ok");
