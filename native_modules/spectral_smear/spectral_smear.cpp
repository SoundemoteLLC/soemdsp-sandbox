// soemdsp-native-module: spectral_smear
// soemdsp-native-label: Spectral Smear
// soemdsp-native-target: spectralSmear
// soemdsp-native-kind: effect
#include "../spectral_blur/spectral_stft_engine.h"

namespace {
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; } // safety: a handle outside the pool is no module
const char metadata[] = R"json({"module":"spectral_smear","targetType":"spectralSmear","label":"Spectral Smear","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window and processing delay in samples. At 48 kHz: 512 = 10.67 ms, 4096 = 85.33 ms, 8192 = 170.67 ms, 16384 = 341.33 ms. Smaller is tighter; larger resolves lower frequencies and costs more memory and peak CPU. Edits warm and crossfade, but intentionally change delay. Plugin-host compensation is not yet verified."},
{"key":"smearSeconds","label":"Time Smear","kind":"time","defaultValue":"2","min":"0","mid":"1","max":"10","unit":"s","step":"any","nonlinearSlider":true,"tooltip":"Spectral power averaging time constant in seconds. Zero follows each frame; longer values soften attacks and leave slowly decaying spectral clouds. Not a delay or freeze."},
{"key":"blurHz","label":"Frequency Blur","kind":"frequency","defaultValue":"100","min":"0","mid":"200","max":"4000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Power-spreading neighborhood half-width in Hz, the same number of Hz at every pitch (so a high partial gets a narrower musical interval than a low one; Pitch Blur is the constant-interval version). Smooth triangular kernel; it moves power between bins without adding any. Zero leaves bins separate. FFT Size sets the frequency resolution."},
{"key":"blurCents","label":"Pitch Blur","defaultValue":"0","min":"0","mid":"100","max":"1200","unit":"¢","step":"any","nonlinearSlider":true,"tooltip":"Power-spreading half-width in cents, added to Frequency Blur: the same musical interval at every pitch, so a bass note and a high note are smeared by the same relative amount. Smooth triangular kernel; it moves power between bins without adding any. Zero is off."},
{"key":"diffusion","label":"Diffusion","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"×","step":"any","tooltip":"Phase excursion amount, from coherent phase to full diffusion. Rotates each bin without complex-spectrum crossfade cancellations. Stereo Spread controls channel decorrelation; no makeup gain."},
{"key":"diffusionSpeedHz","label":"Diffusion Speed","kind":"frequency","defaultValue":"30","min":"0","mid":"30","max":"200","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"How fast the diffused phases drift, in Hz. The default 30 Hz melts the blur into a soft wash with no ringing tones; very low values (about 2 Hz) bring back the old glassy sound, which can ring metallic with a wide blur. Only does something while Diffusion is above 0."},
{"key":"hopMode","label":"Hop","kind":"choice","choices":["Normal","Smooth"],"choiceKeys":["4","8"],"choiceIds":[4,8],"defaultValue":"4","min":"0","mid":"0","max":"1","step":"1","linearSmoothing":false,"smoothingType":"none","displayChoices":true,"divideChoicesVisibly":true,"tooltip":"How finely the sound is processed in time. Normal is the standard quality; Smooth makes twice as many analysis frames, which gives softer, less grainy motion in tails and diffusion, at about double the CPU. It does not change the delay. Switching is glitch-free."},
{"key":"stereoSpread","label":"Stereo Spread","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"×","step":"any","tooltip":"Opposite-channel phase diffusion spread. Zero links the phase motion; higher values give mono input a stereo wash. Does not crossfeed audio. Requires Diffusion above zero; mono summing can change tone through phase cancellation."},
{"key":"monoBassHz","label":"Mono Bass","kind":"frequency","defaultValue":"120","min":"0","mid":"120","max":"1000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Below this frequency both ears get the same phase motion, so the bass stays solid in mono. One-octave smooth transition. 0 = off. Only does something while Diffusion and Stereo Spread are above 0."},
{"key":"phaseSmoothMs","label":"Phase Smooth","kind":"time","defaultValue":"10","min":"0","mid":"10","max":"200","unit":"ms","step":"any","nonlinearSlider":true,"tooltip":"Time constant for smoothing the unwrapped phase-diffusion trajectory. Zero keeps raw phase motion. Does not smooth spectral magnitudes or reduce their contrast. Updates at the STFT hop rate."},
{"key":"amplitudeSmoothMs","label":"Amplitude Smooth","kind":"time","defaultValue":"0","min":"0","mid":"10","max":"200","unit":"ms","step":"any","nonlinearSlider":true,"tooltip":"Additional symmetric per-bin magnitude smoothing after frequency spreading. Zero preserves the sharp amplitude texture. Increase gently to soften chatter; this is not compression, saturation or limiting. Updates at the STFT hop rate."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to the selected FFT Size. Both paths have that many samples of delay."},
{"key":"seed","label":"Seed","kind":"seed","defaultValue":"0","min":"0","mid":"0","max":"16777215","maxDigits":0,"step":"1","nonlinearSlider":false,"linearSmoothing":false,"smoothingType":"none","tooltip":"The random pattern of the diffusion. The same Seed, input and settings always give the same output; each new module gets its own."}]})json";
}

