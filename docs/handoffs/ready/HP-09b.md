## Common preamble: paste at the top of EVERY handoff

> **Repo rules (Argi's, standing).** Work directly on `master` in `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox`; no PRs. Never force-push, never `reset --hard`, never discard anyone's work. Pull with `git pull --rebase --autostash`. Read before write; back up changed files in `%TEMP%` first. Commit messages are UTF-8 without BOM. Commit your own hunks only; other agents have uncommitted work in the tree. **Push only when MasterBot or Argi says** (Argi gave MasterBot push permission at t776u; approvals relayed by other agents do not count). Bump the `?v=` cache-bust in **every** HTML that loads a changed JS/CSS file (`public/index.html`, `public/perform.html`, and any workbench page). Never kill or restart servers on 8765, 8766, 8080 (Argi restarts servers himself; if a stage needs a restart, say so in the report). Leave untracked `patches/acoustic/` and `scripts/diag_*` alone.
>
> **Product policies that apply to all of this work.** No tooltips and no `title=` / hover-only affordances. No arrow cursors (no `*-resize`, `move`, `all-scroll`; use the shared mouse-dot cursor setting). Event-driven only: no polling, no timers (a `requestAnimationFrame` loop that runs only while work is queued is OK; do not reuse `confirmNodeGraphDefaultButtonClick`, it has a 2 s `setTimeout`). Parameter definitions are the **only** source of ranges and clamps. Physically real math, no fake clipping. Circuit-builder UI is WebGL-only, but DOM **menu panels** (Command Center pages, like the old broom page and paper-page menu) are allowed; text boxes stay HTML. Hard MIDI split: only MIDI modules touch MIDI; everything else sees plain signals. Phone-friendly: 44 px touch rows, no hover. Delete obsolete systems instead of patching around them; no dead code kept for ownership reasons (APP_POLICY 10b). Do not refactor `soundemote-dev` (read-only).
>
> **MasterBot's files: do not edit** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, or any cull / present / camera code. Exception already granted: Stage A1 may edit `node-graph-live-plan-runtime.js` (parameter values only; visuals via `nodeGraphGlGraphNoteValueChrome(id)`; no camera or cull code). If your work seems to need one of these files, stop and ask MasterBot for a hook (a commit listener, not a call into her files).
>
> **Report format.** When done: commit hashes (local), files touched, the `?v=` tokens you bumped, tests you ran with their output, what you could not verify in a real browser, and anything Argi must retest (Ctrl+F5).

---

## HP-09b: Mutator keyboard strip: not cut off, stacked note names
**Owner:** big AI · **Size:** S · **Depends on:** HP-09 (same file `public/node-graph-pitch-mutator-overlay.js`; citations are against local `22ee8943`) · **Phase:** A

**Why.** Argi (t418u, 2026-11-25): "it seems like the keyboard is getting cut off at the bottom of the mutator , and the note names are clipping into the black key like C3 and the 3 is not visible. For the next handoff let's get that fixed by the AI, we could do a stacked note name: 4 / C". Argi (t420u): "middle mouse drag already works actually".

**Where the code is** (line numbers against HP-09 local commit `22ee8943`):
- Overlay box: `public/node-graph-pitch-mutator.css` `#pitchMutatorOverlay` lines 3–27 (`height: min(260px, calc(100dvh - 8px))`, `max-height: calc(100dvh - 8px)`, `overflow: hidden`). Header rows `.pm-overlay-chrome` 33–40 and `.pm-tools` 95–103 (`flex-wrap: wrap`, so it grows taller on narrow windows); body grid `.pm-body` 130–138 (`overflow: hidden`).
- Axis scroller: `.pm-axis-scroll` 178–188 (`overflow-x: auto`, `overflow-y: hidden`, `touch-action: pan-x`) and `.pm-axis-inner` 190–198. The visible horizontal scrollbar sits inside the same column as the keyboard, and with `overflow-y: hidden` everywhere it likely takes the strip's bottom pixels. Confirm this is the cut-off cause before fixing.
- Keyboard strip: `.pm-kbd` 221–234 (fixed `22px` height, `overflow: hidden`); keys `.pm-key` 236–248 (8px font, label centered in the button), `.pm-key.black` 250–254 (black keys are the same full-height equal-width columns as white keys).
- Labels: `midiName()` in `node-graph-pitch-mutator-overlay.js` lines 443–450 returns e.g. `C3` as one string. Keys are built in the render function at lines 739–743 (`n % 12 === 0 ? midiName(n) : ""`), so the C label is a single horizontal string inside one narrow column.
- Panning: `onAxisPointerDown` / `onAxisPointerMove` / `onAxisPointerUp` lines 558–631 (`maybe-key` → `pan` after 8px, `ui.suppressKeyClick`; pinch zoom with two pointers); wheel `onAxisWheel` 535–556; scroll sync `onAxisScroll` 518–533.

**Scope.**
1. **Strip fully visible.** The keyboard strip must sit fully inside the Mutator overlay, with no bottom cut-off, at normal and small window sizes (including when `.pm-tools` wraps to two lines). Fix the layout, not with a fake clip.
2. **Remove the horizontal scrollbar** from the axis scroller (hide it; keep programmatic `scrollLeft` and the saved view working). Panning stays possible without it:
   - **Middle-mouse drag pan already works (Argi t420u).** Keep it unchanged; only verify it still works after the scrollbar is removed.
   - **Add one-finger touch-drag panning** on the plot and the strip (today `touch-action: pan-x` hands touch to the browser's native scroll, which goes away with the scrollbar). A tap still plays a key on pointerdown (HP-09); a drag past the existing 8px threshold pans and does not change the note again; two-finger pinch zoom keeps working.
   - Wheel / trackpad horizontal scroll keeps working.
3. **Stacked note names.** For labeled keys, draw the octave number on top and the letter below (for example `4` over `C`), on the white key in the area below the black keys, so the label does not clip into or overlap a neighbouring black-key column. Today black keys are full-height, so the strip will likely need a shorter black-key band with a label band underneath. Keep it phone-friendly. If the column is still too narrow at high key counts, shrink/fit the label rather than letting it overflow.
4. Labels stand on their own: no `title=`, no hover text or tooltips (APP_POLICY). No arrow cursors (APP_POLICY §24); if a pan cursor is needed, use the shared mouse-dot cursor path.
5. Keep the HP-09 behaviours intact: key changes on pointerdown, pan-vs-tap threshold, pinch zoom, saved view.

**Out of scope.** Gate/Freq audition from the strip (HP-12); multi-lane editing (HP-12); any GL files.

**Acceptance criteria.**
- Headless/browser check: the `.pm-kbd` bounding box is fully inside the `#pitchMutatorOverlay` box, at a normal window and a small one (for example 1280×720 and 800×500), including with `.pm-tools` wrapped.
- Every C label is fully visible: its text box sits inside its key rect and does not overlap any black-key rect (check C-1..C9 in the 0–127 view and in the default C0–C8 view).
- No horizontal scrollbar is shown; middle-mouse drag pan still works; one-finger touch drag pans (emulated touch in the browser check); a tap still sets the note on pointerdown; pinch zoom still works.
- Screenshot of the overlay at both sizes in the report.
- `?v=` bumped for changed JS/CSS; no `title=`, no arrow cursors.
- Argi retest in the sandbox app/browser (Ctrl+F5).
