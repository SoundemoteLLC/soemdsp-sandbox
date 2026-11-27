# Spectral Cloud / Warble / Smear: remove all automatic leveling

Date: 2026-11-27. Owner decision (Argi): no compressor-like behavior anywhere in these modules. Overs past 0 dBFS are acceptable for this release. The user sets level by hand with a new Output Gain knob.

## Why

Argi's listening test: the three modules sound good except for an aggressive "compressor" feel. The cause is signal-dependent gain riding inside the shared engine, `native_modules/spectral_blur/spectral_stft_engine.h`:

1. **Per-frame power match (Cloud and Warble, the `moved` path).** Every frame measures `sourcePower` and `accPower` and multiplies the frame by `normal = sqrt(sourcePower / accPower)`. Any beating or partial cancellation between voices is filled back up on the same frame. This is an instant-attack, instant-release leveler.
2. **Per-frame synthesis-window match (all three engines).** `frameGain = olaGain * sqrt((srcWindowed / srcEnergy) / (synWindowed / synEnergy))` changes every frame with the signal. That's another leveler.
3. **Smear's per-bin makeup (`bandGain`).** It depends on `liveWeight` (and on `diffusionHere`, which uses `liveWeight`). That weight is computed per bin per frame from the signal, so the makeup rides the signal and lifts smeared tails against live hits.

## What to delete (no shims, no flags, no "off" mode)

- **Item 1:** delete the `sourcePower` / `accPower` / `normal` computation and its multiply. Write `accRe` / `accIm` straight out (times Cloud's static `bandMakeup`, see below).
- **Item 2:** delete `srcEnergy`, `srcWindowed`, `synEnergy` and `synWindowed`, along with the loops that compute them. `frameGain` becomes the constant `olaGain` (which only depends on overlap). Delete the variable entirely if it's then just `olaGain`.
- **Item 3:** delete Smear's whole `bandGain` block: the `smearCorr` / `smearVar` / `smearDenominator` model, the `coherent1` term, `kSmearMakeupPower`, and the `pow_pos` call. `magnitude = magnitudeState[c][k]`. Delete any setup code and arrays that existed only to feed this, such as `smearCorr`, `smearVar` and `smearDenominator`, if nothing else reads them.
- **Keep, do not touch: Smear's Amplitude Smooth (amplitudeSmoothMs, the per-bin magnitudeState one-pole).** Argi loves that per-bin amplitude slowness effect. It is a user-controlled sound effect, not auto-leveling, and it stays exactly as it sounds now.
- **Keep:** the constant OLA window gain (`olaGain`), the `edge` (DC/Nyquist) handling, and the NaN and divide-by-zero guards that are still needed.
- **Cloud's `bandMakeup[k]`:** it is computed only from parameters (the walk step), not from the signal, so it's a fixed per-bin gain and not a compressor. Keep it for now unless it turns out to depend on the signal. If it does, delete it too.
- **Update stale text:** remove the comments that explain the deleted code, and correct any parameter tooltips or docs (in `docs/` and `SPECTRAL_*_FIX_PLAN.md`) that promise level matching.

## Output Gain on every module

None of the three has an output level control today. Their parameters are:

- Cloud (`spectral_blur`): fftSize, fuzz, grain, stereoSpread, monoBassHz, voices, seed, mix
- Warble (`spectral_warble`): fftSize, depth, rate, drunk, voices, stereoSpread, monoBassHz, seed, mix
- Smear (`spectral_smear`): fftSize, smearSeconds, blurHz, blurCents, diffusion, diffusionSpeedHz, hopMode, stereoSpread, monoBassHz, phaseSmoothMs, amplitudeSmoothMs, seed, mix

Add the same parameter to all three:

- key `outputGain`, label "Output Gain", unit dB, default 0, min -60, mid 0, max +24, step any. Limits come from the parameter definition only, never hard-coded in the DSP.
- Apply it as one multiply on the final output, after Mix. It affects dry and wet together, so the knob means the module's output level. If the Mix code already scales wet and dry separately, apply it after they are summed.
- Smooth gain changes the way the module's other gain-like params are smoothed (no zipper noise). No clip, no limiter, no soft-saturation at any value.
- The tooltip goes in the docked tips panel and needs a real description: "Final output level in dB, after Mix. No automatic leveling, limiter or clipping; overs past 0 dB are possible."
- The module face: fit Output Gain within the face-row rules (at most 4 controls per row, phone friendly). Pairing it with Mix on one row is the natural choice.
- Make the param modulatable like other params (it gets a param input jack if the module's other params have one).
- Older patches without `outputGain` load at 0 dB.

## Tests

- Update or remove test assertions that require level matching. In `scripts/test_spectral_blur.mjs`, `test_spectral_warble.mjs` and `test_spectral_smear.mjs`, delete the checks that only verified the deleted makeups (for example, "the makeup never boosts", Phase Smooth makeup sweep, "fan widens without a loudness change"). Don't loosen tolerances to keep them passing.
- **New test: no signal-dependent gain.** Feed a steady sine, then the same sine 20 dB quieter, through each module at fixed settings. The output RMS must drop by 20 dB ± 0.1 dB. A leveler would shrink the difference.
- **New test: beating isn't flattened.** On Warble or Cloud with two or more voices, the per-frame output RMS of a steady tone must vary (a non-zero spread). Before this change it was pinned by `normal`.
- **New test: Output Gain.** At +6 dB the output is 2.0x within 0.01. At -60 dB the output is 0.001x. Nothing clips above 1.0, and a value over 1.0 passes through as is.
- Keep: the T16 raised-max test, the Time Smear length test (40 s ≈ 39.8 s), the browser test (no page script errors), and the hop crossfade test.
- Report the new peak levels per module with default settings (saw and pink noise), so Argi knows how hot each one runs. Report them only; don't fix them.

## Out of scope

- Any replacement leveler, slow average match, or auto makeup. Argi sets the level by hand.
- Warble's documented 6 dB loss at extremes stays as it is.

## Git and repo rules

- Work in the repo directly. Commit only your own hunks, preserve LF line endings, merge `origin/master` (no rebase), and push only after Argi says yes.
- Rebuild the `.wasm` for all three modules, and bump the `?v=` tags in `index.html` and `perform.html` for every changed script without replacing another agent's tag.
- Never kill or restart Argi's servers. Use your own test port.
- Before editing a shared area, check `docs/KNOWN_BUGS.md` and mark anything this fixes.
