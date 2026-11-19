function createNodeGraphAnalogSignalBody(node, type) {
  const face = document.createElement("div");
  face.className = "node-module-scope-window node-analog-signal-face node-light-source node-module-face";
  face.dataset.node = node;
  face.dataset.nodeType = type;
  face.dataset.lightSource = "screen";
  face.dataset.lightStrength = "1";
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} place`);
  face.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;background:#000000;";

  const canvas = nodeGraphDisplayCanvasCreate("node-analog-signal-canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;";
  face.append(canvas);
  return face;
}

function nodeGraphAnalogSignalShouldAnimate(face) {
  if (typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused()) return false;
  // Speed 0 pauses the engine; the paint gate owns that read.
  if (typeof scopePaintEngineState === "function" && scopePaintEngineState() === "paused") return false;
  return !nodeGraphVideoGraphShouldSleep(face?.dataset?.node || "");
}

registerNodeGraphChromelessModuleUi("analogSignal", {
  createBody: createNodeGraphAnalogSignalBody,
  afterMount(article, body, node, type) {
    if (typeof registerNodeGraphModuleScopeSlot === "function") {
      registerNodeGraphModuleScopeSlot(article, {
        nodeId: node,
        scopeElement: body,
        type,
        viewDrag: false,
      });
    }
    if (typeof nodeGraphInstallDrawingFacePump === "function") {
      body._analogSignalOwnsClock = true;
      nodeGraphInstallDrawingFacePump(body, {
        rafKey: "_analogSignalRaf",
        forceKey: "_analogSignalForce",
        clockKey: "analogSignal",
        shouldAnimate: nodeGraphAnalogSignalShouldAnimate,
        paintOnCreate: true,
        paint(host) {
          if (typeof drawNodeGraphAnalogSignalFaceItem !== "function") return;
          const nodeId = host.dataset?.node || node;
          const slot = typeof nodeGraphModuleScopeState !== "undefined"
            ? nodeGraphModuleScopeState?.slots?.get?.(nodeId)
            : null;
          drawNodeGraphAnalogSignalFaceItem(null, {
            fromFaceLoop: true,
            screenElement: host,
            slot: slot || { nodeId, scopeElement: host, type },
          }, 1);
        },
      });
    }
  },
});
