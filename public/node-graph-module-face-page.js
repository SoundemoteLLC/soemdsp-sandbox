// Module page (Command Center nav): a live copy of the selected module, minus
// its title bar (the page heading names it) and its In/Out band (the Mini
// Canvas bands).
// - Sliders shown on the module: the copy is the module's own pixels, copied
//   each frame out of the workspace GL canvas (#nodeGlGraphCanvas, a 2D
//   present target). Wires or neighbours in that rectangle come along.
// - Sliders hidden on the module (its own Hide sliders, or the workspace-wide
//   one): the module is laid out as if its sliders were shown (per-module
//   forced-visible, nodeGraphModuleFacePageWithSlidersShown) for one task, the
//   GL graph's one-module pass (nodeGraphGlMiniPerformPresentModule, the Mini
//   Canvas pass) draws it into the page's own canvases, and the classes go
//   back before anything paints, so the workspace stays hidden.
// Pointer presses on the copy are mapped back to the module's screen point and
// replayed there (pointerdown/move/up), inside the same forced layout when the
// sliders are hidden, so the circuit builder's own hit tests and drags run
// every control. Follows the primary selection; keeps the last module when
// nothing is selected. The module stays awake while shown
// (nodeGraphViewportCullMustStayAwake asks nodeGraphModuleFacePagePresentsNode).

const NODE_GRAPH_MODULE_FACE_PAGE_POLL_MS = 100;
let nodeGraphModuleFacePageTimer = 0;
let nodeGraphModuleFacePageSignature = "";
let nodeGraphModuleFacePageNodeId = "";
let nodeGraphModuleFacePageDisplayRaf = 0;
let nodeGraphModuleFacePageDisplayLast = 0;
const NODE_GRAPH_MODULE_FACE_PAGE_DISPLAY_FRAME_MS = 33;
const NODE_GRAPH_MODULE_FACE_PAGE_DISPLAY_MAX_H = 520;
// Pixel copy -> module map from the last copied frame (page CSS px).
let nodeGraphModuleFacePageCopyMap = null;
// The press being replayed on the module: { pointerId, target }.
let nodeGraphModuleFacePageForward = null;
const nodeGraphModuleFacePageReplayed = new WeakSet();

function nodeGraphModuleFacePageVisible() {
  const panel = document.getElementById("nodeModuleFacePage");
  return Boolean(panel && !panel.hidden);
}

/** True while the Module page shows this module (keeps its display painting). */
function nodeGraphModuleFacePagePresentsNode(nodeId) {
  const id = String(nodeId || "").trim();
  return Boolean(id && id === nodeGraphModuleFacePageNodeId && nodeGraphModuleFacePageVisible());
}

/** Cut [c0, c1] out of a list of { y0, y1 } bands. */
function nodeGraphModuleFacePageCutBand(bands, c0, c1) {
  const out = [];
  for (const b of bands) {
    if (c1 <= b.y0 || c0 >= b.y1) { out.push(b); continue; }
    if (c0 > b.y0) out.push({ y0: b.y0, y1: c0 });
    if (c1 < b.y1) out.push({ y0: c1, y1: b.y1 });
  }
  return out;
}

/** Module layout bands to show: everything but the In/Out band and the title (the page heading has it). */
function nodeGraphModuleFacePageBands(el) {
  const nat = typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(el) : null;
  const box = nat && nat.w > 1 && nat.h > 1 ? nat : { x: 0, y: 0, w: el.offsetWidth, h: el.offsetHeight };
  const bands = typeof nodeGraphGlMiniPerformBands === "function"
    ? nodeGraphGlMiniPerformBands(el, box)
    : [{ y0: 0, y1: box.h }];
  let shown = bands;
  const header = el.querySelector(":scope > .dsp-node-header");
  const headerBox = header && header.offsetHeight > 1 && typeof nodeGraphModuleLayoutBox === "function"
    ? nodeGraphModuleLayoutBox(header, el)
    : null;
  if (headerBox && headerBox.h > 1) {
    const cut = nodeGraphModuleFacePageCutBand(shown, headerBox.y, headerBox.y + headerBox.h);
    // A module that is only its title keeps it.
    if (cut.some((b) => b.y1 - b.y0 > 0.5)) shown = cut;
  }
  return { w: box.w, bands: shown.filter((b) => b.y1 - b.y0 > 0.5) };
}

