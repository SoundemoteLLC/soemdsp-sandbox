// soemdsp-native-module: spectral_osc
// soemdsp-native-label: Spectral Oscillator
// soemdsp-native-target: spectralOsc
// soemdsp-native-kind: oscillator
//
// Spectral Oscillator: each cycle is built exactly from its parameters. The
// shape formula gives every harmonic's cosine/sine amplitude (closed-form
// Fourier series, or for Asym Sine an 8192-point FFT of the exact formula, no
// stored snapshot); an inverse FFT turns them into one cycle per table.
//
// Tables: 3 per octave, table j holds harmonics 1..K_j only (K = 1, 2, 3, 4, 5,
// 6, 8, 10, 13, 16, ... 813, 1024; round(2^(j/3)), repeats dropped). Playback uses
// the two tables just below the pitch's Nyquist harmonic count H = (sr/2)/|f|:
// K_j <= H < K_(j+1) blends table j-1 -> j by log distance, so no partial of
// either table is ever above Nyquist (switch to the darker table early). Above
// Nyquist (H < 1) the output fades to silence. Table length >= max(256, 4 K) and
// 6-point Lagrange interpolation (linear left images of the top partials only
// ~40-55 dB down): measured alias/image floor <= -100 dB re the fundamental at
// Gibbs 0 (the taper keeps the top partials quiet), <= -75 dB at Gibbs 1.
//
// Band-limit taper (per table, harmonic n of K): g = exp(-a (n / (K+1))^p),
// a = ln 1000 (-60 dB at K+1, the first harmonic left out). Gibbs 0: p = 2, the
// Gaussian: the spectrum of a positive, single-humped kernel, so a table is the
// ideal wave smoothed (no Gibbs ringing; truncating at K leaves at most ~1e-4).
// Gibbs G: p = 2 / (1 - G), steeper; Gibbs 1: brick wall (g = 1 up to K, the
// plain partial sum with its ~9 % Gibbs ringing).
// "Sine" multiplies harmonic n by r^(n-1) (r = 1 - Sine^3; the positive Poisson
// kernel, as DSF brightness): Sine 1 leaves only the fundamental, a pure sine.
//
// A parameter change rebuilds the tables off the per-sample path: the spectrum,
// then a few tables per audio block into the spare bank, then a 20 ms crossfade
// to it (as Noise Convolution Reverb's IR rebuild). A move while one is building
// waits for it.
//
// Shapes (A, B are the two 0..1 controls):
//   0 Center Edge  A Edge   (ramp 0->1, edge 1->-1 at A, ramp -1->0; Additive CenterSaw series), B Sine
//   1 Pulse        A Width  (+1 / -1; DC only in Single trigger),                                B Sine
//   2 Trisaw       A Peak   (0 -> 1 at A/2 -> -1 at 1-A/2 -> 0; Additive Trisaw: 0.5 triangle, 1 = Center Edge), B Sine
//   3 Formant      A Formant (peak at harmonic 2^(7A), 1..128), B Width (0.1..3 octaves, Gaussian in log2 n), cosine phase
//   4 Comb         A Spacing (notch every 2^(1+4A) harmonics, 2..32), B Depth (0 = saw, 1 = full notches)
//   5 Asym Sine    A Sharp (0 sharp bottom .. 0.5 sine .. 1 sharp top), B Skew (0.5 = none): the old
//                  Wavetable 2D shape, computed exactly. Sharp crossfades the parabola cycle
//                  0.5 - 6u^2 (cusp at the bottom; sum (-1)^(n+1) cos / n^2), the cosine and its
//                  flipped twin; Skew warps time with Wavetable 2D's rational warp
//                  t -> (k+1) t / (2 k t - k + 1), k from its 13 warp knots (piecewise linear).
//   6 Glass        A Stretch, B Sine: 12 partials at k^s (s = 1.2 .. 2: stretched -> bar-like),
//                  strong fundamental, 0.6 k^-0.35 above, each split between its two nearest harmonics.
//   7 Bell         A Stretch, B Sine: hum (harmonic 1) plus bell partials (prime, tierce, quint,
//                  nominal, ... ratios 1, 1.2, 1.5, 2, 2.5, 3, 4.2, 5.4 to the prime) at
//                  1 + (2 ratio - 1) S, S = 1 .. 4, split between their two nearest harmonics.
// Every shape is scaled to peak 1, measured on the built tables, so Sine 1 is a
// unit sine and the output never exceeds Amplitude (scale only, never an offset).
//
// DC: Free run is DC-free (harmonics 1..K). Single trigger keeps the shape's own DC,
// so a triggered cycle starts and ends where the shape does instead of jumping out
// of silence: Center Edge / Pulse / Trisaw / Comb start at 0, and their DC is the
// value that puts each band-limited table's start exactly there (it tends to the
// true mean, e.g. Edge - 0.5 for Center Edge, as K grows; the plain mean would leave
// a 1/K offset from smoothing the corner at the cycle start). Sine weights it by r
// (the Poisson weight of harmonic 0), so Sine 1 is still a pure sine. Asym Sine
// keeps its formula's mean; Formant, Glass and Bell are partial sums with no DC.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/trigger/trigger.h>

