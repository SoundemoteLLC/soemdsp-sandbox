# Module display rewrite plan

**Status:** plan only, waiting for Argi's sign-off. No code has changed.
**Base:** `d70104de`, the `fec7d8a9` flicker-fix behavior.
**Read first:** `docs/PAN_POPIN_ATTEMPTS.md`, which records the eight reverted patches.

Argi said: *"whatever controls how modules are displayed and when, seems like it needs a rewrite. stop trying to patch it."* This document covers:

- what that system is today,
- why it keeps breaking,
- what should replace it,
- how to swap it in one small, testable, revertable step at a time on his real patch.

---

## 1. The system today

### 1.1 Input paths: who moves the camera and what each one triggers

| Input | Entry point (file:line) | What it sets | Render mode it lands in |
|---|---|---|---|
| **W/A/S/D** | `node-graph-camera-keys.js:64` `tick` → `:101` `setNodeGraphPan(..., {gesture:true})` → `node-graph-workspace-view.js:198` → `applyNodeGraphPan` (`:1`) → `markNodeGraphViewportGesture("pan")` | Adds the `viewport-gesturing` class and `will-change`, but **no** `workspacePanning`, **no** wheel timer | `nodeGraphViewportGestureActive()` is **false**. The HTML is not frozen, the cull is live every tick, and `Present()` does a full draw. **This is the one that works.** |
| **Q/E** | `camera-keys.js:94-97` → `setNodeGraphZoom` (`node-graph-workspace-zoom.js:71`) → `:127` `markNodeGraphViewportGesture("wheel")` | `wheelActiveUntil` + a 140 ms `settleTimer` (`viewport-perf.js:329-333`, `:670`) | Gesture active, so the HTML is frozen, the cull is skipped, and `Present()` replays the mesh. Shares the wheel path, not the WASD path. |
| **Mouse wheel** | `workspace-zoom.js:681` `handleNodeGraphWorkspaceWheel` (bound `event-bindings.js:125`) → marks `"wheel"` → `zoomNodeGraphAt` → `setNodeGraphZoom` (marks `"wheel"` again) | Same as Q/E, plus the `viewport-zooming` class (hides HTML ports, freezes the stroke var) | Frozen until 140 ms after the last tick |
| **Middle-mouse drag** | `workspace-view.js:727` `beginNodeGraphWorkspacePanFrom` sets `workspacePanning` and marks `"pan"`; `:937` drag → `setNodeGraphPan(..., {gesture:true})`; `:959` end → `flushNodeGraphViewportOnPointerUp` | `workspacePanning` | Frozen until pointer-up |
| **Ctrl/Alt + middle drag zoom** | `workspace-zoom.js:703/732/745` | `smoothZoomDragging` | Frozen until pointer-up |
| **Touch pinch** | `workspace-view.js:811/841/870` | `workspacePinchZooming`; hands off to a pan when one finger lifts | Frozen until pointer-up |
| **Programmatic** (recenter, load, auto-frame, mini-perform, external UI events, trace replay in `gl-graph.js:5403-5437`) | `setNodeGraphPan` without `gesture`, `applyNodeGraphZoom` | Usually `immediate`, so `flushNodeGraphViewportImmediate` runs | Full flush every call |
| **Workspace resize / chrome layout** | `node-graph-workspace-geometry.js:10` `applyNodeGraphWorkspaceView` → `:71`/`:77` `scheduleNodeGraphWorkspaceOriginSync` (double rAF) → `applyNodeGraphPan()` **with no options**. Also `wire-rendering.js:438` `notifyNodeGraphChromeLayoutChanged` | Runs `flushNodeGraphViewportImmediate`, which **clears the settle timer and the wheel window and thaws mid-gesture** (`viewport-perf.js:1630-1640`) | Can land in the middle of a wheel or Q/E gesture |

So six input paths drive at least **four** render modes:

1. WASD live.
2. Frozen until a timer (wheel, Q/E).
3. Frozen until pointer-up (middle-mouse, smooth zoom, pinch).
4. Immediate full flush (programmatic, origin-sync).

### 1.2 Element types and how each one decides it is visible

The circuit builder is a **hybrid**:

- **HTML `.dsp-node` elements** are laid out by the browser (CSS `zoom` per module plus a translate) and keep live inputs, text edit fields, popovers and some faces. With `gl-graph-on` (`styles.css:12837`) their backgrounds are transparent and most of them ignore the pointer.
- **One GL canvas set** (`node-graph-gl-graph.js`) draws the module plates, the module "chrome" (titles, IO labels, jacks, **parameter sliders**, keys, keypads, graphs, header buttons, pills), display faces, wires, wire/jack dots and the heatmap lights.

