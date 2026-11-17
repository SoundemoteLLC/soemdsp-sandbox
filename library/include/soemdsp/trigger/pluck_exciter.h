// Pluck exciter + strict trigger (docs/COMB_PLUCK_PLAN.md). Header-only,
// freestanding, opt-in (not pulled in by soemdsp.hpp). Shared by Comb Pluck and
// Mode Ping so both hit the same way.
//
// Trigger: rising-edge latch with hysteresis. Fires when Trigger rises above
// kFire (0.5), re-arms when it falls below kRearm (0.4). A held gate hits once;
// note-off is silent. Velocity = the trigger's peak over the first
// kVelSamples samples after the edge (a MIDI gate carrying velocity plays
// dynamics); the burst is scaled by the running peak while it is captured.
//
// Exciter: one band-limited, zero-DC burst per hit, Width x the loop period
// long (1/f; Width, f, Shape and Soft latch at the edge):
//   Bump      sin^q(pi u) tap. Soft sets its width geometrically (sqrt(Soft)
//             as the exponent, so the soft half keeps the old feel): Soft 1 =
//             q 4 (gentle hump, about half the burst), Soft 0 = qMax, a spike
//             about 0.6 table points (one sample when n <= kTablePoints) wide:
//             a near-click. qMax = (n_pts / (0.6 pi))^2. The zero-mean step
//             leaves a broad shallow dip under it, so even the click has no DC.
//   Edge      one ramp-and-drop cycle (a single saw with a shaped ramp): rises
//             0 -> 1 over the first 1 - d of the burst along the Step Graph
//             Rational curve (soemdsp/math/segment_curves.h segment_rational01,
//             Curve -1..+1, 0 = straight), then falls 1 -> 0 over the last d
//             with a raised-cosine. Soft sets d geometrically: Soft 0 = half
//             a table point (the burst ends on a one-sample cliff), Soft 1 =
//             half the burst. Made
//             zero-mean, Low Cut and peak 1 like the rest, so it ends inside
//             Width and has no DC.
//   Noise     Hann-windowed hash noise, one-pole tilt (Soft 0 = white, 1 = dark),
//             DC-blocked; made exactly zero-mean and peak 1 the same way.
//             Seed picks the noise; Noise Hit New = every hit takes the next
//             stretch of this instance's stream (salted per instance, so two
//             modules differ), Same = every hit replays the burst that Seed
//             alone gives (hash index 0..n-1, no salt: same Seed, same hit, in
//             any module, and the hit view draws it exactly).
// The whole burst is rendered at the edge into a table (one point per sample,
// u = (i + 0.5) / n; bursts longer than kTablePoints are rendered on
// kTablePoints points and read back with linear interpolation):
//   1. raw shape (Noise: hash noise through its tilt filters, at table rate)
//   2. zero-mean: subtract m * sin^2(pi u), m = sum(shape) / sum(sin^2), so it
//      is zero-mean and still starts and ends at 0
//   3. Low Cut (Comb Pluck): zero-phase highpass (one-pole forward, then
//      backward) at Low Cut Hz, the bottom edge of the burst's spectrum (Soft
//      is the top edge); the change it makes to the two end values is taken
//      back out with edge shapes decaying at the filter's rate, then step 2
//      again. The burst still lasts exactly n samples and stays zero-DC.
//   4. normalized to peak 1; |E(f)| measured for Mode Ping.
// Exact on the samples played whenever n <= kTablePoints.
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
static const int kTablePoints = 2048;
static const double kChokeSeconds = 0.002;
static const double kPeakRelease = 0.02;
static const unsigned int kSeedBase = 0x6a09e667u;  // noise hash seed = base ^ Seed * kSeedMul (^ salt for New)
static const unsigned int kSeedMul = 0x9e3779b1u;
static const double kSeedMax = 16777215.0;          // Seed range = the definition's max
static const double kBumpQMin = 4.0;                // Bump at Soft 1 (gentle hump)
static const double kBumpMinSigma = 0.6;            // Bump at Soft 0: spike width, table points

