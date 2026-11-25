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
assert(E.KEYBOARD_SPAN.min === 0 && E.KEYBOARD_SPAN.max === 127, "keyboard span is full MIDI 0-127");
assert(E.MIDI_RANGE.min === 0 && E.MIDI_RANGE.max === 127, "MIDI_RANGE 0-127");
assert(E.DEFAULT_VIEW.start === 12 && E.DEFAULT_VIEW.visible === 97, "default view is C0-C8");
assert(E.MIN_VISIBLE_KEYS === 12 && E.MAX_VISIBLE_KEYS === 128, "visible-key zoom limits");

const defaultView = E.clampView({});
assert(defaultView.start === 12 && defaultView.visible === 97, "clampView defaults to C0-C8");
const allView = E.clampView({ start: 0, visible: 128 });
assert(allView.start === 0 && allView.visible === 128, "clampView allows full 0-127");
const clipped = E.clampView({ viewStart: 200, visibleKeys: 73 });
assert(clipped.visible === 73 && clipped.start === 128 - 73, "clampView keeps the window in 0-127");
const tooMany = E.clampView({ start: 0, visible: 999 });
assert(tooMany.visible === 128 && tooMany.start === 0, "clampView caps visible at 128");
const tooFew = E.clampView({ start: 60, visible: 2 });
assert(tooFew.visible === 12, "clampView floors visible at 12");

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
let ends = E.pinKey([], 0, "hz", E.hzFromNote(0), true);
ends = E.pinKey(ends, 127, "hz", E.hzFromNote(127), true);
assert(ends.length === 2 && ends[0].x === 0 && ends[1].x === 127, "pin at MIDI 0 and 127");
const endBake = E.bakeFreqLane({ keys: ends });
assert(almost(E.exp2(endBake.table[0]), E.hzFromNote(0), 1e-9), "lut holds MIDI 0");
assert(almost(E.exp2(endBake.table[127]), E.hzFromNote(127), 1e-9), "lut holds MIDI 127");

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
assert(state.viewStart === 12 && state.visibleKeys === 97, "normalize default view");
const viewed = E.normalizeMutatorState({ viewStart: 10, visibleKeys: 20 });
assert(viewed.viewStart === 10 && viewed.visibleKeys === 20, "normalize keeps a valid view");
assert(E.normalizeColor("#C45") === "#cc4455", "short color expands");
assert(E.normalizeColor("nope") === E.DEFAULT_COLOR, "bad color falls back");

// Remap / drop targets
const remapped = E.remapLaneTargets(state.lanes, { "lp-3": "lp-9" });
assert(remapped[0].target.nodeId === "lp-9", "copy remaps target nodeId");
const warnings = [];
const kept = E.dropMissingTargets(state.lanes, (t) => t.nodeId === "exists", warnings);
assert(kept.length === 0 && warnings.length === 1, "missing target dropped with warning");

// ---- HP-09: Freq Out pass-through (D-M3), engine side
{
  const empty = E.bakeFreqLane({ keys: [] });
  assert(!empty.valid, "an empty Frequency lane bakes invalid");
  assert(almost(E.freqOutHz(empty, 69, 523.25), 523.25), "empty lane passes the incoming Hz through");
  assert(almost(E.freqOutHz(empty, 69, null), 440), "empty lane, nothing wired: the playhead note's Hz");
  assert(almost(E.freqOutHz(empty, 69.5, 0), E.hzFromNote(69.5)), "empty lane, no Freq In Hz: playhead Hz");
  const keyed = E.bakeFreqLane({ keys: [{ x: 36, hz: E.hzFromNote(36) }, { x: 84, hz: E.hzFromNote(84) * 2 }] });
  assert(E.freqOutHz(keyed, 60, 123) > E.hzFromNote(60) * 1.0, "a keyed lane ignores the incoming Hz");
}

