// soemdsp-native-module: spectral_blur
// soemdsp-native-label: Spectral Blur
// soemdsp-native-target: spectralBlur
// soemdsp-native-kind: effect
#include "spectral_stft_engine.h"

namespace {
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({"module":"spectral_blur","targetType":"spectralBlur","label":"Spectral Blur","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window and processing delay in samples. At 48 kHz: 512 = 10.67 ms, 4096 = 85.33 ms, 8192 = 170.67 ms, 16384 = 341.33 ms. Smaller is tighter; larger resolves lower frequencies and costs more memory and peak CPU. Edits warm and crossfade, but intentionally change delay. Plugin-host compensation is not yet verified."},
{"key":"fuzz","label":"Fuzz","defaultValue":"50","min":"0","mid":"50","max":"200","unit":"\u00a2","step":"any","nonlinearSlider":true,"tooltip":"How far each voice detunes every partial, in cents at its peak, the same musical interval at every pitch. A smooth chorus, not noise. Zero is dry."},
{"key":"wander","label":"Wander","kind":"frequency","defaultValue":"0.5","min":"0","mid":"0.5","max":"20","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"How fast each partial's detune wanders, in Hz. A fraction of a Hz is a slow, lush chorus beat; a few Hz makes the detune itself shimmer; higher is fuzz and eventually metallic FM. Updates at the STFT hop rate."},
{"key":"voices","label":"Voices","defaultValue":"3","min":"2","mid":"3","max":"4","step":"1","linearSmoothing":false,"tooltip":"Detune voices: independent wandering detune streams of the one analysis, averaged. More voices is a denser, smoother fur. Four is the most the engine holds."},
{"key":"seed","label":"Seed","kind":"seed","defaultValue":"0","min":"0","mid":"0","max":"16777215","maxDigits":0,"step":"1","nonlinearSlider":false,"linearSmoothing":false,"smoothingType":"none","tooltip":"Detune seed. Same Seed = same output; new modules get their own."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to the selected FFT Size. Both paths have that many samples of delay."}]})json";
}

extern "C" int soemdsp_spectral_blur_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure(); fft4096.ensure(); fft8192.ensure();
    s->initialize();
    // Blur is the Cloud engine: 8x overlap, four voices, no smear, blur, diffusion, level wobble or Warble.
    s->desiredCloud = true; for (auto& core : s->cores) { core.cloud = true; core.cloudVoices = 3; core.swarmLevel = 0; core.cloudFuzz = 50; }
    s->reset();
    pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_blur_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_blur_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" int soemdsp_spectral_blur_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096 && length != 8192 && length != 16384)) return -1;
  s->desired = length; return 0;
}
extern "C" int soemdsp_spectral_blur_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
extern "C" double soemdsp_spectral_blur_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_blur_latency() { return 4096; }
extern "C" int soemdsp_spectral_blur_latency_for_handle(int h) { return soemdsp_spectral_blur_fft_size(h); }
extern "C" int soemdsp_spectral_blur_version() { return 1; }
extern "C" const char* soemdsp_spectral_blur_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_blur_metadata_json_size() { return sizeof(metadata) - 1; }

// Fuzz in cents, Wander in Hz, Voices, Seed (integer). Cheap to call every sample; a changed Seed reseeds both cores.
// Voices is rounded to a whole number; the per-voice arrays hold kMaxVoices, so more than that is held to the array size (a storage bound, not a
// musical range). Wander: a negative Hz would make the one-pole coefficient exceed 1 and blow up, so it is treated as 0.
extern "C" void soemdsp_spectral_blur_set_cloud(int h, double fuzzCents, double wanderHz, double voices, double seed) {
  if (auto* s = get(h)) {
    const unsigned int sd = __builtin_isfinite(seed) && seed > 0 ? (seed >= 4294967295.0 ? 4294967295u : (unsigned int)seed) : 0u;
    for (auto& core : s->cores) {
      core.cloudFuzz = __builtin_isfinite(fuzzCents) ? fuzzCents : 0;
      core.cloudWander = __builtin_isfinite(wanderHz) && wanderHz > 0 ? wanderHz : 0;
      const double v = __builtin_isfinite(voices) ? voices : 1;
      core.cloudVoices = v < 1 ? 1 : v > kMaxVoices ? kMaxVoices : (int)(v + 0.5);
      if (sd != core.swarmSeed) { core.swarmSeed = sd; core.seedSwarm(); core.seedCloud(); }
    }
  }
}
extern "C" double soemdsp_spectral_blur_sample(int h, double l, double r, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, 0, 0, 0, mix, rate) : 0;
}
