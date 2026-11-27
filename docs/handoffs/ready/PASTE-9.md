# PASTE-9: text redraw bug fixes, then gradient/mutator points and curves

Do the parts in order and commit each one. Skip anything already done. If two parts disagree, the newer part wins. Don't push. The source of truth for bugs is `docs/KNOWN_BUGS.md`; update it as you fix things.

## Part A: bug fixes (do these first)

### A0. Finish and merge the bugfix worktree
- Worktree `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox-bugfix`, branch `bugfix/text-keyboard`, on top of `8027fb8d`. It holds an uncommitted text-sharpness follow-up: `gl-line-renderer.js` (qualityScale, fitPending in the maxWidth fit), `node-graph-gl-graph.js` (the sharpen queue uses `qualityScale ?? snapScale`), `test_text_gesture_redraw.mjs` (NARROW_TITLE=1 probe), `test_text_squeeze_zoom.mjs`, and an untracked `test_keyboard_highlight_stress.mjs`.
- Cause it fixes: fitted or capped text runs turn off pixel snapping (snapScale=0), so the sharpen queue treated them as stale and re-recorded them forever.
- Run those tests. If they pass, commit the follow-up in the worktree, then merge `bugfix/text-keyboard` into master with a normal merge commit (no rebase). Report conflicts. Don't delete the branch or the worktree.
- Confirm the keyboard key highlight fix (`82380fa0`, blue/gold and Shift/Ctrl click) is on master after the merge.

### A1. Long fitted titles flicker on module drag
- Dragging a module makes long titles that are shrunk to fit flash full size, then shrink back. Very likely the same forever re-record as A0. Verify after A0; fix what's left. The test checks no size change and no text rebuild during the drag.

### A2. Text stays blurry about 1 s after a WASD pan
- Where: `node-graph-viewport-perf.js` `scheduleNodeGraphViewTextQuality` (150 ms settle) and the sharpen tick in `node-graph-gl-graph.js`. Likely cause: a pan at constant zoom still arms the quality-settle and rebake path. A pan that doesn't change zoom shouldn't drop text quality at all. Test: text stays sharp during and after a pan.

### A3. Zoom, then pressing the middle mouse button, redraws text
- Same area. Likely a pending settle timer from the zoom, or mousedown changes `nodeGraphGlGraphLiveKey()` so `Present()` remeshes. A button press alone should never rebuild text. Test it.

### A4. Small open bugs (fix if simple, otherwise list them in the report)
- Right double-click on a module title acts like a left double-click. Only `event.button === 0` should count.
- Output Mono shows no jacks until Tab is pressed. Fix its initial IO visibility.
- Refresh doesn't keep the camera view or patch-view visibility. Persist them.
- Deleting Viewport Out dims or hides the workspace grid. This is MasterBot's viewport area: keep it to the smallest fix and say so in the commit message.
- Leave Elan's `cursor: move` at `styles.css` ~12715 alone; Argi decides it.

## Part B: gradient and mutator points and curves
# Gradients and Mutators: visible points and transition curves

Date: 2026-11-27. Argi's decision: gradients and mutators stay **separate systems** (separate data, pages and modules), but both get envelope points you can see and edit, plus a transition curve on every segment.

## Where things stand (read before coding)

- **Gradients** (`public/node-graph-gradients.js`, `node-graph-gradient-page.js`, `node-graph-gradient-lanes.js`, `modules/gradient/gradient-module.js`; design in `docs/MODULE_GRADIENTS_AND_PRESETS_PLAN.md`).
  - A gradient is `{ id, name, enabled, position, origin, params, stops: [{ id, pos, offsets: { nodeId: { key: sliderOffset } } }] }`.
  - A **stop is a keyframe that groups many params**: one position holds offsets for every param in the gradient. This is the difference from mutators, and it stays.
  - Today, continuous params move **linearly** between stops in slider space, and choice/switch/integer params snap at the halfway point. Stops have no curve shape.
- **Pitch Mutator** (`public/pitch-mutator-engine.js`, `node-graph-pitch-mutator-overlay.js`, `node-graph-pitch-mutator.css`; design in `docs/MUTATOR_PLAN.md`).
  - Mutators work **one lane per param** (a freq lane plus knob lanes). Each key already stores `shape` and `skew`, which are evaluated with the shared `nodeGraphSegmentCurve01` (`public/node-graph-segment-curves.js`), then baked into 128-entry LUTs.
  - Check how much of that the Mutator page lets you see and edit today. Report what's missing (visible points, dragging points, picking a segment's shape, skew handle).
- **Shared curve maths:** `public/node-graph-segment-curves.js` (`nodeGraphSegmentCurve01(t, shape, skew)`) is already used by the mutator, graph utils and the live worklet. **Both systems use this one function for segment shapes.** Don't write a second curve implementation.

## Goal

### Both systems

- **Visible envelope points.** Every key or stop is drawn as a point on its page's curve view, and the segments between points are drawn with their real shape (the same maths the audio uses, so what you see is what you hear).
- **Transition curves per segment.** Each segment (from a point to the next one) has its own shape and skew, picked from the shapes `nodeGraphSegmentCurve01` already supports. The default is linear, so existing behavior doesn't change until you edit it.
- **Editing.**
  - Tap or click empty space to add a point, drag a point to move it, and remove a point with the page's existing delete gesture.
  - Drag on a segment's middle handle to bend its skew, and pick the segment's shape from in-page choice buttons.
  - No tooltips or popups. Everything must work on a phone.
