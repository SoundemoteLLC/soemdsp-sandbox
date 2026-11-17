// Dark Velvet Reverb face: where the taps land, drawn like the Dark Velvet
// Noise paper's sequence plots (Fagerstrom et al., DAFx2020 paper 31, Fig. 3a):
// bipolar rectangular pulses on a zero line. Every tap is a sharp-cornered
// rectangle (nodeGraphGlLinesRect) at its delay (time axis 0 .. Length), as
// wide as its real pulse (Darkness / Tail Darkness; never thinner than Line
// thickness so a 1-sample pulse stays visible), up from the zero line for a +
// tap and down for a - tap (the signs the audio uses: the layout level is
// sign * env). Height = the tap level in dB, mirrored: 0 dB at the top /
// bottom edge, -60 dB on the zero line. Both channels: Left in the Left lamp
// colour (red), Right in the Right lamp colour (blue); where a Left and a Right
// pulse overlap (same side of the zero line) the overlap paints the shared
// R+B=White meet colour (TraceStroke.meetColorForMode "combine", share =
// overlap / union area), the same blend the stereo scopes use. Spread 0 = the
// channels are identical, so every pulse is white.
// Text: the tap count ("64 taps"; "4096 taps max" past the engine's table) and
// the tail length ("25.0 ms"; "5.46 s max" when the delay line holds a longer
// Length). A limit also draws a mark: bold zero line = tap table full;
// full-height bar at the right end = length held by the delay line.
// The layout comes from velvet_reverb.wasm (soemdsp_velvet_reverb_layout: the
// same build_table the audio uses) and is rebuilt only when a setting changes.
// Taps are fully deterministic: a pure function of Seed and the settings
// (xorshift from the Seed, no clock or Math.random).
// Look: the Pulse Train face settings (Background, Line = zero line + text,
// Left, Right, Line thickness, Dot size) over the module definition's
// defaultDisplaySettings (Dot size 0) for any key the node has not stored.
// GPU only (gl-line-renderer).

const nodeGraphVelvetTapsWasm = { promise: null, exports: null, failed: false };

