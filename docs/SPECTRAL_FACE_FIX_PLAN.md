# Spectral face fixes and STFT renames

Date: 2026-11-27. Follows `docs/SPECTRAL_NO_LEVELING_PLAN.md` (commit `c949db03`). From Argi's listening and Ctrl+F5 test.

## 1. Spectral Smear: Amp does nothing (bug)

- Turning Amp on Spectral Smear doesn't change the sound. Find why and fix it.
- A clue: `native_modules/spectral_smear/spectral_smear.cpp` has no amplitude key in its parameter list (it ends at seed and mix). The knob probably exists only in the JS definition and never reaches the worklet or wasm, or its key doesn't match. Check Cloud and Warble the same way: verify that Amp actually scales their output in the real app path (UI knob → worklet → wasm), not only in the standalone test renderer.
- Add a test that moves the Amp param through the same path the app uses and checks the output scales (Amp 0.5 = −6.02 dB, Amp 0 = silence, negative flips polarity).

## 2. Spectral Smear: Mix and Amp have no slider fill (bug)

- On Smear's face, Mix and Amp show no slider fill, unlike every other slider. Find the cause (likely missing min/max/mid or a wrong param kind in the face's control setup) and fix it at the source. Check Cloud and Warble's Mix and Amp too.

## 3. The Curve knob has no drag handle in the gutter (bug)

- The Curve control at the bottom of the module changes value when dragged, but no drag handle appears in the gutter. Fix it so it shows its handle like every other param.
- Then move it (item 5), so it isn't on the face at all.

## 4. Seed goes at the bottom

- On all the spectral modules that have a Seed param (Cloud, Warble, Smear, and any other Spectral module with one), Seed is the last control on the face and the last in the param list. Keep the face-row rules: at most 4 controls per row, phone friendly.

## 5. Curve moves to Display Settings

- Curve is a display setting, not a sound param. Move it off the module face into that module's Display Settings, on every spectral module that shows it.
- No leftover param, jack or hidden face control. Delete its old face code.

## 5b. Smear: group the Diffusion controls on one row

- Phase Smooth only acts on Diffusion's phase walk, so it belongs with it. Put **Diffusion, Diffusion Speed and Phase Smooth** together on one face row (max 4 per row, phone friendly). Reflow Smear's other rows to fit, with Seed still last.

## 6. Rename STFT Contrast and STFT Gate

- STFT Contrast becomes **Spectral Contrast**, and STFT Gate becomes **Spectral Gate**.
- Argi's rule: no legacy code. Rename the type keys, files, folders and labels outright (for example `stftContrast` → `spectralContrast`, `native_modules/stft_contrast` → `native_modules/spectral_contrast`, and the same for Gate). No aliases, no old-name mapping, no migration shim.
- Don't check or update old patches. Only factory and demo patches in the repo that use these modules get updated so they load.
- Update every label, comment, store entry, search entry, display tap, test and doc that names them. Rebuild their wasm.

## Rules

- Work in the repo directly. Commit only your own hunks and keep each file's line endings. Merge `origin/master` (no rebase), and don't push without Argi's yes.
- Bump the `?v=` tags in `index.html` and `perform.html` for every changed script, and never replace another agent's tag.
- Never kill or restart Argi's servers; use your own test port.
- No tooltips or popups. Param help goes in the docked tips panel. No dead code.
- Check `docs/KNOWN_BUGS.md` and mark anything this fixes.
- Report what caused bugs 1 to 3, plus Argi's Ctrl+F5 checklist.
