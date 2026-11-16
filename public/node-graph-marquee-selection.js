// Hitpoint / “snake” selection: drag a thick dotted trail on empty canvas;
// whatever the trail crosses is selected. First hit locks mode to modules XOR wires.
// Locked patch: trail + wire hits still run; modules are never selected.
// Samples the mouse path with lerp so fast drags do not skip over modules/wires.
// Wires also use geometric path hits (isPointInStroke / length sampling) because
// cable hit-paths live under modules and elementFromPoint alone misses them.

// Near-duplicate skip only. A 2px collapse + in-place tip rewrite was eating
// the first samples (dot, then delay) and turning the trail into a polyline.
const nodeGraphHitTrailMinStepPx = 0.12;
const nodeGraphHitTrailMaxPoints = 4000;
/**
 * Layout-px step along a segment when sampling hits.
 * Larger steps + polyline wire cache (not isPointInStroke per path) keep
 * snake select responsive on dense patches (crossovers, many ports).
 */
const nodeGraphHitTrailSampleStepPx = 14;
/**
 * Extra half-width (surface layout px) around the snake for wire/module hits.
 * Matches ~snake visual thickness so grazing a cable still counts.
 */
const nodeGraphHitTrailHitRadiusPx = 10;

function nodeGraphHitTrailZoom() {
  return Math.max(0.0001, typeof nodeGraphZoom === "function" ? nodeGraphFiniteNumber(nodeGraphZoom(), 1) : 1);
}

/** Surface (layout) point → viewport client coordinates. */
function nodeGraphSurfacePointToClient(point, surface = typeof nodeGraphZoomSurface === "function" ? nodeGraphZoomSurface() : null) {
  const rect = surface?.getBoundingClientRect?.();
  if (!rect || !point) {
    return { x: 0, y: 0 };
  }
  const zoom = nodeGraphHitTrailZoom();
  return {
    x: rect.left + Number(point.x) * zoom,
    y: rect.top + Number(point.y) * zoom,
  };
}

// Kept lines are the patch's drawings (saved with it): one entry per
// mouse-down..mouse-up stroke.
function nodeGraphHitTrailKeptStrokes() {
  const patch = nodeGraphMvp.patch;
  if (!patch) return [];
  if (!Array.isArray(patch.drawings)) patch.drawings = [];
  return patch.drawings;
}

// Drawing undo/redo (Pencil page buttons), separate from the patch history.
function nodeGraphDrawingHistory() {
  if (!nodeGraphMvp.drawingHistory) nodeGraphMvp.drawingHistory = { undo: [], redo: [] };
  return nodeGraphMvp.drawingHistory;
}

function clearNodeGraphDrawingHistory() {
  nodeGraphMvp.drawingHistory = { undo: [], redo: [] };
  if (typeof syncNodeGraphPencilPageButtons === "function") syncNodeGraphPencilPageButtons();
}

function nodeGraphDrawingsCopy(list) {
  return (Array.isArray(list) ? list : []).map((s) => ({
    points: s.points.map((p) => ({ x: p.x, y: p.y })),
    worldDash: Array.isArray(s.worldDash) ? s.worldDash.slice() : s.worldDash,
    worldWidth: s.worldWidth,
  }));
}

/** Replace the patch's drawings. Marks the patch edited and autosaves; no patch-history step. */
function setNodeGraphDrawings(next, options = {}) {
  const patch = nodeGraphMvp.patch;
  if (!patch) return;
  if (options.record !== false) {
    const history = nodeGraphDrawingHistory();
    history.undo.push(nodeGraphDrawingsCopy(patch.drawings));
    history.redo = [];
  }
  patch.drawings = typeof normalizeNodeGraphPatchDrawings === "function"
    ? normalizeNodeGraphPatchDrawings(next)
    : next;
  nodeGraphMvp.patchDirtyState = "edited";
  if (typeof syncNodeGraphHeaderPatchTitle === "function") syncNodeGraphHeaderPatchTitle();
  if (typeof scheduleNodeGraphHistoryAutosave === "function") scheduleNodeGraphHistoryAutosave();
  if (typeof syncNodeGraphPencilPageButtons === "function") syncNodeGraphPencilPageButtons();
  presentNodeGraphHitTrail();
}

function undoNodeGraphDrawing() {
  const history = nodeGraphDrawingHistory();
  if (!history.undo.length) return;
  history.redo.push(nodeGraphDrawingsCopy(nodeGraphHitTrailKeptStrokes()));
  setNodeGraphDrawings(history.undo.pop(), { record: false });
}

function redoNodeGraphDrawing() {
  const history = nodeGraphDrawingHistory();
  if (!history.redo.length) return;
  history.undo.push(nodeGraphDrawingsCopy(nodeGraphHitTrailKeptStrokes()));
  setNodeGraphDrawings(history.redo.pop(), { record: false });
}

/** Erase every drawing whose line passes within `radius` world px of (x, y). Returns how many went. */
function nodeGraphDrawingIndicesNear(x, y, radius) {
  const strokes = nodeGraphHitTrailKeptStrokes();
  const hits = [];
  for (let i = 0; i < strokes.length; i += 1) {
    const s = strokes[i];
    const reach = radius + (Number(s.worldWidth) || 0) * 0.5;
    const pts = s.points || [];
    let hit = false;
    if (pts.length === 1) {
      hit = Math.hypot(pts[0].x - x, pts[0].y - y) <= reach;
    }
    for (let k = 1; k < pts.length && !hit; k += 1) {
      hit = nodeGraphDistPointToSegment(x, y, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y) <= reach;
    }
    if (hit) hits.push(i);
  }
  return hits;
}

// Pencil (Command Center > Pencil). Sizes are screen px at the moment a line
// is drawn: a new line always starts at the same size on screen, and once
// drawn it lives in world units, so zooming scales it like everything else.
const nodeGraphPencilDefaults = Object.freeze({ width: 6, dash: 14, gap: 11 });
const nodeGraphPencilStorageKey = "soemdsp-sandbox.pencil";

