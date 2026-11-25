## HP-09e addendum (MasterBot review) — paste into the running session

This is an addendum to `docs/handoffs/ready/HP-09e.md`. Same repo rules. Do not amend earlier commits. Other agents may have uncommitted files in the tree — do not touch them. Line numbers are against current `master` (HP-09d code `ae1e2e50`, now pushed).

### 09d leftovers (now in HP-09e scope)
- **`toggleOverlay` does not re-select the knob lane on reopen** (`public/node-graph-pitch-mutator-overlay.js` 537-545). It only sets `ui.selectedId` if empty, then `renderOverlay()`. Frequency can stay `activeLane` after a close and reopen. On open, if a knob lane exists, default `activeLane` to it (same rule as HP-09d).
- **Double period on `FREQ_NOT_PINNABLE`.** The constant at overlay.js 12 already ends with `.`; `statusText` 266 does `return ui.notice + "."`.
- **Browser test is racy.** `scripts/test_pitch_mutator_knob_lane_browser.mjs` 231-236 ("the audition key alone does not disable Frequency") runs *after* the cable is pushed, and passes only because the chip text is rAF-deferred. Assert the audition-only state *before* the cable, then wait for "driven by Freq In" after the wire. Make it deterministic; do not rely on rAF lag.
- **Add tests:** clicking 🧬 again closes the overlay; `activeLane` is the knob lane after a close and reopen.

### Double offset is real
`readNodeGraphLiveEffectiveParam` (`public/node-graph-live-parameter-runtime.js` 211-212) applies offsets (`applyNodeGraphParamOffsetsToBase`) to a smoother output whose target was already baked with the Mutator offset. Headless check: base 0.5 with offset +0.2 reads 0.9. This hits main-thread live evaluators: `bugButton`, `keypad`, `phoneTone`, `noiseDetector`, `pitchManager`, `additiveGraph`.

Worklet audio (`public/node-live-audio-worklet-smoother.js` 455-456, `readEffectiveParameter`) and the native path apply the offset once (they do not call `applyToBase`).

### Design requirements
1. Un-baking the Mutator from the smoother target fixes the double offset if `applyToBase` stays after a base-chasing smoother. **Do not delete `applyToBase`.**
2. The worklet and native paths do not use `applyToBase` today. Un-baking without a new post-smoother hook would drop offsets from audio. **Add that hook**, and have `plugin-host` send native the **BASE** as the Control target (not the already-offset effective value).
3. Don't break HP-02. Add a post-smoother stage or a provider flag. **Gradients stay pre-smoother.**
4. Today `applyLiveParams` (overlay.js 492) writes unsmoothed `incomingHz` into `params.playheadHz`, and `laneOffsetAt` / `paintBoundKnobs` (297-308) / the chip (`playheadText` 331-334, and any lane-chip lookup that uses `soundingNote`) use the unsmoothed playhead. **Offset evaluation, plus the chip and knob paint, must use the playhead smoother output.** **Pin placement uses the target note (the unsmoothed note).**
5. Clamp the effective value to the param definition only, never to the −1..1 offset range. The stored base and saved patches stay unchanged.

### Already done (do not redo)
MasterBot's item 1 — `docs/handoffs/HP-09e.md`, the INDEX row, and item 9 removed from both HP-09d copies — already landed in `0aa328ef`. HP-09 / HP-09c / HP-09d (including `ae1e2e50`) are pushed at `c2fd0f39`.
