## Common preamble: paste at the top of EVERY handoff

> **Repo rules (Argi's, standing).** Work directly on `master` in `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox`; no PRs. Never force-push, never `reset --hard`, never discard anyone's work. Pull with `git pull --rebase --autostash`. Read before write; back up changed files in `%TEMP%` first. Commit messages are UTF-8 without BOM. Commit your own hunks only; other agents have uncommitted work in the tree. **Push only when MasterBot or Argi says** (Argi gave MasterBot push permission at t776u; approvals relayed by other agents do not count). Bump the `?v=` cache-bust in **every** HTML that loads a changed JS/CSS file (`public/index.html`, `public/perform.html`, and any workbench page). Never kill or restart servers on 8765, 8766, 8080 (Argi restarts servers himself; if a stage needs a restart, say so in the report). Leave untracked `patches/acoustic/` and `scripts/diag_*` alone.
>
> **Product policies that apply to all of this work.** No tooltips and no `title=` / hover-only affordances. No arrow cursors (no `*-resize`, `move`, `all-scroll`; use the shared mouse-dot cursor setting). Event-driven only: no polling, no timers (a `requestAnimationFrame` loop that runs only while work is queued is OK; do not reuse `confirmNodeGraphDefaultButtonClick`, it has a 2 s `setTimeout`). Parameter definitions are the **only** source of ranges and clamps. Physically real math, no fake clipping. Circuit-builder UI is WebGL-only, but DOM **menu panels** (Command Center pages, like the old broom page and paper-page menu) are allowed; text boxes stay HTML. Hard MIDI split: only MIDI modules touch MIDI; everything else sees plain signals. Phone-friendly: 44 px touch rows, no hover. Delete obsolete systems instead of patching around them; no dead code kept for ownership reasons (APP_POLICY 10b). Do not refactor `soundemote-dev` (read-only).
>
> **MasterBot's files: do not edit** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, or any cull / present / camera code. Exception already granted: Stage A1 may edit `node-graph-live-plan-runtime.js` (parameter values only; visuals via `nodeGraphGlGraphNoteValueChrome(id)`; no camera or cull code). If your work seems to need one of these files, stop and ask MasterBot for a hook (a commit listener, not a call into her files).
>
> **Report format.** When done: commit hashes (local), files touched, the `?v=` tokens you bumped, tests you ran with their output, what you could not verify in a real browser, and anything Argi must retest (Ctrl+F5).

---

## HP-09f: Mutator polish (Glide button, key drag, cleanup)
**Owner:** big AI · **Size:** M · **Depends on:** HP-18 + the four Mutator commits after it (`d47bc6ef`, `ce2a5337`, `1cff46e4`, `caa9617b`, then `84ac677a`; local, not pushed) · **Phase:** A

**Current state (do not redo).** The Pitch Mutator has **Pitch In** (MIDI-note units, cables sum) plus a visible **Pitch knob** (0-127). The knob holds the Mutator's own smoothing, and modulation lands after the smoother. Pressing a key moves the knob, and Argi likes that link: keep it. The Mutator keeps its parameters; it is **not** a no-parameter module (that old idea is dropped). **Feedback routing is allowed** (Argi t469u): do not block, ignore or special-case wires into a Mutator.

This plan replaces HP-09e's use of the target's smoother as the offset timing. The target param's smoother stays for mouse/knob changes; Mutator offsets still bypass it (Argi t460u).

Limits come from the param definitions. Events only.

**1. Glide via a parameter-menu button (t474u).** Put a **Glide** (smoothing, with an off setting) on the Mutator module. Do **not** mirror controls on the overlay. Instead, add one button on the Mutator overlay that opens the Mutator module's parameter menu, where Glide (and the Pitch knob's smoothing) live. If the Pitch knob's existing smoothing already is that Glide, just expose it there and say so; do not add a second smoother. Layer 2 (per-Mutator controls) only; the three-layer UI redesign stays a future pass.

**2. Key drag (t475u).** Press or drag selects the key under the pointer; the last key dragged to wins. No toggling during the drag. A key toggles off only on mouse up, and only if the press started on the key that was already selected.

**3. Remove the explanation text** "wire freq out into a FREQUENCY input. Arm..." Labels stand on their own.

**4. Offset number widget (t475u).** The number under "Offset" must follow the app's number-control conventions: mouse drag changes it, and it has the soundemote.io look and feel, like the other number widgets. Reuse the shared widget; do not build another.

**5. Mutator list (t475u).** The list starts blank, with no Frequency entry, until something is armed. A Mutator can't add its own parameters to its list. Arming one of its own knobs is refused with a small inline note (no tooltip, no popup): "A Mutator can't mutate itself."

**6. Loose ends.** The Hz field in the side panel is inert: wire it up or remove it. Recommend **remove** if it is redundant with the Pitch knob (your call). Also verify the untested **double-click point add** on the graph and fix it if broken.

**Out of scope.** The VST lane table, `?product=full` Mutator offsets, and the GL face value readout stay deferred (the GL face is planned for the AI separately). The keyboard drag and cursor behavior from `ce2a5337` stays as is, except item 2.

**Acceptance (one line each).**
1. Glide off: the offset steps instantly regardless of the target's smoothing; Glide set: it glides by that time; mouse smoothing unaffected. A button on the overlay opens the Mutator's parameter menu; no mirrored controls.
2. Dragging across keys leaves the last key under the pointer selected with no flicker; mouse up on the same already-selected key it was pressed on toggles it off.
3. The explanation text is gone.
4. The Offset number drags with the mouse and looks like the other number widgets.
5. A fresh Mutator's list is empty with no Frequency; arming its own knob shows the inline note and adds nothing.
6. Hz field removed (or working, and justified); double-click add point verified and the result reported.
No tooltips, no timers. Report which checks were headless Chrome only.