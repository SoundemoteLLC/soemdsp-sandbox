# Circuit-builder pan/zoom pop-in attempts

This is a record of what was tried to make modules, heatmap lights, wires, and port/jack dots appear during middle-mouse pan, wheel zoom, Q/E zoom, and pinch — the same way W/A/S/D pan already does — without bringing back the Viewport In/Out shader flicker. After `5252241c` Argi reported the circuit builder unusable (panning at a few fps, remaining pop-in, parameters popping). At his instruction, everything in *this* pop-in series after the working flicker fix (`fec7d8a9`) was reverted with `git revert`. The flicker fix and the earlier incremental plate API were kept.

This document is the brief for a future careful redo. Do not treat the reverted commits as a recipe to replay.

## What actually works

`fec7d8a9` (`-fxstay-2`, 2026-11-24) is the last version Argi accepted as smooth, with the shader flicker gone.

- **Flicker fix (must keep):** `nodeGraphViewportCullMustStayAwake` holds Viewport In/Out (`viewOut` / `screenOut`) and live video-graph / screen-fx modules so cull cannot `display:none` them. `node-graph-screen-fx.js` keeps the last good overlay frame (`lastFinal` / MustStayAwake path) instead of blitting an empty frame when a face texture misses. This has to stay for every pan type, including WASD.
- **WASD is the only reliably solid pop-in path.** It calls `setNodeGraphPan(..., { gesture: true, persist: false })` and does **not** set `workspacePanning`, `wheelActiveUntil`, or the settle timer, so `nodeGraphViewportGestureActive()` is false and the HTML world layer is not frozen (`gesturing=0`, `frozen=0`). Live cull and a full `Present()` run on the committed camera every tick.
- **W/A/S/D pop-in must not be "fixed."** Q/E is not part of that working path; it uses `setNodeGraphZoom` (same as the wheel).
- Official tests (`scripts/perf_pan_popin.mjs`, 10×6 synthetic 60-module patch, `cables: []`, free port, Playwright headed or headless) repeatedly passed after later patches that still failed on Argi's real 8766 patch. A future redo must test on his real patch, not only the synthetic grid.

## Key findings and root-cause candidates

These showed up across the series. Several can be true at once.

| Candidate | What it does |
|---|---|
| Frozen `will-change: transform` world layer | Mid-gesture the compositor cached a raster that did not include modules woken from `display:none`. They only appeared at settle / pointer-up. WASD never used this path. |
| Settle-only full flush | Wheel/Q/E start a 140ms `settleTimer`. Heavy chrome (full present, `--node-graph-zoom`, some lights/dots) waited until that timer. Mid-gesture `Present()` early-returned with `ReplayMesh` (camera uniform only). |
| `gesturing=1` / `frozen=1` vs WASD | Middle-mouse sets `workspacePanning`; wheel/Q/E set `wheelActiveUntil` + settle. CssLight then skipped or deferred work WASD does immediately. |
| Zoomed `offsetWidth` poisoning the world-size cull cache | Mid-zoom correctly avoided remasuring (`offsetWidth` includes CSS `zoom`). After settle, remasured zoomed widths were stored in `_viewportCullW/H` and later treated as world units. The next gesture — even one slow wheel tick — used the wrong AABBs. After zoom-out, sizes were too small, so edge modules stayed asleep (intermittent, not speed-related). WASD only changes pan, so this mostly broke zoom (and sometimes later pans at a zoom ≠ 1). |
| Origin-sync retagging a zoom as pan | `scheduleNodeGraphWorkspaceOriginSync` (double rAF) could call `applyNodeGraphPan({ gesture: true })` mid-zoom, set `lastGestureKind` to `"pan"`, drop `cacheSizesOnly`, and remasure zoomed `offsetWidth` into the world cache. |
| Deferred `--node-graph-zoom` | CssLight skipped writing the inherited zoom var until settle. Newly woken modules inherited the pre-zoom camera; wheel zoom felt delayed. |
| Same-event full HTML + GL apply (`5252241c`) | Restored immediate zoom, but `PositionGridHtml` + `PresentCamera` on every pointer/wheel sample collapsed pan to a few fps on a real patch. |

## Argi's observations (real hardware, `http://127.0.0.1:8766/`)

