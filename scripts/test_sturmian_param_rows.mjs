#!/usr/bin/env node
// Sturmian Grid param-band rows: common sliders (not definition.face), generic
// parameterRows packing, Hide Sliders still collapses the params band.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const registerSrc = fs.readFileSync(
  path.join(root, "public/modules/sturmianGrid/sturmian-grid-register.js"),
  "utf8",
);
assert(!/\bface:\s*\[/.test(registerSrc), "sturmian must not use definition.face (that hid the common sliders)");
assert(/parameterRows:\s*\[/.test(registerSrc), "sturmian declares parameterRows");
assert(/label: "Drift"/.test(registerSrc), "Drift visible label");
assert(/key: "semitoneOffset"/.test(registerSrc), "semitoneOffset param");

const registrations = new Map();
const registerCtx = {
  registerNodeGraphChromelessModule(type, config) {
    registrations.set(type, config);
  },
};
vm.createContext(registerCtx);
vm.runInContext(registerSrc, registerCtx, { filename: "sturmian-grid-register.js" });
const def = registrations.get("sturmianGrid")?.definition;
assert(def, "sturmian registered");
assert.equal = (a, b, msg) => assert(a === b, `${msg}: ${a} !== ${b}`);

const expectedRows = [
  ["rate", "drift"],
  ["semitoneOffset", "pitchSource", "pitchRange"],
  ["alpha", "beta", "rho"],
  ["steps", "spread"],
  ["reset", "walk", "snap"],
  ["view"],
];
assert(JSON.stringify(def.parameterRows) === JSON.stringify(expectedRows), "parameterRows order");
const visibleKeys = def.parameters.filter((p) => p.hidden !== true).map((p) => p.key);
assert(JSON.stringify(visibleKeys) === JSON.stringify([
  "rate", "drift", "semitoneOffset", "pitchSource", "pitchRange", "alpha", "beta", "rho", "steps", "spread", "reset", "walk", "snap", "view",
]), "visible parameter order");
assert(def.parameters.find((p) => p.key === "pitchSource")?.choices?.join(",") === "Classic,Tile,Height,X", "pitchSource choices");
assert(def.parameters.find((p) => p.key === "pitchRange")?.defaultValue === "21", "pitchRange default is current span");
assert(def.parameters.find((p) => p.key === "pitchRange")?.unit === "st", "pitchRange unit st");

const defs = {
  sturmianGrid: def,
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
  nodeGraphChromelessModuleLayouts: { has: () => true },
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
  nodeGraphModuleHasFace: () => true,
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

assert(ctx.nodeGraphModuleVisibleBodyRowCount("sturmianGrid") === 6, "sturmian packs 14 params into 6 rows");
assert(ctx.nodeGraphModuleVisibleBodyRowCount("mixStereo2") === 2, "ungrouped modules still count one row per param");

const shown = { slidersHidden: false, ioHidden: false, displayHeightGu: 8 };
const hidden = { slidersHidden: true, ioHidden: false, displayHeightGu: 8 };
const shownH = ctx.nodeGraphModuleSliderBodyHeightGu("sturmianGrid", shown);
const hiddenH = ctx.nodeGraphModuleSliderBodyHeightGu("sturmianGrid", hidden);
const rawH = ctx.nodeGraphModuleSliderBodyHeightGu("sturmianGrid", null);
const six = 6 * (40 / 28) + 5 * (2 / 28);
assert(Math.abs(shownH - six) < 1e-9, `shown height is 6 face-aligned 40px rows (got ${shownH})`);
assert(hiddenH === 0, "Hide Sliders collapses the param body height");
assert(rawH > 0, "raw (no ui) height stays the definition body");

function visibleIds(type, ui) {
  return ctx.nodeGraphModuleLayoutBands(type, ui, { type, ui })
    .filter((band) => band.visible)
    .map((band) => ctx.nodeGraphModuleCanonicalBandId(band.id));
}
const shownBands = visibleIds("sturmianGrid", shown);
const hiddenBands = visibleIds("sturmianGrid", hidden);
assert(shownBands.includes("params"), "params band visible with sliders shown");
assert(shownBands.includes("face") || shownBands.includes("scope"), "display face band stays visible");
assert(!hiddenBands.includes("params"), "Hide Sliders omits the params band");
assert(hiddenBands.includes("io") || hiddenBands.includes("face") || hiddenBands.includes("scope"), "Hide Sliders leaves IO or display");

// K/S/H/M lives in the WebGL face (same texture as the grid), not a DOM strip.
const uiSrc = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid-ui.js"), "utf8");
assert(uiSrc.includes("sturmianLaneButtons"), "K/S/H/M strip laid out in the WebGL face");
assert(uiSrc.includes("sturmianHitFace"), "face hit-test covers cells and lane toggles");
assert(!uiSrc.includes("sturmian-side") && !uiSrc.includes("sturmianCreateLaneMap"), "lane map is not a DOM strip");
assert(uiSrc.includes("display-canvas-pixel-snap"), "plate opts into compositor pixel-snap");
const registrySrc = fs.readFileSync(path.join(root, "public/node-graph-chromeless-module-registry.js"), "utf8");
const renderSrc = fs.readFileSync(path.join(root, "public/node-graph-module-rendering.js"), "utf8");
assert(registrySrc.includes("nodeGraphLayoutParameterRows") && registrySrc.includes("nodeGraphModuleDefinitions[type]?.parameterRows"), "generic parameter row packer reads declared groups");
assert(renderSrc.includes("nodeGraphLayoutParameterRows(body, type)"), "module renderer packs declared groups after mount");

const css = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid.css"), "utf8");
assert(css.includes("--node-body-row-height: 40px"), "slider row height matches face cells");
assert(!css.includes(".sturmian-side") && !css.includes(".sturmian-lane-map"), "lane strip CSS removed");


// Docked-tip descriptions must be real text, not the metadata placeholder.
const tipKeys = [
  "rate", "drift", "semitoneOffset", "pitchSource", "pitchRange",
  "alpha", "beta", "rho", "steps", "spread", "reset", "walk", "snap", "view",
];
for (const key of tipKeys) {
  const param = def.parameters.find((p) => p.key === key);
  const tip = String(param?.tooltip || "").trim();
  assert(tip.length > 20, key + " has a real docked-tip description");
  assert(!/shown in docked tips/i.test(tip), key + " is not the placeholder");
}
const pitchTip = def.parameters.find((p) => p.key === "pitchSource").tooltip;
for (const mode of ["Classic", "Tile", "Height", "X"]) {
  assert(pitchTip.includes(mode), "pitchSource tip names " + mode);
}
assert(/A3/.test(def.parameters.find((p) => p.key === "semitoneOffset").tooltip), "semitoneOffset tip states A3 pitch formula");
assert(/slides down/i.test(def.parameters.find((p) => p.key === "walk").tooltip), "Bar Walk tip explains row slide");
assert(/fraction/i.test(def.parameters.find((p) => p.key === "snap").tooltip), "Rational Snap tip mentions fractions");
assert(/\b0\b/.test(def.parameters.find((p) => p.key === "walk").tooltip), "Bar Walk tip mentions 0");
for (const port of ["Restart", "Adv", "f"]) {
  assert(String(def.inputTooltips?.[port] || "").trim().length > 20, port + " inlet tip");
}
for (const port of ["Kick", "Snare", "Hat", "Melody", "Pitch", "f"]) {
  assert(String(def.outputTooltips?.[port] || "").trim().length > 20, port + " outlet tip");
}

console.log("ok  sturmian common-slider parameterRows and Hide Sliders");
