#pragma once
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace soemdsp_spectral {
constexpr int size = 1024, hopSize = 256, bins = size / 2 + 1, regions = 32;
inline soemdsp::fft::Radix2<size> fft{};
inline double db(double power) {
  return 4.342944819032518 * soemdsp_maths::dsp_ln(power > 1e-30 ? power : 1e-30);
}
inline double amp(double valueDb) { return soemdsp_maths::dsp_exp(valueDb * 0.11512925464970229); }
inline double unit(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
struct Params {
  double contrast = 0, scale = 1, threshold = -24, ratio = 1;
  double attack = 10, release = 100, boost = 18, gain = 0, mix = 1;
  double margin = 3, depth = 60, smooth = 0.5, knee = 6, hold = 0;
  int profile = 0;
};

// Same periodic Hann / 4x overlap and normalized inverse FFT as the tested
// resonator STFT. Stereo-linked gains retain the original complex phases.
template<bool Gate> struct Engine {
  float input[2][size], ola[2][size], re[2][size], im[2][size], window[size];
  double power[bins], noise[Gate ? bins : 1], binGain[bins], target[Gate ? bins : 1];
  double heldGain[Gate ? bins : 1], holdAge[Gate ? bins : 1];
  double bandPower[Gate ? 1 : regions], bandGain[Gate ? 1 : regions];
  double weights[Gate ? 1 : regions][Gate ? 1 : regions];
  int bandIndex[Gate ? 1 : bins];
  double bandFraction[Gate ? 1 : bins], lastRate, lastScale, lastGain, outputGain, right, profileRate, gateKnee, gateHold;
  unsigned long long learnedFrames, samples, learnStart;
  int position, hop, previousProfile;

  void reset(bool forgetProfile = true) {
    fft.ensure();
    for (int i = 0; i < size; ++i) {
      window[i] = i == size / 2 ? 1.0f : 0.5f - 0.5f * fft.twRe[i < size / 2 ? i : size - i];
      for (int c = 0; c < 2; ++c) input[c][i] = ola[c][i] = 0;
    }
    for (auto& g : binGain) g = 0;
    for (auto& g : heldGain) g = 0;
    for (auto& age : holdAge) age = 0;
    for (auto& g : bandGain) g = 0;
    if (forgetProfile) { for (auto& p : noise) p = 0; learnedFrames = 0; profileRate = 0; }
    position = hop = samples = learnStart = 0; right = 0;
    lastRate = lastScale = -1; lastGain = __builtin_huge_val(); outputGain = 1; previousProfile = -1;
  }
  void configure(double rate, double scale) {
    if (lastRate == rate && lastScale == scale) return;
    if (lastRate != rate) {
      const double logRange = soemdsp_maths::dsp_ln(rate * 0.5 / 40);
      for (int k = 0; k < bins; ++k) {
        const double hz = rate * k / size;
        double index = hz <= 40 ? 0 : (regions - 1) * soemdsp_maths::dsp_ln(hz / 40) / logRange;
        if (index > regions - 1) index = regions - 1;
        bandIndex[k] = (int)index; bandFraction[k] = index - bandIndex[k];
      }
    }
    const double spacing = soemdsp_maths::dsp_ln(rate * 0.5 / 40) / (0.6931471805599453 * (regions - 1));
    for (int a = 0; a < regions; ++a) {
      double sum = 0;
      for (int b = 0; b < regions; ++b) {
        const double distance = spacing * (a - b);
        const double w = scale <= 0 ? (a == b ? 1 : 0)
          : soemdsp_maths::dsp_exp(-0.5 * distance * distance / (scale * scale));
        weights[a][b] = w; sum += w;
      }
      for (auto& w : weights[a]) w /= sum;
    }
    lastRate = rate; lastScale = scale;
  }
  bool frame(const Params& p, double rate) {
    for (int c = 0; c < 2; ++c) {
      for (int i = 0; i < size; ++i) {
        re[c][i] = input[c][(position + 1 + i) % size] * window[i]; im[c][i] = 0;
      }
      fft.transform(re[c], im[c], false);
    }
    for (int k = 0; k < bins; ++k) {
      double v = 0;
      for (int c = 0; c < 2; ++c) v += (double)re[c][k] * re[c][k] + (double)im[c][k] * im[c][k];
      if (!__builtin_isfinite(v)) return false;
      // Parseval normalization: sum of one-sided powers is mean stereo power.
      power[k] = v * (k == 0 || k == size / 2 ? 1 : 2) / (2.0 * size * (3.0 * size / 8));
    }
    const double attack = p.attack > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * p.attack * 0.001)) : 0;
    const double release = p.release > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * p.release * 0.001)) : 0;
    if constexpr (Gate) {
      if (p.profile == 1 && samples - learnStart >= size) {
        profileRate = rate;
        ++learnedFrames;
        for (int k = 0; k < bins; ++k) noise[k] += (power[k] - noise[k]) / learnedFrames;
      }
      for (int k = 0; k < bins; ++k) {
        double threshold = p.threshold;
        if (p.profile == 2 && learnedFrames) threshold = db(noise[k]) + p.margin;
        const double delta = db(power[k]) - threshold;
        const double opening = p.knee > 0 ? unit((delta + 0.5 * p.knee) / p.knee)
          : (delta >= 0 ? 1 : 0);
        target[k] = amp(-p.depth * (1 - opening * opening * (3 - 2 * opening)));
        const bool bypass = p.profile == 1 || (p.profile == 2 && !learnedFrames);
        if (bypass || p.hold <= 0) { heldGain[k] = 0; holdAge[k] = 0; }
        else {
          // Peak hold is retriggered while above threshold; Release starts only
          // after the below-threshold age reaches the live Hold duration.
          if (delta >= 0) {
            if (target[k] > heldGain[k]) heldGain[k] = target[k];
            holdAge[k] = 0;
          } else {
            holdAge[k] += hopSize / rate;
            if (holdAge[k] >= p.hold * 0.001) heldGain[k] = 0;
          }
          if (heldGain[k] > target[k]) target[k] = heldGain[k];
        }
        if (bypass) target[k] = 1;
      }
      for (int k = 0; k < bins; ++k) {
        double sum = 0, norm = 0;
        for (int j = -2; j <= 2; ++j) if (k + j >= 0 && k + j < bins) {
          const double w = 3 - (j < 0 ? -j : j); sum += w * target[k + j]; norm += w;
        }
        const double linked = target[k] + unit(p.smooth) * (sum / norm - target[k]);
        const double desired = db(linked * linked);
        const double pole = desired > binGain[k] ? attack : release;
        binGain[k] = desired + pole * (binGain[k] - desired);
      }
    } else {
      configure(rate, p.scale);
      for (auto& v : bandPower) v = 0;
      for (int k = 0; k < bins; ++k) {
        const int a = bandIndex[k]; const double f = bandFraction[k];
        bandPower[a] += power[k] * (1 - f);
        if (a + 1 < regions) bandPower[a + 1] += power[k] * f;
      }
      double smoothed[regions], mean = 0;
      for (int a = 0; a < regions; ++a) {
        smoothed[a] = 0;
        for (int b = 0; b < regions; ++b) smoothed[a] += weights[a][b] * bandPower[b];
        mean += smoothed[a] / regions;
      }
      const double reference = db(mean);
      for (int a = 0; a < regions; ++a) {
        const double level = db(smoothed[a]);
        double desired = p.contrast * (level - reference);
        if (level > p.threshold) desired -= (1 - 1 / p.ratio) * (level - p.threshold);
        if (desired > p.boost) desired = p.boost;
        const double pole = desired < bandGain[a] ? attack : release;
        bandGain[a] = desired + pole * (bandGain[a] - desired);
      }
      for (int k = 0; k < bins; ++k) {
        const int a = bandIndex[k];
        binGain[k] = bandGain[a] + bandFraction[k] * (bandGain[a + (a + 1 < regions ? 1 : 0)] - bandGain[a]);
      }
    }
    for (int c = 0; c < 2; ++c) {
      for (int k = 0; k < bins; ++k) {
        const double gain = amp(binGain[k]);
        re[c][k] *= gain; im[c][k] *= gain;
        if (k > 0 && k < size / 2) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
      }
      fft.transform(re[c], im[c], true);
      for (int i = 0; i < size; ++i)
        ola[c][(position + 1 + i) % size] += re[c][i] * window[i] * (2.0f / 3);
    }
    return true;
  }
  double tick(double left, double r, const Params& p, double rate) {
    const double values[] = {left, r, p.contrast, p.scale, p.threshold, p.ratio,
      p.attack, p.release, p.boost, p.gain, p.mix, p.margin, p.depth, p.smooth, p.knee, p.hold, rate};
    for (double v : values) if (!__builtin_isfinite(v)) { reset(false); return 0; }
    if (!__builtin_isfinite((float)left) || !__builtin_isfinite((float)r)) { reset(false); return 0; }
    if (rate <= 100 || p.ratio <= 0) { reset(false); return 0; }
    if (lastRate > 0 && lastRate != rate) reset(true);
    if constexpr (Gate) {
      lastRate = rate;
      if (learnedFrames && profileRate != rate) { for (auto& n : noise) n = 0; learnedFrames = 0; profileRate = 0; }
      if (p.profile != previousProfile) {
        for (auto& g : heldGain) g = 0;
        for (auto& age : holdAge) age = 0;
      }
      if (p.profile == 1 && previousProfile != 1) {
        for (auto& n : noise) n = 0;
        learnedFrames = 0; learnStart = samples;
      }
      previousProfile = p.profile;
    }
    if (p.gain != lastGain) { outputGain = amp(p.gain); lastGain = p.gain; }
    const double dry[2] = {input[0][position], input[1][position]};
    const double wet[2] = {ola[0][position], ola[1][position]};
    ola[0][position] = ola[1][position] = 0;
    input[0][position] = (float)left; input[1][position] = (float)r; ++samples;
    if (++hop == hopSize) { hop = 0; if (!frame(p, rate)) { reset(false); return 0; } }
    position = (position + 1) % size;
    const double result = outputGain * (dry[0] + p.mix * (wet[0] - dry[0]));
    right = outputGain * (dry[1] + p.mix * (wet[1] - dry[1]));
    if (!__builtin_isfinite(result) || !__builtin_isfinite(right)) { reset(false); return 0; }
    return result;
  }
};
// Display tap (read-only), shared by STFT Gate and STFT Contrast: per-bin input
// power (one-sided, Parseval-normalized, the same units as Threshold) and the
// per-bin gain in dB the audio applies. bins = size / 2 + 1, bin k is at
// k * rate / size. frames counts analysis hops (changes when new data exists).
template<class E> inline const double* display_power(E* s) { return s ? s->power : nullptr; }
template<class E> inline const double* display_gain(E* s) { return s ? s->binGain : nullptr; }
template<class E> inline double display_rate(E* s) { return s && s->lastRate > 0 ? s->lastRate : 0; }
template<class E> inline double display_frames(E* s) { return s ? (double)(s->samples / hopSize) : 0; }

template<bool Gate> struct Pool {
  static constexpr int capacity = 64;
  static inline Engine<Gate>* items[capacity]{};
  static Engine<Gate>* get(int h) { return h > 0 && h <= capacity ? items[h - 1] : nullptr; }
  static int create() {
    for (int i = 0; i < capacity; ++i) if (!items[i]) {
      auto* s = static_cast<Engine<Gate>*>(soemdsp::memory_pool::alloc(sizeof(Engine<Gate>)));
      if (!s) return 0;
      s->gateKnee = 6; s->gateHold = 0; s->reset(); items[i] = s; return i + 1;
    }
    return 0;
  }
  static void destroy(int h) { if (auto* s = get(h)) { soemdsp::memory_pool::release(s); items[h - 1] = nullptr; } }
};
}
