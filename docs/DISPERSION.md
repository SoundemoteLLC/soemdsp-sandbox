# Dispersion

Native type `dispersion`, ID 277, Space category, wave-family browser badge.
Current queue: Material Resonator (listening accepted), Dispersion (this proof),
then Spectral Cross-Synthesis.

## First Listening Tests

- Kick, impulses or short noise bursts -> Mono, or Left/Right -> Dispersion -> Output.
- Start with Low Late, Frequency 300 Hz, Stages 32, Frequency Spread 2 oct,
  Curve 0, Stereo Offset 0 and Mix 100%.
- Lower Frequency toward 60-100 Hz for longer low-frequency smearing on kicks.
- Increase Stages for deeper phase rotation; spread corners across more octaves
  for a broader response instead of stacking the same corner.
- High Late concentrates delay toward Nyquist, not toward a negative time.
  It is a reflected spectral response, not backwards playback of a recording.
- Try Stereo Offset 0.5 oct on mono excitation for different left/right phase shapes.
- Compare Mix 100% with 50%. Fully wet is statically allpass; partial Mix adds
  deliberate dry/wet comb coloration. No hidden gain or amplitude normalization.

## Why This Is A Separate Module

Existing Phase Disperse is a mono chain of identical direct-form RBJ allpass
biquads. Robin Sinepulse Allpass is a mono triggered/audio-fed zapper with its
own stage-range/Q controls. Neither is replaced or renamed here.

This is a stereo normalized first-order lattice cascade with distributed tuning,
mirrored low/high-delay direction and explicit stereo offsets. The normalized
scattering form preserves input-plus-state energy even while coefficients change.
That is its main runtime distinction, not a claim that it is unrelated to other
allpass dispersers or an arbitrary drawn group-delay/FFT phase designer.

The roadmap comparison used a generated impulse response from the lattice and
truncated it as a short FIR. That truncated prefix changed spectral magnitude;
retaining the recursive tail preserves the allpass response without a long FIR
or kernel rebuild. No external or captured IR is loaded in either proof.

## DSP And Controls

For each stage, `y = a*x + b*s`, `sNext = b*x - a*s`, `b = sqrt(1-a*a)`.
Thus `y*y + sNext*sNext = x*x + s*s` within floating-point rounding. Static
transfer is `(a + z^-1)/(1 + a*z^-1)`, with unit magnitude. Group delay in samples
is `(1-a*a)/(1+a*a+2*a*cos(omega))`; total delay sums across the stages.

- Frequency: geometric center of stage corners in Hz. A wired f replaces the
  knob; negative uses magnitude. Low Late uses ordinary allpass corner tuning.
  High Late negates coefficients and mirrors the response around Nyquist, so
  Frequency then describes distance from that edge, not a narrowband resonance.
- Stages: actual integer 0..128, default 32. More stages add group delay and CPU.
  Zero is a wire. No misleading normalized Amount-to-hidden-stage mapping.
- Frequency Spread: total octave span across stage corners, default 2 oct.
- Distribution Curve: shared rational contour -1..1 for corner placement within
  that span. Zero is uniform octave spacing, not uniform Hz spacing.
- Direction: Low Late or High Late, coefficient ramp over 10 ms.
- Stereo Offset: signed octave difference between channels, split equally around
  the center. No audio crossfeed; identical input remains identical at zero offset.
- Mix: immediate dry/wet. Static allpass magnitude applies at 100%, not at partial
  Mix or during a fade between different stage-count taps.
- Error: invalid configuration or nonfinite recovery, confined to this module.

The wave badge identifies the broader spectral/material family, not an FFT engine.
There is no FFT window, buffering latency, lookahead or delay-compensation feature.
Frequency-dependent group delay is the intentional effect, not host buffer latency.

## Modulation And State

Ordinary native controls use the existing parameter-smoothing path. A wired f is
consumed per sample. Coefficients are cached when unchanged. Geometry changes
ramp corner ratios over 10 ms. Count changes crossfade old/new cascade taps over
50 ms and queue subsequent count changes; removed stage states are cleared only
after that fade. Retained stages keep their state. Numerical recovery or sample
rate changes clear local state, not other modules.

The energy invariant does not mean modulation is inaudible: sidebands and release
of stored energy are expected. A momentary peak can grow by drawing on stored
energy without creating energy overall. No clipping or limiter is added.

State is bounded to two 128-stage lanes, allocated once from the native pool.
No processing-time allocation, JavaScript DSP fallback or private drawing surface.
Shared GL 1D Trace displays the live output. Rapid per-sample modulation of many
geometry controls at 192 kHz can exceed realtime budget; start with 32 stages and
ordinary audio rates. Static settings are much cheaper than that stress case.

## Verification

- `test_dispersion.mjs`: 44.1/48/96/192 kHz, measured static magnitude, low/high
  group-delay ordering, exact mirrored impulse relation, generated-FIR truncation
  comparison, impulse and modulated input/output/state energy conservation,
  zero-latency dry/zero-stage wire, stereo isolation/offset and local recovery.
- `test_dispersion_graph.mjs`: all mono/stereo input routes, sample-accurate f,
  direction changes, native parameter binding and lifecycle against direct DSP.
- `test_dispersion_browser.mjs`: native audio, actual direction/count controls,
  group-delay telemetry, stereo setting and shared GL desktop/mobile views.

Listening acceptance remains required. Arbitrary group-delay drawing, multiband
phase profiles and FIR design/export are not implied capabilities of this module.
