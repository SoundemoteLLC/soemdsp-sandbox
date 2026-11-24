// soemdsp-native-module: spectral_osc
// soemdsp-native-label: Spectral Oscillator
// soemdsp-native-target: spectralOsc
// soemdsp-native-kind: oscillator
//
// Spectral Oscillator: each cycle is built exactly from its parameters. The
// shape formula gives every harmonic's cosine/sine amplitude (closed-form
// Fourier series, no sampled snapshot), an inverse FFT turns them into one
// cycle, once per octave mip. Band-limiting never truncates the series: every
// mip multiplies harmonic n by a Gaussian taper exp(-a (n/N)^2) that is -60 dB
// at the mip's Nyquist harmonic N and below 2e-7 where the table stops (1.5 N).
// The taper is the spectrum of a positive, single-humped kernel, so a mip is
// the ideal wave smoothed by that kernel: no Gibbs overshoot, no ripple, and a
// rising ramp stays rising. "Sine" multiplies harmonic n by r^(n-1)
// (r = 1 - Sine^3; the same positive Poisson kernel as DSF brightness): Sine 1
// leaves only the fundamental, a pure sine.
//
// A parameter change rebuilds the tables off the per-sample path: a few mips
// per audio block into the spare bank, then a 20 ms crossfade to it (as Noise
// Convolution Reverb's IR rebuild). A move while one is building waits for it.
// Playback: phase -> linear interpolation in the two mips around the pitch's
// Nyquist harmonic count, blended by log2 distance; O(1) per sample.
//
// Shapes (A, B are the two 0..1 controls):
//   0 Center Edge  A Edge   (ramp 0->1, edge 1->-1 at A, ramp -1->0; Additive CenterSaw series), B Sine
//   1 Pulse        A Width  (+1 / -1, DC removed, scaled to peak 1),                             B Sine
//   2 Trisaw       A Peak   (0 -> 1 at A/2 -> -1 at 1-A/2 -> 0; Additive Trisaw: 0.5 triangle, 1 = Center Edge), B Sine
//   3 Formant      A Formant (peak at harmonic 2^(7A), 1..128), B Width (0.1..3 octaves, Gaussian in log2 n), cosine phase
//   4 Comb         A Spacing (notch every 2^(1+4A) harmonics, 2..32), B Depth (0 = saw, 1 = full notches)
// Every shape is scaled to peak 1 (DC removed), measured on the built tables, so
// Sine 1 is a unit sine and the output never exceeds Amplitude.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/trigger/trigger.h>

#include <stddef.h>
#include <stdint.h>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 128;
static const int kMipCount = 11;           // mip m: Nyquist harmonic N = 2^m (1 .. 1024)
static const int kMaxLen = 4096;
static const int kShapeCount = 5;
static const double kTaperA = 6.907755278982137; // ln(1000): -60 dB at N
static const double kTableReach = 1.5;           // harmonics kept up to 1.5 N (taper < 2e-7)
static const double kFadeSeconds = 0.020;
static const int kBuildPointsPerCall = 4096;     // table points built per work call

struct MipInfo { int len; int harmonics; int offset; };

static MipInfo gMip[kMipCount];
static int gBankFloats = 0;
static int gMipReady = 0;

static const int kBankFloatsMax = 8384;

struct State {
  bool active;
  double phase;
  double lastPhase;
  double lastOut;
  // Banks: tables[bank][...]; gains per bank.
  float tables[2][kBankFloatsMax];
  double gain[2];
  int live;            // bank being played
  int built;           // 0 until the first bank exists
  double builtShape, builtA, builtB;
  // Target (latest parameters).
  double tShape, tA, tB;
  // Build in progress into bank 1 - live.
  int building;
  int buildMip;
  double bShape, bA, bB;
  double bMin, bMax;
  // Crossfade from bank 1 - live (old) to live (new).
  int fadeLeft;
  int fadeLen;
};

static State gPool[kMaxInstances];
static double gCos[kMaxLen / 2];
static double gSin[kMaxLen / 2];
static double gRe[kMaxLen];
static double gIm[kMaxLen];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"spectral_osc\","
    "\"label\":\"Spectral Oscillator\","
    "\"targetType\":\"spectralOsc\","
    "\"kind\":\"oscillator\""
  "}";

