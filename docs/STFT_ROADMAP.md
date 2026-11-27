# STFT Modules Roadmap

Updated: 2026-11-18. Planning/tracking document, not a claim of implementation.
Current code baseline: `codex/convolution-resonator` worktree.

Status: `[x]` implemented here; `[ ]` proposed; `Decision` needs a bounded
design/listening proof. Check items only after implementation and verification.

## Scope And Boundaries

- Native C++/WASM DSP; shared WebGL displays. No JavaScript DSP/drawing fallback.
- Extend working modules deliberately; do not turn every effect into one giant
  spectral processor. Reuse proven FFT/window utilities, not unrelated state.
- Keep standalone IIR Vocoder separate: see [VOCODER_ROADMAP.md](VOCODER_ROADMAP.md).
- Convolution Resonator retains its body-colored STFT path. Its temporary raw
  STFT/filter-bank comparison was removed; do not reintroduce it through this plan.
- No hidden limiter, loudness matching, or arbitrary audio clipping. Expose
  intentional gain bounds/feedback policies and diagnose non-finite failures.
- Parameter spawn ranges are UI defaults, not automatically DSP hard limits.

## Existing Inventory

Implementation details: [STFT_DYNAMICS.md](STFT_DYNAMICS.md).

### Spectral Contrast

- [x] Contrast, Scale, Threshold, Ratio, Attack, Release, Max Boost, Output Gain, Mix.
- [x] Relative contrast over 32 log-frequency regions; separate downward compression.
- [x] Stereo-linked gain; 1024 FFT / 256 hop; aligned 1024-sample dry/wet delay.
- [x] Shared GL time-domain trace; native reconstruction/routing tests.

Proposed controls and tools, in priority order:

- [ ] Spectral display: input/output power and applied gain, with explicit units.
- [ ] External sidechain inputs with a clearly labeled Internal/External detector.
- [ ] Listen selector: Processed / Removed Difference / Detector. Delay-align the
  difference signal; explain that it is a subtraction, not isolated noise.
- [ ] Knee for the threshold compressor, independent of relative Contrast.
- [ ] Detection low/high limits; leave out-of-range audio unchanged by default.
- [ ] Stereo Link amount, preserving current fully linked default. Define how
  channels combine and test image movement before exposing independent behavior.
- [ ] Spectral Tilt around an explicit pivot to bias the target balance.
- [ ] Optional gain-reduction limit, separate from existing Max Boost.
- [ ] Optional transient preservation, only after a measured/listened proof.
- Decision: upward-compression/expansion modes merit a distinct dynamics recipe;
  do not quietly change what the existing Ratio means.

### Spectral Gate

- [x] Manual / Learn / Use Profile, Ready output, Threshold, Margin, Depth, Knee.
- [x] Attack, retriggerable per-bin Hold, Release, neighboring-bin Smooth, Mix.
- [x] Hold supports long typed durations, including 5000 ms; it holds gain open,
  not sound. It cannot make a vanished harmonic continue ringing.
- [x] Stereo-linked per-bin decisions; fixed 1024 FFT / 256 hop and aligned dry.
- [x] Noise profile is currently engine-session state, not patch-persistent.

Proposed controls and tools, in priority order:

- [ ] Spectral display: input, threshold/profile and gain mask; obvious learning
  and Ready state rather than requiring the user to infer profile readiness.
- [ ] Profile persistence: versioned native export/import through existing patch
  assets/state conventions. Store FFT/rate/normalization metadata; validate before
  use. Define rate conversion or explicit relearn behavior, never silently guess.
- [ ] Learn trigger and Clear Profile action; keep the existing mode workflow.
- [ ] Listen selector: Kept / Removed Difference / Detector.
- [ ] Hysteresis: separate opening/closing threshold gap to reduce chatter.
- [ ] External detector inputs, retaining the main input's complex spectrum.
- [ ] Detection low/high limits and threshold Tilt/Pivot for frequency bias.
- [ ] Replace or extend Smooth with a width in Hz/octaves, keeping old patches'
  five-bin smoothing behavior reproducible.
- [ ] Optional frequency-dependent Release (low/high timing tilt), in real time
  units, not a sample-rate-dependent coefficient exposed to users.
- [ ] Optional adaptive profile tracking with explicit speed and activity state;
  never silently modify a frozen learned profile.
