# Spectral Blur

Native listening proof on `codex/convolution-resonator`, 2026-11-18.
Module Browser: Space. Native type 272, `spectral_blur` version 2.

## Controls

- Time Smear: spectral power averaging time constant in seconds, default 2 s.
  Zero follows each frame. This softens attacks and extends spectral energy;
  amplitude tails decay more slowly than the power time constant. It is not
  a freeze or delay line, and very short impulses may become quiet clouds.
- Frequency Blur: power-spreading neighborhood half-width in Hz, default 100 Hz.
  Fractional bin widths interpolate between adjacent box kernels. Zero leaves
  bins separate; broad settings make harmonic material more noise-like.
- Diffusion: phase excursion amount from coherent to phase-diffused synthesis,
  default 100%. A fixed 2 Hz Brownian phase walk has physical hop/rate scaling;
  the control scales its unwrapped phase, not an undocumented cutoff frequency.
  Rotation preserves each bin's magnitude. V1 crossfaded complex spectra, which
  introduced moving cancellations at partial settings; that crossfade is removed.
- Stereo Spread: default 100%, opposite-channel diffusion offsets make a mono
  source into a stereo wash. Zero restores linked phase motion. Diffusion must
  be above zero for spread to act; mono summing can change the result's tone.
- Phase Smooth: default 10 ms, lowpass time constant on the unwrapped diffusion
  trajectory. Zero restores raw motion; it does not smooth spectral power.
- Amplitude Smooth: default 0 ms (off), additional symmetric magnitude smoothing
  after frequency spreading. Try 5..20 ms to soften chatter without changing the
  Time Smear or Frequency Blur settings. It is not compression or a limiter.
- Mix: aligned dry/wet, default fully wet. No limiter or saturation.

## DSP And State

4096-point FFT, 1024-sample hop, periodic Hann analysis/synthesis with normalized
four-way overlap-add. Fixed 4096-sample reference latency (85.33 ms at 48 kHz).
The processing window duration and bin resolution change with sample rate;
Time Smear and Frequency Blur remain expressed in real seconds and Hz.

Per-channel spectral power is exponentially averaged. A source-normalized box
spread preserves total one-sided power across DC/Nyquist boundaries. This is
not loudness normalization, and overlap/phase changes can change output level.

Input phase is retained while a bin has usable excitation. Between excitation
frames its last measured complex phase advance is continued rather than repeating
a frozen complex frame. Newly excited spread bins begin at bin-centered advance.
Linked stochastic phase offsets keep identical stereo channels matched when
Stereo Spread is zero; spread adds a separate seeded phase walk with opposite
signs per channel, without crossfeeding audio. Separate input spectra remain
separate. Float FFT phase estimates in quiet bins can
produce small proportional-channel tail errors; test tolerance is 5e-5 absolute.

Zero smear, zero width, zero diffusion and zero Amplitude Smooth reconstruct
the delayed input. Mix 0
uses the same reference delay. Turning off a parameter changes that process at
the next analysis hop; this is not a sample-domain zero-latency processor.

All buffers are instance-owned, preallocated from the existing native pool;
no processing-time allocation or new shared engine abstraction. Invalid input
or non-finite spectral state resets this module locally. Sample-rate change
resets its spectral history. Destroy returns state to the pool. Shared WebGL
1D Trace is the only display path; no JS DSP or Canvas2D fallback.

## Listening

1. Music, voice, a pluck or percussion -> Spectral Blur -> Output.
2. Start with Time Smear 2 s, Frequency Blur 100 Hz, Diffusion 100%, Stereo Spread
   100%, Phase Smooth 10 ms, Amplitude Smooth 0 ms and Mix 100%.
3. Stop excitation and listen to the spectral tail. Sustained input obscures
   how much the attack is being spread out.
4. Try Smear 5..10 s and Blur 300..1000 Hz for broader washes. Adjust ordinary
   output volume yourself if needed; no hidden makeup gain is provided.
5. Set Blur 0 to retain harmonic separation; reduce Diffusion for a more coherent,
   metallic sustain. Set the spectral effects and Amplitude Smooth to zero for
   the neutral reference. Use Left/Right output cables to hear stereo spread.

The user's partial-diffusion reference is Time Smear 0.46 s, Frequency Blur
490.89 Hz and Diffusion 40.2%. V2 targets cancellation-driven crackle there
without suppressing the intentionally sharp spectral dynamics. Removing the
cancellations can increase audible level; this is not automatic makeup gain.

Freeze, feedback, editable FFT size, pitch shifting and a dedicated spectral
display are not in v1. Do not mistake a long power decay for infinite sustain.

## Verification

- `node scripts/test_spectral_blur.mjs`: 44.1/48/96 kHz, neutral reconstruction
  (max error about 4e-8), dry latency, silence, sustained tail, stereo scaling,
  channel isolation, mono-to-stereo spread, smoothing, retained steady level,
  rapid edits, finite recovery and no memory growth.
- `node scripts/test_spectral_blur_graph.mjs`: native defaults and edited controls,
  mono/left/right/stereo/summed routing versus direct native sample processing.
- `node scripts/test_spectral_blur_browser.mjs`: actual worklet audio, plan,
  real-unit controls and shared GL renderer on desktop/mobile.
- Build/catalog registration, source links, product availability, bypass and
  live parameter mapping are included together.

User listening acceptance is still required. CPU test output includes JavaScript
harness overhead and is not a REAPER CPU measurement. No plugin install, merge
or release is implied by this worktree proof.
