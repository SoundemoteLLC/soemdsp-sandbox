# Spectral Smear

Spectral Smear is the wash: the spectrum smeared in time (it blooms and lingers) and spread in frequency, with drifting phases that give it
width. It is the pre-split Spectral Blur, made cleaner. Module Browser: Space. Native type 282, `spectral_smear`; shared engine
`native_modules/spectral_blur/spectral_stft_engine.h` (Engine `kSmear`). Plan: `SPECTRAL_SMEAR_FIX_PLAN.md`. The cloud is
[Spectral Cloud](SPECTRAL_CLOUD.md), the pitch wobble [Spectral Warble](SPECTRAL_WARBLE.md).

## Controls (limits live in the parameter definition only)

- FFT Size: 512..16384 samples, default 4096 (the processing delay, identical in both Hop modes).
- Time Smear: s (0..10, default 2). Per-bin power averaging time constant; the tail decays with that time constant (tested at 1.0 s in both hops).
- Frequency Blur: Hz (0..4000, default 100). Triangular, power-matched kernel; the same Hz at every pitch. No upper cap in the DSP.
- Pitch Blur: cents (0..1200, default 0), added to Frequency Blur; the same musical interval at every pitch.
- Diffusion: x (0..1, default 1). The amount of phase diffusion.
- Diffusion Speed: Hz (0..200, default 30). The phase-diffusion half-width per bin: the walk step is `sqrt(12 pi Speed H / sr)` per hop. 30 Hz melts
  a blur into a soft wash with no ringing tones; about 2 Hz brings back the old glassy sound, which rings metallic on a wide blur.
- Hop: Normal (overlap 4, hop N/4, default) or Smooth (overlap 8, hop N/8, about twice the CPU). Same delay and level. Switching warms a second core,
  copies the phase state (so the crossfade is between coherent signals) and crossfades over 50 ms; tested glitch-free.
- Stereo Spread: x (0..1, default 1). The side walk: left = shared - half Spread side, right = shared + half Spread side; phase only, no crossfeed.
- Mono Bass: Hz (0..1000, default 120). Below it both ears share the phase motion (one-octave ramp). 0 = off.
- Phase Smooth: ms (default 10): smoothing of the diffusion walk. Amplitude Smooth: ms (default 0): lag on each bin's magnitude.
- Seed: the app seed control: seeds the two walks (seed 0 keeps the original constants). Mix: dry/wet aligned to FFT Size.

Stereo Spread, Phase Smooth, Diffusion Speed and Mono Bass do nothing while Diffusion is 0, and Mono Bass also does nothing at Spread 0: the face draws
them with grey stripes (`NODE_GRAPH_FACE_INACTIVE_PARAMS` in `node-graph-module-face.js`, which also serves Cloud and Warble).

## What changed against the previous Smear

- **Live versus smeared phase.** Per bin, `c = min(1, P_in / P_out)` (input power over the blurred, smeared target). Where the input is really present the
  phase is the input's; smeared tails and spread energy continue the bin's held phase advance instead of taking noise-floor phase, so tails neither crackle
  nor freeze into steady tones. The absolute 1e-24 phase branch is gone for Smear (Cloud and Warble keep theirs: they never blur by smearing).
- **Level.** The synthesis-window pass match now runs for every engine, and each bin is given back what decorrelated frames lose,
  `1 / sqrt(rho^2 + (1 - rho^2) kappa)` with `rho = sinc(Diffusion jitter)` and `kappa = (1 / overlap) 1.944`; it is 1 at Diffusion 0 and cannot boost.
- Diffusion Speed, Mono Bass, Seed and Hop are new; the radius cap on Frequency Blur is deleted (`boxMean` already handles any width).

## Measured behaviour and known limits (`scripts/test_spectral_smear.mjs`)

