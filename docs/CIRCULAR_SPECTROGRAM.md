# Circular Spectrogram

Circular Spectrogram shares FFT analysis, gradients, and the raw spectrum ring
with Spectrogram. It has its own polar presentation and sweep retention.

## Sweep Modes

- Fixed Head scrolls one revolution of history and its older afterglow past a fixed head.
- Moving Head keeps the latest revolution stationary while the write head sweeps.
  The current revolution and older afterglow occupy separate GPU textures.
- Spin is sweeps per second. With Mirror enabled, both halves sweep together.
  Without Mirror, one sweep is a full turn.
- Spin at 0 holds the head and both image layers. Global visual pause also holds them.
- Sweep speed follows elapsed audio-clock time, not FFT packet counts. Incoming
  batches supply spectral content; between batches the latest spectrum is held.
  Frame stalls therefore skip ahead to the correct angle rather than changing
  the effective Spin rate. Plugin views use the host sample counter.

## Frequency Curve

Curve is a module parameter (face cell beside the Freq band), the same on
Spectrogram, Circular Spectrogram, 1D Spectrum and Spectrum Circle: 0 is linear
Hz, 1 is logarithmic (default), with a continuous blend between them. All four
map through one helper, `nodeGraphFrequencyCurveHz` in
`public/lib/spectral-analysis.js` (the spectrogram shader has the same formula
as `hzForCurve`). Curve is a live shader uniform, so turning it remaps the whole
history at once. It works with Reverse Frequency. Mel / Bark are gone.

## Sweep Retention (Both Head Modes)

- Afterglow: older-sweep intensity beneath the current sweep, from 0 to 1;
  default 0.2. Zero shows only the current revolution.
- Hang (turns): revolutions for older ink to fade to 1% of its deposited energy;
  default 1. Zero disables older ink. The UI range is 0 to 30 turns.
- Sweep fade: fraction of the current revolution that eases toward afterglow
  intensity before the head returns. Default 0 keeps the original hard boundary;
  0.2 softens the final fifth; 1 fades across the whole turn.
  On revisiting an angle, its previous spectrum retires into afterglow and its
  latest spectrum becomes the current sweep, including silence.
- Older ink decays by angular travel, not elapsed seconds. Equal angular travel
  gives equal fading at different Spin speeds. Layers combine without additive
  brightness buildup, preserving the current sweep's legibility.

Ghost, Trail, Burn, and Decay blur are not this renderer's retention controls.
Those remain unchanged for Trace and Phosphor displays.

All rendering and compositing are WebGL shader passes on the shared device.
The raw spectrum ring remains bounded; CPU code handles sample transport and
sweep bookkeeping only. Explicit wipes/deletion release the GPU layers.
