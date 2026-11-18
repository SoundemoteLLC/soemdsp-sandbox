// soemdsp-native-module: spectral_freeze
// soemdsp-native-label: Spectral Freeze
// soemdsp-native-target: spectralFreeze
// soemdsp-native-kind: effect
#include "freeze_engine.h"
#include <soemdsp/utility/memory_pool.h>

namespace {
using State = soemdsp_spectral_freeze::State;
constexpr int capacity = 64;
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({
  "module": "spectral_freeze",
  "targetType": "spectralFreeze",
  "label": "Spectral Freeze",
  "kind": "effect",
  "inputs": [
    "In",
    "Left",
    "Right",
    "Freeze",
    "Recapture"
  ],
  "outputs": [
    "Mono",
    "Left",
    "Right",
    "Held"
  ],
  "parameters": [
    {
      "key": "fftSize",
      "label": "FFT Size",
      "kind": "choice",
      "choices": [
        "512",
        "1024",
        "2048",
        "4096",
        "8192",
        "16384"
      ],
      "choiceKeys": [
        "512",
        "1024",
        "2048",
        "4096",
        "8192",
        "16384"
      ],
      "choiceIds": [
        512,
        1024,
        2048,
        4096,
        8192,
        16384
      ],
      "defaultValue": "4096",
      "min": "0",
      "mid": "2.5",
      "max": "5",
      "step": "1",
      "unit": "samples",
      "linearSmoothing": false,
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "tooltip": "Analysis window and processing delay in samples. Smaller windows capture shorter moments; larger windows resolve bass and harmonics. Edits preserve the held spectrum through remapping, warming and Capture Blend, not a new live capture. Delay follows size; plugin-host compensation is unverified."
    },
    {
      "key": "freeze",
      "label": "Freeze",
      "kind": "choice",
      "choices": [
        "Live",
        "Frozen"
      ],
      "choiceKeys": [
        "live",
        "frozen"
      ],
      "choiceIds": [
        0,
        1
      ],
      "defaultValue": "live",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "step": "1",
      "linearSmoothing": false,
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "tooltip": "Frozen captures a complete analysis window and sustains its spectrum with evolving phase. Live releases to delayed input. A wired Freeze gate overrides this switch; rising high captures, low releases. Held reports a completed active capture."
    },
    {
      "key": "recapture",
      "label": "Recapture",
      "defaultValue": "0",
      "min": "0",
      "mid": "1",
      "max": "16777215",
      "step": "1",
      "control": "number",
      "linearSmoothing": false,
      "tooltip": "Button action counter: every click requests a new capture while Frozen. Requests are latched until an available FFT capture boundary; rapid requests coalesce. The wired Recapture input remains a rising-edge trigger.",
      "modulation": false,
      "parameterOutput": false
    },
    {
      "key": "captureBlendMs",
      "label": "Capture Blend",
      "kind": "time",
      "defaultValue": "20",
      "min": "0",
      "mid": "50",
      "max": "1000",
      "step": "any",
      "unit": "ms",
      "nonlinearSlider": true,
      "tooltip": "Crossfade duration between warmed held states after recapture or an FFT-size edit. Zero switches directly after warm-up. Does not smooth or compress the held sound itself. Rapid requests queue the latest capture."
    },
    {
      "key": "refreshHz",
      "label": "Refresh Rate",
      "kind": "frequency",
      "defaultValue": "0",
      "min": "0",
      "mid": "1",
      "max": "20",
      "step": "any",
      "unit": "Hz",
      "nonlinearSlider": true,
      "tooltip": "Rate at which the held spectrum gradually admits live power and phase-advance estimates. Zero holds the captured material unchanged. Rate 1 Hz means a one-second exponential time constant; this is not periodic hard recapture."
    },
    {
      "key": "decaySeconds",
      "label": "Decay",
      "kind": "time",
      "defaultValue": "0",
      "min": "0",
      "mid": "5",
      "max": "60",
      "unit": "s",
      "step": "any",
      "nonlinearSlider": true,
      "tooltip": "Held magnitude decay time constant in seconds. Zero means infinite sustain. Positive values decay after capture; Recapture restarts from the current input."
    },
    {
      "key": "diffusion",
      "label": "Diffusion",
      "defaultValue": "0",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "unit": "%",
      "step": "any",
      "tooltip": "Phase excursion amount added to the evolving held spectrum. Zero retains captured phase advance; higher values create a more diffuse texture without magnitude crossfade cancellations."
    },
    {
      "key": "stereoSpread",
      "label": "Stereo Spread",
      "defaultValue": "1",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "unit": "%",
      "step": "any",
      "tooltip": "Opposite-channel phase diffusion for stereo width, including from mono input. Zero links diffusion motion; requires Diffusion above zero. Input channels remain separate."
    },
    {
      "key": "mix",
      "label": "Mix",
      "defaultValue": "1",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "unit": "%",
      "step": "any",
      "tooltip": "Live/held blend aligned to the selected FFT Size. Capture/release has a separate 20 ms handoff; Capture Blend controls replacement of held states. Held reports an active ready capture."
    }
  ]
})json";
}
extern "C" int soemdsp_spectral_freeze_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    s->initialize(); pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_freeze_destroy(int h) { if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; } }
extern "C" void soemdsp_spectral_freeze_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" double soemdsp_spectral_freeze_sample(int h, double l, double r, double gate, double recapture, double decay, double diffusion, double spread, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, gate, recapture, decay, diffusion, spread, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_freeze_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" double soemdsp_spectral_freeze_held(int h) { auto* s = get(h); return s ? s->held : 0; }
extern "C" int soemdsp_spectral_freeze_latency() { return 4096; }
extern "C" int soemdsp_spectral_freeze_version() { return 2; }
extern "C" const char* soemdsp_spectral_freeze_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_freeze_metadata_json_size() { return sizeof(metadata) - 1; }
extern "C" int soemdsp_spectral_freeze_configure(int h, int length, double blendMs, double refreshHz, double recaptureCount) {
  auto* s = get(h);
  if (!s || !soemdsp_spectral_freeze::validSize(length)) return -1;
  if (!__builtin_isfinite(blendMs) || !__builtin_isfinite(refreshHz) || !__builtin_isfinite(recaptureCount)) return -2;
  s->desired = length; s->captureBlendMs = blendMs > 0 ? blendMs : 0; s->refreshHz = refreshHz > 0 ? refreshHz : 0;
  if (recaptureCount != s->lastCount) { s->lastCount = recaptureCount; s->uiCapture = true; }
  return 0;
}
extern "C" int soemdsp_spectral_freeze_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].size : 0; }
extern "C" int soemdsp_spectral_freeze_latency_for_handle(int h) { return soemdsp_spectral_freeze_fft_size(h); }
extern "C" double soemdsp_spectral_freeze_capture_count(int h) { auto* s = get(h); return s ? (double)s->captures : 0; }
