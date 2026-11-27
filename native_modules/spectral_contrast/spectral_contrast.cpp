// soemdsp-native-module: spectral_contrast
// soemdsp-native-label: Spectral Contrast
// soemdsp-native-target: spectralContrast
// soemdsp-native-kind: dynamics
#include "spectral_engine.h"

namespace {
using Pool = soemdsp_spectral::Pool<false>;
const char metadata[] = R"json({
  "module": "spectral_contrast",
  "targetType": "spectralContrast",
  "label": "Spectral Contrast",
  "kind": "dynamics",
  "inputs": [
    "In",
    "Left",
    "Right"
  ],
  "outputs": [
    "Mono",
    "Left",
    "Right"
  ],
  "parameters": [
    {
      "key": "contrast",
      "label": "Contrast",
      "defaultValue": "-0.35",
      "min": "-1",
      "mid": "0",
      "max": "1",
      "step": "any",
      "tooltip": "Positive emphasizes stronger spectral regions; negative lifts weaker regions relative to the mean. Relative contrast is independent of input level. Zero disables contrast."
    },
    {
      "key": "scale",
      "label": "Scale",
      "defaultValue": "1",
      "min": "0",
      "mid": "1",
      "max": "4",
      "step": "any",
      "unit": "oct",
      "tooltip": "Spectral neighborhood width across 32 overlapping logarithmic analysis regions. Zero keeps regions independent; broad values link their dynamics. This is not FFT size."
    },
    {
      "key": "thresholdDb",
      "label": "Threshold",
      "defaultValue": "-24",
      "min": "-72",
      "mid": "-24",
      "max": "0",
      "step": "any",
      "unit": "dB",
      "tooltip": "Downward compression threshold for each stereo-linked analysis region, not whole-signal peak level. Ratio 1 disables threshold compression."
    },
    {
      "key": "ratio",
      "label": "Ratio",
      "defaultValue": "2",
      "min": "1",
      "mid": "4",
      "max": "20",
      "step": "any",
      "tooltip": "Downward compression ratio above Threshold. One leaves the threshold stage neutral."
    },
    {
      "key": "attackMs",
      "label": "Attack",
      "defaultValue": "10",
      "min": "0",
      "mid": "10",
      "max": "200",
      "step": "any",
      "unit": "ms",
      "tooltip": "Gain-reduction time constant. Spectral gain decisions update every 256 samples; zero means one-hop response.",
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
      "tooltip": "Time constant for gain recovery and upward detail enhancement.",
      "nonlinearSlider": true
    },
    {
      "key": "maxBoostDb",
      "label": "Max Boost",
      "defaultValue": "18",
      "min": "0",
      "mid": "12",
      "max": "36",
      "step": "any",
      "unit": "dB",
      "tooltip": "Explicit maximum positive spectral gain before Output Gain. Prevents upward contrast from giving arbitrarily large boost to near-silent regions. This is a gain limit, not an audio clipper."
    },
    {
      "key": "gainDb",
      "label": "Output Gain",
      "defaultValue": "0",
      "min": "-24",
      "mid": "0",
      "max": "24",
      "step": "any",
      "unit": "dB",
      "tooltip": "Output makeup gain after spectral processing. No hidden loudness normalization, saturation or limiter."
    },
    {
      "key": "mix",
      "label": "Mix",
      "defaultValue": "1",
      "min": "0",
      "mid": "0.5",
      "max": "1",
      "step": "any",
      "tooltip": "Dry/wet blend with both paths aligned to the fixed 1024-sample delay. Contrast 0, Ratio 1 and Output Gain 0 are neutral."
    }
  ]
})json";
}
extern "C" int soemdsp_spectral_contrast_create() { return Pool::create(); }
extern "C" void soemdsp_spectral_contrast_destroy(int h) { Pool::destroy(h); }
extern "C" void soemdsp_spectral_contrast_reset(int h) { if (auto* s = Pool::get(h)) s->reset(false); }
extern "C" double soemdsp_spectral_contrast_sample(int h, double left, double right,
double contrast, double scale, double threshold, double ratio,
  double attack, double release, double boost, double gain, double mix, double rate) {
  auto* s = Pool::get(h); if (!s) return 0;
  soemdsp_spectral::Params p;
  p.contrast = contrast; p.scale = scale; p.threshold = threshold; p.ratio = ratio;
  p.attack = attack; p.release = release; p.boost = boost; p.gain = gain; p.mix = mix;
  return s->tick(left, right, p, rate);
}
extern "C" double soemdsp_spectral_contrast_right(int h) { auto* s = Pool::get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_contrast_latency() { return soemdsp_spectral::size; }
extern "C" int soemdsp_spectral_contrast_version() { return 1; }
extern "C" const char* soemdsp_spectral_contrast_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_contrast_metadata_json_size() { return sizeof(metadata) - 1; }
extern "C" int soemdsp_spectral_contrast_display_bins() { return soemdsp_spectral::bins; }
extern "C" double soemdsp_spectral_contrast_display_size() { return soemdsp_spectral::size; }
extern "C" const double* soemdsp_spectral_contrast_display_power(int h) { return soemdsp_spectral::display_power(Pool::get(h)); }
extern "C" const double* soemdsp_spectral_contrast_display_gain(int h) { return soemdsp_spectral::display_gain(Pool::get(h)); }
extern "C" double soemdsp_spectral_contrast_display_rate(int h) { return soemdsp_spectral::display_rate(Pool::get(h)); }
extern "C" double soemdsp_spectral_contrast_display_frames(int h) { return soemdsp_spectral::display_frames(Pool::get(h)); }
