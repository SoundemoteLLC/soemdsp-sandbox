// soemdsp-native-module: convolution_resonator
// soemdsp-native-label: Convolution Resonator
// soemdsp-native-target: convolutionResonator
// soemdsp-native-kind: effect
// Stage 1: latency reference. No body or vocoder is implemented yet.
#include <soemdsp/utility/memory_pool.h>

namespace {
constexpr int kInstances = 64;
constexpr int kLatency = 2048;
struct State {
  double* delay;
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
  for (int i = 0; i < 2 * kLatency; ++i) s.delay[i] = 0.0;
  s.position = 0;
  s.right = 0.0;
}
}

extern "C" int soemdsp_convolution_resonator_create() {
  for (int i = 0; i < kInstances; ++i) {
    if (states[i].delay) continue;
    auto* delay = static_cast<double*>(soemdsp::memory_pool::alloc(2 * kLatency * sizeof(double)));
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
  *s = {};
}
extern "C" void soemdsp_convolution_resonator_reset(int handle) {
  if (auto* s = state(handle)) clear(*s);
}
extern "C" double soemdsp_convolution_resonator_sample(int handle, double left, double right) {
  auto* s = state(handle);
  if (!s) return 0.0;
  if (!finite(left) || !finite(right)) {
    clear(*s);
    return 0.0;
  }
  const int p = s->position;
  const double out = s->delay[p];
  s->right = s->delay[kLatency + p];
  s->delay[p] = left;
  s->delay[kLatency + p] = right;
  s->position = (p + 1) % kLatency;
  return out;
}
extern "C" double soemdsp_convolution_resonator_right(int handle) {
  auto* s = state(handle);
  return s ? s->right : 0.0;
}
extern "C" int soemdsp_convolution_resonator_latency() { return kLatency; }
extern "C" int soemdsp_convolution_resonator_version() { return 1; }
