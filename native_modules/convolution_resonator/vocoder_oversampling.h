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
struct Resampler2x {
  static constexpr int filterLatency = 128;
  double input[3][128], output[2][512];
  int upPosition, downPosition;
  void reset() {
    halfband.ensure();
    for (auto& channel : input) for (auto& sample : channel) sample = 0;
    for (auto& channel : output) for (auto& sample : channel) sample = 0;
    upPosition = downPosition = 0;
  }
  void upsample(double left, double rightInput, double carrier, double high[2][3]) {
    input[0][upPosition] = left; input[1][upPosition] = rightInput; input[2][upPosition] = carrier;
    for (int c = 0; c < 3; ++c) {
      high[0][c] = input[c][(upPosition - 64) & 127];
      high[1][c] = 0;
      for (int k = 0; k < 128; ++k)
        high[1][c] += 2 * halfband.odd[k] * input[c][(upPosition - k) & 127];
    }
    upPosition = (upPosition + 1) & 127;
  }
  void downsample(int phase, double left, double right, double result[2]) {
    output[0][downPosition] = left; output[1][downPosition] = right;
    if (phase == 0) for (int c = 0; c < 2; ++c) {
      result[c] = 0.5 * output[c][(downPosition - 128) & 511];
      for (int k = 0; k < 128; ++k)
        result[c] += halfband.odd[k] * output[c][(downPosition - 2 * k - 1) & 511];
    }
    downPosition = (downPosition + 1) & 511;
  }
};
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
