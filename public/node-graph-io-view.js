// IO view (Tab): how a module's jacks and labels show.
//
//   A  (default)  The compacted IO: one pill per side in a strip between the title and the display. Cables end at the
//                 pills. Click a pill to go to B (a side with one jack starts that jack's wire instead).
//   B             Full jacks, full names, every cable, and a dark veil over each whole module with the jacks, labels and
//                 wire dots on top of it, so the names stay readable over a display or sliders. A crowded edge shows
//                 every jack at once.
//
// A pill click opens B as a wiring view: it closes again by itself when the cable gesture ends (connected, dropped in empty space,
// or cancelled) and on Esc. B opened with Tab stays until Tab is pressed again.
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
  const state = { view: "A", wiresHidden: false, wiring: false, sawGesture: false, watch: 0 };

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

  /** A cable gesture is going on: a drag from a jack, a cable armed by a click, or a selected cable being moved. */
  function cableGestureActive() {
    const m = typeof nodeGraphMvp === "object" ? nodeGraphMvp : null;
    return Boolean(m && (m.wireDragging || m.portConnectionMode || m.portMovePointer));
  }

  function refreshHelp() {
    if (typeof setNodeInteractionHelp === "function") setNodeInteractionHelp("");
  }

  function stopWiring() {
    state.wiring = false;
    state.sawGesture = false;
    if (state.watch) window.cancelAnimationFrame(state.watch);
    state.watch = 0;
  }

  /** Watches the cable gesture of a wiring view: when one has been going on and is over, View B closes. */
  function watchWiring() {
    state.watch = 0;
    if (!state.wiring || state.view !== "B") return;
    if (cableGestureActive()) state.sawGesture = true;
    else if (state.sawGesture) {
      setView("A");
      return;
    }
    state.watch = window.requestAnimationFrame(watchWiring);
  }

  /** Opened by a pill click: View B for one wiring job. */
  function enterWiringView() {
    state.wiring = true;
    state.sawGesture = false;
    setView("B");
    refreshHelp();
    if (!state.watch) state.watch = window.requestAnimationFrame(watchWiring);
  }

  function setView(view) {
    const next = view === "B" ? "B" : "A";
    if (next === state.view) return state.view;
    // Any switch other than the one that opens the wiring view ends it (Tab pins B or leaves it, the gesture end closes it).
    if (!(next === "B" && state.wiring)) stopWiring();
    state.view = next;
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    applyBodyState();
    resyncModuleSizes();
    refreshGeometry();
    redraw();
    refreshHelp();
    return state.view;
  }

  window.nodeGraphIoView = () => state.view;
  /** One line of help while a pill click's wiring view is open (read by the interaction help bar). */
  window.nodeGraphIoViewHintText = () => (state.wiring && state.view === "B" ? "Wiring view: Esc or Tab goes back to the normal view." : "");
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
      // The same hitbox as an expanded jack: a square on the jack's centre (the wall), so both halves of the circle hit, with the
      // jack hit radius as its half size at the least.
      const jackRadius = typeof nodeGraphJackHitRadiusPx === "function" ? nodeGraphJackHitRadiusPx() : 8;
      const reach = Math.max(pill.r || 0, jackRadius);
      if (Math.max(Math.abs(point.x - pill.x), Math.abs(point.y - pill.y)) <= reach) return pill;
      // And the old strip inward of it, where the pill's count sits.
      const w = pill.r * 3.4;
      const x0 = side > 0 ? pill.x : pill.x - w;
      if (point.x >= x0 && point.x <= x0 + w && Math.abs(point.y - pill.y) <= pill.r) return pill;
    }
    return null;
  }

  /** The wire drag of a side's only jack. false when it cannot be found (the press then opens View B instead). */
  function startWireFromOnlyJack(event, pill) {
    const handler = nodeGraphWireInteractions?.handlePortPointerDown;
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(pill.id) : null;
    if (typeof handler !== "function" || typeof nodeGraphGlHitRetarget !== "function" || !el) return false;
    const ports = [...el.querySelectorAll(`.node-io-column.${pill.io} .node-port`)];
    if (ports.length !== 1) return false;
    handler(nodeGraphGlHitRetarget(event, ports[0]));
    return Boolean(nodeGraphMvp?.wireDragging || nodeGraphMvp?.portMovePointer || nodeGraphMvp?.portConnectionMode);
  }

  // A click on a pill (View A) opens View B: every jack and its full name.
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || typeof nodeGraphGlGraphState !== "object" || state.view !== "A") return;
    const point = pointOf(event);
    const pill = point ? pillAt(point) : null;
    if (!pill) return;
    event.preventDefault();
    event.stopPropagation();
    // A side with one jack has nothing to choose from: the press starts that jack's wire at once (View A stays as it is).
    if (pill.count === 1 && startWireFromOnlyJack(event, pill)) return;
    enterWiringView();
  }, true);

  // Esc closes a wiring view (the cable gesture's own Esc, which cancels the cable, runs as usual).
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.wiring && state.view === "B") setView("A");
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