function nodeGraphPencilSettings() {
  if (!nodeGraphMvp.pencil) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(nodeGraphPencilStorageKey) || "null");
    } catch (_e) {
      saved = null;
    }
    const pick = (key) => {
      const n = Number(saved?.[key]);
      return Number.isFinite(n) && n >= 0 ? n : nodeGraphPencilDefaults[key];
    };
    nodeGraphMvp.pencil = { width: pick("width"), dash: pick("dash"), gap: pick("gap") };
  }
  return nodeGraphMvp.pencil;
}

function setNodeGraphPencilSetting(key, value) {
  const pencil = nodeGraphPencilSettings();
  const n = Number(value);
  if (!(key in nodeGraphPencilDefaults) || !Number.isFinite(n) || n < 0) return;
  pencil[key] = n;
  try {
    localStorage.setItem(nodeGraphPencilStorageKey, JSON.stringify(pencil));
  } catch (_e) { /* private window: settings last for this session */ }
  if (typeof presentNodeGraphHitTrail === "function") presentNodeGraphHitTrail();
}

// Pencil tool: "select" (drag selects; Ctrl keeps the line), "draw" (every
// stroke is kept, nothing is selected), "erase" (whole strokes the pointer
// touches are removed). Not saved: a reload starts in Select.
function nodeGraphPencilTool() {
  const tool = nodeGraphMvp.pencilTool;
  return tool === "draw" || tool === "erase" ? tool : "select";
}

function setNodeGraphPencilTool(tool) {
  nodeGraphMvp.pencilTool = tool === "draw" || tool === "erase" ? tool : "select";
  document.body?.classList.toggle("pencil-tool-draw", nodeGraphMvp.pencilTool === "draw");
  document.body?.classList.toggle("pencil-tool-erase", nodeGraphMvp.pencilTool === "erase");
  if (typeof syncNodeGraphPencilPageButtons === "function") syncNodeGraphPencilPageButtons();
}

// Eraser reach around the pointer, screen px (plus the stroke's own half width).
const nodeGraphPencilEraseRadiusPx = 8;

/** Erase whole drawings along the segment a..b (world px). One undo step per press. */
function nodeGraphPencilEraseAlong(drag, a, b) {
  const zoom = nodeGraphHitTrailZoom();
  const radius = nodeGraphPencilEraseRadiusPx / zoom;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / Math.max(radius * 0.5, 1e-3)));
  const doomed = new Set();
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    for (const i of nodeGraphDrawingIndicesNear(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius)) doomed.add(i);
  }
  if (!doomed.size) return;
  const strokes = nodeGraphHitTrailKeptStrokes();
  const next = strokes.filter((_s, i) => !doomed.has(i));
  // The first erase of this press is the undo step; later ones join it.
  setNodeGraphDrawings(next, { record: !drag.erased });
  drag.erased = true;
}

/**
 * The pen for a line that starts now, in world units (screen px / zoom), so it
 * keeps its size relative to the canvas after it is drawn. Gap 0 = solid.
 */
function nodeGraphHitTrailLivePen() {
  const pencil = nodeGraphPencilSettings();
  const zoom = nodeGraphHitTrailZoom();
  return {
    worldWidth: pencil.width / zoom,
    worldDash: [pencil.dash / zoom, pencil.gap / zoom],
  };
}

function clearNodeGraphHitTrailKept() {
  if (nodeGraphHitTrailKeptStrokes().length) setNodeGraphDrawings([]);
}

/** Add strokes (arrays of points) as drawings in one undoable step. */
function nodeGraphHitTrailPushKept(pointLists, pen = null) {
  const lists = (Array.isArray(pointLists?.[0]) ? pointLists : [pointLists]).filter((l) => l?.length);
  if (!lists.length) {
    return;
  }
  const style = pen || nodeGraphHitTrailLivePen();
  const next = nodeGraphHitTrailKeptStrokes().slice();
  for (const points of lists) {
    next.push({
      points: points.map((p) => ({ x: nodeGraphFiniteNumber(p.x), y: nodeGraphFiniteNumber(p.y) })),
      worldDash: style.worldDash,
      worldWidth: style.worldWidth,
    });
  }
  setNodeGraphDrawings(next);
}

function nodeGraphHitTrailMirrorPoint(point, center) {
  // Vertical axis through the Shift+click: left↔right only (heart, not 180° spin).
  return {
    x: (2 * center.x) - point.x,
    y: point.y,
  };
}

function nodeGraphHitTrailMirrorStroke(points, center) {
  if (!points?.length || !center) {
    return [];
  }
  return points.map((p) => nodeGraphHitTrailMirrorPoint(p, center));
}

function nodeGraphHitTrailEnsureMirrorStrokes(drag) {
  if (!drag) {
    return [];
  }
  if (!Array.isArray(drag.mirrorStrokes)) {
    drag.mirrorStrokes = [];
  }
  return drag.mirrorStrokes;
}

function nodeGraphHitTrailStampMirrorPoint(drag, point) {
  if (!drag?.mirrorDraw || !point) {
    return false;
  }
  const center = nodeGraphMvp.hitTrailMirrorCenter;
  if (!center) {
    return false;
  }
  const strokes = nodeGraphHitTrailEnsureMirrorStrokes(drag);
  let stroke = strokes[strokes.length - 1];
  if (!stroke) {
    stroke = [];
    strokes.push(stroke);
  }
  const mirrored = nodeGraphHitTrailMirrorPoint(point, center);
  const last = stroke[stroke.length - 1];
  if (last) {
    const dx = mirrored.x - last.x;
    const dy = mirrored.y - last.y;
    if ((dx * dx) + (dy * dy) < nodeGraphHitTrailMinStepPx * nodeGraphHitTrailMinStepPx) {
      return false;
    }
  }
  stroke.push(mirrored);
  if (stroke.length > nodeGraphHitTrailMaxPoints) {
    stroke.splice(0, stroke.length - nodeGraphHitTrailMaxPoints);
  }
  return true;
}

