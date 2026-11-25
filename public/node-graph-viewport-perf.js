// Viewport (zoom/pan) performance: light CSS every event, heavy chrome
// (wires / heatmap / scopes) coalesced to rAF; full fidelity + settings
// persist after the gesture settles.
// Camera: GPU shader. World layers stay untransformed. Each module uses
// CSS zoom (not transform:scale) so carets and edit fields stay on the
// glyphs. offsetWidth stays zoom-1, which the GPU plate measures.

// Pan offsets are registered NON-inherited. As plain custom properties on the
// workspace they inherited into ~2.5k module elements, so every pan event
// restyled the whole graph (~370 ms/s of UpdateLayoutTree mid-pan). Only the
// world layers' transform reads them, so they are also written onto those
// layers directly (nodeGraphApplyPanVarsToWorldLayers).
(function registerNodeGraphPanProperties() {
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") {
    return;
  }
  for (const name of ["--node-graph-pan-x", "--node-graph-pan-y"]) {
    try {
      CSS.registerProperty({ name, syntax: "<length>", inherits: false, initialValue: "0px" });
    } catch (_error) {
      // Already registered (hot reload) or unsupported: plain inheritance.
    }
  }
}());

let nodeGraphWorldLayerCollection = null;

function nodeGraphEnsureTextWireLayers(host) {
  const workspace = host || document.getElementById("nodeGraphWorkspace");
  if (!workspace) return;
  const zoom = workspace.querySelector(".node-graph-zoom-surface");
  let behind = document.getElementById("nodeGraphTextBehind");
  if (!behind) {
    behind = document.createElement("div");
    behind.id = "nodeGraphTextBehind";
    behind.className = "node-graph-text-behind";
    if (zoom) workspace.insertBefore(behind, zoom);
    else workspace.append(behind);
  }
  let front = document.getElementById("nodeGraphTextFront");
  if (!front) {
    front = document.createElement("div");
    front.id = "nodeGraphTextFront";
    front.className = "node-graph-text-front";
    workspace.append(front);
  }
}

function nodeGraphPositionGridHtml() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) return;
  nodeGraphEnsureTextWireLayers(workspace);
  const zoom = Math.max(
    0.0001,
    typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1),
  );
  const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset(pan, workspace)
    : pan;
  const panX = Number(origin?.x) || 0;
  const panY = Number(origin?.y) || 0;
  const behind = document.getElementById("nodeGraphTextBehind");
  const front = document.getElementById("nodeGraphTextFront");
  const nodes = workspace.querySelectorAll("#nodeGraphWorldLayer .dsp-node, #nodeGraphAnnotationWorldLayer .dsp-node, #nodeGraphTextBehind .dsp-node, #nodeGraphTextFront .dsp-node");
  // Zoom scales around the layer origin, so layout left (wx) already lands
  // at wx * zoom. The translate is only the camera origin, in pre-zoom px.
  const zoomText = String(zoom);
  const transform = `translate(${panX / zoom}px, ${panY / zoom}px)`;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.closest?.(".node-layout-canvas-tile, .node-screen-solo-stage")) continue;
    // Stage 4: style writes only for mounted modules. Sleepers are drawn
    // from the GL cache; writing zoom/transform on them every wheel tick
    // was the remaining 200ms zoom-out cost once all 60 were awake.
    if (node.classList.contains("viewport-asleep")) continue;
    // Mid-zoom: do not write style.zoom / transform (layout). GL already
    // has the camera; a trailing pass applies HTML zoom after the gesture.
    if (nodeGraphViewZoomLayoutDeferred()) continue;
    const text = node.querySelector(":scope > .node-text-box-body");
    if (text && behind && front) {
      const layout = nodeGraphMvp?.patch?.nodes?.find?.((item) => item?.id === node.dataset.node)?.layout;
      const place = layout?.wireStack === "behind" ? behind : front;
      if (node.parentElement !== place) place.append(node);
    }
    if (node.style.zoom !== zoomText) node.style.zoom = zoomText;
    if (node.style.transformOrigin !== "0px 0px") node.style.transformOrigin = "0 0";
    if (node.style.transform !== transform) node.style.transform = transform;
  }
  nodeGraphViewportPerf.htmlCamera = { zoom, x: panX, y: panY };
  const layers = workspace.getElementsByClassName("node-graph-world-layer");
  for (let i = 0; i < layers.length; i += 1) {
    layers[i].style.transform = "none";
  }
}

function nodeGraphApplyPanVarsToWorldLayers(workspace, x, y) {
  if (!workspace) {
    return;
  }
  if (!nodeGraphWorldLayerCollection || nodeGraphWorldLayerCollection.owner !== workspace) {
    nodeGraphWorldLayerCollection = {
      owner: workspace,
      layers: workspace.getElementsByClassName("node-graph-world-layer"),
    };
  }
  const layers = nodeGraphWorldLayerCollection.layers;
  for (let i = 0; i < layers.length; i += 1) {
    layers[i].style.setProperty("--node-graph-pan-x", x);
    layers[i].style.setProperty("--node-graph-pan-y", y);
    layers[i].style.transform = "none";
  }
  nodeGraphPositionGridHtml();
}

function nodeGraphWriteInheritedZoomVar(workspace) {
  const el = workspace || document.getElementById("nodeGraphWorkspace");
  if (!el?.style) {
    return;
  }
  if (nodeGraphViewZoomLayoutDeferred()) {
    return;
  }
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
  const value = String(zoom);
  if (el.style.getPropertyValue("--node-graph-zoom") !== value) {
    el.style.setProperty("--node-graph-zoom", value);
  }
}

const nodeGraphViewportPerf = {
  heavyRaf: 0,
  persistTimer: 0,
  lastWirePlanKey: "",
  lastWirePlan: null,
  persistMs: 220,
};

const nodeGraphViewCamera = {
  x: 0,
  y: 0,
  zoom: 1,
  epoch: 0,
  dirty: false,
  lastZoomChangeT: 0,
  zoomMoved: false,
};

let nodeGraphViewFrameRaf = 0;
// Settle loop: requestAnimationFrame only while a quality pass or the GL text
// sharpen job is waiting for the camera to go still; it stops by itself.
let nodeGraphViewSettleRaf = 0;
const NODE_GRAPH_VIEW_TEXT_QUALITY_MS = 150;

function viewCameraSnapshot() {
  const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
  return {
    x: Number(pan.x) || 0,
    y: Number(pan.y) || 0,
    zoom: Number(zoom) || 1,
  };
}

/** Stage 3: the only camera setter. Stores pan/zoom, bumps epoch, asks for one frame. No DOM work. */
function viewCameraSet(options = {}) {
  const next = viewCameraSnapshot();
  const prevZoom = nodeGraphViewCamera.zoom;
  const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  if (Math.abs(next.zoom - (Number(prevZoom) || next.zoom)) > 1e-6) {
    nodeGraphViewCamera.lastZoomChangeT = now;
    nodeGraphViewCamera.zoomMoved = true;
    nodeGraphViewCamera.qualityPending = true;
  }
  if (next.zoom !== prevZoom || next.x !== nodeGraphViewCamera.x || next.y !== nodeGraphViewCamera.y) {
    nodeGraphViewCamera.lastChangeT = now;
    // Camera input defers the lazy GL text sharpen (atlas bakes / module
    // repaints); the settle loop resumes it once the camera is still.
    if (typeof nodeGraphGlGraphSharpenPause === "function") nodeGraphGlGraphSharpenPause();
  }
  nodeGraphViewCamera.x = next.x;
  nodeGraphViewCamera.y = next.y;
  nodeGraphViewCamera.zoom = next.zoom;
  nodeGraphViewCamera.epoch = (nodeGraphViewCamera.epoch || 0) + 1;
  nodeGraphViewCamera.dirty = true;
  if (options.persist !== false && typeof scheduleNodeGraphWorkspaceViewPersist === "function") {
    scheduleNodeGraphWorkspaceViewPersist();
  }
  if (options.immediate) {
    if (nodeGraphViewFrameRaf) {
      window.cancelAnimationFrame(nodeGraphViewFrameRaf);
      nodeGraphViewFrameRaf = 0;
    }
    viewFrame();
    return nodeGraphViewCamera;
  }
  if (!nodeGraphViewFrameRaf) {
    nodeGraphViewFrameRaf = window.requestAnimationFrame(() => {
      nodeGraphViewFrameRaf = 0;
      viewFrame();
    });
  }
  return nodeGraphViewCamera;
}

