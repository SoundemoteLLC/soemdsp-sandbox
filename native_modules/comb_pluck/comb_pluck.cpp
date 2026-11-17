// soemdsp-native-module: comb_pluck
// soemdsp-native-label: Comb Pluck
// soemdsp-native-target: combPluck
// soemdsp-native-kind: generator
//
// Comb Pluck (docs/COMB_PLUCK_PLAN.md): the generator half of the old Comb
// Resonator. A strict rising-edge Trigger fires a built-in, zero-DC exciter
// burst (soemdsp/trigger/pluck_exciter.h: Bump / Triangle / Saw / Noise, Soft,
// Width x period, Stack / Choke, velocity = trigger height) into the same
// feedback comb loop as Comb Resonator (soemdsp/filter/comb_core.h: Thiran
// fractional delay, loop one-pole Damping, g = exp(-D / (Decay fs))).
// The burst is always shorter than one loop period (Width < 1), so the comb
// never echoes it back over itself (no flange). Mono out.
// Level: the ring's first pass is the burst itself (peak = velocity), so the
// ring peak stays level across Frequency x Decay; Level scales the output.
// The loop is linear (no clip in the loop; g < 1 always, no Hold).

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/filter/comb_core.h>
#include <soemdsp/trigger/pluck_exciter.h>

namespace {

using namespace soemdsp_maths;
using soemdsp::comb::CombCore;

static const int kMaxInstances = 128;  // one per graph node
static const double kMinHz = 10.0;
static const double kMaxSeconds = 0.12;
static const int kMaxCapacity = 23048;  // 0.12 s @ 192 kHz + headroom
static const double kLoopSafety = 8.0;  // NaN / runaway guard only (never reached in normal use)

struct State {
  bool active;
  void* poolBlock;
  CombCore comb;
  soemdsp::pluck::Exciter ex;
  double lastOut;
};

static State gPool[kMaxInstances];

static const char kMetadataJson[] =
  "{"
    "\"module\":\"comb_pluck\","
    "\"label\":\"Comb Pluck\","
    "\"targetType\":\"combPluck\","
    "\"kind\":\"generator\","
    "\"inputs\":[\"Trigger\",\"f\"],"
    "\"outputs\":[\"Mono\"],"
    "\"parameters\":["
      "{\"key\":\"frequency\",\"label\":\"Frequency\",\"kind\":\"frequency\",\"defaultValue\":110,"
        "\"min\":10,\"mid\":110,\"max\":20000,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"decay\",\"label\":\"Decay\",\"defaultValue\":1,\"min\":0.001,\"mid\":1,\"max\":60,"
        "\"step\":\"any\",\"unit\":\"s\"},"
      "{\"key\":\"damping\",\"label\":\"Damping\",\"defaultValue\":0.2,\"min\":0,\"mid\":0.35,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"invert\",\"label\":\"Polarity\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"shape\",\"label\":\"Shape\",\"defaultValue\":1,\"min\":0,\"mid\":0,\"max\":3,\"step\":1},"
      "{\"key\":\"soft\",\"label\":\"Soft\",\"defaultValue\":0.3,\"min\":0,\"mid\":0.88,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"width\",\"label\":\"Width\",\"defaultValue\":0.5,\"min\":0.05,\"mid\":0.5,\"max\":0.9,\"step\":\"any\"},"
      "{\"key\":\"retrigger\",\"label\":\"Retrigger\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"level\",\"label\":\"Level\",\"defaultValue\":1,\"min\":0,\"mid\":1,\"max\":1,\"step\":\"any\"}"
    "]"
  "}";

static State* get(int handle) {
  if (handle < 1 || handle > kMaxInstances) return nullptr;
  State& s = gPool[handle - 1];
  return s.active ? &s : nullptr;
}

}  // namespace

extern "C" int soemdsp_comb_pluck_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      unsigned long bytes = sizeof(float) * (unsigned long)(kMaxCapacity);
      void* blk = soemdsp::memory_pool::alloc(bytes);
      if (!blk) return 0;  // out of memory budget: the engine reports it
      s.poolBlock = blk;
      s.comb.buffer = (float*)blk;
      s.comb.capacity = 0;
      soemdsp::comb::comb_reset_state(&s.comb);
      soemdsp::pluck::exciter_reset(s.ex, 0x6a09e667u ^ (unsigned int)(i * 2654435761u));
      s.lastOut = 0.0;
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_comb_pluck_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  if (gPool[handle - 1].active) {
    soemdsp::memory_pool::release(gPool[handle - 1].poolBlock);
    gPool[handle - 1].poolBlock = nullptr;
    gPool[handle - 1].comb.buffer = nullptr;
  }
  gPool[handle - 1].active = false;
}

// One sample. trigger = raw Trigger signal (edge detection inside).
// shape 0 Bump / 1 Triangle / 2 Saw / 3 Noise; retrigger 0 Stack / 1 Choke.
extern "C" double soemdsp_comb_pluck_sample(
  int handle,
  double trigger,
  double frequencyHz,
  double decaySec,
  double damping,
  int invert,
  double shape,
  double soft,
  double width,
  double retrigger,
  double level,
  double sampleRate
) {
  State* sp = get(handle);
  if (!sp) return 0.0;
  State& s = *sp;
  soemdsp::comb::comb_ensure_buffer(&s.comb, sampleRate, kMaxSeconds, kMaxCapacity);
  const double rate = maxd(1.0, sampleRate);
  const double delaySamples = soemdsp::comb::comb_delay_samples(&s.comb, frequencyHz, rate, kMinHz);

  double fadeGain = 1.0;
  const double x = soemdsp::pluck::exciter_tick(
    s.ex, trigger, frequencyHz, shape, soft, width, retrigger, rate, &fadeGain);
  if (s.ex.clearNow) soemdsp::comb::comb_clear(&s.comb);

  const double sign = invert ? -1.0 : 1.0;
  const double delayed = soemdsp::comb::comb_read_frac(&s.comb, delaySamples);
  const double fb = soemdsp::comb::comb_loop_filter(&s.comb, delayed, damping);
  const double g = soemdsp::comb::comb_feedback_gain(decaySec, delaySamples, rate, 0);
  double y = clamp(safe(x + sign * g * fb), -kLoopSafety, kLoopSafety);
  if (y > -1e-30 && y < 1e-30) y = 0.0;
  soemdsp::comb::comb_write(&s.comb, (float)y);

  const double lv = safe(level);
  const double out = y * fadeGain * lv;
  soemdsp::pluck::exciter_observe(s.ex, out, rate);
  s.lastOut = out;
  return out;
}

// Face taps (read after _sample).
extern "C" double soemdsp_comb_pluck_elapsed(int handle) { State* s = get(handle); return s ? s->ex.elapsed : -1.0; }
extern "C" double soemdsp_comb_pluck_peak(int handle) { State* s = get(handle); return s ? s->ex.peak : 0.0; }
extern "C" double soemdsp_comb_pluck_velocity(int handle) { State* s = get(handle); return s ? s->ex.lastVel : 0.0; }
extern "C" double soemdsp_comb_pluck_hits(int handle) { State* s = get(handle); return s ? s->ex.hits : 0.0; }

extern "C" int soemdsp_comb_pluck_version() { return 1; }
extern "C" const char* soemdsp_comb_pluck_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_comb_pluck_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
