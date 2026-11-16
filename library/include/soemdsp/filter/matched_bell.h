// Decramped (analog-matched) bell and shelves.
//
// The RBJ cookbook filters are the bilinear transform of analog prototypes, so their shapes are squashed toward Nyquist
// ("cramped"): a bell near 15 kHz is up to ~7 dB off the analog curve at 44.1 kHz. These designs keep the analog
// prototype and fit a biquad to its magnitude:
//   poles      impulse-invariant image of the analog poles (z = exp(s / fs))
//   numerator  chosen so |H| equals the analog magnitude at DC, at f0 and at Nyquist, minimum phase
// Magnitude only: phase is not matched. A cut (dB < 0) is the exact reciprocal of the boost (for the bell and for both
// shelves), so it is designed as a boost and inverted (poles and zeros swap), which gives cuts the same accuracy.
//
// Analog prototypes (A = 10^(dB/40), s = j f / f0), RBJ:
//   bell        (s^2 + s A/Q + 1)              / (s^2 + s/(A Q) + 1)
//   low shelf   A (s^2 + s sqrt(A)/Q + A)      / (A s^2 + s sqrt(A)/Q + 1)
//   high shelf  A (A s^2 + s sqrt(A)/Q + 1)    / (s^2 + s sqrt(A)/Q + A)
//
// Verified against the analog prototypes by scripts/test_matched_bell.mjs (JS mirror in node-graph-cookbook-filter.js).
#pragma once

#include <soemdsp/constant/constant.h>
#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/math/analog_filter_trig.h>

