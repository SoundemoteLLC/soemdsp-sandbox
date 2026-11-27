// One rule for amplitude in the whole app (HP-24): amplitude is a signed gain.
// A negative value inverts the signal at that magnitude; nothing here clamps it, because the parameter definition is the only
// source of limits (its min / max is the spawn range, and typing past it extends it). A non-finite value (NaN, Inf) reads as the
// module's own `fallback`, the one thing a module still decides.
//
// Every DSP path that applies an Amplitude / Level gain goes through soemdsp_signed_gain. scripts/test_signed_amplitude.mjs sweeps
// every module with an amplitude param and fails if -a is not +a inverted.
#ifndef SOEMDSP_SIGNED_GAIN_H
#define SOEMDSP_SIGNED_GAIN_H

static inline double soemdsp_signed_gain(double amplitude, double fallback) {
  return (amplitude * 0.0 == 0.0) ? amplitude : fallback;
}

// Magnitude and sign apart, for a path whose shape must not depend on the sign (an envelope whose attack / release pick the
// direction of travel): run it on the magnitude, then multiply the result by the sign.
static inline double soemdsp_signed_gain_sign(double gain) {
  return gain < 0.0 ? -1.0 : 1.0;
}

#endif