Each piece decides its visibility differently:

| Element | Where its picture comes from | What makes it appear | Notes |
|---|---|---|---|
| **Module HTML** | DOM. `.viewport-asleep` sets `display:none !important` (`styles.css:13305`). | Geometric cull `nodeGraphViewportCullRefresh` (`viewport-perf.js:1084`), the IntersectionObserver (`:1544`, wake-only, 160 px margin), Moth's pop-in pass (`:1313`), selection sync (`:1616`), `MustStayAwake` (`:1415`), and boot or a tiny workspace (wake all, `:1014`) | Three different margins: cull 96 px, IO 160 px, pop-in 96 px |
| **GL module plate** | `nodeGraphGlGraphCollectPlateAndDisplays` (`gl-graph.js:152`) reads **published geometry** (`nodeGraphModuleGeometryGet`) plus `getComputedStyle` | A plate rebuild: full (`:243`) or incremental by ids (`:280`) | Published geometry **keeps the last box while a module is asleep** (`node-graph-module-geometry.js:174-180`), so a plate can exist for a sleeping module |
| **GL chrome: titles, labels, jacks, parameter sliders** | `nodeGraphGlGraphRebuildChrome` (`gl-graph.js:894`) → `CollectChromeForNode` (`:662`) → `nodeGraphGlGraphWorldBox` (`:607`), which uses **`offsetLeft`/`offsetWidth` of the live DOM** | Only while the module HTML is laid out (awake) at rebuild time | **The DOM measurement returns `null` for a `display:none` module, so its parameters and labels vanish from GL while its plate stays.** This is the "parameters pop in and out while the module display doesn't" Argi saw. |
| **Display faces (scopes, video)** | Module canvases, drawn as GL quads | Plate rebuild + face painters woken by `nodeGraphViewportCullWakePainters` (`viewport-perf.js:908`) | Painter loops are stopped and started by cull sleep and wake (`:979`) |
| **Heatmap / module lights** | GL lights pass built from `state.plates`. The CSS grid phase comes from `updateNodeGraphGridHeatmap` (`workspace-geometry.js:684`). | A full present. That function skips the O(modules) work mid-gesture (`:716-728`) and skips asleep modules (`:765`). Incremental plates defer `batch.lights` until a full present. | Different again from plates and chrome |
| **Wires** | `nodeGraphGlGraphRebuild` (`gl-graph.js:2742`) from `nodeGraphPortCenter`/`IoPillPoint`, which read published geometry or the DOM | A full rebuild (`drawNodeGraphWires`, `wire-rendering.js:313`) at settle or pointer-up. Mid-gesture the mesh replays with the old list. | Argi accepts wires appearing only once fully visible |
| **Wire/jack dots** | Per-module stack, `endsByNode` + dot bake (`gl-graph.js:3244`) | **The bake is kept unchanged mid-gesture** (`:3248` `if (p.gesturing && prev) return prev`). Incremental draws had empty `endsByNode`. | A fourth path |
| **HTML jacks/ports** | DOM | Hidden by CSS while `viewport-zooming` (`styles.css:7684-7687`) | A fifth path, CSS-only |
| **Viewport In/Out + video/screen-fx modules** | `node-graph-screen-fx.js`, picture graph | `MustStayAwake` keeps them out of the cull. `lastFinal` (`screen-fx.js:431-440`, `:480`) keeps the last good frame. | **The flicker fix. Must survive unchanged in behavior.** |

### 1.3 Flags, timers and caches involved

All of these live in `node-graph-viewport-perf.js` unless a file is named.

