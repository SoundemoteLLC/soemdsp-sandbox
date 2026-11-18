# Noise Convolution Reverb: Extreme Settings

Updated: 2026-11-18. First short-IR/darker-tone milestone implemented locally;
musical listening acceptance and boom/body experiments remain open.

## Goal

Extend the existing module toward tiny, dark, boxy, smeared and boomy spaces.
Treat short convolution as a creative colored diffuser/filter, not only a
realistic room. Keep this in Noise Convolution Reverb; no new module is needed.

Architect explicitly does not require compatibility checks or a legacy mode.
Prefer clear controls and intentional DSP over preserving old parameter mappings.
Signal correctness, stability and performance tests are still required.

## Non-Goals

- No dedicated Generation Loss module.
- No distortion, saturation, hiss, dropouts, pitch wobble or wow/flutter.
- No STFT conversion. This module uses FFT-accelerated convolution of a
  generated noise impulse response; FFT partitions are an implementation detail.
- No broad convolution-engine rewrite, JavaScript DSP fallback, or private
  Canvas2D display path.

## Original Code Findings (Before Extreme-Settings Work)

Source: `native_modules/noise_conv_reverb/noise_conv_reverb.cpp`.
UI metadata: `public/node-graph-module-definitions.js`, `noiseConvReverb`.

- [x] Existing controls: Length, Amp Shape, Spectral Shape, Darkness,
  Brightness, Decorrelate, Seed and Mix.
- [x] Original UI Length started at 0.025 s. Native parameter sanitization
  accepted one sample, but IR generation had a hidden 128-sample floor. The
  extreme-range implementation removes that floor; the maximum is six seconds.
- [x] Amp Shape warps a decay from 0 to -60 dB. Positive shape reaches the
  end sooner; it does not add distortion or reverse the envelope.
- [x] Brightness maps the initial lowpass cutoff from 1500 to 16000 Hz,
  capped at 45% of sample rate. Darkness moves the final cutoff toward 120 Hz.
  Spectral Shape controls the trajectory between those endpoints.
- [x] Generated noise passes through two one-pole lowpass stages per channel.
- [x] A nominal 20 ms cosine end fade covers most of a 25 ms IR and the
  whole IR at shorter lengths. This needs deliberate short-IR treatment.
- [x] Decorrelate blends the right IR between the left realization and an
  independent realization. It is not time-varying modulation or a crossfeed matrix.
- [x] The generated stereo IR is normalized to combined unit energy. Shaping
  therefore changes spectral concentration, not simply total IR energy.
- [x] Parameter edits rebuild an alternate IR incrementally and crossfade;
  first 128 taps use direct convolution, with FFT partitions for the remainder.

These are source findings, not completed extreme-settings work.

## Listening Reference

Capture a preset/audio reference using the user's reported recipe:

- Amp Shape high; Spectral Shape high.
- Brightness zero; record the actual Darkness and Length settings rather than
  inventing them from the description.
- Sweep Decorrelate from 0 to 100%.

The user describes this as VHS generation-loss-like coloration. Preserve it
as a listening reference, not a promise to model tape or preserve old mappings.
Use impulses, kick drums, grungy pulse oscillators, voice and full mixes.

## Implementation Queue

### 1. Prove The Short-IR Range

- [ ] Exercise 1, 2, 5, 10, 25 and 50 ms through the existing native engine.
- [ ] Inspect IR shape, spectrum, peak gain, stereo behavior and audible output.
- [ ] Compare the existing end fade against a length-relative taper, capped
  at the existing nominal 20 ms for longer IRs.
- [ ] Choose a taper from measurements/listening; do not blindly apply a
  20 ms window to every tiny IR or remove endpoint treatment without testing.
- [ ] Check one-sample and near-zero-energy IR behavior for valid normalization.

Deliverable: a small before/after listening proof and a justified taper rule.

### 2. Expose Useful Tiny Lengths

- [ ] Set a proposed spawn minimum of 0.001 s and provide fine sensitivity
  near the bottom through metaparameter settings, not bespoke slider behavior.
