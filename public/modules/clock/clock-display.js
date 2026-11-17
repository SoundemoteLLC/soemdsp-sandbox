// Clock face: one clock cycle. The gate is a closed rectangle (Pulse Start to
// Pulse End), centered vertically. While the playhead is inside the gate the
// gate fills from Pulse Start up to the playhead. A dim marker sits at the
// phase the clock starts from (Phase). The playhead follows the engine's own
// phase (__Phase), shifted to the time the speakers play it, and flashes when
// the gate goes high (playhead crosses Pulse Start). Display Settings `clockFace`: Background, Pulse (line), Playhead
// (dot), Fill, Start (phase-start marker), Blink (playhead + start marker flash on gate rise) HBS;
// Line thickness (gate + playhead), Start thickness, Blink time (0 = off),
// Height (% of the face height the gate spans, centered).
// The face is also the Pulse Width control: drag an end of the gate to move
// Pulse Start or Pulse End, or inside it to move both (same params and law as
// the Pulse Width band, so either one follows the other).
// GPU only, drawn with the shared antialiased line drawer (gl-line-renderer).

const nodeGraphClockFaceDisplaySettingsDefaults = Object.freeze({
  backgroundHue: 205.714,
  backgroundBrightness: 0.009,
  backgroundSaturation: 0.59,
  lineHue: 187.5,
  lineBrightness: 0.56,
  lineSaturation: 0.99,
  lineThickness: 2,
  dotHue: 0,
  dotBrightness: 1,
  dotSaturation: 0,
  fillHue: 191.5,
  fillBrightness: 0.075,
  fillSaturation: 0.67,
  startHue: 44.5,
  startBrightness: 0.16,
  startSaturation: 0.49,
  startThickness: 1.5,
  blinkHue: 49,
  blinkBrightness: 0.61,
  blinkSaturation: 0.97,
  blinkTime: 0,
  gateHeight: 68,
});
/** HBS lamps the RoundShape model does not carry (it owns background / line / dot). */
const NODE_GRAPH_CLOCK_FACE_EXTRA_LAMPS = Object.freeze(["fill", "start", "blink"]);

function normalizeNodeGraphClockFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphClockFaceDisplaySettingsDefaults;
  const merged = { ...d, ...source };
  const look = normalizeNodeGraphRoundShapeFaceSettings(merged);
  const unit = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  const out = { ...look };
  for (const id of NODE_GRAPH_CLOCK_FACE_EXTRA_LAMPS) {
    const raw = Number(merged[`${id}Hue`]);
    const hue = Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : d[`${id}Hue`];
    const bright = unit(merged[`${id}Brightness`], d[`${id}Brightness`]);
    const sat = unit(merged[`${id}Saturation`], d[`${id}Saturation`]);
    out[`${id}Hue`] = hue;
    out[`${id}Brightness`] = bright;
    out[`${id}Saturation`] = sat;
    out[`${id}Paint`] = nodeGraphHueBrightnessCss(hue, bright, 1, sat);
  }
  const span = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  out.startThickness = span(merged.startThickness, 0, 16, d.startThickness);
  out.blinkTime = span(merged.blinkTime, 0, 1, d.blinkTime);
  out.gateHeight = span(merged.gateHeight, 0, 100, d.gateHeight);
  return out;
}

