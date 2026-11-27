#!/usr/bin/env node
// Stopped-transport paint contract: real key state, paint passes, and mesh
// dirty queue. Drain only event-scheduled frames; no heartbeat or settle timer.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const frames = new Map();
let serial = 0;
let presents = 0;
let miniPresents = 0;
const gridPads = [];
const pianoKeys = [];
const runtimes = new Map();
const gold = new Map();
const chord = { slot: false, on: false, edit: false, note: false, sounding: false };
const ctx = vm.createContext({
  console, Uint8Array,
  document: { querySelectorAll: () => gridPads },
  requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
  nodeGraphGlGraphState: {},
  nodeGraphMvp: { transportPlaying: false },
  nodeGraphMiniPerformShown: () => true,
  nodeGraphGlMiniPerformPresent() { miniPresents += 1; },
  nodeGraphKeyboardNodeIdFromElement: (el) => el.closest(".dsp-node").dataset.node,
  nodeGraphKeyboardRuntime: (id) => runtimes.get(id),
  nodeGraphKeyboardNodeIds: () => [...runtimes.keys()],
  nodeGraphKeyboardHeldPointerSignal: (id) => runtimes.get(id).held || null,
  nodeGraphKeyboardRawMidiFromSignal: (signal) => signal.midi,
  nodeGraphHeldKeysDemux: () => new Uint8Array(128),
  nodeGraphKeyboardArpLatchView: (id) => ({ mask: gold.get(id) }),
  nodeGraphKeyboardOctaveFor: () => 0,
  nodeGraphKeyboardModeForNode: () => "chordMemory",
  nodeGraphChordMemoryMomentaryMaskForNode: () => null,
  noteMaskGet: (mask, midi) => Boolean(mask[midi]),
  renderNodeGraphKeyboardBitmaskDisplay() {},
  setInterval() { throw new Error("No polling"); },
  setTimeout() { throw new Error("No settle timer"); },
});
function loadFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const end = source.indexOf("\nfunction ", start + 1);
  vm.runInContext(source.slice(start, end < 0 ? undefined : end), ctx);
}
vm.runInContext(read("public/lib/visual/piano-keys-draw.js"), ctx);
vm.runInContext(read("public/modules/keyboardController/keyboard-face-gl.js"), ctx);
vm.runInContext(read("public/modules/gridKeyboard/grid-keyboard.js"), ctx);
vm.runInContext(read("public/node-graph-keyboard-chord-memory.js"), ctx);
const graph = read("public/node-graph-gl-graph.js");
for (const name of ["nodeGraphGlGraphNodeIdFromEl", "nodeGraphGlGraphNoteValueChrome", "nodeGraphGlGraphTakeValueChromeDirty"]) loadFunction(graph, name);
const view = read("public/node-graph-view-controls.js");
for (const name of ["renderNodeGraphKeyboardHeldKeys", "renderNodeGraphKeyboardActiveKeys"]) loadFunction(view, name);
ctx.nodeGraphKeyboardAllKeys = (face) => face ? face.keys : pianoKeys;
ctx.nodeGraphKeyboardFaces = (id) => [{ classList: { contains: () => true }, keys: pianoKeys.filter((k) => k.surface.owner === id) }];
ctx.nodeGraphChordMemoryNodeIdFromElement = ctx.nodeGraphKeyboardNodeIdFromElement;
ctx.nodeGraphChordMemoryHasSlot = () => chord.slot;
ctx.nodeGraphChordMemorySlotIsOn = () => chord.on;
ctx.nodeGraphChordMemoryEditIs = () => chord.edit;
ctx.nodeGraphChordMemoryNoteIsEdit = () => chord.note;
ctx.nodeGraphChordMemoryNoteIsSounding = () => chord.sounding;
ctx.nodeGraphKeyboardPresentFaceCanvases = () => {};

