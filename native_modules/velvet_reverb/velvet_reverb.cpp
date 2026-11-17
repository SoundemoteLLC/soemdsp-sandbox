// soemdsp-native-module: velvet_reverb
// soemdsp-native-label: Dark Velvet Reverb
// soemdsp-native-target: velvetReverb
// soemdsp-native-kind: reverb
//
// Dark Velvet Reverb: a Dark Velvet Noise (DVN) diffuser. (The velvet noise event
// generator is its own module, velvet_noise / Dark Velvet Noise.)
//
// Diffuser (Dark Velvet Noise):
//   Sparse FIR of Taps rectangular pulses spread over the tail (Length = the
//   decay param, seconds; longer = sparser, not more taps), one per grid cell
//   (Density Skew warps the grid toward the start or the end), with random
//   position, sign and width (1 .. Darkness samples). Tap level falls
//   exponentially to Amp Decay (dB) at the end of the tail: -60 dB = RT60,
//   0 dB = flat, a gated reverb. Each pulse is read
//   from a leaky running sum of the input:
//
//     I[n]   = leak * I[n-1] + x[n]
//     pulse  = I[n - start] - leak^width * I[n - end]        (end = start + width)
//
//   The leak^width factor makes the difference exactly the (leak-weighted) sum
//   of the last `width` samples, so nothing from before the pulse bleeds in and
//   the sum never drifts. Cost is O(1) per tap for any width.
//
//   Widths are continuous (Darkness 1.66 is really 1.66 samples). A pulse of
//   width w = n + f covers n whole samples plus the next one at weight f, so the
//   colour glides between whole widths instead of stepping. The partial sample
//   comes from the same running sum (x[k] = I[k] - leak * I[k + 1]):
//
//     pulse  = I[s] - leak^n (1 - f) I[s + n] - f leak^(n+1) I[s + n + 1]
//
//   One more read per tap; still O(1) for any width. Gain is 1 / w.
//
//   When parameters stay still for a whole engine block (128 samples), the
//   audio path is tap-major: each tap is applied to the whole block before
//   the next tap, which is the same per-sample accumulation order (and the
//   same double math) as the historical sample loop, so the output is
//   bit-identical. A one-block pad on the delay line keeps those reads
//   linear (no wrap mid-vector). A wrap is otherwise branchless. If a
//   parameter changes mid-block, the caller splits the block and this
//   module starts any table fade on the same sample as before. After the
//   delay has held only silence for max-tap-end + 1 samples, the tap
//   reads are skipped because every window would already be exactly 0.
//
// Click-free changes:
//   Taps, Length, Amp Decay, Density Skew, Darkness, Tail Darkness, Tail Curve, Tail Random, Stereo Spread, Seed and the sample rate all
//   rebuild the tap table. A rebuild goes into the idle one of two tables and
//   the wet signal crossfades to it (kFadeSeconds). While a fade is running,
//   further changes wait for it, so a swept knob costs one rebuild per fade.
//
// No latency: taps are causal and the earliest pulse can sit at delay 0, so dry
// and wet are already time-aligned.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/memory_pool.h>
#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif

namespace {

// Slots are tiny: the big buffers (two tap tables and two delay lines) come from
// the shared memory pool when an instance is created (engine build, never in the
// sample path) and go back when it is destroyed. The delay lines are sized from
// the sample rate the instance is created at: kMaxLengthSeconds plus the widest
// pulse, so any Length the definition allows fits (about 12 MB per instance at
// 48 kHz, 21 MB at 96 kHz, 40 MB at 192 kHz; soemdsp_velvet_reverb_block_bytes).
static const int kMaxInstances = 128;
// Physical limits only. Taps, Length and Darkness ranges belong to the parameters;
// the DSP follows whatever they allow up to what fits in memory / the delay line.
static const int kMaxTaps = 4096;
static const int kMaxPulseWidth = 65536; // a pulse must fit well inside the delay line
// Longest Length the delay line is sized for. Mirrors the Length (decay)
// definition max, which is the source of truth: test_velvet_reverb.mjs checks
// that they match (soemdsp_velvet_reverb_max_length).
static const double kMaxLengthSeconds = 6.0;
// Delay line length in samples at a sample rate: the longest Length plus the
// widest pulse plus read margin. Not a power of two (that would waste up to
// half the memory); reads wrap with one compare. Taps that would still land
// past the end (an instance running faster than the rate it was built for)
// are left out, never piled up at the edge.
static inline int delay_size_for(double sampleRate) {
  if (!(sampleRate >= 1000.0)) sampleRate = 48000.0;
  if (sampleRate > 768000.0) sampleRate = 768000.0;
  return (int)__builtin_ceil(kMaxLengthSeconds * sampleRate) + kMaxPulseWidth + 8;
}
static const double kLeak = 0.9999;
static const double kLnLeak = -1.0000500033335824e-4; // ln(kLeak)
static const double kFadeSeconds = 0.02;
// One engine block (graph_engine kMaxBlockFrames). The delay lines keep this
// many extra cells as a mirror of the start, so a block-sized read that
// would wrap is still a linear address.
static const int kBlockPad = 128;

// SoA tap table (better for a tap-major, SIMD block). Same fields as the
// previous per-tap struct, plus maxEnd for the settled-silence skip.
struct TapChan {
  int start[kMaxTaps];
  int mid[kMaxTaps];
  int end[kMaxTaps];
  double gain[kMaxTaps];
  double cMid[kMaxTaps];
  double cEnd[kMaxTaps];
  int count;
  int maxEnd;
  double norm;
};

struct TapTable {
  TapChan left;
  TapChan right;
};

struct VelvetReverbState {
  bool active;

  // Tap tables: `cur` is audible; during a fade the other one fades in.
  TapTable* tables; // two tables, in the pool block
  int cur;
  bool fading;
  double fade; // 0 .. 1 toward the other table

  // What the newest table was built from.
  double builtGrid;
  double builtWidth;
  double builtSpread;
  double builtDecay;
  double builtTail;
  double builtAmp;
  double builtSkew;
  double builtGap;
  double builtTailRandom;
  double builtTailCurve;
  double builtRate;
  unsigned int builtSeed;

  unsigned int seed;

  // Diffuser. Delay lines are SoA (packed values, packed counts) with
  // kBlockPad extra cells at the end mirroring [0, kBlockPad).
  double integralL;
  double integralR;
  int writeIdx;
  unsigned int countL;
  unsigned int countR;
  int delaySize;     // ring length (delay_size_for the creation rate)
  int delayStride;   // delaySize + kBlockPad
  double* delayLv;
  double* delayRv;
  unsigned int* delayLc;
  unsigned int* delayRc;
  int silentAgeL;    // consecutive zero-input samples on this channel
  int silentAgeR;
  // Precision: true = float delay / running sum (default); false = double.
  bool useFloat;
  float integralFL;
  float integralFR;
  void* block;       // the one pool block that holds tables, delay lines, and display peaks

  // Face telemetry: peak-hold of |width-filtered pulse x gain x table norm|
  // per tap, L and R, until the worklet takes a snapshot. Off unless the face
  // is visible (soemdsp_velvet_reverb_set_display).
  double* peakL;
  double* peakR;
  bool displayOn;

