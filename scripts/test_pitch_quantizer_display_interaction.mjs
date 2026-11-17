#!/usr/bin/env node
// Pitch Quantizer display is a WebGL face: inverted (dark natural / light
// sharp) keys, no radial-gradient rogue DOM keyboard, pointer hit-test
// shares layout with the draw path, toggle still edits the scale mask.
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

const ui = read("public/modules/pitchQuantizer/pitch-quantizer-ui.js");
const css = read("public/modules/pitchQuantizer/pitch-quantizer-ui.css");
const defs = read("public/node-graph-module-definitions.js");
const rendering = read("public/node-graph-module-rendering.js");

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
  !/createElement\("button"\)/.test(ui),
  "old DOM key buttons must be gone",
);
assert(
  !/radial-gradient/.test(ui) && !/radial-gradient/.test(css),
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

const ctx = {
  console,
  Object,
  Math,
  Number,
  String,
  Boolean,
  Array,
  document: undefined,
  ResizeObserver: undefined,
  IntersectionObserver: undefined,
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
vm.runInContext(ui, ctx, { filename: "pitch-quantizer-ui.js" });

const look = ctx.NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
assert(look, "palette is exported");
const lum = (rgba) => 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];
assert(lum(look.naturalFill) < lum(look.sharpFill), "natural keys are darker than sharp keys");
assert(lum(look.electric) > lum(look.naturalFill), "electric accent is brighter than a dark natural pad");
assert(look.glow[3] > 0 && look.glow[3] < 1, "enabled notes use a flat translucent glow, not a radial wash");

const layout = ctx.nodeGraphPitchQuantizerKeyLayout(280, 100, 4);
assert(layout.keys.length === 12, "layout has 12 pitch-class keys");
assert(layout.keys.filter((k) => !k.black).length === 7, "7 natural keys");
assert(layout.keys.filter((k) => k.black).length === 5, "5 sharp keys");
const cSharp = layout.keys.find((k) => k.pc === 1);
const c = layout.keys.find((k) => k.pc === 0);
assert(c && cSharp && cSharp.h < c.h, "sharps are shorter than naturals");
assert(cSharp.y === c.y, "sharps start at the top of the bed");

// A point on a sharp must not fall through to the natural underneath.
const midSharp = ctx.nodeGraphPitchQuantizerKeyAt(
  layout,
  cSharp.x + cSharp.w * 0.5,
  cSharp.y + cSharp.h * 0.5,
);
assert(midSharp && midSharp.pc === 1, "hit test prefers the overlapping sharp");

const frontLip = ctx.nodeGraphPitchQuantizerKeyAt(
  layout,
  cSharp.x + cSharp.w * 0.5,
  c.y + c.h * 0.85,
);
assert(frontLip && frontLip.pc === 0, "the natural front lip remains hittable under a sharp");

const miss = ctx.nodeGraphPitchQuantizerKeyAt(layout, -8, -8);
assert(miss === null, "outside the keyboard is not a key");

assert(typeof ctx.nodeGraphPitchQuantizerSeamRects === "function", "seam rects are exported");
const stroke = 1;
const seams = ctx.nodeGraphPitchQuantizerSeamRects(layout, stroke);
assert(seams.length === 6, "one seam at each of the 6 natural-key joints");
const sharps = layout.keys.filter((k) => k.black);
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
for (const seam of seams) {
  for (const sharp of sharps) {
    assert(!overlaps(seam, sharp), "natural seam must not cross a sharp key rect");
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
assert(
  /nodeGraphPitchQuantizerSeamRects\(layout, stroke\)/.test(ui),
  "draw path must paint the clipped seam rects, not a full-height raw trace",
);

console.log("ok  pitch quantizer WebGL face: inverted keys, shared hit layout, no rogue DOM");
