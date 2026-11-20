function createNodeGraphKaleidoscopeBody(node, type) {
  const face = document.createElement("div");
  face.className = "node-module-scope-window node-kaleidoscope-face node-light-source node-module-face";
  face.dataset.node = node;
  face.dataset.nodeType = type;
  face.dataset.lightSource = "screen";
  face.dataset.lightStrength = "1";
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} place`);
  face.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;background:#000000;";

  const canvas = nodeGraphDisplayCanvasCreate("node-kaleidoscope-canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;";
  face.append(canvas);
  return face;
}

function nodeGraphKaleidoscopeShouldAnimate(face) {
  // While the Viewport is on, the circuit view itself is the picture: it keeps being drawn when the project is paused (speed 0) or the
  // Display Settings freeze is on, or moving around the view would only refresh now and then.
  if (typeof nodeGraphScreenFxState === "object" && nodeGraphScreenFxState?.active) return !nodeGraphVideoGraphShouldSleep(face?.dataset?.node || "");
  if (typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused()) return false;
  // Speed 0 pauses the engine; the paint gate owns that read.
  if (typeof scopePaintEngineState === "function" && scopePaintEngineState() === "paused") return false;
  return !nodeGraphVideoGraphShouldSleep(face?.dataset?.node || "");
}

registerNodeGraphChromelessModuleUi("kaleidoscope", {
  createBody: createNodeGraphKaleidoscopeBody,
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
      body._kaleidoscopeOwnsClock = true;
      nodeGraphInstallDrawingFacePump(body, {
        rafKey: "_kaleidoscopeRaf",
        forceKey: "_kaleidoscopeForce",
        clockKey: "kaleidoscope",
        shouldAnimate: nodeGraphKaleidoscopeShouldAnimate,
        paintOnCreate: true,
        paint(host) {
          if (typeof drawNodeGraphKaleidoscopeFaceItem !== "function") return;
          const nodeId = host.dataset?.node || node;
          const slot = typeof nodeGraphModuleScopeState !== "undefined"
            ? nodeGraphModuleScopeState?.slots?.get?.(nodeId)
            : null;
          drawNodeGraphKaleidoscopeFaceItem(null, {
            fromFaceLoop: true,
            screenElement: host,
            slot: slot || { nodeId, scopeElement: host, type },
          }, 1);
        },
      });
    }
  },
});
