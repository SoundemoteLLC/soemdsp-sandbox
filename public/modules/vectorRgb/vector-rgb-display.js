// Vector RGB — 2D vectorscope. Color from R/G/B streams; X/Y aim the beam.
// Paint: DestFade (Residual hang) + delta capture + batched WebGL RGB points.
// No full-history polyline restroke. Canvas2d arcs only if WebGL is unavailable.

const nodeGraphVectorRgbSettingsDefaults = Object.freeze({
  background: "#000000",
  dot1Brightness: 1,
  dot1Size: 0.08,
  dotBudget: 2048,
  // The Trace settings (Vector RGB takes its colours from the R / G / B streams, so there is no gradient).
  decayBlur: 0,
  buildUp: true,
  drawMode: "budget",
  rotate90: false,
  skipDiscontinuities: false,
  // Mid Ghost ≈ DestFade erase 0.008 (sweet hang); see PhosphorResidual.destFadeAmount.
  ghost: 0.35,
  pixelDensity: 1,
  scale: 1,
  trail: 0.86,
});

function normalizeNodeGraphVectorRgbSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = nodeGraphVectorRgbSettingsDefaults;
  // Number("") is 0 (finite) — treat blank as missing so empty form apply
  // cannot zero Bright/Size/Ghost/Trail/Scale on open.
  const num = (key, fallback) => {
    const raw = source[key];
    if (raw === "" || raw == null) {
      return fallback;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const background = typeof normalizeNodeGraphTraceDisplayColor === "function"
    ? normalizeNodeGraphTraceDisplayColor(source.background ?? source.backgroundColor, d.background)
    : String(source.background || d.background);
  const Residual = typeof PhosphorResidual !== "undefined" ? PhosphorResidual : null;
  const trail = Residual?.migrateTrail
    ? Residual.migrateTrail(source, d.trail)
    : Math.max(0, Math.min(1, num("trail", d.trail)));
  const ghost = Residual?.migrateGhost
    ? Residual.migrateGhost(source, d.ghost)
    : Math.max(0, Math.min(1, num("ghost", d.ghost)));
  const flag = (key, fallback) => {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    return raw === true || raw === 1 || raw === "true" || raw === "1";
  };
  const mode = String(source.drawMode || d.drawMode);
  return {
    background,
    dot1Brightness: Math.max(0, Math.min(1, num("dot1Brightness", d.dot1Brightness))),
    dot1Size: Math.max(0, Math.min(1, num("dot1Size", d.dot1Size))),
    dotBudget: Math.max(1, Math.min(8192, Math.round(num("dotBudget", d.dotBudget)))),
    decayBlur: Math.max(0, Math.min(1, num("decayBlur", d.decayBlur))),
    buildUp: flag("buildUp", d.buildUp),
    drawMode: mode === "length" || mode === "dots" || mode === "lines" ? mode : "budget",
    rotate90: flag("rotate90", d.rotate90),
    skipDiscontinuities: flag("skipDiscontinuities", d.skipDiscontinuities),
    ghost,
    pixelDensity: Math.max(0, Math.min(1, num("pixelDensity", d.pixelDensity))),
    scale: Math.max(0.05, Math.min(8, num("scale", d.scale))),
    trail,
  };
}

function nodeGraphVectorRgbSettingsForNode(node) {
  return normalizeNodeGraphVectorRgbSettings(node?.traceDisplaySettings);
}

function nodeGraphRgbPickPortBuffer(slot, port) {
  const ports = port === "Bright" ? ["Bright", "Blank"] : [port];
  let local = null;
  let connected = null;
  for (let i = 0; i < ports.length; i += 1) {
    const p = ports[i];
    if (!local && typeof nodeGraphModuleScopeState === "object") {
      local = nodeGraphModuleScopeState.buffers.get(`${slot.nodeId}:${p}`) || null;
    }
    if (!connected && typeof nodeGraphModuleScopeConnectedSourceBuffer === "function") {
      connected = nodeGraphModuleScopeConnectedSourceBuffer(slot.nodeId, p) || null;
    }
    if (!connected) {
      const id = slot.nodeId;
      const conns = (typeof nodeGraphMvp !== "undefined" && Array.isArray(nodeGraphMvp?.patch?.connections))
        ? nodeGraphMvp.patch.connections
        : [];
      for (let c = 0; c < conns.length; c += 1) {
        const dest = conns[c]?.destinationNode;
        const destPort = conns[c]?.destinationPort;
        const canon = typeof nodeGraphCanonicalInputPort === "function"
          ? nodeGraphCanonicalInputPort("vectorRgb", destPort)
          : destPort;
        if (dest !== id || (canon !== p && destPort !== p)) continue;
        connected = nodeGraphModuleScopeState?.buffers?.get(
          `${conns[c].sourceNode}:${conns[c].sourcePort}`,
        ) || nodeGraphModuleScopeState?.buffers?.get(conns[c].sourceNode) || null;
        if (connected) break;
      }
    }
  }
  if (typeof nodeGraphScope2dPickRicherBuffer === "function") {
    return nodeGraphScope2dPickRicherBuffer(local, connected);
  }
  return connected || local || null;
}

function nodeGraphRgbAlignedCapture(slot, ports, historySeconds) {
  const rings = ports.map((port) => nodeGraphRgbPickPortBuffer(slot, port));
  const lengths = rings.map((ring) => (ring?.length ? ring.length : 0));
  const present = lengths.filter((n) => n > 0);
  const available = present.length ? Math.min(...present) : 0;
  if (!(available > 0)) {
    return null;
  }
  const sampleRate = Math.max(
    1,
    nodeGraphFiniteNumber(nodeGraphModuleScopeState?.sampleRate, nodeGraphFiniteNumber(nodeGraphMvp?.sampleRate, 44100)),
  );
  const want = Number.isFinite(historySeconds)
    ? Math.min(available, Math.max(1, Math.ceil(Math.max(0, historySeconds) * sampleRate)))
    : available;
  // Cap catch-up after tab sleep — residual is the trail, not a history restroke.
  const maxCatch = Math.min(available, Math.ceil(sampleRate * 0.25));
  const frames = Math.min(available, want, maxCatch);
  const out = { length: frames };
  for (let p = 0; p < ports.length; p += 1) {
    const ring = rings[p];
    const channel = new Float32Array(frames);
    if (ring?.length) {
      const start = ring.length - frames;
      for (let i = 0; i < frames; i += 1) {
        channel[i] = nodeGraphFiniteNumber(ring[start + i]);
      }
    }
    out[ports[p]] = channel;
  }
  return out;
}

function nodeGraphVectorRgbUnitToPx(value, origin, span, scale) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return origin + (0.5 + 0.5 * n * scale) * span;
}