function nodeGraphHitTrailBeginMirrorStroke(drag, point) {
  if (!drag) {
    return;
  }
  const strokes = nodeGraphHitTrailEnsureMirrorStrokes(drag);
  const last = strokes[strokes.length - 1];
  if (!last || last.length) {
    strokes.push([]);
  }
  drag.mirrorDraw = true;
  nodeGraphHitTrailStampMirrorPoint(drag, point);
}

function nodeGraphHitTrailAllStrokes() {
  const strokes = nodeGraphHitTrailKeptStrokes().slice();
  const drag = nodeGraphMvp.marqueeSelection;
  // The pen is fixed when the line starts (zooming mid-line does not resize it).
  const pen = drag?.pen || nodeGraphHitTrailLivePen();
  const live = drag?.erase ? null : drag?.points;
  if (live?.length) {
    strokes.push({ live: true, points: live, worldDash: pen.worldDash, worldWidth: pen.worldWidth });
  }
  if (!drag?.erase && Array.isArray(drag?.mirrorStrokes)) {
    for (const points of drag.mirrorStrokes) {
      if (points?.length) {
        strokes.push({ live: true, points, worldDash: pen.worldDash, worldWidth: pen.worldWidth });
      }
    }
  }
  return strokes;
}

/** Draw the snake trail. The GL graph owns it (on #nodeGlGraphSnake, above the mini view). */
function presentNodeGraphHitTrail() {
  if (typeof nodeGraphGlGraphPresentTrail === "function") {
    nodeGraphGlGraphPresentTrail();
  }
}

const NODE_GRAPH_SNAKE_MOUSE_SMOOTH_MAX = 0.17;

function clampNodeGraphSnakeMouseSmooth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(NODE_GRAPH_SNAKE_MOUSE_SMOOTH_MAX, n));
}

function nodeGraphSnakeMouseSmoothAmount() {
  return clampNodeGraphSnakeMouseSmooth(nodeGraphMvp?.snakeMouseSmooth);
}

function syncNodeGraphSnakeMouseSmoothControl() {
  const button = document.getElementById("nodeSnakeMouseSmoothSlider");
  if (!button) {
    return;
  }
  if (typeof button._syncToolbarFill === "function") {
    button._syncToolbarFill();
    return;
  }
  const amount = nodeGraphSnakeMouseSmoothAmount();
  button.style.setProperty("--toolbar-fill", String(amount));
  button.setAttribute("aria-valuenow", String(amount));
  button.setAttribute("aria-valuetext", `${Math.round(amount * 100)}%`);
  button.setAttribute("aria-pressed", amount > 0.001 ? "true" : "false");
}

function persistNodeGraphSnakeMouseSmoothSetting() {
  if (typeof serializeNodeUiDevSettings !== "function") {
    return;
  }
  if (typeof saveNodeUiDevLocalDefaultSettings === "function") {
    saveNodeUiDevLocalDefaultSettings(serializeNodeUiDevSettings());
  }
}

function setNodeGraphSnakeMouseSmooth(value, options = {}) {
  nodeGraphMvp.snakeMouseSmooth = clampNodeGraphSnakeMouseSmooth(value);
  if (options.sync !== false) {
    syncNodeGraphSnakeMouseSmoothControl();
  }
  if (options.persist) {
    persistNodeGraphSnakeMouseSmoothSetting();
  }
  return nodeGraphMvp.snakeMouseSmooth;
}

function bindNodeGraphSnakeMouseSmoothControl() {
  const button = document.getElementById("nodeSnakeMouseSmoothSlider");
  if (!button || button.dataset.snakeMouseSmoothBound === "true") {
    return;
  }
  button.dataset.snakeMouseSmoothBound = "true";
  if (typeof bindNodeGraphToolbarFillSlider === "function") {
    bindNodeGraphToolbarFillSlider(button, {
      min: 0,
      max: NODE_GRAPH_SNAKE_MOUSE_SMOOTH_MAX,
      get: () => nodeGraphSnakeMouseSmoothAmount(),
      set: (value, options = {}) => {
        setNodeGraphSnakeMouseSmooth(value, {
          persist: Boolean(options.persist),
          sync: true,
        });
      },
      format: (value) => `${Math.round(clampNodeGraphSnakeMouseSmooth(value) * 100)}%`,
    });
    return;
  }
  syncNodeGraphSnakeMouseSmoothControl();
}

function nodeGraphHitTrailEnsureMouseSmooth(drag, point, amount) {
  if (!drag || typeof createNodeGraphMouseSmoothState !== "function") {
    return null;
  }
  if (!drag.mouseSmooth) {
    drag.mouseSmooth = createNodeGraphMouseSmoothState(point.x, point.y);
    if (typeof nodeGraphMouseSmoothBegin === "function") {
      nodeGraphMouseSmoothBegin(drag.mouseSmooth, amount, point.x, point.y);
    }
  }
  return drag.mouseSmooth;
}

function nodeGraphHitTrailSmoothPointer(drag, point) {
  const amount = nodeGraphSnakeMouseSmoothAmount();
  let sx = nodeGraphFiniteNumber(point.x);
  let sy = nodeGraphFiniteNumber(point.y);
  const filter = nodeGraphHitTrailEnsureMouseSmooth(drag, point, amount);
  if (filter && typeof nodeGraphMouseSmoothPoint === "function") {
    const smoothed = nodeGraphMouseSmoothPoint(filter, sx, sy, amount);
    sx = smoothed.x;
    sy = smoothed.y;
  }
  // Amount 0: Papoulis is passthrough. Keep the former light 1-frame EMA so
  // the lowest slider notch is the original (working) snake feel.
  if (amount <= 1e-4 && drag.points?.length) {
    const last = drag.points[drag.points.length - 1];
    const ema = 0.65;
    sx = last.x + (sx - last.x) * ema;
    sy = last.y + (sy - last.y) * ema;
  }
  return { x: sx, y: sy };
}

