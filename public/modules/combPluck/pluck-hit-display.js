// Hit view for Comb Pluck and Mode Ping, decay view for Comb Resonator
// (docs/COMB_PLUCK_PLAN.md). Display type `pluckHitFace`.
//
// Computed from the math, not from recorded audio:
//   - Body curve: the ring envelope A0 * exp(-t / tau). A0 = Level
//     (Amplitude). Knob values only (no wired ƒ, note, velocity or MOD), so a
//     played line never makes the curve, axis or markers jump per note. Comb: tau = -T / ln(g |H(w1)|), with T = 1/f the loop period,
//     g = exp(-T / Decay) the loop gain (comb_core.h comb_feedback_gain) and H the
//     loop one-pole lowpass (1 - c) / (1 - c e^-jw), c = Damping^2
//     (comb_loop_filter). Mode Ping: tau = Decay. Hold: flat. Low Cut is
//     outside the loop (Comb Pluck: exciter, Comb Resonator: input), so it
//     never changes the ring's decay; Comb Pluck's strip shows it.
//   - Top partial (comb with Damping > 0): the same law at the 8th partial
//     (or the highest under Nyquist), drawn fainter. It falls faster: pow vs pong.
//   - -20 / -40 / -60 dB ticks on the body curve (t = tau ln 10^(dB/20)).
//   - Time axis: about 1.2 x T60 of the body, eased toward a new range so it
//     never jumps. Height: the larger of the predicted and the measured peak,
//     so a curve only reaches the top where the signal really peaks there.
//   - Exciter strip on the left: one loop period with the burst (Shape, Soft,
//     Width, Edge's Curve, Comb Pluck's Low Cut) at its start, the same pipeline as
//     soemdsp/trigger/pluck_exciter.h. Noise draws the burst Seed gives with
//     Noise Hit Same (hash index 0..n-1, no instance salt): exact for Same; with
//     New each hit is a different stretch of noise, so it is a representative.
// Live (toggle `liveTrace`, on by default; Comb Pluck / Mode Ping only):
// engine taps __Elapsed (s since the Trigger edge), __Peak (output peak
// follower), __Vel, __Hits. On each hit a playhead starts at the edge and the
// measured envelope draws in behind it with a glow tail. Stack: older traces
// fade out over Fade time. Choke: older traces are cleared. Idle: the last trace
// stays, dimmed. Past the window the playhead parks at the right edge.
// Comb Resonator, Feedforward: no ring, so it shows the magnitude response
// Amplitude |1 +/- Depth e^-jwD| instead.
// Display Settings (node.traceDisplaySettings): Background / Curve / Live / Text
// colours, Fade time (s), Live. GPU only (gl-line-renderer).

const nodeGraphPluckHitFaceDisplaySettingsDefaults = Object.freeze({
  backgroundColor: "#05080b",
  barColor: "#7fc7d9",
  lightColor: "#ffd27a",
  textColor: "#8b9daa",
  fadeTime: 1.5,
  liveTrace: true,
});

const NODE_GRAPH_PLUCK_HIT_SHAPES = Object.freeze(["Bump", "Noise", "Edge"]);
const NODE_GRAPH_PLUCK_HIT_NORM_POINTS = 256;
const NODE_GRAPH_PLUCK_HIT_TOP_PARTIAL = 8;
const NODE_GRAPH_PLUCK_HIT_MAX_POINTS = 4000;

function normalizeNodeGraphPluckHitFaceSettings(settings = {}) {
  const d = nodeGraphPluckHitFaceDisplaySettingsDefaults;
  const source = settings && typeof settings === "object" ? settings : {};
  const color = (key) => {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") return d[key];
    if (typeof normalizeNodeGraphTraceDisplayColor === "function") return normalizeNodeGraphTraceDisplayColor(raw, d[key]);
    const s = String(raw).trim();
    return /^#?[0-9a-f]{6}$/i.test(s) ? (s[0] === "#" ? s : `#${s}`) : d[key];
  };
  const fade = Number(source.fadeTime);
  return {
    backgroundColor: color("backgroundColor"),
    barColor: color("barColor"),
    lightColor: color("lightColor"),
    textColor: color("textColor"),
    fadeTime: Number.isFinite(fade) && fade >= 0 ? Math.min(fade, 10) : d.fadeTime,
    liveTrace: source.liveTrace === undefined
      ? d.liveTrace
      : (typeof nodeGraphDisplaySettingsToggleIsOn === "function"
        ? nodeGraphDisplaySettingsToggleIsOn(source.liveTrace)
        : (source.liveTrace === true || source.liveTrace === 1 || source.liveTrace === "1" || source.liveTrace === "true")),
  };
}

