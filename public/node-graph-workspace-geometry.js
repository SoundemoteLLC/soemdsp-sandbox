const nodeGraphZoomLimits = Object.freeze({
  max: 100,
  min: 0.1,
  buttonRatio: 1.12,
  fineRatio: 1.05,
  quarterRatio: 1.08,
  wheelRatio: 1.12,
});

function applyNodeGraphWorkspaceView() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }

  workspace.style.setProperty("--node-grid-height", `${nodeGraphGridHeight()}px`);
  workspace.style.setProperty("--node-grid-size", `${nodeGraphGridSize()}px`);
  workspace.style.setProperty("--node-grid-width", `${nodeGraphGridWidth()}px`);
  // SSOT for canvas box size:
  //   📱/M on  → fixed frame from patch.view (resize handle owns the size)
  //   M off    → clear fixed width/height so the workspace fills the panel
  //              (💻/V only hides bars; must NOT keep the condensed frame size)
  const modularWindowed = Boolean(workspace.closest(".node-wiring-panel.modular-only-view"));
  const view = normalizeNodeGraphPatchView(nodeGraphMvp.patch?.view);
  const visibleView = view.widthGu > 0 && view.heightGu > 0
    ? clampNodeGraphWorkspaceGridSizeToViewport(view, workspace)
    : view;
  const useFixedFrameSize = modularWindowed
    && visibleView.widthGu > 0
    && visibleView.heightGu > 0;
  const widthCss = useFixedFrameSize
    ? nodeGraphWorkspaceWidthCss(visibleView.widthGu * nodeGraphGridWidth())
    : null;
  const heightCss = useFixedFrameSize
    ? nodeGraphWorkspaceHeightCss(visibleView.heightGu * nodeGraphGridHeight())
    : null;
  applyNodeGraphWorkspaceSizeCss(workspace, widthCss, heightCss);
  if (widthCss) {
    workspace.parentElement?.style.setProperty("--node-workspace-view-width", widthCss);
  } else {
    workspace.parentElement?.style.removeProperty("--node-workspace-view-width");
  }
  // Persist measured size when view is auto (0×0 fill); otherwise store patch view.
  if (visibleView.widthGu > 0 && visibleView.heightGu > 0) {
    workspace.dataset.widthGu = String(visibleView.widthGu);
    workspace.dataset.heightGu = String(visibleView.heightGu);
  } else if (typeof nodeGraphWorkspaceCurrentGridSize === "function") {
    const measured = nodeGraphWorkspaceCurrentGridSize();
    workspace.dataset.widthGu = String(measured.widthGu);
    workspace.dataset.heightGu = String(measured.heightGu);
  } else {
    workspace.dataset.widthGu = String(visibleView.widthGu);
    workspace.dataset.heightGu = String(visibleView.heightGu);
  }
  if (typeof syncNodeGraphModularViewSizeReadout === "function") {
    syncNodeGraphModularViewSizeReadout();
  }
  if (typeof syncNodeGraphWorkspaceResizeHandlePosition === "function") {
    syncNodeGraphWorkspaceResizeHandlePosition();
  }
  workspace.classList.toggle("patch-locked", Boolean(view.locked));
  if (typeof syncNodeGraphReadyPanelChrome === "function") {
    syncNodeGraphReadyPanelChrome();
  }
  if (typeof pinNodeGraphWorkspaceCameraToScreen === "function") {
    pinNodeGraphWorkspaceCameraToScreen(workspace);
  }
  if (typeof applyNodeGraphPan === "function") {
    applyNodeGraphPan();
  }
  scheduleNodeGraphWorkspaceOriginSync();
  if (typeof scheduleNodeGraphSliderReadoutRelayout === "function") {
    scheduleNodeGraphSliderReadoutRelayout();
  }
}

function scheduleNodeGraphWorkspaceOriginSync() {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return;
  }
  if (nodeGraphMvp.workspaceOriginSyncFrame) {
    window.cancelAnimationFrame(nodeGraphMvp.workspaceOriginSyncFrame);
  }
  nodeGraphMvp.workspaceOriginSyncFrame = window.requestAnimationFrame(() => {
    nodeGraphMvp.workspaceOriginSyncFrame = window.requestAnimationFrame(() => {
      nodeGraphMvp.workspaceOriginSyncFrame = 0;
      if (typeof pinNodeGraphWorkspaceCameraToScreen === "function") {
        pinNodeGraphWorkspaceCameraToScreen();
      }
      if (typeof applyNodeGraphPan === "function") {
        applyNodeGraphPan();
      }
    });
  });
}

function nodeGraphZoom() {
  return Number.isFinite(nodeGraphMvp?.zoom) ? nodeGraphMvp.zoom : 1;
}

function nodeGraphZoomLabel() {
  return nodeGraphZoom().toFixed(2);
}

function nodeGraphRenderedPanValue(value, origin = 0) {
  const number = nodeGraphFiniteNumber(value);
  const originNumber = nodeGraphFiniteNumber(origin);
  const rendered = Math.round(originNumber + number) - originNumber;
  return Object.is(rendered, -0) ? 0 : rendered;
}

function invalidateNodeGraphWorkspaceLayoutMetrics() {
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    // Drop left/top seed only. CSS size stays on the ResizeObserver cache —
    // pan/zoom end must not force a remasure.
    nodeGraphMvp._workspaceLayoutMetrics = null;
  }
}

function invalidateNodeGraphWorkspaceCssSize() {
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp._workspaceCssSize = null;
    nodeGraphMvp._workspaceLayoutMetrics = null;
  }
}

