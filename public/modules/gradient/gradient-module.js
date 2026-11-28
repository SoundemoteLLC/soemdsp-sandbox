// Gradient module (HP-23): plays one patch gradient (node.gradientId) at audio rate. Playhead = the Playhead knob + In (cables sum);
// Out passes In straight through (a thru). The engine side is graph_engine.cpp process_gradient + the gradient lanes
// (public/node-graph-gradient-lanes.js). Its knob and the 🌈 page playhead are one value: gradient.position.
//
// Face: WebGL strip, stop colors, read-only selected-param curve, stops, playhead and gradient name. Drag uses the shared Playhead slider
// gesture; double-click resets it. No curve editing, hover effects or polling.

const NODE_GRAPH_GRADIENT_MODULE_TYPE = "gradient";
const NODE_GRAPH_GRADIENT_DISPLAY_DEFAULTS = Object.freeze({ playheadAlpha: 1, playheadColor: "#ffffff", playheadThickness: 2 });

function normalizeNodeGraphGradientDisplaySettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  const n = (key, fallback, min, max) => Number.isFinite(Number(source[key]))
    ? Math.max(min, Math.min(max, Number(source[key])))
    : fallback;
  const color = /^#[0-9a-f]{6}$/i.test(String(source.playheadColor || "")) ? source.playheadColor.toLowerCase() : "#ffffff";
  return { playheadAlpha: n("playheadAlpha", 1, 0, 1), playheadColor: color, playheadThickness: n("playheadThickness", 2, 0, 8) };
}

function nodeGraphGradientDisplaySettingsForNode(node) {
  return normalizeNodeGraphGradientDisplaySettings(node?.traceDisplaySettings);
}

function buildNodeGraphGradientDisplaySettingsBodyHtml() {
  const row = (key, label, min, max, step) => `<label class="metadata-field-row" data-trace-display-control-row><span class="metadata-field-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-gradient-display-setting="${key}"></label>`;
  return `<div data-gradient-display-settings-panel>${row("playheadAlpha", "Playhead Alpha", 0, 1, 0.01)}<label class="metadata-field-row" data-trace-display-control-row><span class="metadata-field-label">Playhead Color</span><input type="color" data-gradient-display-setting="playheadColor"></label>${row("playheadThickness", "Playhead Thickness", 0, 8, 0.1)}</div>`;
}

function syncNodeGraphGradientDisplaySettingsControls(root, settings) {
  const panel = root?.querySelector?.("[data-gradient-display-settings-panel]") || root;
  const value = normalizeNodeGraphGradientDisplaySettings(settings);
  for (const key of Object.keys(NODE_GRAPH_GRADIENT_DISPLAY_DEFAULTS)) {
    const input = panel?.querySelector?.(`[data-gradient-display-setting="${key}"]`);
    if (input) input.value = String(value[key]);
  }
}

function bindNodeGraphGradientDisplaySettingsBody(host) {
  if (!host || host.dataset.gradientDisplaySettingsBound === "true") return;
  host.dataset.gradientDisplaySettingsBound = "true";
  const apply = (persist, record) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") markNodeGraphTraceDisplaySettingsDirty("*");
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") applyNodeGraphTraceDisplaySettingsForm({ persist, record, commit: record });
  };
  host.addEventListener("input", (event) => { if (event.target?.closest?.("[data-gradient-display-setting]")) apply("none", false); });
  host.addEventListener("change", (event) => { if (event.target?.closest?.("[data-gradient-display-setting]")) apply("debounce", true); });
}

function readNodeGraphGradientDisplaySettingsForm(root, current) {
  const panel = root?.querySelector?.("[data-gradient-display-settings-panel]") || root;
  const next = { ...normalizeNodeGraphGradientDisplaySettings(current) };
  for (const key of Object.keys(NODE_GRAPH_GRADIENT_DISPLAY_DEFAULTS)) {
    const input = panel?.querySelector?.(`[data-gradient-display-setting="${key}"]`);
    if (input) next[key] = key === "playheadColor" ? input.value : Number(input.value);
  }
  return normalizeNodeGraphGradientDisplaySettings(next);
}

function applyNodeGraphGradientDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const face = document.querySelector(`.node-gradient-module-face[data-node="${CSS.escape(String(node.id))}"]`);
  if (face) { face._gradientForceDraw = true; drawNodeGraphGradientModuleFace(face); }
}

