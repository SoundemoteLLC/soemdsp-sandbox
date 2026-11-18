// soemdsp-native-module: convolution_resonator
// soemdsp-native-label: Convolution Resonator
// soemdsp-native-target: convolutionResonator
// soemdsp-native-kind: effect
// Buzz / String / Tube, 2x STFT vocoder, and an overlapping-filter listening test.
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/oscillator/blit_saw.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/filter/comb_core.h>
#include "vocoder_oversampling.h"
#include "../vocoder/filter_bank_vocoder.h"

namespace {
constexpr int kInstances = 64;
constexpr int kLatency = convolution_resonator::kMaxFrame + 8 + convolution_resonator::OversampledVocoder::filterLatency;
constexpr int kHalfKernel = 8;
struct Tap { int delay; double coefficients[16]; double weight; };
struct TubeMode {
  double rotationRe, rotationIm, cotangent, excitation, outputFade;
  double re[3], im[3];
};
struct State {
  double* delay;
  double* history;
  double* sums;
  Tap* taps;
  Tap* previousTaps;
  void* bodyBlock;
  int capacity, tapCapacity, write, tapCount;
  double integral[2], dcX[2], dcY[2];
  double frequency, periods, period, norm;
  double previousPeriod, previousNorm;
  int previousCount;
  double fade, fadeStep;
  void* stringBlock;
  soemdsp::comb::CombCore string[3];
  TubeMode* tube;
  int tubeCapacity, tubeCount;
  double tubeFrequency, tubeDecay, tubeRate;
  double tubeInput[3][2];
  convolution_resonator::OversampledVocoder* vocoder;
  convolution_resonator::OversampledVocoder* rawVocoder;
  soemdsp_vocoder::FilterBankVocoder* filterBank;
  int desiredModel, currentModel, targetModel, modelWarm, rawPosition;
  double modelFade, bankWidth, bankResponse, rawDelay[2][8];
  double crunch, response, bandwidth;
  soemdsp_blit::BlitSaw oscillator;
  double carrier;
  int position;
  double right;
};
State states[kInstances]{};
State* state(int handle) {
  return handle > 0 && handle <= kInstances && states[handle - 1].delay
    ? &states[handle - 1] : nullptr;
}
bool finite(double x) { return __builtin_isfinite(x); }
void clear(State& s) {
  for (int i = 0; i < 6 * kLatency; ++i) s.delay[i] = 0.0;
  if (s.vocoder) s.vocoder->reset();
  if (s.rawVocoder) s.rawVocoder->reset();
  if (s.filterBank) s.filterBank->reset();
  for (auto& channel : s.rawDelay) for (auto& value : channel) value = 0;
  s.rawPosition = s.modelWarm = 0; s.modelFade = 1;
  s.currentModel = s.targetModel = s.desiredModel;
  if (s.history) for (int i = 0; i < 2 * s.capacity; ++i) s.history[i] = s.sums[i] = 0;
  s.write = 0;
  for (int c = 0; c < 2; ++c) s.integral[c] = s.dcX[c] = s.dcY[c] = 0;
  s.oscillator.init(0);
  s.carrier = 0;
  s.position = 0;
  s.right = 0.0;
  s.fade = 1;
  s.previousCount = 0;
  s.tapCount = 0;
  s.frequency = s.periods = s.period = s.norm = 0;
  for (auto& loop : s.string) if (loop.buffer) {
    // Growth preserves history at the end of the new ring, not just [0, filled).
    for (int i = 0; i < loop.capacity; ++i) loop.buffer[i] = 0;
    soemdsp::comb::comb_reset_state(&loop);
  }
  for (int i = 0; i < s.tubeCount; ++i)
    for (int c = 0; c < 3; ++c) s.tube[i].re[c] = s.tube[i].im[c] = 0;
  for (auto& input : s.tubeInput) input[0] = input[1] = 0;
  s.tubeCount = 0;
  s.tubeFrequency = s.tubeDecay = s.tubeRate = 0;
}

bool configure_tube(State& s, double frequency, double decay, double sr) {
  if (s.tubeFrequency == frequency && s.tubeDecay == decay && s.tubeRate == sr) return true;
  const double required = __builtin_ceil((sr * 0.5 / frequency - 1) * 0.5);
  if (!finite(required) || required > __INT_MAX__ / (int)sizeof(TubeMode)) return false;
  const int count = (int)required;
  if (count > s.tubeCapacity) {
    auto* modes = static_cast<TubeMode*>(soemdsp::memory_pool::alloc((unsigned long long)count * sizeof(TubeMode)));
    if (!modes) return false;
    for (int i = 0; i < s.tubeCount; ++i) modes[i] = s.tube[i];
    soemdsp::memory_pool::release(s.tube);
    s.tube = modes;
    s.tubeCapacity = count;
  }
  for (int i = s.tubeCount; i < count; ++i)
    for (int c = 0; c < 3; ++c) s.tube[i].re[c] = s.tube[i].im[c] = 0;
  const double density = __builtin_sqrt(4 * frequency / sr);
  for (int i = 0; i < count; ++i) {
    auto& mode = s.tube[i];
    const double harmonic = 2 * i + 1;
    const double hz = harmonic * frequency;
    const double omega = soemdsp_maths::kTwoPi * hz / sr;
    const double sine = soemdsp_maths::dsp_sin(omega);
    const double cosine = soemdsp_maths::dsp_cos(omega);
    const double length = __builtin_sqrt(sine * sine + cosine * cosine);
    // Wall-loss rate grows as sqrt(f/fundamental); Decay specifies mode 1.
    const double radius = decay > 0
      ? soemdsp::comb::comb_feedback_gain(decay / __builtin_sqrt(harmonic), 1, sr, 0) : 0;
    double fade = (1 - hz / (sr * 0.5)) / 0.2;
    if (fade > 1) fade = 1;
    fade = fade * fade * (3 - 2 * fade);
    mode.rotationRe = radius * cosine / length;
    mode.rotationIm = radius * sine / length;
    mode.cotangent = cosine / sine;
    // Unit-energy two-pole bandpass, scaled by physical mode density.
    mode.excitation = __builtin_sqrt((1 - radius * radius) * 0.5) * density;
    mode.outputFade = fade;
  }
  s.tubeCount = count;
  s.tubeFrequency = frequency; s.tubeDecay = decay; s.tubeRate = sr;
  return true;
}

double tube_tick(State& s, int c, double input, double coupling) {
  const double excitation = input - s.tubeInput[c][1];
  s.tubeInput[c][1] = s.tubeInput[c][0];
  s.tubeInput[c][0] = input;
  double resonant = 0;
  for (int i = 0; i < s.tubeCount; ++i) {
    auto& mode = s.tube[i];
    // Complex pole state avoids energy pumping from a time-varying biquad.
    const double re = mode.rotationRe * mode.re[c] - mode.rotationIm * mode.im[c]
      + mode.excitation * excitation;
    const double im = mode.rotationIm * mode.re[c] + mode.rotationRe * mode.im[c];
    mode.re[c] = re; mode.im[c] = im;
    resonant += mode.outputFade * (re + mode.cotangent * im);
  }
  // Morph the section's direct feedthrough and modal residues, while the
  // preceding string feedback recedes. Not two complete body renderers.
  return (1 - coupling) * input + coupling * resonant;
}

bool reserve_string(State& s, int needed) {
  if (s.string[0].capacity >= needed) return true;
  int capacity = s.string[0].capacity ? s.string[0].capacity : 1024;
  while (capacity < needed) capacity *= 2;
  auto* buffer = static_cast<float*>(soemdsp::memory_pool::alloc(3ULL * capacity * sizeof(float)));
  if (!buffer) return false;
  for (int c = 0; c < 3; ++c) {
    auto& loop = s.string[c];
    float* target = buffer + c * capacity;
    for (int age = 1; age <= loop.capacity; ++age)
      target[capacity - age] = loop.buffer[(loop.writeIndex - age + loop.capacity) % loop.capacity];
    loop.buffer = target;
    loop.capacity = capacity;
    loop.writeIndex = 0;
    loop.dcResum = 0;
  }
  soemdsp::memory_pool::release(s.stringBlock);
  s.stringBlock = buffer;
  return true;
}

// Match the fundamental phase of the one-pole damping and Thiran delay.
// The arctangent argument is bounded by the damping pole (< 0.2 here).
double string_read_delay(double period, double damping) {
  using namespace soemdsp_maths;
  const double omega = kTwoPi / period;
  const double pole = damping * damping;
  const double ratio = pole * dsp_sin(omega) / (1 - pole * dsp_cos(omega));
  const double r2 = ratio * ratio;
  const double phase = ratio * (1 + r2 * (-1.0/3 + r2 * (1.0/5 + r2 * (-1.0/7 + r2 * (1.0/9 - r2/11)))));
  const double delay = period - phase / omega;
  const double integer = __builtin_floor(delay);
  const double fraction = delay - integer;
  const double half = omega * 0.5;
  const double corrected = dsp_sin(half * fraction) * dsp_cos(half)
    / (dsp_cos(half * fraction) * dsp_sin(half));
  return integer + corrected;
}
double string_tick(soemdsp::comb::CombCore& s, double input, double period,
  double readDelay, double gain, double damping, double dcCoupling) {
  using namespace soemdsp::comb;
  const double delayed = comb_read_frac(&s, readDelay);
  const double feedback = comb_loop_filter(&s, delayed, damping);
  double out = input * __builtin_sqrt(1 - gain * gain) + gain * feedback;
  if (gain > 0) out -= dcCoupling * comb_dc_mean(&s, period);
  if (comb_nonfinite_reset(&s, out, out)) return 0;
  comb_write_dc(&s, (float)out);
  return out;
}

// Grow only when the requested physical history no longer fits; no pitch floor.
bool reserve(State& s, int frames, int taps) {
  if (frames <= s.capacity && taps <= s.tapCapacity) return true;
  int capacity = s.capacity ? s.capacity : 1024;
  while (capacity < frames) capacity *= 2;
  const int tapCapacity = taps > s.tapCapacity ? taps : s.tapCapacity;
  const auto bytes = 4ULL * capacity * sizeof(double) + 2ULL * tapCapacity * sizeof(Tap);
  void* block = soemdsp::memory_pool::alloc(bytes);
  if (!block) return false;
  auto* history = static_cast<double*>(block);
  double* sums = history + 2 * capacity;
  for (int c = 0; c < 2; ++c) {
    for (int age = 1; age <= capacity; ++age) {
      const int dst = c * capacity + capacity - age;
      if (age <= s.capacity) {
        const int src = c * s.capacity + (s.write - age + s.capacity) % s.capacity;
        history[dst] = s.history[src];
        sums[dst] = s.sums[src];
      } else sums[dst] = s.capacity ? s.sums[c * s.capacity + s.write] : 0;
    }
  }
  auto* newTaps = reinterpret_cast<Tap*>(sums + 2 * capacity);
  auto* previousTaps = newTaps + tapCapacity;
  for (int i = 0; i < s.tapCount; ++i) newTaps[i] = s.taps[i];
  for (int i = 0; i < s.previousCount; ++i) previousTaps[i] = s.previousTaps[i];
  soemdsp::memory_pool::release(s.bodyBlock);
  s.bodyBlock = block;
  s.history = history;
  s.sums = sums;
  s.taps = newTaps;
  s.previousTaps = previousTaps;
  s.capacity = capacity;
  s.tapCapacity = tapCapacity;
  s.write = 0;
  return true;
}
double sinc(double x) {
  if (__builtin_fabs(x) < 1.e-12) return 1;
  return soemdsp_blit::sinApprox(soemdsp_maths::kPi * x) / (soemdsp_maths::kPi * x);
}
bool configure(State& s, double frequency, double periods, double sr, double fadeMs) {
  const double period = sr / frequency;
  const double frames = (periods + 1) * period + 32;
  if (!finite(frames) || frames > __INT_MAX__ / 4 || periods > __INT_MAX__ / (int)sizeof(Tap)) return false;
  const int count = (int)__builtin_ceil(periods);
  if (!reserve(s, (int)__builtin_ceil(frames), count)) return false;
  if (s.frequency == frequency && s.periods == periods && s.period == period) return true;
  if (s.tapCount && s.fade >= 1 && fadeMs > 0) {
    for (int i = 0; i < s.tapCount; ++i) s.previousTaps[i] = s.taps[i];
    s.previousCount = s.tapCount;
    s.previousPeriod = s.period;
    s.previousNorm = s.norm;
    s.fade = 0;
    s.fadeStep = 1000 / (fadeMs * sr);
  }
  s.frequency = frequency;
  s.periods = periods;
  s.period = period;
  s.tapCount = count;
  double energy = 0;
  for (int k = 0; k < count; ++k) {
    Tap& t = s.taps[k];
    t.weight = periods - k < 1 ? periods - k : 1;
    energy += t.weight * t.weight;
    const double d = kHalfKernel + k * period;
    t.delay = (int)__builtin_floor(d);
    const double fraction = d - t.delay;
    double sum = 0;
    for (int j = 0; j < 16; ++j) {
      const double offset = j - 7 - fraction;
      t.coefficients[j] = sinc(offset) * sinc(offset / kHalfKernel);
      sum += t.coefficients[j];
    }
    for (double& coefficient : t.coefficients) coefficient /= sum;
  }
  s.norm = __builtin_sqrt(energy * (1 - 1 / period));
  return true;
}
double history(const State& s, const double* buffer, int c, int age) {
  return buffer[c * s.capacity + (s.write - age + s.capacity) % s.capacity];
}
double integral_at(const State& s, int c, double age) {
  const int n = (int)__builtin_floor(age);
  const double fraction = age - n;
  const double value = history(s, s.sums, c, n);
  return value + fraction * (history(s, s.sums, c, n + 1) - value);
}
double buzz(const State& s, int c, const Tap* taps, int count, double period, double norm) {
  double out = 0;
  for (int k = 0; k < count; ++k) {
    const Tap& t = taps[k];
    double pulse = 0;
    for (int j = 0; j < 16; ++j)
      pulse += t.coefficients[j] * history(s, s.history, c, t.delay + j - 7);
    const double start = kHalfKernel + k * period;
    const double mean = (integral_at(s, c, start) - integral_at(s, c, start + period)) / period;
    out += t.weight * (pulse - mean);
  }
  return out / norm;
}
void reset_model(State& s, int model) {
  if (model == 0 && s.vocoder) s.vocoder->reset();
  if (model == 1) {
    if (s.rawVocoder) s.rawVocoder->reset();
    for (auto& channel : s.rawDelay) for (auto& value : channel) value = 0;
    s.rawPosition = 0;
  }
  if (model == 2) {
    if (s.filterBank) s.filterBank->reset();
    for (int i = 4 * kLatency; i < 6 * kLatency; ++i) s.delay[i] = 0;
  }
}
bool process_model(State& s, int model, const double wet[2], double left, double right,
  double rawCarrier, double sr, double shift, double out[2]) {
  if (model == 2) {
    if (!s.filterBank) {
      s.filterBank = static_cast<soemdsp_vocoder::FilterBankVocoder*>(soemdsp::memory_pool::alloc(sizeof(soemdsp_vocoder::FilterBankVocoder)));
      if (!s.filterBank) return false;
      s.filterBank->reset();
    }
    const double value = s.filterBank->tick(left, right, rawCarrier, sr, s.bankWidth, s.bankResponse, shift);
    const double other = s.filterBank->right;
    if (!finite(value) || !finite(other)) return false;
    const int read = (s.position + convolution_resonator::Resampler2x::filterLatency) % kLatency;
    out[0] = s.delay[4 * kLatency + read]; out[1] = s.delay[5 * kLatency + read];
    s.delay[4 * kLatency + s.position] = value; s.delay[5 * kLatency + s.position] = other;
    return true;
  }
  auto*& processor = model == 0 ? s.vocoder : s.rawVocoder;
  if (!processor) {
    processor = static_cast<convolution_resonator::OversampledVocoder*>(soemdsp::memory_pool::alloc(sizeof(convolution_resonator::OversampledVocoder)));
    if (!processor) return false;
    processor->reset();
  }
  out[0] = processor->tick(model == 0 ? wet[0] : left, model == 0 ? wet[1] : right,
    model == 0 ? s.carrier : rawCarrier, shift, s.crunch, s.response, s.bandwidth);
  out[1] = processor->right;
  if (!finite(out[0]) || !finite(out[1])) return false;
  if (model == 1) {
    // Raw STFT bypasses the body's 8-sample interpolator, but not its timing.
    for (int c = 0; c < 2; ++c) {
      const double delayed = s.rawDelay[c][s.rawPosition];
      s.rawDelay[c][s.rawPosition] = out[c]; out[c] = delayed;
    }
    s.rawPosition = (s.rawPosition + 1) % 8;
  }
  return true;
}
}

