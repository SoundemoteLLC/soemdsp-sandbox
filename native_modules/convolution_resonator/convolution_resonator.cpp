// soemdsp-native-module: convolution_resonator
// soemdsp-native-label: Convolution Resonator
// soemdsp-native-target: convolutionResonator
// soemdsp-native-kind: effect
// Stage 2: finite Buzz body and BLIT carrier. No STFT/vocoder yet.
#include <soemdsp/utility/memory_pool.h>
#include <soemdsp/oscillator/blit_saw.h>
#include <soemdsp/math/exp_log.h>

namespace {
constexpr int kInstances = 64;
constexpr int kLatency = 2048;
constexpr int kHalfKernel = 8;
struct Tap { int delay; double coefficients[16]; double weight; };
struct State {
  double* delay;
  double* history;
  double* sums;
  Tap* taps;
  void* bodyBlock;
  int capacity, tapCapacity, write, tapCount;
  double integral[2], dcX[2], dcY[2];
  double frequency, periods, period, norm;
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
  for (int i = 0; i < 4 * kLatency; ++i) s.delay[i] = 0.0;
  if (s.history) for (int i = 0; i < 2 * s.capacity; ++i) s.history[i] = s.sums[i] = 0;
  s.write = 0;
  for (int c = 0; c < 2; ++c) s.integral[c] = s.dcX[c] = s.dcY[c] = 0;
  s.oscillator.init(0);
  s.carrier = 0;
  s.position = 0;
  s.right = 0.0;
}

// Grow only when the requested physical history no longer fits; no pitch floor.
bool reserve(State& s, int frames, int taps) {
  if (frames <= s.capacity && taps <= s.tapCapacity) return true;
  int capacity = s.capacity ? s.capacity : 1024;
  while (capacity < frames) capacity *= 2;
  const int tapCapacity = taps > s.tapCapacity ? taps : s.tapCapacity;
  const auto bytes = 4ULL * capacity * sizeof(double) + (unsigned long long)tapCapacity * sizeof(Tap);
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
  soemdsp::memory_pool::release(s.bodyBlock);
  s.bodyBlock = block;
  s.history = history;
  s.sums = sums;
  s.taps = reinterpret_cast<Tap*>(sums + 2 * capacity);
  s.capacity = capacity;
  s.tapCapacity = tapCapacity;
  s.write = 0;
  s.frequency = -1;
  return true;
}
double sinc(double x) {
  if (__builtin_fabs(x) < 1.e-12) return 1;
  return soemdsp_blit::sinApprox(soemdsp_maths::kPi * x) / (soemdsp_maths::kPi * x);
}
bool configure(State& s, double frequency, double periods, double sr) {
  const double period = sr / frequency;
  const double frames = (periods + 1) * period + 32;
  if (!finite(frames) || frames > __INT_MAX__ / 4 || periods > __INT_MAX__ / (int)sizeof(Tap)) return false;
  const int count = (int)__builtin_ceil(periods);
  if (!reserve(s, (int)__builtin_ceil(frames), count)) return false;
  if (s.frequency == frequency && s.periods == periods && s.period == period) return true;
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
double buzz(State& s, int c) {
  double out = 0;
  for (int k = 0; k < s.tapCount; ++k) {
    const Tap& t = s.taps[k];
    double pulse = 0;
    for (int j = 0; j < 16; ++j)
      pulse += t.coefficients[j] * history(s, s.history, c, t.delay + j - 7);
    const double start = kHalfKernel + k * s.period;
    const double mean = (integral_at(s, c, start) - integral_at(s, c, start + s.period)) / s.period;
    out += t.weight * (pulse - mean);
  }
  return out / s.norm;
}
}

extern "C" int soemdsp_convolution_resonator_create() {
  for (int i = 0; i < kInstances; ++i) {
    if (states[i].delay) continue;
    auto* delay = static_cast<double*>(soemdsp::memory_pool::alloc(4 * kLatency * sizeof(double)));
    if (!delay) return 0;
    states[i].delay = delay;
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
  *s = {};
}
extern "C" void soemdsp_convolution_resonator_reset(int handle) {
  if (auto* s = state(handle)) clear(*s);
}
extern "C" double soemdsp_convolution_resonator_sample(int handle, double left, double right,
  double frequency, double periods, double mix, double sampleRate) {
  auto* s = state(handle);
  if (!s) return 0.0;
  if (!finite(left) || !finite(right) || !finite(frequency) || !finite(periods) || !finite(mix)) {
    clear(*s);
    return 0.0;
  }
  const double sr = finite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const bool active = frequency > 0 && frequency < sr * 0.5 && periods > 0;
  double wet[2]{};
  if (active) {
    if (!configure(*s, frequency, periods, sr)) { s->right = 0; return 0; }
    const double pole = soemdsp_maths::dsp_exp(-soemdsp_maths::kTwoPi * 5 / sr);
    const double input[2] = {left, right};
    for (int c = 0; c < 2; ++c) {
      const double filtered = pole * (s->dcY[c] + input[c] - s->dcX[c]);
      s->dcX[c] = input[c]; s->dcY[c] = filtered;
      s->history[c * s->capacity + s->write] = filtered;
      s->integral[c] += filtered;
      s->sums[c * s->capacity + s->write] = s->integral[c];
      wet[c] = buzz(*s, c);
      if (!finite(wet[c]) || !finite(s->integral[c])) { clear(*s); return 0; }
    }
    s->write = (s->write + 1) % s->capacity;
  }
  s->carrier = active ? s->oscillator.update(sr / frequency) : 0;
  const int p = s->position;
  const int wp = (p + kHalfKernel) % kLatency;
  const double out = (1 - mix) * s->delay[p] + mix * s->delay[2 * kLatency + wp];
  s->right = (1 - mix) * s->delay[kLatency + p] + mix * s->delay[3 * kLatency + wp];
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
extern "C" int soemdsp_convolution_resonator_version() { return 2; }
