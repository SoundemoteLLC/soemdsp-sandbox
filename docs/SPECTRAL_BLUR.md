# Spectral Blur

Spectral Blur turns a saw into a lush, fuzzy chorus cloud without oscillators: every partial is detuned by four slowly
wandering voices of one analysis. Module Browser: Space. Native type 272, `spectral_blur`; engine
`native_modules/spectral_blur/spectral_stft_engine.h` (shared with Spectral Warble and Spectral Smear, see
[SPECTRAL_SMEAR.md](SPECTRAL_SMEAR.md) for the time/frequency smear and [SPECTRAL_WARBLE.md](SPECTRAL_WARBLE.md) for the phase wobble).

## Controls

- FFT Size: 512..16384 samples, default 4096 (the processing delay; 4096 resolves 50 cents on low notes, 2048 is tighter).
- Fuzz: cents (0..200, default 50). How far each voice detunes every partial at its peak, the same musical interval at
  every pitch. 0 is dry.
- Wander: Hz (0..20, default 0.5). How fast each partial's detune wanders. A fraction of a Hz is a slow, lush beat; a few
  Hz makes the detune itself shimmer; high values are fuzz and eventually metallic FM.
- Seed: seeds the four voices (Seed + voice). Same Seed, input and settings give the same sound.
- Mix: dry/wet aligned to FFT Size. No Amplitude/Level control: the output level is kept by the engine, not boosted.
- Voices are fixed at 4. There is no smear, blur, diffusion or level wobble in this module (Level was removed: a per-partial dB
  wobble is a loudness boost that could clip).

## How it works

Cloud turns a saw into a lush, fuzzy chorus without oscillators: every partial is detuned by several slowly wandering
voices of one analysis. All values are real units (APP_POLICY 25).

- Fuzz (cents, 0..200): how far a voice detunes a partial, at its peak. 0 is dry. The same musical interval at every pitch.
- Wander (Hz, default 0.5, 0..20): how fast each partial's detune moves. A fraction of a Hz is a slow lush beat; a few
  Hz makes the detune itself shimmer; high values are fuzz and eventually metallic FM (a partial that wanders 200 cents
  at 5 Hz is a very wide FM). Cloud only (Rate is Warble's speed).
- Voices (2..4, default 3): independent detune streams, averaged (1/L each).
- Level (dB): a slow level wander per voice at the Wander rate. 0 = none. Seed: seeds each voice (Seed + voice).
- Swarm (degrees), Rate, Drift are Warble-only (Swarm would mix degrees into cents, which APP_POLICY 25 forbids).

How it works (and why the first version sounded ugly):

- The detune is a smooth mean-reverting random state per voice at knots every 8 bins, and every bin takes the state
  of the local spectral peak it belongs to (strongest bin within 3 bins, from the previous hop), so a whole partial
  lobe is moved by the same number of bins. Before, a constant-cents shift was a different number of bins for every
  bin of a lobe, so lobes slid out of phase and fell apart.
- The extra phase is ACCUMULATED hop after hop (2 pi delta hop / N per hop), so a detuned partial is a continuous
  sinusoid. Before, a white per-hop jump (about 94 Hz at 4096) put a buzz at the hop rate on everything, which was the metallic sound.
- The lobe is moved with four neighbours (Catmull-Rom) and its (-1)^bin sign pattern is moved with it (the window is
  centred, so adjacent bins of a lobe alternate in sign; interpolating raw bins cancelled the lobe).
- Each frame is power-matched to its source and the synthesis-window pass of the moved grain is matched to the
  source frame's, so Fuzz does not change the loudness. Measured with sines: about 0 to -0.5 dB at 50 cents with the
  default Wander, about -1 dB at 2 Hz, about -3 dB at 200 cents (a very wide, fast detune is not a coherent partial any more).
- Old patches and bit-identical Warble were deliberately not preserved for Cloud (Argi: build it the best way for the sound).


## Display

Styles: Particles (default), Overlay and Waterfall.

## Preset

`patches/demo_patches/spectral_blur.json`: keyboard -> pulse train -> Spectral Blur -> Output. Fuzz 50 cents, Wander 0.5 Hz,
Seed 1, Mix 1, FFT 4096.

## Verification

`node scripts/test_spectral_blur.mjs` (dry at Fuzz 0, same width in cents at 500 Hz and 2 kHz, in place, level kept,
deterministic, Seed, linked stereo, FFT switches, finite under rapid edits, CPU independent of pitch),
`scripts/test_spectral_blur_graph.mjs` (slots 22 FFT, 30 Fuzz, 46 Wander, 48 Seed, 40 Mix) and
`scripts/test_spectral_blur_browser.mjs`. Listening acceptance is Argi's.
