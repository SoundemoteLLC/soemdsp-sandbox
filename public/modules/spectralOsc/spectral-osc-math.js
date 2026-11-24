// Spectral Oscillator math (JS twin of native_modules/spectral_osc/spectral_osc.cpp).
// Harmonic n of each shape from its closed-form Fourier series (Asym Sine: an
// 8192-point FFT of its exact formula; Glass / Bell: partial lists split between
// neighbouring harmonics), the band-limit taper exp(-a (n/(K+1))^p) (Gibbs 0:
// p = 2, a positive single-humped kernel, no Gibbs ringing; Gibbs 1: brick wall)
// and the Sine rolloff r^(n-1), r = 1 - Sine^3. Single trigger keeps the shape's DC
// (spectralOscDc; Free run is DC-free). The face draws spectralOscBakeCycle: the
// exact cycle for the current Shape / A / B / Gibbs / Cycle mode.

const SPECTRAL_OSC_SHAPES = Object.freeze(["Center Edge", "Pulse", "Trisaw", "Formant", "Comb", "Asym Sine", "Glass", "Bell"]);
// Face labels of the two controls, per shape.
const SPECTRAL_OSC_CONTROL_LABELS = Object.freeze([
  Object.freeze(["Edge", "Sine"]),
  Object.freeze(["Width", "Sine"]),
  Object.freeze(["Peak", "Sine"]),
  Object.freeze(["Formant", "Width"]),
  Object.freeze(["Spacing", "Depth"]),
  Object.freeze(["Sharp", "Skew"]),
  Object.freeze(["Stretch", "Sine"]),
  Object.freeze(["Stretch", "Sine"]),
]);
// Top harmonic of each native table: 3 per octave, round(2^(j/3)), repeats dropped.
const SPECTRAL_OSC_TABLE_K = Object.freeze([
  1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25, 32, 40, 51, 64,
  81, 102, 128, 161, 203, 256, 323, 406, 512, 645, 813, 1024,
]);
const SPECTRAL_OSC_MAX_K = 1024;
const SPECTRAL_OSC_TAPER_A = Math.log(1000);
const SPECTRAL_OSC_ASYM_FFT = 8192;
const SPECTRAL_OSC_WARP_KNOTS = Object.freeze([-0.97, -0.87, -0.73, -0.66, -0.49, -0.19, 0, 0.19, 0.49, 0.66, 0.73, 0.87, 0.97]);
const SPECTRAL_OSC_BELL_RATIO = Object.freeze([1, 1.2, 1.5, 2, 2.5, 3, 4.2, 5.4]);
const SPECTRAL_OSC_BELL_AMP = Object.freeze([1, 0.8, 0.45, 0.9, 0.5, 0.45, 0.35, 0.3]);

function spectralOscClamp(x, lo, hi) {
  const v = Number(x);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
}

function spectralOscShapeIndex(shape) {
  const v = Math.floor(Number(shape) + 0.5);
  return Number.isFinite(v) ? Math.max(0, Math.min(SPECTRAL_OSC_SHAPES.length - 1, v)) : 0;
}

const spectralOscFrac = (x) => x - Math.floor(x);

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

/** Harmonic n (>= 1) of the closed-form shapes 0..4 before band-limiting: a cos(2 pi n t) + b sin(2 pi n t). */
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

/** Asym Sine Skew (0..1) -> Wavetable 2D warp k (its 13 knots, piecewise linear). */
function spectralOscAsymSkewK(B) {
  const pos = spectralOscClamp(B, 0, 1) * 12;
  const i = Math.min(11, Math.floor(pos));
  const f = pos - i;
  return SPECTRAL_OSC_WARP_KNOTS[i] + (SPECTRAL_OSC_WARP_KNOTS[i + 1] - SPECTRAL_OSC_WARP_KNOTS[i]) * f;
}

