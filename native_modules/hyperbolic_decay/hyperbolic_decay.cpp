// soemdsp-native-module: hyperbolic_decay
// soemdsp-native-label: Hyperbolic AD
// soemdsp-native-target: hyperbolicDecay
// soemdsp-native-kind: envelope
//
// soundemote.dev Decay Envelopes #hyperbolic (Marvinh amp-shape), with an optional hyperbolic attack.
// A Trigger hit latches its height as start; end is 0.001.
//   u(x) = |w| > 1e-5 ? (exp(w x) - 1) / (exp(w) - 1) : x        (exp time warp, x = 0..1)
//   decay:  env = start * end / ((start - end) u(x) + end)         (start -> end over Decay)
//   attack: env = start * end / ((start - end) u(1 - x) + end)     (end -> start over Attack: the decay run backwards,
//           so the same time and shape on both sides give a symmetrical envelope)
//   Out = env * Amplitude. Attack 0 = no attack stage (the decay starts at the trigger height).
//
// Speed is a rate, not a position: each stage keeps a phase 0..1 and advances it by 1 / (time * sr) per
// sample, so changing Attack or Decay while the envelope runs makes it finish faster or slower from where
// it is. (It used to recompute x = t / duration, so a speed change moved the envelope forwards or backwards.)
// A hit during a tail rises from the current level instead of snapping to zero (the attack curve is
// inverted to find where it starts).

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 128;
static const double kEng = 0.001;

struct State {
  double phase;       // 0..1 within the current stage
  double height;      // trigger height (start level)
  double level;       // last env value (before Amplitude)
  double lastIn;
  double latchedAttack;
  double latchedAttackShape;
  double latchedDuration;
  double latchedShape;
  double latchedAmplitude;
  int stage;          // 0 idle, 1 attack, 2 decay
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"hyperbolic_decay\","
    "\"label\":\"Hyperbolic AD\","
    "\"targetType\":\"hyperbolicDecay\","
    "\"kind\":\"envelope\""
  "}";

static double exp_warp01(double x, double w) {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;
  if (w > -1.0e-5 && w < 1.0e-5) return x;
  const double ew = dsp_exp(w);
  const double den = ew - 1.0;
  if (den > -1.0e-12 && den < 1.0e-12) return x;
  return (dsp_exp(w * x) - 1.0) / den;
}

// Inverse of exp_warp01: the x whose warp is u.
static double exp_unwarp01(double u, double w) {
  if (u <= 0.0) return 0.0;
  if (u >= 1.0) return 1.0;
  if (w > -1.0e-5 && w < 1.0e-5) return u;
  const double ew = dsp_exp(w);
  const double den = ew - 1.0;
  if (den > -1.0e-12 && den < 1.0e-12) return u;
  const double arg = 1.0 + u * den;
  return arg > 0.0 ? dsp_ln(arg) / w : 0.0;
}

// Hyperbolic level for a position v in 0..1 (v = 0 -> start, v = 1 -> end).
static double hyper(double start, double v) {
  const double den = (start - kEng) * v + kEng;
  return den == 0.0 ? kEng : (start * kEng) / den;
}

}  // namespace

extern "C" int soemdsp_hyperbolic_decay_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.phase = 0.0;
      s.height = 0.0;
      s.level = 0.0;
      s.lastIn = 0.0;
      s.latchedAttack = 0.0;
      s.latchedAttackShape = 0.0;
      s.latchedDuration = 2.0;
      s.latchedShape = 0.0;
      s.latchedAmplitude = 1.0;
      s.stage = 0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_hyperbolic_decay_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_hyperbolic_decay_sample(
  int handle,
  double trigger,
  double duration,
  double shapeW,
  double amplitude,
  double mode,
  double attackTime,
  double attackShape,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];

  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const double in = safe(trigger);
  if (gate_hit(in, &s.lastIn)) {
    const double previous = s.stage != 0 ? s.level : 0.0;
    s.height = maxd(1.0e-6, gate_hit_velocity());
    s.latchedAttack = maxd(0.0, safe(attackTime));
    s.latchedAttackShape = safe(attackShape);
    s.latchedDuration = safe(duration);
    s.latchedShape = safe(shapeW);
    s.latchedAmplitude = safe(amplitude);
    const bool latchNow = safe(mode) >= 0.5;
    const double aT = maxd(0.0, latchNow ? s.latchedAttack : safe(attackTime));
    if (aT > 0.0) {
      // Rise from the current level (0.001 when idle): invert the attack curve to find the phase to start at.
      const double e = kEng;
      const double st = s.height;
      double c = previous < e ? e : previous;
      if (c > st) c = st;
      const double v = (st - e) > 1.0e-12 ? ((st * e / c) - e) / (st - e) : 1.0;
      s.stage = 1;
      s.phase = 1.0 - exp_unwarp01(v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v), latchNow ? s.latchedAttackShape : safe(attackShape));
    } else {
      s.stage = 2;
      s.phase = 0.0;
    }
  }
  if (s.stage == 0) return 0.0;

  const bool latch = safe(mode) >= 0.5;
  const double amp = latch ? s.latchedAmplitude : safe(amplitude);
  double env = 0.0;
  if (s.stage == 1) {
    const double aT = maxd(1.0e-6, latch ? s.latchedAttack : maxd(0.0, safe(attackTime)));
    const double w = latch ? s.latchedAttackShape : safe(attackShape);
    env = hyper(s.height, exp_warp01(1.0 - s.phase, w));
    s.phase += 1.0 / (aT * sr);
    if (s.phase >= 1.0) {
      s.stage = 2;
      s.phase = 0.0;
    }
  } else {
    const double dur = maxd(1.0e-6, latch ? s.latchedDuration : safe(duration));
    const double w = latch ? s.latchedShape : safe(shapeW);
    if (s.phase >= 1.0) {
      s.stage = 0;
      s.level = 0.0;
      return 0.0;
    }
    env = hyper(s.height, exp_warp01(s.phase, w));
    s.phase += 1.0 / (dur * sr);
  }
  s.level = env;
  const double out = env * amp;
  return (out * 0.0 == 0.0) ? out : 0.0;
}

extern "C" int soemdsp_hyperbolic_decay_is_idle(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 1;
  const State& s = gPool[handle - 1];
  return (!s.active || s.stage == 0) ? 1 : 0;
}

// Position for the face's phase dot: 0..1 across the attack, 1..2 across the decay, -1 when idle.
extern "C" double soemdsp_hyperbolic_decay_position(int handle) {
  if (handle < 1 || handle > kMaxInstances) return -1.0;
  const State& s = gPool[handle - 1];
  if (!s.active || s.stage == 0) return -1.0;
  const double p = s.phase < 0.0 ? 0.0 : (s.phase > 1.0 ? 1.0 : s.phase);
  return s.stage == 1 ? p : 1.0 + p;
}

extern "C" int soemdsp_hyperbolic_decay_version() { return 4; }
extern "C" const char* soemdsp_hyperbolic_decay_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_hyperbolic_decay_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
