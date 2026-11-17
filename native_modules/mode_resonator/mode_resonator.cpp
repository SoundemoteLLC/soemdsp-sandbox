// soemdsp-native-module: mode_resonator
// soemdsp-native-label: Mode Resonator
// soemdsp-native-target: modeResonator
// soemdsp-native-kind: generator
//
// Complex 2-pole ring: y[n] = 2 r cos(w) y[n-1] - r^2 y[n-2] + g x[n]
// Strictly triggered generator (docs/COMB_PLUCK_PLAN.md section 2b): no audio
// input. A rising-edge Trigger fires the shared pluck exciter
// (soemdsp/trigger/pluck_exciter.h: Bump / Triangle / Saw / Noise, Soft,
// Width x period, Stack / Choke, velocity = trigger height) into the poles.
// Impulse-normalized: the burst is scaled by 1 / |E(f)| (its spectrum at the
// ring frequency, measured at the edge), and g = sin(w) * Amplitude, so the
// ring envelope starts near velocity * Amplitude at any Frequency, Decay,
// Shape or Width.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/trigger/pluck_exciter.h>

namespace {

using namespace soemdsp_maths;

static const int kMaxInstances = 128;
// Impulse-normalization ceiling: a burst with almost no energy at f (e.g. a
// very narrow Bump on a low ring) is boosted at most this much.
static const double kMaxNormGain = 64.0;

struct State {
  bool active;
  double y1, y2;
  double lastF, lastDecay, lastRate, lastAmp;
  int lastHold;
  double a1, a2, g;
  soemdsp::pluck::Exciter ex;
  double norm;  // 1 / |E(f)| latched at the burst start
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"mode_resonator\","
    "\"label\":\"Mode Resonator\","
    "\"targetType\":\"modeResonator\","
    "\"kind\":\"generator\","
    "\"inputs\":[\"Trigger\",\"f\"],"
    "\"outputs\":[\"Out\"],"
    "\"parameters\":["
      "{\"key\":\"frequency\",\"label\":\"Resonant Freq\",\"kind\":\"frequency\",\"defaultValue\":440,"
        "\"min\":0,\"mid\":440,\"max\":20000,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"decay\",\"label\":\"Decay\",\"defaultValue\":1,\"min\":0.001,\"mid\":1,\"max\":60,"
        "\"step\":\"any\",\"unit\":\"s\"},"
      "{\"key\":\"hold\",\"label\":\"Hold\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"shape\",\"label\":\"Shape\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":3,\"step\":1},"
      "{\"key\":\"soft\",\"label\":\"Soft\",\"defaultValue\":0.5,\"min\":0,\"mid\":0.88,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"width\",\"label\":\"Width\",\"defaultValue\":0.5,\"min\":0.05,\"mid\":0.5,\"max\":0.9,\"step\":\"any\"},"
      "{\"key\":\"retrigger\",\"label\":\"Retrigger\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"amplitude\",\"label\":\"Amplitude\",\"defaultValue\":1,\"min\":0,\"mid\":1,\"max\":1,"
        "\"step\":\"any\"}"
    "]"
  "}";

static void ensure(State* s, double frequencyHz, double decaySec, int hold, double amplitude, double sampleRate) {
  const double rate = maxd(1.0, sampleRate);
  const double f = clamp(safe(frequencyHz), 0.0, rate * 0.499);
  const double decay = maxd(0.0, safe(decaySec));
  const int isHold = hold ? 1 : 0;
  const double level = safe(amplitude);
  const double amp = (level * 0.0 == 0.0) ? level : 1.0;

  if (s->lastF == f && s->lastDecay == decay && s->lastHold == isHold
      && s->lastRate == rate && s->lastAmp == amp) {
    return;
  }
  s->lastF = f;
  s->lastDecay = decay;
  s->lastHold = isHold;
  s->lastRate = rate;
  s->lastAmp = amp;

  double omega = (2.0 * kPi * f) / rate;
  if (omega < 1e-12) omega = 1e-12;
  if (omega > kPi - 1e-12) omega = kPi - 1e-12;

  double r;
  if (isHold) {
    r = 1.0;
  } else {
    const double tau = maxd(1e-6, decay);
    r = dsp_exp(-1.0 / (tau * rate));
    if (!(r >= 0.0) || r * 0.0 != 0.0) r = 0.0;
    if (r > 1.0) r = 1.0;
    if (r > 1.0 - 1e-12) r = 1.0 - 1e-12;
  }

  const double cosw = dsp_cos(omega);
  const double sinw = dsp_sin(omega);
  s->a1 = 2.0 * r * cosw;
  s->a2 = -(r * r);
  double sinAbs = dsp_fabs(sinw);
  if (sinAbs < 1e-6) sinAbs = 1e-6;
  s->g = sinAbs * amp;
}

static State* get(int handle) {
  if (handle < 1 || handle > kMaxInstances) return nullptr;
  State& s = gPool[handle - 1];
  return s.active ? &s : nullptr;
}

}  // namespace

extern "C" int soemdsp_mode_resonator_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      s.y1 = s.y2 = 0.0;
      s.lastF = -1.0;
      s.lastDecay = -1.0;
      s.lastRate = -1.0;
      s.lastAmp = -1.0;
      s.lastHold = -1;
      s.a1 = s.a2 = s.g = 0.0;
      soemdsp::pluck::exciter_reset(s.ex, 0xbb67ae85u ^ (unsigned int)(i * 2654435761u));
      s.norm = 1.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_mode_resonator_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  gPool[handle - 1].active = false;
}

