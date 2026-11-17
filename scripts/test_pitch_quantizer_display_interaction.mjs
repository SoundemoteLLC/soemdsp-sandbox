#!/usr/bin/env node
// Pitch Quantizer display is a WebGL face that shares Keyboard key geometry
// and gradient drawing. Base keys swap the Keyboard unlit palette (dark
// naturals / cream sharps). Bright colors are reserved for enabled (teal)
// and playing (gold) states. Pointer hit-test shares layout with the draw
// path; toggle still edits the scale mask and must not select the module.
// Seams must not show through sharp keys. Key tops are flush with the
// display edge; labels nearly fill each key's width.
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
assert(
  /stopImmediatePropagation/.test(ui)
    && /addEventListener\(\s*"pointerdown"\s*,\s*onPointerDown\s*,\s*true\s*\)/.test(ui),
  "key pointerdown must capture-phase swallow like the Vactrol legend hit layer",
);
assert(
  /function nodeGraphPitchQuantizerArmNativeHits/.test(ui)
    && /nodeGraphGlHitKeepsNativeTarget/.test(ui)
    && /closest\(\s*["']\.node-pitch-quantizer-face["']\s*\)/.test(ui),
  "must wrap the GL keep-native hook so plate clicks on this face are not module drags",
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
assert(layout.inset === 0, "flushEdge layout has no bed inset");
assert(
  layout.keys.every((k) => k.y === 0),
  "natural and sharp tops are flush with the display top edge",
);
const defaultGeom = ctx.nodeGraphPianoKeysComputeRects({
  width: 280,
  height: 100,
  inModuleFace: true,
  whiteW: 16,
  blackW: 10,
  blackH: 0,
  blackKeyHeight: 62,
  totalUnits: 7,
  leadPad: 0,
  whites: [0, 2, 4, 5, 7, 9, 11],
  blacks: [0, 1, 3, 4, 5].map((leftWhiteIndex) => ({ leftWhiteIndex })),
});
assert(
  defaultGeom.inset === 280 * ctx.NODE_GRAPH_PIANO_KEYS_INSET_FRAC
    && defaultGeom.whites[0].y === defaultGeom.inset
    && defaultGeom.blacks[0].y === defaultGeom.inset,
  "Keyboard default ComputeRects (no flushEdge) keeps the golden inset",
);
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

const paint = (key, mask, livePc, settings) => ctx.nodeGraphPitchQuantizerKeyPaint(key, mask, livePc, settings);
const idleC = paint(c, 0, null);
const liveC = paint(c, 0, 0);
const enC = paint(c, C_MAJOR, null);
const enLiveC = paint(c, C_MAJOR, 0);
assert(
  lum(liveC.top) > lum(idleC.top),
  "playing natural is a bright highlight, brighter than the unlit dark natural",
);
assert(liveC.stroke > 0, "playing natural keeps a bright inset ring");
assert(
  lum(enLiveC.top) !== lum(enC.top)
    && Math.hypot(enLiveC.top[0] - liveC.top[0], enLiveC.top[1] - liveC.top[1], enLiveC.top[2] - liveC.top[2]) < 0.08,
  "enabled+playing fill is the playing accent, not the enabled teal plate",
);
assert(enC.stroke > 0 && enLiveC.stroke > 0, "enabled teal and playing both keep a ring");
assert(
  JSON.stringify(enLiveC.strokeRgba) !== JSON.stringify(liveC.strokeRgba),
  "enabled+playing stroke stays teal, distinct from disabled+playing",
);
const tealBias = (p) => p.top[1] - p.top[0];
assert(tealBias(enC) > tealBias(idleC), "enabled-only natural still reads teal against idle");
const playVsEnabled = Math.hypot(liveC.top[0] - enC.top[0], liveC.top[1] - enC.top[1], liveC.top[2] - enC.top[2]);
assert(playVsEnabled >= 0.4, "playing gold is color-distinct from enabled teal");
assert(tealBias(enC) > tealBias(enLiveC), "playing fill on an enabled key is not the teal plate");
assert(
  JSON.stringify(paint(c, C_MAJOR, 4)) === JSON.stringify(enC),
  "a live class on another key does not restyle this enabled natural",
);

const idleCs = paint(cSharp, 0, null);
const liveCs = paint(cSharp, 0, 1);
assert(liveCs.stroke > 0, "playing sharp keeps a highlight ring");
assert(
  Math.hypot(liveCs.top[0] - liveC.top[0], liveCs.top[1] - liveC.top[1], liveCs.top[2] - liveC.top[2]) < 0.08,
  "playing sharp uses the same bright playing fill as a playing natural",
);
assert(
  JSON.stringify(paint(cSharp, 0, 0)) === JSON.stringify(idleCs),
  "a live natural does not restyle a neighboring sharp",
);
assert(idleCs.stroke === 0, "unlit cream sharp has no leftover mid-tone border");

const colorDelta = (a, b) => ({
  dl: Math.abs(lum(a) - lum(b)),
  dc: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
});
const enCs = paint(cSharp, 1 << 1, null);
const idleNatDelta = colorDelta(enC.top, idleC.top);
assert(
  idleNatDelta.dl >= 0.35 || idleNatDelta.dc >= 0.5,
  "enabled vs disabled natural is strongly distinct (luminance or color)",
);
assert(tealBias(enC) >= 0.4, "enabled natural fill is solid bright teal");
assert(lum(idleC.top) <= 0.15, "disabled natural is near-black");
const idleSharpDelta = colorDelta(enCs.top, idleCs.top);
assert(
  idleSharpDelta.dl >= 0.25 || idleSharpDelta.dc >= 0.45,
  "enabled vs disabled sharp is strongly distinct (luminance or color)",
);
assert(tealBias(enCs) >= 0.4, "enabled sharp fill is solid bright teal");
assert(tealBias(idleCs) < 0.08 && lum(idleCs.top) >= 0.9, "disabled sharp is the unlit Keyboard cream white-key top");
assert(tealBias(idleC) < 0.08 && lum(idleC.top) <= 0.18, "disabled natural is the unlit Keyboard black-key top, not teal");
assert(enCs.stroke > 0, "enabled sharp keeps the electric teal stroke");

assert(typeof ctx.nodeGraphPitchQuantizerFacePaintSig === "function", "paint signature helper is exported");
const sigOf = (mask) => ctx.nodeGraphPitchQuantizerFacePaintSig(280, 100, 1, mask, false, null);
assert(sigOf(C_MAJOR) !== sigOf(C_MAJOR ^ (1 << 0)), "toggling a natural must change the paint signature");
assert(sigOf(C_MAJOR) !== sigOf(C_MAJOR ^ (1 << 1)), "toggling a sharp must change the paint signature");
assert(sigOf(C_MAJOR) === sigOf(C_MAJOR), "unchanged mask keeps the same paint signature");

assert(
  /settingsSchema:\s*"pitchQuantizerFace"/.test(defs),
  "pitchQuantizer face must declare a pitchQuantizerFace settings schema",
);
assert(
  typeof ctx.normalizeNodeGraphPitchQuantizerFaceSettings === "function"
    && ctx.NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS,
  "display color settings defaults and normalizer must be exported",
);
const defaults = ctx.NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS;
const toHex = (rgba) => ctx.nodeGraphPitchQuantizerHexFromRgba
  ? ctx.nodeGraphPitchQuantizerHexFromRgba(rgba)
  : (() => {
    const h = (c) => Math.max(0, Math.min(255, Math.round(c * 255))).toString(16).padStart(2, "0");
    return `#${h(rgba[0])}${h(rgba[1])}${h(rgba[2])}`;
  })();
// Defaults: enabled teal, bright playing gold, swapped Keyboard unlit bases.
const lookHex = (rgba) => `#${[0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(rgba[i] * 255))).toString(16).padStart(2, "0")).join("")}`;
assert(defaults.enabledColor === "#3dffd0" && defaults.enabledColor === lookHex(look.electric), "enabled color default is electric teal");
assert(defaults.playingColor === "#ffcf6b" && defaults.playingColor === lookHex(look.playingTop), "playing color default is the bright Keyboard gold");
assert(defaults.naturalColor === "#20252a" && defaults.naturalColor === lookHex(look.naturalTop), "natural color default is the Keyboard black-key top");
assert(defaults.sharpColor === "#f7f2e8" && defaults.sharpColor === lookHex(look.sharpTop), "sharp color default is the Keyboard white-key top");

const fromEmpty = ctx.normalizeNodeGraphPitchQuantizerFaceSettings(undefined);
const fromPartial = ctx.normalizeNodeGraphPitchQuantizerFaceSettings({ enabledColor: "#ff0000" });
assert(
  fromEmpty.enabledColor === defaults.enabledColor
    && fromEmpty.playingColor === defaults.playingColor
    && fromEmpty.naturalColor === defaults.naturalColor
    && fromEmpty.sharpColor === defaults.sharpColor,
  "old patches with no color settings must get the current defaults",
);
assert(fromPartial.enabledColor === "#ff0000", "a saved enabled color is kept");
assert(fromPartial.sharpColor === defaults.sharpColor, "missing color keys fall back to defaults");
assert(
  JSON.stringify(ctx.nodeGraphPitchQuantizerDisplaySettingsForNode({})) === JSON.stringify(defaults)
    && JSON.stringify(ctx.nodeGraphPitchQuantizerDisplaySettingsForNode({ traceDisplaySettings: {} })) === JSON.stringify(defaults),
  "a node without traceDisplaySettings colors gets defaults",
);

assert(
  JSON.stringify(paint(c, C_MAJOR, null)) === JSON.stringify(paint(c, C_MAJOR, null, defaults)),
  "default color settings keep the default enabled/disabled paint",
);
const redEnabled = { ...defaults, enabledColor: "#ff3355" };
const redC = paint(c, C_MAJOR, null, redEnabled);
assert(
  Math.hypot(redC.top[0] - enC.top[0], redC.top[1] - enC.top[1], redC.top[2] - enC.top[2]) >= 0.3,
  "a custom enabled color must change the enabled key fill",
);
assert(
  ctx.nodeGraphPitchQuantizerFacePaintSig(280, 100, 1, C_MAJOR, false, null)
    !== ctx.nodeGraphPitchQuantizerFacePaintSig(280, 100, 1, C_MAJOR, false, null, redEnabled),
  "changing a display color must change the paint signature",
);

ctx.nodeGraphDisplaySettingsBuildColorRowHtml = (key, type) => `<input data-trace-display-color="${key}" data-form="${type}" value="">`;
ctx.nodeGraphDisplaySettingsColorRows = (rows) => rows.join("");
const html = ctx.buildNodeGraphPitchQuantizerDisplaySettingsBodyHtml();
assert(/data-trace-display-color="enabledColor"/.test(html), "settings include enabled highlight color");
assert(/data-trace-display-color="playingColor"/.test(html), "settings include playing highlight color");
assert(/data-trace-display-color="naturalColor"/.test(html), "settings include natural key color");
assert(/data-trace-display-color="sharpColor"/.test(html), "settings include sharp key color");
assert(!/\btitle\s*=/.test(html) && !/data-tooltip/.test(html), "display color controls must not set hover title text");
assert(/Colors/.test(html), "color controls are grouped in the display settings form");

// Unjacked draw must not paint a plate ring that covers the flush key tops.
ops.length = 0;
ctx.nodeGraphPitchQuantizerGlDrawKeys({}, layout, C_MAJOR, false, 1);
const unjackedRing = ops.find((o) => o.op === "roundRect" && o.spec && o.spec.fill && o.spec.fill[3] === 0 && (o.spec.stroke || 0) > 0);
assert(!unjackedRing, "unjacked flush face must not draw a plate ring over the key tops");
const keyTops = ops.filter((o) => o.op === "roundRect" && o.spec && o.spec.fillBottom);
assert(keyTops.length >= 12 && keyTops.every((o) => Math.abs(o.y) < 0.001), "drawn key rects start at the display top");

// Labels nearly fill each key's width (naturals in the lip, sharps in the sharp).
const texts = [];
ctx.nodeGraphGlLinesText = (batch, label, x, y, spec = {}) => {
  texts.push({ label, x, y, px: spec.px, rgba: spec.rgba, maxWidth: spec.maxWidth });
};
ops.length = 0;
texts.length = 0;
ctx.nodeGraphPitchQuantizerGlDrawKeys({}, layout, 0, false, 1);
assert(texts.length === 12, "every key is labelled");
const aspect = ctx.NODE_GRAPH_PIANO_KEYS_LABEL_CHAR_ASPECT || 0.62;
const cqiWhite = (ctx.NODE_GRAPH_PIANO_KEYS_WHITE_LABEL_CQI * layout.width / 7);
const cqiBlack = (ctx.NODE_GRAPH_PIANO_KEYS_BLACK_LABEL_CQI * layout.width / 7);
for (const key of layout.keys) {
  const label = texts.find((t) => t.label === key.label
    && Math.abs(t.x - (key.x + key.w * 0.5)) < 0.01);
  assert(label, "label is centered on " + key.label);
  const expected = ctx.nodeGraphPianoKeysLabelPx(key, key, {
    labelFit: "width",
    labelMargin: 1,
    sharpHeightFrac: 0.62,
    labelSizeK: 1,
    totalUnits: 7,
  }, { w: layout.width, h: layout.height }, 1, 1);
  assert(Math.abs(label.px - expected) < 0.01, "PQ label px is the width-fit size for " + key.label);
  const margin = 1;
  const maxW = Math.max(1, key.w - margin * 2);
  const chars = Math.max(1, String(key.label).length);
  const glyphW = label.px * aspect * chars;
  assert(glyphW <= maxW + 0.05, "label stays inside " + key.label + " with a small margin");
  // Width-fit should be close to the available width, or capped by the lip/height.
  const lipH = key.black ? (key.h - margin * 2) : (key.h * 0.38 - margin * 2);
  const widthLimited = expected + 0.01 >= (maxW / (chars * aspect)) - 0.05;
  const heightLimited = expected + 0.01 >= lipH - 0.05;
  assert(widthLimited || heightLimited, key.label + " label nearly fills its width or lip height");
  assert(label.px > cqiWhite * 1.5, "PQ labels are much larger than the Keyboard CQI size");
  // Contrast: text luminance is clearly apart from the key fill.
  const painted = paint(key, 0, null);
  const textLum = lum(label.rgba || painted.text);
  const fillLum = lum(painted.top);
  assert(Math.abs(textLum - fillLum) >= 0.35, "base " + key.label + " label stays legible against the unlit fill");
}
const enTexts = [];
ctx.nodeGraphGlLinesText = (batch, label, x, y, spec = {}) => {
  enTexts.push({ label, px: spec.px, rgba: spec.rgba });
};
ctx.nodeGraphPitchQuantizerGlDrawKeys({}, layout, C_MAJOR, false, 1, 0);
const enLabelC = enTexts.find((t) => t.label === "C");
const playTexts = [];
ctx.nodeGraphGlLinesText = (batch, label, x, y, spec = {}) => {
  playTexts.push({ label, rgba: spec.rgba });
};
ctx.nodeGraphPitchQuantizerGlDrawKeys({}, layout, 0, false, 1, 0);
const playLabelC = playTexts.find((t) => t.label === "C");
assert(enLabelC && Math.abs(lum(enLabelC.rgba) - lum(enC.top)) >= 0.35, "label stays legible on an enabled teal fill");
assert(playLabelC && Math.abs(lum(playLabelC.rgba) - lum(liveC.top)) >= 0.35, "label stays legible on a playing gold fill");

// Keyboard CQI path is unchanged when labelFit is omitted.
const kWhite = ctx.nodeGraphPianoKeysLabelPx({ black: false, label: "C" }, { w: 40, h: 100 }, {
  labelSizeK: 1,
  totalUnits: 7,
}, { w: 280, h: 100 }, 1, 1);
const kBlack = ctx.nodeGraphPianoKeysLabelPx({ black: true, label: "C#" }, { w: 25, h: 62 }, {
  labelSizeK: 1,
  totalUnits: 7,
}, { w: 280, h: 100 }, 1, 1);
assert(Math.abs(kWhite - cqiWhite) < 1e-9, "Keyboard natural label size stays on the CQI path");
assert(Math.abs(kBlack - cqiBlack) < 1e-9, "Keyboard sharp label size stays on the CQI path");

// Runtime wrap: PQ face targets stay native so the overlay does not begin a drag.
const prevKeep = (target) => target && target.id === "keep-me";
ctx.nodeGraphGlHitKeepsNativeTarget = prevKeep;
ctx.nodeGraphPitchQuantizerArmNativeHits();
const pqTarget = { id: "pq", closest: (sel) => (sel === ".node-pitch-quantizer-face" ? pqTarget : null) };
const other = { id: "other", closest: () => null };
const keep = { id: "keep-me", closest: () => null };
assert(ctx.nodeGraphGlHitKeepsNativeTarget(pqTarget) === true, "PQ face target is treated as a native interactive hit");
assert(ctx.nodeGraphGlHitKeepsNativeTarget(other) === false, "unrelated targets still go through the previous hook");
assert(ctx.nodeGraphGlHitKeepsNativeTarget(keep) === true, "existing keep-native targets still match");
ctx.nodeGraphPitchQuantizerArmNativeHits();
assert(ctx.nodeGraphGlHitKeepsNativeTarget._pqFaceNative, "the keep-native wrap is idempotent");
assert(/toggleNodeGraphPitchQuantizerKey/.test(ui), "a key click still toggles the scale mask");

const form = read("public/node-graph-module-scope-settings-form.js");
assert(
  /playingColor:\s*"#ffcf6b"/.test(form)
    && /naturalColor:\s*"#20252a"/.test(form)
    && /sharpColor:\s*"#f7f2e8"/.test(form),
  "settings form fallbacks match the new display color defaults",
);

console.log("ok  pitch quantizer WebGL face: swapped unlit keys, bright playing, flush tops, wide labels, no-select clicks");
