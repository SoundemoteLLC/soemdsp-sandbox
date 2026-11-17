#!/usr/bin/env node
// Hide Sliders on hand-written faces (Dark Velvet Reverb, Cinematic Reverb):
// the params/knob body must collapse and IO must stay. A later CSS
// display:block on .has-module-face used to override sliders-hidden and
// [hidden], so the knobs stayed painted over the shrunken IO strip.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const faceIdx = styles.indexOf(".dsp-node.has-module-face > .dsp-node-body {");
const faceBlock = styles.indexOf("display: block;", faceIdx);
const hideRule = styles.indexOf(".dsp-node.sliders-hidden.has-module-face > .dsp-node-body", faceBlock);
const hiddenAttr = styles.indexOf(".dsp-node.has-module-face > .dsp-node-body[hidden]", faceBlock);
assert(faceIdx >= 0 && faceBlock >= 0, "has-module-face body still sets display:block");
assert(hideRule > faceBlock, "sliders-hidden must beat has-module-face display:block");
assert(hiddenAttr > faceBlock, "[hidden] must beat has-module-face display:block");

const faceJs = fs.readFileSync(path.join(root, "public/node-graph-module-face.js"), "utf8");
assert(
  /function nodeGraphModuleFaceDrawAllGl[\s\S]*?classList\.contains\("sliders-hidden"\)[\s\S]*?continue/.test(faceJs),
  "GL face draw must skip sliders-hidden modules",
);

const defs = {
  velvetReverb: {
    layout: "pulseCurve",
    displayType: "pulseTrainFace",
    displayHeightGu: 8,
    face: [{ kind: "cells", params: [["mix", "Mix"]], h: 40 }],
    parameters: [{ key: "density" }, { key: "mix" }],
    inputs: ["In", "Left", "Right", "f"],
    outputs: ["Mono", "Left", "Right"],
  },
  reverbEffect: {
    displayType: "hypersawBurn",
    displayHeightGu: 8,
    face: [{ kind: "cells", params: [["mix", "Mix"]], h: 52 }],
    parameters: [{ key: "mix" }, { key: "recycle" }],
    inputs: ["Mono", "Left", "Right", "Reset"],
    outputs: ["Dry L", "Dry R", "Mix L", "Mix R"],
  },
  mixStereo2: {
    parameters: [{ key: "amplitude" }, { key: "pan" }],
    inputs: ["Left", "Right"],
    outputs: ["Left", "Right"],
  },
};

const ctx = {
  console,
  nodeGraphModuleDefinitions: defs,
  nodeGraphGrid: { heightPx: 28 },
  nodeGraphModuleLayout: {
    headerHeightGu: 1,
    headerTitleRowHeightGu: 1,
    sliderRowHeightGu: 30 / 28,
    bodyRowGapGu: 2 / 28,
    ioRowHeightGu: 0.75,
    ioRowGapGu: 0,
    ioSectionMinHeightGu: 0.5,
    ioPaddingYGu: 0.15,
    moduleGridInsetGu: 0.15,
    moduleScopeHeightGu: 2,
  },
  nodeGraphModuleUsesLayoutB: () => false,
  nodeGraphModuleUsesLayoutC: () => false,
  nodeGraphModuleUsesMetamoduleLayout: () => false,
  nodeGraphModuleIsCollapsedUi: () => false,
  nodeGraphModuleIsTitleOnlyUi: () => false,
  nodeGraphChromelessModuleLayouts: new Set(),
  nodeGraphChromelessModuleIsCompactTile: () => false,
  nodeGraphEffectivePatchNodeUi: (ui = {}) => ({
    slidersHidden: false,
    ioHidden: false,
    oscilloscopeHidden: false,
    titleHidden: false,
    buttonsHidden: false,
    displayHeightGu: 8,
    ...ui,
  }),
  normalizeNodeGraphPatchNodeUi: (ui = {}) => ({ displayHeightGu: 8, ...ui }),
  nodeGraphModuleDisplayVisibleForUi: () => true,
  nodeGraphModuleInterfaceControlsVisibleForUi: () => false,
  nodeGraphModuleInterfaceControlsHeightGu: () => 0,
  nodeGraphModuleDisplayHeightUnits: () => 8,
  nodeGraphModuleFaceHeightPx: (type) => (defs[type]?.face ? 226 : 0),
  nodeGraphFiniteNumber: (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },
};

vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(root, "public/node-graph-module-sizing.js"), "utf8"),
  ctx,
  { filename: "node-graph-module-sizing.js" },
);

function visibleIds(type, ui) {
  return ctx.nodeGraphModuleLayoutBands(type, ui, { type, ui })
    .filter((band) => band.visible)
    .map((band) => band.id);
}

const shown = { slidersHidden: false, ioHidden: false, displayHeightGu: 8 };
const hidden = { slidersHidden: true, ioHidden: false, displayHeightGu: 8 };

for (const type of ["velvetReverb", "reverbEffect", "mixStereo2"]) {
  const shownH = ctx.nodeGraphModuleSliderBodyHeightGu(type, shown);
  const hiddenH = ctx.nodeGraphModuleSliderBodyHeightGu(type, hidden);
  const rawH = ctx.nodeGraphModuleSliderBodyHeightGu(type, null);
  assert(shownH > 0, `${type} shows a param body`);
  assert(hiddenH === 0, `${type} Hide Sliders collapses the param body height`);
  assert(rawH > 0, `${type} raw (no ui) height stays the definition body`);

  const shownBands = visibleIds(type, shown);
  const hiddenBands = visibleIds(type, hidden);
  assert(shownBands.includes("params"), `${type} shows a params band`);
  assert(shownBands.includes("io"), `${type} shows IO with sliders visible`);
  assert(!hiddenBands.includes("params"), `${type} Hide Sliders omits the params band`);
  assert(hiddenBands.includes("io"), `${type} Hide Sliders leaves IO visible`);

  const shownOuter = ctx.nodeGraphModuleRequiredHeightUnitsForUi(type, shown);
  const hiddenOuter = ctx.nodeGraphModuleRequiredHeightUnitsForUi(type, hidden);
  assert(hiddenOuter < shownOuter, `${type} Hide Sliders shrinks outer height`);
}

console.log("ok  hide sliders on face modules collapses knobs and keeps IO");
