// soemdsp-native-module: spectral_warble
// soemdsp-native-label: Spectral Warble
// soemdsp-native-target: spectralWarble
// soemdsp-native-kind: effect
#include "../spectral_blur/spectral_stft_engine.h"

namespace {
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({"module":"spectral_warble","targetType":"spectralWarble","label":"Spectral Warble","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window and processing delay in samples. At 48 kHz: 512 = 10.67 ms, 4096 = 85.33 ms, 8192 = 170.67 ms, 16384 = 341.33 ms. Smaller is tighter; larger resolves lower frequencies and costs more memory and peak CPU. Edits warm and crossfade, but intentionally change delay. Plugin-host compensation is not yet verified."},
{"key":"swarm","label":"Swarm","defaultValue":"0","min":"0","mid":"45","max":"180","unit":"\u00b0","step":"any","tooltip":"Peak phase wobble of each partial, in degrees, a fuzzy buzz that stays in place in time. Zero is off and leaves the sound unchanged. It is not a smear: transients keep their time plus the FFT window delay."},
{"key":"rate","label":"Rate","kind":"frequency","defaultValue":"5","min":"0","mid":"5","max":"1000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"How fast the wobble moves. Updates at the STFT hop rate (about 47 Hz at 4096 and 48 kHz), so it is not audio-rate modulation. No effect while Swarm is zero."},
{"key":"seed","label":"Seed","kind":"seed","defaultValue":"1","min":"0","mid":"1","max":"16777215","step":"1","linearSmoothing":false,"smoothingType":"none","tooltip":"Seed for the wobble. Same Seed, input and settings give the same sound."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to the selected FFT Size. Both paths have that many samples of delay."}]})json";
}

extern "C" int soemdsp_spectral_warble_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure(); fft4096.ensure(); fft8192.ensure();
    s->initialize();
    // Warble is the phase-wobble engine alone: 4x overlap, no smear, blur, diffusion, level wobble or drift.
    s->desiredCloud = false; for (auto& core : s->cores) { core.cloud = false; core.swarmLevel = 0; core.swarmDrift = 0; }
    s->reset();
    pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_warble_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_warble_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" int soemdsp_spectral_warble_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096 && length != 8192 && length != 16384)) return -1;
  s->desired = length; return 0;
}
extern "C" int soemdsp_spectral_warble_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
extern "C" double soemdsp_spectral_warble_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_warble_latency() { return 4096; }
extern "C" int soemdsp_spectral_warble_latency_for_handle(int h) { return soemdsp_spectral_warble_fft_size(h); }
extern "C" int soemdsp_spectral_warble_version() { return 1; }
extern "C" const char* soemdsp_spectral_warble_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_warble_metadata_json_size() { return sizeof(metadata) - 1; }

// Swarm phase wobble in degrees, Rate in Hz, Seed (integer). Cheap to call every sample; a changed Seed reseeds both cores.
extern "C" void soemdsp_spectral_warble_set_warble(int h, double phaseDegrees, double rateHz, double seed) {
  if (auto* s = get(h)) {
    const unsigned int sd = __builtin_isfinite(seed) && seed > 0 ? (seed >= 4294967295.0 ? 4294967295u : (unsigned int)seed) : 0u;
    for (auto& core : s->cores) {
      core.swarm = __builtin_isfinite(phaseDegrees) ? phaseDegrees : 0;
      core.swarmRate = __builtin_isfinite(rateHz) && rateHz > 0 ? rateHz : 0;
      if (sd != core.swarmSeed) { core.swarmSeed = sd; core.seedSwarm(); core.seedCloud(); }
    }
  }
}
extern "C" double soemdsp_spectral_warble_sample(int h, double l, double r, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, 0, 0, 0, mix, rate) : 0;
}