// Triangle / Saw were dropped (t365s993); saved patches remap old indices on load.
enum Shape { kBump = 0, kNoise = 1, kEdge = 2 };
static const int kShapeMax = 2;                     // = the definition's Shape max

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
  double mean;      // (unused: the table is already corrected)
  double invPeak;   // (unused: the table is already normalized)
  double q;         // bump exponent
  // noise
  unsigned int noiseCounter;
  unsigned int noiseStart;
  unsigned int salt;  // per-instance salt for Noise Hit New
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
  // resonators that need impulse normalization (Mode Ping).
  double specMag;
  int pts;                    // table points used (= len when len <= kTablePoints)
  float table[kTablePoints];  // the normalized burst
};

static inline void exciter_reset(Exciter& e, unsigned int salt) {
  e.armed = 1;
  e.active = 0;
  e.pending = 0;
  e.pos = 0.0;
  e.len = 2.0;
  e.shape = kBump;
  e.soft = 0.0;
  e.vel = 0.0;
  e.velLeft = 0;
  e.mean = 0.0;
  e.invPeak = 1.0;
  e.q = 4.0;
  e.noiseCounter = 0u;
  e.noiseStart = 0u;
  e.salt = salt;
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
  e.pts = 0;
}

static inline int shape_index(double v) {
  int s = (int)(v + (v >= 0.0 ? 0.5 : -0.5));
  if (s < 0) s = 0;
  if (s > kShapeMax) s = kShapeMax;
  return s;
}

// Edge at burst phase u in [0, 1]: Rational ramp (Curve) over [0, 1 - d], raised-cosine drop over d.
static inline double raw_edge(double u, double drop, double curve) {
  using namespace soemdsp_maths;
  const double r = 1.0 - drop;
  if (u < r) return soemdsp::math::segment_rational01(u / r, curve);
  const double t = (u - r) / drop;
  return 0.5 + 0.5 * dsp_cos_turns(0.5 * (t < 1.0 ? t : 1.0));
}

// Raw Bump at burst phase u in [0, 1]: sin^q(pi u) (before correction / normalization).
static inline double raw_bump(double u, double q) {
  using namespace soemdsp_maths;
  const double s = dsp_sin_turns(0.5 * u);
  if (!(s > 1e-12)) return 0.0;
  return dsp_exp(q * dsp_ln(s));
}

static inline double hann(double u) {
  const double s = soemdsp_maths::dsp_sin_turns(0.5 * u);
  return s * s;
}

// Zero-mean step: v -= m * hann, m = sum(v) / sum(hann) on the table points.
static inline void table_zero_mean(float* t, int pts) {
  double sum = 0.0, hsum = 0.0;
  for (int i = 0; i < pts; i++) {
    sum += (double)t[i];
    hsum += hann((i + 0.5) / (double)pts);
  }
  const double m = hsum > 1e-12 ? sum / hsum : 0.0;
  for (int i = 0; i < pts; i++) t[i] = (float)((double)t[i] - m * hann((i + 0.5) / (double)pts));
}

