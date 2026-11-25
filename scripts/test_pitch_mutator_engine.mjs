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
function almost(a, b, eps = 1e-6) { // lane tables are Float32 (as in the native engine)
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
  assert(almost(E.freqOutHz(empty, 69.5, 0), E.hzFromNote(69.5)), "empty lane, no Pitch In Hz: playhead Hz");
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
  // The app-wide note name (node-graph-view-controls.js): MIDI 0 = C-2, MIDI 60 = C3.
  ctx2.nodeGraphKeyboardPitchLabel = (m) => ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((m % 12) + 12) % 12] + (Math.floor(m / 12) - 2);
  ctx2.sendNodeGraphLiveKeyboardModuleSignal = () => {};
  const num = (a, b) => ({ min: a, max: b });
  ctx2.nodeGraphMvp = {
    patch: {
      nodes: [
        { id: "pm", type: "pitchMutator", params: { playhead: 0 } },
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
  // The Playhead is a knob in keys (0..127); the Mutator keyboard sets it, and anything on Pitch In adds to it.
  const setPlayhead = (n) => { pm.params.playhead = n; ctx2.sendNodeGraphLiveMidiKeyboardSignal({ note: n }); }; // the signal only wakes the overlay (noteMoved); the playhead is the knob
  const overlay = registry.pitchMutatorOverlay;
  assert(overlay && overlay.handlers.click && overlay.handlers.pointerdown, "overlay boots and listens");

  // idle: nothing scheduled while closed
  assert(rafCalls === 0, "boot schedules no requestAnimationFrame (got " + rafCalls + ")");
  for (const fn of commitListeners) fn();
  setPlayhead(64);
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: 440 });
  assert(commitListeners.length === 1, "one patch commit listener");
  assert(rafCalls === 0, "closed overlay: commits and notes schedule no requestAnimationFrame (got " + rafCalls + ")");

  // knob lane: first armed turn binds, second armed turn is ignored (D-M1)
  ctx2.togglePitchMutatorOverlay(true);
  pm.mutator.autoPin = true;
  pm._mutatorArmed = true;
  // The real range input has only dataset.param; its node id lives on the parent .dsp-node article.
  const slider = (node, param) => ({
    dataset: { param }, value: "0", getAttribute() { return null; },
    closest: (sel) => (sel === ".dsp-node" ? { dataset: { node } } : null),
  });
  const s1 = slider("k1", "cutoff");
  const s2 = slider("k2", "cutoff");
  assert(ctx2.pitchMutatorMaybeInterceptSlider(s1, 0.7) === true, "first armed turn binds and is taken");
  assert(pm.mutator.lanes.length === 1 && pm.mutator.lanes[0].target.nodeId === "k1", "lane 1 is the first knob");
  const keysBefore = JSON.stringify(pm.mutator.lanes[0].keys);
  s2.value = "0.2";
  assert(pm._mutatorArmed === false, "Arm ends with the first bind (D-M8)");
  assert(ctx2.pitchMutatorMaybeInterceptSlider(s2, 0.9) === false, "disarmed: the second knob is a normal base write");
  pm._mutatorArmed = true;
  assert(ctx2.pitchMutatorMaybeInterceptSlider(s2, 0.9) === false, "second armed knob is not taken");
  assert(s2.value === "0.2", "second knob stays free");
  assert(pm.mutator.lanes.length === 1 && pm.mutator.lanes[0].target.nodeId === "k1", "still one lane, still the first knob");
  assert(JSON.stringify(pm.mutator.lanes[0].keys) === keysBefore, "lane 1 keys untouched by the second turn");
  assert(JSON.stringify(ctx2.nodeGraphMvp.patch.nodes[2].params) === '{"cutoff":0.5}', "first knob's base slider untouched");
  assert(overlay.innerHTML.includes("One knob lane for now"), "overlay shows the one-lane line");
  assert(pm._mutatorArmed === false, "an ignored second knob disarms");
  ctx2.togglePitchMutatorOverlay(false);
  assert(overlay.hidden === true, "overlay closes");

  // D-M2: wired Pitch In drives the playhead; unwired falls back to the audition key
  pm.mutator.lanes[0].keys = [{ x: 60, offset: 0 }, { x: 81, offset: 0.3 }];
  pm.mutator.autoPin = false;
  pm.mutator.snap = false; // Snap rounds the playhead to a key; off, Pitch In is continuous
  const meta = ctx2.nodeGraphMvp.patch.nodes[2].paramMeta.cutoff;
  // HP-09e: the Mutator does not touch the target's params. It ships the native engine (1) the playhead Hz and (2) a 128-entry lane table; the
  // engine adds table[note] to the target AFTER the target's smoother. This helper does what the engine does with those two, for the asserts.
  const nativeEffective = (node, key, base, metaIn) => {
    ctx2.applyNodeGraphParamOffsets(pm, {}, { notify: false });
    const lane = pm._mutatorLane;
    if (!lane || !lane.valid || lane.target.nodeId !== node.id || lane.target.paramKey !== key) return base;
    const note = ctx2.pitchMutatorPlayheadNote(pm);
    const i = Math.floor(note), f = note - i, t1 = lane.table[Math.min(127, i + 1)];
    const off = lane.table[i] + (t1 - lane.table[i]) * f;
    return Math.min(metaIn.max, Math.max(metaIn.min, base + off));
  };
  const effective = () => nativeEffective(ctx2.nodeGraphMvp.patch.nodes[2], "cutoff", 0.5, meta);
  setPlayhead(60);
  assert(almost(effective(), 0.5, 1e-6), "unwired: the Playhead knob (C4) is the playhead");
  ctx2.nodeGraphMvp.patch.connections.push({ sourceNode: "kb", sourcePort: "f", destinationNode: "pm", destinationPort: "pitch" });
  setPlayhead(0);
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: E.hzFromNote(81), gate: 1 });
  assert(almost(effective(), 0.8, 1e-6), "wired Pitch In (A5) with the knob at 0 moves the playhead and the knob offset, got " + effective());
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: E.hzFromNote(70.5), gate: 1 });
  const bakedLane = E.bakeOffsetLane(pm.mutator.lanes[0]);
  const wiredMid = 0.5 + E.lookupOffset(bakedLane.table, 70.5, true);
  assert(Math.abs(wiredMid - (0.5 + bakedLane.table[70])) > 1e-6 && Math.abs(wiredMid - (0.5 + bakedLane.table[71])) > 1e-6, "70.5 is between two keys");
  assert(almost(effective(), wiredMid, 1e-6), "Pitch In is read as a continuous signal, not a rounded key, got " + effective());
  // mixing: the knob adds to Pitch In (C4 on the wire + 12 keys on the knob = C5), nobody wins
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: E.hzFromNote(60), gate: 1 });
  setPlayhead(12);
  assert(almost(effective(), 0.5 + E.lookupOffset(bakedLane.table, 72, true), 1e-6), "Pitch In C4 + Playhead knob 12 keys = C5, got " + effective());
  setPlayhead(0);
  const syncsBefore = ctx2.__syncs || 0;
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: E.hzFromNote(60), gate: 1 });
  assert((ctx2.__syncs || 0) > syncsBefore, "a note on the wired source asks for a live param sync");
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("other", { frequency: 1000, gate: 1 });
  ctx2.nodeGraphMvp.patch.connections.length = 0;
  setPlayhead(81);
  assert(almost(effective(), 0.8, 1e-6), "unwired again: the knob alone is the playhead");

  // HP-09f: a fresh list is blank (no Frequency entry). With no knob bound, Pin is disabled; the Hz field is gone.
  pm.mutator.activeLane = "freq";
  pm.mutator.freqLane.keys = [];
  pm.mutator.lanes.length = 0;
  ctx2.nodeGraphMvp.patch.connections.push({ sourceNode: "kb", sourcePort: "f", destinationNode: "pm", destinationPort: "pitch" });
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: 523.25, gate: 1 });
  ctx2.togglePitchMutatorOverlay(true);
  const pinBtn = { getAttribute: (n) => (n === "data-pm" ? "pin" : null) };
  overlay.handlers.click({ target: { closest: () => pinBtn } });
  assert(pm.mutator.freqLane.keys.length === 0, "Pin with no knob bound leaves the Frequency lane empty");
  assert(!overlay.innerHTML.includes("Frequency"), "the list has no Frequency entry");
  assert(!overlay.innerHTML.includes('data-pm="hz"'), "the Hz field is gone");
  assert(!overlay.innerHTML.includes("Wire Freq Out"), "the explanation text is gone");
  assert(overlay.innerHTML.includes("disabled aria-disabled"), "Pin is disabled while nothing is bound");
  assert(!overlay.innerHTML.includes('data-pm="lane"'), "no lane entries until something is armed");
  // a saved patch with Frequency pins AND a knob lane: the Frequency pins drop once, the knob lane keeps its keys
  {
    const legacy = { type: "pitchMutator", id: "pm-old", params: {}, mutator: {
      freqLane: { keys: [{ x: 60, hz: 261.6 }, { x: 72, hz: 600 }] },
      lanes: [{ id: "L1", target: { nodeId: "k1", paramKey: "cutoff" }, keys: [{ x: 60, offset: 0.1 }] }],
      activeLane: "freq" } };
    ctx2.nodeGraphMvp.patch.nodes.push(legacy);
    ctx2.applyNodeGraphParamOffsets(legacy, {}, { notify: false }); // building the Mutator's live params normalizes its state
    assert(legacy.mutator.freqLane.keys.length === 0, "Frequency pins are dropped on load");
    assert(legacy.mutator.lanes[0].keys.length === 1, "the knob lane is not touched");
    assert(legacy.mutator.activeLane === "L1", "the knob lane is the active lane when one exists");
    ctx2.nodeGraphMvp.patch.nodes.pop();
  }
  ctx2.nodeGraphMvp.patch.connections.length = 0;

  // 7: the overlay strip key changes the playhead on pointerdown; a drag still pans and eats the click
  pm.mutator.lanes.push({ id: "L1", target: { nodeId: "k1", paramKey: "cutoff" }, keys: [], discrete: false });
  pm.mutator.activeLane = "L1";
  ctx2.nodeGraphMvp.patch.connections.length = 0;
  const axis = { scrollLeft: 0, setPointerCapture() {} };
  const keyEl = (n) => ({ getAttribute: (a) => (a === "data-note" ? String(n) : a === "data-pm" ? "key" : null) });
  const target = (k) => ({ closest: (sel) => (sel === "[data-pm=axis]" ? axis : sel === "[data-pm=key]" ? k : null) });
  pm.mutator.freqLane.keys = [];
  pm.mutator.lanes[0].keys = [{ x: 60, offset: 0 }, { x: 72, offset: 0.12 }];
  overlay.handlers.pointerdown({ target: target(keyEl(72)), pointerId: 1, clientX: 100, clientY: 0 });
  assert(almost(effective(), 0.62, 1e-6), "key pointerdown set the playhead before any click, got " + effective());
  overlay.handlers.pointermove({ target: target(null), pointerId: 1, clientX: 140, clientY: 0 });
  overlay.handlers.pointerup({ target: target(null), pointerId: 1, clientX: 140, clientY: 0 });
  overlay.handlers.click({ target: { closest: () => keyEl(60) } });
  assert(almost(effective(), 0.62, 1e-6), "the click after a drag-pan is suppressed");
  // No 0ms timer: leftover suppress is cleared on the next pointerdown (and consumed by the click above).
  overlay.handlers.pointerdown({ target: target(keyEl(60)), pointerId: 2, clientX: 10, clientY: 0 });
  overlay.handlers.pointerup({ target: target(keyEl(60)), pointerId: 2, clientX: 10, clientY: 0 });
  assert(almost(effective(), 0.5, 1e-6), "a plain tap on another key moves the playhead");

  // HP-09c: Auto-Pin OFF flow on a fresh lane (pending value, Pin Keyframe, drop on another note), base untouched
  {
    pm.mutator.lanes.length = 0;
    pm.mutator.freqLane.keys = [];
    pm.mutator.autoPin = false;
    pm.mutator.snap = true;
    ctx2.nodeGraphMvp.patch.connections.length = 0;
    ctx2.togglePitchMutatorOverlay(false);
    const k1 = ctx2.nodeGraphMvp.patch.nodes[2];
    const knob = slider("k1", "cutoff");
    const turn = (v) => { knob.value = String(v); return ctx2.pitchMutatorMaybeInterceptSlider(knob, v); };
    const eff = () => nativeEffective(k1, "cutoff", k1.params.cutoff, k1.paramMeta.cutoff);
    const live = () => { const p = { cutoff: k1.params.cutoff }; ctx2.applyNodeGraphParamOffsets(k1, p, { notify: false }); return p.cutoff; };
    // the target's own params are never offset by the Mutator
    const liveIsBase = () => almost(live(), k1.params.cutoff);
    setPlayhead(60);
    assert(turn(0.9) === false, "not armed, no lane: a normal base write");
    pm._mutatorArmed = true; // armed with the overlay CLOSED (D-M8)
    assert(turn(0.9) === true, "armed with the overlay closed: the turn binds");
    assert(pm.mutator.lanes.length === 1 && pm._mutatorArmed === false, "bound and disarmed");
    assert(almost(k1.params.cutoff, 0.5), "base slider never written by a bound turn");
    assert(pm.mutator.lanes[0].keys.length === 0, "Auto-Pin off: the turn is pending, nothing pinned");
    assert(almost(eff(), 0.9) && liveIsBase(), "the pending value shows at the playhead");
    setPlayhead(72);
    assert(almost(eff(), 0.5) && liveIsBase(), "moving to another note drops the pending value");
    setPlayhead(60);
    assert(almost(eff(), 0.5), "and it does not come back");
    assert(turn(0.9) === true, "a bound knob turn is always taken");
    ctx2.togglePitchMutatorOverlay(true);
    const pinBtn2 = { getAttribute: (n) => (n === "data-pm" ? "pin" : null) };
    overlay.handlers.click({ target: { closest: () => pinBtn2 } });
    assert(pm.mutator.lanes[0].keys.length === 1 && pm.mutator.lanes[0].keys[0].x === 60, "Pin Keyframe pins the pending value at C4");
    setPlayhead(84);
    assert(turn(0.1) === true, "turn at C6");
    overlay.handlers.click({ target: { closest: () => pinBtn2 } });
    const keys2 = pm.mutator.lanes[0].keys;
    assert(keys2.length === 2 && keys2[0].x === 60 && keys2[1].x === 84, "second pin at C6");
    assert(almost(keys2[0].offset, 0.4) && almost(keys2[1].offset, -0.4), "two different, signed offsets: " + JSON.stringify(keys2));
    setPlayhead(60);
    assert(almost(eff(), 0.9) && liveIsBase(), "C4 gives the first pin");
    setPlayhead(84);
    assert(almost(eff(), 0.1) && liveIsBase(), "C6 gives the second pin");
    setPlayhead(72);
    assert(almost(eff(), 0.5, 1e-6), "C5 is interpolated between the pins, got " + eff());
    assert(almost(k1.params.cutoff, 0.5), "base slider still untouched");
    // Auto-Pin on: each turn pins at the playing note
    pm.mutator.autoPin = true;
    setPlayhead(48);
    assert(turn(0.7) === true && pm.mutator.lanes[0].keys.some((k) => k.x === 48 && almost(k.offset, 0.2)), "Auto-Pin on pins at the playing note");
    // lane identity: a bind and pin in the very same turn lands in node.mutator.lanes (the bug stored it in a stale copy)
    pm.mutator.lanes.length = 0;
    pm.mutator.autoPin = true;
    pm._mutatorArmed = true;
    setPlayhead(60);
    assert(turn(0.8) === true, "bind + Auto-Pin in one turn");
    assert(pm.mutator.lanes.length === 1 && pm.mutator.lanes[0].keys.length === 1 && almost(pm.mutator.lanes[0].keys[0].offset, 0.3),
      "the pin is in node.mutator.lanes[0], got " + JSON.stringify(pm.mutator.lanes));
    // HP-09d: never the Mutator's own controls; a bound-knob turn re-selects its lane; Pin ignores the Frequency chip
    pm._mutatorArmed = true;
    assert(ctx2.pitchMutatorMaybeInterceptSlider(slider("pm", "playhead"), 0.5) === false, "the Mutator's own playhead is never bound");
    assert(pm.mutator.lanes.length === 1 && pm.mutator.lanes[0].target.nodeId === "k1", "no lane for the Mutator's own control");
    assert(overlay.innerHTML.includes("A Mutator can't mutate itself."), "arming its own knob shows the inline note");
    assert(pm._mutatorArmed === true, "and Arm stays on for the real knob");
    pm._mutatorArmed = false;
    pm.mutator.activeLane = "freq";
    assert(turn(0.6) === true && pm.mutator.activeLane === "L1", "turning the bound knob re-selects its lane");
    pm.mutator.activeLane = "freq";
    ctx2.togglePitchMutatorOverlay(true);
    const keysBeforePin = pm.mutator.lanes[0].keys.length;
    setPlayhead(66);
    overlay.handlers.click({ target: { closest: () => ({ getAttribute: (n) => (n === "data-pm" ? "pin" : null) }) } });
    assert(pm.mutator.lanes[0].keys.length === keysBeforePin + 1 && pm.mutator.freqLane.keys.length === 0, "Pin with the Frequency chip showing still pins the knob lane");
  }

  // HP-09e: paint and the main-thread offset follow the engine's SMOOTHED playhead (data bus PlayheadHz); pins stay on the target note
  {
    const k1 = ctx2.nodeGraphMvp.patch.nodes[2];
    const metaK = k1.paramMeta.cutoff;
    pm.mutator.lanes.length = 0;
    pm.mutator.lanes.push({ id: "L1", target: { nodeId: "k1", paramKey: "cutoff" }, keys: [{ x: 60, offset: 0 }, { x: 84, offset: 0.24 }], discrete: false });
    pm.mutator.snap = false; pm.mutator.autoPin = false; pm.mutator.activeLane = "L1";
    setPlayhead(60);
    const at = () => ctx2.applyNodeGraphParamOffsetsToBase(k1, "cutoff", 0.5, metaK);
    assert(almost(at(), 0.5), "target note C4, nothing heard: the lane at C4");
    ctx2.pitchMutatorPlayheadHeard("pm", 440 * 2 ** ((72 - 69) / 12)); // engine says the smoothed playhead is at C5 (gliding up)
    assert(almost(at(), 0.5), "no live engine: the heard value is not used");
    ctx2.nodeGraphMvp.live = { node: {} };
    assert(almost(at(), 0.62), "live engine: the offset is evaluated at the smoothed playhead (C5), not the target note, got " + at());
    ctx2.pitchMutatorPlayheadHeard("pm", 440 * 2 ** ((84 - 69) / 12));
    assert(almost(at(), 0.74), "and follows the glide to C6");
    ctx2.pitchMutatorPlayheadHeard("pm", -1);
    assert(almost(at(), 0.5), "an engine that reports nothing falls back to the target note");
    // pin placement: the target note, even while the smoothed playhead is elsewhere
    ctx2.pitchMutatorPlayheadHeard("pm", 440 * 2 ** ((84 - 69) / 12));
    ctx2.togglePitchMutatorOverlay(true);
    overlay.handlers.click({ target: { closest: () => ({ getAttribute: (n) => (n === "data-pm" ? "pin" : null) }) } });
    assert(pm.mutator.lanes[0].keys.some((k) => k.x === 60), "Pin lands on the target note (C4) while the smoothed playhead is at C6");
    ctx2.pitchMutatorPlayheadHeard("pm", 0);
    ctx2.nodeGraphMvp.live = undefined;
  }

  // idle again after closing: no requestAnimationFrame left queued by the Mutator
  ctx2.togglePitchMutatorOverlay(false);
  const rafAtClose = rafCalls;
  for (const fn of commitListeners) fn();
  ctx2.sendNodeGraphLiveKeyboardModuleSignal("kb", { frequency: 330, gate: 1 });
  setPlayhead(50);
  assert(rafCalls === rafAtClose, "closed and idle again: no requestAnimationFrame scheduled");
}

// Offsets are signed: shifting keeps negatives (clamped to -1..1, not 0..1)
{
  const s = E.shiftOffsets([{ x: 36, offset: -0.5 }, { x: 60, offset: 0.2 }], -0.2, { min: 0, max: 1 });
  assert(almost(s[0].offset, -0.7) && almost(s[1].offset, 0), "negative offsets survive a shift, got " + JSON.stringify(s));
  const lo = E.shiftOffsets([{ x: 36, offset: -0.9 }], -0.5, { min: 0, max: 1 });
  assert(almost(lo[0].offset, -1), "clamps at -1");
}

console.log("test_pitch_mutator_engine: ok");
