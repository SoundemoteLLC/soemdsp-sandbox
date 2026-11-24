// Pitch Mod Wheel face: the first display-only module. The WebGL face is the
// control (docs/APP_POLICY.md section 3): there are no DOM wheel graphics.
//
// Look: two recessed wheel slots (Pitch, Mod) drawn by the shared controller
// kit (modules/_shared/controller-face-gl.js, kind "wheel"): a rolling ridged
// wheel, a fill from the zero point to the value, a grip line at the value, a
// center detent tick on a bipolar range and the modulation ghost.
//
// Input stays in DOM: one transparent hit element per wheel, laid over the
// drawn slot. Dragging a wheel writes its parameter through the shared slider
// path (setNodeSliderValue / commitNodeSliderDragValue), so the parameter's
// own range, curve and smoothing are the only limits. Each pointer drives its
// own wheel, so two fingers can work both wheels at once.
//
// Spring return (Display Settings, per module): on release a spring wheel goes
// back to its parameter default (Pitch springs by default, Mod holds).
//
// Wire drops: each hit element carries data-face-param-drop, so a cable
// dropped on a wheel lands on that parameter's MOD inlet (node-graph-module-face.js
// nodeGraphModuleFaceHitBoxes -> node-graph-wires.js).
//
// Right-click: the face is a display, so it opens Display Settings. For this
// face that page is one merged panel: a Parameter section on top (the real
// Parameter Settings form for the wheel under the pointer, moved in while the
// page shows it) and the Display section (colors, spring) below.
//
// No hover text.

const NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS = Object.freeze(["pitch", "mod"]);

const NODE_GRAPH_PITCH_MOD_WHEEL_DISPLAY_DEFAULTS = Object.freeze({
  backgroundColor: "#05080b",
  wheelColor: "#2a3036",
  fillColor: "#7fc7d9",
  textColor: "#f3f1ec",
  springPitch: true,
  springMod: false,
});

const NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_FIELDS = Object.freeze([
  "backgroundColor",
  "wheelColor",
  "fillColor",
  "textColor",
]);

const NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_LABELS = Object.freeze({
  backgroundColor: "Background",
  wheelColor: "Wheel",
  fillColor: "Fill",
  textColor: "Text",
});

const NODE_GRAPH_PITCH_MOD_WHEEL_SPRING_FIELDS = Object.freeze({
  pitch: "springPitch",
  mod: "springMod",
});