#include <stddef.h>
#include <stdint.h>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 128;
static const int kTableCount = 28;
static const int kMaxK = 1024;
static const int kFft = 8192;                     // Asym Sine analysis length
static const int kShapeCount = 8;
static const double kTaperA = 6.907755278982137;  // ln(1000): -60 dB at K + 1
static const double kFadeSeconds = 0.020;
static const int kBuildPointsPerCall = 4096;      // table points built per work call
static const int kBankFloats = 27136;

static const int kTableK[kTableCount] = {
  1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25, 32, 40, 51, 64,
  81, 102, 128, 161, 203, 256, 323, 406, 512, 645, 813, 1024
};

struct TableInfo { int len; int k; int offset; double lnK; };

static TableInfo gTab[kTableCount];
static double gLnTop = 0.0;  // ln of the hypothetical table after the last (1024 * 2^(1/3))
static int gReady = 0;

struct State {
  bool active;
  double phase;
  double lastPhase;
  double lastOut;
  float tables[2][kBankFloats];
  double gain[2];
  int live;
  int built;
  int lastTable;
  double builtShape, builtA, builtB, builtG;
  double tShape, tA, tB, tG;
  int builtKeep, tKeep, bKeep;  // keep DC (Single trigger)
  // Rebuild in progress into bank 1 - live: step -1 = spectrum, then tables top down.
  int building;
  int buildStep;
  double bShape, bA, bB, bG;
  double bMin, bMax;
  double specA[kMaxK + 1];
  double specB[kMaxK + 1];
  int fadeLeft;
  int fadeLen;
};

static State gPool[kMaxInstances];
static double gCos[kFft / 2];
static double gSin[kFft / 2];
static double gRe[kFft];
static double gIm[kFft];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"spectral_osc\","
    "\"label\":\"Spectral Oscillator\","
    "\"targetType\":\"spectralOsc\","
    "\"kind\":\"oscillator\""
  "}";

static void init_tables() {
  if (gReady) return;
  int off = 0;
  for (int j = 0; j < kTableCount; j += 1) {
    const int K = kTableK[j];
    int len = 256;
    while (len < 4 * K) len <<= 1;
    gTab[j].len = len;
    gTab[j].k = K;
    gTab[j].offset = off;
    gTab[j].lnK = dsp_ln((double)K);
    off += len;
  }
  gLnTop = gTab[kTableCount - 1].lnK + 0.23104906018664842;  // + ln(2)/3
  for (int k = 0; k < kFft / 2; k += 1) {
    double s = 0.0, c = 1.0;
    dsp_sin_cos_turns((double)k / (double)kFft, &s, &c);
    gCos[k] = c;
    gSin[k] = s;
  }
  gReady = 1;
}

static double clampd(double x, double lo, double hi) {
  if (!(x == x)) return lo;
  return x < lo ? lo : (x > hi ? hi : x);
}

