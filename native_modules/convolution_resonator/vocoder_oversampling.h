#pragma once
#include "vocoder_stft.h"
#include "../vocoder/resampler_2x.h"

namespace convolution_resonator {
using soemdsp_vocoder::Resampler2x;
struct OversampledVocoder {
  static constexpr int filterLatency = Resampler2x::filterLatency;
  CrunchVocoderT<2> core;
  Resampler2x resampler;
  double right;
  void reset() { core.reset(); resampler.reset(); right = 0; }
  double tick(double left, double rightInput, double carrier, double shift,
    double crunch, double response, double bandwidth, bool unity = false) {
    double high[2][3]; resampler.upsample(left, rightInput, carrier, high);
    double result[2]{};
    for (int phase = 0; phase < 2; ++phase) {
      const double value = core.tick(high[phase][0], high[phase][1], high[phase][2], shift,
        crunch, response, bandwidth, unity);
      resampler.downsample(phase, value, core.right, result);
    }
    right = result[1];
    return result[0];
  }
};
}
