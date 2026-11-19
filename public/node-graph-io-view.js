// IO view (Tab): how a module's jacks, labels and cables show.
//
//   A  (default)  Short jack labels. Cables are hidden (their jack dots stay) unless the pointer is over a module at
//                 one end of the cable. Quiet: sliders and displays stay clear to use.
//   B             Full jack names, every cable, and a dark veil over each whole module with the jacks, labels and
//                 wire dots on top of it, so the names stay readable over a display or sliders.
//
// A hover never shows full names: that would put labels over a slider being adjusted.
// The view is a UI setting, saved in the browser (not in the patch).

(() => {
  "use strict";

  // One row per view; each is a setting, so a view is changed by editing its row.
  //   jacks   the half-circle jack cutouts (on the plate and through the display)
  //   labels  jack names: "off" | "short" | "full"
  //   dots    the wire end dots (always drawn where a cable ends)
  //   wires   "all" | "hover" (only cables at the hovered module) | "none"
  //   veil    alpha of the dark veil over each module under its IO (0 = none)
  //   collapseUnused  unconnected jacks leave the rail, so the connected ones stack up from the top
  //                   (module sizes do not change: that is only where the jacks sit)
  const VIEWS = {
    A: { jacks: false, labels: "off", wires: "all", veil: 0, collapseUnused: true },
    B: { jacks: true, labels: "full", wires: "all", veil: 0.55, collapseUnused: false },
  };

  const STORAGE_KEY = "soemdsp-sandbox.ioView.v1";
  const state = { view: "A", hover: "" };

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "A" || saved === "B") state.view = saved;
  } catch { /* storage unavailable: keep the default */ }

  function applyBodyState() {
    const body = document.body;
    if (!body) return;
    body.setAttribute("data-io-view", state.view);
    body.setAttribute("data-io-collapse", VIEWS[state.view].collapseUnused ? "1" : "0");
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

  function setView(view) {
    const next = view === "B" ? "B" : "A";
    if (next === state.view) return state.view;
    state.view = next;
    state.hover = "";
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    applyBodyState();
    refreshGeometry();
    redraw();
    return state.view;
  }

  /** The module under a client point, front-most first (the GL plates are the only hit geometry). */
  function moduleAt(clientX, clientY) {
    const point = typeof nodeGraphClientToZoomSurfacePoint === "function"
      ? nodeGraphClientToZoomSurfacePoint(clientX, clientY)
      : null;
    const plates = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState?.plates || [] : [];
    if (!point) return "";
    for (let i = plates.length - 1; i >= 0; i -= 1) {
      const p = plates[i];
      if (point.x >= p.x && point.x <= p.x + p.w && point.y >= p.y && point.y <= p.y + p.h) return String(p.id || "");
    }
    return "";
  }

  window.nodeGraphIoView = () => state.view;
  window.nodeGraphIoViewConfig = () => VIEWS[state.view];
  window.setNodeGraphIoView = setView;
  window.toggleNodeGraphIoView = () => setView(state.view === "A" ? "B" : "A");

  /** A cable is hidden (its jack dots stay) per the view's `wires` setting. */
  window.nodeGraphIoViewHidesWire = (sourceNode, destinationNode) => {
    const mode = VIEWS[state.view].wires;
    if (mode === "all") return false;
    if (mode === "none") return true;
    const h = state.hover;
    return !(h && (String(sourceNode) === h || String(destinationNode) === h));
  };

  /** Jack label text for the current view ("" = none), short by the shared rail short-label rule. */
  window.nodeGraphIoViewLabelText = (text) => {
    const full = String(text || "");
    const mode = VIEWS[state.view].labels;
    if (mode === "off") return "";
    if (mode === "full" || full.length <= 4 || typeof nodeGraphRailShortLabel !== "function") return full;
    return nodeGraphRailShortLabel(full) || full;
  };

  document.addEventListener("pointermove", (event) => {
    if (VIEWS[state.view].wires !== "hover") return;
    const id = moduleAt(event.clientX, event.clientY);
    if (id === state.hover) return;
    state.hover = id;
    redraw();
  }, { passive: true });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (typeof nodeGraphEventTargetIsTextEditable === "function" && nodeGraphEventTargetIsTextEditable(event.target)) return;
    if (event.repeat) { event.preventDefault(); return; }
    event.preventDefault();
    window.toggleNodeGraphIoView();
  }, true);

  if (document.body) applyBodyState();
  else document.addEventListener("DOMContentLoaded", applyBodyState, { once: true });
})();
