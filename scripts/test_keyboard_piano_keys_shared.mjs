#!/usr/bin/env node
// Keyboard face draw/layout must stay pixel-identical after moving geometry
// and gradients into public/lib/visual/piano-keys-draw.js. The golden was
// captured from keyboard-face-gl.js immediately before that extract.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const sharedSrc = read("public/lib/visual/piano-keys-draw.js");
const keyboardSrc = read("public/modules/keyboardController/keyboard-face-gl.js");
const pqSrc = read("public/modules/pitchQuantizer/pitch-quantizer-ui.js");

assert(
  /nodeGraphPianoKeysComputeRects\(/.test(keyboardSrc) && /nodeGraphPianoKeysDraw\(/.test(keyboardSrc),
  "Keyboard face must call the shared piano-keys helper for layout and draw",
);
assert(
  /nodeGraphPianoKeysComputeRects\(/.test(pqSrc) && /nodeGraphPianoKeysDraw\(/.test(pqSrc),
  "Pitch Quantizer face must call the shared piano-keys helper for layout and draw",
);

function makeState(initial = []) {
  const on = new Set(initial);
  return {
    _on: on,
    contains: (name) => on.has(name),
    add: (name) => on.add(name),
    remove: (name) => on.delete(name),
  };
}

function makeOctaveSurface() {
  const whitesMidi = [60, 62, 64, 65, 67, 69, 71];
  const whitesLabels = ["C", "D", "E", "F", "G", "A", "B"];
  const blacks = [
    { midi: 61, leftWhiteIndex: 0, label: "C#" },
    { midi: 63, leftWhiteIndex: 1, label: "D#" },
    { midi: 66, leftWhiteIndex: 3, label: "F#" },
    { midi: 68, leftWhiteIndex: 4, label: "G#" },
    { midi: 70, leftWhiteIndex: 5, label: "A#" },
  ];
  const surface = { dataset: { keyLabelSize: "100" } };
  const whiteKeys = whitesMidi.map((midi, index) => ({
    surface, midi, index, black: false, leftWhiteIndex: -1,
    label: whitesLabels[index], aria: "",
    state: makeState(midi === 65 ? ["held"] : midi === 60 ? ["active"] : []),
  }));
  const blackKeys = blacks.map((src, i) => ({
    surface, midi: src.midi, index: 100 + i, black: true, leftWhiteIndex: src.leftWhiteIndex,
    label: src.label, aria: "",
    state: makeState(src.midi === 66 ? ["active"] : []),
  }));
  const keys = [...whiteKeys, ...blackKeys];
  surface._midiKeyModel = {
    sig: "60:12",
    start: 60,
    count: 12,
    keys,
    whites: whiteKeys,
    blacks: blackKeys,
    byMidi: new Map(keys.map((k) => [k.midi, k])),
    totalWhite: 7,
    leadPad: 0,
    trailPad: 0,
    totalUnits: 7,
    labels: "name",
    geom: null,
  };
  return surface;
}

function roundDeep(value) {
  if (typeof value === "number") return Number(value.toFixed(8));
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = roundDeep(value[k]);
    return out;
  }
  return value;
}

const ops = [];
const ctx = {
  console,
  Object, Math, Number, String, Boolean, Array, Map, Set,
  requestAnimationFrame: () => 0,
  document: undefined,
  nodeGraphGlLinesRoundRect(batch, x, y, w, h, spec = {}) {
    ops.push(roundDeep({ op: "roundRect", x, y, w, h, spec }));
  },
  nodeGraphGlLinesText(batch, text, x, y, opts) {
    ops.push(roundDeep({ op: "text", text, x, y, opts: { ...opts } }));
  },
  nodeGraphGlGraphTextOpts: (o) => o,
  nodeGraphGlGraphPresentSoon() {},
  nodeGraphGlGraphRebuildChrome() {},
  nodeGraphMiniPerformShown: () => false,
};

vm.createContext(ctx);
vm.runInContext(sharedSrc, ctx, { filename: "piano-keys-draw.js" });
vm.runInContext(keyboardSrc, ctx, { filename: "keyboard-face-gl.js" });

const fixtures = [];
function runFixture(name, layout, dest) {
  ops.length = 0;
  const surface = makeOctaveSurface();
  ctx.nodeGraphKeyboardLayoutKeyRects(surface, layout);
  const geom = surface._midiKeyModel.geom;
  const rects = [];
  for (const key of surface._midiKeyModel.keys) {
    const r = geom.rects.get(key);
    if (r) rects.push(roundDeep({ midi: key.midi, black: key.black, ...r }));
  }
  ctx.nodeGraphKeyboardGlDraw(ctx, surface, dest.x, dest.y, dest.w, dest.h);
  fixtures.push({
    name, layout, dest,
    geom: roundDeep({ w: geom.w, h: geom.h, inset: geom.inset, inModuleFace: geom.inModuleFace, sig: geom.sig }),
    rects,
    ops: ops.slice(),
  });
}

runFixture("module-face-1x", {
  width: 280, height: 100, inModuleFace: true, whiteW: 16, blackW: 10, blackH: 0, blackKeyHeight: 62,
}, { x: 0, y: 0, w: 280, h: 100 });

runFixture("loose-scaled", {
  width: 400, height: 140, inModuleFace: false, whiteW: 16, blackW: 10, blackH: 80, blackKeyHeight: 62,
}, { x: 10, y: 20, w: 200, h: 70 });

const golden = JSON.parse(read("scripts/fixtures/keyboard-face-gl-draw-ops.json"));
assert(fixtures.length === golden.length, "fixture count");
for (let i = 0; i < fixtures.length; i += 1) {
  const actual = JSON.stringify(fixtures[i]);
  const expected = JSON.stringify(golden[i]);
  assert(actual === expected, "keyboard draw/layout ops must match the pre-extract golden for " + fixtures[i].name);
}

console.log("ok  keyboard piano-keys helper is shared and pixel-identical to the pre-extract golden");