- [ ] Keep native sample-count and memory-capacity boundaries explicit.
- [ ] Listen before deciding whether sub-millisecond lengths deserve UI range.
- [ ] Explain in the tooltip that tiny values become coloration/filtering.

### 3. Extend Dark Tonal Reach

- [ ] Prototype initial cutoff values below the current 1500 Hz floor.
- [ ] Prefer explicit understandable frequency endpoints over several obscure
  overlapping tone knobs. Decide whether to remap Brightness or expose cutoff
  in Hz after the first listening proof; no legacy mode is required.
- [ ] Keep the distinction between initial cutoff, final cutoff and Spectral
  Shape clear. Test stationary dark kernels as well as darkening trajectories.
- [ ] Verify sensible sample-rate limits and no accidental DC buildup.

### 4. Prototype Boom / Body

- [ ] Compare a broad low-frequency shelf with a damped resonant component
  applied during IR generation. Select by sound and measured response.
- [ ] Start with Body Amount and Body Frequency only if both are necessary;
  add Width/Decay only when the proof demonstrates independent musical value.
- [ ] Decide explicitly how body shaping interacts with IR energy normalization.
  Do not silently add automatic makeup gain or output clipping.
- [ ] Keep it finite-IR coloration, not a new live feedback loop. Narrow ringing
  and boomy emphasis are allowed, but newly generated harmonics are not the goal.

### 5. Finish The Instrument

- [ ] Add a few useful presets: tiny dark box, warm smear, boomy chamber and
  the user's high-shape/dark/decorrelation reference.
- [ ] Update tooltips with actual units, endpoint meanings and rebuild behavior.
- [ ] If needed, expose a bounded IR/frequency-response view through shared GL;
  do not make a new display a prerequisite for the first audio proof.
- [ ] Remove superseded mappings/helpers rather than retaining unused branches.
- [ ] Record the chosen controls, measurements, listening results and checkpoint.

## Verification

- [ ] Compare native output with direct convolution using the generated IR,
  especially when the entire IR fits inside the direct head.
- [ ] Test 44.1/48/96 kHz, silence, impulses, sustained bass, dense transients,
  mono/stereo routing, multiple instances and extreme valid parameter values.
- [ ] Measure energy normalization, DC response, spectral peaks and left/right
  correlation across Decorrelate. Do not mistake narrow spectral emphasis for
  nonlinear distortion or assume intermediate correlation is perceptually linear.
- [ ] Rapid Length/tone/shape/seed edits must not cause avoidable clicks,
  callback stalls, allocations, lost tails or unrelated module resets.
- [ ] Check rebuild scheduling, capacity, finite-state recovery and memory reuse.
- [ ] Report CPU/memory and listening acceptance; correctness does not establish
  that a tiny room sounds good.

No patch-compatibility test suite, migration layer or legacy-sound branch is
required for this work. Do not relax audio correctness checks as a consequence.

## Related Plans

- [STFT roadmap](STFT_ROADMAP.md): separate spectral effects and dynamics.
- [Vocoder roadmap](VOCODER_ROADMAP.md): separate IIR filter-bank work.

## First Implementation Checkpoint

- [x] Length spawn range is 1 ms..6 s, with midpoint 100 ms for fine low-end
  control. Removed the hidden 128-sample kernel floor; native supports one sample.
- [x] Taper the filtered IR's final quarter (integer sample spacing), capped at
  20 ms, with an exact zero endpoint for kernels longer than one sample.
- [x] Brightness now spans 50 Hz..16 kHz logarithmically. Darkness never raises
  an already-sub-120 Hz cutoff. Existing Brightness values have a new mapping;
  no legacy mode or compatibility work was added.
- [x] Native version 2; standalone and combined WASM rebuilt. DSP controls,
  IR rebuilding and crossfades remain the existing mechanism.
- [x] Native tests verify 1 sample and 1/2/5/10/25/50 ms at 44.1/48/96 kHz,
  normalized stereo IR energy, zero endpoints, direct-convolution identity,
  dark/bright spectral difference, decorrelation and rapid edits.
