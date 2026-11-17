// soemdsp-native-module: velvet_reverb
// soemdsp-native-label: Velvet Reverb
// soemdsp-native-target: velvetReverb
// soemdsp-native-kind: reverb
//
// Velvet Reverb: a Dark Velvet Noise (DVN) diffuser. (The velvet noise event
// generator is its own module, velvet_noise.)
//
// Diffuser (Dark Velvet Noise):
//   Sparse FIR of Tap Count rectangular pulses, one per 1/Density period, with
//   random position, sign and width (1 .. Darkness samples). Each pulse is read
//   from a leaky running sum of the input:
//
//     I[n]   = leak * I[n-1] + x[n]
//     pulse  = I[n - start] - leak^width * I[n - end]        (end = start + width)
//
//   The leak^width factor makes the difference exactly the (leak-weighted) sum
//   of the last `width` samples, so nothing from before the pulse bleeds in and
//   the sum never drifts. Cost is O(1) per tap for any width.
//
// Click-free changes:
//   Density, Tap Count, Darkness, Stereo Spread, Seed and the sample rate all
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
// Physical limits only. Tap Count and Darkness ranges belong to the parameters;
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
  int end;         // start + width
  double gain;     // sign / width
  double leakPow;  // kLeak ^ width
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
  int builtTaps;
  int builtWidth;
  double builtSpread;
  double builtDecay;
  int builtTail;
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

static inline void set_tap(Tap& tap, int start, int width, double sign) {
  tap.start = start;
  tap.end = start + width;
  tap.gain = sign / (double)width;
  tap.leakPow = soemdsp_maths::dsp_exp((double)width * kLnLeak);
}

// Fills `t` from the given settings. Every tap draws the same number of random
// values whatever the settings are, so one setting can move without
// reshuffling what the others decided.
// Mean of 1/w over w = 1..W (a tap's energy factor on noise for widths drawn
// uniformly up to W): H(W) / W, with the harmonic number from its expansion.
static double mean_inv_width(double w) {
  if (w <= 1.0) return 1.0;
  const double h = soemdsp_maths::dsp_ln(w) + 0.5772156649015329 + 0.5 / w - 1.0 / (12.0 * w * w);
  return h / w;
}

static void build_table(
  TapTable& t, double grid, int taps, int headWidth, double spread, unsigned int seed,
  double decay, double sampleRate, int tailWidth
) {
  // Decay is a rate in dB per second: tap level falls by `decay` dB every
  // second. 0 is flat and small values are nearly flat (continuous at 0).
  const double decayK = decay * 0.1151292546497023 / sampleRate;
  double sumL = 0.0;
  double sumR = 0.0;
  unsigned int sL = seed_left(seed);
  unsigned int sR = seed_right(seed);
  int countL = 0;
  int countR = 0;
  bool openL = true;
  bool openR = true;

  // Tail Darkness: the widest pulse grows from Darkness at the first tap to
  // Tail Darkness at the last (0 = off), so the tail darkens over time the way
  // a room's highs die first (Dark Velvet Noise, Fagerstrom et al., DAFx 2022).
  // Each tap also gets back the energy wider pulses lose, so Decay alone sets
  // the tail's level and Tail Darkness only its colour.
  const bool ramp = tailWidth > 0 && tailWidth != headWidth && taps > 1;
  const double headEnergy = mean_inv_width((double)headWidth);

  for (int i = 0; i < taps; ++i) {
    const double blockStart = (double)i * grid;
    int maxWidth = headWidth;
    double rampGain = 1.0;
    if (ramp) {
      const double u = (double)i / (double)(taps - 1);
      maxWidth = (int)((double)headWidth + u * (double)(tailWidth - headWidth) + 0.5);
      if (maxWidth < 1) maxWidth = 1;
      rampGain = __builtin_sqrt(headEnergy / mean_inv_width((double)maxWidth));
    }

    const double jitterL = next_unit(sL);
    const double widthUnitL = next_unit(sL);
    const double signL = (next_rand(sL) & 0x10000u) ? 1.0 : -1.0;

    const double jitterR = next_unit(sR);
    const double widthUnitR = next_unit(sR);
    const double ownSignR = (next_rand(sR) & 0x10000u) ? 1.0 : -1.0;
    const double ownR = next_unit(sR);

    const double posL = blockStart + jitterL * grid;
    const double posR = blockStart + jitterR * grid;
    const int widthL = 1 + (int)(widthUnitL * (double)maxWidth);
    const int rawWidthR = 1 + (int)(widthUnitR * (double)maxWidth);

    // Right follows Left at Spread 0 and its own draw at Spread 1. The sign
    // goes independent on a per-tap threshold, so decorrelation grows evenly.
    const double blendPosR = posL + spread * (posR - posL);
    int widthR = (int)((double)widthL + spread * (double)(rawWidthR - widthL) + 0.5);
    if (widthR < 1) widthR = 1;
    if (widthR > maxWidth) widthR = maxWidth;
    const double signR = (ownR < spread) ? ownSignR : signL;

    if (openL) {
      if (posL + (double)widthL < (double)(kDelaySize - 1)) {
        const double envL = rampGain * soemdsp_maths::dsp_exp(-decayK * (posL + 0.5 * (double)widthL));
        set_tap(t.left[countL++], (int)posL, widthL, signL * envL);
        // A tap averages `width` samples (gain 1/width), so its energy on
        // noise is env^2 / width. Counting the width keeps the wet level the
        // same at any Darkness (it used to drop as Darkness rose).
        sumL += envL * envL / (double)widthL;
      } else {
        openL = false;
      }
    }
    if (openR) {
      if (blendPosR + (double)widthR < (double)(kDelaySize - 1)) {
        const double envR = rampGain * soemdsp_maths::dsp_exp(-decayK * (blendPosR + 0.5 * (double)widthR));
        set_tap(t.right[countR++], (int)blendPosR, widthR, signR * envR);
        sumR += envR * envR / (double)widthR;
      } else {
        openR = false;
      }
    }
    if (!openL && !openR) break;
  }

  t.countL = countL;
  t.countR = countR;
  t.normL = sumL > 0.0 ? 1.0 / __builtin_sqrt(sumL) : 0.0;
  // Right normalizes on its own energy like Left. It used the plain tap count,
  // which ignored Decay and width, so Right came out louder than Left.
  t.normR = sumR > 0.0 ? 1.0 / __builtin_sqrt(sumR) : 0.0;
}

