## Common preamble: paste at the top of EVERY handoff

> **Repo rules (Argi's, standing).** Work directly on `master` in `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox`; no PRs. Never force-push, never `reset --hard`, never discard anyone's work. Pull with `git pull --rebase --autostash`. Read before write; back up changed files in `%TEMP%` first. Commit messages are UTF-8 without BOM. Commit your own hunks only; other agents have uncommitted work in the tree. **Push only when MasterBot or Argi says** (Argi gave MasterBot push permission at t776u; approvals relayed by other agents do not count). Bump the `?v=` cache-bust in **every** HTML that loads a changed JS/CSS file (`public/index.html`, `public/perform.html`, and any workbench page). Never kill or restart servers on 8765, 8766, 8080 (Argi restarts servers himself; if a stage needs a restart, say so in the report). Leave untracked `patches/acoustic/` and `scripts/diag_*` alone.
>
> **Product policies that apply to all of this work.** No tooltips and no `title=` / hover-only affordances. No arrow cursors (no `*-resize`, `move`, `all-scroll`; use the shared mouse-dot cursor setting). Event-driven only: no polling, no timers (a `requestAnimationFrame` loop that runs only while work is queued is OK; do not reuse `confirmNodeGraphDefaultButtonClick`, it has a 2 s `setTimeout`). Parameter definitions are the **only** source of ranges and clamps. Physically real math, no fake clipping. Circuit-builder UI is WebGL-only, but DOM **menu panels** (Command Center pages, like the old broom page and paper-page menu) are allowed; text boxes stay HTML. Hard MIDI split: only MIDI modules touch MIDI; everything else sees plain signals. Phone-friendly: 44 px touch rows, no hover. Delete obsolete systems instead of patching around them; no dead code kept for ownership reasons (APP_POLICY 10b). Do not refactor `soundemote-dev` (read-only).
>
> **MasterBot's files: do not edit** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, or any cull / present / camera code. Exception already granted: Stage A1 may edit `node-graph-live-plan-runtime.js` (parameter values only; visuals via `nodeGraphGlGraphNoteValueChrome(id)`; no camera or cull code). If your work seems to need one of these files, stop and ask MasterBot for a hook (a commit listener, not a call into her files).
>
> **Report format.** When done: commit hashes (local), files touched, the `?v=` tokens you bumped, tests you ran with their output, what you could not verify in a real browser, and anything Argi must retest (Ctrl+F5).

---

## HP-09d: Mutator Frequency is not pinnable; pin dots are interactive
**Owner:** big AI · **Size:** S · **Depends on:** HP-09c (`6afa3e9b`, local, unpushed; MasterBot is reviewing it) · **Phase:** A · **Queued next**, then HP-09b, HP-03, HP-18
**Paste-ready path:** `docs/handoffs/ready/HP-09d.md`

**Why.** Argi's browser retest of HP-09c (t427u, 2026-11-25), verbatim:
- "it looks like i pinned frequency"
- "i can't interact with points but they are getting placed and the cutoff knob is responding"
- "frequency is not changing i guess because i pinned it, but also the keyboard is plugged into pitch mutator module, so technically shouldnt the frequency be "under construction" / disabled?"
- "but also, shouldn't the frequency not even be pinnable? that doesn't really make sense to pin frequency of the pitch mutator"

HP-09c is a **partial pass**: the Flower Child Cutoff lane binds, pins and follows. This plan is the rest. Do not mark HP-09c done until HP-09d passes Argi's retest.

## Root cause (file:line at `6afa3e9b`)
Argi did **not** Arm-bind the Mutator's own frequency parameter. `bindKnob` already returns `null` when the knob is on the Mutator itself (`public/node-graph-pitch-mutator-overlay.js` 364-368: `if (node.id === nodeId) return null`). The Pitch Mutator module has no visible frequency param; its only parameter is hidden `playheadHz` (`public/node-graph-module-definitions.js` 11165-11175).

He pinned the built-in **Frequency lane**. That lane is the default `activeLane` (`"freq"`, `pitch-mutator-engine.js` `normalizeMutatorState` 158). The overlay always draws a Frequency chip and starts with it selected (`overlay.js` 851, `state.activeLane === "freq"`). `pinActiveLane` (337-347) writes `freqLane` keys (Hz at the playhead) whenever the active lane is `"freq"`. The Frequency Hz number field does the same on change / Auto-Pin (1002-1016). One Pin Keyframe while Frequency is still the active lane — the default when the overlay opens, or after clicking the Frequency chip — is enough. Binding Cutoff later (`bindKnob` 388 sets `activeLane` to `L1`) does not remove those Frequency keys, and `drawPlot` (806-815) still draws a dot for every `freqLane` key next to the Cutoff pins.

Once `freqLane` has keys, Freq Out is no longer an empty-lane passthrough (D-M3). A keyboard (or anything else) on Freq In still moves the playhead (`soundingNote` / `incomingHz`, 108-126) but no longer drives the outgoing frequency, which matches "frequency is not changing" with the keyboard plugged in. There is no disabled / "driven by Freq In" state today: the Frequency chip, the Hz field, and Pin Keyframe all stay live.

The dots he cannot drag are `.pm-pin` circles in the overlay SVG (806-823). They have no pointer handlers (axis pointer code only pans and plays keys). CSS also turns hits off: `.pm-pin { pointer-events: none; }` (`public/node-graph-pitch-mutator.css` 297-298).

## Scope
1. **The Pitch Mutator's own frequency / pitch is never bound or pinned.** Arm ignores the Mutator's own params (keep the `bindKnob` self-id guard; also ignore `playheadHz` and any other self frequency/pitch key even if the id check were bypassed). Pin Keyframe is disabled while the Frequency lane would be the target (or the Frequency lane is simply not a pin target). The Frequency Hz field must not write `freqLane` keys. The status line explains it in words, for example: "The Pitch Mutator's frequency cannot be pinned. Bind a knob on another module (Arm, then turn it)." No tooltips.
2. **When Freq In (or the keyboard) is connected**, the Frequency chip, the Hz field, and any Frequency edit show a disabled / "driven by Freq In" state in words, use the existing disabled / under-construction styling (`.node-under-construction-control` in `public/styles.css` 3977-3996, `disabled` / `aria-disabled`), and are not editable. Empty-lane passthrough (D-M3) remains the Freq Out behaviour. Events only: update when a cable is attached or removed, not on a timer.
3. **Recover already-pinned Frequency lanes** in saved patches (Argi's included). Recommended default: drop `freqLane.keys` on load / `ensureState`, and tell the user in the status line once (for example: "Dropped a Frequency pin. The Pitch Mutator's frequency is not pinnable."). Do not silently keep a lane that can no longer be edited.
4. **Pin dots on the knob-lane plot are interactive.** Drag to move: vertical is the value (clamped to that parameter's min/max from the parameter definition only), horizontal is the note. Delete uses one single-action, touch-friendly gesture (see D-M10). Turn on pointer events for `.pm-pin`. No `title=`, no hover text, no arrow cursors (APP_POLICY §24); if a drag cursor is needed, use the shared mouse-dot path. Keep pan / key / 8px threshold working (a pin drag is not a pan). No GL file edits: the dots already live in the overlay SVG.
5. Extend `scripts/test_pitch_mutator_knob_lane_browser.mjs` (and unit tests as needed) with real mouse / touch for all of the above. Bump `?v=` on changed JS/CSS.

**Out of scope.** HP-09b keyboard strip layout. Gradients (HP-03). Compact IO labels (HP-18). Editing `node-graph-gl-graph.js` or any other GL file. Re-introducing Frequency-lane pinning.

## Decisions (Open; only Argi's own words close them)
- **D-M10.** How does a pin get deleted? Recommended default: **tap the pin to select it, then press Delete / Backspace, or double-tap the pin.** No modifier key, no right-click, no hover-only control. Build that default; Argi can veto it when he retests.

## Acceptance criteria
- Arm + a real drag of the Mutator's own control (if any, including hidden `playheadHz`) does not create a knob lane or `freqLane` keys. Pin Keyframe does not write `freqLane` keys, including when the Frequency chip is selected; the Pin button is disabled (or not a Frequency target) and the status line explains why. Typing in the Hz field does not pin.
- With a Keyboard (or other Freq source) wired to Freq In: the Frequency chip / Hz field uses the existing disabled / under-construction styling, shows "driven by Freq In" (or the same idea) in visible text, and rejects edits. Freq Out follows the incoming note (passthrough). Unwiring restores the previous non-editable Frequency policy from item 1, still not pinnable.
- Load (or `ensureState`) a patch whose `mutator.freqLane.keys` is non-empty: the keys are dropped, the status line says so once, and Cutoff (or any bound knob lane) is unchanged.
- Real mouse (and touch, or emulated touch): drag a Cutoff pin vertically and horizontally; assert the key's value and note change, clamped to the param definition. Delete a pin with the D-M10 gesture; assert the key is gone and the effective cutoff at that note follows the remaining curve. Overlay pan and key taps still work.
- The existing HP-09c browser checks still pass (Cutoff binds, pins at two notes, follows the playhead, Auto-Pin on and off, overlay closed, Freq In playheadHz).
- Screenshots in the report: disabled Frequency with Freq In wired; a selected pin; after a drag and after a delete. No `title=`, no arrow cursors, no GL file edits.
- MasterBot review, then Argi retest in the sandbox app/browser (Ctrl+F5), including his own patch that currently has a Frequency pin.