/** No camera change for NODE_GRAPH_VIEW_TEXT_QUALITY_MS (pan, zoom, wheel, keys, drag). */
function nodeGraphViewCameraIdle() {
  const last = Math.max(nodeGraphViewCamera.lastChangeT || 0, nodeGraphViewCamera.lastZoomChangeT || 0);
  if (!last) return true;
  const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  return (now - last) >= NODE_GRAPH_VIEW_TEXT_QUALITY_MS;
}

function nodeGraphViewTextQualitySettled() {
  const last = nodeGraphViewCamera.lastZoomChangeT || 0;
  if (!last) return true;
  const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  return (now - last) >= NODE_GRAPH_VIEW_TEXT_QUALITY_MS;
}

let nodeGraphViewZoomCssTimer = 0;

function nodeGraphViewZoomLayoutDeferred() {
  return nodeGraphViewportPerf.deferZoomLayout === true;
}

/** After the last zoom frame: write layout-affecting zoom CSS once, not mid-gesture. */
function scheduleNodeGraphViewZoomCss() {
  if (nodeGraphViewZoomCssTimer) {
    window.clearTimeout(nodeGraphViewZoomCssTimer);
  }
  nodeGraphViewZoomCssTimer = window.setTimeout(() => {
    nodeGraphViewZoomCssTimer = 0;
    if (nodeGraphViewCamera.zoomMoved) {
      scheduleNodeGraphViewZoomCss();
      return;
    }
    const workspace = document.getElementById("nodeGraphWorkspace");
    if (!workspace) return;
    nodeGraphViewportPerf.deferZoomLayout = false;
    if (typeof nodeGraphWriteInheritedZoomVar === "function") {
      nodeGraphWriteInheritedZoomVar(workspace);
    }
    const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
    workspace.dataset.zoom = Number(zoom).toFixed(2);
    workspace.classList.toggle("pixelated-canvas-zoom", zoom > 2.5);
    if (typeof nodeGraphPositionGridHtml === "function") {
      nodeGraphPositionGridHtml();
    }
  }, 32);
}

/**
 * Text quality after the camera stops. There is no wheel-end event, so this
 * is a requestAnimationFrame loop that runs only while a quality pass (zoom
 * changed) or the GL text sharpen job is waiting, and stops by itself once
 * the camera has been still for NODE_GRAPH_VIEW_TEXT_QUALITY_MS (no timers).
 */
function scheduleNodeGraphViewTextQuality() {
  if (nodeGraphViewSettleRaf) return;
  nodeGraphViewSettleRaf = window.requestAnimationFrame(nodeGraphViewSettleTick);
}

function nodeGraphViewSettleTick() {
  nodeGraphViewSettleRaf = 0;
  const zoomPending = nodeGraphViewCamera.qualityPending === true;
  const sharpenWaiting = typeof nodeGraphGlGraphSharpenWanted === "function" && nodeGraphGlGraphSharpenWanted();
  if (!zoomPending && !sharpenWaiting) return;
  if (!nodeGraphViewTextQualitySettled() || !nodeGraphViewCameraIdle()) {
    nodeGraphViewSettleRaf = window.requestAnimationFrame(nodeGraphViewSettleTick);
    return;
  }
  if (zoomPending) {
    nodeGraphViewCamera.qualityPending = false;
    // Quality pass only. Never adds or removes plates or chrome.
    // Also start waking HTML that stayed asleep during zoom (GL already had
    // the records). Interaction needs the DOM after the camera settles.
    if (typeof scheduleNodeGraphViewportCullRefresh === "function") {
      scheduleNodeGraphViewportCullRefresh({ minIntervalMs: 0 });
    }
    // Snap leftover HTML to the settled zoom (deferred mid-gesture).
    if (typeof applyNodeGraphViewportCssLight === "function") {
      applyNodeGraphViewportCssLight({ zoom: true, pan: true, readouts: true, skipSync: true, skipCull: true, skipHeatmap: true });
    } else if (typeof nodeGraphPositionGridHtml === "function") {
      nodeGraphPositionGridHtml();
    }
    // Raises the shared (tile) bake and asks the GL sharpen job for camera
    // text at the settled zoom. Never a synchronous remesh: the job bakes and
    // re-records a little per frame while the old mesh keeps drawing.
    if (typeof nodeGraphGlGraphSettleTextBake === "function") nodeGraphGlGraphSettleTextBake();
    if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent({ cameraOnly: true });
  }
  if (typeof nodeGraphGlGraphSharpenResume === "function") nodeGraphGlGraphSharpenResume();
}

// Margin around a framed world rect, per side (fraction of the rect).
const NODE_GRAPH_VIEW_FRAME_MARGIN = 0.05;

/**
 * Frame a world rect { x, y, w, h }: zoom so it fits the workspace with
 * NODE_GRAPH_VIEW_FRAME_MARGIN per side, clamped to the zoom limits
 * (clampNodeGraphZoom / nodeGraphZoomLimits), and centre it. Writes zoom and
 * pan, then applies them through viewCameraSet (one immediate frame, no
 * timers). False when the rect or the workspace size is unusable.
 */
function viewFrameRect(rect, options = {}) {
  const x = Number(rect?.x); const y = Number(rect?.y);
  const w = Number(rect?.w); const h = Number(rect?.h);
  if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0) || !nodeGraphMvp) return false;
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) return false;
  const box = typeof nodeGraphWorkspaceLayoutMetrics === "function" ? nodeGraphWorkspaceLayoutMetrics(workspace) : null;
  let W = Number(box?.width) || 0;
  let H = Number(box?.height) || 0;
  if (!(W > 0) || !(H > 0)) {
    const r = workspace.getBoundingClientRect();
    W = r.width; H = r.height;
  }
  if (!(W > 0) || !(H > 0)) return false;
  const k = 1 + 2 * NODE_GRAPH_VIEW_FRAME_MARGIN;
  const fit = Math.min(W / (w * k), H / (h * k));
  const zoom = typeof clampNodeGraphZoom === "function" ? clampNodeGraphZoom(fit) : fit;
  nodeGraphMvp.zoom = zoom;
  if (typeof syncNodeGraphPatchViewZoom === "function") syncNodeGraphPatchViewZoom(zoom);
  // Screen = origin + world x zoom, and the rendered origin moves 1:1 with pan:
  // shift pan so the rect centre lands on the workspace centre.
  const cx = x + w / 2; const cy = y + h / 2;
  let pan = { x: Number(nodeGraphMvp.pan?.x) || 0, y: Number(nodeGraphMvp.pan?.y) || 0 };
  for (let i = 0; i < 2; i += 1) {
    const origin = typeof nodeGraphRenderedOriginOffset === "function" ? nodeGraphRenderedOriginOffset(pan, workspace) : pan;
    pan = {
      x: pan.x + (W / 2 - cx * zoom) - (Number(origin?.x) || 0),
      y: pan.y + (H / 2 - cy * zoom) - (Number(origin?.y) || 0),
    };
  }
  nodeGraphMvp.pan = pan;
  viewCameraSet({ immediate: true, persist: options.persist !== false });
  return true;
}

/**
 * Stage 3: the only per-frame camera apply. Same path for WASD, wheel, Q/E,
 * and middle-drag. viewFrame(rect) with a world rect { x, y, w, h } frames
 * that rect instead (see viewFrameRect); no argument keeps the frame apply.
 */