- [ ] Optional invert-mask sound-design mode, separate from the diagnostic
  difference output. Document gain-mask inversion versus audio subtraction.

### Convolution Resonator: STFT Portion

- [x] Body-colored BLIT carrier, Vocoder blend, Crunch, Response, Bandwidth,
  Formant Shift; body controls and pinned IR/kernel GL display.
- [x] Active-pair multiresolution processing with 2x oversampling and aligned
  2184-sample reference delay.
- [ ] Clarify effective analysis duration and spectral smoothing in the display
  so Crunch/Response/Bandwidth interactions are visible.
- [ ] Voice/Synth diagnostic listening or display only if it resolves a real
  usability issue; do not duplicate standalone Vocoder controls here.
- Decision: independent envelope attack/release trims must prove useful beyond
  Response before adding more overlapping controls.

## New Modules

General buffered reconstruction/time stretching is parked separately under
Sample Player: [FFT_RECONSTRUCTION_PLAN.md](FFT_RECONSTRUCTION_PLAN.md).
Its placeholder is FFT Reconstruction, not Spectral Stretch.

All seven ideas are accepted as roadmap candidates, not an instruction to build
them simultaneously. Proposed order follows musical value and implementation risk.

### 1. Spectral Freeze

- [x] Native v1 Freeze switch/gate and Recapture trigger; capture at a complete
  analysis frame. See [SPECTRAL_FREEZE.md](SPECTRAL_FREEZE.md).
- [x] Sustain with captured phase advance, optional diffusion and stereo spread.
- [x] Decay including explicit infinite hold, Mix and Held output.
- [x] FFT sizes 512..16384, Capture Blend (ms), Refresh Rate (Hz), Recapture button.
- [ ] User listening acceptance for size remapping, refresh and recapture blend.
- [ ] Later: frequency diffusion, pitch/formant controls, capture persistence.
- Proof: silence remains silent; a captured transient sustains without periodic
  frame buzz; capture/release is click-controlled; repeated triggers work.
- Keep distinct from Gate Hold: Freeze stores/synthesizes sound.

### 2. Spectral Delay

- [x] Native stereo Spectral Delay: Base Delay, signed Delay Spread, Pivot,
  Curve, Feedback, Mix and FFT sizes 512..16384. See [SPECTRAL_DELAY.md](SPECTRAL_DELAY.md).
- [x] Bounded preallocated spectral histories; native capacity getter reports
  milliseconds, roughly 10.8 seconds at 48 kHz. Invalid requests raise Error.
- [x] Base module listening acceptance; Feedback Tilt (dB) and Stereo Crossfeed.
- [ ] Listening acceptance for Tilt/Crossfeed, long-tail FFT handoff and worst-case host CPU proof.
- [ ] Later: band-pattern editing and tempo sync.
- Proof: known impulses arrive at specified band delays; modulation behavior is
  intentional; feedback decay and memory/CPU limits are measured.
- Decision: shifting read heads versus crossfading delay taps changes the sound;
  select deliberately rather than hide it as generic smoothing.
  V1 uses moving, phase-aware fractional spectral reads. Time edits can bend pitch;
  FFT-size edits separately warm and crossfade two engines.

### Parked: Spectral Smear

- [x] Under-construction Module Browser entry: "pre and post ringing smear".
- [ ] Revisit controlled transient lead-in and trailing ringing later.
- No DSP, new lookahead, latency-compensation work or active module in this pass.

### 3. Spectral Blur

- [x] Native v1: Time Smear (seconds), Frequency Blur (Hz), Diffusion blend,
  Mix and phase-evolving tails. See [SPECTRAL_CLOUD.md](SPECTRAL_CLOUD.md).
- [ ] User listening acceptance and follow-up priorities.
- [ ] Later: direction/bias, freeze interaction, diffusion and feedback.
- Proof: neutral reconstruction; independent time/frequency controls; sensible
  energy behavior at DC/Nyquist and no unexplained boundary amplification.

### 4. Spectral Cross-Synthesis

- [x] Voice L/R and Synth L/R; Transfer, Envelope Width (Hz), Attack/Release (ms),
  Mix and explicit output gain. FFT sizes 512..16384, hop size / 4.
- [x] Voice supplies broad power envelope; Synth supplies fine structure/phase.
  No built-in carrier or IIR bands. See [SPECTRAL_CROSS_SYNTHESIS.md](SPECTRAL_CROSS_SYNTHESIS.md).
