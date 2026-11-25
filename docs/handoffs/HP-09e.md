## HP-09e: Mutator lane offsets bypass the target param's smoother (split out of HP-09d item 9)
**Owner:** big AI · **Size:** L · **Depends on:** HP-09d (`ae1e2e50`, pushed at `c2fd0f39`; done) · **Phase:** A · **Related:** HP-11 (native offsets), HP-03 (gradients stay out of scope)
**Paste-ready path:** `docs/handoffs/ready/HP-09e.md`
**Addendum (paste into the running session):** `docs/handoffs/ready/HP-09e-addendum.md`
**Queued with the AI now.** After this: HP-18, then HP-09b, then HP-03 (Argi t444u moved HP-18 up).

**Why (Argi, t437u, verbatim).** "mutator should not go through the parameter's smoother, and instead the playhead parameter's smoother has a smoother, we can use that for the source of truth of current value, so the changes actually move in sync with the playhead final value after smoothing".

**Evidence (Argi, t441u, verbatim, during the HP-09d retest).** "i have the playhead pitch mutator parameter on ❌ for no smoothing and im still hearing smoothing. ok if i turn off cutoff smoothing then i don't hear smoothing". This confirms the bug: with playhead smoothing off, the bound Cutoff still glides because the Mutator offset is going through Cutoff's own smoother.

**Goal.** The bound target (e.g. Flower Child Cutoff) moves in sync with the playhead's **smoothed** value, with no extra lag from the target's own smoother, in both the JS worklet path and the native path. The target's smoother keeps chasing the **base** value only. The lane offset is evaluated every block (or sample) from the smoothed `playheadHz` and added **after** the target's smoother.

## What HP-09d found (file areas, re-check line numbers)
- `public/node-graph-param-offsets.js`: `applyNodeGraphParamOffsets` bakes every provider (gradients order 0, Pitch Mutator order 20) into a copy of `node.params`. `nodeGraphEffectiveNodeParams` is what `public/plugin-host.js` diffs and posts to the native engine, so the target's native `Control` chases an **already-offset** value (second lag).
- `public/node-graph-live-plan-runtime.js` (~191, ~333): the baked params become the smoother targets (`createNodeGraphParameterSmoother` / `updateNodeGraphParameterSmoother`, default 0.0333 s).
- **Double offset is real** (`readNodeGraphLiveEffectiveParam`, `public/node-graph-live-parameter-runtime.js` 211-212): offsets are applied to a smoother output that was already baked. Headless check: base 0.5 with offset +0.2 reads 0.9. Hits main-thread live evaluators (`bugButton`, `keypad`, `phoneTone`, `noiseDetector`, `pitchManager`, `additiveGraph`). Worklet audio (`public/node-live-audio-worklet-smoother.js` 455-456) and native apply it once. See the addendum.
- The Mutator's `applyLiveParams` writes the **unsmoothed** incoming Hz into `params.playheadHz`, then the `playheadHz` smoother chases it. Native: `public/node-live-audio-worklet-native-graph.js` ~8231 pushes it; `process_pitch_mutator` in `native_modules/graph_engine/graph_engine.cpp` (~7318) uses live Freq In samples when wired, else `control_audio(node.frequency)` (the smoothed playhead).
- Native smoothing: `struct Control`, `control_set_target`, `smoother_run`, `control_effective` (MOD applies after `out`), `soemdsp_graph_set_param`, all in `graph_engine.cpp`.

## Do this
1. Split the Pitch Mutator out of the baked `applyParams` smoother-target path (gradients unchanged). Targets chase base only.
2. JS worklet: evaluate the lane from the playhead smoother's output (last value / `outputBuffer`) each block and add the offset after the target's smoother.
3. Native: bake the knob lane into a LUT per Mutator (like `_mutatorFreqLut`), evaluate it from the Control `out` of `playheadHz` (or the live Freq In sample when wired) and add it after the target Control's `out`. Do not post already-offset values as the target. Do not use MOD cables.
4. **Architect gate.** Keep the change in `graph_engine.cpp`. If it touches `library/include/soemdsp`, stop and propose first (APP_POLICY §19).
5. Knob-lane keys stay signed slider offsets (HP-09d); effective value clamps to the param definition only.

## Acceptance
- **Playhead ❌, Cutoff smoothing on (Argi t441u).** Setup: the playhead smoothing is off (❌) and Cutoff has its own smoothing on. Expected: the bound Cutoff steps instantly with the note, with no glide, in both the JS worklet path and the native path. Also: with playhead smoothing on, the glide matches the playhead's smoothing time, not Cutoff's. Cover in a unit or worklet test and, if practical, the browser test, for JS and native.
- With a long playhead / Freq In glide, the target tracks the lane value at the **smoothed** playhead, with no lag from its own smoother, even when the target has a long `smoothingSeconds`. Cover in a unit or worklet test and, if practical, the browser test, for JS and native.
- Stored base value never changes; saved patches unchanged.
- Existing `scripts/test_pitch_mutator_engine.mjs`, `test_param_offset_providers.mjs`, `test_pitch_mutator_knob_lane_browser.mjs` still pass.
- The confirmed double offset (base 0.5 + 0.2 reading 0.9 on the main-thread path) is fixed, without dropping worklet/native offsets and without breaking HP-02 gradients. See the addendum.
- 09d leftovers: `activeLane` is the knob lane on reopen; no double period on `FREQ_NOT_PINNABLE`; the "audition key alone" Frequency check is deterministic (asserted before the cable); clicking 🧬 again closes the overlay.
- Report in the standard format; MasterBot review, then Argi retest on his patch.

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