function nodeGraphGradientModuleGradient(node) {
  const id = String(node?.gradientId || "");
  const list = Array.isArray(nodeGraphMvp?.patch?.gradients) ? nodeGraphMvp.patch.gradients : [];
  return id ? list.find((g) => g && g.id === id) || null : null;
}

function nodeGraphGradientModuleHueRgba(i, alpha = 1) {
  // hsl(i * 137.5, 55%, 50%) as on the page strip.
  const h = ((i * 137.5) % 360) / 360;
  const s = 0.55;
  const l = 0.5;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3), alpha];
}

function nodeGraphGradientModuleStopRgba(stop, i) {
  const hex = String(stop?.color || "");
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return nodeGraphGradientModuleHueRgba(i);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1];
}

function nodeGraphGradientModuleSettings(node) {
  const settings = node?.traceDisplaySettings || {};
  const color = /^#[0-9a-f]{6}$/i.test(String(settings.playheadColor || "")) ? settings.playheadColor : "#ffffff";
  const n = Number.parseInt(color.slice(1), 16);
  return {
    alpha: Math.max(0, Math.min(1, Number.isFinite(Number(settings.playheadAlpha)) ? Number(settings.playheadAlpha) : 1)),
    color: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255],
    thickness: Math.max(0, Math.min(8, Number.isFinite(Number(settings.playheadThickness)) ? Number(settings.playheadThickness) : 2)),
  };
}

function drawNodeGraphGradientModuleFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.(".node-display-face");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const gradient = nodeGraphGradientModuleGradient(node);
  const pos = gradient ? Math.max(0, Math.min(1, NodeGraphGradients.positionOf(gradient))) : 0;
  // Repaint only when the strip, the name or the playhead changed.
  const settings = nodeGraphGradientModuleSettings(node);
  const curveParam = gradient
    ? (typeof nodeGraphGradientSelectedParam === "function" ? nodeGraphGradientSelectedParam(gradient) : gradient.params?.[0] || null)
    : null;
  const curveParamId = curveParam ? `${curveParam.nodeId}.${curveParam.key}` : "";
  const curveSignature = curveParam ? gradient.stops.map((stop) => JSON.stringify([
    stop.pos,
    stop.offsets?.[curveParam.nodeId]?.[curveParam.key] || 0,
    stop.curves?.[curveParam.nodeId]?.[curveParam.key] || null,
  ])).join("|") : "";
  const sig = gradient
    ? `${w}x${h}|${gradient.id}|${gradient.name}|${pos.toFixed(4)}|${gradient.stops.map((s) => `${s.pos}:${s.color || ""}`).join(",")}|${curveParamId}|${curveSignature}|${settings.alpha}|${settings.color}|${settings.thickness}`
    : `${w}x${h}|none`;
  if (sig === section._gradientSig && !section._gradientForceDraw) return;
  section._gradientSig = sig;
  section._gradientForceDraw = false;
  const batch = nodeGraphGlLinesBegin(canvas, [0.02, 0.03, 0.05, 1], { scale: pixelRatio, textInk: false });
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "gradient: no shared GL device");
    return;
  }
  const pad = Math.max(4, w * 0.05);
  const textPx = Math.max(8, Math.min(h * 0.3, 13));
  const stripTop = pad + textPx + pad * 0.5;
  const stripH = Math.max(4, h - stripTop - pad);
  const stripW = Math.max(4, w - 2 * pad);
  if (gradient) {
    const stops = [...gradient.stops].sort((x, y) => x.pos - y.pos);
    // The strip: columns blended between the neighbouring stops' hues (the page's linear-gradient).
    const cols = Math.max(2, Math.min(Math.round(stripW), 256));
    for (let c = 0; c < cols; c += 1) {
      const x = c / (cols - 1);
      let i = 0;
      while (i < stops.length - 1 && stops[i + 1].pos <= x) i += 1;
      const ca = nodeGraphGradientModuleStopRgba(stops[i], i);
      const cb = nodeGraphGradientModuleStopRgba(stops[Math.min(stops.length - 1, i + 1)], Math.min(stops.length - 1, i + 1));
      const span = i < stops.length - 1 ? stops[i + 1].pos - stops[i].pos : 0;
      const t = span > 0 ? Math.max(0, Math.min(1, (x - stops[i].pos) / span)) : 0;
      nodeGraphGlLinesRect(batch, pad + (c / cols) * stripW, stripTop, stripW / cols + 0.5, stripH,
        [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t, 1]);
    }
    if (curveParam && stops.length > 1) {
      const points = [];
      const offset = (stop) => Number(stop.offsets?.[curveParam.nodeId]?.[curveParam.key]) || 0;
      for (let i = 0; i + 1 < stops.length; i += 1) {
        const a = stops[i], b = stops[i + 1];
        const curve = NodeGraphGradients.curveOf(a, curveParam.nodeId, curveParam.key);
        const start = i ? 1 : 0;
        for (let j = start; j <= 24; j += 1) {
          const t = j / 24;
          const shaped = nodeGraphSegmentCurve01(t, curve.shape, curve.skew);
          const value = offset(a) + (offset(b) - offset(a)) * shaped;
          const px = pad + ((a.pos + (b.pos - a.pos) * t)) * stripW;
          const py = stripTop + stripH * (0.5 - Math.max(-1, Math.min(1, value)) * 0.42);
          points.push(px, py);
        }
      }
      if (points.length >= 4) nodeGraphGlLinesPolyline(batch, points, 0.85, 0.7, [1, 1, 1, 0.92]);
    }
    for (const stop of stops) {
      const x = pad + stop.pos * stripW;
      const value = curveParam ? Number(stop.offsets?.[curveParam.nodeId]?.[curveParam.key]) || 0 : 0;
      const y = stripTop + stripH * (0.5 - Math.max(-1, Math.min(1, value)) * 0.42);
      nodeGraphGlLinesRect(batch, x - 2, y - 2, 4, 4, [1, 1, 1, 0.95]);
    }
    // The playhead: the per-module look is patch state in traceDisplaySettings.
    if (settings.thickness > 0) nodeGraphGlLinesRect(batch, pad + pos * stripW - settings.thickness * 0.5, stripTop - 2,
      settings.thickness, stripH + 4, [...settings.color, settings.alpha]);
  }
  nodeGraphGlLinesText(batch, gradient ? gradient.name : "No gradient", pad, pad + textPx * 0.5, {
    px: textPx, rgba: [0.95, 0.96, 1, 1], align: "left", baseline: "middle", weight: 600,
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "gradient: GL present failed");
  }
}

