# Spectral Warble

Spectral Warble makes every harmonic of the input wobble in pitch on its own, like an ensemble, a swarm of bees or a worn tape
chorus. The note's centre stays; the inside of the tone moves. Module Browser: Space. Native type 281, `spectral_warble`; shared
engine `native_modules/spectral_blur/spectral_stft_engine.h` (Engine `kWarble`, hop N/8). Plan: `SPECTRAL_WARBLE_FIX_PLAN.md`.

## Controls (limits live in the parameter definition only)

- FFT Size: 512..16384 samples, default 4096 (the processing delay).
- Depth: cents (0..200, default 25). The RMS pitch deviation of each partial, the same musical amount at every pitch. 0 is dry.
- Rate: Hz (0.05..20, default 4). Average wobble speed. Motion updates once per hop (about 94 times a second at 4096).
- Drunk: x (0..1, default 0.5). 0 = every partial is a regular vibrato at exactly Rate, just out of step with the others;
  1 = a wandering, organic motion with each partial's speed spread over an octave.
- Voices: 1..4, default 3. Independently wobbling copies of every partial.
- Stereo Spread: x (0..1, default 1). 0 = identical channels; 1 = each ear wobbles on its own and the voices fan left to right.
- Mono Bass: Hz (0..1000, default 120). Below it both ears wobble identically and the voices stay centred. 0 = off.
- Seed: the app seed control. Same Seed, input and settings give the same output; a reset reseeds.
- Mix: dry/wet aligned to FFT Size.

Swarm (degrees), Level and Drift are gone. There is no level modulation of any kind.

## How it works

- Each partial (a spectral peak and its lobe, found from the input's power) is moved as a unit by the same number of bins, with
  its phase accumulated hop after hop, so it is a continuous sinusoid at the wobbled pitch. The lobe is moved with four
  neighbours (Catmull-Rom) and its alternating sign pattern is moved with it. The per-hop shift is integrated with the
  trapezoid rule.
- The motion: for each voice and each knot (every 2 bins, so every harmonic gets its own) three unit-variance generators
  (mid, left side, right side). Each is `cos(pi D/2) sqrt(2) sin(phase) + sin(pi D/2) g`, where `g` is seeded noise through two
  cascaded one-poles scaled by the analytic stationary variance. The rate of each generator is `Rate 2^(Drunk r)` with its own
  seeded `r`. Nothing is clamped, so Depth is the RMS pitch deviation at every Drunk.
- A partial uses its own knot (its peak's), never a blend of two: two independent motions blended would cancel part of the wobble.
- Stereo: `w_c = cos(pi S/2) mid + sin(pi S/2) side_c`; the voices sit at pan `S (2v/(L-1) - 1)` with constant-power gains; Mono
  Bass ramps S from 0 to full over one octave. No crossfeed: left is built from the left input only.
- Level: each frame is matched to its source power per channel, then the synthesis-window pass is matched. No makeup gain.

## Known limits (measured, not hidden)

- A partial that sweeps hundreds of cents several times per window is no longer a steady grain, so the overlap-add loses level:
  about 1 dB at Depth 25 / Rate 4 on an 880 Hz saw, up to about 6 dB at Depth 200 / Rate 20 (reported by test T9).
- Detuning a saw's harmonics randomises their phase alignment: at the same RMS the peak rises by up to about 5 dB. That is the
  sound, not a gain.
- At FFT 8192 and above a 4 Hz wobble is faster than the window, so the output shows an envelope ripple; use 4096 or less
  for fast Rates.
- With identical voices (Depth 0) and Stereo Spread above 0 the fan gains differ between the bass and the rest, which is a very small
  stereo tilt (about -70 dB on broadband input).
- Cost is about 2.4x Cloud's at 16384 with 4 voices and stereo (JS harness: about 290 ms per audio second).

## Display and preset

Styles: Waterfall (default for now; Argi will pick after trying them), Overlay and Particles.
`patches/demo_patches/spectral_warble.json`: Depth 25, Rate 4, Drunk 0.5, Voices 3, Spread 1, Mono Bass 120, Seed 1, FFT 4096.

## Verification

`node scripts/test_spectral_warble.mjs` (T1 dry, T2 Depth in cents at 220 and 1760 Hz, T3 Rate, T4 Drunk, T5 independent partials,
T6 glide not buzz, T7 centre, T8 voices, T9 level, T10 stereo, T11 determinism, T12 in place, T13 cost, T14 robustness, T16 guard
lint and matching defaults), `scripts/test_spectral_blur_graph.mjs` (slots 22 FFT, 13 Depth, 57 Rate, 47 Drunk, 32 Voices, 1 Spread,
10 Mono Bass, 48 Seed, 40 Mix) and `scripts/test_spectral_blur_browser.mjs`.
