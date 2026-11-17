// soemdsp-native-module: velvet_noise
// soemdsp-native-label: Velvet Noise
// soemdsp-native-target: velvetNoise
// soemdsp-native-kind: noise
//
// Velvet Noise: a stereo random-event generator. One event at a random position in
// every 1/Density period, nothing in between. What an event looks like is the Shape:
//
//   Trigger          one sample (a velvet impulse).
//   Sinc             a lowpass impulse (windowed sinc, peak exactly on the event). Cutoff sets
//                    how wide the lobes are, Lobes how many ring either side of the peak.
//   PolyBLEP Saw     a ramp that starts at the event and completes before the next one.
//   Half Sine        the same ramp with the half-sine curve (a bassier, rounder saw).
//   Sine             one full sine cycle from event to event.
//   Rect Sine        a rectified sine arch: sharp at the bottom, rounded at the top.
//
// The four ramp shapes are one cycle per gap: an event starts a cycle and the next
// event ends it, so the cycle length follows the random spacing. Their jumps and
// kinks are PolyBLEP / PolyBLAMP corrected at the event's exact (fractional) time.
//
// Sign:
//   Random   every event is flipped to +1 or -1 at random (classic velvet noise).
//   Bipolar  every event is the shape's own bipolar form (a saw is always -1 to +1,
//            an impulse is always +1), so the Trigger - output never fires.
//
// Event times are real numbers, not whole samples: the whole-sample part is the
// classic velvet position and the fraction comes from its own random stream, so
// Trigger mode keeps the classic sequence and every other shape is placed exactly.
//
// Sinc needs lead-in (its ringing starts before the peak), so events are drawn
// ahead of time and the kernel is stamped early. The peak still lands on the event:
// there is no added latency and the Trigger outputs stay aligned with it.
//
// Density 0 pauses the generator (no hidden 1 Hz floor). Above the sample rate the
// generator simply fires on every sample.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/memory_pool.h>