- **WebGL only.** Draw the curve views as WebGL like the other displays. No 2D canvas or DOM drawing for the curves.
- **Events only.** No timers or polling, and redraw on change.
- **Audio rate.** The live engine has to use the curve shapes too, not only the UI: gradient lanes LUT (`laneLut`) and mutator LUTs bake the shaped segments.

### Gradients: points stay together, curves don't

- **Points and positions stay grouped:** a stop is still one keyframe position shared by every param in the gradient. Moving, adding or deleting a stop does it for all params at once.
- **Curves are per param:** each param has its own shape and skew for each segment (from this stop to the next one). Bending one param's segment doesn't change any other param.
- Store it next to the offset: `stops[i].curves[nodeId][key] = { shape, skew }`. A missing value means linear.
- Choice, switch and integer params still snap. With a shaped segment, they snap where the **shaped** curve crosses 0.5, not at the halfway position.
- Ends still hold their end values, and limits still come only from the parameter definition's range.
- The gradient page gets a curve view: stops as points along the position axis, with the current playhead shown. Because a stop holds many params, show the selected param's value curve. Curve editing (shape and skew) applies to the selected param only, while dragging a point moves the shared stop for every param. With no param selected, show the stops as points on the position axis and don't offer curve editing.

### Mutators: per lane

- Each lane keeps its own keys with shape and skew. Make sure all of it is visible and editable on the Mutator page for both the freq lane and the knob lanes.

### Gradient display: mouse interaction

- The gradient display (the module face and the curve view) gets direct mouse and touch interaction like the knob and slider displays: drag on the display to change the value, using the same drag direction, sensitivity, fine-drag modifier, double-click reset and wheel behavior those displays already use. Reuse their existing interaction code; don't write a new one.
- On the gradient display, dragging moves the gradient's position (the playhead). Dragging a point or a segment handle still edits points and curves as described above.
- No hover effects, animations or hand cursor. Use the same cursors the knob and slider displays use.
- Test it: a browser test drags the gradient display and checks the position changes, and double-click resets it, including at phone width.

## Bias mutators (later, design note only)

- Argi wants **bias mutators** eventually: a mutator that leans a param toward one side instead of moving it over time. Don't build it now, but don't design the curve storage in a way that blocks it. A bias lane would be a lane whose input holds still.

## Rules

- Keep them separate: no shared data model, no merging of pages or modules. Only `nodeGraphSegmentCurve01` is shared.
- No legacy code. Don't check or migrate old patches; a missing shape just reads as linear.
- No dead code. If drawing code is replaced, delete the old version.
- Face-row and module rules as usual: phone friendly, wire color from the IN jack, docked tips panel for help text.
- Work in the repo directly. Commit only your own hunks and keep each file's line endings. Merge `origin/master` (no rebase), and don't push without Argi's yes.
- Bump `?v=` tags in `index.html` and `perform.html` for every changed script without replacing another agent's tag.
- Never kill or restart Argi's servers; use your own test port.
- Check `docs/KNOWN_BUGS.md` first.

## Tests

- **Shape maths:** a gradient segment with a given shape and skew produces the same values as `nodeGraphSegmentCurve01` at 9 points. The same goes for a mutator lane.
- **Audio path:** the gradient lane LUT and the mutator LUT match the UI curve within LUT resolution.
- **Linear default:** a gradient or mutator with no shapes set gives exactly the same output as before this change.
- **Grouping:** moving a stop moves it for every param, while setting one param's segment curve leaves the other params' curves unchanged.
- **Snapping:** a choice param snaps where the shaped curve crosses 0.5.
- **UI (browser test, one browser at a time):** you can add, drag and delete a point and bend a segment on both pages, including at phone width, with no page script errors.

## Report back

- What the Mutator page was missing before.
- Commits.
- Argi's Ctrl+F5 checklist.

## Addendum (Argi, newer wins over anything above)

### Gradient display on the module face

- It shows the stops, the playhead and the gradient's colors. **No curve editing on the gradient display**: no point dragging, no segment handles and no shape picking there. Curve editing happens only on the 🌈 page curve view.
- It also draws each segment's curve line (read-only, with the same `nodeGraphSegmentCurve01` maths), so the shape is visible at a glance. Use the selected param's curves; if no param is selected, use the first param in the gradient.
- The mouse interaction from the section above stays: dragging the display moves the gradient's position (the playhead), like the knob and slider displays, with double-click reset.

### Gradient module display options

- Add display options to the Gradient module in the same display-settings place other module displays use: **Playhead Alpha**, **Playhead Color** and **Playhead Thickness**. Defaults match today's look. They're saved with the patch.

### Stop colors in the gradient Command Center window

- In the 🌈 Command Center window, each stop's color can be changed with the app's existing color picker. Store it as `stops[i].color`; a missing value uses today's color. The module display, the 🌈 page and the curve view all use the stop color.

### Tests

- The gradient display ignores point and curve-edit gestures, and dragging it moves the playhead.
- The three playhead options change the drawn playhead and survive save, load and clone.
- A stop color set on 🌈 shows on the module display and survives save, load and clone.

### Bug fix: module title editing (do with the other bug fixes, before the curves work)

- While a module title is being edited, hide that module's WebGL title text so only the text being typed shows. Nothing should be drawn under or on top of the edit field.
- When the edit is committed or canceled, the WebGL title comes back once, showing the new text (or the old text on cancel). No flicker and no extra text rebuilds for other modules.
- Test it: a browser test starts a title edit and checks the module's GL title isn't drawn. It then commits and checks the new title is drawn, and does the same for cancel.