- **Gesture flags:** `nodeGraphMvp.workspacePanning`, `.smoothZoomDragging`, `.workspacePinchZooming`, `nodeGraphViewportPerf.wheelActiveUntil` (160 ms hold), and `.settleTimer` (140 ms, `:670`). Together they form `nodeGraphViewportGestureActive()` (`:264`), which, with the freeze flag, is referenced about **50 times across 7 files** (viewport-perf, workspace-geometry, gl-graph, module-face, wires, port-geometry, slider-values).
- **Freeze:** `htmlFrozen` and `htmlCamera` (`:112-156`), `nodeGraphApplyFrozenHtmlCamera` (one transform on every world/text layer), and `NODE_GRAPH_GESTURE_WILL_CHANGE` with its toggle (`:185-221`).
- **CSS classes:** `viewport-gesturing` and `viewport-zooming` on the workspace (`:284-334`), and the frozen stroke compensate var (`:337-358`).
- **Coalescing rAFs:** `heavyRaf`, `wireViewBoxRaf`, `heatmapCameraRaf`, `gestureHeatmapRaf`, `cullRaf`, `nodeGraphViewportWakeRebuildRaf`, `nodeGraphViewportPopIn.raf`, `workspaceOriginSyncFrame` (double rAF), and `wireRedrawFrame` (double rAF).
- **Throttle timers:** `cullTrailingTimer`, `minIntervalMs` 48, pop-in `timer` (100 ms minimum interval), and `persistTimer` 220 ms.
- **Re-entrancy and partial-state flags:** `nodeGraphViewportCullFlushing`, `nodeGraphViewportPopIn.{rebuild, partial, partialGen}`, `holdHeavyDepth`/`heldHeavy`, `bootHeavyQueued`, and GL `gen` vs `mesh.gen`.
- **Size caches:**
  - `element._viewportCullW/H`, which are DOM `offsetWidth`. Whether those are world or zoomed units depends on CSS zoom semantics; see the attempts doc.
  - `_awakeClientWidth/H`.
  - `nodeGraphHeatmapBoundsCache`.
  - Published module geometry (`nodeGraphModuleGeometryById`).
  - The workspace layout-metrics cache.
  - The 220×140 guess for an unmeasured module.

### 1.4 Who decides visibility, and when

Nobody decides it alone. On any given frame, visibility comes out of a race between:

1. the geometric cull (rAF, sometimes throttled 48 ms, skipped while frozen),
2. the IntersectionObserver (async, can only wake, ignored while frozen, and **never fires again for a `display:none` element**),
3. Moth's pop-in pass (every ≥100 ms, at most 24 modules or 8 ms),
4. settle / pointer-up full flush (`flushNodeGraphViewportHeavyChrome({full:true})`, `:611`),
5. origin-sync's unoptioned `applyNodeGraphPan()`, which can do a full flush and thaw mid-gesture,
6. `MustStayAwake` and selection overrides.

The GL side then rebuilds or doesn't, depending on `gen`, `mesh.gen`, `partial`, and whether a gesture is active.

### 1.5 Why it breaks (root causes, not symptoms)

1. **GL picture depends on DOM layout, and DOM layout depends on culling.**
   - Chrome (parameters, labels, jacks) is measured from live HTML with `offsetLeft`/`offsetWidth`. A culled module has no layout, so its GL chrome is missing.
   - Plates use a kept geometry box, so they can show without their parameters.
   - Lights, dots and wires each read from yet another cache.
   - Any time the cull state and the GL rebuild are out of step, some layers of a module are on screen and others are not. **This is the inconsistency between modules, heatmaps, wires, dots and parameters.**
2. **Rendering behaves differently depending on which input moved the camera.**
   - "Gesture active" switches the HTML freeze, cull skipping, mesh replay, deferred lights, the dot bake hold, the deferred zoom var and the hidden ports.
   - WASD happens to dodge the flag, so it gets the live path.
   - Every fix so far tried to make the frozen path act like the live one, one element type at a time.
3. **The gesture flag's lifetime is driven by timers and side effects, not by input state.**
   - The wheel and Q/E end 140 ms after the last tick.
   - Origin-sync can end a gesture early and the next tick restarts it.
   - So two identical slow wheel ticks can land in different modes. That is why pop-in is **intermittent and not speed-related**.
4. **Several wake authorities with different margins and stale inputs.**
   - The IO can't see `display:none` elements.
   - The pop-in pass uses cached sizes that may be in the wrong units.
   - The cull reads `offsetWidth` on whatever zoom the module last had.
   - Each authority is correct in isolation; together they disagree.
5. **Full work is paid all at once at settle.**
   - The full plate rebuild, chrome measurement, wire rebuild, geometry publish and heatmap all wait for the end of the gesture.
   - That makes pop-in-at-release, and it is also why letting the work happen mid-gesture (`5252241c`) collapsed fps: there was no cheap incremental path to run per frame.
6. **The freeze hides the problem it creates.**
   - `will-change: transform` caches a raster that does not include modules woken mid-gesture.
   - The fix for that (re-raster after wake) is another special case.

---

## 2. Proposed architecture

One camera, one per-frame loop, one visibility authority, and every element type drawn from cached world-space records that **do not depend on whether the module's HTML is currently mounted**.

### 2.1 One camera

