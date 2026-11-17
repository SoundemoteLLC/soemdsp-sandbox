function syncNodeUiDevNodeColorControls() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  for (const input of document.querySelectorAll("[data-node-color-var]")) {
    const property = input.dataset.nodeColorVar;
    if (!property?.startsWith("--")) {
      continue;
    }
    const fallback = input.getAttribute("value") || "#000000";
    const color = normalizeNodeUiDevColor(input.value, fallback);
    input.value = color;
    workspace.style.setProperty(property, color);
    const output = document.getElementById(`${input.id}Value`);
    if (output) {
      output.textContent = color;
    }
  }
}

// Slider fill colors. Amount + ghost stay HSLA. Handles (numeric + choice)
// use hue / physically-plausible brightness / alpha.
// Deliberately NOT folded into syncNodeUiDevSettingsHeaderControls below --
// that function bails early if any one of its ~80 hardcoded inputs is missing,
// so anything added to it inherits that fragility.
const nodeUiDevSliderFillColorTargets = Object.freeze([
  { property: "--node-slider-amount-color", prefix: "nodeUiDevSliderAmountFill", fallback: [200, 31, 15, 55] },
  { property: "--node-slider-ghost-color", prefix: "nodeUiDevSliderGhostFill", fallback: [262, 100, 76, 38] },
]);

function syncNodeUiDevSnakeSelectColor() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  const hue = nodeUiDevSliderFillChannel("nodeUiDevSnakeSelectHue", 191, 360);
  const brightness = nodeUiDevSliderFillChannel("nodeUiDevSnakeSelectBrightness", 50, 100);
  const alpha = nodeUiDevSliderFillChannel("nodeUiDevSnakeSelectAlpha", 95, 100);
  const css = typeof nodeGraphHueBrightnessCss === "function"
    ? nodeGraphHueBrightnessCss(hue, brightness / 100)
    : `hsl(${hue} 100% 50%)`;
  workspace.style.setProperty("--node-selection-hit-trail-color", css);
  workspace.style.setProperty("--node-selection-hit-trail-alpha", String(alpha / 100));
  document.documentElement.style.setProperty("--node-selection-hit-trail-alpha", String(alpha / 100));
  if (typeof nodeGraphMagnifierIsActive === "function" && nodeGraphMagnifierIsActive()) {
    applyNodeGraphMagnifierLayout();
  }
  const hueOut = document.getElementById("nodeUiDevSnakeSelectHueValue");
  if (hueOut) {
    hueOut.textContent = `${hue}deg`;
  }
  const brightOut = document.getElementById("nodeUiDevSnakeSelectBrightnessValue");
  if (brightOut) {
    brightOut.textContent = `${brightness}%`;
  }
  const alphaOut = document.getElementById("nodeUiDevSnakeSelectAlphaValue");
  if (alphaOut) {
    alphaOut.textContent = `${alpha}%`;
  }
}

function nodeUiDevSliderFillChannel(id, fallback, max) {
  const input = document.getElementById(id);
  const value = Number(input?.value);
  return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
}

function syncNodeUiDevSliderHandleColor() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  const hue = nodeUiDevSliderFillChannel("nodeUiDevSliderHandleHue", 203, 360);
  const brightness = nodeUiDevSliderFillChannel("nodeUiDevSliderHandleBrightness", 57, 100);
  const alpha = nodeUiDevSliderFillChannel("nodeUiDevSliderHandleAlpha", 37, 100);
  const css = typeof nodeGraphHueBrightnessCss === "function"
    ? nodeGraphHueBrightnessCss(hue, brightness / 100, alpha / 100)
    : `hsl(${hue} 100% 50% / ${alpha / 100})`;
  workspace.style.setProperty("--node-slider-position-color", css);
  const hueOut = document.getElementById("nodeUiDevSliderHandleHueValue");
  if (hueOut) {
    hueOut.textContent = `${hue}deg`;
  }
  const brightOut = document.getElementById("nodeUiDevSliderHandleBrightnessValue");
  if (brightOut) {
    brightOut.textContent = `${brightness}%`;
  }
  const alphaOut = document.getElementById("nodeUiDevSliderHandleAlphaValue");
  if (alphaOut) {
    alphaOut.textContent = `${alpha}%`;
  }
}

function syncNodeUiDevSliderFillColorControls() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  syncNodeUiDevSliderHandleColor();
  for (const target of nodeUiDevSliderFillColorTargets) {
    const [hueFallback, satFallback, lightFallback, alphaFallback] = target.fallback;
    const hue = nodeUiDevSliderFillChannel(`${target.prefix}Hue`, hueFallback, 360);
    const saturation = nodeUiDevSliderFillChannel(`${target.prefix}Saturation`, satFallback, 100);
    const lightness = nodeUiDevSliderFillChannel(`${target.prefix}Lightness`, lightFallback, 100);
    const alpha = nodeUiDevSliderFillChannel(`${target.prefix}Alpha`, alphaFallback, 100);
    workspace.style.setProperty(
      target.property,
      `hsl(${hue} ${saturation}% ${lightness}% / ${alpha / 100})`,
    );
    for (const [suffix, text] of [
      ["Hue", `${hue}deg`],
      ["Saturation", `${saturation}%`],
      ["Lightness", `${lightness}%`],
      ["Alpha", `${alpha}%`],
    ]) {
      const output = document.getElementById(`${target.prefix}${suffix}Value`);
      if (output) {
        output.textContent = text;
      }
    }
  }
}

function syncNodeUiDevWiresFollowPortColors() {
  const input = document.getElementById("nodeUiDevWiresFollowPortColors");
  const on = input ? Boolean(input.checked) : true;
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.wiresFollowPortColors = on;
  }
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires();
  }
}

function bindNodeUiDevWiresFollowPortColors() {
  const input = document.getElementById("nodeUiDevWiresFollowPortColors");
  if (input && input.dataset.wiresFollowPortColorsBound !== "true") {
    input.dataset.wiresFollowPortColorsBound = "true";
    input.addEventListener("change", () => {
      syncNodeUiDevWiresFollowPortColors();
      if (typeof scheduleNodeUiDevSettingsAutosave === "function") {
        scheduleNodeUiDevSettingsAutosave();
      }
    });
  }
  syncNodeUiDevWiresFollowPortColors();
}

function nodeGraphFullyOpaqueWires() {
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp && typeof nodeGraphMvp.fullyOpaqueWires === "boolean") {
    return nodeGraphMvp.fullyOpaqueWires;
  }
  const input = typeof document !== "undefined"
    ? document.getElementById("nodeUiDevFullyOpaqueWires")
    : null;
  return Boolean(input?.checked);
}

function syncNodeUiDevFullyOpaqueWires() {
  const input = document.getElementById("nodeUiDevFullyOpaqueWires");
  const on = input ? Boolean(input.checked) : false;
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.fullyOpaqueWires = on;
  }
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires();
  }
}

function bindNodeUiDevFullyOpaqueWires() {
  const input = document.getElementById("nodeUiDevFullyOpaqueWires");
  if (input && input.dataset.fullyOpaqueWiresBound !== "true") {
    input.dataset.fullyOpaqueWiresBound = "true";
    input.addEventListener("change", () => {
      syncNodeUiDevFullyOpaqueWires();
      if (typeof scheduleNodeUiDevSettingsAutosave === "function") {
        scheduleNodeUiDevSettingsAutosave();
      }
    });
  }
  syncNodeUiDevFullyOpaqueWires();
}

function nodeGraphPixelateWiresOnZoom() {
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp && typeof nodeGraphMvp.pixelateWiresOnZoom === "boolean") {
    return nodeGraphMvp.pixelateWiresOnZoom;
  }
  const input = typeof document !== "undefined"
    ? document.getElementById("nodeUiDevPixelateWiresOnZoom")
    : null;
  return Boolean(input?.checked);
}

function syncNodeUiDevPixelateWiresOnZoom() {
  const input = document.getElementById("nodeUiDevPixelateWiresOnZoom");
  const on = input ? Boolean(input.checked) : false;
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.pixelateWiresOnZoom = on;
  }
  // Bake now (on) or straight back to vector strokes (off): no reload.
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires();
  }
}

function bindNodeUiDevPixelateWiresOnZoom() {
  const input = document.getElementById("nodeUiDevPixelateWiresOnZoom");
  if (input && input.dataset.pixelateWiresOnZoomBound !== "true") {
    input.dataset.pixelateWiresOnZoomBound = "true";
    input.addEventListener("change", () => {
      syncNodeUiDevPixelateWiresOnZoom();
      if (typeof scheduleNodeUiDevSettingsAutosave === "function") {
        scheduleNodeUiDevSettingsAutosave();
      }
    });
  }
  syncNodeUiDevPixelateWiresOnZoom();
}

