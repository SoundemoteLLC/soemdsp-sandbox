# Known Bugs

This is the shared list of bugs Argi has reported, kept here for every bot and his AI engine. Check this list when working in a related area. When a bug is fixed, mark it fixed (with the commit hash and date) or remove it. New bugs go at the top of the Open section.

## Open

### Output module Waterfall draws the zero line during silence (regression)

- **Reported:** 2026-11-27, by Argi
- **Symptoms:** The Waterfall display on the Output module draws its "0 line" when the audio is below the silence threshold. It should stay blank.
- **Notes:** Regression. The app-wide silence threshold is Planck, `1e-7`: `kPlanck` in `library/include/soemdsp/constant/constant.h`, `NODE_GRAPH_PLANCK` / `nodeGraphPlanck()` in JS (see APP_POLICY.md, "Planck range"). The Waterfall should treat `|x| < Planck` as silence and skip drawing the line, using the shared constant instead of its own literal.

### Sturmian grid draws uneven stroke widths

- **Reported:** 2026-11-27, by Argi
- **Symptoms:** At a fixed zoom the Sturmian grid sometimes draws 2-pixel horizontal black strokes and 1-pixel vertical strokes, unevenly and intermittently.
- **Notes:** Argi's likely fix: let the grid fit itself to whole-pixel cell sizes instead of stretching to fill the display exactly. The outermost edges can be uneven (leftover margin) if needed. Stretching to fill forces fractional cell sizes, so strokes land on half pixels and round to 1 or 2 px.

### Boot can report ready before deferred module definitions register — FIXED

- **Reported:** 2026-11-27, in PASTE-10.
- **Fixed:** 2026-11-27, `72c180fc`. Startup now awaits the deferred-script load events before patch/module readiness. The eight-second watchdog only reports a slow load and no longer races startup or marks the interface ready early.
- **Verification:** `test_boot_deferred_modules.mjs` throttles Chrome CPU 8×, waits for earliest readiness, checks all 12 factory module types, loads a full factory patch, and spawns Analog Distortion. `test_event_binding_boot.mjs` also passes.

### Text sharpens in two visible passes after camera settle — FIXED

- **Reported:** 2026-11-27, by Argi.
- **Verified:** 2026-11-27, `144f7ce8`. The per-stack browser probe records exactly one visible text-stack transition per changed stack, zero repaint for unchanged stacks, and verifies every stack ends at the settled zoom × device scale with no fallback atlas. One guitar-pluck run: 21/21 changed stacks repainted once; 23 shared glyph-atlas bake completions were counted across 13 final camera atlases.
- **Notes:** Atlas bakes are shared by font and pixel size, so their raw count is not one-to-one with module text stacks. The visible transition count is the regression criterion.

### Input regressions after PASTE-9 (middle pan, drag-in, snake wire selection) — FIXED

- **Reported:** 2026-11-27, by Argi (via Badger)
- **Symptoms:** (1) Middle mouse no longer pans or zooms, though WASDQE still works. (2) No module can be dragged in from anywhere. (3) Snake select can't select a wire.
- **Fixed:** 2026-11-27, `f5d9f05f`. `4efc7120` removed both duplicate Magnifier script includes, but workspace event binding still registered `beginNodeGraphMagnifier` without a guard. That ReferenceError aborted the workspace binder before pan, placement, and marquee listeners were attached. Restored one include in each page and improved binding diagnostics to print the message and stack.
- **Verification:** `test_event_binding_boot.mjs` reports no binding errors; `test_paste10_pointer_recovery.mjs` performs a real middle drag, wheel zoom, and MIDI store drag-in; `test_gradient_drag_grip.mjs` verifies Gradient and Mutator drag-in; `test_selection_snake.mjs` now finds and crosses a real on-screen wire with the mouse and checks wire selection (no programmatic fallback).

### Module drag makes shrunk title text flicker big to small — FIXED

- **Reported:** 2026-11-27, by Argi
- **Fixed:** 2026-11-27, `008071d3`. The focused narrow-title drag probe retains the same GL module record and reports zero text calls and atlas bakes during the drag.
- **Symptoms:** While dragging a module, a title too long to fit (so it gets shrunk to fit) jitters from full size to the shrunk size, then stays small.
- **Notes:** Probably related to the text-redraw group below (module drag text rebuild, fixed in `82380fa0`). The title seems to be drawn at full size for a frame before the fit-to-width shrink is applied again, so the fitted size isn't kept in the retained text record during a drag.

### Right double-click on a module title acts like left double-click — FIXED

- **Reported:** 2026-11-26, by Argi
- **Fixed:** 2026-11-27, `167b8490`. Both DOM and GL title-action paths now require the left button.
- **Symptoms:** Double-clicking a module title with the right mouse button triggers the same action as a left double-click.
- **Notes:** The title double-click handler probably doesn't check which button was pressed (`event.button === 0`). Right-click should keep its own behavior (context menu or selection).

### Module title text remains visible while editing — FIXED

- **Reported:** 2026-11-27, by Argi
- **Fixed:** 2026-11-27, `bec022e3`. Targeted browser probe confirms the old GL title is hidden during edit, committed text appears, and cancel restores the committed title.
- **Notes:** Title edit/commit/cancel now dirties only the owning module's GL value chrome and presents once per completed action.

### Output Mono shows no IO by default — RECLASSIFIED

- **Reported:** 2026-11-26, by Argi
- **Rechecked:** 2026-11-27. Current IO View A intentionally shows compact side pills and hides individual jacks for every module; Tab opens View B and displays the full jacks. This is global IO-view behavior, not an Output Mono initialization fault. No module-specific code change is indicated.

