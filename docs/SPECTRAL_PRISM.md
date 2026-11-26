# Spectral Prism

Seeded spectral stereo placement. The listening prototype now uses Centre,
Spread, Fold and Amp instead of the old side-boosting Width control.

## Try It

Connect a mono synth or music source to **Mono**, then wire **Left** and
**Right** separately to Output. Mono is the actual fold-down, which becomes
quieter as energy moves from mid to side; it is no longer an unchanged dry mid.

- Start with Centre 0 dB, Spread 1, Fold 0, Amp 1, Smooth 300 cents, Phase 0.25.
- Centre attenuates the rotated mid after side generation, without boosting side.
- Spread rotates mid/side with per-bin energy normalization, including stereo
  input. Sweep 0 through 40: the old large side-amplitude boost is gone.
- Fold triangle-folds the seeded pattern, not the audio waveform. Try 0, 1,
  3 and 6. It adds alternating spectral structure independently of Spread.
- Amp is the final multiplier after Mix; zero silences wet and dry alike.
- Tilt spawns at zero. Spread's spawn maximum is 40; Shimmer Speed spans
  -50 to +50 Hz. These are editable parameter ranges, not DSP clamps.
- Phase 0 gives coherent left/right placement. Phase 1 rotates generated side
  into quadrature: more diffuse stereo, less hard amplitude panning. It cannot
  change coefficient magnitudes on the display. On stereo input it can also
  change the fold-down. Compare through separate L/R, Mix 1 and Spread near 1.
- Seed uses the same shared code/dice/+/- row as Flower Child Filter,
  including its drag, type-in and modifier behaviour. No Prism-specific seed widget.
- Smooth sets the log-frequency correlation length, not audio smoothing.
- Shimmer Speed is signed Hz: positive travels right toward higher
  frequencies, negative left. One Hz moves one Smooth correlation length per
  second. There is no sine reversal or one-cycle wrap; zero freezes position.
- Shimmer Depth blends the fixed seeded field (0) with the travelling field
  (1), without changing its speed. At zero speed, it blends the fixed pattern
  against the frozen position. Bass and tilt envelopes remain stationary.
- Evolve Rate morphs through independently seeded patterns instead of moving
  one pattern across frequency. Quintic transitions join continuously. Rate
  is patterns/second (Hz), initially 1; zero freezes the current evolution.
- Evolve Depth starts at zero (off); one fully replaces the original pattern
  with evolution. Seed makes the sequence deterministic. Evolve combines with
  Shimmer and occurs before Fold. Try Depth 1 and Rate 0.5, 5, 20 or 60 Hz.
  Fast rates deliberately create roughness/sidebands, not hard seed jumps.
  Motion is evaluated per STFT hop; use FFT 512/1024 for faster effects.
- Evolve Transition controls the fraction of each period spent morphing.
  One uses the entire period; 0.25 holds for 75% then morphs over 25%; zero
  makes hard seeded steps. At Rate 5 Hz, Transition 0.25 means a 50 ms morph.
  Rate still determines how often a new pattern arrives. Smooth transitions
  use the same quintic curve; STFT overlap softens even the hard setting.
- Quantize is unitless transition sharpness from 0 to 1. Zero preserves
  continuous travel; one holds then snaps between positions one Smooth
  region apart. Intermediate values shorten each transition while keeping
  that spacing unchanged. Try Depth 1, Speed 2 Hz and sweep Quantize through
  0, 0.5, 0.9 and 1. STFT overlap still softens the audible transitions.
  This does not quantize the input audio's pitch or amplitude.
- Spread 0, Centre 0 dB and Amp 1 give delayed stereo identity.
- Normalization preserves complex-bin stereo power before Centre attenuation;
  it is not a limiter or a perceived-loudness guarantee. Individual channel
  peaks and transient shapes may still change. No hidden audio clipping.

## Latency And Display

Hann STFT, quarter-window hops, sizes 512 through 16384; default 2048.
Dry and wet have the same FFT-size delay. Size changes warm a second engine
and crossfade for 50 ms; requests arriving during that transition queue the
latest size. No host delay compensation is introduced.

The native engine adds separate stereo OLA corrections to latency-aligned
dry L/R. For q from the folded seeded field and the phase rotation phi:

```text
c = 1 / hypot(1, q)
s = q * c
Mout = centre * (c*M - s*exp(-i*phi)*S)
Sout = s*exp(i*phi)*M + c*S
```

At Centre 0 dB the matrix is unitary; attenuation only reduces its mid.

The WebGL face shows the ideal wet coefficients for mono input: signed side
in rainbow colour and Centre in grey, before Mix and Amp. Curve changes
only its frequency spacing. Geometry is seeded in the field's correlation
domain and adaptively subdivides to 0.125 backing-pixel chord error.
This prevents narrow moving peaks from vanishing between screen samples;
the shared WebGL stroke integrates final subpixel coverage. The vertical axis
is linear +/-1, with no display-only compression, folding or auto-normalization.
The coefficients fit because normalization now occurs in the actual DSP.
Display Settings retain only the shared gradient editor. Parameters
reshape the picture while audio is off. Only native shimmer/evolution positions,
size and rate arrive through the display bus; no spectrum arrays are copied.
Both positions are split into two floats in that bus so long sessions
do not lose fractional motion precision.

The visual-only JS curve twin uses the same uint32 hash, log-frequency
breakpoints and quintic interpolation as C++. It never processes audio.
Native type ID is 283; it has its own engine, pool allocation and graph path.

## Verification

Development proofs were run outside the repository, not added as new smoke
or release gates (APP_POLICY section 2).

- Delayed stereo identity at Spread 0 for 512/2048/8192/16384 FFT sizes.
- Stereo-power tests at Spread 1/10/40 and Phase 0/0.25/1, mono and stereo
  inputs: no boost; steady-state ratios about 0.98-1.00 due to WOLA filtering.
- Centre -12 dB scales only mid; side remains unchanged (error below 5e-8).
- Fold changes the pattern, Amp zero silences both wet/dry, native/display
  field parity and normalized coefficient bounds.
- Evolution: native/display field parity through 100 Hz, deterministic audio,
  zero-depth identity, zero-rate freeze, FFT handoff and continuous seed joins.
- Transition 0/0.25/0.5/1: independent hold/morph ratios, native/display parity
  and continuous joins for nonzero transition widths.
- Native graph routing, Centre/Spread/Fold/Amp control slots, Mono/Left/Right/Error
  outputs and pooled lifecycle compared against standalone processing.
- One-second 2048-size development CPU check: same order as Spectral Warp.
- Browser: cold picture, live hop data, signed Shimmer Speed, specialized settings
  and parameter edits while stopped.
- Canonical `node scripts/smoke.mjs`: exact zero difference on 88,200 samples.

Argi's musical listening acceptance remains pending.
