// Dark Velvet Reverb face: where the taps land, drawn like the Dark Velvet
// Noise paper's sequence plots (Fagerstrom et al., DAFx2020 paper 31, Fig. 3a):
// bipolar rectangular pulses (no zero line is drawn). Every tap is a sharp-cornered
// rectangle at its delay (time axis 0 .. Length), as wide as its real pulse
// (Darkness / Tail Darkness; at least 1 device px, with exact fractional
// edges only when wider than 1 px), up from the zero line for a + tap and down for a - tap (the signs
// the audio uses). Height = amplitude only
// (sign x the Amp Decay envelope; darkness never shrinks or grows it) in dB, mirrored: 0 dB at the top /
// bottom edge, -60 dB on the zero line. Both channels: Left in the Left lamp
// colour (red), Right in the Right lamp colour (blue), drawn additively so a
// Left+Right overlap sums toward R+B=White and a dense cluster bursts.
// Spread 0 = the channels are identical, so every pulse adds toward white.
// Darker (wider) pulses draw dimmer: ink x 1/w (the audio's pulse gain), floored at 0.2.
// Text: the tap count ("64 taps"; "48 / 64 taps" when taps that would bunch up
// under the cell floor are not used; "4096 taps max" past the engine's table) and
// the tail length ("25.0 ms"; "... s max" only when the delay line truly cannot
// hold the Length; it holds the definition max at any sample rate). The held length also draws a mark: a full-height bar at the right
// end (the tap table limit shows as "max" in the text only).
// The layout comes from velvet_reverb.wasm (soemdsp_velvet_reverb_layout: the
// same build_table the audio uses) and is rebuilt only when a setting changes.
// Taps are fully deterministic: a pure function of Seed and the settings
// (xorshift from the Seed, no clock or Math.random).
// Look: the Pulse Train face settings (Background, Text = the line lamp, shown as
// "Text" on this face: tap count / length readouts and the held-length bar,
// Left, Right, Line thickness, Dot size) over the module definition's
// defaultDisplaySettings (Dot size 0) for any key the node has not stored.
// Live animation is binary (no fade, no level-to-brightness map): a tap is
// idle (the static darkness shade) or fully bright (full channel ink). The
// worklet posts per-tap peak-hold levels (TapLevelsL / TapLevelsR) at the
// display-telemetry rate. A tap is triggered when that peak is above
// NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL (-90 dB). The trigger is latched until
// one bright frame has been drawn, so a snapshot that arrives between paints
// still gets a frame, and a stale bus value cannot retrigger the next paints.
// Height stays the static amplitude layout. A tap narrower than 1 device px
// is drawn as a 1 px bar at full coverage (brightness follows darkness and
// the trigger flash only, never Length or zoom). Wider taps keep exact
// fractional edges with coverage-weighted alpha. Taps go in a GL layer with
// quadBlend "add" (SRC_ALPHA, ONE)
// so overlaps accumulate: sparse taps stay distinct thin lines, dense clusters
// stack into a bright burst (additive may clip toward white), and L red + R
// blue add to the R+B=White look. Idle alpha is near 1 so an isolated tap
// matches the pre-animation static look (ink x 1/width, floor 0.2). A
// triggered tap is full channel ink lifted toward white.
// GPU only (gl-line-renderer); the face does not edit that shared renderer.

const nodeGraphVelvetTapsWasm = { promise: null, exports: null, failed: false };