function nodeGraphPitchModWheelNormalizeHex(value, fallback) {
  const raw = String(value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return fallback;
}

function nodeGraphPitchModWheelNormalizeBool(value, fallback) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

/** Display Settings bag (node.traceDisplaySettings). Old patches carry none: defaults. */
function normalizeNodeGraphPitchModWheelFaceSettings(settings) {
  const d = NODE_GRAPH_PITCH_MOD_WHEEL_DISPLAY_DEFAULTS;
  const src = settings && typeof settings === "object" ? settings : {};
  const out = {};
  for (const key of NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_FIELDS) {
    out[key] = nodeGraphPitchModWheelNormalizeHex(src[key], d[key]);
  }
  out.springPitch = nodeGraphPitchModWheelNormalizeBool(src.springPitch, d.springPitch);
  out.springMod = nodeGraphPitchModWheelNormalizeBool(src.springMod, d.springMod);
  return out;
}

function nodeGraphPitchModWheelDisplaySettingsForNode(node) {
  return normalizeNodeGraphPitchModWheelFaceSettings(node?.traceDisplaySettings);
}

function nodeGraphPitchModWheelPatchNode(nodeId) {
  return typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(String(nodeId || "")) : null;
}

/** The wheel's parameter slider (hidden row; the one value path for every control). */
function nodeGraphPitchModWheelSlider(nodeId, key) {
  if (typeof document === "undefined" || !nodeId || !key) return null;
  return document.getElementById(`node-${nodeId}-${key}`);
}

function nodeGraphPitchModWheelParamDefinition(key) {
  const defs = typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions : null;
  const list = defs?.pitchModWheel?.parameters;
  return Array.isArray(list) ? (list.find((p) => p && p.key === key) || null) : null;
}

function nodeGraphPitchModWheelLabel(slider, key) {
  if (slider && typeof nodeSliderLabelText === "function") {
    const text = String(nodeSliderLabelText(slider) || "").trim();
    if (text) return text;
  }
  return String(nodeGraphPitchModWheelParamDefinition(key)?.label || key);
}

function nodeGraphPitchModWheelTravel(slider, value) {
  if (!slider || !Number.isFinite(Number(value))) return 0;
  const t = typeof nodeSliderTravelFromValue === "function"
    ? Number(nodeSliderTravelFromValue(slider, Number(value)))
    : NaN;
  if (Number.isFinite(t)) return Math.max(0, Math.min(1, t));
  const min = Number(slider.min);
  const max = Number(slider.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0;
  return Math.max(0, Math.min(1, (Number(value) - min) / (max - min)));
}

/** Value under a 0..1 travel (bottom = 0), through the parameter's own curve and step. */
function nodeGraphPitchModWheelValueFromTravel(slider, travel) {
  const t = Math.max(0, Math.min(1, Number(travel) || 0));
  let value = typeof nodeSliderValueFromRelativeTravel === "function"
    ? Number(nodeSliderValueFromRelativeTravel(slider, t))
    : NaN;
  if (!Number.isFinite(value)) {
    const min = Number(slider?.min);
    const max = Number(slider?.max);
    value = Number.isFinite(min) && Number.isFinite(max) ? min + (max - min) * t : NaN;
  }
  if (Number.isFinite(value) && typeof quantizeNodeSliderDragValue === "function") {
    value = Number(quantizeNodeSliderDragValue(slider, value));
  }
  return value;
}

function nodeGraphPitchModWheelValue(nodeId, key, slider) {
  const domain = Number(slider?.dataset?.domainValue);
  if (Number.isFinite(domain)) return domain;
  const raw = Number(nodeGraphPitchModWheelPatchNode(nodeId)?.params?.[key]);
  if (Number.isFinite(raw)) return raw;
  const def = Number(nodeGraphPitchModWheelParamDefinition(key)?.defaultValue);
  return Number.isFinite(def) ? def : 0;
}

/** Draw state of one wheel: value / zero / ghost in travel units, texts. */
function nodeGraphPitchModWheelState(nodeId, key) {
  const slider = nodeGraphPitchModWheelSlider(nodeId, key);
  const value = nodeGraphPitchModWheelValue(nodeId, key, slider);
  const min = Number(slider?.min);
  const max = Number(slider?.max);
  const bipolar = Number.isFinite(min) && Number.isFinite(max) && Math.min(min, max) < 0 && Math.max(min, max) > 0;
  const unit = nodeGraphPitchModWheelTravel(slider, value);
  const zero = bipolar ? nodeGraphPitchModWheelTravel(slider, 0) : 0;
  const sent = Number(slider?.dataset?.sentDomainValue);
  let ghost = null;
  if (slider && Number.isFinite(sent) && Math.abs(sent - value) > 1e-9) {
    ghost = nodeGraphPitchModWheelTravel(slider, sent);
    if (Math.abs(ghost - unit) < 1e-4) ghost = null;
  }
  let valueText = "";
  if (slider && typeof nodeSliderReadoutValueText === "function") {
    valueText = String(nodeSliderReadoutValueText(slider) ?? "").trim();
  } else if (Number.isFinite(value)) {
    valueText = value.toFixed(3);
  }
  return {
    key,
    label: nodeGraphPitchModWheelLabel(slider, key),
    unit,
    zero,
    ghost,
    bipolar,
    valueText,
    active: false,
  };
}

/** Paint one face. Cheap when nothing changed (the kit skips identical frames). */
function paintNodeGraphPitchModWheelFace(face) {
  if (!face?.isConnected || typeof nodeGraphControllerFacePaint !== "function") return;
  const nodeId = String(face.dataset.node || "");
  const patchNode = nodeGraphPitchModWheelPatchNode(nodeId);
  const s = nodeGraphPitchModWheelDisplaySettingsForNode(patchNode);
  const drags = face._wheelDrags || new Map();
  const wheels = NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS.map((key) => {
    const state = nodeGraphPitchModWheelState(nodeId, key);
    for (const drag of drags.values()) {
      if (drag.key === key) state.active = true;
    }
    return state;
  });
  const model = {
    settings: { count: wheels.length },
    background: s.backgroundColor,
    wheel: s.wheelColor,
    fill: s.fillColor,
    text: s.textColor,
    wheels,
  };
  const hits = face._wheelHits || [];
  face._ctrlLayout = nodeGraphControllerFacePaint(face, "wheel", model, (L) => {
    hits.forEach((hit, i) => nodeGraphControllerFacePlace(hit, L.rects.wheels[i] || null, L.w, L.h));
  }) || face._ctrlLayout;
  if (typeof nodeGraphKnobFaceSyncLightSource === "function") {
    nodeGraphKnobFaceSyncLightSource(face, true);
  }
}

function syncNodeGraphPitchModWheelFace(nodeId) {
  if (typeof document === "undefined") return;
  const id = String(nodeId || "");
  const selector = id
    ? `.node-pitch-mod-wheel-face[data-node="${CSS.escape(id)}"]`
    : ".node-pitch-mod-wheel-face";
  for (const face of document.querySelectorAll(selector)) {
    paintNodeGraphPitchModWheelFace(face);
  }
}

// ---------------------------------------------------------------- input

function nodeGraphPitchModWheelSpring(nodeId, key) {
  const field = NODE_GRAPH_PITCH_MOD_WHEEL_SPRING_FIELDS[key];
  if (!field) return false;
  const s = nodeGraphPitchModWheelDisplaySettingsForNode(nodeGraphPitchModWheelPatchNode(nodeId));
  return s[field] === true;
}

function nodeGraphPitchModWheelSetFromPointer(drag, event) {
  const rect = drag.hit.getBoundingClientRect();
  if (!(rect.height > 0)) return;
  const travel = 1 - (event.clientY - rect.top) / rect.height;
  const value = nodeGraphPitchModWheelValueFromTravel(drag.slider, travel);
  if (!Number.isFinite(value) || typeof setNodeSliderValue !== "function") return;
  setNodeSliderValue(drag.slider, value, { interaction: "drag" });
  drag.moved = true;
}

function nodeGraphPitchModWheelCommit(slider, status) {
  if (typeof commitNodeSliderDragValue === "function") {
    commitNodeSliderDragValue(slider, status);
  }
}

function beginNodeGraphPitchModWheelDrag(face, event) {
  const hit = event.target?.closest?.("[data-pitch-mod-wheel-param]");
  if (!hit || !face.contains(hit)) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) return;
  const key = hit.dataset.pitchModWheelParam;
  const slider = nodeGraphPitchModWheelSlider(face.dataset.node, key);
  if (!slider) return;
  event.preventDefault();
  event.stopPropagation();
  if (!face._wheelDrags) face._wheelDrags = new Map();
  for (const other of face._wheelDrags.values()) {
    if (other.key === key) return;
  }
  const drag = { key, slider, hit, pointerId: event.pointerId, moved: false };
  face._wheelDrags.set(event.pointerId, drag);
  try { hit.setPointerCapture(event.pointerId); } catch (_) { /* synthetic events */ }
  nodeGraphPitchModWheelSetFromPointer(drag, event);
  paintNodeGraphPitchModWheelFace(face);
}

function moveNodeGraphPitchModWheelDrag(face, event) {
  const drag = face._wheelDrags?.get(event.pointerId);
  if (!drag) return;
  event.preventDefault();
  event.stopPropagation();
  nodeGraphPitchModWheelSetFromPointer(drag, event);
  paintNodeGraphPitchModWheelFace(face);
}

function endNodeGraphPitchModWheelDrag(face, event) {
  const drag = face._wheelDrags?.get(event.pointerId);
  if (!drag) return;
  face._wheelDrags.delete(event.pointerId);
  try { drag.hit.releasePointerCapture?.(event.pointerId); } catch (_) { /* already released */ }
  const nodeId = face.dataset.node;
  const label = nodeGraphPitchModWheelLabel(drag.slider, drag.key).toLowerCase();
  if (nodeGraphPitchModWheelSpring(nodeId, drag.key)) {
    const reset = typeof nodeSliderCtrlClickDefaultValue === "function"
      ? Number(nodeSliderCtrlClickDefaultValue(drag.slider))
      : Number(nodeGraphPitchModWheelParamDefinition(drag.key)?.defaultValue);
    if (Number.isFinite(reset) && typeof setNodeSliderValue === "function") {
      setNodeSliderValue(drag.slider, reset, { interaction: "drag" });
    }
    nodeGraphPitchModWheelCommit(drag.slider, `${label} wheel returned`);
  } else {
    nodeGraphPitchModWheelCommit(drag.slider, `${label} wheel`);
  }
  paintNodeGraphPitchModWheelFace(face);
}

/** Right-click: remember which wheel the merged panel's Parameter section edits. */
function noteNodeGraphPitchModWheelContext(face, event) {
  const hit = event.target?.closest?.("[data-pitch-mod-wheel-param]");
  const key = hit?.dataset?.pitchModWheelParam
    || nodeGraphPitchModWheelKeyAtClientX(face, event.clientX)
    || "pitch";
  const nodeId = String(face.dataset.node || "");
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.pitchModWheelSettingsParam = { nodeId, key };
  }
  // Panel already open on this module: switch its Parameter section now.
  const embed = nodeGraphPitchModWheelParamEmbed;
  if (embed.grid && embed.nodeId === nodeId && embed.key !== key && embed.host?.isConnected) {
    embedNodeGraphPitchModWheelParamSettings(embed.host, nodeId, key);
  }
}

