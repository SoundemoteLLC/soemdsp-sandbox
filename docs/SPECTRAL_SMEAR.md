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
- Hop: Normal (overlap 4, hop N/4, default) or Smooth (overlap 8, hop N/8, about twice the CPU). Same delay. Switching warms a second core,
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
- **Level.** No automatic leveling (`docs/SPECTRAL_NO_LEVELING_PLAN.md`): the per-frame synthesis-window match and the per-bin makeup for
  decorrelated frames are deleted. What diffused frames lose in the overlap-add is heard as it is; Amplitude (0..1, a signed gain after Mix) sets
  the output level. The blur kernel still conserves each frame's own power (`blurPower`), and Amplitude Smooth is the same per-bin lag as before.
- Diffusion Speed, Mono Bass, Seed and Hop are new; the radius cap on Frequency Blur is deleted (`boxMean` already handles any width).

## Measured behaviour and known limits (`scripts/test_spectral_smear.mjs`)

- Neutral reconstruction about 4e-8 at 44.1, 48 and 96 kHz in both hops; every FFT size reconstructs at its own delay.
- **Peaks.** Spread energy used to copy its source bin's phase, so a saw blurred without Diffusion became a pulse train (+24 dB over dry). Now the share of a
  bin that is not live input always takes the full phase walk (Diffusion scales only the live share; neutral settings are untouched). Result: a blurred saw
  peaks +2.4 to +6.5 dB (was up to +24), a diffused one +4.3 to +7.3 (was up to +10); on pink noise the peak is now at most 2.0 dB UNDER dry (it was within +2.5 dB with the makeup). Against a SAW
  the plan's 3 dB cannot be met by any wash: noise has a crest factor of about 4.6 and a saw 1.7, so the peak rises by about 8 dB at equal RMS whatever
  the phases. The test therefore reports the pink-noise peak and checks that a washed saw is no peakier than noise (crest <= 5.5, measured 4.9; a pulse train has about 15).
- **Level against dry** (reported by T9, not asserted): over the T9 grid at most -2.4 dB over dry and down to -9.1 dB under (880 Hz saw,
  Diffusion 0.5, Speed 200, Pitch Blur 300, Spread 1, Smooth hop). At the defaults about -7.4 dB RMS on a 110 Hz saw and on pink noise; a 1.0
  sine at 220 Hz peaks at 1.21 (+1.7 dBFS) (`scripts/test_spectral_no_leveling.mjs`).
- Not metallic: at the FFT-bin centres of a 2-6 kHz noise band the worst peak over the floor is 6.2 dB at Speed 30 against 12.5 dB at Speed 2.
- Stereo: Spread 0 is bit-linked; Spread 0.5 and 1 are already decorrelated (the side walk is unbounded); Mono Bass 200 keeps a 100 Hz sine at rho 1.00.
- The plan's Spread 0.5 correlation of 0.3-0.9 and the 3 dB bin-peak bound are not reachable with a random band; the tests say how they were adapted.

## Display and preset

Styles: Particles (default), Overlay, Waterfall. `patches/demo_patches/spectral_smear.json`: the pre-split defaults (Time Smear 2, Frequency Blur 100,
Pitch Blur 0, Diffusion 1, Stereo Spread 1, Phase Smooth 10, Amplitude Smooth 0) with Diffusion Speed 30, Mono Bass 120, Seed 1.

## Verification

`node scripts/test_spectral_smear.mjs`, `scripts/test_spectral_blur_graph.mjs` (slots: 22 FFT, 52 Time Smear, 31 Frequency Blur, 10 Pitch Blur, 42 Diffusion,
57 Diffusion Speed, 21 Hop, 1 Spread, 46 Mono Bass, 55 Phase Smooth, 41 Amplitude Smooth, 48 Seed, 40 Mix) and `scripts/test_spectral_blur_browser.mjs`.