function nodeGraphVelvetTapsLoad() {
  if (nodeGraphVelvetTapsWasm.promise || typeof fetch !== "function" || typeof WebAssembly === "undefined") {
    return nodeGraphVelvetTapsWasm.promise;
  }
  nodeGraphVelvetTapsWasm.promise = fetch("/native_modules/velvet_reverb/velvet_reverb.wasm?v=dvel-taps-5-v12s1-v6s1-skw1-gap1-trand1-vtaps1")
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
    nodeGraphVelvetTapsParam(node, "minGap", 1),
    nodeGraphVelvetTapsParam(node, "tailRandom", 1),
    nodeGraphVelvetTapsParam(node, "tailCurve", 0),
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
    sampleRate: sr,
    paused: !(args[0] > 0),
    // What Taps asks for (whole taps, up to the table). Fewer play where they
    // would bunch under the cell floor (flag 4): the text reads "48 / 64 taps".
    setting: Math.max(1, Math.ceil(Math.min(Number(args[0]) || 0, x.soemdsp_velvet_reverb_max_taps?.() || 4096) - 1e-6)),
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


// Binary on/off trigger: a posted peak above this is "signal present".
// -90 dB of the width-filtered |pulse x gain x norm|. Exact 0 stays idle.
const NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL = Math.pow(10, -90 / 20); // ~3.162e-5

const nodeGraphVelvetTapTriggerStates = new Map();

function nodeGraphVelvetTapsTriggerState(nodeId) {
  const id = String(nodeId || "");
  let state = nodeGraphVelvetTapTriggerStates.get(id);
  if (!state) {
    state = {
      triggeredL: new Uint8Array(0),
      triggeredR: new Uint8Array(0),
      snapL: undefined,
      snapR: undefined,
    };
    nodeGraphVelvetTapTriggerStates.set(id, state);
  }
  return state;
}

function nodeGraphVelvetTapsEnsureTriggers(state, key, n) {
  const count = Math.max(0, n | 0);
  if (!state[key] || state[key].length !== count) {
    const next = new Uint8Array(count);
    if (state[key]) next.set(state[key].subarray(0, Math.min(state[key].length, count)));
    state[key] = next;
  }
  return state[key];
}

// OR any peak above the threshold into the latch. Used by ingest (every
// snapshot write) and as a draw-time fallback when ingest is not armed.
function nodeGraphVelvetTapsArmTriggers(triggered, levels, threshold) {
  const th = threshold == null ? NODE_GRAPH_VELVET_TAP_TRIGGER_LEVEL : threshold;
  const n = triggered.length;
  for (let i = 0; i < n; i += 1) {
    const v = levels && i < levels.length ? Number(levels[i]) : 0;
    if (v > th) triggered[i] = 1;
  }
  return triggered;
}

// Copy the latch and clear it: each trigger is consumed by exactly one draw.
function nodeGraphVelvetTapsConsumeTriggers(triggered) {
  const on = new Uint8Array(triggered);
  triggered.fill(0);
  return on;
}

function nodeGraphVelvetTapsArmSnapshot(nodeId, port, levels) {
  const state = nodeGraphVelvetTapsTriggerState(nodeId);
  const key = port === "TapLevelsR" ? "triggeredR" : "triggeredL";
  const n = levels && typeof levels.length === "number" ? levels.length : 0;
  nodeGraphVelvetTapsArmTriggers(nodeGraphVelvetTapsEnsureTriggers(state, key, n), levels);
}

// Main-thread ingest wrap: arm the latch when a snapshot is written to the
// bus, so a later snapshot cannot overwrite a trigger that has not been drawn.
function nodeGraphVelvetTapsInstallIngestArm() {
  if (typeof writeNodeGraphDataOutput !== "function") return false;
  if (writeNodeGraphDataOutput._velvetTapArm) return true;
  const prev = writeNodeGraphDataOutput;
  const wrapped = function writeNodeGraphDataOutputVelvetTapArm(nodeId, port, value) {
    prev(nodeId, port, value);
    if (port === "TapLevelsL" || port === "TapLevelsR") {
      nodeGraphVelvetTapsArmSnapshot(String(nodeId), port, value);
    }
  };
  wrapped._velvetTapArm = true;
  writeNodeGraphDataOutput = wrapped;
  return true;
}

// One draw: optionally arm from a new bus identity (fallback), then consume
// the latch so this frame is the guaranteed bright frame.
function nodeGraphVelvetTapsTakeLit(nodeId, rawL, rawR, countL, countR, armFromBus) {
  const state = nodeGraphVelvetTapsTriggerState(nodeId);
  const nL = Math.max(0, countL | 0);
  const nR = Math.max(0, countR | 0);
  const tL = nodeGraphVelvetTapsEnsureTriggers(state, "triggeredL", nL);
  const tR = nodeGraphVelvetTapsEnsureTriggers(state, "triggeredR", nR);
  if (armFromBus) {
    if (state.snapL !== rawL) {
      state.snapL = rawL;
      nodeGraphVelvetTapsArmTriggers(tL, rawL);
    }
    if (state.snapR !== rawR) {
      state.snapR = rawR;
      nodeGraphVelvetTapsArmTriggers(tR, rawR);
    }
  }
  return {
    onL: nodeGraphVelvetTapsConsumeTriggers(tL),
    onR: nodeGraphVelvetTapsConsumeTriggers(tR),
  };
}

nodeGraphVelvetTapsInstallIngestArm();


// Idle fill is near the pre-animation static look (ink x 1/width at almost
// solid alpha). Triggered is opaque and lifted toward white so the one-frame
// flash reads clearly. Overlaps still add and may clip to white (a burst).
const NODE_GRAPH_VELVET_TAP_IDLE_ALPHA = 0.92;
const NODE_GRAPH_VELVET_TAP_ON_ALPHA = 1;
const NODE_GRAPH_VELVET_TAP_ON_LIFT = 0.4;

// Darkness dim: 1 / pulse width in samples, floored at 0.2. Wider is always
// dimmer until the floor. Used only for idle taps.
function nodeGraphVelvetTapsDarknessShade(widthSeconds, sampleRate) {
  return Math.max(0.2, Math.min(1, 1 / Math.max(1, widthSeconds * sampleRate)));
}

// ink is the lamp colour. Idle keeps its darkness shade; triggered uses full
// ink lifted toward white.
function nodeGraphVelvetTapsShade(ink, g, on) {
  if (on) {
    const lift = NODE_GRAPH_VELVET_TAP_ON_LIFT;
    return [
      ink[0] + (1 - ink[0]) * lift,
      ink[1] + (1 - ink[1]) * lift,
      ink[2] + (1 - ink[2]) * lift,
      NODE_GRAPH_VELVET_TAP_ON_ALPHA,
    ];
  }
  const s = Math.max(0, Math.min(1, g));
  return [ink[0] * s, ink[1] * s, ink[2] * s, NODE_GRAPH_VELVET_TAP_IDLE_ALPHA];
}

// Coverage spans along one axis in device pixels: each { p, c, w } is a run
// of `w` pixels starting at `p` with per-pixel coverage `c` in (0, 1].
// minFull > 0: a span no wider than that is one bar of 1 px at coverage 1,
// centred on the exact position (so Length cannot fade a thin tap).
function nodeGraphVelvetTapsAxisSpans(a, b, minFull) {
  if (b < a) { const t = a; a = b; b = t; }
  const spans = [];
  if (!(b > a)) return spans;
  const min = minFull > 0 ? minFull : 0;
  if (min > 0 && !(b - a > min)) {
    spans.push({ p: Math.floor((a + b) * 0.5), c: 1, w: 1 });
    return spans;
  }
  const first = Math.floor(a);
  const last = Math.ceil(b) - 1;
  if (last < first) return spans;
  if (first === last) {
    spans.push({ p: first, c: b - a, w: 1 });
    return spans;
  }
  spans.push({ p: first, c: (first + 1) - a, w: 1 });
  if (last - first > 1) spans.push({ p: first + 1, c: 1, w: last - first - 1 });
  spans.push({ p: last, c: b - last, w: 1 });
  return spans;
}

// Sharp-cornered rectangle at exact CSS-pixel edges. Horizontal spans no
// wider than 1 device px are a 1 px bar at full coverage; wider spans keep
// fractional edge coverage. Height still uses coverage AA. Device pixels
// follow batch.scale / dpr.
function nodeGraphVelvetTapsCoverageRect(batch, xa, ya, wa, ha, rgba) {
  if (!batch || typeof nodeGraphGlLinesRect !== "function") return;
  if (!(wa > 0) || !(ha > 0)) return;
  const k = Number(batch.scale) > 0 ? Number(batch.scale) : 1;
  const xs = nodeGraphVelvetTapsAxisSpans(xa * k, (xa + wa) * k, 1);
  const ys = nodeGraphVelvetTapsAxisSpans(ya * k, (ya + ha) * k);
  if (!xs.length || !ys.length) return;
  const saved = batch.scale;
  batch.scale = 1;
  const cr = rgba[0];
  const cg = rgba[1];
  const cb = rgba[2];
  const ca = rgba[3];
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i];
    for (let j = 0; j < ys.length; j += 1) {
      const y = ys[j];
      const cov = x.c * y.c;
      if (!(cov > 0) || !(x.w > 0) || !(y.w > 0)) continue;
      nodeGraphGlLinesRect(batch, x.p, y.p, x.w, y.w, [cr, cg, cb, ca * cov]);
    }
  }
  batch.scale = saved;
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
    : { backgroundPaint: "#000", strokePaint: "#fff", leftPaint: "#ff7171", rightPaint: "#5454f9", lineThickness: 1.5, dotThickness: 0 };
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
      : `${layout.count}${layout.count < layout.setting ? ` / ${layout.setting}` : ""} ${layout.setting === 1 ? "tap" : "taps"}${layout.flags & 1 ? " max" : ""}`;
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
  // No zero line or end ticks (Argi): the rectangles alone show the sign. The
  // delay line holding the length also shows as a mark, not only as "max" in
  // the text: a full-height bar at the tail end, in the Text colour.
  const lengthLimit = Boolean(layout && !layout.paused && (layout.flags & 2));
  if (lengthLimit) nodeGraphGlLinesSegment(batch, x1, top - dotR, x1, bottom + dotR, Math.max(1, halfPx), smoothing, line);

  if (layout && layout.count > 0 && layout.length > 0) {
    let peak = 0;
    for (let i = 0; i < layout.count; i += 1) peak = Math.max(peak, Math.abs(layout.level[i]));
    for (let i = 0; i < layout.countR; i += 1) peak = Math.max(peak, Math.abs(layout.levelR[i]));
    const span = x1 - x0;
    const at = (t) => x0 + span * Math.max(0, Math.min(1, t / layout.length));
    // Darker taps draw dimmer: the audio gain of a pulse is 1 / width (in
    // samples), so the ink is scaled by 1 / w, floored at 0.2 so the
    // darkest pulses stay visible. A triggered tap is binary: full channel
    // ink for this one frame, otherwise that static shade. Width stays the
    // real pulse; a sub-pixel pulse is a 1 device-px bar at full coverage.
    const sr = layout.sampleRate || 48000;
    const nodeId = String(node?.id || section?.dataset?.node || "");
    const rawL = (typeof nodeGraphDataBus !== "undefined" && typeof nodeGraphDataBusKey === "function")
      ? nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, "TapLevelsL"))
      : null;
    const rawR = (typeof nodeGraphDataBus !== "undefined" && typeof nodeGraphDataBusKey === "function")
      ? nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, "TapLevelsR"))
      : null;
    const ingest = nodeGraphVelvetTapsInstallIngestArm();
    const lit = nodeGraphVelvetTapsTakeLit(nodeId, rawL, rawR, layout.count, layout.countR, !ingest);
    const shade = (ink, r) => nodeGraphVelvetTapsShade(ink, r.g, r.on);
    // One sharp rectangle per tap: x range = the real pulse, y = zero line to
    // the mirrored dB height (lvl <= 1 of the peak, so it stays in the face).
    const rect = (p, wd, signed, on) => {
      const lvl = Math.abs(signed) / (peak || 1);
      const db = lvl > 0 ? 20 * Math.log10(lvl) : -120;
      const hNorm = Math.max(0, 1 + db / 60);
      const xa = at(p);
      const xb = at(p + wd);
      const g = nodeGraphVelvetTapsDarknessShade(wd, sr);
      return { xa, xb, s: Math.sign(signed), hh: hNorm * reach, hNorm, g: on ? 1 : g, on: !!on };
    };
    const rl = [];
    const rr = [];
    for (let i = 0; i < layout.count; i += 1) rl.push(rect(layout.pos[i], layout.width[i], layout.level[i], lit.onL[i]));
    for (let i = 0; i < layout.countR; i += 1) rr.push(rect(layout.posR[i], layout.widthR[i], layout.levelR[i], lit.onR[i]));
    // Taps are their own additive layer so text and the length bar stay
    // normal-over, while overlapping pulses (same or opposite channel) sum
    // light. L red + R blue therefore still reads as R+B=White, and a dense
    // cluster bursts instead of overdrawing at one tap's brightness.
    const taps = typeof nodeGraphGlLinesLayer === "function" ? nodeGraphGlLinesLayer(batch) : batch;
    if (taps && taps !== batch) taps.quadBlend = "add";
    const fill = (r, ink) => {
      if (!(r.hh > 0) || !(r.xb > r.xa) || !r.s) return;
      nodeGraphVelvetTapsCoverageRect(taps, r.xa, r.s > 0 ? mid - r.hh : mid, r.xb - r.xa, r.hh, shade(ink, r));
    };
    for (const r of rl) fill(r, inkL);
    for (const r of rr) fill(r, inkR);
    if (dotR > 0) {
      for (const [list, ink] of [[rl, inkL], [rr, inkR]]) {
        for (const r of list) {
          if (r.hNorm > 0 && r.s) nodeGraphGlLinesDot(taps, (r.xa + r.xb) * 0.5, mid - r.s * r.hh, dotR, smoothing, shade(ink, r));
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