- `ViewCamera = { x, y, zoom, epoch }` in world units, with one setter: `viewCameraSet({ x, y, zoom, anchor })`.
- **Every** input calls only that setter: WASD, Q/E, wheel, middle drag, smooth zoom, pinch, programmatic moves, and resize or origin pin. The setter stores the value, bumps `epoch`, and asks for one frame. It does no DOM work.
- Input state stays only where input needs it, for example `workspacePanning` keeps the drag start. **Rendering never reads input state.** There is no "gesture active" render mode.
- Saving the view stays a debounced timer after the camera stops. It never touches rendering.

### 2.2 One frame loop (`viewFrame`, one rAF when the camera or any record is dirty)

Each frame runs in this order: reads first, then writes, with no forced reflow in between.

1. **Camera:** take the latest camera, coalescing all samples since the last frame. The last sample always wins, so no trailing update is ever dropped.
2. **Visibility:** query a world-space index of module boxes (a uniform grid; a plain array scan is fine below about 1,000 modules) with the view rectangle plus an **overscan margin**. That gives the *wanted* set. The *pinned* set (Viewport In/Out, live video/screen-fx sources, presented faces, mini-perform, face-page, layout-canvas pins, selection) is always wanted. This is today's `MustStayAwake`, moved over unchanged.
3. **Mount/unmount diff:**
   - Modules that are wanted but unmounted go on a mount queue, nearest the center first.
   - Modules that are mounted but outside a *larger* exit margin go on an unmount queue. The gap between the two margins is the hysteresis: no flapping at the edge.
4. **Budgeted mount work:** wake HTML, start painters, measure if the record is dirty. This runs within a time budget per frame, around 3–4 ms; anything left over runs next frame. Unmounting is cheap and also budgeted.
5. **Writes:**
   - The camera goes to the GL uniform.
   - CSS zoom + translate goes to **mounted modules only**, which is bounded by what is on screen and not by patch size.
   - `--node-graph-zoom` goes on the workspace every frame. Unmounted modules are `display:none` and cost nothing.
6. **Present:** replay the cached GL mesh with the new camera. Only modules whose records changed are patched into the mesh (the incremental plate API from `18c65ff4`). A full mesh rebuild happens only when the patch structure changes.

### 2.3 Records: the per-element-type renderer contract

Each module has one **ModuleRecord** in world units, built from the DOM **once when the module's layout or content changes**: on add, resize, parameter list or rail change, text edit, theme change. It is never rebuilt because of the camera or culling. If a module has never been measured, it is measured during boot, when every module is already awake (`viewport-perf.js:1014`).

| Record part | Contents | Used by |
|---|---|---|
| `box` | x, y, w, h (world) | the visibility index, plate, lights |
| `plate` | fill, flags (selected, text box, on top) | GL plates batch |
| `chrome` | titles, labels, jacks, **parameter sliders**, keys, buttons, pills, as world boxes | GL chrome |
| `ports` | jack world points + visibility | wire ends, wire dots |
| `faces` | display canvases + their world rects | GL face quads; painters |
| `light` | center, radius, color | GL lights pass |

Every element type renders through the same contract:

- `build(record)` makes the GPU data once per record change.
- `draw(camera)` is a uniform-only replay.
- `mount(id)` and `unmount(id)` are for things that need live work: HTML inputs, painter loops, video sinks.

**Rule:** what is on screen in GL depends only on records and the camera, never on mount state. Mounting affects HTML interactivity and live painting only. Modules, parameters, heatmap lights and jack dots therefore all appear in the same frame, on every input path, because they come from the same record.

Per element type:

- **Modules, parameters, labels, jacks:** drawn from records. The HTML is mounted for live inputs, text editing and faces only.
- **Heatmap lights:** drawn from `record.light` in the GL lights pass every present. The `updateNodeGraphGridHeatmap` module loop goes away (it already only builds GPU data).
- **Wires:**
  - Built from `record.ports` of both ends, rebuilt only when connections or ports change.
  - Drawn every frame by the camera uniform; the GPU clips them.
  - They can't depend on the end module being mounted, so they show as soon as any part is in view. That is earlier than today; Argi's "only once fully visible" is allowed, not required (see the open questions).
- **Wire/jack dots:** built with the wires, keyed by module, and drawn in that module's stack. No mid-gesture bake hold.
- **Display faces and video/shader modules:**
  - Their quads come from the record.
  - Painter loops are started by `mount` and stopped by `unmount`, except pinned modules, which never unmount (the flicker fix).
  - `lastFinal` in screen-fx stays exactly as it is.
