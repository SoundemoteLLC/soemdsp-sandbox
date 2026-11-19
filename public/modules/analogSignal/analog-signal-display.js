function nodeGraphAnalogSignalReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphAnalogSignalClamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function nodeGraphAnalogSignalEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-analog-signal-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-analog-signal-canvas");
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

function nodeGraphAnalogSignalCircuitLive() {
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

/** Speed for a Rate slider: 0..1 is 0.1 .. 6 (exponential), past 1 (a widened range) it keeps climbing, +6 for every unit. */
function nodeGraphAnalogSignalRateSpeed(rate) {
  const r = Math.max(0, Number(rate) || 0);
  return 0.1 * Math.pow(60, Math.min(r, 1)) + Math.max(0, r - 1) * 6;
}

/** A slow wandering value in about -1..1 that does not repeat (three sines that never line up). */
function nodeGraphAnalogSignalWander(t, seed) {
  return (Math.sin(t * 0.37 + seed) + Math.sin(t * 0.91 + seed * 1.7 + 1.3) + Math.sin(t * 1.73 + seed * 2.3 + 2.1)) / 3;
}

/**
 * The signal's clocks. Each effect has its own phase that advances by the time since the last frame times its speed, so changing a
 * rate changes only the speed (the phase never jumps, you can feel the speed while you move the slider). Instability makes the
 * speeds and the amounts wander on a slow clock of their own. The clock is the wall clock: the signal does not stop with the engine.
 * The frame time is smoothed: a very fast rate multiplies every millisecond of frame-time wobble into visible shake, and the slow
 * patterns it aliases into only hold still when each frame advances the phase by the same amount.
 */
function nodeGraphAnalogSignalClock(face, p) {
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  let c = face._analogSignalClock;
  if (!c) {
    c = { last: now, jt: 0, wt: 0, drift: 0, dt: 1 / 60 };
    face._analogSignalClock = c;
  }
  // A long gap (a hidden tab) is not a jump: at most a quarter second per frame.
  const raw = Math.max(0, Math.min(0.25, now - c.last));
  c.last = now;
  c.dt += (raw - c.dt) * 0.08;
  const dt = c.dt;
  c.drift += dt * 0.25;
  const inst = p.instability;
  const wander = (seed) => 1 + inst * 0.6 * nodeGraphAnalogSignalWander(c.drift, seed);
  c.jt += dt * nodeGraphAnalogSignalRateSpeed(p.jitterRate) * wander(1);
  c.wt += dt * nodeGraphAnalogSignalRateSpeed(p.wobbleRate) * wander(4.1);
  // The phases run in doubles here and reach the shader already reduced, so they stay exact at any speed (a 32-bit float phase
  // would lose its fraction within seconds at thousands of times real time, and the slow patterns a very fast rate aliases into
  // depend on exactly that fraction). The jitter noise layers get (whole part mod 65536, fraction); the sines get an angle in 0..2pi.
  const split = (x) => {
    const w = Math.floor(x);
    return [w - Math.floor(w / 65536) * 65536, x - w];
  };
  const TAU = Math.PI * 2;
  const ang = (x) => x - Math.floor(x / TAU) * TAU;
  return {
    jA: split(c.jt * 0.9),
    jB: split(c.jt * 2.3 + 17.0),
    jTick: split(c.jt * 30.0)[0],
    wAng: [ang(c.wt * 1.7), ang(c.wt * 0.37)],
    jitter: Math.max(0, p.jitter * wander(9.3)),
    wobble: Math.max(0, p.wobble * wander(12.9)),
    tick: Math.floor(now * 30),
  };
}

function drawNodeGraphAnalogSignalFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphAnalogSignalEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(canvas)
    : null;
  if (!ctx) return;
  if (face._analogSignalOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphAnalogSignalGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  // Render at the size of the picture coming in (the whole screen for Screen Space In), not the small face; the face shows it scaled down.
  const renderer = nodeGraphAnalogSignalGlEnsure(canvas, picture?.width > 0 ? picture.width : canvas.width, picture?.height > 0 ? picture.height : canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphAnalogSignalCircuitLive() && typeof nodeGraphAnalogSignalGlStep === "function") {
    const read = (key, fallback, hi = 1) => nodeGraphAnalogSignalClamp(nodeGraphAnalogSignalReadParam(nodeId, key, fallback), 0, hi);
    const signed = (key, fallback) => nodeGraphAnalogSignalClamp(nodeGraphAnalogSignalReadParam(nodeId, key, fallback), -1, 1);
    const clock = nodeGraphAnalogSignalClock(face, {
      jitter: read("jitter", 0.1),
      wobble: read("wobble", 0.15),
      jitterRate: read("jitterRate", 0.5, 1000),
      wobbleRate: read("wobbleRate", 0.5, 1000),
      instability: read("instability", 0.3),
    });
    nodeGraphAnalogSignalGlStep(canvas, {
      nodeId,
      jitter: clock.jitter,
      roughness: read("roughness", 0.15),
      wobble: clock.wobble,
      noise: read("noise", 0.08),
      ringing: read("ringing", 0.15),
      ringX: signed("ringX", 1),
      ringY: signed("ringY", 0),
      bleed: read("bleed", 0.2),
      jA: clock.jA,
      jB: clock.jB,
      jTick: clock.jTick,
      wAng: clock.wAng,
      tick: clock.tick,
      picture,
    });
  }
  if (typeof nodeGraphAnalogSignalGlPresent === "function") {
    nodeGraphAnalogSignalGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphAnalogSignalScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphAnalogSignalGlWipe === "function") nodeGraphAnalogSignalGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.analogSignalFace = drawNodeGraphAnalogSignalFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("analogSignalFace", (canvas) => {
    wipeNodeGraphAnalogSignalScreensToColdBoot(canvas);
  });
}
