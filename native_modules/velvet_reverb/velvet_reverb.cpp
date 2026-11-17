// soemdsp-native-module: velvet_reverb
// soemdsp-native-label: Dark Velvet Reverb
// soemdsp-native-target: velvetReverb
// soemdsp-native-kind: reverb
//
// Dark Velvet Reverb: a Dark Velvet Noise (DVN) diffuser. (The velvet noise event
// generator is its own module, velvet_noise / Dark Velvet Noise.)
//
// Diffuser (Dark Velvet Noise):
//   Sparse FIR of rectangular pulses, one per 1/Density period over the tail
//   (Decay seconds long, so Density x Decay pulses), with random position, sign
//   and width (1 .. Darkness samples). Tap level falls exponentially to -60 dB
//   at the end of the tail, so it never stops dead. Each pulse is read
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
//   Density, Decay, Darkness, Tail Darkness, Stereo Spread, Seed and the sample rate all
//   rebuild the tap table. A rebuild goes into the idle one of two tables and
//   the wet signal crossfades to it (kFadeSeconds). While a fade is running,
//   further changes wait for it, so a swept knob costs one rebuild per fade.
//
// No latency: taps are causal and the earliest pulse can sit at delay 0, so dry
// and wet are already time-aligned.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/memory_pool.h>

namespace {

// Slots are tiny now: the big buffers (tap tables and delay lines, ~8.8 MB per instance) come
// from the shared memory pool when an instance is created and go back when it is destroyed.
static const int kMaxInstances = 128;
// Physical limits only. Density, Decay and Darkness ranges belong to the parameters;
// the DSP follows whatever they allow up to what fits in memory / the delay line.
static const int kMaxTaps = 4096;
static const int kMaxPulseWidth = 65536; // a pulse must fit well inside the delay line
// 2^18 samples: 5.46 s at 48 kHz, 2.73 s at 96 kHz. Taps that would land past
// the end are left out (never piled up at the edge).
static const int kDelaySize = 262144;
static const int kDelayMask = kDelaySize - 1;
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
  double builtRate;
  unsigned int builtSeed;

  unsigned int seed;

  // Diffuser
  double integralL;
  double integralR;
  int writeIdx;
  unsigned int countL;
  unsigned int countR;
  Cell* delayL;     // kDelaySize cells each, in the pool block
  Cell* delayR;
  void* block;      // the one pool block that holds tables and both delay lines

  double outRight;
};

static VelvetReverbState gPool[kMaxInstances];

static const unsigned long kBlockBytes = 2UL * sizeof(TapTable) + 2UL * (unsigned long)kDelaySize * sizeof(Cell);

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
// tap's delay, width and level, the tail length used and which physical limit
// (if any) shaped it.
struct Layout {
  double* pos;    // seconds
  double* width;  // seconds
  double* level;  // linear, before the 1/width pulse gain (1 = first-tap level)
  double length;  // seconds actually used
  int flags;      // kLayoutTapLimit | kLayoutLengthLimit
};
static const int kLayoutTapLimit = 1;    // Density x Decay > kMaxTaps: taps spread to cover the tail
static const int kLayoutLengthLimit = 2; // Decay longer than the delay line: the tail is held there