function nodeGraphHitTrailAppendPoint(drag, point) {
  const smoothed = nodeGraphHitTrailSmoothPointer(drag, point);
  if (!drag.points?.length) {
    drag.points = [smoothed];
    nodeGraphHitTrailStampMirrorPoint(drag, smoothed);
    return true;
  }
  const last = drag.points[drag.points.length - 1];
  const dx = smoothed.x - last.x;
  const dy = smoothed.y - last.y;
  if ((dx * dx) + (dy * dy) < nodeGraphHitTrailMinStepPx * nodeGraphHitTrailMinStepPx) {
    return false;
  }
  drag.points.push(smoothed);
  if (drag.points.length > nodeGraphHitTrailMaxPoints) {
    drag.points.splice(0, drag.points.length - nodeGraphHitTrailMaxPoints);
  }
  nodeGraphHitTrailStampMirrorPoint(drag, smoothed);
  return true;
}

/**
 * Parse a wire hit from an element (hit-path or visible path).
 * @returns {{ kind: "wire", wireKind: string, index: number } | null}
 */
function nodeGraphWireHitFromElement(el) {
  if (!el || !(el instanceof Element) || el.classList?.contains("temp")) {
    return null;
  }
  const wire = el.closest?.(".node-wire-hit-path, .node-wire-path");
  if (!wire || wire.classList.contains("temp")) {
    return null;
  }
  const index = Number(wire.dataset.connectionIndex);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  return {
    kind: "wire",
    wireKind: wire.dataset.connectionKind || "signal",
    index,
  };
}

/**
 * What is under a client point (modules / wires).
 * Uses elementsFromPoint (full stack) so wires under modules still register.
 * Trail has pointer-events:none so it never steals hits.
 * @returns {Array<{ kind: string, id?: string, wireKind?: string, index?: number }>}
 */
function nodeGraphHitTestSelectionStackAtClient(clientX, clientY) {
  const hits = [];
  const seenWire = new Set();
  const seenModule = new Set();
  const stack = typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(clientX, clientY)
    : [document.elementFromPoint(clientX, clientY)].filter(Boolean);

  for (const el of stack) {
    if (!(el instanceof Element)) {
      continue;
    }
    const wireHit = nodeGraphWireHitFromElement(el);
    if (wireHit) {
      const key = `${wireHit.wireKind}:${wireHit.index}`;
      if (!seenWire.has(key)) {
        seenWire.add(key);
        hits.push(wireHit);
      }
      continue;
    }
    const node = el.closest?.(".dsp-node");
    if (node?.dataset?.node && !node.classList.contains("removed")) {
      const id = node.dataset.node;
      if (!seenModule.has(id)) {
        seenModule.add(id);
        hits.push({ kind: "module", id });
      }
    }
  }
  return hits;
}

/**
 * Build once per snake drag: surface AABBs without re-reading offsetWidth every
 * sample (that forced layout thrash × module count).
 */
function nodeGraphHitTrailEnsureModuleBoundsCache(drag) {
  if (drag?.moduleBoundsCache) {
    return drag.moduleBoundsCache;
  }
  const cache = [];
  for (const node of document.querySelectorAll(".dsp-node:not(.removed)")) {
    const id = node.dataset?.node;
    if (!id) {
      continue;
    }
    const x = Number.parseFloat(node.style.getPropertyValue("--node-x")) || 0;
    const y = Number.parseFloat(node.style.getPropertyValue("--node-y")) || 0;
    // One layout read per module per drag, not per sample.
    const w = Math.max(1, node.offsetWidth || 0);
    const h = Math.max(1, node.offsetHeight || 0);
    cache.push({
      bottom: y + h,
      id,
      left: x,
      right: x + w,
      top: y,
    });
  }
  if (drag) {
    drag.moduleBoundsCache = cache;
  }
  return cache;
}

/** Geometric module hit in surface space (modules use pointer-events:none on the plate). */
function nodeGraphModulesContainingSurfacePoint(point, padPx = 0, boundsCache = null) {
  const hits = [];
  if (!point) {
    return hits;
  }
  const pad = Math.max(0, nodeGraphFiniteNumber(padPx));
  const list = boundsCache
    || (typeof nodeGraphHitTrailEnsureModuleBoundsCache === "function"
      ? nodeGraphHitTrailEnsureModuleBoundsCache(nodeGraphMvp?.marqueeSelection)
      : null);
  if (Array.isArray(list) && list.length) {
    for (const b of list) {
      if (
        point.x >= b.left - pad
        && point.x <= b.right + pad
        && point.y >= b.top - pad
        && point.y <= b.bottom + pad
      ) {
        hits.push({ kind: "module", id: b.id });
      }
    }
    return hits;
  }
  // Fallback (no active drag cache).
  if (typeof nodeGraphNodeBounds !== "function") {
    return hits;
  }
  for (const node of document.querySelectorAll(".dsp-node:not(.removed)")) {
    const id = node.dataset?.node;
    if (!id) {
      continue;
    }
    const b = nodeGraphNodeBounds(node);
    if (
      point.x >= b.left - pad
      && point.x <= b.right + pad
      && point.y >= b.top - pad
      && point.y <= b.bottom + pad
    ) {
      hits.push({ kind: "module", id });
    }
  }
  return hits;
}

/**
 * Distance from point P to segment AB (surface space).
 */
function nodeGraphDistPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = (abx * abx) + (aby * aby);
  if (abLen2 <= 1e-9) {
    return Math.hypot(apx, apy);
  }
  let t = ((apx * abx) + (apy * aby)) / abLen2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + (abx * t);
  const cy = ay + (aby * t);
  return Math.hypot(px - cx, py - cy);
}