- After refresh, footer tokens are `server.py` boot stamps, not commit hashes. 8765 and 8766 both serve live repo files (`Cache-Control: no-store`). Do not kill those servers or load official test patches onto 8766.
- Shader flicker was **gone** after `fec7d8a9` and must stay gone.
- Modules popped in only after releasing middle-mouse pan, wheel, Q/E, or pinch — until `24bc92c8`, when modules started appearing mid-gesture. WASD had been solid the whole time.
- After `24bc92c8` / `62ce64f8`: module heatmap lights were OK; wire dots (and probably wires) still popped in late. Wires may wait until their entire length is visible; Argi accepted that and did not ask for wire-path culling.
- Pop-in is **not speed-related**. It happens with slow single wheel ticks, and sometimes a given wheel gesture does not show it at all (stale state, not a throttle/budget).
- Wheel zoom felt delayed.
- Q/E pop-in stayed intermittent; "there must be a reference not updating."
- After `5252241c`: **panning at a few fps**, circuit builder unusable, wire dots still pop in, Q still causes pop-in, and **parameters pop in and out while the module display doesn't**.

## Lessons

- Headless and headed Playwright on a 60-module synthetic patch did not reproduce his real patch (fps collapse, intermittent pop-in, parameter vs display). Test on the real 8766 patch, or a captured copy of it, before calling a change done.
- One change at a time. This series layered freeze-off, live cull, debug logs, no-HTML-freeze, live lights/dots, and same-event zoom on top of each other until the view was unusable.
- Keep the flicker fix and the WASD path untouched. Do not re-freeze the HTML world layer as a "perf" fix.
- Cache-bust (`?v=`) only the files actually changed, with a **new unique** suffix, in every HTML loader (`index.html` and `perform.html`).
- Prefer measuring (ring buffer, `__popinDump()`, camera vs cull rect on his machine) over adding more mid-gesture work.

## History (oldest first)

Commits `94d2331c`, `1fb856fb`, and `f913a03b` live on `backup/pre-squash-20261124-0724`. They landed on `master` as `18c65ff4` (same incremental-plate patch, same timestamp as `f913a03b`) and `7d07bd76` (squash of graph-point-editor, graph switch row, and pan-popin-1/2; tagged `pan-popin-1` / `pan-popin-2`). Those `master` commits are kept.

### Moth: `94d2331c` — pan-popin-1 (on `master` via `7d07bd76`)

- **Hypothesis:** While a middle-mouse pan, touch pan/pinch, or wheel zoom is held, the HTML camera is frozen and cull / IntersectionObserver / wake rebuilds are skipped, so modules that scroll into view stay `display:none` until settle.
- **Change:** `applyNodeGraphViewportCssLight` schedules a budgeted pop-in pass: wake asleep modules intersecting the live view (+96px), nearest first, at most 24 modules or 8ms per pass, at most every 100ms; publish geometry; one GL plate rebuild + present. Nothing sleeps mid-gesture. Added `scripts/perf_pan_popin.mjs`.
- **Argi's result:** The idea (wake mid-gesture) is the starting point. Flicker on Viewport I/O pans was still present until `fec7d8a9`. Mid-gesture pop-in on non-WASD gestures was still incomplete in later testing.

### Incremental plates: `f913a03b` / `18c65ff4`, then `1fb856fb` (on `master` as `18c65ff4` + the pop-in-2 half of `7d07bd76`)

- **Hypothesis:** A full plate rebuild every time a module wakes is too expensive mid-gesture. Patch only the woken ids into the cached mesh so `Present()` can `ReplayMesh`.
- **Change:** `nodeGraphGlGraphRebuildPlates({ ids })` / `AddPlates(ids)` rebuilds plates, displays, and chrome for those modules and patches the mesh (append new layers; keep buffers for ids already meshed). Falls back to a full rebuild when the mesh cannot be patched. pan-popin-2 calls this from the pop-in pass. Settle does a full rebuild if incremental plates were patched, so heatmap lights catch up.
- **Argi's result:** API is kept. Incremental mid-gesture presents later deferred lights and some dots until the full settle present — that showed up after modules themselves started appearing.

### `fec7d8a9` — flicker fix (`-fxstay-2`) — WORKED

- **Hypothesis:** Cull could still put Viewport In/Out and live shader-chain modules to `display:none`, and ScreenFxRender blitted an empty overlay when face textures missed a frame, so the whole view flickered on any pan, including WASD. Separately, waking a `display:none` module did not redraw the `will-change:transform` world-layer cache, so HTML only appeared on pointer-up.
- **Change:** MustStayAwake holds those modules. The overlay keeps the last good frame unless the patch no longer has viewport I/O. Re-raster the frozen world layer after a successful pop-in wake. Middle-mouse still uses Moth's budgeted pop-in; WASD is unchanged.
- **Argi's result:** **Flicker gone. Keep this.** He was testing at 8766; later "pop ins still happening" meant modules still appearing only on release, not that flicker had returned.