/** Asym Sine at phase t: Sharp crossfades parabola (cusp bottom) / cosine / parabola (cusp top); Skew warps time. */
function spectralOscAsymValue(sharp, k, t) {
  let x = t;
  if (k !== 0) {
    const cv = k * t;
    const den = 2 * cv - k + 1;
    if (Math.abs(den) > 1e-12) x = (cv + t) / den;
  }
  x = spectralOscFrac(x);
  const u = spectralOscFrac(x + 0.5) - 0.5;
  const f0 = 0.5 - 6 * u * u;
  const v = x - 0.5;
  const f2 = 6 * v * v - 0.5;
  const c = Math.cos(2 * Math.PI * x);
  if (sharp <= 0.5) { const m = 2 * sharp; return (1 - m) * f0 + m * c; }
  const m = 2 * sharp - 1;
  return (1 - m) * c + m * f2;
}

/** In-place radix-2 forward FFT (e^-i). */
function spectralOscFft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    for (let k = 0; k < half; k += 1) {
      const wr = Math.cos((2 * Math.PI * k) / size);
      const wi = -Math.sin((2 * Math.PI * k) / size);
      for (let i = 0; i < n; i += size) {
        const i0 = i + k, i1 = i0 + half;
        const tr = wr * re[i1] - wi * im[i1];
        const ti = wr * im[i1] + wi * re[i1];
        re[i1] = re[i0] - tr; im[i1] = im[i0] - ti;
        re[i0] += tr; im[i0] += ti;
      }
    }
  }
}

function spectralOscAddPartial(sa, sb, x, amp, phaseTurns) {
  if (!(x >= 1)) return;
  const n0 = Math.floor(x);
  const f = x - n0;
  const th = 2 * Math.PI * spectralOscFrac(phaseTurns);
  const s = Math.sin(th), c = Math.cos(th);
  if (n0 >= 1 && n0 <= SPECTRAL_OSC_MAX_K) { sa[n0] += (1 - f) * amp * s; sb[n0] += (1 - f) * amp * c; }
  if (f > 0 && n0 + 1 <= SPECTRAL_OSC_MAX_K) { sa[n0 + 1] += f * amp * s; sb[n0 + 1] += f * amp * c; }
}

/** Unweighted spectrum { a, b } (index n = 1..1024) of a shape, before taper / Sine. */
function spectralOscSpectrum(shape, A, B, asymFft = SPECTRAL_OSC_ASYM_FFT) {
  const s = spectralOscShapeIndex(shape);
  const sa = new Float64Array(SPECTRAL_OSC_MAX_K + 1);
  const sb = new Float64Array(SPECTRAL_OSC_MAX_K + 1);
  if (s <= 4) {
    for (let n = 1; n <= SPECTRAL_OSC_MAX_K; n += 1) { const c = spectralOscShapeCoef(s, A, B, n); sa[n] = c.a; sb[n] = c.b; }
  } else if (s === 5) {
    const sharp = spectralOscClamp(A, 0, 1);
    const k = spectralOscAsymSkewK(B);
    const re = new Float64Array(asymFft), im = new Float64Array(asymFft);
    for (let j = 0; j < asymFft; j += 1) re[j] = spectralOscAsymValue(sharp, k, j / asymFft);
    spectralOscFft(re, im);
    const sc = 2 / asymFft;
    sa[0] = re[0] / asymFft; // the formula's mean (kept in Single trigger)
    for (let n = 1; n <= SPECTRAL_OSC_MAX_K; n += 1) { sa[n] = sc * re[n]; sb[n] = -sc * im[n]; }
  } else if (s === 6) {
    const p = 1.2 + 0.8 * spectralOscClamp(A, 0, 1);
    for (let k = 1; k <= 12; k += 1) {
      const x = k === 1 ? 1 : Math.exp(p * Math.log(k));
      const amp = k === 1 ? 1 : 0.6 * Math.exp(-0.35 * Math.log(k));
      spectralOscAddPartial(sa, sb, x, amp, k === 1 ? 0 : k * 0.6180339887498949);
    }
  } else {
    const S = 1 + 3 * spectralOscClamp(A, 0, 1);
    spectralOscAddPartial(sa, sb, 1, 0.55, 0);
    for (let i = 0; i < 8; i += 1) {
      spectralOscAddPartial(sa, sb, 1 + (2 * SPECTRAL_OSC_BELL_RATIO[i] - 1) * S, SPECTRAL_OSC_BELL_AMP[i], (i + 1) * 0.7548776662466927);
    }
  }
  return { a: sa, b: sb };
}

function spectralOscHasSine(shape) {
  const s = spectralOscShapeIndex(shape);
  return s <= 2 || s === 6 || s === 7;
}