function nodeGraphPitchModWheelKeyAtClientX(face, clientX) {
  const rect = face.getBoundingClientRect();
  if (!(rect.width > 0)) return "";
  const i = Math.floor(((clientX - rect.left) / rect.width) * NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS.length);
  return NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS[Math.max(0, Math.min(NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS.length - 1, i))];
}

function createNodeGraphPitchModWheelFace(nodeIdOrEl, _type) {
  const nodeId = nodeIdOrEl && typeof nodeIdOrEl === "object"
    ? String(nodeIdOrEl.dataset?.node || nodeIdOrEl.id || "")
    : String(nodeIdOrEl || "");
  const face = document.createElement("div");
  // node-face: the graph keeps native pointer/context events on module faces
  // (nodeGraphGlHitKeepsNativeTarget), so drags reach the wheel, not the module.
  face.className = "node-face node-module-scope-window node-controller-gl-face node-pitch-mod-wheel-face";
  face.dataset.node = nodeId;
  face.dataset.nodeType = "pitchModWheel";
  face.dataset.lightSource = "screen";
  face.dataset.lightStrength = "1";
  face.setAttribute("aria-label", "Pitch and mod wheels");
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(face, "face");
  }
  face._wheelHits = NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS.map((key) => {
    const hit = document.createElement("span");
    hit.className = "node-controller-face-hit node-pitch-mod-wheel-hit";
    hit.dataset.pitchModWheelParam = key;
    hit.dataset.faceParamDrop = key;
    hit.setAttribute("role", "slider");
    hit.setAttribute("aria-label", `${key === "pitch" ? "Pitch" : "Mod"} wheel`);
    face.append(hit);
    return hit;
  });
  face._wheelDrags = new Map();
  if (typeof nodeGraphControllerFaceCanvas === "function") {
    nodeGraphControllerFaceCanvas(face);
  }
  face.addEventListener("pointerdown", (event) => beginNodeGraphPitchModWheelDrag(face, event));
  face.addEventListener("pointermove", (event) => moveNodeGraphPitchModWheelDrag(face, event));
  face.addEventListener("pointerup", (event) => endNodeGraphPitchModWheelDrag(face, event));
  face.addEventListener("pointercancel", (event) => endNodeGraphPitchModWheelDrag(face, event));
  face.addEventListener("lostpointercapture", (event) => endNodeGraphPitchModWheelDrag(face, event));
  face.addEventListener("contextmenu", (event) => noteNodeGraphPitchModWheelContext(face, event), true);
  if (typeof nodeGraphControllerFaceObserve === "function") {
    nodeGraphControllerFaceObserve(face, () => paintNodeGraphPitchModWheelFace(face));
  }
  // Repaint while on screen: modulation moves the ghost without any input.
  let rafId = 0;
  let onScreen = typeof IntersectionObserver !== "function";
  const tick = () => {
    rafId = 0;
    if (!face.isConnected || !onScreen) return;
    paintNodeGraphPitchModWheelFace(face);
    rafId = requestAnimationFrame(tick);
  };
  const arm = () => {
    if (!rafId && onScreen) rafId = requestAnimationFrame(tick);
  };
  if (typeof IntersectionObserver === "function") {
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) arm();
    });
    io.observe(face);
  }
  requestAnimationFrame(() => {
    paintNodeGraphPitchModWheelFace(face);
    arm();
  });
  return face;
}

