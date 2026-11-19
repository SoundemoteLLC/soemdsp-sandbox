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
    dot1Brightness: Math.max(0, Math.min(4, num("dot1Brightness", d.dot1Brightness))),
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

// Level of a stream (R, G, B, Bright) as a drive amount: 0..1 as-is, a bipolar -1..0 maps through 0.5 + 0.5x, and ABOVE 1 it is an
// overdrive (10 = ten times full), so a signal can push past the Brightness slider's ceiling.
function nodeGraphVectorRgbDrive(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 1) return n;
  return nodeGraphVectorRgbAnalog01(value);
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
  canvas._vectorRgbLast = null;
  canvas._vectorRgbAcc = 0;
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
    // Draw: dots = the samples only; budget / length / lines = connected by an even-spaced fill along the path.
    const skipJump = side * 0.35;
    const budget = Math.max(1, Math.min(8192, Math.round(nodeGraphFiniteNumber(settings.dotBudget, 2048))));
    const connectionsTo = typeof nodeGraphModuleScopeConnectionsTo === "function"
      ? nodeGraphModuleScopeConnectionsTo
      : () => [];
    const brightWired = nodeGraphVectorRgbBrightWired(slot.nodeId);
    const rgbWired = ["R", "G", "B"].some((port) => connectionsTo(slot.nodeId, port).length > 0);

    const floatsPer = typeof TraceRgbPoints !== "undefined" ? TraceRgbPoints.FLOATS : 5;
    const nCap = captured.length;
    // Pass 1: every sample to a pixel position and a colour. Colour is the analog 0..1 of each stream (a bipolar -1..1 signal
    // maps through 0.5 + 0.5x, the same as Bright), so a channel can sit at any level, not only fully on or off.
    const pts = new Float32Array((nCap + 1) * 6);
    let np = 0;
    const last = canvas._vectorRgbLast || null;
    if (last) {
      pts.set([last.x, last.y, last.r, last.g, last.b, 1], 0);
      np = 1;
    }
    const chan = (arr, i) => (rgbWired ? nodeGraphVectorRgbDrive(arr?.[i]) : 1);
    for (let i = 0; i < nCap; i += 1) {
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
      const bright = brightWired ? nodeGraphVectorRgbDrive(captured.Bright?.[i] ?? captured.Blank?.[i]) : 1;
      const ink = gain * bright;
      const o = np * 6;
      if (x == null || y == null) {
        pts[o + 5] = 0; // no position: the line breaks here
      } else {
        pts[o] = x;
        pts[o + 1] = y;
        pts[o + 2] = chan(captured.R, i) * ink;
        pts[o + 3] = chan(captured.G, i) * ink;
        pts[o + 4] = chan(captured.B, i) * ink;
        pts[o + 5] = pts[o + 2] + pts[o + 3] + pts[o + 4] > 1e-6 ? 1 : 0; // black = pen up
      }
      np += 1;
    }
    const joined = (a, b) => {
      if (!pts[a * 6 + 5] || !pts[b * 6 + 5]) return false;
      if (!settings.skipDiscontinuities) return true;
      return Math.hypot(pts[b * 6] - pts[a * 6], pts[b * 6 + 1] - pts[a * 6 + 1]) <= skipJump;
    };

    // Pass 2: stamps. Lines / budget / length: the stamps are spaced by ARC LENGTH along the path, so the line is unbroken at
    // any speed and as bright at a fast part as a slow one; the dot budget only widens the spacing when the path is too long
    // for it. Dots: just the samples, thinned to the budget.
    // Dots: the budget is the number of dots. Lines: the budget is per 1/8 of the cap, so a fast path still gets stamped close
    // enough to read as a line (the spacing only widens past 8x the budget).
    const stampCap = settings.drawMode === "dots" ? budget : Math.min(65536, budget * 8);
    const maxStamps = stampCap + 16;
    let packed = canvas._vectorRgbPacked;
    const need = maxStamps * floatsPer;
    if (!(packed instanceof Float32Array) || packed.length < need) {
      packed = new Float32Array(Math.max(need, 4096 * floatsPer));
      canvas._vectorRgbPacked = packed;
    }
    let count = 0;
    const pushStamp = (x, y, r, g, b, w) => {
      if (count >= maxStamps) return;
      const o = count * floatsPer;
      packed[o] = x;
      packed[o + 1] = y;
      packed[o + 2] = r * w;
      packed[o + 3] = g * w;
      packed[o + 4] = b * w;
      count += 1;
    };
    if (settings.drawMode === "dots") {
      const step = np > budget ? np / budget : 1;
      for (let f = 0; f < np && count < budget; f += step) {
        const i = Math.floor(f);
        if (!pts[i * 6 + 5]) continue;
        pushStamp(pts[i * 6], pts[i * 6 + 1], pts[i * 6 + 2], pts[i * 6 + 3], pts[i * 6 + 4], 1);
      }
    } else {
      let pathLen = 0;
      for (let i = 1; i < np; i += 1) {
        if (joined(i - 1, i)) pathLen += Math.hypot(pts[i * 6] - pts[(i - 1) * 6], pts[i * 6 + 1] - pts[(i - 1) * 6 + 1]);
      }
      // Close enough that the stamps blend into one smooth line (a gaussian dot every 0.25 radius ripples by about 3%).
      const spacing = Math.max(radius * 0.25, pathLen / stampCap, 0.2);
      // Build up off takes the brightest stamp (MAX), so a stamp must carry the full level: scaling it down by the spacing would cap
      // the line below what you dialled. Build up on adds the stamps, so there each is scaled to keep the sum at the level.
      const weight = settings.buildUp === false ? 1 : Math.min(1, spacing / (radius * 1.2));
      let acc = canvas._vectorRgbAcc || 0;
      for (let i = 1; i < np; i += 1) {
        const a = (i - 1) * 6;
        const b = i * 6;
        if (!joined(i - 1, i)) {
          acc = 0;
          if (pts[b + 5] && i > 1) pushStamp(pts[b], pts[b + 1], pts[b + 2], pts[b + 3], pts[b + 4], weight);
          continue;
        }
        const dx = pts[b] - pts[a];
        const dy = pts[b + 1] - pts[a + 1];
        const d = Math.hypot(dx, dy);
        let pos = spacing - acc; // distance along this segment of the next stamp
        while (pos <= d) {
          const t = d > 0 ? pos / d : 1;
          pushStamp(
            pts[a] + dx * t, pts[a + 1] + dy * t,
            pts[a + 2] + (pts[b + 2] - pts[a + 2]) * t,
            pts[a + 3] + (pts[b + 3] - pts[a + 3]) * t,
            pts[a + 4] + (pts[b + 4] - pts[a + 4]) * t,
            weight,
          );
          pos += spacing;
        }
        acc = spacing - (pos - d);
      }
      canvas._vectorRgbAcc = acc;
      // Standing still: nothing travelled, so keep the point lit.
      if (count === 0 && np > 0 && pts[(np - 1) * 6 + 5]) {
        const o = (np - 1) * 6;
        pushStamp(pts[o], pts[o + 1], pts[o + 2], pts[o + 3], pts[o + 4], weight);
      }
    }
    if (np > 0) {
      const o = (np - 1) * 6;
      canvas._vectorRgbLast = pts[o + 5] ? { x: pts[o], y: pts[o + 1], r: pts[o + 2], g: pts[o + 3], b: pts[o + 4] } : null;
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
