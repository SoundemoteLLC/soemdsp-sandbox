## HP-09e: Mutator lane offsets bypass the target param's smoother (split out of HP-09d item 9)
**Owner:** big AI · **Size:** L · **Depends on:** HP-09d (`ae1e2e50`, local, unpushed) · **Phase:** A · **Related:** HP-11 (native offsets), HP-03 (gradients stay out of scope)
**Paste-ready path:** `docs/handoffs/ready/HP-09e.md`
**Queued after HP-09d passes**, then HP-09b, HP-03, HP-18.

**Why (Argi, t437u, verbatim).** "mutator should not go through the parameter's smoother, and instead the playhead parameter's smoother has a smoother, we can use that for the source of truth of current value, so the changes actually move in sync with the playhead final value after smoothing".

**Evidence (Argi, t441u, verbatim, during the HP-09d retest).** "i have the playhead pitch mutator parameter on ❌ for no smoothing and im still hearing smoothing. ok if i turn off cutoff smoothing then i don't hear smoothing". This confirms the bug: with playhead smoothing off, the bound Cutoff still glides because the Mutator offset is going through Cutoff's own smoother.

**Goal.** The bound target (e.g. Flower Child Cutoff) moves in sync with the playhead's **smoothed** value, with no extra lag from the target's own smoother, in both the JS worklet path and the native path. The target's smoother keeps chasing the **base** value only. The lane offset is evaluated every block (or sample) from the smoothed `playheadHz` and added **after** the target's smoother.

## What HP-09d found (file areas, re-check line numbers)
- `public/node-graph-param-offsets.js`: `applyNodeGraphParamOffsets` bakes every provider (gradients order 0, Pitch Mutator order 20) into a copy of `node.params`. `nodeGraphEffectiveNodeParams` is what `public/plugin-host.js` diffs and posts to the native engine, so the target's native `Control` chases an **already-offset** value (second lag).
- `public/node-graph-live-plan-runtime.js` (~191, ~333): the baked params become the smoother targets (`createNodeGraphParameterSmoother` / `updateNodeGraphParameterSmoother`, default 0.0333 s).
- **Suspected double offset, unverified:** `readNodeGraphLiveEffectiveParam` (`public/node-graph-live-parameter-runtime.js` ~211) reads the smoothed value, whose target was already baked with the Mutator offset, then calls `applyNodeGraphParamOffsetsToBase` again. Check whether the main-thread path is reachable; if so the offset is counted twice there.
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
- The double-offset question is answered in the report (and fixed if real).
- Report in the standard format; MasterBot review, then Argi retest on his patch.
