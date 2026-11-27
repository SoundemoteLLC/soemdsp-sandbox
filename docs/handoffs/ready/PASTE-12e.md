# PASTE-12e: Per-gradient Edit, Snapshot back, Set Start gone

Follows PASTE-12d. Gradient only; do not touch the Mutator. Run after 12d has landed.

## Spec
1. **Per-gradient Edit button**: replace the global Edit on/off with an Edit button on each gradient (module and its entry on the Gradient page). Only one gradient can be in Edit at a time: turning Edit on for one turns it off for any other. The gradient being edited must be obvious (its Edit button lit).
2. **Bring Snapshot back** (12d removed it; Argi wants it): with Edit OFF, set params however you like, then Snapshot writes a stop (keyframe) at the playhead with ALL of that gradient's params at their current values. If a stop is at/snapped to the playhead, update it; otherwise create one. Playhead does not move. One Snapshot button per gradient, next to its Edit button.
3. **Remove "Set Start"**: it does nothing. Remove the button and any dead code/tests for it.
4. Keep everything else from 12c/12d (New Gradient live flow, param-colored outlines, right-click param settings with Smoothing, no + Param chip, playhead snapping, click-a-stop-to-edit).
5. Policies: no hover effects, no animations, no tooltips, shared mouse-dot cursor, params single source of truth, event-driven redraws only, no WebGL in the Command Center.

## Done when
- Two gradients: Edit on A, then Edit on B -> A turns off.
- Edit off, move params, Snapshot -> keyframe at playhead with all that gradient's params at current values.
- No Set Start button.

## Testing scope
- Test only the Gradient module/page files touched and their direct dependents (test_gradient_page.mjs, test_gradient_stop_edit.mjs, test_gradient_module_live.mjs).
- Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box. Stop after reporting; do not start the next plan.