- **Text sharpness:** the GL text bake can be redone at the new zoom about 150 ms after the camera stops. That **"quality pass" may only sharpen; it never adds or removes anything.** It is the only render timer left (saving the view keeps its own debounce).

### 2.4 What gets deleted

All of this is in `node-graph-viewport-perf.js` unless a file is named.

- **Render-mode switching:**
  - `nodeGraphViewportGestureActive()` as a render switch, and every render-side reader of it (about 50 references across 7 files).
  - `wheelActiveUntil` and `settleTimer` as render gates.
  - `nodeGraphViewportHoldsDisplays`.
- **Freeze:** the HTML freeze (`htmlFrozen`, `htmlCamera`, `nodeGraphFreezeHtmlCamera`, `nodeGraphApplyFrozenHtmlCamera`, `nodeGraphThawHtmlCamera`, `nodeGraphInvalidateFrozenHtmlLayers`) and the `will-change` toggle.
- **CSS:**
  - `viewport-zooming` port hiding (`styles.css:7684-7687`) and the frozen stroke-compensate var.
  - `viewport-gesturing` stays only if Argi wants the dot cursor while panning.
- **Wake paths:** the IntersectionObserver cull, the geometric cull's DOM `offsetWidth` reads, the `_viewportCullW/H` cache, the 220×140 guess, Moth's pop-in pass and its partial/settle-full bookkeeping, the cull throttle and trailing timer, and `scheduleNodeGraphViewportWakeRebuild`.
- **Settle and rAF plumbing:** `flushNodeGraphViewportHeavyChrome` as a settle step, `flushNodeGraphViewportOnPointerUp`, `heavyRaf`, `wireViewBoxRaf`, `heatmapCameraRaf`, and `gestureHeatmapRaf`.
- **GL:** the `gesturing` holds in `node-graph-gl-graph.js` (`:3009`, `:3248`, `:3911-3915`).
- **Origin-sync:** `applyNodeGraphPan()` without options becomes `viewCameraSet` with the pinned origin.

Kept: `MustStayAwake` (as the pinned set), `lastFinal`, the incremental plate API, the module geometry store (reworked as `record.ports`), and `nodeGraphPositionGridHtml` (restricted to mounted modules).

---

## 3. Performance budget (60 fps = 16.7 ms per frame)

| Work per frame while moving | Budget | How |
|---|---|---|
| Input handlers | < 0.2 ms each | They only call `viewCameraSet`. No DOM work. |
| Visibility query + diff | < 0.5 ms | Grid index in world units. No DOM reads. |
| Mount work (HTML wake, painter start, dirty-record measure) | ≤ 4 ms, hard cap | Nearest first, the rest next frame. Overscan means it normally finishes before a module reaches the edge. |
| Module style writes | ~ mounted count | Only mounted modules, typically tens and not hundreds |
| GL present | ~2–3 ms | Mesh replay with a camera uniform (measured about 2.5 ms on the 60-module grid). Patch only changed records. |
| Browser style/layout/paint | the rest | Unmounted modules are `display:none`, so no style or layout. There is no forced reflow because all reads happen before writes. |

Rules that keep it there:

- Nothing O(patch size) runs per frame except the index query.
- Full rebuilds happen only on structural patch changes, never because of the camera.
- **Measure on his real patch:** frame time p50, p95 and max, plus long tasks over 50 ms, for each input path. Pass means p95 ≤ 20 ms and no long task during a gesture.
- If his patch has many video/shader modules pinned awake, their cost is the same as today with the flicker fix, so it is not a new cost.

---

## 4. Staged migration

Each stage is **one local commit**, with a unique `?v=` bump in `public/index.html` and `public/perform.html` for exactly the files it touches. It is revertable with one `git revert`, and Argi checks it on his real patch at 8766 (Ctrl+F5) before the next stage starts. Nothing is pushed unless Argi says so. WASD and the flicker fix must still pass at every stage.

