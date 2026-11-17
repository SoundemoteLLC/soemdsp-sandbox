// Shared drum noise shaper (Modal Snare wires, Electro Hat noise source).
// Const-peak TPT band-pass at freq/Q, then a one-pole tilt split at freq.
// tilt +1 doubles the highs, -1 keeps only the lows, 0 = plain band-pass.
#pragma once

#include <soemdsp/filter/tpt_svf.h>
#include <soemdsp/drum/drum_parts.h>

namespace soemdsp::drum {

struct NoiseShape {
  soemdsp_maths::TptSvfState svf;
  double lp;  // one-pole tilt split
};

static inline void noise_shape_reset(NoiseShape& s) {
  soemdsp_maths::tpt_svf_reset(s.svf);
  s.lp = 0.0;
}

static inline double noise_shape_tick(NoiseShape& s, double n, double freq, double q, double tilt, double sr) {
  soemdsp_maths::TptSvfCoeffs k;
  soemdsp_maths::tpt_svf_setup_bandpass_const_peak(k, (2.0 * soemdsp_maths::kPi) * freq / sr, q);
  const double bp = soemdsp_maths::tpt_svf_tick(s.svf, k, n);
  s.svf.z1 = planck_snap(s.svf.z1);
  s.svf.z2 = planck_snap(s.svf.z2);
  const double hpT = bp - one_pole_lp_tick(s.lp, bp, freq, sr);
  return (tilt != 0.0) ? bp + tilt * hpT : bp;
}

}  // namespace soemdsp::drum
