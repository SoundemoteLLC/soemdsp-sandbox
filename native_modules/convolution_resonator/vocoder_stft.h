#pragma once
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/exp_log.h>

namespace convolution_resonator {
constexpr int kFrame = 512, kHop = kFrame / 4;
inline soemdsp::fft::Radix2<kFrame> fft{};
struct VocoderStft {
  float input[3][kFrame], ola[2][kFrame];
  float carrierRe[kFrame], carrierIm[kFrame], re[kFrame], im[kFrame];
  float envelope[kFrame / 2 + 1], window[kFrame];
  int position, hop;
  double right;

  void reset() {
    position = hop = 0; right = 0;
    fft.ensure();
    for (int i = 0; i < kFrame; ++i) {
      for (auto& channel : input) channel[i] = 0;
      for (auto& channel : ola) channel[i] = 0;
      window[i] = i == kFrame / 2 ? 1.0f
        : 0.5f - 0.5f * fft.twRe[i < kFrame / 2 ? i : kFrame - i];
    }
  }

  void frame(double shift, bool unityEnvelope) {
    for (int i = 0; i < kFrame; ++i) {
      carrierRe[i] = input[2][(position + 1 + i) % kFrame] * window[i];
      carrierIm[i] = 0;
    }
    fft.transform(carrierRe, carrierIm, false);
    const double ratio = soemdsp_maths::dsp_exp(shift * (0.6931471805599453 / 12));
    for (int c = 0; c < 2; ++c) {
      for (int i = 0; i < kFrame; ++i) {
        re[i] = input[c][(position + 1 + i) % kFrame] * window[i];
        im[i] = 0;
      }
      fft.transform(re, im, false);
      for (int k = 0; k <= kFrame / 2; ++k)
        envelope[k] = __builtin_sqrt((double)re[k] * re[k] + (double)im[k] * im[k]) * (4.0 / kFrame);
      for (int k = 0; k <= kFrame / 2; ++k) {
        const double source = k / ratio;
        double gain = 0;
        if (unityEnvelope) gain = 1;
        else if (k > 0 && k < kFrame / 2 && source >= 1 && source < kFrame / 2) {
          const int index = (int)source;
          const double fraction = source - index;
          const double a = envelope[index], b = envelope[index + 1];
          gain = fraction == 0 ? a : (a > 0 && b > 0
            ? soemdsp_maths::dsp_exp(soemdsp_maths::dsp_ln(a)
              + fraction * (soemdsp_maths::dsp_ln(b) - soemdsp_maths::dsp_ln(a)))
            : a + fraction * (b - a));
        }
        re[k] = (float)(carrierRe[k] * gain); im[k] = (float)(carrierIm[k] * gain);
        if (k > 0 && k < kFrame / 2) { re[kFrame - k] = re[k]; im[kFrame - k] = -im[k]; }
      }
      fft.transform(re, im, true);
      // Four periodic Hann-squared windows sum to 3/2. Frames are scheduled
      // one sample ahead, giving an exact, fixed 512-sample streaming delay.
      for (int i = 0; i < kFrame; ++i)
        ola[c][(position + 1 + i) % kFrame] += re[i] * window[i] * (2.0f / 3.0f);
    }
  }

  double tick(double left, double rightInput, double carrier, double shift, bool unityEnvelope = false) {
    const double result = ola[0][position]; right = ola[1][position];
    ola[0][position] = ola[1][position] = 0;
    input[0][position] = (float)left; input[1][position] = (float)rightInput;
    input[2][position] = (float)carrier;
    if (++hop == kHop) { hop = 0; frame(shift, unityEnvelope); }
    position = (position + 1) % kFrame;
    return result;
  }
};
}