/**
 * True if surface point is within radius of an SVG path's stroke geometry.
 * Prefers isPointInStroke (uses path stroke-width); falls back to length sampling.
 */
function nodeGraphSurfacePointHitsSvgPath(pathEl, surfaceX, surfaceY, extraRadiusPx = 0) {
  if (!pathEl || typeof pathEl.getTotalLength !== "function") {
    return false;
  }
  const svg = pathEl.ownerSVGElement;
  if (!svg) {
    return false;
  }

  // isPointInStroke: coordinates in the path's local user space (viewBox = surface).
  if (typeof pathEl.isPointInStroke === "function" && typeof svg.createSVGPoint === "function") {
    try {
      const pt = svg.createSVGPoint();
      pt.x = surfaceX;
      pt.y = surfaceY;
      if (pathEl.isPointInStroke(pt)) {
        return true;
      }
      // Expand hit with a small axis-aligned ring (snake thickness). 4 probes
      // is enough; 8× paths × samples was a main-thread killer on busy patches.
      const r = Math.max(0, extraRadiusPx);
      if (r > 0) {
        const ring = [[r, 0], [-r, 0], [0, r], [0, -r]];
        for (const [ox, oy] of ring) {
          pt.x = surfaceX + ox;
          pt.y = surfaceY + oy;
          if (pathEl.isPointInStroke(pt)) {
            return true;
          }
        }
      }
    } catch (_error) {
      // Fall through to length sampling.
    }
  }

  // Fallback: sample along path, distance in surface px.
  const total = pathEl.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) {
    return false;
  }
  const radius = Math.max(8, extraRadiusPx + 6);
  const step = Math.max(2, Math.min(8, radius * 0.45));
  let prev = pathEl.getPointAtLength(0);
  for (let d = 0; d <= total; d += step) {
    const cur = pathEl.getPointAtLength(Math.min(total, d));
    if (nodeGraphDistPointToSegment(surfaceX, surfaceY, prev.x, prev.y, cur.x, cur.y) <= radius) {
      return true;
    }
    prev = cur;
  }
  const end = pathEl.getPointAtLength(total);
  if (nodeGraphDistPointToSegment(surfaceX, surfaceY, prev.x, prev.y, end.x, end.y) <= radius) {
    return true;
  }
  return false;
}

/**
 * Pre-sample wire geometry once per drag into polylines + bboxes.
 * Runtime hits use pure JS segment distance — never isPointInStroke per move
 * (that was the snake main-thread freeze on multiport modules).
 */
function nodeGraphHitTrailEnsureWireGeomCache(drag) {
  if (drag?.wireGeomCache) {
    return drag.wireGeomCache;
  }
  const glWires = typeof nodeGraphGlGraphState !== "undefined" ? nodeGraphGlGraphState?.wires : null;
  if (Array.isArray(glWires) && glWires.length) {
    const geoms = [];
    for (let w = 0; w < glWires.length; w += 1) {
      const wire = glWires[w];
      const pts = wire?.xy;
      if (!wire?.kind || wire.index < 0 || !pts || pts.length < 4) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const flat = [];
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i];
        const y = pts[i + 1];
        flat.push(x, y);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      geoms.push({
        maxX,
        maxY,
        minX,
        minY,
        pts: flat,
        wireHit: { kind: "wire", wireKind: wire.kind, index: wire.index },
      });
    }
    if (drag) {
      drag.wireGeomCache = geoms;
      drag.wirePathCache = [];
    }
    return geoms;
  }
  const hitKeys = new Set();
  const pathEls = [];
  for (const pathEl of document.querySelectorAll(".node-wire-hit-path")) {
    if (!(pathEl instanceof SVGGeometryElement) || pathEl.classList.contains("temp")) {
      continue;
    }
    const idx = String(pathEl.dataset.connectionIndex ?? "");
    const kind = String(pathEl.dataset.connectionKind || "signal");
    if (idx) {
      hitKeys.add(`${kind}:${idx}`);
    }
    pathEls.push(pathEl);
  }
  for (const pathEl of document.querySelectorAll(".node-wire-path:not(.temp)")) {
    if (!(pathEl instanceof SVGGeometryElement)) {
      continue;
    }
    const idx = String(pathEl.dataset.connectionIndex ?? "");
    const kind = String(pathEl.dataset.connectionKind || "signal");
    if (idx && hitKeys.has(`${kind}:${idx}`)) {
      continue;
    }
    pathEls.push(pathEl);
  }

  const geoms = [];
  for (const pathEl of pathEls) {
    const wireHit = nodeGraphWireHitFromElement(pathEl);
    if (!wireHit) {
      continue;
    }
    let total = 0;
    try {
      total = nodeGraphFiniteNumber(pathEl.getTotalLength());
    } catch (_error) {
      total = 0;
    }
    if (!(total > 0)) {
      continue;
    }
    // ~24 samples per cable is enough for thick-stroke snake hits.
    const count = Math.max(4, Math.min(28, Math.ceil(total / 18)));
    const pts = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i <= count; i += 1) {
      const p = pathEl.getPointAtLength((total * i) / count);
      const x = nodeGraphFiniteNumber(p.x);
      const y = nodeGraphFiniteNumber(p.y);
      pts.push(x, y);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    geoms.push({
      maxX,
      maxY,
      minX,
      minY,
      pts,
      wireHit,
    });
  }
  if (drag) {
    drag.wireGeomCache = geoms;
    drag.wirePathCache = pathEls;
  }
  return geoms;
}

/** @deprecated name kept; returns polyline geom cache. */
function nodeGraphHitTrailEnsureWirePathCache(drag) {
  return nodeGraphHitTrailEnsureWireGeomCache(drag);
}

/**
 * Geometric wire hits in surface space via precomputed polylines.
 * @returns {Array<{ kind: "wire", wireKind: string, index: number }>}
 */