const cached = new Map();
// Model the renderer's existing dirty-plate replay contract, not a new painter.
ctx.nodeGraphGlGraphPresentSoon = () => {
  presents += 1;
  for (const id of ctx.nodeGraphGlGraphTakeValueChromeDirty()) {
    const key = pianoKeys.find((k) => k.surface.owner === id);
    cached.set(id, key ? JSON.stringify(ctx.nodeGraphKeyboardKeyPaint(key, false)) : gridPads[0].className);
  }
};
function drain() {
  const scheduled = [...frames.values()];
  frames.clear();
  for (const fn of scheduled) fn();
  assert.equal(frames.size, 0, "paint must stop without a heartbeat");
}
function surface(owner) {
  return { owner, dataset: { gridOctave: "0" }, closest: () => ({ dataset: { node: owner } }) };
}
for (const id of ["pianoA", "pianoB", "grid"]) {
  runtimes.set(id, { signal: null });
  gold.set(id, new Uint8Array(128));
}
for (const id of ["pianoA", "pianoB"]) {
  const s = surface(id);
  ctx.surfaceForState = s;
  const state = vm.runInContext("new NodeGraphMidiKeyState(surfaceForState)", ctx);
  pianoKeys.push({ surface: s, midi: 60, black: false, state });
}
const padState = new Set();
const pad = {
  ...surface("grid"), dataset: { gridMidi: "60" },
  get className() { return [...padState].join(" "); },
  classList: {
    toggle(name, on) { if (on) padState.add(name); else padState.delete(name); },
    remove(name) { padState.delete(name); },
  },
};
const grid = surface("grid");
grid.querySelectorAll = () => [pad];
ctx.document.querySelectorAll = (selector) => selector === ".node-grid-keyboard-surface" ? [grid] : selector.includes("node-grid-keyboard-pad") ? [pad] : [];
gridPads.push(pad);

ctx.renderNodeGraphKeyboardActiveKeys();
drain();
assert.equal(presents, 0, "unchanged idle keys schedule nothing");
for (const id of ["pianoA", "pianoB"]) runtimes.get(id).signal = { midi: 60, gate: 1 };
ctx.renderNodeGraphKeyboardActiveKeys();
assert.equal(frames.size, 1, "two keyboard events coalesce");
drain();
assert.equal(cached.size, 2, "both owners dirty even when the frame is already queued");
const blue = cached.get("pianoA");
runtimes.get("pianoA").signal = null;
runtimes.get("pianoA").held = { midi: 60, gate: 1 };
ctx.renderNodeGraphKeyboardActiveKeys("pianoA");
assert.equal(frames.size, 0, "Shift sustain keeps the same blue without redundant paint");
runtimes.get("pianoA").held = null;
ctx.renderNodeGraphKeyboardActiveKeys("pianoA");
drain();
assert.notEqual(cached.get("pianoA"), blue, "release clears cached blue while stopped");
gold.get("pianoA")[60] = 1;
gold.get("grid")[60] = 1;
ctx.renderNodeGraphKeyboardHeldKeys();
drain();
assert.notEqual(cached.get("pianoA"), blue, "Ctrl latch repaints gold");
assert.match(cached.get("grid"), /held/, "Grid gold changes reach cached replay");
gold.get("pianoA")[60] = 0;
gold.get("grid")[60] = 0;
ctx.renderNodeGraphKeyboardHeldKeys();
drain();
assert.doesNotMatch(cached.get("grid"), /held/, "Grid unlatch clears cached gold");
runtimes.get("grid").signal = { midi: 60, gate: 1 };
ctx.renderNodeGraphGridKeyboardPads();
drain();
assert.match(cached.get("grid"), /active/, "Grid press repaints while stopped");
runtimes.get("grid").signal = null;
ctx.renderNodeGraphGridKeyboardPads();
drain();
assert.doesNotMatch(cached.get("grid"), /active/, "Grid release repaints while stopped");
for (const field of Object.keys(chord)) {
  chord[field] = true;
  ctx.nodeGraphChordMemoryPaintKeys();
  assert.equal(frames.size, field === "sounding" ? 0 : 1, `${field} respects edit-note precedence`);
  drain();
}
assert.match(cached.get("grid"), /chord-memory/);
assert.match(cached.get("grid"), /slot-on/);
assert.match(cached.get("grid"), /slot-edit/);
assert.match(cached.get("grid"), /chord-edit-note/);
chord.note = false;
ctx.nodeGraphChordMemoryPaintKeys();
drain();
assert.match(cached.get("grid"), /ghost-chord/, "sounding ghost appears when edit highlight clears");
for (const field of Object.keys(chord)) chord[field] = false;
ctx.nodeGraphChordMemoryPaintKeys();
drain();
assert.equal(cached.get("grid"), "", "chord clear reaches cached replay");
const before = presents;
ctx.renderNodeGraphKeyboardHeldKeys();
ctx.renderNodeGraphKeyboardActiveKeys();
ctx.nodeGraphChordMemoryPaintKeys();
drain();
assert.equal(presents, before, "unchanged render passes stay asleep");
assert.equal(miniPresents, presents, "mini performance receives each coalesced paint");
assert.equal(ctx.nodeGraphMvp.transportPlaying, false);
console.log("ok  stopped keyboard/Grid/chord-memory changes dirty owning plates; events coalesce and idle paint stops");