function viewFrame(rect) {
  if (rect && typeof rect === "object") {
    viewFrameRect(rect);
    return;
  }
  if (nodeGraphViewFrameRaf) {
    window.cancelAnimationFrame(nodeGraphViewFrameRaf);
    nodeGraphViewFrameRaf = 0;
  }
  nodeGraphViewCamera.dirty = false;
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) return;
  // Mid-zoom, skip layout-affecting CSS zoom (inherited var + per-node
  // style.zoom). Writing those and then reading clientWidth in Present was
  // the Q/E and TILE=4 wheel cost (p95 33-50 ms). The GL camera uniform
  // already shows the new zoom; HTML zoom catches up one frame after the
  // last zoom change.
  const deferZoomLayout = nodeGraphViewCamera.zoomMoved === true;
  nodeGraphViewCamera.zoomMoved = false;
  nodeGraphViewportPerf.deferZoomLayout = deferZoomLayout;
  try {
  if (typeof applyNodeGraphViewportCssLight === "function") {
    applyNodeGraphViewportCssLight({ zoom: true, pan: true, readouts: true, skipSync: true, skipCull: true, skipHeatmap: true });
  }
  // Mid-camera heatmap used to wait on a trailing rAF. Run the lite/phase-only
  // update in this same camera frame so lights track pan/zoom.
  if (typeof updateNodeGraphGridHeatmap === "function") {
    updateNodeGraphGridHeatmap({ lite: true, phaseOnly: true });
  }
  // Same live cull as WASD: schedule a refresh, do not synchronously wake
  // every newly visible module in this frame (that blew zoom-out past 20 ms).
  // GL chrome comes from records, so drawing does not wait on the HTML wake.
  if (typeof scheduleNodeGraphViewportCullRefresh === "function") {
    scheduleNodeGraphViewportCullRefresh({ cacheSizesOnly: false, minIntervalMs: 0 });
  }
  if (typeof syncNodeGraphWireSvgViewBox === "function") {
    syncNodeGraphWireSvgViewBox();
  } else if (typeof nodeGraphGlGraphPresent === "function") {
    nodeGraphGlGraphPresent();
  }
  if (typeof syncNodeGraphWorkspaceResizeHandlePosition === "function") {
    syncNodeGraphWorkspaceResizeHandlePosition();
  }
  if (deferZoomLayout) {
    scheduleNodeGraphViewZoomCss();
  }
  if (nodeGraphViewCamera.qualityPending === true
    || (typeof nodeGraphGlGraphSharpenWanted === "function" && nodeGraphGlGraphSharpenWanted())) {
    scheduleNodeGraphViewTextQuality();
  }
  } finally {
    nodeGraphViewportPerf.deferZoomLayout = false;
  }
}


/** Zoom-ish gesture kinds: hide wires + port jacks while active (CSS). */
function nodeGraphViewportGestureIsZoom(kind = "") {
  const k = String(kind || "").toLowerCase();
  return k === "zoom" || k === "wheel" || k === "pinch" || k === "smooth-zoom" || k === "smoothzoom";
}

/** Mark an interactive viewport gesture (wheel / pan / pinch / smooth-zoom). */
function markNodeGraphViewportGesture(kind = "gesture") {
  nodeGraphViewportPerf.lastGestureKind = String(kind || "gesture");
  // Bumped on every pan/zoom event: per-gesture client-rect caches key on it.
  nodeGraphViewportPerf.viewEpoch = (nodeGraphViewportPerf.viewEpoch || 0) + 1;
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  workspace.classList.add("viewport-gesturing");
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp && !nodeGraphMvp._workspaceLayoutMetrics) {
    if (typeof nodeGraphWorkspaceLayoutMetrics === "function") {
      nodeGraphWorkspaceLayoutMetrics(workspace);
    }
  }
  // Stage 3: rendering no longer switches modes mid-gesture. viewport-gesturing
  // stays only as a cursor hint. Do not hide ports or arm a settle timer.
}

/**
 * Pointer-up end of pan / pinch / smooth-zoom: one full lights+wires pass.
 * No debounce timer — user asked for mouse-up only.
 */
function flushNodeGraphViewportOnPointerUp(options = {}) {
  if (nodeGraphViewportPerf.heavyRaf) {
    window.cancelAnimationFrame(nodeGraphViewportPerf.heavyRaf);
    nodeGraphViewportPerf.heavyRaf = 0;
  }
  clearNodeGraphViewportGestureClass();
  if (typeof applyNodeGraphViewportCssLight === "function") {
    applyNodeGraphViewportCssLight({
      zoom: options.zoom !== false,
      pan: options.pan !== false,
    });
  }
  if (typeof syncNodeGraphWorldPositionReadout === "function") {
    syncNodeGraphWorldPositionReadout();
  }
  if (typeof scheduleNodeGraphViewportCullRefresh === "function") {
    scheduleNodeGraphViewportCullRefresh();
  }
  flushNodeGraphViewportHeavyChrome({ full: true });
  if (options.persist !== false) {
    scheduleNodeGraphWorkspaceViewPersist();
  }
}

function clearNodeGraphViewportGestureClass() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  nodeGraphWriteInheritedZoomVar(workspace);
  workspace.classList.remove("viewport-gesturing");
  if (typeof invalidateNodeGraphWorkspaceLayoutMetrics === "function") {
    invalidateNodeGraphWorkspaceLayoutMetrics();
  }
}

if (typeof window !== "undefined" && !window.__nodeGraphViewportGestureRescue) {
  window.__nodeGraphViewportGestureRescue = true;
  window.addEventListener("pageshow", () => {
    clearNodeGraphViewportGestureClass();
  });
}

/**
 * Light path only: CSS zoom/pan vars + cheap chrome (buttons, world readout).
 * Safe to call every wheel/pointermove sample.
 */
function applyNodeGraphViewportCssLight(options = {}) {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  if (options.zoom !== false) {
    const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
    nodeGraphWriteInheritedZoomVar(workspace);
    if (!nodeGraphViewZoomLayoutDeferred()) {
      workspace.dataset.zoom = Number(zoom).toFixed(2);
      workspace.classList.toggle("pixelated-canvas-zoom", zoom > 2.5);
    }
  }
  if (options.zoom !== false || options.pan !== false) {
    const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
    const originOffset = typeof nodeGraphRenderedOriginOffset === "function"
      ? nodeGraphRenderedOriginOffset(pan, workspace)
      : pan;
    nodeGraphApplyPanVarsToWorldLayers(workspace, `${originOffset.x}px`, `${originOffset.y}px`);
  }
  if (options.pan !== false) {
    const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
    const originOffset = typeof nodeGraphRenderedOriginOffset === "function"
      ? nodeGraphRenderedOriginOffset(pan, workspace)
      : pan;
    workspace.style.setProperty("--node-graph-pan-x", `${originOffset.x}px`);
    workspace.style.setProperty("--node-graph-pan-y", `${originOffset.y}px`);
    workspace.dataset.panX = String(pan.x);
    workspace.dataset.panY = String(pan.y);
    if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
      nodeGraphMvp._cameraScreenOrigin = {
        x: nodeGraphFiniteNumber(originOffset.x),
        y: nodeGraphFiniteNumber(originOffset.y),
      };
    }
  }
  // viewFrame presents once after CSS + cull. Other callers still sync here.
  if (
    options.skipSync !== true
    && (options.zoom !== false || options.pan !== false)
    && typeof syncNodeGraphWireSvgViewBox === "function"
  ) {
    if (nodeGraphViewportPerf.wireViewBoxRaf) {
      window.cancelAnimationFrame(nodeGraphViewportPerf.wireViewBoxRaf);
      nodeGraphViewportPerf.wireViewBoxRaf = 0;
    }
    syncNodeGraphWireSvgViewBox();
  }
  if (options.zoomButtons !== false && options.zoom !== false) {
    const zoomOutButton = document.getElementById("nodeZoomOutButton");
    const zoomResetButton = document.getElementById("nodeZoomResetButton");
    const zoomInButton = document.getElementById("nodeZoomInButton");
    const z = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
    const limits = typeof nodeGraphZoomLimits !== "undefined" ? nodeGraphZoomLimits : { min: 0.1, max: 100 };
    if (zoomOutButton) {
      zoomOutButton.disabled = z <= limits.min + 0.001;
    }
    if (zoomInButton) {
      zoomInButton.disabled = z >= limits.max - 0.001;
    }
    if (zoomResetButton && zoomResetButton.dataset.editingZoom !== "true") {
      const zoomLabel = typeof nodeGraphZoomLabel === "function" ? nodeGraphZoomLabel() : `${Math.round(z * 100)}%`;
      zoomResetButton.textContent = zoomLabel;
      zoomResetButton.setAttribute("aria-label", `Current zoom ${zoomLabel}. Reset graph zoom to 1:1`);
      zoomResetButton.removeAttribute("title");
    }
  }
  if (options.readouts !== false) {
    if (typeof syncNodeGraphWorldPositionReadout === "function") {
      syncNodeGraphWorldPositionReadout();
    }
    if (typeof syncNodeGraphOriginMarker === "function") {
      syncNodeGraphOriginMarker();
    }
  }
  if (options.skipHeatmap !== true && typeof scheduleNodeGraphRoomDimmerDraw === "function") {
    scheduleNodeGraphRoomDimmerDraw();
  }
  if (options.skipHeatmap !== true && typeof updateNodeGraphGridHeatmap === "function") {
    updateNodeGraphGridHeatmap({ lite: true });
  }
  if (options.skipCull !== true && typeof scheduleNodeGraphViewportCullRefresh === "function") {
    scheduleNodeGraphViewportCullRefresh({ cacheSizesOnly: false, minIntervalMs: 0 });
  }
}

