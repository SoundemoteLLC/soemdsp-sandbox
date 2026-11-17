// Dark Velvet Reverb face: where the taps land, so density over time is visible.
// One stem per Left tap at its delay (time axis 0 .. the tail length), height =
// the tap level in dB from 0 (top) to -60 dB (the axis): the Decay fade reaches
// the axis at the end of the tail. A pulse wider than the line draws as wide as
// it is. Text: the tap count ("62 taps"; "4096 taps max" when Density x Decay
// passes the engine's table size and the taps spread out) and the tail length
// ("0.30 s"; "5.46 s max" when the delay line holds a longer Decay). A limit
// also draws a mark: bold time axis = tap table full; bar at the right end =
// length held by the delay line.
// The layout comes from velvet_reverb.wasm (soemdsp_velvet_reverb_layout: the
// same build_table the audio uses) and is rebuilt only when a setting changes.
// Look: the Pulse Train face settings (Background, Line, Dot, Line thickness, Dot size).
// GPU only (gl-line-renderer).

const nodeGraphVelvetTapsWasm = { promise: null, exports: null, failed: false };

function nodeGraphVelvetTapsLoad() {
  if (nodeGraphVelvetTapsWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphVelvetTapsWasm.promise;
  }
  nodeGraphVelvetTapsWasm.promise = fetch("/native_modules/velvet_reverb/velvet_reverb.wasm?v=dvel-taps-2")
    .then((response) => {
      if (!response.ok) throw new Error(`velvet_reverb wasm HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((bytes) => WebAssembly.compile(bytes))
    .then((mod) => {
      // Layout needs no host functions; stub whatever the module imports.
      const imports = {};
      for (const i of WebAssembly.Module.imports(mod)) {
        imports[i.module] ??= {};
        imports[i.module][i.name] = i.kind === "function" ? () => 0 : undefined;
      }
      return WebAssembly.instantiate(mod, imports);
    })
    .then((instance) => {
      nodeGraphVelvetTapsWasm.exports = instance.exports;
      document.querySelectorAll?.(".node-velvet-taps-display").forEach((el) => {
        el._velvetTapsForceDraw = true;
        el._velvetTapsKey = "";
        drawNodeGraphVelvetTapsDisplay(el);
      });
    })
    .catch(() => {
      nodeGraphVelvetTapsWasm.failed = true;
    });
  return nodeGraphVelvetTapsWasm.promise;
}

function nodeGraphVelvetTapsParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/** { count, pos, width, level, length, flags } for the node's settings; cached per section. */
function nodeGraphVelvetTapsLayout(section, node) {
  const x = nodeGraphVelvetTapsWasm.exports;
  if (!x) {
    nodeGraphVelvetTapsLoad();
    return null;
  }
  const sr = Number(nodeGraphMvp?.live?.context?.sampleRate) || 48000;
  const args = [
    nodeGraphVelvetTapsParam(node, "density", 2500),
    nodeGraphVelvetTapsParam(node, "darkness", 1),
    nodeGraphVelvetTapsParam(node, "stereoSpread", 1),
    sr,
    nodeGraphVelvetTapsParam(node, "decay", 0.025),
    nodeGraphVelvetTapsParam(node, "tailDarkness", 0),
    nodeGraphVelvetTapsParam(node, "seed", 1),
  ];
  const key = args.join(",");
  if (section._velvetTapsKey === key && section._velvetTapsLayout) return section._velvetTapsLayout;
  const count = x.soemdsp_velvet_reverb_layout(...args) | 0;
  const buf = x.memory.buffer;
  const read = (ptr) => new Float64Array(buf, ptr, count).slice();
  const layout = {
    count,
    pos: read(x.soemdsp_velvet_reverb_layout_pos()),
    width: read(x.soemdsp_velvet_reverb_layout_width()),
    level: read(x.soemdsp_velvet_reverb_layout_level()),
    length: x.soemdsp_velvet_reverb_layout_length(),
    flags: x.soemdsp_velvet_reverb_layout_flags() | 0,
    paused: !(args[0] > 0),
  };
  section._velvetTapsKey = key;
  section._velvetTapsLayout = layout;
  return layout;
}

function nodeGraphVelvetTapsSeconds(s) {
  if (!(s > 0)) return "0 s";
  if (s < 0.01) return `${(s * 1000).toFixed(2)} ms`;
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`;
  return `${s.toFixed(2)} s`;
}

function drawNodeGraphVelvetTapsDisplay(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.(".node-display-face");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const look = typeof nodeGraphPulseTrainFaceSettingsForNode === "function"
    ? nodeGraphPulseTrainFaceSettingsForNode(node)
    : { backgroundPaint: "#000", strokePaint: "#fff", dotPaint: "#fff", lineThickness: 1.5, dotThickness: 3 };
  const rgba = (css) => nodeGraphGlGraphParseCssColor(css, [1, 1, 1, 1]);
  const batch = nodeGraphGlLinesBegin(canvas, rgba(look.backgroundPaint), { scale: pixelRatio });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "velvet taps face: no shared GL device");
    return;
  }
  const smoothing = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(look, 1)
    : Math.max(0, Number(look.lineSmoothing) || 1);
  const halfPx = Math.max(0, Number(look.lineThickness) || 0) * 0.5;
  const dotR = Math.max(0, Number(look.dotThickness) || 0) * 0.5;
  const line = rgba(look.strokePaint);
  const dot = rgba(look.dotPaint);
  const dim = (c, a) => [c[0], c[1], c[2], c[3] * a];

  // Text row on top: tap count left, tail length right. Both fit the face (px shrinks to fit).
  const layout = nodeGraphVelvetTapsLayout(section, node);
  const textPx = Math.max(8, Math.min(13, h * 0.13));
  const pad = Math.max(4, w * 0.03);
  if (layout) {
    const countText = layout.paused
      ? "paused"
      : `${layout.count} ${layout.count === 1 ? "tap" : "taps"}${layout.flags & 1 ? " max" : ""}`;
    const lenText = layout.paused ? "" : `${nodeGraphVelvetTapsSeconds(layout.length)}${layout.flags & 2 ? " max" : ""}`;
    const measure = (t, px) => (typeof nodeGraphGlLinesMeasureText === "function" ? nodeGraphGlLinesMeasureText(t, px) : t.length * px * 0.6);
    let px = textPx;
    const avail = Math.max(1, w - 2 * pad);
    const need = measure(countText, px) + (lenText ? measure(lenText, px) + px : 0);
    if (need > avail) px = Math.max(4, px * avail / need);
    const ty = pad * 0.5 + px * 0.5 + 1;
    nodeGraphGlLinesText(batch, countText, pad, ty, { px, align: "left", baseline: "middle", rgba: dot });
    if (lenText) nodeGraphGlLinesText(batch, lenText, w - pad, ty, { px, align: "right", baseline: "middle", rgba: dim(dot, 0.75) });
  }

  const top = pad * 0.5 + textPx + 4 + dotR;
  const base = h - Math.max(4, h * 0.07);
  const x0 = pad + dotR;
  const x1 = Math.max(x0 + 1, w - pad - dotR);
  // A physical limit also shows as a mark, not only as "max" in the text:
  // the tap table is full -> the time axis draws bold; the delay line holds the
  // length -> a full-height bar at the tail end.
  const tapLimit = Boolean(layout && !layout.paused && (layout.flags & 1));
  const lengthLimit = Boolean(layout && !layout.paused && (layout.flags & 2));
  nodeGraphGlLinesSegment(batch, x0, base, x1, base, tapLimit ? Math.max(1.5, halfPx * 1.5) : Math.max(0.5, halfPx * 0.5), smoothing, tapLimit ? dot : dim(line, 0.6));
  nodeGraphGlLinesSegment(batch, x0, base - 3, x0, base + 3, 0.5, smoothing, dim(line, 0.6));
  if (lengthLimit) nodeGraphGlLinesSegment(batch, x1, top - dotR, x1, base + 3, Math.max(1, halfPx), smoothing, dot);
  else nodeGraphGlLinesSegment(batch, x1, base - 3, x1, base + 3, 0.5, smoothing, dim(line, 0.6));

  if (layout && layout.count > 0 && layout.length > 0) {
    let peak = 0;
    for (let i = 0; i < layout.count; i += 1) peak = Math.max(peak, Math.abs(layout.level[i]));
    const span = x1 - x0;
    const at = (t) => x0 + span * Math.max(0, Math.min(1, t / layout.length));
    for (let i = 0; i < layout.count; i += 1) {
      const lvl = Math.abs(layout.level[i]) / (peak || 1);
      // dB height: 0 dB at the top, -60 dB on the axis (where the Decay fade ends).
      const db = lvl > 0 ? 20 * Math.log10(lvl) : -120;
      const hNorm = Math.max(0, 1 + db / 60);
      const y = base - hNorm * (base - top);
      const xa = at(layout.pos[i]);
      const xb = at(layout.pos[i] + layout.width[i]);
      const half = Math.max(halfPx, (xb - xa) * 0.5);
      const xm = (xa + xb) * 0.5;
      if (half > 0 && base - y > 0.5) nodeGraphGlLinesSegment(batch, xm, base, xm, y, half, smoothing, line);
      if (dotR > 0 && hNorm > 0) nodeGraphGlLinesDot(batch, xm, y, dotR, smoothing, dot);
    }
  }
  if (!nodeGraphGlLinesEnd(batch, "alpha")) nodeGraphDisplayGlFailed(canvas, "velvet taps face: GL present failed");
}

function applyNodeGraphVelvetTapsDisplaySettingsToFace(node) {
  if (!node?.id) return;
  const el = document.querySelector?.(`.node-velvet-taps-display[data-node="${CSS.escape(String(node.id))}"]`);
  if (!el) return;
  el._velvetTapsForceDraw = true;
  drawNodeGraphVelvetTapsDisplay(el);
}

function createNodeGraphVelvetTapsDisplay(nodeId, type = "velvetReverb") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-velvet-taps-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "velvetReverb");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-velvet-taps-canvas"));
  nodeGraphVelvetTapsLoad();
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `velvetTaps:${el.dataset?.node || ""}`,
    forceKey: "_velvetTapsForceDraw",
    rafKey: "_velvetTapsRaf",
    paint: drawNodeGraphVelvetTapsDisplay,
    onResize: (el) => { if (typeof syncFaceMetrics === "function") syncFaceMetrics(el); },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphVelvetTapsDisplay(section);
    section._startFaceLoop?.();
  }));
  return section;
}