#!/usr/bin/env node
// Sturmian Grid param-band rows: common sliders (not definition.face), compact
// parameterRows count, Hide Sliders still collapses the params band.
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
  ["rate", "semitoneOffset"],
  ["alpha", "beta", "rho"],
  ["drift"],
  ["steps", "reset"],
  ["spread", "walk"],
  ["snap"],
  ["view"],
];
assert(JSON.stringify(def.parameterRows) === JSON.stringify(expectedRows), "parameterRows order");
const visibleKeys = def.parameters.filter((p) => p.hidden !== true).map((p) => p.key);
assert(JSON.stringify(visibleKeys) === JSON.stringify([
  "rate", "semitoneOffset", "alpha", "beta", "rho", "drift", "steps", "reset", "spread", "walk", "snap", "view",
]), "visible parameter order");

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

assert(ctx.nodeGraphModuleVisibleBodyRowCount("sturmianGrid") === 7, "sturmian packs 12 params into 7 rows");
assert(ctx.nodeGraphModuleVisibleBodyRowCount("mixStereo2") === 2, "ungrouped modules still count one row per param");

const shown = { slidersHidden: false, ioHidden: false, displayHeightGu: 8 };
const hidden = { slidersHidden: true, ioHidden: false, displayHeightGu: 8 };
const shownH = ctx.nodeGraphModuleSliderBodyHeightGu("sturmianGrid", shown);
const hiddenH = ctx.nodeGraphModuleSliderBodyHeightGu("sturmianGrid", hidden);
const rawH = ctx.nodeGraphModuleSliderBodyHeightGu("sturmianGrid", null);
const seven = 7 * (30 / 28) + 6 * (2 / 28);
assert(Math.abs(shownH - seven) < 1e-9, `shown height is 7 compact rows (got ${shownH})`);
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

// Lane map lives on the grid face, not the param body.
const uiSrc = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid-ui.js"), "utf8");
assert(uiSrc.includes("sturmian-side"), "K/S/H/M strip still mounted on the grid face");
assert(uiSrc.includes("sturmianCreateLaneMap"), "lane map factory still present");
assert(uiSrc.includes("sturmianLayoutParamRows"), "common sliders packed after mount");
assert(uiSrc.includes("queueMicrotask"), "pack waits until the param body exists");

const css = fs.readFileSync(path.join(root, "public/modules/sturmianGrid/sturmian-grid.css"), "utf8");
assert(css.includes(".sturmian-param-row"), "compact row CSS");
assert(css.includes(".sturmian-side"), "lane strip CSS");

console.log("ok  sturmian common-slider parameterRows and Hide Sliders");
