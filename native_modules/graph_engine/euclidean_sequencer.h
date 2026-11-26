#pragma once

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/math/exp_log.h>
#include <soemdsp/math/midi_hz.h>

namespace sandbox_euclidean {

using soemdsp::math::dsp_floor;

struct RingParams {
  double steps;
  double hits;
  double rotate;
};

struct Params {
  RingParams rings[4];
  double rate;
  double drift; // steps per completed ring loop
  double resetSteps; // global advance events; zero disables automatic restart
  double semitones;
  double pitchRange;
  bool positionPitch;
};

struct RingState {
  double steps;
  double occupied;
  double effectiveRotation;
  double lastHitPhase;
  double hitAge;
  double step;
  double rotation;
  double loops;
  double phase;
  double trigger;
  double hits;
};

struct State {
  RingState rings[4];
  double clockPhase;
  double advances;
  double melodyPosition;
  double pitch;
  double frequency;
  bool started;
};

inline double finite(double value, double fallback = 0.0) {
  return soemdsp::debug::is_bad(value) ? fallback : value;
}

inline double wrap(double value, double length) {
  return value - dsp_floor(value / length) * length;
}

// A step count is a positive integer divisor, not a musical range clamp.
inline double step_count(double value) {
  return soemdsp::math::maxd(1.0, dsp_floor(finite(value, 1.0)));
}

inline bool hit_at(double step, double steps, double hits, double rotation) {
  // A binary n-step rhythm has 0..n occupied positions by definition.
  const double k = soemdsp::math::mind(steps, soemdsp::math::maxd(0.0, dsp_floor(finite(hits))));
  const double i = wrap(step - dsp_floor(rotation), steps);
  // Rotation convention: nonempty rhythms start with a hit at step zero.
  return dsp_floor(i * k / steps) != dsp_floor((i - 1.0) * k / steps);
}

inline void reset(State& state) {
  state = State{};
}

inline void sample(State& state, const Params& p, double sampleRate,
    bool restart, bool externalClock, bool advance) {
  if (restart) reset(state);
  for (auto& ring : state.rings) ring.trigger = 0.0;
  const double rate = finite(p.rate);
  const double sr = sampleRate > 0.0 ? sampleRate : 44100.0; // avoid division by zero
  bool tick = false;
  if (!state.started && (externalClock ? advance : rate > 0.0)) {
    state.started = true;
    tick = true;
  } else if (externalClock) {
    tick = advance;
  } else if (!restart && rate > 0.0) {
    state.clockPhase += rate / sr;
    if (state.clockPhase >= 1.0) {
      state.clockPhase -= dsp_floor(state.clockPhase);
      tick = true; // At most one observable trigger per engine sample; bounded work.
    }
  }
  const double resetAfter = dsp_floor(finite(p.resetSteps));
  const bool first = tick && state.advances == 0.0;
  const bool automaticReset = tick && resetAfter > 0.0 && state.advances >= resetAfter;
  if (automaticReset) {
    state.advances = 0.0;
    for (auto& ring : state.rings) ring = RingState{};
  }
  for (int lane = 0; lane < 4; ++lane) {
    auto& ring = state.rings[lane];
    const auto& param = p.rings[lane];
    const double n = step_count(param.steps);
    ring.steps = n;
    ring.occupied = soemdsp::math::mind(n, soemdsp::math::maxd(0.0, dsp_floor(finite(param.hits))));
    ring.step = wrap(ring.step, n);
    ring.hitAge += 1.0 / sr;
    if (tick) {
      if (!first && !automaticReset) {
        ring.step += 1.0;
        if (ring.step >= n) {
          ring.step = 0.0;
          ring.loops += 1.0;
          ring.rotation = wrap(ring.rotation + finite(p.drift), n);
        }
      }
      const double rotation = finite(param.rotate) + ring.rotation;
      if (hit_at(ring.step, n, param.hits, rotation)) {
        ring.trigger = 1.0;
        ring.hits += 1.0;
        ring.lastHitPhase = ring.step / n;
        ring.hitAge = 0.0;
        if (lane == 3) state.melodyPosition = wrap(ring.step - dsp_floor(rotation), n) / n;
      }
    }
    ring.effectiveRotation = finite(param.rotate) + ring.rotation;
    ring.phase = (ring.step + (externalClock ? 0.0 : state.clockPhase)) / n;
  }
  if (tick) state.advances += 1.0;
  double mapped = state.melodyPosition;
  if (!p.positionPitch) {
    static const int scale[5] = {0, 2, 4, 7, 9};
    const int degree = (int)dsp_floor(mapped * 10.0);
    mapped = (scale[degree % 5] + 12 * (degree / 5)) / 21.0;
  }
  state.pitch = 57.0 + finite(p.semitones) + mapped * finite(p.pitchRange);
  state.frequency = soemdsp::math::midi_to_hz(state.pitch);
}

} // namespace sandbox_euclidean
