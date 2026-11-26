// Shared STFT engine of Spectral Blur, Spectral Warble and Spectral Smear (one analysis/synthesis core, three modules that expose different controls).
// Not a module itself: each module .cpp includes this file and defines its own State pool, metadata and exports.
#pragma once
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int size = 16384, bins = size / 2 + 1, capacity = 64;
constexpr double twoPi = 6.283185307179586;
// Cloud: up to 4 voices; each source bin may be sprayed at most this many bins away so a high bin cannot fan across the spectrum (a cost / fan-out guard).
constexpr int kMaxVoices = 4, kCloudKnot = 8, kCloudLobe = 3;
// Warble: a motion knot every 2 bins (every harmonic gets its own motion even at FFT 2048) and a +-2 bin peak search.
constexpr int kWarbleKnot = 2, kWarbleLobe = 2, kWarbleKnots = bins / kWarbleKnot + 3;
// Which engine a module uses. Smear: 4x overlap time/frequency smear. Warble: per-partial pitch wobble. Cloud: the cloud (8x overlap).
enum Engine { kSmear = 0, kWarble = 1, kCloud = 2 };
// dsp_sin_cos wants an angle near one turn; Cloud's per-hop offsets can be many turns, so they are wrapped first.
inline double wrapTurns(double a) { return a - twoPi * (double)(long long)(a / twoPi + (a < 0 ? -0.5 : 0.5)); }
soemdsp::fft::Radix2<size> fft{};
soemdsp::fft::Radix2<512> fft512{};
soemdsp::fft::Radix2<1024> fft1024{};
soemdsp::fft::Radix2<2048> fft2048{};
soemdsp::fft::Radix2<4096> fft4096{};
soemdsp::fft::Radix2<8192> fft8192{};
void transform(int length, float* re, float* im, bool inverse) {
  switch (length) {
    case 512: fft512.transform(re, im, inverse); break;
    case 1024: fft1024.transform(re, im, inverse); break;
    case 2048: fft2048.transform(re, im, inverse); break;
    case 4096: fft4096.transform(re, im, inverse); break;
    case 8192: fft8192.transform(re, im, inverse); break;
    default: fft.transform(re, im, inverse); break;
  }
}
struct Core {
  float input[2][size], ola[2][size], re[2][size], im[2][size], window[size];
  double power[2][bins], phaseR[2][bins], phaseI[2][bins];
  double prevR[2][bins], prevI[2][bins], velocityR[2][bins], velocityI[2][bins];
  double prefix[bins + 1], blurred[bins], offset[bins], smoothOffset[bins], magnitudeState[2][bins];
  double sideOffset[bins], smoothSideOffset[bins];
  unsigned int rng, sideRng, seed;
  int engine; // Engine
  // Moved partials (Warble and Cloud): per channel, per voice, per bin the target bin, fraction, rotation and gain of a partial's lobe, the
  // accumulated extra phase, and the local spectral peak each bin belongs to. Cloud uses channel 0 for both channels (linked).
  unsigned short mvTarget[2][kMaxVoices][bins];
  float mvGain[2][kMaxVoices][bins], mvFrac[2][kMaxVoices][bins], mvCos[2][kMaxVoices][bins], mvSin[2][kMaxVoices][bins];
  float mvAcc[2][kMaxVoices][bins], mvDelta[2][kMaxVoices][bins]; // mvDelta: last hop's shift in bins, for the trapezoid rule
  unsigned short mvPeak[2][bins];
  double specRe[bins], specIm[bins], accRe[bins], accIm[bins];
  // Cloud: fuzz in cents, voices from one analysis (hop = N/8).
  double cloudFuzz;
  int cloudVoices;
  unsigned int cloudRng[kMaxVoices];
  double cloudDetune[kMaxVoices][bins / kCloudKnot + 3];
  // Warble: per voice and knot, three unit-variance motion generators (0 = mid, 1 = left side, 2 = right side): a sine phase and two cascaded
  // one-poles of seeded noise, plus a per-knot rate factor and the latest output.
  double warbleDepth = 25, warbleRate = 4, warbleDrunk = 0.5, monoBassHz = 0;
  int warbleVoices = 3;
  unsigned int warbleRng[kMaxVoices];
  float wPhase[3][kMaxVoices][kWarbleKnots], wG1[3][kMaxVoices][kWarbleKnots], wG2[3][kMaxVoices][kWarbleKnots], wX[3][kMaxVoices][kWarbleKnots];
  float wRate[3][kMaxVoices][kWarbleKnots]; // r_n in [-1, 1] per generator, drawn once from the seed (so the two ears do not share a rate)
  int position, hop, windowSize;
  double cloudWander = 0.5; // Hz
  double blurCents = 0; // Pitch Blur: extra width in cents, on top of Frequency Blur (Hz)
  double right, lastRate, phaseSmoothMs, amplitudeSmoothMs, stereoSpread;