function nodeGraphWirePlanCacheKey() {
  const nodes = nodeGraphMvp?.patch?.nodes;
  const n = Array.isArray(nodes) ? nodes.length : 0;
  const c = nodeGraphMvp?.connections?.length || 0;
  const m = nodeGraphMvp?.modulations?.length || 0;
  const g = nodeGraphMvp?.graphConnections?.length || 0;
  // Order / bypass can change feedback highlighting without connection counts.
  const orderLen = nodeGraphMvp?.live?.planEvidence?.order?.length
    ?? nodeGraphMvp?.executionPlan?.order?.length
    ?? 0;
  return `${n}|${c}|${m}|${g}|${orderLen}`;
}

function nodeGraphViewportCompileWirePlan() {
  const key = nodeGraphWirePlanCacheKey();
  if (
    nodeGraphViewportPerf.lastWirePlan
    && nodeGraphViewportPerf.lastWirePlanKey === key
  ) {
    return nodeGraphViewportPerf.lastWirePlan;
  }
  const plan = typeof compileNodeGraphExecutionPlan === "function"
    ? compileNodeGraphExecutionPlan()
    : null;
  nodeGraphViewportPerf.lastWirePlanKey = key;
  nodeGraphViewportPerf.lastWirePlan = plan;
  return plan;
}

/** Invalidate wire plan cache (call after patch/wire edits). */
function invalidateNodeGraphViewportWirePlanCache() {
  nodeGraphViewportPerf.lastWirePlan = null;
  nodeGraphViewportPerf.lastWirePlanKey = "";
}

/**
 * Heavy chrome: wires + module lights (heatmap).
 * Stage 3: always the live path. There is no mid-gesture skip.
 */
function flushNodeGraphViewportHeavyChrome(options = {}) {
  if (typeof scheduleNodeGraphRoomDimmerDraw === "function") {
    scheduleNodeGraphRoomDimmerDraw();
  }
  if (typeof updateNodeGraphGridHeatmap === "function") {
    updateNodeGraphGridHeatmap({ lite: false });
  }
  // B-101: reconcile sleep/wake for the final camera BEFORE the GL rebuild.
  // The cull used to be a queued rAF that ran after this pass, so the GL
  // rebuild below skipped faces of modules that were still asleep (display:none
  // has no layout box) and nothing rebuilt them once they woke.
  nodeGraphViewportCullFlushNow();
  // Republish modules that are on screen. Offscreen modules stay display:none
  // and keep the attaches they already have, so their cables still have ends.
  if (typeof nodeGraphModuleGeometryPublishVisible === "function") {
    nodeGraphModuleGeometryPublishVisible();
  }
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires({
      lite: false,
      skipHeatmap: true,
      skipScopes: false,
      skipSelection: false,
    });
  }
  if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw();
  }
  if (typeof scheduleNodeGraphModuleFramesUpdate === "function") {
    scheduleNodeGraphModuleFramesUpdate({ force: false });
  }
}

function scheduleNodeGraphViewportHeavyChrome() {
  if (nodeGraphViewportPerf.heavyRaf) {
    return;
  }
  nodeGraphViewportPerf.heavyRaf = window.requestAnimationFrame(() => {
    nodeGraphViewportPerf.heavyRaf = 0;
    flushNodeGraphViewportHeavyChrome({ full: true });
  });
}

function scheduleNodeGraphWorkspaceViewPersist() {
  if (typeof saveNodeGraphWorkspaceViewToUserSettings !== "function") {
    return;
  }
  if (nodeGraphViewportPerf.persistTimer) {
    window.clearTimeout(nodeGraphViewportPerf.persistTimer);
  }
  nodeGraphViewportPerf.persistTimer = window.setTimeout(() => {
    nodeGraphViewportPerf.persistTimer = 0;
    saveNodeGraphWorkspaceViewToUserSettings({ status: false });
  }, nodeGraphViewportPerf.persistMs);
}

// Live HTMLCollections: the browser keeps them current, and in the modular
// view they are empty, so the per-face "is it presented?" check is O(1)
// instead of a document-wide querySelector every paint.
let nodeGraphPresentedFaceCollections = null;

function nodeGraphPresentedDisplayFace(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id || typeof document === "undefined") {
    return null;
  }
  // Every presented face carries node-screen-solo-face (layout canvas,
  // screen solo and metamodule mirror all add it), so one live collection
  // covers all three; walking three made three document walks per frame.
  if (!nodeGraphPresentedFaceCollections) {
    nodeGraphPresentedFaceCollections = document.getElementsByClassName("node-screen-solo-face");
  }
  // id -> first presented face (same order as the old collection walk),
  // built once per animation frame. Live-collection .length re-walks the
  // document after any DOM write, and every face pump is its own rAF
  // callback, so a per-call (or per-task) walk ran dozens of times a frame.
  // Hits are re-validated on use; a face presented between frames is seen
  // from the next frame on.
  const frameStamp = nodeGraphViewportFrameStamp();
  let map = nodeGraphPresentedFaceMap;
  if (map && (frameStamp === null || map.frameStamp !== frameStamp)) {
    map = null;
  }
  if (!map) {
    map = { faces: new Map(), frameStamp };
    const collection = nodeGraphPresentedFaceCollections;
    const count = collection.length;
    // Old lookup order: layout-canvas faces first, then solo, then metamodule
    // (metamodule faces are also layout faces).
    for (let pass = 0; pass < 2 && count > 0; pass += 1) {
      for (let i = 0; i < count; i += 1) {
        const element = collection[i];
        if (pass === 0 && !element.classList.contains("node-layout-canvas-face")) continue;
        const faceId = element.dataset.node;
        if (faceId && !map.faces.has(faceId)) {
          map.faces.set(faceId, element);
        }
      }
    }
    nodeGraphPresentedFaceMap = map;
    if (frameStamp === null && typeof queueMicrotask === "function") {
      queueMicrotask(() => {
        nodeGraphPresentedFaceMap = null;
      });
    }
  }
  const hit = map.faces.get(id) || null;
  if (hit && (!hit.isConnected || hit.dataset.node !== id)) {
    nodeGraphPresentedFaceMap = null;
    return nodeGraphPresentedDisplayFace(id);
  }
  return hit;
}

let nodeGraphPresentedFaceMap = null;

/** Same value for every rAF callback of one frame (null when unavailable). */
function nodeGraphViewportFrameStamp() {
  const t = typeof document !== "undefined" ? document.timeline?.currentTime : null;
  return Number.isFinite(t) ? t : null;
}

/**
 * Cached `${selector}[data-node="id"]` lookup for per-frame paint paths.
 * A hit is reused while it stays connected and still carries that node id;
 * otherwise one fresh querySelector refills it.
 */
const nodeGraphNodeElementLookupCache = new Map();

function nodeGraphCachedNodeElement(selector, nodeId) {
  const id = String(nodeId || "");
  if (!id || typeof document === "undefined") {
    return null;
  }
  let bySelector = nodeGraphNodeElementLookupCache.get(selector);
  if (!bySelector) {
    bySelector = new Map();
    nodeGraphNodeElementLookupCache.set(selector, bySelector);
  }
  const hit = bySelector.get(id);
  if (hit && hit.isConnected && hit.dataset.node === id) {
    return hit;
  }
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, "");
  const element = document.querySelector(`${selector}[data-node="${escaped}"]`);
  if (element) {
    bySelector.set(id, element);
  } else {
    bySelector.delete(id);
  }
  return element;
}

