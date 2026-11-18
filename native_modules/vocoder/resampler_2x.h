#pragma once
#include <soemdsp/math/exp_log.h>
#include <soemdsp/math/analog_filter_trig.h>

namespace soemdsp_vocoder {
// 257-tap Blackman halfband; interpolation + decimation delay is 128 samples.
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
template<int Channels> struct Resampler2xT {
  static constexpr int filterLatency = 128;
  double input[Channels][128], output[2][512];
  int upPosition, downPosition;
  void reset() {
    halfband.ensure();
    for (auto& channel : input) for (auto& sample : channel) sample = 0;
    for (auto& channel : output) for (auto& sample : channel) sample = 0;
    upPosition = downPosition = 0;
  }
  void upsample(const double source[Channels], double high[2][Channels]) {
    for (int c = 0; c < Channels; ++c) {
      input[c][upPosition] = source[c];
      high[0][c] = input[c][(upPosition - 64) & 127];
      high[1][c] = 0;
      for (int k = 0; k < 128; ++k)
        high[1][c] += 2 * halfband.odd[k] * input[c][(upPosition - k) & 127];
    }
    upPosition = (upPosition + 1) & 127;
  }
  void upsample(double left, double right, double carrier, double high[2][3]) {
    static_assert(Channels == 3);
    const double source[3] = {left, right, carrier};
    upsample(source, high);
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
using Resampler2x = Resampler2xT<3>;
}