- [x] Base-module listening acceptance; FFT-size warm/crossfade and Formant Shift
  in semitones, with explicit Voice-envelope versus Synth-phase ownership.
- [ ] New controls listening acceptance and worst-case host callback proof.
- [x] Hidden, inactive Whitening and Transient Blend parameter placeholders;
  no modulation, parameter outputs or runtime bindings.
- [ ] Later: implement envelope whitening and transient blend.
- Proof: donor ownership is audible and measurable; silent donors have defined
  behavior; stereo and dry alignment remain correct.
- Decision: establish a distinct sound/use case from the resonator's STFT path
  before extracting a reusable engine or adding another near-duplicate vocoder.

### 5. Spectral Shift / Warp

- [x] Native stereo Spectral Shift / Warp: Shift in Hz, positive Warp exponent,
  Pivot in Hz, Pitch in semitones, Stereo Shift in Hz, Mix/Gain and FFT sizes
  512..16384. See [SPECTRAL_WARP.md](SPECTRAL_WARP.md).
- [x] Phase-coherent peak-region translation and explicit out-of-band rejection.
- [x] Base listening acceptance. New Pitch/Stereo controls await confirmation.
- [ ] Later: alternate negative-frequency policies and worst-case host CPU proof.
- Proof: sine/multitone output frequencies match the mapping; phase evolution
  is continuous; high-frequency products and aliasing are measured.
- True pitch shifting needs its own phase-coherent design; moving FFT bins is
  not sufficient and is not a promised shortcut here.

### 6. Spectral Morph

Parked by Architect; do not implement next automatically.

- [ ] Two stereo inputs, Morph amount, explicit magnitude interpolation law.
- [ ] Define phase ownership/alignment; do not merely crossfade audio and call
  it spectral morphing. Optional energy matching must be visible and defeatable.
- [ ] Later: independent envelope/fine-structure morph and frequency-dependent mix.
- Proof: endpoint identity, silence handling, unrelated-input stability and
  smooth musical intermediate states.

### 7. Spectral Extractor

- [ ] Harmonic / Percussive / Residual outputs with sensitivity and separation mix.
- [ ] Begin with a bounded harmonic/percussive median-filter proof; residual
  separation requires a separately defined mask, not an assumed third component.
- [ ] Later: mask sharpness, time/frequency neighborhood widths, audition modes.
- Proof: complementary masks reconstruct the input within documented tolerance;
  report lookahead/latency; test drums, sustained tones and mixed material.

## Shared Engineering Gates

Current Architect priority: Material Resonator, then Dispersion, then Spectral
Cross-Synthesis. Other candidates remain backlog, not concurrent implementation.

- [ ] Each module declares FFT/hop/window, reference latency, stereo policy,
  detector units, parameter update rate and persistent versus transient state.
- [ ] Neutral reconstruction, DC/Nyquist, silence, impulse and multitone tests
  at 44.1/48/96 kHz. Verify phase, channel isolation and aligned dry/wet.
- [ ] Parameter ramps and rapid edits must not allocate, stall, clear unrelated
  state or introduce avoidable zipper noise. Structural changes need an explicit
  warm/crossfade/rebuild policy and latency reporting.
- [ ] Preallocated bounded memory and measured worst-case callback cost with
  multiple instances; no unbounded per-hop work or main-thread audio dependency.
- [ ] Spectral displays consume bounded telemetry, never native audio ownership;
  hiding/zooming a display must not alter DSP. Shared GL only.
- [ ] State survives relevant graph edits; reset/delete/rate-change behavior is
  explicit. Bad native state is diagnosed locally, not silently replaced by JS.
- [ ] Parameter metadata, tooltips, native registry, exports, runtime bindings,
  patch persistence and tests land together.

## Queue And Completion Rule

1. Gate profile persistence and useful spectral telemetry/listening tools.
2. Spectral Freeze: one phase-evolving capture proof, then musical controls.
3. Spectral Delay, then Blur; each gets its own native and browser acceptance.
4. Contrast sidechain/Knee and Gate hysteresis after listening prioritization.
5. Cross-Synthesis, Shift/Warp, Morph, Extractor as separate bounded milestones.

For each milestone record: exact controls/units, non-goals, tests, listening
result, CPU/memory/latency, commit and remaining decisions. Prefer one proof,
one demo, one checkpoint, one report. Do not build a new shared framework first.
