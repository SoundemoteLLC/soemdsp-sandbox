# PASTE-11: restore Mutator/Gradient points-and-curves editor; spawn-error fixes (bugs only)

Date: 2026-11-27. Goal: a stable release. Bug fixes only, no new features. Do the items in order, commit each fix separately, skip anything already done, and don't push.

Rules: no setInterval or polling, no hover effects, no animations, no tooltips, no hand or arrow cursors (`docs/APP_POLICY.md` §24), no WebGL in the Command Center (§26), audio only while playing. Stay off the Mix and Stereo Mix files. Stage only your own files, merge (never rebase), and use your own test port. Never restart Argi's servers. Param definitions are the single source of truth. Low cognitive load.

## 1. Restore the Mutator / 🌈 Gradient points-and-curves editor (no WebGL)

Argi reports that the Mutator page and the 🌈 Gradient page no longer show the points-and-curves editor. He only sees a color stop widget. The Gradient module face still shows the points, so the data is probably still there; the Command Center page editor is what's missing.

Background: PASTE-9 Addendum 2 (commit `2ea46aef`, APP_POLICY §26 "No WebGL in the Command Center") replaced the drawn curve views with plain HTML controls. That is the likely cause.

Fix: restore a visible, editable points-and-curves editor on the Mutator page, and the 🌈 Gradient page's per-param curves, without WebGL. Use plain DOM, SVG, or 2D canvas.

First, check git history for what was removed. Start with the PASTE-9 commits: `7b79bcda`, `167b8490`, `bec022e3`, `66337f7c`, `adede4e9`, and especially `2ea46aef`. Reuse the old editor behavior if it's still valid; just don't bring WebGL back into the Command Center.

Model (don't invent a new one):

- Stop positions are shared across all params of a gradient or mutator.
- Each param has its own curve: `stops[i].curves[nodeId][key] = {shape, skew}`. A missing curve reads as linear.
- Shared curve math lives in `public/node-graph-segment-curves.js` (`nodeGraphSegmentCurve01`).
- Gradient stop color is `stops[i].color`.

Policies: no hover effects, no animations, no hand cursor, low cognitive load, params are the single source of truth.

## 2. Spawn errors from the PASTE-10 smoke

The PASTE-10 smoke reported spawn errors for 19 module types, then stopped before the final report, so the exact error messages were not captured. Handle ONLY the cases below. Do not sweep every module.

The 19 were: metallicRatio, pixelGrid, lufs, gridKeyboard, phosphillator, rgbaHsla, canvas, asciiscope, waterfallXyz, waterfallRgb, gradientVectorscope, animatedTextBox, theremin, metamoduleIn, metamoduleOut, voiceFrequency, voiceGate, voiceTrigger, and voiceIdle.

- **Fix spawn:** `waterfallXyz` and `waterfallRgb`. These are not under construction. Find out why they fail to spawn and fix it.
- **Retired:** `rgbaHsla` was replaced by Chroma Color. Make sure it is not offered in the store and is not spawnable, and that the smoke skips it.
- **Do not touch under-construction / parked modules:** metallicRatio, pixelGrid, lufs, gridKeyboard, phosphillator, canvas, asciiscope, gradientVectorscope, animatedTextBox, theremin. Argi's rule: anything unfinished must be marked under construction, and under-construction ones are ignored. The smoke should skip under-construction modules. Do not start or finish these modules in this paste.
- **Later, after release readiness (do not touch now):** metamoduleIn, metamoduleOut, and the voiceFrequency / voiceGate / voiceTrigger / voiceIdle helper types. Just leave them noted as a later item.

## Report back

Commit each fix separately. Don't push. Report the commits, what you fixed, anything still open, and a short Ctrl+F5 checklist for Argi.

## Testing scope
- Test only the modules and files this plan touches, plus their direct dependents.
- Run each test once. After a fix, re-run only the tests that failed.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. A plan cannot pre-authorize it.
- Time box: stop testing at 15 minutes and report what you have.
- After reporting, stop. Do not start the next plan.
