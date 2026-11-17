// Pluck exciter + strict trigger (docs/COMB_PLUCK_PLAN.md). Header-only,
// freestanding, opt-in (not pulled in by soemdsp.hpp). Shared by Comb Pluck and
// Mode Resonator so both hit the same way.
//
// Trigger: rising-edge latch with hysteresis. Fires when Trigger rises above
// kFire (0.5), re-arms when it falls below kRearm (0.4). A held gate hits once;
// note-off is silent. Velocity = the trigger's peak over the first
// kVelSamples samples after the edge (a MIDI gate carrying velocity plays
// dynamics); the burst is scaled by the running peak while it is captured.
//
// Exciter: one band-limited, zero-DC burst per hit, Width x the loop period
// long (1/f; Width, f, Shape and Soft latch at the edge):
//   Bump      sin^q(pi u) Ricker-style tap, q = 4 (Soft 1, gentle) .. 32 (Soft 0, punchy)
//   Triangle  one triangle cycle, odd harmonics k with a^(k-1)/k^2 (Soft 1 = sine)
//   Saw       one saw cycle, harmonics k with a^(k-1)/k (Soft 1 = sine, 0 = sharp saw)
//   Noise     Hann-windowed hash noise, one-pole tilt (Soft 0 = white, 1 = dark),
//             DC-blocked; made exactly zero-mean and peak 1 the same way
// a = (1 - Soft) * amax, amax = 0.01^(1/K): the top harmonic K (below the
// burst's Nyquist, at most kMaxHarmonics) sits 40 dB down.
// Every tonal shape gets m * sin^2(pi u) subtracted (m = sum(shape) / sum(sin^2)
// over the burst's samples), so it is zero-mean and still starts and ends at 0;
// then it is normalized to peak 1. Both are measured at the edge on the burst's
// own sample points (u = (i + 0.5) / n), or on kNormPoints points when longer.
//
// Retrigger: Stack = a new hit adds into the ringing resonator. Choke = the
// resonator fades out over kChokeSeconds, is cleared, then the new burst starts.
//
// Face taps: elapsed (s since the last edge, -1 before any), peak (|y| peak
// follower, kPeakRelease s), velocity (last hit), hits (edge counter).
#pragma once

#include <soemdsp/soemdsp.hpp>

