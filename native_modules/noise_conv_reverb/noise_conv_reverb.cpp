// soemdsp-native-module: noise_conv_reverb
// soemdsp-native-label: Noise Convolution Reverb
// soemdsp-native-target: noiseConvReverb
// soemdsp-native-kind: reverb
//
// Noise Convolution Reverb: zero-latency partitioned convolution with a
// generated, shaped noise impulse response. A short time-domain head covers
// the first 128 samples of the IR; the rest is non-uniform overlap-save with
// growing FFT partitions, then uniform partitions at the largest hop, so a
// long tail stays cheap. Length, Amp Shape, Spectral Shape, Start/End Cutoff,
// Decorrelate and Seed rebuild the IR (fully in create, or
// incrementally across audio blocks when a parameter changes) and the wet
// signal crossfades, so a knob move does not click or zipper.
//
// Amp Shape warps a linear-in-dB decay over Length with the Step Graph
// rational curve (segment_rational01, same sign: + reaches the end sooner).
// Spectral Shape warps how the lowpass cutoff travels from Start Cutoff
// to End Cutoff in Hz, same curve. Decorrelate (0 = identical L/R, 1 =
// independent seeds) is cheap.
// The filtered IR ends with a quarter-length cosine taper, capped at 20 ms.
// Tiny kernels may fit entirely in the head.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/math/segment_curves.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>

