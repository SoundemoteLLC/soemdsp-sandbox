// Shared comb loop core (docs/COMB_PLUCK_PLAN.md): Thiran fractional delay,
// loop one-pole damping, feedback gain from Decay. Header-only, freestanding,
// opt-in (not pulled in by soemdsp.hpp). Used by Comb Resonator (effect) and
// Comb Pluck (generator) so both ring identically.
//   D    = fs / f (fractional, Thiran allpass on the fraction)
//   g    = exp(-D / (tau * fs))       (tau = Decay, seconds to 1/e)
//   loop = one-pole lowpass, coef = damping^2 (0 = bright, 1 = dark)
//   Low Cut (Comb Resonator) = one-pole highpass on the input, outside the
//          loop, so it shapes what excites the comb without touching tuning
//          or Decay (Comb Pluck's Low Cut is on its exciter instead).
//   DC trap (+ polarity Feedback only): the loop writes y - m, m = the mean
//          of the last D written samples (one loop period). A periodic
//          partial has zero mean over its own period, so every harmonic of
//          f passes untouched (no pitch, gain or phase change); only the
//          0 Hz "resonance" is removed (DC loop gain g/2 instead of g, so
//          DC can never pile up). Running sum, O(1) per sample.
// The caller owns the buffer (shared memory pool block) and the write policy.
// No clip or level limit anywhere in the loop or output: a loud input (or Hold)
// may ring as loud as it likes. The only guard is comb_nonfinite_reset: a NaN
// / Inf sum (or a value too big for the float delay line) zeroes the comb; the
// output stage (Speaker Protection) mutes bad audio downstream.
#pragma once

#include <soemdsp/soemdsp.hpp>

