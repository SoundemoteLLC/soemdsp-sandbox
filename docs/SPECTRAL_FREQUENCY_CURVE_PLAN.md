# Spectral Frequency Curve Plan

| Field | Value |
|-------|-------|
| **Date** | 2026-11-25 |
| **Status** | Implemented 2026-11-25 (steps 1-6, 8-10; step 7 scope Spectrum mode stays for display Phase 3). Open questions taken as: label Curve, default 1, Spectrum Circle gets Min / Max Freq and Curve as module parameters. |
| **Related** | `docs/SPECTRAL_DISPLAY_UPGRADE_PLAN.md`, `docs/SPECTRUM_1D.md` |

Goal: every spectral display uses **one** frequency axis. **Frequency Curve** is
a module parameter from 0 to 1: 0 = linear Hz, 1 = log Hz, blended in between.
It sits on the face beside the Freq band, its limits live only in the parameter
definition, and every display maps it through the same helper.

## 1. Today: five different ways of doing it

| Display | Where the curve lives | How Hz is mapped | Notes |
|---------|-----------------------|------------------|-------|
| **Spectrogram** | Display Settings `frequencyCurve` (0..1), plus the older `freqScale` (Linear / Mel / Bark) | GL shader `hzForU` in `spectrogram-gl.js`: `scale` codes 0 Linear, 1 Mel, 2 Bark, 3 log, 4..5 = 4 + curve | Curve is frozen per ink column ("new settings apply to new ink only"), so turning it does not remap history. |
| **Circular Spectrogram** | Display Settings `frequencyCurve` | Same shader, same per-ink freeze | Same issue. |
| **1D Spectrum** | Display Settings `frequencyCurve` | `nodeGraphFrequencyCurveHz` (JS) in `spectrogram-display.js` | Already the target math; immediate remap. |
| **Spectrum Circle** (`videoFeedback`) | Display Settings `spectrumAxis` choice: Log / Linear / Mel / Bark | `nodeGraphVideoFeedbackSlotHz` → own log branch or `spectrogramRowTToHz` | Choice list, not a continuous curve. Min/Max Freq are Display Settings, not face params. |
| **Scope Spectrum mode** | none | Linear max-pool to 160 bars | No axis at all. |

## 2. Target

- **Parameter** (same on every spectral module):

  | Key | Label | Default | Min / mid / max | Step | Unit |
  |-----|-------|---------|-----------------|------|------|
  | `frequencyCurve` | Curve | 1 | 0 / 0.5 / 1 | any | none (0 = linear, 1 = log) |

  Docked tip: "Frequency spacing: 0 = linear Hz, 1 = logarithmic. Higher gives
  bass more room, lower gives treble more room."
- **Face:** a Curve cell next to the Freq band (`{ kind: "cells", params: [["frequencyCurve", "Curve"]] }`),
  phone-friendly, on Spectrogram, Circular Spectrogram, 1D Spectrum and Spectrum Circle.
- **One mapping:** `nodeGraphFrequencyCurveHz(t, curve, lo, hi)` moves into the
  shared core `public/lib/spectral-analysis.js` (loaded on the page and in the
  worklet). The GL shader keeps one GLSL twin of the same formula (the existing
  `scale >= 3.5` branch), fed by a `uFrequencyCurve` uniform.
- **Immediate:** turning Curve remaps the whole picture at once, including
  spectrogram history. The ring already stores raw bin magnitudes per column and
  the shader maps Hz per pixel at draw time, so the curve becomes a live uniform
  instead of a per-ink frozen value.
- **Removed:** Mel / Bark (`freqScale`, `spectrumAxis`), the Display Settings
  `frequencyCurve` field, the legacy `scale` codes 0..3 in the shader, and the
  Spectrum Circle's own axis branch. Old patches are not migrated (standing rule).

## 3. Steps

1. **Shared helper.** Move `nodeGraphFrequencyCurveHz` into
   `public/lib/spectral-analysis.js`; delete it from `spectrogram-display.js`;
   delete `spectrogramRowTToHz`'s Mel/Bark branches and `spectrogramHzToMel` /
   Bark helpers if nothing else uses them.
2. **Definitions.** Add the `frequencyCurve` parameter and the Curve face cell to
   `spectrogram`, `circularSpectrogram`, `spectrum1d` and `videoFeedback`
   (register file). Spectrum Circle also gets `minFreq` / `maxFreq` as face params
   (Freq band) so all four share the same view controls.
3. **Display Settings.** Remove `frequencyCurve`, `freqScale`, `spectrumAxis`
   from the schemas, registries, field/choice meta, normalizers and defaults
   (`node-graph-module-scope-trace-controls.js`, `-normalize.js`,
   `-defaults.js`, `video-feedback-display.js`).
4. **Spectrogram / Circular Spectrogram GL.** Replace the per-ink `scale` code
   with a `uFrequencyCurve` uniform read from the node param every frame; drop
   `paintFreqScale` and the Mel/Bark/log codes in `hzForU`. Keep the ring's
   stored magnitudes. Check the Canvas and Mini Canvas still share one ring.
5. **1D Spectrum.** Read `node.params.frequencyCurve` instead of the display
   setting (column map cache key already includes the axis).
6. **Spectrum Circle.** `nodeGraphVideoFeedbackSlotHz` becomes
   `nodeGraphFrequencyCurveHz(u, params.frequencyCurve, minFreq, maxFreq)`.
7. **Scope Spectrum mode.** Out of scope here: it has no module parameters. It
   is retired or pointed at the shared core in Phase 3 of the display upgrade.
8. **Worklet injection.** `nodeGraphInjectSpectrogramWorkletParams` stops
   sending `freqScale`; the worklet never needed the curve (display only).
9. **Tests.** Extend `scripts/test_spectrum1d.mjs` (curve from the param;
   0 / 0.5 / 1 place a sine at the expected x), add a shader-vs-JS check that the
   GLSL `hzForU` matches `nodeGraphFrequencyCurveHz` at many points, and update
   `scripts/test_spectrum_circle.mjs` for the removed `spectrumAxis`. Browser
   smoke: each of the four modules spawns with Curve 1, turning it remaps
   immediately, no console errors.
10. **Docs.** `SPECTRUM_1D.md`, `CIRCULAR_SPECTROGRAM.md`, `SPECTRUM_CIRCLE.md`:
    one paragraph each pointing at the shared Curve.

Cache-bust tags in `index.html` / `perform.html` are appended, never replaced.
Only the files above; other agents' dirty hunks stay out of the commit.

## 4. Open questions

1. Label: **Curve** (short, phone-friendly) or **Freq Curve**?
2. Default 1 (log) on all four? (Today's default everywhere is 1.)
3. Spectrum Circle: move Min / Max Freq onto its face as a Freq band (recommended,
   so all four match), or keep them in Display Settings?
