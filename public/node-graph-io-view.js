// IO view (Tab): how a module's jacks and labels show.
//
//   A  (default)  The compacted IO: one pill per side in a strip between the title and the display. Cables end at the
//                 pills. Click a pill to go to B.
//   B             Full jacks, full names, every cable, and a dark veil over each whole module with the jacks, labels and
//                 wire dots on top of it, so the names stay readable over a display or sliders. A crowded edge shows
//                 every jack at once.
//
// Tab toggles A and B. Shift+Tab shows / hides the cables in A (their jack dots stay); B always shows every cable.
// The view and the cable setting are UI settings, saved in the browser (not in the patch).

(() => {
  "use strict";

  // One row per view; each is a setting, so a view is changed by editing its row.
  //   jacks   the half-circle jack cutouts (on the plate and through the display)
  //   labels  jack names: "off" | "full"
  //   veil    alpha of the dark veil over each module under its IO (0 = none)
  //   wireColor "from" (the colour of the jack the cable leaves) | "to" (the jack it enters); modulation cables
  //             always keep their modulation (purple) colour
  //   pills   one pill per side stands for that side's jacks (cables end at it)
  //   strip   the one-row band between the title and the display. A shows the pills in it; in B it is the first jack
  //           row, so the pill and the first jack are the same slot and a module's size is the same in both views
  const VIEWS = {
    A: { jacks: false, labels: "off", veil: 0, wireColor: "from", pills: true, strip: true },
    B: { jacks: true, labels: "full", veil: 0.55, wireColor: "to", strip: true },
  };

  const STORAGE_KEY = "soemdsp-sandbox.ioView.v1";
  const WIRES_KEY = "soemdsp-sandbox.ioWiresHidden.v1";
  const state = { view: "A", wiresHidden: false };

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "A" || saved === "B") state.view = saved;
    state.wiresHidden = window.localStorage.getItem(WIRES_KEY) === "1";
  } catch { /* storage unavailable: keep the default */ }

  function applyBodyState() {
    const body = document.body;
    if (!body) return;
    body.setAttribute("data-io-view", state.view);
    body.setAttribute("data-io-strip", VIEWS[state.view].strip ? "1" : "0");
  }

  /** Jack positions follow the rows, so they are read again from the DOM after the view changes the rows. */
  function refreshGeometry() {
    if (typeof nodeGraphModuleGeometryInvalidateAll === "function") nodeGraphModuleGeometryInvalidateAll();
    if (typeof nodeGraphModuleGeometryPublishVisible === "function") nodeGraphModuleGeometryPublishVisible();
  }

  function redraw() {
    if (typeof drawNodeGraphWires === "function") {
      try { drawNodeGraphWires(); } catch { /* wires not ready yet */ }
    }
    if (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState) {
      nodeGraphGlGraphState.gen = (nodeGraphGlGraphState.gen || 0) + 1;
      if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
    }
  }

  /** Every module re-reads its size (the strip row is part of it). */
  function resyncModuleSizes() {
    const nodes = nodeGraphMvp?.patch?.nodes;
    if (!Array.isArray(nodes) || typeof syncNodeGraphModuleChromeElement !== "function") return;
    for (const node of nodes) {
      const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(node.id) : null;
      if (el) {
        try { syncNodeGraphModuleChromeElement(el, node); } catch { /* module not mounted */ }
      }
    }
  }

  function setView(view) {
    const next = view === "B" ? "B" : "A";
    if (next === state.view) return state.view;
    state.view = next;
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    applyBodyState();
    resyncModuleSizes();
    refreshGeometry();
    redraw();
    return state.view;
  }

  window.nodeGraphIoView = () => state.view;
  window.nodeGraphIoViewConfig = () => VIEWS[state.view];
  /** The strip (grid cells) at the top of each module's shell, between the title and the display. */
  window.nodeGraphIoViewStripGu = (type) => (
    VIEWS[state.view].strip && typeof nodeGraphModuleUsesLayoutB === "function" && nodeGraphModuleUsesLayoutB(type)
      ? 15 / 28
      : 0
  );
  window.setNodeGraphIoView = setView;
  window.toggleNodeGraphIoView = () => setView(state.view === "A" ? "B" : "A");
  /** Cables are hidden (their jack dots stay) in View A when the user hid them; View B always shows them. */
  window.nodeGraphWiresHidden = () => state.view === "A" && state.wiresHidden;
  window.toggleNodeGraphWiresHidden = () => {
    if (state.view !== "A") return state.wiresHidden;
    state.wiresHidden = !state.wiresHidden;
    try { window.localStorage.setItem(WIRES_KEY, state.wiresHidden ? "1" : "0"); } catch { /* ignore */ }
    redraw();
    return state.wiresHidden;
  };

  /** Jack label text for the current view ("" = none). */
  window.nodeGraphIoViewLabelText = (text) => (VIEWS[state.view].labels === "off" ? "" : String(text || ""));

  function pointOf(event) {
    return typeof nodeGraphClientToZoomSurfacePoint === "function"
      ? nodeGraphClientToZoomSurfacePoint(event.clientX, event.clientY)
      : null;
  }

  function pillAt(point) {
    const pills = nodeGraphGlGraphState?.chrome?.pills || [];
    for (let i = pills.length - 1; i >= 0; i -= 1) {
      const pill = pills[i];
      const side = pill.io === "output" ? -1 : 1;
      const w = pill.r * 3.4;
      const x0 = side > 0 ? pill.x : pill.x - w;
      if (point.x >= x0 && point.x <= x0 + w && Math.abs(point.y - pill.y) <= pill.r) return pill;
    }
    return null;
  }

  // A click on a pill (View A) opens View B: every jack and its full name.
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || typeof nodeGraphGlGraphState !== "object" || state.view !== "A") return;
    const point = pointOf(event);
    if (!point || !pillAt(point)) return;
    event.preventDefault();
    event.stopPropagation();
    setView("B");
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
    if (typeof nodeGraphEventTargetIsTextEditable === "function" && nodeGraphEventTargetIsTextEditable(event.target)) return;
    event.preventDefault();
    if (event.repeat) return;
    if (event.shiftKey) window.toggleNodeGraphWiresHidden();
    else window.toggleNodeGraphIoView();
  }, true);

  if (document.body) applyBodyState();
  else document.addEventListener("DOMContentLoaded", applyBodyState, { once: true });
})();
