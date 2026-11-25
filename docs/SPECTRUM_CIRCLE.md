# Spectrum Circle

The saved module type remains `videoFeedback`; renderer/settings schema is
`videoFeedbackFace`. All rays, antialiasing, gradient lookup and retained-ink
rotation are GLSL on the existing shared picture device. No JS drawing fallback.

## Rotation

Rotate (saved key `twist`) is a wrapping phase parameter. The -1..+1 range covers one full turn:
0.5 is 90 degrees; -1 and +1 are the same orientation. Spin input adds using
the same scale. Retained ink rotates by the change in orientation, not by a
separate frame-dependent Twist velocity. Crossing the wrap seam does not clear
the plate or reverse an unrelated trail-spin effect.

## Frequency

Min Freq, Max Freq and Curve are module parameters (default 30 Hz, 16 kHz,
Curve 1). Curve is the same 0 = linear Hz … 1 = log Hz axis as Spectrogram,
Circular Spectrogram and 1D Spectrum (`nodeGraphFrequencyCurveHz`); the old
Freq axis choice (Log / Linear / Mel / Bark) and the Display Settings Min / Max
freq fields are gone.

## Settings

- Inner sets where rays start, as a fraction of Size. Their magnitude fills
  the remaining distance from Inner to Size, preserving short rays instead
  of cutting them away. Radius coloring also spans Inner to Size.
  The saved parameter key remains `zoom`. The mask-only Cutout Curve was removed.

- Reverse freq: reverses the frequency order. In symmetric mode, lows start
  at the top and highs travel down before Rotate is applied. Default Off.

- Ray width: continuous fraction of an angular band slot, 0..1. Zero hides
  discrete rays, one fills the slot. Continuous Bands does not use this value.
- dB floor: continuous dBFS, -180..-0.1. Fractional entries are preserved.
  This change is local to Spectrum Circle; other spectrum controls are untouched.
- Bands: integer-density presets or Continuous. These are visual choices, not
  a power-of-two GPU or FFT requirement. Mirrored mode uses the selected count
  on each half; full-ring mode uses it once around the circle.
- Symmetric: On keeps the previous mirrored low-bottom/high-top mapping.
  Off runs the spectrum once around the full circle, low frequencies starting
  at the bottom before Twist.
- Color by level and Color by radius are independent On/Off switches.
  Level selects the gradient coordinate from band magnitude. Radius selects it
  from distance between Inner and Size. Both On multiply these coordinates;
  both Off use the final gradient color.

Old Level/Radius color settings migrate to the corresponding toggle. New
settings persist in the existing `traceDisplaySettings` object; unrelated
settings schemas and module spawn dimensions do not change.

## Verification

`scripts/test_spectrum_circle.mjs` exercises the real settings form and patch
round trip, switch persistence, fractional fields and legacy color migration.
GPU pixel checks verify nonblank rays, all four color combinations, mirror versus
full-ring mapping, 90-degree rotation, identical wrap endpoints, zero width and
retained-ink continuity across the seam.