/**
 * Run fn with the module laid out as if its sliders were shown, then put the
 * classes back. Synchronous, so the workspace never paints the shown state.
 * fn(forced) gets whether anything was changed.
 */
function nodeGraphModuleFacePageWithSlidersShown(el, fn) {
  const perModule = Boolean(el?.classList?.contains("sliders-hidden"));
  const forced = Boolean(el?.classList?.contains("sliders-forced-visible"));
  const workspace = Boolean(el?.closest?.(".node-graph-workspace.module-sliders-hidden"));
  if (!el || (!perModule && (forced || !workspace))) return fn(false);
  if (perModule) el.classList.remove("sliders-hidden");
  if (!forced) el.classList.add("sliders-forced-visible");
  try {
    return fn(true);
  } finally {
    if (!forced) el.classList.remove("sliders-forced-visible");
    if (perModule) el.classList.add("sliders-hidden");
  }
}

/** The page's face surface (one host per shown band) for the hidden-sliders copy. */
function nodeGraphModuleFacePageFaceSurface(wrap) {
  let face = document.getElementById("nodeModuleFacePageFace");
  if (!face && wrap) {
    face = document.createElement("div");
    face.id = "nodeModuleFacePageFace";
    face.className = "node-module-face-page-face";
    wrap.append(face);
  }
  return face;
}

