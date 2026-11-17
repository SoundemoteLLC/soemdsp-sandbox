#!/usr/bin/env node
// Pitch Quantizer display is a WebGL face that shares Keyboard key geometry
// and gradient drawing (inverted palette, dark naturals / light sharps).
// Pointer hit-test shares layout with the draw path; toggle still edits the
// scale mask. Seams must not show through sharp keys.
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

const shared = read("public/lib/visual/piano-keys-draw.js");
const ui = read("public/modules/pitchQuantizer/pitch-quantizer-ui.js");
const css = read("public/modules/pitchQuantizer/pitch-quantizer-ui.css");
const defs = read("public/node-graph-module-definitions.js");
const rendering = read("public/node-graph-module-rendering.js");
const keyboard = read("public/modules/keyboardController/keyboard-face-gl.js");

assert(
  /displayType:\s*"pitchQuantizerFace"/.test(defs),
  "pitchQuantizer must declare displayType pitchQuantizerFace",
);
assert(
  /registerNodeGraphModuleFaceCreator\(\s*"pitchQuantizerFace"/.test(ui),
  "face must register on the WebGL display-type creator map",
);
assert(
  /nodeGraphDisplayCanvasCreate\(/.test(ui) && /nodeGraphGlLinesBegin\(/.test(ui),
  "face must draw through the shared display-canvas + gl-lines path",
);
assert(
  /nodeGraphPianoKeysComputeRects\(/.test(ui) && /nodeGraphPianoKeysDraw\(/.test(ui),
  "Pitch Quantizer must use the shared piano-keys helper, not a bespoke key draw",
);
assert(
  /nodeGraphPianoKeysComputeRects\(/.test(keyboard) && /nodeGraphPianoKeysDraw\(/.test(keyboard),
  "Keyboard face must use the same shared piano-keys helper",
);
assert(
  !/createElement\("button"\)/.test(ui),
  "old DOM key buttons must be gone",
);
assert(
  !/radial-gradient/.test(ui) && !/radial-gradient/.test(css) && !/radial-gradient/.test(shared),
  "radial gradients must be gone from the face",
);
assert(
  !/\.title\s*=/.test(ui) && !/root\.title/.test(ui),
  "face must not set hover title text",
);
assert(
  !/definition\.layout === "pitchQuantizer"/.test(rendering),
  "module rendering must not still special-case the rogue DOM face branch",
);
assert(
  /event\.stopPropagation\(\)/.test(ui) && /onPointerDown/.test(ui),
  "pointer path must stopPropagation so module drag does not swallow key hits",
);

const ops = [];
const ctx = {
  console,
  Object,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Map,
  Set,
  document: undefined,
  ResizeObserver: undefined,
  IntersectionObserver: undefined,
  nodeGraphGlLinesRoundRect(batch, x, y, w, h, spec = {}) {
    ops.push({ op: "roundRect", x, y, w, h, spec, black: Boolean(spec && spec.radiusTop === 0 && (spec.radius || 0) > 0) });
  },
  nodeGraphGlLinesRect() {},
  nodeGraphGlLinesText() {},
  nodeGraphPitchQuantizerWhiteClasses: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
  nodeGraphPitchQuantizerBlackKeys: Object.freeze([
    { pitchClass: 1, afterWhite: 0 },
    { pitchClass: 3, afterWhite: 1 },
    { pitchClass: 6, afterWhite: 3 },
    { pitchClass: 8, afterWhite: 4 },
    { pitchClass: 10, afterWhite: 5 },
  ]),
  nodeGraphPitchQuantizerNoteNames: Object.freeze(
    ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
  ),
  nodeGraphPitchQuantizerMaskHasClass: (mask, pc) => Boolean((Number(mask) >> (((pc % 12) + 12) % 12)) & 1),
  nodeGraphModuleScopeCustomRenderers: {},
  registerNodeGraphModuleFaceCreator: () => {},
};

vm.createContext(ctx);
vm.runInContext(shared, ctx, { filename: "piano-keys-draw.js" });
vm.runInContext(ui, ctx, { filename: "pitch-quantizer-ui.js" });

const look = ctx.NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
assert(look, "palette is exported");
const lum = (rgba) => 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];
assert(lum(look.naturalFill) < lum(look.sharpFill), "natural keys are darker than sharp keys");
assert(lum(look.naturalTop) < lum(look.sharpTop), "inverted natural gradient tops stay darker than sharp tops");
assert(lum(look.electric) > lum(look.naturalFill), "electric accent is brighter than a dark natural pad");
assert(look.glow[3] > 0 && look.glow[3] < 1, "enabled notes use a flat translucent glow, not a radial wash");
assert(look.naturalTop && look.naturalBottom && look.sharpTop && look.sharpBottom, "keys use a top/bottom gradient, like the Keyboard");

const layout = ctx.nodeGraphPitchQuantizerKeyLayout(280, 100);
assert(layout.keys.length === 12, "layout has 12 pitch-class keys");
assert(layout.keys.filter((k) => !k.black).length === 7, "7 natural keys");
assert(layout.keys.filter((k) => k.black).length === 5, "5 sharp keys");
const cSharp = layout.keys.find((k) => k.pc === 1);
const c = layout.keys.find((k) => k.pc === 0);
assert(c && cSharp && cSharp.h < c.h, "sharps are shorter than naturals");
assert(cSharp.y === c.y, "sharps start at the top of the bed");
// Keyboard centers a sharp on the C/D joint.
const joint = c.x + c.w;
assert(
  Math.abs((cSharp.x + cSharp.w * 0.5) - joint) < 0.01,
  "sharps are centered on the natural-key joint, like the Keyboard",
);

const midSharp = ctx.nodeGraphPitchQuantizerKeyAt(
  layout,
  cSharp.x + cSharp.w * 0.5,
  cSharp.y + cSharp.h * 0.5,
);
assert(midSharp && midSharp.pc === 1, "hit test prefers the overlapping sharp");

// Sharp is centered on the C/D joint, so the mid-x of C# is the boundary;
// pick a point in the left half of C# (still on C's front lip).
const frontLip = ctx.nodeGraphPitchQuantizerKeyAt(
  layout,
  cSharp.x + cSharp.w * 0.25,
  c.y + c.h * 0.85,
);
assert(frontLip && frontLip.pc === 0, "the natural front lip remains hittable under a sharp");

const miss = ctx.nodeGraphPitchQuantizerKeyAt(layout, -8, -8);
assert(miss === null, "outside the keyboard is not a key");

assert(typeof ctx.nodeGraphPitchQuantizerSeamRects === "function", "seam rects are exported");
const seams = ctx.nodeGraphPitchQuantizerSeamRects(layout);
assert(seams.length === 6, "one seam at each of the 6 natural-key joints");
const sharps = layout.keys.filter((k) => k.black);
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
for (const seam of seams) {
  for (const sharp of sharps) {
    assert(!overlaps(seam, sharp), "visible natural seam must not cross a sharp key rect");
  }
}
const tall = [...seams].sort((a, b) => b.h - a.h)[0];
assert(
  seams.filter((s) => Math.abs(s.h - tall.h) < 0.5).length === 1,
  "only the E-F joint (no sharp) runs the full exposed natural height",
);
for (const sharp of sharps) {
  const lip = seams.filter((s) => s.x < sharp.x + sharp.w && s.x + s.w > sharp.x);
  assert(lip.length === 1, "each sharp has one seam in the lip below it");
  assert(lip[0].y >= sharp.y + sharp.h, "seam starts at or below the sharp bottom edge");
}

ops.length = 0;
const C_MAJOR = (1 << 0) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9) | (1 << 11);
ctx.nodeGraphPitchQuantizerGlDrawKeys({}, layout, C_MAJOR, false, 1);
const keyFills = ops.filter((o) => o.op === "roundRect" && o.spec && o.spec.fillBottom);
assert(keyFills.length >= 12, "each key is a vertical gradient (fill + fillBottom), like the Keyboard");
const sharpFills = ops.filter((o) => o.black);
assert(sharpFills.length === 5, "five sharps with rounded bottoms (radiusTop 0)");
for (const o of sharpFills) {
  assert((o.spec.fill[3] ?? 1) === 1, "sharp fills are fully opaque so seams cannot show through");
}
const firstSharp = ops.findIndex((o) => o.black);
const lastSeam = (() => {
  let idx = -1;
  ops.forEach((o, i) => {
    if (o.op === "roundRect" && o.spec && o.spec.feather === 0.5 && o.spec.radius === 0) idx = i;
  });
  return idx;
})();
assert(lastSeam >= 0 && firstSharp > lastSeam, "natural seams are drawn before the opaque sharps");

assert(
  /function nodeGraphPianoKeysPaint/.test(shared),
  "shared helper must own the key-state paint path",
);
assert(
  /nodeGraphPianoKeysPaint\(NODE_GRAPH_MIDI_KEY_LOOK/.test(keyboard),
  "Keyboard KeyPaint must be a thin wrapper around the shared state-paint path",
);
assert(
  /nodeGraphPianoKeysPaint\(look/.test(ui) && /nodeGraphPianoKeysFlagState/.test(ui),
  "Pitch Quantizer KeyPaint must use the shared state-paint path, not a bespoke highlight",
);
assert(
  /nodeGraphModuleScopeLatestOutputValue/.test(ui) && /scopePaintIsEnginePlaying/.test(ui),
  "live class must come from the module scope output + play gate",
);
assert(
  !/requestMIDIAccess|MIDIAccess|midiKeyboard|renderNodeGraphKeyboardActiveKeys|WebMidi/.test(ui),
  "Pitch Quantizer must not touch MIDI; only MIDI modules do that",
);

ctx._playing = false;
ctx._pitch = 64;
ctx.scopePaintIsEnginePlaying = () => Boolean(ctx._playing);
ctx.nodeGraphModuleScopeLatestOutputValue = (id, port, fallback) => {
  if (port !== "pitch") return fallback;
  return ctx._pitch;
};

assert(
  ctx.nodeGraphPitchQuantizerLivePitchClass("pq1") === null,
  "live highlight clears when the engine is stopped, even if a stale pitch is buffered",
);
ctx._playing = true;
assert(ctx.nodeGraphPitchQuantizerLivePitchClass("pq1") === 4, "MIDI-like 64 (E) maps to pitch class 4");
ctx._pitch = 60;
assert(ctx.nodeGraphPitchQuantizerLivePitchClass("pq1") === 0, "60 (C) maps to class 0");
ctx._pitch = 72.4;
assert(ctx.nodeGraphPitchQuantizerLivePitchClass("pq1") === 0, "rounded 72 maps to class 0");
ctx._pitch = 59.6;
assert(ctx.nodeGraphPitchQuantizerLivePitchClass("pq1") === 0, "rounded 60 maps to class 0");
ctx._pitch = Number.NaN;
assert(ctx.nodeGraphPitchQuantizerLivePitchClass("pq1") === null, "non-finite pitch is not a live class");
ctx._playing = false;
ctx._pitch = 67;
assert(ctx.nodeGraphPitchQuantizerLivePitchClass("pq1") === null, "stopped play gate wins over a finite pitch");

let paintCalls = 0;
const origPaint = ctx.nodeGraphPianoKeysPaint;
ctx.nodeGraphPianoKeysPaint = function wrappedPaint(...args) {
  paintCalls += 1;
  return origPaint.apply(this, args);
};
const cPaint = ctx.nodeGraphPitchQuantizerKeyPaint(c, 0, 0);
assert(paintCalls > 0, "PQ KeyPaint must call the shared nodeGraphPianoKeysPaint");
ctx.nodeGraphPianoKeysPaint = origPaint;

const paint = (key, mask, livePc) => ctx.nodeGraphPitchQuantizerKeyPaint(key, mask, livePc);
const idleC = paint(c, 0, null);
const liveC = paint(c, 0, 0);
const enC = paint(c, C_MAJOR, null);
const enLiveC = paint(c, C_MAJOR, 0);
assert(lum(liveC.top) < lum(idleC.top) && lum(liveC.bottom) < lum(idleC.bottom), "live natural is darker than idle (inverted Keyboard highlight)");
assert(liveC.stroke > 0, "live natural gets a dark ring");
assert(idleC.stroke === 0, "idle natural has no ring");
assert(lum(enLiveC.top) < lum(enC.top) && lum(enLiveC.bottom) < lum(enC.bottom), "live enabled natural is darker than enabled-only teal");
assert(enC.stroke > 0 && enLiveC.stroke > 0, "enabled teal and live-on both keep a ring");
assert(
  JSON.stringify(enC.strokeRgba) !== JSON.stringify(enLiveC.strokeRgba),
  "live ring is visually distinct from the enabled teal stroke",
);
const tealBias = (p) => p.top[1] - p.top[0];
assert(tealBias(enC) > tealBias(idleC), "enabled-only natural still reads teal against idle");
assert(tealBias(enLiveC) > tealBias(liveC), "live+enabled still reads teal against a live-but-out-of-scale natural");
assert(
  JSON.stringify(paint(c, C_MAJOR, 4)) === JSON.stringify(enC),
  "a live class on another key does not restyle this enabled natural",
);

const idleCs = paint(cSharp, 0, null);
const liveCs = paint(cSharp, 0, 1);
assert(lum(liveCs.top) < lum(idleCs.top) && lum(liveCs.bottom) < lum(idleCs.bottom), "live sharp is darker than its light idle pad");
assert(liveCs.stroke > 0, "live sharp keeps a dark ring");
assert(
  JSON.stringify(paint(cSharp, 0, 0)) === JSON.stringify(idleCs),
  "a live natural does not darken a neighboring sharp",
);

console.log("ok  pitch quantizer WebGL face: shared keyboard keys, inverted palette, live key-on, no rogue DOM");