function nodeGraphClockFaceSettingsForNode(node) {
  return normalizeNodeGraphClockFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphClockDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-clock-face[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._clockForceDraw = true;
  drawNodeGraphClockFace(el);
}

function nodeGraphClockFaceParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/** True when a cable is plugged into this clock's ƒ input. */
function nodeGraphClockFaceFJackWired(nodeId) {
  const connections = Array.isArray(nodeGraphMvp?.patch?.connections) ? nodeGraphMvp.patch.connections : [];
  return connections.some((c) => c.destinationNode === nodeId && (c.destinationPort === "f" || c.destinationPort === "ƒ"));
}

/**
 * The speed the engine's clock is really running at, in cycles per second
 * (negative = backwards), or NaN when it cannot be read. It is the step
 * between the last two entries of the engine's phase history times how many
 * entries that history holds per second.
 */
function nodeGraphClockFaceEngineRate(section, contextTime) {
  const buffer = nodeGraphModuleScopeState?.buffers?.get(`${section.dataset.node}:__Phase`);
  const n = buffer?.length || 0;
  if (n < 2) return Number.NaN;
  // Entries per second is counted, not taken from the history's own label
  // (which says 30 while the engine writes one entry per audio block): how
  // far its running entry count moved over at least a second of audio time.
  const count = Number(buffer.nodeGraphScopeTotalSampleCount);
  if (!Number.isFinite(count)) return Number.NaN;
  const cal = section._clockRateCal;
  if (!cal || count < cal.count || contextTime < cal.time) {
    section._clockRateCal = { count, time: contextTime, perSecond: cal?.perSecond };
  } else if (contextTime - cal.time >= 1) {
    section._clockRateCal = { count, time: contextTime, perSecond: (count - cal.count) / (contextTime - cal.time) };
  }
  const perSecond = Number(section._clockRateCal.perSecond);
  const a = Number(buffer[n - 2]);
  const b = Number(buffer[n - 1]);
  if (!(perSecond > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  let step = b - a;
  step -= Math.floor(step + 0.5); // shortest way round the cycle, either direction
  return step * perSecond;
}

/**
 * Heard phase 0..1, or NaN when the engine is not publishing. Each new engine
 * value is anchored at the context time it arrived; the phase is then advanced
 * at Rate to the context time now coming out of the speakers
 * (getOutputTimestamp), which also takes the output latency off.
 */
function nodeGraphClockFacePhase(section, node) {
  const ctx = nodeGraphMvp?.live?.context;
  const live = typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(section.dataset.node, "__Phase", Number.NaN))
    : Number.NaN;
  if (!Number.isFinite(live)) return Number.NaN;
  // Plugin WebView has no running AudioContext. Use the engine phase as-is
  // (display-tap / worklet __Phase). Browser still extrapolates to output time.
  if (!ctx || ctx.state !== "running" || typeof ctx.getOutputTimestamp !== "function") {
    return live - Math.floor(live);
  }
  if (live !== section._clockAnchorValue) {
    section._clockAnchorValue = live;
    section._clockAnchorTime = ctx.currentTime;
  }
  const stamp = ctx.getOutputTimestamp();
  const heard = stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  // A wired ƒ replaces Rate in the engine, so the Rate knob is not the speed
  // any more. Then the speed is read from the engine's own phase history.
  // Not readable yet: hold the engine value instead of guessing.
  let rate = Math.max(0, nodeGraphClockFaceParam(node, "rate", 2));
  if (nodeGraphClockFaceFJackWired(section.dataset.node)) {
    const engineRate = nodeGraphClockFaceEngineRate(section, ctx.currentTime);
    rate = Number.isFinite(engineRate) ? engineRate : 0;
  }
  const p = live + rate * (heard - section._clockAnchorTime);
  return p - Math.floor(p);
}

/**
 * Gate geometry in face px: x0..x1 the cycle, xs/xe the gate ends, high/low
 * the gate top and bottom with equal margins above and below. heightPct is
 * the share of the face height the gate spans (stroke included). Amp is the
 * output level, not a face size: a quiet clock still fills its display.
 */
function nodeGraphClockFaceGeometry(w, h, pulseStart, pulseEnd, stroke, heightPct) {
  const padX = Math.max(6, w * 0.06) + stroke * 0.5;
  const x0 = padX;
  const x1 = w - padX;
  const half = Math.max(0, h * heightPct / 200 - stroke * 0.5);
  const at = (v) => x0 + (x1 - x0) * v;
  return { x0, x1, xs: at(pulseStart), xe: at(pulseEnd), high: h * 0.5 - half, low: h * 0.5 + half, at };
}

/**
 * True when the gate never falls. Same rule as native clock.cpp (v8): the gate
 * is high while phase is in [Start, End) with phase in [0, 1), so it is high on
 * every sample exactly when Start is 0 and End is 1, at any rate (Rate 0 just
 * pauses the phase; it is not a special case).
 */
function nodeGraphClockFaceGateEndless(pulseStart, pulseEnd) {
  return pulseStart <= 0 && pulseEnd >= 1;
}

/** True when phase moved forward from last to now (under half a cycle, wrap allowed) past edge. */
function nodeGraphClockFaceCrossed(last, now, edge) {
  if (!Number.isFinite(last) || !Number.isFinite(now)) return false;
  const wrap = (v) => v - Math.floor(v);
  const d = wrap(now - last);
  const u = wrap(edge - last);
  return d > 0 && d < 0.5 && u > 0 && u <= d;
}

/** Fill spans [x, x] from Pulse Start up to the playhead, only while the playhead is in the gate. */
function nodeGraphClockFaceFillSpans(g, pulseStart, pulseEnd, phase, endless = false) {
  const xp = g.at(phase);
  if (endless) return [[g.x0, xp]];
  if (pulseEnd >= pulseStart) return phase >= pulseStart && phase < pulseEnd ? [[g.xs, xp]] : [];
  if (phase >= pulseStart) return [[g.xs, xp]];
  if (phase < pulseEnd) return [[g.xs, g.x1], [g.x0, xp]];
  return [];
}

function drawNodeGraphClockFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.(".node-display-face");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const now = performance.now() / 1000;
  const offset = nodeGraphClockFaceParam(node, "phase", 0);
  const startPhase = offset - Math.floor(offset);
  const heard = nodeGraphClockFacePhase(section, node);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const pulseStart = clamp01(nodeGraphClockFaceParam(node, "pulseStart", 0));
  const pulseEnd = clamp01(nodeGraphClockFaceParam(node, "pulseEnd", 0.5));
  const endless = nodeGraphClockFaceGateEndless(pulseStart, pulseEnd);
  // Blink on gate start: the playhead crossed Pulse Start since the last frame
  // (in the clock's own, offset phase, which the native __Phase reports).
  if (!endless && Number.isFinite(heard) && nodeGraphClockFaceCrossed(section._clockLast, heard, pulseStart)) section._clockFlash = now;
  // The face axis is the cycle as it runs from Reset (left edge = Reset).
  // The gate fires at offset phase Start, so on this axis the gate box sits
  // at Start - Phase and End - Phase (wrapping across the edge): changing
  // Phase visibly slides the gate and the tick mark. The playhead is the
  // offset phase minus Phase, so after a Reset it sweeps from the left edge.
  const wrapPhase = (v) => v - Math.floor(v);
  const phase = Number.isFinite(heard) ? wrapPhase(heard - startPhase) : 0;
  let gateStart = endless ? 0 : wrapPhase(pulseStart - startPhase);
  let gateEnd = endless ? 1 : wrapPhase(pulseEnd - startPhase);
  // An End that lands exactly on the cycle edge is the right edge, not 0.
  if (!endless && gateEnd === 0 && gateStart > 0) gateEnd = 1;
  // Start == End (one-sample trigger per cycle, clock v10) draws as a line.
  section._clockLast = heard;
  const look = nodeGraphClockFaceSettingsForNode(node);
  const flashing = look.blinkTime > 0 && Number.isFinite(section._clockFlash) && now - section._clockFlash < look.blinkTime;
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "clock face: no shared GL device");
    return;
  }
  const smoothing = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look.lineSmoothing) || 1);
  const stroke = look.lineThickness;
  const halfPx = stroke * 0.5;
  const g = nodeGraphClockFaceGeometry(w, h, gateStart, gateEnd, stroke, look.gateHeight);
  const { x0, x1, xs, xe, high, low } = g;
  const fill = rgba(look.fillPaint);
  for (const [a, b] of nodeGraphClockFaceFillSpans(g, gateStart, gateEnd, phase, endless)) {
    if (b > a) nodeGraphGlLinesRect(batch, a, high, b - a, low - high, fill);
  }
  // Gate: a closed rectangle. End before Start wraps it across the cycle edge.
  // A gate that never falls has no edges: top and bottom only.
  const pulse = rgba(look.strokePaint);
  // Line thickness 0 = no gate outline (the fill stays).
  const outline = halfPx > 0;
  if (outline && endless) {
    nodeGraphGlLinesSegment(batch, x0, high, x1, high, halfPx, smoothing, pulse);
    nodeGraphGlLinesSegment(batch, x0, low, x1, low, halfPx, smoothing, pulse);
  } else if (outline && gateEnd >= gateStart) {
    const mid = (xs + xe) * 0.5;
    nodeGraphGlLinesPolyline(batch, [mid, low, xs, low, xs, high, xe, high, xe, low, mid, low], halfPx, smoothing, pulse);
  } else if (outline) {
    nodeGraphGlLinesPolyline(batch, [x1, low, xs, low, xs, high, x1, high], halfPx, smoothing, pulse);
    nodeGraphGlLinesPolyline(batch, [x0, high, xe, high, xe, low, x0, low], halfPx, smoothing, pulse);
  }
  // Tick marker: where T fires, the offset phase wrapping, at 1 - Phase on
  // this axis (the left edge at Phase 0). Slides with Phase like the gate.
  // Blinks with the playhead.
  const xm = g.at(wrapPhase(1 - startPhase));
  if (look.startThickness > 0) nodeGraphGlLinesSegment(batch, xm, high, xm, low, look.startThickness * 0.5, smoothing, rgba(flashing ? look.blinkPaint : look.startPaint));
  // Playhead: the gate's height and stroke; flashes when the clock fires.
  const xp = g.at(phase);
  nodeGraphGlLinesSegment(batch, xp, high, xp, low, halfPx, smoothing, rgba(flashing ? look.blinkPaint : look.dotPaint));
  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "clock face: GL present failed");
}