/**
 * Workspace padding-box size in layout CSS px (clientWidth/Height).
 * ResizeObserver owns the cache — pan/zoom must not remasure.
 */
function nodeGraphWorkspaceCssSize(container = document.getElementById("nodeGraphWorkspace")) {
  if (!container) {
    return { height: 0, width: 0 };
  }
  ensureNodeGraphWorkspaceCssSizeObserver(container);
  const cached = typeof nodeGraphMvp === "object" ? nodeGraphMvp?._workspaceCssSize : null;
  if (
    cached
    && cached.el === container
    && cached.width > 0
    && cached.height > 0
  ) {
    return { height: cached.height, width: cached.width };
  }
  const width = Math.max(0, nodeGraphFiniteNumber(container.clientWidth || container.offsetWidth));
  const height = Math.max(0, nodeGraphFiniteNumber(container.clientHeight || container.offsetHeight));
  const next = { el: container, height, width };
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp._workspaceCssSize = next;
  }
  return { height, width };
}

function ensureNodeGraphWorkspaceCssSizeObserver(container) {
  if (!container || typeof ResizeObserver !== "function") {
    return;
  }
  if (container._nodeGraphCssSizeObserver) {
    return;
  }
  const ro = new ResizeObserver(() => {
    const width = Math.max(0, nodeGraphFiniteNumber(container.clientWidth || container.offsetWidth));
    const height = Math.max(0, nodeGraphFiniteNumber(container.clientHeight || container.offsetHeight));
    if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
      nodeGraphMvp._workspaceCssSize = { el: container, height, width };
      // Size change also drops gesture layout metrics / camera box.
      nodeGraphMvp._workspaceLayoutMetrics = null;
    }
  });
  try {
    ro.observe(container);
    container._nodeGraphCssSizeObserver = ro;
  } catch (_error) {
    // Detached / already observed.
  }
}

function nodeGraphWorkspaceLayoutMetrics(container = document.getElementById("nodeGraphWorkspace")) {
  const gesturing = typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive();
  if (gesturing && nodeGraphMvp?._workspaceLayoutMetrics) {
    return nodeGraphMvp._workspaceLayoutMetrics;
  }
  // Width/height: layout CSS (client*) — stable under pan/zoom. left/top only
  // for pan pixel-rounding; cold-seed once and reuse while gesturing.
  const css = nodeGraphWorkspaceCssSize(container);
  let left = 0;
  let top = 0;
  const prior = nodeGraphMvp?._workspaceLayoutMetrics;
  // Same size and classes: the borders cannot have moved. Skip the per-frame
  // getComputedStyle (camera presents call this several times a frame).
  if (
    prior
    && prior._cssW === css.width
    && prior._cssH === css.height
    && prior._cls === nodeGraphWorkspaceClassKey(container)
    && Number.isFinite(prior.left)
    && Number.isFinite(prior.top)
  ) {
    return prior;
  }
  if (
    prior
    && prior._cssW === css.width
    && prior._cssH === css.height
    && Number.isFinite(prior.left)
    && Number.isFinite(prior.top)
  ) {
    left = prior.left;
    top = prior.top;
  } else if (container?.getBoundingClientRect) {
    const rect = container.getBoundingClientRect();
    left = nodeGraphFiniteNumber(rect?.left);
    top = nodeGraphFiniteNumber(rect?.top);
  }
  const style = container ? getComputedStyle(container) : null;
  const metrics = {
    _cls: nodeGraphWorkspaceClassKey(container),
    _cssH: css.height,
    _cssW: css.width,
    borderBottom: Number.parseFloat(style?.borderBottomWidth) || 0,
    borderLeft: Number.parseFloat(style?.borderLeftWidth) || 0,
    borderRight: Number.parseFloat(style?.borderRightWidth) || 0,
    borderTop: Number.parseFloat(style?.borderTopWidth) || 0,
    height: css.height,
    left,
    top,
    width: css.width,
  };
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    // Always keep last metrics so the next pan sample can reuse left/top
    // without another gBCR (gesture flag may lag the first CSS apply).
    nodeGraphMvp._workspaceLayoutMetrics = metrics;
  }
  return metrics;
}

function nodeGraphWorkspaceCenterOffset(container = document.getElementById("nodeGraphWorkspace")) {
  const box = nodeGraphWorkspaceLayoutMetrics(container);
  // box.width/height are padding-box (client*). Match prior gBCR formula:
  // borderLeft + (borderBox - borders) / 2 == borderLeft + clientWidth / 2.
  return {
    x: box.borderLeft + Math.max(0, box.width) * 0.5,
    y: box.borderTop + Math.max(0, box.height) * 0.5,
  };
}

function nodeGraphRenderedPan(pan = nodeGraphMvp.pan || { x: 0, y: 0 }, container = document.getElementById("nodeGraphWorkspace")) {
  const box = nodeGraphWorkspaceLayoutMetrics(container);
  return {
    x: nodeGraphRenderedPanValue(pan.x, box.left + box.borderLeft),
    y: nodeGraphRenderedPanValue(pan.y, box.top + box.borderTop),
  };
}

function nodeGraphWorkspaceCameraBox(container = document.getElementById("nodeGraphWorkspace")) {
  if (!container?.getBoundingClientRect) {
    return null;
  }
  const rect = container.getBoundingClientRect();
  const center = nodeGraphWorkspaceCenterOffset(container);
  return {
    left: rect.left,
    top: rect.top,
    centerX: center.x,
    centerY: center.y,
  };
}

