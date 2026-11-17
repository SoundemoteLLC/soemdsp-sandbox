#!/usr/bin/env node
// Collapse/uncollapse is an independent persisted flag. It must not overwrite
// slidersHidden, ioHidden, titleHidden, buttonsHidden, oscilloscopeHidden,
// hideUnused, or displayHeightGu 0.
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

const actions = read("public/node-graph-module-actions.js");
const cloneSrc = read("public/node-graph-patch-clone.js");
const sizingSrc = read("public/node-graph-module-sizing.js");
const defaultPatch = read("public/node-graph-default-patch.js");
const patchCore = read("public/node-graph-patch-core.js");

const toggleMatch = actions.match(
  /function toggleNodeGraphModuleCollapsedFromContext\(\) \{[\s\S]*?\nfunction /,
);
assert(toggleMatch, "toggleNodeGraphModuleCollapsedFromContext is missing");
const toggleBody = toggleMatch[0];
assert(
  /ui\.collapsed\s*=\s*wantCollapsed/.test(toggleBody),
  "collapse toggle must assign ui.collapsed",
);
for (const flag of [
  "titleHidden",
  "buttonsHidden",
  "ioHidden",
  "slidersHidden",
  "oscilloscopeHidden",
  "hideUnused",
  "displayHeightGu",
  "interfaceControlsHidden",
]) {
  assert(
    !new RegExp(`${flag}\\s*=`).test(toggleBody),
    `collapse toggle must not assign ${flag}`,
  );
}
assert(
  /nodeGraphModuleActionTargetNodeIds\(\)/.test(toggleBody),
  "collapse toggle must use the shared single/multi selection target helper",
);
assert(
  /bindNodeGraphSceneElementEvent\("nodeSceneToggleCollapsed", "click", toggleNodeGraphModuleCollapsedFromContext\)/.test(
    read("public/node-graph-scene-menu-event-bindings.js"),
  ),
  "context-menu Collapsed button must call the independent toggle",
);

assert(/normalizedUi\.collapsed/.test(actions), "applyNodeGraphPatchNodeUi must persist collapsed");
assert(/ui\.collapsed/.test(defaultPatch), "default-patch spawn persist must keep collapsed");
assert(/ui\.collapsed/.test(patchCore), "patch-core normalize persist must keep collapsed");
assert(/ui\.collapsed/.test(cloneSrc), "patch-clone serialize persist must keep collapsed");
assert(
  /collapsed:\s*Boolean\(source\.collapsed\)/.test(cloneSrc),
  "normalizeNodeGraphPatchNodeUi must copy collapsed as its own flag",
);
assert(
  /function nodeGraphModuleIsCollapsedUi[\s\S]*?return Boolean\(effective\?\.collapsed\)/.test(sizingSrc),
  "isCollapsed must read the collapsed flag, not infer from other hide settings",
);

const ctx = {
  console,
  nodeGraphModuleDefinitions: {
    gain: {
      parameters: [{ key: "gain" }, { key: "mix" }],
      inputs: ["In"],
      outputs: ["Out"],
    },
    textBox: { layout: "textBox" },
  },
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
  nodeGraphModuleGuPolicy: { minGu: 1 },
  nodeGraphModuleUsesLayoutB: () => false,
  nodeGraphModuleUsesLayoutC: () => false,
  nodeGraphModuleUsesMetamoduleLayout: () => false,
  nodeGraphChromelessModuleLayouts: new Set(),
  nodeGraphChromelessModuleIsCompactTile: () => false,
  nodeGraphModuleTypeSlidersAlwaysHidden: () => false,
  nodeGraphModuleTypeHasHideableSliders: () => true,
  nodeGraphModuleTypeHasIoPorts: () => true,
  nodeGraphModuleHasFace: () => true,
  nodeGraphModuleDisplayVisibleForUi: (_type, ui) => Number(ui?.displayHeightGu) !== 0 && !ui?.oscilloscopeHidden,
  nodeGraphModuleInterfaceControlsVisibleForUi: () => false,
  nodeGraphModuleInterfaceControlsHeightGu: () => 0,
  nodeGraphModuleDisplayHeightUnits: (_type, ui) => Number(ui?.displayHeightGu) || 0,
  nodeGraphModuleConfiguredDisplayHeightUnits: (_type, ui) => Number(ui?.displayHeightGu) || 0,
  nodeGraphModuleDefaultDisplayHeightUnits: () => 4,
  normalizeNodeGraphModuleDisplayHeightOffsetUnits: (_type, value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  },
  normalizeNodeGraphModuleDisplayHeightUnits: (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  },
  nodeGraphModuleFaceHeightPx: () => 0,
  nodeGraphFiniteNumber: (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },
  nodeGraphCanvasForcesIoHidden: () => false,
};

vm.createContext(ctx);
vm.runInContext(cloneSrc, ctx, { filename: "node-graph-patch-clone.js" });
vm.runInContext(sizingSrc, ctx, { filename: "node-graph-module-sizing.js" });

const hideState = {
  slidersHidden: true,
  ioHidden: true,
  titleHidden: true,
  buttonsHidden: true,
  hideUnused: true,
  oscilloscopeHidden: true,
  displayHeightGu: 0,
};

const loaded = ctx.normalizeNodeGraphPatchNodeUi(hideState, "gain");
assert(loaded.slidersHidden === true, "load keeps slidersHidden");
assert(loaded.ioHidden === true, "load keeps ioHidden");
assert(loaded.titleHidden === true, "load keeps titleHidden");
assert(loaded.buttonsHidden === true, "load keeps buttonsHidden");
assert(loaded.hideUnused === true, "load keeps hideUnused");
assert(loaded.oscilloscopeHidden === true, "load keeps oscilloscopeHidden");
assert(loaded.displayHeightGu === 0, "load keeps displayHeightGu 0");
assert(loaded.collapsed === false, "old patches without collapsed load as not collapsed");
assert(
  ctx.nodeGraphModuleIsCollapsedUi("gain", loaded) === false,
  "all-hidden without collapsed is not inferred as collapsed",
);

const collapsedUi = ctx.normalizeNodeGraphPatchNodeUi({ ...hideState, collapsed: true }, "gain");
assert(collapsedUi.collapsed === true, "normalize keeps collapsed true");
assert(collapsedUi.slidersHidden === true, "collapsed normalize keeps slidersHidden");
assert(collapsedUi.ioHidden === true, "collapsed normalize keeps ioHidden");
assert(collapsedUi.displayHeightGu === 0, "collapsed normalize keeps display height 0");
assert(ctx.nodeGraphModuleIsCollapsedUi("gain", collapsedUi) === true, "isCollapsed true from flag");
assert(
  ctx.nodeGraphModuleIsCollapsedUi("gain", { collapsed: true, slidersHidden: false, ioHidden: false }) === true,
  "isCollapsed is independent of other hide flags being off",
);
assert(
  ctx.nodeGraphModuleIsCollapsedUi("textBox", { collapsed: true }) === false,
  "textBox stays opted out of collapse",
);

assert(ctx.nodeGraphModuleLayoutBands("gain", collapsedUi).length === 0, "collapsed layout omits all bands");
assert(ctx.nodeGraphModuleGridHeightUnitsForUi("gain", collapsedUi) === 1, "collapsed height is 1 GU");

const expanded = ctx.normalizeNodeGraphPatchNodeUi({ ...collapsedUi, collapsed: false }, "gain");
assert(expanded.collapsed === false, "uncollapse clears collapsed");
assert(expanded.slidersHidden === true, "uncollapse keeps slidersHidden");
assert(expanded.ioHidden === true, "uncollapse keeps ioHidden");
assert(expanded.titleHidden === true, "uncollapse keeps titleHidden");
assert(expanded.buttonsHidden === true, "uncollapse keeps buttonsHidden");
assert(expanded.hideUnused === true, "uncollapse keeps hideUnused");
assert(expanded.oscilloscopeHidden === true, "uncollapse keeps oscilloscopeHidden");
assert(expanded.displayHeightGu === 0, "uncollapse keeps displayHeightGu 0");
assert(ctx.nodeGraphModuleIsCollapsedUi("gain", expanded) === false, "uncollapsed is not collapsed");
assert(ctx.nodeGraphModuleGridHeightUnitsForUi("gain", expanded) >= 1, "uncollapsed all-hidden module still loads");

console.log("ok  collapse is an independent hide setting and survives load");
