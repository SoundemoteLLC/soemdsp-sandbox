// Unit checks for the Pitch Mutator first-slice engine:
// A440 note law, 128-entry LUT bake, log-Hz frequency interpolation,
// linear slider-space offsets, pin, and whole-lane shift.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = { console };
vm.createContext(context);
for (const rel of [
  "public/node-graph-segment-curves.js",
  "public/pitch-mutator-engine.js",
]) {
  const filename = path.basename(rel);
  vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), context, { filename });
}

const E = context.PitchMutatorEngine;
const curve01 = context.nodeGraphSegmentCurve01;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function almost(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

assert(E, "engine loaded");
assert(typeof curve01 === "function", "segment curves loaded");
assert(E.LUT_SIZE === 128, "128-entry LUT");
assert(E.KEYBOARD_SPAN.min === 24 && E.KEYBOARD_SPAN.max === 96, "default C1-C7 span");

// A440 pitch law
assert(almost(E.hzFromNote(69), 440), "A4 is 440 Hz");
assert(almost(E.noteFromHz(440), 69), "440 Hz is A4");
assert(almost(E.hzFromNote(81), 880, 1e-9), "A5 is 880 Hz");
assert(almost(E.noteFromHz(E.hzFromNote(36)), 36, 1e-9), "note->Hz->note C2");

// Frequency bake: log interpolation between C2 and C6
const c2 = E.hzFromNote(36);
const c6 = E.hzFromNote(84);
const freqBake = E.bakeFreqLane({
  keys: [
    { x: 36, hz: c2, shape: "rational", skew: 0 },
    { x: 84, hz: c6 },
  ],
});
assert(freqBake.valid, "freq lut valid");
assert(freqBake.table.length === 128, "freq lut length");
assert(almost(E.exp2(freqBake.table[36]), c2, 1e-9), "lut holds C2 at 36");
assert(almost(E.exp2(freqBake.table[84]), c6, 1e-9), "lut holds C6 at 84");
const mid = E.lookupFreqHz(freqBake.table, 60, true);
const expectedMid = E.hzFromNote(60); // log interpolation == equal temperament
assert(almost(mid, expectedMid, 1e-6), "log-Hz mid is C4, got " + mid);
// Hold outside first/last keys
assert(almost(E.lookupFreqHz(freqBake.table, 0, true), c2, 1e-9), "hold below first key");
assert(almost(E.lookupFreqHz(freqBake.table, 127, true), c6, 1e-9), "hold above last key");
assert(E.lookupFreqHz(freqBake.table, 60, false) == null, "empty freq lut is unset");

// Fractional lookup stays in log space (linear in the table)
const a = E.lookupFreqHz(freqBake.table, 60, true);
const b = E.lookupFreqHz(freqBake.table, 61, true);
const frac = E.lookupFreqHz(freqBake.table, 60.5, true);
const logMid = (E.log2Hz(a) + E.log2Hz(b)) * 0.5;
assert(almost(E.log2Hz(frac), logMid, 1e-9), "fractional freq lerp is log");

// Knob offsets: linear in slider space
const offBake = E.bakeOffsetLane({
  keys: [
    { x: 36, offset: -0.15, shape: "rational", skew: 0 },
    { x: 60, offset: 0.25 },
  ],
});
assert(offBake.valid, "offset lut valid");
assert(almost(offBake.table[36], -0.15), "offset at first key");
assert(almost(offBake.table[60], 0.25), "offset at last key");
const midOff = E.lookupOffset(offBake.table, 48, true);
assert(almost(midOff, 0.05, 1e-9), "linear offset mid, got " + midOff);

// Discrete / hold does not interpolate
const discBake = E.bakeOffsetLane({
  discrete: true,
  keys: [
    { x: 36, offset: 0 },
    { x: 60, offset: 1 },
  ],
});
assert(almost(discBake.table[59], 0), "discrete holds until next key");
assert(almost(discBake.table[60], 1), "discrete snaps at next key");

// finalSlider clamp / sum
assert(almost(E.finalSlider(0.4, 0.2, { min: 0, max: 1 }), 0.6), "base+offset");
assert(almost(E.finalSlider(0.9, 0.3, { min: 0, max: 1 }), 1), "clamp high");
assert(almost(E.finalSlider(0.1, -0.4, { min: 0, max: 1 }), 0), "clamp low");
assert(almost(E.finalSlider(0.5, [0.1, 0.2], { min: 0, max: 1 }), 0.8), "sum offsets");

// Pin updates / inserts
let keys = [];
keys = E.pinKey(keys, 36.4, "hz", 100, true);
assert(keys.length === 1 && keys[0].x === 36, "pin snaps to semitone");
keys = E.pinKey(keys, 36.2, "hz", 110, true);
assert(keys.length === 1 && almost(keys[0].hz, 110), "pin updates existing");
keys = E.pinKey(keys, 60, "hz", 261.63, true);
assert(keys.length === 2 && keys[1].x === 60, "pin inserts second key");

// Whole-lane offset shift, then clamp
const shifted = E.shiftOffsets(
  [{ x: 36, offset: -0.15 }, { x: 60, offset: 0.25 }],
  0.2,
  { min: 0, max: 1 },
);
assert(almost(shifted[0].offset, 0.05) && almost(shifted[1].offset, 0.45), "shift both keys");
const clampedShift = E.shiftOffsets([{ x: 0, offset: 0.9 }], 0.3, { min: 0, max: 1 });
assert(almost(clampedShift[0].offset, 1), "shift clamps to definition");

// Freq lane log shift (whole-lane transpose)
const fshifted = E.shiftFreqKeysLog([{ x: 69, hz: 440 }], 1);
assert(almost(fshifted[0].hz, 880, 1e-9), "+1 octave in log2 Hz");

// Normalize + color
const state = E.normalizeMutatorState({
  color: "#C45",
  freqLane: { keys: [{ x: 69, hz: 440 }] },
  lanes: [{ target: { nodeId: "lp-3", paramKey: "cutoff" }, keys: [{ x: 36, offset: 0.1 }] }],
});
assert(state.freqLane.keys.length === 1, "normalize freq keys");
assert(state.lanes[0].target.paramKey === "cutoff", "normalize target");
assert(E.normalizeColor("#C45") === "#cc4455", "short color expands");
assert(E.normalizeColor("nope") === E.DEFAULT_COLOR, "bad color falls back");

// Remap / drop targets
const remapped = E.remapLaneTargets(state.lanes, { "lp-3": "lp-9" });
assert(remapped[0].target.nodeId === "lp-9", "copy remaps target nodeId");
const warnings = [];
const kept = E.dropMissingTargets(state.lanes, (t) => t.nodeId === "exists", warnings);
assert(kept.length === 0 && warnings.length === 1, "missing target dropped with warning");

console.log("test_pitch_mutator_engine: ok");