function nodeGraphVectorRgbAnalog01(value) {
  if (typeof nodeGraphRasterRgbAsVideo01 === "function") {
    return nodeGraphRasterRgbAsVideo01(value);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0 || n > 1) return Math.max(0, Math.min(1, 0.5 + 0.5 * n));
  return Math.max(0, Math.min(1, n));
}

function nodeGraphVectorRgbNodePoweredOff(nodeId) {
  const id = String(nodeId || "");
  if (!id) return false;
  if (typeof scopePaintIsFacePoweredOff === "function") {
    return scopePaintIsFacePoweredOff(id);
  }
  if (typeof nodeGraphNodeDisplaysBypassed === "function") {
    return nodeGraphNodeDisplaysBypassed(id);
  }
  if (typeof nodeGraphNodeIsBypassed === "function") {
    return nodeGraphNodeIsBypassed(id);
  }
  const listed = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.patch?.bypassedNodes : null;
  return Array.isArray(listed) && listed.includes(id);
}

function nodeGraphVectorRgbEngineStopped() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  return !live?.node;
}

function nodeGraphVectorRgbBrightWired(nodeId) {
  const id = String(nodeId || "");
  const conns = (typeof nodeGraphMvp !== "undefined" && Array.isArray(nodeGraphMvp?.patch?.connections))
    ? nodeGraphMvp.patch.connections
    : [];
  for (let i = 0; i < conns.length; i += 1) {
    if (conns[i]?.destinationNode !== id) continue;
    const port = conns[i].destinationPort;
    const canon = typeof nodeGraphCanonicalInputPort === "function"
      ? nodeGraphCanonicalInputPort("vectorRgb", port)
      : port;
    if (canon === "Bright" || port === "Bright" || port === "Blank" || port === "Blk") {
      return true;
    }
  }
  return false;
}

