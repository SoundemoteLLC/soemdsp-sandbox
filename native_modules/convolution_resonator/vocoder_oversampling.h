#pragma once
#include "vocoder_stft.h"

namespace convolution_resonator {
// 257-tap symmetric Blackman halfband. Polyphase interpolation and decimation
// each contribute 64 base-rate samples, for a 128-sample combined delay.
struct HalfbandCoefficients {
  double odd[128];
  bool ready;
  void ensure() {
    if (ready) return;
    double sum = 0;
    for (int k = 0; k < 128; ++k) {
      const int j = 2 * k + 1, d = j - 128;
      const double angle = soemdsp_maths::kTwoPi * j / 256;
      const double window = 0.42 - 0.5 * soemdsp_maths::dsp_cos(angle)
        + 0.08 * soemdsp_maths::dsp_cos(2 * angle);
      odd[k] = soemdsp_maths::dsp_sin(soemdsp_maths::kPi * d / 2) / (soemdsp_maths::kPi * d) * window;
      sum += odd[k];
    }
    for (auto& coefficient : odd) coefficient *= 0.5 / sum;
    ready = true;
  }
};
inline HalfbandCoefficients halfband{};
struct OversampledVocoder {
  static constexpr int filterLatency = 128;
  CrunchVocoderT<2> core;
  double input[3][128], output[2][512];
  int upPosition, downPosition;
  double right;
  void reset() {
    core.reset(); halfband.ensure();
    for (auto& channel : input) for (auto& sample : channel) sample = 0;
    for (auto& channel : output) for (auto& sample : channel) sample = 0;
    upPosition = downPosition = 0; right = 0;
  }
  double tick(double left, double rightInput, double carrier, double shift,
    double crunch, double response, double bandwidth, bool unity = false) {
    input[0][upPosition] = left; input[1][upPosition] = rightInput; input[2][upPosition] = carrier;
    double high[2][3];
    for (int c = 0; c < 3; ++c) {
      high[0][c] = input[c][(upPosition - 64) & 127];
      high[1][c] = 0;
      for (int k = 0; k < 128; ++k)
        high[1][c] += 2 * halfband.odd[k] * input[c][(upPosition - k) & 127];
    }
    upPosition = (upPosition + 1) & 127;
    double result[2]{};
    for (int phase = 0; phase < 2; ++phase) {
      output[0][downPosition] = core.tick(high[phase][0], high[phase][1], high[phase][2], shift,
        crunch, response, bandwidth, unity);
      output[1][downPosition] = core.right;
      if (phase == 0) for (int c = 0; c < 2; ++c) {
        result[c] = 0.5 * output[c][(downPosition - 128) & 511];
        for (int k = 0; k < 128; ++k)
          result[c] += halfband.odd[k] * output[c][(downPosition - 2 * k - 1) & 511];
      }
      downPosition = (downPosition + 1) & 511;
    }
    right = result[1];
    return result[0];
  }
};
}
