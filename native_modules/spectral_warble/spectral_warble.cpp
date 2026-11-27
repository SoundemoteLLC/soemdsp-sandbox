// soemdsp-native-module: spectral_warble
// soemdsp-native-label: Spectral Warble
// soemdsp-native-target: spectralWarble
// soemdsp-native-kind: effect
#include "../spectral_blur/spectral_stft_engine.h"

namespace {
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; } // safety: a handle outside the pool is no module
// voiceStorage: how many voices the engine holds; a definition's Voices max above it would be held to it, so a test fails if one is.
const char metadata[] = R"json({"module":"spectral_warble","targetType":"spectralWarble","label":"Spectral Warble","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"voiceStorage":4,"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window and processing delay in samples. At 48 kHz: 512 = 10.67 ms, 4096 = 85.33 ms, 8192 = 170.67 ms, 16384 = 341.33 ms. Smaller is tighter; larger resolves lower frequencies and costs more memory and peak CPU. Edits warm and crossfade, but intentionally change delay. Plugin-host compensation is not yet verified."},
{"key":"depth","label":"Depth","defaultValue":"25","min":"0","mid":"25","max":"200","unit":"\u00a2","step":"any","nonlinearSlider":true,"tooltip":"How far each partial's pitch wobbles, in cents (average, RMS): the same musical amount on low and high notes. Every harmonic moves on its own, so the tone swims instead of doing one vibrato. 0 is dry."},
{"key":"rate","label":"Rate","kind":"frequency","defaultValue":"4","min":"0.05","mid":"4","max":"20","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Average wobble speed in Hz. Around 2-6 Hz is a lush, vocal warble; slower is a gentle swim; faster gets nervous. Each partial runs at its own speed around this (see Drunk). Motion updates about 94 times a second at FFT 4096 (half that at 8192, a quarter at 16384), so very high rates step at big FFT sizes."},
{"key":"drunk","label":"Drunk","defaultValue":"0.5","min":"0","mid":"0.5","max":"1","unit":"\u00d7","step":"any","tooltip":"How irregular the wobble is. 0 = every partial is a smooth, regular vibrato at Rate (just out of step with each other); 1 = a wandering, organic motion with each partial's speed spread over an octave."},
{"key":"voices","label":"Voices","defaultValue":"3","min":"1","mid":"2","max":"4","step":"1","linearSmoothing":false,"tooltip":"How many independently wobbling copies sing each partial. More voices make a thicker chorus that gently beats; the beating is heard as is (no leveling). Costs CPU per voice."},
{"key":"stereoSpread","label":"Stereo Spread","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"\u00d7","step":"any","tooltip":"How differently the two ears wobble, and how wide the voices are spread. 0 = identical channels; 1 = each ear has its own motion and the voices fan out left to right. The voices' pan gains average to 1 per ear."},
{"key":"monoBassHz","label":"Mono Bass","kind":"frequency","defaultValue":"120","min":"0","mid":"120","max":"1000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Below this frequency both ears wobble identically and the voices stay centred, so the bass stays solid in mono. One-octave smooth transition. 0 = off."},
{"key":"seed","label":"Seed","kind":"seed","defaultValue":"0","min":"0","mid":"0","max":"16777215","maxDigits":0,"step":"1","nonlinearSlider":false,"linearSmoothing":false,"smoothingType":"none","tooltip":"The random pattern of the wobble. The same Seed, input and settings always give the same output."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to the selected FFT Size. Both paths have that many samples of delay."}]})json";
}

extern "C" int soemdsp_spectral_warble_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure(); fft4096.ensure(); fft8192.ensure();
    s->initialize();
    s->setEngine(kWarble);
    pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_warble_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_warble_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" int soemdsp_spectral_warble_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096 && length != 8192 && length != 16384)) return -1; // safety: only these sizes have transforms and buffers
  s->desired = length; return 0;
}
extern "C" int soemdsp_spectral_warble_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
// Depth in cents, Rate in Hz, Drunk, Voices, Seed. Cheap to call every sample; a changed Seed reseeds both cores.
// safety: a non-finite value becomes 0 (1 for Voices); a negative Rate would make the one-pole coefficient exceed 1 and blow up, so the sign is
// dropped (|Rate|); Voices is rounded to a whole number and held to the per-voice storage (kMaxVoices, also in the metadata as voiceStorage).
extern "C" void soemdsp_spectral_warble_set_warble(int h, double depthCents, double rateHz, double drunk, double voices, double seed) {
  if (auto* s = get(h)) {
    const unsigned int sd = __builtin_isfinite(seed) && seed > 0 ? (seed >= 4294967295.0 ? 4294967295u : (unsigned int)seed) : 0u; // safety: the storage type is uint32
    for (auto& core : s->cores) {
      core.warbleDepth = __builtin_isfinite(depthCents) ? depthCents : 0;
      core.warbleRate = __builtin_isfinite(rateHz) ? (rateHz < 0 ? -rateHz : rateHz) : 0; // safety: a negative rate makes the one-pole coefficient exceed 1
      core.warbleDrunk = __builtin_isfinite(drunk) ? drunk : 0;
      const double v = __builtin_isfinite(voices) ? voices : 1;
      core.warbleVoices = v < 1 ? 1 : v > kMaxVoices ? kMaxVoices : (int)(v + 0.5); // safety: below 1 divides by zero, above kMaxVoices is past the arrays
      if (sd != core.seed) { core.seed = sd; core.seedWarble(); }
    }
  }
}
// Stereo Spread (a ratio) and Mono Bass (Hz, 0 = off). Not limited; a non-finite value becomes 0.
extern "C" void soemdsp_spectral_warble_set_stereo(int h, double spread, double monoBassHz) {
  if (auto* s = get(h)) for (auto& core : s->cores) {
    core.stereoSpread = __builtin_isfinite(spread) ? spread : 0;
    core.monoBassHz = __builtin_isfinite(monoBassHz) ? monoBassHz : 0;
  }
}
extern "C" double soemdsp_spectral_warble_sample(int h, double l, double r, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, 0, 0, 0, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_warble_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_warble_latency() { return 4096; }
extern "C" int soemdsp_spectral_warble_latency_for_handle(int h) { return soemdsp_spectral_warble_fft_size(h); }
extern "C" int soemdsp_spectral_warble_version() { return 2; }
extern "C" const char* soemdsp_spectral_warble_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_warble_metadata_json_size() { return sizeof(metadata) - 1; }