function nodeGraphWiresNearSurfacePoint(point, radiusPx = nodeGraphHitTrailHitRadiusPx, geomCache = null) {
  const hits = [];
  if (!point) {
    return hits;
  }
  const geoms = Array.isArray(geomCache)
    ? geomCache
    : nodeGraphHitTrailEnsureWireGeomCache(nodeGraphMvp?.marqueeSelection);
  if (!Array.isArray(geoms) || !geoms.length) {
    return hits;
  }
  const r = Math.max(0, nodeGraphFiniteNumber(radiusPx));
  const r2 = r * r;
  const px = point.x;
  const py = point.y;
  const seen = new Set();
  for (const g of geoms) {
    if (!g?.pts?.length || !g.wireHit) {
      continue;
    }
    // Cheap AABB reject (expanded by radius).
    if (
      px < g.minX - r
      || px > g.maxX + r
      || py < g.minY - r
      || py > g.maxY + r
    ) {
      continue;
    }
    const pts = g.pts;
    let hit = false;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const d = nodeGraphDistPointToSegment(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      if (d * d <= r2) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      continue;
    }
    const key = `${g.wireHit.wireKind}:${g.wireHit.index}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    hits.push(g.wireHit);
  }
  return hits;
}

function nodeGraphHitTrailApplyHit(drag, hit) {
  if (!drag || !hit) {
    return;
  }
  // Locked patch: trail and wire hits stay live; modules are not selectable.
  if (drag.skipModuleHits && hit.kind === "module") {
    return;
  }
  // Lock to first hit type: modules XOR wires for this drag.
  if (!drag.lockMode) {
    drag.lockMode = hit.kind === "wire" ? "wires" : "modules";
  }
  if (drag.lockMode === "modules" && hit.kind !== "module") {
    return;
  }
  if (drag.lockMode === "wires" && hit.kind !== "wire") {
    return;
  }

  if (drag.lockMode === "modules") {
    if (!drag.hitNodeIds) {
      drag.hitNodeIds = new Set(drag.startSelectedIds || []);
    }
    if (!nodeGraphMvp.activeNodes.has(hit.id)) {
      return;
    }
    if (drag.hitNodeIds.has(hit.id)) {
      return;
    }
    drag.hitNodeIds.add(hit.id);
    // Defer DOM selection paint until end of sample segment (many hits / move).
    drag.selectionDirty = true;
    return;
  }

  // wires
  if (!drag.hitWires) {
    drag.hitWires = [...(drag.startSelectedWires || [])];
  }
  const key = `${hit.wireKind}:${hit.index}`;
  if (drag.hitWireKeys?.has(key)) {
    return;
  }
  if (!drag.hitWireKeys) {
    drag.hitWireKeys = new Set(drag.hitWires.map((w) => `${w.kind}:${w.index}`));
  }
  drag.hitWireKeys.add(key);
  drag.hitWires.push({ kind: hit.wireKind, index: hit.index });
  drag.selectionDirty = true;
}

function nodeGraphHitTrailFlushSelection(drag) {
  if (!drag?.selectionDirty) {
    return;
  }
  drag.selectionDirty = false;
  if (drag.lockMode === "modules") {
    if (!drag.skipModuleHits) {
      setNodeGraphNodeSelection([...(drag.hitNodeIds || [])]);
    }
    return;
  }
  if (drag.lockMode === "wires") {
    if (typeof setNodeGraphWireSelection === "function") {
      setNodeGraphWireSelection(drag.hitWires || []);
    } else if (drag.hitWires?.length) {
      const last = drag.hitWires[drag.hitWires.length - 1];
      setNodeGraphSelection({ type: "wire", kind: last.kind, index: last.index });
    }
  }
}

/**
 * Sample the segment from → to in surface space with lerp, hit-testing each
 * step. Modules: cached AABB. Wires: precomputed polylines (no SVG stroke API).
 */
function nodeGraphHitTrailSampleSegment(drag, fromSurface, toSurface) {
  if (!drag || !toSurface) {
    return;
  }
  const from = fromSurface || toSurface;
  const dx = toSurface.x - from.x;
  const dy = toSurface.y - from.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / nodeGraphHitTrailSampleStepPx));
  const moduleBounds = drag.skipModuleHits
    ? null
    : nodeGraphHitTrailEnsureModuleBoundsCache(drag);
  // Only build wire geom when we might need it (unlocked or wire-locked).
  const mayHitWires = !drag.lockMode || drag.lockMode === "wires";
  const wireGeoms = mayHitWires ? nodeGraphHitTrailEnsureWireGeomCache(drag) : null;
  // Side probes only once locked to wires (or still unlocked on a short drag).
  const needWireSides = drag.lockMode === "wires";
  let nx = 0;
  let ny = 0;
  if (needWireSides && dist > 1e-6) {
    nx = -dy / dist;
    ny = dx / dist;
  }
  const side = nodeGraphHitTrailHitRadiusPx * 0.55;
  const wireOffsets = needWireSides && dist > 1e-6
    ? [
      { x: 0, y: 0 },
      { x: nx * side, y: ny * side },
      { x: -nx * side, y: -ny * side },
    ]
    : [{ x: 0, y: 0 }];

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const baseX = from.x + dx * t;
    const baseY = from.y + dy * t;
    const center = { x: baseX, y: baseY };

    if (!drag.skipModuleHits && (!drag.lockMode || drag.lockMode === "modules")) {
      for (const hit of nodeGraphModulesContainingSurfacePoint(center, 2, moduleBounds)) {
        nodeGraphHitTrailApplyHit(drag, hit);
      }
      // Locked to modules: skip wire tests for the rest of this segment.
      if (drag.lockMode === "modules") {
        continue;
      }
    }

    if (!drag.lockMode || drag.lockMode === "wires") {
      for (const off of wireOffsets) {
        const surfacePt = { x: baseX + off.x, y: baseY + off.y };
        for (const hit of nodeGraphWiresNearSurfacePoint(
          surfacePt,
          nodeGraphHitTrailHitRadiusPx,
          wireGeoms,
        )) {
          nodeGraphHitTrailApplyHit(drag, hit);
        }
      }
    }
  }
  nodeGraphHitTrailFlushSelection(drag);
}

function nodeGraphEventHoldsShift(event) {
  return Boolean(event?.shiftKey);
}

function syncNodeGraphMarqueeShiftMirror(shiftHeld) {
  const drag = nodeGraphMvp?.marqueeSelection;
  if (!drag) {
    return false;
  }
  const on = Boolean(shiftHeld);
  if (on && !nodeGraphMvp.hitTrailMirrorCenter) {
    const origin = drag.start || drag.current;
    if (origin) {
      nodeGraphMvp.hitTrailMirrorCenter = { x: origin.x, y: origin.y };
    }
  }
  if (drag.mirrorDraw === on) {
    return false;
  }
  if (on) {
    const tip = drag.points?.[drag.points.length - 1] || drag.current || drag.start;
    nodeGraphHitTrailBeginMirrorStroke(drag, tip);
  } else {
    drag.mirrorDraw = false;
  }
  presentNodeGraphHitTrail();
  return true;
}

function handleNodeGraphMarqueeModifierKey(event) {
  if (!nodeGraphMvp?.marqueeSelection) {
    return;
  }
  syncNodeGraphMarqueeShiftMirror(nodeGraphEventHoldsShift(event));
}

function bindNodeGraphMarqueeModifierKeys() {
  if (typeof document === "undefined" || document.documentElement.dataset.marqueeModifierKeysBound === "true") {
    return;
  }
  document.documentElement.dataset.marqueeModifierKeysBound = "true";
  document.addEventListener("keydown", handleNodeGraphMarqueeModifierKey, true);
  document.addEventListener("keyup", handleNodeGraphMarqueeModifierKey, true);
}

function updateNodeGraphMarqueeSelection(event = null) {
  const drag = nodeGraphMvp.marqueeSelection;
  if (!drag) {
    return;
  }
  if (event) {
    syncNodeGraphMarqueeShiftMirror(nodeGraphEventHoldsShift(event));
  }
  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    const raw = nodeGraphClientPoint(event);
    const fromSurface = drag.lastSampleSurface || drag.points?.[drag.points.length - 1] || drag.current || drag.start || raw;
    nodeGraphHitTrailAppendPoint(drag, raw);
    const tip = drag.points?.[drag.points.length - 1] || raw;
    if (drag.erase) {
      nodeGraphPencilEraseAlong(drag, fromSurface, raw);
    }
    if (!drag.cosmetic) {
      nodeGraphHitTrailSampleSegment(drag, fromSurface, tip);
    }
    drag.current = raw;
    drag.lastSampleSurface = { x: tip.x, y: tip.y };
    drag.lastClient = { x: event.clientX, y: event.clientY };
  }
  presentNodeGraphHitTrail();
}

function nodeGraphMarqueeTargetIsBlocked(target) {
  return Boolean(target?.closest?.(
    ".dsp-node, .node-port, .node-param-port, .node-slider-readout, .node-wire-hit-path, .node-wire-path, button, input, textarea, select",
  ));
}

function startNodeGraphMarqueeSelection(event, workspace) {
  // event.preventDefault() suppresses browser blur; blur title edit explicitly.
  if (document.activeElement?.classList?.contains("node-header-title")) {
    document.activeElement.blur();
  }
  const point = nodeGraphClientPoint(event);
  const tool = nodeGraphPencilTool();
  const erase = tool === "erase";
  // Draw keeps every stroke and selects nothing. Select only ever draws a
  // temporary line (Ctrl: a line that does not select); it is never kept.
  const keepCtrl = tool === "draw";
  const mirrorDraw = !erase && Boolean(event.shiftKey);
  const cosmetic = keepCtrl || mirrorDraw || erase || Boolean(event.ctrlKey);
  if (mirrorDraw) {
    // Shift+click plants the mirror origin. Drag never moves it.
    nodeGraphMvp.hitTrailMirrorCenter = { x: point.x, y: point.y };
  }
  const startSelectedWires = typeof nodeGraphSelectedWireEntries === "function"
    ? nodeGraphSelectedWireEntries()
    : [];
  const skipModuleHits = typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked();
  const smoothAmount = nodeGraphSnakeMouseSmoothAmount();
  const mouseSmooth = typeof createNodeGraphMouseSmoothState === "function"
    ? createNodeGraphMouseSmoothState(point.x, point.y)
    : null;
  if (mouseSmooth && typeof nodeGraphMouseSmoothBegin === "function") {
    nodeGraphMouseSmoothBegin(mouseSmooth, smoothAmount, point.x, point.y);
  }
  nodeGraphMvp.marqueeSelection = {
    additive: false,
    cosmetic,
    erase,
    erased: false,
    keepTrail: keepCtrl,
    mirrorDraw,
    mirrorStrokes: [],
    current: point,
    hitNodeIds: new Set(),
    hitWires: [],
    hitWireKeys: new Set(),
    lastClient: { x: event.clientX, y: event.clientY },
    lastSampleSurface: { x: point.x, y: point.y },
    lockMode: null,
    moduleBoundsCache: null,
    mouseSmooth,
    moved: false,
    pen: nodeGraphHitTrailLivePen(),
    pointerId: event.pointerId,
    points: [{ x: point.x, y: point.y }],
    selectionDirty: false,
    skipModuleHits,
    start: point,
    startSelectedIds: [...nodeGraphSelectedNodeIds()],
    startSelectedWires,
    wireGeomCache: null,
    wirePathCache: null,
  };
  if (mirrorDraw) {
    nodeGraphHitTrailBeginMirrorStroke(nodeGraphMvp.marqueeSelection, point);
  }
  if (erase) {
    // A click (no drag) erases what is under the pointer too.
    nodeGraphPencilEraseAlong(nodeGraphMvp.marqueeSelection, point, point);
  }
  // Pre-warm module AABBs once on pointerdown. Wire polylines are built lazily
  // on first wire hunt (modules-only snakes never pay that cost). Locked patch
  // still draws and can hit wires; it never selects modules.
  if (!cosmetic) {
    if (!skipModuleHits) {
      nodeGraphHitTrailEnsureModuleBoundsCache(nodeGraphMvp.marqueeSelection);
      setNodeGraphSelection(null);
    }
    nodeGraphHitTrailSampleSegment(
      nodeGraphMvp.marqueeSelection,
      point,
      point,
    );
  }
  presentNodeGraphHitTrail();
  try {
    workspace.setPointerCapture(event.pointerId);
  } catch (_error) {
    // Capture can throw if the element is not active for that pointer.
  }
  event.preventDefault();
  event.stopPropagation();
}

// Draw and Erase take a press anywhere on the canvas, on top of modules too:
// modules do not react and nothing is selected. Runs in the capture phase at
// the window, before module, slider, pan and placement handlers. Floating
// windows (Command Center, Pencil page ...) keep working.
function nodeGraphPencilCapturePointerDown(event) {
  if (event.button !== 0 || nodeGraphMvp.marqueeSelection) return;
  if (typeof nodeGraphPencilTool !== "function" || nodeGraphPencilTool() === "select") return;
  const workspace = document.getElementById("nodeGraphWorkspace");
  const target = event.target;
  if (!workspace || !(target instanceof Element) || !workspace.contains(target)) return;
  const floatingUi = typeof nodeGraphWorkspaceFloatingUiSelector === "string"
    ? nodeGraphWorkspaceFloatingUiSelector
    : ".node-floating-window-surface";
  if (target.closest(floatingUi)) return;
  startNodeGraphMarqueeSelection(event, workspace);
  event.stopImmediatePropagation();
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", nodeGraphPencilCapturePointerDown, true);
}

function beginNodeGraphMarqueeSelection(event) {
  if (
    event.button !== 0 ||
    nodeGraphMarqueeTargetIsBlocked(event.target)
  ) {
    return;
  }

  startNodeGraphMarqueeSelection(event, event.currentTarget);
}

function nodeGraphOutsideMarqueeStartIsBlocked(target) {
  return Boolean(target?.closest?.(
    "#nodeGraphWorkspace, #nodeSceneContextMenu, #nodeParameterMetadataPopover, #nodeUiDevHelper, #nodeUserUiSettingsPanel, button, input, textarea, select",
  ));
}

function trackNodeGraphOutsideMarqueePointer(event) {
  if (event.button !== 0 || nodeGraphOutsideMarqueeStartIsBlocked(event.target)) {
    nodeGraphMvp.marqueeSelectionEntryPointer = null;
    return;
  }
  nodeGraphMvp.marqueeSelectionEntryPointer = {
    additive: event.shiftKey || event.ctrlKey || event.metaKey,
    pointerId: event.pointerId,
  };
}

function clearNodeGraphOutsideMarqueePointer(event) {
  if (
    !nodeGraphMvp.marqueeSelectionEntryPointer ||
    nodeGraphMvp.marqueeSelectionEntryPointer.pointerId === event.pointerId
  ) {
    nodeGraphMvp.marqueeSelectionEntryPointer = null;
  }
}

function beginNodeGraphMarqueeSelectionOnEntry(event) {
  const entry = nodeGraphMvp.marqueeSelectionEntryPointer;
  if (
    !entry ||
    entry.pointerId !== event.pointerId ||
    !(event.buttons & 1) ||
    nodeGraphMvp.marqueeSelection ||
    nodeGraphMvp.dragging ||
    nodeGraphMvp.nodeDragging ||
    nodeGraphMvp.workspacePanning ||
    nodeGraphMvp.smoothZoomDragging ||
    nodeGraphMvp.workspaceResizing
  ) {
    return;
  }
  startNodeGraphMarqueeSelection(event, event.currentTarget);
  nodeGraphMvp.marqueeSelectionEntryPointer = null;
}

function dragNodeGraphMarqueeSelection(event) {
  const drag = nodeGraphMvp.marqueeSelection;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  const point = nodeGraphClientPoint(event);
  drag.current = point;
  drag.moved ||=
    Math.abs(point.x - drag.start.x) > 2 ||
    Math.abs(point.y - drag.start.y) > 2;
  if (event.ctrlKey && !drag.erase) {
    drag.cosmetic = true; // Ctrl in Select: stop selecting, the line stays temporary
  }
  updateNodeGraphMarqueeSelection(event);
  event.preventDefault();
  event.stopPropagation();
}

function endNodeGraphMarqueeSelection(event) {
  const drag = nodeGraphMvp.marqueeSelection;
  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  syncNodeGraphMarqueeShiftMirror(nodeGraphEventHoldsShift(event));
  if (drag.moved) {
    updateNodeGraphMarqueeSelection(event);
    if (!drag.cosmetic) {
      nodeGraphHitTrailFlushSelection(drag);
    }
  } else if (!drag.cosmetic && !drag.skipModuleHits) {
    setNodeGraphSelection(null);
  }
  if (!drag.erase && drag.keepTrail && drag.moved && drag.points?.length) {
    // One stroke (plus its mirror copies) = one drawing step to undo.
    const pen = drag.pen || nodeGraphHitTrailLivePen();
    nodeGraphHitTrailPushKept([drag.points, ...(Array.isArray(drag.mirrorStrokes) ? drag.mirrorStrokes : [])], pen);
  }
  nodeGraphMvp.marqueeSelection = null;
  presentNodeGraphHitTrail();
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // ignore
    }
  }
  event.preventDefault();
  event.stopPropagation();
}