function nodeGraphPixelateWireDotsOnZoom() {
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp && typeof nodeGraphMvp.pixelateWireDotsOnZoom === "boolean") {
    return nodeGraphMvp.pixelateWireDotsOnZoom;
  }
  const input = typeof document !== "undefined"
    ? document.getElementById("nodeUiDevPixelateWireDotsOnZoom")
    : null;
  return Boolean(input?.checked);
}

function syncNodeUiDevPixelateWireDotsOnZoom() {
  const input = document.getElementById("nodeUiDevPixelateWireDotsOnZoom");
  const on = input ? Boolean(input.checked) : false;
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.pixelateWireDotsOnZoom = on;
  }
  // Bake now (on) or straight back to vector dots (off): no reload.
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires();
  }
}

function bindNodeUiDevPixelateWireDotsOnZoom() {
  const input = document.getElementById("nodeUiDevPixelateWireDotsOnZoom");
  if (input && input.dataset.pixelateWireDotsOnZoomBound !== "true") {
    input.dataset.pixelateWireDotsOnZoomBound = "true";
    input.addEventListener("change", () => {
      syncNodeUiDevPixelateWireDotsOnZoom();
      if (typeof scheduleNodeUiDevSettingsAutosave === "function") {
        scheduleNodeUiDevSettingsAutosave();
      }
    });
  }
  syncNodeUiDevPixelateWireDotsOnZoom();
}

function nodeGraphWireDotShadows() {
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp && typeof nodeGraphMvp.wireDotShadows === "boolean") {
    return nodeGraphMvp.wireDotShadows;
  }
  const input = typeof document !== "undefined"
    ? document.getElementById("nodeUiDevWireDotShadows")
    : null;
  return input ? Boolean(input.checked) : true;
}

function syncNodeUiDevWireDotShadows() {
  const input = document.getElementById("nodeUiDevWireDotShadows");
  const on = input ? Boolean(input.checked) : true;
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.wireDotShadows = on;
  }
  // Re-bake the dot pictures (they hold the edge) and redraw: no reload.
  if (typeof nodeGraphGlGraphDotBakeDrop === "function") nodeGraphGlGraphDotBakeDrop();
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires();
  }
}

function bindNodeUiDevWireDotShadows() {
  const input = document.getElementById("nodeUiDevWireDotShadows");
  if (input && input.dataset.wireDotShadowsBound !== "true") {
    input.dataset.wireDotShadowsBound = "true";
    input.addEventListener("change", () => {
      syncNodeUiDevWireDotShadows();
      if (typeof scheduleNodeUiDevSettingsAutosave === "function") {
        scheduleNodeUiDevSettingsAutosave();
      }
    });
  }
  syncNodeUiDevWireDotShadows();
}

function bindNodeUiDevSliderFillColorControls() {
  for (const target of nodeUiDevSliderFillColorTargets) {
    for (const suffix of ["Hue", "Saturation", "Lightness", "Alpha"]) {
      const input = document.getElementById(`${target.prefix}${suffix}`);
      if (!input || input.dataset.sliderFillColorBound === "true") {
        continue;
      }
      input.dataset.sliderFillColorBound = "true";
      input.addEventListener("input", syncNodeUiDevSliderFillColorControls);
      input.addEventListener("change", syncNodeUiDevSliderFillColorControls);
    }
  }
  for (const id of ["nodeUiDevSliderHandleHue", "nodeUiDevSliderHandleBrightness", "nodeUiDevSliderHandleAlpha"]) {
    const input = document.getElementById(id);
    if (!input || input.dataset.sliderHandleColorBound === "true") {
      continue;
    }
    input.dataset.sliderHandleColorBound = "true";
    input.addEventListener("input", syncNodeUiDevSliderHandleColor);
    input.addEventListener("change", syncNodeUiDevSliderHandleColor);
  }
  for (const id of ["nodeUiDevSnakeSelectHue", "nodeUiDevSnakeSelectBrightness", "nodeUiDevSnakeSelectAlpha"]) {
    const input = document.getElementById(id);
    if (!input || input.dataset.snakeSelectColorBound === "true") {
      continue;
    }
    input.dataset.snakeSelectColorBound = "true";
    input.addEventListener("input", syncNodeUiDevSnakeSelectColor);
    input.addEventListener("change", syncNodeUiDevSnakeSelectColor);
  }
  syncNodeUiDevSliderFillColorControls();
  syncNodeUiDevSnakeSelectColor();
  bindNodeUiDevWiresFollowPortColors();
  bindNodeUiDevFullyOpaqueWires();
  bindNodeUiDevPixelateWiresOnZoom();
  bindNodeUiDevPixelateWireDotsOnZoom();
  bindNodeUiDevWireDotShadows();
}

// Unselected plate outline. CSS-only — do not fold into the header sync
// (that rebuilds the patch / heatmap / wires on every input event).
// Plate corners for the GL plates (read per draw). Top and bottom are set apart.
const NODE_MODULE_CORNER_SHAPE_NAMES = ["Round", "Squircle", "Pill"];
let nodeGraphModuleStrokeFollowAmount = 0.92;
let nodeGraphModuleStrokeFollowFrame = 0;
let nodeGraphModuleStrokeFollowBeat = 0;
// The colour a loud signal moves the stroke toward (0..1 rgb).
// Fallback when a module has no outgoing cable yet (the Output module): amber-pink.
const nodeGraphStrokeLoudFallbackRgb = [252 / 255, 190 / 255, 161 / 255];
// Loud stroke look: brightness lifts the cable colour toward white (0..1), alpha is its opacity.
let nodeGraphStrokeLoudBrightness = 0;
let nodeGraphStrokeLoudAlpha = 0.31;

// A module's loud colour is the colour of its first outgoing cable; the UI Dev colour is the
// fallback (the Output module, or a module with no cable yet).
function nodeGraphStrokeLoudColor(nodeId) {
  const cableState = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState : null;
  // First outgoing cable; a module with none (the Output module) uses its first incoming cable.
  const cable = cableState?.firstCable?.get?.(String(nodeId)) || cableState?.firstCableIn?.get?.(String(nodeId)) || null;
  const rgb = cable || nodeGraphStrokeLoudFallbackRgb;
  const lift = nodeGraphStrokeLoudBrightness;
  return [rgb[0] + (1 - rgb[0]) * lift, rgb[1] + (1 - rgb[1]) * lift, rgb[2] + (1 - rgb[2]) * lift, nodeGraphStrokeLoudAlpha];
}
function nodeGraphModuleStrokeFollowSourceIsModule() {
  return nodeGraphModuleStrokeFollowAmount > 0;
}
// Output module stroke while the ear protector is engaged (fixed look).
const nodeGraphOutputOverheatRgb = [254 / 255, 57 / 255, 77 / 255, 0.95];

// True while the follow option is on (amount above 0).
function nodeGraphModuleStrokeFollowActive() {
  return nodeGraphModuleStrokeFollowAmount > 0;
}

function nodeGraphOutputOverheatColor() {
  return nodeGraphOutputOverheatRgb;
}

// 0..1: how hard the module strokes follow the final output level right now.
// Modules that make no audio (controllers, game triggers) have no level to follow.
const NODE_STROKE_FOLLOW_SILENT_CATEGORIES = new Set(["controller", "gametrigger"]);
const nodeStrokeFollowSilentCache = new Map();

function nodeGraphModuleStrokeFollowIsNonAudio(nodeId) {
  if (nodeStrokeFollowSilentCache.has(nodeId)) return nodeStrokeFollowSilentCache.get(nodeId);
  const type = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId)?.type : "";
  const category = typeof nodeGraphModuleStoreCatalog === "object" && nodeGraphModuleStoreCatalog ? nodeGraphModuleStoreCatalog[type]?.category : "";
  const silent = NODE_STROKE_FOLLOW_SILENT_CATEGORIES.has(category);
  if (type) nodeStrokeFollowSilentCache.set(nodeId, silent);
  return silent;
}

// A module whose output goes nowhere has nothing to follow. Cached by the connection list.
let nodeStrokeFollowSourcesFor = null;
let nodeStrokeFollowSourcesLen = -1;
let nodeStrokeFollowSources = new Set();

function nodeGraphModuleStrokeFollowHasOutgoing(nodeId) {
  const connections = nodeGraphMvp?.patch?.connections;
  if (!Array.isArray(connections)) return true;
  if (connections !== nodeStrokeFollowSourcesFor || connections.length !== nodeStrokeFollowSourcesLen) {
    nodeStrokeFollowSourcesFor = connections;
    nodeStrokeFollowSourcesLen = connections.length;
    nodeStrokeFollowSources = new Set(connections.map((c) => c?.sourceNode));
  }
  return nodeStrokeFollowSources.has(nodeId);
}