function rememberNodeGraphWorkspaceCameraBox(container = document.getElementById("nodeGraphWorkspace")) {
  const box = nodeGraphWorkspaceCameraBox(container);
  if (box && typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.workspaceCameraBox = box;
  }
  return box;
}

function nodeGraphWorkspaceChromePin() {
  const pin = typeof nodeGraphMvp === "object" ? nodeGraphMvp?.workspaceChromePin : null;
  return {
    x: nodeGraphFiniteNumber(pin?.x),
    y: nodeGraphFiniteNumber(pin?.y),
  };
}

/**
 * Chrome (tips band, controller dock) changes #nodeGraphWorkspace's box.
 * Origin is workspace-center + pan, so a height change would slide lamps
 * (and, if pan is reapplied, modules). Hold the graph on the same screen
 * pixels by accumulating a chrome pin — user pan is left alone.
 * Skip while the user is dragging the workspace frame (centered clip).
 */
function pinNodeGraphWorkspaceCameraToScreen(container = document.getElementById("nodeGraphWorkspace")) {
  if (!container || typeof nodeGraphMvp !== "object" || !nodeGraphMvp) {
    return false;
  }
  if (nodeGraphMvp.workspaceResizing) {
    rememberNodeGraphWorkspaceCameraBox(container);
    return false;
  }
  const next = nodeGraphWorkspaceCameraBox(container);
  if (!next) {
    return false;
  }
  const prev = nodeGraphMvp.workspaceCameraBox;
  nodeGraphMvp.workspaceCameraBox = next;
  if (!prev) {
    return false;
  }
  const dx = (prev.left + prev.centerX) - (next.left + next.centerX);
  const dy = (prev.top + prev.centerY) - (next.top + next.centerY);
  if (!(Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05)) {
    return false;
  }
  const pin = nodeGraphWorkspaceChromePin();
  nodeGraphMvp.workspaceChromePin = { x: pin.x + dx, y: pin.y + dy };
  nodeGraphMvp._mouseLightWorkspaceRect = null;
  return true;
}

function setNodeGraphChromeSectionResizing(on) {
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.chromeSectionResizing = Boolean(on);
  }
  document.body.classList.toggle("is-resizing-chrome-section", Boolean(on));
}

/**
 * Taskbar / Start / leaving the browser window often delivers pointercancel
 * or a ghost client point (0,0 or a huge jump). Keep the last good sample.
 */
