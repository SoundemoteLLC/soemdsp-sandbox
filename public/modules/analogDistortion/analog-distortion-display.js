function nodeGraphAnalogDistortionReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphAnalogDistortionClamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function nodeGraphAnalogDistortionEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-analog-distortion-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-analog-distortion-canvas");
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

function nodeGraphAnalogDistortionCircuitLive() {
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

/** Speed for a Rate slider: 0..1 is 0.1 .. 6 (exponential), past 1 it keeps climbing, +6 for every unit. */
function nodeGraphAnalogDistortionRateSpeed(rate) {
  const r = Math.max(0, Number(rate) || 0);
  return 0.1 * Math.pow(60, Math.min(r, 1)) + Math.max(0, r - 1) * 6;
}

/** A slow wandering value in about -1..1 that does not repeat (three sines that never line up). */
function nodeGraphAnalogDistortionWander(t, seed) {
  return (Math.sin(t * 0.37 + seed) + Math.sin(t * 0.91 + seed * 1.7 + 1.3) + Math.sin(t * 1.73 + seed * 2.3 + 2.1)) / 3;
}

/**
 * The distortion's clocks: the hum bars' position (a phase in screens, signed speed) and the wiggle's angle. Phases run in doubles
 * and reach the shader reduced, so they stay exact at any speed, and the frame time is smoothed so a very fast rate does not turn
 * frame-time wobble into shake: the slow patterns it aliases into only hold still when every frame advances the phase equally. The clock is
 * the wall clock: the distortion does not stop with the engine.
 */
function nodeGraphAnalogDistortionClock(face, p) {
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  let c = face._analogDistortionClock;
  if (!c) {
    c = { last: now, hp: 0, wt: 0, dt: 1 / 60, drift: 0 };
    face._analogDistortionClock = c;
  }
  const raw = Math.max(0, Math.min(0.25, now - c.last));
  c.last = now;
  c.dt += (raw - c.dt) * 0.08;
  // Instability: a slow wander of the hum speed, the wiggle speed and the amounts (and the magnet's strength and place), on a clock of its own.
  c.drift += c.dt * 0.25;
  const inst = p.instability;
  const wander = (seed) => nodeGraphAnalogDistortionWander(c.drift, seed);
  c.hp += c.dt * p.humSpeed * 0.5 * (1 + inst * 0.8 * wander(7.7));
  c.hp -= Math.floor(c.hp);
  c.wt += c.dt * nodeGraphAnalogDistortionRateSpeed(p.wiggleRate) * (1 + inst * 0.6 * wander(4.1));
  const TAU = Math.PI * 2;
  return {
    hp: c.hp,
    wig: (c.wt * 3.0) - Math.floor((c.wt * 3.0) / TAU) * TAU,
    hum: Math.max(0, p.hum * (1 + inst * 0.5 * wander(16.1))),
    wiggle: Math.max(0, p.wiggle * (1 + inst * 0.6 * wander(12.9))),
    magnet: Math.max(0, p.magnet * (1 + inst * 0.4 * wander(21.3))),
    magX: inst * 0.15 * wander(25.1),
    magY: inst * 0.15 * wander(29.7),
  };
}

function drawNodeGraphAnalogDistortionFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphAnalogDistortionEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(canvas)
    : null;
  if (!ctx) return;
  if (face._analogDistortionOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphAnalogDistortionGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  // Render at the size of the picture coming in (the whole screen for Screen Space In), not the small face; the face shows it scaled down.
  const renderer = nodeGraphAnalogDistortionGlEnsure(canvas, picture?.width > 0 ? picture.width : canvas.width, picture?.height > 0 ? picture.height : canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphAnalogDistortionCircuitLive() && typeof nodeGraphAnalogDistortionGlStep === "function") {
    const read = (key, fallback, lo = 0, hi = 1) => nodeGraphAnalogDistortionClamp(nodeGraphAnalogDistortionReadParam(nodeId, key, fallback), lo, hi);
    const clock = nodeGraphAnalogDistortionClock(face, {
      humSpeed: read("humSpeed", 0.15, -100, 100),
      wiggleRate: read("wiggleRate", 0.5, 0, 1000),
      instability: read("instability", 0.25),
      hum: read("hum", 0.35),
      wiggle: read("wiggle", 0.25),
      magnet: read("magnet", 0),
    });
    nodeGraphAnalogDistortionGlStep(canvas, {
      nodeId,
      hum: clock.hum,
      humBars: read("humBars", 1, 0.25, 12),
      humWidth: read("humWidth", 0.4),
      wiggle: clock.wiggle,
      magnet: clock.magnet,
      magX: nodeGraphAnalogDistortionClamp(read("magX", 0, -1, 1) + clock.magX, -1, 1),
      magY: nodeGraphAnalogDistortionClamp(read("magY", 0, -1, 1) + clock.magY, -1, 1),
      magPull: read("magPull", 0.5, -1, 1),
      magSwirl: read("magSwirl", 0, -1, 1),
      magSize: read("magSize", 0.35),
      magPurity: read("magPurity", 0.3),
      hp: clock.hp,
      wig: clock.wig,
      picture,
    });
  }
  if (typeof nodeGraphAnalogDistortionGlPresent === "function") {
    nodeGraphAnalogDistortionGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphAnalogDistortionScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphAnalogDistortionGlWipe === "function") nodeGraphAnalogDistortionGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.analogDistortionFace = drawNodeGraphAnalogDistortionFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("analogDistortionFace", (canvas) => {
    wipeNodeGraphAnalogDistortionScreensToColdBoot(canvas);
  });
}
