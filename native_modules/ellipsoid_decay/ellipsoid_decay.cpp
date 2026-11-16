// soemdsp-native-module: ellipsoid_decay
// soemdsp-native-label: Ellipsoid AD
// soemdsp-native-target: ellipsoidDecay
// soemdsp-native-kind: envelope
//
// soundemote.dev Decay Envelopes #ellipsoiddecay (RoundShape sine->square), with an optional attack.
// Decay is the rising quarter of the RoundShape wave (phase 0.5 -> 0.75): progress runs 0 -> 1.
//   x = 0..1 across the stage, a = pi x / 2
//   circle(x)    = sin a                                           (the sine's rising quarter: fast, then flat)
//   square(x, k) = sin a / sqrt(sin^2 a + (k cos a)^2)             (k = 0 square, k = 1 circle)
// Morph is bipolar, -1..+1, like contour in the Step Graph, and passes through a straight ramp:
//   0 = straight ramp; 0 .. +0.5 blends the ramp into the circle; +0.5 .. +1 morphs circle -> square
//   (+1 jumps at once); -x is the point-reflected curve 1 - shape(1 - x, x): the slow orientation, so
//   -0.5 is the slow circle and -1 the slow square (stays put, then jumps at the end).
//   decay:  env = start + (0.001 - start) shape(x, decay morph)
//   attack: the decay run backwards, env = start + (0.001 - start) shape(1 - x, attack morph)
//           so a positive morph is fast down / slow up, a negative one slow down / fast up.
//   Out = env * Amplitude. Attack 0 = no attack stage.
// Morphs: Morph moves both sides; Attack / Decay Morph (-1..+1) trim each side by a percentage of the
// remaining room toward +1 or -1, like Skew % in the Step Graph: 0 leaves Morph alone, +1 always reaches
// +1 and -1 always reaches -1, whatever Morph is (the whole swing is always available).
//
// Speed is a rate: each stage keeps a phase 0..1 advanced by 1 / (time * sr) per sample, so changing a time
// while the envelope runs makes it finish faster or slower from where it is (no sliding). A hit during a tail
// rises from the current level.

#include <soemdsp/soemdsp.hpp>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 128;
static const double kEng = 0.001;
static const double kHalfPi = 1.5707963267948966;