// ---- HP-09: the overlay (headless: stub DOM, counting requestAnimationFrame)
{
  const registry = {};
  const timeouts = [];
  let rafCalls = 0;
  function makeEl(id) {
    const handlers = {};
    return {
      id: id || "", hidden: false, dataset: {}, children: [], handlers,
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(type, fn) { handlers[type] = fn; },
      append() {}, prepend() {}, setAttribute() {}, getAttribute() { return null; },
      querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; },
      innerHTML: "",
    };
  }
  const reg = (e) => { if (e.id) registry[e.id] = e; };
  const ctx2 = {
    console,
    document: {
      readyState: "complete", activeElement: null,
      getElementById: (id) => registry[id] || null,
      createElement: () => makeEl(""),
      body: { append: reg }, head: { append: reg },
      querySelector: () => null, querySelectorAll: () => [],
    },
    requestAnimationFrame: () => { rafCalls += 1; return rafCalls; },
    setTimeout: (fn) => { timeouts.push(fn); return timeouts.length; },
    clearTimeout() {},
    devicePixelRatio: 1,
  };
  vm.createContext(ctx2);
  const commitListeners = [];
  ctx2.addNodeGraphPatchCommitListener = (fn) => { commitListeners.push(fn); return () => {}; };
  ctx2.scheduleNodeGraphLiveParameterSync = () => { ctx2.__syncs = (ctx2.__syncs || 0) + 1; };
  ctx2.sendNodeGraphLiveMidiKeyboardSignal = () => {};
  ctx2.sendNodeGraphLiveKeyboardModuleSignal = () => {};
  const num = (a, b) => ({ min: a, max: b });
  ctx2.nodeGraphMvp = {
    patch: {
      nodes: [
        { id: "pm", type: "pitchMutator", params: { playheadHz: 440 } },
        { id: "kb", type: "keyboard", params: {} },
        { id: "k1", type: "filter", params: { cutoff: 0.5 }, paramMeta: { cutoff: num(0, 1) } },
        { id: "k2", type: "filter", params: { cutoff: 0.2 }, paramMeta: { cutoff: num(0, 1) } },
      ],
      connections: [],
    },
  };
  for (const rel of [
    "public/node-graph-segment-curves.js",
    "public/pitch-mutator-engine.js",
    "public/node-graph-param-offsets.js",
    "public/node-graph-pitch-mutator-overlay.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), "utf8"), ctx2, { filename: path.basename(rel) });
  }
  const pm = ctx2.nodeGraphMvp.patch.nodes[0];
  const overlay = registry.pitchMutatorOverlay;
  assert(overlay && overlay.handlers.click && overlay.handlers.pointerdown, "overlay boots and listens");

  // idle: nothing scheduled while closed
  assert(rafCalls === 0, "boot schedules no requestAnimationFrame (got " + rafCalls + ")");
  for (const fn of commitListeners) fn();
  ctx2.sendNodeGraphLiveMidiKeyboardSignal({ note: 64 });
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: 440 });
  assert(commitListeners.length === 1, "one patch commit listener");
  assert(rafCalls === 0, "closed overlay: commits and notes schedule no requestAnimationFrame (got " + rafCalls + ")");

  // knob lane: first armed turn binds, second armed turn is ignored (D-M1)
  ctx2.togglePitchMutatorOverlay(true);
  pm.mutator.autoPin = true;
  pm._mutatorArmed = true;
  const slider = (node, param) => ({ dataset: { node, param }, value: "0", getAttribute() { return null; } });
  const s1 = slider("k1", "cutoff");
  const s2 = slider("k2", "cutoff");
  assert(ctx2.pitchMutatorMaybeInterceptSlider(s1, 0.7) === true, "first armed turn binds and is taken");
  assert(pm.mutator.lanes.length === 1 && pm.mutator.lanes[0].target.nodeId === "k1", "lane 1 is the first knob");
  const keysBefore = JSON.stringify(pm.mutator.lanes[0].keys);
  s2.value = "0.2";
  assert(ctx2.pitchMutatorMaybeInterceptSlider(s2, 0.9) === false, "second armed knob is not taken");
  assert(s2.value === "0.2", "second knob stays free");
  assert(pm.mutator.lanes.length === 1 && pm.mutator.lanes[0].target.nodeId === "k1", "still one lane, still the first knob");
  assert(JSON.stringify(pm.mutator.lanes[0].keys) === keysBefore, "lane 1 keys untouched by the second turn");
  assert(JSON.stringify(ctx2.nodeGraphMvp.patch.nodes[2].params) === '{"cutoff":0.5}', "first knob's base slider untouched");
  assert(overlay.innerHTML.includes("One knob lane for now"), "overlay shows the one-lane line");
  ctx2.togglePitchMutatorOverlay(false);
  assert(overlay.hidden === true, "overlay closes");

  // D-M2: wired Freq In drives the playhead; unwired falls back to the audition key
  pm.mutator.lanes[0].keys = [{ x: 60, offset: 0 }, { x: 81, offset: 0.3 }];
  pm.mutator.autoPin = false;
  pm.mutator.snap = false; // Snap rounds the playhead to a key; off, Freq In is continuous
  const meta = ctx2.nodeGraphMvp.patch.nodes[2].paramMeta.cutoff;
  const effective = () => ctx2.applyNodeGraphParamOffsetsToBase(ctx2.nodeGraphMvp.patch.nodes[2], "cutoff", 0.5, meta);
  ctx2.sendNodeGraphLiveMidiKeyboardSignal({ note: 60 });
  assert(almost(effective(), 0.5, 1e-9), "unwired: the audition key (C4) sets the playhead");
  ctx2.nodeGraphMvp.patch.connections.push({ sourceNode: "kb", sourcePort: "f", destinationNode: "pm", destinationPort: "f" });
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: E.hzFromNote(81), gate: 1 });
  assert(almost(effective(), 0.8, 1e-9), "wired Freq In (A5) moves the playhead and the knob offset, got " + effective());
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: E.hzFromNote(70.5), gate: 1 });
  const bakedLane = E.bakeOffsetLane(pm.mutator.lanes[0]);
  const wiredMid = 0.5 + E.lookupOffset(bakedLane.table, 70.5, true);
  assert(Math.abs(wiredMid - (0.5 + bakedLane.table[70])) > 1e-6 && Math.abs(wiredMid - (0.5 + bakedLane.table[71])) > 1e-6, "70.5 is between two keys");
  assert(almost(effective(), wiredMid, 1e-6), "Freq In is read as a continuous signal, not a rounded key, got " + effective());
  const syncsBefore = ctx2.__syncs || 0;
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: E.hzFromNote(60), gate: 1 });
  assert((ctx2.__syncs || 0) > syncsBefore, "a note on the wired source asks for a live param sync");
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("other", { frequency: 1000, gate: 1 });
  ctx2.nodeGraphMvp.patch.connections.length = 0;
  ctx2.sendNodeGraphLiveMidiKeyboardSignal({ note: 81 });
  assert(almost(effective(), 0.8, 1e-9), "unwired again: back to the audition key");

  // D-M3: Pin on an empty Frequency lane writes the incoming Hz
  pm.mutator.activeLane = "freq";
  pm.mutator.freqLane.keys = [];
  ctx2.nodeGraphMvp.patch.connections.push({ sourceNode: "kb", sourcePort: "f", destinationNode: "pm", destinationPort: "f" });
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: 523.25, gate: 1 });
  ctx2.togglePitchMutatorOverlay(true);
  const pinBtn = { getAttribute: (n) => (n === "data-pm" ? "pin" : null) };
  overlay.handlers.click({ target: { closest: () => pinBtn } });
  assert(pm.mutator.freqLane.keys.length === 1 && almost(pm.mutator.freqLane.keys[0].hz, 523.25, 1e-6),
    "empty lane pins the incoming Hz, got " + JSON.stringify(pm.mutator.freqLane.keys));

  // 7: the overlay strip key changes the playhead on pointerdown; a drag still pans and eats the click
  ctx2.nodeGraphMvp.patch.connections.length = 0;
  const axis = { scrollLeft: 0, setPointerCapture() {} };
  const keyEl = (n) => ({ getAttribute: (a) => (a === "data-note" ? String(n) : a === "data-pm" ? "key" : null) });
  const target = (k) => ({ closest: (sel) => (sel === "[data-pm=axis]" ? axis : sel === "[data-pm=key]" ? k : null) });
  pm.mutator.freqLane.keys = [];
  pm.mutator.lanes[0].keys = [{ x: 60, offset: 0 }, { x: 72, offset: 0.12 }];
  overlay.handlers.pointerdown({ target: target(keyEl(72)), pointerId: 1, clientX: 100, clientY: 0 });
  assert(almost(effective(), 0.62, 1e-9), "key pointerdown set the playhead before any click, got " + effective());
  overlay.handlers.pointermove({ target: target(null), pointerId: 1, clientX: 140, clientY: 0 });
  overlay.handlers.pointerup({ target: target(null), pointerId: 1, clientX: 140, clientY: 0 });
  overlay.handlers.click({ target: { closest: () => keyEl(60) } });
  assert(almost(effective(), 0.62, 1e-9), "the click after a drag-pan is suppressed");
  while (timeouts.length) timeouts.shift()();
  overlay.handlers.pointerdown({ target: target(keyEl(60)), pointerId: 2, clientX: 10, clientY: 0 });
  overlay.handlers.pointerup({ target: target(keyEl(60)), pointerId: 2, clientX: 10, clientY: 0 });
  assert(almost(effective(), 0.5, 1e-9), "a plain tap on another key moves the playhead");

  // idle again after closing: no requestAnimationFrame left queued by the Mutator
  ctx2.togglePitchMutatorOverlay(false);
  const rafAtClose = rafCalls;
  for (const fn of commitListeners) fn();
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: 330, gate: 1 });
  ctx2.sendNodeGraphLiveMidiKeyboardSignal({ note: 50 });
  assert(rafCalls === rafAtClose, "closed and idle again: no requestAnimationFrame scheduled");
}

console.log("test_pitch_mutator_engine: ok");
