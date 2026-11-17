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
// Click-free changes:
//   Taps, Length, Amp Decay, Density Skew, Darkness, Tail Darkness, Stereo Spread, Seed and the sample rate all
//   rebuild the tap table. A rebuild goes into the idle one of two tables and
//   the wet signal crossfades to it (kFadeSeconds). While a fade is running,
//   further changes wait for it, so a swept knob costs one rebuild per fade.
//
// No latency: taps are causal and the earliest pulse can sit at delay 0, so dry
// and wet are already time-aligned.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/memory_pool.h>

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

struct Tap {
  int start;       // delay of the newest sample in the pulse
  int mid;         // start + floor(width): the partial sample (weight = fraction)
  int end;         // mid + 1 when the width has a fraction, else mid
  double gain;     // sign / width
  double cMid;     // kLeak^n * (1 - fraction)
  double cEnd;     // kLeak^(n+1) * fraction
};

struct TapTable {
  Tap left[kMaxTaps];
  Tap right[kMaxTaps];
  int countL;
  int countR;
  double normL;
  double normR;
};

// One delay-line cell: the running sum plus how many nonzero inputs have
// arrived up to this sample. Equal counts at a pulse's two ends mean its window
// saw only silence, so the pulse is exactly 0 instead of rounding residue.
struct Cell {
  double v;
  unsigned int count;
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
  double builtRate;
  unsigned int builtSeed;

  unsigned int seed;

  // Diffuser
  double integralL;
  double integralR;
  int writeIdx;
  unsigned int countL;
  unsigned int countR;
  int delaySize;    // cells per delay line (delay_size_for the creation rate)
  Cell* delayL;     // delaySize cells each, in the pool block
  Cell* delayR;
  void* block;      // the one pool block that holds tables and both delay lines

  double outRight;
};

static VelvetReverbState gPool[kMaxInstances];

