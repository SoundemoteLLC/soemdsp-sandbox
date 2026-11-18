#pragma once
#include "vocoder_oversampling.h"
#include <soemdsp/filter/tpt_svf.h>

namespace convolution_resonator {
// Listening proof: 32 overlapping constant-peak bandpasses, rectification,
// one-pole envelopes, and multiplication onto corresponding carrier bands.
struct FilterBankCore {
  static constexpr int count = 32;
  struct Band {
    soemdsp_maths::TptSvfCoeffs analysis, synthesis;
    soemdsp_maths::TptSvfState voice[2], carrier;
    double envelope[2], gain;
  } bands[count];
  double lastRate, lastWidth, lastShift, lastResponse, pole, right;
  void reset() {
    for (auto& band : bands) {
      for (auto& state : band.voice) soemdsp_maths::tpt_svf_reset(state);
      soemdsp_maths::tpt_svf_reset(band.carrier);
      band.envelope[0] = band.envelope[1] = 0;
    }
    lastRate = lastWidth = lastShift = lastResponse = -1; right = 0;
  }
  void configure(double baseRate, double width, double shift, double response) {
    using namespace soemdsp_maths;
    const bool rateChanged = baseRate != lastRate;
    if (rateChanged || response != lastResponse) {
      pole = response > 0 ? dsp_exp(-1 / (response * 2 * baseRate)) : 0;
      lastResponse = response;
    }
    if (!rateChanged && width == lastWidth && shift == lastShift) return;
    // Nominal octave bandwidth maps to Q. Bilinear warping narrows digital
    // width near Nyquist; there is no hidden overlap or gain compensation.
    const double edge = dsp_exp(0.5 * 0.6931471805599453 * width);
    double r = edge - 1 / edge;
    if (r < 1e-9) r = 1e-9; // positive damping is a filter stability condition
    const double ratio = dsp_exp(shift * (0.6931471805599453 / 12));
    const double low = 40, high = baseRate * 0.45;
    for (int i = 0; i < count; ++i) {
      auto& band = bands[i];
      const double hz = low * dsp_exp(dsp_ln(high / low) * i / (count - 1));
      const double destination = hz * ratio, nyquist = baseRate * 0.5;
      tpt_svf_setup(band.analysis, kTwoPi * hz / (2 * baseRate), r, 0, r, 0, 1);
      double fade = (nyquist - destination) / (0.2 * nyquist);
      if (fade < 0) fade = 0;
      if (fade > 1) fade = 1;
      band.gain = fade * fade * (3 - 2 * fade);
      // Unrepresentable synthesis bands fade out; never wrap across Nyquist.
      const double tuned = destination < nyquist ? destination : nyquist;
      tpt_svf_setup(band.synthesis, kTwoPi * tuned / (2 * baseRate), r, 0, r, 0, 1);
      if (band.gain == 0) tpt_svf_reset(band.carrier);
    }
    lastRate = baseRate; lastWidth = width; lastShift = shift;
  }
  double tick(double left, double rightInput, double carrier) {
    double out[2]{}, input[2] = {left, rightInput};
    for (auto& band : bands) {
      const double synthesis = band.gain == 0 ? 0 : soemdsp_maths::tpt_svf_tick(band.carrier, band.synthesis, carrier) * band.gain;
      for (int c = 0; c < 2; ++c) {
        const double analysis = soemdsp_maths::tpt_svf_tick(band.voice[c], band.analysis, input[c]);
        band.envelope[c] = pole * band.envelope[c] + (1 - pole) * __builtin_fabs(analysis);
        // pi/2 calibrates the mean rectified amplitude of a unit sinusoid.
        out[c] += synthesis * band.envelope[c] * (soemdsp_maths::kPi * 0.5);
      }
    }
    right = out[1]; return out[0];
  }
};
struct FilterBankVocoder {
  FilterBankCore core;
  Resampler2x resampler;
  double right;
  void reset() { core.reset(); resampler.reset(); right = 0; }
  double tick(double left, double rightInput, double carrier, double rate, double width, double response, double shift) {
    core.configure(rate, width, shift, response);
    double high[2][3], result[2]{};
    resampler.upsample(left, rightInput, carrier, high);
    for (int phase = 0; phase < 2; ++phase) {
      const double value = core.tick(high[phase][0], high[phase][1], high[phase][2]);
      resampler.downsample(phase, value, core.right, result);
    }
    right = result[1]; return result[0];
  }
};
}