### `a14b5b0d` — `-fxstay-3` — REVERTED

- **Hypothesis:** `will-change: transform` on the frozen world layers cached a GPU raster that did not include modules woken from `display:none`, for every viewport gesture (middle-mouse, wheel, Q/E, pinch, touch). WASD is not a viewport gesture and was unaffected.
- **Change:** Disable that layer cache (`NODE_GRAPH_GESTURE_WILL_CHANGE = false`, "FIX C off") and re-apply the frozen camera transform after a pop-in wake.
- **Argi's result:** No change on 8766 after Ctrl+F5. Headless tests did not show what he saw.

### `e13c84ce` — `-popinlog-1` — REVERTED

- **Hypothesis:** Need an opt-in trace to see whether pop-in steps and cull refreshes run on his machine.
- **Change:** `window.__popinDebug = true` or `?popindebug=1`. One `[popin]` line per pop-in step and cull refresh. No behavior change when debug is off.
- **Argi's result:** He opened `?popindebug=1` and later set `__popinDebug = true`. Zero `[popin]` lines. Only Chrome Violations (`setTimeout` 51–74ms at viewport-perf settle, forced reflow).

### `af80e32e` — `-popinlog-2` — REVERTED

- **Hypothesis:** Mid-gesture CssLight skipped the WASD-style cull while HTML was frozen; the budgeted pop-in rAF bailed unlogged. Modules appeared only when the 140ms settle ran the full flush. Also, logs used `console.info` and were easy to miss.
- **Change:** Throttled live cull (48ms) during pan/zoom, with immediate geometry / incremental plates / present for modules it wakes. Logs use `console.log`; gesture start/end and scheduler bail reasons.
- **Argi's result:** On 8766, modules still popped in only after release. Debug logs still did not show in his console.

### `fba52976` — `-popinlog-3` — REVERTED

- **Hypothesis:** Either viewport-perf was not the script 8766 executed, or logs were filtered. Also, a mid-gesture origin-sync `applyNodeGraphPan()` with no options was running the full chrome flush (65–179ms rAF / forced reflow). A permanent non-passive window `wheel` listener can delay wheel input ~100ms in Chrome.
- **Change:** Unconditional `console.warn` at script load, `window.__popinPerfVersion`, `__popinDump()`. Skip the origin-sync full flush while a viewport gesture is active. Mid-gesture cull no longer publishes geometry from the DOM or reads `offsetWidth`. Bind camera-keys and document outer-wheel listeners as non-passive only when they need `preventDefault`.
- **Argi's result:** `__popinPerfVersion` returned `'fxstay-3-popinlog-3'` (script runs), but `__popinDump()` printed `undefined` and no `[popin]` or `console.warn` lines appeared (DevTools "No messages / No warnings", custom levels greyed out). Confirming a console override was part of the next patch, not a fix for pop-in.

### `84f91ce5` — `-popinlog-4` — REVERTED

- **Hypothesis:** DevTools was hiding console output; `__popinDump()` only warned and returned undefined, so he had nothing to copy.
- **Change:** Always-on `window.__popinLog` ring buffer (~300). `__popinDump()` **returns** version, debug flag, gesture/frozen state, counters, last skip reason, console-hook probe, and recent entries.
- **Argi's result:** Dump now usable. Diagnosis stayed the same: WASD has `gesturing=0` `frozen=0`; middle-mouse / wheel / Q/E / pinch have `gesturing=1` `frozen=1`. Logging did not fix pop-in.

### `24bc92c8` — `-wasdcull-1` — REVERTED

- **Hypothesis:** The only behavioral difference is the freeze / GestureActive flag. If middle-mouse, wheel, Q/E, and pinch do not freeze the HTML world layer and run the same live cull/wake as WASD, modules will appear mid-gesture.
- **Change:** Never call `nodeGraphFreezeHtmlCamera` from CssLight. Live unthrottled cull (keep cached world sizes only while zooming). rAF-coalesce per-module style writes mid-gesture. Light settle (skip 50–180ms full flush unless incremental plates need a full rebuild). `viewport-zooming` kept (then still used to hide cables). Headed `perf_pan_popin` gained Q/E and pinch.
- **Argi's result:** **Modules now popped in mid-gesture.** Heatmap lights, wires, and wire/port dots still appeared only after release or settle. Wheel zoom-out to all 60 synthetic modules was hitchy in official tests (p50 still ~16.7ms, mean much higher). Flicker still gone. WASD still solid.