// ---------------------------------------------------------------- merged panel
//
// The Parameter section is the real Parameter Settings form: its grid is
// moved out of #nodeParameterMetadataPopover into this panel while it shows,
// filled for the wheel's slider, and moved home again before any other page
// (or another display body) needs it. Its controls are found by id, so the
// same code edits them in either place; the popover-level listeners are
// forwarded from the host.

const nodeGraphPitchModWheelParamEmbed = {
  grid: null,
  home: null,
  homeNext: null,
  host: null,
  nodeId: "",
  key: "",
  observer: null,
};

function restoreNodeGraphPitchModWheelParamEmbed() {
  const embed = nodeGraphPitchModWheelParamEmbed;
  const { grid, home, homeNext } = embed;
  embed.grid = null;
  embed.host = null;
  embed.nodeId = "";
  embed.key = "";
  if (!grid || !home) return false;
  if (grid.parentNode !== home) {
    home.insertBefore(grid, homeNext && homeNext.parentNode === home ? homeNext : null);
  }
  return true;
}

function nodeGraphPitchModWheelWatchParamPopover(popover) {
  const embed = nodeGraphPitchModWheelParamEmbed;
  if (!popover || embed.observer || typeof MutationObserver !== "function") return;
  // Parameter Settings opening on its own page takes its form back.
  embed.observer = new MutationObserver(() => {
    if (!popover.hidden && embed.grid) restoreNodeGraphPitchModWheelParamEmbed();
  });
  embed.observer.observe(popover, { attributes: true, attributeFilter: ["hidden"] });
}

