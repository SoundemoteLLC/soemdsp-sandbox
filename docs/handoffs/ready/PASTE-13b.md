# PASTE-13b: Fixes after PASTE-13 (Gradient + Pitch Quantizer)

Run BEFORE PASTE-14. Fix item 1 first.

## 1. POLICY BREAK (fix first)
PASTE-13 added HTML/JS buttons on top of the Gradient display module in the circuit builder. App policy: NO HTML/SVG rendering in the circuit builder. Remove every HTML/SVG/JS button or overlay added to the Gradient module face. Module-face controls must be drawn in the module's own canvas render path like other modules, or live only on the Command Center Gradient page. Also remove any scrollbars PASTE-13 introduced.

## 1b. Gradient display drag conflict
Clicking/dragging on the Gradient module's display moves the Blend AND drags the module at the same time. A press on the display must only move the Blend: consume the pointer event (stop propagation to the module-drag handler) the same way other interactive module displays do. The module is still draggable from its title/frame.

## 2. Joined-param boxes
- Boxes must appear immediately when Edit turns on / a param joins (currently they only appear after an extra click in the circuit builder forces a redraw). Trigger the redraw from the Edit/join event.
- Box color = that param's gradient color (not gold).
- Colors are randomly chosen for now: each new gradient stop and each param gets a random color on creation (param color used for its graph curve, chip and box). Store it so it stays stable after reload.

## 3. Right-click on the Gradient page
Nothing on the Gradient page opens param settings on right-click. Right-clicking the gradient's own controls on the page (Playhead/slider and the gradient's own params) must open that gradient param's settings (with Smoothing), with preventDefault. Not other modules' params.

## 4. Gradient page wording and buttons (save space)
- Rename "Touching Selected" to "Touching".
- Delete stop becomes a ➖ emoji button.
- On/Off becomes ✔️ / ❌ emoji buttons (fixed width).
- Rename "Playhead" to "Blend" everywhere in UI text (label, settings, hotkeys page if listed). Keep internal ids/saved keys compatible.

## 5. Pitch Quantizer
- Clicking a key on the display must toggle that key on/off for quantization (currently impossible). Event-driven redraw.
- Keyboard display settings page: color controls go at the BOTTOM of the page, below the slider settings (standing rule: colors always last).

## 6. More fixes
- Joined-param boxes stay visible after deleting the gradient until the module is moved. Deleting a gradient (or a param leaving it) must clear its boxes immediately (event-driven redraw).
- **Pitch Quantizer default spawn settings** (from Argi's patch): params scaleMask 2741, octave 0, semitones 0, fretting 0 (Fretting default stays 0). widthGu 10. ui.buttonsHidden true, ui.displayHeightGu 3. traceDisplaySettings: enabledColor #3dffd0, playingColor #ffcf6b, naturalColor #20252a, sharpColor #f7f2e8, blackKeyWidth 12.945455, blackKeyHeight 57.336364, keyLabels "name", keyLabelSize 315.
- **Display settings sliders must show their current value** (e.g. Sharp width/height currently show no number, so Argi can't tell what is selected). Use the same value readout as normal param sliders.

## Policies
No HTML/SVG in the circuit builder, no hover effects, no animations, no tooltips, no popups, shared mouse-dot cursor, params single source of truth, event-driven redraws only, buttons never resize with text, no WebGL in the Command Center.

## Testing scope
- Test only the Gradient and Pitch Quantizer files touched and their direct dependents. Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box. Stop after reporting; do not start the next plan.