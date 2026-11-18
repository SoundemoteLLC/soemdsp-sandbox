// soemdsp-native-module: stft_gate
// soemdsp-native-label: STFT Gate
// soemdsp-native-target: stftGate
// soemdsp-native-kind: dynamics
#include "../stft_contrast/spectral_engine.h"

namespace {
using Pool = soemdsp_spectral::Pool<true>;
const char metadata[] = R"json({
  "module": "stft_gate",
  "targetType": "stftGate",
  "label": "STFT Gate",
  "kind": "dynamics",
  "inputs": [
    "In",
    "Left",
    "Right"
  ],
  "outputs": [
    "Mono",
    "Left",
    "Right",
    "Ready"
  ],
  "parameters": [
    {
      "key": "profileMode",
      "label": "Noise Profile",
      "kind": "choice",
      "choices": [
        "Manual",
        "Learn",
        "Use Profile"
      ],
      "choiceKeys": [
        "manual",
        "learn",
        "use"
      ],
      "choiceIds": [
        0,
        1,
        2
      ],
      "defaultValue": "0",
      "min": "0",
      "mid": "0",
      "max": "2",
      "step": "1",
      "displayChoices": true,
      "divideChoicesVisibly": false,
      "linearSmoothing": false,
      "tooltip": "Manual uses Threshold. Learn averages a noise-only passage without gating; then choose Use Profile. Ready is 1 once a complete frame was learned. Use Profile without a learned profile passes audio unchanged. Profiles are engine-session state, not saved in patches; engine rebuild or sample-rate change clears them."
    },
    {
      "key": "thresholdDb",
      "label": "Threshold",
      "defaultValue": "-60",
      "min": "-120",
      "mid": "-60",
      "max": "0",
      "step": "any",
      "unit": "dB",
      "tooltip": "Manual gate threshold per FFT bin, in normalized one-sided bin-power dBFS. Knee controls how sharply bins open. Not a whole-signal peak threshold."
    },
    {
      "key": "marginDb",
      "label": "Margin",
      "defaultValue": "3",
      "min": "-12",
      "mid": "3",
      "max": "24",
      "step": "any",
      "unit": "dB",
      "tooltip": "Use Profile only: threshold offset above each learned noise-bin mean power. More margin rejects more noise and can remove quiet wanted detail."
    },
    {
      "key": "depthDb",
      "label": "Depth",
      "defaultValue": "60",
      "min": "0",
      "mid": "48",
      "max": "120",
      "step": "any",
      "unit": "dB",
      "tooltip": "Maximum attenuation for closed bins. Zero disables attenuation; no hard audio clipping."
    },
    {
      "key": "kneeDb",
      "label": "Knee",
      "defaultValue": "6",
      "min": "0",
      "mid": "6",
      "max": "24",
      "step": "any",
      "unit": "dB",
      "tooltip": "Transition width around the manual or learned threshold. Zero hard-switches bins for abrupt harmonic pop-in; 6 dB retains the original soft behavior. For extreme effects also set Attack, Release and Smooth to zero. STFT overlap still blends adjacent frames."
    },
    {
      "key": "attackMs",
      "label": "Attack",
      "defaultValue": "5",
      "min": "0",
      "mid": "5",
      "max": "200",
      "step": "any",
      "unit": "ms",
      "tooltip": "Opening time constant when a bin exceeds its threshold. Decisions update every 256 samples.",
      "nonlinearSlider": true
    },
    {
      "key": "holdMs",
      "label": "Hold",
      "defaultValue": "0",
      "min": "0",
      "mid": "100",
      "max": "1000",
      "step": "any",
      "unit": "ms",
      "tooltip": "Retriggerable peak-hold duration after a bin falls below threshold, before Release closes it. Zero preserves the original behavior. Timed in milliseconds at the STFT hop rate; no DSP maximum. This holds the gain open, not the audio itself.",
      "nonlinearSlider": true
    },
    {
      "key": "releaseMs",
      "label": "Release",
      "defaultValue": "100",
      "min": "0",
      "mid": "100",
      "max": "1000",
      "step": "any",
      "unit": "ms",
      "tooltip": "Closing time constant. Longer release reduces spectral chatter and preserves tails.",
      "nonlinearSlider": true
    },
    {
      "key": "smooth",
      "label": "Smooth",
      "defaultValue": "0.5",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "step": "any",
      "tooltip": "Links neighboring bin gain decisions with a five-bin triangular average to reduce isolated musical-noise artifacts. Zero keeps decisions independent."
    },
    {
      "key": "mix",
      "label": "Mix",
      "defaultValue": "1",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "step": "any",
      "tooltip": "Dry/wet blend aligned to the fixed 1024-sample delay. Stereo channels share gain decisions to preserve their image."
    }
  ]
})json";
}
extern "C" int soemdsp_stft_gate_create() { return Pool::create(); }
extern "C" void soemdsp_stft_gate_destroy(int h) { Pool::destroy(h); }
extern "C" void soemdsp_stft_gate_reset(int h) { if (auto* s = Pool::get(h)) s->reset(false); }
extern "C" void soemdsp_stft_gate_set_knee(int h, double knee) { if (auto* s = Pool::get(h)) s->gateKnee = knee; }
extern "C" void soemdsp_stft_gate_set_hold(int h, double milliseconds) { if (auto* s = Pool::get(h)) s->gateHold = milliseconds; }
extern "C" double soemdsp_stft_gate_sample(int h, double left, double right,
int profileMode, double threshold, double margin, double depth, double attack,
  double release, double smooth, double mix, double rate) {
  auto* s = Pool::get(h); if (!s) return 0;
  soemdsp_spectral::Params p;
  p.profile = profileMode; p.threshold = threshold; p.margin = margin; p.depth = depth;
  p.attack = attack; p.release = release; p.smooth = smooth; p.mix = mix;
  p.knee = s->gateKnee;
  p.hold = s->gateHold;
  return s->tick(left, right, p, rate);
}
extern "C" double soemdsp_stft_gate_right(int h) { auto* s = Pool::get(h); return s ? s->right : 0; }
extern "C" int soemdsp_stft_gate_latency() { return soemdsp_spectral::size; }
extern "C" int soemdsp_stft_gate_version() { return 3; }
extern "C" const char* soemdsp_stft_gate_metadata_json() { return metadata; }
extern "C" int soemdsp_stft_gate_metadata_json_size() { return sizeof(metadata) - 1; }
extern "C" double soemdsp_stft_gate_ready(int h) { auto* s = Pool::get(h); return s && s->learnedFrames ? 1 : 0; }
extern "C" double soemdsp_stft_gate_profile_frames(int h) { auto* s = Pool::get(h); return s ? (double)s->learnedFrames : 0; }