static void init_tables() {
  if (gMipReady) return;
  int off = 0;
  for (int m = 0; m < kMipCount; m += 1) {
    const int N = 1 << m;
    int K = (int)dsp_floor(kTableReach * (double)N);
    if (K < 1) K = 1;
    int len = 64;
    while (len < 2 * K + 2 && len < kMaxLen) len <<= 1;
    if (K > len / 2 - 1) K = len / 2 - 1;
    gMip[m].len = len;
    gMip[m].harmonics = K;
    gMip[m].offset = off;
    off += len;
  }
  gBankFloats = off;
  for (int k = 0; k < kMaxLen / 2; k += 1) {
    double s = 0.0, c = 1.0;
    dsp_sin_cos_turns((double)k / (double)kMaxLen, &s, &c);
    gCos[k] = c;
    gSin[k] = s;
  }
  gMipReady = 1;
}

static double clampd(double x, double lo, double hi) {
  if (!(x == x)) return lo;
  return x < lo ? lo : (x > hi ? hi : x);
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

// Harmonic n of a shape before band-limiting: y = a cos(2 pi n t) + b sin(2 pi n t).
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
    case 1: {  // Pulse: +1 on [0,w), -1 on [w,1), DC removed, peak 1
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

static bool shape_has_sine(int shape) { return shape >= 0 && shape <= 2; }

static double sine_r(double s) {
  const double v = clampd(s, 0.0, 1.0);
  return 1.0 - v * v * v;
}

// In-place iterative radix-2 FFT (forward, e^{-i}) on gRe/gIm, length len (<= kMaxLen).
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
    const int stride = kMaxLen / size;
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

// Build mip m of (shape, A, B) into dst; returns nothing, updates min/max.
static void build_mip(int shape, double A, double B, int m, float* dst, double* mn, double* mx) {
  const int len = gMip[m].len;
  const int K = gMip[m].harmonics;
  const double N = (double)(1 << m);
  const bool sine = shape_has_sine(shape);
  const double r = sine ? sine_r(B) : 1.0;
  for (int i = 0; i < len; i += 1) { gRe[i] = 0.0; gIm[i] = 0.0; }
  double rp = 1.0;  // r^(n-1)
  for (int n = 1; n <= K; n += 1) {
    double a = 0.0, b = 0.0;
    shape_coef(shape, A, B, n, &a, &b);
    const double x = (double)n / N;
    const double g = dsp_exp(-kTaperA * x * x) * rp;
    // y_j = sum a cos + b sin = Re sum (a - i b) e^{+i 2 pi n j / len}.
    // Conjugate trick: forward FFT of conj(X) then conj -> X[n] = (a + i b) under e^{-i}.
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

static double bank_gain(int shape, double mn, double mx) {
  double peak = mx > -mn ? mx : -mn;
  (void)shape;
  if (!(peak > 1e-12)) return 0.0;
  return 1.0 / peak;
}

static int shape_index(double s) {
  int v = (int)dsp_floor(s + 0.5);
  if (v < 0) v = 0;
  if (v > kShapeCount - 1) v = kShapeCount - 1;
  return v;
}

static void build_full(State& st, int bank, int shape, double A, double B) {
  double mn = 0.0, mx = 0.0;
  for (int m = 0; m < kMipCount; m += 1) {
    build_mip(shape, A, B, m, st.tables[bank] + gMip[m].offset, &mn, &mx);
  }
  st.gain[bank] = bank_gain(shape, mn, mx);
}

static bool target_differs(const State& st, double shape, double A, double B) {
  return shape != st.builtShape || dsp_fabs(A - st.builtA) > 1e-7 || dsp_fabs(B - st.builtB) > 1e-7;
}

static double read_mip(const float* bank, int m, double t) {
  const int len = gMip[m].len;
  const float* tab = bank + gMip[m].offset;
  const double x = t * (double)len;
  int i0 = (int)x;
  if (i0 >= len) i0 -= len;
  if (i0 < 0) i0 = 0;
  const double f = x - (double)(int)x;
  int i1 = i0 + 1;
  if (i1 >= len) i1 = 0;
  return (double)tab[i0] + ((double)tab[i1] - (double)tab[i0]) * f;
}

// Mip pair and blend for a Nyquist harmonic count hmax (continuous).
static void mip_pick(double hmax, int* m0, int* m1, double* w) {
  if (!(hmax > 1.0)) { *m0 = 0; *m1 = 0; *w = 0.0; return; }
  double x = dsp_ln(hmax) * 1.4426950408889634;
  if (x >= (double)(kMipCount - 1)) { *m0 = kMipCount - 1; *m1 = kMipCount - 1; *w = 0.0; return; }
  const int i = (int)dsp_floor(x);
  *m0 = i;
  *m1 = i + 1;
  *w = x - (double)i;
}

static double read_bank(const State& st, int bank, int m0, int m1, double w, double t) {
  const float* tab = st.tables[bank];
  double y = read_mip(tab, m0, t);
  if (m1 != m0 && w > 0.0) y += (read_mip(tab, m1, t) - y) * w;
  return y * st.gain[bank];
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
    s.builtShape = s.builtA = s.builtB = 0.0;
    s.tShape = 0.0; s.tA = 0.5; s.tB = 0.0;
    s.building = 0;
    s.buildMip = 0;
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

// Latest Shape / A / B. The first call builds the bank at once; later changes
// rebuild in soemdsp_spectral_osc_work.
extern "C" void soemdsp_spectral_osc_set_target(int handle, double shape, double A, double B) {
  State* st = slot(handle);
  if (!st) return;
  st->tShape = (double)shape_index(shape);
  st->tA = clampd(A, 0.0, 1.0);
  st->tB = clampd(B, 0.0, 1.0);
  if (!st->built) {
    build_full(*st, st->live, (int)st->tShape, st->tA, st->tB);
    st->builtShape = st->tShape; st->builtA = st->tA; st->builtB = st->tB;
    st->built = 1;
  }
}

// Off the per-sample path: continue (or start) a rebuild, a few mips per call.
// Returns 1 while a rebuild or crossfade is in progress.
extern "C" int soemdsp_spectral_osc_work(int handle, double sampleRate) {
  State* stp = slot(handle);
  if (!stp || !stp->built) return 0;
  State& st = *stp;
  if (!st.building && st.fadeLeft <= 0 && target_differs(st, st.tShape, st.tA, st.tB)) {
    st.building = 1;
    st.buildMip = kMipCount - 1;  // biggest first: cost front-loaded
    st.bShape = st.tShape; st.bA = st.tA; st.bB = st.tB;
    st.bMin = 0.0; st.bMax = 0.0;
  }
  if (st.building) {
    const int back = 1 - st.live;
    int spent = 0;
    while (st.buildMip >= 0 && spent < kBuildPointsPerCall) {
      const int m = st.buildMip;
      build_mip((int)st.bShape, st.bA, st.bB, m, st.tables[back] + gMip[m].offset, &st.bMin, &st.bMax);
      spent += gMip[m].len;
      st.buildMip -= 1;
    }
    if (st.buildMip < 0) {
      st.gain[back] = bank_gain((int)st.bShape, st.bMin, st.bMax);
      st.live = back;
      st.builtShape = st.bShape; st.builtA = st.bA; st.builtB = st.bB;
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
  int m0 = 0, m1 = 0;
  double w = 0.0;
  mip_pick(hmax, &m0, &m1, &w);
  double off = phaseOffset == phaseOffset ? phaseOffset : 0.0;
  const double t = wrap01(st.phase + wrap01(off));
  double y = read_bank(st, st.live, m0, m1, w, t);
  if (st.fadeLeft > 0) {
    const double k = (double)st.fadeLeft / (double)st.fadeLen;  // old bank weight 1 -> 0
    const double yo = read_bank(st, 1 - st.live, m0, m1, w, t);
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

extern "C" double soemdsp_spectral_osc_phase(int handle) {
  State* st = slot(handle);
  return st ? st->lastPhase : 0.0;
}

extern "C" double soemdsp_spectral_osc_out(int handle) {
  State* st = slot(handle);
  return st ? st->lastOut : 0.0;
}

// Test / display taps: the live bank's mip table, its length, harmonics and gain.
extern "C" int soemdsp_spectral_osc_table_ptr(int handle, int mip) {
  State* st = slot(handle);
  if (!st || mip < 0 || mip >= kMipCount) return 0;
  return (int)(intptr_t)(st->tables[st->live] + gMip[mip].offset);
}
extern "C" int soemdsp_spectral_osc_table_len(int mip) {
  init_tables();
  return (mip < 0 || mip >= kMipCount) ? 0 : gMip[mip].len;
}
extern "C" int soemdsp_spectral_osc_table_harmonics(int mip) {
  init_tables();
  return (mip < 0 || mip >= kMipCount) ? 0 : gMip[mip].harmonics;
}
extern "C" double soemdsp_spectral_osc_gain(int handle) {
  State* st = slot(handle);
  return st ? st->gain[st->live] : 0.0;
}
extern "C" int soemdsp_spectral_osc_busy(int handle) {
  State* st = slot(handle);
  return st ? ((st->building || st->fadeLeft > 0) ? 1 : 0) : 0;
}

extern "C" int soemdsp_spectral_osc_version() { return 1; }
extern "C" const char* soemdsp_spectral_osc_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_spectral_osc_metadata_json_size() { return sizeof(kMetadataJson) - 1; }