struct State {
  double phase;
  double height;
  double level;
  double lastIn;
  double latchedAttack;
  double latchedAttackMorph;  // effective (clamped) morphs
  double latchedDuration;
  double latchedDecayMorph;
  double latchedAmplitude;
  int stage;                  // 0 idle, 1 attack, 2 decay
  bool active;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"ellipsoid_decay\","
    "\"label\":\"Ellipsoid AD\","
    "\"targetType\":\"ellipsoidDecay\","
    "\"kind\":\"envelope\""
  "}";

static double unit01(double v) { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }
static double bi11(double v) { return v < -1.0 ? -1.0 : (v > 1.0 ? 1.0 : v); }

// Sine->square rising quarter at x for stretch k (0 = square, 1 = circle).
static double ellipse_progress(double x, double k) {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;
  double sa = 0.0, ca = 0.0;
  dsp_sin_cos_turns(x * 0.25, &sa, &ca);  // sin / cos of (pi x / 2): x * 0.25 turns
  const double den = sa * sa + (ca * k) * (ca * k);
  if (den <= 1.0e-24) return sa > 0.0 ? 1.0 : 0.0;
  const double p = sa / __builtin_sqrt(den);
  return (p * 0.0 == 0.0) ? p : 0.0;
}

// Shape for m >= 0: 0 = straight ramp, 0.5 = circle, 1 = square.
static double shape_pos(double x, double m) {
  if (x <= 0.0) return 0.0;
  if (x >= 1.0) return 1.0;
  if (m <= 0.5) {
    const double t = 2.0 * m;
    return (1.0 - t) * x + t * ellipse_progress(x, 1.0);
  }
  return ellipse_progress(x, 1.0 - (2.0 * m - 1.0));
}

// The bipolar shape: negative morph is the point-reflected curve (the slow orientation).
static double progress(double x, double m) {
  const double mm = bi11(m);
  if (mm >= 0.0) return shape_pos(x, mm);
  return 1.0 - shape_pos(1.0 - x, -mm);
}

// x whose shape_pos is p (shape_pos is increasing in x).
static double unshape_pos(double p, double m) {
  if (p <= 0.0) return 0.0;
  if (p >= 1.0 - 1.0e-12) return 1.0;
  if (m > 0.5) {
    const double k = 1.0 - (2.0 * m - 1.0);
    if (k <= 1.0e-12) return 0.0;
    // sin a / sqrt(sin^2 a + (k cos a)^2) = p  =>  tan a = p k / sqrt(1 - p^2)
    const double t = p * k / __builtin_sqrt(1.0 - p * p);
    const double s = t / __builtin_sqrt(1.0 + t * t);  // = sin(atan t)
    double a = s;
    for (int i = 0; i < 6; i++) {
      double sa = 0.0, ca = 0.0;
      dsp_sin_cos_turns(a / (2.0 * 3.141592653589793), &sa, &ca);
      if (ca < 1.0e-9) break;
      a -= (sa - s) / ca;
    }
    const double x = a / kHalfPi;
    return x < 0.0 ? 0.0 : (x > 1.0 ? 1.0 : x);
  }
  // ramp -> circle blend: monotone, so bisect.
  double lo = 0.0, hi = 1.0;
  for (int i = 0; i < 40; i++) {
    const double mid = 0.5 * (lo + hi);
    if (shape_pos(mid, m) < p) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

static double unprogress(double p, double m) {
  const double mm = bi11(m);
  if (mm >= 0.0) return unshape_pos(p, mm);
  return 1.0 - unshape_pos(1.0 - p, -mm);
}

static double level_at(double start, double prog) { return start + (kEng - start) * prog; }

// Morph trimmed by `trim` (-1..+1) as a fraction of the remaining room toward +1 (+) or -1 (-): the Step Graph's
// Skew % rule, so the trim always has the whole swing available.
static double room_morph(double morph, double trim) {
  const double m = bi11(morph);
  const double t = bi11(trim);
  return bi11(t >= 0.0 ? m + t * (1.0 - m) : m + t * (m + 1.0));
}

}  // namespace

extern "C" int soemdsp_ellipsoid_decay_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.phase = 0.0;
      s.height = 0.0;
      s.level = 0.0;
      s.lastIn = 0.0;
      s.latchedAttack = 0.0;
      s.latchedAttackMorph = 0.0;
      s.latchedDuration = 2.0;
      s.latchedDecayMorph = 0.0;
      s.latchedAmplitude = 1.0;
      s.stage = 0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_ellipsoid_decay_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_ellipsoid_decay_sample(
  int handle,
  double trigger,
  double duration,
  double morph,
  double amplitude,
  double mode,
  double attackTime,
  double attackMorph,
  double decayMorph,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances || !gPool[handle - 1].active) return 0.0;
  State& s = gPool[handle - 1];

  const double sr = sampleRate < 1.0 ? 44100.0 : sampleRate;
  const bool latch = safe(mode) >= 0.5;
  const double liveAttackMorph = room_morph(safe(morph), safe(attackMorph));
  const double liveDecayMorph = room_morph(safe(morph), safe(decayMorph));
  const double in = safe(trigger);
  if (gate_hit(in, &s.lastIn)) {
    const double previous = s.stage != 0 ? s.level : 0.0;
    s.height = maxd(1.0e-6, gate_hit_velocity());
    s.latchedAttack = maxd(0.0, safe(attackTime));
    s.latchedAttackMorph = liveAttackMorph;
    s.latchedDuration = safe(duration);
    s.latchedDecayMorph = liveDecayMorph;
    s.latchedAmplitude = safe(amplitude);
    const double aT = latch ? s.latchedAttack : maxd(0.0, safe(attackTime));
    if (aT > 0.0) {
      // Rise from the current level (0.001 when idle): invert the curve to find the phase to start at.
      const double st = s.height;
      double c = previous < kEng ? kEng : previous;
      if (c > st) c = st;
      const double p = (kEng - st) != 0.0 ? unit01((c - st) / (kEng - st)) : 1.0;
      s.stage = 1;
      s.phase = 1.0 - unprogress(p, latch ? s.latchedAttackMorph : liveAttackMorph);
    } else {
      s.stage = 2;
      s.phase = 0.0;
    }
  }
  if (s.stage == 0) return 0.0;

  const double amp = latch ? s.latchedAmplitude : safe(amplitude);
  double env = 0.0;
  if (s.stage == 1) {
    const double aT = maxd(1.0e-6, latch ? s.latchedAttack : maxd(0.0, safe(attackTime)));
    const double m = latch ? s.latchedAttackMorph : liveAttackMorph;
    env = level_at(s.height, progress(1.0 - s.phase, m));
    s.phase += 1.0 / (aT * sr);
    if (s.phase >= 1.0) {
      s.stage = 2;
      s.phase = 0.0;
    }
  } else {
    const double dur = maxd(1.0e-6, latch ? s.latchedDuration : safe(duration));
    const double m = latch ? s.latchedDecayMorph : liveDecayMorph;
    if (s.phase >= 1.0) {
      s.stage = 0;
      s.level = 0.0;
      return 0.0;
    }
    env = level_at(s.height, progress(s.phase, m));
    s.phase += 1.0 / (dur * sr);
  }
  s.level = env;
  const double out = env * amp;
  return (out * 0.0 == 0.0) ? out : 0.0;
}

extern "C" int soemdsp_ellipsoid_decay_is_idle(int handle) {
  if (handle < 1 || handle > kMaxInstances) return 1;
  const State& s = gPool[handle - 1];
  return (!s.active || s.stage == 0) ? 1 : 0;
}

// Position for the face's phase dot: 0..1 across the attack, 1..2 across the decay, -1 when idle.
extern "C" double soemdsp_ellipsoid_decay_position(int handle) {
  if (handle < 1 || handle > kMaxInstances) return -1.0;
  const State& s = gPool[handle - 1];
  if (!s.active || s.stage == 0) return -1.0;
  const double p = s.phase < 0.0 ? 0.0 : (s.phase > 1.0 ? 1.0 : s.phase);
  return s.stage == 1 ? p : 1.0 + p;
}

extern "C" int soemdsp_ellipsoid_decay_version() { return 2; }
extern "C" const char* soemdsp_ellipsoid_decay_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_ellipsoid_decay_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