### Text redraws during drag, pan, zoom, and wire pull

These reports probably share a root cause: text in the GL text and label rendering rebuilds or re-renders when it shouldn't. MasterBot owns the viewport, text, and culling rendering code and is partway through a module display rewrite (`docs/MODULE_DISPLAY_REWRITE_PLAN.md`).

#### Module drag redraws text on every pixel - FIXED

- **Reported:** 2026-11-25, by Argi
- **Fixed:** 2026-11-26, `82380fa0`. Retained module GL records move and reorder without rebuilding text; gesture test verifies zero text calls and atlas bakes.
- **Symptoms:** Clicking a module's title to drag it makes the text redraw before the module has even moved. After that, the text redraws on every pixel the mouse moves.
- **Notes:** Grouped with the other text-redraw reports above.

#### WASD panning leaves text blurry

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** Panning with WASD seems to make text rebuild. After panning stops, the text stays blurry for about a second.
- **Notes:** Grouped with the other text-redraw reports above. A focused probe reports no GL text calls or atlas bakes during WASD pan, but this is not visual confirmation. Argi has not confirmed the symptom; leave open.

#### Zoom then middle-mouse triggers a leftover text redraw

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** After zooming, simply pressing the middle mouse button down triggers another text redraw it doesn't need. The redraw after the zoom may not have finished, and the mouse-down completes it — or something else is going on.
- **Notes:** Grouped with the other text-redraw reports above. A focused probe reports no GL text calls or atlas bakes after zoom then middle press, but this is not visual confirmation. Argi has not confirmed the symptom; leave open.

#### Wire drag from Flower Child re-renders text - FIXED

- **Reported:** 2026-11-25, by Argi
- **Fixed:** 2026-11-26, `82380fa0`. Gesture-only cable updates retain module ink; real Clock and Flower Child wire-pull tests verify zero text calls and atlas bakes.
- **Symptoms:** Dragging a wire out of the Flower Child filter makes text re-render. This is probably not limited to that one module.
- **Notes:** Grouped with the other text-redraw reports above.

#### Wire drag is slow, with a low framerate - FIXED

- **Reported:** 2026-11-26, by Argi
- **Fixed:** 2026-11-26, `82380fa0`. Removed duplicate pointer-move paints and full plate/plan refreshes. Measured mean frame time improved from 25.47-30.90 ms to 16.67 ms on the focused fixture. Broader camera-performance limits remain documented in `TEXT_KEYBOARD_BUGFIX_REPORT.md`.
- **Symptoms:** Dragging a wire is slow, with a low framerate. This may be caused by the constant text redraws in this group.
- **Notes:** Grouped with the other text-redraw reports above. Measure frame time while dragging a wire, before and after a text-redraw fix.

### Deleting Viewport Out dims or hides the workspace grid

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** Deleting the Viewport Out module makes the circuit builder grid lines dim until they seem to disappear, as if Viewport Out has to exist for the workspace background to render correctly.
- **Notes:** MasterBot owns viewport and workspace rendering. See also the module display rewrite in `docs/MODULE_DISPLAY_REWRITE_PLAN.md`. Rechecked directly on 2026-11-27 by adding Viewport In → Viewport Out, then deleting Out and comparing the workspace screenshots; the grid did not visibly dim in this run. No fix was indicated, so this remains open.

### Keyboard key color highlighting is missing or intermittent - FIXED

- **Reported:** 2026-11-25, by Argi
- **Fixed:** 2026-11-26, `82380fa0`. State changes dirty owning module chrome; Grid also uses the shared GL painter/hit route. Real stopped-transport pointer/pixel tests cover plain, Shift, Ctrl and chord-slot colors without starting DSP.
- **Symptoms:** Keyboard key color highlighting (blue, gold, and the other highlight colors) doesn't work, or works only sometimes, on any click, including Shift-click and Ctrl-click.
- **Notes:** Argi suspects this regressed when timer polling (`setInterval`) was converted to event-driven updates, so the keyboard likely lost a refresh a timer used to drive. Check MasterBot's conversion commits `958808b4`, `9eb8b7ca`, `cb686247`, and `9ab21898` first. In Argi's words, the keyboard "doesn't really update properly" and isn't highlighting at the moment.

## Logged earlier

These were already on the earlier bug log. Fixed items include their commit hashes.

### Music Player will not replay after a track ends — FIXED

- **Fixed in:** `7553e6e8`
- **Notes:** Previously logged 2026-11-20 (via MasterBot from Argi). The Music Player module would not replay music after it finished playing.

### Screen Glass effects render unevenly on rectangular aspects — FIXED

- **Fixed in:** `6bd82f17`
- **Notes:** Previously logged 2026-11-20 (via MasterBot from Argi). Screen Glass effects like screen fringe rendered unevenly: a rectangular aspect made horizontal edges sharper or softer than vertical ones. Likely needed aspect-correct distances so all sides match.

### MIDI Listen dropdowns

- **Status:** open
- **Notes:** Logged earlier. No detail recorded yet.

### Monitor DOM graphics

- **Status:** open
- **Notes:** Logged earlier. No detail recorded yet.

### Elan's `cursor: move` breaks the no-arrow-cursor lint

- **Status:** open, waiting on Argi's decision
- **Notes:** `cursor: move` at `styles.css` around line 12715 (`cfbaa592`) breaks the no-arrow-cursor lint (APP_POLICY §24).