namespace {

static const int kMaxInstances = 128;
static const int kRing = 1024;      // event blocks kept: drawn ahead plus a little history
static const int kRingMask = kRing - 1;
static const int kMaxHalf = 1024;   // longest sinc reach: samples either side of an event
static const int kAcc = 4096;       // output ring the sinc kernels are stamped into (> 2 * reach)
static const int kAccMask = kAcc - 1;

enum Shape {
  kTrigger = 0,
  kSinc = 1,
  kSaw = 2,
  kHalfSine = 3,
  kSine = 4,
  kRectSine = 5,
  kShapeCount = 6
};

struct Ev {
  double t;     // absolute time in samples (fractional)
  double te;    // t, pushed later if needed so events are at least one sample apart (ramp shapes)
  double sign;  // +1 / -1, drawn for every event so the sequence never depends on Sign mode
};

struct Pend {
  double j;
  double s;
  unsigned int idx;
  bool valid;
};

struct Chan {
  unsigned int tIdx;  // next event for the Trigger shape / outputs (fires on floor(t))
  unsigned int rIdx;  // next event the ramp shapes have not reached yet (reached when t <= now)
  unsigned int sIdx;  // next event whose sinc kernel is not stamped yet
  bool havePrev;
  Ev prev;            // the event whose cycle is running
  Pend pend;          // jump of the upcoming event, computed one sample ahead
  bool post;          // a corrected event is within one sample behind us
  double postJ;
  double postS;
  double postTau;
  double* acc;        // kAcc cells, in the pool block
};

struct VelvetNoiseState {
  bool active;
  unsigned int seed;
  unsigned int rngL;
  unsigned int rngR;
  unsigned int rngFL;  // fractional part of the event time
  unsigned int rngFR;
  long long now;       // sample being made
  double lastTeL;      // effective time of the last drawn event, per channel
  double lastTeR;
  double blockEnd;     // start of the next period to draw (a whole number of samples)
  double remainder;    // fractional samples carried between periods
  unsigned int wr;     // periods drawn so far
  Ev* evL;            // kRing events each, in the pool block
  Ev* evR;
  void* block;
  Chan ch[2];
  double sincFc;      // sinc cutoff in cycles per sample (0.5 = Nyquist)
  double sincK;       // sinc reach in samples either side
  double outRight;
  double trigPos;
  double trigNeg;
};

static VelvetNoiseState gPool[kMaxInstances];

static const unsigned long kBlockBytes =
  2UL * (unsigned long)kRing * sizeof(Ev) + 2UL * (unsigned long)kAcc * sizeof(double);

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

// Value and slope (per unit phase) at the two ends of each ramp shape's cycle.
struct RampEnds {
  double f0;
  double f1;
  double d0;
  double d1;
};

static const double kVPi = 3.14159265358979323846;
static const double kVTwoPi = 6.28318530717958647692;

static const RampEnds kRamp[4] = {
  { -1.0, 1.0, 2.0, 2.0 },            // Saw: 2x - 1
  { -1.0, 1.0, 0.0, 0.0 },            // Half Sine: -cos(pi x)
  { 0.0, 0.0, kVTwoPi, kVTwoPi },       // Sine: sin(2 pi x)
  { -1.0, -1.0, kVTwoPi, -kVTwoPi }     // Rect Sine: 2 sin(pi x) - 1
};

static inline double ramp_value(int shape, double x) {
  if (shape == kSaw) return 2.0 * x - 1.0;
  if (shape == kHalfSine) return -soemdsp_maths::dsp_cos(kVPi * x);
  if (shape == kSine) return soemdsp_maths::dsp_sin(kVTwoPi * x);
  return 2.0 * soemdsp_maths::dsp_sin(kVPi * x) - 1.0;
}

// PolyBLEP (step) and PolyBLAMP (slope) residuals for an event that sits x samples
// before (x in [-1, 0)) or after (x in [0, 1)) this sample. J is the jump in value
// across the event and S the jump in slope per sample.
static inline double event_correction(double x, double J, double S) {
  if (x < 0.0) {
    const double a = x + 1.0;
    return 0.5 * J * a * a + (S / 6.0) * a * a * a;
  }
  return 0.5 * J * (2.0 * x - x * x - 1.0)
    + 0.5 * S * (1.0 / 3.0 + x * x - x * x * x / 3.0 - x);
}

static void restart_stream(VelvetNoiseState& s) {
  s.rngL = seed_left(s.seed);
  s.rngR = seed_right(s.seed);
  s.rngFL = seed_left(s.seed ^ 0xA5A5A5A5u);
  s.rngFR = seed_right(s.seed ^ 0x5A5A5A5Au);
  s.blockEnd = (double)s.now;
  s.lastTeL = -1.0e18;
  s.lastTeR = -1.0e18;
  s.remainder = 0.0;
  s.wr = 0u;
  for (int c = 0; c < 2; ++c) {
    Chan& ch = s.ch[c];
    ch.tIdx = 0u;
    ch.rIdx = 0u;
    ch.sIdx = 0u;
    ch.havePrev = false;
    ch.prev.t = 0.0;
    ch.prev.te = 0.0;
    ch.prev.sign = 1.0;
    ch.pend.valid = false;
    ch.pend.idx = 0u;
    ch.pend.j = 0.0;
    ch.pend.s = 0.0;
    ch.post = false;
    ch.postJ = 0.0;
    ch.postS = 0.0;
    ch.postTau = 0.0;
    if (ch.acc) for (int i = 0; i < kAcc; ++i) ch.acc[i] = 0.0;
  }
}

static void clear_state(VelvetNoiseState& s) {
  s.now = 0;
  s.outRight = 0.0;
  s.trigPos = 0.0;
  s.trigNeg = 0.0;
  restart_stream(s);
}

// Draws the next period: one event per channel. The classic draws (position, sign,
// right-channel blend) are made in the classic order, so the whole-sample position and
// the sign of every event are the same sequence the old generator produced.
static void draw_block(VelvetNoiseState& s, double grid, double spread) {
  s.remainder += grid;
  int length = (int)s.remainder;
  if (length < 1) length = 1; // at most one event per sample (density above the sample rate)
  s.remainder -= (double)length;
  if (s.remainder < 0.0) s.remainder = 0.0;

  const int offL = (int)(next_unit(s.rngL) * (double)length);
  const double signL = (next_rand(s.rngL) & 0x10000u) ? 1.0 : -1.0;
  const int rawR = (int)(next_unit(s.rngR) * (double)length);
  const double ownSignR = (next_rand(s.rngR) & 0x10000u) ? 1.0 : -1.0;
  const double ownR = next_unit(s.rngR);

  int offR = (int)((double)offL + spread * (double)(rawR - offL) + 0.5);
  if (offR > length - 1) offR = length - 1;
  if (offR < 0) offR = 0;
  const double signR = (ownR < spread) ? ownSignR : signL;

  const double fracL = next_unit(s.rngFL);
  const double rawFracR = next_unit(s.rngFR);
  const double fracR = fracL + spread * (rawFracR - fracL);

  const unsigned int k = s.wr & (unsigned int)kRingMask;
  s.evL[k].t = s.blockEnd + (double)offL + fracL;
  s.evL[k].sign = signL;
  s.evR[k].t = s.blockEnd + (double)offR + fracR;
  s.evR[k].sign = signR;
  // The ramp shapes need a whole sample for a cycle to be anti-aliased, so their event times
  // keep one sample of room after the previous event (a later event is pushed, never an earlier
  // one, and it stays inside its own period). Trigger and Sinc use the true times.
  s.evL[k].te = s.evL[k].t < s.lastTeL + 1.0 ? s.lastTeL + 1.0 : s.evL[k].t;
  s.evR[k].te = s.evR[k].t < s.lastTeR + 1.0 ? s.lastTeR + 1.0 : s.evR[k].t;
  s.lastTeL = s.evL[k].te;
  s.lastTeR = s.evR[k].te;

  s.blockEnd += (double)length;
  s.wr++;
}

// Keeps enough periods drawn ahead for what the current shape needs.
static void ensure_blocks(VelvetNoiseState& s, double nd, int shape, double grid, double spread) {
  for (;;) {
    bool need = s.wr <= s.ch[0].rIdx || s.wr <= s.ch[1].rIdx
      || s.wr <= s.ch[0].tIdx || s.wr <= s.ch[1].tIdx;
    if (!need && shape == kSinc) need = (s.blockEnd - s.sincK <= nd);
    if (!need && shape >= kSaw) {
      // A ramp needs the event after the next one to size its jump and kink.
      for (int c = 0; c < 2 && !need; ++c) {
        const Chan& ch = s.ch[c];
        const Ev* ring = c == 0 ? s.evL : s.evR;
        if (s.wr <= ch.rIdx + 1u && ring[ch.rIdx & (unsigned int)kRingMask].te - nd <= 1.0) need = true;
      }
    }
    if (!need) return;
    draw_block(s, grid, spread);
  }
}

// Jump in value and in slope (per sample) when event `e` starts its cycle.
static void compute_jump(
  const Chan& c, const Ev* ring, unsigned int wr, unsigned int e, bool bipolar, int shape,
  double& J, double& S
) {
  const RampEnds& end = kRamp[shape - kSaw];
  const Ev& ev = ring[e & (unsigned int)kRingMask];
  const double sN = bipolar ? 1.0 : ev.sign;
  // A cycle shorter than a couple of samples has no room for a kink to be corrected, and a
  // signal limited to Nyquist cannot slope steeper than pi per sample at unit height, so the
  // slope that feeds the correction is capped there (cycle length floored at |d| / pi).
  double dNext = (wr > e + 1u) ? ring[(e + 1u) & (unsigned int)kRingMask].te - ev.te : 1.0;
  double room = dNext; // the shorter of the two cycles beside this event, before any floor
  const double floorNext = (end.d0 < 0.0 ? -end.d0 : end.d0) / kVPi;
  if (dNext < floorNext) dNext = floorNext;
  if (dNext < 1e-6) dNext = 1e-6;
  double jv = sN * end.f0;
  double sv = sN * end.d0 / dNext;
  if (c.havePrev) {
    const double sP = bipolar ? 1.0 : c.prev.sign;
    double dPrev = ev.te - c.prev.te;
    if (dPrev < room) room = dPrev;
    const double floorPrev = (end.d1 < 0.0 ? -end.d1 : end.d1) / kVPi;
    if (dPrev < floorPrev) dPrev = floorPrev;
    if (dPrev < 1e-6) dPrev = 1e-6;
    jv -= sP * end.f1;
    sv -= sP * end.d1 / dPrev;
  }
  // Corrections only fit kinks that stand alone: two kinks closer than ~2 samples overlap and
  // would add up to far more than the little arch between them, so they fade out from 3 samples apart to 1.
  J = jv;
  S = room >= 3.0 ? sv : (room <= 1.0 ? 0.0 : sv * ((room - 1.0) * 0.5));
}

// Adds one windowed-sinc event (Blackman window) into the output ring: a lowpass impulse
// sinc(2 fc x), peak 1, with a zero crossing every 1 / (2 fc) samples. Below Nyquist the lobes
// are wider than a sample, so the pre- and post-ringing is spread between the ticks. The sine
// and the window are stepped by rotation (one multiply-add pair per tap).
static void stamp_sinc(VelvetNoiseState& s, Chan& c, const Ev& e, double sg, long long now) {
  const double K = s.sincK;
  const long long whole = (long long)e.t;
  const double fr = e.t - (double)whole;
  const double delta = kVTwoPi * s.sincFc;       // sine phase per sample
  const double half = K + 1.0;                    // window half-width
  const double wd = kVPi / half;                  // window phase per sample
  const int reach = (int)K;
  const int i0 = -reach;
  const double x0 = (double)i0 - fr;
  double sn = soemdsp_maths::dsp_sin(delta * x0);
  double cs = soemdsp_maths::dsp_cos(delta * x0);
  const double sd = soemdsp_maths::dsp_sin(delta);
  const double cd = soemdsp_maths::dsp_cos(delta);
  double wsn = soemdsp_maths::dsp_sin(wd * x0);
  double wcs = soemdsp_maths::dsp_cos(wd * x0);
  const double wsd = soemdsp_maths::dsp_sin(wd);
  const double wcd = soemdsp_maths::dsp_cos(wd);
  for (int i = i0; i <= reach + 1; ++i) {
    const double x = (double)i - fr;
    if (x <= K && x >= -K) {
      const long long j = whole + (long long)i;
      if (j >= now) { // not already played
        const double th = delta * x;
        const double k = (th > 1e-9 || th < -1e-9) ? sn / th : 1.0;
        const double w = 0.42 + 0.5 * wcs + 0.08 * (2.0 * wcs * wcs - 1.0);
        c.acc[(unsigned int)(j & (long long)kAccMask)] += sg * k * w;
      }
    }
    const double ns = sn * cd + cs * sd;
    cs = cs * cd - sn * sd;
    sn = ns;
    const double wns = wsn * wcd + wcs * wsd;
    wcs = wcs * wcd - wsn * wsd;
    wsn = wns;
  }
}

static double run_channel(
  VelvetNoiseState& s, int ci, double nd, int shape, bool bipolar, double grid, double spread
) {
  Chan& c = s.ch[ci];
  const Ev* ring = ci == 0 ? s.evL : s.evR;
  const unsigned int mask = (unsigned int)kRingMask;
  const long long now = s.now;

  // Events that land inside this sample (the Trigger shape and the Trigger outputs).
  double trigVal = 0.0;
  for (;;) {
    ensure_blocks(s, nd, shape, grid, spread);
    if (!(c.tIdx < s.wr && ring[c.tIdx & mask].t < nd + 1.0)) break;
    const Ev& e = ring[c.tIdx & mask];
    c.tIdx++;
    const double sg = bipolar ? 1.0 : e.sign;
    trigVal = sg;
    if (ci == 0) {
      if (sg > 0.0) s.trigPos = 1.0;
      else s.trigNeg = 1.0;
    }
  }

  // Events that have begun by this sample's instant (start of a ramp cycle).
  for (;;) {
    ensure_blocks(s, nd, shape, grid, spread);
    if (!(c.rIdx < s.wr && ring[c.rIdx & mask].te <= nd)) break;
    const Ev& e = ring[c.rIdx & mask];
    if (shape >= kSaw) {
      double J, S;
      if (c.pend.valid && c.pend.idx == c.rIdx) {
        J = c.pend.j;
        S = c.pend.s;
      } else {
        compute_jump(c, ring, s.wr, c.rIdx, bipolar, shape, J, S);
      }
      c.post = true;
      c.postJ = J;
      c.postS = S;
      c.postTau = e.te;
    }
    c.prev = e;
    c.havePrev = true;
    c.rIdx++;
  }

  double y = 0.0;
  if (shape == kTrigger) {
    y = trigVal;
  } else if (shape == kSinc) {
    for (;;) {
      ensure_blocks(s, nd, shape, grid, spread);
      if (!(c.sIdx < s.wr && ring[c.sIdx & mask].t - s.sincK <= nd)) break;
      const Ev& e = ring[c.sIdx & mask];
      stamp_sinc(s, c, e, bipolar ? 1.0 : e.sign, now);
      c.sIdx++;
    }
    y = c.acc[(unsigned int)(now & (long long)kAccMask)];
  } else if (c.havePrev) {
    const Ev& nx = ring[c.rIdx & mask];
    double dt = nx.te - c.prev.te;
    if (dt < 1e-12) dt = 1e-12;
    double x = (nd - c.prev.te) / dt;
    if (x < 0.0) x = 0.0;
    if (x > 0.999999999) x = 0.999999999;
    y = (bipolar ? 1.0 : c.prev.sign) * ramp_value(shape, x);

    if (c.post) {
      const double px = nd - c.postTau;
      if (px >= 1.0) c.post = false;
      else y += event_correction(px, c.postJ, c.postS);
    }
    if (nx.te - nd <= 1.0) {
      if (!(c.pend.valid && c.pend.idx == c.rIdx)) {
        double J, S;
        compute_jump(c, ring, s.wr, c.rIdx, bipolar, shape, J, S);
        c.pend.j = J;
        c.pend.s = S;
        c.pend.idx = c.rIdx;
        c.pend.valid = true;
      }
      y += event_correction(nd - nx.te, c.pend.j, c.pend.s);
    }
  }

  // Keep the stamping index current while another shape is playing, and clear the slot.
  if (shape != kSinc) c.sIdx = c.rIdx;
  c.acc[(unsigned int)(now & (long long)kAccMask)] = 0.0;
  return y;
}

} // namespace

