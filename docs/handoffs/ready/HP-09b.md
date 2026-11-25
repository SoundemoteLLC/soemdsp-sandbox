## Common preamble: paste at the top of EVERY handoff

> **Repo rules (Argi's, standing).** Work directly on `master` in `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox`; no PRs. Never force-push, never `reset --hard`, never discard anyone's work. Pull with `git pull --rebase --autostash`. Read before write; back up changed files in `%TEMP%` first. Commit messages are UTF-8 without BOM. Commit your own hunks only; other agents have uncommitted work in the tree. **Push only when MasterBot or Argi says** (Argi gave MasterBot push permission at t776u; approvals relayed by other agents do not count). Bump the `?v=` cache-bust in **every** HTML that loads a changed JS/CSS file (`public/index.html`, `public/perform.html`, and any workbench page). Never kill or restart servers on 8765, 8766, 8080 (Argi restarts servers himself; if a stage needs a restart, say so in the report). Leave untracked `patches/acoustic/` and `scripts/diag_*` alone.
>
> **Product policies that apply to all of this work.** No tooltips and no `title=` / hover-only affordances. No arrow cursors (no `*-resize`, `move`, `all-scroll`; use the shared mouse-dot cursor setting). Event-driven only: no polling, no timers (a `requestAnimationFrame` loop that runs only while work is queued is OK; do not reuse `confirmNodeGraphDefaultButtonClick`, it has a 2 s `setTimeout`). Parameter definitions are the **only** source of ranges and clamps. Physically real math, no fake clipping. Circuit-builder UI is WebGL-only, but DOM **menu panels** (Command Center pages, like the old broom page and paper-page menu) are allowed; text boxes stay HTML. Hard MIDI split: only MIDI modules touch MIDI; everything else sees plain signals. Phone-friendly: 44 px touch rows, no hover. Delete obsolete systems instead of patching around them; no dead code kept for ownership reasons (APP_POLICY 10b). Do not refactor `soundemote-dev` (read-only).
>
> **MasterBot's files: do not edit** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, or any cull / present / camera code. Exception already granted: Stage A1 may edit `node-graph-live-plan-runtime.js` (parameter values only; visuals via `nodeGraphGlGraphNoteValueChrome(id)`; no camera or cull code). If your work seems to need one of these files, stop and ask MasterBot for a hook (a commit listener, not a call into her files).
>
> **Report format.** When done: commit hashes (local), files touched, the `?v=` tokens you bumped, tests you ran with their output, what you could not verify in a real browser, and anything Argi must retest (Ctrl+F5).

---

## HP-09b: Mutator stacked note names, plus unit 0-1
**Owner:** big AI · **Size:** S · **Depends on:** HP-09g (pushed at `17065c30`) · **Phase:** A

**Current state (do not redo).** Already in `17065c30` (d47bc6ef, ce2a5337, HP-09f, HP-09g):
- No scrollbars on the Mutator overlay; wheel, touch and view buttons still scroll.
- Cursors are the little + on hover and the little dot while pressed (no hand).
- Keys fit the 22px strip (the global button min-height no longer clips them).
- Mouse plays and drags keys and never pans; touch still drags the view; middle-mouse pan already worked (t420u) — keep it.
- Note names already use one shared helper (`nodeGraphKeyboardPitchLabel`): MIDI 0 = C-2, MIDI 60 = C3. Do not invent another convention.

**Report back.** When done, update `C:\Users\argit\Desktop\soemdsp-mutator-handoff.md`. That is the AI-to-Badger channel from now on. Put the commit hash, what changed, tests, and anything Argi must retest in that file. Do not rely on a chat message alone.

Events only. No tooltips, no `title=`, no arrow cursors.

**1. Stacked note names (t418u, still open).** The naming convention is done; the layout is not. C labels still clip into neighbouring black keys. For labeled keys, draw the octave number on top and the letter below (for example `4` over `C`), on the white key in the area below the black keys, so the label does not clip into or overlap a neighbouring black-key column. Black keys may need a shorter band with a label band underneath. Keep it phone-friendly. If the column is still too narrow at high key counts, shrink/fit the label rather than letting it overflow. Use the existing shared helper; the lowest C is C-2. Files: `public/node-graph-pitch-mutator-overlay.js`, `public/node-graph-pitch-mutator.css`. If a leftover bottom cut-off shows up while you do this, fix it; do not reopen the scrollbar / cursor / key-fit work.

**2. Unit 0-1 output (t488u).** The Mutator's `unit` output is the mixed playhead (Pitch In + Pitch knob), 0-127, mapped linearly to 0-1: `(Pitch In + knob) / 127`. It is not the bound knob's position on its own range (that was the HP-09g interpretation). MIDI 0 → 0, MIDI 127 → 1. Update the native engine, tests and any overlay copy that describes it.

**Out of scope.** Scrollbars, cursors, key fit, and the note-name convention. Gate/Freq audition and multi-lane editing (HP-12). Any GL files. Deferred: the VST lane table, `?product=full` Mutator offsets, the GL face value readout.

**Keep intact.** HP-09f key press/drag, touch drag-pan, middle-mouse pan, wheel scroll, pinch zoom, saved view.

**Acceptance (one line each).**
1. Every C label is stacked (octave over letter) and fully visible inside its key, with no overlap of a black-key rect, in the 0-127 view and the default view (lowest C reads C-2).
2. `unit` is (Pitch In + knob) / 127: MIDI 0 → 0, MIDI 60 → 60/127, MIDI 127 → 1; it does not follow the bound knob position.
`?v=` bumped for changed JS/CSS. Report which checks were headless Chrome only, in the desktop handoff file. Restart the 8766 server and Ctrl+F5 if the wasm changed.
