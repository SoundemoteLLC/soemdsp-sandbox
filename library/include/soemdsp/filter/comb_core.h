// Shared comb loop core (docs/COMB_PLUCK_PLAN.md): Thiran fractional delay,
// loop one-pole damping, feedback gain from Decay. Header-only, freestanding,
// opt-in (not pulled in by soemdsp.hpp). Used by Comb Resonator (effect) and
// Comb Pluck (generator) so both ring identically.
//   D    = fs / f (fractional, Thiran allpass on the fraction)
//   g    = exp(-D / (tau * fs))       (tau = Decay, seconds to 1/e)
//   loop = one-pole lowpass, coef = damping^2 (0 = bright, 1 = dark)
// The caller owns the buffer (shared memory pool block) and the write policy.
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
};

static inline void comb_reset_state(CombCore* s) {
  s->writeIndex = 0;
  s->filled = 0;
  s->lp = 0.0;
  s->thiranX1 = 0.0;
  s->thiranY1 = 0.0;
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

static inline void comb_write(CombCore* s, float v) {
  s->buffer[s->writeIndex] = v;
  s->writeIndex = (s->writeIndex + 1) % s->capacity;
  if (s->filled < s->capacity) s->filled += 1;
}

}  // namespace soemdsp::comb