static void build_table(
  TapTable& t, double rawGrid, double headWidth, double spread, unsigned int seed,
  double decaySeconds, double sampleRate, double tailWidth, Layout* out
) {
  // Decay is the tail length: the time (s) from the input to the end of the
  // tail, and the tap level falls exponentially to -60 dB there (an RT60).
  // A tail is at least one sample long and has to fit the delay line with its
  // widest pulse (physical limits only).
  int flags = 0;
  double length = decaySeconds * sampleRate;
  if (!(length >= 1.0)) length = 1.0;
  const double widest = headWidth > tailWidth ? headWidth : tailWidth;
  const double maxLength = (double)(kDelaySize - 4) - widest;
  if (length > maxLength) { length = maxLength; flags |= kLayoutLengthLimit; }

  // Density sets the spacing (one tap per 1/Density period) and Decay the
  // length, so the tap count is Density x Decay. It is continuous: the last
  // tap's period is the part of the length that is left, and that tap is
  // scaled by the same fraction, so it fades in and out. Past kMaxTaps (the
  // engine's physical table size) the taps spread evenly over the length and
  // the face says so.
  double grid = rawGrid;
  if (grid * (double)kMaxTaps < length) { grid = length / (double)kMaxTaps; flags |= kLayoutTapLimit; }
  double exactTaps = length / grid;
  if (exactTaps > (double)kMaxTaps) exactTaps = (double)kMaxTaps;
  int count = (int)exactTaps;
  double lastPart = exactTaps - (double)count;
  // A leftover below 1e-6 of a tap is float round-off (76 x 1/76 s), not a tap.
  if (lastPart > 1e-6) {
    count += 1;
  } else {
    lastPart = 1.0;
  }
  if (count > kMaxTaps) { count = kMaxTaps; lastPart = 1.0; }
  if (count < 1) { count = 1; lastPart = 1.0; }

  const double decayK = kLn1000 / length; // per sample: -60 dB at the end
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
  // gets back the energy wider pulses lose, so Decay alone sets the tail's
  // level and Tail Darkness only its colour.
  const bool ramp = tailWidth > 0.0 && tailWidth != headWidth;
  const double headEnergy = mean_width_energy(headWidth);

  for (int i = 0; i < count; ++i) {
    const bool last = (i == count - 1);
    const double blockStart = (double)i * grid;
    const double block = last ? grid * lastPart : grid; // the last period is what is left
    const double part = last ? lastPart : 1.0;
    double maxWidth = headWidth;
    double rampGain = 1.0;
    if (ramp) {
      const double u = blockStart / length;
      maxWidth = headWidth + u * (tailWidth - headWidth);
      if (maxWidth < 1.0) maxWidth = 1.0; // a pulse covers at least one sample
      rampGain = __builtin_sqrt(headEnergy / mean_width_energy(maxWidth));
    }

    const double jitterL = next_unit(sL);
    const double widthUnitL = next_unit(sL);
    const double signL = (next_rand(sL) & 0x10000u) ? 1.0 : -1.0;

    const double jitterR = next_unit(sR);
    const double widthUnitR = next_unit(sR);
    const double ownSignR = (next_rand(sR) & 0x10000u) ? 1.0 : -1.0;
    const double ownR = next_unit(sR);

    const double posL = blockStart + jitterL * block;
    const double posR = blockStart + jitterR * block;
    // Widths are drawn uniformly over [1, maxWidth].
    const double widthL = 1.0 + widthUnitL * (maxWidth - 1.0);
    const double rawWidthR = 1.0 + widthUnitR * (maxWidth - 1.0);

    // Right follows Left at Spread 0 and its own draw at Spread 1. The sign
    // goes independent on a per-tap threshold, so decorrelation grows evenly.
    const double blendPosR = posL + spread * (posR - posL);
    const double widthR = widthL + spread * (rawWidthR - widthL); // stays in [1, maxWidth]
    const double signR = (ownR < spread) ? ownSignR : signL;

    if (openL) {
      if (posL + widthL < (double)(kDelaySize - 1)) {
        const double envL = part * rampGain * soemdsp_maths::dsp_exp(-decayK * (posL + 0.5 * widthL));
        if (out) {
          out->pos[countL] = (double)(int)posL / sampleRate;
          out->width[countL] = widthL / sampleRate;
          out->level[countL] = envL;
        }
        set_tap(t.left[countL++], (int)posL, widthL, signL * envL);
        // A tap averages `width` samples (gain 1/width), so its energy on
        // noise is env^2 * (n + f^2) / w^2 (env^2 / width at whole widths).
        // Counting the width keeps the wet level the same at any Darkness.
        sumL += envL * envL * width_energy(widthL);
      } else {
        openL = false;
      }
    }
    if (openR) {
      if (blendPosR + widthR < (double)(kDelaySize - 1)) {
        const double envR = part * rampGain * soemdsp_maths::dsp_exp(-decayK * (blendPosR + 0.5 * widthR));
        set_tap(t.right[countR++], (int)blendPosR, widthR, signR * envR);
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
  }
}

// Face layout: one static table (no delay lines), rebuilt only when the face asks.
static TapTable gLayoutTable;
static double gLayoutPos[kMaxTaps];
static double gLayoutWidth[kMaxTaps];
static double gLayoutLevel[kMaxTaps];
static Layout gLayout = { gLayoutPos, gLayoutWidth, gLayoutLevel, 0.0, 0 };

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

static inline double read_taps(const Cell* line, int write, const Tap* taps, int count) {
  double sum = 0.0;
  for (int i = 0; i < count; ++i) {
    const Tap& tap = taps[i];
    const Cell& a = line[(write - tap.start) & kDelayMask];
    const Cell& c = line[(write - tap.end) & kDelayMask];
    if (a.count == c.count) continue; // window saw only silence: exactly 0
    const Cell& b = line[(write - tap.mid) & kDelayMask];
    sum += (a.v - tap.cMid * b.v - tap.cEnd * c.v) * tap.gain;
  }
  return sum;
}

static void clear_state(VelvetReverbState& s) {
  for (int i = 0; i < kDelaySize; ++i) {
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

int soemdsp_velvet_reverb_create() {
  for (int i = 0; i < kMaxInstances; ++i) {
    if (!gPool[i].active) {
      void* block = soemdsp::memory_pool::alloc(kBlockBytes);
      if (!block) return 0; // out of memory budget: the engine reports it
      VelvetReverbState& s = gPool[i];
      s.block = block;
      s.tables = (TapTable*)block;
      s.delayL = (Cell*)((unsigned char*)block + 2UL * sizeof(TapTable));
      s.delayR = s.delayL + kDelaySize;
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
      s.builtRate = 0.0;
      s.builtSeed = 0u;
      s.tables[0].countL = 0;
      s.tables[0].countR = 0;
      s.tables[0].normL = 0.0;
      s.tables[0].normR = 0.0;
      clear_state(s);
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
  double densityHz,     // taps per second
  double darkness,      // max pulse width in samples (continuous, >= 1)
  double stereoSpread,  // 0 .. 1
  double mix,           // dry/wet
  double sampleRate,
  double decay,         // tail length in seconds (RT60: -60 dB at the last tap)
  double tailDarkness   // max pulse width at the last tap, 0 = same as Darkness
) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  VelvetReverbState& s = gPool[handle - 1];
  if (!s.active) return 0.0;

  if (!(sampleRate >= 1000.0)) sampleRate = 48000.0;
  if (!(densityHz == densityHz)) densityHz = 2500.0;
  // Density 0 (or below) pauses: the diffuser keeps the taps it has. No hidden
  // floor: 0 means stopped, not "1 Hz".
  const bool paused = !(densityHz > 0.0);
  const double grid = paused ? s.builtGrid : sampleRate / densityHz;

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
    build_table(s.tables[s.cur], grid, width, spread, s.seed, decay, sampleRate, tail, nullptr);
    s.builtDecay = decay; s.builtRate = sampleRate; s.builtTail = tail;
    s.builtGrid = grid; s.builtWidth = width;
    s.builtSpread = spread; s.builtSeed = s.seed;
  } else if (!s.fading && (
    grid != s.builtGrid || width != s.builtWidth
    || spread != s.builtSpread || s.seed != s.builtSeed
    || decay != s.builtDecay || sampleRate != s.builtRate || tail != s.builtTail
  )) {
    build_table(s.tables[1 - s.cur], grid, width, spread, s.seed, decay, sampleRate, tail, nullptr);
    s.builtDecay = decay; s.builtRate = sampleRate; s.builtTail = tail;
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
  s.writeIdx = (w + 1) & kDelayMask;

  double outL = 0.0;
  double outR = 0.0;

  {
    const TapTable& a = s.tables[s.cur];
    double wetL = read_taps(s.delayL, w, a.left, a.countL) * a.normL;
    double wetR = read_taps(s.delayR, w, a.right, a.countR) * a.normR;
    if (s.fading) {
      const TapTable& b = s.tables[1 - s.cur];
      const double g = s.fade;
      wetL += g * (read_taps(s.delayL, w, b.left, b.countL) * b.normL - wetL);
      wetR += g * (read_taps(s.delayR, w, b.right, b.countR) * b.normR - wetR);
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
// static table and return the tap count (0 while Density pauses). Read it with
// the _layout_* pointers / values below. Costs one table build; call it only
// when a setting changes.
int soemdsp_velvet_reverb_layout(
  double densityHz, double darkness, double stereoSpread, double sampleRate,
  double decay, double tailDarkness, double seed
) {
  if (!(sampleRate >= 1000.0)) sampleRate = 48000.0;
  if (!(densityHz == densityHz)) densityHz = 2500.0;
  gLayout.length = 0.0;
  gLayout.flags = 0;
  if (!(densityHz > 0.0)) return 0;
  if (!(decay == decay)) decay = 0.025;
  const unsigned int seedU = seed > 0.0 ? (unsigned int)seed : 0u;
  build_table(gLayoutTable, sampleRate / densityHz, clean_width(darkness), clean_spread(stereoSpread),
    seedU, decay, sampleRate, clean_tail(tailDarkness), &gLayout);
  return gLayoutTable.countL;
}
double* soemdsp_velvet_reverb_layout_pos() { return gLayoutPos; }
double* soemdsp_velvet_reverb_layout_width() { return gLayoutWidth; }
double* soemdsp_velvet_reverb_layout_level() { return gLayoutLevel; }
double soemdsp_velvet_reverb_layout_length() { return gLayout.length; }
int soemdsp_velvet_reverb_layout_flags() { return gLayout.flags; }
int soemdsp_velvet_reverb_max_taps() { return kMaxTaps; }

double soemdsp_velvet_reverb_right(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].outRight;
}

int soemdsp_velvet_reverb_version() {
  return 2; // 2: Darkness / Tail Darkness are continuous (fractional pulse widths); Decay is the tail length in seconds (RT60), the taps span it and fade to -60 dB; Density x Decay sets the tap count (no Tap Count); layout export for the face. 1: split out of Velvet Noise (diffuser only; the generator is its own module now)
}

} // extern "C"