### `62ce64f8` — `-livechrome-1` — REVERTED

- **Hypothesis:** Incremental plate rebuild deferred `batch.lights` and incremental `DrawCtx` used empty `endsByNode` / `dotBake: null`, so lights and dots waited for a full present. `.viewport-zooming` hid HTML `.node-port` / `.node-param-port`.
- **Change:** Sync GPU heatmap lights from current plates before mid-gesture `ReplayMesh`. Pass wire-end/port dots into incremental plate draws. Stop hiding HTML ports under `.viewport-zooming` (class kept for frozen stroke-compensate only). No wire-path culling (Argi: wires may appear only once their entire length is visible).
- **Argi's result:** **Module heatmaps no longer had the pop-in bug.** Wire dots still did (wires probably as well). Modules themselves were again intermittent on his machine. Wheel zoom felt delayed. Q/E still intermittent. "All the pop-ins are intermittent. WASD continues to be solid." Official headed tests still passed and did not match his reality.

### `5252241c` — `-immedzoom-1` — REVERTED

- **Hypothesis:** Delay was skipped `--node-graph-zoom` + rAF-coalesced HTML/GL apply. Intermittent pop-in was stale world-size cull cache (zoomed `offsetWidth` after settle) and origin-sync retagging zoom as pan, not a throttle. Port dots were collected before newly woken modules had live zoom/transform.
- **Change:** Write `--node-graph-zoom`, module transforms, and GL camera on the same event (WASD-style). Cache cull AABBs in world units. Skip origin-sync mid-gesture. Trailing cull if the camera epoch changes mid-pass. Position woken modules before jack chrome is collected. Official tests added slow isolated wheel ticks and a per-frame cull-rect vs visible-rect log.
- **Argi's result:** **Circuit builder unusable.** Panning at a few fps. Wire dots still pop in. Q still causes pop-in. Parameters pop in and out while the module display does not. Instruction: record what was tried, then revert to the smooth flicker-fix version.

## What was reverted

