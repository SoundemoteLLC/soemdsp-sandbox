# Hypersaw: grouped Jitter and Vibrato controls (plan for the AI brain)

Goal: make Hypersaw's Jitter and Vibrato section compact, about 150 px instead of about 200 px, by giving each group
a small header strip and an XY pad. This is a face-layout change only. The DSP, param keys and ranges do not change.

Approved mockup: layout "A" (XY pad on the left, a tall vertical-fill cell beside it, and a header strip with the
toggles inline).

## Copy, don't invent

- **XY pad:** copy the existing shared `xy` face row used by Analog Distortion's Magnet
  (`public/modules/analogDistortion/analog-distortion-register.js`, row
  `{ kind: "xy", x: "magX", y: "magY", label: "Magnet", cell: ["magnet", "Magnet"], h: 124 }`).
  It is rendered by `public/node-graph-module-face.js` (`xyPad` widget). Use it as is: it already has the mouse
  rules, the jacks stacking down the rail, and the tall cell beside the pad.
- **Sliders:** use our existing vertical-fill cells (a normal `cells` entry without the `"horizontal"` flag), not
  horizontal sliders. The `cell` beside the XY pad is already one of these.

## New face (in `public/node-graph-module-definitions.js`, the Hypersaw face, about line 6133)

Replace the 7 Jitter and Vibrato rows with:

1. **Jitter header strip:** the label "Jitter", then the Fixed/Random (`jitterSteps`) and Wavelength/Division
   (`jitterDistanceTiltSource`) choice buttons inline on the same strip.
2. **Jitter XY:** `{ kind: "xy", x: "jitterDistance", y: "jitterSpeed", label: "Jitter", cell: ["jitterFilter", "Filter"] }`.
   X is Distance and Y is Speed, and the Filter vertical-fill cell sits beside the pad.
3. **Vibrato header strip:** the label "Vibrato", then the Wavelength/Division (`vibratoDistanceTiltSource`) choice buttons inline.
4. **Vibrato XY:** `{ kind: "xy", x: "vibratoDistance", y: "vibratoSpeed", label: "Vibrato", cell: ["vibratoPhaseVary", "Phase Vary"] }`.

Pick a pad height so the whole section is about 150 px. The Magnet pad's `h: 124` is too tall for this.

## Header strip (the only new piece)

There's no face row yet that puts a group label plus inline choice buttons on one thin line. Add a single shared
row kind for it, for example `{ kind: "group", label, choices: [{ param, labels }] }`, in `node-graph-module-face.js`.
Document it in the row-kind comment at the top, next to `xy`, so other modules can reuse it later. Choice buttons
must use the same drawing and mouse code as the existing `choices` row, with short labels so they fit
(Fix/Rnd, Wave/Div). It's drawn in WebGL like the rest of the face.

## Rules

- Every control must still show its value. The XY pad has to print both X and Y values, with units ("Hz" on Speed),
  inside or beside the pad. If the Magnet pad doesn't show values today, add that to the shared `xy` row so every
  XY pad gets it.
- Labels must be clear: "Distance" and "Speed" on the pad axes, and "Filter" and "Phase Vary" on the cells.
- The face must stay phone friendly. No tooltips or popups, events only, WebGL only, and no dead code: delete the
  old rows completely.
- No legacy code: no aliases or shims, and don't check old patches. While you're in the file, `node-graph-hypersaw2.js`
  still reads `options.vibratoAmp` and `options.jitterSpeedHz` as fallbacks. Delete those unless they're actually in use.
- Bump the `?v=` tags in index.html and perform.html for every touched script, and don't overwrite another agent's tags.

## Report back

- The final section height in px (it should be about 150).
- The screenshot or a description of the new face.
- Whether the shared `xy` row needed the value readout added.