function spectralOscSineR(sine) {
  const s = spectralOscClamp(sine, 0, 1);
  return 1 - s * s * s;
}

/** Band-limit taper of harmonic n in a table with top harmonic K at Gibbs G. */
function spectralOscTaper(n, K, gibbs = 0) {
  const G = spectralOscClamp(gibbs, 0, 1);
  if (G >= 0.999999) return 1;
  const p = 2 / (1 - G);
  return Math.exp(-SPECTRAL_OSC_TAPER_A * Math.exp(p * Math.log(n / (K + 1))));
}

/** Band-limited harmonics of a table with top harmonic K: [{ n, a, b }], n = 1..K. */
function spectralOscHarmonics(shape, A, B, K, gibbs = 0, spectrum = null) {
  const sp = spectrum || spectralOscSpectrum(shape, A, B);
  const r = spectralOscHasSine(shape) ? spectralOscSineR(B) : 1;
  const out = [];
  let rp = 1;
  for (let n = 1; n <= Math.min(K, SPECTRAL_OSC_MAX_K); n += 1) {
    const g = spectralOscTaper(n, K, gibbs) * rp;
    out.push({ n, a: sp.a[n] * g, b: sp.b[n] * g });
    rp *= r;
    if (rp < 1e-30) rp = 0;
  }
  return out;
}

/**
 * Single-trigger DC of the table with top harmonic K. Center Edge / Pulse / Trisaw /
 * Comb start at 0: the DC puts the band-limited (Sine 0) table's start exactly there
 * (-> the true mean as K grows), weighted by r for Sine so Sine 1 stays a pure sine.
 * Asym Sine: its formula's mean. Formant / Glass / Bell: none.
 */
function spectralOscDc(shape, A, B, K, gibbs = 0, spectrum = null) {
  const s = spectralOscShapeIndex(shape);
  const sp = spectrum || spectralOscSpectrum(s, A, B);
  if (s === 5) return sp.a[0];
  if (s === 3 || s >= 6) return 0;
  let v = 0;
  for (let n = 1; n <= Math.min(K, SPECTRAL_OSC_MAX_K); n += 1) v += sp.a[n] * spectralOscTaper(n, K, gibbs);
  return -v * (spectralOscHasSine(s) ? spectralOscSineR(B) : 1);
}

/** One cycle (length points) of the table with top harmonic K, unscaled (keepDc: Single trigger). */
function spectralOscCycle(shape, A, B, K, length, gibbs = 0, spectrum = null, keepDc = false) {
  const out = new Float64Array(length);
  const sp = spectrum || spectralOscSpectrum(shape, A, B);
  const hs = spectralOscHarmonics(shape, A, B, K, gibbs, sp).filter((h) => Math.abs(h.a) + Math.abs(h.b) > 1e-14);
  const dc = keepDc ? spectralOscDc(shape, A, B, K, gibbs, sp) : 0;
  for (let j = 0; j < length; j += 1) {
    const t = j / length;
    let y = dc;
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
  void shape;
  const peak = Math.max(max, -min);
  if (!(peak > 1e-12)) return 0;
  return 1 / peak;
}

let spectralOscBakeSpectrumKey = "";
let spectralOscBakeSpectrum = null;

/** The face cycle: floor(length / 3) harmonics at `length` points, gain applied; Single trigger (cycleMode 1) keeps the DC. */
function spectralOscBakeCycle(params, length = 256) {
  const shape = spectralOscShapeIndex(params?.shape);
  const A = spectralOscClamp(params?.shapeA ?? 0.5, 0, 1);
  const B = spectralOscClamp(params?.shapeB ?? 0, 0, 1);
  const G = spectralOscClamp(params?.gibbs ?? 0, 0, 1);
  const keepDc = Number(params?.cycleMode) >= 0.5;
  const key = `${shape}|${A}|${B}`;
  if (key !== spectralOscBakeSpectrumKey) {
    spectralOscBakeSpectrum = spectralOscSpectrum(shape, A, B);
    spectralOscBakeSpectrumKey = key;
  }
  const K = Math.max(8, Math.floor(length / 3));
  const out = spectralOscCycle(shape, A, B, K, length, G, spectralOscBakeSpectrum, keepDc);
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