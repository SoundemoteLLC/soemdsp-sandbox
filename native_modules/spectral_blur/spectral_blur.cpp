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
double unit(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
struct State {
  float input[2][size], ola[2][size], re[2][size], im[2][size], window[size];
  double power[2][bins], phaseR[2][bins], phaseI[2][bins];
  double prevR[2][bins], prevI[2][bins], velocityR[2][bins], velocityI[2][bins];
  double prefix[bins + 1], blurred[bins], offset[bins];
  unsigned int rng;
  int position, hop;
  double right, lastRate;

  void reset() {
    fft.ensure();
    for (int i = 0; i < size; ++i) {
      window[i] = i == size / 2 ? 1 : 0.5f - 0.5f * fft.twRe[i < size / 2 ? i : size - i];
      for (int c = 0; c < 2; ++c) input[c][i] = ola[c][i] = 0;
    }
    for (int k = 0; k < bins; ++k) {
      offset[k] = 0;
      for (int c = 0; c < 2; ++c) {
        power[c][k] = prevR[c][k] = prevI[c][k] = phaseI[c][k] = 0;
        phaseR[c][k] = 1;
        // The exact bin-centered advance is a multiple of pi/2 at this hop.
        const int q = k % 4;
        velocityR[c][k] = q == 0 ? 1 : q == 2 ? -1 : 0;
        velocityI[c][k] = q == 1 ? 1 : q == 3 ? -1 : 0;
      }
    }
    position = hop = 0; right = lastRate = 0; rng = 0x9e3779b9u;
  }
  double random() {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return (double)rng * (2.0 / 4294967296.0) - 1.0;
  }
  void spread(int channel, int radius, double weight) {
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
    const double pole = seconds > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * seconds)) : 0;
    double radius = widthHz * size / rate;
    if (radius > bins - 1) radius = bins - 1;
    const int r = (int)radius;
    const double fraction = radius - r;
    // Full diffusion is a fixed 2 Hz Brownian phase diffuser; the parameter
    // is explicitly a complex-spectrum blend, not a disguised time/frequency.
    const double jitter = __builtin_sqrt(12.0 * twoPi * 2.0 * hopSize / rate);
    for (int k = 1; k < bins - 1; ++k) {
      offset[k] += random() * jitter;
      if (offset[k] > twoPi) offset[k] -= twoPi;
      if (offset[k] < -twoPi) offset[k] += twoPi;
    }
    for (int c = 0; c < 2; ++c) {
      for (int i = 0; i < size; ++i) {
        re[c][i] = input[c][(position + 1 + i) % size] * window[i]; im[c][i] = 0;
      }
      fft.transform(re[c], im[c], false);
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
        const double magnitude = __builtin_sqrt((blurred[k] > 0 ? blurred[k] : 0) / (edge ? 1 : 2));
        double sn = 0, cs = 1;
        if (!edge && diffusion > 0) soemdsp_maths::dsp_sin_cos(offset[k], &sn, &cs);
        const double pr = phaseR[c][k], pi = phaseI[c][k];
        re[c][k] = (float)(magnitude * (pr + diffusion * (pr * cs - pi * sn - pr)));
        im[c][k] = edge ? 0 : (float)(magnitude * (pi + diffusion * (pr * sn + pi * cs - pi)));
        if (k > 0 && k < bins - 1) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
      }
      fft.transform(re[c], im[c], true);
      for (int i = 0; i < size; ++i)
        ola[c][(position + 1 + i) % size] += re[c][i] * window[i] * (2.0f / 3);
    }
    return true;
  }
  double tick(double left, double r, double seconds, double width, double diffusion, double mix, double rate) {
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
    const double out = dryL + unit(mix) * (wetL - dryL);
    if (!__builtin_isfinite(out) || !__builtin_isfinite(right)) { reset(); return 0; }
    return out;
  }
};
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({"module":"spectral_blur","targetType":"spectralBlur","label":"Spectral Blur","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right"],"parameters":[
{"key":"smearSeconds","label":"Time Smear","kind":"time","defaultValue":"2","min":"0","mid":"1","max":"10","unit":"s","step":"any","nonlinearSlider":true,"tooltip":"Spectral power averaging time constant in seconds. Zero follows each frame; longer values soften attacks and leave slowly decaying spectral clouds. Not a delay or freeze."},
{"key":"blurHz","label":"Frequency Blur","kind":"frequency","defaultValue":"100","min":"0","mid":"200","max":"4000","unit":"Hz","step":"any","nonlinearSlider":true,"tooltip":"Power-spreading neighborhood half-width in Hz. Zero leaves bins separate. Higher values spread harmonics into surrounding frequencies. The fixed FFT limits frequency resolution."},
{"key":"diffusion","label":"Diffusion","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Complex-spectrum blend from coherent phase to a fixed-rate phase diffuser. Shared phase offsets preserve matched stereo channels. Intermediate blends can reduce level through phase cancellation; no hidden makeup gain."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Dry/wet blend aligned to 4096 samples of latency. Time Smear 0, Frequency Blur 0 and Diffusion 0 are neutral."}]})json";
}
extern "C" int soemdsp_spectral_blur_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    s->reset(); pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_blur_destroy(int h) {
  if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; }
}
extern "C" void soemdsp_spectral_blur_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" double soemdsp_spectral_blur_sample(int h, double l, double r, double seconds, double hz, double diffusion, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, seconds, hz, diffusion, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_blur_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" int soemdsp_spectral_blur_latency() { return size; }
extern "C" int soemdsp_spectral_blur_version() { return 1; }
extern "C" const char* soemdsp_spectral_blur_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_blur_metadata_json_size() { return sizeof(metadata) - 1; }
