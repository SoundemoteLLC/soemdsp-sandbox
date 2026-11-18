# Noise Convolution Reverb: Extreme Settings

Updated: 2026-11-18. Approved direction; implementation has not started.

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

## Current Code Findings

Source: `native_modules/noise_conv_reverb/noise_conv_reverb.cpp`.
UI metadata: `public/node-graph-module-definitions.js`, `noiseConvReverb`.

- [x] Existing controls: Length, Amp Shape, Spectral Shape, Darkness,
  Brightness, Decorrelate, Seed and Mix.
- [x] UI Length starts at 0.025 s; native sanitization accepts one sample up
  to the allocated capacity, with an overall maximum of six seconds.
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
