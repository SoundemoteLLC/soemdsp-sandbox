function nodeGraphKaleidoscopeReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphKaleidoscopeClamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

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
  // While Screen Space In / Out are in the patch the circuit view is the picture being worked on, so a screen effect keeps working with the
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
  // Render at the size of the picture coming in (the whole screen for Screen Space In), not the small face; the face shows it scaled down.
  const renderer = nodeGraphKaleidoscopeGlEnsure(canvas, picture?.width > 0 ? picture.width : canvas.width, picture?.height > 0 ? picture.height : canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphKaleidoscopeCircuitLive() && typeof nodeGraphKaleidoscopeGlStep === "function") {
    const read = (key, fallback, lo = 0, hi = 1) => nodeGraphKaleidoscopeClamp(nodeGraphKaleidoscopeReadParam(nodeId, key, fallback), lo, hi);
    nodeGraphKaleidoscopeGlStep(canvas, {
      nodeId,
      segments: Math.round(read("segments", 6, 2, 32)),
      angle: read("angle", 0, -1, 1) * Math.PI,
      mirror: nodeGraphKaleidoscopeReadParam(nodeId, "mirror", 0) >= 0.5 ? 1 : 0,
      centerX: read("centerX", 0, -1, 1),
      centerY: read("centerY", 0, -1, 1),
      input: read("input", 1),
      decay: read("decay", 0.85),
      // Per frame steps: Zoom is up to 5% a frame, Rotate up to 0.5 rad (about 29 degrees) a frame, Shift up to 2% of the picture a frame.
      zoom: 1 + read("zoom", 0.1, -1, 1) * 0.05,
      rotate: read("rotate", 0.05, -1, 1) * 0.5,
      shiftX: read("shiftX", 0, -1, 1) * 0.02,
      shiftY: read("shiftY", 0, -1, 1) * 0.02,
      blend: Math.round(read("blend", 0, 0, 3)),
      // Hue turns the previous frame's colours by up to 0.05 of a turn (18 degrees) each frame; Blur is up to ~2.5 px of softening a frame.
      hue: read("hue", 0, -1, 1) * 0.05,
      blur: read("blur", 0),
      saturation: read("saturation", 0, -1, 1),
      punch: read("punch", 0),
      srcX: read("srcX", 0, -1, 1),
      srcY: read("srcY", 0, -1, 1),
      srcZoom: read("srcZoom", 1, 0.25, 8),
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
