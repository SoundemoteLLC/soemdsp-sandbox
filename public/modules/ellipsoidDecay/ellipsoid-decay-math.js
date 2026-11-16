// Ellipsoid AD: closed-form curve for the Envelope Curve face (same formula as
// native_modules/ellipsoid_decay). No simulation: one evaluation per column.
//   a = pi x / 2
//   circle(x)    = sin a                                        (the sine's rising quarter: fast, then flat)
//   square(x, k) = sin a / sqrt(sin^2 a + (k cos a)^2)          (k = 0 square, k = 1 circle)
// Morph is bipolar, -1..+1 (like contour in the Step Graph), through a straight ramp:
//   0 ramp; 0..+0.5 ramp -> circle; +0.5..+1 circle -> square; -x is 1 - shape(1 - x, x): the slow orientation
//   (-0.5 slow circle, -1 slow square: stays put, then jumps at the end).
//   decay:  env = 1 + (0.001 - 1) shape(x, decay morph)
//   attack: the decay run backwards, env = 1 + (0.001 - 1) shape(1 - x, attack morph)
//           (positive morph: fast down / slow up; negative: slow down / fast up)
//   Attack / Decay Morph (-1..+1) trim the stage morph by a fraction of the remaining room toward +1 (+) or -1 (-),
//   like Skew % in the Step Graph: +1 always reaches +1, -1 always reaches -1.

const NODE_GRAPH_ELLIPSOID_DECAY_END = 0.001;

function nodeGraphEllipsoidDecayEllipse(x, k) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const a = Math.PI * 0.5 * x;
  const sa = Math.sin(a);
  const ca = Math.cos(a) * k;
  const den = sa * sa + ca * ca;
  return den <= 1e-24 ? (sa > 0 ? 1 : 0) : sa / Math.sqrt(den);
}

function nodeGraphEllipsoidDecayShapePos(x, m) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (m <= 0.5) {
    const t = 2 * m;
    return (1 - t) * x + t * nodeGraphEllipsoidDecayEllipse(x, 1);
  }
  return nodeGraphEllipsoidDecayEllipse(x, 1 - (2 * m - 1));
}

/** Progress 0..1 at x for a bipolar morph. */
function nodeGraphEllipsoidDecayProgress(x, m) {
  const mm = Math.max(-1, Math.min(1, Number(m) || 0));
  if (mm >= 0) return nodeGraphEllipsoidDecayShapePos(x, mm);
  return 1 - nodeGraphEllipsoidDecayShapePos(1 - x, -mm);
}

/** Morph trimmed by `trim` (-1..+1) as a fraction of the remaining room toward +1 (+) or -1 (-). */
function nodeGraphEllipsoidDecayRoomMorph(morph, trim) {
  const m = Math.max(-1, Math.min(1, Number(morph) || 0));
  const t = Math.max(-1, Math.min(1, Number(trim) || 0));
  return Math.max(-1, Math.min(1, t >= 0 ? m + t * (1 - m) : m + t * (m + 1)));
}

function nodeGraphEllipsoidDecayLevel(x, morph) {
  return 1 + (NODE_GRAPH_ELLIPSOID_DECAY_END - 1) * nodeGraphEllipsoidDecayProgress(x, morph);
}

function nodeGraphEllipsoidDecayRiseLevel(x, morph) {
  return nodeGraphEllipsoidDecayLevel(1 - x, morph);
}

/** points: { t: 0..1 over Attack + Decay, y }. guideT is where the attack ends (0 = no attack). */
function nodeGraphEllipsoidDecayPreviewCurve(params = {}, points = 160, heightPx = 40) {
  const duration = Math.max(1e-6, Number(params.duration) || 2);
  const attack = Math.max(0, Number.isFinite(Number(params.attack)) ? Number(params.attack) : 0);
  const morph = Number.isFinite(Number(params.morph)) ? Number(params.morph) : 0;
  const attackMorph = nodeGraphEllipsoidDecayRoomMorph(morph, params.attackMorph);
  const decayMorph = nodeGraphEllipsoidDecayRoomMorph(morph, params.decayMorph);
  const amplitude = Math.max(0, Number.isFinite(Number(params.amplitude)) ? Number(params.amplitude) : 1);
  const total = attack + duration;
  const aFrac = attack > 0 ? attack / total : 0;
  const n = Math.max(64, Math.floor(points));
  const at = (t) => (aFrac > 0 && t < aFrac
    ? nodeGraphEllipsoidDecayRiseLevel(t / aFrac, attackMorph)
    : nodeGraphEllipsoidDecayLevel(aFrac > 0 ? (t - aFrac) / (1 - aFrac) : t, decayMorph));
  const ts = [];
  for (let i = 0; i < n; i += 1) ts.push(i / (n - 1));
  if (aFrac > 0) {
    const k = ts.findIndex((t) => t >= aFrac);
    if (k > 0 && ts[k] !== aFrac) ts.splice(k, 0, aFrac);
  }
  // Squares make the turns near vertical: split any span that would jump more than a pixel.
  const px = Math.max(1, Number(heightPx) || 40) * Math.min(1, amplitude || 1);
  const out = [];
  const refine = (t0, y0, t1, y1, depth) => {
    if (depth >= 14 || out.length >= 6000 || Math.abs(y1 - y0) * px <= 1) return;
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
