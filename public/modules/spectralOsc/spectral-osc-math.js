// Spectral Oscillator math (JS twin of native_modules/spectral_osc/spectral_osc.cpp).
// Harmonic n of each shape from its closed-form Fourier series, the Gaussian
// band-limit taper exp(-a (n/N)^2) (-60 dB at the Nyquist harmonic N, a positive
// single-humped kernel: no Gibbs overshoot or ripple) and the Sine rolloff
// r^(n-1), r = 1 - Sine^3. The face draws spectralOscBakeCycle: the exact cycle
// for the current Shape / A / B (no snapshot crossfade).

const SPECTRAL_OSC_SHAPES = Object.freeze(["Center Edge", "Pulse", "Trisaw", "Formant", "Comb"]);
// Face labels of the two controls, per shape.
const SPECTRAL_OSC_CONTROL_LABELS = Object.freeze([
  Object.freeze(["Edge", "Sine"]),
  Object.freeze(["Width", "Sine"]),
  Object.freeze(["Peak", "Sine"]),
  Object.freeze(["Formant", "Width"]),
  Object.freeze(["Spacing", "Depth"]),
]);
const SPECTRAL_OSC_TAPER_A = Math.log(1000);
const SPECTRAL_OSC_TABLE_REACH = 1.5;

function spectralOscClamp(x, lo, hi) {
  const v = Number(x);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
}

function spectralOscShapeIndex(shape) {
  const v = Math.floor(Number(shape) + 0.5);
  return Number.isFinite(v) ? Math.max(0, Math.min(SPECTRAL_OSC_SHAPES.length - 1, v)) : 0;
}

// Piecewise-linear wave: knots [t, value jump, slope jump] -> { a, b } of harmonic n.
function spectralOscKnotsCoef(knots, n, scale = 1) {
  const w = 2 * Math.PI * n;
  let re = 0;
  let im = 0;
  for (const [t, d, c] of knots) {
    const th = 2 * Math.PI * ((n * t) % 1);
    const s = Math.sin(th);
    const co = Math.cos(th);
    re += -d * s / w - c * co / (w * w);
    im += -d * co / w + c * s / (w * w);
  }
  return { a: 2 * re * scale, b: -2 * im * scale };
}

/** Harmonic n (>= 1) of a shape before band-limiting: a cos(2 pi n t) + b sin(2 pi n t). */
function spectralOscShapeCoef(shape, A, B, n) {
  switch (spectralOscShapeIndex(shape)) {
    case 0: {
      const p = spectralOscClamp(A, 0.001, 0.999);
      return spectralOscKnotsCoef([[0, 0, 1 / p - 1 / (1 - p)], [p, -2, 1 / (1 - p) - 1 / p]], n);
    }
    case 1: {
      const w = spectralOscClamp(A, 0.001, 0.999);
      const peak = Math.max(2 - 2 * w, 2 * w);
      return spectralOscKnotsCoef([[0, 2, 0], [w, -2, 0]], n, 1 / peak);
    }
    case 2: {
      const p = spectralOscClamp(A, 0.001, 0.999);
      const up = 2 / p;
      const down = -2 / (1 - p);
      return spectralOscKnotsCoef([[0.5 * p, 0, down - up], [1 - 0.5 * p, 0, up - down]], n);
    }
    case 3: {
      const center = 7 * spectralOscClamp(A, 0, 1);
      const width = 0.1 + 2.9 * spectralOscClamp(B, 0, 1);
      const x = (Math.log2(n) - center) / width;
      return { a: Math.exp(-0.5 * x * x), b: 0 };
    }
    case 4: {
      const spacing = 2 ** (1 + 4 * spectralOscClamp(A, 0, 1));
      const depth = spectralOscClamp(B, 0, 1);
      const comb = 1 - depth * 0.5 * (1 + Math.cos(2 * Math.PI * ((n / spacing) % 1)));
      return { a: 0, b: (2 / Math.PI) * (n % 2 ? 1 : -1) / n * comb };
    }
    default:
      return { a: 0, b: 0 };
  }
}

function spectralOscHasSine(shape) {
  return spectralOscShapeIndex(shape) <= 2;
}

function spectralOscSineR(sine) {
  const s = spectralOscClamp(sine, 0, 1);
  return 1 - s * s * s;
}

/**
 * Band-limited harmonics for Nyquist harmonic count N: [{ n, a, b }] up to
 * 1.5 N, each times exp(-a (n/N)^2) and (Sine shapes) r^(n-1).
 */
function spectralOscHarmonics(shape, A, B, N) {
  const K = Math.max(1, Math.floor(SPECTRAL_OSC_TABLE_REACH * N));
  const r = spectralOscHasSine(shape) ? spectralOscSineR(B) : 1;
  const out = [];
  let rp = 1;
  for (let n = 1; n <= K; n += 1) {
    const c = spectralOscShapeCoef(shape, A, B, n);
    const g = Math.exp(-SPECTRAL_OSC_TAPER_A * (n / N) ** 2) * rp;
    out.push({ n, a: c.a * g, b: c.b * g });
    rp *= r;
    if (rp < 1e-30) rp = 0;
  }
  return out;
}

/** One cycle (length points) for Nyquist harmonic count N, unscaled. */
function spectralOscCycle(shape, A, B, N, length, dest = null) {
  const out = dest && dest.length === length ? dest : new Float64Array(length);
  const hs = spectralOscHarmonics(shape, A, B, N).filter((h) => Math.abs(h.a) + Math.abs(h.b) > 1e-12);
  for (let j = 0; j < length; j += 1) {
    const t = j / length;
    let y = 0;
    for (const h of hs) {
      const th = 2 * Math.PI * ((h.n * t) % 1);
      y += h.a * Math.cos(th) + h.b * Math.sin(th);
    }
    out[j] = y;
  }
  return out;
}

/** Output gain from a built cycle's range: every shape to peak 1 (Sine 1 = a unit sine). */
function spectralOscGain(shape, min, max) {
  const peak = Math.max(max, -min);
  if (!(peak > 1e-12)) return 0;
  void shape;
  return 1 / peak;
}

/** The face cycle: N = 256 harmonics' worth of detail at `length` points, gain applied. */
function spectralOscBakeCycle(params, length = 256, dest = null) {
  const shape = spectralOscShapeIndex(params?.shape);
  const A = spectralOscClamp(params?.shapeA ?? 0.5, 0, 1);
  const B = spectralOscClamp(params?.shapeB ?? 0, 0, 1);
  const N = Math.max(8, Math.floor(length / 3));
  const out = spectralOscCycle(shape, A, B, N, length, dest);
  let mn = 0;
  let mx = 0;
  for (let i = 0; i < out.length; i += 1) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
  const g = spectralOscGain(shape, mn, mx);
  for (let i = 0; i < out.length; i += 1) out[i] *= g;
  return out;
}

/** Face labels of the A / B controls for a node's Shape. */
function spectralOscControlLabels(shape) {
  return SPECTRAL_OSC_CONTROL_LABELS[spectralOscShapeIndex(shape)];
}