// Low Cut: zero-phase one-pole highpass (forward, then backward) at pole a.
// The forward pass's ringing past the burst end is a^j decay, so the backward
// pass starts from its exact closed-form state (as if the burst were zero
// padded). The highpass moves the two end values; that change is taken back
// out with two edge shapes g0 = (a^i - a^(n-1)) / (1 - a^(n-1)) (1 at the
// start, 0 at the end) and its mirror, which decay at the filter's own rate
// (a straight line in the a -> 1 limit), so the ends keep their original
// values without a long ramp putting lows back in. Then zero-mean again.
// At the 1 Hz floor this is the identity to within float rounding.
static inline void table_low_cut(float* t, int pts, double a) {
  if (!(a < 1.0) || pts < 3) return;
  const double t0 = (double)t[0], tn = (double)t[pts - 1];
  double x1 = 0.0, y1 = 0.0;
  for (int i = 0; i < pts; i++) {
    const double x = (double)t[i];
    const double y = a * (y1 + x - x1);
    x1 = x;
    y1 = soemdsp_maths::safe(y);
    t[i] = (float)y1;
  }
  // forward tail past the end: c * a^j, c = a (y1 - x1); backward state = a c / (1 + a)
  const double c = a * (y1 - x1);
  x1 = c;
  y1 = a * c / (1.0 + a);
  for (int i = pts - 1; i >= 0; i--) {
    const double x = (double)t[i];
    const double y = a * (y1 + x - x1);
    x1 = x;
    y1 = soemdsp_maths::safe(y);
    t[i] = (float)y1;
  }
  const double d0 = (double)t[0] - t0, d1 = (double)t[pts - 1] - tn;
  const double aN = soemdsp_maths::dsp_exp((double)(pts - 1) * soemdsp_maths::dsp_ln(a > 1e-300 ? a : 1e-300));
  const double den = 1.0 - aN;
  if (den > 1e-9) {
    const double inv = 1.0 / den;
    double p = 1.0;  // a^i from the start
    for (int i = 0; i < pts; i++) {
      t[i] = (float)((double)t[i] - d0 * (p - aN) * inv);
      p *= a;
    }
    p = 1.0;         // a^i from the end
    for (int i = pts - 1; i >= 0; i--) {
      t[i] = (float)((double)t[i] - d1 * (p - aN) * inv);
      p *= a;
    }
  } else {
    for (int i = 0; i < pts; i++) {
      const double u = (double)i / (double)(pts - 1);
      t[i] = (float)((double)t[i] - (d0 * (1.0 - u) + d1 * u));
    }
  }
  table_zero_mean(t, pts);
}

// Latch the burst: length, render the table (shape, zero-mean, Low Cut),
// normalization, |E(f)|.
static inline void start_burst(Exciter& e, double freqHz, int shape, double soft, double width,
                               double curve, double lowCutHz, unsigned int seed, int noiseSame,
                               double sr) {
  using namespace soemdsp_maths;
  const double rate = maxd(1.0, sr);
  double f = dsp_fabs(safe(freqHz));
  if (f < 1.0) f = 1.0;
  if (f > rate * 0.499) f = rate * 0.499;
  double w = safe(width);
  if (w < 0.0) w = 0.0;
  // Whole samples: the burst is n = round(Width * fs / f) samples
  // (at least 3: a zero-mean symmetric 2-sample tap would be silent).
  double len = dsp_floor(w * rate / f + 0.5);
  if (len < 3.0) len = 3.0;
  const double sf = clamp(safe(soft), 0.0, 1.0);
  e.len = len;
  e.shape = shape;
  e.soft = sf;
  e.pos = 0.0;
  e.active = 1;
  const int pts = len <= (double)kTablePoints ? (int)len : kTablePoints;
  e.pts = pts;
  const double tableRate = rate * (double)pts / len;  // table points per second
  float* t = e.table;
  if (shape == kNoise) {
    const double fb = rate / len;
    double fc = fb * dsp_exp2(6.0 * (1.0 - sf));
    double c = 1.0 - dsp_exp(-kTwoPi * fc / tableRate);
    if (!(c > 1e-6)) c = 1e-6;
    if (c > 1.0) c = 1.0;
    double r = 1.0 - kTwoPi * (0.25 * fb) / tableRate;
    if (r < 0.0) r = 0.0;
    const unsigned int hseed = kSeedBase ^ (unsigned int)(seed * kSeedMul) ^ (noiseSame ? 0u : e.salt);
    e.noiseStart = noiseSame ? 0u : e.noiseCounter;
    double lp = 0.0, x1 = 0.0, hpv = 0.0;
    for (int i = 0; i < pts; i++) {
      const double white = hash_bipolar(e.noiseStart + (unsigned int)i, hseed);
      lp += c * (white - lp);
      hpv = safe(lp - x1 + r * hpv);
      x1 = lp;
      t[i] = (float)(hpv * hann((i + 0.5) / (double)pts));
    }
    if (!noiseSame) e.noiseCounter = e.noiseStart + (unsigned int)pts;
  } else if (shape == kEdge) {
    // drop: half a table point (Soft 0: the last point is still the top, so the
    // burst ends on a one-sample cliff) .. half the burst (Soft 1), geometric
    const double dMin = 0.5 / (double)pts;
    const double dMax = 0.5;
    const double drop = dMin < dMax ? dMin * dsp_exp(dsp_ln(dMax / dMin) * sf) : dMax;
    const double cv = clamp(safe(curve), -1.0, 1.0);
    for (int i = 0; i < pts; i++) t[i] = (float)raw_edge((i + 0.5) / (double)pts, drop, cv);
  } else {
    // Bump width: sigma ~ pts / (pi sqrt q); Soft 0 -> sigma = kBumpMinSigma points.
    double qMax = (double)pts / (3.141592653589793 * kBumpMinSigma);
    qMax *= qMax;
    if (qMax < kBumpQMin) qMax = kBumpQMin;
    e.q = kBumpQMin * dsp_exp(dsp_ln(qMax / kBumpQMin) * (1.0 - __builtin_sqrt(sf)));
    for (int i = 0; i < pts; i++) t[i] = (float)raw_bump((i + 0.5) / (double)pts, e.q);
  }
  table_zero_mean(t, pts);
  double lc = safe(lowCutHz);
  if (lc > 0.0) {
    if (lc > tableRate * 0.45) lc = tableRate * 0.45;
    table_low_cut(t, pts, dsp_exp(-kTwoPi * lc / tableRate));
  }
  // cycles of f across the burst (= Width unless the 3-sample floor kicked in)
  const double cyc = len * f / rate;
  double peak = 0.0, cre = 0.0, cim = 0.0;
  for (int i = 0; i < pts; i++) {
    const double v = (double)t[i];
    const double av = dsp_fabs(v);
    if (av > peak) peak = av;
    double sn = 0.0, cs = 1.0;
    dsp_sin_cos_turns(cyc * (i + 0.5) / (double)pts, &sn, &cs);
    cre += v * cs;
    cim -= v * sn;
  }
  const double inv = peak > 1e-12 ? 1.0 / peak : 0.0;
  for (int i = 0; i < pts; i++) t[i] = (float)((double)t[i] * inv);
  e.invPeak = 1.0;
  e.mean = 0.0;
  e.specMag = __builtin_sqrt(cre * cre + cim * cim) / (double)pts * inv * len;
}

