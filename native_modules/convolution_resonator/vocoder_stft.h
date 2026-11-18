#pragma once
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/exp_log.h>

namespace convolution_resonator {
constexpr int kFrame = 512, kHop = kFrame / 4, kMaxFrame = 2048;
template<int N> inline soemdsp::fft::Radix2<N> frameFft{};
inline auto& fft = frameFft<512>;
template<int kFrame, int kHop, int kAlignment = kMaxFrame, int kSpectralScale = 1> struct StftFrame {
  static constexpr int size = kFrame, step = kHop, alignment = kAlignment;
  float input[3][kFrame], ola[2][kAlignment];
  float carrierRe[kFrame], carrierIm[kFrame], re[kFrame], im[kFrame];
  float envelope[kFrame / 2 + 1], window[kFrame];
  float smoothA[kFrame / 2], smoothNorm[kFrame / 2], forward[kFrame / 2];
  double lastBandwidth;
  int position, outPosition, hop;
  double right;

  void reset() {
    position = outPosition = hop = 0; right = 0; lastBandwidth = -1;
    auto& fft = frameFft<kFrame>;
    fft.ensure();
    for (int i = 0; i < kFrame; ++i) {
      for (auto& channel : input) channel[i] = 0;
      window[i] = i == kFrame / 2 ? 1.0f
        : 0.5f - 0.5f * fft.twRe[i < kFrame / 2 ? i : kFrame - i];
    }
    for (auto& channel : ola) for (float& sample : channel) sample = 0;
  }

  void smooth(double bandwidth) {
    if (bandwidth <= 0) return;
    constexpr int end = kFrame / (2 * kSpectralScale) - 1;
    if (lastBandwidth != bandwidth) {
      const double width = bandwidth < 1 ? 0.6931471805599453 * bandwidth / (1 - bandwidth) : 0;
      double weight = 0;
      for (int k = 1; k <= end; ++k) {
        smoothA[k] = k == 1 ? 0 : (bandwidth >= 1 ? 1 : (float)soemdsp_maths::dsp_exp(
          -soemdsp_maths::dsp_ln((double)k / (k - 1)) / width));
        weight = 1 + smoothA[k] * weight;
        smoothNorm[k] = (float)weight;
      }
      weight = 0;
      for (int k = end; k >= 1; --k) {
        weight = 1 + (k == end ? 0 : smoothA[k + 1] * weight);
        smoothNorm[k] = (float)(1 / (smoothNorm[k] + weight - 1));
      }
      lastBandwidth = bandwidth;
    }
    double value = 0;
    for (int k = 1; k <= end; ++k) {
      value = envelope[k] + smoothA[k] * value;
      forward[k] = (float)value;
    }
    value = 0;
    for (int k = end; k >= 1; --k) {
      value = envelope[k] + (k == end ? 0 : smoothA[k + 1] * value);
      envelope[k] = (float)((forward[k] + value - envelope[k]) * smoothNorm[k]);
    }
  }

  double envelopeGain(double source) const {
    if (!(source >= 1 && source < kFrame / (2 * kSpectralScale))) return 0;
    const int index = (int)source;
    const double fraction = source - index, a = envelope[index], b = envelope[index + 1];
    return fraction == 0 ? a : (a > 0 && b > 0
      ? soemdsp_maths::dsp_exp(soemdsp_maths::dsp_ln(a)
        + fraction * (soemdsp_maths::dsp_ln(b) - soemdsp_maths::dsp_ln(a)))
      : a + fraction * (b - a));
  }
  void analyze() { frameFft<kFrame>.transform(re, im, false); }

  void frame(double shift, bool unityEnvelope, double bandwidth, int skip = 0) {
    auto& fft = frameFft<kFrame>;
    bool hasCarrier = false, hasVoice[2]{};
    for (int i = 0; i < kFrame; ++i) {
      const int p = (position + 1 + i) % kFrame;
      carrierRe[i] = input[2][p] * window[i];
      carrierIm[i] = 0;
      hasCarrier = hasCarrier || carrierRe[i] != 0;
      for (int c = 0; c < 2; ++c) hasVoice[c] = hasVoice[c] || input[c][p] != 0;
    }
    // Skip only zero-contribution frames; pending overlap-add tails stay intact.
    if (!hasCarrier || (!unityEnvelope && !hasVoice[0] && !hasVoice[1])) return;
    fft.transform(carrierRe, carrierIm, false);
    const double ratio = soemdsp_maths::dsp_exp(shift * (0.6931471805599453 / 12));
    for (int c = 0; c < 2; ++c) {
      if (!unityEnvelope && !hasVoice[c]) continue;
      for (int i = 0; i < kFrame; ++i) {
        re[i] = input[c][(position + 1 + i) % kFrame] * window[i];
        im[i] = 0;
      }
      analyze();
      for (int k = 0; k <= kFrame / 2; ++k)
        envelope[k] = __builtin_sqrt((double)re[k] * re[k] + (double)im[k] * im[k]) * (4.0 / kFrame);
      smooth(bandwidth);
      for (int k = 0; k <= kFrame / 2; ++k) {
        const double source = k / ratio;
        double gain = 0;
        if (unityEnvelope) gain = 1;
        else if (k > 0 && k < kFrame / 2) gain = envelopeGain(source);
        re[k] = (float)(carrierRe[k] * gain); im[k] = (float)(carrierIm[k] * gain);
        if (k > 0 && k < kFrame / 2) { re[kFrame - k] = re[k]; im[kFrame - k] = -im[k]; }
      }
      fft.transform(re, im, true);
      // Hann squared sums to 3*N/(8*H), including the sliding-hop sizes.
      // All sizes schedule onto one alignment: 2048 base samples, or 4096 at 2x.
      for (int i = skip; i < kFrame; ++i)
        ola[c][(outPosition + 1 + kAlignment - kFrame + i) % kAlignment]
          += re[i] * window[i] * (8.0f * kHop / (3.0f * kFrame));
    }
  }

  double tick(double left, double rightInput, double carrier, double shift, bool unityEnvelope = false, double bandwidth = 0) {
    const double result = ola[0][outPosition]; right = ola[1][outPosition];
    ola[0][outPosition] = ola[1][outPosition] = 0;
    input[0][position] = (float)left; input[1][position] = (float)rightInput;
    input[2][position] = (float)carrier;
    if (++hop == kHop) { hop = 0; frame(shift, unityEnvelope, bandwidth); }
    position = (position + 1) % kFrame;
    outPosition = (outPosition + 1) % kAlignment;
    return result;
  }
};
using VocoderStft = StftFrame<512, 128>;
inline double unit(double value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
struct CrunchSelection { int low, high; double blend; };
inline CrunchSelection selectCrunch(double crunch, double response) {
  const double index = 6 * (1 - unit(crunch + response));
  const int low = (int)index;
  const double fraction = index - low;
  return {low, low < 6 ? low + 1 : 6, fraction * fraction * (3 - 2 * fraction)};
}
template<int Scale> struct CrunchVocoderT {
  static constexpr int alignment = kMaxFrame * Scale, historySize = 2 * alignment;
  StftFrame<32 * Scale, Scale, alignment, Scale> n32;
  StftFrame<64 * Scale, 2 * Scale, alignment, Scale> n64;
  StftFrame<128 * Scale, 32 * Scale, alignment, Scale> n128;
  StftFrame<256 * Scale, 64 * Scale, alignment, Scale> n256;
  StftFrame<512 * Scale, 128 * Scale, alignment, Scale> n512;
  StftFrame<1024 * Scale, 256 * Scale, alignment, Scale> n1024;
  StftFrame<2048 * Scale, 512 * Scale, alignment, Scale> n2048;
  float history[3][historySize];
  double shifts[historySize], widths[historySize];
  bool unities[historySize];
  long long time, lastActive[7];
  double right;
  void reset() {
    n32.reset(); n64.reset(); n128.reset(); n256.reset(); n512.reset(); n1024.reset(); n2048.reset(); right = 0;
    time = 0;
    for (auto& t : lastActive) t = -2;
    for (int i = 0; i < historySize; ++i) {
      for (auto& channel : history) channel[i] = 0;
      shifts[i] = widths[i] = 0; unities[i] = false;
    }
  }
  double tick(double left, double rightInput, double carrier, double shift,
    double crunch, double response, double bandwidth, bool unity = false, bool reference = false) {
    const double width = unit(crunch + bandwidth);
    const auto selected = selectCrunch(crunch, response);
    const int low = selected.low, high = selected.high;
    const double blend = selected.blend;
    const int hp = (int)(time % historySize);
    history[0][hp] = (float)left; history[1][hp] = (float)rightInput; history[2][hp] = (float)carrier;
    shifts[hp] = shift; widths[hp] = width; unities[hp] = unity;
    double output[7][2]{};
    auto run = [&](auto& core, int slot) {
      if (reference) {
        output[slot][0] = core.tick(left, rightInput, carrier, shift, unity, width);
        output[slot][1] = core.right;
        return;
      }
      if (slot != low && (slot != high || blend == 0)) return;
      const int N = core.size, H = core.step;
      const long long relative = time - alignment;
      const long long latest = relative >= 0 ? relative / H * H : -((-relative + H - 1) / H) * H;
      const bool waking = lastActive[slot] != time - 1;
      if (waking) for (auto& channel : core.ola) for (float& sample : channel) sample = 0;
      auto render = [&](long long start) {
        const long long end = start + N - 1;
        if (end < 0) return;
        for (int i = 0; i < N; ++i) {
          const long long source = start + i;
          const int p = source >= 0 ? (int)(source % historySize) : 0;
          for (int c = 0; c < 3; ++c) core.input[c][i] = source >= 0 ? history[c][p] : 0;
        }
        core.position = N - 1;
        core.outPosition = (int)((end % alignment + alignment) % alignment);
        const int p = (int)(end % historySize);
        const int skip = (int)(time - (start + alignment));
        core.frame(shifts[p], unities[p], widths[p], skip > 0 ? skip : 0);
      };
      // On wake, reconstruct only the N/H frames overlapping this output.
      // Original frame-time controls are retained alongside the input audio.
      if (waking) for (int j = 0; j < N / H; ++j) render(latest - N + H + j * H);
      else if (relative == latest) render(latest);
      core.outPosition = (int)(time % alignment);
      output[slot][0] = core.ola[0][core.outPosition];
      output[slot][1] = core.ola[1][core.outPosition];
      core.ola[0][core.outPosition] = core.ola[1][core.outPosition] = 0;
      lastActive[slot] = time;
    };
    run(n32, 0); run(n64, 1); run(n128, 2); run(n256, 3); run(n512, 4); run(n1024, 5); run(n2048, 6);
    ++time;
    right = output[low][1] + blend * (output[high][1] - output[low][1]);
    return output[low][0] + blend * (output[high][0] - output[low][0]);
  }
};
using CrunchVocoder = CrunchVocoderT<1>;
}