extern "C" int soemdsp_convolution_resonator_create() {
  for (int i = 0; i < kInstances; ++i) {
    if (states[i].delay) continue;
    auto* delay = static_cast<double*>(soemdsp::memory_pool::alloc(6 * kLatency * sizeof(double)));
    if (!delay) return 0;
    states[i].delay = delay;
    states[i].crunch = 1.0 / 3; states[i].response = 0; states[i].bandwidth = -1.0 / 3;
    states[i].bankWidth = 0.75; states[i].bankResponse = 0.00025;
    clear(states[i]);
    return i + 1;
  }
  return 0;
}
extern "C" void soemdsp_convolution_resonator_destroy(int handle) {
  auto* s = state(handle);
  if (!s) return;
  soemdsp::memory_pool::release(s->delay);
  soemdsp::memory_pool::release(s->bodyBlock);
  soemdsp::memory_pool::release(s->stringBlock);
  soemdsp::memory_pool::release(s->tube);
  soemdsp::memory_pool::release(s->vocoder);
  soemdsp::memory_pool::release(s->rawVocoder);
  soemdsp::memory_pool::release(s->filterBank);
  *s = {};
}
extern "C" void soemdsp_convolution_resonator_reset(int handle) {
  if (auto* s = state(handle)) clear(*s);
}
extern "C" double soemdsp_convolution_resonator_sample(int handle, double left, double right,
  double frequency, double periods, double mix, double sampleRate, double fadeMs,
  double body, double decay, double vocoderMix, double formantShift) {
  auto* s = state(handle);
  if (!s) return 0.0;
  if (!finite(left) || !finite(right) || !finite(frequency) || !finite(periods) || !finite(mix)
      || !finite(body) || !finite(decay) || !finite(vocoderMix) || !finite(formantShift)) {
    clear(*s);
    return 0.0;
  }
  const double sr = finite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const bool carrierActive = frequency > 0 && frequency < sr * 0.5;
  const bool active = carrierActive && periods > 0;
  const double morph = body <= 0.5 ? 2 * body : 1;
  const double tube = body > 0.5 ? 2 * body - 1 : 0;
  if (tube <= 0 && s->tubeCount) {
    for (int i = 0; i < s->tubeCount; ++i)
      for (int c = 0; c < 3; ++c) s->tube[i].re[c] = s->tube[i].im[c] = 0;
    for (auto& input : s->tubeInput) input[0] = input[1] = 0;
    s->tubeCount = 0;
    s->tubeFrequency = 0;
  }
  const double morph2 = morph * morph;
  const double stringPeriod = active ? sr / frequency : 0;
  const double gain = active && morph2 > 0 && decay > 0
    ? soemdsp::comb::comb_feedback_gain(decay * morph2, stringPeriod, sr, 0) * (1 - tube) : 0;
  const double damping = 0.4 * morph2 / (1 + morph2);
  const double readDelay = active && (morph2 > 0 || s->stringBlock)
    ? string_read_delay(stringPeriod, damping) : 0;
  const double carrier = carrierActive ? s->oscillator.update(sr / frequency) : 0;
  double wet[2]{};
  if (active) {
    const double fadeTime = finite(fadeMs) && fadeMs > 0 ? fadeMs : 0;
    if (fadeTime == 0) s->fade = 1;
    else if (s->fade < 1) s->fadeStep = 1000 / (fadeTime * sr);
    const double trainPeriods = 1 + (periods - 1) * (1 - morph) * (1 - morph);
    if (!configure(*s, frequency, trainPeriods, sr, fadeTime)) { s->right = 0; return 0; }
    if (morph2 > 0 && !reserve_string(*s, (int)__builtin_ceil(stringPeriod) + 8)) { s->right = 0; return 0; }
    if (tube > 0 && !configure_tube(*s, frequency, decay, sr)) { s->right = 0; return 0; }
    const double pole = soemdsp_maths::dsp_exp(-soemdsp_maths::kTwoPi * 5 / sr);
    const double input[2] = {left, right};
    for (int c = 0; c < 2; ++c) {
      const double filtered = pole * (s->dcY[c] + input[c] - s->dcX[c]);
      s->dcX[c] = input[c]; s->dcY[c] = filtered;
      s->history[c * s->capacity + s->write] = filtered;
      s->integral[c] += filtered;
      s->sums[c * s->capacity + s->write] = s->integral[c];
      wet[c] = buzz(*s, c, s->taps, s->tapCount, s->period, s->norm);
      if (s->fade < 1) {
        const double old = buzz(*s, c, s->previousTaps, s->previousCount, s->previousPeriod, s->previousNorm);
        const double blend = s->fade * s->fade * (3 - 2 * s->fade);
        wet[c] = old + blend * (wet[c] - old);
      }
      if (s->stringBlock)
        wet[c] = string_tick(s->string[c], wet[c], stringPeriod, readDelay, gain, damping, 1 - tube);
      if (tube > 0) wet[c] = tube_tick(*s, c, wet[c], tube);
      if (!finite(wet[c]) || !finite(s->integral[c])) { clear(*s); return 0; }
    }
    s->write = (s->write + 1) % s->capacity;
    if (s->fade < 1) {
      s->fade += s->fadeStep;
      if (s->fade > 1) s->fade = 1;
    }
  }
  s->carrier = active && s->stringBlock
    ? string_tick(s->string[2], carrier, stringPeriod, readDelay, gain, damping, 1 - tube) : carrier;
  if (active && tube > 0) s->carrier = tube_tick(*s, 2, s->carrier, tube);
  if (!finite(s->carrier)) { clear(*s); return 0; }
  double vocoded[2]{};
  if (s->currentModel != s->targetModel && s->desiredModel == s->currentModel) {
    if (s->modelWarm == 0) {
      const int previous = s->currentModel; s->currentModel = s->targetModel; s->targetModel = previous;
      s->modelFade = 1 - s->modelFade;
    } else s->targetModel = s->currentModel;
  }
  if (s->currentModel == s->targetModel && s->desiredModel != s->currentModel) {
    s->targetModel = s->desiredModel; s->modelWarm = kLatency; s->modelFade = 0;
    reset_model(*s, s->targetModel);
  }
  const bool changing = s->currentModel != s->targetModel;
  if (vocoderMix != 0 || s->vocoder || s->currentModel != 0 || changing) {
    if (!process_model(*s, s->currentModel, wet, left, right, carrier, sr, formantShift, vocoded)) { clear(*s); return 0; }
    if (changing) {
      double target[2]{};
      if (!process_model(*s, s->targetModel, wet, left, right, carrier, sr, formantShift, target)) { clear(*s); return 0; }
      if (s->modelWarm > 0) --s->modelWarm;
      else {
        s->modelFade += 1 / (0.02 * sr);
        if (s->modelFade > 1) s->modelFade = 1;
        const double blend = s->modelFade * s->modelFade * (3 - 2 * s->modelFade);
        for (int c = 0; c < 2; ++c) vocoded[c] += blend * (target[c] - vocoded[c]);
        if (s->modelFade == 1) s->currentModel = s->targetModel;
      }
    }
  }
  const int p = s->position;
  const int wp = (p + kHalfKernel) % kLatency;
  const double out = (1 - mix) * s->delay[p] + mix * (
    (1 - vocoderMix) * s->delay[2 * kLatency + wp] + vocoderMix * vocoded[0]);
  s->right = (1 - mix) * s->delay[kLatency + p] + mix * (
    (1 - vocoderMix) * s->delay[3 * kLatency + wp] + vocoderMix * vocoded[1]);
  s->delay[p] = left;
  s->delay[kLatency + p] = right;
  s->delay[2 * kLatency + p] = wet[0];
  s->delay[3 * kLatency + p] = wet[1];
  s->position = (p + 1) % kLatency;
  return out;
}
extern "C" double soemdsp_convolution_resonator_right(int handle) {
  auto* s = state(handle);
  return s ? s->right : 0.0;
}
extern "C" int soemdsp_convolution_resonator_latency() { return kLatency; }
extern "C" double soemdsp_convolution_resonator_carrier(int handle) {
  auto* s = state(handle);
  return s ? s->carrier : 0;
}
extern "C" int soemdsp_convolution_resonator_version() { return 9; }
// Native API uses seconds; the graph binding converts UI bankFollowerMs here.
extern "C" void soemdsp_convolution_resonator_set_filter_bank(int handle, int model, double width, double response) {
  if (auto* s = state(handle)) {
    if (model < 0 || model > 2 || !finite(width) || !finite(response)) { clear(*s); return; }
    s->desiredModel = model; s->bankWidth = width; s->bankResponse = response;
  }
}
extern "C" void soemdsp_convolution_resonator_set_crunch(int handle, double crunch, double response, double bandwidth) {
  if (auto* s = state(handle)) {
    if (!finite(crunch) || !finite(response) || !finite(bandwidth)) { clear(*s); return; }
    s->crunch = crunch; s->response = response; s->bandwidth = bandwidth;
  }
}
#include "resonator_probe.h"