  double outRight;
};

static VelvetReverbState gPool[kMaxInstances];

static inline unsigned long long block_bytes_for(int delaySize) {
  const unsigned long long stride = (unsigned long long)delaySize + (unsigned long long)kBlockPad;
  // 16-byte slop so the delay arrays can be aligned for v128 loads.
  return 2ULL * sizeof(TapTable)
    + 16ULL
    + 2ULL * stride * sizeof(double)
    + 2ULL * stride * sizeof(unsigned int)
    + 2ULL * (unsigned long long)kMaxTaps * sizeof(double);
}

static inline unsigned char* align16(unsigned char* p) {
  const uintptr_t a = (uintptr_t)p;
  return (unsigned char*)((a + 15u) & ~(uintptr_t)15u);
}

static inline unsigned int next_rand(unsigned int& state) {
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return state;
}

// Uniform in [0, 1) from the top 24 bits.
static inline double next_unit(unsigned int& state) {
  return (double)(next_rand(state) >> 8) * (1.0 / 16777216.0);
}

static inline unsigned int seed_left(unsigned int seed) {
  return seed ? seed : 0x12345678u;
}

static inline unsigned int seed_right(unsigned int seed) {
  const unsigned int r = seed_left(seed) ^ 0x9E3779B9u;
  return r ? r : 0x87654321u;
}

// width >= 1, any real value: n whole samples plus one at weight f.
static inline void set_tap(TapChan& ch, int index, int start, double width, double sign) {
  const int n = (int)width;
  const double f = width - (double)n;
  const double leakN = soemdsp_maths::dsp_exp((double)n * kLnLeak);
  ch.start[index] = start;
  ch.mid[index] = start + n;
  ch.end[index] = f > 0.0 ? ch.mid[index] + 1 : ch.mid[index];
  ch.gain[index] = sign / width;
  ch.cMid[index] = leakN * (1.0 - f);
  ch.cEnd[index] = leakN * kLeak * f;
}

static inline void finish_channel(TapChan& ch) {
  int maxE = 0;
  for (int i = 0; i < ch.count; ++i) {
    if (ch.end[i] > maxE) maxE = ch.end[i];
  }
  ch.maxEnd = maxE;
}

// A pulse's energy factor on noise: sum of its squared weights times gain^2,
// (n + f^2) / w^2. At whole widths this is 1 / w.
static inline double width_energy(double w) {
  const int n = (int)w;
  const double f = w - (double)n;
  return ((double)n + f * f) / (w * w);
}

// Fills `t` from the given settings. Every tap draws the same number of random
// values whatever the settings are, so one setting can move without
// reshuffling what the others decided.
// ln((N-1)!) for whole N >= 1: exact sum for small N, Stirling above.
static double ln_gamma_int(int N) {
  if (N < 16) {
    double sum = 0.0;
    for (int k = 2; k < N; ++k) sum += soemdsp_maths::dsp_ln((double)k);
    return sum;
  }
  const double n = (double)N;
  const double inv = 1.0 / n;
  const double inv2 = inv * inv;
  return (n - 0.5) * soemdsp_maths::dsp_ln(n) - n + 0.9189385332046728
    + inv * (1.0 / 12.0 - inv2 * (1.0 / 360.0 - inv2 / 1260.0));
}

// Mean of width_energy(w) over w uniform in [1, W] (a tap's energy factor on
// noise for widths drawn continuously up to W). Exact: on [n, n+1) the
// integrand is 1 - 2n/w + (n + n^2)/w^2, whose whole-unit integrals sum to
// 2(N-1) - 2(N-1) ln N + 2 ln((N-1)!), plus the partial last unit. Continuous
// in W, 1 at W = 1.
static double mean_width_energy(double W) {
  if (W <= 1.0) return 1.0;
  if (W - 1.0 < 1e-6) return 1.0 - (W - 1.0);
  const int N = (int)W;
  const double n = (double)N;
  const double g = W - n;
  double F = 2.0 * (n - 1.0) - 2.0 * (n - 1.0) * soemdsp_maths::dsp_ln(n) + 2.0 * ln_gamma_int(N);
  if (g > 0.0) {
    F += g - 2.0 * n * soemdsp_maths::dsp_ln(W / n) + (n + n * n) * (1.0 / n - 1.0 / W);
  }
  return F / (W - 1.0);
}

// ln(1000): an exponential that falls this much (in nepers) is down 60 dB.
static const double kLn1000 = 6.907755278982137;

// What a table build reports for the face (velvet_reverb_layout): every Left
// and Right tap's delay, width and signed level, the tail length used and which
// physical limit (if any) shaped it.
struct Layout {
  double* pos;    // seconds
  double* width;  // seconds
  double* level;  // amplitude only, signed: sign x Amp Decay envelope (x the last tap's fraction); no darkness gain (1/width or the Tail Darkness energy make-up), so the face height is amplitude and its brightness is darkness
  double* posR;   // Right taps, same units
  double* widthR;
  double* levelR;
  double length;  // seconds actually used
  int flags;      // kLayoutTapLimit | kLayoutLengthLimit
  int countR;     // Right tap count (Left = the layout call's return)
};
static const int kLayoutTapLimit = 1;    // Taps > kMaxTaps (the engine's table size)
static const int kLayoutLengthLimit = 2; // Length longer than the delay line: the tail is held there
static const int kLayoutThinned = 4;     // fewer taps play than Taps asks: they would bunch up (cell floor)

// Cell floor (velvet_reverb v6, v11 no-overlap starts): no tap's cell is
// narrower than max(Min Gap, pulse width + 1 sample), so every pulse has a
// whole-sample start in [cellStart, cellEnd - width] and ends inside its
// own cell. (The +1 is on the pulse, not on Min Gap, so a 1 ms default
// gap is unchanged when Darkness is 1.) Where Density Skew (or simply many
// Taps in a short Length) would pack cells tighter, the taps there are not
// used: the tap count follows the floor instead of the setting, which also
// saves CPU. kWarpSteps sections of the warp are each given
// min(Taps share, section length / floor) taps; the running sum is continuous
// in every parameter, and its fraction fades the last tap in exactly like a
// fractional Taps, so moving Skew never pops.
static const double kDefaultMinGapMs = 1.0; // the Min Gap definition default (48 samples at 48 kHz)
static inline double clean_min_gap_ms(double ms) {
  if (!(ms == ms)) return kDefaultMinGapMs;
  return ms > 0.0 ? ms : 0.0;
}
// 4096 sections keep the rational warp well resolved up to a contour of
// about +-0.995 (the soft cap used at Skew +-1). 1024 was only comfortable
// out to +-0.9, where the last section would otherwise swallow most of the tail.
static const int kWarpSteps = 4096;
// The rational curve is a step at contour = +-1 (every interior p maps to 0
// or 1: every tap on one sample). Soft-cap just inside that so +-1 stays
// finite: extreme packing toward the start or the end, Min Gap still drops
// taps that would bunch, no NaN and no infinite cells. Last/first section
// stays about 5% of the tail (20 / kWarpSteps).
static const double kMaxWarpContour = 1.0 - 20.0 / (double)kWarpSteps;
static double gWarpX[kWarpSteps + 1]; // warped position (samples) at section edges
static double gWarpN[kWarpSteps + 1]; // taps kept up to each edge (running sum)

static inline double clean_tail_random(double r) {
  if (!(r == r)) return 1.0; // default = the previous (fully random) widths
  if (r < 0.0) return 0.0;
  if (r > 1.0) return 1.0;
  return r;
}

// Tail Curve: Step Graph rational contour, -1..+1 (NaN -> 0, the neutral curve).
static inline double clean_tail_curve(double c) {
  if (!(c == c)) return 0.0;
  if (c > 1.0) return 1.0;
  if (c < -1.0) return -1.0;
  return c;
}

// DSP warp contour for Density Skew. Parameter range is -1..+1; the rational
// curve is soft-capped just inside +-1 (see kMaxWarpContour).
static inline double warp_contour(double densitySkew) {
  double s = densitySkew == densitySkew ? densitySkew : 0.0;
  if (s > 1.0) s = 1.0;
  if (s < -1.0) s = -1.0;
  double c = -s;
  if (c > kMaxWarpContour) c = kMaxWarpContour;
  if (c < -kMaxWarpContour) c = -kMaxWarpContour;
  return c;
}

// Expected energy factor of a pulse whose widest width is W, at a Tail Random
// amount: 0 = the width is always W, 1 = uniform in [1, W] (mean_width_energy).
static inline double expected_width_energy(double W, double randAmt) {
  const double smoothE = width_energy(W);
  const double randomE = mean_width_energy(W);
  return smoothE + randAmt * (randomE - smoothE);
}

// Room a cell needs so the pulse ends inside it and there is at least one
// whole-sample start: max(Min Gap, width + 1). Adding 1 to Min Gap itself
// would shrink default 1 ms packing (25 ms / 64 taps would drop a tap).
static inline double cell_need(double minGap, double width) {
  const double w = width + 1.0;
  return w > minGap ? w : minGap;
}

// Whole-sample start in [cellStart, cellEnd - width]. If the historical
// full-cell jitter already lands in that window, keep it (Darkness 1
// default patches stay bit-identical). Otherwise remap jitter into the
// window. Returns false when the cell is too small (drop the tap).
static inline bool start_in_cell(double cellStart, double cellEnd, double width, double jitter, double minGap, int* startOut, double* posAmpOut) {
  if (!startOut) return false;
  (void)minGap;
  // First whole sample at or after cellStart (ceil), so a pulse that ends
  // at the previous cell's end cannot share a sample with this start.
  int first = (int)cellStart;
  if ((double)first < cellStart) first += 1;
  if (first < 0) first = 0;
  if ((double)first + width > cellEnd) first += 1;
  int last = (int)(cellEnd - width);
  while (last >= first && (double)last + width > cellEnd) last -= 1;
  if (first > last) return false;
  const double posOld = cellStart + jitter * (cellEnd - cellStart);
  int s = (int)posOld;
  if (s >= first && s <= last) {
    *startOut = s;
    if (posAmpOut) *posAmpOut = posOld;
    return true;
  }
  const double latest = cellEnd - width;
  const double lo = cellStart;
  const double hi = latest > lo ? latest : lo;
  const double pos = lo + jitter * (hi - lo);
  s = (int)pos;
  if (s < first) s = first;
  if (s > last) s = last;
  *startOut = s;
  if (posAmpOut) *posAmpOut = (double)s;
  return true;
}

static void build_table(
  TapTable& t, double taps, double headWidth, double spread, unsigned int seed,
  double lengthSeconds, double sampleRate, double tailWidth, double ampDecayDb,
  double densitySkew, double minGapMs, double tailRandom, double tailCurve, int delaySize, Layout* out
) {
  // Each parameter has one job (velvet_reverb v4):
  //   Taps        how many taps (continuous: the last one fades in by its fraction)
  //   Length      spreads those taps over the tail (s); longer = sparser, not more
  //   Amp Decay   tap level at the end of the tail (dB), an exponential fade
  //               along it: 0 dB = flat (gated), -60 dB = RT60
  //   Density Skew where the taps sit: the Step Graph rational curve
  //               (segment_rational01, contour = -skew) warps the even grid, so
  //               + packs them toward the start and - toward the end (a
  //               reverse-reverb build-up); taps that would pack under the
  //               cell floor are not used (v6). The definition range is
  //               -1..+1. At exactly +-1 the contour is soft-capped just
  //               inside the curve's step so packing stays extreme but finite
  //               (Min Gap still drops bunched taps; no NaN, no infinite
  //               cells). The knob's bipolar rational scaling (amount -0.99)
  //               gives fine control near 0.
  // A tail is at least one sample long and has to fit the delay line with its
  // widest pulse (physical limits only).
  int flags = 0;
  double length = lengthSeconds * sampleRate;
  if (!(length >= 1.0)) length = 1.0;
  const double widest = headWidth > tailWidth ? headWidth : tailWidth;
  const double maxLength = (double)(delaySize - 4) - widest;
  if (length > maxLength) { length = maxLength; flags |= kLayoutLengthLimit; }

  double exactTaps = taps;
  if (exactTaps > (double)kMaxTaps) { exactTaps = (double)kMaxTaps; flags |= kLayoutTapLimit; }
  if (!(exactTaps > 1e-6)) exactTaps = 1e-6;
  const double contour = warp_contour(densitySkew);
  const double randAmt = clean_tail_random(tailRandom);
  // Curve 0 is identity (segment_rational01). Positive raises mid-segment
  // weight (the same sign as Step Graph), so the sweep reaches Tail Dark sooner.
  const double curveC = soemdsp_maths::segment_contour_soft_cap(clean_tail_curve(tailCurve));
  const bool ramp = tailWidth > 0.0 && tailWidth != headWidth;
  // Widest pulse at a place in the tail. Base sweep is geometric in width
  // (log-domain lerp, cutoff ~ 1/width falls exponentially over time).
  // Tail Curve then warps the 0..1 progress with the Step Graph rational curve.
  auto widestAt = [&](double x) {
    if (!ramp) return headWidth;
    const double p = x / length;
    const double u = soemdsp_maths::segment_rational01(p, curveC);
    const double a = headWidth < 1.0 ? 1.0 : headWidth;
    const double b = tailWidth < 1.0 ? 1.0 : tailWidth;
    const double m = (a == b) ? a : a * soemdsp_maths::pow_pos(b / a, u);
    return m < 1.0 ? 1.0 : m;
  };
  // Min Gap: the least spacing between consecutive cells (never less than
  // the pulse there plus one sample of start positions, and at least one sample).
  double minGap = clean_min_gap_ms(minGapMs) * 0.001 * sampleRate;
  if (minGap < 1.0) minGap = 1.0;
  auto floorAt = [&](double x) {
    return cell_need(minGap, widestAt(x));
  };

  // Kept taps along the warped tail (see kWarpSteps). Without the floor this is
  // the plain warped grid: Taps cells of equal share in the unwarped 0..1 tail.
  gWarpX[0] = 0.0;
  gWarpN[0] = 0.0;
  const double share = exactTaps / (double)kWarpSteps;
  for (int j = 1; j <= kWarpSteps; ++j) {
    double x = length * soemdsp_maths::segment_rational01((double)j / (double)kWarpSteps, contour);
    if (!(x == x) || x < gWarpX[j - 1]) x = gWarpX[j - 1];
    if (x > length) x = length;
    gWarpX[j] = x;
    const double dx = gWarpX[j] - gWarpX[j - 1];
    const double fit = dx / floorAt(0.5 * (gWarpX[j] + gWarpX[j - 1]));
    gWarpN[j] = gWarpN[j - 1] + (fit < share ? fit : share);
  }
  double keptTaps = gWarpN[kWarpSteps];
  if (keptTaps < exactTaps * (1.0 - 1e-9)) flags |= kLayoutThinned;
  else keptTaps = exactTaps; // round-off: every tap fits
  if (!(keptTaps > 1e-6)) keptTaps = 1e-6;
  // Position (samples) of the place where `n` kept taps have gone by.
  int seg = 1;
  auto cellEdge = [&](double n) {
    if (n <= 0.0) return 0.0;
    if (n >= gWarpN[kWarpSteps]) return gWarpX[kWarpSteps];
    while (seg > 1 && gWarpN[seg - 1] > n) --seg;
    while (seg < kWarpSteps && gWarpN[seg] < n) ++seg;
    const double dn = gWarpN[seg] - gWarpN[seg - 1];
    const double f = dn > 0.0 ? (n - gWarpN[seg - 1]) / dn : 0.0;
    return gWarpX[seg - 1] + f * (gWarpX[seg] - gWarpX[seg - 1]);
  };

  int count = (int)keptTaps;
  double lastPart = keptTaps - (double)count;
  // A leftover below 1e-6 of a tap is float round-off, not a tap.
  if (lastPart > 1e-6) {
    count += 1;
  } else {
    lastPart = 1.0;
  }
  if (count > kMaxTaps) { count = kMaxTaps; lastPart = 1.0; }
  if (count < 1) { count = 1; lastPart = 1.0; }

  // Amp Decay: level falls exponentially from 0 dB at the input to ampDecayDb at
  // the end of the tail (per sample in nepers).
  const double ampDb = ampDecayDb == ampDecayDb ? ampDecayDb : -60.0;
  const double decayK = -ampDb * (kLn1000 / 60.0) / length;
  double sumL = 0.0;
  double sumR = 0.0;
  unsigned int sL = seed_left(seed);
  unsigned int sR = seed_right(seed);
  int countL = 0;
  int countR = 0;
  bool openL = true;
  bool openR = true;

  // Tail Darkness: the widest pulse grows from Darkness at the start of the
  // tail to Tail Darkness at its end (0 = off), so the tail darkens over time
  // the way a room's highs die first (Dark Velvet Noise, Fagerstrom et al.,
  // DAFx 2022), and wide late pulses smear sparse late taps. Each tap also
  // gets back the energy wider pulses lose, so Amp Decay alone sets the tail's
  // level and Tail Darkness only its colour.
  // Tail Random (0..1): 1 = widths drawn uniformly in [1, maxWidth] (the
  // previous Tail Dark behaviour); 0 = every pulse follows the smooth
  // Darkness -> Tail Darkness curve with no width randomness (a clean 'pow'
  // as the filter closes); in between, the random draw is crossfaded in.
  // The RNG stream is always consumed in the same order, so Seed still
  // determines positions and signs at any Tail Random.
  const double headEnergy = expected_width_energy(headWidth, randAmt);

  for (int i = 0; i < count; ++i) {
    const bool last = (i == count - 1);
    const double part = last ? lastPart : 1.0; // the last cell is what is left
    const double cellStart = cellEdge((double)i);
    const double cellEnd = cellEdge((double)i + part);

    const double jitterL = next_unit(sL);
    const double widthUnitL = next_unit(sL);
    const double signL = (next_rand(sL) & 0x10000u) ? 1.0 : -1.0;

    const double jitterR = next_unit(sR);
    const double widthUnitR = next_unit(sR);
    const double ownSignR = (next_rand(sR) & 0x10000u) ? 1.0 : -1.0;
    const double ownR = next_unit(sR);

    double maxWidth = headWidth;
    double rampGain = 1.0;
    if (ramp) {
      maxWidth = widestAt(cellStart); // where the cell starts in the tail
      rampGain = __builtin_sqrt(headEnergy / expected_width_energy(maxWidth, randAmt));
    }
    // Widths: at Tail Random 1, uniform over [1, maxWidth]; at 0, exactly
    // maxWidth (the smooth curve). The lerp stays in [1, maxWidth].
    const double randWidthL = 1.0 + widthUnitL * (maxWidth - 1.0);
    const double randWidthR = 1.0 + widthUnitR * (maxWidth - 1.0);
    const double widthL = maxWidth + randAmt * (randWidthL - maxWidth);
    const double rawWidthR = maxWidth + randAmt * (randWidthR - maxWidth);
    const double widthR = widthL + spread * (rawWidthR - widthL); // stays in [1, maxWidth]
    // The sign goes independent on a per-tap threshold, so decorrelation grows evenly.
    const double signR = (ownR < spread) ? ownSignR : signL;
    // Whole-sample start in [cellStart, cellEnd - pulseWidth] per channel
    // (Right follows Left's jitter at Spread 0 and its own at Spread 1).
    // A cell narrower than max(Min Gap, this pulse's width + 1) drops the
    // tap the same way extra taps are already dropped (thinned flag).
    // RNG is always consumed above, so Seed stays deterministic at any
    // Darkness / Tail Random / Spread.
    const double jitterPosR = jitterL + spread * (jitterR - jitterL);
    int startL = 0;
    int startR = 0;
    double posAmpL = 0.0;
    double posAmpR = 0.0;
    const bool fitL = start_in_cell(cellStart, cellEnd, widthL, jitterL, minGap, &startL, &posAmpL);
    const bool fitR = start_in_cell(cellStart, cellEnd, widthR, jitterPosR, minGap, &startR, &posAmpR);
    if ((openL && !fitL) || (openR && !fitR)) flags |= kLayoutThinned;

    if (openL) {
      if (fitL && (double)startL + widthL < (double)(delaySize - 1)) {
        const double posL = posAmpL;
        const double ampL = part * soemdsp_maths::dsp_exp(-decayK * (posL + 0.5 * widthL)); // amplitude (face height)
        const double envL = rampGain * ampL;
        if (out) {
          out->pos[countL] = (double)startL / sampleRate;
          out->width[countL] = widthL / sampleRate;
          out->level[countL] = signL * ampL;
        }
        set_tap(t.left, countL, startL, widthL, signL * envL);
        countL += 1;
        // A tap averages `width` samples (gain 1/width), so its energy on
        // noise is env^2 * (n + f^2) / w^2 (env^2 / width at whole widths).
        // Counting the width keeps the wet level the same at any Darkness.
        sumL += envL * envL * width_energy(widthL);
      } else if (!fitL) {
        // Dropped: cell too narrow for this pulse. Keep openL so later
        // cells can still play.
      } else {
        openL = false;
      }
    }
    if (openR) {
      if (fitR && (double)startR + widthR < (double)(delaySize - 1)) {
        const double blendPosR = posAmpR;
        const double ampR = part * soemdsp_maths::dsp_exp(-decayK * (blendPosR + 0.5 * widthR));
        const double envR = rampGain * ampR;
        if (out) {
          out->posR[countR] = (double)startR / sampleRate;
          out->widthR[countR] = widthR / sampleRate;
          out->levelR[countR] = signR * ampR;
        }
        set_tap(t.right, countR, startR, widthR, signR * envR);
        countR += 1;
        sumR += envR * envR * width_energy(widthR);
      } else if (!fitR) {
        // Dropped: cell too narrow for this pulse.
      } else {
        openR = false;
      }
    }
    if (!openL && !openR) break;
  }

  t.left.count = countL;
  t.right.count = countR;
  t.left.norm = sumL > 0.0 ? 1.0 / __builtin_sqrt(sumL) : 0.0;
  // Right normalizes on its own energy like Left.
  t.right.norm = sumR > 0.0 ? 1.0 / __builtin_sqrt(sumR) : 0.0;
  finish_channel(t.left);
  finish_channel(t.right);
  if (out) {
    out->length = length / sampleRate;
    out->flags = flags;
    out->countR = countR;
  }
}

// Face layout: one static table (no delay lines), rebuilt only when the face asks.
static TapTable gLayoutTable;
static double gLayoutPos[kMaxTaps];
static double gLayoutWidth[kMaxTaps];
static double gLayoutLevel[kMaxTaps];
static double gLayoutPosR[kMaxTaps];
static double gLayoutWidthR[kMaxTaps];
static double gLayoutLevelR[kMaxTaps];
static Layout gLayout = { gLayoutPos, gLayoutWidth, gLayoutLevel, gLayoutPosR, gLayoutWidthR, gLayoutLevelR, 0.0, 0, 0 };

// Same sanitising as the audio path (soemdsp_velvet_reverb_sample).
static inline double clean_width(double darkness) {
  double width = (darkness == darkness) ? darkness : 1.0;
  if (width < 1.0) width = 1.0;
  if (width > (double)kMaxPulseWidth) width = (double)kMaxPulseWidth;
  return width;
}
static inline double clean_tail(double tailDarkness) {
  double tail = (tailDarkness == tailDarkness && tailDarkness > 0.0) ? tailDarkness : 0.0; // 0 = off
  if (tail > (double)kMaxPulseWidth) tail = (double)kMaxPulseWidth;
  return tail;
}
static inline double clean_spread(double stereoSpread) {
  double spread = (stereoSpread == stereoSpread) ? stereoSpread : 1.0;
  if (spread < 0.0) spread = 0.0;
  if (spread > 1.0) spread = 1.0;
  return spread;
}

static inline int wrap_index(int i, int size) {
  // i is in (-size, size). One add is enough; the shift makes it branchless.
  return i + (size & (i >> 31));
}

static inline void write_delay_cell(double* v, unsigned int* c, int size, int w, double val, unsigned int cnt) {
  v[w] = val;
  c[w] = cnt;
  if (w < kBlockPad) {
    v[size + w] = val;
    c[size + w] = cnt;
  }
}

// Add one tap to wet[lo..hi) from three contiguous value/count streams (old
// delay or the block's fresh writes). Lane order matches the historical
// per-sample loop: a.count == c.count -> exactly 0, else the leaky boxcar.
static void acc_range(
  double* wet, int lo, int hi,
  const double* aV, const unsigned int* aC,
  const double* bV, const unsigned int* bC,
  const double* cV, const unsigned int* cC,
  double gain, double cMid, double cEnd,
  double* peak, double magScale
) {
  const bool hold = peak != nullptr;
  int f = lo;
#if defined(__wasm_simd128__) && !defined(VELVET_NO_SIMD)
  const v128_t vGain = wasm_f64x2_splat(gain);
  const v128_t vCMid = wasm_f64x2_splat(cMid);
  const v128_t vCEnd = wasm_f64x2_splat(cEnd);
  int i = 0;
  const int n = hi - lo;
  for (; i + 1 < n; i += 2) {
    const v128_t va = wasm_f64x2_make(aV[i], aV[i + 1]);
    const v128_t vb = wasm_f64x2_make(bV[i], bV[i + 1]);
    const v128_t vc = wasm_f64x2_make(cV[i], cV[i + 1]);
    // Same association as the scalar path: ((a - cMid*b) - cEnd*c) * gain.
    v128_t y = wasm_f64x2_mul(
      wasm_f64x2_sub(wasm_f64x2_sub(va, wasm_f64x2_mul(vCMid, vb)), wasm_f64x2_mul(vCEnd, vc)),
      vGain
    );
    const unsigned long long m0 = (aC[i] == cC[i]) ? 0ull : ~0ull;
    const unsigned long long m1 = (aC[i + 1] == cC[i + 1]) ? 0ull : ~0ull;
    y = wasm_v128_and(y, wasm_i64x2_make((long long)m0, (long long)m1));
    const v128_t w = wasm_f64x2_make(wet[lo + i], wet[lo + i + 1]);
    const v128_t s = wasm_f64x2_add(w, y);
    wet[lo + i] = wasm_f64x2_extract_lane(s, 0);
    wet[lo + i + 1] = wasm_f64x2_extract_lane(s, 1);
    if (hold) {
      const double y0 = wasm_f64x2_extract_lane(y, 0);
      const double y1 = wasm_f64x2_extract_lane(y, 1);
      const double mag0 = (y0 < 0.0 ? -y0 : y0) * magScale;
      const double mag1 = (y1 < 0.0 ? -y1 : y1) * magScale;
      if (mag0 > *peak) *peak = mag0;
      if (mag1 > *peak) *peak = mag1;
    }
  }
  f = lo + i;
#endif
  for (; f < hi; ++f) {
    const int i = f - lo;
    if (aC[i] == cC[i]) continue;
    const double y = (aV[i] - cMid * bV[i] - cEnd * cV[i]) * gain;
    if (hold) {
      const double mag = (y < 0.0 ? -y : y) * magScale;
      if (mag > *peak) *peak = mag;
    }
    wet[f] += y;
  }
}

static inline const double* delay_v_at(const double* delayV, int size, int w0, int f, int d) {
  return delayV + wrap_index(w0 + f - d, size);
}
static inline const unsigned int* delay_c_at(const unsigned int* delayC, int size, int w0, int f, int d) {
  return delayC + wrap_index(w0 + f - d, size);
}

static void acc_one_tap(
  double* wet, int frames,
  int w0, int size,
  const double* delayV, const unsigned int* delayC,
  const double* freshV, const unsigned int* freshC,
  int start, int mid, int end,
  double gain, double cMid, double cEnd,
  double* peak, double magScale
) {
  // Split where each delay switches from the old line to this block's fresh writes.
  int p[5];
  p[0] = 0;
  p[1] = start < frames ? start : frames;
  p[2] = mid < frames ? mid : frames;
  p[3] = end < frames ? end : frames;
  p[4] = frames;
  for (int s = 0; s < 4; ++s) {
    const int lo = p[s];
    const int hi = p[s + 1];
    if (hi <= lo) continue;
    const double* aV;
    const unsigned int* aC;
    const double* bV;
    const unsigned int* bC;
    const double* cV;
    const unsigned int* cC;
    if (start <= lo) { aV = freshV + (lo - start); aC = freshC + (lo - start); }
    else { aV = delay_v_at(delayV, size, w0, lo, start); aC = delay_c_at(delayC, size, w0, lo, start); }
    if (mid <= lo) { bV = freshV + (lo - mid); bC = freshC + (lo - mid); }
    else { bV = delay_v_at(delayV, size, w0, lo, mid); bC = delay_c_at(delayC, size, w0, lo, mid); }
    if (end <= lo) { cV = freshV + (lo - end); cC = freshC + (lo - end); }
    else { cV = delay_v_at(delayV, size, w0, lo, end); cC = delay_c_at(delayC, size, w0, lo, end); }
    acc_range(wet, lo, hi, aV, aC, bV, bC, cV, cC, gain, cMid, cEnd, peak, magScale);
  }
}

static void acc_channel(
  double* wet, int frames,
  int w0, int size,
  const double* delayV, const unsigned int* delayC,
  const double* freshV, const unsigned int* freshC,
  const TapChan& ch,
  double* peaks
) {
  for (int i = 0; i < frames; ++i) wet[i] = 0.0;
  if (ch.count <= 0) return;
  const double magScale = ch.norm < 0.0 ? -ch.norm : ch.norm;
  for (int i = 0; i < ch.count; ++i) {
    acc_one_tap(
      wet, frames, w0, size, delayV, delayC, freshV, freshC,
      ch.start[i], ch.mid[i], ch.end[i],
      ch.gain[i], ch.cMid[i], ch.cEnd[i],
      peaks ? &peaks[i] : nullptr, magScale
    );
  }
  const double nrm = ch.norm;
  for (int i = 0; i < frames; ++i) wet[i] *= nrm;
}

static void clear_scalars(VelvetReverbState& s) {
  s.integralL = 0.0;
  s.integralR = 0.0;
  s.countL = 0u;
  s.countR = 0u;
  s.writeIdx = 0;
  s.silentAgeL = 0;
  s.silentAgeR = 0;
  s.integralFL = 0.0f;
  s.integralFR = 0.0f;
  s.outRight = 0.0;
}

static void clear_state(VelvetReverbState& s) {
  if (s.delayLv && s.delayRv && s.delayLc && s.delayRc) {
    const int n = s.delayStride > 0 ? s.delayStride : s.delaySize;
    for (int i = 0; i < n; ++i) {
      s.delayLv[i] = 0.0;
      s.delayRv[i] = 0.0;
      s.delayLc[i] = 0u;
      s.delayRc[i] = 0u;
    }
  }
  if (s.peakL && s.peakR) {
    for (int i = 0; i < kMaxTaps; ++i) {
      s.peakL[i] = 0.0;
      s.peakR[i] = 0.0;
    }
  }
  clear_scalars(s);
}

struct CleanParams {
  double grid;
  double width;
  double spread;
  double mix;
  double sampleRate;
  double decay;
  double tail;
  double ampDecayDb;
  double densitySkew;
  double minGapMsC;
  double randAmt;
  double curveAmt;
  bool paused;
};

static CleanParams clean_params(
  VelvetReverbState& s,
  double taps, double darkness, double stereoSpread, double mix,
  double sampleRate, double decay, double tailDarkness, double ampDecayDb,
  double densitySkew, double minGapMs, double tailRandom, double tailCurve
) {
  CleanParams p;
  if (!(sampleRate >= 1000.0)) sampleRate = 48000.0;
  if (!(taps == taps)) taps = 64.0;
  p.paused = !(taps > 0.0);
  p.grid = p.paused ? s.builtGrid : taps;
  if (!(ampDecayDb == ampDecayDb)) ampDecayDb = -60.0;
  if (!(densitySkew == densitySkew)) densitySkew = 0.0;
  if (!(mix == mix)) mix = 0.0;
  if (!(decay == decay)) decay = 0.025;
  p.width = clean_width(darkness);
  p.spread = clean_spread(stereoSpread);
  p.mix = mix;
  p.sampleRate = sampleRate;
  p.decay = decay;
  p.tail = clean_tail(tailDarkness);
  p.ampDecayDb = ampDecayDb;
  p.densitySkew = densitySkew;
  p.minGapMsC = clean_min_gap_ms(minGapMs);
  p.randAmt = clean_tail_random(tailRandom);
  p.curveAmt = clean_tail_curve(tailCurve);
  return p;
}

static void prepare_tables(VelvetReverbState& s, const CleanParams& p) {
  if (p.paused) {
    return;
  } else if (s.builtGrid < 0.0) {
    build_table(s.tables[s.cur], p.grid, p.width, p.spread, s.seed, p.decay, p.sampleRate, p.tail, p.ampDecayDb, p.densitySkew, p.minGapMsC, p.randAmt, p.curveAmt, s.delaySize, nullptr);
    s.builtDecay = p.decay; s.builtRate = p.sampleRate; s.builtTail = p.tail;
    s.builtAmp = p.ampDecayDb; s.builtSkew = p.densitySkew; s.builtGap = p.minGapMsC; s.builtTailRandom = p.randAmt; s.builtTailCurve = p.curveAmt;
    s.builtGrid = p.grid; s.builtWidth = p.width;
    s.builtSpread = p.spread; s.builtSeed = s.seed;
  } else if (!s.fading && (
    p.grid != s.builtGrid || p.width != s.builtWidth
    || p.spread != s.builtSpread || s.seed != s.builtSeed
    || p.decay != s.builtDecay || p.sampleRate != s.builtRate || p.tail != s.builtTail
    || p.ampDecayDb != s.builtAmp || p.densitySkew != s.builtSkew || p.minGapMsC != s.builtGap
    || p.randAmt != s.builtTailRandom || p.curveAmt != s.builtTailCurve
  )) {
    build_table(s.tables[1 - s.cur], p.grid, p.width, p.spread, s.seed, p.decay, p.sampleRate, p.tail, p.ampDecayDb, p.densitySkew, p.minGapMsC, p.randAmt, p.curveAmt, s.delaySize, nullptr);
    s.builtDecay = p.decay; s.builtRate = p.sampleRate; s.builtTail = p.tail;
    s.builtAmp = p.ampDecayDb; s.builtSkew = p.densitySkew; s.builtGap = p.minGapMsC; s.builtTailRandom = p.randAmt; s.builtTailCurve = p.curveAmt;
    s.builtGrid = p.grid; s.builtWidth = p.width;
    s.builtSpread = p.spread; s.builtSeed = s.seed;
    s.fading = true;
    s.fade = 0.0;
  }
}

static void process_chunk(
  VelvetReverbState& s,
  const double* inL, const double* inR, const double* mixIn,
  double* outL, double* outR,
  int frames,
  double mixScalar, bool mixIsScalar,
  double sampleRate
) {
  const int size = s.delaySize;
  const int w0 = s.writeIdx;
  const int ageL0 = s.silentAgeL;
  const int ageR0 = s.silentAgeR;
  double freshLv[kBlockPad];
  double freshRv[kBlockPad];
  unsigned int freshLc[kBlockPad];
  unsigned int freshRc[kBlockPad];
  double inLc[kBlockPad];
  double inRc[kBlockPad];
  double mixC[kBlockPad];

  for (int f = 0; f < frames; ++f) {
    double xL = inL[f];
    double xR = inR[f];
    if (!(xL == xL)) xL = 0.0;
    if (!(xR == xR)) xR = 0.0;
    inLc[f] = xL;
    inRc[f] = xR;
    double m = mixIsScalar ? mixScalar : mixIn[f];
    if (!(m == m)) m = 0.0;
    mixC[f] = m;

    s.integralL = s.integralL * kLeak + xL;
    s.integralR = s.integralR * kLeak + xR;
    if (xL != 0.0) {
      s.countL += 1u;
      s.silentAgeL = 0;
    } else if (s.silentAgeL < 0x7fffffff) {
      s.silentAgeL += 1;
    }
    if (xR != 0.0) {
      s.countR += 1u;
      s.silentAgeR = 0;
    } else if (s.silentAgeR < 0x7fffffff) {
      s.silentAgeR += 1;
    }
    freshLv[f] = s.integralL;
    freshRv[f] = s.integralR;
    freshLc[f] = s.countL;
    freshRc[f] = s.countR;
  }

  double wetAL[kBlockPad];
  double wetAR[kBlockPad];
  double wetBL[kBlockPad];
  double wetBR[kBlockPad];
  const TapTable& a = s.tables[s.cur];
  double* peaksL = s.displayOn ? s.peakL : nullptr;
  double* peaksR = s.displayOn ? s.peakR : nullptr;

  int settleL = a.left.maxEnd + 1;
  int settleR = a.right.maxEnd + 1;
  if (s.fading) {
    const TapTable& b0 = s.tables[1 - s.cur];
    if (b0.left.maxEnd + 1 > settleL) settleL = b0.left.maxEnd + 1;
    if (b0.right.maxEnd + 1 > settleR) settleR = b0.right.maxEnd + 1;
  }

  // Only skip a whole chunk when it would already have been exactly 0 on
  // every sample (already settled before the chunk, and no new input).
  bool anyL = false, anyR = false;
  for (int f = 0; f < frames; ++f) {
    if (inLc[f] != 0.0) anyL = true;
    if (inRc[f] != 0.0) anyR = true;
  }
  const bool skipL = (ageL0 >= settleL) && !anyL;
  const bool skipR = (ageR0 >= settleR) && !anyR;
  if (skipL) {
    for (int f = 0; f < frames; ++f) wetAL[f] = 0.0;
  } else {
    acc_channel(wetAL, frames, w0, size, s.delayLv, s.delayLc, freshLv, freshLc, a.left, peaksL);
  }
  if (skipR) {
    for (int f = 0; f < frames; ++f) wetAR[f] = 0.0;
  } else {
    acc_channel(wetAR, frames, w0, size, s.delayRv, s.delayRc, freshRv, freshRc, a.right, peaksR);
  }

  const bool fading0 = s.fading;
  if (fading0) {
    const TapTable& b = s.tables[1 - s.cur];
    if (skipL) {
      for (int f = 0; f < frames; ++f) wetBL[f] = 0.0;
    } else {
      acc_channel(wetBL, frames, w0, size, s.delayLv, s.delayLc, freshLv, freshLc, b.left, peaksL);
    }
    if (skipR) {
      for (int f = 0; f < frames; ++f) wetBR[f] = 0.0;
    } else {
      acc_channel(wetBR, frames, w0, size, s.delayRv, s.delayRc, freshRv, freshRc, b.right, peaksR);
    }
  }

  // Commit the fresh samples to the ring (and its pad) after the reads.
  for (int f = 0; f < frames; ++f) {
    int w = w0 + f;
    if (w >= size) w -= size;
    write_delay_cell(s.delayLv, s.delayLc, size, w, freshLv[f], freshLc[f]);
    write_delay_cell(s.delayRv, s.delayRc, size, w, freshRv[f], freshRc[f]);
  }
  int wEnd = w0 + frames;
  if (wEnd >= size) wEnd -= size;
  s.writeIdx = wEnd;

  bool fading = fading0;
  bool switched = false;
  const double fadeStep = 1.0 / (kFadeSeconds * sampleRate);
  double fade = s.fade;
  for (int f = 0; f < frames; ++f) {
    double wetL = wetAL[f];
    double wetR = wetAR[f];
    if (fading) {
      wetL += fade * (wetBL[f] - wetL);
      wetR += fade * (wetBR[f] - wetR);
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
    outL[f] = inLc[f] + mixC[f] * (wetL - inLc[f]);
    outR[f] = inRc[f] + mixC[f] * (wetR - inRc[f]);
  }
  s.fading = fading;
  s.fade = fade;
  if (frames > 0) s.outRight = outR[frames - 1];
}


static void write_delay_cell_f(float* v, unsigned int* c, int size, int w, float val, unsigned int cnt) {
  v[w] = val;
  c[w] = cnt;
  if (w < kBlockPad) {
    v[size + w] = val;
    c[size + w] = cnt;
  }
}

static void acc_range_f(
  float* wet, int lo, int hi,
  const float* aV, const unsigned int* aC,
  const float* bV, const unsigned int* bC,
  const float* cV, const unsigned int* cC,
  float gain, float cMid, float cEnd,
  double* peak, double magScale
) {
  const bool hold = peak != nullptr;
  int f = lo;
#if defined(__wasm_simd128__) && !defined(VELVET_NO_SIMD)
  const v128_t vGain = wasm_f32x4_splat(gain);
  const v128_t vCMid = wasm_f32x4_splat(cMid);
  const v128_t vCEnd = wasm_f32x4_splat(cEnd);
  int i = 0;
  const int n = hi - lo;
  for (; i + 3 < n; i += 4) {
    const v128_t va = wasm_f32x4_make(aV[i], aV[i + 1], aV[i + 2], aV[i + 3]);
    const v128_t vb = wasm_f32x4_make(bV[i], bV[i + 1], bV[i + 2], bV[i + 3]);
    const v128_t vc = wasm_f32x4_make(cV[i], cV[i + 1], cV[i + 2], cV[i + 3]);
    v128_t y = wasm_f32x4_mul(
      wasm_f32x4_sub(wasm_f32x4_sub(va, wasm_f32x4_mul(vCMid, vb)), wasm_f32x4_mul(vCEnd, vc)),
      vGain
    );
    y = wasm_v128_and(y, wasm_i32x4_make(
      aC[i] == cC[i] ? 0 : -1,
      aC[i + 1] == cC[i + 1] ? 0 : -1,
      aC[i + 2] == cC[i + 2] ? 0 : -1,
      aC[i + 3] == cC[i + 3] ? 0 : -1
    ));
    const float y0 = wasm_f32x4_extract_lane(y, 0);
    const float y1 = wasm_f32x4_extract_lane(y, 1);
    const float y2 = wasm_f32x4_extract_lane(y, 2);
    const float y3 = wasm_f32x4_extract_lane(y, 3);
    wet[lo + i] += y0;
    wet[lo + i + 1] += y1;
    wet[lo + i + 2] += y2;
    wet[lo + i + 3] += y3;
    if (hold) {
      const double mag0 = (y0 < 0.0f ? -(double)y0 : (double)y0) * magScale;
      const double mag1 = (y1 < 0.0f ? -(double)y1 : (double)y1) * magScale;
      const double mag2 = (y2 < 0.0f ? -(double)y2 : (double)y2) * magScale;
      const double mag3 = (y3 < 0.0f ? -(double)y3 : (double)y3) * magScale;
      if (mag0 > *peak) *peak = mag0;
      if (mag1 > *peak) *peak = mag1;
      if (mag2 > *peak) *peak = mag2;
      if (mag3 > *peak) *peak = mag3;
    }
  }
  f = lo + i;
#endif
  for (; f < hi; ++f) {
    const int i = f - lo;
    if (aC[i] == cC[i]) continue;
    const float y = (aV[i] - cMid * bV[i] - cEnd * cV[i]) * gain;
    if (hold) {
      const double mag = (y < 0.0f ? -(double)y : (double)y) * magScale;
      if (mag > *peak) *peak = mag;
    }
    wet[f] += y;
  }
}

static void acc_one_tap_f(
  float* wet, int frames,
  int w0, int size,
  const float* delayV, const unsigned int* delayC,
  const float* freshV, const unsigned int* freshC,
  int start, int mid, int end,
  float gain, float cMid, float cEnd,
  double* peak, double magScale
) {
  int p[5];
  p[0] = 0;
  p[1] = start < frames ? start : frames;
  p[2] = mid < frames ? mid : frames;
  p[3] = end < frames ? end : frames;
  p[4] = frames;
  for (int s = 0; s < 4; ++s) {
    const int lo = p[s];
    const int hi = p[s + 1];
    if (hi <= lo) continue;
    const float* aV; const unsigned int* aC;
    const float* bV; const unsigned int* bC;
    const float* cV; const unsigned int* cC;
    if (start <= lo) { aV = freshV + (lo - start); aC = freshC + (lo - start); }
    else { aV = delayV + wrap_index(w0 + lo - start, size); aC = delayC + wrap_index(w0 + lo - start, size); }
    if (mid <= lo) { bV = freshV + (lo - mid); bC = freshC + (lo - mid); }
    else { bV = delayV + wrap_index(w0 + lo - mid, size); bC = delayC + wrap_index(w0 + lo - mid, size); }
    if (end <= lo) { cV = freshV + (lo - end); cC = freshC + (lo - end); }
    else { cV = delayV + wrap_index(w0 + lo - end, size); cC = delayC + wrap_index(w0 + lo - end, size); }
    acc_range_f(wet, lo, hi, aV, aC, bV, bC, cV, cC, gain, cMid, cEnd, peak, magScale);
  }
}

static void acc_channel_f(
  float* wet, int frames,
  int w0, int size,
  const float* delayV, const unsigned int* delayC,
  const float* freshV, const unsigned int* freshC,
  const TapChan& ch,
  double* peaks
) {
  for (int i = 0; i < frames; ++i) wet[i] = 0.0f;
  if (ch.count <= 0) return;
  const double magScale = ch.norm < 0.0 ? -ch.norm : ch.norm;
  for (int i = 0; i < ch.count; ++i) {
    acc_one_tap_f(
      wet, frames, w0, size, delayV, delayC, freshV, freshC,
      ch.start[i], ch.mid[i], ch.end[i],
      (float)ch.gain[i], (float)ch.cMid[i], (float)ch.cEnd[i],
      peaks ? &peaks[i] : nullptr, magScale
    );
  }
  const float nrm = (float)ch.norm;
  for (int i = 0; i < frames; ++i) wet[i] *= nrm;
}

static void convert_line_to_float(double* src, int n) {
  const int CHUNK = 256;
  double tmp[CHUNK];
  for (int off = 0; off < n; ) {
    int m = n - off;
    if (m > CHUNK) m = CHUNK;
    for (int i = 0; i < m; ++i) tmp[i] = src[off + i];
    float* f = (float*)src;
    for (int i = 0; i < m; ++i) f[off + i] = (float)tmp[i];
    off += m;
  }
}

static void convert_line_to_double(double* dst, int n) {
  const int CHUNK = 256;
  float tmp[CHUNK];
  for (int off = n; off > 0; ) {
    int m = off > CHUNK ? CHUNK : off;
    off -= m;
    const float* f = (const float*)dst;
    for (int i = 0; i < m; ++i) tmp[i] = f[off + i];
    for (int i = 0; i < m; ++i) dst[off + i] = (double)tmp[i];
  }
}

static void apply_precision(VelvetReverbState& s, bool wantFloat) {
  if (s.useFloat == wantFloat) return;
  const int n = s.delayStride > 0 ? s.delayStride : s.delaySize;
  if (wantFloat) {
    convert_line_to_float(s.delayLv, n);
    convert_line_to_float(s.delayRv, n);
    s.integralFL = (float)s.integralL;
    s.integralFR = (float)s.integralR;
    s.useFloat = true;
  } else {
    convert_line_to_double(s.delayLv, n);
    convert_line_to_double(s.delayRv, n);
    s.integralL = (double)s.integralFL;
    s.integralR = (double)s.integralFR;
    s.useFloat = false;
  }
}

static void process_chunk_float(
  VelvetReverbState& s,
  const double* inL, const double* inR, const double* mixIn,
  double* outL, double* outR,
  int frames,
  double mixScalar, bool mixIsScalar,
  double sampleRate
) {
  const int size = s.delaySize;
  const int w0 = s.writeIdx;
  const int ageL0 = s.silentAgeL;
  const int ageR0 = s.silentAgeR;
  float* delayLv = (float*)s.delayLv;
  float* delayRv = (float*)s.delayRv;
  float freshLv[kBlockPad];
  float freshRv[kBlockPad];
  unsigned int freshLc[kBlockPad];
  unsigned int freshRc[kBlockPad];
  double inLc[kBlockPad];
  double inRc[kBlockPad];
  double mixC[kBlockPad];
  const float leak = (float)kLeak;

  for (int f = 0; f < frames; ++f) {
    double xL = inL[f];
    double xR = inR[f];
    if (!(xL == xL)) xL = 0.0;
    if (!(xR == xR)) xR = 0.0;
    inLc[f] = xL;
    inRc[f] = xR;
    double m = mixIsScalar ? mixScalar : mixIn[f];
    if (!(m == m)) m = 0.0;
    mixC[f] = m;
    s.integralFL = s.integralFL * leak + (float)xL;
    s.integralFR = s.integralFR * leak + (float)xR;
    if (xL != 0.0) { s.countL += 1u; s.silentAgeL = 0; }
    else if (s.silentAgeL < 0x7fffffff) s.silentAgeL += 1;
    if (xR != 0.0) { s.countR += 1u; s.silentAgeR = 0; }
    else if (s.silentAgeR < 0x7fffffff) s.silentAgeR += 1;
    freshLv[f] = s.integralFL;
    freshRv[f] = s.integralFR;
    freshLc[f] = s.countL;
    freshRc[f] = s.countR;
  }

  float wetAL[kBlockPad], wetAR[kBlockPad], wetBL[kBlockPad], wetBR[kBlockPad];
  const TapTable& a = s.tables[s.cur];
  double* peaksL = s.displayOn ? s.peakL : nullptr;
  double* peaksR = s.displayOn ? s.peakR : nullptr;
  int settleL = a.left.maxEnd + 1;
  int settleR = a.right.maxEnd + 1;
  if (s.fading) {
    const TapTable& b0 = s.tables[1 - s.cur];
    if (b0.left.maxEnd + 1 > settleL) settleL = b0.left.maxEnd + 1;
    if (b0.right.maxEnd + 1 > settleR) settleR = b0.right.maxEnd + 1;
  }
  bool anyL = false, anyR = false;
  for (int f = 0; f < frames; ++f) {
    if (inLc[f] != 0.0) anyL = true;
    if (inRc[f] != 0.0) anyR = true;
  }
  const bool skipL = (ageL0 >= settleL) && !anyL;
  const bool skipR = (ageR0 >= settleR) && !anyR;
  if (skipL) { for (int f = 0; f < frames; ++f) wetAL[f] = 0.0f; }
  else acc_channel_f(wetAL, frames, w0, size, delayLv, s.delayLc, freshLv, freshLc, a.left, peaksL);
  if (skipR) { for (int f = 0; f < frames; ++f) wetAR[f] = 0.0f; }
  else acc_channel_f(wetAR, frames, w0, size, delayRv, s.delayRc, freshRv, freshRc, a.right, peaksR);
  const bool fading0 = s.fading;
  if (fading0) {
    const TapTable& b = s.tables[1 - s.cur];
    if (skipL) { for (int f = 0; f < frames; ++f) wetBL[f] = 0.0f; }
    else acc_channel_f(wetBL, frames, w0, size, delayLv, s.delayLc, freshLv, freshLc, b.left, peaksL);
    if (skipR) { for (int f = 0; f < frames; ++f) wetBR[f] = 0.0f; }
    else acc_channel_f(wetBR, frames, w0, size, delayRv, s.delayRc, freshRv, freshRc, b.right, peaksR);
  }
  for (int f = 0; f < frames; ++f) {
    int w = w0 + f;
    if (w >= size) w -= size;
    write_delay_cell_f(delayLv, s.delayLc, size, w, freshLv[f], freshLc[f]);
    write_delay_cell_f(delayRv, s.delayRc, size, w, freshRv[f], freshRc[f]);
  }
  int wEnd = w0 + frames;
  if (wEnd >= size) wEnd -= size;
  s.writeIdx = wEnd;
  bool fading = fading0;
  bool switched = false;
  const double fadeStep = 1.0 / (kFadeSeconds * sampleRate);
  double fade = s.fade;
  for (int f = 0; f < frames; ++f) {
    double wetL = (double)wetAL[f];
    double wetR = (double)wetAR[f];
    if (fading) {
      wetL += fade * ((double)wetBL[f] - wetL);
      wetR += fade * ((double)wetBR[f] - wetR);
      fade += fadeStep;
      if (fade >= 1.0) { s.cur = 1 - s.cur; fading = false; switched = true; fade = 0.0; }
    } else if (switched) {
      wetL = (double)wetBL[f];
      wetR = (double)wetBR[f];
    }
    outL[f] = inLc[f] + mixC[f] * (wetL - inLc[f]);
    outR[f] = inRc[f] + mixC[f] * (wetR - inRc[f]);
  }
  s.fading = fading;
  s.fade = fade;
  if (frames > 0) s.outRight = outR[frames - 1];
}

static void process_run(
  VelvetReverbState& s,
  const double* inL, const double* inR, const double* mixIn,
  double* outL, double* outR,
  int frames,
  const CleanParams& p,
  bool mixIsScalar
) {
  prepare_tables(s, p);
  int done = 0;
  while (done < frames) {
    int n = frames - done;
    if (n > kBlockPad) n = kBlockPad;
    if (s.useFloat) {
      process_chunk_float(
        s, inL + done, inR + done, mixIsScalar ? nullptr : mixIn + done,
        outL + done, outR + done, n, p.mix, mixIsScalar, p.sampleRate
      );
    } else {
      process_chunk(
        s, inL + done, inR + done, mixIsScalar ? nullptr : mixIn + done,
        outL + done, outR + done, n, p.mix, mixIsScalar, p.sampleRate
      );
    }
    done += n;
  }
}

} // namespace

extern "C" {

// sampleRate sizes the delay lines (kMaxLengthSeconds + the widest pulse at that
// rate). The engine creates instances when it builds the graph, so the
// allocation never happens in the sample path.
int soemdsp_velvet_reverb_create(double sampleRate) {
  for (int i = 0; i < kMaxInstances; ++i) {
    if (!gPool[i].active) {
      const int delaySize = delay_size_for(sampleRate);
      const int stride = delaySize + kBlockPad;
      void* block = soemdsp::memory_pool::alloc(block_bytes_for(delaySize));
      if (!block) return 0; // out of memory budget: the engine reports it
      VelvetReverbState& s = gPool[i];
      s.block = block;
      s.delaySize = delaySize;
      s.delayStride = stride;
      s.tables = (TapTable*)block;
      unsigned char* p = align16((unsigned char*)block + 2UL * sizeof(TapTable));
      s.delayLv = (double*)p;
      s.delayRv = s.delayLv + stride;
      s.delayLc = (unsigned int*)(s.delayRv + stride);
      s.delayRc = s.delayLc + stride;
      s.peakL = (double*)(s.delayRc + stride);
      s.peakR = s.peakL + kMaxTaps;
      s.displayOn = false;
      s.active = true;
      s.seed = 1u;
      s.cur = 0;
      s.fading = false;
      s.fade = 0.0;
      s.builtGrid = -1.0; // first sample builds the table directly
      s.builtWidth = 0.0;
      s.builtSpread = 0.0;
      s.builtDecay = 0.0;
      s.builtTail = 0.0;
      s.builtAmp = -60.0;
      s.builtSkew = 0.0;
      s.builtGap = kDefaultMinGapMs;
      s.builtTailRandom = 1.0;
      s.builtTailCurve = 0.0;
      s.builtRate = 0.0;
      s.builtSeed = 0u;
      s.tables[0].left.count = 0;
      s.tables[0].right.count = 0;
      s.tables[0].left.norm = 0.0;
      s.tables[0].right.norm = 0.0;
      s.tables[0].left.maxEnd = 0;
      s.tables[0].right.maxEnd = 0;
      s.useFloat = true;
      clear_scalars(s); // the pool hands out zeroed blocks: no second pass over the lines
      return i + 1;
    }
  }
  return 0;
}

void soemdsp_velvet_reverb_destroy(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return;
  VelvetReverbState& s = gPool[handle - 1];
  if (s.active) soemdsp::memory_pool::release(s.block);
  s.block = nullptr;
  s.tables = nullptr;
  s.delayLv = nullptr;
  s.delayRv = nullptr;
  s.delayLc = nullptr;
  s.delayRc = nullptr;
  s.peakL = nullptr;
  s.peakR = nullptr;
  s.displayOn = false;
  s.active = false;
}

void soemdsp_velvet_reverb_reset(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return;
  clear_state(gPool[handle - 1]);
}

// The diffuser table follows the new seed through the crossfade on the next sample.
void soemdsp_velvet_reverb_set_seed(int handle, double seed) {
  if (handle <= 0 || handle > kMaxInstances) return;
  VelvetReverbState& s = gPool[handle - 1];
  s.seed = seed > 0.0 ? (unsigned int)seed : 0u;
}

// 0 = double, anything >= 0.5 = float delay / running sum (default is float).
// Converts the live delay in place so a listening A/B does not drop the tail.
void soemdsp_velvet_reverb_set_precision(int handle, double mode) {
  if (handle <= 0 || handle > kMaxInstances) return;
  VelvetReverbState& s = gPool[handle - 1];
  if (!s.active) return;
  apply_precision(s, mode >= 0.5);
}

double soemdsp_velvet_reverb_sample(
  int handle,
  double inL,
  double inR,
  double taps,          // tap count (continuous; 0 pauses)
  double darkness,      // max pulse width in samples (continuous, >= 1)
  double stereoSpread,  // 0 .. 1
  double mix,           // dry/wet
  double sampleRate,
  double decay,         // Length: the tail in seconds the taps spread over
  double tailDarkness,  // max pulse width at the last tap, 0 = same as Darkness
  double ampDecayDb,    // level at the end of the tail in dB (0 = flat / gated)
  double densitySkew,   // + packs taps toward the start, - toward the end
  double minGapMs,      // Min Gap: least spacing between consecutive taps (ms)
  double tailRandom,    // 0 = smooth Darkness->Tail Darkness widths, 1 = previous random widths
  double tailCurve      // -1..+1 Step Graph rational bend on the (log-width) Darkness->Tail Dark sweep; 0 = geometric
) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  VelvetReverbState& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  const CleanParams p = clean_params(
    s, taps, darkness, stereoSpread, mix, sampleRate, decay, tailDarkness,
    ampDecayDb, densitySkew, minGapMs, tailRandom, tailCurve
  );
  double oL = 0.0, oR = 0.0;
  process_run(s, &inL, &inR, nullptr, &oL, &oR, 1, p, true);
  return oL;
}

void soemdsp_velvet_reverb_process_block(
  int handle,
  const double* inL,
  const double* inR,
  double* outL,
  double* outR,
  int frames,
  double taps,
  double darkness,
  double stereoSpread,
  const double* mix,
  double sampleRate,
  double decay,
  double tailDarkness,
  double ampDecayDb,
  double densitySkew,
  double minGapMs,
  double tailRandom,
  double tailCurve
) {
  if (handle <= 0 || handle > kMaxInstances || frames <= 0) return;
  VelvetReverbState& s = gPool[handle - 1];
  if (!s.active || !inL || !inR || !outL || !outR || !mix) return;
  const CleanParams p = clean_params(
    s, taps, darkness, stereoSpread, mix[0], sampleRate, decay, tailDarkness,
    ampDecayDb, densitySkew, minGapMs, tailRandom, tailCurve
  );
  process_run(s, inL, inR, mix, outL, outR, frames, p, false);
}

// Scratch for JS tests / the standalone wasm bench (the graph engine passes its own buffers).
static double gBlkInL[kBlockPad];
static double gBlkInR[kBlockPad];
static double gBlkOutL[kBlockPad];
static double gBlkOutR[kBlockPad];
static double gBlkMix[kBlockPad];

double* soemdsp_velvet_reverb_block_in_l() { return gBlkInL; }
double* soemdsp_velvet_reverb_block_in_r() { return gBlkInR; }
double* soemdsp_velvet_reverb_block_out_l() { return gBlkOutL; }
double* soemdsp_velvet_reverb_block_out_r() { return gBlkOutR; }
double* soemdsp_velvet_reverb_block_mix() { return gBlkMix; }
int soemdsp_velvet_reverb_block_max_frames() { return kBlockPad; }


// Face: build the Left tap layout the audio would use for these settings into a
// static table and return the Left tap count (0 while Taps pauses). Read it with
// the _layout_* pointers / values below. Costs one table build; call it only
// when a setting changes.
int soemdsp_velvet_reverb_layout(
  double taps, double darkness, double stereoSpread, double sampleRate,
  double decay, double tailDarkness, double seed, double ampDecayDb, double densitySkew,
  double minGapMs, double tailRandom, double tailCurve
) {
  if (!(sampleRate >= 1000.0)) sampleRate = 48000.0;
  if (!(taps == taps)) taps = 64.0;
  gLayout.length = 0.0;
  gLayout.flags = 0;
  gLayout.countR = 0;
  if (!(taps > 0.0)) return 0;
  if (!(decay == decay)) decay = 0.025;
  if (!(ampDecayDb == ampDecayDb)) ampDecayDb = -60.0;
  if (!(densitySkew == densitySkew)) densitySkew = 0.0;
  const unsigned int seedU = seed > 0.0 ? (unsigned int)seed : 0u;
  build_table(gLayoutTable, taps, clean_width(darkness), clean_spread(stereoSpread),
    seedU, decay, sampleRate, clean_tail(tailDarkness), ampDecayDb, densitySkew, clean_min_gap_ms(minGapMs), clean_tail_random(tailRandom), clean_tail_curve(tailCurve), delay_size_for(sampleRate), &gLayout);
  return gLayoutTable.left.count;
}
double* soemdsp_velvet_reverb_layout_pos() { return gLayoutPos; }
double* soemdsp_velvet_reverb_layout_width() { return gLayoutWidth; }
double* soemdsp_velvet_reverb_layout_level() { return gLayoutLevel; }
int soemdsp_velvet_reverb_layout_count_r() { return gLayout.countR; }
double* soemdsp_velvet_reverb_layout_pos_r() { return gLayoutPosR; }
double* soemdsp_velvet_reverb_layout_width_r() { return gLayoutWidthR; }
double* soemdsp_velvet_reverb_layout_level_r() { return gLayoutLevelR; }
double soemdsp_velvet_reverb_layout_length() { return gLayout.length; }
int soemdsp_velvet_reverb_layout_flags() { return gLayout.flags; }
int soemdsp_velvet_reverb_max_taps() { return kMaxTaps; }
double soemdsp_velvet_reverb_max_length() { return kMaxLengthSeconds; }
// Pool bytes one instance takes at a sample rate (tap tables + both delay lines + two peak-hold buffers).
double soemdsp_velvet_reverb_block_bytes(double sampleRate) {
  return (double)block_bytes_for(delay_size_for(sampleRate));
}

double soemdsp_velvet_reverb_right(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].outRight;
}

