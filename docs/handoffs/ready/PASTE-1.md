# PASTE-1: HP-24 + HP-05 + HP-23

Do these in order, committing each separately. Skip anything already done (check git log). Where an older plan overlaps a newer one, the newer one wins.

---

# HP-24: G toggle fix, negative amplitude everywhere, gradient stop editing

## 1. G shows "Engine status" instead of the debug window
- After HP-22, pressing G brings up the Engine status row instead of the main CPU/RAM/GPU debug window. G must toggle the main debug window. Engine status stays a collapsed row inside it, never the thing G shows on its own.

## 2. Negative amplitude: one rule for the whole app
- Sincos is fixed, but the spectral oscillator (and probably others) still treat negative amplitude as 0.
- Make one shared rule: amplitude is a signed gain, and a negative value inverts the signal at that magnitude. The param definition is the only source of limits.
- Find every module or engine path that clamps or rectifies amplitude (search the DSP and wasm for max(0, amp), fabs and the like). Route them through one shared helper or convention, and add a test that sweeps every module with an amplitude param.
- Say **server restart needed** if the wasm changes.

## 3. Editing gradient stop values
- Clicking a stop on the 🌈 strip selects it: the playhead snaps there, the stop gets a solid outline, and every slider that stop affects gets the same outline. The outline means "editing this stop."
- While a stop is selected, moving an outlined slider writes into that stop's offset (one undo step per release). Other sliders behave normally.
- With the playhead between stops or no stop selected, there are no outlines and nothing writes into the gradient. Sliders act as base values.
- Click the selected stop again, click empty strip space or press Esc to stop editing.
- No hover effects and no animation, just the static outline. Labels must stand on their own. Low cognitive load.
- Add a browser test.

## 4. Typing a value below the minimum extends the minimum
- Today, typing a number above a slider's max extends the max. Do the same for the minimum: typing a value below the current min extends the min to that value, mirroring the max behavior exactly (same code path, same persistence, same undo).
- Respect whatever hard limits the param definition allows (the definition stays the only source of limits). If the existing max extension is unbounded, the min matches it.
- Add a test next to the existing max-extension test.

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

## HP-05: Stage A4, slider ghost uses the effective value, 1 to 2 px outline, "Holds still" line
**Owner:** Misty · **Size:** M · **Depends on:** HP-03, HP-04 · **Phase:** C
**Spec:** plan sections 4.3 (last paragraph), 4.7, 12 (A4), 14.

**Goal.** Sliders show the sounding value without any new marker, and the user can see which sliders belong to the gradient being edited.

**Scope.**
- The existing slider ghost (`nodeGraphParameterGhostSignal` in `public/node-graph-ghost-sliders.js`) already folds base + MOD cables into the displayed final value. Make it fold **gradient offsets (and later Mutator offsets) first**, then cables as today. **No new marker, ring, or second handle.**
- **Outline:** while a gradient is the selected card on the Gradients page, every **slider** in its `params` list gets a **1 to 2 px outline**. Sliders only, not Knob modules. Removed on deselect or page close (selection/panel events, no timer). Do it in `node-graph-ghost-sliders.js` and the existing slider DOM. **Do not edit** the GL graph files; if the paint site turns out to be GL-drawn, stop and ask MasterBot for a hook.
- The plain text line `Holds still: <module names>` under a card's bar when its modules include something that is not a gradient param (Step Graph, Smooth Graph, `stepRegister`, `chordMemory`). No badge, no tooltip, no pop-up.

**Acceptance criteria.** Ghost value equals what the engine uses (assert in a test: ghost == provider output); outline appears/disappears on card select/deselect and page close, with no polling; the Holds-still line appears for a gradient touching a Step Graph and not otherwise; unchanged behavior when no gradients exist. `?v=` bumps. Argi retest list: move playhead, watch ghost; select card, see outlines.

---

# HP-23: Gradient module (modulatable playhead)

## Goal
Argi loves the Gradients page and wants to modulate it. Add a **Gradient module** that plays a gradient, so its playhead can be driven by any signal (LFO, envelope, Mutator, audio and so on).

## Shape
- The module picks one gradient from `patch.gradients`, chosen on the module.
- It has a **Playhead input jack** (0 to 1 across the gradient's stops; cables sum) plus a Playhead knob. Playhead = knob + input.
- Moving the playhead applies the gradient's interpolated param offsets, the same as dragging the playhead on the 🌈 page.
- The module and the 🌈 page share one source of truth. When the module drives it, the page's playhead follows.
- It has a small display showing the strip and a moving playhead, with no hover effects.
- Optional outputs: Playhead (unit) and the stop index.

## Rules
- Param definitions are the only source of limits.
- Events and audio-rate or block-rate only, with no timers or polling.
- Feedback routing is allowed, so don't block it.
- No tooltips, no hand cursor, and labels must stand on their own. Keep cognitive load low.
- No legacy compatibility worries.
- Undo: changing the module settings is one undo step each. Signal-driven motion is not undoable.

## Report
- How fast the gradient can be driven (control rate vs per block) and any CPU cost.
- Whether the wasm changed (say **server restart needed** if so).

## Must be audio-rate
- The module must respond at **audio rate**: the playhead input is read per sample, and the interpolated offsets are applied per sample (or per block with per-sample interpolation), not as UI-rate param writes.
- **Existing bug to fix first:** dragging the 🌈 page playhead with the mouse sounds stuttery or crossfady. Likely cause: each pointer event writes target param values at UI rate (about 60 Hz), and the param smoothers ramp between those steps. Find the real cause and report it. Then route the page playhead through the same audio-rate path as the module, so mouse drags sound smooth.

## Also fix first: gradient playhead changes aren't visible
- When the 🌈 page playhead moves, Argi sees no ghost, the param knobs/sliders in the circuit builder don't update, and displays don't show the changes (only the audio moves).
- Fix it so gradient-applied offsets show everywhere a modulated value normally shows: the ghost/effective-value indicator on each affected knob or slider, and every display reading those params. The same goes when the Gradient module drives it.
- Events only. Reuse the existing modulation-ghost path, and don't add a new timer.

## Addendum (Argi t537u): drag in from the Gradients page

- Each gradient on the rainbow Gradients page can be dragged into the circuit. Dropping it spawns a Gradient module already tied to that gradient.
- The module has one input (playhead 0-1, cables sum) plus the playhead knob. Keep it minimal, with no extra UI.
- The old 'gradient to modules' feature (HP-14) is retired: overkill and UI clutter. Do not build it.
- Test: dragging a gradient from the page spawns a module bound to it, and moving the module's knob or input moves the same playhead the page shows.
- Argi t538u: the module is a thru: 1 input and 1 output. The output passes the input signal (summed cables) straight through, so it can be chained or fed back.
- Argi t540u: the jacks use the existing in/out symbols (→ for in, ← for out) with no text label.