function bindNodeGraphPitchModWheelParamHost(host) {
  if (!host || host.dataset.pitchModWheelParamBound === "true") return;
  host.dataset.pitchModWheelParamBound = "true";
  if (typeof bindNodeGraphSettingsTextInputProtection === "function") {
    bindNodeGraphSettingsTextInputProtection(host);
  }
  const forwardInput = (event) => {
    if (typeof handleNodeMetadataEditorInput === "function") handleNodeMetadataEditorInput(event);
    // Display Settings must not read Parameter fields as its own.
    event.stopPropagation();
  };
  host.addEventListener("input", forwardInput);
  host.addEventListener("change", forwardInput);
  host.addEventListener("click", (event) => {
    if (typeof stepNodeMetadataField === "function") stepNodeMetadataField(event);
    if (typeof clickNodeMetadataSmoothingModeButton === "function") clickNodeMetadataSmoothingModeButton(event);
  });
}

function embedNodeGraphPitchModWheelParamSettings(host, nodeId, keyOpt = "") {
  if (!host || typeof document === "undefined") return false;
  const id = String(nodeId || "");
  const chosen = typeof nodeGraphMvp === "object" ? nodeGraphMvp?.pitchModWheelSettingsParam : null;
  const key = NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS.includes(keyOpt)
    ? keyOpt
    : (chosen?.nodeId === id && NODE_GRAPH_PITCH_MOD_WHEEL_PARAMS.includes(chosen.key) ? chosen.key : "pitch");
  const slider = nodeGraphPitchModWheelSlider(id, key);
  const embed = nodeGraphPitchModWheelParamEmbed;
  const popover = document.getElementById("nodeParameterMetadataPopover");
  const grid = embed.grid || popover?.querySelector(":scope > .metadata-popover-grid");
  if (!slider || !grid || typeof fillNodeMetadataPopover !== "function") return false;
  if (typeof bindNodeGraphMetadataPopoverEvents === "function") bindNodeGraphMetadataPopoverEvents();
  if (nodeGraphMvp.metadataEditorTarget
    && nodeGraphMvp.metadataEditorTarget !== slider.id
    && typeof confirmNodeMetadataScriptDiscard === "function"
    && !confirmNodeMetadataScriptDiscard()) {
    return false;
  }
  if (!embed.grid) {
    embed.grid = grid;
    embed.home = popover;
    embed.homeNext = grid.nextSibling;
    nodeGraphPitchModWheelWatchParamPopover(popover);
  }
  nodeGraphMvp.metadataEditorTarget = slider.id;
  fillNodeMetadataPopover(slider);
  grid.hidden = false;
  if (grid.parentNode !== host) host.append(grid);
  embed.host = host;
  embed.nodeId = id;
  embed.key = key;
  bindNodeGraphPitchModWheelParamHost(host);
  return true;
}