/** Sliders hidden: draw the module (laid out with its sliders shown) through the one-module GL pass. */
function presentNodeGraphModuleFacePageFace(wrap, el, nodeId) {
  if (typeof nodeGraphGlMiniPerformPresentModule !== "function") return false;
  const canvas = document.getElementById("nodeModuleFacePageDisplayCanvas");
  const face = nodeGraphModuleFacePageFaceSurface(wrap);
  if (!face) return false;
  if (canvas) canvas.hidden = true;
  face.hidden = false;
  return nodeGraphModuleFacePageWithSlidersShown(el, () => {
    const { w: natW, bands } = nodeGraphModuleFacePageBands(el);
    if (!bands.length || !(natW > 1)) return false;
    const shownH = bands.reduce((sum, b) => sum + (b.y1 - b.y0), 0);
    const style = getComputedStyle(wrap);
    const availW = Math.max(1, wrap.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
    const scale = Math.min(availW / natW, NODE_GRAPH_MODULE_FACE_PAGE_DISPLAY_MAX_H / shownH);
    const cssW = Math.max(1, Math.round(natW * scale));
    const map = { nodeId, cssW, cssH: 0, scale, bands: [], surface: "nodeModuleFacePageFace", forced: true };
    while (face.children.length > bands.length) face.lastElementChild.remove();
    let y = 0;
    for (let i = 0; i < bands.length; i += 1) {
      const band = bands[i];
      const h = Math.max(1, Math.round((band.y1 - band.y0) * scale));
      let host = face.children[i];
      if (!host) {
        host = document.createElement("div");
        host.className = "node-module-face-page-face-band";
        face.append(host);
      }
      if (host.style.width !== `${cssW}px`) host.style.width = `${cssW}px`;
      if (host.style.height !== `${h}px`) host.style.height = `${h}px`;
      nodeGraphGlMiniPerformPresentModule(host, el, nodeId, scale, band.y0);
      map.bands.push({ y, h, y0: band.y0 });
      y += h;
    }
    map.cssH = y;
    nodeGraphModuleFacePageCopyMap = map;
    return true;
  });
}

/** Copy the module's pixels from the workspace GL canvas into the page canvas. */
function presentNodeGraphModuleFacePageDisplay() {
  const wrap = document.getElementById("nodeModuleFacePageDisplay");
  const canvas = document.getElementById("nodeModuleFacePageDisplayCanvas");
  if (!wrap || !canvas) return false;
  const nodeId = nodeGraphModuleFacePageNodeId;
  const el = nodeId && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(nodeId) : null;
  const src = document.getElementById("nodeGlGraphCanvas");
  if (!el || !el.isConnected || !src || !(src.width > 0) || !(el.offsetWidth > 0)) {
    wrap.hidden = true;
    nodeGraphModuleFacePageCopyMap = null;
    return false;
  }
  wrap.hidden = false;
  if (nodeGraphModuleFacePageNeedsReadouts(nodeId, el)) {
    return presentNodeGraphModuleFacePageFace(wrap, el, nodeId);
  }
  canvas.hidden = false;
  const faceSurface = document.getElementById("nodeModuleFacePageFace");
  if (faceSurface && !faceSurface.hidden) {
    faceSurface.hidden = true;
    faceSurface.replaceChildren();
  }
  const mr = el.getBoundingClientRect();
  const sr = src.getBoundingClientRect();
  if (!(sr.width > 0) || !(sr.height > 0)) return false;
  // Off screen: keep this module's last copied frame; never another module's.
  if (mr.right <= sr.left || mr.left >= sr.right || mr.bottom <= sr.top || mr.top >= sr.bottom) {
    if (nodeGraphModuleFacePageCopyMap?.nodeId === nodeId) return true;
    wrap.hidden = true;
    nodeGraphModuleFacePageCopyMap = null;
    return false;
  }
  const { w: natW, bands } = nodeGraphModuleFacePageBands(el);
  if (!bands.length) return false;
  const shownH = bands.reduce((sum, b) => sum + (b.y1 - b.y0), 0);
  const style = getComputedStyle(wrap);
  const availW = Math.max(1, wrap.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
  const scale = Math.min(availW / natW, NODE_GRAPH_MODULE_FACE_PAGE_DISPLAY_MAX_H / shownH);
  const cssW = Math.max(1, Math.round(natW * scale));
  const cssH = Math.max(1, Math.round(shownH * scale));
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const wz = mr.width / el.offsetWidth;
  const kx = src.width / sr.width;
  const ky = src.height / sr.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, pxW, pxH);
  const map = { nodeId, cssW, cssH, scale, bands: [] };
  let y = 0;
  for (const band of bands) {
    const h = (band.y1 - band.y0) * scale;
    ctx.drawImage(
      src,
      (mr.left - sr.left) * kx,
      (mr.top + band.y0 * wz - sr.top) * ky,
      natW * wz * kx,
      (band.y1 - band.y0) * wz * ky,
      0,
      y * dpr,
      cssW * dpr,
      h * dpr,
    );
    map.bands.push({ y, h, y0: band.y0 });
    y += h;
  }
  nodeGraphModuleFacePageCopyMap = map;
  return true;
}

/** The module's screen point under a page-copy pointer (clamped to the copy). */
function nodeGraphModuleFacePageModulePoint(event) {
  const map = nodeGraphModuleFacePageCopyMap;
  const canvas = document.getElementById(map?.surface || "nodeModuleFacePageDisplayCanvas");
  const el = map && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(map.nodeId) : null;
  if (!map || !canvas || !el || !map.bands.length || !(el.offsetWidth > 0)) return null;
  const cr = canvas.getBoundingClientRect();
  if (!(cr.width > 0) || !(cr.height > 0)) return null;
  const px = (event.clientX - cr.left) * (map.cssW / cr.width);
  const py = Math.max(0, Math.min(map.cssH, (event.clientY - cr.top) * (map.cssH / cr.height)));
  const band = map.bands.find((b) => py >= b.y && py <= b.y + b.h) || map.bands[map.bands.length - 1];
  const lx = px / map.scale;
  const ly = band.y0 + (py - band.y) / map.scale;
  const mr = el.getBoundingClientRect();
  const wz = mr.width / el.offsetWidth;
  return { x: mr.left + lx * wz, y: mr.top + ly * wz, el };
}

function nodeGraphModuleFacePageReplay(type, source, point, target) {
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: point.x,
    clientY: point.y,
    screenX: point.x,
    screenY: point.y,
    pointerId: source.pointerId,
    pointerType: source.pointerType || "mouse",
    isPrimary: source.isPrimary !== false,
    button: source.button,
    buttons: source.buttons,
    pressure: source.pressure,
    width: source.width,
    height: source.height,
    shiftKey: source.shiftKey,
    altKey: source.altKey,
    ctrlKey: source.ctrlKey,
    metaKey: source.metaKey,
    detail: source.detail,
  };
  const replay = typeof PointerEvent === "function" ? new PointerEvent(type, init) : new MouseEvent(type, init);
  nodeGraphModuleFacePageReplayed.add(replay);
  target.dispatchEvent(replay);
  return replay;
}

