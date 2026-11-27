// Hyperbolic Decay: closed-form curve for the Envelope Curve face (same formula as
// native_modules/hyperbolic_decay). No simulation: one evaluation per column.
//   u(x) = |w| > 1e-5 ? (exp(w x) - 1) / (exp(w) - 1) : x          (Shape w, exp time warp)
//   decay:  env = start * end / ((start - end) u(x) + end)           start = 1, end = 0.001
//   attack: the decay run backwards, env = start * end / ((start - end) u(1 - x) + end)
//           (the same Attack / Decay and shapes give a symmetrical envelope)
//   Out = env * Amplitude. Attack 0 = no attack stage.

const NODE_GRAPH_HYPERBOLIC_DECAY_END = 0.001;

function nodeGraphHyperbolicDecayWarp01(x, w) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (w > -1e-5 && w < 1e-5) return x;
  const den = Math.exp(w) - 1;
  if (den > -1e-12 && den < 1e-12) return x;
  return (Math.exp(w * x) - 1) / den;
}

function nodeGraphHyperbolicDecayHyper(v) {
  const end = NODE_GRAPH_HYPERBOLIC_DECAY_END;
  const den = (1 - end) * v + end;
  return den === 0 ? end : end / den;
}

/** Decay level 0..1 (before Amplitude) at x = t / Decay, for a trigger of height 1. */
function nodeGraphHyperbolicDecayLevel(x, shape) {
  return nodeGraphHyperbolicDecayHyper(nodeGraphHyperbolicDecayWarp01(x, shape));
}

/** Attack level at x = t / Attack: rises from 0.001 to 1, the decay curve in reverse. */
function nodeGraphHyperbolicDecayRiseLevel(x, shape) {
  return nodeGraphHyperbolicDecayLevel(1 - x, shape);
}

/**
 * points: { t: 0..1 over Attack + Decay, y }. guideT is where the attack ends (0 = no attack).
 * The curve is near vertical at its turns (the end of the attack, the start of the decay), so it is not
 * sampled once per pixel column: the peak is always a point, and any span that would jump more than a pixel
 * is split until it does not (heightPx = the face height). The line is then always full height.
 */
function nodeGraphHyperbolicDecayPreviewCurve(params = {}, points = 160, heightPx = 40) {
  const duration = Math.max(1e-6, Number(params.duration) || 2);
  const shape = Number.isFinite(Number(params.shape)) ? Number(params.shape) : 0;
  const attack = Math.max(0, Number.isFinite(Number(params.attack)) ? Number(params.attack) : 0);
  const attackShape = Number.isFinite(Number(params.attackShape)) ? Number(params.attackShape) : 0;
  // Magnitude: the face draws the sign (a negative Amplitude hangs the curve from the top).
  const amplitude = Number.isFinite(Number(params.amplitude)) ? Math.abs(Number(params.amplitude)) : 1;
  const total = attack + duration;
  const aFrac = attack > 0 ? attack / total : 0;
  const n = Math.max(64, Math.floor(points));
  const at = (t) => (aFrac > 0 && t < aFrac
    ? nodeGraphHyperbolicDecayRiseLevel(t / aFrac, attackShape)
    : nodeGraphHyperbolicDecayLevel(aFrac > 0 ? (t - aFrac) / (1 - aFrac) : t, shape));
  const ts = [];
  for (let i = 0; i < n; i += 1) ts.push(i / (n - 1));
  if (aFrac > 0) {
    // The peak is always drawn, whatever pixel it falls between.
    const k = ts.findIndex((t) => t >= aFrac);
    if (k > 0 && ts[k] !== aFrac) ts.splice(k, 0, aFrac);
  }
  const px = Math.max(1, Number(heightPx) || 40) * Math.min(1, amplitude || 1);
  const out = [];
  const maxPoints = 6000;
  const refine = (t0, y0, t1, y1, depth) => {
    if (depth >= 14 || out.length >= maxPoints || Math.abs(y1 - y0) * px <= 1) return;
    const tm = (t0 + t1) / 2;
    const ym = at(tm);
    refine(t0, y0, tm, ym, depth + 1);
    out.push({ t: tm, y: ym });
    refine(tm, ym, t1, y1, depth + 1);
  };
  let prev = null;
  for (const t of ts) {
    const y = at(t);
    if (prev) refine(prev.t, prev.y, t, y, 0);
    out.push({ t, y });
    prev = { t, y };
  }
  return { points: out, total, guideT: aFrac, ampView: Math.min(1, amplitude) };
}