/** Cached child lookup under a mounted element (paint paths). */
const nodeGraphChildLookupCache = new WeakMap();

function nodeGraphCachedChild(parent, selector) {
  if (!parent?.querySelector) {
    return null;
  }
  let bySelector = nodeGraphChildLookupCache.get(parent);
  if (!bySelector) {
    bySelector = new Map();
    nodeGraphChildLookupCache.set(parent, bySelector);
  }
  const hit = bySelector.get(selector);
  if (hit && hit.isConnected && parent.contains(hit)) {
    return hit;
  }
  const element = parent.querySelector(selector);
  if (element) {
    bySelector.set(selector, element);
  } else {
    bySelector.delete(selector);
  }
  return element;
}

function nodeGraphDisplayIsPresented(nodeId) {
  return Boolean(nodeGraphPresentedDisplayFace(nodeId));
}

function nodeGraphModuleIsViewportAsleep(nodeOrElement) {
  const element = nodeOrElement instanceof Element
    ? (nodeOrElement.classList.contains("dsp-node")
      ? nodeOrElement
      : nodeOrElement.closest?.(".dsp-node"))
    : (typeof nodeGraphCachedNodeElement === "function"
      ? nodeGraphCachedNodeElement(".dsp-node", nodeOrElement)
      : (typeof nodeGraphNodeElement === "function"
        ? nodeGraphNodeElement(nodeOrElement)
        : null));
  const nodeId = String(element?.dataset?.node || nodeOrElement || "").trim();
  if (nodeId && nodeGraphDisplayIsPresented(nodeId)) {
    return false;
  }
  return Boolean(element?.classList.contains("viewport-asleep"));
}

/** Bands CSS skips with content-visibility:hidden on .viewport-asleep. */
var NODE_GRAPH_VIEWPORT_ASLEEP_SKIP_SEL = [
  ".node-module-face",
  ".node-module-scope-window",
  ".node-solid-module-custom-ui",
].join(", ");

/**
 * True when measuring this node would force-render a content-visibility:hidden
 * band (Chrome: "Rendering was performed in a subtree hidden by content-visibility").
 * Asleep modules use display:none (whole node). Jack census skips them.
 */
function nodeGraphElementInSkippedContentVisibility(element) {
  if (!element?.closest) {
    return false;
  }
  const module = element.closest(".dsp-node");
  if (!module?.classList?.contains("viewport-asleep")) {
    return false;
  }
  return Boolean(element.closest(NODE_GRAPH_VIEWPORT_ASLEEP_SKIP_SEL));
}

/**
 * CSS box without forcing a content-visibility:hidden subtree to paint.
 * Asleep faces reuse the last awake size (or fallback).
 */
function nodeGraphElementClientSize(element, fallbackW = 1, fallbackH = 1) {
  const fw = Math.max(1, nodeGraphFiniteNumber(fallbackW, 1));
  const fh = Math.max(1, nodeGraphFiniteNumber(fallbackH, 1));
  if (!element) {
    return { width: fw, height: fh, skipped: true };
  }
  if (nodeGraphElementInSkippedContentVisibility(element)) {
    const lastW = Number(element._awakeClientWidth);
    const lastH = Number(element._awakeClientHeight);
    return {
      width: Math.max(1, lastW > 0 ? lastW : fw),
      height: Math.max(1, lastH > 0 ? lastH : fh),
      skipped: true,
    };
  }
  const width = Math.max(1, Math.floor(nodeGraphFiniteNumber(element.clientWidth, fw)));
  const height = Math.max(1, Math.floor(nodeGraphFiniteNumber(element.clientHeight, fh)));
  element._awakeClientWidth = width;
  element._awakeClientHeight = height;
  return { width, height, skipped: false };
}

function nodeGraphViewportCullPainterRoots(element) {
  const roots = [];
  if (element) {
    roots.push(element);
  }
  const nodeId = String(element?.dataset?.node || "");
  const presented = nodeId ? nodeGraphPresentedDisplayFace(nodeId) : null;
  if (presented && !roots.some((root) => root === presented || root.contains?.(presented))) {
    roots.push(presented);
  }
  return roots;
}

function nodeGraphViewportCullWakePainters(element) {
  if (!element) {
    return;
  }
  const nodeId = String(element.dataset?.node || "");
  const roots = nodeGraphViewportCullPainterRoots(element);
  for (const root of roots) {
    for (const face of root.querySelectorAll?.(".node-fbm-field-face") || []) {
      if (typeof nodeGraphFbmFieldStartLoop === "function") {
        nodeGraphFbmFieldStartLoop(face, nodeId || face.dataset?.node);
      }
    }
    if (root.matches?.(".node-fbm-field-face") && typeof nodeGraphFbmFieldStartLoop === "function") {
      nodeGraphFbmFieldStartLoop(root, nodeId);
    }
    for (const face of root.querySelectorAll?.(
      ".node-harmonic-lines-display, .node-harmonic-count-display",
    ) || []) {
      face._startFaceLoop?.();
    }
    for (const face of root.querySelectorAll?.(".node-sample-waveform-display") || []) {
      if (typeof nodeGraphSampleWaveformEnsureLoop === "function") {
        nodeGraphSampleWaveformEnsureLoop(face);
      }
    }
    if (root.matches?.(".node-sample-waveform-display")
      && typeof nodeGraphSampleWaveformEnsureLoop === "function") {
      nodeGraphSampleWaveformEnsureLoop(root);
    }
    if (typeof nodeGraphScreenSoloWakeFace === "function") {
      nodeGraphScreenSoloWakeFace(root.matches?.(".node-module-face, .node-module-scope-window, .node-keyboard-module, .node-arp-keys-face")
        ? root
        : (root.querySelector?.(".node-module-face, .node-module-scope-window, .node-keyboard-module, .node-arp-keys-face") || root));
    }
  }
  // Mid-zoom, the GPU mesh already holds every recorded face. Forcing a
  // scope redraw or cold-plate rebuild here is why wheel zoom-out still
  // had 200ms tasks after Present itself started replaying (graph bezier,
  // layout, a full present when the mesh was dropped).
  const zooming = typeof nodeGraphViewTextQualitySettled === "function"
    && !nodeGraphViewTextQualitySettled();
  if (zooming) return;
  if (nodeId && typeof requestNodeGraphModuleScopeRepaint === "function") {
    requestNodeGraphModuleScopeRepaint(nodeId);
  }
  if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw({ force: true });
  }
  // Engine-state plan: a buffer face waking while stopped (or paused with no
  // held canvas) gets its canvas and cold plate, same as a stopped spawn.
  nodeGraphViewportWakeColdPlate(nodeId);
  element.dispatchEvent(new CustomEvent("nodegraphviewport", {
    bubbles: false,
    detail: { asleep: false },
  }));
}

function nodeGraphViewportWakeColdPlate(nodeId) {
  if (
    !nodeId
    || typeof scopePaintEnsureColdPlate !== "function"
    || typeof scopePaintEngineState !== "function"
    || typeof requestAnimationFrame !== "function"
  ) {
    return;
  }
  requestAnimationFrame(() => {
    const state = scopePaintEngineState();
    const slot = nodeGraphModuleScopeState?.slots?.get?.(nodeId);
    if (!slot || state === "playing") return;
    if (state === "paused") {
      const held = slot.scopeElement?.querySelector?.(".node-display-face");
      if (held && held.width > 1 && held.height > 1) return;
    }
    scopePaintEnsureColdPlate(slot, { create: true, force: true, assumeStopped: true });
  });
}

