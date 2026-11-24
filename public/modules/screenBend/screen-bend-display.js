function nodeGraphScreenBendReadParam(nodeId, key, fallback) {
  // Knob + this frame's MOD cables, bounded by the parameter definition (node-graph-picture-params.js).
  if (typeof nodeGraphPictureParam === "function") {
    const m = nodeGraphPictureParam(nodeId, key);
    if (Number.isFinite(m)) return m;
  }
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphScreenBendEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-screen-bend-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-screen-bend-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.appendChild(canvas);
  }
  if (typeof nodeGraphDisplayCanvasSize === "function") {
    const m = nodeGraphDisplayCanvasSize(face, canvas);
    if (m && (m.width < 8 || m.height < 8) && typeof nodeGraphDisplayCanvasSizeCss === "function") {
      nodeGraphDisplayCanvasSizeCss(canvas, Math.max(8, m.width) / m.pixelRatio, Math.max(8, m.height) / m.pixelRatio, 1);
    }
  }
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "5";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  return canvas;
}

function nodeGraphScreenBendCircuitLive() {
  // While Viewport In / Out are in the patch the circuit view is the picture being worked on, so a screen effect keeps working with the
  // engine stopped (it would otherwise sit on a wiped black frame and the screen would go black).
  if (typeof nodeGraphScreenFxState === "object" && nodeGraphScreenFxState?.active) return true;
  try {
    if (typeof nodeGraphModuleScopeEnginePaused === "function" && nodeGraphModuleScopeEnginePaused()) return false;
  } catch (_e) { /* fall through */ }
  try {
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) return false;
  } catch (_e) { /* fall through */ }
  return true;
}

function drawNodeGraphScreenBendFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphScreenBendEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(canvas)
    : null;
  if (!ctx) return;
  if (face._screenBendOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphScreenBendGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  // Render at the size of the picture coming in (the whole screen for Viewport In), not the small face; the face shows it scaled down.
  const renderer = nodeGraphScreenBendGlEnsure(canvas, picture?.width > 0 ? picture.width : canvas.width, picture?.height > 0 ? picture.height : canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphScreenBendCircuitLive() && typeof nodeGraphScreenBendGlStep === "function") {
    nodeGraphScreenBendGlStep(canvas, {
      nodeId,
      width: nodeGraphScreenBendReadParam(nodeId, "width", 0.55),
      height: nodeGraphScreenBendReadParam(nodeId, "height", 0.55),
      round: nodeGraphScreenBendReadParam(nodeId, "round", 0.4),
      vignette: nodeGraphScreenBendReadParam(nodeId, "vignette", 0.35),
      glare: nodeGraphScreenBendReadParam(nodeId, "glare", 0.15),
      glareX: nodeGraphScreenBendReadParam(nodeId, "glareX", -0.42),
      glareY: nodeGraphScreenBendReadParam(nodeId, "glareY", 0.5),
      glareSize: nodeGraphScreenBendReadParam(nodeId, "glareSize", 0.5),
      vigReach: nodeGraphScreenBendReadParam(nodeId, "vigReach", 0.4),
      vigCurve: nodeGraphScreenBendReadParam(nodeId, "vigCurve", 0.3),
      vigShape: nodeGraphScreenBendReadParam(nodeId, "vigShape", 1),
      shadowAlpha: nodeGraphScreenBendReadParam(nodeId, "shadowAlpha", 0),
      shadowThick: nodeGraphScreenBendReadParam(nodeId, "shadowThick", 0.3),
      picture,
    });
  }
  if (typeof nodeGraphScreenBendGlPresent === "function") {
    nodeGraphScreenBendGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphScreenBendScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphScreenBendGlWipe === "function") nodeGraphScreenBendGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.screenBendFace = drawNodeGraphScreenBendFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("screenBendFace", (canvas) => {
    wipeNodeGraphScreenBendScreensToColdBoot(canvas);
  });
}