// In-place iterative radix-2 FFT (forward, e^{-i}) on gRe/gIm, length len (<= kFft).
static void fft_forward(int len) {
  for (int i = 1, j = 0; i < len; i += 1) {
    int bit = len >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      double t = gRe[i]; gRe[i] = gRe[j]; gRe[j] = t;
      t = gIm[i]; gIm[i] = gIm[j]; gIm[j] = t;
    }
  }
  for (int size = 2; size <= len; size <<= 1) {
    const int half = size >> 1;
    const int stride = kFft / size;
    for (int i = 0; i < len; i += size) {
      for (int k = 0; k < half; k += 1) {
        const double wr = gCos[k * stride];
        const double wi = -gSin[k * stride];
        const int i0 = i + k, i1 = i0 + half;
        const double tr = wr * gRe[i1] - wi * gIm[i1];
        const double ti = wr * gIm[i1] + wi * gRe[i1];
        gRe[i1] = gRe[i0] - tr;
        gIm[i1] = gIm[i0] - ti;
        gRe[i0] += tr;
        gIm[i0] += ti;
      }
    }
  }
}

// Piecewise-linear wave: knots at t with value jump d and slope jump c.
// F_n = sum e^{-i w t}(d/(i w) + c/(i w)^2), a_n = 2 Re F, b_n = -2 Im F.
struct Knot { double t, d, c; };

static void knots_coef(const Knot* k, int count, int n, double scale, double* a, double* b) {
  const double w = kTwoPi * (double)n;
  double re = 0.0, im = 0.0;
  for (int i = 0; i < count; i += 1) {
    double s = 0.0, co = 1.0;
    dsp_sin_cos_turns(wrap01((double)n * k[i].t), &s, &co);
    re += -k[i].d * s / w - k[i].c * co / (w * w);
    im += -k[i].d * co / w + k[i].c * s / (w * w);
  }
  *a = 2.0 * re * scale;
  *b = -2.0 * im * scale;
}

// Harmonic n of the closed-form shapes 0..4: y = a cos(2 pi n t) + b sin(2 pi n t).
static void shape_coef(int shape, double A, double B, int n, double* a, double* b) {
  *a = 0.0;
  *b = 0.0;
  if (n < 1) return;
  switch (shape) {
    case 0: {  // Center Edge
      const double p = clampd(A, 0.001, 0.999);
      const Knot k[2] = {
        { 0.0, 0.0, 1.0 / p - 1.0 / (1.0 - p) },
        { p, -2.0, 1.0 / (1.0 - p) - 1.0 / p },
      };
      knots_coef(k, 2, n, 1.0, a, b);
      break;
    }
    case 1: {  // Pulse: +1 on [0,w), -1 on [w,1), DC removed
      const double w = clampd(A, 0.001, 0.999);
      const double peak = (2.0 - 2.0 * w) > 2.0 * w ? (2.0 - 2.0 * w) : 2.0 * w;
      const Knot k[2] = { { 0.0, 2.0, 0.0 }, { w, -2.0, 0.0 } };
      knots_coef(k, 2, n, 1.0 / peak, a, b);
      break;
    }
    case 2: {  // Trisaw: 0 -> 1 at p/2 -> -1 at 1-p/2 -> 0
      const double p = clampd(A, 0.001, 0.999);
      const double up = 2.0 / p;
      const double down = -2.0 / (1.0 - p);
      const Knot k[2] = { { 0.5 * p, 0.0, down - up }, { 1.0 - 0.5 * p, 0.0, up - down } };
      knots_coef(k, 2, n, 1.0, a, b);
      break;
    }
    case 3: {  // Formant: Gaussian in log2(n) around 2^(7A), width 0.1..3 octaves, cosine phase
      const double centerOct = 7.0 * clampd(A, 0.0, 1.0);
      const double width = 0.1 + 2.9 * clampd(B, 0.0, 1.0);
      const double x = (dsp_ln((double)n) * 1.4426950408889634 - centerOct) / width;
      *a = dsp_exp(-0.5 * x * x);
      break;
    }
    case 4: {  // Comb: saw (Center Edge 0.5 series) times a raised-cosine comb
      const double spacing = dsp_exp2(1.0 + 4.0 * clampd(A, 0.0, 1.0));
      const double depth = clampd(B, 0.0, 1.0);
      double s = 0.0, co = 1.0;
      dsp_sin_cos_turns(wrap01((double)n / spacing), &s, &co);
      const double comb = 1.0 - depth * 0.5 * (1.0 + co);
      *b = (2.0 / kPi) * ((n & 1) ? 1.0 : -1.0) / (double)n * comb;
      break;
    }
    default:
      break;
  }
}