function nodeGraphViewportCullSleepPainters(element) {
  if (!element) {
    return;
  }
  if (typeof nodeGraphViewportCullMustStayAwake === "function"
    && nodeGraphViewportCullMustStayAwake(element)) {
    return;
  }
  // Video nodes (VG-4) keep running while a visible sink reads their picture.
  const videoNeeded = typeof nodeGraphVideoGraphShouldSleep === "function"
    && !nodeGraphVideoGraphShouldSleep(element.dataset?.node);
  for (const face of element.querySelectorAll(".node-fbm-field-face")) {
    if (!videoNeeded && typeof nodeGraphFbmFieldStopLoop === "function") {
      nodeGraphFbmFieldStopLoop(face);
    }
  }
  for (const face of element.querySelectorAll(
    ".node-harmonic-lines-display, .node-harmonic-count-display",
  )) {
    if (face._raf) {
      window.cancelAnimationFrame(face._raf);
      face._raf = 0;
    }
  }
  for (const face of element.querySelectorAll(".node-sample-waveform-display")) {
    if (typeof nodeGraphSampleWaveformStopLoop === "function") {
      nodeGraphSampleWaveformStopLoop(face);
    }
  }
  element.dispatchEvent(new CustomEvent("nodegraphviewport", {
    bubbles: false,
    detail: { asleep: true },
  }));
}

function nodeGraphViewportCullBootOrLayoutUnsafe() {
  // During boot the shell is visibility:hidden. A cull then would mark every
  // module viewport-asleep (display:none). After the loading screen fades, K
  // still works (controller dock) but the graph stays black with no nodes.
  // Never sleep while booting or when the workspace has no real layout box yet.
  const body = document.body;
  if (
    body?.classList?.contains("node-boot-loading")
    || body?.classList?.contains("node-boot-fading")
  ) {
    return true;
  }
  return false;
}

/** Module world layer plus every legal Text Box host.
 *  Those nodes sit outside the zoom surface. A cull that only walks the
 *  module world layer never clears viewport-asleep. */
function nodeGraphViewportCullModuleRoots(surface) {
  const roots = [];
  const seen = new Set();
  const add = (root) => {
    if (!root || seen.has(root)) {
      return;
    }
    seen.add(root);
    roots.push(root);
  };
  add(surface
    || (typeof nodeGraphZoomSurface === "function"
      ? nodeGraphZoomSurface()
      : document.getElementById("nodeGraphWorldLayer") || document.getElementById("nodeGraphZoomSurface"))
    || document.getElementById("nodeGraphWorkspace"));
  if (typeof nodeGraphModuleMountContainers === "function") {
    for (const container of nodeGraphModuleMountContainers()) {
      add(container);
    }
  } else {
    add(document.getElementById("nodeGraphAnnotationNodes"));
    add(document.getElementById("nodeGraphTextBehind"));
    add(document.getElementById("nodeGraphTextFront"));
  }
  return roots;
}

function nodeGraphViewportCullForEachNode(surface, selector, visit) {
  const seen = new Set();
  for (const root of nodeGraphViewportCullModuleRoots(surface)) {
    for (const element of root.querySelectorAll(selector)) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      visit(element);
    }
  }
}

/** Measure every module's chrome at load or commit, with no timer.
 *  Wake, force layout, publish geometry, rebuild plates, present once,
 *  then let the budgeted cull put offscreen HTML back to sleep. GL already
 *  has the records, so later camera frames can replay from the cache. */
function nodeGraphViewportCaptureChromeNow() {
  const surface = typeof nodeGraphZoomSurface === "function"
    ? nodeGraphZoomSurface()
    : document.getElementById("nodeGraphWorldLayer") || document.getElementById("nodeGraphZoomSurface");
  if (!surface) return;
  nodeGraphViewportCullWakeAll(surface);
  void surface.offsetHeight;
  const nodes = surface.querySelectorAll(".dsp-node:not(.removed)");
  for (let i = 0; i < nodes.length; i += 1) void nodes[i].offsetHeight;
  if (typeof nodeGraphModuleGeometryPublishVisible === "function") {
    nodeGraphModuleGeometryPublishVisible();
  }
  if (typeof nodeGraphGlGraphRebuildPlates === "function") {
    nodeGraphGlGraphRebuildPlates();
  }
  if (typeof nodeGraphGlGraphPresent === "function") {
    nodeGraphGlGraphPresent();
  }
  scheduleNodeGraphViewportCullRefresh({ minIntervalMs: 0 });
}

function nodeGraphViewportCullWakeAll(surface) {
  nodeGraphViewportCullForEachNode(
    surface,
    ".dsp-node.viewport-asleep, .dsp-node:not(.removed)",
    (element) => {
      nodeGraphViewportCullApply(element, true);
    },
  );
}

function nodeGraphViewportCullRefresh(options = {}) {
  const workspace = document.getElementById("nodeGraphWorkspace");
  const surface = typeof nodeGraphZoomSurface === "function"
    ? nodeGraphZoomSurface()
    : document.getElementById("nodeGraphWorldLayer") || document.getElementById("nodeGraphZoomSurface");
  if (!workspace || !surface) {
    return;
  }
  if (nodeGraphViewportCullBootOrLayoutUnsafe()) {
    nodeGraphViewportCullWakeAll(surface);
    return;
  }
  const zoom = Math.max(
    0.0001,
    typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphFiniteNumber(nodeGraphMvp?.zoom, 1)),
  );
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset()
    : { x: 0, y: 0 };
  const box = typeof nodeGraphWorkspaceLayoutMetrics === "function"
    ? nodeGraphWorkspaceLayoutMetrics(workspace)
    : { width: workspace.clientWidth, height: workspace.clientHeight };
  const boxW = nodeGraphFiniteNumber(box.width);
  const boxH = nodeGraphFiniteNumber(box.height);
  // Zero/tiny workspace (iframe not laid out yet) would cull the whole patch.
  if (boxW < 32 || boxH < 32) {
    nodeGraphViewportCullWakeAll(surface);
    return;
  }
  // Stage 4: overscan is a quarter of the screen so modules are in the
  // records before they cross the edge. Exit uses a slightly larger band so
  // they do not thrash at the margin. DOM wake is budgeted (~4ms/frame);
  // GL keeps drawing every recorded plate from the chrome cache, so nothing
  // visible depends on the HTML being awake in this frame.
  const enterMx = boxW * 0.25;
  const enterMy = boxH * 0.25;
  const exitMx = boxW * 0.35;
  const exitMy = boxH * 0.35;
  const ox = nodeGraphFiniteNumber(origin.x);
  const oy = nodeGraphFiniteNumber(origin.y);
  const enterLeft = (0 - enterMx - ox) / zoom;
  const enterTop = (0 - enterMy - oy) / zoom;
  const enterRight = (boxW + enterMx - ox) / zoom;
  const enterBottom = (boxH + enterMy - oy) / zoom;
  const exitLeft = (0 - exitMx - ox) / zoom;
  const exitTop = (0 - exitMy - oy) / zoom;
  const exitRight = (boxW + exitMx - ox) / zoom;
  const exitBottom = (boxH + exitMy - oy) / zoom;
  const viewCx = ((boxW * 0.5) - ox) / zoom;
  const viewCy = ((boxH * 0.5) - oy) / zoom;
  const selected = typeof nodeGraphSelectedNodeIds === "function"
    ? nodeGraphSelectedNodeIds()
    : new Set();
  const cacheSizesOnly = Boolean(options.cacheSizesOnly);
  const zooming = typeof nodeGraphViewTextQualitySettled === "function"
    && !nodeGraphViewTextQualitySettled();
  // Mid-zoom: 4ms of HTML wake per frame. After the camera settles, finish
  // waking visible modules in this pass so they are interactive.
  const wakeBudgetMs = zooming ? 4 : 1e9;
  const toWake = [];
  const toSleep = [];
  nodeGraphViewportCullForEachNode(surface, ".dsp-node:not(.removed)", (element) => {
    const id = String(element.dataset?.node || "");
    const box = nodeGraphViewportModuleWorldBox(element, { measure: !cacheSizesOnly });
    const inEnter = box.x < enterRight
      && (box.x + box.w) > enterLeft
      && box.y < enterBottom
      && (box.y + box.h) > enterTop;
    const inExit = box.x < exitRight
      && (box.x + box.w) > exitLeft
      && box.y < exitBottom
      && (box.y + box.h) > exitTop;
    const pinned = (id && selected.has(id))
      || (typeof nodeGraphViewportCullMustStayAwake === "function"
        && nodeGraphViewportCullMustStayAwake(element));
    const asleep = element.classList.contains("viewport-asleep");
    if (pinned || inEnter) {
      if (asleep) {
        // While zooming, leave meshed modules asleep. GL already has their
        // plates and chrome; waking the DOM is what made zoom-out write
        // style.zoom on every module and blow the frame budget.
        const zooming = typeof nodeGraphViewTextQualitySettled === "function"
          && !nodeGraphViewTextQualitySettled();
        if (!pinned && zooming && nodeGraphViewportModuleAlreadyMeshed(id)) {
          return;
        }
        const dx = (box.x + box.w * 0.5) - viewCx;
        const dy = (box.y + box.h * 0.5) - viewCy;
        toWake.push({ element, pinned, d: dx * dx + dy * dy });
      } else {
        nodeGraphViewportCullApply(element, true);
      }
    } else if (!inExit && !asleep) {
      toSleep.push(element);
    }
  });
  toWake.sort((a, b) => (a.pinned === b.pinned ? a.d - b.d : (a.pinned ? -1 : 1)));
  const t0 = performance.now();
  let deferred = 0;
  for (const item of toWake) {
    const over = (performance.now() - t0) > wakeBudgetMs;
    if (over && !item.pinned) {
      deferred += 1;
      continue;
    }
    nodeGraphViewportCullApply(item.element, true);
  }
  for (const element of toSleep) nodeGraphViewportCullApply(element, false);
  if (deferred > 0) {
    scheduleNodeGraphViewportCullRefresh({ minIntervalMs: 0 });
  }
}

