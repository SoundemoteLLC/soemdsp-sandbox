# PASTE-4: HP-10

Do these in order, committing each separately. Skip anything already done (check git log). Where an older plan overlaps a newer one, the newer one wins.

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

## HP-10: Stage A5, rebase the Pitch Mutator onto gradients
**Owner:** Misty · **Size:** L · **Depends on:** HP-03, HP-04, HP-09 · **Phase:** D · **Unblocks:** HP-11, HP-12
**Decisions settled (t449u).** D-M5 "yes": linear over full MIDI 0 to 127, shape-editable later, stored on the Mutator binding. D-M6 "yes": Pin Keyframe snapshots all moved sliders at the note's stop; the overlay still highlights the active param. **D-M7 / D-G3:** Argi: "wait, mutators can own gradients? i figured it would just be another offset sort of modulation". A Mutator does **not** own gradients in the UI. It is another offset-style modulation that internally uses the gradient machinery; **nothing appears on the Gradients page**.
**Spec:** plan section 5 (Gradients plan), `docs/MUTATOR_PLAN.md` sections 3, 6, 8, 10.

**Goal.** One internal data model: a Mutator knob lane uses the gradient machinery as offset-style modulation (not a Gradients-page object). The Mutator is an axis-to-position router. The Frequency lane stays on the Mutator (Hz is not a slider offset).

**Scope.**
- Mutator binding = `(gradient id, axis, position curve)`; axis = pitch (0..127 from Freq In or the audition key). The curve maps axis to position 0..1 reusing the Step Graph shapes (`nodeGraphSegmentCurve01`); default map per D-M5 (recommended: linear over MIDI 0 to 127, stored on the Mutator binding, not the gradient). The Mutator's contribution adds to the gradient position (clamped 0..1), per Gradients plan 4.5.
- **Pin Keyframe / Auto-Pin** now writes a **stop** at the position the current note maps to, into the Mutator's internal gradient-style data (D-M6: snapshot all moved sliders; the overlay still highlights the active param). Arm + knob turn registers the param (this also resolves D-M1 option "add a second param"). That data is **not** listed on the Gradients page.
- The overlay's lane plot reads the gradient's stops as a function of pitch (offset curve per param, one active at full strength, others faint), so the relation-on-one-keyboard view of the Mutator plan survives.
- **Do not** list Mutator lanes on the Gradients page (D-M7 / D-G3). Edits on the Gradients page must not show or retitle them as owned gradients.
- Remove the Mutator's private knob-lane code and its own offset path from the overlay/engine once the provider list handles it (delete, do not keep both). Keep: overlay UI, MIDI policy, Freq lane + native LUT, view persistence, rings/chips, `remapLaneTargets`/`dropMissingTargets` equivalents for gradients.
- **Migration:** shipped patches have **no** authored knob-lane data (`patches/acoustic/bass*.json` have 0 lanes). Add a one-way normalize that converts any existing `node.mutator.lanes[]` with keys into the Mutator's internal gradient-style data (write the test with a synthetic fixture); then delete the old fields on next save. Still do not show that data on the Gradients page. Update `MUTATOR_PLAN.md` and `MODULE_GRADIENTS_AND_PRESETS_PLAN.md` to the single model.

**Acceptance criteria.** Sound with a keyed knob lane is unchanged vs before the rebase (A/B by effective-param diff for a fixture with 2 pins); play note, tweak, pin at two pitches, hear the morph; patch reload restores identical behavior; Mutator lanes do **not** appear on the Gradients page; tests: engine tests updated, `test_gradients.mjs` extended with an axis-driven position case; plugin-host effective params include the Mutator contribution; no timers; `?v=` bumped.