function nodeGraphVectorRgbClearPlate(canvas, ctx, bg) {
  if (!canvas) return;
  canvas._vectorRgbPrimed = false;
  canvas._vectorRgbAbs = 0;
  const trails = typeof TraceRgbTrailsGl !== "undefined" ? TraceRgbTrailsGl : null;
  if (trails && typeof trails.clear === "function") {
    trails.clear(canvas, bg);
  }
  if (ctx) {
    nodeGraphFacePlateFillCanvas(null, canvas, bg);
  }
}

function wipeNodeGraphVectorRgbScreensToColdBoot(options = {}) {
  const onlyId = String(options.nodeId || "").trim();
  const seen = new Set();
  const visit = (canvas, nodeId) => {
    if (!canvas || seen.has(canvas)) return;
    if (onlyId && String(nodeId || "") !== onlyId) return;
    seen.add(canvas);
    const ctx = typeof nodeGraphSharedGlPresentTarget === "function" ? nodeGraphSharedGlPresentTarget(canvas) : null;
    const settings = nodeGraphVectorRgbSettingsForNode(
      typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null,
    );
    nodeGraphVectorRgbClearPlate(canvas, ctx, settings.background);
  };
  if (options.canvas) {
    const host = options.canvas.closest?.("[data-node]");
    visit(options.canvas, host?.dataset?.node || onlyId);
    if (onlyId) return;
  }
  if (typeof document !== "undefined") {
    const hosts = document.querySelectorAll("[data-node-type=\"vectorRgb\"]");
    for (const host of hosts) {
      const nodeId = host.dataset?.node || "";
      const canvas = host.querySelector?.(":scope .node-module-scope-local-fallback-canvas")
        || host.querySelector?.(".node-display-face");
      visit(canvas, nodeId);
    }
  }
  if (typeof nodeGraphModuleScopePersistentCanvases !== "undefined"
    && nodeGraphModuleScopePersistentCanvases?.forEach) {
    nodeGraphModuleScopePersistentCanvases.forEach((canvas, nodeId) => {
      const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
      if (node?.type === "vectorRgb") visit(canvas, nodeId);
    });
  }
}