// view-1 (Stage 1 of docs/MODULE_DISPLAY_REWRITE_PLAN.md): module boxes in
// WORLD units -- zoom-1 layout px, the space of --node-x / --node-y and of the
// GL plates. The cull and the mid-gesture pop-in pass both read this, so they
// agree. Sizes are kept per module id (they used to be expandos on the
// element: a re-rendered module element started over at a 220x140 guess, so
// a bigger module at the edge of the view stayed culled until settle).
// offsetWidth / offsetHeight ignore the module's own CSS zoom and transform
// (checked in Chrome 157: zoom 2.5, width 100px -> offsetWidth 100), so a
// measurement is world units at any camera zoom.
const NODE_GRAPH_VIEWPORT_GUESS_W = 220;
const NODE_GRAPH_VIEWPORT_GUESS_H = 140;
const nodeGraphViewportModuleSizes = new Map();

function nodeGraphViewportRememberModuleSize(nodeId, width, height) {
  const id = String(nodeId || "");
  const w = nodeGraphFiniteNumber(width);
  const h = nodeGraphFiniteNumber(height);
  if (!id || !(w > 1) || !(h > 1)) return;
  const prev = nodeGraphViewportModuleSizes.get(id);
  if (prev && prev.w === w && prev.h === h) return;
  nodeGraphViewportModuleSizes.set(id, { w, h });
}

/** World box { x, y, w, h, guessed } of a .dsp-node. options.measure: read
 *  offsetWidth/Height if the module is awake (layout read; not mid-gesture). */
function nodeGraphViewportModuleWorldBox(element, options = {}) {
  const id = String(element?.dataset?.node || "");
  const x = Number.parseFloat(element?.style?.getPropertyValue("--node-x")) || 0;
  const y = Number.parseFloat(element?.style?.getPropertyValue("--node-y")) || 0;
  if (
    options.measure
    && element
    && !element.hidden
    && !element.classList.contains("viewport-asleep")
  ) {
    nodeGraphViewportRememberModuleSize(id, element.offsetWidth, element.offsetHeight);
  }
  let size = id ? nodeGraphViewportModuleSizes.get(id) : null;
  if (!size && id && typeof nodeGraphModuleGeometryGet === "function") {
    // The GL plate's box (published from layout, world units).
    const geo = nodeGraphModuleGeometryGet(id)?.box;
    if (geo && geo.w > 1 && geo.h > 1) {
      size = { w: geo.w, h: geo.h };
      nodeGraphViewportModuleSizes.set(id, size);
    }
  }
  if (!size) {
    return { x, y, w: NODE_GRAPH_VIEWPORT_GUESS_W, h: NODE_GRAPH_VIEWPORT_GUESS_H, guessed: true };
  }
  // Older readers (fit-to-content in workspace-zoom.js) still use these.
  if (element) {
    element._viewportCullW = size.w;
    element._viewportCullH = size.h;
  }
  return { x, y, w: size.w, h: size.h, guessed: false };
}

/** B-101: run the geometric cull now (live camera), dropping any queued one. */
function nodeGraphViewportCullFlushNow() {
  if (nodeGraphViewportPerf.cullRaf) {
    window.cancelAnimationFrame(nodeGraphViewportPerf.cullRaf);
    nodeGraphViewportPerf.cullRaf = 0;
  }
  if (nodeGraphViewportPerf.cullTrailingTimer) {
    window.clearTimeout(nodeGraphViewportPerf.cullTrailingTimer);
    nodeGraphViewportPerf.cullTrailingTimer = 0;
  }
  nodeGraphViewportPerf.cullPendingOptions = null;
  nodeGraphViewportPerf.cullLastAt = performance.now?.() || Date.now();
  nodeGraphViewportCullFlushing = true;
  try {
    nodeGraphViewportCullRefresh();
  } finally {
    nodeGraphViewportCullFlushing = false;
  }
}

// B-101: a module woken outside a full chrome pass (observer, selection,
// metamodule, trailing cull) needs its GL plate + display faces rebuilt —
// the last rebuild skipped it while it was display:none. One rAF, coalesced.
let nodeGraphViewportCullFlushing = false;
let nodeGraphViewportWakeRebuildRaf = 0;
const nodeGraphViewportJustWokeIds = new Set();
function scheduleNodeGraphViewportWakeRebuild() {
  if (nodeGraphViewportCullFlushing || nodeGraphViewportWakeRebuildRaf) return;
  if (typeof nodeGraphGlGraphRebuildPlates !== "function") return;
  nodeGraphViewportWakeRebuildRaf = window.requestAnimationFrame(() => {
    nodeGraphViewportWakeRebuildRaf = 0;
    const ids = [...nodeGraphViewportJustWokeIds];
    nodeGraphViewportJustWokeIds.clear();
    // HTML waking is for live sliders / faces. If the module is already in
    // the GPU mesh (captured at load), a rebuild would invalidate that mesh
    // and cost a 200ms+ present on zoom-out. Skip those. Only rebuild the
    // ones that actually have no record yet.
    const need = ids.filter((id) => !nodeGraphViewportModuleAlreadyMeshed(id));
    if (!need.length) return;
    if (typeof nodeGraphModuleGeometryPublishVisible === "function") {
      nodeGraphModuleGeometryPublishVisible();
    }
    // Never fall back to a full plates rebuild here: that drops the mesh
    // and the next present costs 200-300ms. Incremental patch or skip.
    if (typeof nodeGraphGlGraphRebuildPlatesIncremental === "function") {
      if (!nodeGraphGlGraphRebuildPlatesIncremental(need)) return;
    } else {
      nodeGraphGlGraphRebuildPlates({ ids: need });
    }
    if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
  });
}

function nodeGraphViewportModuleAlreadyMeshed(id) {
  if (!id || typeof nodeGraphGlGraphState !== "object" || !nodeGraphGlGraphState) return false;
  const state = nodeGraphGlGraphState;
  const mesh = state.mesh;
  if (!mesh || mesh.gen !== state.gen) return false;
  const want = String(id);
  if (!(state.plates || []).some((p) => String(p.id) === want)) return false;
  const layers = mesh.plateGroupLayers || [];
  if (!layers.length) return true;
  for (let i = 0; i < layers.length; i += 1) {
    if ((layers[i]?.ids || []).some((x) => String(x) === want)) return true;
  }
  return false;
}

