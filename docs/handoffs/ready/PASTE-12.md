# PASTE-12: Gradient + Mutator UI/UX pass

Date: 2026-11-27. Goal: make the 🌈 Gradient page, Mutator page, and Gradient module face clean and usable. The functionality already works; this is a visual and layout pass only. No new features. Don't push.

Rules: no setInterval or polling, no hover effects, no animations, no tooltips, no hand or arrow cursors (`docs/APP_POLICY.md` §24; use the shared mouse-dot cursor), no WebGL in the Command Center (§26 — SVG, DOM, or 2D canvas only), audio only while playing. Stay off the Mix and Stereo Mix files. Stage only your own files, merge (never rebase), and use your own test port. Never restart Argi's servers. Param definitions are the single source of truth for ranges and limits. Displays are 1:1 pixel-honest. Event-driven redraws only. Low cognitive load.

## Context

The system works (PASTE-9, then PASTE-11):

- SVG points-and-curves on the Mutator page (`public/node-graph-pitch-mutator-overlay.js`, `[data-pm=plot]`, styles in `public/node-graph-pitch-mutator.css`) and on the selected param of the 🌈 Gradient page (`public/node-graph-gradient-page.js`, `.node-gradient-curve-chart`, styles in `public/styles.css`).
- Mutator gestures: double-click to add a point, drag to move one, right-click (or touch/pen long-press) to delete one.
- Shared stop positions; per-param curves stored as `stops[i].curves[nodeId][key] = {shape, skew}`. Shared maths: `public/node-graph-segment-curves.js`. Stop colors: `stops[i].color`.
- The Gradient module face (`public/modules/gradient/gradient-module.js`) is WebGL (correct under §3): strip, stop colors, stops, read-only curve lines, and a playhead, with Playhead Alpha / Color / Thickness options.

Argi's take: the current UI is extremely ugly, but it works. Get the layout and look right now; do not add features.

## What to do

Audit both Command Center pages and the Gradient module face, then fix:

- Layout, spacing, alignment, sizing, grouping, and labels.
- Consistent control styles that match the rest of the Command Center.
- A clear visual hierarchy: the curve/points view is the main focus; controls are grouped beneath or beside it; redundant or duplicate controls are removed; the selected param and the selected stop are obvious.
- The Gradient and Mutator editors should look and behave alike: same point/curve drawing, same gestures (double-click add, drag move, right-click / long-press delete).
- Keep phone width working.

Do not invent a new data model. Do not move curve drawing into WebGL on the Command Center pages. The Gradient module face may stay WebGL.

Files you are likely to touch: `public/node-graph-gradient-page.js`, `public/styles.css` (gradient page classes such as `.node-gradient-card`, `.node-gradient-curves`, `.node-gradient-curve-row`), `public/node-graph-pitch-mutator-overlay.js`, `public/node-graph-pitch-mutator.css`, and `public/modules/gradient/gradient-module.js` (face only; no new face features).

## Judgment calls

If a UX choice is a real judgment call (not an obvious cleanup), do not guess big. List it as a numbered question for Argi in the report.

## Report back

Commit each change separately, staging only your own files. Don't push. Report the commits, what you changed, any numbered open questions, and a short Ctrl+F5 checklist for Argi.

## Testing scope
- Test only the Gradient page, Mutator page, and Gradient module face, plus their direct dependents. Existing tests such as `scripts/test_gradient_page.mjs` and `scripts/test_pitch_mutator_knob_lane_browser.mjs` are in scope if your changes touch what they cover.
- Run each test once. After a fix, re-run only the tests that failed.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. A plan cannot pre-authorize it.
- Time box: stop testing at 15 minutes and report what you have.
- After reporting, stop. Do not start the next plan.