// The same retained Grid rectangles drive draw and hit, including scaled
// surfaces, empty cells, and gaps. Colors must come from the piano painter.
ctx.getComputedStyle = () => ({ columnGap: "2px", rowGap: "2px" });
Object.assign(grid, {
  clientWidth: 240,
  clientHeight: 220,
  getBoundingClientRect: () => ({ left: 100, top: 50, width: 480, height: 440 }),
});
pad.dataset.gridCol = "0";
pad.dataset.gridRow = "0";
pad.textContent = "C3";
pad.classList.contains = (name) => padState.has(name);
const model = ctx.nodeGraphGridKeyboardLayoutKeyRects(grid);
assert.equal(model.keys.length, 1);
const rect = model.keys[0];
const hitX = 100 + (rect.x + rect.w / 2) * 2;
const hitY = 50 + (rect.y + rect.h / 2) * 2;
assert.equal(ctx.nodeGraphGridKeyboardKeyAtClient(grid, hitX, hitY), pad, "Grid scaled draw rect is hit");
assert.equal(ctx.nodeGraphGridKeyboardKeyAtClient(grid, 100 + (rect.x + rect.w + 1) * 2, hitY), null, "Grid gap is not a pad");
assert.equal(ctx.nodeGraphGridKeyboardKeyAtClient(grid, 99, hitY), null, "outside Grid is not a pad");
assert.equal(ctx.nodeGraphGridKeyboardKeyAtClient(grid, hitX, 51), null, "empty Grid cells are not pads");
const draws = [];
ctx.nodeGraphGlLinesRoundRect = (_batch, x, y, w, h, paint) => draws.push({ x, y, w, h, paint });
ctx.nodeGraphGlLinesText = () => {};
for (const state of ["active", "held", "chord-memory", "slot-edit", "chord-edit-note", "ghost-play", "ghost-chord"]) {
  padState.clear();
  padState.add(state);
  draws.length = 0;
  ctx.nodeGraphGridKeyboardGlDraw({}, grid, 100, 50, 480, 440);
  assert.equal(draws.length, 2, "Grid draws bed plus one pad, no DOM/C2D fallback");
  const draw = draws[1];
  assert.equal(draw.x + draw.w / 2, hitX);
  assert.equal(draw.y + draw.h / 2, hitY);
  const expected = ctx.nodeGraphGridKeyboardKeyPaint(model.keys[0]);
  assert.deepEqual(draw.paint.fill, expected.top, `${state} shares piano top color`);
  assert.deepEqual(draw.paint.fillBottom, expected.bottom, `${state} shares piano bottom color`);
  if (state !== "ghost-chord" && state !== "ghost-play") {
    assert.deepEqual(draw.paint.fill, ctx.nodeGraphKeyboardKeyPaint(model.keys[0], true).top, `${state} matches piano highlight`);
  }
}
for (const name of ["nodeGraphGlHitInside", "nodeGraphGlHitCovered", "nodeGraphGlHitRetarget"]) loadFunction(graph, name);
ctx.nodeGraphGlGraphState.chrome = { keyboards: [{ id: "grid", surface: grid, x: 10, y: 20, w: 240, h: 220, draw: ctx.nodeGraphGridKeyboardGlDraw }] };
ctx.nodeGraphGlGraphState.plates = [{ id: "grid", x: 10, y: 20, w: 240, h: 220 }];
const routed = [];
ctx.updateNodeGraphGridKeyboardSignal = (event) => routed.push({ target: event.currentTarget, pointerId: event.pointerId });
grid.setPointerCapture = (id) => routed.push({ captured: id });
const event = { pointerId: 7, preventDefault() {}, stopPropagation() {} };
assert.equal(ctx.nodeGraphGridKeyboardGlPointerDown(event, { x: 30, y: 40 }), true);
assert.equal(routed[0].captured, 7, "real surface owns subsequent pointer events");
assert.equal(routed[1].target, grid);
ctx.nodeGraphGlGraphState.plates.push({ id: "front", x: 10, y: 20, w: 240, h: 220 });
routed.length = 0;
assert.equal(ctx.nodeGraphGridKeyboardGlPointerDown(event, { x: 30, y: 40 }), false, "front module blocks Grid hits");
assert.equal(routed.length, 0, "covered Grid never captures the pointer");
assert.equal(ctx.nodeGraphGridKeyboardGlPointerDown(event, { x: 0, y: 0 }), false);
console.log("ok  Grid GL/hit geometry, shared palette, capture routing, gaps, and module occlusion");