namespace soemdsp::comb {

struct CombCore {
  float* buffer;  // capacity floats (caller-owned)
  int capacity;
  int writeIndex;
  int filled;
  double lp;
  double thiranX1;
  double thiranY1;
  double hpX1;     // Low Cut input highpass state (Comb Resonator)
  double hpY1;
  double dcSum;    // DC trap: sum of the last dcN written samples
  int dcN;
  int dcResum;     // samples until dcSum is re-added from scratch (float drift)
};

static inline void comb_reset_state(CombCore* s) {
  s->writeIndex = 0;
  s->filled = 0;
  s->lp = 0.0;
  s->thiranX1 = 0.0;
  s->thiranY1 = 0.0;
  s->hpX1 = 0.0;
  s->hpY1 = 0.0;
  s->dcSum = 0.0;
  s->dcN = 0;
  s->dcResum = 0;
}

// Zero the loop (Choke). Only the written part of the buffer needs clearing.
static inline void comb_clear(CombCore* s) {
  const int n = s->filled < s->capacity ? s->filled : s->capacity;
  for (int i = 0; i < n; i++) s->buffer[i] = 0.0f;
  if (s->filled >= s->capacity) {
    for (int i = n; i < s->capacity; i++) s->buffer[i] = 0.0f;
  }
  comb_reset_state(s);
}

// Size the loop for the sample rate: rate * maxSeconds + 8, in [64, maxCapacity].
static inline void comb_ensure_buffer(CombCore* s, double sampleRate, double maxSeconds, int maxCapacity) {
  const double rate = soemdsp_maths::maxd(1.0, sampleRate);
  int capacity = (int)(rate * maxSeconds) + 8;
  if (capacity < 64) capacity = 64;
  if (capacity > maxCapacity) capacity = maxCapacity;
  if (s->capacity != capacity) {
    s->capacity = capacity;
    comb_reset_state(s);
    for (int i = 0; i < capacity; i++) s->buffer[i] = 0.0f;
  }
}

static inline double comb_read_int(const CombCore* s, int delayInt) {
  const int capacity = s->capacity;
  if (capacity < 2 || s->filled <= 0) return 0.0;
  int d = delayInt;
  if (d < 1) d = 1;
  if (d > capacity - 2) d = capacity - 2;
  int i = s->writeIndex - d;
  i %= capacity;
  if (i < 0) i += capacity;
  return (double)s->buffer[i];
}

static inline double comb_thiran(CombCore* s, double x, double frac) {
  double d = frac;
  if (d < 1e-12) {
    s->thiranX1 = x;
    s->thiranY1 = x;
    return x;
  }
  if (d > 0.999999) d = 0.999999;
  const double a = (1.0 - d) / (1.0 + d);
  const double y = a * x + s->thiranX1 - a * s->thiranY1;
  s->thiranX1 = x;
  s->thiranY1 = soemdsp_maths::safe(y);
  return s->thiranY1;
}

static inline double comb_read_frac(CombCore* s, double delaySamples) {
  const int capacity = s->capacity;
  if (capacity < 2) return 0.0;
  double D = delaySamples;
  if (D < 2.0) D = 2.0;
  if (D > (double)(capacity - 2)) D = (double)(capacity - 2);
  const int dInt = (int)soemdsp_maths::dsp_floor(D);
  const double frac = D - (double)dInt;
  return comb_thiran(s, comb_read_int(s, dInt), frac);
}

static inline double comb_feedback_gain(double decaySec, double delaySamples, double rate, int hold) {
  if (hold) return 1.0 - 1e-12;
  const double D = soemdsp_maths::maxd(1.0, delaySamples);
  const double tau = soemdsp_maths::maxd(1e-6, decaySec);
  double g = soemdsp_maths::dsp_exp(-D / (tau * rate));
  if (!(g >= 0.0) || g * 0.0 != 0.0) g = 0.0;
  if (g > 1.0 - 1e-12) g = 1.0 - 1e-12;
  return g;
}

static inline double comb_loop_filter(CombCore* s, double x, double damping) {
  const double d = soemdsp_maths::clamp(damping, 0.0, 1.0);
  if (d <= 1e-9) {
    s->lp = x;
    return x;
  }
  const double coef = d * d;
  const double a = 1.0 - coef;
  s->lp += a * (x - s->lp);
  s->lp = soemdsp_maths::safe(s->lp);
  return s->lp;
}

// Loop delay in samples for frequency f (f floored at minHz, capped at 0.499 fs,
// D kept inside the buffer). *outRate gets the safe sample rate.
static inline double comb_delay_samples(const CombCore* s, double frequencyHz, double sampleRate, double minHz) {
  const double rate = soemdsp_maths::maxd(1.0, sampleRate);
  double f0 = soemdsp_maths::safe(frequencyHz);
  if (f0 < minHz) f0 = minHz;
  if (f0 > rate * 0.499) f0 = rate * 0.499;
  double delaySamples = rate / f0;
  if (delaySamples < 2.0) delaySamples = 2.0;
  if (delaySamples > (double)(s->capacity - 2)) delaySamples = (double)(s->capacity - 2);
  return delaySamples;
}

// ---- Low Cut (Comb Resonator input highpass) ----

// Pole of the one-pole highpass y = a (y1 + x - x1) for a cutoff in Hz
// (a = 1 is the identity).
static inline double comb_hp_coef(double lowCutHz, double rate) {
  double fc = soemdsp_maths::safe(lowCutHz);
  if (fc < 0.0) fc = 0.0;
  if (fc > rate * 0.45) fc = rate * 0.45;
  return soemdsp_maths::dsp_exp(-6.283185307179586 * fc / rate);
}

static inline double comb_highpass(CombCore* s, double x, double a) {
  const double y = a * (s->hpY1 + x - s->hpX1);
  s->hpX1 = x;
  s->hpY1 = soemdsp_maths::safe(y);
  return s->hpY1;
}

// ---- DC trap (period mean) ----

// Mean of the last D written samples, D fractional: trapezoid integral of the
// written signal over exactly D samples (linear between samples), divided by
// D. Exact for DC; for a loop harmonic (period D / k) the error is second
// order in k / D, so the trap leaves pitch and decay alone (a plain N-sample
// sum plus a frac-weighted tail is only first order and audibly detunes /
// shortens high notes). Keeps a running sum of M = floor(D) + 1 samples,
// O(|dM|) when D moves.
static inline double comb_dc_mean(CombCore* s, double delaySamples) {
  const double D = delaySamples > 1.0 ? delaySamples : 1.0;
  int N = (int)soemdsp_maths::dsp_floor(D);
  if (N > s->capacity - 5) N = s->capacity - 5;
  if (N < 1) N = 1;
  const int M = N + 1;
  if (s->dcResum <= 0) {
    double sum = 0.0;
    for (int i = 1; i <= M; i++) sum += comb_read_int(s, i);
    s->dcSum = sum;
    s->dcN = M;
    s->dcResum = 8192;
  }
  while (s->dcN < M) { s->dcN += 1; s->dcSum += comb_read_int(s, s->dcN); }
  while (s->dcN > M) { s->dcSum -= comb_read_int(s, s->dcN); s->dcN -= 1; }
  double fr = D - (double)N;
  if (fr < 0.0) fr = 0.0;
  const double w1 = comb_read_int(s, 1);
  const double wM = comb_read_int(s, M);
  const double wEnd = wM + fr * (comb_read_int(s, M + 1) - wM);
  const double area = s->dcSum - 0.5 * (w1 + wM) + 0.5 * fr * (wM + wEnd);
  return area / ((double)N + fr);
}

// Write one loop sample and slide the DC window by one.
static inline void comb_write_dc(CombCore* s, float v) {
  if (s->dcN > 0) s->dcSum += (double)v - comb_read_int(s, s->dcN);
  s->dcResum -= 1;
  s->buffer[s->writeIndex] = v;
  s->writeIndex = (s->writeIndex + 1) % s->capacity;
  if (s->filled < s->capacity) s->filled += 1;
}

// Non-finite guard. y = this sample's loop sum, w = the value about to be
// written to the delay line. If either is NaN / Inf, or w overflows float,
// zero the whole comb (delay buffer, damping filter, Thiran state) and return
// true: the caller outputs 0 and skips the write. No level-based limiting.
static inline bool comb_nonfinite_reset(CombCore* s, double y, double w) {
  const double wf = (double)(float)w;
  if (soemdsp::debug::is_bad(y) || soemdsp::debug::is_bad(wf)) {
    comb_clear(s);
    return true;
  }
  return false;
}

static inline void comb_write(CombCore* s, float v) {
  s->dcResum = 0;  // the DC window is not slid here: re-add it when the trap runs again
  s->buffer[s->writeIndex] = v;
  s->writeIndex = (s->writeIndex + 1) % s->capacity;
  if (s->filled < s->capacity) s->filled += 1;
}

}  // namespace soemdsp::comb