/** The deepest element of the module under a screen point (off screen or covered: no elementFromPoint). */
function nodeGraphModuleFacePageElementAt(el, x, y) {
  let best = null;
  const within = (node) => {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  if (!within(el)) return null;
  best = el;
  for (const node of el.querySelectorAll("*")) {
    if (best.contains(node) && within(node) && getComputedStyle(node).pointerEvents !== "none") best = node;
  }
  return best;
}

/** Run fn inside the forced layout when the current copy is the hidden-sliders face pass. */
function nodeGraphModuleFacePageInCopyLayout(fn) {
  const map = nodeGraphModuleFacePageCopyMap;
  const el = map?.forced && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(map.nodeId) : null;
  return el ? nodeGraphModuleFacePageWithSlidersShown(el, fn) : fn(false);
}

/** Press on the copy: replay it on the module itself, then keep replaying until release. */
function beginNodeGraphModuleFacePageCopyPointer(event) {
  return nodeGraphModuleFacePageInCopyLayout(() => {
    const point = nodeGraphModuleFacePageModulePoint(event);
    if (!point) return false;
    const panel = document.getElementById("nodeModuleFacePage");
    // The element the press would hit on the module, as if this page were not over it.
    const before = panel?.style.pointerEvents ?? "";
    if (panel) panel.style.pointerEvents = "none";
    let target = null;
    try {
      target = document.elementFromPoint(point.x, point.y);
    } finally {
      if (panel) panel.style.pointerEvents = before;
    }
    if (!target || panel?.contains(target) || (nodeGraphModuleFacePageCopyMap?.forced && !point.el.contains(target))) {
      target = nodeGraphModuleFacePageElementAt(point.el, point.x, point.y);
    }
    if (!target || panel?.contains(target)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    nodeGraphModuleFacePageForward = { pointerId: event.pointerId, target };
    nodeGraphModuleFacePageReplay("pointerdown", event, point, target);
    // Real moves keep coming to the copy; they are replayed at the module.
    const surface = document.getElementById(nodeGraphModuleFacePageCopyMap?.surface || "nodeModuleFacePageDisplayCanvas");
    try {
      surface?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer already released.
    }
    return true;
  });
}

function nodeGraphModuleFacePageCopyPointerRelay(event) {
  if (nodeGraphModuleFacePageReplayed.has(event)) return;
  if (event.type === "pointerdown") {
    const canvas = document.getElementById("nodeModuleFacePageDisplayCanvas");
    const face = document.getElementById("nodeModuleFacePageFace");
    const onCopy = (canvas && event.target === canvas) || (face && !face.hidden && face.contains(event.target));
    if (onCopy && event.button === 0) beginNodeGraphModuleFacePageCopyPointer(event);
    return;
  }
  const forward = nodeGraphModuleFacePageForward;
  if (!forward || event.pointerId !== forward.pointerId) return;
  event.stopImmediatePropagation();
  nodeGraphModuleFacePageInCopyLayout(() => {
    const point = nodeGraphModuleFacePageModulePoint(event);
    if (point) nodeGraphModuleFacePageReplay(event.type, event, point, forward.target.isConnected ? forward.target : document);
  });
  if (event.type === "pointerup" || event.type === "pointercancel") {
    nodeGraphModuleFacePageForward = null;
  }
}

function nodeGraphModuleFacePageDisplayTick(now) {
  nodeGraphModuleFacePageDisplayRaf = 0;
  if (!nodeGraphModuleFacePageVisible()) return;
  if (now - nodeGraphModuleFacePageDisplayLast >= NODE_GRAPH_MODULE_FACE_PAGE_DISPLAY_FRAME_MS) {
    nodeGraphModuleFacePageDisplayLast = now;
    try {
      presentNodeGraphModuleFacePageDisplay();
    } catch (error) {
      console.warn("[module page] display", error?.message || error);
    }
  }
  nodeGraphModuleFacePageDisplayRaf = window.requestAnimationFrame(nodeGraphModuleFacePageDisplayTick);
}

function startNodeGraphModuleFacePageDisplay() {
  if (!nodeGraphModuleFacePageDisplayRaf) {
    nodeGraphModuleFacePageDisplayRaf = window.requestAnimationFrame(nodeGraphModuleFacePageDisplayTick);
  }
}

function stopNodeGraphModuleFacePageDisplay() {
  if (nodeGraphModuleFacePageDisplayRaf) {
    window.cancelAnimationFrame(nodeGraphModuleFacePageDisplayRaf);
    nodeGraphModuleFacePageDisplayRaf = 0;
  }
  const wrap = document.getElementById("nodeModuleFacePageDisplay");
  if (wrap) wrap.hidden = true;
  document.getElementById("nodeModuleFacePageFace")?.replaceChildren();
}

/** Wake (or let sleep) the shown module's painters after the page target changes. */
function nodeGraphModuleFacePageRefreshCull() {
  if (typeof scheduleNodeGraphViewportCullRefresh === "function") {
    scheduleNodeGraphViewportCullRefresh();
  }
}

function applyNodeGraphModuleFacePageSize(size = {}, panelArg = null) {
  const panel = panelArg || document.getElementById("nodeModuleFacePage");
  if (!panel) {
    return null;
  }
  if (typeof applyNodeGraphUnifiedWindowShellSize === "function") {
    return applyNodeGraphUnifiedWindowShellSize(panel, size);
  }
  const width = Math.round(Number(size.width) || panel.getBoundingClientRect().width);
  const height = Math.round(Number(size.height) || panel.getBoundingClientRect().height);
  if (width >= 24) {
    panel.style.width = `${width}px`;
  }
  if (height >= 120) {
    panel.style.height = `${height}px`;
  }
  return { width, height };
}

/** Primary selected module, else the last module the page showed / settings targeted. */
function nodeGraphModuleFacePageTargetId() {
  const primary = typeof nodeGraphModuleActionTargetNodeId === "function"
    ? nodeGraphModuleActionTargetNodeId()
    : null;
  if (primary) {
    return String(primary);
  }
  const candidates = [nodeGraphMvp?.lastModuleActionTargetNode, nodeGraphModuleFacePageNodeId];
  for (const candidate of candidates) {
    const id = String(candidate || "").trim();
    if (id && typeof nodeGraphPatchNode === "function" && nodeGraphPatchNode(id)) {
      return id;
    }
  }
  return "";
}

/**
 * Parameter keys shown on the module: definition visibility plus the patch's
 * per-parameter Show/Hide (paramMeta.visible). Not the DOM rows' hidden state,
 * because "Hide sliders" hides those rows too and the page must keep them.
 */
function nodeGraphModuleFacePageVisibleKeys(moduleEl) {
  const nodeId = String(moduleEl?.dataset?.node || "");
  const node = nodeId && typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || typeof nodeGraphPatchNodeParameterDefinitions !== "function") {
    return null;
  }
  const keys = new Set();
  for (const parameter of nodeGraphPatchNodeParameterDefinitions(node) || []) {
    const visible = typeof nodeGraphParameterEffectiveVisible === "function"
      ? nodeGraphParameterEffectiveVisible(parameter, node.paramMeta?.[parameter.key])
      : parameter?.hidden !== true;
    if (visible) {
      keys.add(String(parameter.key));
    }
  }
  return keys;
}

/** The module's parameter-row inputs (what "Hide sliders" hides), in face order. */
function nodeGraphModuleFacePageSliders(moduleEl) {
  if (!moduleEl) {
    return [];
  }
  const visibleKeys = nodeGraphModuleFacePageVisibleKeys(moduleEl);
  let inputs = [...moduleEl.querySelectorAll(".dsp-node-body input[data-param]")];
  if (!inputs.length) {
    inputs = [...moduleEl.querySelectorAll("input[data-param]")]
      .filter((input) => !input.closest(".dsp-node-io-section"));
  }
  return inputs.filter((input) => input.id
    && input.type === "range"
    && input.closest(".dsp-node") === moduleEl
    && (!visibleKeys || visibleKeys.has(String(input.dataset.param || ""))));
}

/**
 * Rows as the module lays its controls out. A module with a face (definition
 * .face, via nodeGraphModuleFaceSpec with this patch node's hidden params
 * dropped) gives one row per face row, its params side by side in face order
 * ("stack" cells narrower, as on the face). Any other module: one control per
 * row in the module body's order. Layout comes from the definitions, never
 * from DOM rects, so it holds while the module's sliders are hidden.
 */
function nodeGraphModuleFacePageLayout(moduleEl, sliders) {
  const plain = () => sliders.map((slider) => ({ kind: "slider", cells: [{ slider, weight: 1 }] }));
  const nodeId = String(moduleEl?.dataset?.node || "");
  const node = nodeId && typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const type = String(moduleEl?.dataset?.nodeType || node?.type || "");
  if (
    !moduleEl?.classList?.contains("has-module-face")
    || typeof nodeGraphModuleFaceSpec !== "function"
    || typeof nodeGraphModuleFaceRowParams !== "function"
  ) {
    return plain();
  }
  const spec = nodeGraphModuleFaceSpec(type, node);
  if (!Array.isArray(spec) || !spec.length) {
    return plain();
  }
  const byKey = new Map(sliders.map((slider) => [String(slider.dataset.param || ""), slider]));
  const used = new Set();
  const rows = [];
  for (const row of spec) {
    const stacked = new Set(row.kind === "cells" && Array.isArray(row.params)
      ? row.params.filter((cell) => cell[2] === "stack").map((cell) => String(cell[0]))
      : []);
    const cells = [];
    for (const raw of nodeGraphModuleFaceRowParams(row)) {
      const key = String(raw || "");
      const slider = byKey.get(key);
      if (!slider || used.has(key)) continue;
      used.add(key);
      cells.push({ slider, weight: stacked.has(key) ? 0.5 : 1 });
    }
    if (cells.length) rows.push({ kind: String(row.kind || ""), cells });
  }
  // Face params the face does not place are not on the module either.
  return rows.length ? rows : plain();
}

function nodeGraphModuleFacePageTitle(nodeId, moduleEl) {
  const header = moduleEl?.querySelector?.(".node-header-title");
  const text = String(header?.textContent || "").trim();
  if (text) {
    return text;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const definition = node && typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions[node.type] : null;
  return String(definition?.label || node?.type || nodeId);
}

function nodeGraphModuleFacePageSlidersHidden(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node) {
    return false;
  }
  const ui = typeof nodeGraphEffectivePatchNodeUi === "function"
    ? nodeGraphEffectivePatchNodeUi(node.ui, node.type)
    : (node.ui || {});
  return Boolean(ui.slidersHidden);
}

/** True when the module draws no sliders (its own Hide sliders, or the workspace-wide one). */
function nodeGraphModuleFacePageNeedsReadouts(nodeId, moduleEl) {
  return nodeGraphModuleFacePageSlidersHidden(nodeId)
    || Boolean(moduleEl?.closest?.(".node-graph-workspace.module-sliders-hidden") && !moduleEl.classList.contains("sliders-forced-visible"));
}

function nodeGraphModuleFacePageComputeSignature(nodeId) {
  if (!nodeId) {
    return "empty";
  }
  const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(nodeId) : null;
  const sliders = nodeGraphModuleFacePageSliders(moduleEl);
  const layout = nodeGraphModuleFacePageLayout(moduleEl, sliders);
  return [
    nodeId,
    moduleEl ? "el" : "none",
    nodeGraphModuleFacePageTitle(nodeId, moduleEl),
    nodeGraphModuleFacePageNeedsReadouts(nodeId, moduleEl) ? "h" : "s",
    layout.map((row) => row.cells.map((cell) => `${cell.slider.id}=${nodeSliderLabelText(cell.slider)}`).join(",")).join("|"),
  ].join("\n");
}

function nodeGraphModuleFacePageEmpty(text) {
  const empty = document.createElement("p");
  empty.className = "node-module-face-page-empty";
  empty.textContent = text;
  return empty;
}

function renderNodeGraphModuleFacePage(nodeId) {
  const body = document.getElementById("nodeModuleFacePageBody");
  const titleEl = document.getElementById("nodeModuleFacePageTitle");
  if (!body) {
    return;
  }
  const moduleEl = nodeId && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(nodeId) : null;
  if (!nodeId || !moduleEl) {
    nodeGraphModuleFacePageNodeId = "";
    if (titleEl) titleEl.textContent = "Module";
    body.replaceChildren(nodeGraphModuleFacePageEmpty("Select a module"));
    return;
  }
  nodeGraphModuleFacePageNodeId = nodeId;
  if (titleEl) titleEl.textContent = nodeGraphModuleFacePageTitle(nodeId, moduleEl);
  // The copy above shows (and runs) the module's own controls, sliders
  // hidden or not.
  body.replaceChildren();
}

/** Retired: the mirror readout list once shown under a slider-less copy. */
function renderNodeGraphModuleFacePageReadouts(body, moduleEl) {
  const sliders = nodeGraphModuleFacePageSliders(moduleEl);
  const rows = [];
  for (const entry of nodeGraphModuleFacePageLayout(moduleEl, sliders)) {
    const row = document.createElement("div");
    row.className = "node-module-face-page-row";
    row.dataset.rowKind = entry.kind;
    row.dataset.param = entry.cells.map((cell) => cell.slider.dataset.param || "").join(" ");
    for (const cell of entry.cells) {
      const label = nodeSliderLabelText(cell.slider);
      const readout = createNodeSliderReadoutButton(cell.slider.id, cell.slider, {
        paramLabel: label,
        ariaLabel: label,
        mirror: true,
      });
      readout.style.flexGrow = String(cell.weight);
      row.append(readout);
    }
    rows.push(row);
  }
  if (!rows.length) {
    rows.push(nodeGraphModuleFacePageEmpty("No controls"));
  }
  body.replaceChildren(...rows);
  const paintAll = () => {
    for (const slider of sliders) {
      if (slider.isConnected && typeof paintNodeSliderMirrorReadouts === "function") {
        paintNodeSliderMirrorReadouts(slider);
      }
    }
  };
  paintAll();
  // Text fit is measured after layout.
  window.requestAnimationFrame(paintAll);
}

function refreshNodeGraphModuleFacePage(options = {}) {
  const panel = document.getElementById("nodeModuleFacePage");
  if (!panel || panel.hidden) {
    return;
  }
  // Leave the rows alone mid-drag or while a value is being typed into one.
  if (!options.force) {
    const body = document.getElementById("nodeModuleFacePageBody");
    if (nodeGraphMvp?.sliderDragging || body?.querySelector("input")) {
      return;
    }
  }
  const nodeId = nodeGraphModuleFacePageTargetId();
  const signature = nodeGraphModuleFacePageComputeSignature(nodeId);
  if (!options.force && signature === nodeGraphModuleFacePageSignature) {
    return;
  }
  nodeGraphModuleFacePageSignature = signature;
  const previous = nodeGraphModuleFacePageNodeId;
  renderNodeGraphModuleFacePage(nodeId);
  if (previous !== nodeGraphModuleFacePageNodeId) {
    nodeGraphModuleFacePageRefreshCull();
  }
}

function stopNodeGraphModuleFacePageWatch() {
  if (nodeGraphModuleFacePageTimer) {
    window.clearInterval(nodeGraphModuleFacePageTimer);
    nodeGraphModuleFacePageTimer = 0;
  }
}

function startNodeGraphModuleFacePageWatch() {
  if (nodeGraphModuleFacePageTimer) {
    return;
  }
  nodeGraphModuleFacePageTimer = window.setInterval(() => {
    const panel = document.getElementById("nodeModuleFacePage");
    if (!panel || panel.hidden) {
      stopNodeGraphModuleFacePageWatch();
      return;
    }
    refreshNodeGraphModuleFacePage();
  }, NODE_GRAPH_MODULE_FACE_PAGE_POLL_MS);
}

function setNodeGraphModuleFacePageOpen(open) {
  const panel = document.getElementById("nodeModuleFacePage");
  if (!panel) {
    return;
  }
  const switching = Boolean(nodeGraphMvp?._unifiedWindowSwitching);
  if (open && !panel.hidden) {
    if (!switching && typeof openNodeGraphUnifiedWindowPage === "function") {
      openNodeGraphUnifiedWindowPage("moduleFace");
      return;
    }
    if (typeof pulseNodeGraphFloatingWindowAttention === "function") {
      pulseNodeGraphFloatingWindowAttention(panel);
    }
    return;
  }
  if (open && !switching && typeof openNodeGraphUnifiedWindowPage === "function") {
    openNodeGraphUnifiedWindowPage("moduleFace");
    return;
  }
  panel.hidden = !open;
  if (open) {
    panel.classList.add("node-unified-window");
    if (typeof markNodeGraphFloatingWindowSurface === "function") {
      markNodeGraphFloatingWindowSurface(panel);
    }
    if (typeof noteNodeGraphUnifiedWindowOpened === "function") {
      noteNodeGraphUnifiedWindowOpened("moduleFace", panel);
    }
    refreshNodeGraphModuleFacePage({ force: true });
    startNodeGraphModuleFacePageWatch();
    startNodeGraphModuleFacePageDisplay();
    nodeGraphModuleFacePageRefreshCull();
  } else {
    stopNodeGraphModuleFacePageWatch();
    stopNodeGraphModuleFacePageDisplay();
    nodeGraphModuleFacePageCopyMap = null;
    nodeGraphModuleFacePageForward = null;
    nodeGraphModuleFacePageRefreshCull();
    document.getElementById("nodeModuleFacePageBody")?.replaceChildren();
    nodeGraphModuleFacePageSignature = "";
  }
}

function bindNodeGraphModuleFacePageEvents() {
  if (document.documentElement.dataset.moduleFacePageBound === "true") {
    return;
  }
  document.documentElement.dataset.moduleFacePageBound = "true";
  // Window capture: ahead of the document-level selection / drag handlers.
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    window.addEventListener(type, nodeGraphModuleFacePageCopyPointerRelay, true);
  }
  document.getElementById("nodeModuleFacePageClose")?.addEventListener("click", () => {
    if (typeof closeNodeGraphUnifiedWindowPage === "function") {
      closeNodeGraphUnifiedWindowPage("moduleFace");
      return;
    }
    setNodeGraphModuleFacePageOpen(false);
  });
  document
    .querySelector("#nodeModuleFacePage .scene-context-heading")
    ?.addEventListener("pointerdown", (event) => {
      if (event.target?.closest?.("#nodeModuleFacePageClose")) {
        return;
      }
      if (typeof beginNodeGraphRegisteredFloatingWindowDrag === "function") {
        beginNodeGraphRegisteredFloatingWindowDrag(event, "moduleFace");
      }
    });
  document
    .getElementById("nodeModuleFacePageResizeHandle")
    ?.addEventListener("pointerdown", (event) => {
      if (typeof beginNodeGraphRegisteredFloatingWindowResize === "function") {
        beginNodeGraphRegisteredFloatingWindowResize(event, "moduleFace");
      }
    });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNodeGraphModuleFacePageEvents, { once: true });
  } else {
    bindNodeGraphModuleFacePageEvents();
  }
}