// One sample. trigger = raw Trigger signal (edge detection inside).
// shape 0 Bump / 1 Triangle / 2 Saw / 3 Noise; retrigger 0 Stack / 1 Choke.
extern "C" double soemdsp_mode_resonator_sample(
  int handle,
  double trigger,
  double frequencyHz,
  double decaySec,
  int hold,
  double amplitude,
  double shape,
  double soft,
  double width,
  double retrigger,
  double sampleRate
) {
  State* sp = get(handle);
  if (!sp) return 0.0;
  State& s = *sp;
  ensure(&s, frequencyHz, decaySec, hold, amplitude, sampleRate);
  const double rate = maxd(1.0, sampleRate);
  const double hitsBefore = s.ex.hits;
  double fadeGain = 1.0;
  const double e = soemdsp::pluck::exciter_tick(
    s.ex, trigger, frequencyHz, shape, soft, width, retrigger, rate, &fadeGain);
  if (s.ex.hits != hitsBefore) {
    const double m = s.ex.specMag;
    double n = m > 1e-12 ? 1.0 / m : kMaxNormGain;
    if (n > kMaxNormGain) n = kMaxNormGain;
    s.norm = n;
  }
  if (s.ex.clearNow) s.y1 = s.y2 = 0.0;
  const double x = e * s.norm;
  double y = s.g * x + s.a1 * s.y1 + s.a2 * s.y2;
  y = clamp11(safe(y));
  if (y > -1e-30 && y < 1e-30) y = 0.0;
  s.y2 = s.y1;
  s.y1 = y;
  const double out = y * fadeGain;
  soemdsp::pluck::exciter_observe(s.ex, out, rate);
  return out;
}

// Face taps (read after _sample).
extern "C" double soemdsp_mode_resonator_elapsed(int handle) { State* s = get(handle); return s ? s->ex.elapsed : -1.0; }
extern "C" double soemdsp_mode_resonator_peak(int handle) { State* s = get(handle); return s ? s->ex.peak : 0.0; }
extern "C" double soemdsp_mode_resonator_velocity(int handle) { State* s = get(handle); return s ? s->ex.lastVel : 0.0; }
extern "C" double soemdsp_mode_resonator_hits(int handle) { State* s = get(handle); return s ? s->ex.hits : 0.0; }

extern "C" int soemdsp_mode_resonator_version() { return 2; }
extern "C" const char* soemdsp_mode_resonator_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_mode_resonator_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
