#pragma once
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/math/scalar_helpers.h>

namespace soemdsp::allpass {
// FlatZapper/Robin distribution and coefficient conventions, shared by effect and instrument.
inline double distribution(double x,double shape) {
  const double sl=soemdsp_maths::dsp_exp(.6931471805599453*shape);
  return soemdsp_maths::rational_curve01(x,(sl-1)/(sl+1));
}
struct Coefficients {double b0,b1,b2,inner;};
inline Coefficients one_pole(double f,double rate) {
  double sn,cs;soemdsp_maths::dsp_sin_cos_turns(.5*f/rate,&sn,&cs);
  return {(sn-cs)/(sn+cs),1,0,1};
}
inline Coefficients biquad(double f,double q,double rate) {
  double sh,ch;soemdsp_maths::dsp_sin_cos_turns(.5*f/rate,&sh,&ch);
  const double sine=2*sh*ch,cosine=1-2*sh*sh,alpha=sine/(2*q);
  const double rec=1/(1+alpha);
  if(!__builtin_isfinite(alpha))return {-1,0,1,-cosine};
  return {(1-alpha)*rec,-2*cosine*rec,(1+alpha)*rec,-cosine};
}
}
