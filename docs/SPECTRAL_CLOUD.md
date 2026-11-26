# Spectral Cloud

Spectral Cloud (type key `spectralBlur`, native type 272, `spectral_blur`) turns every partial into a soft, diffuse BAND centred on its
pitch: air and fur around each harmonic, the same width in cents at every pitch, with no vibrato, no detune and no chorus. Plan:
`SPECTRAL_CLOUD_FIX_PLAN.md`. Shared engine: `native_modules/spectral_blur/spectral_stft_engine.h` (Engine `kCloud`, hop N/8).
See [SPECTRAL_SMEAR.md](SPECTRAL_SMEAR.md) and [SPECTRAL_WARBLE.md](SPECTRAL_WARBLE.md) for the other two modules.

## Controls (limits live in the parameter definition only)

- FFT Size: 512..16384 samples, default 4096.
- Fuzz: cents (0..1200, default 100). The half-width of the cloud around every partial. 0 is dry (with Grain 0).
- Grain: dB (0..6, default 1). A fast per-bin level flicker that only ever dips bins, normalised to unity mean power, so it never boosts.
- Stereo Spread: x (0..1, default 1). 0 = identical channels; 1 = independent fur in each ear (phase only, no crossfeed).
- Mono Bass: Hz (0..1000, default 0). Below it the cloud is identical in both ears (one-octave ramp). 0 = off.
- Voices: 1..4, default 3. Independent cloud layers.
- Seed: the app seed control. Mix: dry/wet aligned to FFT Size.

Wander is gone (slow wandering is Warble's job). There is no Level.

## How it works

- Every bin of every voice has its own random WALK on its phase: a random-walk phase turns a line into a Lorentzian band centred on the
  original frequency. The step follows Fuzz: half-width `df = k sr / N (2^(Fuzz/1200) - 1)`, step `sqrt(12 pi df H / sr)`; at a step of pi the
  phase is fully random each hop (Paulstretch). Above that, the cents-wide magnitude kernel (`blurPower`, triangular, power-matched) supplies the
  width, so a high harmonic is as wide in cents as a low one.
- Stereo: Left rotates by `walk - a`, Right by `walk + a`, `a = Spread(k) side / 2` with its own unwrapped side walk per voice and bin.
- Level: the frame is matched to its source power; frames whose phases have decorrelated add in power, so each bin is given the statistical
  makeup `1 / sqrt(rho^2 + (1 - rho^2) 0.243)` (rho = sin(step)/step), and the synthesis-window pass is matched. No limiter, no clamp.
- Three RNG streams per voice (walk, side, grain) from Seed + voice: changing Grain or Spread never changes the main walks.

## Measured behaviour (see `scripts/test_spectral_blur.mjs`)

- A band, not lines: flatness 0.95 over +-50 cents of an 880 Hz sine; -10 dB half-width 61 / 105 / 302 cents at Fuzz 50 / 100 / 300.
- Level within 1 dB over the whole plan grid (worst 0.98 dB).
- Peak over dry: up to +7.8 dB on a saw (random phase raises the crest factor); reported, not hidden (the plan allowed +6 dB).
- Cost at 16384, 4 voices, stereo: about 123 ms per audio second in the JS harness (the previous Cloud engine was about 120 ms).
- Deviations from the plan's test thresholds: the phase-coherence test uses non-overlapping frames (at 87.5 % overlap even white noise
  reads 0.98); the centroid test allows 0.35 Fuzz of scatter (a noise band's centroid cannot be steadier through a 43 ms window); the
  Grain peak bound is 0.75 dB (a peak is an extreme statistic).

## Display and preset

Styles: Particles (default), Overlay, Waterfall. `patches/demo_patches/spectral_cloud.json`: Fuzz 100, Grain 1, Spread 1, Mono Bass 0, Voices 3, Seed 1.

## Verification

`node scripts/test_spectral_blur.mjs` (T1-T16), `scripts/test_spectral_blur_graph.mjs` (slots 22 FFT, 30 Fuzz, 51 Grain, 1 Spread, 10 Mono Bass,
32 Voices, 48 Seed, 40 Mix) and `scripts/test_spectral_blur_browser.mjs`.