// Table read at burst sample pos (linear interpolation when pts < len).
static inline double table_read(const Exciter& e, double pos) {
  const int pts = e.pts;
  if (pts <= 0) return 0.0;
  if ((double)pts == e.len) return (double)e.table[(int)pos];
  double ti = (pos + 0.5) / e.len * (double)pts - 0.5;
  if (ti < 0.0) ti = 0.0;
  const int i0 = (int)ti;
  const double fr = ti - (double)i0;
  const int i1 = i0 + 1 < pts ? i0 + 1 : pts - 1;
  return (double)e.table[i0] + fr * ((double)e.table[i1] - (double)e.table[i0]);
}

// One exciter sample (velocity-scaled). Call once per sample with the raw
// Trigger. After it: e.clearNow (Choke fade done: clear the resonator now) and
// the return value *gain (resonator output gain during a Choke fade).
static inline double exciter_tick(Exciter& e, double trigger, double freqHz, double shapeV,
                                  double soft, double width, double curve, double lowCutHz, double seedV,
                                  double noiseHitV, double retriggerV, double sr, double* gain) {
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
    double sv = safe(seedV);
    sv = sv < 0.0 ? 0.0 : (sv > kSeedMax ? kSeedMax : sv);
    const unsigned int seed = (unsigned int)(sv + 0.5);
    const int noiseSame = (int)(safe(noiseHitV) + 0.5) >= 1;
    if (choke && e.peak > 1e-6) {
      const double rate = maxd(1.0, sr);
      e.fadeLen = (int)(kChokeSeconds * rate);
      if (e.fadeLen < 1) e.fadeLen = 1;
      e.fadeLeft = e.fadeLen;
      e.pending = 1;
      e.active = 0;
      // latch now (Width / f / Shape / Soft at the edge)
      start_burst(e, freqHz, shape, soft, width, curve, lowCutHz, seed, noiseSame, sr);
      e.active = 0;
    } else {
      e.pending = 0;
      e.fadeLeft = 0;
      start_burst(e, freqHz, shape, soft, width, curve, lowCutHz, seed, noiseSame, sr);
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
  const double v = table_read(e, e.pos);
  e.pos += 1.0;
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
