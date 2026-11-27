// Gradient module (HP-23): plays one patch gradient (node.gradientId) at audio rate. Playhead = the Playhead knob + In (cables sum);
// Out passes In straight through (a thru). The engine side is graph_engine.cpp process_gradient + the gradient lanes
// (public/node-graph-gradient-lanes.js). Its knob and the 🌈 page playhead are one value: gradient.position.
//
// Face: the gradient's strip (one hue per stop, as on the page) with the playhead where it sounds, and the gradient's name. Tap the
// display to play the next gradient (one undo step). WebGL only, no hover, moves only when the playhead or the gradient changes.

const NODE_GRAPH_GRADIENT_MODULE_TYPE = "gradient";

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
  const sig = gradient
    ? `${w}x${h}|${gradient.id}|${gradient.name}|${pos.toFixed(4)}|${gradient.stops.map((s) => s.pos).join(",")}`
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
      const ca = nodeGraphGradientModuleHueRgba(i);
      const cb = nodeGraphGradientModuleHueRgba(Math.min(stops.length - 1, i + 1));
      const span = i < stops.length - 1 ? stops[i + 1].pos - stops[i].pos : 0;
      const t = span > 0 ? Math.max(0, Math.min(1, (x - stops[i].pos) / span)) : 0;
      nodeGraphGlLinesRect(batch, pad + (c / cols) * stripW, stripTop, stripW / cols + 0.5, stripH,
        [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t, 1]);
    }
    // The playhead: a white line where the gradient sounds.
    nodeGraphGlLinesRect(batch, pad + pos * stripW - 1, stripTop - 2, 2, stripH + 4, [1, 1, 1, 1]);
  }
  nodeGraphGlLinesText(batch, gradient ? gradient.name : "No gradient", pad, pad + textPx * 0.5, {
    px: textPx, rgba: [0.95, 0.96, 1, 1], align: "left", baseline: "middle", weight: 600,
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "gradient: GL present failed");
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
  section.syncFromParameters = () => { section._gradientForceDraw = true; drawNodeGraphGradientModuleFace(section); };
  requestAnimationFrame(() => requestAnimationFrame(() => {
    section._gradientForceDraw = true;
    drawNodeGraphGradientModuleFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.gradientFace = () => {};
}
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
  gradient.position = value;
  slider.dataset.domainValue = String(value);
  if (typeof nodeGraphGradientsNotifyPlayhead === "function") nodeGraphGradientsNotifyPlayhead(gradient, `${gradient.name} position`);
  if (typeof nodeGraphGradientPageUpdateLive === "function") nodeGraphGradientPageUpdateLive(gradient);
  nodeGraphGradientModuleNoteMoved();
  if (options.commit && typeof recordNodeGraphHistory === "function") recordNodeGraphHistory();
  return true;
}

/** Tap a Gradient module's display: play the next gradient of the patch (one undo step). */
function nodeGraphGradientModuleCycle(nodeId) {
  const node = nodeGraphPatchNode(nodeId);
  const list = Array.isArray(nodeGraphMvp?.patch?.gradients) ? nodeGraphMvp.patch.gradients : [];
  if (!node || !list.length) return;
  const at = list.findIndex((g) => g.id === node.gradientId);
  node.gradientId = list[(at + 1) % list.length].id;
  const gradient = nodeGraphGradientModuleGradient(node);
  node.params = { ...(node.params || {}), playhead: Number(gradient?.position) || 0 };
  if (typeof recordNodeGraphHistory === "function") recordNodeGraphHistory();
  if (typeof scheduleNodeGraphLiveParameterSync === "function") scheduleNodeGraphLiveParameterSync();
  nodeGraphGradientModuleNoteMoved();
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const screen = event.target?.closest?.(".node-gradient-module-face");
    const nodeEl = screen?.closest?.(".dsp-node");
    if (!nodeEl || nodeGraphPatchNode(nodeEl.dataset.node)?.type !== NODE_GRAPH_GRADIENT_MODULE_TYPE) return;
    nodeGraphGradientModuleCycle(nodeEl.dataset.node);
  });
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