function drawNodeGraphVectorRgbFaceItem(_renderer, item, pixelRatio) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) {
    return;
  }
  const canvas = typeof nodeGraphModuleScopeLocalFallbackCanvas === "function"
    ? nodeGraphModuleScopeLocalFallbackCanvas(slot)
    : null;
  if (!canvas || typeof syncNodeGraphModuleScopeLocalFallbackCanvas !== "function") {
    return;
  }
  const settings = nodeGraphVectorRgbSettingsForNode(nodeGraphModuleScopeNodeForSlot?.(slot));
  const density = typeof nodeGraphFacePlateDensity === "function"
    ? nodeGraphFacePlateDensity(settings, 1)
    : 1;
  if (!syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, face, pixelRatio, density)) {
    return;
  }
  // Density < 1: nearest-neighbour via the shared display-canvas class (styles.css).
  canvas.classList?.toggle?.("display-canvas-pixelated", density < 0.999);
  // 2D present surface for the shared-GL trails blit (display-canvas.js); no 2D drawing here.
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function" ? nodeGraphSharedGlPresentTarget(canvas) : null;
  if (!ctx) {
    return;
  }
  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function"
    && nodeGraphModuleScopePhosphorFrozen();
  const bg = settings.background;
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(face, bg);
  }
  const sizeKey = `${canvas.width}x${canvas.height}`;
  if (canvas._vectorRgbSizeKey !== sizeKey) {
    canvas._vectorRgbSizeKey = sizeKey;
    canvas._vectorRgbPrimed = false;
    canvas._vectorRgbAbs = 0;
    canvas._vectorRgbPacked = null;
  }
  if (!canvas._vectorRgbPrimed) {
    nodeGraphVectorRgbClearPlate(canvas, ctx, bg);
    canvas._vectorRgbPrimed = true;
  }
  if (nodeGraphVectorRgbNodePoweredOff(slot.nodeId) || nodeGraphVectorRgbEngineStopped()) {
    nodeGraphVectorRgbClearPlate(canvas, ctx, bg);
    return;
  }
  if (frozen) {
    return;
  }

  // RGB trails GL on the shared picture device (no Canvas2D fallback: no GL ->
  // plain black square, docs/WEBGL_DISPLAY_PLAN.md).
  const trails = typeof TraceRgbTrailsGl !== "undefined" ? TraceRgbTrailsGl : null;
  const useTrails = Boolean(
    trails
    && typeof trails.ensure === "function"
    && trails.ensure(canvas, canvas.width, canvas.height)
  );
  if (!useTrails) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    canvas._vectorRgbPrimed = false;
    return;
  }
  // Decay blur 0 (the default) is the plain fade; above 0 the stored picture also diffuses a little every frame (0..0.25 per frame).
  trails.stepFade(canvas, settings.trail, settings.ghost, bg, settings.decayBlur * 0.25);

  try {
    const source = nodeGraphRgbPickPortBuffer(slot, "X");
    const sampleRate = Math.max(
      1,
      nodeGraphFiniteNumber(
        source?.nodeGraphScopeSampleRate,
        nodeGraphFiniteNumber(
          nodeGraphModuleScopeState?.sampleRate,
          nodeGraphFiniteNumber(nodeGraphMvp?.sampleRate, 44100),
        ),
      ),
    );
    const abs = Math.max(0, Math.floor(nodeGraphFiniteNumber(source?.nodeGraphScopeTotalSampleCount)));
    const prev = Number(canvas._vectorRgbAbs || 0);
    const deltaSec = prev > 0 && abs > prev ? (abs - prev) / sampleRate : 0;
    const catchUp = prev > 0
      ? Math.min(0.25, Math.max(0.004, deltaSec))
      : 0.05;
    const captured = nodeGraphRgbAlignedCapture(
      slot,
      ["X", "Y", "R", "G", "B", "Bright"],
      catchUp,
    );
    if (abs) {
      canvas._vectorRgbAbs = abs;
    }
    if (!captured?.length) {
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const side = Math.min(w, h);
    const ox = (w - side) * 0.5;
    const oy = (h - side) * 0.5;
    const scale = settings.scale;
    const gain = settings.dot1Brightness;
    // Size is the same mapping as Trace: authored px (dotUnitInkPx) -> px on this face (faceInkPx), not a share of the side.
    const sizePx = typeof dotUnitInkPx === "function" ? dotUnitInkPx(settings.dot1Size) : settings.dot1Size * 96;
    const diameter = typeof faceInkPx === "function" ? faceInkPx(sizePx, side) : side * settings.dot1Size;
    const radius = Math.max(0.5, diameter * 0.5);
    // Draw: dots = the samples only; lines = connect each sample to the next; budget / length = a light fill (the old default).
    const segs = settings.drawMode === "dots" ? 0 : (settings.drawMode === "lines" ? 6 : 1);
    const skipJump = side * 0.35;
    const budget = Math.max(1, Math.min(8192, Math.round(nodeGraphFiniteNumber(settings.dotBudget, 2048))));
    const connectionsTo = typeof nodeGraphModuleScopeConnectionsTo === "function"
      ? nodeGraphModuleScopeConnectionsTo
      : () => [];
    const brightWired = nodeGraphVectorRgbBrightWired(slot.nodeId);
    const rgbWired = ["R", "G", "B"].some((port) => connectionsTo(slot.nodeId, port).length > 0);

    const floatsPer = typeof TraceRgbPoints !== "undefined" ? TraceRgbPoints.FLOATS : 5;
    const nCap = captured.length;
    const stride = nCap > budget ? nCap / budget : 1;
    const maxStamps = Math.min(8192, Math.ceil(nCap / stride) * (segs + 1) + 2);
    let packed = canvas._vectorRgbPacked;
    const need = maxStamps * floatsPer;
    if (!(packed instanceof Float32Array) || packed.length < need) {
      packed = new Float32Array(Math.max(need, 4096 * floatsPer));
      canvas._vectorRgbPacked = packed;
    }
    let count = 0;
    let prevX = NaN;
    let prevY = NaN;
    let prevR = 0;
    let prevG = 0;
    let prevB = 0;
    const pushStamp = (x, y, r, g, b) => {
      if (count >= maxStamps) return;
      const o = count * floatsPer;
      packed[o] = x;
      packed[o + 1] = y;
      packed[o + 2] = r;
      packed[o + 3] = g;
      packed[o + 4] = b;
      count += 1;
    };
    const pickCount = stride <= 1 ? nCap : Math.min(budget, nCap);
    const pickStep = pickCount <= 1 ? 1 : (nCap - 1) / Math.max(1, pickCount - 1);
    for (let p = 0; p < pickCount && count < budget; p += 1) {
      const i = stride <= 1 ? p : Math.min(nCap - 1, Math.round(p * pickStep));
      let sx = captured.X[i];
      let sy = captured.Y[i];
      if (settings.rotate90) {
        const rot = typeof nodeGraphGradientVectorscopeRotate === "function"
          ? nodeGraphGradientVectorscopeRotate(sx, sy, true)
          : { x: (sx - sy) * Math.SQRT1_2, y: (sx + sy) * Math.SQRT1_2 };
        sx = rot.x;
        sy = rot.y;
      }
      const x = nodeGraphVectorRgbUnitToPx(sx, ox, side, scale);
      const y = nodeGraphVectorRgbUnitToPx(-sy, oy, side, scale);
      if (x == null || y == null) {
        continue;
      }
      const bright = brightWired
        ? nodeGraphVectorRgbAnalog01(captured.Bright?.[i] ?? captured.Blank?.[i])
        : 1;
      const ink = gain * bright;
      const r = (rgbWired ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(captured.R[i]))) : 1) * ink;
      const g = (rgbWired ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(captured.G[i]))) : 1) * ink;
      const b = (rgbWired ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(captured.B[i]))) : 1) * ink;
      if (r + g + b <= 1e-6) {
        prevX = NaN;
        continue;
      }
      // Skip Discontinuity: no line across a big jump (a wrap or a cut), the same idea as Trace.
      const jumped = settings.skipDiscontinuities && Number.isFinite(prevX) && Number.isFinite(prevY)
        && Math.hypot(x - prevX, y - prevY) > skipJump;
      if (segs > 0 && !jumped && Number.isFinite(prevX) && Number.isFinite(prevY)) {
        for (let s = 1; s <= segs && count < budget; s += 1) {
          const t = s / (segs + 1);
          pushStamp(
            prevX + (x - prevX) * t,
            prevY + (y - prevY) * t,
            prevR + (r - prevR) * t,
            prevG + (g - prevG) * t,
            prevB + (b - prevB) * t,
          );
        }
      }
      pushStamp(x, y, r, g, b);
      prevX = x;
      prevY = y;
      prevR = r;
      prevG = g;
      prevB = b;
    }
    if (count > 0 && typeof trails.stampPoints === "function") {
      // Build up off: a pixel never gets brighter than one stamp (MAX blend), like Trace.
      trails.stampPoints(canvas, packed, count, radius * 2, { max: settings.buildUp === false });
    }
  } finally {
    if (typeof trails.presentTo === "function") {
      trails.presentTo(canvas, ctx, bg);
    }
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.vectorRgbFace = drawNodeGraphVectorRgbFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("vectorRgbFace", (canvas, _bg, options) => {
    wipeNodeGraphVectorRgbScreensToColdBoot({
      canvas: canvas || options?.canvas,
      nodeId: options?.nodeId,
      all: options?.all,
    });
  });
  nodeGraphModuleScopeRegisterFaceWipe("gradientVectorscopeFace", (canvas, bg) => {
    if (!canvas) return;
    const ctx = typeof nodeGraphSharedGlPresentTarget === "function" ? nodeGraphSharedGlPresentTarget(canvas) : null;
    nodeGraphVectorRgbClearPlate(canvas, ctx, bg);
  });
}
if (typeof globalThis !== "undefined") {
  globalThis.wipeNodeGraphVectorRgbScreensToColdBoot = wipeNodeGraphVectorRgbScreensToColdBoot;
}