- [x] Existing tail/dry/seed/range and CPU tests pass.
- [ ] User listening acceptance: this is not yet a verdict on the best taper sound.
- [ ] Boom/body shaping and curated presets remain later work.

Listening queue (settings are suggestions, not claimed finished presets):

1. Set Mix fully wet, Length 25 ms, Amp/Spectral Shape high, both cutoffs 5 Hz;
   sweep Decorrelate from 0 to 100%.
2. Compare Length 1, 2, 5, 10, 25 and 50 ms with a pulse oscillator or percussion.
3. Raise both cutoffs through 50, 120, 500 and 1500 Hz to explore coloration.
4. Try Start 1500 / End 120 Hz, then Start 5 / End 500 Hz. Sweep Spectral Shape
   to curve the darkening or brightening trajectory; Amp Shape controls decay.

### Deeper Brightness Follow-Up

Historical intermediate mapping: on user listening request, the cutoff range was extended to 5 Hz..16 kHz
(native version 3). The old 0.999 coefficient cap is removed: the positive,
sample-rate-limited cutoff already produces a stable one-pole coefficient,
and that cap otherwise imposes an unintended sample-rate-dependent cutoff floor.
Brightness around 0.285 reproduces a 50 Hz starting cutoff. IR energy
normalization remains unchanged. No added distortion, wobble or output filter.

Very short finite kernels cannot realize an arbitrarily narrow lowpass response;
at extreme settings the integrated noise shape and endpoint taper dominate.
Try 25..100 ms as well as 1..10 ms for different kinds of muffling. The 5 Hz
control value describes the noise-generation filter, not a promise that the final
truncated IR has a 5 Hz measured -3 dB corner or tracks a voice's fundamental.

### Physical-Unit Parameter Correction (Current)

Architect policy: when a parameter controls a quantity with a real physical
unit, expose and store that quantity in its real unit. A nonlinear slider is
allowed; a hidden normalized-to-Hz DSP mapping is not.

Start Cutoff (`startCutoffHz`) and End Cutoff (`endCutoffHz`) now store Hz
throughout UI metadata, patches, worklet, native graph and native sample/block
APIs. Defaults are 1500 / 120 Hz; both spawn ranges are 5..16000 Hz with midpoint
1000 Hz, frequency kind and Hz unit. Native version 5 removes both normalized
endpoint mappings. Brightness/Darkness keys and controls are removed, not kept
as aliases or a legacy conversion layer.

Native cutoffs are bounded only to nonnegative frequencies and 45% of sample
rate. Positive endpoints interpolate logarithmically using Spectral Shape;
either direction is allowed. A zero endpoint uses linear interpolation to avoid
logarithms of zero; two zero endpoints generate a silent IR. Old instances
should be respawned for the new parameters. No compatibility work is required.

### Parameter-Edit Crackle Fix

Native version 6 corrects bank recycling and transition behavior:

- Clear a recycled bank's pending output horizon before rebuilding; align its
  output cursor with the live bank before activation.
- Warm the new bank for its largest FFT hop using shared input history before
  a 20 ms smoothstep output crossfade. Short direct-only kernels need no FFT warmup.
- Finish an immutable build/transition, then accept the latest requested values.
  Continuous edits no longer restart every build or overwrite active build state.
- Limit generation to 512 taps, normalization to 4096 taps and partition building
  to one stereo partition per call. Long kernels take longer to update rather
  than performing the entire normalization/generation burst on one callback.
- Reserve spectrum storage for the full final partition, even when the kernel
  ends partway through it. The old allocation could overlap adjacent state.

Transition regression tests cover direct/FFT and recycled banks at 44.1/48/96 kHz
against steady-state tap sums. `test_noise_conv_reverb_extremes.mjs --baseline`
intentionally fails on the pre-fix `ad44142c` binary. Current tests pass. A stronger
six-second impulse comparison now matches the generated IR within 3e-9; the old
tail-energy checks alone did not catch the allocation problem. Browser checks pass.
Actual knob-movement listening acceptance remains with Architect.
