# Dispersion

Native stereo effect, type `dispersion`, ID 277, Space category.
Material Resonator -> Dispersion -> Spectral Cross-Synthesis is the current queue.

## Listening

New instances open in Biquad / Range, 50 stages, Low Freq 15 Hz,
High Freq 8000 Hz, Low/High Q 1, Low Late and fully wet.
Feed impulses, drums, bass or speech into Mono or Left/Right.

For a stronger focused effect:
- Set Low Freq 200 Hz, High Freq 800 Hz and both Q controls to 5.
- Increase Stages toward 100 for longer ringing/chirps.
- Try Stereo Offset 0.5 oct for independent left/right phase shapes.
- Compare Mix 100% and 50%; partial mix deliberately adds comb coloration.
- High Late mirrors the delay response around Nyquist; it is not reverse playback.

## Consolidated Allpass Design

Dispersion is the complete stereo audio effect. Robin Sinepulse Allpass remains
the triggered instrument, with its existing trigger, DF1 state, idle handling,
input/exciter gain and patch controls. No third module was added.

Both use `library/include/soemdsp/filter/allpass_design.h` for Robin Schmidt's
RS-MET-compatible frequency/Q distribution and coefficient design (used with
permission; see Robin's module source and originalcode). Before consolidation,
Dispersion's normalized lattice was compared against Robin's unchanged direct
form at 44.1/48/96 kHz, one-pole/biquad, and 1/8/50/256 stages.

Dispersion uses nested orthogonal lattice sections, not Robin's DF1 state:
each scattering rotation preserves input-plus-state energy within rounding.
The static second-order denominator is
`1 + k1*(1+a)*z^-1 + a*z^-2`. Setting `k1=1` reduces it to first order.
Changing tuning/Q uses valid normalized rotations rather than a direct-form
coefficient ramp that could generate unbounded state energy.

## Controls

- Filter Mode: One-Pole for broad dispersion; Biquad for Q-focused delay.
- Tuning: Range uses Low/High Freq and Freq Shape. Center uses Center Freq,
  Center Spread in octaves and the normalized Center Curve.
- Range endpoints are actual Hz and may be reversed. One stage uses Low Freq.
- Freq Shape and Q Shape use Robin's original distribution, not Center Curve's
  normalized contour. Zero gives uniform logarithmic spacing.
- Low/High Q: positive dimensionless biquad Q, independently distributed.
  No hidden 1000-Q ceiling in Dispersion; Robin retains its original clamp.
- Wired f overrides Center Freq in Center mode. In Range mode it shifts the
  geometric center while preserving the endpoint ratio. Negative uses magnitude.
- Stages: 0..256; zero is a wire. Biquad has two poles per stage.
- Direction: Low Late / High Late, mirrored spectral delay.
- Stereo Offset: signed octave difference between left and right tuning.
- Output Gain: explicit final dB gain, default 0. No hidden makeup or limiter.
- Mix: immediate dry/wet blend. Fully wet static response is allpass.
- Error: local invalid configuration/nonfinite recovery, not engine shutdown.

All controls stay visible with mode-specific names/tooltips. Center controls
intentionally do nothing in Range mode, and Q controls do nothing in One-Pole.
Old Dispersion patches without Filter Mode are migrated to One-Pole / Center.

## Runtime

No FFT, external IR, lookahead or buffering latency. Frequency-dependent group
delay is the effect, not host buffer latency. The wave badge is a family marker.
State is allocated once for two 256-stage lanes; no processing-time allocation.
Unchanged coefficients are cached. Wired f is consumed per sample.
Geometry and mode/direction changes ramp over 10 ms. Stage-count changes fade
output taps over 50 ms, retaining remaining state and clearing removed stages
only after the fade. Switching to One-Pole discards the now-decoupled inner state;
it cannot add energy. Tap fades and dry/wet blends need not be allpass.
Local reset/sample-rate changes affect this module only.
Shared GL 1D Trace draws the face; no private JavaScript renderer.

## Verification

- `test_dispersion.mjs`: legacy Center/One-Pole behavior, static response,
  modulation energy, stereo isolation, count/direction and local recovery.
- `test_dispersion_robin_match.mjs`: static Robin parity and nested-lattice
  energy accounting across modes, sample rates and cascade depths.
- `test_dispersion_graph.mjs`: Range/Biquad native control binding, stereo routes,
  sample-accurate wired f, direction transitions and lifecycle.
- `test_dispersion_browser.mjs`: live native controls, GL desktop/mobile faces.

Listening acceptance remains separate from these numerical checks.
