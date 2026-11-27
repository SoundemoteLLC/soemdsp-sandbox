# Text and Keyboard Bugfix Report

Date: 2026-11-26

Branch: `bugfix/text-keyboard`, based on `60d52088` (`origin/master` at handoff).
Worktree: `../soemdsp-sandbox-bugfix`. Main checkout was not edited, merged,
stashed, reset, or cleaned. This branch requires Argi's approval before merge.

## Root Causes

- Module dragging called the full cable/plate rebuild on every pointer move.
  Raising a module also rebuilt the graph and incremented its generation again.
  Both discarded the recorded module text despite unchanged content and scale.
- Wire movement had two paint owners: the general connection cursor handler and
  the pointer drag handler. Each move could rebuild plates, text, cable geometry,
  and the execution-plan presentation twice.
- Keyboard state changes scheduled Present but did not dirty the cached module
  chrome. Present correctly replayed the cache, including its stale key colors.
- Grid Keyboard additionally had no registered shared-GL face or overlay hit
  route. Its DOM pads were not a usable substitute under the shared GL overlays.

## Changes

- Gesture-only cable updates preserve the module mesh generation and skip the
  full layout, connection-class, execution-plan and scope-refresh work.
- Module ink is retained in nested, individually transformable GL layer records.
  Moving changes their camera offset; raising reorders the records; selection
  changes their existing outline state. None requires rebuilding glyph geometry.
- Retained-module bookkeeping runs only after module movement, selection,
  record replacement, or wire-source state changes, not every camera frame.
- Moving also updates the existing published plate/display positions so wires,
  lighting, hit testing and later incremental repaints use the current geometry.
- The general cursor handler no longer duplicates pointer-owned wire drags.
  Free cable endpoints are drawn in the live contact layer, not retained ink.
- Piano and Grid state changes mark their owning module's chrome dirty before
  the existing coalesced paint. Grid shares the piano highlight palette and GL
  device, with one pad-layout model for painting and hit testing.
- Changed asset cache tags were bumped in both HTML entry points.
- Two existing text tests now wait for the actual boot-ready state before
  loading their fixtures; their earlier function-only waits could race deferred
  control/scope scripts and fail with unrelated missing-global errors.

No Canvas2D fallback, polling timer, extra DSP execution, native-code change,
viewport-culling rewrite, or new cross-project abstraction was added.

## Reproduction and Measurements

`scripts/test_text_gesture_redraw.mjs` uses a free-port server, real pointer and
keyboard events, the guitar-pluck fixture plus Flower Child, and stopped audio.
It verifies retained record identity, actual module translation reaching the GL
camera, front ordering, text-call counts, atlas bake counts and frame intervals.

Baseline uses `--baseline` to serve the original public JS from `60d52088`,
without modifying either checkout. `BASELINE_REF` selects another checkpoint.

| Gesture | Baseline workspace text calls / atlas bakes | Fixed calls / bakes | Baseline mean / p95 ms | Fixed mean / p95 ms |
| --- | --- | --- | --- | --- |
| Module drag | 19,480 / 164 | 0 / 0 | 20.53 / 33.4 | 16.67 / 16.8 |
| WASD pan | 0 / 0 | 0 / 0 | 16.67 / 16.8 | 16.67 / 16.7 |
| Settled zoom then middle press | 0 / 0 | 0 / 0 | 16.68 / 16.8 | 16.67 / 16.8 |
| Clock wire drag | 100,680 / 480 | 0 / 0 | 30.90 / 83.3 | 16.67 / 16.8 |
| Flower Child wire drag | 79,560 / 480 | 0 / 0 | 25.47 / 50.0 | 16.67 / 16.8 |

These are measured runs, not performance guarantees. Other fixed runs under
machine load reached about 19 ms mean / 33 ms p95 for wire dragging, still with
zero workspace text calls and zero atlas bakes.

WASD blur and the middle-down report did not independently reproduce on the
baseline in this fixture. The constant-scale checks pass, but those two user
reports remain open for manual confirmation rather than being claimed fixed.

## Verification

Passed:

- `git diff --check` and Node syntax checks on changed public JS.
- `test_text_gesture_redraw.mjs`.
- `test_text_resharpen.mjs`.
- `test_text_sharp.mjs` (DPR 1, 1.25 and 1.5).
- `test_text_single_change.mjs` (both fixtures, DPR 1 and 1.5).
- `test_text_survives_settle.mjs`.
- `test_text_squeeze_zoom.mjs`.
- `test_view_no_gesture_skip.mjs`.
- `test_keyboard_piano_keys_shared.mjs`.
- `test_keyboard_overlay_display_settings.mjs`.
- `test_keyboard_highlight_events.mjs`.
- `test_keyboard_highlight_browser.mjs`: actual plain/Shift/Ctrl clicks,
  release, unlatch and chord-slot GL pixel changes for Piano and Grid. Transport
  remains stopped, with no audio engine or running AudioContext. Grid DOM pad
  opacity is zero, so the pixel proof cannot come from HTML painting.
- `perf_pan_popin.mjs`: all visibility, interaction and replay checks pass on
  the 60-module fixture; no page errors.

Not fully green:

- `perf_view_real.mjs`: no blank/pop-in failures, no mid-camera replay failure,
  and no page errors. The latest fixed run failed the 20 ms p95 gate for middle
  drag (33.4 ms); the baseline failed that same gate (33.4 ms) and both wheel
  gates. The fixed run passed wheel, Q/E and WASD gates (16.7-17.0 ms p95).
- Manual testing in Argi's browser/REAPER session has not been performed.
  Automated acceptance uses Chrome real input events and screenshots.

## MasterBot Overlap

The integration touches shared graph record/replay and a small layer-camera
offset hook in `gl-line-renderer.js`. Individual module records are necessary
to move/raise one module without rebuilding its former group. This changes
compositing granularity and should be reviewed with MasterBot before merge.
The existing lazy atlas sharpening, common camera setter, event-driven cull,
group/range repaint helpers and specialized tile paths remain in place.
`node-graph-viewport-perf.js` was not changed.
