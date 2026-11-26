# Spectral Warble

Spectral Warble wobbles the phase of every partial: a fuzzy buzz that stays in place in time (no smear). Module Browser:
Space. Native type 281, `spectral_warble`; shared engine `native_modules/spectral_blur/spectral_stft_engine.h`.

## Controls

- FFT Size: 512..16384 samples, default 4096.
- Swarm: degrees (0..180, default 0). Peak phase wobble of each partial; 0 is the dry signal at the window delay.
- Rate: Hz (0..1000, default 5). How fast the wobble moves. Updates at the STFT hop rate (about 47 Hz at 4096 and 48 kHz),
  so it is not audio-rate modulation. Mean-reverting noise per bin: the depth is the same at every Rate, only the speed
  changes, and it always comes back to 0 (it never integrates like Diffusion).
- Seed: same Seed, input and settings give the same sound; a reset reseeds cleanly.
- Mix: dry/wet aligned to FFT Size.
- Level (a per-partial dB wobble) and Drift (a Hz pitch wander) were removed: Level was a loudness boost that could clip, and
  Drift is what Spectral Blur does properly in cents.

Each frame's synthesis-window pass is matched to the source frame's, so the wobble keeps the loudness.

## Display and preset

Styles: Particles (default), Overlay and Waterfall. `patches/demo_patches/spectral_warble.json`: Swarm 120 degrees, Rate 5 Hz, Seed 1, FFT 4096.

## Verification

`node scripts/test_spectral_warble.mjs`, `scripts/test_spectral_blur_graph.mjs` (slots 22 FFT, 13 Swarm, 57 Rate, 48 Seed, 40 Mix),
`scripts/test_spectral_blur_browser.mjs`.
