// soemdsp-native-module: spectral_blur
// soemdsp-native-label: Spectral Blur
// soemdsp-native-target: spectralBlur
// soemdsp-native-kind: effect
#include <soemdsp/fft/fft_radix2.h>
#include <soemdsp/math/analog_filter_trig.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int size = 4096, hopSize = 1024, bins = size / 2 + 1, capacity = 64;
constexpr double twoPi = 6.283185307179586;
soemdsp::fft::Radix2<size> fft{};
soemdsp::fft::Radix2<512> fft512{};
soemdsp::fft::Radix2<1024> fft1024{};
soemdsp::fft::Radix2<2048> fft2048{};
void transform(int length, float* re, float* im, bool inverse) {
  switch (length) {
    case 512: fft512.transform(re, im, inverse); break;
    case 1024: fft1024.transform(re, im, inverse); break;
    case 2048: fft2048.transform(re, im, inverse); break;
    default: fft.transform(re, im, inverse); break;
  }
}
double unit(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
struct Core {
  float input[2][size], ola[2][size], re[2][size], im[2][size], window[size];
  double power[2][bins], phaseR[2][bins], phaseI[2][bins];
  double prevR[2][bins], prevI[2][bins], velocityR[2][bins], velocityI[2][bins];
  double prefix[bins + 1], blurred[bins], offset[bins], smoothOffset[bins], magnitudeState[2][bins];
  double sideOffset[bins], smoothSideOffset[bins];
  float padding[2][size];
  unsigned int rng, sideRng;
  int position, hop, windowSize, padPosition;
  double right, lastRate, phaseSmoothMs, amplitudeSmoothMs, stereoSpread;

  void reset(int length = 0) {
    if (length) windowSize = length;
    fft.ensure();
    for (int i = 0; i < size; ++i) {
      const int index = i < windowSize ? (i < windowSize / 2 ? i : windowSize - i) * (size / windowSize) : 0;
      window[i] = i >= windowSize ? 0 : i == windowSize / 2 ? 1 : 0.5f - 0.5f * fft.twRe[index];
      for (int c = 0; c < 2; ++c) input[c][i] = ola[c][i] = padding[c][i] = 0;
    }
    for (int k = 0; k < bins; ++k) {
      offset[k] = smoothOffset[k] = 0;
      sideOffset[k] = smoothSideOffset[k] = 0;
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
    position = hop = padPosition = 0; right = lastRate = 0; rng = 0x9e3779b9u; sideRng = 0xC2B2AE35u;
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
    const int size = windowSize, hopSize = size / 4, bins = size / 2 + 1;
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
        const double magnitude = magnitudeState[c][k];
        double sn = 0, cs = 1;
        if (!edge && diffusion > 0) {
          const double phase = smoothOffset[k] + (c == 0 ? -0.5 : 0.5) * stereoSpread * smoothSideOffset[k];
          soemdsp_maths::dsp_sin_cos(diffusion * phase, &sn, &cs);
        }
        const double pr = phaseR[c][k], pi = phaseI[c][k];
        re[c][k] = (float)(magnitude * (pr * cs - pi * sn));
        im[c][k] = edge ? 0 : (float)(magnitude * (pr * sn + pi * cs));
        if (k > 0 && k < bins - 1) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
      }
      transform(size, re[c], im[c], true);
      for (int i = 0; i < size; ++i)
        ola[c][(position + 1 + i) % size] += re[c][i] * window[i] * (2.0f / 3);
    }
    return true;
  }
  double tick(double left, double r, double seconds, double width, double diffusion, double mix, double rate) {
    const int size = windowSize, hopSize = size / 4;
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
      if (!frame(seconds > 0 ? seconds : 0, width > 0 ? width : 0, unit(diffusion), rate)) { reset(); return 0; }
    }
    position = (position + 1) % size;
    right = dryR + unit(mix) * (wetR - dryR);
    double out = dryL + unit(mix) * (wetL - dryL);
    const int delay = 4096 - size;
    if (delay > 0) {
      const double a = padding[0][padPosition], b = padding[1][padPosition];
      padding[0][padPosition] = (float)out; padding[1][padPosition] = (float)right;
      out = a; right = b;
      if (++padPosition == delay) padPosition = 0;
    }
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
    for (auto& core : cores) { core.phaseSmoothMs = 10; core.amplitudeSmoothMs = 0; core.stereoSpread = 1; }
    reset();
  }
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
    warm = 4096; fade = 0; changing = true;
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
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({"module":"spectral_blur","targetType":"spectralBlur","label":"Spectral Blur","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096"],"choiceKeys":["512","1024","2048","4096"],"choiceIds":[512,1024,2048,4096],"defaultValue":"4096","min":"0","mid":"1.5","max":"3","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Analysis window length in samples. At 48 kHz: 512 = 10.67 ms, 1024 = 21.33 ms, 2048 = 42.67 ms, 4096 = 85.33 ms. Smaller windows tighten processed attacks with coarser frequency resolution. Changes warm and crossfade; total dry/wet latency stays 4096 samples."},
{"key":"smearSeconds","label":"Time Smear","kind":"time","defaultValue":"2","min":"0","mid":"1","max":"10","unit":"s","step":"any","nonlinearSlider":true,"tooltip":"Spectral power averaging time constant in seconds. Zero follows each frame; longer values soften attacks and leave slowly decaying spectral clouds. Not a delay or freeze."},
{"key":"blurHz","label":"Frequency Blur","kind":"frequency","defaultValue":"100","min":"0","mid":"200","max":"4000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Power-spreading neighborhood half-width in Hz. Zero leaves bins separate. Higher values spread harmonics into surrounding frequencies. FFT Size sets the frequency resolution."},
{"key":"diffusion","label":"Diffusion","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Phase excursion amount, from coherent phase to full diffusion. Rotates each bin without complex-spectrum crossfade cancellations. Stereo Spread controls channel decorrelation; no makeup gain."},
{"key":"stereoSpread","label":"Stereo Spread","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Opposite-channel phase diffusion spread. Zero links the phase motion; higher values give mono input a stereo wash. Does not crossfeed audio. Requires Diffusion above zero; mono summing can change tone through phase cancellation."},
{"key":"phaseSmoothMs","label":"Phase Smooth","kind":"time","defaultValue":"10","min":"0","mid":"10","max":"200","unit":"ms","step":"any","nonlinearSlider":true,"tooltip":"Time constant for smoothing the unwrapped phase-diffusion trajectory. Zero keeps raw phase motion. Does not smooth spectral magnitudes or reduce their contrast. Updates at the STFT hop rate."},
{"key":"amplitudeSmoothMs","label":"Amplitude Smooth","kind":"time","defaultValue":"0","min":"0","mid":"10","max":"200","unit":"ms","step":"any","nonlinearSlider":true,"tooltip":"Additional symmetric per-bin magnitude smoothing after frequency spreading. Zero preserves the sharp amplitude texture. Increase gently to soften chatter; this is not compression, saturation or limiting. Updates at the STFT hop rate."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to 4096 samples of latency. Turn off Time Smear, Frequency Blur, Diffusion and Amplitude Smooth for neutral reconstruction."}]})json";
}
extern "C" int soemdsp_spectral_blur_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    fft.ensure(); fft512.ensure(); fft1024.ensure(); fft2048.ensure();
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
extern "C" void soemdsp_spectral_blur_set_stereo_spread(int h, double amount) {
  if (auto* s = get(h)) for (auto& core : s->cores) core.stereoSpread = __builtin_isfinite(amount) ? unit(amount) : 0;
}
extern "C" int soemdsp_spectral_blur_set_fft_size(int h, int length) {
  auto* s = get(h); if (!s || (length != 512 && length != 1024 && length != 2048 && length != 4096)) return -1;
  s->desired = length; return 0;
}
extern "C" int soemdsp_spectral_blur_fft_size(int h) { auto* s = get(h); return s ? s->cores[s->current].windowSize : 0; }
extern "C" double soemdsp_spectral_blur_sample(int h, double l, double r, double seconds, double hz, double diffusion, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, seconds, hz, diffusion, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_blur_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_blur_latency() { return size; }
extern "C" int soemdsp_spectral_blur_version() { return 3; }
extern "C" const char* soemdsp_spectral_blur_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_blur_metadata_json_size() { return sizeof(metadata) - 1; }
