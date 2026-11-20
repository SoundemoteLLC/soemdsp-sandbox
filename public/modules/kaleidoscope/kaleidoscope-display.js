// Degrees to radians (a unit conversion, not a limit).
const NODE_GRAPH_KALEIDOSCOPE_RAD_PER_DEG = Math.PI / 180;

function nodeGraphKaleidoscopeEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-kaleidoscope-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-kaleidoscope-canvas");
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

function nodeGraphKaleidoscopeCircuitLive() {
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

function drawNodeGraphKaleidoscopeFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphKaleidoscopeEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(canvas)
    : null;
  if (!ctx) return;
  if (face._kaleidoscopeOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphKaleidoscopeGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  // Render at the size of the picture coming in (the whole screen for Viewport In), not the small face; the face shows it scaled down.
  const renderer = nodeGraphKaleidoscopeGlEnsure(canvas, picture?.width > 0 ? picture.width : canvas.width, picture?.height > 0 ? picture.height : canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphKaleidoscopeCircuitLive() && typeof nodeGraphKaleidoscopeGlStep === "function") {
    // This frame's values: knob + MOD (the mean of each cable over the frame), limited only by the definitions
    // (nodeGraphPictureParams). Below are unit conversions only: degrees to radians, percent to a fraction, degrees of hue to turns.
    const p = nodeGraphPictureParams(nodeId, nodeGraphPictureParamKeys("kaleidoscope"));
    nodeGraphKaleidoscopeGlStep(canvas, {
      nodeId,
      segments: p.segments,
      angle: p.angle * NODE_GRAPH_KALEIDOSCOPE_RAD_PER_DEG,
      mirror: p.mirror,
      centerX: p.centerX,
      centerY: p.centerY,
      input: p.input,
      decay: p.decay,
      // Per frame steps (the feedback runs once per frame): Zoom in % a frame, Rotate in degrees a frame, Shift in % of the picture a frame.
      zoom: 1 + p.zoom / 100,
      rotate: p.rotate * NODE_GRAPH_KALEIDOSCOPE_RAD_PER_DEG,
      shiftX: p.shiftX / 100,
      shiftY: p.shiftY / 100,
      blend: p.blend,
      // Hue turns the previous frame's colours by this many degrees each frame (the shader takes turns).
      hue: p.hue / 360,
      blur: p.blur,
      saturation: p.saturation,
      punch: p.punch,
      srcX: p.srcX,
      srcY: p.srcY,
      srcZoom: p.srcZoom,
      frame: (face._kaleidoscopeFrame = ((face._kaleidoscopeFrame || 0) + 1) % 65536),
      picture,
    });
  }
  if (typeof nodeGraphKaleidoscopeGlPresent === "function") {
    nodeGraphKaleidoscopeGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphKaleidoscopeScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphKaleidoscopeGlWipe === "function") nodeGraphKaleidoscopeGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.kaleidoscopeFace = drawNodeGraphKaleidoscopeFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("kaleidoscopeFace", (canvas) => {
    wipeNodeGraphKaleidoscopeScreensToColdBoot(canvas);
  });
}
