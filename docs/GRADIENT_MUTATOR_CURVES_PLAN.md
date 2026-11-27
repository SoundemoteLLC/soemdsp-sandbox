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