// ---------------------------------------------------------------- display settings

function buildNodeGraphPitchModWheelDisplaySettingsBodyHtml() {
  const type = "pitchModWheelFace";
  const colorRow = (key) => (typeof nodeGraphDisplaySettingsBuildColorRowHtml === "function"
    ? nodeGraphDisplaySettingsBuildColorRowHtml(key, type)
    : "");
  const rows = NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_FIELDS.map(colorRow);
  const spring = (field, label) => `
        <label class="metadata-checkbox-label">
          <input type="checkbox" data-pitch-mod-wheel-setting="${field}">
          <span>${label}</span>
        </label>`;
  return `
    <div data-pitch-mod-wheel-display-settings-panel>
      <div class="metadata-section-title">Parameter</div>
      <div class="node-parameter-metadata-popover node-pitch-mod-wheel-param-embed" data-pitch-mod-wheel-param-host></div>
      <div class="metadata-section-title">Display</div>
      <div class="metadata-field-section">${typeof nodeGraphDisplaySettingsColorRows === "function"
        ? nodeGraphDisplaySettingsColorRows(rows, [2, 2])
        : rows.join("")}</div>
      <div class="metadata-section-title">Spring</div>
      <div class="metadata-field-section node-pitch-mod-wheel-spring-rows">${spring("springPitch", "Pitch returns")}${spring("springMod", "Mod returns")}
      </div>
    </div>`;
}

function syncNodeGraphPitchModWheelDisplaySettingsControls(root, settings) {
  if (!root || !settings) return;
  const s = normalizeNodeGraphPitchModWheelFaceSettings(settings);
  const panel = root.querySelector?.("[data-pitch-mod-wheel-display-settings-panel]") || root;
  for (const key of NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_FIELDS) {
    const input = panel?.querySelector?.(`[data-trace-display-color="${key}"]`);
    if (input) input.value = s[key];
  }
  for (const field of Object.values(NODE_GRAPH_PITCH_MOD_WHEEL_SPRING_FIELDS)) {
    const input = panel?.querySelector?.(`[data-pitch-mod-wheel-setting="${field}"]`);
    if (input) input.checked = s[field] === true;
  }
}