function bindNodeGraphGradientModulePlayheadSurface(section, nodeId) {
  if (!section) return;
  if (typeof nodeGraphSliderForParameter !== "function") return;
  const slider = nodeGraphSliderForParameter(nodeId, "playhead");
  if (!slider?.id) return;
  section.dataset.sliderTarget = slider.id;
  section.dataset.sliderDragSurface = "vertical";
  section.dataset.sliderTypeIn = "reset";
  if (section.dataset.sliderDragBound === "true") return;
  if (typeof bindNodeSliderDragSurface === "function") bindNodeSliderDragSurface(section);
}

function nodeGraphGradientModuleActions(section, nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  let actions = section.querySelector(".node-gradient-module-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "node-gradient-module-actions";
    for (const action of ["toggleEdit", "snapshot"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.gradientAction = action;
      button.addEventListener("click", () => {
        const id = button.dataset.gradientId;
        if (id && typeof nodeGraphGradientPageAction === "function") nodeGraphGradientPageAction(action, id, button);
        nodeGraphGradientModuleActions(section, nodeId);
      });
      actions.append(button);
    }
    section.append(actions);
  }
  const id = String(node?.gradientId || "");
  const editing = Boolean(id && typeof nodeGraphGradientPageIsEditing === "function" && nodeGraphGradientPageIsEditing(id));
  for (const button of actions.querySelectorAll("button")) {
    button.dataset.gradientId = id;
    if (button.dataset.gradientAction === "toggleEdit") {
      button.textContent = editing ? "Edit On" : "Edit Off";
      button.setAttribute("aria-pressed", editing ? "true" : "false");
      button.setAttribute("aria-label", "Gradient edit mode");
    } else {
      button.textContent = "Snapshot";
      button.disabled = !id || editing;
      button.setAttribute("aria-label", "Gradient snapshot");
    }
    button.disabled = button.dataset.gradientAction === "toggleEdit" ? !id : button.disabled;
  }
}

function nodeGraphGradientModuleSyncActions() {
  for (const section of document.querySelectorAll(".node-gradient-module-face")) {
    nodeGraphGradientModuleActions(section, section.dataset.node || "");
  }
}

function createNodeGraphGradientModuleFace(nodeId, type = NODE_GRAPH_GRADIENT_MODULE_TYPE) {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-gradient-module-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || NODE_GRAPH_GRADIENT_MODULE_TYPE);
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-gradient-module-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `gradient:${el.dataset?.node || ""}`,
    forceKey: "_gradientForceDraw",
    rafKey: "_gradientRaf",
    paint: drawNodeGraphGradientModuleFace,
    onResize: (el) => {
      el._gradientForceDraw = true;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
    },
    paintOnCreate: false,
  });
  // A parameter change (the Playhead knob) repaints through the shared parameter-visual contract.
  section.syncFromParameters = () => {
    nodeGraphGradientModuleActions(section, id);
    bindNodeGraphGradientModulePlayheadSurface(section, id);
    section._gradientForceDraw = true;
    drawNodeGraphGradientModuleFace(section);
  };
  requestAnimationFrame(() => requestAnimationFrame(() => {
    nodeGraphGradientModuleActions(section, id);
    bindNodeGraphGradientModulePlayheadSurface(section, id);
    section._gradientForceDraw = true;
    drawNodeGraphGradientModuleFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.gradientFace = () => {};
}
Object.assign(globalThis, {
  NODE_GRAPH_GRADIENT_DISPLAY_DEFAULTS,
  normalizeNodeGraphGradientDisplaySettings,
  nodeGraphGradientDisplaySettingsForNode,
  buildNodeGraphGradientDisplaySettingsBodyHtml,
  syncNodeGraphGradientDisplaySettingsControls,
  bindNodeGraphGradientDisplaySettingsBody,
  nodeGraphGradientModuleSyncActions,
  readNodeGraphGradientDisplaySettingsForm,
  applyNodeGraphGradientDisplaySettingsToFace,
});
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("gradientFace", createNodeGraphGradientModuleFace);
}

/** The playhead or the gradient moved: repaint the faces of the modules playing it (events only). */
function nodeGraphGradientModuleNoteMoved() {
  for (const face of document.querySelectorAll(".node-gradient-module-face")) drawNodeGraphGradientModuleFace(face);
}

/**
 * The Playhead knob is gradient.position (slider intercept, node-graph-slider-dragging.js): one value for the knob and the page.
 * A drag moves one engine knob (no param resync); the release is one undo step.
 */
function nodeGraphGradientModuleInterceptSlider(slider, domainValue, options = {}) {
  if (!slider || String(slider.dataset?.param || "") !== "playhead") return false;
  const nodeId = slider.closest?.(".dsp-node")?.dataset?.node || "";
  const node = nodeId ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== NODE_GRAPH_GRADIENT_MODULE_TYPE) return false;
  const gradient = nodeGraphGradientModuleGradient(node);
  const value = Number(domainValue);
  if (!gradient || !Number.isFinite(value)) return false;
  if (typeof nodeGraphGradientPageSetPlayhead === "function") {
    nodeGraphGradientPageSetPlayhead(gradient, value, { bypassSnap: options.bypassGradientSnap === true });
    slider.dataset.domainValue = String(gradient.position);
    slider.value = String(gradient.position);
  } else {
    gradient.position = value;
    slider.dataset.domainValue = String(value);
    if (typeof nodeGraphGradientsNotifyPlayhead === "function") nodeGraphGradientsNotifyPlayhead(gradient, `${gradient.name} position`);
    if (typeof nodeGraphGradientPageUpdateLive === "function") nodeGraphGradientPageUpdateLive(gradient);
    nodeGraphGradientModuleNoteMoved();
  }
  if (options.commit && typeof recordNodeGraphHistory === "function") recordNodeGraphHistory();
  return true;
}

// A typed Playhead value (or undo / load) lands in the module's param: the gradient follows its module (module wins), events only.
if (typeof addNodeGraphPatchCommitListener === "function") {
  addNodeGraphPatchCommitListener(() => {
    for (const node of nodeGraphMvp?.patch?.nodes || []) {
      if (node?.type !== NODE_GRAPH_GRADIENT_MODULE_TYPE) continue;
      const gradient = nodeGraphGradientModuleGradient(node);
      const knob = Number(node.params?.playhead);
      if (gradient && Number.isFinite(knob) && gradient.position !== knob) gradient.position = knob;
    }
    nodeGraphGradientModuleNoteMoved();
  });
}