function nodeGraphSectionResizeAcceptPoint(event, lastPoint) {
  if (!event) {
    return null;
  }
  const type = String(event.type || "");
  if (type === "pointercancel" || type === "lostpointercapture") {
    return null;
  }
  const x = Number(event.clientX);
  const y = Number(event.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (lastPoint) {
    const span = Math.min(nodeGraphFiniteNumber(window.innerWidth, 800), nodeGraphFiniteNumber(window.innerHeight, 600));
    const maxJump = Math.max(160, Math.round(span * 0.4));
    if (Math.abs(x - lastPoint.x) > maxJump || Math.abs(y - lastPoint.y) > maxJump) {
      return null;
    }
  }
  return { x, y };
}

function watchNodeGraphSectionResizeDrag(event, options = {}) {
  const handle = options.handle || event.currentTarget;
  const pointerId = event.pointerId;
  let lastPoint = nodeGraphSectionResizeAcceptPoint(event, null) || {
    x: nodeGraphFiniteNumber(event.clientX),
    y: nodeGraphFiniteNumber(event.clientY),
  };
  let finished = false;
  setNodeGraphChromeSectionResizing(true);
  handle?.classList.add("is-dragging");
  try {
    handle?.setPointerCapture?.(pointerId);
  } catch {
    // ignore
  }

  const onMove = (moveEvent) => {
    if (finished) {
      return;
    }
    if (moveEvent.pointerId != null && pointerId != null && moveEvent.pointerId !== pointerId) {
      return;
    }
    const point = nodeGraphSectionResizeAcceptPoint(moveEvent, lastPoint);
    if (!point) {
      return;
    }
    lastPoint = point;
    options.onMove?.(point, moveEvent);
  };

  const onEnd = (endEvent) => {
    if (finished) {
      return;
    }
    if (endEvent?.pointerId != null && pointerId != null && endEvent.pointerId !== pointerId) {
      return;
    }
    finished = true;
    handle?.classList.remove("is-dragging");
    try {
      if (pointerId != null && handle?.hasPointerCapture?.(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    } catch {
      // ignore
    }
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerup", onEnd, true);
    document.removeEventListener("pointercancel", onEnd, true);
    handle?.removeEventListener("lostpointercapture", onEnd);
    setNodeGraphChromeSectionResizing(false);
    options.onEnd?.(endEvent, lastPoint);
  };

  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerup", onEnd, true);
  document.addEventListener("pointercancel", onEnd, true);
  handle?.addEventListener("lostpointercapture", onEnd);
}

function nodeGraphRenderedOriginOffset(
  pan = nodeGraphMvp.pan || { x: 0, y: 0 },
  container = document.getElementById("nodeGraphWorkspace"),
) {
  const center = nodeGraphWorkspaceCenterOffset(container);
  const renderedPan = nodeGraphRenderedPan(pan, container);
  const pin = nodeGraphWorkspaceChromePin();
  return {
    x: center.x + renderedPan.x + pin.x,
    y: center.y + renderedPan.y + pin.y,
  };
}

function nodeGraphZoomSurfaceHost() {
  return document.getElementById("nodeGraphZoomSurface");
}

/** Camera-scaled world root (modules / origin). Wire SVGs are workspace siblings. */
function nodeGraphWorldLayer() {
  return document.getElementById("nodeGraphWorldLayer")
    || nodeGraphZoomSurfaceHost();
}

/**
 * Coordinate + query root for module/port geometry = world layer under the
 * compositor camera. Prefer this over the unscaled zoom-surface host.
 */
function nodeGraphZoomSurface() {
  return nodeGraphWorldLayer();
}

/**
 * World-space size of the camera root's layout box (pre-scale). Used for
 * module clamp / legacy callers. Wire SVGs use nodeGraphWireCameraViewBox().
 */
function nodeGraphGraphRect() {
  const surface = nodeGraphZoomSurface();
  const graphElement = surface || document.getElementById("nodeGraphWorkspace");
  const rect = graphElement?.getBoundingClientRect?.();
  if (!rect) {
    return { height: 0, width: 0 };
  }
  // A CSS-scaled world layer reports the scaled box. The GPU camera leaves the
  // layer unscaled, so that box is already the layout size.
  const scaled = graphElement?.style?.transform && graphElement.style.transform !== "none";
  const zoom = scaled ? Math.max(0.0001, nodeGraphZoom()) : 1;
  return {
    height: rect.height / zoom,
    width: rect.width / zoom,
  };
}

/**
 * Screen-space wire SVG viewBox = world rectangle currently visible in the
 * workspace. SVG is viewport-sized (scale 1); mapping world->screen is the camera.
 */
function nodeGraphWireCameraViewBox(workspace = document.getElementById("nodeGraphWorkspace")) {
  const host = workspace || document.getElementById("nodeGraphWorkspace");
  const zoom = Math.max(0.0001, nodeGraphZoom());
  let width = 0;
  let height = 0;
  if (typeof nodeGraphWorkspaceLayoutMetrics === "function" && host) {
    const box = nodeGraphWorkspaceLayoutMetrics(host);
    width = Math.max(0, nodeGraphFiniteNumber(box?.width));
    height = Math.max(0, nodeGraphFiniteNumber(box?.height));
  }
  if (!(width > 0) || !(height > 0)) {
    const rect = host?.getBoundingClientRect?.();
    width = Math.max(0, rect?.width || 0);
    height = Math.max(0, rect?.height || 0);
  }
  const pan = (typeof nodeGraphMvp === "object" && nodeGraphMvp?.pan) || { x: 0, y: 0 };
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset(pan, host)
    : { x: 0, y: 0 };
  const ox = nodeGraphFiniteNumber(origin?.x);
  const oy = nodeGraphFiniteNumber(origin?.y);
  return {
    x: -ox / zoom,
    y: -oy / zoom,
    width: width / zoom,
    height: height / zoom,
  };
}

// Camera scale is nodeGraphZoom() (world-layer compositor transform). Do not
// reverse-engineer from getBoundingClientRect / offsetWidth.
function nodeGraphZoomSurfaceClientScale(surface = nodeGraphZoomSurface()) {
  const zoom = Math.max(0.0001, nodeGraphZoom());
  return { x: zoom, y: zoom };
}

function nodeGraphClientToZoomSurfacePoint(clientX, clientY, surface = nodeGraphZoomSurface()) {
  if (!surface) {
    return { x: 0, y: 0 };
  }
  const host = document.getElementById("nodeGraphWorkspace");
  const scale = nodeGraphZoomSurfaceClientScale(surface);
  const scaled = Boolean(surface.style?.transform && surface.style.transform !== "none");
  const gesturing = typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive();
  let left = 0;
  let top = 0;
  if (scaled || gesturing) {
    // Mid-gesture (or frozen HTML camera): no layout reads. The world layer is
    // absolute at 0,0 of the workspace padding box, so its unscaled client
    // origin is the cached workspace metrics plus the border. The frozen layer
    // transform is not the live camera; the live origin below is.
    const metrics = host && typeof nodeGraphWorkspaceLayoutMetrics === "function"
      ? nodeGraphWorkspaceLayoutMetrics(host)
      : null;
    left = nodeGraphFiniteNumber(metrics?.left) + nodeGraphFiniteNumber(metrics?.borderLeft);
    top = nodeGraphFiniteNumber(metrics?.top) + nodeGraphFiniteNumber(metrics?.borderTop);
  } else {
    const rect = surface.getBoundingClientRect?.();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    left = rect.left;
    top = rect.top;
  }
  const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset(pan, host)
    : pan;
  const panX = Number(origin?.x) || 0;
  const panY = Number(origin?.y) || 0;
  return {
    x: (clientX - left - panX) / scale.x,
    y: (clientY - top - panY) / scale.y,
  };
}

function nodeGraphClientPoint(event) {
  return nodeGraphClientToZoomSurfacePoint(event.clientX, event.clientY);
}

function positionNodeGraphNode(node, point, options = {}) {
  const graphRect = nodeGraphGraphRect();
  const maxX = Math.max(0, graphRect.width - node.offsetWidth - 10);
  const maxY = Math.max(0, graphRect.height - node.offsetHeight - 10);
  const snapOptions = { halfGrid: options.halfGrid === true };
  const positionedPoint = options.snap === false ? point : snapNodeGraphPointToGrid(point, snapOptions);
  const x = options.clamp === false
    ? positionedPoint.x
    : Math.max(0, Math.min(maxX, positionedPoint.x));
  const y = options.clamp === false
    ? positionedPoint.y
    : Math.max(0, Math.min(maxY, positionedPoint.y));
  // B-100: this is the only module-position writer, so it also moves the
  // published geometry (plate, jacks, displays, wire ends) in the same call.
  // Before, the GL paint read last move's geometry while titles/labels/sliders
  // read the live DOM, so half the module drew one grid step behind.
  const prevX = Number.parseFloat(node.style.getPropertyValue("--node-x"));
  const prevY = Number.parseFloat(node.style.getPropertyValue("--node-y"));
  node.style.setProperty("--node-x", `${x}px`);
  node.style.setProperty("--node-y", `${y}px`);
  if (
    Number.isFinite(prevX) && Number.isFinite(prevY)
    && (x !== prevX || y !== prevY)
    && typeof nodeGraphModuleGeometryTranslate === "function"
  ) {
    nodeGraphModuleGeometryTranslate(node.dataset?.node, x - prevX, y - prevY);
  }
}

function nodeGraphRectFromPoints(a, b) {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function nodeGraphNodeBounds(node) {
  const x = Number.parseFloat(node.style.getPropertyValue("--node-x")) || 0;
  const y = Number.parseFloat(node.style.getPropertyValue("--node-y")) || 0;
  return {
    bottom: y + node.offsetHeight,
    left: x,
    right: x + node.offsetWidth,
    top: y,
  };
}

function nodeGraphWorkspaceFloatProperty(element, property, fallback = 0) {
  const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
  return Number.isFinite(value) ? value : fallback;
}

var nodeGraphGridVisualScaleLast = 0;
function nodeGraphGridVisualScaleCss(workspace) {
  const host = workspace || document.getElementById("nodeGraphWorkspace");
  if (!host) {
    return 1;
  }
  // The scale is a setting, not a camera value: mid-gesture reuse the last read.
  if (
    nodeGraphGridVisualScaleLast > 0
    && typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive()
  ) {
    return nodeGraphGridVisualScaleLast;
  }
  const raw = Number.parseFloat(
    host.style.getPropertyValue("--node-grid-visual-scale")
    || getComputedStyle(host).getPropertyValue("--node-grid-visual-scale")
    || "",
  );
  if (Number.isFinite(raw) && raw > 0) {
    nodeGraphGridVisualScaleLast = raw;
    return raw;
  }
  if (typeof nodeGraphGridVisualScaleFromMultiply === "function") {
    return nodeGraphGridVisualScaleFromMultiply(
      document.getElementById("nodeUiDevGridDivisionMultiply")?.value,
    );
  }
  return 1;
}

function nodeGraphGridScreenCellPx(workspace, zoom) {
  const z = Number.isFinite(Number(zoom)) ? Number(zoom) : (typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1);
  const visualScale = nodeGraphGridVisualScaleCss(workspace);
  return {
    height: nodeGraphGridHeight() * z * visualScale,
    width: nodeGraphGridWidth() * z * visualScale,
  };
}

function nodeGraphGridBackgroundPhase(origin, cell) {
  const period = Number(cell);
  if (!(period > 0) || !Number.isFinite(period)) {
    return 0;
  }
  const value = nodeGraphFiniteNumber(origin);
  return ((value % period) + period) % period;
}

function applyNodeGraphGridVisualCellSize(workspace, heatmap, zoom) {
  const surface = heatmap || document.getElementById("nodeGridHeatmap");
  const host = workspace || document.getElementById("nodeGraphWorkspace");
  if (!surface || !host) {
    return null;
  }
  const cell = nodeGraphGridScreenCellPx(host, zoom);
  surface.style.setProperty(
    "--node-grid-heatmap-grid-size",
    `${cell.width}px ${cell.height}px`,
  );
  return cell;
}

function nodeGraphHeatmapWantsGrid() {
  return nodeGraphMvp?.gridVisible === true;
}

function nodeGraphHeatmapWantsLight() {
  return nodeGraphMvp?.gridLightVisible !== false;
}

function updateNodeGraphGridHeatmap(options = {}) {
  const heatmap = document.getElementById("nodeGridHeatmap");
  const surface = nodeGraphZoomSurface();
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!heatmap || !surface || !workspace) {
    return;
  }

  const wantGrid = nodeGraphHeatmapWantsGrid();
  const wantLight = nodeGraphHeatmapWantsLight();
  if (!wantGrid && !wantLight && options?.force !== true) {
    heatmap.style.setProperty("--node-grid-heatmap", "none");
    heatmap.style.setProperty(
      "--node-grid-reveal-mask",
      "linear-gradient(transparent, transparent)",
    );
    return;
  }

  const zoom = nodeGraphZoom();
  const origin = nodeGraphRenderedOriginOffset();
  // Phase-wrap into one cell. A raw origin of e.g. -3500 with a 4000px tile
  // puts the 1px line off-screen; Chrome then often skips the next tile, so
  // the line you zoomed in on vanishes once the cell exceeds the workspace.
  const cell = options?.phaseOnly === true
    ? nodeGraphGridScreenCellPx(workspace, zoom)
    : (applyNodeGraphGridVisualCellSize(workspace, heatmap, zoom)
      || nodeGraphGridScreenCellPx(workspace, zoom));
  const phaseX = nodeGraphGridBackgroundPhase(origin.x, cell.width);
  const phaseY = nodeGraphGridBackgroundPhase(origin.y, cell.height);
  heatmap.style.setProperty("--node-grid-heatmap-grid-position", `${phaseX}px ${phaseY}px`);

  const gesturing = typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive();
  // Pause only the O(modules) light/mask rebuild. Grid position already updated.
  // camera:true is the once-a-frame gesture pass (ZP-4): the module glows are
  // screen-space gradients, so they must follow the camera or they stay at the
  // old zoom as blobs. It reuses the cached module bounds (no layout reads).
  if (
    options?.lite === true
    || options?.phaseOnly === true
    || (gesturing && options?.force !== true && options?.camera !== true)
  ) {
    return;
  }

  const glowLayers = [];
  const maskLayers = [];
  const visibleNodes = [...surface.querySelectorAll(".dsp-node:not(.removed):not([hidden])")];
  const lightSpread = Math.max(
    0.4,
    Math.min(2.2, nodeGraphHeatmapFloatProperty(workspace, "--node-module-light-spread", 0.78)),
  );
  const gridSpread = Math.max(
    0.4,
    Math.min(2.2, nodeGraphHeatmapFloatProperty(workspace, "--node-grid-reveal-spread", 0.78)),
  );
  const lightBright = Math.max(
    0,
    Math.min(1, nodeGraphHeatmapFloatProperty(workspace, "--node-module-light-brightness", 1)),
  );
  const roomDim = typeof nodeGraphRoomDim === "function"
    ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(nodeGraphRoomDim())))
    : 0;
  const deep = typeof nodeGraphRoomDimDeep === "function"
    ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(nodeGraphRoomDimDeep())))
    : (roomDim <= 0.5 ? 0 : Math.min(1, (roomDim - 0.5) * 2));
  // The grid and the module lamps never go fully dark with the room: a dark room is a circuit board
  // with its traces still faintly lit.
  const moduleAmt = Math.max(NODE_GRID_DARK_FLOOR, 1 - deep);
  // Stroke colours for the stroke-coloured module light (idle / selected), read once per update.
  const strokeStyle = getComputedStyle(workspace);
  const parseStroke = typeof nodeGraphGlGraphParseCssColor === "function" ? nodeGraphGlGraphParseCssColor : null;
  const idleStroke = parseStroke ? parseStroke(strokeStyle.getPropertyValue("--node-module-idle-stroke"), [0.8, 0.8, 0.85, 0.6]) : [0.8, 0.8, 0.85, 0.6];
  const selectedStroke = parseStroke ? parseStroke(strokeStyle.getPropertyValue("--node-module-selected-stroke"), [0.95, 0.7, 0.7, 1]) : [0.95, 0.7, 0.7, 1];
  const moduleBright = lightBright * moduleAmt;
  // Module world bounds cannot change during a pan/zoom gesture: reuse the
  // last measured box instead of forcing layout on every camera frame.
  const heatmapGesturing = typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive();
  for (const node of visibleNodes) {
    if (node.classList.contains("viewport-asleep")) {
      continue;
    }
    const cachedBounds = heatmapGesturing ? nodeGraphHeatmapBoundsCache.get(node) : null;
    const bounds = cachedBounds || nodeGraphHeatmapNodeBounds(node);
    nodeGraphHeatmapBoundsCache.set(node, bounds);
    const centerX = (bounds.left + (bounds.right - bounds.left) / 2) * zoom + (nodeGraphFiniteNumber(origin.x));
    const centerY = (bounds.top + (bounds.bottom - bounds.top) / 2) * zoom + (nodeGraphFiniteNumber(origin.y));
    const baseX = Math.max(nodeGraphGridWidth() * 5, (bounds.right - bounds.left) * 1.18) * zoom;
    const baseY = Math.max(nodeGraphGridHeight() * 5, (bounds.bottom - bounds.top) * 1.35) * zoom;
    // Module lights are drawn on the GPU (gl-line-renderer: lights pass), not as CSS gradients.
    // The grid reveal around modules is drawn on the GPU (gl-line-renderer lights pass).
  }
  // Screen glow is the veil SDF (sharp shape, smoothstep outward). Do not
  // stamp a CSS ellipse over the glass.
  let mouseAmount = Math.max(0, Math.min(2, nodeGraphHeatmapFloatProperty(workspace, "--node-mouse-light-amount")));
  const mouseSpread = Math.max(0, Math.min(2, nodeGraphHeatmapFloatProperty(workspace, "--node-mouse-light-spread")));
  const mousePoint = nodeGraphMvp.mouseLightPoint;
  // Without a mouse dimmer cutout, fade the mouse light with room dim so it
  // doesn't stay full-bright under the veil. With cutout on, keep full amount
  // (the hole reveals it at design strength).
  if (mouseAmount > 0 && nodeGraphMvp?.dimmerCutoutMouseEnabled !== true
    && typeof nodeGraphRoomDim === "function") {
    const roomDim = Math.max(0, Math.min(1, nodeGraphFiniteNumber(nodeGraphRoomDim())));
    if (roomDim > 0.0005) {
      mouseAmount *= Math.max(NODE_GRID_DARK_FLOOR, 1 - roomDim);
    }
  }
  heatmap.style.setProperty("--node-grid-heatmap", glowLayers.length ? glowLayers.join(", ") : "none");
  const mask = maskLayers.length ? maskLayers.join(", ") : "linear-gradient(transparent, transparent)";
  heatmap.style.setProperty("--node-grid-reveal-mask", mask);
  heatmap.style.setProperty("--node-grid-heatmap-mask", mask);
}