  void reset(int length = 0) {
    if (length) windowSize = length;
    fft.ensure();
    for (int i = 0; i < size; ++i) {
      const int index = i < windowSize ? (i < windowSize / 2 ? i : windowSize - i) * (size / windowSize) : 0;
      window[i] = i >= windowSize ? 0 : i == windowSize / 2 ? 1 : 0.5f - 0.5f * fft.twRe[index];
      for (int c = 0; c < 2; ++c) input[c][i] = ola[c][i] = 0;
    }
    for (int k = 0; k < bins; ++k) {
      offset[k] = smoothOffset[k] = 0;
      sideOffset[k] = smoothSideOffset[k] = 0;
      for (int c = 0; c < 2; ++c) for (int v = 0; v < kMaxVoices; ++v) mvAcc[c][v][k] = mvDelta[c][v][k] = 0;
      for (int c = 0; c < 2; ++c) {
        power[c][k] = prevR[c][k] = prevI[c][k] = phaseI[c][k] = 0;
        magnitudeState[c][k] = 0;
        phaseR[c][k] = 1;
        // The exact bin-centered advance is a multiple of pi/2 at this hop.
        const int q = k % 4;
        velocityR[c][k] = q == 0 ? 1 : q == 2 ? -1 : 0;
        velocityI[c][k] = q == 1 ? 1 : q == 3 ? -1 : 0;
      }
    }
    for (int v = 0; v < kMaxVoices; ++v) for (int n = 0; n < bins / kCloudKnot + 3; ++n) cloudDetune[v][n] = 0;
    position = hop = 0; right = lastRate = 0; rng = 0x9e3779b9u; sideRng = 0xC2B2AE35u;
    seedCloud();
    seedWarble();
  }
  // Each Cloud voice has its own stream, from Seed + voice index: same Seed, input and settings give the same fur.
  void seedCloud() {
    for (int v = 0; v < kMaxVoices; ++v) {
      cloudRng[v] = (seed + (unsigned int)v) * 2654435761u ^ 0x68E31DA4u;
      if (!cloudRng[v]) cloudRng[v] = 0x1B873593u;
    }
  }
  double cloudRandom(int v) {
    unsigned int& s = cloudRng[v];
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (double)s * (2.0 / 4294967296.0) - 1.0;
  }
  double warbleRandom(int v) {
    unsigned int& r = warbleRng[v];
    r ^= r << 13; r ^= r >> 17; r ^= r << 5;
    return (double)r * (2.0 / 4294967296.0) - 1.0;
  }
  // Every Warble generator comes from Seed + voice: the per-knot rate factors and the starting phases are drawn once, in a fixed order, so the
  // same Seed, input and settings always give the same sound, and a reset reseeds cleanly.
  void seedWarble() {
    for (int v = 0; v < kMaxVoices; ++v) {
      warbleRng[v] = (seed + (unsigned int)v) * 2246822519u ^ 0x7F4A7C15u;
      if (!warbleRng[v]) warbleRng[v] = 0x2545F491u; // safety: xorshift never leaves 0
      for (int n = 0; n < kWarbleKnots; ++n) {
        for (int st = 0; st < 3; ++st) { wRate[st][v][n] = (float)warbleRandom(v); wPhase[st][v][n] = (float)(twoPi * 0.5 * (warbleRandom(v) + 1.0)); wG1[st][v][n] = wG2[st][v][n] = wX[st][v][n] = 0; }
      }
    }
  }
  double random() {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return (double)rng * (2.0 / 4294967296.0) - 1.0;
  }
  double sideRandom() {
    sideRng ^= sideRng << 13; sideRng ^= sideRng >> 17; sideRng ^= sideRng << 5;
    return (double)sideRng * (2.0 / 4294967296.0) - 1.0;
  }
  // Mean of src over [k - half, k + half] (half in bins, fractional edges by linear interpolation), for every bin, via a cumulative sum.
  void boxMean(const double* src, double* dst, double radiusBins, double centsRatio, int bins) {
    prefix[0] = 0;
    for (int k = 0; k < bins; ++k) prefix[k + 1] = prefix[k] + src[k];
    auto cumulative = [&](double x) { // sum of src over [0, x), x in bins
      if (x <= 0) return 0.0;
      if (x >= bins) return prefix[bins];
      const int i = (int)x;
      return prefix[i] + (x - i) * src[i];
    };
    for (int k = 0; k < bins; ++k) {
      const double half = 0.5 * (radiusBins + k * centsRatio), lo = k - half, hi = k + 1 + half;
      dst[k] = (cumulative(hi) - cumulative(lo < 0 ? 0 : lo)) / ((hi > bins ? bins : hi) - (lo < 0 ? 0 : lo));
    }
  }
  // Frequency Blur (Hz) plus Pitch Blur (cents): a triangular kernel (two box passes, so no hard edges and no sinc ripple on a partial), its
  // half-width per bin = Hz width + k * (2^(cents/1200) - 1), so a cents width is the same musical interval at every pitch. The frame's
  // power is then matched to the unblurred power, so blurring never changes the level.
  void blurPower(int channel, double radiusBins, double centsRatio) {
    const int bins = windowSize / 2 + 1;
    const bool any = radiusBins > 0 || centsRatio > 0;
    double* const blurTmp = specRe; // scratch: specRe is only written after the blur, inside the same channel pass
    const double* src = power[channel];
    if (!any) { for (int k = 0; k < bins; ++k) blurred[k] = src[k]; return; }
    boxMean(src, blurTmp, radiusBins, centsRatio, bins);
    boxMean(blurTmp, blurred, radiusBins, centsRatio, bins);
    double before = 0, after = 0;
    for (int k = 0; k < bins; ++k) { before += src[k]; after += blurred[k]; }
    const double match = after > 1e-300 ? before / after : 1.0;
    for (int k = 0; k < bins; ++k) blurred[k] *= match;
  }
  bool frame(double seconds, double widthHz, double diffusion, double rate) {
    const bool cloud = engine == kCloud, warble = engine == kWarble, moved = cloud || warble;
    const int size = windowSize, hopSize = size / (moved ? 8 : 4), bins = size / 2 + 1;
    // Overlap-add gain for the Hann analysis * Hann synthesis windows: the squared windows sum to 3 * overlap / 8, so 8 / (3 * overlap).
    const float olaGain = moved ? 1.0f / 3 : 2.0f / 3;
    const double pole = seconds > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * seconds)) : 0;
    double radius = widthHz * size / rate;
    if (radius > bins - 1) radius = bins - 1;
    const double centsRatio = blurCents > 0 ? soemdsp_maths::dsp_exp(blurCents * 0.6931471805599453 / 1200.0) - 1.0 : 0.0;
    // Keep the phase walk unwrapped: scaling a wrapped angle would jump at pi.
    const double jitter = __builtin_sqrt(12.0 * twoPi * 2.0 * hopSize / rate);
    const double phasePole = phaseSmoothMs > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * phaseSmoothMs * 0.001)) : 0;
    const double amplitudePole = amplitudeSmoothMs > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * amplitudeSmoothMs * 0.001)) : 0;
    for (int k = 1; k < bins - 1; ++k) {
      offset[k] += random() * jitter;
      smoothOffset[k] = offset[k] + phasePole * (smoothOffset[k] - offset[k]);
      sideOffset[k] += sideRandom() * jitter;
      smoothSideOffset[k] = sideOffset[k] + phasePole * (smoothSideOffset[k] - sideOffset[k]);
    }
    const bool stereoWarble = warble && stereoSpread != 0;
    if (cloud) {
      // Cloud = a continuous, slowly wandering detune of every partial, per voice, in cents (a chorus that is not made of oscillators).
      // Per voice, a mean-reverting random state (the Wander parameter sets how fast it wanders, Fuzz how many cents it reaches) lives at knots
      // every kCloudKnot bins (about two Hann main lobes) and is interpolated across the spectrum, so a whole partial moves together. A source bin
      // is moved to bin k + delta (delta = k * (2^(c/1200) - 1) bins, linear interpolation between the two neighbours)
      // and its phase is rotated by the frequency offset ACCUMULATED hop after hop (2 pi delta hop / N per hop), so the moved partial is a
      // continuous sinusoid at the detuned frequency, not a train of phase jumps: smooth beating, no hop-rate buzz. The voices share nothing but the one analysis and are averaged (1/L each). Left and Right
      // share every draw (linked).
      const int voices = cloudVoices < 1 ? 1 : cloudVoices > kMaxVoices ? kMaxVoices : cloudVoices;
      const double centsToRatio = 0.6931471805599453 / 1200.0;
      const double voiceGain = 1.0 / voices;
      const double wanderPole = soemdsp_maths::dsp_exp(-twoPi * (cloudWander > 0 ? cloudWander : 0) * hopSize / rate);
      const double wanderInject = __builtin_sqrt(1.0 - wanderPole * wanderPole) * 1.7320508075688772; // uniform [-1,1] has variance 1/3
      const int knots = (bins - 1) / kCloudKnot + 2;
      // Every bin of one partial's lobe has to be moved by the SAME amount, or the lobe's bins slide out of phase with each other frame after
      // frame (a constant-cents shift is a different number of bins at every bin) and the partial falls apart (a level loss and a ragged,
      // metallic grain). So each bin takes the detune of the local peak it belongs to (the strongest bin within +-kCloudLobe of it, from the
      // previous hop's power: a peak moves slowly), and the shift in bins is that peak's bin * (2^(cents/1200) - 1).
      for (int k = 0; k < bins; ++k) {
        const int lo = k > kCloudLobe ? k - kCloudLobe : 0, hi = k + kCloudLobe < bins ? k + kCloudLobe : bins - 1;
        int best = k; double bestPower = power[0][k] + power[1][k];
        for (int j = lo; j <= hi; ++j) { const double pw = power[0][j] + power[1][j]; if (pw > bestPower) { bestPower = pw; best = j; } }
        mvPeak[0][k] = (unsigned short)best;
      }
      for (int v = 0; v < voices; ++v) {
        for (int n = 0; n < knots; ++n) {
          double d = wanderPole * cloudDetune[v][n] + wanderInject * cloudRandom(v);
          cloudDetune[v][n] = d < -1 ? -1 : d > 1 ? 1 : d;
        }
        for (int k = 1; k < bins - 1; ++k) {
          const int pk = mvPeak[0][k];
          const int n = pk / kCloudKnot;
          const double along = (double)(pk - n * kCloudKnot) / kCloudKnot;
          const double u = cloudDetune[v][n] + (cloudDetune[v][n + 1] - cloudDetune[v][n]) * along;
          double delta = pk * (soemdsp_maths::dsp_exp(cloudFuzz * u * centsToRatio) - 1.0);
          double t = k + delta;
          if (t < 2.0 || t > bins - 3.0 - 1e-9) { t = k; delta = 0; } // too near DC / Nyquist for the four-bin move: stays where it is
          const int t0 = (int)t;
          const double frac = t - t0;
          double acc = mvAcc[0][v][k] + twoPi * delta * hopSize / size;
          acc -= twoPi * (double)(long long)(acc / twoPi);
          mvAcc[0][v][k] = (float)acc;
          double sn, cs;
          soemdsp_maths::dsp_sin_cos(wrapTurns(acc), &sn, &cs);
          mvTarget[0][v][k] = (unsigned short)t0;
          mvGain[0][v][k] = (float)voiceGain;
          mvFrac[0][v][k] = (float)frac;
          mvCos[0][v][k] = (float)cs; mvSin[0][v][k] = (float)sn;
        }
      }
    } else if (warble) {
      // Warble: every PARTIAL moves its own pitch, smoothly, in cents. For each voice and each knot (every 2 bins, so every harmonic has its
      // own motion) there are three unit-variance motion generators: x = cos(pi D / 2) sqrt(2) sin(phase) + sin(pi D / 2) g, where the phase
      // advances at the knot's own rate R_n = Rate 2^(Drunk r_n) and g is seeded noise through two cascaded one-poles at R_n, scaled to unit
      // variance by the filter's analytic stationary variance. Nothing is clamped, so Depth is the RMS pitch deviation in cents at every Drunk.
      // The channel motion is w_c = cos(pi S_n / 2) m + sin(pi S_n / 2) side_c, which has unit variance for any Spread; S_n is Spread with the
      // Mono Bass ramp. A partial's lobe is moved by the same number of bins in every bin (the local peak's), with its phase ACCUMULATED hop
      // after hop, so it is a continuous sinusoid at the detuned pitch.
      const int voices = warbleVoices < 1 ? 1 : warbleVoices > kMaxVoices ? kMaxVoices : warbleVoices; // safety: below 1 divides by zero, above kMaxVoices is past the arrays
      const double centsToRatio = 0.6931471805599453 / 1200.0;
      const double hopSeconds = (double)hopSize / rate;
      double sinHalfPiD, cosHalfPiD; soemdsp_maths::dsp_sin_cos(wrapTurns(0.5 * 3.141592653589793 * warbleDrunk), &sinHalfPiD, &cosHalfPiD);
      const double mixSine = cosHalfPiD * 1.4142135623730951, mixNoise = sinHalfPiD;
      const int knots = (bins - 1) / kWarbleKnot + 2;
      const int streams = stereoWarble ? 3 : 1;
      for (int v = 0; v < voices; ++v) {
        for (int n = 0; n < knots; ++n) {
          for (int st = 0; st < streams; ++st) {
            const double knotRate = warbleRate * soemdsp_maths::dsp_exp(warbleDrunk * wRate[st][v][n] * 0.6931471805599453);
            const double step = twoPi * knotRate * hopSeconds;
            const double a = soemdsp_maths::dsp_exp(-step); // the one-pole coefficient of the noise path
            const double variance = (1.0 - a) * (1.0 + a * a) / ((1.0 + a) * (1.0 + a) * (1.0 + a)) / 3.0; // two cascaded one-poles on uniform noise
            const double scale = variance > 1e-30 ? 1.0 / __builtin_sqrt(variance) : 0.0; // safety: a zero rate has no noise path and would divide by zero
            double phi = wPhase[st][v][n] + step;
            phi -= twoPi * (double)(long long)(phi / twoPi);
            wPhase[st][v][n] = (float)phi;
            const double w = warbleRandom(v);
            const double g1 = a * wG1[st][v][n] + (1.0 - a) * w;
            const double g2 = a * wG2[st][v][n] + (1.0 - a) * g1;
            wG1[st][v][n] = (float)g1; wG2[st][v][n] = (float)g2;
            double sn, cs; soemdsp_maths::dsp_sin_cos(wrapTurns(phi), &sn, &cs);
            wX[st][v][n] = (float)(mixSine * sn + mixNoise * g2 * scale);
          }
        }
      }
      const int channels = stereoWarble ? 2 : 1;
      // Mono Bass: Spread rises from 0 at MonoBass / sqrt(2) to its full value at MonoBass sqrt(2) over one octave (raised cosine); 0 is off.
      static double knotCos[kWarbleKnots], knotSin[kWarbleKnots], fanL[kMaxVoices][kWarbleKnots], fanR[kMaxVoices][kWarbleKnots];
      for (int n = 0; n < knots; ++n) {
        double ramp = 1.0;
        if (monoBassHz > 0) {
          const double hz = (n * kWarbleKnot + 0.5 * kWarbleKnot) * rate / size;
          double t = hz > 0 ? soemdsp_maths::dsp_ln(hz / (monoBassHz * 0.7071067811865476)) * 1.4426950408889634 : 0.0;
          t = t < 0 ? 0 : t > 1 ? 1 : t; // the shape of the one-octave ramp, not a parameter limit
          double sn, cs; soemdsp_maths::dsp_sin_cos(wrapTurns(3.141592653589793 * t), &sn, &cs);
          ramp = 0.5 - 0.5 * cs;
        }
        const double sNode = stereoSpread * ramp;
        double sn, cs; soemdsp_maths::dsp_sin_cos(wrapTurns(0.5 * 3.141592653589793 * sNode), &sn, &cs);
        knotCos[n] = cs; knotSin[n] = sn;
        for (int v = 0; v < voices; ++v) {
          const double pan = voices > 1 ? sNode * (2.0 * v / (voices - 1) - 1.0) : 0.0;
          double ps, pc; soemdsp_maths::dsp_sin_cos(wrapTurns(0.7853981633974483 * (1.0 + pan)), &ps, &pc);
          fanL[v][n] = (float)(1.4142135623730951 * pc); fanR[v][n] = (float)(1.4142135623730951 * ps);
        }
      }
      for (int c = 0; c < channels; ++c) {
        for (int k = 0; k < bins; ++k) {
          const int lo = k > kWarbleLobe ? k - kWarbleLobe : 0, hi = k + kWarbleLobe < bins ? k + kWarbleLobe : bins - 1;
          int best = k; double bestPower = power[c][k];
          for (int j = lo; j <= hi; ++j) if (power[c][j] > bestPower) { bestPower = power[c][j]; best = j; }
          mvPeak[c][k] = (unsigned short)best;
        }
        for (int v = 0; v < voices; ++v) {
          for (int k = 1; k < bins - 1; ++k) {
            const int pk = mvPeak[c][k];
            const int n = pk / kWarbleKnot;
            // One knot per partial (its peak's), never blended with a neighbour: two independent motions blended would cancel part of the wobble.
            // The peak comes from the INPUT's power, so a steady input keeps its knot.
            const int side = stereoWarble ? 1 + c : 0; // stream 1 = left side, 2 = right side
            const double w = knotCos[n] * wX[0][v][n] + (stereoWarble ? knotSin[n] * wX[side][v][n] : 0.0);
            const double cents = warbleDepth * w;
            double delta = pk * (soemdsp_maths::dsp_exp(cents * centsToRatio) - 1.0);
            double t = k + delta;
            if (t < 2.0 || t > bins - 3.0 - 1e-9) { t = k; delta = 0; } // safety: too near DC / Nyquist for the four-bin move, so it stays where it is
            const int t0 = (int)t;
            const double frac = t - t0;
            // The phase gained over the hop is the integral of the shift; the mean of last hop's and this hop's shift (trapezoid rule) is second-order
            // accurate, where holding this hop's value is only first order and leaves a hop-rate ripple in the overlap-add at fast Rate and big FFT sizes.
            double acc = mvAcc[c][v][k] + twoPi * 0.5 * (mvDelta[c][v][k] + delta) * hopSize / size;
            mvDelta[c][v][k] = (float)delta;
            acc -= twoPi * (double)(long long)(acc / twoPi);
            mvAcc[c][v][k] = (float)acc;
            double sn, cs;
            soemdsp_maths::dsp_sin_cos(wrapTurns(acc), &sn, &cs);
            const double fan = c == 0 ? fanL[v][n] : fanR[v][n];
            mvTarget[c][v][k] = (unsigned short)t0;
            mvGain[c][v][k] = (float)(fan / voices);
            mvFrac[c][v][k] = (float)frac;
            mvCos[c][v][k] = (float)cs; mvSin[c][v][k] = (float)sn;
          }
        }
      }
    }
    for (int c = 0; c < 2; ++c) {
      // Cloud: how much of the analysis frame's energy the synthesis window passes (windowed / unwindowed), measured on the source frame
      // so the moved spectrum can be held to the same figure below.
      double srcEnergy = 0, srcWindowed = 0;
      for (int i = 0; i < size; ++i) {
        re[c][i] = input[c][(position + 1 + i) % size] * window[i]; im[c][i] = 0;
        if (moved) { const double e = (double)re[c][i] * re[c][i]; srcEnergy += e; srcWindowed += e * window[i] * window[i]; }
      }
      transform(size, re[c], im[c], false);
      for (int k = 0; k < bins; ++k) {
        const double a = re[c][k], b = im[c][k], magnitude2 = a * a + b * b;
        if (!__builtin_isfinite(magnitude2)) return false;
        const double edge = k == 0 || k == bins - 1 ? 1 : 2;
        power[c][k] = pole * power[c][k] + (1 - pole) * edge * magnitude2;
        if (magnitude2 > 1e-24) {
          const double magnitude = __builtin_sqrt(magnitude2);
          const double old = prevR[c][k] * prevR[c][k] + prevI[c][k] * prevI[c][k];
          if (old > 1e-24) {
            const double norm = __builtin_sqrt(old * magnitude2);
            velocityR[c][k] = (a * prevR[c][k] + b * prevI[c][k]) / norm;
            velocityI[c][k] = (b * prevR[c][k] - a * prevI[c][k]) / norm;
          }
          phaseR[c][k] = a / magnitude; phaseI[c][k] = b / magnitude;
        } else {
          const double pr = phaseR[c][k], pi = phaseI[c][k];
          phaseR[c][k] = pr * velocityR[c][k] - pi * velocityI[c][k];
          phaseI[c][k] = pr * velocityI[c][k] + pi * velocityR[c][k];
        }
        prevR[c][k] = a; prevI[c][k] = b;
      }
      blurPower(c, radius, centsRatio);
      for (int k = 0; k < bins; ++k) {
        const bool edge = k == 0 || k == bins - 1;
        const double targetMagnitude = __builtin_sqrt((blurred[k] > 0 ? blurred[k] : 0) / (edge ? 1 : 2));
        magnitudeState[c][k] = targetMagnitude + amplitudePole * (magnitudeState[c][k] - targetMagnitude);
        double magnitude = magnitudeState[c][k];
        double sn = 0, cs = 1;
        if (!edge && diffusion > 0) {
          const double phase = smoothOffset[k] + (c == 0 ? -0.5 : 0.5) * stereoSpread * smoothSideOffset[k];
          soemdsp_maths::dsp_sin_cos(diffusion * phase, &sn, &cs);
        }
        const double pr = phaseR[c][k], pi = phaseI[c][k];
        if (moved) {
          specRe[k] = magnitude * (pr * cs - pi * sn);
          specIm[k] = edge ? 0 : magnitude * (pr * sn + pi * cs);
          continue;
        }
        re[c][k] = (float)(magnitude * (pr * cs - pi * sn));
        im[c][k] = edge ? 0 : (float)(magnitude * (pr * sn + pi * cs));
        if (k > 0 && k < bins - 1) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
      }
      if (moved) {
        const int cc = stereoWarble ? c : 0; // Cloud and a linked Warble share channel 0's moves
        const int voices = warble ? (warbleVoices < 1 ? 1 : warbleVoices > kMaxVoices ? kMaxVoices : warbleVoices) : (cloudVoices < 1 ? 1 : cloudVoices > kMaxVoices ? kMaxVoices : cloudVoices); // safety: array bounds
        for (int k = 0; k < bins; ++k) accRe[k] = accIm[k] = 0;
        accRe[0] = specRe[0]; accRe[bins - 1] = specRe[bins - 1]; // DC and Nyquist stay where they are
        double sourcePower = specRe[0] * specRe[0] + specRe[bins - 1] * specRe[bins - 1];
        for (int k = 1; k < bins - 1; ++k) {
          const double xr = specRe[k], xi = specIm[k];
          sourcePower += 2 * (xr * xr + xi * xi);
          for (int v = 0; v < voices; ++v) {
            const double yr = xr * mvCos[cc][v][k] - xi * mvSin[cc][v][k], yi = xr * mvSin[cc][v][k] + xi * mvCos[cc][v][k];
            const int t0 = mvTarget[cc][v][k];
            // The window is centred in the frame, so the bins of a partial's lobe alternate in sign, (-1)^k. Moving a lobe by delta bins has to
            // keep that pattern at its new place, (-1)^(t0) and (-1)^(t0 + 1) for the two neighbours it is shared between; interpolating the
            // raw bins would add opposite signs and cancel the lobe (a level loss and a ragged, metallic grain).
            // Four neighbours (Catmull-Rom weights, which sum to 1) keep the shape of the lobe much better than two.
            const double f = mvFrac[cc][v][k], f2 = f * f, f3 = f2 * f, g = mvGain[cc][v][k];
            const double w[4] = { g * (-0.5 * f3 + f2 - 0.5 * f), g * (1.5 * f3 - 2.5 * f2 + 1.0), g * (-1.5 * f3 + 2.0 * f2 + 0.5 * f), g * (0.5 * f3 - 0.5 * f2) };
            for (int j = 0; j < 4; ++j) {
              const int q = t0 - 1 + j;
              if (q < 0 || q >= bins) continue;
              const double sj = ((q + k) & 1) ? -w[j] : w[j]; // the lobe's (-1)^bin pattern moves with it: factor (-1)^(q - k)
              accRe[q] += yr * sj; accIm[q] += yi * sj;
            }
          }
        }
        // One normalisation per frame keeps the frame's power equal to the power it came from, so Fuzz changes the character and not the level
        // (the voices average to exactly the source at Fuzz 0; a wide spray is power-preserving). It is a level match, not a clip.
        double accPower = accRe[0] * accRe[0] + accRe[bins - 1] * accRe[bins - 1];
        for (int k = 1; k < bins - 1; ++k) {
          accPower += 2 * (accRe[k] * accRe[k] + accIm[k] * accIm[k]);
        }
        const double normal = accPower > 1e-30 && sourcePower > 0 ? __builtin_sqrt(sourcePower / accPower) : 1.0;
        for (int k = 0; k < bins; ++k) {
          const bool edge = k == 0 || k == bins - 1;
          re[c][k] = (float)(accRe[k] * normal);
          im[c][k] = edge ? 0 : (float)(accIm[k] * normal);
          if (!edge) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
        }
      }
      transform(size, re[c], im[c], true);
      float frameGain = olaGain;
      if (moved) {
        // A moved partial is not exactly a Hann-shaped grain any more, so the synthesis window passes a different share of it. Hold that share
        // to the source frame's (identical at Fuzz 0, so a dry Cloud is untouched): a level match per frame, not a clip.
        double synEnergy = 0, synWindowed = 0;
        for (int i = 0; i < size; ++i) { const double e = (double)re[c][i] * re[c][i]; synEnergy += e; synWindowed += e * window[i] * window[i]; }
        if (srcEnergy > 1e-24 && synEnergy > 1e-24 && synWindowed > 1e-24 && srcWindowed > 1e-24)
          frameGain = (float)(olaGain * __builtin_sqrt((srcWindowed / srcEnergy) / (synWindowed / synEnergy)));
      }
      for (int i = 0; i < size; ++i)
        ola[c][(position + 1 + i) % size] += re[c][i] * window[i] * frameGain;
    }
    return true;
  }
  double tick(double left, double r, double seconds, double width, double diffusion, double mix, double rate) {
    const int size = windowSize, hopSize = size / (engine != kSmear ? 8 : 4);
    const double values[] = {left, r, seconds, width, diffusion, mix, rate};
    for (double v : values)
      if (!__builtin_isfinite(v)) { reset(); return 0; }
    if (!__builtin_isfinite((float)left) || !__builtin_isfinite((float)r) || rate < 100) { reset(); return 0; }
    if (lastRate != 0 && lastRate != rate) reset();
    lastRate = rate;
    const double dryL = input[0][position], dryR = input[1][position];
    const double wetL = ola[0][position], wetR = ola[1][position];
    ola[0][position] = ola[1][position] = 0;
    input[0][position] = (float)left; input[1][position] = (float)r;
    if (++hop == hopSize) {
      hop = 0;
      // Parameters are used as given; their ranges live in the parameter definitions. Only a negative Time Smear / Frequency Blur is
      // refused (a negative smear time makes the one-pole coefficient exceed 1 and blow up; a negative width has no meaning).
      if (!frame(seconds > 0 ? seconds : 0, width > 0 ? width : 0, diffusion, rate)) { reset(); return 0; }
    }
    position = (position + 1) % size;
    right = dryR + mix * (wetR - dryR);
    double out = dryL + mix * (wetL - dryL);
    if (!__builtin_isfinite(out) || !__builtin_isfinite(right)) { reset(); return 0; }
    return out;
  }
};
struct State {
  Core cores[2];
  int current, desired, warm;
  double fade, right, rate;
  bool changing, started;
  void reset() {
    for (auto& core : cores) core.reset(4096);
    current = warm = 0; fade = right = rate = 0; changing = started = false;
  }
  void initialize() {
    desired = 4096;
    for (auto& core : cores) {
      core.engine = kSmear;
      core.phaseSmoothMs = 10; core.amplitudeSmoothMs = 0; core.stereoSpread = 1; core.seed = 1;
      core.blurCents = 0; core.cloudWander = 0.5; core.cloudFuzz = 0; core.cloudVoices = 3;
      core.warbleDepth = 25; core.warbleRate = 4; core.warbleDrunk = 0.5; core.warbleVoices = 3; core.monoBassHz = 0;
    }
    reset();
  }
  // Which engine this module runs; both cores. (A module sets it once, in create.)
  void setEngine(int e) { for (auto& core : cores) core.engine = e; reset(); }
  void beginChange() {
    Core& from = cores[current]; Core& to = cores[1 - current];
    to.reset(desired);
    // Conservatively remap one-sided power, with FFT normalization accounted for.
    const double scale = (double)to.windowSize / from.windowSize;
    for (int k = 0; k <= from.windowSize / 2; ++k) {
      const double index = k * scale; const int a = (int)index; const double f = index - a;
      for (int c = 0; c < 2; ++c) {
        const double v = from.power[c][k] * scale * scale;
        to.power[c][a] += v * (1 - f);
        if (a + 1 <= to.windowSize / 2) to.power[c][a + 1] += v * f;
      }
    }
    warm = to.windowSize; fade = 0; changing = true;
  }
  double tick(double l, double r, double seconds, double hz, double diffusion, double mix, double sr) {
    if (rate != 0 && rate != sr) reset();
    rate = sr;
    if (!started) { cores[current].reset(desired); started = true; }
    if (!changing && cores[current].windowSize != desired) beginChange();
    const double a = cores[current].tick(l, r, seconds, hz, diffusion, mix, sr);
    right = cores[current].right;
    if (!changing) return a;
    const double b = cores[1 - current].tick(l, r, seconds, hz, diffusion, mix, sr);
    if (warm > 0) { --warm; return a; }
    const double g = fade * fade * (3 - 2 * fade);
    const double out = a + g * (b - a);
    right += g * (cores[1 - current].right - right);
    fade += 1.0 / (0.05 * (sr > 100 ? sr : 48000));
    if (fade >= 1) { current = 1 - current; changing = false; }
    return out;
  }
};
}  // namespace