/**
 * What a press at u (0..1 across the cycle) grabs, by the Pulse Width band's
 * rule on the face axis, where the gate wraps with Phase: inside the gate and
 * clear of its ends moves both ("span"), otherwise the nearer end ("lo" =
 * Pulse Start, "hi" = Pulse End). edge is the end grab width, 0..1.
 */
function nodeGraphClockFaceGrabMode(u, gateStart, gateEnd, edge) {
  const inside = gateEnd >= gateStart
    ? u > gateStart + edge && u < gateEnd - edge
    : u > gateStart + edge || u < gateEnd - edge;
  if (inside) return "span";
  return Math.abs(u - gateStart) <= Math.abs(u - gateEnd) ? "lo" : "hi";
}

/**
 * Drag on the face edits Pulse Start / Pulse End through their own sliders,
 * exactly as the Pulse Width band does: an end of the gate moves that end, the
 * inside moves both (each end clamps on its own), right or up raises, the
 * shared fine/coarse modifiers scale the drag, Ctrl/Cmd+click resets both.
 * Limits come from the param definitions; the gate is redrawn from the params.
 */
function nodeGraphClockFaceInstallGateDrag(section) {
  section.style.touchAction = "none";
  section.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const article = section.closest(".dsp-node");
    const lo = nodeGraphModuleFaceInput(article, "pulseStart");
    const hi = nodeGraphModuleFaceInput(article, "pulseEnd");
    const node = nodeGraphPatchNode(section.dataset.node || "");
    if (!lo || !hi || !node) return;
    event.preventDefault();
    event.stopPropagation();
    // The gate where the face draws it (see drawNodeGraphClockFace).
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const wrapPhase = (v) => v - Math.floor(v);
    const startPhase = wrapPhase(nodeGraphClockFaceParam(node, "phase", 0));
    const pulseStart = clamp01(nodeGraphClockFaceParam(node, "pulseStart", 0));
    const pulseEnd = clamp01(nodeGraphClockFaceParam(node, "pulseEnd", 0.5));
    const endless = nodeGraphClockFaceGateEndless(pulseStart, pulseEnd);
    const gateStart = endless ? 0 : wrapPhase(pulseStart - startPhase);
    let gateEnd = endless ? 1 : wrapPhase(pulseEnd - startPhase);
    if (!endless && gateEnd === 0 && gateStart > 0) gateEnd = 1;
    const look = nodeGraphClockFaceSettingsForNode(node);
    const p = nodeGraphModuleFaceLocalPoint(section, event);
    const g = nodeGraphClockFaceGeometry(section.offsetWidth, section.offsetHeight, 0, 1, look.lineThickness, look.gateHeight);
    const span = Math.max(1, g.x1 - g.x0);
    const mode = nodeGraphClockFaceGrabMode((p.x - g.x0) / span, gateStart, gateEnd, NODE_GRAPH_FACE_BAND_HANDLE_PX / span);
    const tl = nodeGraphModuleFaceTravel(lo);
    const th = nodeGraphModuleFaceTravel(hi);
    const set = (input, t, drag) => setNodeGraphModuleFaceValue(input, nodeSliderValueFromTravel(input, t), drag);
    const resetOnClick = nodeGraphNumericResetClickModifier(event);
    const captureOpts = resetOnClick
      ? { resetOnClick: true, onReset: () => nodeGraphModuleFaceResetWidget(article, { type: "band", lo: "pulseStart", hi: "pulseEnd" }) }
      : {};
    let lx = event.clientX;
    let ly = event.clientY;
    let ax = 0;
    let ay = 0;
    nodeGraphModuleFaceCapture(section, event, (ev, drag) => {
      const k = nodeGraphNumericDragMultiplier(ev);
      ax += (ev.clientX - lx) * p.sx * k;
      ay += (ev.clientY - ly) * p.sy * k;
      lx = ev.clientX;
      ly = ev.clientY;
      const du = (ax - ay) / span;
      if (mode !== "hi") set(lo, clamp01(tl + du), drag);
      if (mode !== "lo") set(hi, clamp01(th + du), drag);
      section._clockForceDraw = true;
    }, captureOpts);
  });
}

function createNodeGraphClockFace(nodeId, type = "clock") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-clock-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "clock");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-clock-canvas"));
  nodeGraphClockFaceInstallGateDrag(section);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `clock:${el.dataset?.node || ""}`,
    forceKey: "_clockForceDraw",
    rafKey: "_clockRaf",
    paint: drawNodeGraphClockFace,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphClockFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.clockFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("clockFace", createNodeGraphClockFace);
}