function nodeGraphPluckHitFaceSettingsForNode(node) {
  return normalizeNodeGraphPluckHitFaceSettings(node?.traceDisplaySettings);
}

function applyNodeGraphPluckHitDisplaySettingsToFace(node) {
  const id = String(node?.id || "");
  document.querySelectorAll(`.node-pluck-hit-face[data-node="${CSS.escape(id)}"]`).forEach((el) => {
    el._pluckHitForceDraw = true;
    el._startFaceLoop?.();
  });
  if (typeof markNodeGraphRenderPending === "function") markNodeGraphRenderPending();
}

/**
 * Knob value only: the slider mid-drag, else the patch value. Never a wired ƒ,
 * a note, or MOD: a played note changes those on every hit, and the static
 * curve, time axis and markers must not jump around per note (Argi,
 * 2026-11-17). Per-hit changes show only in the live trace.
 */
function nodeGraphPluckHitKnob(node, key, fallback) {
  const slider = typeof nodeGraphSliderForParameter === "function"
    ? nodeGraphSliderForParameter(String(node?.id || ""), key)
    : null;
  const fromSlider = Number(slider?.dataset?.domainValue);
  if (Number.isFinite(fromSlider)) return fromSlider;
  const n = Number(node?.params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

/** Every picture input is a knob value (see nodeGraphPluckHitKnob). */
function nodeGraphPluckHitParam(node, key, fallback) {
  return nodeGraphPluckHitKnob(node, key, fallback);
}

function nodeGraphPluckHitSampleRate() {
  const sr = Number(nodeGraphModuleScopeState?.sampleRate) || Number(nodeGraphMvp?.sampleRate) || 48000;
  return sr > 0 ? sr : 48000;
}

// ---- exciter mirror (pluck_exciter.h) ----

function nodeGraphPluckHitHash(index, seed) {
  let v = (index ^ seed) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 2246822507) >>> 0;
  v = Math.imul(v ^ (v >>> 13), 3266489909) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  return (v / 4294967295) * 2 - 1;
}

function nodeGraphPluckHitHann(u) {
  const s = Math.sin(Math.PI * u);
  return s * s;
}

/** Edge (pluck_exciter.h raw_edge): Rational ramp (segment curves twin) over 1 - d, raised-cosine drop over d. */
function nodeGraphPluckHitRawEdge(u, drop, curve) {
  const r = 1 - drop;
  if (u < r) {
    const p = u / r;
    return typeof nodeGraphSegmentRational01 === "function" ? nodeGraphSegmentRational01(p, curve) : p;
  }
  const t = Math.min(1, (u - r) / drop);
  return 0.5 + 0.5 * Math.cos(Math.PI * t);
}

function nodeGraphPluckHitRawBump(u, q) {
  const s = Math.sin(Math.PI * u);
  return s > 1e-12 ? Math.pow(s, q) : 0;
}

/** The burst as played: n samples (n = round(Width fs / f), at least 3), peak 1. */
const NODE_GRAPH_PLUCK_HIT_TABLE_POINTS = 2048;

/** Zero-mean step of pluck_exciter.h (table_zero_mean): v -= m hann, m = sum v / sum hann. */
function nodeGraphPluckHitZeroMean(t) {
  const pts = t.length;
  let sum = 0, hsum = 0;
  for (let i = 0; i < pts; i += 1) { sum += t[i]; hsum += nodeGraphPluckHitHann((i + 0.5) / pts); }
  const m = hsum > 1e-12 ? sum / hsum : 0;
  for (let i = 0; i < pts; i += 1) t[i] -= m * nodeGraphPluckHitHann((i + 0.5) / pts);
}

/** Low Cut of pluck_exciter.h (table_low_cut): zero-phase one-pole highpass, edge change taken back out at the filter rate, zero-mean. */
function nodeGraphPluckHitLowCut(t, a) {
  const pts = t.length;
  if (!(a < 1) || pts < 3) return;
  const t0 = t[0], tn = t[pts - 1];
  let x1 = 0, y1 = 0;
  for (let i = 0; i < pts; i += 1) { const x = t[i]; y1 = a * (y1 + x - x1); x1 = x; t[i] = y1; }
  const c = a * (y1 - x1);
  x1 = c; y1 = a * c / (1 + a);
  for (let i = pts - 1; i >= 0; i -= 1) { const x = t[i]; y1 = a * (y1 + x - x1); x1 = x; t[i] = y1; }
  const d0 = t[0] - t0, d1 = t[pts - 1] - tn;
  const aN = Math.pow(a, pts - 1);
  const den = 1 - aN;
  if (den > 1e-9) {
    let p = 1;
    for (let i = 0; i < pts; i += 1) { t[i] -= d0 * (p - aN) / den; p *= a; }
    p = 1;
    for (let i = pts - 1; i >= 0; i -= 1) { t[i] -= d1 * (p - aN) / den; p *= a; }
  } else {
    for (let i = 0; i < pts; i += 1) { const u = i / (pts - 1); t[i] -= d0 * (1 - u) + d1 * u; }
  }
  nodeGraphPluckHitZeroMean(t);
}

/**
 * The normalized burst, the same pipeline as pluck_exciter.h start_burst:
 * render on min(len, 2048) points, zero-mean, Low Cut, peak 1. Returns at most
 * 512 points for drawing plus the burst length in samples.
 */
function nodeGraphPluckHitBurst(shape, soft, width, f, sr, lowCut = 0, seed = 0, curve = 0) {
  const ff = Math.min(Math.max(Math.abs(f), 1), sr * 0.499);
  const len = Math.max(3, Math.floor(Math.max(0, width) * sr / ff + 0.5));
  const sf = Math.min(1, Math.max(0, soft));
  const pts = Math.min(len, NODE_GRAPH_PLUCK_HIT_TABLE_POINTS);
  const tableRate = sr * pts / len;
  const t = new Float64Array(pts);
  if (shape === 1) {
    const fb = sr / len;
    const fc = fb * Math.pow(2, 6 * (1 - sf));
    const c = Math.min(1, Math.max(1e-6, 1 - Math.exp(-2 * Math.PI * fc / tableRate)));
    const r = Math.max(0, 1 - 2 * Math.PI * (0.25 * fb) / tableRate);
    // pluck_exciter.h: kSeedBase ^ Seed * kSeedMul (Noise Hit Same, no salt)
    const hseed = (0x6a09e667 ^ Math.imul(Math.min(16777215, Math.max(0, Math.round(seed))) >>> 0, 0x9e3779b1)) >>> 0;
    let lp = 0, x1 = 0, hp = 0;
    for (let i = 0; i < pts; i += 1) {
      lp += c * (nodeGraphPluckHitHash(i, hseed) - lp);
      hp = lp - x1 + r * hp;
      x1 = lp;
      t[i] = hp * nodeGraphPluckHitHann((i + 0.5) / pts);
    }
  } else if (shape === 2) {
    // Edge: drop half a table point (Soft 0, a one-sample cliff at the end) .. half the burst (Soft 1)
    const dMin = 0.5 / pts;
    const drop = dMin < 0.5 ? dMin * Math.exp(Math.log(0.5 / dMin) * sf) : 0.5;
    const cv = Math.min(1, Math.max(-1, Number(curve) || 0));
    for (let i = 0; i < pts; i += 1) t[i] = nodeGraphPluckHitRawEdge((i + 0.5) / pts, drop, cv);
  } else {
    // Bump q (pluck_exciter.h): 4 at Soft 1 .. (pts / (0.6 pi))^2 at Soft 0, geometric in sqrt(Soft)
    const qMax = Math.max(4, Math.pow(pts / (Math.PI * 0.6), 2));
    const q = 4 * Math.exp(Math.log(qMax / 4) * (1 - Math.sqrt(sf)));
    for (let i = 0; i < pts; i += 1) t[i] = nodeGraphPluckHitRawBump((i + 0.5) / pts, q);
  }
  nodeGraphPluckHitZeroMean(t);
  const lc = Math.min(Math.max(0, Number(lowCut) || 0), tableRate * 0.45);
  if (lc > 0) nodeGraphPluckHitLowCut(t, Math.exp(-2 * Math.PI * lc / tableRate));
  let peak = 0;
  for (let i = 0; i < pts; i += 1) peak = Math.max(peak, Math.abs(t[i]));
  const n = Math.min(pts, 512);
  const out = new Float64Array(n);
  for (let j = 0; j < n; j += 1) out[j] = peak > 1e-12 ? t[Math.floor((j * pts) / n)] / peak : 0;
  return { samples: out, len };
}

// ---- ring model ----

/** |H(w)| of the loop one-pole y += (1 - c)(x - y), c = d^2. */
function nodeGraphPluckHitLoopLp(damping, w) {
  const d = Math.min(1, Math.max(0, damping));
  if (d <= 1e-9) return 1;
  const c = d * d;
  return (1 - c) / Math.sqrt(Math.max(1e-30, 1 - 2 * c * Math.cos(w) + c * c));
}

/** Everything the picture needs, from the module's parameters. */
function nodeGraphPluckHitModel(node) {
  const type = String(node?.type || "");
  const sr = nodeGraphPluckHitSampleRate();
  const m = { type, sr, hold: false, feedforward: false, curves: [], f: 0, tau: Infinity };
  if (type === "modeResonator") {
    m.f = nodeGraphPluckHitParam(node, "frequency", 440);
    m.decay = nodeGraphPluckHitParam(node, "decay", 1);
    m.hold = nodeGraphPluckHitParam(node, "hold", 0) >= 0.5;
    m.level = nodeGraphPluckHitParam(node, "amplitude", 1);
    m.tau = m.hold ? Infinity : m.decay;
    m.curves.push({ tau: m.tau, weight: 1 });
  } else {
    m.f = nodeGraphPluckHitParam(node, "frequency", 110);
    m.decay = nodeGraphPluckHitParam(node, "decay", 1);
    m.damping = nodeGraphPluckHitParam(node, "damping", type === "combPluck" ? 0.2 : 0);
    m.lowCut = nodeGraphPluckHitParam(node, "lowCut", 1);
    m.invert = nodeGraphPluckHitParam(node, "invert", 0) >= 0.5;
    m.level = nodeGraphPluckHitParam(node, type === "combPluck" ? "level" : "amplitude", 1);
    if (type === "combResonator") {
      m.hold = nodeGraphPluckHitParam(node, "hold", 0) >= 0.5;
      m.feedforward = nodeGraphPluckHitParam(node, "topology", 0) >= 0.5;
      m.depth = nodeGraphPluckHitParam(node, "depth", 1);
    }
    const f = m.f > 0 ? m.f : 0;
    if (f > 0) {
      const T = 1 / f;
      const g = m.hold ? 1 : Math.exp(-T / Math.max(1e-6, m.decay));
      const partialHz = (k) => (m.invert ? (k - 0.5) : k) * f;
      const tauAt = (k) => {
        const w = 2 * Math.PI * partialHz(k) / sr;
        const gain = g * nodeGraphPluckHitLoopLp(m.damping, w);
        return gain >= 1 - 1e-12 ? Infinity : -T / Math.log(Math.max(1e-300, gain));
      };
      m.tau = tauAt(1);
      m.curves.push({ tau: m.tau, weight: 1 });
      if (m.damping > 1e-6) {
        let top = NODE_GRAPH_PLUCK_HIT_TOP_PARTIAL;
        while (top > 1 && partialHz(top) >= sr * 0.5) top -= 1;
        if (top > 1) m.curves.push({ tau: tauAt(top), weight: 0.55, partial: top });
      }
    }
  }
  if (type !== "combResonator") {
    m.shape = Math.min(2, Math.max(0, Math.round(nodeGraphPluckHitParam(node, "shape", 0)) || 0));
    m.soft = nodeGraphPluckHitParam(node, "soft", type === "combPluck" ? 0.3 : 0.5);
    m.width = nodeGraphPluckHitParam(node, "width", 0.5);
    m.retrigger = nodeGraphPluckHitParam(node, "retrigger", 0) >= 0.5 ? 1 : 0;
    m.seed = Math.round(nodeGraphPluckHitParam(node, "seed", 0));
    m.curve = nodeGraphPluckHitParam(node, "curve", 0);
  }
  return m;
}

function nodeGraphPluckHitFormatSeconds(s) {
  if (!Number.isFinite(s)) return "∞";
  if (s < 0.01) return `${(s * 1000).toFixed(2)} ms`;
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`;
  if (s < 10) return `${s.toFixed(2)} s`;
  return `${s.toFixed(1)} s`;
}

// ---- live state ----

function nodeGraphPluckHitLive(section, node, m, look, now) {
  const st = section._pluckHitLive || (section._pluckHitLive = { hits: Number.NaN, traces: [], lastElapsed: -1 });
  if (m.type === "combResonator" || !look.liveTrace || typeof nodeGraphModuleScopeLatestOutputValue !== "function") {
    st.traces.length = 0;
    st.hits = Number.NaN;
    return st;
  }
  const id = String(node.id);
  const hits = Number(nodeGraphModuleScopeLatestOutputValue(id, "__Hits", Number.NaN));
  const elapsed = Number(nodeGraphModuleScopeLatestOutputValue(id, "__Elapsed", -1));
  const peak = Number(nodeGraphModuleScopeLatestOutputValue(id, "__Peak", 0));
  const vel = Number(nodeGraphModuleScopeLatestOutputValue(id, "__Vel", Number.NaN));
  if (Number.isFinite(hits)) {
    if (Number.isFinite(st.hits) && hits > st.hits) {
      // New hit: Choke clears what was there, Stack lets it fade out underneath.
      if (m.retrigger === 1) st.traces.length = 0;
      else st.traces.forEach((tr) => { if (!Number.isFinite(tr.fadeFrom)) tr.fadeFrom = now; });
      st.traces.push({ t: [], v: [], vel: Number.isFinite(vel) ? vel : 1, fadeFrom: Number.NaN });
    } else if (Number.isFinite(st.hits) && hits < st.hits) {
      st.traces.length = 0; // engine restarted
    }
    st.hits = hits;
  }
  const cur = st.traces[st.traces.length - 1];
  if (cur && Number.isFinite(elapsed) && elapsed >= 0 && Number.isFinite(peak)) {
    if (Number.isFinite(vel)) cur.vel = vel;
    const lastT = cur.t.length ? cur.t[cur.t.length - 1] : -1;
    if (elapsed > lastT && cur.t.length < NODE_GRAPH_PLUCK_HIT_MAX_POINTS) {
      cur.t.push(elapsed);
      cur.v.push(Math.abs(peak));
    }
  }
  st.lastElapsed = Number.isFinite(elapsed) ? elapsed : -1;
  // Stack fades: drop traces once fully faded.
  const fade = look.fadeTime;
  st.traces = st.traces.filter((tr) => !Number.isFinite(tr.fadeFrom) || (fade > 0 && now - tr.fadeFrom < fade));
  return st;
}

// ---- draw ----

function drawNodeGraphPluckHitFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.(".node-display-face");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const look = nodeGraphPluckHitFaceSettingsForNode(node);
  const m = nodeGraphPluckHitModel(node);
  const now = performance.now() / 1000;
  const audioLive = typeof scopePaintIsLive === "function" ? scopePaintIsLive() : true;
  const live = nodeGraphPluckHitLive(section, node, m, look, now);
  const cur = live.traces[live.traces.length - 1] || null;

  // Window: ~1.2 x T60 of the body; eased in log time so it never jumps.
  // (the longest curve: with Low Cut up, a higher partial outlasts the body)
  const tauMax = m.curves.reduce((acc, c) => (c.tau > acc ? c.tau : acc), m.tau);
  const t60 = tauMax * Math.log(1000);
  const target = m.feedforward ? 1 : (Number.isFinite(t60) && t60 > 0 ? 1.2 * t60 : (section._pluckHitWin || 2));
  const prevNow = section._pluckHitNow || now;
  const dt = Math.min(0.25, Math.max(0, now - prevNow));
  section._pluckHitNow = now;
  let win = section._pluckHitWin;
  if (!(win > 0) || section._pluckHitType !== m.type) win = target;
  else {
    const k = dt > 0 ? Math.min(1, dt * 6) : 0;
    win = Math.exp(Math.log(win) + (Math.log(target) - Math.log(win)) * k);
    if (Math.abs(Math.log(win / target)) < 0.003) win = target;
  }
  section._pluckHitWin = win;
  section._pluckHitType = m.type;
  section._pluckHitSettling = win !== target;

  // Static picture from the knobs only (full-velocity hit at Level): per-note
  // velocity / ƒ never rescale the curve or the axis. A live trace above the
  // top (Stack piling up) is drawn at the top edge and labelled with its real
  // peak, so it never looks like a clip that is not there.
  const A0 = Number.isFinite(m.level) ? m.level : 1;
  let measuredMax = 0;
  live.traces.forEach((tr) => { for (let i = 0; i < tr.v.length; i += 1) if (tr.v[i] > measuredMax) measuredMax = tr.v[i]; });
  const ffPeak = m.feedforward ? Math.abs(A0) * (1 + Math.abs(m.depth || 0)) : 0;
  const yMax = Math.max(Math.abs(A0), ffPeak, 1e-9);
  const over = look.liveTrace && measuredMax > yMax * 1.0005 ? measuredMax : 0;

  const elapsed = live.lastElapsed;
  const ringing = cur && audioLive && elapsed >= 0 && elapsed < Math.max(win, 0.05) * 1.5;
  const sig = [w, h, pixelRatio, look.backgroundColor, look.barColor, look.lightColor, look.textColor, look.liveTrace,
    m.type, m.f, m.decay, m.damping, m.lowCut, m.invert, m.hold, m.feedforward, m.depth, m.level, m.shape, m.soft, m.width, m.seed, m.curve,
    win.toPrecision(5), yMax.toPrecision(4), over.toPrecision(3), live.traces.length,
    cur ? `${cur.t.length}:${cur.vel}` : "-", ringing ? elapsed.toFixed(3) : "idle",
    live.traces.some((tr) => Number.isFinite(tr.fadeFrom)) ? now.toFixed(2) : ""].join("|");
  if (sig === section._pluckHitSig && !section._pluckHitForceDraw) return;
  section._pluckHitSig = sig;
  section._pluckHitForceDraw = false;

  const hex = (css, fb) => (typeof nodeGraphGlGraphParseCssColor === "function" ? nodeGraphGlGraphParseCssColor(css, fb) : fb);
  const bg = hex(look.backgroundColor, [0.02, 0.03, 0.04, 1]);
  const fg = hex(look.barColor, [0.5, 0.78, 0.85, 1]);
  const lv = hex(look.lightColor, [1, 0.82, 0.48, 1]);
  const ink = hex(look.textColor, [0.55, 0.62, 0.67, 1]);
  const alpha = (c, a) => [c[0], c[1], c[2], (c[3] ?? 1) * a];
  const batch = nodeGraphGlLinesBegin(canvas, bg, { scale: pixelRatio });
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "pluck hit: no shared GL device");
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const stroke = (pts, half, rgba) => {
    if (pts.length < 4) return;
    if (typeof nodeGraphGlLinesStroke === "function") nodeGraphGlLinesStroke(batch, pts, half, fine, rgba);
    else nodeGraphGlLinesPolyline(batch, pts, half, fine, rgba);
  };
  const font = "\"Cascadia Mono\", Consolas, \"Courier New\", monospace";
  const text = (s, x, y, align, baseline, rgba, px = 9) => nodeGraphGlLinesText(batch, s, x, y, {
    px, rgba, align, baseline, weight: 400, family: font,
  });

  const pad = 5;
  const axisH = 11;
  const hasExciter = m.type !== "combResonator";
  const stripW = hasExciter ? Math.round(Math.max(30, Math.min(84, w * 0.22))) : 0;
  const top = pad + 1;
  const floor = h - pad - axisH;
  const x0 = pad + stripW + (hasExciter ? 5 : 0);
  const x1 = w - pad;
  const plotW = Math.max(1, x1 - x0);
  const plotH = Math.max(1, floor - top);
  const yOf = (v) => floor - (v / yMax) * plotH;
  const yLive = (v) => floor - (Math.min(v, yMax) / yMax) * plotH;

  // Exciter strip: one period, burst at its start.
  if (hasExciter) {
    const sx0 = pad;
    const sx1 = pad + stripW;
    const mid = top + plotH * 0.5;
    const amp = plotH * 0.42;
    nodeGraphGlLinesRect(batch, sx0, top, stripW, plotH, alpha(fg, 0.06));
    nodeGraphGlLinesRect(batch, sx0, mid, stripW, fine, alpha(ink, 0.35));
    const f = m.f > 0 ? m.f : 1;
    const burst = nodeGraphPluckHitBurst(m.shape, m.soft, m.width, f, m.sr, m.type === "combPluck" ? m.lowCut : 0, m.seed || 0, m.curve || 0);
    const periodSamples = m.sr / Math.min(Math.max(f, 1), m.sr * 0.499);
    const burstW = Math.min(stripW, stripW * (burst.len / periodSamples));
    const pts = [sx0, mid];
    const n = burst.samples.length;
    for (let i = 0; i < n; i += 1) pts.push(sx0 + burstW * ((i + 0.5) / n), mid - burst.samples[i] * amp);
    pts.push(sx0 + burstW, mid, sx1, mid);
    stroke(pts, 0.6, alpha(fg, 0.95));
    nodeGraphGlLinesRect(batch, sx1 - fine, top, fine, plotH, alpha(ink, 0.35));
    // Shape under the strip; the strip spans one period (tick at its end).
    text(NODE_GRAPH_PLUCK_HIT_SHAPES[m.shape] || "", sx0 + stripW * 0.5, h - pad, "center", "bottom", alpha(ink, 0.85));
  }

  // Floor line.
  nodeGraphGlLinesRect(batch, x0, floor, plotW, fine, alpha(ink, 0.35));

  if (m.feedforward) {
    // Feedforward: magnitude response over 0 .. 8 f (or Nyquist).
    const f = m.f > 0 ? m.f : 110;
    const D = m.sr / f;
    const sgn = m.invert ? -1 : 1;
    const hzMax = Math.min(m.sr * 0.5, 8 * f);
    const pts = [];
    const steps = Math.max(64, Math.ceil(plotW * 2));
    for (let i = 0; i <= steps; i += 1) {
      const hz = (hzMax * i) / steps;
      const wv = 2 * Math.PI * hz / m.sr;
      const re = 1 + sgn * (m.depth || 0) * Math.cos(wv * D);
      const im = -sgn * (m.depth || 0) * Math.sin(wv * D);
      pts.push(x0 + (plotW * i) / steps, yOf(Math.abs(m.level) * Math.hypot(re, im)));
    }
    nodeGraphGlLinesFillUnder(batch, pts, floor, alpha(fg, 0.12));
    stroke(pts, 0.7, fg);
    text("Feedforward: no ring", x0 + 2, top + 1, "left", "top", alpha(ink, 0.9));
    text("0", x0, h - pad, "left", "bottom", alpha(ink, 0.8));
    text(`${Math.round(hzMax)} Hz`, x1, h - pad, "right", "bottom", alpha(ink, 0.8));
  } else {
    const xOf = (t) => x0 + (t / win) * plotW;
    const steps = Math.max(48, Math.ceil(plotW));
    const curvePts = (tau, a0) => {
      const pts = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = (win * i) / steps;
        const v = Number.isFinite(tau) ? a0 * Math.exp(-t / tau) : a0;
        pts.push(x0 + (plotW * i) / steps, yOf(Math.abs(v)));
      }
      return pts;
    };
    // Top partial first (behind), then the body.
    for (let ci = m.curves.length - 1; ci >= 0; ci -= 1) {
      const c = m.curves[ci];
      const pts = curvePts(c.tau, A0);
      if (ci === 0) {
        nodeGraphGlLinesFillUnder(batch, pts, floor, alpha(fg, 0.1));
        stroke(pts, 0.75, alpha(fg, 0.9));
      } else {
        stroke(pts, 0.5, alpha(fg, 0.45));
        const tp = Number.isFinite(c.tau) ? Math.min(win, c.tau) : win;
        text(`partial ${c.partial}`, Math.min(x1 - 2, xOf(tp) + 3), yOf(Math.abs(A0) * Math.exp(-tp / c.tau)) - 2, "left", "bottom", alpha(ink, 0.7), 8);
      }
    }
    // dB ticks on the body curve.
    if (Number.isFinite(m.tau) && m.tau > 0) {
      [20, 40, 60].forEach((db) => {
        const t = m.tau * (db / 20) * Math.LN10;
        if (!(t <= win)) return;
        const x = xOf(t);
        nodeGraphGlLinesRect(batch, x - fine * 0.5, floor - 4, fine, 4, alpha(ink, 0.8));
        const yv = yOf(Math.abs(A0) * Math.pow(10, -db / 20));
        nodeGraphGlLinesRect(batch, x - 1, yv - 1, 2, 2, alpha(fg, 0.95));
        text(`-${db}`, x, floor - 5, "center", "bottom", alpha(ink, 0.85), 8);
      });
    }
    // Live traces: older ones (Stack) fade, the current one is bright with a glow tail.
    if (look.liveTrace && hasExciter) {
      const fade = look.fadeTime;
      live.traces.forEach((tr, ti) => {
        if (tr.t.length < 2) return;
        const isCur = ti === live.traces.length - 1;
        let a = 1;
        if (Number.isFinite(tr.fadeFrom)) a = fade > 0 ? Math.max(0, 1 - (now - tr.fadeFrom) / fade) * 0.6 : 0;
        else if (!ringing) a = 0.55; // idle: last hit stays, dimmed
        if (!(a > 0.01)) return;
        const pts = [];
        for (let i = 0; i < tr.t.length; i += 1) {
          if (tr.t[i] > win) break;
          pts.push(xOf(tr.t[i]), yLive(tr.v[i]));
        }
        if (pts.length < 4) return;
        stroke(pts, 0.8, alpha(lv, a));
        if (isCur && ringing) {
          // Glow tail: the last ~12 % of the window behind the playhead.
          const tailFrom = Math.max(0, Math.min(elapsed, win) - win * 0.12);
          const tail = [];
          for (let i = 0; i < pts.length; i += 2) if (((pts[i] - x0) / plotW) * win >= tailFrom) tail.push(pts[i], pts[i + 1]);
          if (tail.length >= 4) {
            stroke(tail, 2.4, alpha(lv, 0.18));
            stroke(tail, 1.3, alpha(lv, 0.35));
          }
        }
      });
      if (cur && ringing) {
        // Playhead: real time from the Trigger edge; parks at the right edge.
        const parked = elapsed >= win;
        const xp = parked ? x1 : xOf(elapsed);
        nodeGraphGlLinesRect(batch, xp - fine * 0.5, top, fine, plotH, alpha(lv, parked ? 0.45 : 0.75));
        const last = cur.v.length ? cur.v[cur.v.length - 1] : 0;
        nodeGraphGlLinesRect(batch, xp - 1.5, yLive(last) - 1.5, 3, 3, alpha(lv, 1));
      }
      if (over > 0) text(`peak ${(over / yMax).toFixed(2)}x`, x0 + 2, top + 1, "left", "top", alpha(lv, 0.9), 8);
    }
    // Labels.
    const t60Label = m.hold ? "Hold: rings forever" : `T60 ${nodeGraphPluckHitFormatSeconds(t60)}`;
    text(t60Label, x1, top + 1, "right", "top", alpha(ink, 0.9));
    text("0", x0, h - pad, "left", "bottom", alpha(ink, 0.8));
    text(nodeGraphPluckHitFormatSeconds(win), x1, h - pad, "right", "bottom", alpha(ink, 0.8));
  }
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "pluck hit: GL present failed");
  }
}

function createNodeGraphPluckHitFace(nodeId, type = "combPluck") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-pluck-hit-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "combPluck");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-pluck-hit-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `pluckHit:${el.dataset?.node || ""}`,
    forceKey: "_pluckHitForceDraw",
    rafKey: "_pluckHitRaf",
    paint: drawNodeGraphPluckHitFace,
    // Keep painting while the time axis eases to a new range, even when stopped.
    shouldAnimate: (el) => Boolean(el._pluckHitSettling) || (
      typeof scopePaintFaceShouldAnimate === "function"
        ? scopePaintFaceShouldAnimate(el)
        : (typeof scopePaintIsLive === "function" ? scopePaintIsLive() : true)
    ),
    onResize: (el) => {
      el._pluckHitForceDraw = true;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    section._pluckHitForceDraw = true;
    drawNodeGraphPluckHitFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.pluckHitFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("pluckHitFace", createNodeGraphPluckHitFace);
}