// ---- Asym Sine (the old Wavetable 2D shape, exact) ----
static const double kWarpKnots[13] = {
  -0.97, -0.87, -0.73, -0.66, -0.49, -0.19, 0.0, 0.19, 0.49, 0.66, 0.73, 0.87, 0.97
};

static double asym_skew_k(double B) {
  const double pos = clampd(B, 0.0, 1.0) * 12.0;
  int i = (int)dsp_floor(pos);
  if (i > 11) i = 11;
  const double f = pos - (double)i;
  return kWarpKnots[i] + (kWarpKnots[i + 1] - kWarpKnots[i]) * f;
}

// One cycle at phase t (exact formula, before DC removal).
static double asym_value(double sharp, double k, double t) {
  double x = t;
  if (k != 0.0) {
    const double cv = k * t;
    const double den = 2.0 * cv - k + 1.0;
    if (dsp_fabs(den) > 1e-12) x = (cv + t) / den;
  }
  x = wrap01(x);
  double u = wrap01(x + 0.5) - 0.5;
  const double f0 = 0.5 - 6.0 * u * u;   // round top, cusp at the bottom
  const double v = x - 0.5;
  const double f2 = 6.0 * v * v - 0.5;   // cusp at the top, round bottom
  double s = 0.0, c = 1.0;
  dsp_sin_cos_turns(x, &s, &c);
  if (sharp <= 0.5) {
    const double m = 2.0 * sharp;
    return (1.0 - m) * f0 + m * c;
  }
  const double m = 2.0 * sharp - 1.0;
  return (1.0 - m) * c + m * f2;
}

// ---- Glass / Bell partial lists ----
static void add_partial(double* sa, double* sb, double x, double amp, double phaseTurns) {
  if (!(x >= 1.0)) return;
  int n0 = (int)dsp_floor(x);
  const double f = x - (double)n0;
  double s = 0.0, c = 1.0;
  dsp_sin_cos_turns(wrap01(phaseTurns), &s, &c);
  // amp * sin(2 pi n t + phi) = amp (sin phi cos + cos phi sin)
  if (n0 >= 1 && n0 <= kMaxK) { sa[n0] += (1.0 - f) * amp * s; sb[n0] += (1.0 - f) * amp * c; }
  if (f > 0.0 && n0 + 1 <= kMaxK) { sa[n0 + 1] += f * amp * s; sb[n0 + 1] += f * amp * c; }
}

static const double kBellRatio[8] = { 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.2, 5.4 };
static const double kBellAmp[8] = { 1.0, 0.8, 0.45, 0.9, 0.5, 0.45, 0.35, 0.3 };

