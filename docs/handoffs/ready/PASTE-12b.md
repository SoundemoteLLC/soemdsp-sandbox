# PASTE-12b: Gradient Edit mode + Snapshot (UX and function)

Follows PASTE-12. Gradient only; the Mutator is fine as is, do not touch it.

## Problem
Making snapshots and gradients feels wrong:
1. There is no dedicated Snapshot button.
2. You can't just press snapshot, move controls, snapshot again: moving a control changes the offset instead of being a gradient interaction.
3. There is no gradient editing mode, so the slider moves when you adjust a param instead of a ghost showing the pending value.

## Goal: the loop
Turn Edit on -> Snapshot -> move playhead -> move some controls -> Snapshot -> repeat.

## Spec
1. **Edit toggle** on the Gradient page toolbar. Off by default. State is UI-only (not saved in the preset) unless the existing gradient state already stores UI flags.
2. **Snapshot button** next to Edit on the Gradient page toolbar, plus a small Snapshot button on the Gradient module itself. Both call the same function.
3. **While Edit is on**, moving any control does NOT change the param offset or the live slider position. Instead it sets a pending value for that param, shown as the existing ghost marker on the control (and on the graph as that param's pending point at the playhead). The slider itself stays put.
4. **Snapshot** writes all pending values into a stop at the current playhead position, then clears the pending values. If a stop already exists at that exact position, update it; otherwise create a new stop. Params not touched since the last snapshot take their current curve value at the playhead (so the new stop doesn't jump).
5. **Untracked params**: touching a param that is not in the gradient yet adds it to the gradient on Snapshot (new chip, new color, values filled at existing stops from the param's current value so nothing jumps).
6. **Playhead does not auto-advance** after Snapshot. The user moves it.
7. **Editing existing stops**: clicking directly on a stop still makes it editable (keep that). ALSO add playhead snapping (Argi approved this "toy" feel on purpose): while dragging the playhead, it snaps onto a stop when within +/-2 positions (of 0-127); the snapped stop is drawn highlighted (outline/brighter, no animation) so "on a stop" is a clear visible yes/no. In Edit mode, while snapped, moving controls edits that stop live (values update immediately, ghosts follow). Dragging further breaks the snap. When not snapped, controls set pending values and Snapshot makes a new stop.
8. **Edit off**: controls go back to the current offset behavior exactly as before. Pending values that were never snapshotted are discarded when Edit turns off.
9. Policies: no hover effects, no animations, no tooltips, shared mouse-dot cursor, params stay single source of truth, event-driven redraws only, no WebGL in the Command Center.

## Done when
- Edit on, Snapshot, move playhead, move 2 controls (sliders do not move, ghosts do), Snapshot -> two stops exist and the graph shows the crossfade between them.
- A control not in the gradient, touched in Edit, appears as a new param chip after Snapshot.
- Edit off -> controls act as offsets again, nothing else changed.
- Drag playhead near a stop -> it snaps and the stop highlights; in Edit, moving a control changes that stop live; drag away -> snap releases.

## Testing scope
- Test only the Gradient module/page files touched and their direct dependents.
- Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box. Stop after reporting; do not start the next plan.