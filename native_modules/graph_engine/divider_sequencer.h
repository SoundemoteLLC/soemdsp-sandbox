#pragma once

#include <soemdsp/math/scalar_helpers.h>
#include <soemdsp/trigger/trigger.h>

namespace sandbox_divider {

struct Params {
  double rate;
  double resetAfter;
  double divide[4];
  double offset[4];
  int logic; // Stable IDs: OR=0, XOR=1, AND=2.
};

struct State {
  double tick;
  double phase;
  double gates[4];
  double previous[4];
  double pulses[4];
  double combined;
  double previousCombined;
  double pulse;
  bool started;
};

inline double finite(double x, double fallback = 0.0) {
  return soemdsp::debug::is_bad(x) ? fallback : x;
}

inline double wrap(double x, double length) {
  return x - soemdsp::math::dsp_floor(x / length) * length;
}

inline void reset(State& s) { s = State{}; }

inline void sample(State& s, const Params& p, double sampleRate,
    bool restart, bool external, bool clockHit, bool clockHigh) {
  if (restart) reset(s);
  const double rate = finite(p.rate);
  const double sr = sampleRate > 0.0 ? sampleRate : 44100.0;
  bool advanced = false;
  if (!s.started) {
    if (external ? clockHit : rate > 0.0) s.started = true;
  } else if (external) {
    if (clockHit) { s.tick += 1.0; advanced = true; }
  } else if (rate > 0.0) {
    s.phase += rate / sr;
    if (s.phase >= 1.0) {
      // Bounded work, even above sample rate; no hidden musical ceiling.
      const double advances = soemdsp::math::dsp_floor(s.phase);
      s.tick += advances;
      s.phase -= advances;
      advanced = true;
    }
  }
  const double resetAfter = soemdsp::math::dsp_floor(finite(p.resetAfter));
  if (advanced && resetAfter > 0.0 && s.tick >= resetAfter) {
    const double remainder = wrap(s.tick, resetAfter), phase = s.phase;
    reset(s);
    s.started = true;
    s.tick = remainder;
    s.phase = phase; // Preserve the master clock's fractional timing.
  }
  // External gates supply their own high/low half-cycle. Never extrapolate
  // an irregular clock from UI time or a guessed period.
  if (external) s.phase = clockHigh ? 0.0 : 0.5;
  int high = 0;
  for (int lane = 0; lane < 4; ++lane) {
    // Division is a positive integer divisor, not an arbitrary range clamp.
    const double n = soemdsp::math::maxd(1.0, soemdsp::math::dsp_floor(finite(p.divide[lane], 1.0)));
    const double offset = soemdsp::math::dsp_floor(finite(p.offset[lane]));
    const double position = wrap(s.tick + s.phase - offset, n);
    s.gates[lane] = s.started && position < n * 0.5 ? 1.0 : 0.0;
    s.pulses[lane] = soemdsp::math::gate_hit(s.gates[lane], &s.previous[lane]) ? 1.0 : 0.0;
    high += s.gates[lane] > 0.0;
  }
  const bool combined = p.logic == 0 ? high > 0 : (p.logic == 2 ? high == 4 : (high % 2) != 0);
  s.combined = combined ? 1.0 : 0.0;
  s.pulse = soemdsp::math::gate_hit(s.combined, &s.previousCombined) ? 1.0 : 0.0;
}

} // namespace sandbox_divider