// 0..1 animation amount for one module right now: its output level (each module's own output; the
// Output module follows the final output) times the "animate" control. Modules that make no audio
// (controllers, game triggers) and modules whose output goes nowhere do not animate.
function nodeGraphModuleStrokeFollowLevel(nodeId) {
  if (!(nodeGraphModuleStrokeFollowAmount > 0)) return 0;
  if (nodeGraphModuleStrokeFollowIsNonAudio(nodeId)) return 0;
  let raw = 0;
  if (typeof nodeGraphIsOutputModule === "function" && nodeGraphIsOutputModule(nodeId)) {
    raw = typeof nodeGraphOutputLevel === "function" ? nodeGraphOutputLevel() : 0;
  } else {
    if (!nodeGraphModuleStrokeFollowHasOutgoing(nodeId)) return 0;
    raw = typeof nodeGraphNodeLevel === "function" ? nodeGraphNodeLevel(nodeId) : 0;
  }
  return Math.min(1, raw * 1.5) * nodeGraphModuleStrokeFollowAmount;
}

function nodeGraphModuleStrokeFollowTick() {
  nodeGraphModuleStrokeFollowFrame = 0;
  if (!(nodeGraphModuleStrokeFollowAmount > 0)) return;
  if (typeof nodeGraphGlGraphPresentDisplaysOnly === "function") nodeGraphGlGraphPresentDisplaysOnly();
  nodeGraphModuleStrokeFollowFrame = requestAnimationFrame(nodeGraphModuleStrokeFollowTick);
}

let nodeGraphModulePlateLookState = { topShape: 1, topRadius: 6, strokeTopRadius: 6, bottomShape: 1, bottomRadius: 6 };

function nodeGraphModulePlateLook() {
  return nodeGraphModulePlateLookState;
}

function syncNodeUiDevModuleCorners() {
  const read = (id, fallback, lo, hi) => {
    const input = document.getElementById(id);
    const n = Number(input?.value);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
  };
  const look = {
    topShape: read("nodeUiDevModuleTopShape", 1, 0, 2),
    topRadius: read("nodeUiDevModuleTopRadius", 6, 0, 60),
    bottomShape: read("nodeUiDevModuleBottomShape", 1, 0, 2),
    bottomRadius: read("nodeUiDevModuleBottomRadius", 6, 0, 60),
  };
  // Stroke top radius: range and default from its definition.
  {
    const def = typeof nodeUiDevSettingControls !== "undefined" ? nodeUiDevSettingControls.find((d) => d.id === "nodeUiDevModuleStrokeTopRadius") : null;
    const n = Number(document.getElementById("nodeUiDevModuleStrokeTopRadius")?.value);
    const lo = Number(def?.min);
    const hi = Number(def?.max);
    const v = Number.isFinite(n) ? n : Number(def?.defaultValue ?? look.topRadius);
    look.strokeTopRadius = Math.min(Number.isFinite(hi) ? hi : v, Math.max(Number.isFinite(lo) ? lo : v, v));
  }
  nodeGraphModulePlateLookState = look;
  const follow = read("nodeUiDevStrokeAnimate", 92, 0, 100);
  nodeGraphModuleStrokeFollowAmount = follow / 100;
  if (typeof nodeGraphSyncNodeLevelsEnabled === "function") nodeGraphSyncNodeLevelsEnabled(nodeGraphModuleStrokeFollowSourceIsModule());
  const loudBright = read("nodeUiDevStrokeLoudBrightness", 0, 0, 100);
  const loudAlpha = read("nodeUiDevStrokeLoudAlpha", 31, 0, 100);
  nodeGraphStrokeLoudBrightness = loudBright / 100;
  nodeGraphStrokeLoudAlpha = loudAlpha / 100;
  const loudBrightOut = document.getElementById("nodeUiDevStrokeLoudBrightnessValue");
  if (loudBrightOut) loudBrightOut.textContent = `${loudBright}%`;
  const loudAlphaOut = document.getElementById("nodeUiDevStrokeLoudAlphaValue");
  if (loudAlphaOut) loudAlphaOut.textContent = `${loudAlpha}%`;
  const followOut = document.getElementById("nodeUiDevStrokeAnimateValue");
  if (followOut) followOut.textContent = follow > 0 ? `${follow}%` : "off";
  if (follow > 0 && !nodeGraphModuleStrokeFollowFrame) nodeGraphModuleStrokeFollowFrame = requestAnimationFrame(nodeGraphModuleStrokeFollowTick);
  const show = (id, text) => {
    const out = document.getElementById(id);
    if (out) out.textContent = text;
  };
  show("nodeUiDevModuleTopShapeValue", NODE_MODULE_CORNER_SHAPE_NAMES[look.topShape]);
  show("nodeUiDevModuleTopRadiusValue", look.topShape === 2 ? "full" : `${look.topRadius}px`);
  show("nodeUiDevModuleStrokeTopRadiusValue", look.topShape === 2 ? "full" : `${look.strokeTopRadius}px`);
  show("nodeUiDevModuleBottomShapeValue", NODE_MODULE_CORNER_SHAPE_NAMES[look.bottomShape]);
  show("nodeUiDevModuleBottomRadiusValue", look.bottomShape === 2 ? "full" : `${look.bottomRadius}px`);
  if (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState) nodeGraphGlGraphState.gen += 1;
  if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
}

// UI Dev "lighting: wires" (the light cables and their end dots keep in a fully dark room) and
// "lighting: jacks" (connected / unconnected jack ring light). Percent controls; the range is the
// definition's (nodeUiDevSettingControls), applied to the inputs here.
function syncNodeUiDevLightingLevels() {
  const pairs = [
    ["nodeUiDevWireDarkLight", "nodeGraphWireDarkLight"],
    ["nodeUiDevWireDotDarkLight", "nodeGraphWireDotDarkLight"],
    ["nodeUiDevWireDotLitLight", "nodeGraphWireDotLitLight"],
    ["nodeUiDevJackActiveLight", "nodeGraphJackActiveLight"],
    ["nodeUiDevJackInactiveLight", "nodeGraphJackInactiveLight"],
  ];
  for (const [id, target] of pairs) {
    const def = typeof nodeUiDevSettingControls !== "undefined" ? nodeUiDevSettingControls.find((d) => d.id === id) : null;
    if (!def) continue;
    const input = document.getElementById(id);
    if (input && typeof nodeUiDevApplyDefinitionLimits === "function") {
      nodeUiDevApplyDefinitionLimits(input, def);
    } else if (input) {
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step ?? 1);
    }
    const raw = Number(input?.value);
    const pct = Number.isFinite(raw) ? Math.max(def.min, Math.min(def.max, raw)) : def.defaultValue;
    globalThis[target] = pct / 100;
    const out = document.getElementById(`${id}Value`);
    if (out) out.textContent = `${pct}%`;
  }
  if (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState) nodeGraphGlGraphState.gen += 1;
  if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
}

function syncNodeUiDevModuleIdleStroke() {
  const colorInput = document.getElementById("nodeUiDevModuleStrokeColor");
  const colorOut = document.getElementById("nodeUiDevModuleStrokeColorValue");
  const selectedColorInput = document.getElementById("nodeUiDevModuleSelectedStrokeColor");
  const selectedColorOut = document.getElementById("nodeUiDevModuleSelectedStrokeColorValue");
  const selectedAlphaInput = document.getElementById("nodeUiDevModuleSelectedStrokeAlpha");
  const selectedAlphaOut = document.getElementById("nodeUiDevModuleSelectedStrokeAlphaValue");
  const color = normalizeNodeUiDevColor(colorInput?.value, "#6922ec");
  const idleAlphaInput = document.getElementById("nodeUiDevModuleStrokeAlpha");
  const idleAlphaOut = document.getElementById("nodeUiDevModuleStrokeAlphaValue");
  const idleAlphaRaw = Number(idleAlphaInput?.value);
  const idleAlphaPercent = Number.isFinite(idleAlphaRaw) ? Math.max(0, Math.min(100, idleAlphaRaw)) : 31;
  if (idleAlphaOut) idleAlphaOut.textContent = `${idleAlphaPercent}%`;
  const selectedColor = normalizeNodeUiDevColor(selectedColorInput?.value, "#f9aeae");
  const selectedAlphaRaw = Number(selectedAlphaInput?.value);
  const selectedAlphaPercent = Number.isFinite(selectedAlphaRaw)
    ? Math.max(0, Math.min(100, selectedAlphaRaw))
    : 100;
  if (colorInput) {
    colorInput.value = color;
  }
  if (colorOut) {
    colorOut.textContent = color;
  }
  if (selectedColorInput) {
    selectedColorInput.value = selectedColor;
  }
  if (selectedAlphaInput && !selectedAlphaInput.matches(":active")) {
    selectedAlphaInput.value = String(selectedAlphaPercent);
  }
  if (selectedColorOut) {
    selectedColorOut.textContent = selectedColor;
  }
  if (selectedAlphaOut) {
    selectedAlphaOut.textContent = `${selectedAlphaPercent}%`;
  }
  const workspace = document.getElementById("nodeGraphWorkspace");
  workspace?.style.setProperty("--node-module-idle-stroke-width", "1px");
  workspace?.style.setProperty(
    "--node-module-idle-stroke",
    `rgb(${nodeUiDevHexColorToRgbTriplet(color)} / ${idleAlphaPercent / 100})`,
  );
  workspace?.style.setProperty(
    "--node-module-selected-stroke",
    `rgb(${nodeUiDevHexColorToRgbTriplet(selectedColor)} / ${selectedAlphaPercent / 100})`,
  );
  // The plate stroke vars are read once per rebuild generation; bump it so this change shows now.
  if (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState) nodeGraphGlGraphState.gen += 1;
  if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
}

