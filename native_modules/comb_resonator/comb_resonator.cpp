// soemdsp-native-module: comb_resonator
// soemdsp-native-label: Comb Resonator
// soemdsp-native-target: combResonator
// soemdsp-native-kind: filter
//
// Feedback/feedforward comb with Thiran fractional delay. Strict effect
// (docs/COMB_PLUCK_PLAN.md): audio in only, no Trigger (Comb Pluck is the
// triggered generator). The loop math is shared with Comb Pluck in
// soemdsp/filter/comb_core.h.
// No clip (Argi 2026-11-17: "don't let it inf but let it explode, the output
// will mute if bad things happen"): the loop and the output are unbounded;
// a NaN / Inf loop resets the comb to silence (comb_nonfinite_reset).
// Low Cut = input highpass. + polarity Feedback runs the DC trap
// (comb_dc_mean / comb_write_dc): DC cannot build up, harmonics untouched.

#include <soemdsp/soemdsp.hpp>
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/filter/comb_core.h>

namespace {

using namespace soemdsp_maths;
using soemdsp::comb::CombCore;

static const int kMaxInstances = 384;  // 3 per graph node (Mono / Left / Right lanes)
static const double kMinHz = 10.0;
static const double kMaxSeconds = 0.12;
// 0.12s @ 192 kHz + headroom
static const int kMaxCapacity = 23048;

struct State {
  bool active;
  void* poolBlock; // one shared-pool block with all the buffers of this instance
  CombCore comb;   // buffer lives in the pool block
};

static State gPool[kMaxInstances];

// Limits mirror the module definition (the only source of truth for limits).
static const char kMetadataJson[] =
  "{"
    "\"module\":\"comb_resonator\","
    "\"label\":\"Comb Resonator\","
    "\"targetType\":\"combResonator\","
    "\"kind\":\"filter\","
    "\"inputs\":[\"In\",\"Left\",\"Right\",\"f\"],"
    "\"outputs\":[\"Mono\",\"Left\",\"Right\"],"
    "\"parameters\":["
      "{\"key\":\"frequency\",\"label\":\"Frequency\",\"kind\":\"frequency\",\"defaultValue\":110,"
        "\"min\":10,\"mid\":110,\"max\":20000,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"decay\",\"label\":\"Decay\",\"defaultValue\":1,\"min\":0.001,\"mid\":1,\"max\":60,"
        "\"step\":\"any\",\"unit\":\"s\"},"
      "{\"key\":\"hold\",\"label\":\"Hold\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"damping\",\"label\":\"Damping\",\"defaultValue\":0,\"min\":0,\"mid\":0.35,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"lowCut\",\"label\":\"Low Cut\",\"kind\":\"frequency\",\"defaultValue\":1,\"min\":1,\"mid\":100,\"max\":5000,\"step\":\"any\",\"unit\":\"Hz\"},"
      "{\"key\":\"topology\",\"label\":\"Topology\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"invert\",\"label\":\"Polarity\",\"defaultValue\":0,\"min\":0,\"mid\":0,\"max\":1,\"step\":1},"
      "{\"key\":\"depth\",\"label\":\"Depth\",\"defaultValue\":1,\"min\":0,\"mid\":0.5,\"max\":1,\"step\":\"any\"},"
      "{\"key\":\"amplitude\",\"label\":\"Amplitude\",\"defaultValue\":1,\"min\":0,\"mid\":1,\"max\":1,\"step\":\"any\"}"
    "]"
  "}";

}  // namespace

extern "C" int soemdsp_comb_resonator_create() {
  for (int i = 0; i < kMaxInstances; i++) {
    if (!gPool[i].active) {
      State& s = gPool[i];
      unsigned long bytes = sizeof(float) * (unsigned long)(kMaxCapacity);
      void* blk = soemdsp::memory_pool::alloc(bytes);
      if (!blk) return 0; // out of memory budget: the engine reports it
      s.poolBlock = blk;
      s.comb.buffer = (float*)blk;
      s.comb.capacity = 0;
      soemdsp::comb::comb_reset_state(&s.comb);
      s.active = true;
      return i + 1;
    }
  }
  return 0;
}

extern "C" void soemdsp_comb_resonator_destroy(int handle) {
  if (handle < 1 || handle > kMaxInstances) return;
  if (gPool[handle - 1].active) {
    soemdsp::memory_pool::release(gPool[handle - 1].poolBlock);
    gPool[handle - 1].poolBlock = nullptr;
    gPool[handle - 1].comb.buffer = nullptr;
  }
  gPool[handle - 1].active = false;
}

extern "C" double soemdsp_comb_resonator_sample(
  int handle,
  double input,
  double frequencyHz,
  double decaySec,
  int hold,
  double damping,
  double lowCut,
  int topology,
  int invert,
  double depth,
  double amplitude,
  double sampleRate
) {
  if (handle < 1 || handle > kMaxInstances) return 0.0;
  State& s = gPool[handle - 1];
  if (!s.active) return 0.0;
  soemdsp::comb::comb_ensure_buffer(&s.comb, sampleRate, kMaxSeconds, kMaxCapacity);
  const double rate = maxd(1.0, sampleRate);
  const double delaySamples = soemdsp::comb::comb_delay_samples(&s.comb, frequencyHz, rate, kMinHz);

  const double amp = safe(amplitude);
  // Low Cut: input highpass (outside the loop: shapes the excitation only).
  const double x = soemdsp::comb::comb_highpass(&s.comb, safe(input), soemdsp::comb::comb_hp_coef(lowCut, rate))
    * ((amp * 0.0 == 0.0) ? amp : 1.0);
  const double sign = invert ? -1.0 : 1.0;
  const int isFf = topology != 0;

  double y;
  if (isFf) {
    const double delayed = soemdsp::comb::comb_read_frac(&s.comb, delaySamples);
    const double amt = clamp(depth, 0.0, 1.0);
    y = x + sign * amt * delayed;
  } else {
    const double delayed = soemdsp::comb::comb_read_frac(&s.comb, delaySamples);
    const double fb = soemdsp::comb::comb_loop_filter(&s.comb, delayed, damping);
    const double g = soemdsp::comb::comb_feedback_gain(decaySec, delaySamples, rate, hold);
    y = x + sign * g * fb;
    // DC trap (+ only: with − the loop already cancels DC every pass).
    if (!invert) y -= soemdsp::comb::comb_dc_mean(&s.comb, delaySamples);
  }

  if (y > -1e-30 && y < 1e-30) y = 0.0;

  // Feedback writes the output (unclipped) back into the loop.
  // Feedforward writes the input history.
  const double w = isFf ? x : y;
  if (soemdsp::comb::comb_nonfinite_reset(&s.comb, y, w)) return 0.0;
  if (!isFf && !invert) soemdsp::comb::comb_write_dc(&s.comb, (float)w);
  else soemdsp::comb::comb_write(&s.comb, (float)w);

  return y;
}

extern "C" int soemdsp_comb_resonator_version() { return 3; }
extern "C" const char* soemdsp_comb_resonator_metadata_json() { return kMetadataJson; }
extern "C" int soemdsp_comb_resonator_metadata_json_size() { return sizeof(kMetadataJson) - 1; }
