# PASTE-5: HP-11

Do these in order, committing each separately. Skip anything already done (check git log). Where an older plan overlaps a newer one, the newer one wins.
Do S-4 first (B-058: voice parameter modulation misses active and idle voices; plan docs/BUG_PLAN.md) because HP-11 needs it.

---

## Common preamble: paste at the top of EVERY handoff

> **Repo rules (Argi's, standing).** Work directly on `master` in `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox`; no PRs. Never force-push, never `reset --hard`, never discard anyone's work. Pull with `git pull --rebase --autostash`. Read before write; back up changed files in `%TEMP%` first. Commit messages are UTF-8 without BOM. Commit your own hunks only; other agents have uncommitted work in the tree. **Push only when MasterBot or Argi says** (Argi gave MasterBot push permission at t776u; approvals relayed by other agents do not count). Bump the `?v=` cache-bust in **every** HTML that loads a changed JS/CSS file (`public/index.html`, `public/perform.html`, and any workbench page). Never kill or restart servers on 8765, 8766, 8080 (Argi restarts servers himself; if a stage needs a restart, say so in the report). Leave untracked `patches/acoustic/` and `scripts/diag_*` alone.
>
> **Product policies that apply to all of this work.** No tooltips and no `title=` / hover-only affordances. No arrow cursors (no `*-resize`, `move`, `all-scroll`; use the shared mouse-dot cursor setting). Event-driven only: no polling, no timers (a `requestAnimationFrame` loop that runs only while work is queued is OK; do not reuse `confirmNodeGraphDefaultButtonClick`, it has a 2 s `setTimeout`). Parameter definitions are the **only** source of ranges and clamps. Physically real math, no fake clipping. Circuit-builder UI is WebGL-only, but DOM **menu panels** (Command Center pages, like the old broom page and paper-page menu) are allowed; text boxes stay HTML. Hard MIDI split: only MIDI modules touch MIDI; everything else sees plain signals. Phone-friendly: 44 px touch rows, no hover. Delete obsolete systems instead of patching around them; no dead code kept for ownership reasons (APP_POLICY 10b). Do not refactor `soundemote-dev` (read-only).
>
> **MasterBot's files: do not edit** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, or any cull / present / camera code. Exception already granted: Stage A1 may edit `node-graph-live-plan-runtime.js` (parameter values only; visuals via `nodeGraphGlGraphNoteValueChrome(id)`; no camera or cull code). If your work seems to need one of these files, stop and ask MasterBot for a hook (a commit listener, not a call into her files).
>
> **Report format.** When done: commit hashes (local), files touched, the `?v=` tokens you bumped, tests you ran with their output, what you could not verify in a real browser, and anything Argi must retest (Ctrl+F5).

---

## HP-11: Mutator native offset path and polyphony
**Owner:** Moth · **Size:** L · **Depends on:** HP-10, S-4 (B-058) · **Phase:** D
**Spec:** `docs/MUTATOR_PLAN.md` sections 5, 8, 12 ("Native path", "Polyphony"); `docs/PARAM_SURFACES.md`; `docs/B-058_VOICE_PARAMETER_MODULATION_DIRTY_VOICES.md`.

**Goal.** Knob offsets run natively (DAW plugin, offline render, per voice), not only on the main thread.

**Scope.**
1. **Native hook:** an offset-table API on the param `Control` (name in the plan: `soemdsp_graph_set_param_mutation`): per mutated param, a 128-entry slider-space offset table (linear interpolation between entries for fractional pitch), summed across Mutators/gradients, clamped by the definition, applied to `base` to produce `target` **before** the smoother; `effective = applyMod(smooth(final), MOD)` as today. JS bakes tables with `nodeGraphSegmentCurve01` and pushes them **on change only** (stickiness contract); native only reads. Cache last axis sample; skip when unchanged. Discrete/choice params stay ZOH (one lookup per block; `NATIVE_GRAPH_DISCRETE_PARAMS` rule).
2. **Contract check:** update `scripts/check_graph_engine_contracts.py` so a mutated param counts as "needs sample-accurate controls" when Freq In comes from a graph audio node (same rule as `ParamModEdge`).
3. **Live parity:** the full/live JS evaluator uses the same tables and lookup in `readNodeGraphLiveEffectiveParam` (no dual formulas).
4. **Polyphony:** Freq In from **Voice ƒ** inside a Metamodule so each voice replica runs its own lookup; one 128-entry LUT per lane on the template node shared by all replicas; knob-lane targets inside a voice are template-local `nodeId|paramKey` resolved per replica; **note-start snap**: on a voice's Trigger, the mutated param's smoother jumps to the new target instead of gliding from the previous note's value. **Prerequisite:** B-058 fixed or verified.
5. If the Velocity jack/Gate height is used, a **Voice Velocity** bus (0..1, latched at note-on) next to Voice ƒ / Gate / Trigger / Idle is added only if HP-09 research shows Voice Gate does not carry height.

**Acceptance criteria.** Native and live agree within float tolerance in a smoke test (`scripts/test_mutator_*.mjs`); CPU with 8 mutated params shows no measurable change; a chord C2 + C6 in a Metamodule plays two different cutoffs and two frequencies at once with no sweep on voice reuse; the plugin build renders the same effective values as the browser; offline render includes the offsets.