const NODE_MODULE_PLATE_ROUNDNESS_RATIO = 0.11;
const NODE_MODULE_PLATE_CORNER_SHAPE = "squircle";

function applyNodeModulePlateLook() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  const ratio = String(NODE_MODULE_PLATE_ROUNDNESS_RATIO);
  const shape = NODE_MODULE_PLATE_CORNER_SHAPE;
  workspace?.style.setProperty("--node-module-roundness-ratio", ratio);
  workspace?.style.setProperty("--node-module-corner-shape", shape);
  document.documentElement.style.setProperty("--node-module-roundness-ratio", ratio);
  document.documentElement.style.setProperty("--node-module-corner-shape", shape);
}

function syncNodeUiDevModuleRoundness() {
  applyNodeModulePlateLook();
}

function bindNodeUiDevModuleRoundness() {
  applyNodeModulePlateLook();
}

function syncNodeUiDevModuleTitlePadding() {
  const input = document.getElementById("nodeUiDevModuleTitlePadding");
  const out = document.getElementById("nodeUiDevModuleTitlePaddingValue");
  const px = Math.max(0, Math.min(16, nodeGraphFiniteNumber(input?.value, 0)));
  if (input && !input.matches(":active")) {
    input.value = String(px);
  }
  if (out) {
    out.textContent = `${px}px`;
  }
  document.getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-module-title-padding", `${px}px`);
  if (typeof scheduleNodeGraphModuleTitleTextFit === "function") {
    scheduleNodeGraphModuleTitleTextFit();
  }
}

function bindNodeUiDevModuleTitlePadding() {
  const input = document.getElementById("nodeUiDevModuleTitlePadding");
  if (input && input.dataset.moduleTitlePaddingBound !== "true") {
    input.dataset.moduleTitlePaddingBound = "true";
    input.addEventListener("input", syncNodeUiDevModuleTitlePadding);
    input.addEventListener("change", syncNodeUiDevModuleTitlePadding);
  }
  syncNodeUiDevModuleTitlePadding();
}