static inline unsigned long long block_bytes_for(int delaySize) {
  return 2ULL * sizeof(TapTable) + 2ULL * (unsigned long long)delaySize * sizeof(Cell);
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
static inline void set_tap(Tap& tap, int start, double width, double sign) {
  const int n = (int)width;
  const double f = width - (double)n;
  const double leakN = soemdsp_maths::dsp_exp((double)n * kLnLeak);
  tap.start = start;
  tap.mid = start + n;
  tap.end = f > 0.0 ? tap.mid + 1 : tap.mid;
  tap.gain = sign / width;
  tap.cMid = leakN * (1.0 - f);
  tap.cEnd = leakN * kLeak * f;
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

// Cell floor (velvet_reverb v6): no tap's cell is narrower than its widest
// pulse, and never under Min Gap (ms, a parameter), so every pulse fits its own cell with
// room for its jitter and taps never stack or overlap. Where Density Skew (or
// simply many Taps in a short Length) would pack cells tighter, the taps there
// are not used: the tap count follows the floor instead of the setting, which
// also saves CPU. kWarpSteps sections of the warp are each given
// min(Taps share, section length / floor) taps; the running sum is continuous
// in every parameter, and its fraction fades the last tap in exactly like a
// fractional Taps, so moving Skew never pops.
static const double kDefaultMinGapMs = 0.083; // ~4 samples at 48 kHz (the Min Gap definition default)
static inline double clean_min_gap_ms(double ms) {
  if (!(ms == ms)) return kDefaultMinGapMs;
  return ms > 0.0 ? ms : 0.0;
}
static const int kWarpSteps = 1024;
static double gWarpX[kWarpSteps + 1]; // warped position (samples) at section edges
static double gWarpN[kWarpSteps + 1]; // taps kept up to each edge (running sum)

static void build_table(
  TapTable& t, double taps, double headWidth, double spread, unsigned int seed,
  double lengthSeconds, double sampleRate, double tailWidth, double ampDecayDb,
  double densitySkew, double minGapMs, int delaySize, Layout* out
) {
  // Each parameter has one job (velvet_reverb v4):
  //   Taps        how many taps (continuous: the last one fades in by its fraction)
  //   Length      spreads those taps over the tail (s); longer = sparser, not more
  //   Amp Decay   tap level at the end of the tail (dB), an exponential fade
  //               along it: 0 dB = flat (gated), -60 dB = RT60
  //   Density Skew where the taps sit: the Step Graph rational curve
  //               (segment_rational01, contour = -skew) warps the even grid, so
  //               + packs them toward the start and - toward the end; taps
  //               that would pack under the cell floor are not used (v6). The
  //               definition range (-0.9..0.9) keeps it off the curve's step
  //               at +-1; the knob's bipolar rational scaling gives fine
  //               control near 0.
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
  const double contour = -soemdsp_maths::clamp11(densitySkew == densitySkew ? densitySkew : 0.0);
  const bool ramp = tailWidth > 0.0 && tailWidth != headWidth;
  // Widest pulse at a place in the tail (Tail Darkness ramps it along Length).
  auto widestAt = [&](double x) {
    if (!ramp) return headWidth;
    const double m = headWidth + (x / length) * (tailWidth - headWidth);
    return m < 1.0 ? 1.0 : m;
  };
  // Min Gap: the least spacing between consecutive taps (never less than the
  // pulse there, and at least one sample).
  double minGap = clean_min_gap_ms(minGapMs) * 0.001 * sampleRate;
  if (minGap < 1.0) minGap = 1.0;
  auto floorAt = [&](double x) {
    const double m = widestAt(x);
    return m > minGap ? m : minGap;
  };

  // Kept taps along the warped tail (see kWarpSteps). Without the floor this is
  // the plain warped grid: Taps cells of equal share in the unwarped 0..1 tail.
  gWarpX[0] = 0.0;
  gWarpN[0] = 0.0;
  const double share = exactTaps / (double)kWarpSteps;
  for (int j = 1; j <= kWarpSteps; ++j) {
    gWarpX[j] = length * soemdsp_maths::segment_rational01((double)j / (double)kWarpSteps, contour);
    if (gWarpX[j] < gWarpX[j - 1]) gWarpX[j] = gWarpX[j - 1];
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
  const double headEnergy = mean_width_energy(headWidth);

  double endL = 0.0; // where the previous pulse ends: pulses never overlap
  double endR = 0.0;
  for (int i = 0; i < count; ++i) {
    const bool last = (i == count - 1);
    const double part = last ? lastPart : 1.0; // the last cell is what is left
    const double cellStart = cellEdge((double)i);
    const double cellEnd = cellEdge((double)i + part);
    const double cellSize = cellEnd - cellStart;

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
      rampGain = __builtin_sqrt(headEnergy / mean_width_energy(maxWidth));
    }
    // Widths are drawn uniformly over [1, maxWidth].
    const double widthL = 1.0 + widthUnitL * (maxWidth - 1.0);
    const double rawWidthR = 1.0 + widthUnitR * (maxWidth - 1.0);
    const double widthR = widthL + spread * (rawWidthR - widthL); // stays in [1, maxWidth]
    // The sign goes independent on a per-tap threshold, so decorrelation grows evenly.
    const double signR = (ownR < spread) ? ownSignR : signL;
    // Velvet jitter over the whole cell (Right follows Left at Spread 0 and its
    // own draw at Spread 1). The cell floor keeps a cell at least the widest
    // pulse, so a pulse can only reach into the next cell; a tap that would
    // start inside the previous pulse starts where it ends (positions do not
    // depend on the widths otherwise, so sweeping Darkness never moves taps).
    double posL = cellStart + jitterL * cellSize;
    double blendPosR = cellStart + (jitterL + spread * (jitterR - jitterL)) * cellSize;
    if (posL < endL) posL = endL;
    if (blendPosR < endR) blendPosR = endR;

    if (openL) {
      if (posL + widthL < (double)(delaySize - 1)) {
        const double ampL = part * soemdsp_maths::dsp_exp(-decayK * (posL + 0.5 * widthL)); // amplitude (face height)
        const double envL = rampGain * ampL;
        if (out) {
          out->pos[countL] = (double)(int)posL / sampleRate;
          out->width[countL] = widthL / sampleRate;
          out->level[countL] = signL * ampL;
        }
        set_tap(t.left[countL++], (int)posL, widthL, signL * envL);
        endL = posL + widthL;
        // A tap averages `width` samples (gain 1/width), so its energy on
        // noise is env^2 * (n + f^2) / w^2 (env^2 / width at whole widths).
        // Counting the width keeps the wet level the same at any Darkness.
        sumL += envL * envL * width_energy(widthL);
      } else {
        openL = false;
      }
    }
    if (openR) {
      if (blendPosR + widthR < (double)(delaySize - 1)) {
        const double ampR = part * soemdsp_maths::dsp_exp(-decayK * (blendPosR + 0.5 * widthR));
        const double envR = rampGain * ampR;
        if (out) {
          out->posR[countR] = (double)(int)blendPosR / sampleRate;
          out->widthR[countR] = widthR / sampleRate;
          out->levelR[countR] = signR * ampR;
        }
        set_tap(t.right[countR++], (int)blendPosR, widthR, signR * envR);
        endR = blendPosR + widthR;
        sumR += envR * envR * width_energy(widthR);
      } else {
        openR = false;
      }
    }
    if (!openL && !openR) break;
  }

  t.countL = countL;
  t.countR = countR;
  t.normL = sumL > 0.0 ? 1.0 / __builtin_sqrt(sumL) : 0.0;
  // Right normalizes on its own energy like Left.
  t.normR = sumR > 0.0 ? 1.0 / __builtin_sqrt(sumR) : 0.0;
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

static inline int wrap_index(int i, int size) { return i < 0 ? i + size : i; }

static inline double read_taps(const Cell* line, int size, int write, const Tap* taps, int count) {
  double sum = 0.0;
  for (int i = 0; i < count; ++i) {
    const Tap& tap = taps[i];
    // Every tap delay is < size (build_table keeps them inside the line), so one add wraps.
    const Cell& a = line[wrap_index(write - tap.start, size)];
    const Cell& c = line[wrap_index(write - tap.end, size)];
    if (a.count == c.count) continue; // window saw only silence: exactly 0
    const Cell& b = line[wrap_index(write - tap.mid, size)];
    sum += (a.v - tap.cMid * b.v - tap.cEnd * c.v) * tap.gain;
  }
  return sum;
}

static void clear_scalars(VelvetReverbState& s) {
  s.integralL = 0.0;
  s.integralR = 0.0;
  s.countL = 0u;
  s.countR = 0u;
  s.writeIdx = 0;
  s.outRight = 0.0;
}

static void clear_state(VelvetReverbState& s) {
  for (int i = 0; i < s.delaySize; ++i) {
    s.delayL[i].v = 0.0;
    s.delayL[i].count = 0u;
    s.delayR[i].v = 0.0;
    s.delayR[i].count = 0u;
  }
  s.integralL = 0.0;
  s.integralR = 0.0;
  s.countL = 0u;
  s.countR = 0u;
  s.writeIdx = 0;
  s.outRight = 0.0;
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
      void* block = soemdsp::memory_pool::alloc(block_bytes_for(delaySize));
      if (!block) return 0; // out of memory budget: the engine reports it
      VelvetReverbState& s = gPool[i];
      s.block = block;
      s.delaySize = delaySize;
      s.tables = (TapTable*)block;
      s.delayL = (Cell*)((unsigned char*)block + 2UL * sizeof(TapTable));
      s.delayR = s.delayL + delaySize;
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
      s.builtRate = 0.0;
      s.builtSeed = 0u;
      s.tables[0].countL = 0;
      s.tables[0].countR = 0;
      s.tables[0].normL = 0.0;
      s.tables[0].normR = 0.0;
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
  s.delayL = nullptr;
  s.delayR = nullptr;
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
  double minGapMs       // Min Gap: least spacing between consecutive taps (ms)
) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  VelvetReverbState& s = gPool[handle - 1];
  if (!s.active) return 0.0;

  if (!(sampleRate >= 1000.0)) sampleRate = 48000.0;
  if (!(taps == taps)) taps = 64.0;
  // Taps 0 (or below) pauses: the diffuser keeps the taps it has. No hidden
  // floor: 0 means stopped, not "1 tap".
  const bool paused = !(taps > 0.0);
  const double grid = paused ? s.builtGrid : taps; // built tap count
  if (!(ampDecayDb == ampDecayDb)) ampDecayDb = -60.0;
  if (!(densitySkew == densitySkew)) densitySkew = 0.0;
  const double minGapMsC = clean_min_gap_ms(minGapMs);

  // Continuous width: 1.66 is 1.66 samples. Below 1 a pulse is still one sample.
  const double width = clean_width(darkness);

  const double spread = clean_spread(stereoSpread);

  if (!(mix == mix)) mix = 0.0;
  if (!(decay == decay)) decay = 0.025;
  const double tail = clean_tail(tailDarkness);
  if (!(inL == inL)) inL = 0.0;
  if (!(inR == inR)) inR = 0.0;

  // Tap table upkeep (none while paused: the diffuser keeps its taps).
  if (paused) {
    // nothing to build; a module that starts paused has no taps yet (wet is silent)
  } else if (s.builtGrid < 0.0) {
    build_table(s.tables[s.cur], grid, width, spread, s.seed, decay, sampleRate, tail, ampDecayDb, densitySkew, minGapMsC, s.delaySize, nullptr);
    s.builtDecay = decay; s.builtRate = sampleRate; s.builtTail = tail;
    s.builtAmp = ampDecayDb; s.builtSkew = densitySkew; s.builtGap = minGapMsC;
    s.builtGrid = grid; s.builtWidth = width;
    s.builtSpread = spread; s.builtSeed = s.seed;
  } else if (!s.fading && (
    grid != s.builtGrid || width != s.builtWidth
    || spread != s.builtSpread || s.seed != s.builtSeed
    || decay != s.builtDecay || sampleRate != s.builtRate || tail != s.builtTail
    || ampDecayDb != s.builtAmp || densitySkew != s.builtSkew || minGapMsC != s.builtGap
  )) {
    build_table(s.tables[1 - s.cur], grid, width, spread, s.seed, decay, sampleRate, tail, ampDecayDb, densitySkew, minGapMsC, s.delaySize, nullptr);
    s.builtDecay = decay; s.builtRate = sampleRate; s.builtTail = tail;
    s.builtAmp = ampDecayDb; s.builtSkew = densitySkew; s.builtGap = minGapMsC;
    s.builtGrid = grid; s.builtWidth = width;
    s.builtSpread = spread; s.builtSeed = s.seed;
    s.fading = true;
    s.fade = 0.0;
  }

  s.integralL = s.integralL * kLeak + inL;
  s.integralR = s.integralR * kLeak + inR;
  const int w = s.writeIdx;
  if (inL != 0.0) s.countL++;
  if (inR != 0.0) s.countR++;
  s.delayL[w].v = s.integralL;
  s.delayL[w].count = s.countL;
  s.delayR[w].v = s.integralR;
  s.delayR[w].count = s.countR;
  s.writeIdx = (w + 1 < s.delaySize) ? w + 1 : 0;

  double outL = 0.0;
  double outR = 0.0;

  {
    const TapTable& a = s.tables[s.cur];
    double wetL = read_taps(s.delayL, s.delaySize, w, a.left, a.countL) * a.normL;
    double wetR = read_taps(s.delayR, s.delaySize, w, a.right, a.countR) * a.normR;
    if (s.fading) {
      const TapTable& b = s.tables[1 - s.cur];
      const double g = s.fade;
      wetL += g * (read_taps(s.delayL, s.delaySize, w, b.left, b.countL) * b.normL - wetL);
      wetR += g * (read_taps(s.delayR, s.delaySize, w, b.right, b.countR) * b.normR - wetR);
    }
    outL = inL + mix * (wetL - inL);
    outR = inR + mix * (wetR - inR);
  }

  if (s.fading) {
    s.fade += 1.0 / (kFadeSeconds * sampleRate);
    if (s.fade >= 1.0) {
      s.cur = 1 - s.cur;
      s.fading = false;
      s.fade = 0.0;
    }
  }

  s.outRight = outR;
  return outL;
}

// Face: build the Left tap layout the audio would use for these settings into a
// static table and return the Left tap count (0 while Taps pauses). Read it with
// the _layout_* pointers / values below. Costs one table build; call it only
// when a setting changes.
int soemdsp_velvet_reverb_layout(
  double taps, double darkness, double stereoSpread, double sampleRate,
  double decay, double tailDarkness, double seed, double ampDecayDb, double densitySkew,
  double minGapMs
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
    seedU, decay, sampleRate, clean_tail(tailDarkness), ampDecayDb, densitySkew, clean_min_gap_ms(minGapMs), delay_size_for(sampleRate), &gLayout);
  return gLayoutTable.countL;
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
// Pool bytes one instance takes at a sample rate (tap tables + both delay lines).
double soemdsp_velvet_reverb_block_bytes(double sampleRate) {
  return (double)block_bytes_for(delay_size_for(sampleRate));
}

double soemdsp_velvet_reverb_right(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].outRight;
}

int soemdsp_velvet_reverb_version() {
  return 7; // 7: Min Gap parameter (ms; sample and layout take it last): the cell floor is max(Min Gap, widest pulse); Density Skew back to the one-sided rational warp. 6: cell floor (taps that would bunch under max(4 samples, widest pulse) are not used; layout flag 4) and the delay lines are sized from the creation sample rate for 6 s (kMaxLengthSeconds; was 12 s) plus the widest pulse, so any allowed Length fits; create(sampleRate). 5: the layout level is amplitude only (sign x Amp Decay envelope, no darkness make-up), so darkness never changes the face height. 4: one job per parameter: Taps = the count (Density x Decay no more), Length (decay) only spreads them, Amp Decay = dB at the end of the tail (0 = gated), Density Skew = Step Graph rational warp of the positions; layout exports Right taps too. 3: the layout level carries the tap sign (signL * envL, the same value set_tap gets) so the face can draw a bipolar plot. 2: Darkness / Tail Darkness are continuous (fractional pulse widths); Decay is the tail length in seconds (RT60), the taps span it and fade to -60 dB; Density x Decay sets the tap count (no Tap Count); layout export for the face. 1: split out of Velvet Noise (diffuser only; the generator is its own module now)
}

} // extern "C"
