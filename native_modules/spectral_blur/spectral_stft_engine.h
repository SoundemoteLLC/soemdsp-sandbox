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
constexpr int kMaxVoices = 4;
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
  // Cloud: Fuzz in cents (the half-width of the band around every partial), Grain in dB, voices (hop = N/8). Per voice and bin a phase walk
  // (mvAcc[0], wrapped), a side walk (unwrapped: it is scaled by Spread / 2 below, and scaling a wrapped angle jumps at pi) and a flicker gain.
  double cloudFuzz = 100, cloudGrain = 1;
  int cloudVoices = 3;
  unsigned int cloudRng[kMaxVoices], cloudSideRng[kMaxVoices], cloudGrainRng[kMaxVoices];
  double cloudSide[kMaxVoices][bins];
  float bandMakeup[bins]; // Cloud, per bin: a fixed gain from the walk step (a parameter), not from the signal
  float smearRamp[bins]; // Smear, per bin: the Mono Bass ramp on the side walk
  int overlap = 4; // frames per window: hop = N / overlap (Smear: Normal 4 / Smooth 8; Warble and Cloud 8)
  double diffusionSpeed = 30; // Hz: the phase-diffusion half-width per bin (Smear)
  // Warble: per voice and knot, three unit-variance motion generators (0 = mid, 1 = left side, 2 = right side): a sine phase and two cascaded
  // one-poles of seeded noise, plus a per-knot rate factor and the latest output.
  double warbleDepth = 25, warbleRate = 4, warbleDrunk = 0.5, monoBassHz = 0;
  int warbleVoices = 3;
  unsigned int warbleRng[kMaxVoices];
  float wPhase[3][kMaxVoices][kWarbleKnots], wG1[3][kMaxVoices][kWarbleKnots], wG2[3][kMaxVoices][kWarbleKnots], wX[3][kMaxVoices][kWarbleKnots];
  float wRate[3][kMaxVoices][kWarbleKnots]; // r_n in [-1, 1] per generator, drawn once from the seed (so the two ears do not share a rate)
  int position, hop, windowSize;
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
        // The exact bin-centred phase advance per hop is 2 pi k / overlap.
        double vs, vc; soemdsp_maths::dsp_sin_cos(twoPi * (double)(k % overlap) / overlap, &vs, &vc);
        velocityR[c][k] = vc; velocityI[c][k] = vs;
      }
    }
    for (int v = 0; v < kMaxVoices; ++v) for (int k = 0; k < bins; ++k) cloudSide[v][k] = 0;
    position = hop = 0; right = lastRate = 0; rng = seed * 2654435761u ^ 0x9e3779b9u; sideRng = seed * 2246822519u ^ 0xC2B2AE35u; // seed 0 keeps the original constants
    if (!rng) rng = 0x9e3779b9u; if (!sideRng) sideRng = 0xC2B2AE35u; // safety: xorshift never leaves 0
    seedCloud();
    seedWarble();
  }
  // Each Cloud voice has three streams from Seed + voice: the main phase walk, the side walk (Stereo Spread) and the Grain flicker. They are
  // separate, so changing Grain or Stereo Spread never changes the main walks.
  void seedCloud() {
    for (int v = 0; v < kMaxVoices; ++v) {
      cloudRng[v] = (seed + (unsigned int)v) * 2654435761u ^ 0x68E31DA4u;
      cloudSideRng[v] = (seed + (unsigned int)v) * 2246822519u ^ 0x2C1B3C6Du;
      cloudGrainRng[v] = (seed + (unsigned int)v) * 3266489917u ^ 0x297A2D39u;
      if (!cloudRng[v]) cloudRng[v] = 0x1B873593u; // safety: xorshift never leaves 0
      if (!cloudSideRng[v]) cloudSideRng[v] = 0x2545F491u; // safety: xorshift never leaves 0
      if (!cloudGrainRng[v]) cloudGrainRng[v] = 0x6C078965u; // safety: xorshift never leaves 0
    }
  }
  static double xorshiftUniform(unsigned int& s) { // uniform on [-1, 1]
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (double)s * (2.0 / 4294967296.0) - 1.0;
  }
  double cloudRandom(int v) { return xorshiftUniform(cloudRng[v]); }
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
    const int size = windowSize, hopSize = size / overlap, bins = size / 2 + 1;
    // Overlap-add gain for the Hann analysis * Hann synthesis windows: the squared windows sum to 3 * overlap / 8, so 8 / (3 * overlap).
    const float olaGain = 8.0f / (3.0f * overlap);
    const double pole = seconds > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * seconds)) : 0;
    const double radius = widthHz * size / rate; // boxMean handles a kernel wider than the spectrum, so there is no cap
    const double widthCents = cloud ? cloudFuzz : blurCents; // Cloud's Fuzz is the cents width of the magnitude kernel
    const double centsRatio = widthCents > 0 ? soemdsp_maths::dsp_exp(widthCents * 0.6931471805599453 / 1200.0) - 1.0 : 0.0; // safety: a negative width has no meaning
    // Keep the phase walk unwrapped: scaling a wrapped angle would jump at pi.
    // Diffusion Speed (Hz) is the half-width of the phase-diffusion line per bin: a uniform step of +-jitter per hop has variance 4 pi Speed H / sr.
    const double jitter = __builtin_sqrt(12.0 * 3.141592653589793 * (diffusionSpeed > 0 ? diffusionSpeed : 0) * hopSize / rate); // safety: a negative speed is the square root of a negative number
    const double phasePole = phaseSmoothMs > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * phaseSmoothMs * 0.001)) : 0;
    const double amplitudePole = amplitudeSmoothMs > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * amplitudeSmoothMs * 0.001)) : 0;
    for (int k = 1; k < bins - 1; ++k) {
      offset[k] += random() * jitter;
      smoothOffset[k] = offset[k] + phasePole * (smoothOffset[k] - offset[k]);
      sideOffset[k] += sideRandom() * jitter;
      smoothSideOffset[k] = sideOffset[k] + phasePole * (smoothSideOffset[k] - sideOffset[k]);
    }
    if (engine == kSmear) {
      // Mono Bass: the side walk is scaled by a raised-cosine ramp from 0 at MonoBass / sqrt(2) to 1 at MonoBass sqrt(2) (0 = off).
      smearRamp[0] = smearRamp[bins - 1] = 1.0f;
      for (int k = 1; k < bins - 1; ++k) {
        double ramp = 1.0;
        if (monoBassHz > 0) {
          const double hz = k * rate / size;
          double t = soemdsp_maths::dsp_ln(hz / (monoBassHz * 0.7071067811865476)) * 1.4426950408889634;
          t = t < 0 ? 0 : t > 1 ? 1 : t; // the shape of the one-octave ramp, not a parameter limit
          double sn, cs; soemdsp_maths::dsp_sin_cos(wrapTurns(3.141592653589793 * t), &sn, &cs);
          ramp = 0.5 - 0.5 * cs;
        }
        smearRamp[k] = (float)ramp;
      }
    }
    const bool stereoWarble = warble && stereoSpread != 0, stereoCloud = cloud && stereoSpread != 0;
    if (cloud) {
      // Cloud: every partial becomes a BAND, not a set of lines. Each bin of each voice gets its own random WALK on its phase; a random-walk
      // phase turns a line into a smooth Lorentzian band centred on the original frequency (no pitch shift, no vibrato). The step follows
      // Fuzz in cents: the half-width in Hz at bin k is df = k sr / N (2^(Fuzz/1200) - 1), and the uniform step has variance 4 pi df H / sr, so
      // its FWHM is 2 df. At a step of pi the phase is fully random each hop (Paulstretch). Above that the cents-wide magnitude kernel
      // (blurPower, below) supplies the width. Stereo: Left rotates by walk - a and Right by walk + a, a = Spread(k) side / 2, with no crossfeed.
      // Grain is an attenuation-only flicker, 10^(-Grain uG / 20) with uG in [0, 1], normalised to unity mean power, so it can only
      // redistribute level.
      const int voices = cloudVoices; // the setter guarantees 1..kMaxVoices
      const double ratio = cloudFuzz > 0 ? soemdsp_maths::dsp_exp(cloudFuzz * 0.6931471805599453 / 1200.0) - 1.0 : 0.0;
      const double grainX = cloudGrain * 0.2302585092994046; // Grain ln(10) / 10
      const double grainNorm = (grainX > 1e-9 || grainX < -1e-9) ? 1.0 / __builtin_sqrt((1.0 - soemdsp_maths::dsp_exp(-grainX)) / grainX) : 1.0; // unity mean power
      const double voiceGain = 1.0 / voices;
      bandMakeup[0] = bandMakeup[bins - 1] = 1.0f; // DC and Nyquist are not walked
      for (int k = 1; k < bins - 1; ++k) {
        const double df = k * rate / size * ratio;
        const double step = __builtin_sqrt(12.0 * 3.141592653589793 * df * hopSize / rate);
        const double hz = k * rate / size;
        double ramp = 1.0; // Mono Bass: Spread rises from 0 at MonoBass / sqrt(2) to full at MonoBass sqrt(2) over one octave (raised cosine); 0 = off
        if (monoBassHz > 0 && hz > 0) {
          double t = soemdsp_maths::dsp_ln(hz / (monoBassHz * 0.7071067811865476)) * 1.4426950408889634;
          t = t < 0 ? 0 : t > 1 ? 1 : t; // the shape of the one-octave ramp, not a parameter limit
          double sn, cs; soemdsp_maths::dsp_sin_cos(wrapTurns(3.141592653589793 * t), &sn, &cs);
          ramp = 0.5 - 0.5 * cs;
        }
        // Frames whose phases are independent add in POWER where coherent ones add in amplitude. A uniform step of +-s per hop correlates successive
        // frames by rho = sin(s) / s (0 once the phase is fully random); this fixed per-bin gain, 1 / sqrt(rho^2 + (1 - rho^2) 0.243), comes from Fuzz
        // (the step), never from the signal. No signal-dependent leveling anywhere: the user sets level with Amplitude.
        { const double rho = step >= 3.141592653589793 ? 0.0 : (step < 1e-9 ? 1.0 : soemdsp_maths::dsp_sin(step) / step); bandMakeup[k] = (float)(1.0 / __builtin_sqrt(rho * rho + (1.0 - rho * rho) * 0.243)); }
        const double spreadK = stereoSpread * ramp;
        for (int v = 0; v < voices; ++v) {
          double walk = mvAcc[0][v][k];
          if (step >= 3.141592653589793) walk = 3.141592653589793 * cloudRandom(v);
          else { walk += step * cloudRandom(v); walk -= twoPi * (double)(long long)(walk / twoPi); }
          mvAcc[0][v][k] = (float)walk;
          double side = cloudSide[v][k];
          if (stereoSpread != 0) {
            if (step >= 3.141592653589793) side = 3.141592653589793 * xorshiftUniform(cloudSideRng[v]);
            else side += step * xorshiftUniform(cloudSideRng[v]);
            cloudSide[v][k] = side;
          }
          const double a = 0.5 * spreadK * side;
          double sn, cs;
          soemdsp_maths::dsp_sin_cos(wrapTurns(walk - a), &sn, &cs);
          mvCos[0][v][k] = (float)cs; mvSin[0][v][k] = (float)sn;
          if (stereoSpread != 0) { soemdsp_maths::dsp_sin_cos(wrapTurns(walk + a), &sn, &cs); mvCos[1][v][k] = (float)cs; mvSin[1][v][k] = (float)sn; }
          const double flicker = cloudGrain != 0 ? grainNorm * soemdsp_maths::dsp_exp(-cloudGrain * 0.5 * (xorshiftUniform(cloudGrainRng[v]) + 1.0) * 0.11512925464970229) : 1.0;
          mvGain[0][v][k] = (float)(voiceGain * flicker);
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
      const int voices = warbleVoices; // the setter guarantees 1..kMaxVoices
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
        // The voices' pan gains averaged to 1 per ear, so identical voices (Depth 0) sum to exactly the input. A fixed gain from Spread and Voices,
        // never from the signal (the per-frame level match that used to do this is gone).
        double sumL = 0, sumR = 0;
        for (int v = 0; v < voices; ++v) { sumL += fanL[v][n]; sumR += fanR[v][n]; }
        const double normL = sumL > 1e-12 ? voices / sumL : 1.0, normR = sumR > 1e-12 ? voices / sumR : 1.0; // safety: a zero sum (no voices) keeps the gains
        for (int v = 0; v < voices; ++v) { fanL[v][n] *= normL; fanR[v][n] *= normR; }
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
      for (int i = 0; i < size; ++i) {
        re[c][i] = input[c][(position + 1 + i) % size] * window[i]; im[c][i] = 0;
      }
      transform(size, re[c], im[c], false);
      for (int k = 0; k < bins; ++k) {
        const double a = re[c][k], b = im[c][k], magnitude2 = a * a + b * b;
        if (!__builtin_isfinite(magnitude2)) return false;
        const double edge = k == 0 || k == bins - 1 ? 1 : 2;
        power[c][k] = pole * power[c][k] + (1 - pole) * edge * magnitude2;
        if (engine == kSmear) continue; // Smear assigns phase below, once the blurred power is known
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
        double liveWeight = 1.0; // Smear: how much of this bin is live input (1) rather than smeared or spread energy (0)
        if (engine == kSmear) {
          // Live versus smeared phase: where the input is really present (c = 1) the phase is the input's; smeared tails and spread energy (c -> 0)
          // continue the bin's held phase advance instead of taking noise-floor phase, so tails neither crackle nor freeze into steady tones.
          const double a = re[c][k], b = im[c][k], magnitude2 = a * a + b * b, pOut = blurred[k] > 0 ? blurred[k] : 0;
          double pr = phaseR[c][k], pi = phaseI[c][k];
          const double vr = velocityR[c][k], vi = velocityI[c][k];
          double cr = pr * vr - pi * vi, ci = pr * vi + pi * vr; // the continued phase
          const double cn = cr * cr + ci * ci; if (cn > 1e-30) { const double inv = 1.0 / __builtin_sqrt(cn); cr *= inv; ci *= inv; } else { cr = 1; ci = 0; } // safety: renormalise, never divide by zero
          if (magnitude2 > 1e-24) {
            const double magnitude = __builtin_sqrt(magnitude2), ar = a / magnitude, ai = b / magnitude;
            const double pIn = (k == 0 || k == bins - 1 ? 1.0 : 2.0) * magnitude2; // the input power in the same one-sided units as blurred[]
            const double weight = pOut > 1e-300 ? (pIn / pOut < 1.0 ? pIn / pOut : 1.0) : 1.0; // blend weight
            const double old = prevR[c][k] * prevR[c][k] + prevI[c][k] * prevI[c][k];
            if (old > 1e-24) {
              const double norm = __builtin_sqrt(old * magnitude2);
              const double mr = (a * prevR[c][k] + b * prevI[c][k]) / norm, mi = (b * prevR[c][k] - a * prevI[c][k]) / norm;
              double nr = vr + weight * (mr - vr), ni = vi + weight * (mi - vi); // the held advance follows the measured one by the blend weight
              const double nn = nr * nr + ni * ni; if (nn > 1e-30) { const double inv = 1.0 / __builtin_sqrt(nn); nr *= inv; ni *= inv; } else { nr = vr; ni = vi; } // safety: renormalise
              velocityR[c][k] = nr; velocityI[c][k] = ni;
            }
            double nr = cr + weight * (ar - cr), ni = ci + weight * (ai - ci);
            const double nn = nr * nr + ni * ni; if (nn > 1e-30) { const double inv = 1.0 / __builtin_sqrt(nn); nr *= inv; ni *= inv; } else { nr = ar; ni = ai; } // safety: opposite vectors cancel; take the input's
            phaseR[c][k] = nr; phaseI[c][k] = ni; liveWeight = weight;
          } else { phaseR[c][k] = cr; phaseI[c][k] = ci; liveWeight = 0.0; }
          prevR[c][k] = a; prevI[c][k] = b;
        }
        const double targetMagnitude = __builtin_sqrt((blurred[k] > 0 ? blurred[k] : 0) / (edge ? 1 : 2));
        magnitudeState[c][k] = targetMagnitude + amplitudePole * (magnitudeState[c][k] - targetMagnitude);
        const double diffusionHere = engine == kSmear ? diffusion * liveWeight + (1.0 - liveWeight) : diffusion;
        const double magnitude = magnitudeState[c][k];
        double sn = 0, cs = 1;
        // Smeared or spread energy has no phase of its own to keep: left to copy its source bin's phase it adds up with the other spread bins into a pulse train
        // (a saw blurred without Diffusion peaks +24 dB). So the share of a bin that is not live input always takes the full phase walk, whatever Diffusion is;
        // Diffusion scales only the live share. Neutral settings (c = 1, Diffusion 0) are untouched.
        if (!edge && diffusionHere > 0) {
          const double phase = smoothOffset[k] + (c == 0 ? -0.5 : 0.5) * stereoSpread * (engine == kSmear ? smearRamp[k] : 1.0f) * smoothSideOffset[k];
          soemdsp_maths::dsp_sin_cos(wrapTurns(diffusionHere * phase), &sn, &cs); // the walk is unwrapped (it can reach hundreds of radians at a high Diffusion Speed); sin_cos wants one turn
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
        const int cc = (stereoWarble || stereoCloud) ? c : 0; // a linked channel pair shares channel 0's rotations
        const int voices = warble ? warbleVoices : cloudVoices; // the setters guarantee 1..kMaxVoices
        for (int k = 0; k < bins; ++k) accRe[k] = accIm[k] = 0;
        accRe[0] = specRe[0]; accRe[bins - 1] = specRe[bins - 1]; // DC and Nyquist stay where they are
        for (int k = 1; k < bins - 1; ++k) {
          const double xr = specRe[k], xi = specIm[k];
          if (cloud) { // accumulated in place: no target bin, no move
            for (int v = 0; v < voices; ++v) {
              const double rr = xr * mvCos[cc][v][k] - xi * mvSin[cc][v][k], ri = xr * mvSin[cc][v][k] + xi * mvCos[cc][v][k], g = mvGain[0][v][k];
              accRe[k] += rr * g; accIm[k] += ri * g;
            }
            continue;
          }
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
        // The voices go out as they sum: no per-frame level match (beating and partial cancellation between voices stay audible).
        for (int k = 0; k < bins; ++k) {
          const bool edge = k == 0 || k == bins - 1;
          const double mk = cloud ? bandMakeup[k] : 1.0;
          re[c][k] = (float)(accRe[k] * mk);
          im[c][k] = edge ? 0 : (float)(accIm[k] * mk);
          if (!edge) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
        }
      }
      transform(size, re[c], im[c], true);
      for (int i = 0; i < size; ++i)
        ola[c][(position + 1 + i) % size] += re[c][i] * window[i] * olaGain; // the constant OLA window gain; no per-frame match
    }
    return true;
  }
  double tick(double left, double r, double seconds, double width, double diffusion, double mix, double rate) {
    const int size = windowSize, hopSize = size / overlap;
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
  int current, desired, warm, desiredOverlap = 4;
  double fade, right, rate;
  bool changing, started;
  void reset() {
    for (auto& core : cores) core.reset(4096);
    current = warm = 0; fade = right = rate = 0; changing = started = false;
  }
  void initialize() {
    desired = 4096;
    for (auto& core : cores) {
      core.engine = kSmear; core.overlap = 4; core.diffusionSpeed = 30;
      core.phaseSmoothMs = 10; core.amplitudeSmoothMs = 0; core.stereoSpread = 1; core.seed = 1;
      core.blurCents = 0; core.cloudFuzz = 100; core.cloudGrain = 1; core.cloudVoices = 3;
      core.warbleDepth = 25; core.warbleRate = 4; core.warbleDrunk = 0.5; core.warbleVoices = 3; core.monoBassHz = 0;
    }
    reset();
  }
  // Which engine this module runs; both cores. (A module sets it once, in create.)
  void setEngine(int e) { desiredOverlap = e == kSmear ? 4 : 8; for (auto& core : cores) { core.engine = e; core.overlap = desiredOverlap; } reset(); }
  void beginChange() {
    Core& from = cores[current]; Core& to = cores[1 - current];
    to.overlap = desiredOverlap; // the hop is part of the core; it changes with the same warm-and-crossfade as an FFT size change
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
    if (to.windowSize == from.windowSize) {
      // Same N (a hop-only change): continue the same phase walks, so the crossfade is between coherent signals and does not dip.
      for (int c = 0; c < 2; ++c) for (int k = 0; k < bins; ++k) {
        to.power[c][k] = from.power[c][k]; to.magnitudeState[c][k] = from.magnitudeState[c][k];
        to.phaseR[c][k] = from.phaseR[c][k]; to.phaseI[c][k] = from.phaseI[c][k];
        to.velocityR[c][k] = from.velocityR[c][k]; to.velocityI[c][k] = from.velocityI[c][k];
        to.prevR[c][k] = from.prevR[c][k]; to.prevI[c][k] = from.prevI[c][k];
      }
      for (int k = 0; k < bins; ++k) { to.offset[k] = from.offset[k]; to.smoothOffset[k] = from.smoothOffset[k]; to.sideOffset[k] = from.sideOffset[k]; to.smoothSideOffset[k] = from.smoothSideOffset[k]; }
      to.rng = from.rng; to.sideRng = from.sideRng;
    }
    warm = to.windowSize; fade = 0; changing = true;
  }
  double tick(double l, double r, double seconds, double hz, double diffusion, double mix, double sr) {
    if (rate != 0 && rate != sr) reset();
    rate = sr;
    if (!started) { cores[current].reset(desired); started = true; }
    if (!changing && (cores[current].windowSize != desired || cores[current].overlap != desiredOverlap)) beginChange();
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