// A module light with a physically plausible falloff. The light leaves the module's edge (t = 0.5 of
// the gradient ellipse, the module hides the inside) and fades as an inverse-square law with a soft
// knee, I = 1 / (1 + (d / d0)^2), windowed to reach zero at the rim. colorAt(t) -> [r, g, b] bytes.
// More colour stops, same single CSS gradient: no extra layers, so no extra cost.
function nodeGraphModuleLightGradient(radiusX, radiusY, cx, cy, colorAt, peak) {
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const stops = [0, 0.5, 0.54, 0.58, 0.63, 0.69, 0.76, 0.84, 0.92, 1];
  const parts = stops.map((t) => {
    const u = Math.max(0, t - 0.5) / 0.5;
    const falloff = (1 / (1 + (u / 0.3) * (u / 0.3))) * (1 - smooth(0.55, 1, u));
    const c = colorAt(t);
    const a = (peak * falloff).toFixed(4);
    return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a}) ${(t * 100).toFixed(1)}%`;
  });
  return `radial-gradient(ellipse ${radiusX.toFixed(2)}px ${radiusY.toFixed(2)}px at ${cx.toFixed(2)}px ${cy.toFixed(2)}px, ${parts.join(", ")})`;
}

// How much of the grid reveal / module light stays in a fully dark room (0..1).
var NODE_GRID_DARK_FLOOR = 0.75;
// The mouse is a light like a module: it reveals the grid with the same falloff a module does, wherever it is, in a lit room or a
// dark one, so the lines around it are exactly as bright as the lines around a module. 1 = the same as a module (dial it here:
// lower is fainter, above 1 reaches further).
var NODE_GRID_LAMP_REVEAL = 1;
// Grid for the GPU lights pass, or null when the grid is off. World-space cell (the grid is anchored at
// the world origin), line colour + alpha, how far modules reveal it, and the mouse reveal.
var nodeGridParamsCache = { at: 0, base: null };
globalThis.nodeGraphGridLightParams = function nodeGraphGridLightParams() {
  if (!nodeGraphHeatmapWantsGrid()) return null;
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) return null;
  const now = performance.now();
  if (!nodeGridParamsCache.base || now - nodeGridParamsCache.at > 250) {
    const cs = getComputedStyle(workspace);
    const rgb = String(cs.getPropertyValue("--node-grid-color-rgb") || "255 255 255").trim().split(/[\s,]+/).map(Number);
    const visualScale = nodeGraphGridVisualScaleCss(workspace);
    nodeGridParamsCache = {
      at: now,
      base: {
        cell: [nodeGraphGridWidth() * visualScale, nodeGraphGridHeight() * visualScale],
        rgba: [(rgb[0] || 255) / 255, (rgb[1] || 255) / 255, (rgb[2] || 255) / 255, nodeGraphHeatmapFloatProperty(workspace, "--node-grid-line-alpha", 0.2)],
        spread: Math.max(0.4, Math.min(2.2, nodeGraphHeatmapFloatProperty(workspace, "--node-grid-reveal-spread", 0.78))),
        mouseSpread: Math.max(0, Math.min(2, nodeGraphHeatmapFloatProperty(workspace, "--node-mouse-light-spread"))),
        mouseBase: Math.max(0, Math.min(2, nodeGraphHeatmapFloatProperty(workspace, "--node-mouse-light-amount"))),
      },
    };
  }
  const b = nodeGridParamsCache.base;
  const roomDim = typeof nodeGraphRoomDim === "function" ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(nodeGraphRoomDim()))) : 0;
  const deep = typeof nodeGraphRoomDimDeep === "function" ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(nodeGraphRoomDimDeep()))) : 0;
  let mouseAmount = b.mouseBase;
  if (mouseAmount > 0 && nodeGraphMvp?.dimmerCutoutMouseEnabled !== true && roomDim > 0.0005) {
    mouseAmount *= Math.max(NODE_GRID_DARK_FLOOR, 1 - roomDim);
  }
  const mouse = nodeGraphMvp?.mouseLightPoint || null;
  const active = Boolean(mouse) && mouseAmount > 0 && b.mouseSpread > 0;
  return {
    cell: b.cell,
    rgba: b.rgba,
    spread: b.spread,
    moduleAmt: Math.max(NODE_GRID_DARK_FLOOR, 1 - deep),
    mouse: active ? mouse : null,
    // The mouse is a light like a module (see NODE_GRID_LAMP_REVEAL).
    reflect: NODE_GRID_LAMP_REVEAL,
    mouseRadius: Math.max(nodeGraphGridWidth(), nodeGraphGridHeight()) * (3 + 10.5 * b.mouseSpread),
    mouseAmount: 0.92 * mouseAmount,
  };
};
// The module light strength the GPU lights pass uses: the workspace brightness setting times how much
// of the light survives the room being dark.
globalThis.nodeGraphModuleLightBrightness = function nodeGraphModuleLightBrightness() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  const lightBright = Math.max(0, Math.min(3, nodeGraphHeatmapFloatProperty(workspace, "--node-module-light-brightness", 1)));
  const deep = typeof nodeGraphRoomDimDeep === "function" ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(nodeGraphRoomDimDeep()))) : 0;
  return lightBright * Math.max(NODE_GRID_DARK_FLOOR, 1 - deep);
};
// The stroke light's strength: the same brightness setting, but not dimmed by the room (the module
// stroke and its loudness animation stay at full strength under the dimmer).
globalThis.nodeGraphModuleStrokeLightBrightness = function nodeGraphModuleStrokeLightBrightness() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  return Math.max(0, Math.min(3, nodeGraphHeatmapFloatProperty(workspace, "--node-module-light-brightness", 1)));
};
var nodeGraphHeatmapBoundsCache = new WeakMap();

// Heatmap only (marquee / drag repaint it every frame): node size from a
// ResizeObserver instead of offsetWidth/offsetHeight, position from the
// inline --node-x/--node-y. First sight of a node measures once.
var nodeGraphHeatmapSizeCache = new WeakMap();
var nodeGraphHeatmapSizeObserver = null;
function nodeGraphHeatmapNodeBounds(node) {
  let size = nodeGraphHeatmapSizeCache.get(node);
  if (!size) {
    size = { w: node.offsetWidth, h: node.offsetHeight };
    nodeGraphHeatmapSizeCache.set(node, size);
    if (typeof ResizeObserver === "function") {
      if (!nodeGraphHeatmapSizeObserver) {
        nodeGraphHeatmapSizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const el = entry.target;
            nodeGraphHeatmapSizeCache.set(el, { w: el.offsetWidth, h: el.offsetHeight });
          }
        });
      }
      nodeGraphHeatmapSizeObserver.observe(node);
    }
  }
  const x = Number.parseFloat(node.style.getPropertyValue("--node-x")) || 0;
  const y = Number.parseFloat(node.style.getPropertyValue("--node-y")) || 0;
  return { bottom: y + size.h, left: x, right: x + size.w, top: y };
}

// Workspace tuning vars for the heatmap: computed style once per distinct
// style state (pan / zoom vars excluded from the key, they change per frame).
var nodeGraphHeatmapFloatCache = new Map();
function nodeGraphWorkspaceClassKey(workspace) {
  return String(workspace?.className || "")
    .replace(/\b(viewport-gesturing|viewport-zooming|pixelated-canvas-zoom)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
var nodeGraphHeatmapFloatLast = new Map();
function nodeGraphHeatmapFloatProperty(workspace, property, fallback = 0) {
  // Tuning vars are settings, not camera state: a gesture reuses the last value.
  if (
    nodeGraphHeatmapFloatLast.has(property)
    && typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive()
  ) {
    return nodeGraphHeatmapFloatLast.get(property);
  }
  // Gesture classes and the frozen stroke var do not touch these tuning vars;
  // keeping them out of the key means a gesture never starts with a miss.
  const styleKey = String(workspace?.getAttribute?.("style") || "")
    .replace(/--node-graph-(pan|zoom)[^;]*;?/g, "")
    .replace(/--node-module-stroke-zoom-compensate-frozen[^;]*;?/g, "");
  const key = `${property}|${styleKey}|${nodeGraphWorkspaceClassKey(workspace)}|${document.body?.className || ""}|${document.documentElement.getAttribute("style") || ""}`;
  if (nodeGraphHeatmapFloatCache.has(key)) {
    const hit = nodeGraphHeatmapFloatCache.get(key);
    nodeGraphHeatmapFloatLast.set(property, hit);
    return hit;
  }
  const value = nodeGraphWorkspaceFloatProperty(workspace, property, fallback);
  nodeGraphHeatmapFloatLast.set(property, value);
  if (nodeGraphHeatmapFloatCache.size > 256) nodeGraphHeatmapFloatCache.clear();
  nodeGraphHeatmapFloatCache.set(key, value);
  return value;
}

function scheduleNodeGraphGridHeatmapUpdate() {
  if (nodeGraphMvp.mouseLightFrame) {
    return;
  }
  if (!nodeGraphHeatmapWantsGrid() && !nodeGraphHeatmapWantsLight()) {
    return;
  }
  nodeGraphMvp.mouseLightFrame = window.requestAnimationFrame(() => {
    nodeGraphMvp.mouseLightFrame = 0;
    const gesturing = typeof nodeGraphViewportGestureActive === "function"
      && nodeGraphViewportGestureActive();
    updateNodeGraphGridHeatmap({ lite: gesturing });
  });
}

function updateNodeGraphMouseLight(event) {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  // Avoid getBoundingClientRect on every move when possible: workspace is the
  // event target for canvas moves; still need rect for origin. Cache for 1 frame.
  let rect = nodeGraphMvp._mouseLightWorkspaceRect;
  const now = performance.now?.() || Date.now();
  const gesturing = typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive();
  if (gesturing) {
    // Zoom/pan never moves the workspace box: reuse the last rect, or the
    // cached gesture layout metrics (same client left/top), never measure.
    if (!rect) rect = nodeGraphWorkspaceLayoutMetrics(workspace);
  } else if (!rect || (now - (nodeGraphMvp._mouseLightWorkspaceRectAt || 0)) > 250) {
    rect = workspace.getBoundingClientRect();
    nodeGraphMvp._mouseLightWorkspaceRect = rect;
    nodeGraphMvp._mouseLightWorkspaceRectAt = now;
  }
  nodeGraphMvp.mouseLightPoint = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  if (typeof nodeGraphViewportGestureActive === "function" && nodeGraphViewportGestureActive()) {
    updateNodeGraphGridHeatmap({ lite: true });
    return;
  }
  scheduleNodeGraphGridHeatmapUpdate();
  if (typeof nodeGraphGlGraphPresentDisplaysSoon === "function") nodeGraphGlGraphPresentDisplaysSoon();
}

function clearNodeGraphMouseLight() {
  nodeGraphMvp.mouseLightPoint = null;
  if (typeof nodeGraphGlGraphPresentDisplaysSoon === "function") nodeGraphGlGraphPresentDisplaysSoon();
  if (nodeGraphHeatmapWantsGrid() || nodeGraphHeatmapWantsLight()) {
    updateNodeGraphGridHeatmap();
  }
}

function nodeGraphRectsIntersect(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}
