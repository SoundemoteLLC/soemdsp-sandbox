// soemdsp-native-module: spectral_blur
// soemdsp-native-label: Spectral Cloud
// soemdsp-native-target: spectralBlur
// soemdsp-native-kind: effect
#include "spectral_stft_engine.h"

namespace {
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; } // safety: a handle outside the pool is no module
// voiceStorage: how many voices the engine holds; a definition's Voices max above it would be held to it, so a test fails if one is.
const char metadata[] = R"json({"module":"spectral_blur","targetType":"spectralBlur","label":"Spectral Cloud","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"voiceStorage":4,"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window and processing delay in samples. At 48 kHz: 512 = 10.67 ms, 4096 = 85.33 ms, 8192 = 170.67 ms, 16384 = 341.33 ms. Smaller is tighter; larger resolves lower frequencies and costs more memory and peak CPU. Edits warm and crossfade, but intentionally change delay. Plugin-host compensation is not yet verified."},
{"key":"fuzz","label":"Fuzz","defaultValue":"100","min":"0","mid":"100","max":"1200","unit":"\u00a2","step":"any","nonlinearSlider":true,"tooltip":"How wide the cloud is around every partial, in cents either side: the same musical width at every pitch. Small values add air and keep the pitch tonal; large values turn each harmonic into a soft diffuse band. The centre pitch never moves. 0 is dry."},
{"key":"grain","label":"Grain","defaultValue":"1","min":"0","mid":"1","max":"6","unit":"dB","step":"any","tooltip":"Fast random level flicker on every frequency bin, in dB. It only ever dips bins, scaled to unity mean power, so on average it leaves the level alone. 0 is a smooth, hissy cloud; a few dB makes the fur rougher and more textured."},
{"key":"stereoSpread","label":"Stereo Spread","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"\u00d7","step":"any","tooltip":"How differently the cloud moves in each ear. 0 = the same in both (mono in stays mono); 1 = fully independent fur left and right, a wide stereo wash. Changes phase only, never level, and does not cross-feed. In mono, a high Spread can sound up to about 3 dB quieter."},
{"key":"monoBassHz","label":"Mono Bass","kind":"frequency","defaultValue":"0","min":"0","mid":"120","max":"1000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Keeps the cloud identical in both ears below this frequency, so the low end stays solid in mono. Smooth one-octave transition. 0 = off."},
{"key":"voices","label":"Voices","defaultValue":"3","min":"1","mid":"2","max":"4","step":"1","linearSmoothing":false,"tooltip":"Independent cloud layers summed together. More voices make the low, still-tonal harmonics denser and smoother. Costs CPU per voice."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to the selected FFT Size. Both paths have that many samples of delay."},
{"key":"seed","label":"Seed","kind":"seed","defaultValue":"0","min":"0","mid":"0","max":"16777215","maxDigits":0,"step":"1","nonlinearSlider":false,"linearSmoothing":false,"smoothingType":"none","tooltip":"Random pattern of the cloud. The same Seed, input and settings always give the same output."}]})json";
}

extern "C" int soemdsp_spectral_blur_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure(); fft4096.ensure(); fft8192.ensure();
    s->initialize();
    s->setEngine(kCloud);
    pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_blur_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_blur_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" int soemdsp_spectral_blur_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096 && length != 8192 && length != 16384)) return -1; // safety: only these sizes have transforms and buffers
  s->desired = length; return 0;
}
extern "C" int soemdsp_spectral_blur_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
// Fuzz in cents, Grain in dB, Voices, Seed. Cheap to call every sample; a changed Seed reseeds both cores.
// safety: a non-finite value becomes 0 (1 for Voices); a negative Fuzz would put the square root of a negative number in the walk step and a
// negative kernel width, so it is 0; Voices is rounded to a whole number and held to the per-voice storage (kMaxVoices, also in the metadata as
// voiceStorage). Grain is used as given at any value (its unity mean power comes from grainNorm).
extern "C" void soemdsp_spectral_blur_set_cloud(int h, double fuzzCents, double grainDb, double voices, double seed) {
  if (auto* s = get(h)) {
    const unsigned int sd = __builtin_isfinite(seed) && seed > 0 ? (seed >= 4294967295.0 ? 4294967295u : (unsigned int)seed) : 0u; // safety: the storage type is uint32
    for (auto& core : s->cores) {
      core.cloudFuzz = __builtin_isfinite(fuzzCents) && fuzzCents > 0 ? fuzzCents : 0; // safety: a negative width has no meaning
      core.cloudGrain = __builtin_isfinite(grainDb) ? grainDb : 0;
      const double v = __builtin_isfinite(voices) ? voices : 1;
      core.cloudVoices = v < 1 ? 1 : v > kMaxVoices ? kMaxVoices : (int)(v + 0.5); // safety: below 1 divides by zero, above kMaxVoices is past the arrays
      if (sd != core.seed) { core.seed = sd; core.seedCloud(); }
    }
  }
}
// Stereo Spread (a ratio) and Mono Bass (Hz, 0 = off). Not limited; a non-finite value becomes 0.
extern "C" void soemdsp_spectral_blur_set_stereo(int h, double spread, double monoBassHz) {
  if (auto* s = get(h)) for (auto& core : s->cores) {
    core.stereoSpread = __builtin_isfinite(spread) ? spread : 0;
    core.monoBassHz = __builtin_isfinite(monoBassHz) ? monoBassHz : 0;
  }
}
extern "C" double soemdsp_spectral_blur_sample(int h, double l, double r, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, 0, 0, 0, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_blur_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_blur_latency() { return 4096; }
extern "C" int soemdsp_spectral_blur_latency_for_handle(int h) { return soemdsp_spectral_blur_fft_size(h); }
extern "C" int soemdsp_spectral_blur_version() { return 2; }
extern "C" const char* soemdsp_spectral_blur_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_blur_metadata_json_size() { return sizeof(metadata) - 1; }
