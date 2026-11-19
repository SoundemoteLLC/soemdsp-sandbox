function createNodeGraphScreenShakeBody(node, type) {
  const face = document.createElement("div");
  face.className = "node-module-scope-window node-screen-shake-face node-light-source node-module-face";
  face.dataset.node = node;
  face.dataset.nodeType = type;
  face.dataset.lightSource = "screen";
  face.dataset.lightStrength = "1";
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} place`);
  face.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;background:#000000;";

  const canvas = nodeGraphDisplayCanvasCreate("node-screen-shake-canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;";
  face.append(canvas);
  return face;
}

function nodeGraphScreenShakeShouldAnimate(face) {
  if (typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused()) return false;
  // Speed 0 pauses the engine; the paint gate owns that read.
  if (typeof scopePaintEngineState === "function" && scopePaintEngineState() === "paused") return false;
  return !nodeGraphVideoGraphShouldSleep(face?.dataset?.node || "");
}

registerNodeGraphChromelessModuleUi("screenShake", {
  createBody: createNodeGraphScreenShakeBody,
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
      body._screenShakeOwnsClock = true;
      nodeGraphInstallDrawingFacePump(body, {
        rafKey: "_screenShakeRaf",
        forceKey: "_screenShakeForce",
        clockKey: "screenShake",
        shouldAnimate: nodeGraphScreenShakeShouldAnimate,
        paintOnCreate: true,
        paint(host) {
          if (typeof drawNodeGraphScreenShakeFaceItem !== "function") return;
          const nodeId = host.dataset?.node || node;
          const slot = typeof nodeGraphModuleScopeState !== "undefined"
            ? nodeGraphModuleScopeState?.slots?.get?.(nodeId)
            : null;
          drawNodeGraphScreenShakeFaceItem(null, {
            fromFaceLoop: true,
            screenElement: host,
            slot: slot || { nodeId, scopeElement: host, type },
          }, 1);
        },
      });
    }
  },
});
