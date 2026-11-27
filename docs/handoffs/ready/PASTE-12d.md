# PASTE-12d: Gradient polish (param colors, right-click settings, drop Snapshot)

Follows PASTE-12c (commits 7b93cc2b, 84503198). Gradient only; do not touch the Mutator.

## Spec
1. **Remove the Snapshot button** (page toolbar and module). The New Gradient live flow replaces it. Remove its code paths and tests that only exist for it; keep stop creation via param moves, playhead snapping and click-a-stop-to-edit.
2. **Joined-param box uses the param's own color**: each param gets an auto-chosen color when it joins the gradient (the same color as its chip and curve). The outline around that param's control must be that color, not gold. One source of truth for the color.
3. **Right-click opens param settings**: right-clicking a param's curve on the gradient graph, or that param's slider/control, opens that param's gradient settings. Include at least **Smoothing** (per-param), plus the existing per-param items if any (color, remove from gradient). Use the existing settings/popup style; no hover effects, no animations, no tooltips.
4. **Playhead double-click reset (still failing in test_gradient_module_live.mjs, sees 0.178571 instead of 0)**: first check whether the test is stale (e.g. it double-clicks a spot that now lands on a stop or a different element, or expects 0 while the new default playhead is 1). If the test is stale, fix the test to match the intended behavior: double-click resets the playhead exactly to its default, bypassing snapping. If the code is wrong, fix the code. Report which one it was.
5. **Legacy positions (answer to 12c question 1)**: leave ambiguous saves that only contain positions 0 and 1 as-is.
6. Policies: no hover effects, no animations, no tooltips, shared mouse-dot cursor, params single source of truth, event-driven redraws only, no WebGL in the Command Center.

## Done when
- No Snapshot button anywhere.
- A param joining the gradient gets an outline in its own chip/curve color.
- Right-click on a curve or slider opens that param's settings with Smoothing that audibly/visibly affects it.
- test_gradient_module_live.mjs passes.

## Testing scope
- Test only the Gradient module/page files touched and their direct dependents (test_gradient_page.mjs, test_gradient_stop_edit.mjs, test_gradient_module_live.mjs).
- Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box. Stop after reporting; do not start the next plan.