// Unweighted spectrum (before taper / Sine) of shape into sa/sb[1..kMaxK].
static void build_spectrum(int shape, double A, double B, double* sa, double* sb) {
  for (int n = 0; n <= kMaxK; n += 1) { sa[n] = 0.0; sb[n] = 0.0; }
  if (shape <= 4) {
    for (int n = 1; n <= kMaxK; n += 1) shape_coef(shape, A, B, n, &sa[n], &sb[n]);
    return;
  }
  if (shape == 5) {
    const double sharp = clampd(A, 0.0, 1.0);
    const double k = asym_skew_k(B);
    for (int j = 0; j < kFft; j += 1) {
      gRe[j] = asym_value(sharp, k, (double)j / (double)kFft);
      gIm[j] = 0.0;
    }
    fft_forward(kFft);
    const double sc = 2.0 / (double)kFft;
    sa[0] = gRe[0] / (double)kFft;  // the formula's mean (kept in Single trigger)
    for (int n = 1; n <= kMaxK; n += 1) { sa[n] = sc * gRe[n]; sb[n] = -sc * gIm[n]; }
    return;
  }
  const double st = clampd(A, 0.0, 1.0);
  if (shape == 6) {  // Glass
    const double s = 1.2 + 0.8 * st;
    for (int k = 1; k <= 12; k += 1) {
      const double x = k == 1 ? 1.0 : dsp_exp(s * dsp_ln((double)k));
      const double amp = k == 1 ? 1.0 : 0.6 * dsp_exp(-0.35 * dsp_ln((double)k));
      add_partial(sa, sb, x, amp, k == 1 ? 0.0 : (double)k * 0.6180339887498949);
    }
    return;
  }
  // Bell: hum on harmonic 1, bell partials stretched by S.
  const double S = 1.0 + 3.0 * st;
  add_partial(sa, sb, 1.0, 0.55, 0.0);
  for (int i = 0; i < 8; i += 1) {
    const double x = 1.0 + (2.0 * kBellRatio[i] - 1.0) * S;
    add_partial(sa, sb, x, kBellAmp[i], (double)(i + 1) * 0.7548776662466927);
  }
}

static bool shape_has_sine(int shape) { return (shape >= 0 && shape <= 2) || shape == 6 || shape == 7; }

static double sine_r(double s) {
  const double v = clampd(s, 0.0, 1.0);
  return 1.0 - v * v * v;
}

// Band-limit taper for harmonic n of a table with top harmonic K.
static double taper(int n, int K, double gibbs) {
  const double G = clampd(gibbs, 0.0, 1.0);
  if (G >= 0.999999) return 1.0;
  const double x = (double)n / (double)(K + 1);
  const double p = 2.0 / (1.0 - G);
  return dsp_exp(-kTaperA * dsp_exp(p * dsp_ln(x)));
}

// Single-trigger DC of a table with top harmonic K (see the header).
static double table_dc(const State& st, int shape, double B, double G, int K) {
  if (shape == 5) return st.specA[0];
  if (shape == 3 || shape >= 6) return 0.0;
  double s = 0.0;  // the Sine-0 table's start: sum of its cosine terms
  for (int n = 1; n <= K; n += 1) s += st.specA[n] * taper(n, K, G);
  return -s * (shape_has_sine(shape) ? sine_r(B) : 1.0);
}

// Build table j from the spectrum into dst; updates min/max.
static void build_table(const State& st, int shape, double B, double G, int keepDc, int j, float* dst, double* mn, double* mx) {
  const int len = gTab[j].len;
  const int K = gTab[j].k;
  const double r = shape_has_sine(shape) ? sine_r(B) : 1.0;
  for (int i = 0; i < len; i += 1) { gRe[i] = 0.0; gIm[i] = 0.0; }
  if (keepDc) gRe[0] = table_dc(st, shape, B, G, K);
  double rp = 1.0;  // r^(n-1)
  for (int n = 1; n <= K; n += 1) {
    const double g = taper(n, K, G) * rp;
    const double a = st.specA[n], b = st.specB[n];
    // Conjugate trick: forward FFT of X[n] = (a + i b)/2 g gives sum g (a cos + b sin).
    gRe[n] = 0.5 * a * g;
    gIm[n] = 0.5 * b * g;
    gRe[len - n] = 0.5 * a * g;
    gIm[len - n] = -0.5 * b * g;
    rp *= r;
    if (rp < 1e-30) rp = 0.0;
  }
  fft_forward(len);
  for (int i = 0; i < len; i += 1) {
    const double v = gRe[i];
    dst[i] = (float)v;
    if (v < *mn) *mn = v;
    if (v > *mx) *mx = v;
  }
}

static double bank_gain(double mn, double mx) {
  const double peak = mx > -mn ? mx : -mn;
  if (!(peak > 1e-12)) return 0.0;
  return 1.0 / peak;
}