Newest first, with `git revert` (no `reset --hard`, no force-push, no discarding other people's work). All eight reverted cleanly (HTML auto-merged; no manual conflict resolution). After the reverts, `node-graph-viewport-perf.js`, `node-graph-screen-fx.js`, `node-graph-gl-graph.js`, `node-graph-camera-keys.js`, `node-graph-workspace-event-bindings.js`, `node-graph-workspace-geometry.js`, `node-graph-workspace-view.js`, and `scripts/perf_pan_popin.mjs` are identical to `fec7d8a9`. `styles.css` still has the later `-nodotcur-1` cursor work.

1. `951415de` reverts `5252241c` `-immedzoom-1`
2. `ec36d067` reverts `62ce64f8` `-livechrome-1`
3. `e7b33272` reverts `24bc92c8` `-wasdcull-1`
4. `c38b693e` reverts `84f91ce5` `-popinlog-4`
5. `2f2c5267` reverts `fba52976` `-popinlog-3`
6. `a76a8d30` reverts `af80e32e` `-popinlog-2`
7. `7654c391` reverts `e13c84ce` `-popinlog-1`
8. `92b81972` reverts `a14b5b0d` `-fxstay-3`

The history write-up itself is `22bf7567` (this file), committed before the reverts.

**Not reverted:** `fec7d8a9` (flicker fix), `7d07bd76` / `18c65ff4` (Moth pop-in + incremental plates), and other agents' commits that landed in between (`e9b5c94b` `-nodotcur-1`, `b406a1f0` APP_POLICY cursors, `64986cb5` / `fed95259` code-box work, and anything else that is not this series).

After the reverts, `?v=` cache-busts on scripts/CSS actually touched were given a **new unique** suffix (`-revert-popin-1`) so 8766 reloads even if an old `-fxstay-2` token would otherwise have been restored.

## Recommendations for a future careful redo

1. Start from this post-revert tree (flicker fix + Moth budgeted pop-in + incremental plate API). Do not replay the eight reverted commits.
2. Reproduce on Argi's real 8766 patch first. If a change is not visible there, it is not done — passing `perf_pan_popin.mjs` is not sufficient.
3. One change at a time, with a unique `?v=` bump, local commit, no push unless he asks. Let him retest (Ctrl+F5) after each.
4. Leave WASD and the flicker fix (MustStayAwake, screen-fx `lastFinal`) completely alone.
5. Treat "make the other gestures like WASD" as a precise constraint: `GestureActive` false for culling/present, no HTML freeze, live committed camera — but do **not** pay full `PositionGridHtml` + full `Present()` on every high-rate pointer/wheel sample. Coalesce expensive work to one rAF without deferring the camera commit or dropping a trailing update.
6. If mid-gesture `ReplayMesh` is used, lights and port/jack dots have to be in that mesh or they will wait for settle. Wires may stay full-length-only.
7. Never store CSS-zoomed `offsetWidth` in a world-unit AABB. Never let origin-sync retag a zoom gesture as pan.
8. Keep `__popinDump()` as a returning ring buffer if it is still present after the revert; if the revert removed it, a future debug patch should add the returning dump *without* changing gesture/cull behavior.
9. Watch frame time on the real patch (not only the 60-module grid). A few-fps pan means the change failed, even if pop-in looks better in a synthetic test.

## Stage 5a notes (pop-in reproduction, then shelved)

Argi reported that `1e6a35c5` (`-view-4-budget-k`, footer build RK3I on 8766) made no visible change: wheel and Q/E still popped in on his machine, WASD was fine. Official tests kept passing, so they were not exercising his conditions.

What we verified from his real `__viewDump` and on-disk patches, then stopped when he said the pop-in only happens at extreme offsets and zooms:

- The 22-module patch that matches the dump (output, plot1d-1, combResonator-1, onset-1, clock-1, stepGraph-1, codeBox-1; no pluckEnvelope) is the untracked `patches/acoustic/bass2.json`. The committed `tests/fixtures/view-real-acoustic-bass.json` / `patches/acoustic/bass.json` have 23 nodes (extra codeBox-2). Working-patch restore is the session blob, not the unused `soemdsp-sandbox.defaultPatch.live.v6` key.
- `present.counts` of replay 173 / replayFail 67 / full 67 with `fails: { "no-mesh": 67 }` are cumulative. They were not split into boot vs mid-camera in that dump. `meshGen` 56 with `meshFresh` at idle is consistent with a lot of those 67 being load / full `RebuildPlates` rather than a mid-hold miss — unproven, because `InvalidateMesh` had no reason log at the time. Instrumentation now records `reason`, `duringCamera`, and `presentCounts.replayFailDuringCamera` / `fullDuringCamera`.
- `onset-1` stayed blank after 106 s: `paramMissing`, `hasFace` false, `cacheSliders` 0, `cacheLabels` 3, `cacheJacks` 3, laid out. The onset chrome capture is a separate bug (position slider world box / face class), not the mid-gesture pop-in.
- `nodeGraphLogJackVisibility` FAILs at zoom 0.5 with every jack at 1.69x3.39 screen px (`size-1.7x3.4`) were a stale diagnostic: the census used `getBoundingClientRect` < 2x2. A normal 7x14 jack at 0.5x is ~1.7x3.4 on screen. The census now uses layout `offsetWidth` / `offsetHeight`.
- Tests at zoom 2, 1600x1000, guitar-pluck / 23-node bass, often headless, did not reproduce the casual-camera pop-in. Do not claim a visual fix from those numbers. Per Argi (t752u era) the remaining pop-in is only at extreme offsets and zooms and is shelved.

## Stage 5b: selection snake frozen by the cached-mesh replay

`1e6a35c5` made `Present()` replay the cached mesh whenever it was valid, not only on camera-only frames. Two leftovers then froze the snake:

1. `PresentTrail` still looked up `mesh.batches[5]`. That index was correct when batches were `[plates, wires, contacts, dots, veil, trail]`. After the dots batch was folded in, the trail lives at `[4]`, so `held` was always missing and every lasso frame fell through to `PresentSoon` → `Present()`.
2. That `Present()` then took the Stage 4 replay path, restamping plates, wires, and a stale trail. Selection still worked in JS (he could delete), but the snake stopped once it crossed a module (the first `renderNodeGraphSelection` → `Present()` replay) and later highlights never entered the mesh. His later dump (`replay` 1617, `replayFail` 262 with `no-mesh` 257 and `gen-mismatch` 5) fits this: almost all selection frames were silent replays.

The fix: replay only when the live selection key (selected modules, selected wires, raised id, drag) matches the key stored on the mesh; otherwise do a full present so highlights are submitted this frame. `PresentTrail` finds the snake canvas by id and redraws only that overlay. Camera frames stay a cheap replay plus a live trail refresh. `scripts/test_selection_snake.mjs` drags a real snake across 3+ modules and asserts per frame that the trail and `selectedDrawn` were submitted.
