# Codex handoff: text redraws and keyboard highlighting

This is a work brief for Codex (Argi's "AI brain"). Work on a dedicated bug-fix worktree, not in the main checkout. Do not merge back to `master` until Argi approves.

Read first: `docs/KNOWN_BUGS.md` (open items 1-4 plus the wire-drag slowness note in that group, and item 6), `docs/APP_POLICY.md`, and `docs/MODULE_DISPLAY_REWRITE_PLAN.md`.

## 1. Goal

Create your own git worktree and branch for these bug fixes, then fix the text-redraw group and the keyboard key-highlighting bug there. Test in that worktree so you do not collide with the main checkout at `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox`, where several bots and MasterBot have uncommitted work.

From the main repo (do not commit, stash, rebase, or clean that tree):

```
cd C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox
git fetch origin
git worktree add ../soemdsp-sandbox-bugfix -b bugfix/text-keyboard origin/master
cd ../soemdsp-sandbox-bugfix
```

The worktree path is `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox-bugfix`. Base the branch on `origin/master`, not local `master`. Local `master` may be ahead of origin and the main working tree is dirty; leave both alone.

Do all editing, tests, and commits on `bugfix/text-keyboard` in that worktree. Merging the branch back to `master` happens only when Argi approves.

## 2. Scope

### (a) Text-redraw group (`docs/KNOWN_BUGS.md`, Text redraws during drag, pan, zoom, and wire pull)

These reports probably share one root cause: GL text or labels are rebuilt or re-rasterized when nothing about the text (content, scale, or layout) changed. Find what invalidates the text cache, and make text update only when content, scale, or layout really changes.

Bugs in this group:

1. **Module title click or drag redraws text.** Clicking a module's title to drag it makes the text redraw before the module has even moved. After that, the text redraws on every pixel the mouse moves.
2. **WASD pan leaves text blurry.** Panning with WASD seems to make text rebuild. After panning stops, the text stays blurry for about a second.
3. **Zoom then middle-mouse-down triggers an unneeded redraw.** After zooming, simply pressing the middle mouse button down triggers another text redraw it does not need. The zoom's redraw may not have finished, and the mouse-down completes it — or something else is going on.
4. **Dragging a wire re-renders text.** Dragging a wire out of the Flower Child filter makes text re-render. This is probably not limited to that one module.
5. **Wire dragging is slow, with a low framerate.** Argi reports that dragging a wire is slow and may be caused by the constant text redraws in this group. Treat this as a symptom of the same bug: measure frame time while dragging a wire, before and after the fix, and report both numbers.

### (b) Keyboard key highlighting (`docs/KNOWN_BUGS.md`, Keyboard key color highlighting is missing or intermittent)

Blue, gold, and the other highlight colors do not show, or only show sometimes, on any click, including Shift-click and Ctrl-click. In Argi's words, the keyboard "doesn't really update properly" and is not highlighting at the moment.

Argi suspects this regressed when timer polling (`setInterval`) was converted to event-driven updates, so the keyboard likely lost a refresh a timer used to drive. Start with MasterBot's conversion commits:

- `958808b4` — GPU additive producer: refill on worklet messages, not an 8 ms timer
- `9eb8b7ca` — Scopes: drop the 100 ms draw heartbeat
- `cb686247` — Plugin host: params and display watch on change events, not 33 ms / 750 ms polls
- `9ab21898` — Player embed API: state on events, not a 250 ms clock

Those four commits do **not** touch keyboard files directly (they change `node-graph-live-runtime.js`, `node-graph-module-scope-lifecycle.js`, `plugin-host.js`, and `audio-player-api.js`). Also inspect the umbrella event-driven commit that landed the same day:

- `e0d742dd` — Module display rewrite through Stage 4, selection fix, and event-driven updates (no polling)

`e0d742dd` heavily changed `public/node-graph-gl-graph.js` and `public/node-graph-viewport-perf.js`, and it includes a selection-highlight replay fix (Stage 4 was replaying a stale mesh on every `Present()`, which froze the lasso trail and later highlights). The keyboard may have lost a refresh in that same conversion, or a Present/replay path may be dropping key-color updates.

The fix must stay event-driven. Do not bring back `setInterval` polling. Update on the click / state-change events themselves (or a one-shot `requestAnimationFrame` coalesced from those events, which the keyboard already uses).

## 3. Rules (APP_POLICY and standing practice)

Follow `docs/APP_POLICY.md`. The rules that matter most for this work:

- **No timer polling.** No `setInterval`. Update on events or on actual changes. A `requestAnimationFrame` loop may run only while work is pending and must stop by itself (see `scheduleNodeGraphViewTextQuality` and `scripts/test_text_resharpen.mjs`). Do not add settle `setTimeout`s to replace the old polls.
- **No hover text or tooltips** (APP_POLICY §12): no mouse-following tooltips or `title` hover clutter.
- **No arrow cursors** (APP_POLICY §24): no `ew-resize`, `ns-resize`, `move`, `all-scroll`, `pointer`, or `grab`. Use the shared mouse-dot cursor (`--node-dot-cursor` on hover, `--node-adjust-cursor` while pressed). Text fields keep `text`. A smoke test fails if an arrow cursor comes back (`scripts/test_no_arrow_cursors.mjs`).
- **Audio only during Play.** The rule "audio only runs during Play mode" must not be broken. Displays may spawn and update while stopped (APP_POLICY §3b), but do not run DSP / the audio engine outside Play to make a face or highlight work.
- **The circuit builder is WebGL-only** (APP_POLICY §3): every pixel of every object in the circuit builder is drawn by a WebGL2 shader. JS may hold state, do layout, and handle input; it must not decide pixel color. Module faces go through the shared picture device / `gl-line-renderer.js`. Keyboard keys are already on that path (`keyboard-face-gl.js`); do not regress them to HTML-span drawing.
- **Prefer shared code.** Reuse the existing glyph-atlas / GL text path and the existing keyboard paint helpers. Do not fork a second text cache or a second key-highlight painter. Shared DSP maths belong in `library/include/soemdsp` and need Architect (Argi) approval before that tree is edited (APP_POLICY §19); this bug fix should not need that.
- **Preserve line endings and never truncate files.** Docs in this repo are LF. Some JS files are CRLF (for example certain slider files). Keep whatever endings a file already has. Never rewrite a file by truncating it first.
- **Bump `?v=` only for assets that changed.** When you change public JS that must not be cached stale, bump the matching cache-bust query in both `public/index.html` and `public/perform.html` (APP_POLICY §9). Leave other `?v=` tags alone; they may belong to in-flight work in the main checkout.
- **No BOM in commit messages.** Commit messages are plain UTF-8, no byte-order mark.

MasterBot owns the viewport, culling, and text rendering code, and has a module display rewrite in progress. See `docs/MODULE_DISPLAY_REWRITE_PLAN.md`. The plan document is still marked "plan only, waiting for Argi's sign-off," but `e0d742dd` already landed stages 0-4 of that rewrite (world-unit module boxes, cached chrome, one camera setter / live per-frame path, mesh replay on camera-only frames, and deletion of the mid-gesture HTML freeze and 140 ms settle timer). Keep changes surgical. Do not start the broader rewrite, and do not fight the plan (one camera path, replay the cached mesh on camera-only frames, lazy incremental text sharpen after zoom, no mid-gesture freeze). If your fix overlaps that work, say so in the report and keep the overlap as small as possible.

## 4. Likely files and leads (read-only survey)

Start here; confirm before changing anything.

**Text / labels**

- `public/node-graph-gl-graph.js` — workspace GL present, mesh record/replay, `textBakeDirty`, `resharpenText`, `nodeGraphGlGraphSharpenTick` (around 1500, 4545, 4706, 5095).
- `public/lib/visual/gl-line-renderer.js` — glyph atlas (`nodeGraphGlLinesTextAtlas*`, `nodeGraphGlLinesText`, `nodeGraphGlLinesSetGlyphBakePx`).
- `public/lib/visual/glyph-sdf-atlas.js` — shared SDF glyph bake.
- `public/node-graph-viewport-perf.js` — `scheduleNodeGraphViewTextQuality` / `nodeGraphViewSettleTick` (around 153-271). `NODE_GRAPH_VIEW_TEXT_QUALITY_MS` is 150 ms, which is much shorter than the "about a second" of blur Argi sees after WASD stops. The comment at line 206 says the quality settle waits on pan, zoom, wheel, keys, and drag. If a pan (scale unchanged) arms the sharpen / quality path, that would rebuild or soften text for no reason.
- `public/node-graph-camera-keys.js` — WASD / Q/E camera input.
- `public/node-graph-workspace-view.js`, `public/node-graph-workspace-zoom.js` — middle-mouse pan and wheel zoom.
- `public/node-graph-wires.js` — `handleWireDragMove` / `handleWireDragEnd` (around 1326-1436).

Leads to confirm or rule out:

- `nodeGraphGlGraphLiveKey()` (around `node-graph-gl-graph.js:5653`) includes selection, raised module, and `nodeDragging.moved`. `Present()` remeshes when this key changes, or when `textBakeDirty` / `resharpenText` is set. A title mousedown that selects or raises a module would remesh — and redraw text — before the module moves. During a drag, a remesh every pointer move would redraw text every pixel if something marks the mesh dirty each time rather than moving recorded plates.
- Camera-only frames are supposed to replay the cached mesh (`liveUnchanged && !resharpenText`). If pan, module drag, or wire drag fails that test, the full record path runs, including text.
- WASD should not need a text rebake: only zoom changes glyph size. If `scheduleNodeGraphViewTextQuality` or `textBakeDirty` is armed on pan, that matches bugs 2 and 3 (a later middle-mouse-down may flush a pending sharpen).
- Wire-drag slowness: if text is re-rasterized on every `handleWireDragMove`, frame time will be high. Measure it.

**Keyboard highlighting**

- `public/node-graph-view-controls.js` — `renderNodeGraphKeyboardHeldKeys` (gold Arp Keys latch, around 2312), `renderNodeGraphKeyboardActiveKeys` (blue / active, around 3881), pointer handling for Shift / Ctrl / Alt (around 3476-3637). Comments there: Ctrl+click is gold "Arp Keys" latch; Shift+click is blue mono sustain.
- `public/modules/keyboardController/keyboard-face-gl.js` — GL key painting, blue/gold palettes (around 288-309), `nodeGraphKeyboardRequestPaint` (rAF-coalesced, around 232) which calls `nodeGraphGlGraphPresentSoon` and `nodeGraphKeyboardPresentFaceCanvases`.
- `public/modules/keyboardController/keyboard-layout-settings.js` — layout and some held-key refresh.
- `public/node-graph-keyboard-chord-memory.js` — chord-memory clicks and paints (`nodeGraphChordMemoryPaintKeys`).
- `public/modules/gridKeyboard/grid-keyboard.js` — grid pads use the same gold / held / ghost-play states; check it does not regress.

Hypothesis to test: click handlers still update `key.state` (`held`, `active`, …) but the event-driven paint (`nodeGraphKeyboardRequestPaint` / face present) is not reached, or `Present()` replays a cached mesh that does not include the new key colors. The fix should hook the existing state-change events to a paint, not start a timer.

## 5. How to verify

### Reproduction

1. **Module drag text:** In the circuit builder, click a module title and hold still — text should not redraw. Drag it slowly one pixel at a time — text should not rebuild or flash on each pixel. Only the module's position should change.
2. **WASD blur:** Pan with WASD across a patch that has many module titles and jack labels. After you stop, text should stay sharp (or, if a zoom-related sharpen is legitimately running, it must not have been armed by pan alone, and it must not stay blurry for about a second).
3. **Zoom then middle-mouse:** Zoom with the wheel, then press middle-mouse down without moving. That press must not trigger a leftover text redraw.
4. **Wire drag text and frame time:** Drag a wire from Flower Child (and from at least one other module). Text must not re-render. Record frame time / FPS while dragging, before and after the fix.
5. **Keyboard highlights:** Click keys on the Keyboard module: plain click, Shift-click (blue sustain), and Ctrl-click (gold Arp latch), plus the other highlight colors (ghost-play / chord-memory if applicable). Highlights must appear immediately and consistently. Repeat on Grid Keyboard where the same colors exist. This must work with the project stopped (no audio required).

### Existing tests to run

These start their own `server.py` on a free port and must not touch 8765 / 8766 / 8080:

- `node scripts/test_text_resharpen.mjs` — mid-zoom must not rebake; settle is rAF-while-pending, not `setTimeout` / `setInterval`.
- `node scripts/test_text_sharp.mjs`
- `node scripts/test_text_single_change.mjs` — each stack's text changes at most once while resharpening after zoom.
- `node scripts/test_text_survives_settle.mjs`
- `node scripts/test_text_squeeze_zoom.mjs` if still applicable.
- `node scripts/test_view_no_gesture_skip.mjs` — Stage 3 deleted the mid-gesture freeze; do not bring it back.
- `node scripts/perf_view_real.mjs` and `node scripts/perf_pan_popin.mjs` if your changes touch the present / cull path.
- `node scripts/test_keyboard_piano_keys_shared.mjs`
- `node scripts/test_keyboard_overlay_display_settings.mjs`
- `node scripts/test_no_arrow_cursors.mjs` if you touch CSS or cursors.

### New coverage

Add a small test or instrumentation that counts text rebuilds / atlas rebakes / full text remeshes during a module drag and during a WASD pan at constant zoom. The count should be **zero** when text content, scale, and layout have not changed. Also measure wire-drag frame time before and after (for example ms/frame or FPS over a 2-3 second drag on a real patch such as `tests/fixtures/view-real-guitar-pluck.json` or Argi's current patch). Prefer a free-port headless script in the style of the existing `test_text_*.mjs` files.

### Real app

After the scripts pass, test in the real app: browser circuit builder and/or the REAPER plugin. Confirm the five text/wire cases and the keyboard colors by hand.

## 6. What to report back

- Root causes for the text-redraw group (including whether wire-drag slowness was the same cause) and for the keyboard highlight bug.
- Commit hashes on `bugfix/text-keyboard`.
- Test results: existing scripts, the new rebuild-count / wire-drag frame-time numbers (before and after), and what you checked in the real app.
- Any overlap with MasterBot's viewport / text / module-display rewrite.

On the bugfix branch, mark the fixed bugs in `docs/KNOWN_BUGS.md` (fixed, with commit hash and date) and leave any still-open items untouched.