- Neutral reconstruction about 4e-8 at 44.1, 48 and 96 kHz in both hops; every FFT size reconstructs at its own delay.
- **Peaks.** Spread energy used to copy its source bin's phase, so a saw blurred without Diffusion became a pulse train (+24 dB over dry). Now the share of a
  bin that is not live input always takes the full phase walk (Diffusion scales only the live share; neutral settings are untouched). Result: a blurred saw
  peaks +2.4 to +6.5 dB (was up to +24), a diffused one +4.3 to +7.3 (was up to +10); on pink noise the peak is within +2.5 dB of dry (plan: 3). Against a SAW
  the plan's 3 dB cannot be met by any wash: noise has a crest factor of about 4.6 and a saw 1.7, so the peak rises by about 8 dB at equal RMS whatever
  the phases. The test therefore checks pink noise at 3 dB and that a washed saw is no peakier than noise (crest <= 5.5; a pulse train has about 15).
- **Level makeup, derived instead of fitted.** Overlapping frames whose diffused phases differ add in power rather than amplitude. For a bin the frames m hops
  apart agree with coherence `exp(-v Var_m / 2)`, where `v = diffusion^2 jitter^2 / 3` is the per-hop step variance and `Var_m` the variance of the walk
  after the Phase Smooth one-pole lag (`sum_{k<m} (1 - p^(k+1))^2 + (1 - p^m)^2 p^2 / (1 - p^2)`, p = exp(-hop / (sr tau))). The power that survives the
  overlap-add against the fully coherent sum is `(1 + 2 sum C_m rho_m) / (1 + 2 sum C_m)`, C_m being the autocorrelation of the squared window at whole hops
  (computed in reset() for the core's own overlap; at rho = 0 it equals 0.486 at 4x and 0.243 at 8x, the values derived earlier). Each bin is given 1 / sqrt
  of that, raised to the measured power 1.1 (the window-pass match leaves the loss slightly under-restored). It is 1 for live input without Diffusion.
  Spread energy gets one more term: it forms bursts that do not add in amplitude even when its walk is slow, so at 8x it is restored in proportion to the
  walk's coherence.
- **Measured over the whole Phase Smooth range (0..200 ms), both hops, saws and washes:** over dry at most +0.63 dB, under at most -0.90 dB at Normal and -1.26 dB at
  Smooth. Pink noise: over +0.62, under -1.25. So the plan's 1 dB is met at Normal and missed by 0.26 dB at Smooth. **The makeup can still exceed dry by up to
  0.6 dB**: it restores a MODELLED loss, so the model's error shows as a small boost on some material (it is exactly 1 for live input without Diffusion, and it
  never exceeds the loss of fully independent frames: +3.1 dB at 4x, +6.1 dB at 8x before the power). Raising the power to 1.2 trades this for a smaller loss at
  Smooth but boosts pink noise by 1.15 dB, so 1.1 was chosen (boost first).
- Raised maxima (Frequency Blur 20000, Pitch Blur 3000, Diffusion Speed 800, Diffusion 1.5, Time Smear 40): the level stays within +0.75 dB of dry.
- Not metallic: at the FFT-bin centres of a 2-6 kHz noise band the worst peak over the floor is 6.2 dB at Speed 30 against 12.5 dB at Speed 2.
- Stereo: Spread 0 is bit-linked; Spread 0.5 and 1 are already decorrelated (the side walk is unbounded); Mono Bass 200 keeps a 100 Hz sine at rho 1.00.
- The plan's Spread 0.5 correlation of 0.3-0.9 and the 3 dB bin-peak bound are not reachable with a random band; the tests say how they were adapted.

## Display and preset

Styles: Particles (default), Overlay, Waterfall. `patches/demo_patches/spectral_smear.json`: the pre-split defaults (Time Smear 2, Frequency Blur 100,
Pitch Blur 0, Diffusion 1, Stereo Spread 1, Phase Smooth 10, Amplitude Smooth 0) with Diffusion Speed 30, Mono Bass 120, Seed 1.

## Verification

`node scripts/test_spectral_smear.mjs`, `scripts/test_spectral_blur_graph.mjs` (slots: 22 FFT, 52 Time Smear, 31 Frequency Blur, 10 Pitch Blur, 42 Diffusion,
57 Diffusion Speed, 21 Hop, 1 Spread, 46 Mono Bass, 55 Phase Smooth, 41 Amplitude Smooth, 48 Seed, 40 Mix) and `scripts/test_spectral_blur_browser.mjs`.