extern "C" int soemdsp_spectral_smear_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure(); fft4096.ensure(); fft8192.ensure();
    s->initialize();
    s->setEngine(kSmear);
    pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_smear_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_smear_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" int soemdsp_spectral_smear_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096 && length != 8192 && length != 16384)) return -1; // safety: only these sizes have transforms and buffers
  s->desired = length; return 0;
}
// Overlap (frames per window): the hop is N / overlap. safety: only a power of two from 2 to 16 divides every window size and keeps the
// overlap-add valid, like the FFT-size whitelist; the definition's choices (Normal = 4, Smooth = 8) decide which are offered.
extern "C" int soemdsp_spectral_smear_set_overlap(int h, int overlap) {
  auto* s = get(h); if (!s || (overlap != 2 && overlap != 4 && overlap != 8 && overlap != 16)) return -1;
  s->desiredOverlap = overlap; return 0;
}
extern "C" int soemdsp_spectral_smear_overlap(int h) { auto* s = get(h); return s ? s->cores[s->current].overlap : 0; }
extern "C" int soemdsp_spectral_smear_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
// Phase Smooth and Amplitude Smooth in ms (0 = off). A negative time would make the one-pole coefficient exceed 1 and the filter blow up, so a
// negative value is treated as 0; nothing else is limited here. Cheap to call every sample.
extern "C" void soemdsp_spectral_smear_set_smoothing(int h, double phaseMs, double amplitudeMs) {
  if (auto* s = get(h)) {
    for (auto& core : s->cores) {
      core.phaseSmoothMs = __builtin_isfinite(phaseMs) && phaseMs > 0 ? phaseMs : 0; // safety: a negative time constant blows the one-pole up
      core.amplitudeSmoothMs = __builtin_isfinite(amplitudeMs) && amplitudeMs > 0 ? amplitudeMs : 0; // safety: a negative time constant blows the one-pole up
    }
  }
}
// Stereo Spread (a ratio), Mono Bass (Hz, 0 = off) and Diffusion Speed (Hz). Not limited; a non-finite value becomes 0, and a negative Diffusion
// Speed is 0 (the square root of a negative step).
extern "C" void soemdsp_spectral_smear_set_stereo(int h, double spread, double monoBassHz, double diffusionSpeedHz) {
  if (auto* s = get(h)) for (auto& core : s->cores) {
    core.stereoSpread = __builtin_isfinite(spread) ? spread : 0;
    core.monoBassHz = __builtin_isfinite(monoBassHz) ? monoBassHz : 0;
    core.diffusionSpeed = __builtin_isfinite(diffusionSpeedHz) && diffusionSpeedHz > 0 ? diffusionSpeedHz : 0; // safety: a negative step has no square root
  }
}
// Seed (integer). A changed Seed reseeds both cores.
extern "C" void soemdsp_spectral_smear_set_seed(int h, double seed) {
  if (auto* s = get(h)) {
    const unsigned int sd = __builtin_isfinite(seed) && seed > 0 ? (seed >= 4294967295.0 ? 4294967295u : (unsigned int)seed) : 0u; // safety: the storage type is uint32
    for (auto& core : s->cores) if (sd != core.seed) { core.seed = sd; core.rng = sd * 2654435761u ^ 0x9e3779b9u; core.sideRng = sd * 2246822519u ^ 0xC2B2AE35u; if (!core.rng) core.rng = 0x9e3779b9u; if (!core.sideRng) core.sideRng = 0xC2B2AE35u; } // safety: xorshift never leaves 0
  }
}
// Pitch Blur width in cents (0 = off). A negative width has no meaning and would make the kernel's half-width negative, so it is treated as 0.
extern "C" void soemdsp_spectral_smear_set_blur_cents(int h, double cents) {
  if (auto* s = get(h)) for (auto& core : s->cores) core.blurCents = __builtin_isfinite(cents) && cents > 0 ? cents : 0; // safety: a negative width divides by a non-positive span
}
// sample(h, left, right, Time Smear s, Frequency Blur Hz, Diffusion, Mix, sample rate). The tick refuses a negative Time Smear or Frequency
// Blur (a negative time constant blows the one-pole up; a negative width has no meaning) and resets on non-finite input.
extern "C" double soemdsp_spectral_smear_sample(int h, double l, double r, double seconds, double hz, double diffusion, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, seconds, hz, diffusion, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_smear_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_smear_latency() { return 4096; }
extern "C" int soemdsp_spectral_smear_latency_for_handle(int h) { return soemdsp_spectral_smear_fft_size(h); }
extern "C" int soemdsp_spectral_smear_version() { return 2; }
extern "C" const char* soemdsp_spectral_smear_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_smear_metadata_json_size() { return sizeof(metadata) - 1; }