function nodeGraphVelvetTapsLoad() {
  if (nodeGraphVelvetTapsWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphVelvetTapsWasm.promise;
  }
  nodeGraphVelvetTapsWasm.promise = fetch("/native_modules/velvet_reverb/velvet_reverb.wasm?v=dvel-taps-4")
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

// Default = the parameter definition's defaultValue (the only source of truth);
// a param the definition does not carry yet uses the engine's default.
function nodeGraphVelvetTapsParam(node, key, engineDefault) {
  const def = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions?.[node?.type]?.parameters?.find?.((p) => p.key === key)
    : null;
  const d = Number(def?.defaultValue);
  const fallback = Number.isFinite(d) ? d : engineDefault;
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

/** { count, pos, width, level, countR, posR, widthR, levelR, length, flags } for the node's settings; cached per section. */
function nodeGraphVelvetTapsLayout(section, node) {
  const x = nodeGraphVelvetTapsWasm.exports;
  if (!x) {
    nodeGraphVelvetTapsLoad();
    return null;
  }
  const sr = Number(nodeGraphMvp?.live?.context?.sampleRate) || 48000;
  const args = [
    nodeGraphVelvetTapsParam(node, "density", 64),
    nodeGraphVelvetTapsParam(node, "darkness", 1),
    nodeGraphVelvetTapsParam(node, "stereoSpread", 1),
    sr,
    nodeGraphVelvetTapsParam(node, "decay", 0.025),
    nodeGraphVelvetTapsParam(node, "tailDarkness", 0),
    nodeGraphVelvetTapsParam(node, "seed", 1),
    nodeGraphVelvetTapsParam(node, "ampDecay", -60),
    nodeGraphVelvetTapsParam(node, "densitySkew", 0),
  ];
  const key = args.join(",");
  if (section._velvetTapsKey === key && section._velvetTapsLayout) return section._velvetTapsLayout;
  const count = x.soemdsp_velvet_reverb_layout(...args) | 0;
  const buf = x.memory.buffer;
  const countR = x.soemdsp_velvet_reverb_layout_count_r() | 0;
  const read = (ptr, n = count) => new Float64Array(buf, ptr, n).slice();
  const layout = {
    count,
    pos: read(x.soemdsp_velvet_reverb_layout_pos()),
    width: read(x.soemdsp_velvet_reverb_layout_width()),
    level: read(x.soemdsp_velvet_reverb_layout_level()),
    countR,
    posR: read(x.soemdsp_velvet_reverb_layout_pos_r(), countR),
    widthR: read(x.soemdsp_velvet_reverb_layout_width_r(), countR),
    levelR: read(x.soemdsp_velvet_reverb_layout_level_r(), countR),
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
    : { backgroundPaint: "#000", strokePaint: "#fff", leftPaint: "#f00", rightPaint: "#00f", lineThickness: 1.5, dotThickness: 0 };
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
  const inkL = rgba(look.leftPaint);
  const inkR = rgba(look.rightPaint);
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
    nodeGraphGlLinesText(batch, countText, pad, ty, { px, align: "left", baseline: "middle", rgba: line });
    if (lenText) nodeGraphGlLinesText(batch, lenText, w - pad, ty, { px, align: "right", baseline: "middle", rgba: dim(line, 0.75) });
  }

  const top = pad * 0.5 + textPx + 4 + dotR;
  const bottom = h - Math.max(4, h * 0.07) - dotR;
  const mid = (top + bottom) * 0.5;
  const reach = Math.max(0, (bottom - top) * 0.5);
  const x0 = pad + dotR;
  const x1 = Math.max(x0 + 1, w - pad - dotR);
  // A physical limit also shows as a mark, not only as "max" in the text:
  // the tap table is full -> the zero line draws bold; the delay line holds the
  // length -> a full-height bar at the tail end.
  const tapLimit = Boolean(layout && !layout.paused && (layout.flags & 1));
  const lengthLimit = Boolean(layout && !layout.paused && (layout.flags & 2));
  nodeGraphGlLinesSegment(batch, x0, mid, x1, mid, tapLimit ? Math.max(1.5, halfPx * 1.5) : Math.max(0.5, halfPx * 0.5), smoothing, tapLimit ? line : dim(line, 0.6));
  nodeGraphGlLinesSegment(batch, x0, mid - 3, x0, mid + 3, 0.5, smoothing, dim(line, 0.6));
  if (lengthLimit) nodeGraphGlLinesSegment(batch, x1, top - dotR, x1, bottom + dotR, Math.max(1, halfPx), smoothing, line);
  else nodeGraphGlLinesSegment(batch, x1, mid - 3, x1, mid + 3, 0.5, smoothing, dim(line, 0.6));

  if (layout && layout.count > 0 && layout.length > 0) {
    let peak = 0;
    for (let i = 0; i < layout.count; i += 1) peak = Math.max(peak, Math.abs(layout.level[i]));
    for (let i = 0; i < layout.countR; i += 1) peak = Math.max(peak, Math.abs(layout.levelR[i]));
    const span = x1 - x0;
    const at = (t) => x0 + span * Math.max(0, Math.min(1, t / layout.length));
    const minW = Math.max(0.5, halfPx * 2);
    // One sharp rectangle per tap: x range = the real pulse, y = zero line to
    // the mirrored dB height (lvl <= 1 of the peak, so it stays in the face).
    const rect = (p, wd, signed) => {
      const lvl = Math.abs(signed) / (peak || 1);
      const db = lvl > 0 ? 20 * Math.log10(lvl) : -120;
      const hNorm = Math.max(0, 1 + db / 60);
      let xa = at(p);
      let xb = at(p + wd);
      if (xb - xa < minW) { const c = (xa + xb) * 0.5; xa = c - minW * 0.5; xb = c + minW * 0.5; }
      return { xa, xb, s: Math.sign(signed), hh: hNorm * reach, hNorm };
    };
    const rl = [];
    const rr = [];
    for (let i = 0; i < layout.count; i += 1) rl.push(rect(layout.pos[i], layout.width[i], layout.level[i]));
    for (let i = 0; i < layout.countR; i += 1) rr.push(rect(layout.posR[i], layout.widthR[i], layout.levelR[i]));
    const fill = (r, xa, xb, hh, ink) => {
      if (!(hh > 0) || !(xb > xa) || !r.s) return;
      nodeGraphGlLinesRect(batch, xa, r.s > 0 ? mid - hh : mid, xb - xa, hh, ink);
    };
    for (const r of rl) fill(r, r.xa, r.xb, r.hh, inkL);
    for (const r of rr) fill(r, r.xa, r.xb, r.hh, inkR);
    // L and R overlap: the shared R+B=White meet colour on the intersection.
    // Taps are one per grid cell on both sides, so a Left tap can only meet
    // Right taps of nearby cells.
    const meet = (share) => {
      const m = typeof TraceStroke !== "undefined" && typeof TraceStroke.meetColorForMode === "function"
        ? TraceStroke.meetColorForMode("combine", inkL, inkR, share)
        : [Math.min(1, inkL[0] + inkR[0]), Math.min(1, inkL[1] + inkR[1]), Math.min(1, inkL[2] + inkR[2])];
      return [m[0], m[1], m[2], Math.max(inkL[3], inkR[3])];
    };
    const reachCells = 4;
    for (let i = 0; i < rl.length; i += 1) {
      const a = rl[i];
      if (!a.s || !(a.hh > 0)) continue;
      for (let j = Math.max(0, i - reachCells); j <= Math.min(rr.length - 1, i + reachCells); j += 1) {
        const b = rr[j];
        if (b.s !== a.s || !(b.hh > 0)) continue;
        const xa = Math.max(a.xa, b.xa);
        const xb = Math.min(a.xb, b.xb);
        if (!(xb > xa)) continue;
        const hh = Math.min(a.hh, b.hh);
        const inter = (xb - xa) * hh;
        const union = (a.xb - a.xa) * a.hh + (b.xb - b.xa) * b.hh - inter;
        fill(a, xa, xb, hh, meet(union > 0 ? inter / union : 1));
      }
    }
    if (dotR > 0) {
      for (const [list, ink] of [[rl, inkL], [rr, inkR]]) {
        for (const r of list) {
          if (r.hNorm > 0 && r.s) nodeGraphGlLinesDot(batch, (r.xa + r.xb) * 0.5, mid - r.s * r.hh, dotR, smoothing, ink);
        }
      }
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