// soemdsp-native-module: spectral_smear
// soemdsp-native-label: Spectral Smear
// soemdsp-native-target: spectralSmear
// soemdsp-native-kind: effect
#include "../spectral_blur/spectral_stft_engine.h"

namespace {
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({"module":"spectral_smear","targetType":"spectralSmear","label":"Spectral Smear","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window and processing delay in samples. At 48 kHz: 512 = 10.67 ms, 4096 = 85.33 ms, 8192 = 170.67 ms, 16384 = 341.33 ms. Smaller is tighter; larger resolves lower frequencies and costs more memory and peak CPU. Edits warm and crossfade, but intentionally change delay. Plugin-host compensation is not yet verified."},
{"key":"smearSeconds","label":"Time Smear","kind":"time","defaultValue":"2","min":"0","mid":"1","max":"10","unit":"s","step":"any","nonlinearSlider":true,"tooltip":"Spectral power averaging time constant in seconds. Zero follows each frame; longer values soften attacks and leave slowly decaying spectral clouds. Not a delay or freeze."},
{"key":"blurCents","label":"Blur","defaultValue":"0","min":"0","mid":"100","max":"1200","unit":"\u00a2","step":"any","nonlinearSlider":true,"tooltip":"Power-spreading half-width in cents: the same musical interval at every pitch, so a bass note and a high note are smeared by the same relative amount. Smooth triangular kernel, level preserving. Zero leaves bins separate."},
{"key":"diffusion","label":"Diffusion","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"×","step":"any","tooltip":"Phase excursion amount, from coherent phase to full diffusion. Rotates each bin without complex-spectrum crossfade cancellations. Stereo Spread controls channel decorrelation; no makeup gain."},
{"key":"amplitudeSmoothMs","label":"Amplitude Smooth","kind":"time","defaultValue":"0","min":"0","mid":"10","max":"200","unit":"ms","step":"any","nonlinearSlider":true,"tooltip":"Additional symmetric per-bin magnitude smoothing after frequency spreading. Zero preserves the sharp amplitude texture. Increase gently to soften chatter; this is not compression, saturation or limiting. Updates at the STFT hop rate."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to the selected FFT Size. Both paths have that many samples of delay."}]})json";
}

extern "C" int soemdsp_spectral_smear_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure(); fft4096.ensure(); fft8192.ensure();
    s->initialize();
    // Smear: no Cloud, no Warble; Phase Smooth is fixed at 10 ms (only Diffusion uses it) and the two channels share the diffusion walk.
    s->desiredCloud = false; for (auto& core : s->cores) { core.cloud = false; core.swarm = 0; core.swarmLevel = 0; core.swarmDrift = 0; core.phaseSmoothMs = 10; core.stereoSpread = 0; }
    s->reset();
    pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_smear_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_smear_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" int soemdsp_spectral_smear_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096 && length != 8192 && length != 16384)) return -1;
  s->desired = length; return 0;
}
extern "C" int soemdsp_spectral_smear_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
extern "C" double soemdsp_spectral_smear_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_smear_latency() { return 4096; }
extern "C" int soemdsp_spectral_smear_latency_for_handle(int h) { return soemdsp_spectral_smear_fft_size(h); }
extern "C" int soemdsp_spectral_smear_version() { return 1; }
extern "C" const char* soemdsp_spectral_smear_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_smear_metadata_json_size() { return sizeof(metadata) - 1; }

// Amplitude Smooth in ms (symmetric lag on each bin's magnitude), 0 = off. Cheap to call every sample.
extern "C" void soemdsp_spectral_smear_set_amplitude_smooth(int h, double ms) {
  if (auto* s = get(h)) for (auto& core : s->cores) core.amplitudeSmoothMs = __builtin_isfinite(ms) && ms > 0 ? ms : 0;
}
// Blur width in cents (0 = off). Cheap to call every sample.
extern "C" void soemdsp_spectral_smear_set_blur_cents(int h, double cents) {
  if (auto* s = get(h)) for (auto& core : s->cores) core.blurCents = __builtin_isfinite(cents) && cents > 0 ? cents : 0;
}
extern "C" double soemdsp_spectral_smear_sample(int h, double l, double r, double seconds, double diffusion, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, seconds, 0, diffusion, mix, rate) : 0;
}