static int shape_index(double s) {
  int v = (int)dsp_floor(s + 0.5);
  if (v < 0) v = 0;
  if (v > kShapeCount - 1) v = kShapeCount - 1;
  return v;
}

static void build_full(State& st, int bank, int shape, double A, double B, double G, int keepDc) {
  double mn = 0.0, mx = 0.0;
  build_spectrum(shape, A, B, st.specA, st.specB);
  for (int j = kTableCount - 1; j >= 0; j -= 1) {
    build_table(st, shape, B, G, keepDc, j, st.tables[bank] + gTab[j].offset, &mn, &mx);
  }
  st.gain[bank] = bank_gain(mn, mx);
}

static bool target_differs(const State& st) {
  return st.tShape != st.builtShape || st.tKeep != st.builtKeep || dsp_fabs(st.tA - st.builtA) > 1e-7
    || dsp_fabs(st.tB - st.builtB) > 1e-7 || dsp_fabs(st.tG - st.builtG) > 1e-7;
}

// 6-point Lagrange interpolation (nodes i0-2 .. i0+3); len is a power of two.
static double read_table(const float* bank, int j, double t) {
  const int len = gTab[j].len;
  const int mask = len - 1;
  const float* tab = bank + gTab[j].offset;
  const double x = t * (double)len;
  int i0 = (int)x;
  const double f = x - (double)i0;
  const double a = f + 2.0, b = f + 1.0, c = f, d = f - 1.0, e = f - 2.0, g = f - 3.0;
  const double ab = a * b, de = d * e, cde = c * de, abc = ab * c;
  const double wm2 = b * cde * g * (-1.0 / 120.0);
  const double wm1 = a * cde * g * (1.0 / 24.0);
  const double w0 = ab * de * g * (-1.0 / 12.0);
  const double w1 = abc * e * g * (1.0 / 12.0);
  const double w2 = abc * d * g * (-1.0 / 24.0);
  const double w3 = abc * de * (1.0 / 120.0);
  return wm2 * (double)tab[(i0 - 2) & mask] + wm1 * (double)tab[(i0 - 1) & mask]
    + w0 * (double)tab[i0 & mask] + w1 * (double)tab[(i0 + 1) & mask]
    + w2 * (double)tab[(i0 + 2) & mask] + w3 * (double)tab[(i0 + 3) & mask];
}

// Tables for Nyquist harmonic count hmax: lo (-1 = silence) -> hi, weight w of hi.
static void table_pick(State& st, double hmax, int* lo, int* hi, double* w) {
  if (!(hmax >= 1.0)) { *lo = -1; *hi = -1; *w = 0.0; return; }
  int j = st.lastTable;
  if (j < 0 || j >= kTableCount) j = 0;
  while (j + 1 < kTableCount && (double)gTab[j + 1].k <= hmax) j += 1;
  while (j > 0 && (double)gTab[j].k > hmax) j -= 1;
  st.lastTable = j;
  const double lnNext = (j + 1 < kTableCount) ? gTab[j + 1].lnK : gLnTop;
  double x = (dsp_ln(hmax) - gTab[j].lnK) / (lnNext - gTab[j].lnK);
  if (x > 1.0) x = 1.0;
  if (x < 0.0) x = 0.0;
  if (j == kTableCount - 1 && dsp_ln(hmax) >= gLnTop) { *lo = j; *hi = j; *w = 1.0; return; }
  *lo = j - 1;
  *hi = j;
  *w = x;
}

static double read_bank(const State& st, int bank, int lo, int hi, double w, double t) {
  if (hi < 0) return 0.0;
  const float* tab = st.tables[bank];
  const double yh = read_table(tab, hi, t);
  const double yl = lo >= 0 ? read_table(tab, lo, t) : 0.0;
  return (yl + (yh - yl) * w) * st.gain[bank];
}

static State* slot(int handle) {
  if (handle < 1 || handle > kMaxInstances) return nullptr;
  State& st = gPool[handle - 1];
  return st.active ? &st : nullptr;
}

}  // namespace

