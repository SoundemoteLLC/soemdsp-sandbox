// soemdsp-native-module: spectral_freeze
// soemdsp-native-label: Spectral Freeze
// soemdsp-native-target: spectralFreeze
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
  double previousR[2][bins], previousI[2][bins], magnitude[2][bins];
  double phaseR[2][bins], phaseI[2][bins], velocityR[2][bins], velocityI[2][bins];
  double offset[bins], side[bins];
  unsigned int rng, sideRng;
  int position, hop;
  unsigned long long samples;
  bool pending, valid, lastGate, lastCapture;
  double blend, right, held, lastRate;
  void reset() {
    fft.ensure();
    for (int i = 0; i < size; ++i) {
      window[i] = i == size / 2 ? 1 : 0.5f - 0.5f * fft.twRe[i < size / 2 ? i : size - i];
      for (int c = 0; c < 2; ++c) input[c][i] = ola[c][i] = 0;
    }
    for (int k = 0; k < bins; ++k) {
      offset[k] = side[k] = 0;
      for (int c = 0; c < 2; ++c) {
        previousR[c][k] = previousI[c][k] = magnitude[c][k] = phaseI[c][k] = 0;
        phaseR[c][k] = 1;
        const int q = k % 4;
        velocityR[c][k] = q == 0 ? 1 : q == 2 ? -1 : 0;
        velocityI[c][k] = q == 1 ? 1 : q == 3 ? -1 : 0;
      }
    }
    position = hop = 0; samples = 0; pending = valid = lastGate = lastCapture = false;
    blend = right = held = lastRate = 0; rng = 0x9e3779b9u; sideRng = 0xC2B2AE35u;
  }
  double random(unsigned int& state) {
    state ^= state << 13; state ^= state >> 17; state ^= state << 5;
    return (double)state * (2.0 / 4294967296.0) - 1;
  }
  bool frame(double decay, double diffusion, double spread, double rate) {
    const bool capture = pending && samples >= size;
    const double loss = decay > 0 ? soemdsp_maths::dsp_exp(-hopSize / (rate * decay)) : 1;
    const double jitter = __builtin_sqrt(12.0 * twoPi * 2 * hopSize / rate);
    for (int k = 1; k < bins - 1; ++k) {
      offset[k] += random(rng) * jitter;
      side[k] += random(sideRng) * jitter;
      if (capture) offset[k] = side[k] = 0;
    }
    for (int c = 0; c < 2; ++c) {
      for (int i = 0; i < size; ++i) {
        re[c][i] = input[c][(position + 1 + i) % size] * window[i]; im[c][i] = 0;
      }
      fft.transform(re[c], im[c], false);
      for (int k = 0; k < bins; ++k) {
        const double a = re[c][k], b = im[c][k], p = a * a + b * b;
        if (!__builtin_isfinite(p)) return false;
        if (capture) {
          magnitude[c][k] = __builtin_sqrt(p);
          const double previous = previousR[c][k] * previousR[c][k] + previousI[c][k] * previousI[c][k];
          if (p > 1e-24) {
            phaseR[c][k] = a / magnitude[c][k]; phaseI[c][k] = b / magnitude[c][k];
            if (previous > 1e-24) {
              const double norm = __builtin_sqrt(p * previous);
              velocityR[c][k] = (a * previousR[c][k] + b * previousI[c][k]) / norm;
              velocityI[c][k] = (b * previousR[c][k] - a * previousI[c][k]) / norm;
            }
          }
        } else if (valid) {
          magnitude[c][k] *= loss;
          const double pr = phaseR[c][k], pi = phaseI[c][k];
          const double nr = pr * velocityR[c][k] - pi * velocityI[c][k];
          const double ni = pr * velocityI[c][k] + pi * velocityR[c][k];
          const double norm = __builtin_sqrt(nr * nr + ni * ni);
          if (norm > 0) { phaseR[c][k] = nr / norm; phaseI[c][k] = ni / norm; }
        }
        previousR[c][k] = a; previousI[c][k] = b;
        double sn = 0, cs = 1;
        if (k > 0 && k < bins - 1 && diffusion > 0)
          soemdsp_maths::dsp_sin_cos(diffusion * (offset[k] + (c ? 0.5 : -0.5) * spread * side[k]), &sn, &cs);
        const double pr = phaseR[c][k], pi = phaseI[c][k];
        re[c][k] = (float)(magnitude[c][k] * (pr * cs - pi * sn));
        im[c][k] = k == 0 || k == bins - 1 ? 0 : (float)(magnitude[c][k] * (pr * sn + pi * cs));
        if (k > 0 && k < bins - 1) { re[c][size - k] = re[c][k]; im[c][size - k] = -im[c][k]; }
      }
      if (valid || capture) {
        fft.transform(re[c], im[c], true);
        for (int i = 0; i < size; ++i)
          ola[c][(position + 1 + i) % size] += re[c][i] * window[i] * (2.0f / 3);
      }
    }
    if (capture) { valid = true; pending = false; }
    return true;
  }
  double tick(double l, double r, double gate, double recapture, double decay, double diffusion, double spread, double mix, double rate) {
    const double values[] = {l, r, gate, recapture, decay, diffusion, spread, mix, rate};
    for (double v : values) if (!__builtin_isfinite(v)) { reset(); return 0; }
    if (!__builtin_isfinite((float)l) || !__builtin_isfinite((float)r) || rate < 100) { reset(); return 0; }
    if (lastRate != 0 && lastRate != rate) reset();
    lastRate = rate;
    const bool on = gate >= 0.5, hit = recapture >= 0.5;
    if (on && (!lastGate || (hit && !lastCapture))) pending = true;
    if (!on) pending = false;
    lastGate = on; lastCapture = hit;
    const double dry[2] = {input[0][position], input[1][position]};
    const double wet[2] = {ola[0][position], ola[1][position]};
    ola[0][position] = ola[1][position] = 0;
    input[0][position] = (float)l; input[1][position] = (float)r; ++samples;
    if (++hop == hopSize) {
      hop = 0;
      if (!frame(decay > 0 ? decay : 0, unit(diffusion), unit(spread), rate)) { reset(); return 0; }
    }
    position = (position + 1) % size;
    // Slew the live/held handoff over 20 ms, independently of the user's Mix.
    const double target = on && valid ? 1 : 0;
    const double step = 1.0 / (0.02 * rate);
    blend += target > blend ? step : target < blend ? -step : 0;
    if (blend < 0) blend = 0; if (blend > 1) blend = 1;
    const double g = blend * blend * (3 - 2 * blend) * unit(mix);
    right = dry[1] + g * (wet[1] - dry[1]);
    const double out = dry[0] + g * (wet[0] - dry[0]);
    held = on && valid ? 1 : 0;
    if (!__builtin_isfinite(out) || !__builtin_isfinite(right)) { reset(); return 0; }
    return out;
  }
};
State* pool[capacity]{};
State* get(int h) { return h > 0 && h <= capacity ? pool[h - 1] : nullptr; }
const char metadata[] = R"json({"module":"spectral_freeze","targetType":"spectralFreeze","label":"Spectral Freeze","kind":"effect","inputs":["In","Left","Right","Freeze","Recapture"],"outputs":["Mono","Left","Right","Held"],"parameters":[
{"key":"freeze","label":"Freeze","kind":"choice","choices":["Live","Frozen"],"choiceKeys":["live","frozen"],"choiceIds":[0,1],"defaultValue":"live","min":"0","mid":"0.5","max":"1","step":"1","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"Frozen captures a complete analysis window and sustains its spectrum with evolving phase. Live releases to delayed input. A wired Freeze gate overrides this switch; rising high captures, low releases. Held reports a completed active capture."},
{"key":"decaySeconds","label":"Decay","kind":"time","defaultValue":"0","min":"0","mid":"5","max":"60","unit":"s","step":"any","nonlinearSlider":true,"tooltip":"Held magnitude decay time constant in seconds. Zero means infinite sustain. Positive values decay after capture; Recapture restarts from the current input."},
{"key":"diffusion","label":"Diffusion","defaultValue":"0","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Phase excursion amount added to the evolving held spectrum. Zero retains captured phase advance; higher values create a more diffuse texture without magnitude crossfade cancellations."},
{"key":"stereoSpread","label":"Stereo Spread","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Opposite-channel phase diffusion for stereo width, including from mono input. Zero links diffusion motion; requires Diffusion above zero. Input channels remain separate."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","unit":"%","step":"any","tooltip":"Live/held blend, aligned to 4096 samples. Capture/release uses a separate 20 ms handoff. Recapture takes effect at the next analysis hop while Frozen. This is not a looper or a repeated frozen FFT frame."}]})json";
}
extern "C" int soemdsp_spectral_freeze_create() {
  for (int i = 0; i < capacity; ++i) if (!pool[i]) {
    auto* s = static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0;
    s->reset(); pool[i] = s; return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_freeze_destroy(int h) { if (auto* s = get(h)) { soemdsp::memory_pool::release(s); pool[h - 1] = nullptr; } }
extern "C" void soemdsp_spectral_freeze_reset(int h) { if (auto* s = get(h)) s->reset(); }
extern "C" double soemdsp_spectral_freeze_sample(int h, double l, double r, double gate, double recapture, double decay, double diffusion, double spread, double mix, double rate) {
  auto* s = get(h); return s ? s->tick(l, r, gate, recapture, decay, diffusion, spread, mix, rate) : 0;
}
extern "C" double soemdsp_spectral_freeze_right(int h) { auto* s = get(h); return s ? s->right : 0; }
extern "C" double soemdsp_spectral_freeze_held(int h) { auto* s = get(h); return s ? s->held : 0; }
extern "C" int soemdsp_spectral_freeze_latency() { return size; }
extern "C" int soemdsp_spectral_freeze_version() { return 1; }
extern "C" const char* soemdsp_spectral_freeze_metadata_json() { return metadata; }
extern "C" int soemdsp_spectral_freeze_metadata_json_size() { return sizeof(metadata) - 1; }