| # | Stage | What changes | What Argi should see | Revert risk |
|---|---|---|---|---|
| **0** | **Measure only** | Add a read-only `__viewDump()` that **returns** camera, mounted and wanted counts, per-frame times, and blank-module count (records in view without a plate in the mesh). Add a "copy patch for tests" export. Add `scripts/perf_view_real.mjs` (below). **No behavior change.** | Nothing different. We get numbers from his machine. | None |
| **1** | **World-unit module boxes** | One store of module boxes in world units, filled at layout time. The existing cull and pop-in read it instead of `offsetWidth` or `_viewportCullW`. | Fewer intermittent wheel/Q/E pop-ins. Everything else the same. | Low |
| **2** | **GL records independent of mount** | Chrome, ports, dots and lights are cached per module and rebuilt on content change only, not dropped when a module is culled. | **Parameters, labels, jacks, dots and lights always match the module plate**, even if the HTML wakes late | Medium (gl-graph) |
| **3** | **One camera setter** | Every input path calls `viewCameraSet`; one `viewFrame` rAF applies it. The old render code still runs inside it, with the WASD-style live path (no freeze) for everyone. | Wheel, Q/E and middle-mouse behave like WASD. Check that fps holds. | Medium |
| **4** | **One visibility authority** | Grid index + overscan + hysteresis + budgeted mount/unmount replace the cull refresh, IO, pop-in pass and selection sync. `MustStayAwake` becomes the pinned set. | No blank modules mid-gesture on any input. Flicker still gone. | Medium |
| **5** | **Delete the old machinery** | Remove everything in §2.4. Origin-sync uses the camera setter. | Same as stage 4, with less code | Low, if 1–4 held |
| **6** | **Quality pass + polish** | Text re-bake 150 ms after the camera stops. Tune overscan and the budget on his patch. | Text sharp after stopping; nothing pops | Low |

If a stage fails on his patch, revert that one commit, record why in `docs/PAN_POPIN_ATTEMPTS.md`, and fix it within the stage. Do not stack a patch on top.

### 4.1 Test plan on Argi's real patch (8766, after Ctrl+F5, every stage)

For each input: **WASD**, **Q hold**, **E hold**, **single slow wheel ticks** (10 in, 10 out), **fast wheel**, **middle-mouse drag** (slow and fast), **Ctrl/Alt-drag zoom**, and **pinch** if he has a touch screen.

- [ ] No module, parameter, label, jack, jack dot or heatmap light is blank or late while moving
- [ ] Wires appear as agreed in open question 3
- [ ] Viewport In/Out: no flicker on any input
- [ ] Panning feels as smooth as WASD does today
- [ ] After he runs it, `__viewDump()` shows p95 ≤ 20 ms, 0 long tasks, 0 blank modules

### 4.2 Better headless repro (`scripts/perf_view_real.mjs`)

- **His patch, not the grid:**
  - Loads a **captured copy of his real patch** (stage 0 export), with his OK on where it is stored.
  - Uses a fresh server on a free port, never 8765, 8766 or 8080.
  - Uses his window size and device pixel ratio.
  - Applies 4× CPU throttle so a fast box behaves more like a busy one.
- **Real input events:** drives every input path with real events (`mouse.wheel` single ticks with pauses, middle-button drags, held Q/E/WASD keys, CDP touch pinch). It does not call internal functions.
- **Checks every frame**, not just at the end:
  - every module record intersecting the view has a plate **and** its chrome in the mesh;
  - frame times;
  - long tasks;
  - the screen-fx overlay never blits empty (flicker guard).
- **Does not replace Argi's check.** It is a fast guard so a stage isn't handed to him already broken. The synthetic `perf_pan_popin.mjs` stays as a smoke test only.

---

## 5. Risks and open questions

**Risks**

- **Stale records:**
  - If some module type changes its layout without telling the record store, its GL picture goes stale. That is a stale picture, not a pop-in, but still wrong.
  - Mitigation: a ResizeObserver on mounted modules marks their record dirty, plus a debug check in `__viewDump()` that compares records to the DOM for mounted modules.
- **Measurement cost on huge patches:** booting with every module awake already happens today. Records just keep what boot measured.
- **Gl-graph is 5,281 lines:** stage 2 touches its heart, so it gets its own stage and its own check by Argi.

**Questions for Argi**

1. While zooming, is it OK if module text is a little soft and sharpens about 150 ms after you stop? Only the sharpness changes; nothing appears or disappears.
2. May I save a copy of your current 8766 patch into the repo (for example `tests/fixtures/`) so the headless test uses your real patch? Or should it stay outside git?
3. Wires: OK if they show as soon as any part is on screen, instead of only once fully visible? It's simpler, and they'd never pop.
4. Jacks: OK to stop hiding the HTML jacks while zooming? Today `viewport-zooming` hides them, so they'd always show.
5. How far beyond the screen edge should modules get ready in advance? I'd start at a quarter of the screen.
6. Who builds it: MasterBot, or Moth, since she owns the viewport-perf pop-in code?
