// soemdsp-native-module: spectral_blur
// soemdsp-native-label: Spectral Blur
// soemdsp-native-target: spectralBlur
// soemdsp-native-kind: effect
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int size = 16384, bins = size / 2 + 1, capacity = 64;
constexpr double twoPi = 6.283185307179586;
// Swarm is in real units: Swarm = phase wobble in degrees, Level = level wobble in dB, Drift = pitch wander in Hz. No other scaling.
constexpr double kDegrees = 0.017453292519943295;
// Cloud: up to 4 voices; each source bin may be sprayed at most this many bins away so a high bin cannot fan across the spectrum (a cost / fan-out guard).
constexpr int kMaxVoices = 4, kCloudCapBins = 32, kCloudKnot = 8;
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
  // Swarm: separate, mean-reverting per-bin modulators (hop rate, shared by both channels). They never touch the Diffusion walk above.
  double swarmPhaseState[bins], swarmAmpState[bins], swarmDriftState[bins], swarmDriftPhase[bins];
  double swarmSin[bins], swarmCos[bins], swarmGain[bins];
  unsigned int rng, sideRng, swarmRng, swarmSeed;
  double swarm, swarmLevel, swarmRate, swarmDrift; // degrees, dB, Hz, Hz
  // Cloud: fuzz in cents (log-frequency spray), white per-hop scatter, voices from one analysis. Runs at an 8x overlap (hop = N/8).
  bool cloud;
  double cloudFuzz;
  int cloudVoices;
  unsigned int cloudRng[kMaxVoices];
  int cloudTarget[kMaxVoices][bins];
  float cloudLo[kMaxVoices][bins], cloudHi[kMaxVoices][bins], cloudCos[kMaxVoices][bins], cloudSin[kMaxVoices][bins];
  double specRe[bins], specIm[bins], accRe[bins], accIm[bins], cloudCorr[bins];
  int position, hop, windowSize;
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
      swarmPhaseState[k] = swarmAmpState[k] = swarmDriftState[k] = swarmDriftPhase[k] = 0;
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
    position = hop = 0; right = lastRate = 0; rng = 0x9e3779b9u; sideRng = 0xC2B2AE35u;
    seedSwarm();
    seedCloud();
  }
  // Each Cloud voice has its own stream, from Seed + voice index: same Seed, input and settings give the same fur.
  void seedCloud() {
    for (int v = 0; v < kMaxVoices; ++v) {
      cloudRng[v] = (swarmSeed + (unsigned int)v) * 2654435761u ^ 0x68E31DA4u;
      if (!cloudRng[v]) cloudRng[v] = 0x1B873593u;
    }
  }
  double cloudRandom(int v) {
    unsigned int& s = cloudRng[v];
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (double)s * (2.0 / 4294967296.0) - 1.0;
  }
  // The Swarm stream is its own: same Seed + same input + same params gives the same output after a reset.
  void seedSwarm() {
    swarmRng = swarmSeed * 2654435761u ^ 0x7F4A7C15u;
    if (!swarmRng) swarmRng = 0x2545F491u;
    for (int k = 0; k < bins; ++k) swarmPhaseState[k] = swarmAmpState[k] = swarmDriftState[k] = swarmDriftPhase[k] = 0;
  }
  double swarmRandom() {
    swarmRng ^= swarmRng << 13; swarmRng ^= swarmRng >> 17; swarmRng ^= swarmRng << 5;
    return (double)swarmRng * (2.0 / 4294967296.0) - 1.0;
  }
  double random() {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return (double)rng * (2.0 / 4294967296.0) - 1.0;
  }
  double sideRandom() {
    sideRng ^= sideRng << 13; sideRng ^= sideRng >> 17; sideRng ^= sideRng << 5;
    return (double)sideRng * (2.0 / 4294967296.0) - 1.0;
  }
  void spread(int channel, int radius, double weight) {
    const int bins = windowSize / 2 + 1;
    // Each source bin distributes its power over its valid neighborhood.
    // This preserves total one-sided power even at DC/Nyquist boundaries.
    prefix[0] = 0;
    for (int k = 0; k < bins; ++k) {
      const int lo = k > radius ? k - radius : 0;
      const int hi = k + radius < bins ? k + radius : bins - 1;
      prefix[k + 1] = prefix[k] + power[channel][k] / (hi - lo + 1);
    }
    for (int k = 0; k < bins; ++k) {
      const int lo = k > radius ? k - radius : 0;
      const int hi = k + radius < bins ? k + radius : bins - 1;
      blurred[k] += weight * (prefix[hi + 1] - prefix[lo]);
    }
  }
  bool frame(double seconds, double widthHz, double diffusion, double rate) {
    const int size = windowSize, hopSize = size / (cloud ? 8 : 4), bins = size / 2 + 1;
    // Overlap-add gain for the Hann analysis * Hann synthesis windows: the squared windows sum to 3 * overlap / 8, so 8 / (3 * overlap).
    const float olaGain = cloud ? 1.0f / 3 : 2.0f / 3;
    const double pole = seconds > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * seconds)) : 0;
    double radius = widthHz * size / rate;
    if (radius > bins - 1) radius = bins - 1;
    const int r = (int)radius;
    const double fraction = radius - r;
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
    const bool swarming = !cloud && (swarm != 0 || swarmLevel != 0 || swarmDrift != 0);
    if (cloud) {
      // Fuzz in cents. Per hop and per voice a random spray offset (a triangular variable, +-Fuzz cents) is drawn at knots every kCloudKnot bins
      // (about two Hann main lobes) and interpolated across the spectrum, so the whole lobe of one partial moves together: its grain keeps its
      // shape and the partial becomes a line that jumps by a few cents every hop (a band), not noise. The offset is in cents, so its width in bins
      // grows with the bin and a 2 kHz partial gets the same relative fuzz as a 100 Hz one. A source bin is moved to bin k + delta (linear
      // interpolation between the two neighbours, capped at kCloudCapBins) and its phase advances by that frequency offset held for one hop
      // (2 pi delta hop / N): a tiny Fuzz stays coherent, a wide one decorrelates. Draws are white per hop and shared by Left and Right (linked).
      // Level adds a small white level dither per bin and voice (+-Level dB). Each voice takes 1/L of the amplitude (the voices average).
      const int voices = cloudVoices < 1 ? 1 : cloudVoices > kMaxVoices ? kMaxVoices : cloudVoices;
      const double centsToRatio = 0.6931471805599453 / 1200.0;
      const double voiceGain = 1.0 / voices;
      // Frame-to-frame correlation of a bin's sum, from the statistics of its spray (nothing is measured per hop): the phase offset one hop applies
      // is a triangular variable of peak kappa = 2 pi spread hop / N, with characteristic function psi = (sin(kappa/2) / (kappa/2))^2; L voices
      // correlate r = L psi^2 / (1 + (L - 1) psi^2) between hops. Decorrelated frames overlap-add with less power than coherent ones (a grain that
      // is no longer Hann-shaped passes less of the synthesis window: at 8x with the 1/3 gain the power falls from 1 toward 1/8), which the
      // per-frame makeup below undoes.
      for (int k = 1; k < bins - 1; ++k) {
        double spread = k * (soemdsp_maths::dsp_exp((cloudFuzz < 0 ? -cloudFuzz : cloudFuzz) * centsToRatio) - 1.0);
        if (spread > kCloudCapBins) spread = kCloudCapBins;
        const double half = 0.5 * twoPi * spread * hopSize / size;
        double psi = 1;
        if (half > 1e-6) { double sn, cs; soemdsp_maths::dsp_sin_cos(wrapTurns(half), &sn, &cs); psi = (sn / half) * (sn / half); }
        const double psi2 = psi * psi;
        cloudCorr[k] = voices * psi2 / (1.0 + (voices - 1.0) * psi2);
      }
      double knot[bins / kCloudKnot + 3];
      for (int v = 0; v < voices; ++v) {
        const int knots = (bins - 1) / kCloudKnot + 2;
        for (int n = 0; n < knots; ++n) knot[n] = 0.5 * (cloudRandom(v) + cloudRandom(v));
        for (int k = 1; k < bins - 1; ++k) {
          const int n = k / kCloudKnot;
          const double along = (double)(k - n * kCloudKnot) / kCloudKnot;
          const double u = knot[n] + (knot[n + 1] - knot[n]) * along;
          double delta = k * (soemdsp_maths::dsp_exp(cloudFuzz * u * centsToRatio) - 1.0);
          if (delta > kCloudCapBins) delta = kCloudCapBins;
          if (delta < -kCloudCapBins) delta = -kCloudCapBins;
          double t = k + delta;
          if (t < 1.0) t = 1.0;
          if (t > bins - 2.0 - 1e-9) t = bins - 2.0 - 1e-9;
          const int t0 = (int)t;
          const double frac = t - t0;
          double sn, cs;
          soemdsp_maths::dsp_sin_cos(wrapTurns(twoPi * (t - k) * hopSize / size), &sn, &cs);
          const double gain = voiceGain * soemdsp_maths::dsp_exp(swarmLevel * cloudRandom(v) * 0.11512925464970229);
          cloudTarget[v][k] = t0;
          cloudLo[v][k] = (float)(gain * (1.0 - frac));
          cloudHi[v][k] = (float)(gain * frac);
          cloudCos[v][k] = (float)cs; cloudSin[v][k] = (float)sn;
        }
      }
    } else if (swarming) {
      // One-pole, hop-rate, mean-reverting noise: state = pole * state + sqrt(1 - pole^2) * noise. The sqrt keeps the depth the same at
      // every Rate (only the speed changes); the state is clamped to +-1 and always comes back to 0, it never integrates like Diffusion.
      const double swarmPole = soemdsp_maths::dsp_exp(-twoPi * (swarmRate > 0 ? swarmRate : 0) * hopSize / rate);
      const double inject = __builtin_sqrt(1.0 - swarmPole * swarmPole) * 1.7320508075688772; // uniform [-1,1] has variance 1/3
      const double driftStep = twoPi * hopSize / rate; // radians per hop per Hz of pitch wander, at a state of 1
      for (int k = 1; k < bins - 1; ++k) {
        double p = swarmPole * swarmPhaseState[k] + inject * swarmRandom();
        double a = swarmPole * swarmAmpState[k] + inject * swarmRandom();
        double d = swarmPole * swarmDriftState[k] + inject * swarmRandom();
        swarmPhaseState[k] = p = p < -1 ? -1 : p > 1 ? 1 : p;
        swarmAmpState[k] = a = a < -1 ? -1 : a > 1 ? 1 : a;
        swarmDriftState[k] = d = d < -1 ? -1 : d > 1 ? 1 : d;
        // Drift is a small pitch wander: an extra phase advance per hop (mean-reverting around 0), accumulated and wrapped.
        double dp = swarmDriftPhase[k] + swarmDrift * d * driftStep;
        dp -= twoPi * (double)(long long)(dp / twoPi);
        swarmDriftPhase[k] = dp;
        const double angle = swarm * kDegrees * p + dp;
        soemdsp_maths::dsp_sin_cos(angle, &swarmSin[k], &swarmCos[k]);
        swarmGain[k] = soemdsp_maths::dsp_exp(swarmLevel * a * 0.11512925464970229); // +-Level dB at the state's peak (ln(10)/20); no range is imposed here
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
        prevR[c][k] = a; prevI[c][k] = b; blurred[k] = 0;
      }
      spread(c, r, 1 - fraction);
      if (fraction > 0) spread(c, r + 1, fraction);
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
        if (swarming && !edge) {
          // Swarm rotates the ANALYSIS phase and scales the sounding magnitude (after the Amplitude Smooth lag, so that lag cannot erase it).
          const double sc = swarmCos[k], ss = swarmSin[k];
          const double cs2 = cs * sc - sn * ss, sn2 = sn * sc + cs * ss;
          cs = cs2; sn = sn2;
          magnitude *= swarmGain[k];
        }
        const double pr = phaseR[c][k], pi = phaseI[c][k];
        if (cloud) {
          specRe[k] = magnitude * (pr * cs - pi * sn);
          specIm[k] = edge ? 0 : magnitude * (pr * sn + pi * cs);
          continue;
        }
        re[c][k] = (float)(magnitude * (pr * cs - pi * sn));
        im[c][k] = edge ? 0 : (float)(magnitude * (pr * sn + pi * cs));
        if (k > 0 && k < bins - 1) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
      }
      if (cloud) {
        const int voices = cloudVoices < 1 ? 1 : cloudVoices > kMaxVoices ? kMaxVoices : cloudVoices;
        for (int k = 0; k < bins; ++k) accRe[k] = accIm[k] = 0;
        accRe[0] = specRe[0]; accRe[bins - 1] = specRe[bins - 1]; // DC and Nyquist stay where they are
        double sourcePower = specRe[0] * specRe[0] + specRe[bins - 1] * specRe[bins - 1];
        for (int k = 1; k < bins - 1; ++k) {
          const double xr = specRe[k], xi = specIm[k];
          sourcePower += 2 * (xr * xr + xi * xi);
          for (int v = 0; v < voices; ++v) {
            const double yr = xr * cloudCos[v][k] - xi * cloudSin[v][k], yi = xr * cloudSin[v][k] + xi * cloudCos[v][k];
            const int t0 = cloudTarget[v][k];
            accRe[t0] += yr * cloudLo[v][k]; accIm[t0] += yi * cloudLo[v][k];
            accRe[t0 + 1] += yr * cloudHi[v][k]; accIm[t0 + 1] += yi * cloudHi[v][k];
          }
        }
        // One normalisation per frame keeps the frame's power equal to the power it came from, so Fuzz changes the character and not the level
        // (the voices average to exactly the source at Fuzz 0; a wide spray is power-preserving). It is a level match, not a clip.
        double accPower = accRe[0] * accRe[0] + accRe[bins - 1] * accRe[bins - 1];
        double correlated = 0;
        for (int k = 1; k < bins - 1; ++k) {
          const double bp = 2 * (specRe[k] * specRe[k] + specIm[k] * specIm[k]);
          accPower += 2 * (accRe[k] * accRe[k] + accIm[k] * accIm[k]);
          correlated += bp * cloudCorr[k];
        }
        // Makeup for the overlap-add of decorrelated frames: the power-weighted correlation r of the frame gives 1 / sqrt((1 - r) / 8 + r).
        const double r = sourcePower > 0 ? correlated / sourcePower : 1.0;
        const double makeup = 1.0 / __builtin_sqrt((1.0 - r) * 0.125 + r);
        const double normal = accPower > 1e-30 && sourcePower > 0 ? makeup * __builtin_sqrt(sourcePower / accPower) : 1.0;
        for (int k = 0; k < bins; ++k) {
          const bool edge = k == 0 || k == bins - 1;
          re[c][k] = (float)(accRe[k] * normal);
          im[c][k] = edge ? 0 : (float)(accIm[k] * normal);
          if (!edge) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
        }
      }
      transform(size, re[c], im[c], true);
      for (int i = 0; i < size; ++i)
        ola[c][(position + 1 + i) % size] += re[c][i] * window[i] * olaGain;
    }
    return true;
  }
  double tick(double left, double r, double seconds, double width, double diffusion, double mix, double rate) {
    const int size = windowSize, hopSize = size / (cloud ? 8 : 4);
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
  bool desiredCloud;
  double fade, right, rate;
  bool changing, started;
  void reset() {
    for (auto& core : cores) core.reset(4096);
    cores[0].cloud = cores[1].cloud = desiredCloud;
    current = warm = 0; fade = right = rate = 0; changing = started = false;
  }
  void initialize() {
    desired = 4096; desiredCloud = false;
    for (auto& core : cores) {
      core.phaseSmoothMs = 10; core.amplitudeSmoothMs = 0; core.stereoSpread = 1;
      core.swarm = 0; core.swarmLevel = 0; core.swarmRate = 5; core.swarmDrift = 0; core.swarmSeed = 1;
      core.cloud = false; core.cloudFuzz = 0; core.cloudVoices = 3;
    }
    reset();
  }
  void beginChange() {
    Core& from = cores[current]; Core& to = cores[1 - current];
    to.cloud = desiredCloud; // the hop (N/4 or N/8) is part of the core; it changes with the same warm-and-crossfade as an FFT size change
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
    if (!changing && (cores[current].windowSize != desired || cores[current].cloud != desiredCloud)) beginChange();
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
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({"module":"spectral_blur","targetType":"spectralBlur","label":"Spectral Blur","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window and processing delay in samples. At 48 kHz: 512 = 10.67 ms, 4096 = 85.33 ms, 8192 = 170.67 ms, 16384 = 341.33 ms. Smaller is tighter; larger resolves lower frequencies and costs more memory and peak CPU. Edits warm and crossfade, but intentionally change delay. Plugin-host compensation is not yet verified."},
{"key":"smearSeconds","label":"Time Smear","kind":"time","defaultValue":"2","min":"0","mid":"1","max":"10","unit":"s","step":"any","nonlinearSlider":true,"tooltip":"Spectral power averaging time constant in seconds. Zero follows each frame; longer values soften attacks and leave slowly decaying spectral clouds. Not a delay or freeze."},
{"key":"blurHz","label":"Frequency Blur","kind":"frequency","defaultValue":"100","min":"0","mid":"200","max":"4000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Power-spreading neighborhood half-width in Hz. Zero leaves bins separate. Higher values spread harmonics into surrounding frequencies. FFT Size sets the frequency resolution."},
{"key":"diffusion","label":"Diffusion","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"×","step":"any","tooltip":"Phase excursion amount, from coherent phase to full diffusion. Rotates each bin without complex-spectrum crossfade cancellations. Stereo Spread controls channel decorrelation; no makeup gain."},
{"key":"stereoSpread","label":"Stereo Spread","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"×","step":"any","tooltip":"Opposite-channel phase diffusion spread. Zero links the phase motion; higher values give mono input a stereo wash. Does not crossfeed audio. Requires Diffusion above zero; mono summing can change tone through phase cancellation."},
{"key":"phaseSmoothMs","label":"Phase Smooth","kind":"time","defaultValue":"10","min":"0","mid":"10","max":"200","unit":"ms","step":"any","nonlinearSlider":true,"tooltip":"Time constant for smoothing the unwrapped phase-diffusion trajectory. Zero keeps raw phase motion. Does not smooth spectral magnitudes or reduce their contrast. Updates at the STFT hop rate."},
{"key":"amplitudeSmoothMs","label":"Amplitude Smooth","kind":"time","defaultValue":"0","min":"0","mid":"10","max":"200","unit":"ms","step":"any","nonlinearSlider":true,"tooltip":"Additional symmetric per-bin magnitude smoothing after frequency spreading. Zero preserves the sharp amplitude texture. Increase gently to soften chatter; this is not compression, saturation or limiting. Updates at the STFT hop rate."},
{"key":"swarm","label":"Swarm","defaultValue":"0","min":"0","mid":"45","max":"180","unit":"°","step":"any","tooltip":"Peak phase wobble of each partial, in degrees, a fuzzy buzz that stays in place in time. Zero is off and leaves the sound unchanged. It is not a smear: with Time Smear, Frequency Blur and Diffusion at zero, transients keep their time (plus the FFT Size delay). Wobble updates at the STFT hop rate."},
{"key":"swarmLevel","label":"Level","defaultValue":"0","min":"0","mid":"6","max":"24","unit":"dB","step":"any","tooltip":"Level wobble of each partial, in dB (plus or minus at its peak), applied after Amplitude Smooth. Zero leaves levels alone. Updates at the STFT hop rate."},
{"key":"swarmRate","label":"Rate","kind":"frequency","defaultValue":"5","min":"0","mid":"5","max":"1000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"How fast the Swarm wobble moves. Updates at the STFT hop rate (about 47 Hz at 4096 and 48 kHz), so it is not audio-rate modulation. No effect while Swarm, Level and Drift are zero."},
{"key":"swarmDrift","label":"Drift","kind":"frequency","defaultValue":"0","min":"0","mid":"1","max":"20","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Pitch wander of each partial around its own frequency, in Hz at its peak. It is not Frequency Blur: no power moves to neighboring bins. Uses the Swarm Rate."},
{"key":"swarmSeed","label":"Seed","kind":"seed","defaultValue":"1","min":"0","mid":"1","max":"16777215","step":"1","linearSmoothing":false,"smoothingType":"none","tooltip":"Seed for the Swarm, Level and Drift noise. Same Seed, same input and same settings give the same sound. No effect while Swarm, Level and Drift are zero."},
{"key":"swarmCharacter","label":"Character","kind":"choice","choices":["Warble","Cloud"],"defaultValue":"0","min":"0","mid":"0","max":"1","step":"1","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":true,"tooltip":"Warble is the slow per-partial wobble (Swarm, Level, Rate, Drift). Cloud smears each partial into a soft band that is the same width in cents at every pitch, so a high note gets the same fuzz as a low one, still in place in time (no Time Smear needed). Cloud runs at an 8x overlap and uses Fuzz, Level (as a fast level dither), Voices and Seed; Swarm, Rate and Drift are Warble-only. A Character change warms a second core and crossfades."},
{"key":"swarmFuzz","label":"Fuzz","defaultValue":"0","min":"0","mid":"50","max":"200","unit":"\u00a2","step":"any","nonlinearSlider":true,"tooltip":"Cloud width in cents: each partial is sprayed to within plus or minus this many cents of itself, a different amount every hop. Zero is dry. The spray reaches at most 32 bins from a partial. Only used by Cloud."},
{"key":"swarmVoices","label":"Voices","defaultValue":"3","min":"2","mid":"3","max":"4","step":"1","linearSmoothing":false,"tooltip":"Cloud voices: independent sprays of the same single analysis, summed power-for-power. More voices is a denser fur. Only used by Cloud."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to the selected FFT Size. Both paths have that many samples of delay. Turn off Time Smear, Frequency Blur, Diffusion, Amplitude Smooth, Swarm, Level and Drift for neutral reconstruction."}]})json";
}
extern "C" int soemdsp_spectral_blur_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure(); fft4096.ensure(); fft8192.ensure();
    s->initialize(); pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_blur_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_blur_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" void soemdsp_spectral_blur_set_smoothing(int h, double phaseMs, double amplitudeMs) {
  if (auto* s = get(h)) {
    for (auto& core : s->cores) {
      core.phaseSmoothMs = __builtin_isfinite(phaseMs) && phaseMs > 0 ? phaseMs : 0;
      core.amplitudeSmoothMs = __builtin_isfinite(amplitudeMs) && amplitudeMs > 0 ? amplitudeMs : 0;
    }
  }
}
// Swarm phase wobble in degrees, Level wobble in dB, Rate in Hz, Drift (pitch wander) in Hz, Seed (integer). Cheap to call every sample;
// a changed Seed reseeds both cores.
extern "C" void soemdsp_spectral_blur_set_swarm(int h, double phaseDegrees, double levelDb, double rateHz, double driftHz, double seed) {
  if (auto* s = get(h)) {
    // Only guards the type and non-finite input: any finite non-negative Seed up to the 32-bit integer range is used as given.
    const unsigned int sd = __builtin_isfinite(seed) && seed > 0 ? (seed >= 4294967295.0 ? 4294967295u : (unsigned int)seed) : 0u;
    for (auto& core : s->cores) {
      // The parameter definitions own the ranges; nothing is clamped here. Only what would break the math is guarded: a non-finite value
      // is 0, and a negative Rate is 0 (a negative rate would make the one-pole coefficient exceed 1 and the filter blow up).
      core.swarm = __builtin_isfinite(phaseDegrees) ? phaseDegrees : 0;
      core.swarmLevel = __builtin_isfinite(levelDb) ? levelDb : 0;
      core.swarmDrift = __builtin_isfinite(driftHz) ? driftHz : 0;
      core.swarmRate = __builtin_isfinite(rateHz) && rateHz > 0 ? rateHz : 0;
      if (sd != core.swarmSeed) { core.swarmSeed = sd; core.seedSwarm(); core.seedCloud(); }
    }
  }
}
// Character (0 = Warble, 1 = Cloud), Fuzz in cents, Voices. Cheap to call every sample; a Character change warms a second core and crossfades.
extern "C" void soemdsp_spectral_blur_set_cloud(int h, double character, double fuzzCents, double voices) {
  if (auto* s = get(h)) {
    s->desiredCloud = __builtin_isfinite(character) && character >= 0.5;
    for (auto& core : s->cores) {
      core.cloudFuzz = __builtin_isfinite(fuzzCents) ? fuzzCents : 0;
      // Voices is rounded to a whole number; the arrays hold 4, so more than that is held to the array size (a storage guard).
      const double v = __builtin_isfinite(voices) ? voices : 1;
      core.cloudVoices = v < 1 ? 1 : v > kMaxVoices ? kMaxVoices : (int)(v + 0.5);
    }
  }
}
extern "C" void soemdsp_spectral_blur_set_stereo_spread(int h, double amount) {
  if (auto* s = get(h)) for (auto& core : s->cores) core.stereoSpread = __builtin_isfinite(amount) ? amount : 0;
}
extern "C" int soemdsp_spectral_blur_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096 && length != 8192 && length != 16384)) return -1;
  s->desired = length; return 0;
}
extern "C" int soemdsp_spectral_blur_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
extern "C" double soemdsp_spectral_blur_sample(int h, double l, double r, double seconds, double hz, double diffusion, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, seconds, hz, diffusion, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_blur_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_blur_latency() { return 4096; }
extern "C" int soemdsp_spectral_blur_latency_for_handle(int h) { return soemdsp_spectral_blur_fft_size(h); }
extern "C" int soemdsp_spectral_blur_version() { return 6; }
extern "C" const char* soemdsp_spectral_blur_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_blur_metadata_json_size() { return sizeof(metadata) - 1; }