function scheduleNodeGraphViewportCullRefresh(options = {}) {
  const cacheSizesOnly = Boolean(options.cacheSizesOnly);
  const minIntervalMs = Math.max(0, nodeGraphFiniteNumber(options.minIntervalMs));
  const now = performance.now?.() || Date.now();
  if (
    minIntervalMs > 0
    && nodeGraphViewportPerf.cullLastAt
    && (now - nodeGraphViewportPerf.cullLastAt) < minIntervalMs
  ) {
    // Still coalesce a trailing refresh so the last pan sample gets culled.
    if (!nodeGraphViewportPerf.cullTrailingTimer) {
      const wait = Math.max(0, minIntervalMs - (now - nodeGraphViewportPerf.cullLastAt));
      nodeGraphViewportPerf.cullTrailingTimer = window.setTimeout(() => {
        nodeGraphViewportPerf.cullTrailingTimer = 0;
        scheduleNodeGraphViewportCullRefresh({
          cacheSizesOnly,
          minIntervalMs: 0,
        });
      }, wait);
    }
    return;
  }
  if (nodeGraphViewportPerf.cullRaf) {
    nodeGraphViewportPerf.cullPendingOptions = {
      cacheSizesOnly: cacheSizesOnly
        || Boolean(nodeGraphViewportPerf.cullPendingOptions?.cacheSizesOnly),
    };
    return;
  }
  const pending = { cacheSizesOnly };
  nodeGraphViewportPerf.cullRaf = window.requestAnimationFrame(() => {
    nodeGraphViewportPerf.cullRaf = 0;
    const opts = nodeGraphViewportPerf.cullPendingOptions || pending;
    nodeGraphViewportPerf.cullPendingOptions = null;
    nodeGraphViewportPerf.cullLastAt = performance.now?.() || Date.now();
    nodeGraphViewportCullRefresh(opts);
  });
}

/**
 * Keep the *face* painting when it is teleported. Never unhide a graph
 * module that does not belong in the current view (Voice* / Meta Out / interiors).
 */
function nodeGraphViewportCullMustStayAwake(elementOrNodeId) {
  const element = elementOrNodeId instanceof Element
    ? (elementOrNodeId.classList.contains("dsp-node")
      ? elementOrNodeId
      : elementOrNodeId.closest?.(".dsp-node"))
    : (typeof nodeGraphNodeElement === "function"
      ? nodeGraphNodeElement(elementOrNodeId)
      : null);
  if (element?.hidden) {
    return false;
  }
  const nodeId = String(
    (element?.dataset?.node || elementOrNodeId || ""),
  ).trim();
  if (!nodeId) {
    return false;
  }
  // Viewport In / Out and anything feeding the live screen-fx / video graph
  // must stay awake: putting them display:none (off-screen cull) drops the
  // shader pass for a frame, so the whole circuit view flickers even when the
  // pan is far from those modules.
  const stayNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const stayType = String(stayNode?.type || "");
  if (stayType === "viewOut" || stayType === "screenOut") {
    return true;
  }
  if (typeof nodeGraphVideoGraphShouldSleep === "function" && !nodeGraphVideoGraphShouldSleep(nodeId)) {
    return true;
  }
  if (typeof nodeGraphMiniPerformPresentsNode === "function" && nodeGraphMiniPerformPresentsNode(nodeId)) {
    return true; // Mini Performance View is showing it.
  }
  if (typeof nodeGraphModuleFacePagePresentsNode === "function" && nodeGraphModuleFacePagePresentsNode(nodeId)) {
    return true; // Command Center Module page is showing its display.
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (
    patchNode
    && typeof nodeGraphMetamoduleNodeVisibleInCurrentView === "function"
    && !nodeGraphMetamoduleNodeVisibleInCurrentView(patchNode)
  ) {
    return false;
  }
  if (element?.querySelector?.(":scope > .node-screen-solo-placeholder, .node-screen-solo-placeholder")) {
    return true;
  }
  if (nodeGraphDisplayIsPresented(nodeId)) {
    return true;
  }
  if (typeof nodeGraphLayoutCanvasIsActive === "function" && nodeGraphLayoutCanvasIsActive()) {
    if (typeof nodeGraphLayoutCanvasIsPinned === "function" && nodeGraphLayoutCanvasIsPinned(nodeId)) {
      return true;
    }
  }
  return false;
}

function nodeGraphViewportCullWakePresentedFace(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return;
  }
  const face = typeof nodeGraphPresentedDisplayFace === "function"
    ? nodeGraphPresentedDisplayFace(id)
    : null;
  if (face && typeof nodeGraphScreenSoloWakeFace === "function") {
    nodeGraphScreenSoloWakeFace(face);
  }
  if (id && typeof requestNodeGraphModuleScopeRepaint === "function") {
    requestNodeGraphModuleScopeRepaint(id);
  }
}

function nodeGraphViewportCullWakeNodeById(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return;
  }
  nodeGraphViewportCullWakePresentedFace(id);
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, "");
  const host = document.querySelector(`.dsp-node[data-node="${escaped}"]`);
  if (!host || host.hidden) {
    return;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  if (
    patchNode
    && typeof nodeGraphMetamoduleNodeVisibleInCurrentView === "function"
    && !nodeGraphMetamoduleNodeVisibleInCurrentView(patchNode)
  ) {
    return;
  }
  nodeGraphViewportCullApply(host, true);
}

function nodeGraphViewportCullApply(element, intersecting) {
  if (!element?.classList?.contains("dsp-node")) {
    return;
  }
  const nodeId = String(element.dataset?.node || "");
  if (element.hidden) {
    const wasAsleep = element.classList.contains("viewport-asleep");
    element.classList.add("viewport-asleep");
    if (!wasAsleep) {
      nodeGraphViewportCullSleepPainters(element);
    }
    nodeGraphViewportCullWakePresentedFace(nodeId);
    return;
  }
  const selected = Boolean(
    nodeId
    && typeof nodeGraphSelectedNodeIds === "function"
    && nodeGraphSelectedNodeIds().has(nodeId),
  );
  const stay = nodeGraphViewportCullMustStayAwake(element);
  const awake = intersecting || selected || stay;
  const wasAsleep = element.classList.contains("viewport-asleep");
  element.classList.toggle("viewport-asleep", !awake);
  if (wasAsleep === !awake) {
    return;
  }
  if (awake) {
    if (nodeId) nodeGraphViewportJustWokeIds.add(nodeId);
    nodeGraphViewportCullWakePainters(element);
    scheduleNodeGraphViewportWakeRebuild();
  } else {
    nodeGraphViewportCullSleepPainters(element);
  }
}

function nodeGraphViewportCullObserve(element) {
  // Stage 5: the IntersectionObserver cull is gone. New or replaced modules
  // just ask the live geometric cull to run.
  if (!element) return;
  if (typeof scheduleNodeGraphViewportCullRefresh === "function") {
    scheduleNodeGraphViewportCullRefresh();
  }
}

function nodeGraphViewportCullSyncSelection() {
  const selected = typeof nodeGraphSelectedNodeIds === "function"
    ? nodeGraphSelectedNodeIds()
    : new Set();
  for (const id of selected) {
    const element = typeof nodeGraphNodeElement === "function"
      ? nodeGraphNodeElement(id)
      : null;
    if (element?.classList.contains("viewport-asleep")) {
      nodeGraphViewportCullApply(element, true);
    }
  }
}

function flushNodeGraphViewportImmediate(options = {}) {
  if (nodeGraphViewportPerf.heavyRaf) {
    window.cancelAnimationFrame(nodeGraphViewportPerf.heavyRaf);
    nodeGraphViewportPerf.heavyRaf = 0;
  }
  clearNodeGraphViewportGestureClass();
  applyNodeGraphViewportCssLight({
    zoom: options.zoom !== false,
    pan: options.pan !== false,
  });
  if (nodeGraphViewportPerf.holdHeavyDepth > 0) {
    // Inside commitNodeGraphPatch: one heavy pass runs when the commit ends.
    nodeGraphViewportPerf.heldHeavy = true;
  } else if (globalThis.nodeSandboxInterfaceReady !== true) {
    // Startup sets view mode, chrome bars, zoom and pan back to back, and each
    // one lands here. Until the interface is ready the heavy pass (cull,
    // geometry publish, full wire redraw) runs once at the end of the current
    // task instead of once per call.
    if (!nodeGraphViewportPerf.bootHeavyQueued) {
      nodeGraphViewportPerf.bootHeavyQueued = true;
      queueMicrotask(() => {
        nodeGraphViewportPerf.bootHeavyQueued = false;
        flushNodeGraphViewportHeavyChrome({ full: true });
      });
    }
  } else {
    flushNodeGraphViewportHeavyChrome({ full: true });
  }
  if (options.persist !== false) {
    scheduleNodeGraphWorkspaceViewPersist();
  }
}