function bindNodeGraphPitchModWheelDisplaySettingsBody(host, node = null) {
  if (!host) return;
  const paramHost = host.querySelector?.("[data-pitch-mod-wheel-param-host]");
  const nodeId = String(node?.id || (typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
    ? nodeGraphTraceDisplaySettingsTargetNodeId()
    : "") || "");
  if (paramHost && nodeId) {
    embedNodeGraphPitchModWheelParamSettings(paramHost, nodeId);
  }
  if (host.dataset.pitchModWheelSettingsBound === "true") return;
  host.dataset.pitchModWheelSettingsBound = "true";
  const apply = (persist, record) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty("*");
    }
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") {
      applyNodeGraphTraceDisplaySettingsForm({ persist, record, commit: record });
    }
  };
  const isOwn = (event) => event.target?.closest?.("[data-trace-display-color], [data-pitch-mod-wheel-setting]")
    && !event.target?.closest?.("[data-pitch-mod-wheel-param-host]");
  host.addEventListener("input", (event) => {
    if (isOwn(event) && event.target.type !== "checkbox") apply("none", false);
  });
  host.addEventListener("change", (event) => {
    if (isOwn(event)) apply("immediate", true);
  });
}

function readNodeGraphPitchModWheelDisplaySettingsForm(root, current) {
  const panel = root?.querySelector?.("[data-pitch-mod-wheel-display-settings-panel]") || root;
  const next = { ...(current && typeof current === "object" ? current : {}) };
  for (const key of NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_FIELDS) {
    const input = panel?.querySelector?.(`[data-trace-display-color="${key}"]`);
    if (input && input.value) next[key] = input.value;
  }
  for (const field of Object.values(NODE_GRAPH_PITCH_MOD_WHEEL_SPRING_FIELDS)) {
    const input = panel?.querySelector?.(`[data-pitch-mod-wheel-setting="${field}"]`);
    if (input) next[field] = Boolean(input.checked);
  }
  return normalizeNodeGraphPitchModWheelFaceSettings(next);
}

function applyNodeGraphPitchModWheelDisplaySettingsToFace(node) {
  const id = String(node?.id || "").trim();
  if (id) syncNodeGraphPitchModWheelFace(id);
}

function nodeGraphPitchModWheelColorLabel(key) {
  return NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_LABELS[key] || "";
}

if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, {
    NODE_GRAPH_PITCH_MOD_WHEEL_DISPLAY_DEFAULTS,
    NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_FIELDS,
    NODE_GRAPH_PITCH_MOD_WHEEL_COLOR_LABELS,
    normalizeNodeGraphPitchModWheelFaceSettings,
    nodeGraphPitchModWheelDisplaySettingsForNode,
    nodeGraphPitchModWheelColorLabel,
    nodeGraphPitchModWheelState,
    nodeGraphPitchModWheelValueFromTravel,
    paintNodeGraphPitchModWheelFace,
    syncNodeGraphPitchModWheelFace,
    createNodeGraphPitchModWheelFace,
    embedNodeGraphPitchModWheelParamSettings,
    restoreNodeGraphPitchModWheelParamEmbed,
    buildNodeGraphPitchModWheelDisplaySettingsBodyHtml,
    syncNodeGraphPitchModWheelDisplaySettingsControls,
    bindNodeGraphPitchModWheelDisplaySettingsBody,
    readNodeGraphPitchModWheelDisplaySettingsForm,
    applyNodeGraphPitchModWheelDisplaySettingsToFace,
  });
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.pitchModWheelFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("pitchModWheelFace", createNodeGraphPitchModWheelFace);
}