namespace soemdsp::pluck {

static const double kFire = 0.5;
static const double kRearm = 0.4;
static const int kVelSamples = 16;
static const int kMaxHarmonics = 48;
static const int kNormPoints = 256;
static const double kChokeSeconds = 0.002;
static const double kPeakRelease = 0.02;

enum Shape { kBump = 0, kTriangle = 1, kSaw = 2, kNoise = 3 };

struct Exciter {
  int armed;        // 1 = the next rise above kFire hits
  // burst (latched at the edge)
  int active;
  int pending;      // Choke: burst waits for the fade
  double pos;       // samples into the burst
  double len;       // burst length, samples
  int shape;
  double soft;
  double vel;
  int velLeft;      // samples of velocity capture left
  double mean;      // tonal: Hann correction amount
  double invPeak;   // tonal: 1 / peak after correction
  double a;         // tonal: harmonic tilt
  int harmonics;    // tonal: K
  double q;         // bump exponent
  // noise
  unsigned int noiseCounter;
  unsigned int noiseStart;
  unsigned int seed;
  double nlp, nx1, nhp;
  double nlpCoef, nhpR;
  // choke
  int fadeLeft;
  int fadeLen;
  int clearNow;     // set for one sample when the fade ends
  // taps
  double elapsed;
  double peak;
  double lastVel;
  double hits;
  double peakRel;   // cached release coefficient for peakRelSr
  double peakRelSr;
  // spectral magnitude of the normalized burst at the latched f (|E(f)|), for
  // resonators that need impulse normalization (Mode Resonator).
  double specMag;
};

static inline void exciter_reset(Exciter& e, unsigned int seed) {
  e.armed = 1;
  e.active = 0;
  e.pending = 0;
  e.pos = 0.0;
  e.len = 2.0;
  e.shape = kTriangle;
  e.soft = 0.0;
  e.vel = 0.0;
  e.velLeft = 0;
  e.mean = 0.0;
  e.invPeak = 1.0;
  e.a = 0.0;
  e.harmonics = 1;
  e.q = 4.0;
  e.noiseCounter = 0u;
  e.noiseStart = 0u;
  e.seed = seed;
  e.nlp = e.nx1 = e.nhp = 0.0;
  e.nlpCoef = 1.0;
  e.nhpR = 0.999;
  e.fadeLeft = 0;
  e.fadeLen = 1;
  e.clearNow = 0;
  e.elapsed = -1.0;
  e.peak = 0.0;
  e.lastVel = 0.0;
  e.hits = 0.0;
  e.peakRel = 0.0;
  e.peakRelSr = -1.0;
  e.specMag = 1.0;
}

static inline int shape_index(double v) {
  int s = (int)(v + (v >= 0.0 ? 0.5 : -0.5));
  if (s < 0) s = 0;
  if (s > 3) s = 3;
  return s;
}

// Raw tonal shape at burst phase u in [0, 1] (before correction / normalization).
static inline double raw_tonal(int shape, double u, double q, double a, int harmonics) {
  using namespace soemdsp_maths;
  if (shape == kBump) {
    const double s = dsp_sin_turns(0.5 * u);
    if (!(s > 1e-12)) return 0.0;
    return dsp_exp(q * dsp_ln(s));
  }
  // Triangle / Saw: harmonic series by rotation (one sin/cos per sample).
  double s1 = 0.0, c1 = 1.0;
  dsp_sin_cos_turns(u, &s1, &c1);
  double sk = s1, ck = c1;  // sin(k th), cos(k th), k = 1
  double ak = 1.0;          // a^(k-1)
  double sum = 0.0;
  for (int k = 1; k <= harmonics; k++) {
    if (shape == kSaw) {
      sum += ak * sk / (double)k;
    } else if (k & 1) {
      const double sign = (((k - 1) >> 1) & 1) ? -1.0 : 1.0;
      sum += sign * ak * sk / ((double)k * (double)k);
    }
    const double sn = sk * c1 + ck * s1;
    const double cn = ck * c1 - sk * s1;
    sk = sn;
    ck = cn;
    ak *= a;
    if (ak < 1e-9) break;
  }
  return sum;
}

static inline double hann(double u) {
  const double s = soemdsp_maths::dsp_sin_turns(0.5 * u);
  return s * s;
}

// Latch the burst: length, tilt, normalization, |E(f)|.
static inline void start_burst(Exciter& e, double freqHz, int shape, double soft, double width, double sr) {
  using namespace soemdsp_maths;
  const double rate = maxd(1.0, sr);
  double f = dsp_fabs(safe(freqHz));
  if (f < 1.0) f = 1.0;
  if (f > rate * 0.499) f = rate * 0.499;
  double w = safe(width);
  if (w < 0.0) w = 0.0;
  // Whole samples: the burst is n = round(Width * fs / f) samples
  // sampled at the midpoints u = (i + 0.5) / n, so the zero-mean correction and
  // the peak are exact on the samples actually played (n <= kNormPoints).
  // (at least 3: a zero-mean symmetric 2-sample tap would be silent).
  double len = dsp_floor(w * rate / f + 0.5);
  if (len < 3.0) len = 3.0;
  const double sf = clamp(safe(soft), 0.0, 1.0);
  e.len = len;
  e.shape = shape;
  e.soft = sf;
  e.pos = 0.0;
  e.active = 1;
  // cycles of f across the burst (= Width unless the 2-sample floor kicked in)
  const double cyc = len * f / rate;
  if (shape == kNoise) {
    const double fb = rate / len;
    double fc = fb * dsp_exp2(6.0 * (1.0 - sf));
    double c = 1.0 - dsp_exp(-kTwoPi * fc / rate);
    if (!(c > 1e-6)) c = 1e-6;
    if (c > 1.0) c = 1.0;
    e.nlpCoef = c;
    e.nhpR = 1.0 - kTwoPi * (0.25 * fb) / rate;
    if (e.nhpR < 0.0) e.nhpR = 0.0;
    // The noise is counter-indexed (hash), so the whole burst is known at the
    // edge: run it once here for its exact mean, peak and |E(f)|, then play the
    // same samples back (same counter start, same filter start).
    e.noiseStart = e.noiseCounter;
    const int n = (int)len;
    double lp = 0.0, x1 = 0.0, hpv = 0.0, sum = 0.0, hsum = 0.0;
    for (int i = 0; i < n; i++) {
      const double u = (i + 0.5) / len;
      const double white = hash_bipolar(e.noiseStart + (unsigned int)i, e.seed);
      lp += c * (white - lp);
      hpv = safe(lp - x1 + e.nhpR * hpv);
      x1 = lp;
      const double hw = hann(u);
      sum += hpv * hw;
      hsum += hw;
    }
    e.mean = hsum > 1e-12 ? sum / hsum : 0.0;
    lp = x1 = hpv = 0.0;
    double peak = 0.0, cre = 0.0, cim = 0.0;
    for (int i = 0; i < n; i++) {
      const double u = (i + 0.5) / len;
      const double white = hash_bipolar(e.noiseStart + (unsigned int)i, e.seed);
      lp += c * (white - lp);
      hpv = safe(lp - x1 + e.nhpR * hpv);
      x1 = lp;
      const double hw = hann(u);
      const double v = (hpv - e.mean) * hw;
      const double av = dsp_fabs(v);
      if (av > peak) peak = av;
      double sn = 0.0, cs = 1.0;
      dsp_sin_cos_turns(cyc * u, &sn, &cs);
      cre += v * cs;
      cim -= v * sn;
    }
    e.invPeak = peak > 1e-12 ? 1.0 / peak : 0.0;
    e.specMag = __builtin_sqrt(cre * cre + cim * cim) * e.invPeak;
    e.noiseCounter = e.noiseStart + (unsigned int)n;
    e.nlp = e.nx1 = e.nhp = 0.0;
    return;
  }
  int K = (int)(len * 0.5) - 1;
  if (K < 1) K = 1;
  if (K > kMaxHarmonics) K = kMaxHarmonics;
  e.harmonics = K;
  const double amax = K > 1 ? dsp_exp(dsp_ln(0.01) / (double)(K - 1)) : 0.0;
  e.a = (1.0 - sf) * amax;
  e.q = 4.0 + 28.0 * (1.0 - sf);
  const int pts = len < (double)kNormPoints ? (int)len : kNormPoints;
  double sum = 0.0, hsum = 0.0;
  for (int j = 0; j < pts; j++) {
    const double u = (j + 0.5) / (double)pts;
    sum += raw_tonal(shape, u, e.q, e.a, K);
    hsum += hann(u);
  }
  // correction: raw - mean * hann, mean = sum(raw) / sum(hann)
  e.mean = hsum > 1e-12 ? sum / hsum : 0.0;
  double peak = 0.0, cre = 0.0, cim = 0.0;
  for (int j = 0; j < pts; j++) {
    const double u = (j + 0.5) / (double)pts;
    const double v = raw_tonal(shape, u, e.q, e.a, K) - e.mean * hann(u);
    const double av = dsp_fabs(v);
    if (av > peak) peak = av;
    double sn = 0.0, cs = 1.0;
    dsp_sin_cos_turns(cyc * u, &sn, &cs);
    cre += v * cs;
    cim -= v * sn;
  }
  e.invPeak = peak > 1e-12 ? 1.0 / peak : 0.0;
  const double cmag = __builtin_sqrt(cre * cre + cim * cim) / (double)pts * e.invPeak;
  e.specMag = cmag * len;
}

// One exciter sample (velocity-scaled). Call once per sample with the raw
// Trigger. After it: e.clearNow (Choke fade done: clear the resonator now) and
// the return value *gain (resonator output gain during a Choke fade).
static inline double exciter_tick(Exciter& e, double trigger, double freqHz, double shapeV,
                                  double soft, double width, double retriggerV, double sr,
                                  double* gain) {
  using namespace soemdsp_maths;
  const double t = safe(trigger);
  e.clearNow = 0;
  *gain = 1.0;
  if (e.armed && t > kFire) {
    e.armed = 0;
    int choke = (int)(retriggerV + (retriggerV >= 0.0 ? 0.5 : -0.5)) >= 1;
    e.vel = t;
    e.velLeft = kVelSamples;
    e.elapsed = 0.0;
    e.hits += 1.0;
    e.lastVel = t;
    const int shape = shape_index(shapeV);
    if (choke && e.peak > 1e-6) {
      const double rate = maxd(1.0, sr);
      e.fadeLen = (int)(kChokeSeconds * rate);
      if (e.fadeLen < 1) e.fadeLen = 1;
      e.fadeLeft = e.fadeLen;
      e.pending = 1;
      e.active = 0;
      // latch now (Width / f / Shape / Soft at the edge)
      start_burst(e, freqHz, shape, soft, width, sr);
      e.active = 0;
    } else {
      e.pending = 0;
      e.fadeLeft = 0;
      start_burst(e, freqHz, shape, soft, width, sr);
    }
  } else if (!e.armed && t < kRearm) {
    e.armed = 1;
  }
  if (e.velLeft > 0) {
    if (t > e.vel) e.vel = t;
    e.lastVel = e.vel;
    e.velLeft -= 1;
  }
  if (e.elapsed >= 0.0) e.elapsed += 1.0 / maxd(1.0, sr);
  if (e.fadeLeft > 0) {
    e.fadeLeft -= 1;
    *gain = (double)e.fadeLeft / (double)e.fadeLen;
    if (e.fadeLeft == 0) {
      e.clearNow = 1;
      e.peak = 0.0;
      if (e.pending) {
        e.pending = 0;
        e.active = 1;
        e.pos = 0.0;
      }
    }
    return 0.0;
  }
  if (!e.active) return 0.0;
  if (e.pos >= e.len) {
    e.active = 0;
    return 0.0;
  }
  const double u = (e.pos + 0.5) / e.len;
  e.pos += 1.0;
  double v;
  if (e.shape == kNoise) {
    const unsigned int i = (unsigned int)(e.pos - 1.0);
    const double white = hash_bipolar(e.noiseStart + i, e.seed);
    e.nlp += e.nlpCoef * (white - e.nlp);
    const double hp = e.nlp - e.nx1 + e.nhpR * e.nhp;
    e.nx1 = e.nlp;
    e.nhp = safe(hp);
    v = (e.nhp - e.mean) * hann(u) * e.invPeak;
  } else {
    v = (raw_tonal(e.shape, u, e.q, e.a, e.harmonics) - e.mean * hann(u)) * e.invPeak;
  }
  return safe(v) * e.vel;
}

// Feed the resonator's output back for the face taps (peak follower).
static inline void exciter_observe(Exciter& e, double y, double sr) {
  using namespace soemdsp_maths;
  const double ay = dsp_fabs(safe(y));
  if (e.peakRelSr != sr) {
    e.peakRelSr = sr;
    e.peakRel = dsp_exp(-1.0 / (kPeakRelease * maxd(1.0, sr)));
  }
  const double decayed = e.peak * e.peakRel;
  e.peak = ay > decayed ? ay : decayed;
  if (e.peak < 1e-12) e.peak = 0.0;
}

}  // namespace soemdsp::pluck