// Face telemetry. Off by default so hidden instances skip the peak compares.
void soemdsp_velvet_reverb_set_display(int handle, int on) {
  if (handle <= 0 || handle > kMaxInstances) return;
  VelvetReverbState& s = gPool[handle - 1];
  if (!s.active) return;
  const bool want = on != 0;
  if (s.displayOn && !want && s.peakL && s.peakR) {
    const int nL = s.tables ? s.tables[s.cur].left.count : 0;
    const int nR = s.tables ? s.tables[s.cur].right.count : 0;
    const int n = nL > nR ? nL : nR;
    for (int i = 0; i < n; ++i) {
      s.peakL[i] = 0.0;
      s.peakR[i] = 0.0;
    }
  }
  s.displayOn = want;
}

static double gLevelsL[kMaxTaps];
static double gLevelsR[kMaxTaps];
static int gLevelsCountR = 0;

// Copy peak-hold since the last take (or since display was turned on) into the
// static level buffers and clear the instance peaks. Returns the Left count;
// Right count is soemdsp_velvet_reverb_levels_count_r().
int soemdsp_velvet_reverb_take_levels(int handle) {
  gLevelsCountR = 0;
  if (handle <= 0 || handle > kMaxInstances) return 0;
  VelvetReverbState& s = gPool[handle - 1];
  if (!s.active || !s.tables || !s.peakL || !s.peakR) return 0;
  int nL = s.tables[s.cur].left.count;
  int nR = s.tables[s.cur].right.count;
  if (s.fading) {
    const int bL = s.tables[1 - s.cur].left.count;
    const int bR = s.tables[1 - s.cur].right.count;
    if (bL > nL) nL = bL;
    if (bR > nR) nR = bR;
  }
  if (nL < 0) nL = 0;
  if (nR < 0) nR = 0;
  if (nL > kMaxTaps) nL = kMaxTaps;
  if (nR > kMaxTaps) nR = kMaxTaps;
  for (int i = 0; i < nL; ++i) {
    gLevelsL[i] = s.peakL[i];
    s.peakL[i] = 0.0;
  }
  for (int i = 0; i < nR; ++i) {
    gLevelsR[i] = s.peakR[i];
    s.peakR[i] = 0.0;
  }
  gLevelsCountR = nR;
  return nL;
}

