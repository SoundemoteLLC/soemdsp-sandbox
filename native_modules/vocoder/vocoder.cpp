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
  soemdsp_vocoder::FilterBankCore bank[2];
  soemdsp_vocoder::Resampler2xT<4> resampler;
  double dry[2][kLatency], right;
  double fade;
  int position, desiredCount, counts[2], current, warm;
  bool switching, started;
  void reset() {
    for (auto& core : bank) core.reset();
    resampler.reset();
    for (auto& channel : dry) for (auto& sample : channel) sample = 0;
    position = 0; right = 0;
    current = warm = 0; fade = 0; switching = started = false;
    counts[0] = counts[1] = desiredCount;
  }
  double wet(double voiceL, double voiceR, double synthL, double synthR,
    double rate, double width, double response, double shift) {
    if (!started) { counts[current] = desiredCount; started = true; }
    const int next = 1 - current;
    if (!switching && counts[current] != desiredCount) {
      bank[next].reset(); counts[next] = desiredCount;
      warm = (int)__builtin_ceil(0.02 * rate); fade = 0; switching = true;
    }
    bank[current].configure(rate, width, shift, response, counts[current]);
    if (switching) bank[next].configure(rate, width, shift, response, counts[next]);
    const double source[4] = {voiceL, voiceR, synthL, synthR};
    double high[2][4], result[2]{};
    resampler.upsample(source, high);
    const double weight = fade * fade * (3 - 2 * fade);
    for (int phase = 0; phase < 2; ++phase) {
      double left = bank[current].tick(high[phase][0], high[phase][1], high[phase][2], high[phase][3]);
      double r = bank[current].right;
      if (switching) {
        const double newLeft = bank[next].tick(high[phase][0], high[phase][1], high[phase][2], high[phase][3]);
        left += weight * (newLeft - left); r += weight * (bank[next].right - r);
      }
      resampler.downsample(phase, left, r, result);
    }
    if (switching) {
      if (warm > 0) --warm;
      else {
        fade += 1 / (0.02 * rate);
        if (fade >= 1) { current = next; switching = false; fade = 0; }
      }
    }
    right = result[1]; return result[0];
  }
};
State* states[kInstances]{};
State* state(int h) { return h > 0 && h <= kInstances ? states[h - 1] : nullptr; }
const char metadata[] = R"json({
  "module":"vocoder", "targetType":"vocoder", "label":"Vocoder", "kind":"effect",
  "inputs":["Voice L","Voice R","Synth L","Synth R"], "outputs":["Mono","Left","Right"],
  "parameters":[
    {"key":"bands","label":"Bands","defaultValue":"32","min":"5","mid":"32","max":"100","step":"1","linearSmoothing":false,"tooltip":"Number of logarithmic IIR bands from 40 Hz to 90% of Nyquist. Changes warm a new layout for 20 ms, then crossfade for 20 ms. Rapid edits queue the latest count. More bands use more CPU and can change level; no automatic gain compensation. Native capacity is 100."},
    {"key":"bandWidth","label":"Band Width","defaultValue":"0.75","min":"0.001","mid":"0.1","max":"4","step":"any","unit":"oct","nonlinearSlider":true,"tooltip":"Nominal octave width of each logarithmic IIR band. Very narrow bands ring; wider bands overlap. High-frequency widths warp near Nyquist. No automatic level compensation."},
    {"key":"followerMs","label":"Follower","defaultValue":"0.25","min":"0","mid":"1","max":"20","step":"any","unit":"ms","nonlinearSlider":true,"tooltip":"Rectified envelope time constant in milliseconds, shared attack/release. Zero retains instantaneous waveform ripple and crunchy audio-rate modulation. Longer times smooth the envelope."},
    {"key":"formantShift","label":"Formant Shift","defaultValue":"0","min":"-24","mid":"0","max":"24","step":"any","unit":"st","tooltip":"Moves the synth filter centers relative to the analysis bands without changing synth pitch. Bands approaching the output Nyquist limit fade out rather than wrap."},
    {"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","tooltip":"Dry voice to vocoded synth. Both paths include the 128-sample resampling reference delay; IIR phase and ringing remain frequency dependent."}
  ]
})json";
}
extern "C" int soemdsp_vocoder_create() {
  for (int i = 0; i < kInstances; ++i) if (!states[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    s->desiredCount = 32; s->reset(); states[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_vocoder_destroy(int h) {
  if (auto* s = state(h)) { soemdsp::memory_pool::release(s); states[h - 1] = nullptr; }
}
extern "C" void soemdsp_vocoder_reset(int h) { if (auto* s = state(h)) s->reset(); }
extern "C" void soemdsp_vocoder_set_bands(int h, int count) {
  if (auto* s = state(h)) s->desiredCount = count < 5 ? 5 : count > 100 ? 100 : count;
}
extern "C" int soemdsp_vocoder_bands(int h) {
  auto* s = state(h); return s ? s->counts[s->current] : 0;
}
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
  const double wetL = s->wet(modL, modR, carL, carR, rate, width, followerSeconds, shift);
  const double left = dryL + mix * (wetL - dryL);
  s->right = dryR + mix * (s->right - dryR);
  if (!__builtin_isfinite(left) || !__builtin_isfinite(s->right)) { s->reset(); return 0; }
  return left;
}
extern "C" double soemdsp_vocoder_right(int h) { auto* s = state(h); return s ? s->right : 0; }
// Display tap (read-only): the band envelopes that drive the synth filters.
// layout 0 = sounding bank, 1 = incoming bank while a Bands change warms and
// crossfades (count 0 otherwise). Level is pi/2 x the rectified envelope, the
// same calibration the audio uses, so a unit sine in one band reads 1 (0 dBFS).
// Hz is the synthesis centre (Formant Shift applied), where that energy sounds.
static const soemdsp_vocoder::FilterBankCore* display_bank(State* s, int layout) {
  if (!s) return nullptr;
  if (layout == 0) return &s->bank[s->current];
  return s->switching ? &s->bank[1 - s->current] : nullptr;
}
extern "C" int soemdsp_vocoder_display_count(int h, int layout) {
  const auto* b = display_bank(state(h), layout);
  return b && b->lastRate > 0 ? b->count : 0;
}
extern "C" double soemdsp_vocoder_display_hz(int h, int layout, int band) {
  const auto* b = display_bank(state(h), layout);
  if (!b || b->lastRate <= 0 || band < 0 || band >= b->count || b->count < 2) return 0;
  using namespace soemdsp_maths;
  const double low = 40, high = b->lastRate * 0.45;
  const double hz = low * dsp_exp(dsp_ln(high / low) * band / (b->count - 1));
  return hz * dsp_exp(b->lastShift * (0.6931471805599453 / 12));
}
extern "C" double soemdsp_vocoder_display_level(int h, int layout, int band) {
  const auto* b = display_bank(state(h), layout);
  if (!b || band < 0 || band >= b->count) return 0;
  const auto& e = b->bands[band].envelope;
  return (e[0] > e[1] ? e[0] : e[1]) * (soemdsp_maths::kPi * 0.5);
}
// Crossfade weight of the incoming bank: 0 while warming, then the same
// smoothstep the audio uses.
extern "C" double soemdsp_vocoder_display_weight(int h) {
  auto* s = state(h);
  if (!s || !s->switching || s->warm > 0) return 0;
  return s->fade * s->fade * (3 - 2 * s->fade);
}
extern "C" int soemdsp_vocoder_latency() { return kLatency; }
extern "C" int soemdsp_vocoder_version() { return 2; }
extern "C" const char* soemdsp_vocoder_metadata_json() { return metadata; }
extern "C" int soemdsp_vocoder_metadata_json_size() { return sizeof(metadata) - 1; }
