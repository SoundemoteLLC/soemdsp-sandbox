function nodeGraphScreenShakeReadParam(nodeId, key, fallback) {
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

function nodeGraphScreenShakeEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-screen-shake-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-screen-shake-canvas");
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

/**
 * The shake's noise clock in jitters: Rate (jitters per second) integrated over the time between paints, so a modulated or
 * moving Rate changes the speed without jumping the picture. The clock is the wall clock: a shake does not stop with the engine.
 * A gap longer than 0.25 s (hidden tab) counts as 0.25 s so the shake does not lurch on return.
 */
function nodeGraphScreenShakeAdvance(face, rate) {
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  const c = face._screenShakeClock || (face._screenShakeClock = { last: now, phase: now * (Number(rate) || 0) });
  const dt = Math.max(0, Math.min(0.25, now - c.last));
  c.last = now;
  c.phase += (Number(rate) || 0) * dt;
  return c.phase;
}

function nodeGraphScreenShakeCircuitLive() {
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

function drawNodeGraphScreenShakeFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphScreenShakeEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(canvas)
    : null;
  if (!ctx) return;
  if (face._screenShakeOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphScreenShakeGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  // Render at the size of the picture coming in (the whole screen for Viewport In), not the small face; the face shows it scaled down.
  const renderer = nodeGraphScreenShakeGlEnsure(canvas, picture?.width > 0 ? picture.width : canvas.width, picture?.height > 0 ? picture.height : canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphScreenShakeCircuitLive() && typeof nodeGraphScreenShakeGlStep === "function") {
    nodeGraphScreenShakeGlStep(canvas, {
      nodeId,
      amount: nodeGraphScreenShakeReadParam(nodeId, "amount", 0.25),
      time: nodeGraphScreenShakeAdvance(face, nodeGraphScreenShakeReadParam(nodeId, "rate", 6.94)),
      picture,
    });
  }
  if (typeof nodeGraphScreenShakeGlPresent === "function") {
    nodeGraphScreenShakeGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphScreenShakeScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphScreenShakeGlWipe === "function") nodeGraphScreenShakeGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.screenShakeFace = drawNodeGraphScreenShakeFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("screenShakeFace", (canvas) => {
    wipeNodeGraphScreenShakeScreensToColdBoot(canvas);
  });
}