extern "C" int soemdsp_spectral_osc_create() {
  init_tables();
  for (int i = 0; i < kMaxInstances; i += 1) {
    State& s = gPool[i];
    if (s.active) continue;
    s.active = true;
    s.phase = 0.0;
    s.lastPhase = 0.0;
    s.lastOut = 0.0;
    s.gain[0] = s.gain[1] = 0.0;
    s.live = 0;
    s.built = 0;
    s.lastTable = 0;
    s.builtShape = s.builtA = s.builtB = s.builtG = 0.0;
    s.tShape = 0.0; s.tA = 0.5; s.tB = 0.0; s.tG = 0.0;
    s.builtKeep = s.tKeep = s.bKeep = 0;
    s.building = 0;
    s.buildStep = 0;
    s.fadeLeft = 0;
    s.fadeLen = 1;
    return i + 1;
  }
  return 0;
}

extern "C" void soemdsp_spectral_osc_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" void soemdsp_spectral_osc_reset(int handle) {
  State* st = slot(handle);
  if (!st) return;
  st->phase = 0.0;
}

// Reset trigger of height h (-1..1): move the phase |h| of the way to the cycle
// start (h < 0 the long way, |h| = 1 lands on it), as PolyBLEP / Sinc.
extern "C" void soemdsp_spectral_osc_retrigger(int handle, double h) {
  State* st = slot(handle);
  if (!st) return;
  st->phase = soemdsp::math::partial_reset_phase(st->phase, 0.0, h, 1.0);
}

// Latest Shape / A / B / Gibbs / keep DC (1 = Single trigger). The first call builds
// the bank at once; later changes (Cycle mode too) rebuild in soemdsp_spectral_osc_work.
extern "C" void soemdsp_spectral_osc_set_target(int handle, double shape, double A, double B, double gibbs, double keepDc) {
  State* st = slot(handle);
  if (!st) return;
  st->tShape = (double)shape_index(shape);
  st->tA = clampd(A, 0.0, 1.0);
  st->tB = clampd(B, 0.0, 1.0);
  st->tG = clampd(gibbs, 0.0, 1.0);
  st->tKeep = keepDc >= 0.5 ? 1 : 0;  // NaN / missing -> Free run
  if (!st->built) {
    build_full(*st, st->live, (int)st->tShape, st->tA, st->tB, st->tG, st->tKeep);
    st->builtShape = st->tShape; st->builtA = st->tA; st->builtB = st->tB; st->builtG = st->tG;
    st->builtKeep = st->tKeep;
    st->built = 1;
  }
}

// Off the per-sample path: continue (or start) a rebuild, a few tables per call.
// Returns 1 while a rebuild or crossfade is in progress.
extern "C" int soemdsp_spectral_osc_work(int handle, double sampleRate) {
  State* stp = slot(handle);
  if (!stp || !stp->built) return 0;
  State& st = *stp;
  if (!st.building && st.fadeLeft <= 0 && target_differs(st)) {
    st.building = 1;
    st.buildStep = -1;
    st.bShape = st.tShape; st.bA = st.tA; st.bB = st.tB; st.bG = st.tG;
    st.bKeep = st.tKeep;
    st.bMin = 0.0; st.bMax = 0.0;
  }
  if (st.building) {
    const int back = 1 - st.live;
    if (st.buildStep == -1) {
      build_spectrum((int)st.bShape, st.bA, st.bB, st.specA, st.specB);
      st.buildStep = kTableCount - 1;
      return 1;
    }
    int spent = 0;
    while (st.buildStep >= 0 && spent < kBuildPointsPerCall) {
      const int j = st.buildStep;
      build_table(st, (int)st.bShape, st.bB, st.bG, st.bKeep, j, st.tables[back] + gTab[j].offset, &st.bMin, &st.bMax);
      spent += gTab[j].len;
      st.buildStep -= 1;
    }
    if (st.buildStep < 0) {
      st.gain[back] = bank_gain(st.bMin, st.bMax);
      st.live = back;
      st.builtShape = st.bShape; st.builtA = st.bA; st.builtB = st.bB; st.builtG = st.bG;
      st.builtKeep = st.bKeep;
      st.building = 0;
      const double sr = sampleRate > 1.0 ? sampleRate : 44100.0;
      st.fadeLen = (int)(kFadeSeconds * sr);
      if (st.fadeLen < 1) st.fadeLen = 1;
      st.fadeLeft = st.fadeLen;
    }
  }
  return (st.building || st.fadeLeft > 0) ? 1 : 0;
}