extern "C" {

int soemdsp_velvet_noise_create() {
  for (int i = 0; i < kMaxInstances; ++i) {
    if (!gPool[i].active) {
      void* block = soemdsp::memory_pool::alloc(kBlockBytes);
      if (!block) return 0; // out of memory budget: the engine reports it
      VelvetNoiseState& s = gPool[i];
      s.block = block;
      s.evL = (Ev*)block;
      s.evR = s.evL + kRing;
      s.ch[0].acc = (double*)(s.evR + kRing);
      s.ch[1].acc = s.ch[0].acc + kAcc;
      s.active = true;
      s.seed = 1u;
      s.sincFc = 0.5;
      s.sincK = 16.0;
      clear_state(s);
      return i + 1;
    }
  }
  return 0;
}

void soemdsp_velvet_noise_destroy(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return;
  VelvetNoiseState& s = gPool[handle - 1];
  if (s.active) soemdsp::memory_pool::release(s.block);
  s.block = nullptr;
  s.evL = nullptr;
  s.evR = nullptr;
  s.ch[0].acc = nullptr;
  s.ch[1].acc = nullptr;
  s.active = false;
}

void soemdsp_velvet_noise_reset(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return;
  clear_state(gPool[handle - 1]);
}

// Restarts the event stream from the new seed.
void soemdsp_velvet_noise_set_seed(int handle, double seed) {
  if (handle <= 0 || handle > kMaxInstances) return;
  VelvetNoiseState& s = gPool[handle - 1];
  s.seed = seed > 0.0 ? (unsigned int)seed : 0u;
  restart_stream(s);
}

double soemdsp_velvet_noise_sample(
  int handle,
  double shapeIn,       // 0 Trigger, 1 Sinc, 2 PolyBLEP Saw, 3 Half Sine, 4 Sine, 5 Rect Sine
  double signIn,        // 0 = Random sign, 1 = Bipolar
  double densityHz,     // events per second
  double stereoSpread,  // 0 .. 1
  double gain,
  double sampleRate,
  double cutoffHz,      // Sinc: lowpass cutoff, at or above Nyquist = a plain band-limited impulse
  double lobes          // Sinc: ringing lobes kept either side of the peak
) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  VelvetNoiseState& s = gPool[handle - 1];
  if (!s.active) return 0.0;

  if (!(sampleRate >= 1000.0)) sampleRate = 48000.0;
  if (!(densityHz == densityHz)) densityHz = 2500.0;
  if (!(gain == gain)) gain = 0.0;

  int shape = (shapeIn == shapeIn) ? (int)(shapeIn + 0.5) : 0;
  if (shape < 0) shape = 0;
  if (shape >= kShapeCount) shape = kShapeCount - 1;
  const bool bipolar = signIn == signIn && signIn >= 0.5;

  double spread = (stereoSpread == stereoSpread) ? stereoSpread : 1.0;
  if (spread < 0.0) spread = 0.0;
  if (spread > 1.0) spread = 1.0;

  s.trigPos = 0.0;
  s.trigNeg = 0.0;

  // Density 0 (or below) pauses: no new events, and the stream holds its place.
  if (!(densityHz > 0.0)) {
    s.outRight = 0.0;
    return 0.0;
  }
  const double grid = sampleRate / densityHz;
  const double nd = (double)s.now;

  // Sinc shape: cutoff in cycles per sample and the reach that holds the requested lobes.
  if (!(cutoffHz == cutoffHz)) cutoffHz = sampleRate * 0.5;
  double fc = cutoffHz / sampleRate;
  if (fc > 0.5) fc = 0.5;
  if (fc < 0.00002) fc = 0.00002;
  if (!(lobes == lobes) || lobes < 1.0) lobes = 1.0;
  if (lobes > 64.0) lobes = 64.0;
  double reach = (double)(int)(lobes / (2.0 * fc) + 1.0);
  if (reach < 4.0) reach = 4.0;
  if (reach > (double)kMaxHalf) reach = (double)kMaxHalf;
  s.sincFc = fc;
  s.sincK = reach;

  const double outL = run_channel(s, 0, nd, shape, bipolar, grid, spread);
  const double outR = run_channel(s, 1, nd, shape, bipolar, grid, spread);
  s.now++;

  s.outRight = outR * gain;
  return outL * gain;
}

double soemdsp_velvet_noise_right(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].outRight;
}

// One-sample triggers from the Left event stream, split by sign. Height is always 1
// (Amp does not scale them). In Bipolar mode every event is positive.
double soemdsp_velvet_noise_trigger_pos(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].trigPos;
}

double soemdsp_velvet_noise_trigger_neg(int handle) {
  if (handle <= 0 || handle > kMaxInstances) return 0.0;
  return gPool[handle - 1].trigNeg;
}

int soemdsp_velvet_noise_version() {
  return 9; // 9: Sinc Cutoff and Lobes (lowpass sinc, audible pre/post ringing), pool memory again. 8: generator only, with Shape (Trigger, Sinc, PolyBLEP Saw, Half Sine, Sine, Rect Sine) and Sign (Random / Bipolar). 7: Density 0 pauses
}

} // extern "C"
