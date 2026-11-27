# PASTE-6: HP-12

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

## HP-12: Mutator editing depth
**Owner:** Misty · **Size:** L · **Depends on:** HP-10 · **Phase:** D (parallel with HP-11)
**Spec:** `docs/MUTATOR_PLAN.md` sections 7, 9, 12 ("Editing depth").

**Scope.** Several knob params per Mutator (already natural after HP-10), **per-segment shape and skew** UI (Step Graph curves, skew -1..+1), **key drag and delete**, rings and binding chips polished, the **Mutator inspection view** (a circuit overlay, in the spirit of the debug menu: each Mutator paints a box around everything it controls in its color and/or numbers, alongside the rings), copy/remap (copying a Mutator with its targets remaps `target.nodeId` to the copies, copying the Mutator alone keeps the originals), **audition from the overlay keyboard** via Gate/Freq outs, **more than one Mutator** per patch with ownership boxes. Keep: overlay name = module name sync, no tooltips, dense DPR-sharp UI.

**Out of scope.** Velocity Mutator (HP-13), native path (HP-11), bias lane, discrete thresholds, concentric rings (listed as not adopted in plan section 13).

**Acceptance criteria.** Full play-and-pin loop works on a phone with no MIDI hardware (on-screen keyboard); two Mutators in one patch show distinct colored ownership boxes and each overlay tab edits only its own; drag/delete keys are single undo steps; copy/paste a Mutator with its targets remaps; inspection view toggles from the Command Center; no GL files edited without MasterBot's OK (the inspection boxes may need a hook from her: ask, do not edit).

## Testing scope
- Test only the modules and files this plan touches, plus their direct dependents.
- Run each test once. After a fix, re-run only the tests that failed.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. A plan cannot pre-authorize it.
- Time box: stop testing at 15 minutes and report what you have.
- After reporting, stop. Do not start the next plan.
