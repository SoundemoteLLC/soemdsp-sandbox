function nodeGraphChromaColorReadParam(nodeId, key, fallback) {
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

function nodeGraphChromaColorEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-chroma-color-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-chroma-color-canvas");
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

function nodeGraphChromaColorCircuitLive() {
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

/**
 * The drifting hue: a phase (in turns) that advances by the time since the last frame times Drift, so changing Drift changes only the speed and
 * never makes the colour jump. Kept in a double and wrapped to 0..1 before it reaches the shader. The clock is the wall clock: the drift does not
 * stop with the engine.
 */
function nodeGraphChromaColorDrift(face, drift) {
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  let c = face._chromaColorClock;
  if (!c) {
    c = { last: now, phase: 0 };
    face._chromaColorClock = c;
  }
  const dt = Math.max(0, Math.min(0.25, now - c.last));
  c.last = now;
  // Drift -1 .. 1 is up to 0.5 turns of hue a second.
  c.phase += dt * drift * 0.5;
  c.phase -= Math.floor(c.phase);
  return c.phase;
}

function drawNodeGraphChromaColorFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphChromaColorEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(canvas)
    : null;
  if (!ctx) return;
  if (face._chromaColorOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphChromaColorGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  // Render at the size of the picture coming in (the whole screen for Viewport In), not the small face; the face shows it scaled down.
  const renderer = nodeGraphChromaColorGlEnsure(canvas, picture?.width > 0 ? picture.width : canvas.width, picture?.height > 0 ? picture.height : canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphChromaColorCircuitLive() && typeof nodeGraphChromaColorGlStep === "function") {
    // Bounds come from the parameter definitions (the reader folds MOD cables and clips to them).
    const read = (key, fallback) => nodeGraphChromaColorReadParam(nodeId, key, fallback);
    nodeGraphChromaColorGlStep(canvas, {
      nodeId,
      red: read("red", 1),
      green: read("green", 1),
      blue: read("blue", 1),
      // Hue and Tint Hue are in degrees; the shader works in whole turns.
      hue: read("hue", 0) / 360,
      saturation: read("saturation", 0),
      lightness: read("lightness", 0),
      contrast: read("contrast", 0),
      gamma: read("gamma", 1),
      tintHue: read("tintHue", 208.8) / 360,
      tint: read("tint", 0),
      invert: read("invert", 0),
      spread: read("spread", 0),
      drift: nodeGraphChromaColorDrift(face, read("drift", 0)),
      picture,
    });
  }
  if (typeof nodeGraphChromaColorGlPresent === "function") {
    nodeGraphChromaColorGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphChromaColorScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphChromaColorGlWipe === "function") nodeGraphChromaColorGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.chromaColorFace = drawNodeGraphChromaColorFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("chromaColorFace", (canvas) => {
    wipeNodeGraphChromaColorScreensToColdBoot(canvas);
  });
}