namespace {

static const int kMaxInstances = 64;
static const double kMaxLengthSeconds = 6.0;
static const int kHead = 128;
static const int kMaxHop = 4096;
static const int kMaxFft = kMaxHop * 2;
static const int kMaxParts = 512;
static const int kSizeCount = 6;
static const int kBlockMax = 128;
static const double kFadeSeconds = 0.020;
static const int kBuildSamplesPerCall = 8192;
static const int kBuildFftsPerCall = 2;
static const float kDenorm = 1.0e-20f;
static const double kAmpFloorDb = -60.0;

static inline float flush_f(float x) {
  return (x > kDenorm || x < -kDenorm) ? x : 0.0f;
}

static inline double clampf(double v, double lo, double hi) {
  if (!(v == v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

static unsigned int splitmix(unsigned int& s) {
  s += 0x9e3779b9u;
  unsigned int z = s;
  z = (z ^ (z >> 16)) * 0x85ebca6bu;
  z = (z ^ (z >> 13)) * 0xc2b2ae35u;
  return z ^ (z >> 16);
}

static float rng_u01(unsigned int& s) {
  return (float)(splitmix(s) >> 8) * (1.0f / 16777216.0f);
}

static float rng_gauss(unsigned int& s) {
  const float sum = rng_u01(s) + rng_u01(s) + rng_u01(s) + rng_u01(s);
  return (sum - 2.0f) * 1.7320508f;
}

static float gTwRe[kMaxFft];
static float gTwIm[kMaxFft];
static int gTwInit = 0;

static void ensure_twiddles() {
  if (gTwInit) return;
  for (int k = 0; k < kMaxFft; ++k) {
    double s, c;
    soemdsp_maths::dsp_sin_cos_turns(-(double)k / (double)kMaxFft, &s, &c);
    gTwRe[k] = (float)c;
    gTwIm[k] = (float)s;
  }
  gTwInit = 1;
}

static void fft_radix2(float* re, float* im, int n, int inverse) {
  ensure_twiddles();
  int j = 0;
  for (int i = 1; i < n; ++i) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const float tr = re[i]; re[i] = re[j]; re[j] = tr;
      const float ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (int len = 2; len <= n; len <<= 1) {
    const int half = len >> 1;
    const int step = kMaxFft / len;
    for (int i0 = 0; i0 < n; i0 += len) {
      for (int k = 0; k < half; ++k) {
        const float wr = gTwRe[k * step];
        const float wi = inverse ? -gTwIm[k * step] : gTwIm[k * step];
        const int i1 = i0 + k;
        const int i2 = i1 + half;
        const float tr = wr * re[i2] - wi * im[i2];
        const float ti = wr * im[i2] + wi * re[i2];
        re[i2] = re[i1] - tr;
        im[i2] = im[i1] - ti;
        re[i1] += tr;
        im[i1] += ti;
      }
    }
  }
  if (inverse) {
    const float s = 1.0f / (float)n;
    for (int i = 0; i < n; ++i) { re[i] *= s; im[i] *= s; }
  }
}

struct CleanParams {
  double length;
  double ampShape;
  double spectralShape;
  double endCutoffHz;
  double startCutoffHz;
  double decorrelate;
  double sampleRate;
  unsigned int seed;
};

struct Partition {
  int offset;
  int length;
  int hop;
  int fftSize;
  int delayHops;
  float* specL;
  float* specR;
};

struct Bank {
  float* irL;
  float* irR;
  float* specArena;
  int irLen;
  int partCount;
  Partition parts[kMaxParts];
  float* outL;
  float* outR;
  int outIdx;
  int outCap;
  CleanParams built;
};

struct SizeClass {
  int hop;
  int fftSize;
  int depth;
  int write;
  int filled;
  int hopsWritten;
  float* overlapL;
  float* overlapR;
  float* fdlL;
  float* fdlR;
};

enum BuildPhase { kBuildIdle = 0, kBuildSamples = 1, kBuildScale = 2, kBuildFft = 3 };

struct State {
  bool active;
  void* block;
  int maxLen;
  int headCap;
  double sampleRate;
  unsigned int seed;
  Bank bank[2];
  int cur;
  bool fading;
  double fade;
  bool haveIr;
  SizeClass sizes[kSizeCount];
  float* headL;
  float* headR;
  int headIdx;
  int headCapSamples;
  float* fftRe;
  float* fftIm;
  int silentAge;
  int buildBank;
  BuildPhase buildPhase;
  int buildT;
  int buildPart;
  CleanParams buildP;
  bool buildDirty;
  unsigned int rngL;
  unsigned int rngR;
  float lpL1, lpL2, lpR1, lpR2;
  double energy;
};

static State gPool[kMaxInstances];
static double gInL[kBlockMax];
static double gInR[kBlockMax];
static double gOutL[kBlockMax];
static double gOutR[kBlockMax];
static double gMix[kBlockMax];

static int ir_len_for(double length, double sr) {
  if (!(sr > 1.0)) sr = 44100.0;
  if (!(length > 0.0) || !(length == length)) length = 0.0;
  if (length > kMaxLengthSeconds) length = kMaxLengthSeconds;
  int n = (int)(length * sr + 0.5);
  if (n < 1) n = 1;
  return n;
}

static int max_len_for(double sr) {
  return ir_len_for(kMaxLengthSeconds, sr) + 64;
}

static unsigned char* align16(unsigned char* p) {
  const __UINTPTR_TYPE__ a = (__UINTPTR_TYPE__)p;
  const __UINTPTR_TYPE__ b = (a + 15u) & ~(__UINTPTR_TYPE__)15u;
  return (unsigned char*)b;
}

static int fdl_depth_for(int hop, int maxLen) {
  int d = (maxLen + hop - 1) / hop + 4;
  if (d < 4) d = 4;
  return d;
}

static int out_cap_for(int maxLen) {
  return maxLen + kMaxHop + kBlockMax + 16;
}

static unsigned long long block_bytes_for(int maxLen) {
  unsigned long long bytes = 512;
  const int outCap = out_cap_for(maxLen);
  bytes += (unsigned long long)maxLen * 4u * 4u; // two banks, L/R IR
  bytes += (unsigned long long)outCap * 4u * 4u; // two banks, L/R rings
  bytes += (unsigned long long)maxLen * 8u * 4u * 2u; // two banks IR spectra (8 floats per IR sample)
  int hop = kHead;
  for (int s = 0; s < kSizeCount; ++s) {
    const int fft = hop * 2;
    const int depth = fdl_depth_for(hop, maxLen);
    bytes += (unsigned long long)fft * 4u * 2u;
    bytes += (unsigned long long)depth * (unsigned long long)fft * 8u * 2u;
    hop <<= 1;
  }
  bytes += (unsigned long long)kMaxFft * 4u * 2u;
  bytes += (unsigned long long)(kHead + kBlockMax + 8) * 4u * 2u;
  bytes += 8192;
  return bytes;
}

static CleanParams sanitize(
  double length, double ampShape, double spectralShape,
  double endCutoffHz, double startCutoffHz, double decorrelate,
  double sampleRate, unsigned int seed
) {
  CleanParams p;
  p.sampleRate = sampleRate > 1.0 && sampleRate == sampleRate ? sampleRate : 44100.0;
  p.length = clampf(length, 1.0 / p.sampleRate, kMaxLengthSeconds);
  p.ampShape = soemdsp::math::segment_contour_soft_cap(ampShape);
  p.spectralShape = soemdsp::math::segment_contour_soft_cap(spectralShape);
  p.endCutoffHz = clampf(endCutoffHz, 0.0, 0.45 * p.sampleRate);
  p.startCutoffHz = clampf(startCutoffHz, 0.0, 0.45 * p.sampleRate);
  p.decorrelate = clampf(decorrelate, 0.0, 1.0);
  p.seed = seed;
  return p;
}

static bool params_equal(const CleanParams& a, const CleanParams& b) {
  return a.length == b.length
    && a.ampShape == b.ampShape
    && a.spectralShape == b.spectralShape
    && a.endCutoffHz == b.endCutoffHz
    && a.startCutoffHz == b.startCutoffHz
    && a.decorrelate == b.decorrelate
    && a.sampleRate == b.sampleRate
    && a.seed == b.seed;
}

static void place_partitions(Bank& b, int irLen, float* arena) {
  b.partCount = 0;
  b.irLen = irLen;
  float* cur = arena;
  int fill = kHead;
  int P = kHead;
  while (fill < irLen && b.partCount < kMaxParts) {
    if (P < kMaxHop && fill >= 2 * P && (fill % (2 * P)) == 0) {
      P *= 2;
      continue;
    }
    const int len = (irLen - fill < P) ? (irLen - fill) : P;
    Partition& p = b.parts[b.partCount];
    p.offset = fill;
    p.length = len;
    p.hop = P;
    p.fftSize = P * 2;
    p.delayHops = fill / P - 1; // 0 = use the hop just collected
    p.specL = cur; cur += (unsigned long long)p.fftSize * 2u;
    p.specR = cur; cur += (unsigned long long)p.fftSize * 2u;
    b.partCount += 1;
    fill += len;
  }
}

static void clear_bank_out(Bank& b) {
  for (int i = 0; i < b.outCap; ++i) { b.outL[i] = 0.0f; b.outR[i] = 0.0f; }
  b.outIdx = 0;
}

static void clear_conv_state(State& s) {
  const int headN = s.headCapSamples;
  for (int i = 0; i < headN; ++i) { s.headL[i] = 0.0f; s.headR[i] = 0.0f; }
  s.headIdx = 0;
  for (int i = 0; i < kSizeCount; ++i) {
    SizeClass& z = s.sizes[i];
    z.write = 0;
    z.filled = 0;
    z.hopsWritten = 0;
    const int fft = z.fftSize;
    for (int k = 0; k < fft; ++k) { z.overlapL[k] = 0.0f; z.overlapR[k] = 0.0f; }
    const int n = z.depth * fft * 2;
    for (int k = 0; k < n; ++k) { z.fdlL[k] = 0.0f; z.fdlR[k] = 0.0f; }
  }
  clear_bank_out(s.bank[0]);
  clear_bank_out(s.bank[1]);
  s.silentAge = 0;
}

static unsigned char* wire_block(State& s, unsigned char* raw, int maxLen) {
  unsigned char* p = align16(raw);
  s.maxLen = maxLen;
  s.headCapSamples = kHead + kBlockMax + 8;
  const int outCap = out_cap_for(maxLen);
  for (int b = 0; b < 2; ++b) {
    s.bank[b].irL = (float*)p; p = align16(p + (unsigned long long)maxLen * 4u);
    s.bank[b].irR = (float*)p; p = align16(p + (unsigned long long)maxLen * 4u);
    s.bank[b].outL = (float*)p; p = align16(p + (unsigned long long)outCap * 4u);
    s.bank[b].outR = (float*)p; p = align16(p + (unsigned long long)outCap * 4u);
    s.bank[b].specArena = (float*)p; p = align16(p + (unsigned long long)maxLen * 8u * 4u);
    s.bank[b].outCap = outCap;
    s.bank[b].outIdx = 0;
    s.bank[b].irLen = 0;
    s.bank[b].partCount = 0;
  }
  int hop = kHead;
  for (int i = 0; i < kSizeCount; ++i) {
    const int fft = hop * 2;
    const int depth = fdl_depth_for(hop, maxLen);
    s.sizes[i].hop = hop;
    s.sizes[i].fftSize = fft;
    s.sizes[i].depth = depth;
    s.sizes[i].write = 0;
    s.sizes[i].filled = 0;
    s.sizes[i].hopsWritten = 0;
    s.sizes[i].overlapL = (float*)p; p = align16(p + (unsigned long long)fft * 4u);
    s.sizes[i].overlapR = (float*)p; p = align16(p + (unsigned long long)fft * 4u);
    s.sizes[i].fdlL = (float*)p; p = align16(p + (unsigned long long)depth * (unsigned long long)fft * 8u);
    s.sizes[i].fdlR = (float*)p; p = align16(p + (unsigned long long)depth * (unsigned long long)fft * 8u);
    hop <<= 1;
  }
  s.headL = (float*)p; p = align16(p + (unsigned long long)s.headCapSamples * 4u);
  s.headR = (float*)p; p = align16(p + (unsigned long long)s.headCapSamples * 4u);
  s.fftRe = (float*)p; p = align16(p + (unsigned long long)kMaxFft * 4u);
  s.fftIm = (float*)p; p = align16(p + (unsigned long long)kMaxFft * 4u);
  return p;
}

static double cutoff_hz(const CleanParams& p, double u) {
  const double fStart = p.startCutoffHz;
  const double fEnd = p.endCutoffHz;
  const double w = soemdsp::math::segment_rational01(u, p.spectralShape);
  if (fStart == 0.0 || fEnd == 0.0) return fStart + (fEnd - fStart) * w;
  return fStart * soemdsp::math::pow_pos(fEnd / fStart, w);
}

static void start_build(State& s, const CleanParams& p, int bank) {
  s.buildBank = bank;
  s.buildPhase = kBuildSamples;
  s.buildT = 0;
  s.buildPart = 0;
  s.buildP = p;
  s.rngL = p.seed ? p.seed : 1u;
  // XOR a constant that is not splitmix's Weyl increment (adding 0x9e3779b9
  // made the two streams strongly correlated).
  s.rngR = s.rngL ^ 0xC2B2AE35u;
  if (s.rngR == 0u) s.rngR = 0xC2B2AE35u;
  s.lpL1 = s.lpL2 = s.lpR1 = s.lpR2 = 0.0f;
  s.energy = 0.0;
  Bank& b = s.bank[bank];
  const int n = ir_len_for(p.length, p.sampleRate);
  const int use = n <= s.maxLen ? n : s.maxLen;
  place_partitions(b, use, b.specArena);
  for (int i = 0; i < use; ++i) { b.irL[i] = 0.0f; b.irR[i] = 0.0f; }
}

static void build_samples(State& s, int count) {
  Bank& b = s.bank[s.buildBank];
  const CleanParams& p = s.buildP;
  const int n = b.irLen;
  const int fadeCap = (int)(0.020 * p.sampleRate + 0.5);
  const int fadeQuarter = n / 4 > 0 ? n / 4 : 1;
  const int fadeN = fadeQuarter < fadeCap ? fadeQuarter : fadeCap;
  const int fadeStart = n - 1 - fadeN;
  const double invNm1 = n > 1 ? 1.0 / (double)(n - 1) : 1.0;
  const double twoPi = 6.283185307179586;
  int t = s.buildT;
  const int end = t + count < n ? t + count : n;
  for (; t < end; ++t) {
    const double u = (double)t * invNm1;
    const double w = soemdsp::math::segment_rational01(u, p.ampShape);
    double env = soemdsp::math::pow_pos(10.0, (kAmpFloorDb / 20.0) * w);
    const double fc = cutoff_hz(p, u);
    double a = soemdsp_maths::dsp_exp(-twoPi * fc / p.sampleRate);
    if (!(a == a) || a < 0.0) a = 0.0;
    const float af = (float)a;
    const float g = (float)(1.0 - a);
    const float xL = rng_gauss(s.rngL) * (float)env;
    const float xR = rng_gauss(s.rngR) * (float)env;
    s.lpL1 = flush_f(af * s.lpL1 + g * xL);
    s.lpL2 = flush_f(af * s.lpL2 + g * s.lpL1);
    s.lpR1 = flush_f(af * s.lpR1 + g * xR);
    s.lpR2 = flush_f(af * s.lpR2 + g * s.lpR1);
    // Taper the filtered IR, not its excitation: filter memory must also end.
    double taper = 1.0;
    if (n > 1 && t > fadeStart) {
      const double x = (double)(t - fadeStart) / (double)fadeN;
      taper = 0.5 * (1.0 + soemdsp_maths::dsp_cos(3.141592653589793 * x));
      if (t == n - 1) taper = 0.0;
    }
    const float yL = (float)(taper * (double)s.lpL2);
    const float yR = (float)(taper * ((1.0 - p.decorrelate) * (double)s.lpL2 + p.decorrelate * (double)s.lpR2));
    b.irL[t] = yL;
    b.irR[t] = yR;
    s.energy += (double)yL * (double)yL + (double)yR * (double)yR;
  }
  s.buildT = t;
  if (s.buildT >= n) s.buildPhase = kBuildScale;
}

static void build_scale(State& s) {
  Bank& b = s.bank[s.buildBank];
  const int n = b.irLen;
  // Unity power per channel pair: sum(L^2+R^2) == 1, so Mix is a meaningful wet gain.
  double e = s.energy;
  if (!(e > 1.0e-30)) e = 1.0;
  const float g = (float)soemdsp_maths::dsp_exp(-0.5 * soemdsp_maths::dsp_ln(e));
  for (int i = 0; i < n; ++i) { b.irL[i] *= g; b.irR[i] *= g; }
  s.buildPhase = kBuildFft;
  s.buildPart = 0;
}

static void fft_ir_partition(State& s, Partition& p, const float* ir, float* spec) {
  const int N = p.fftSize;
  for (int i = 0; i < N; ++i) { s.fftRe[i] = 0.0f; s.fftIm[i] = 0.0f; }
  const int n = p.length < N ? p.length : N;
  for (int i = 0; i < n; ++i) s.fftRe[i] = ir[p.offset + i];
  fft_radix2(s.fftRe, s.fftIm, N, 0);
  float* re = spec;
  float* im = spec + N;
  for (int i = 0; i < N; ++i) { re[i] = s.fftRe[i]; im[i] = s.fftIm[i]; }
}

static void build_ffts(State& s, int count) {
  Bank& b = s.bank[s.buildBank];
  int done = 0;
  while (s.buildPart < b.partCount && done < count) {
    Partition& p = b.parts[s.buildPart];
    fft_ir_partition(s, p, b.irL, p.specL);
    fft_ir_partition(s, p, b.irR, p.specR);
    s.buildPart += 1;
    done += 1;
  }
  if (s.buildPart >= b.partCount) {
    b.built = s.buildP;
    s.buildPhase = kBuildIdle;
    if (!s.haveIr) {
      s.cur = s.buildBank;
      s.haveIr = true;
      s.fading = false;
      s.fade = 0.0;
    } else if (s.buildBank != s.cur) {
      s.fading = true;
      s.fade = 0.0;
    }
  }
}

static void build_all(State& s, const CleanParams& p, int bank) {
  start_build(s, p, bank);
  while (s.buildPhase == kBuildSamples) build_samples(s, kBuildSamplesPerCall);
  if (s.buildPhase == kBuildScale) build_scale(s);
  while (s.buildPhase == kBuildFft) build_ffts(s, 64);
}

static void build_some(State& s) {
  if (s.buildPhase == kBuildSamples) build_samples(s, kBuildSamplesPerCall);
  if (s.buildPhase == kBuildScale) build_scale(s);
  if (s.buildPhase == kBuildFft) build_ffts(s, kBuildFftsPerCall);
}

static void add_head(
  State& s, const Bank& b,
  const float* xL, const float* xR, int frames,
  float* yL, float* yR
) {
  const int cap = s.headCapSamples;
  const int nFir = kHead < b.irLen ? kHead : b.irLen;
  int w = s.headIdx;
  for (int f = 0; f < frames; ++f) {
    w += 1;
    if (w >= cap) w = 0;
    s.headL[w] = xL[f];
    s.headR[w] = xR[f];
    float accL = 0.0f, accR = 0.0f;
    int xi = w;
    for (int k = 0; k < nFir; ++k) {
      accL += s.headL[xi] * b.irL[k];
      accR += s.headR[xi] * b.irR[k];
      xi -= 1;
      if (xi < 0) xi += cap;
    }
    yL[f] += accL;
    yR[f] += accR;
  }
  s.headIdx = w;
}

static void add_to_ring(Bank& b, int start, const float* addL, const float* addR, int n) {
  const int cap = b.outCap;
  int i = start;
  if (i < 0) i %= cap;
  while (i >= cap) i -= cap;
  for (int k = 0; k < n; ++k) {
    b.outL[i] += addL[k];
    b.outR[i] += addR[k];
    i += 1;
    if (i >= cap) i = 0;
  }
}

static void process_finished_hop(State& s, SizeClass& z, int usedBanks, int* banks, int tHopEnd) {
  const int N = z.fftSize;
  const int P = z.hop;
  // Input spectrum already in FFT work? We'll FFT from overlap into FDL.
  auto store = [&](float* overlap, float* fdl, int slot) {
    for (int i = 0; i < N; ++i) { s.fftRe[i] = overlap[i]; s.fftIm[i] = 0.0f; }
    fft_radix2(s.fftRe, s.fftIm, N, 0);
    float* dst = fdl + (unsigned long long)slot * (unsigned long long)N * 2u;
    for (int i = 0; i < N; ++i) { dst[i] = s.fftRe[i]; dst[N + i] = s.fftIm[i]; }
  };
  const int slot = z.write;
  store(z.overlapL, z.fdlL, slot);
  store(z.overlapR, z.fdlR, slot);
  z.write = (z.write + 1) % z.depth;
  z.hopsWritten += 1;

  auto run_bank = [&](Bank& b) {
    // One IFFT per channel for all partitions of this hop. Contributions for
    // this hop land at tHopEnd (the first sample after the just-finished hop).
    auto accum_ifft_add = [&](const float* fdl, bool isRight) {
      for (int k = 0; k < N; ++k) { s.fftRe[k] = 0.0f; s.fftIm[k] = 0.0f; }
      for (int i = 0; i < b.partCount; ++i) {
        const Partition& part = b.parts[i];
        if (part.hop != P) continue;
        if (part.delayHops + 1 > z.hopsWritten) continue;
        int src = slot - part.delayHops;
        while (src < 0) src += z.depth;
        const float* xr = fdl + (unsigned long long)src * (unsigned long long)N * 2u;
        const float* xi = xr + N;
        const float* spec = isRight ? part.specR : part.specL;
        const float* hr = spec;
        const float* hi = spec + N;
        for (int k = 0; k < N; ++k) {
          s.fftRe[k] += xr[k] * hr[k] - xi[k] * hi[k];
          s.fftIm[k] += xr[k] * hi[k] + xi[k] * hr[k];
        }
      }
      fft_radix2(s.fftRe, s.fftIm, N, 1);
      const int cap = b.outCap;
      int idx = b.outIdx + tHopEnd;
      while (idx < 0) idx += cap;
      while (idx >= cap) idx -= cap;
      float* dst = isRight ? b.outR : b.outL;
      for (int k = 0; k < P; ++k) {
        dst[idx] += flush_f(s.fftRe[P + k]);
        idx += 1;
        if (idx >= cap) idx = 0;
      }
    };
    accum_ifft_add(z.fdlL, false);
    accum_ifft_add(z.fdlR, true);
  };
  for (int i = 0; i < usedBanks; ++i) run_bank(s.bank[banks[i]]);

  // Shift overlap: new region becomes previous.
  for (int i = 0; i < P; ++i) {
    z.overlapL[i] = z.overlapL[P + i];
    z.overlapR[i] = z.overlapR[P + i];
    z.overlapL[P + i] = 0.0f;
    z.overlapR[P + i] = 0.0f;
  }
}

static void feed_sizes(
  State& s, const float* xL, const float* xR, int frames,
  int t0, int usedBanks, int* banks
) {
  for (int si = 0; si < kSizeCount; ++si) {
    SizeClass& z = s.sizes[si];
    const int P = z.hop;
    int f = 0;
    while (f < frames) {
      const int room = P - z.filled;
      const int take = (frames - f < room) ? (frames - f) : room;
      for (int k = 0; k < take; ++k) {
        z.overlapL[P + z.filled + k] = xL[f + k];
        z.overlapR[P + z.filled + k] = xR[f + k];
      }
      z.filled += take;
      f += take;
      if (z.filled >= P) {
        const int tHopEnd = t0 + f; // relative to block start; outIdx is block start
        process_finished_hop(s, z, usedBanks, banks, tHopEnd);
        z.filled = 0;
      }
    }
  }
}

static void take_ring(Bank& b, float* yL, float* yR, int frames) {
  const int cap = b.outCap;
  int i = b.outIdx;
  while (i < 0) i += cap;
  while (i >= cap) i -= cap;
  for (int f = 0; f < frames; ++f) {
    yL[f] += b.outL[i];
    yR[f] += b.outR[i];
    b.outL[i] = 0.0f;
    b.outR[i] = 0.0f;
    i += 1;
    if (i >= cap) i = 0;
  }
  b.outIdx = i;
}

static void request_rebuild(State& s, const CleanParams& p) {
  if (s.buildPhase != kBuildIdle) {
    if (!params_equal(s.buildP, p) && !s.fading) {
      start_build(s, p, s.haveIr ? 1 - s.cur : s.cur);
    } else if (!params_equal(s.buildP, p)) {
      s.buildDirty = true;
      s.buildP = p;
    }
    return;
  }
  if (s.haveIr && params_equal(s.bank[s.cur].built, p) && !s.buildDirty) return;
  if (s.fading) {
    s.buildDirty = true;
    s.buildP = p;
    return;
  }
  start_build(s, p, s.haveIr ? 1 - s.cur : s.cur);
}

static void process_run(
  State& s,
  const double* inL, const double* inR, const double* mixIn,
  double* outL, double* outR,
  int frames,
  const CleanParams& p,
  bool mixIsScalar, double mixScalar
) {
  if (frames <= 0) return;
  if (frames > kBlockMax) frames = kBlockMax;

  request_rebuild(s, p);
  if (s.buildPhase != kBuildIdle) build_some(s);

  float xL[kBlockMax], xR[kBlockMax], mC[kBlockMax];
  bool any = false;
  for (int f = 0; f < frames; ++f) {
    double l = inL[f];
    double r = inR[f];
    if (!(l == l)) l = 0.0;
    if (!(r == r)) r = 0.0;
    xL[f] = (float)l;
    xR[f] = (float)r;
    if (l != 0.0 || r != 0.0) any = true;
    double m = mixIsScalar ? mixScalar : mixIn[f];
    if (!(m == m)) m = 0.0;
    if (m < 0.0) m = 0.0;
    if (m > 1.0) m = 1.0;
    mC[f] = (float)m;
  }

  int settle = 0;
  if (s.haveIr) {
    settle = s.bank[s.cur].irLen;
    if (s.fading && s.bank[1 - s.cur].irLen > settle) settle = s.bank[1 - s.cur].irLen;
  }
  const bool skip = s.haveIr && (s.silentAge >= settle) && !any;
  if (!any) {
    if (s.silentAge < 0x7fffffff - frames) s.silentAge += frames;
  } else {
    s.silentAge = 0;
  }

  float wetAL[kBlockMax], wetAR[kBlockMax], wetBL[kBlockMax], wetBR[kBlockMax];
  for (int f = 0; f < frames; ++f) {
    wetAL[f] = wetAR[f] = wetBL[f] = wetBR[f] = 0.0f;
  }

  if (!skip && s.haveIr) {
    int banks[2];
    int used = 1;
    banks[0] = s.cur;
    if (s.fading) { banks[1] = 1 - s.cur; used = 2; }
    // Time-domain head for each bank, then shared input FFTs, then take rings.
    // Head writes into the shared head ring once; must only write once.
    // So: write head ring once, convolve against each bank's IR head.
    const int cap = s.headCapSamples;
    int w = s.headIdx;
    for (int f = 0; f < frames; ++f) {
      w += 1;
      if (w >= cap) w = 0;
      s.headL[w] = xL[f];
      s.headR[w] = xR[f];
      auto fir = [&](const Bank& b, float& oL, float& oR) {
        const int nFir = kHead < b.irLen ? kHead : b.irLen;
        int xi = w;
        float accL = 0.0f, accR = 0.0f;
        for (int k = 0; k < nFir; ++k) {
          accL += s.headL[xi] * b.irL[k];
          accR += s.headR[xi] * b.irR[k];
          xi -= 1;
          if (xi < 0) xi += cap;
        }
        oL += accL;
        oR += accR;
      };
      fir(s.bank[s.cur], wetAL[f], wetAR[f]);
      if (s.fading) fir(s.bank[1 - s.cur], wetBL[f], wetBR[f]);
    }
    s.headIdx = w;

    feed_sizes(s, xL, xR, frames, 0, used, banks);
    take_ring(s.bank[s.cur], wetAL, wetAR, frames);
    if (s.fading) take_ring(s.bank[1 - s.cur], wetBL, wetBR, frames);
  } else if (skip) {
    // Stay skipped: do not feed sizes (they are already flushed). Advance out idx
    // as if we took zeros so a later unsip remains aligned — rings are already 0.
    auto adv = [&](Bank& b) {
      int i = b.outIdx + frames;
      while (i >= b.outCap) i -= b.outCap;
      b.outIdx = i;
    };
    if (s.haveIr) adv(s.bank[s.cur]);
    if (s.fading) adv(s.bank[1 - s.cur]);
  }

  const double fadeStep = 1.0 / (kFadeSeconds * (p.sampleRate > 1.0 ? p.sampleRate : 44100.0));
  bool fading = s.fading;
  double fade = s.fade;
  bool switched = false;
  for (int f = 0; f < frames; ++f) {
    float wetL = wetAL[f];
    float wetR = wetAR[f];
    if (fading) {
      const float g = (float)fade;
      wetL += g * (wetBL[f] - wetL);
      wetR += g * (wetBR[f] - wetR);
      fade += fadeStep;
      if (fade >= 1.0) {
        s.cur = 1 - s.cur;
        fading = false;
        switched = true;
        fade = 0.0;
      }
    } else if (switched) {
      wetL = wetBL[f];
      wetR = wetBR[f];
    }
    const float m = mC[f];
    outL[f] = (double)((1.0f - m) * xL[f] + m * wetL);
    outR[f] = (double)((1.0f - m) * xR[f] + m * wetR);
  }
  s.fading = fading;
  s.fade = fade;
  if (!s.fading && s.buildDirty && s.buildPhase == kBuildIdle) {
    s.buildDirty = false;
    start_build(s, s.buildP, 1 - s.cur);
  }
}

} // namespace

extern "C" {

int soemdsp_noise_conv_reverb_create(double sampleRate) {
  for (int i = 0; i < kMaxInstances; ++i) {
    if (gPool[i].active) continue;
    if (!(sampleRate > 1.0) || !(sampleRate == sampleRate)) sampleRate = 44100.0;
    const int maxLen = max_len_for(sampleRate);
    const unsigned long long bytes = block_bytes_for(maxLen);
    void* block = soemdsp::memory_pool::alloc(bytes);
    if (!block) return 0;
    State& s = gPool[i];
    s.block = block;
    s.sampleRate = sampleRate;
    s.seed = 1u;
    s.cur = 0;
    s.fading = false;
    s.fade = 0.0;
    s.haveIr = false;
    s.buildPhase = kBuildIdle;
    s.buildDirty = false;
    s.active = true;
    wire_block(s, (unsigned char*)block, maxLen);
    clear_conv_state(s);
    const CleanParams p = sanitize(1.5, 0.0, 0.0, 120.0, 1500.0, 1.0, sampleRate, 1u);
    build_all(s, p, 0);
    return i + 1;
  }
  return 0;
}

void soemdsp_noise_conv_reverb_destroy(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (s.active) soemdsp::memory_pool::release(s.block);
  s.block = nullptr;
  s.active = false;
}

void soemdsp_noise_conv_reverb_reset(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (!s.active) return;
  clear_conv_state(s);
}

void soemdsp_noise_conv_reverb_set_seed(int handle, double seed) {
  if (handle <= 0 || handle > kMaxInstances) return;
  State& s = gPool[handle - 1];
  if (!s.active) return;
  unsigned int u = 1u;
  if (seed == seed && seed > 0.0) {
    if (seed > 16777215.0) seed = 16777215.0;
    u = (unsigned int)(seed + 0.5);
    if (u == 0u) u = 1u;
  }
  s.seed = u;
}

double soemdsp_noise_conv_reverb_sample(
  int handle,
  double inL, double inR,
  double length, double ampShape, double spectralShape,
  double endCutoffHz, double startCutoffHz, double decorrelate,
  double mix, double sampleRate
) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  State& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  const CleanParams p = sanitize(length, ampShape, spectralShape, endCutoffHz, startCutoffHz, decorrelate, sampleRate, s.seed);
  double oL = 0.0, oR = 0.0;
  process_run(s, &inL, &inR, nullptr, &oL, &oR, 1, p, true, mix);
  gOutR[0] = oR;
  return oL;
}

void soemdsp_noise_conv_reverb_process_block(
  int handle,
  const double* inL, const double* inR,
  double* outL, double* outR,
  int frames,
  const double* mix,
  double length, double ampShape, double spectralShape,
  double endCutoffHz, double startCutoffHz, double decorrelate,
  double sampleRate
) {
  if (handle <= 0 || handle > kMaxInstances || !inL || !inR || !outL || !outR || frames <= 0) return;
  State& s = gPool[handle - 1];
  if (!s.active) {
    for (int i = 0; i < frames; ++i) { outL[i] = inL[i]; outR[i] = inR[i]; }
    return;
  }
  const CleanParams p = sanitize(length, ampShape, spectralShape, endCutoffHz, startCutoffHz, decorrelate, sampleRate, s.seed);
  process_run(s, inL, inR, mix, outL, outR, frames, p, false, 0.0);
}

double soemdsp_noise_conv_reverb_right(int handle) {
  (void)handle;
  return gOutR[0];
}

int soemdsp_noise_conv_reverb_version() { return 5; }

double soemdsp_noise_conv_reverb_max_length() { return kMaxLengthSeconds; }

int soemdsp_noise_conv_reverb_ir_length(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0;
  const State& s = gPool[handle - 1];
  if (!s.active || !s.haveIr) return 0;
  return s.bank[s.cur].irLen;
}

double soemdsp_noise_conv_reverb_ir_sample(int handle, int channel, int index) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  const State& s = gPool[handle - 1];
  if (!s.active || !s.haveIr) return 0.0;
  const Bank& b = s.bank[s.cur];
  if (index < 0 || index >= b.irLen) return 0.0;
  return channel != 0 ? (double)b.irR[index] : (double)b.irL[index];
}

int soemdsp_noise_conv_reverb_block_max_frames() { return kBlockMax; }
double* soemdsp_noise_conv_reverb_block_in_l() { return gInL; }
double* soemdsp_noise_conv_reverb_block_in_r() { return gInR; }
double* soemdsp_noise_conv_reverb_block_out_l() { return gOutL; }
double* soemdsp_noise_conv_reverb_block_out_r() { return gOutR; }
double* soemdsp_noise_conv_reverb_block_mix() { return gMix; }

int soemdsp_noise_conv_reverb_block_bytes(double sampleRate) {
  if (!(sampleRate > 1.0) || !(sampleRate == sampleRate)) sampleRate = 44100.0;
  const unsigned long long b = block_bytes_for(max_len_for(sampleRate));
  if (b > 2147483647u) return 2147483647;
  return (int)b;
}

} // extern "C"