static inline double read_taps(const Cell* line, int write, const Tap* taps, int count) {
  double sum = 0.0;
  for (int i = 0; i < count; ++i) {
    const Tap& tap = taps[i];
    const Cell& a = line[(write - tap.start) & kDelayMask];
    const Cell& b = line[(write - tap.end) & kDelayMask];
    if (a.count == b.count) continue; // window saw only silence: exactly 0
    sum += (a.v - tap.leakPow * b.v) * tap.gain;
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
      s.builtTaps = 0;
      s.builtWidth = 0;
      s.builtSpread = 0.0;
      s.builtDecay = 0.0;
      s.builtTail = 0;
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
  double densityHz,     // pulses per second
  double tapCount,      // 1 .. 256
  double darkness,      // max pulse width, 1 .. 32 samples
  double stereoSpread,  // 0 .. 1
  double mix,           // dry/wet
  double sampleRate,
  double decay,         // Diffuser tail decay in dB per second, 0 = flat
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

  int taps = (tapCount == tapCount) ? (int)(tapCount + 0.5) : 64;
  if (taps < 1) taps = 1;
  if (taps > kMaxTaps) taps = kMaxTaps;

  int width = (darkness == darkness) ? (int)(darkness + 0.5) : 1;
  if (width < 1) width = 1;
  if (width > kMaxPulseWidth) width = kMaxPulseWidth;

  double spread = (stereoSpread == stereoSpread) ? stereoSpread : 1.0;
  if (spread < 0.0) spread = 0.0;
  if (spread > 1.0) spread = 1.0;

  if (!(mix == mix)) mix = 0.0;
  if (!(decay == decay)) decay = 0.0;
  int tail = (tailDarkness == tailDarkness && tailDarkness > 0.0) ? (int)(tailDarkness + 0.5) : 0;
  if (tail > kMaxPulseWidth) tail = kMaxPulseWidth;
  if (!(inL == inL)) inL = 0.0;
  if (!(inR == inR)) inR = 0.0;

  // Tap table upkeep (none while paused: the diffuser keeps its taps).
  if (paused) {
    // nothing to build; a module that starts paused has no taps yet (wet is silent)
  } else if (s.builtGrid < 0.0) {
    build_table(s.tables[s.cur], grid, taps, width, spread, s.seed, decay, sampleRate, tail);
    s.builtDecay = decay; s.builtRate = sampleRate; s.builtTail = tail;
    s.builtGrid = grid; s.builtTaps = taps; s.builtWidth = width;
    s.builtSpread = spread; s.builtSeed = s.seed;
  } else if (!s.fading && (
    grid != s.builtGrid || taps != s.builtTaps || width != s.builtWidth
    || spread != s.builtSpread || s.seed != s.builtSeed
    || decay != s.builtDecay || sampleRate != s.builtRate || tail != s.builtTail
  )) {
    build_table(s.tables[1 - s.cur], grid, taps, width, spread, s.seed, decay, sampleRate, tail);
    s.builtDecay = decay; s.builtRate = sampleRate; s.builtTail = tail;
    s.builtGrid = grid; s.builtTaps = taps; s.builtWidth = width;
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

double soemdsp_velvet_reverb_right(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].outRight;
}

int soemdsp_velvet_reverb_version() {
  return 1; // 1: split out of Velvet Noise (diffuser only; the generator is its own module now)
}

} // extern "C"