// One sample at the current phase (+ phaseOffset), then advance the phase.
extern "C" double soemdsp_spectral_osc_sample(
  int handle, double frequencyHz, double phaseOffset, double amplitude, double engineSampleRate
) {
  State* stp = slot(handle);
  if (!stp || !stp->built) return 0.0;
  State& st = *stp;
  const double sr = engineSampleRate > 1.0 ? engineSampleRate : 44100.0;
  double freq = frequencyHz == frequencyHz ? frequencyHz : 0.0;
  const double af = freq < 0.0 ? -freq : freq;
  const double hmax = af > 1e-9 ? (0.5 * sr) / af : 1e9;
  int lo = -1, hi = -1;
  double w = 0.0;
  table_pick(st, hmax, &lo, &hi, &w);
  double off = phaseOffset == phaseOffset ? phaseOffset : 0.0;
  const double t = wrap01(st.phase + wrap01(off));
  double y = read_bank(st, st.live, lo, hi, w, t);
  if (st.fadeLeft > 0) {
    const double k = (double)st.fadeLeft / (double)st.fadeLen;  // old bank weight 1 -> 0
    const double yo = read_bank(st, 1 - st.live, lo, hi, w, t);
    y = y + (yo - y) * k;
    st.fadeLeft -= 1;
  }
  double amp = amplitude == amplitude ? amplitude : 0.0;
  if (amp < 0.0) amp = 0.0;
  if (amp > 1.0) amp = 1.0;
  y *= amp;
  st.lastOut = y;
  st.lastPhase = t;
  st.phase = wrap01(st.phase + freq / sr);
  return y;
}

// A silent sample (Single trigger, stopped): the crossfade still runs, so a rebuild
// made while idle (e.g. switching Cycle mode) is complete before the next hit.
extern "C" void soemdsp_spectral_osc_hold(int handle) {
  State* st = slot(handle);
  if (st && st->fadeLeft > 0) st->fadeLeft -= 1;
}

extern "C" double soemdsp_spectral_osc_phase(int handle) {
  State* st = slot(handle);
  return st ? st->lastPhase : 0.0;
}

extern "C" double soemdsp_spectral_osc_out(int handle) {
  State* st = slot(handle);
  return st ? st->lastOut : 0.0;
}

// Test / display taps: the live bank's table j, its length, top harmonic and gain.
extern "C" int soemdsp_spectral_osc_table_count() { return kTableCount; }
extern "C" int soemdsp_spectral_osc_table_ptr(int handle, int j) {
  State* st = slot(handle);
  if (!st || j < 0 || j >= kTableCount) return 0;
  return (int)(intptr_t)(st->tables[st->live] + gTab[j].offset);
}
extern "C" int soemdsp_spectral_osc_table_len(int j) {
  init_tables();
  return (j < 0 || j >= kTableCount) ? 0 : gTab[j].len;
}
extern "C" int soemdsp_spectral_osc_table_harmonics(int j) {
  init_tables();
  return (j < 0 || j >= kTableCount) ? 0 : gTab[j].k;
}
extern "C" double soemdsp_spectral_osc_gain(int handle) {
  State* st = slot(handle);
  return st ? st->gain[st->live] : 0.0;
}
extern "C" int soemdsp_spectral_osc_busy(int handle) {
  State* st = slot(handle);
  return st ? ((st->building || st->fadeLeft > 0) ? 1 : 0) : 0;
}

extern "C" int soemdsp_spectral_osc_version() { return 3; }
extern "C" const char* soemdsp_spectral_osc_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_spectral_osc_metadata_json_size() { return sizeof(kMetadataJson) - 1; }