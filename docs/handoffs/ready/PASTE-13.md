# PASTE-13: Gradient finish (12e) + Pitch Quantizer Fretting

One round, two parts. Do Part A first, then Part B.

## Record: results since PASTE-12d (saved per Argi)
- 12d: 910e4d4a Snapshot removed; 3f9125fd param colors for chip/curve/outline; 543c4279, ea971bd7 right-click settings; f99f9abb, 2888d0d7, e98b3af2 playhead reset path; 757815ed, 0bf799be, 9f892d13, 853afcbb test fixes.
- 1f534182: double-click reset fixed. It was a stale test target: after the module was dragged, the test reused old coordinates and hit a patch-point inlet. The test now finds the current face bounds. test_gradient_module_live.mjs passes.
- f0cb77fe: right-clicking the Command Center Gradient page playhead slider opens the bound Gradient module's Playhead settings (with Smoothing). Curve and joined-param context menus were removed on purpose: Argi only wants the gradient's OWN params (e.g. Playhead) to open from the page, not other modules' params.

## Part A: Gradient
Carry out docs\handoffs\ready\PASTE-12e.md in full (jump bug first, per-gradient Edit, Snapshot back per gradient, remove Set Start, delete gradient = trash emoji, fixed-width buttons). Its double-click item is already done (1f534182); skip it. Keep the f0cb77fe right-click behavior.

## Part B: Pitch Quantizer
1. **Restore the rounded key look on natural (white) keys.** Only the sharps still have rounded corners. Find the regression; do not redesign.
2. **New parameter: Fretting** (0-1, default 0 = current strict quantize, so existing presets are unchanged).
   - 0: strict hard steps (as now).
   - Rising: each step edge becomes a smoothstep glide between neighbouring scale degrees, so a pitch sweep "sticks" on each note like a fret and glides to the next.
   - 1: no quantizing (output = input pitch).
   - Pure remap of the pitch value. Continuous and monotonic at every setting (no backwards pitch, no clicks).
   - If the module has a transfer display, show the curve (event-driven redraw only).
3. **No Scala/.scl/.kbm and no MTS in this round** (Argi deferred Scala; MTS rejected).

## Policies
No hover effects, no animations, no tooltips, shared mouse-dot cursor, params single source of truth, event-driven redraws only, buttons never resize with text, no WebGL in the Command Center.

## Done when
- Everything in PASTE-12e's Done-when (except double-click).
- Pitch Quantizer natural keys are rounded like the sharps.
- Fretting 0 is identical to before, 0.5 gives sticky glides, 1 gives an unquantized sweep.

## Testing scope
- Test only the Gradient and Pitch Quantizer files touched and their direct dependents (test_gradient_page.mjs, test_gradient_stop_edit.mjs, test_gradient_module_live.mjs, plus Pitch Quantizer tests).
- Add a small Fretting continuity/monotonicity test at 0, 0.5 and 1.
- Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box per part. Stop after reporting; do not start the next plan.