namespace soemdsp_maths {

struct MatchedBellCoeffs {
  double b0, b1, b2, a1, a2;  // y = b0 x + b1 x1 + b2 x2 - a1 y1 - a2 y2
};

enum MatchedShape { kMatchedBell = 0, kMatchedLowShelf = 1, kMatchedHighShelf = 2 };

// |H|^2 of the analog prototype at x = f / f0.
static inline double matched_analog_mag2(int shape, double x, double A, double Q) {
  const double x2 = x * x;
  const double sA = sqrt_newton(A);
  double nr, ni, dr, di;
  if (shape == kMatchedBell) {
    nr = 1.0 - x2; ni = x * A / Q; dr = 1.0 - x2; di = x / (A * Q);
  } else if (shape == kMatchedLowShelf) {
    nr = A * (A - x2); ni = A * x * sA / Q; dr = 1.0 - A * x2; di = x * sA / Q;
  } else {
    nr = A * (1.0 - A * x2); ni = A * x * sA / Q; dr = A - x2; di = x * sA / Q;
  }
  const double den = dr * dr + di * di;
  return den > 1.0e-300 ? (nr * nr + ni * ni) / den : 1.0e300;
}

// |H|^2 of a biquad (b0..b2 over 1, a1, a2) at w.
static inline double matched_biquad_mag2(const MatchedBellCoeffs& k, double w) {
  double c1 = 0.0, s1 = 0.0, c2 = 0.0, s2 = 0.0;
  dsp_sin_cos(w, &s1, &c1);
  dsp_sin_cos(2.0 * w, &s2, &c2);
  const double nr = k.b0 + k.b1 * c1 + k.b2 * c2, ni = -(k.b1 * s1 + k.b2 * s2);
  const double dr = 1.0 + k.a1 * c1 + k.a2 * c2, di = -(k.a1 * s1 + k.a2 * s2);
  const double den = dr * dr + di * di;
  return den > 1.0e-300 ? (nr * nr + ni * ni) / den : 1.0e300;
}

// Fits a minimum-phase numerator to the analog magnitude at DC, f0 and Nyquist for the given poles (boost form).
static inline bool matched_fit(int shape, double a1, double a2, double w0, double A, double q, MatchedBellCoeffs& out) {
  const double sh = dsp_sin(0.5 * w0);
  const double phiC = sh * sh;
  const double B0 = (1.0 + a1 + a2) * (1.0 + a1 + a2);
  const double B1 = -4.0 * (a1 + 4.0 * a2 + a1 * a2);
  const double B2 = 16.0 * a2;
  const double T0 = matched_analog_mag2(shape, 0.0, A, q);
  const double y0 = T0 * B0;
  const double y1 = matched_analog_mag2(shape, 1.0, A, q) * (B0 + B1 * phiC + B2 * phiC * phiC);
  const double y2 = matched_analog_mag2(shape, kPi / w0, A, q) * (B0 + B1 + B2);
  const double N2 = ((y2 - y0) - (y1 - y0) / phiC) / (1.0 - phiC);
  const double N1 = (y1 - y0) / phiC - N2 * phiC;
  const double S = sqrt_newton(T0) * (1.0 + a1 + a2);  // b0 + b1 + b2
  const double P = -(N1 + N2) / 4.0;                   // b1 * (b0 + b2)
  const double bb = N2 / 16.0;                         // b0 * b2
  const double disc = S * S - 4.0 * P;
  if (disc < 0.0) return false;
  const double rd = sqrt_newton(disc);
  for (int i = 0; i < 2; i += 1) {
    const double v = 0.5 * (S + (i == 0 ? rd : -rd));  // b1
    const double u = S - v;                             // b0 + b2
    const double d2 = u * u - 4.0 * bb;
    if (d2 < 0.0) continue;
    const double rd2 = sqrt_newton(d2);
    for (int j = 0; j < 2; j += 1) {
      const double b0 = 0.5 * (u + (j == 0 ? rd2 : -rd2));
      const double b2 = u - b0;
      // Minimum phase: zeros of b0 z^2 + b1 z + b2 inside the unit circle.
      if (!(b0 > 1.0e-12)) continue;
      const double ab2 = b2 < 0.0 ? -b2 : b2;
      const double ab1 = v < 0.0 ? -v : v;
      if (!(ab2 < b0 && ab1 < b0 + b2)) continue;
      out.b0 = b0; out.b1 = v; out.b2 = b2; out.a1 = a1; out.a2 = a2;
      return true;
    }
  }
  return false;
}

// Worst |ln(|H|^2 / analog |H|^2)| over a few probe frequencies.
static inline double matched_probe_error(int shape, const MatchedBellCoeffs& k, double w0, double A, double q) {
  static const double kProbe[8] = {0.04, 0.10, 0.20, 0.35, 0.5, 0.65, 0.8, 0.95};
  double worst = 0.0;
  for (int i = 0; i < 8; i += 1) {
    const double w = kPi * kProbe[i];
    const double r = matched_biquad_mag2(k, w) / matched_analog_mag2(shape, w / w0, A, q);
    const double e = dsp_ln(r > 1.0e-30 ? r : 1.0e-30);
    const double ae = e < 0.0 ? -e : e;
    if (ae > worst) worst = ae;
  }
  return worst;
}

// Returns false when the design does not apply (invalid input, centre too close to Nyquist, no minimum-phase
// solution); the caller then uses its plain bilinear coefficients.
//
// Two pole sets are tried and the one closer to the analog curve is kept: the impulse-invariant image of the analog
// poles (best almost everywhere), and the bilinear (RBJ) poles, which win when the analog poles sit near or above
// Nyquist (a high shelf centred above ~12 kHz).
static inline bool matched_design(int shape, double freqHz, double q, double gainDb, double rate, MatchedBellCoeffs& out) {
  if (!(rate > 1.0) || !(freqHz > 0.0) || !(q > 0.0)) return false;
  const double absDb = gainDb < 0.0 ? -gainDb : gainDb;
  if (!(absDb > 1.0e-6)) {
    out.b0 = 1.0; out.b1 = 0.0; out.b2 = 0.0; out.a1 = 0.0; out.a2 = 0.0;
    return true;
  }
  double w0 = kTwoPi * freqHz / rate;
  if (w0 > kPi * 0.999) w0 = kPi * 0.999;
  const double A = dsp_exp(0.05756462732485115 * absDb);  // 10^(dB/40)
  const double sh = dsp_sin(0.5 * w0);
  const double phiC = sh * sh;
  if (!(1.0 - phiC > 1.0e-3) || !(phiC > 1.0e-12)) return false;

  // 1) impulse-invariant poles: analog s^2 + 2 zeta wn s + wn^2, scaled by w0 and mapped with z = exp(s).
  double wn, zeta;
  if (shape == kMatchedBell) { wn = 1.0; zeta = 1.0 / (2.0 * A * q); }
  else if (shape == kMatchedLowShelf) { wn = 1.0 / sqrt_newton(A); zeta = 1.0 / (2.0 * q); }
  else { wn = sqrt_newton(A); zeta = 1.0 / (2.0 * q); }
  double ia1, ia2;
  if (zeta < 1.0) {
    const double r = dsp_exp(-zeta * wn * w0);
    const double wd = wn * w0 * sqrt_newton(1.0 - zeta * zeta);
    double snd = 0.0, csd = 0.0;
    dsp_sin_cos(wd, &snd, &csd);
    ia1 = -2.0 * r * csd;
    ia2 = r * r;
  } else {
    const double d = sqrt_newton(zeta * zeta - 1.0);
    const double p1 = dsp_exp(wn * w0 * (-zeta + d));
    const double p2 = dsp_exp(wn * w0 * (-zeta - d));
    ia1 = -(p1 + p2);
    ia2 = p1 * p2;
  }
  // 2) bilinear (RBJ) poles.
  double sn = 0.0, cs = 0.0;
  dsp_sin_cos(w0, &sn, &cs);
  double ba1, ba2;
  if (shape == kMatchedBell) {
    const double alpha = sn / (2.0 * q);
    const double a0 = 1.0 + alpha / A;
    ba1 = -2.0 * cs / a0;
    ba2 = (1.0 - alpha / A) / a0;
  } else {
    const double beta = sqrt_newton(A) / q;
    if (shape == kMatchedLowShelf) {
      const double a0 = (A + 1.0) + (A - 1.0) * cs + beta * sn;
      ba1 = -2.0 * ((A - 1.0) + (A + 1.0) * cs) / a0;
      ba2 = ((A + 1.0) + (A - 1.0) * cs - beta * sn) / a0;
    } else {
      const double a0 = (A + 1.0) - (A - 1.0) * cs + beta * sn;
      ba1 = 2.0 * ((A - 1.0) - (A + 1.0) * cs) / a0;
      ba2 = ((A + 1.0) - (A - 1.0) * cs - beta * sn) / a0;
    }
  }

  MatchedBellCoeffs best = {1.0, 0.0, 0.0, 0.0, 0.0};
  MatchedBellCoeffs cand = best;
  bool have = false;
  double bestErr = 0.0;
  for (int k = 0; k < 2; k += 1) {
    if (!matched_fit(shape, k == 0 ? ia1 : ba1, k == 0 ? ia2 : ba2, w0, A, q, cand)) continue;
    const double e = matched_probe_error(shape, cand, w0, A, q);
    if (!have || e < bestErr) { best = cand; bestErr = e; have = true; }
  }
  if (!have) return false;

  if (gainDb >= 0.0) {
    out = best;
  } else {
    out.b0 = 1.0 / best.b0; out.b1 = best.a1 / best.b0; out.b2 = best.a2 / best.b0;
    out.a1 = best.b1 / best.b0; out.a2 = best.b2 / best.b0;
  }
  return true;
}

static inline bool matched_bell_design(double freqHz, double q, double gainDb, double rate, MatchedBellCoeffs& out) {
  return matched_design(kMatchedBell, freqHz, q, gainDb, rate, out);
}

}  // namespace soemdsp_maths
