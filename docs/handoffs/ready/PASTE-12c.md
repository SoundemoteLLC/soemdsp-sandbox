# PASTE-12c: New Gradient flow + 0-1 positions

Follows PASTE-12b (commits 4b273901, 0dc59a80). Gradient only; do not touch the Mutator.

## Problem
In PASTE-12b you have to move controls before the first Snapshot just to establish a gradient. That is backwards: Argi should not have to change his settings to start one.

## Spec
1. **Positions become a 0-1 bias** instead of 0-127 (stops, playhead, position labels, display). Migrate any saved gradient data (divide old positions by 127). Zero-based stop numbering (stop 0, stop 1, ...).
2. **New Gradient button** on the Gradient page toolbar (and module if there is room). Pressing it:
   - creates a new empty gradient,
   - turns Edit on,
   - places the playhead at 1,
   - creates stop 0 at position 0 holding the current settings.
3. **First param move after New Gradient**: creates stop 1 at the playhead (1). That param joins the gradient: stop 0 = its original value, stop 1 = the value being dialed in live while dragging. No Snapshot press needed.
4. **Each further param touched** joins the same way: its stop 0 value = where it was, its value at the current stop = where it is moved to.
5. **Moving the playhead then adjusting a param** (playhead not on a stop): creates a new stop at the playhead for ALL params. Params not being touched take their current curve value at that position (no jump; a param with no ramp stays flat). Only the param being adjusted is bent at that stop.
6. Playhead snapping and live editing of a snapped stop (from 12b) stay, as does click-a-stop-to-edit. Snap window: +/-2/127 in the new 0-1 units.
7. **Snapshot button stays**, for explicitly dropping a stop at the playhead with current values.
8. **Gold box**: in Edit mode, every param that has joined the gradient gets the existing gold box/outline around its control (reuse the existing gold style if one exists; otherwise a plain gold 1px outline). It appears the moment the param joins.
9. Fix the open 12b bug: double-click on the playhead resets exactly to its default and bypasses snapping (test_gradient_module_live.mjs).
10. Policies: no hover effects, no animations, no tooltips, shared mouse-dot cursor, params single source of truth, event-driven redraws only, no WebGL in the Command Center.

## Done when
- New Gradient -> Edit on, playhead at 1, stop 0 visible, nothing else changed.
- Move param A -> stop 1 appears at 1, A ramps from old to new value live, gold box on A.
- Move playhead to 0.5, adjust param B -> stop at 0.5 for all params, A unchanged (no jump), B bent at 0.5, gold box on B.
- Old saved gradients load at the right 0-1 positions.
- Playhead double-click resets to default.

## Testing scope
- Test only the Gradient module/page files touched and their direct dependents (test_gradient_page.mjs, test_gradient_stop_edit.mjs, test_gradient_module_live.mjs).
- Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box. Stop after reporting; do not start the next plan.