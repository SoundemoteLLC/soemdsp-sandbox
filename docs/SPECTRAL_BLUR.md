# Spectral Blur

Native listening proof on `codex/convolution-resonator`, 2026-11-18.
Module Browser: Space. Native type 272, `spectral_blur` version 5 (adds Swarm, Rate, Drift and Seed; see below).

## Controls

- FFT Size: 512 / 1024 / 2048 / 4096 / 8192 / 16384 samples, default 4096. The UI uses six
  evenly spaced choice indices; persisted keys and DSP IDs are actual sample
  counts. At 48 kHz these windows/delays span 10.67 / 21.33 / 42.67 / 85.33 /
  170.67 / 341.33 ms. Large sizes are intentionally expensive options.
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
- Swarm: default 0 (off). A fuzzy, buzzing wobble of each partial's phase and level that
  stays in place in time. Separate from Diffusion (whose Brownian walk is untouched) and not a
  smear: with Time Smear, Frequency Blur, Diffusion and Amplitude Smooth at zero, transients keep
  their time plus the FFT window delay. At 0 the output is bit-identical to version 4.
- Rate: default 5 Hz (the definition spans 0..1000; nothing in the DSP enforces a range, the parameter
  definition / Parameter Settings do). How fast the Swarm wobble moves. It updates at the STFT hop rate
  (about 47 Hz at 4096 / 48 kHz), so it is not audio-rate modulation. No effect while Swarm and Drift are 0.
- Drift: default 0. A tiny mean-reverting pitch wander of each partial around its own frequency
  (a few Hz at most), not Frequency Blur: no power moves to neighboring bins. Uses Rate.
- Seed: default 1 (0..16777215, discrete, never smoothed). Seeds the Swarm / Drift noise: same Seed,
  same input, same settings, same sound. No effect while Swarm and Drift are 0.
- Mix: dry/wet aligned to the selected FFT size, default fully wet. No limiter or saturation.

## Swarm DSP

Done in `Core::frame` after the analysis, with its own xorshift stream (Diffusion's streams are never
drawn from) that is reseeded from Seed on a Seed change, on the module's local reset and on a
sample-rate reset. When Swarm and Drift are both 0 nothing here runs, including the random draws.
Per bin and hop (bins 1..N/2-1), one-pole mean-reverting noise for a phase wobble, an amplitude wobble
and a drift: `state = pole * state + sqrt(1 - pole^2) * noise`, with `pole = exp(-2 pi Rate hop / sr)`
and the state clamped to +-1 (the sqrt keeps the depth the same at every Rate; the state returns to 0, it
never integrates). The wobble rotates the analysis phase by `Swarm * state * pi` radians and scales the
sounding magnitude by `1 + Swarm * state * 0.5` (no clamp: Swarm, Drift and Rate are used as given, only non-finite input and a negative Rate are guarded) AFTER the Amplitude Smooth lag, so that lag
cannot erase it. Drift adds `Drift * state * 2 pi 3 Hz * hop / sr` radians per hop to a wrapped accumulator,
a pitch wander of up to 3 Hz. The modulators are linked across Left and Right (a mono input stays mono);
Stereo Spread still affects Diffusion only. No FFT is added.

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
uses the selected window's delay. Turning off a parameter changes that process at
the next analysis hop; this is not a sample-domain zero-latency processor.

All buffers are instance-owned, preallocated from the existing native pool;
no processing-time allocation or new shared engine abstraction. Invalid input
or non-finite spectral state resets this module locally. Sample-rate change
resets its spectral history. Destroy returns state to the pool. Shared WebGL
1D Trace is the only display path; no JS DSP or Canvas2D fallback.

## Swarm preset

No per-module preset hook exists in this repo, so the values are documented here and a demo patch is
in `patches/demo_patches/spectral_blur_swarm.json` (keyboard -> pulse train -> Spectral Blur -> Output).
Swarm preset: Time Smear 0, Frequency Blur 0, Diffusion 0, Stereo Spread 0, Amplitude Smooth 0, Mix 1,
Phase Smooth 10 ms (only Diffusion uses it), FFT Size 4096 (the module default; try 2048 for tighter
transients), Swarm 0.8, Rate 5 Hz, Drift 0.2, Seed 1.

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

Freeze, feedback, pitch shifting and a dedicated spectral
display are not in v1. Do not mistake a long power decay for infinite sustain.

## Verification

- `node scripts/test_spectral_blur.mjs`: Swarm section (off is bit-identical, Seed and Rate inert while off,
  deterministic, reseeds on reset, in place for an impulse and a tone, linked stereo, finite and recovering,
  CPU against Swarm off), plus 44.1/48/96 kHz, neutral reconstruction
  (max error about 4e-8), dry latency, silence, sustained tail, stereo scaling,
  channel isolation, mono-to-stereo spread, smoothing, retained steady level,
  rapid edits, finite recovery and no memory growth.
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