function bindNodeUiDevModuleIdleStroke() {
  // Click a colour's hex text in UI Dev to copy it; the text reads "copied!" for a second.
  if (!document.documentElement.dataset.uiDevHexCopyBound) {
    document.documentElement.dataset.uiDevHexCopyBound = "true";
    document.addEventListener("click", (event) => {
      const out = event.target?.closest?.("output[for]");
      if (!out || !out.closest("#nodeUiDevPanel, .node-ui-dev, [id^='nodeUiDev']")) return;
      const input = document.getElementById(out.getAttribute("for") || "");
      if (input?.type !== "color") return;
      const hex = out.dataset.hexCopyValue || out.textContent.trim();
      if (!/^#[0-9a-f]{3,8}$/i.test(hex)) return;
      out.dataset.hexCopyValue = hex;
      const done = () => {
        out.textContent = "copied!";
        clearTimeout(out._hexCopyTimer);
        out._hexCopyTimer = setTimeout(() => {
          out.textContent = input.value || out.dataset.hexCopyValue;
          delete out.dataset.hexCopyValue;
        }, 1000);
      };
      const fallback = () => {
        const t = document.createElement("textarea");
        t.value = hex; t.style.position = "fixed"; t.style.opacity = "0";
        document.body.appendChild(t); t.select();
        try { document.execCommand("copy"); } catch (_) {}
        t.remove();
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(hex).catch(fallback);
      else fallback();
      done();
    });
  }
  for (const id of ["nodeUiDevModuleTopShape", "nodeUiDevModuleTopRadius", "nodeUiDevModuleStrokeTopRadius", "nodeUiDevModuleBottomShape", "nodeUiDevModuleBottomRadius", "nodeUiDevStrokeAnimate", "nodeUiDevStrokeLoudBrightness", "nodeUiDevStrokeLoudAlpha"]) {
    const input = document.getElementById(id);
    if (!input || input.dataset.moduleCornerBound === "true") continue;
    input.dataset.moduleCornerBound = "true";
    input.addEventListener("input", syncNodeUiDevModuleCorners);
    input.addEventListener("change", syncNodeUiDevModuleCorners);
  }
  syncNodeUiDevModuleCorners();
  for (const id of ["nodeUiDevWireDarkLight", "nodeUiDevWireDotDarkLight", "nodeUiDevWireDotLitLight", "nodeUiDevJackActiveLight", "nodeUiDevJackInactiveLight"]) {
    const input = document.getElementById(id);
    if (!input || input.dataset.wireLightBound === "true") continue;
    input.dataset.wireLightBound = "true";
    input.addEventListener("input", syncNodeUiDevLightingLevels);
    input.addEventListener("change", syncNodeUiDevLightingLevels);
  }
  syncNodeUiDevLightingLevels();
  for (const id of [
    "nodeUiDevModuleStrokeColor",
    "nodeUiDevModuleStrokeAlpha",
    "nodeUiDevModuleSelectedStrokeColor",
    "nodeUiDevModuleSelectedStrokeAlpha",
  ]) {
    const input = document.getElementById(id);
    if (!input || input.dataset.moduleIdleStrokeBound === "true") {
      continue;
    }
    input.dataset.moduleIdleStrokeBound = "true";
    input.addEventListener("input", syncNodeUiDevModuleIdleStroke);
    input.addEventListener("change", syncNodeUiDevModuleIdleStroke);
  }
  syncNodeUiDevModuleIdleStroke();
}

/**
 * Room-dimmer mouse cutout + size/softness/shape.
 * Separate from the big header sync so a missing unrelated control cannot
 * block dimmer updates (same pattern as slider fill colors).
 */
function syncNodeUiDevDimmerCutoutControls() {
  const mouseEl = document.getElementById("nodeUiDevDimmerCutoutMouse");
  const sizeEl = document.getElementById("nodeUiDevDimmerMouseSize");
  const sizeOut = document.getElementById("nodeUiDevDimmerMouseSizeValue");
  const softEl = document.getElementById("nodeUiDevDimmerMouseSoftness");
  const softOut = document.getElementById("nodeUiDevDimmerMouseSoftnessValue");
  const shapeEl = document.getElementById("nodeUiDevDimmerMouseShape");
  const shapeOut = document.getElementById("nodeUiDevDimmerMouseShapeValue");

  let mouseOn = false;
  let size = 56;
  let soft = 25;
  let shape = 0;

  if (mouseEl) mouseOn = Boolean(mouseEl.checked);
  if (sizeEl) {
    size = Math.max(8, Math.min(240, nodeGraphFiniteNumber(sizeEl.value, 56)));
    if (!sizeEl.matches(":active")) sizeEl.value = String(size);
  }
  if (softEl) {
    soft = Math.max(0, Math.min(100, nodeGraphFiniteNumber(softEl.value)));
    if (!softEl.matches(":active")) softEl.value = String(soft);
  }
  if (shapeEl) {
    shape = Math.max(0, Math.min(100, nodeGraphFiniteNumber(shapeEl.value)));
    if (!shapeEl.matches(":active")) shapeEl.value = String(shape);
  }

  if (sizeOut) sizeOut.textContent = `${size}px`;
  if (softOut) softOut.textContent = `${soft}%`;
  if (shapeOut) {
    shapeOut.textContent = shape <= 8
      ? "square"
      : (shape >= 92 ? "circle" : (shape < 55 ? "squircle" : "round"));
  }

  const ws = document.getElementById("nodeGraphWorkspace");
  ws?.classList.toggle("dimmer-cutout-mouse-enabled", mouseOn);

  if (typeof nodeGraphMvp !== "undefined" && nodeGraphMvp) {
    nodeGraphMvp.dimmerCutoutMouseEnabled = mouseOn;
    nodeGraphMvp.dimmerMouseSize = size;
    nodeGraphMvp.dimmerMouseSoftness = soft;
    nodeGraphMvp.dimmerMouseShape = shape;
  }

  if (typeof setNodeGraphDimmerCutoutOptions === "function") {
    setNodeGraphDimmerCutoutOptions({
      mouse: mouseOn,
      mouseSize: size,
      mouseSoftness: soft,
      mouseShape: shape,
    });
  }
}

function applyNodeGraphMagnifierRimLook(thicknessPx = 5, softnessPx = 4) {
  const thickness = Math.max(0, Math.min(24, nodeGraphFiniteNumber(thicknessPx)));
  const softness = Math.max(0, Math.min(32, nodeGraphFiniteNumber(softnessPx)));
  const thickCss = `${thickness}px`;
  const softCss = `${softness}px`;
  const workspace = document.getElementById("nodeGraphWorkspace");
  workspace?.style.setProperty("--magnifier-rim-width", thickCss);
  workspace?.style.setProperty("--magnifier-rim-softness", softCss);
  document.documentElement.style.setProperty("--magnifier-rim-width", thickCss);
  document.documentElement.style.setProperty("--magnifier-rim-softness", softCss);
  document.getElementById("nodeGraphMagnifier")?.style.setProperty("--magnifier-rim-width", thickCss);
  document.getElementById("nodeGraphMagnifier")?.style.setProperty("--magnifier-rim-softness", softCss);
  if (typeof nodeGraphMvp !== "undefined" && nodeGraphMvp) {
    nodeGraphMvp.magnifierBorderThickness = thickness;
    nodeGraphMvp.magnifierBorderSoftness = softness;
  }
}

function syncNodeUiDevMagnifierRimControls() {
  const thickEl = document.getElementById("nodeUiDevMagnifierBorderThickness");
  const thickOut = document.getElementById("nodeUiDevMagnifierBorderThicknessValue");
  const softEl = document.getElementById("nodeUiDevMagnifierBorderSoftness");
  const softOut = document.getElementById("nodeUiDevMagnifierBorderSoftnessValue");
  let thickness = 5;
  let softness = 4;
  if (thickEl) {
    thickness = Math.max(0, Math.min(24, nodeGraphFiniteNumber(thickEl.value)));
    if (!thickEl.matches(":active")) {
      thickEl.value = String(thickness);
    }
  } else if (typeof nodeGraphMvp !== "undefined" && Number.isFinite(Number(nodeGraphMvp?.magnifierBorderThickness))) {
    thickness = Number(nodeGraphMvp.magnifierBorderThickness);
  }
  if (softEl) {
    softness = Math.max(0, Math.min(32, nodeGraphFiniteNumber(softEl.value)));
    if (!softEl.matches(":active")) {
      softEl.value = String(softness);
    }
  } else if (typeof nodeGraphMvp !== "undefined" && Number.isFinite(Number(nodeGraphMvp?.magnifierBorderSoftness))) {
    softness = Number(nodeGraphMvp.magnifierBorderSoftness);
  }
  if (thickOut) {
    thickOut.textContent = `${thickness}px`;
  }
  if (softOut) {
    softOut.textContent = `${softness}px`;
  }
  applyNodeGraphMagnifierRimLook(thickness, softness);
  if (typeof applyNodeGraphMagnifierLayout === "function") {
    applyNodeGraphMagnifierLayout();
  }
}

function nodeGraphGridVisualScaleFromMultiply(multiply) {
  // 1 = a line every module unit. Higher drops lines so each box is N units.
  const n = Math.round(Number(multiply));
  return Number.isFinite(n) ? Math.max(1, Math.min(32, n)) : 16;
}

function syncNodeUiDevGridDivisionMultiply() {
  const input = document.getElementById("nodeUiDevGridDivisionMultiply");
  const raw = Math.round(Number(input?.value));
  const multiply = Number.isFinite(raw) ? Math.max(1, Math.min(32, raw)) : 16;
  if (input) {
    input.value = String(multiply);
  }
  const scale = nodeGraphGridVisualScaleFromMultiply(multiply);
  const output = document.getElementById("nodeUiDevGridDivisionMultiplyValue");
  if (output) {
    output.textContent = `${scale}×`;
  }
  const workspace = document.getElementById("nodeGraphWorkspace");
  const css = String(scale);
  workspace?.style.setProperty("--node-grid-visual-scale", css);
  document.documentElement.style.setProperty("--node-grid-visual-scale", css);
  if (typeof updateNodeGraphGridHeatmap === "function") {
    updateNodeGraphGridHeatmap({ force: true });
  } else if (typeof applyNodeGraphGridVisualCellSize === "function") {
    applyNodeGraphGridVisualCellSize(workspace);
  }
}

function nodeUiDevSyncPortBrightnessControl(inputId, outputId, cssVar, fallback) {
  const input = document.getElementById(inputId);
  const raw = Number(input?.value);
  const brightness = Number.isFinite(raw)
    ? Math.max(0, Math.min(1, raw))
    : fallback;
  if (input) {
    input.value = String(brightness);
  }
  const output = document.getElementById(outputId);
  if (output) {
    output.textContent = brightness.toFixed(2);
  }
  const css = `${Math.round(brightness * 100)}%`;
  const workspace = document.getElementById("nodeGraphWorkspace");
  workspace?.style.setProperty(cssVar, css);
  document.documentElement.style.setProperty(cssVar, css);
}

function syncNodeUiDevPortBrightness() {
  nodeUiDevSyncPortBrightnessControl(
    "nodeUiDevUsedPortBrightness",
    "nodeUiDevUsedPortBrightnessValue",
    "--node-port-used-brightness",
    0.85,
  );
  nodeUiDevSyncPortBrightnessControl(
    "nodeUiDevUnusedPortBrightness",
    "nodeUiDevUnusedPortBrightnessValue",
    "--node-port-unused-brightness",
    0.68,
  );
}

function nodeUiDevApplyJackColorVar(inputId, outputId, cssVar, fallback) {
  const input = document.getElementById(inputId);
  const color = typeof normalizeNodeUiDevColor === "function"
    ? normalizeNodeUiDevColor(input?.value, fallback)
    : (String(input?.value || fallback));
  if (input && input.value !== color) {
    input.value = color;
  }
  const output = document.getElementById(outputId);
  if (output) {
    output.textContent = color;
  }
  const workspace = document.getElementById("nodeGraphWorkspace");
  workspace?.style.setProperty(cssVar, color);
  document.documentElement.style.setProperty(cssVar, color);
  return color;
}

function syncNodeUiDevJackColors() {
  const red = nodeUiDevApplyJackColorVar(
    "nodeUiDevJackRgbRed",
    "nodeUiDevJackRgbRedValue",
    "--node-jack-red",
    "#f25d5d",
  );
  const green = nodeUiDevApplyJackColorVar(
    "nodeUiDevJackRgbGreen",
    "nodeUiDevJackRgbGreenValue",
    "--node-jack-green",
    "#3ddc84",
  );
  const blue = nodeUiDevApplyJackColorVar(
    "nodeUiDevJackRgbBlue",
    "nodeUiDevJackRgbBlueValue",
    "--node-jack-blue",
    "#4d8dff",
  );
  const analog = nodeUiDevApplyJackColorVar(
    "nodeUiDevJackAnalog",
    "nodeUiDevJackAnalogValue",
    "--node-output-fill",
    "#e2a86d",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackDigital",
    "nodeUiDevJackDigitalValue",
    "--node-digital-fill",
    "#ffffff",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackGold",
    "nodeUiDevJackGoldValue",
    "--node-jack-gold",
    "#f0b84a",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackParameter",
    "nodeUiDevJackParameterValue",
    "--node-jack-cyan",
    "#00e5ff",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackGraph",
    "nodeUiDevJackGraphValue",
    "--node-jack-yellow",
    "#ffe600",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackModulation",
    "nodeUiDevJackModulationValue",
    "--node-mod-input-fill",
    "#b184ff",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackVoices",
    "nodeUiDevJackVoicesValue",
    "--node-jack-black",
    "#6a6a6a",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackPurple",
    "nodeUiDevJackPurpleValue",
    "--node-jack-purple",
    "#c44dff",
  );
  nodeUiDevApplyJackColorVar(
    "nodeUiDevJackMagenta",
    "nodeUiDevJackMagentaValue",
    "--node-jack-magenta",
    "#e040fb",
  );
  const workspace = document.getElementById("nodeGraphWorkspace");
  const root = document.documentElement;
  const modulationColor = document.getElementById("nodeUiDevJackModulation")
    ? (typeof normalizeNodeUiDevColor === "function"
      ? normalizeNodeUiDevColor(document.getElementById("nodeUiDevJackModulation").value, "#b184ff")
      : "#b184ff")
    : "#b184ff";
  const setBoth = (name, value) => {
    workspace?.style.setProperty(name, value);
    root.style.setProperty(name, value);
  };
  setBoth("--node-input-fill", analog);
  setBoth("--node-input-stroke", analog);
  setBoth("--node-output-stroke", analog);
  setBoth("--node-inlet-blue-stroke", analog);
  workspace?.style.removeProperty("--node-port-idle-crescent-stroke");
  root.style.removeProperty("--node-port-idle-crescent-stroke");
  workspace?.style.removeProperty("--node-port-idle-stroke");
  root.style.removeProperty("--node-port-idle-stroke");
  workspace?.style.removeProperty("--node-port-crescent-stroke");
  root.style.removeProperty("--node-port-crescent-stroke");
  setBoth("--node-mod-input-stroke", modulationColor);
  setBoth("--node-param-output-fill", modulationColor);
  setBoth("--node-param-output-stroke", modulationColor);
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires();
  }
  const fillIn = document.getElementById("nodeUiDevInputFillColor");
  const fillOut = document.getElementById("nodeUiDevOutputFillColor");
  if (fillIn) fillIn.value = analog;
  if (fillOut) fillOut.value = analog;
  const strokeIn = document.getElementById("nodeUiDevInputStrokeColor");
  const strokeOut = document.getElementById("nodeUiDevOutputStrokeColor");
  if (strokeIn) strokeIn.value = analog;
  if (strokeOut) strokeOut.value = analog;
  void red;
  void green;
  void blue;
}

function nodeUiDevSpreadRatioFromPercent(value, fallback = 78) {
  const raw = Number(value);
  const percent = Number.isFinite(raw) ? raw : fallback;
  return Math.max(0.4, Math.min(2.2, Math.max(40, Math.min(220, percent)) / 100));
}

function syncNodeUiDevModuleLightGridControls() {
  const lightBrightEl = document.getElementById("nodeUiDevModuleLightBrightness");
  const lightSpreadEl = document.getElementById("nodeUiDevModuleLightSpread");
  const gridBrightEl = document.getElementById("nodeUiDevMinimumGridBrightness");
  const gridSpreadEl = document.getElementById("nodeUiDevGridSpread");
  const lightBrightOut = document.getElementById("nodeUiDevModuleLightBrightnessValue");
  const lightSpreadOut = document.getElementById("nodeUiDevModuleLightSpreadValue");
  const gridBrightOut = document.getElementById("nodeUiDevMinimumGridBrightnessValue");
  const gridSpreadOut = document.getElementById("nodeUiDevGridSpreadValue");

  // 100% is the default look; up to 300% for a much stronger module light.
  const lightBright = Math.max(0, Math.min(300, nodeGraphFiniteNumber(lightBrightEl?.value, 100)));
  // Module light spread: 10% (a tight rim) up to 220%.
  const lightSpread = Math.max(10, Math.min(220, nodeGraphFiniteNumber(lightSpreadEl?.value, 10)));
  const gridBright = Math.max(0, Math.min(100, nodeGraphFiniteNumber(gridBrightEl?.value, 43)));
  const gridSpread = Math.max(40, Math.min(220, nodeGraphFiniteNumber(gridSpreadEl?.value, 220)));

  if (lightBrightOut) lightBrightOut.textContent = `${lightBright}%`;
  if (lightSpreadOut) lightSpreadOut.textContent = `${lightSpread}%`;
  if (gridBrightOut) gridBrightOut.textContent = `${gridBright}%`;
  if (gridSpreadOut) gridSpreadOut.textContent = `${gridSpread}%`;

  const ws = document.getElementById("nodeGraphWorkspace");
  ws?.style.setProperty("--node-module-light-brightness", String(lightBright / 100));
  ws?.style.setProperty("--node-module-light-spread", String(Math.max(0.1, Math.min(2.2, lightSpread / 100))));
  ws?.style.setProperty("--node-grid-line-alpha", String(gridBright / 100));
  ws?.style.setProperty("--node-grid-reveal-spread", String(nodeUiDevSpreadRatioFromPercent(gridSpread)));
  // Never paint a full-workspace grid. Reveal is radius-around-modules only.
  ws?.style.setProperty("--node-min-grid-brightness-alpha", "0");
  document.getElementById("nodeWiringPanel")?.style.setProperty("--node-min-grid-brightness-alpha", "0");

  if (typeof updateNodeGraphGridHeatmap === "function") {
    updateNodeGraphGridHeatmap({ force: true });
  }
  // The module lights and the grid are drawn on the GPU: rebuild the scene so it picks the values up.
  if (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState) {
    nodeGraphGlGraphState.gen = (nodeGraphGlGraphState.gen || 0) + 1;
    if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
  }
}

function bindNodeUiDevModuleLightGridControls() {
  for (const id of [
    "nodeUiDevModuleLightBrightness",
    "nodeUiDevModuleLightSpread",
    "nodeUiDevMinimumGridBrightness",
    "nodeUiDevGridSpread",
  ]) {
    const input = document.getElementById(id);
    if (!input || input.dataset.lightGridBound === "true") {
      continue;
    }
    input.dataset.lightGridBound = "true";
    input.addEventListener("input", syncNodeUiDevModuleLightGridControls);
    input.addEventListener("change", syncNodeUiDevModuleLightGridControls);
  }
  syncNodeUiDevModuleLightGridControls();
}

function syncNodeUiDevSettingsHeaderControls() {
  // Runs before the early-return guard below so the slider fill colors apply
  // even if some unrelated control is absent from the DOM.
  syncNodeUiDevSliderFillColorControls();
  if (typeof syncNodeUiDevSnakeSelectColor === "function") {
    syncNodeUiDevSnakeSelectColor();
  }
  if (typeof syncNodeUiDevWiresFollowPortColors === "function") {
    syncNodeUiDevWiresFollowPortColors();
  }
  syncNodeUiDevModuleIdleStroke();
  syncNodeUiDevModuleTitlePadding();
  syncNodeUiDevDimmerCutoutControls();
  syncNodeUiDevMagnifierRimControls();
  syncNodeUiDevPortBrightness();
  syncNodeUiDevLightingLevels();
  syncNodeUiDevJackColors();
  if (typeof syncNodeUiDevFullyOpaqueWires === "function") {
    syncNodeUiDevFullyOpaqueWires();
  }
  if (typeof syncNodeUiDevPixelateWiresOnZoom === "function") {
    syncNodeUiDevPixelateWiresOnZoom();
  }
  if (typeof syncNodeUiDevPixelateWireDotsOnZoom === "function") {
    syncNodeUiDevPixelateWireDotsOnZoom();
  }
  if (typeof syncNodeUiDevWireDotShadows === "function") {
    syncNodeUiDevWireDotShadows();
  }
  syncNodeUiDevGridDivisionMultiply();
  syncNodeUiDevModuleLightGridControls();
  const settingsView = document.getElementById("nodeSettingsView");
  const mouseLightEnabledInput = document.getElementById("nodeUiDevMouseLightEnabled");
  const showOriginMarkerInput = document.getElementById("nodeUiDevShowOriginMarker");
  const tooltipTextSizeInput = document.getElementById("nodeUiDevTooltipTextSize");
  const tooltipTextSizeValue = document.getElementById("nodeUiDevTooltipTextSizeValue");
  const minimumGridBrightnessInput = document.getElementById("nodeUiDevMinimumGridBrightness");
  const minimumGridBrightnessValue = document.getElementById("nodeUiDevMinimumGridBrightnessValue");
  const moduleLightSpreadInput = document.getElementById("nodeUiDevModuleLightSpread");
  const moduleLightSpreadValue = document.getElementById("nodeUiDevModuleLightSpreadValue");
  const moduleGridInsetInput = document.getElementById("nodeUiDevModuleGridInset");
  const moduleGridInsetValue = document.getElementById("nodeUiDevModuleGridInsetValue");
  const gridColorInput = document.getElementById("nodeUiDevGridColor");
  const gridColorValue = document.getElementById("nodeUiDevGridColorValue");
  const workspaceBackgroundColorInput = document.getElementById("nodeUiDevWorkspaceBackgroundColor");
  const workspaceBackgroundColorValue = document.getElementById("nodeUiDevWorkspaceBackgroundColorValue");
  const moduleFillColorInput = document.getElementById("nodeUiDevModuleFillColor");
  const moduleFillColorValue = document.getElementById("nodeUiDevModuleFillColorValue");
  const moduleFillAlphaInput = document.getElementById("nodeUiDevModuleFillAlpha");
  const moduleFillAlphaValue = document.getElementById("nodeUiDevModuleFillAlphaValue");
  const moduleTitleFillColorInput = document.getElementById("nodeUiDevModuleTitleFillColor");
  const moduleTitleFillColorValue = document.getElementById("nodeUiDevModuleTitleFillColorValue");
  const sliderLabelColorInput = document.getElementById("nodeUiDevSliderLabelColor");
  const sliderLabelColorValue = document.getElementById("nodeUiDevSliderLabelColorValue");
  const sliderValueColorInput = document.getElementById("nodeUiDevSliderValueColor");
  const sliderValueColorValue = document.getElementById("nodeUiDevSliderValueColorValue");
  const sliderUnitColorInput = document.getElementById("nodeUiDevSliderUnitColor");
  const sliderUnitColorValue = document.getElementById("nodeUiDevSliderUnitColorValue");
  const choiceSlideEmptyBorderInput = document.getElementById("nodeUiDevChoiceSlideEmptyBorder");
  const choiceSlideEmptyBorderValue = document.getElementById("nodeUiDevChoiceSlideEmptyBorderValue");
  const choiceSlideDebugBoxesInput = document.getElementById("nodeUiDevChoiceSlideDebugBoxes");
  const bypassIconSizeInput = document.getElementById("nodeUiDevBypassIconSize");
  const bypassIconSizeValue = document.getElementById("nodeUiDevBypassIconSizeValue");
  const bypassIconPreview = document.getElementById("nodeUiDevBypassIconPreview");
  const bypassIconGlowSpreadInput = document.getElementById("nodeUiDevBypassIconGlowSpread");
  const bypassIconGlowSpreadValue = document.getElementById("nodeUiDevBypassIconGlowSpreadValue");
  const bypassIconGlowColorInput = document.getElementById("nodeUiDevBypassIconGlowColor");
  const bypassIconGlowColorValue = document.getElementById("nodeUiDevBypassIconGlowColorValue");
  const bypassIconOnColorInput = document.getElementById("nodeUiDevBypassIconOnColor");
  const bypassIconOnColorValue = document.getElementById("nodeUiDevBypassIconOnColorValue");
  const bypassOnBackgroundColorInput = document.getElementById("nodeUiDevBypassOnBackgroundColor");
  const bypassOnBackgroundColorValue = document.getElementById("nodeUiDevBypassOnBackgroundColorValue");
  const bypassOffBackgroundColorInput = document.getElementById("nodeUiDevBypassOffBackgroundColor");
  const bypassOffBackgroundColorValue = document.getElementById("nodeUiDevBypassOffBackgroundColorValue");
  if (typeof syncNodeUiDevModuleRoundness === "function") {
    syncNodeUiDevModuleRoundness();
  }
  if (typeof scheduleNodeUiDevSettingsAutosave === "function") {
    scheduleNodeUiDevSettingsAutosave();
  }
  if (
    !settingsView ||
    !mouseLightEnabledInput ||
    !showOriginMarkerInput ||
    !tooltipTextSizeInput ||
    !tooltipTextSizeValue ||
    !minimumGridBrightnessInput ||
    !minimumGridBrightnessValue ||
    !moduleLightSpreadInput ||
    !moduleLightSpreadValue ||
    !gridColorInput ||
    !gridColorValue ||
    !workspaceBackgroundColorInput ||
    !workspaceBackgroundColorValue ||
    !moduleFillColorInput ||
    !moduleFillColorValue ||
    !moduleFillAlphaInput ||
    !moduleFillAlphaValue ||
    !sliderLabelColorInput ||
    !sliderLabelColorValue ||
    !sliderValueColorInput ||
    !sliderValueColorValue ||
    !sliderUnitColorInput ||
    !sliderUnitColorValue ||
    !choiceSlideDebugBoxesInput ||
    !bypassIconSizeInput ||
    !bypassIconSizeValue ||
    !bypassIconPreview ||
    !bypassIconGlowSpreadInput ||
    !bypassIconGlowSpreadValue ||
    !bypassIconGlowColorInput ||
    !bypassIconGlowColorValue ||
    !bypassIconOnColorInput ||
    !bypassIconOnColorValue ||
    !bypassOnBackgroundColorInput ||
    !bypassOnBackgroundColorValue ||
    !bypassOffBackgroundColorInput ||
    !bypassOffBackgroundColorValue
  ) {
    return;
  }

  const mouseLightEnabled = Boolean(mouseLightEnabledInput.checked);
  const showOriginMarker = Boolean(showOriginMarkerInput.checked);
  // UIDEV minimum tip size. fitNodeInteractionHelpText uses this as the floor.
  const tooltipTextSizePx = Math.max(12, Math.min(96, nodeGraphFiniteNumber(tooltipTextSizeInput.value, 12)));
  const minimumGridBrightnessPercent = Math.max(
    0,
    Math.min(100, nodeGraphFiniteNumber(minimumGridBrightnessInput.value)),
  );
  const moduleLightSpreadPercent = Math.max(40, Math.min(220, nodeGraphFiniteNumber(moduleLightSpreadInput.value, 78)));
  const moduleGridInsetPx = moduleGridInsetInput
    ? Math.max(0, Math.min(20, nodeGraphFiniteNumber(moduleGridInsetInput.value)))
    : null;
  const gridColor = normalizeNodeUiDevColor(gridColorInput.value, "#ffffff");
  const workspaceBackgroundColor = normalizeNodeUiDevColor(workspaceBackgroundColorInput.value, "#19191a");
  const moduleFillColor = normalizeNodeUiDevColor(moduleFillColorInput.value, "#171a1f");
  const moduleTitleFillColor = normalizeNodeUiDevColor(moduleTitleFillColorInput?.value, "#030113");
  const moduleFillAlphaRaw = Number(moduleFillAlphaInput.value);
  const moduleFillAlphaPercent = Math.max(
    0,
    Math.min(100, Number.isFinite(moduleFillAlphaRaw) ? moduleFillAlphaRaw : 100),
  );
  const sliderLabelColor = normalizeNodeUiDevColor(sliderLabelColorInput.value, "#cfdde5");
  const sliderValueColor = normalizeNodeUiDevColor(sliderValueColorInput.value, "#ffffff");
  const sliderUnitColor = normalizeNodeUiDevColor(sliderUnitColorInput.value, "#7fc7d9");
  const choiceSlideEmptyBorderPx = choiceSlideEmptyBorderInput
    ? Math.max(0, Math.min(8, nodeGraphFiniteNumber(choiceSlideEmptyBorderInput.value)))
    : null;
  const bypassIconSizePercent = Math.max(0, Math.min(100, nodeGraphFiniteNumber(bypassIconSizeInput.value)));
  const bypassIconGlowSpreadPercent = Math.max(
    0,
    Math.min(200, nodeGraphFiniteNumber(bypassIconGlowSpreadInput.value)),
  );
  const bypassIconGlowColor = normalizeNodeUiDevColor(bypassIconGlowColorInput.value, "#f25d5d");
  const bypassIconOnColor = normalizeNodeUiDevColor(bypassIconOnColorInput.value, "#f7b758");
  const bypassOnBackgroundColor = normalizeNodeUiDevColor(bypassOnBackgroundColorInput.value, "#5c1818");
  const bypassOffBackgroundColor = normalizeNodeUiDevColor(bypassOffBackgroundColorInput.value, "#000000");
  document
    .getElementById("nodeWiringPanel")
    ?.style.setProperty("--node-tooltip-text-size", `${tooltipTextSizePx}px`);
  if (typeof fitNodeInteractionHelpText === "function") {
    fitNodeInteractionHelpText(document.getElementById("nodeInteractionHelp"));
  }
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-mouse-light-amount", mouseLightEnabled ? "0.79" : "0");
  document
    .getElementById("nodeGraphWorkspace")
    ?.classList.toggle("origin-marker-visible", showOriginMarker);
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-mouse-light-spread", "0.05");
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-mouse-light-color-rgb", "127 199 217");
  if (moduleGridInsetPx != null) {
    document
      .getElementById("nodeGraphWorkspace")
      ?.style.setProperty("--node-module-grid-inset", `${moduleGridInsetPx}px`);
  }
  gridColorInput.value = gridColor;
  workspaceBackgroundColorInput.value = workspaceBackgroundColor;
  moduleFillColorInput.value = moduleFillColor;
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-grid-color-rgb", nodeUiDevHexColorToRgbTriplet(gridColor));
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-workspace-bg", workspaceBackgroundColor);
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty(
      "--node-module-fill",
      `rgb(${nodeUiDevHexColorToRgbTriplet(moduleFillColor)} / ${moduleFillAlphaPercent / 100})`,
    );
  if (moduleTitleFillColorInput) {
    moduleTitleFillColorInput.value = moduleTitleFillColor;
    document
      .getElementById("nodeGraphWorkspace")
      ?.style.setProperty("--node-module-title-fill", moduleTitleFillColor);
  }
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.removeProperty("--node-slider-readout-height");
  sliderLabelColorInput.value = sliderLabelColor;
  sliderValueColorInput.value = sliderValueColor;
  sliderUnitColorInput.value = sliderUnitColor;
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-slider-label-color", sliderLabelColor);
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-slider-value-color", sliderValueColor);
  document
    .getElementById("nodeGraphWorkspace")
    ?.style.setProperty("--node-slider-unit-color", sliderUnitColor);
  if (choiceSlideEmptyBorderPx != null) {
    document
      .getElementById("nodeGraphWorkspace")
      ?.style.setProperty("--node-choice-slide-empty-border", `${choiceSlideEmptyBorderPx}`);
  }
  document
    .getElementById("nodeWiringPanel")
    ?.classList.toggle("choice-slider-debug", choiceSlideDebugBoxesInput.checked);
  // B-048: Apply bypass chrome vars on #nodeWiringPanel so Module Settings
  // (sibling of workspace) inherits the same black/red/glow SSOT as module face.
  {
    const bypassChromeHost = document.getElementById("nodeWiringPanel")
      || document.getElementById("nodeGraphWorkspace");
    bypassChromeHost?.style.setProperty("--node-bypass-icon-size-ratio", String(bypassIconSizePercent / 100));
    bypassChromeHost?.style.setProperty("--node-bypass-icon-glow-spread-ratio", String(bypassIconGlowSpreadPercent / 100));
    bypassChromeHost?.style.setProperty("--node-bypass-icon-glow-color", bypassIconGlowColor);
    bypassChromeHost?.style.setProperty("--node-bypass-icon-on-color", bypassIconOnColor);
    bypassChromeHost?.style.setProperty("--node-bypass-on-bg", bypassOnBackgroundColor);
    bypassChromeHost?.style.setProperty("--node-bypass-off-bg", bypassOffBackgroundColor);
  }
  tooltipTextSizeValue.textContent = `${tooltipTextSizePx}px`;
  minimumGridBrightnessValue.textContent = `${minimumGridBrightnessPercent}%`;
  moduleLightSpreadValue.textContent = `${moduleLightSpreadPercent}%`;
  if (moduleGridInsetValue) moduleGridInsetValue.textContent = `${moduleGridInsetPx}px`;
  gridColorValue.textContent = gridColor;
  workspaceBackgroundColorValue.textContent = workspaceBackgroundColor;
  moduleFillColorValue.textContent = moduleFillColor;
  moduleFillAlphaValue.textContent = `${moduleFillAlphaPercent}%`;
  if (moduleTitleFillColorValue) moduleTitleFillColorValue.textContent = moduleTitleFillColor;
  sliderLabelColorValue.textContent = sliderLabelColor;
  sliderValueColorValue.textContent = sliderValueColor;
  sliderUnitColorValue.textContent = sliderUnitColor;
  const sliderTextSizeInput = document.getElementById("nodeUiDevSliderTextSize");
  const sliderTextLineInput = document.getElementById("nodeUiDevSliderTextLineHeight");
  const sliderTextPadInput = document.getElementById("nodeUiDevSliderTextPadding");
  const sliderTextSize = Math.max(8, Math.min(32, nodeGraphFiniteNumber(sliderTextSizeInput?.value, 13)));
  const sliderTextLine = Math.max(0.6, Math.min(2, nodeGraphFiniteNumber(sliderTextLineInput?.value, 0.9)));
  const sliderTextPad = Math.max(0, Math.min(16, nodeGraphFiniteNumber(sliderTextPadInput?.value, 0)));
  const sliderTextHost = document.getElementById("nodeGraphWorkspace");
  sliderTextHost?.style.setProperty("--node-slider-text-size", `${sliderTextSize}px`);
  sliderTextHost?.style.setProperty("--node-slider-text-line-height", String(sliderTextLine));
  sliderTextHost?.style.setProperty("--node-slider-text-padding", `${sliderTextPad}px`);
  const sliderTextSizeValue = document.getElementById("nodeUiDevSliderTextSizeValue");
  const sliderTextLineValue = document.getElementById("nodeUiDevSliderTextLineHeightValue");
  const sliderTextPadValue = document.getElementById("nodeUiDevSliderTextPaddingValue");
  if (sliderTextSizeValue) sliderTextSizeValue.textContent = `${sliderTextSize}px`;
  if (sliderTextLineValue) sliderTextLineValue.textContent = String(sliderTextLine);
  if (sliderTextPadValue) sliderTextPadValue.textContent = `${sliderTextPad}px`;
  // Signal wires (jack to jack) width and end-dot diameter.
  const wireThick = Math.max(0.5, Math.min(12, nodeGraphFiniteNumber(document.getElementById("nodeUiDevWireThickness")?.value, 3)));
  sliderTextHost?.style.setProperty("--node-wire-thickness", `${wireThick}px`);
  const wireThickValue = document.getElementById("nodeUiDevWireThicknessValue");
  if (wireThickValue) wireThickValue.textContent = `${wireThick}px`;
  // Default 7.86 is the locked signal wire end-dot size.
  const wireDot = Math.max(0, Math.min(12, nodeGraphFiniteNumber(document.getElementById("nodeUiDevWirePatchPointSize")?.value, 7.86)));
  sliderTextHost?.style.setProperty("--node-wire-patch-point-size", `${wireDot}px`);
  const wireDotValue = document.getElementById("nodeUiDevWirePatchPointSizeValue");
  if (wireDotValue) wireDotValue.textContent = `${wireDot}px`;
  // Param wire gradient dip: darkening depth / width at the crossfade midpoint.
  for (const [id, cssVar] of [["nodeUiDevWireDip", "--node-wire-dip"], ["nodeUiDevWireDipWidth", "--node-wire-dip-width"]]) {
    const v = Math.max(0, Math.min(1, nodeGraphFiniteNumber(document.getElementById(id)?.value, id === "nodeUiDevWireDip" ? 0.35 : 0.5)));
    sliderTextHost?.style.setProperty(cssVar, String(v));
    const out = document.getElementById(id + "Value");
    if (out) out.textContent = String(v);
  }
  // Param wires (ending on a rail IO box) keep their own width and end dot.
  const paramWireThick = Math.max(0.5, Math.min(6, nodeGraphFiniteNumber(document.getElementById("nodeUiDevParamWireThickness")?.value, 1)));
  const paramWireDot = Math.max(0, Math.min(12, nodeGraphFiniteNumber(document.getElementById("nodeUiDevParamWireDotSize")?.value, 3.3)));
  sliderTextHost?.style.setProperty("--node-param-wire-thickness", `${paramWireThick}px`);
  sliderTextHost?.style.setProperty("--node-param-wire-dot-size", `${paramWireDot}px`);
  const paramWireThickValue = document.getElementById("nodeUiDevParamWireThicknessValue");
  const paramWireDotValue = document.getElementById("nodeUiDevParamWireDotSizeValue");
  if (paramWireThickValue) paramWireThickValue.textContent = `${paramWireThick}px`;
  if (paramWireDotValue) paramWireDotValue.textContent = `${paramWireDot}px`;
  if (typeof nodeGraphGlGraphState === "object") {
    nodeGraphGlGraphState.thick = 0;
  }
  if (typeof drawNodeGraphWires === "function") drawNodeGraphWires();
  if (choiceSlideEmptyBorderValue) choiceSlideEmptyBorderValue.textContent = `${choiceSlideEmptyBorderPx}px`;
  bypassIconSizeValue.textContent = `${bypassIconSizePercent}%`;
  bypassIconGlowSpreadValue.textContent = `${bypassIconGlowSpreadPercent}%`;
  bypassIconGlowColorInput.value = bypassIconGlowColor;
  bypassIconGlowColorValue.textContent = bypassIconGlowColor;
  bypassIconOnColorInput.value = bypassIconOnColor;
  bypassIconOnColorValue.textContent = bypassIconOnColor;
  bypassOnBackgroundColorInput.value = bypassOnBackgroundColor;
  bypassOnBackgroundColorValue.textContent = bypassOnBackgroundColor;
  bypassOffBackgroundColorInput.value = bypassOffBackgroundColor;
  bypassOffBackgroundColorValue.textContent = bypassOffBackgroundColor;
  bypassIconPreview.style.setProperty(
    "--node-ui-dev-symbol-preview-size",
    String(bypassIconSizePercent / 100),
  );
  bypassIconPreview.style.setProperty(
    "--node-ui-dev-bypass-preview-size",
    String(bypassIconSizePercent / 100),
  );
  bypassIconPreview.style.setProperty(
    "--node-ui-dev-bypass-preview-glow-spread",
    String(bypassIconGlowSpreadPercent / 100),
  );
  bypassIconPreview.style.setProperty("--node-ui-dev-bypass-preview-glow-color", bypassIconGlowColor);
  bypassIconPreview.style.setProperty("--node-ui-dev-bypass-preview-on-color", bypassIconOnColor);
  bypassIconPreview.style.setProperty("--node-ui-dev-bypass-preview-bg", bypassOnBackgroundColor);
  syncNodeUserUiSettingsMirrorControls();
  applyNodeGraphPatchToDom();
  updateNodeGraphGridHeatmap();
  drawNodeGraphWires();
  scheduleNodeSettingsHeaderTextFit();
  scheduleNodeLiveToggleTextFit();
}
