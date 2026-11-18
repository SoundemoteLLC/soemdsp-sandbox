#pragma once
#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/analog_filter_trig.h>

namespace soemdsp::math {
// Freestanding phase-angle approximation, exact on the coordinate axes.
inline double atan2_approx(double y, double x) {
  if (x == 0.0 && y == 0.0) return 0.0;
  const double ax = soemdsp_maths::dsp_fabs(x), ay = soemdsp_maths::dsp_fabs(y);
  const bool steep = ay > ax;
  const double z = steep ? (ay > 0 ? ax/ay : 0) : (ax > 0 ? ay/ax : 0);
  const double z2 = z*z;
  double a = z*(0.99997726+z2*(-0.33262347+z2*(0.19354346
    +z2*(-0.11643287+z2*(0.05265332+z2*-0.01172120)))));
  if (steep) a = soemdsp_maths::kPi*0.5-a;
  if (x < 0) a = soemdsp_maths::kPi-a;
  if (y < 0) a = -a;
  return a;
}
}
