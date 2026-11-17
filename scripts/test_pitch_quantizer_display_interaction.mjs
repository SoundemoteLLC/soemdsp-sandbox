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

console.log("ok  pitch quantizer WebGL face: shared keyboard keys, inverted palette, no rogue DOM");
