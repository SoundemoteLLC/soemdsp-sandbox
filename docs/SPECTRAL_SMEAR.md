# Spectral Smear

Spectral Smear is the original Spectral Blur, now its own module. The Cloud engine became Spectral Blur ([SPECTRAL_BLUR.md](SPECTRAL_BLUR.md)) and the phase wobble became Spectral Warble ([SPECTRAL_WARBLE.md](SPECTRAL_WARBLE.md)); all three share one STFT engine (`native_modules/spectral_blur/spectral_stft_engine.h`).

Native listening proof on `codex/convolution-resonator`, 2026-11-18.
Module Browser: Space. Native type 282, `spectral_smear`.

## Controls

- FFT Size: 512 / 1024 / 2048 / 4096 / 8192 / 16384 samples, default 4096. The UI uses six
  evenly spaced choice indices; persisted keys and DSP IDs are actual sample
  counts. At 48 kHz these windows/delays span 10.67 / 21.33 / 42.67 / 85.33 /
  170.67 / 341.33 ms. Large sizes are intentionally expensive options.
- Time Smear: spectral power averaging time constant in seconds, default 2 s.
  Zero follows each frame. This softens attacks and extends spectral energy;
  amplitude tails decay more slowly than the power time constant. It is not
  a freeze or delay line, and very short impulses may become quiet clouds.
- Blur: power-spreading half-width in CENTS (0..1200, default 0): the same musical interval at every pitch (bin k widens by
  k*(2^(c/1200)-1) bins), so a bass note and a high note are smeared by the same relative amount. The kernel is
  triangular (two box passes over the power spectrum, no hard edges) and each frame is power-matched to its source.
  There is no Hz version any more: a constant number of Hz is a different musical interval at every pitch, which sounds
  metallic. Zero leaves bins separate.
- Diffusion: phase excursion from coherent to phase-diffused synthesis, a fixed 2 Hz Brownian phase walk scaled by the
  control (unitless, `×`, default 1). Rotation preserves each bin's magnitude. Phase Smooth is fixed at 10 ms and the two
  channels share the walk (no Stereo Spread: the module is stereo-linked).
- Amplitude Smooth: symmetric lag on each bin's magnitude in ms (0..200, default 0), applied after Time Smear.
- Mix: dry/wet aligned to the selected FFT size, default fully wet. No limiter or saturation.

## DSP And State

Selectable FFT with quarter-window hop, periodic Hann analysis/synthesis and
normalized four-way overlap-add. Architect chose size-dependent processing
latency rather than forcing small windows to inherit the maximum delay.
Size edits reset an inactive
preallocated core, conservatively remap spectral power, warm for the new window
length, then smoothstep-crossfade for 50 ms. Latest requested edits queue while switching.
No allocation, global plan rebuild or active-core reset is needed for a size edit.
The transition can change timing/phase because its two cores have different
delays. This is not a promise of transparent delay-changing automation.
`latency_for_handle` reports the current core's size; the no-handle latency
function reports the 4096-sample default. Plugin-host compensation is not yet
verified and must be audited before a plugin release.
The processing window duration and bin resolution change with sample rate;
Time Smear (seconds) and Blur (cents) are real units.

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
uses the selected window's delay. Turning off a parameter changes that process at
the next analysis hop; this is not a sample-domain zero-latency processor.

All buffers are instance-owned, preallocated from the existing native pool;
no processing-time allocation or new shared engine abstraction. Invalid input
or non-finite spectral state resets this module locally. Sample-rate change
resets its spectral history. Destroy returns state to the pool. Shared WebGL
1D Trace is the only display path; no JS DSP or Canvas2D fallback.

## Listening

1. Music, voice, a pluck or percussion -> Spectral Blur -> Output.
2. Start with Time Smear 2 s, Blur 100 cents, Diffusion 100%,
   Amplitude Smooth 0 ms and Mix 100%.
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

Freeze, feedback, pitch shifting and a dedicated spectral
display are not in v1. Do not mistake a long power decay for infinite sustain.

## Verification

- `node scripts/test_spectral_smear.mjs`: 44.1/48/96 kHz neutral reconstruction (max error about 4e-8), dry latency, silence,
  sustained tail, linked stereo scaling, channel isolation, Amplitude Smooth, rapid edits, finite recovery, no memory growth,
  every FFT size at every rate, and Blur in cents.
- All six sizes reconstruct with their selected sample delay at each sample
  rate. Switching stays neutral on DC, preserves output continuity and accepts
  the latest queued size; invalid sizes return an error.
- The browser test observes the actual running native size after the UI changes,
  not merely the patch value, and checks evenly spaced choice-handle positions.
- `node scripts/test_spectral_blur_graph.mjs`: native defaults and edited controls,
  mono/left/right/stereo/summed routing versus direct native sample processing.
- `node scripts/test_spectral_blur_browser.mjs`: actual worklet audio, plan,
  real-unit controls and shared GL renderer on desktop/mobile.
- Build/catalog registration, source links, product availability, bypass and
  live parameter mapping are included together.

User listening acceptance is still required. CPU test output includes JavaScript
harness overhead and is not a REAPER CPU measurement. No plugin install, merge
or release is implied by this worktree proof.
