// soemdsp-native-module: vocoder
// soemdsp-native-label: Vocoder
// soemdsp-native-target: vocoder
// soemdsp-native-kind: effect
#include <soemdsp/utility/memory_pool.h>
#include "filter_bank_vocoder.h"

namespace {
constexpr int kInstances = 64;
constexpr int kLatency = soemdsp_vocoder::Resampler2x::filterLatency;
struct State {
  soemdsp_vocoder::FilterBankVocoder bank;
  double dry[2][kLatency], right;
  int position;
  void reset() {
    bank.reset();
    for (auto& channel : dry) for (auto& sample : channel) sample = 0;
    position = 0; right = 0;
  }
};
State* states[kInstances]{};
State* state(int h) { return h > 0 && h <= kInstances ? states[h - 1] : nullptr; }
const char metadata[] = R"json({
  "module":"vocoder", "targetType":"vocoder", "label":"Vocoder", "kind":"effect",
  "inputs":["Mod L","Mod R","Car L","Car R"], "outputs":["Mono","Left","Right"],
  "parameters":[
    {"key":"bandWidth","label":"Band Width","defaultValue":"0.75","min":"0.001","mid":"0.1","max":"4","step":"any","unit":"oct","nonlinearSlider":true,"tooltip":"Nominal octave width of 32 logarithmic IIR bands. Very narrow bands ring; wider bands overlap. High-frequency widths warp near Nyquist. No automatic level compensation."},
    {"key":"followerMs","label":"Follower","defaultValue":"0.25","min":"0","mid":"1","max":"20","step":"any","unit":"ms","nonlinearSlider":true,"tooltip":"Rectified envelope time constant in milliseconds, shared attack/release. Zero retains instantaneous waveform ripple and crunchy audio-rate modulation. Longer times smooth the envelope."},
    {"key":"formantShift","label":"Formant Shift","defaultValue":"0","min":"-24","mid":"0","max":"24","step":"any","unit":"st","tooltip":"Moves the carrier filter centers relative to the analysis bands without changing carrier pitch. Bands approaching the output Nyquist limit fade out rather than wrap."},
    {"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Dry modulator to vocoded carrier. Both paths include the 128-sample resampling reference delay; IIR phase and ringing remain frequency dependent."}
  ]
})json";
}
extern "C" int soemdsp_vocoder_create() {
  for (int i = 0; i < kInstances; ++i) if (!states[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    s->reset(); states[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_vocoder_destroy(int h) {
  if (auto* s = state(h)) { soemdsp::memory_pool::release(s); states[h - 1] = nullptr; }
}
extern "C" void soemdsp_vocoder_reset(int h) { if (auto* s = state(h)) s->reset(); }
extern "C" double soemdsp_vocoder_sample(int h, double modL, double modR,
  double carL, double carR, double width, double followerSeconds, double shift,
  double mix, double rate) {
  auto* s = state(h);
  if (!s) return 0;
  const double values[] = {modL, modR, carL, carR, width, followerSeconds, shift, mix, rate};
  for (double v : values) if (!__builtin_isfinite(v)) { s->reset(); return 0; }
  if (rate <= 100 || width <= 0 || followerSeconds < 0) { s->reset(); return 0; }
  const double dryL = s->dry[0][s->position], dryR = s->dry[1][s->position];
  s->dry[0][s->position] = modL; s->dry[1][s->position] = modR;
  s->position = (s->position + 1) % kLatency;
  const double wetL = s->bank.tick(modL, modR, carL, carR, rate, width, followerSeconds, shift);
  const double left = dryL + mix * (wetL - dryL);
  s->right = dryR + mix * (s->bank.right - dryR);
  if (!__builtin_isfinite(left) || !__builtin_isfinite(s->right)) { s->reset(); return 0; }
  return left;
}
extern "C" double soemdsp_vocoder_right(int h) { auto* s = state(h); return s ? s->right : 0; }
extern "C" int soemdsp_vocoder_latency() { return kLatency; }
extern "C" int soemdsp_vocoder_version() { return 1; }
extern "C" const char* soemdsp_vocoder_metadata_json() { return metadata; }
extern "C" int soemdsp_vocoder_metadata_json_size() { return sizeof(metadata) - 1; }