double* soemdsp_velvet_reverb_levels_l() { return gLevelsL; }
double* soemdsp_velvet_reverb_levels_r() { return gLevelsR; }
int soemdsp_velvet_reverb_levels_count_r() { return gLevelsCountR; }

int soemdsp_velvet_reverb_version() {
  return 14; // 14: Precision defaults to Float (set_precision(0) is still Double). 13: optional float delay / running sum (soemdsp_velvet_reverb_set_precision; default was double). 12: tap-major block path (bit-identical double math, same tap accumulation order), branchless wrap, hoisted rebuild checks, settled-silence skip. 11: each pulse starts on a whole sample in [cellStart, cellEnd - width] so it cannot overlap the next tap on the same channel (cell floor is max(Min Gap, width + 1); L/R are checked separately). 10: per-tap display peak-hold (width-filtered pulse x gain x norm, L/R, taken by the worklet at the face telemetry rate; off when the face is hidden). 9: Tail Curve (-1..+1, default 0): Step Graph rational bend (segment_rational01, same sign as Step Graph) on a log-width Darkness->Tail Darkness sweep, so cutoff falls exponentially over time at curve 0. 8: Tail Random (0 = smooth Darkness->Tail Darkness pulse widths, 1 = previous per-tap random widths; default 1) and Density Skew is -1..+1 (the rational warp is soft-capped just inside +-1 so the endpoints stay finite; Min Gap still drops bunched taps). 7: Min Gap parameter (default 1 ms) (ms; sample and layout take it last): the cell floor is max(Min Gap, widest pulse); Density Skew back to the one-sided rational warp. 6: cell floor (taps that would bunch under max(4 samples, widest pulse) are not used; layout flag 4) and the delay lines are sized from the creation sample rate for 6 s (kMaxLengthSeconds; was 12 s) plus the widest pulse, so any allowed Length fits; create(sampleRate). 5: the layout level is amplitude only (sign x Amp Decay envelope, no darkness make-up), so darkness never changes the face height. 4: one job per parameter: Taps = the count (Density x Decay no more), Length (decay) only spreads them, Amp Decay = dB at the end of the tail (0 = gated), Density Skew = Step Graph rational warp of the positions; layout exports Right taps too. 3: the layout level carries the tap sign (signL * envL, the same value set_tap gets) so the face can draw a bipolar plot. 2: Darkness / Tail Darkness are continuous (fractional pulse widths); Decay is the tail length in seconds (RT60), the taps span it and fade to -60 dB; Density x Decay sets the tap count (no Tap Count); layout export for the face. 1: split out of Velvet Noise (diffuser only; the generator is its own module now)
}

} // extern "C"
