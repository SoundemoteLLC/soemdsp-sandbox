# Preset Explorer: Design Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-24 |
| **Status** | **DRAFT for Argi's review.** Investigation and design only. No feature code written. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Replaces** | The broom page circuit presets (`node-graph-circuit-patches.js`) and the 📄 Pages menu (`node-graph-pages.js`) |
| **Related** | `docs/MUTATOR_PLAN.md` (preset morphing lands there later), `docs/APP_POLICY.md` (§2, §5, §22, MIDI boundary), `docs/MODULE_DISPLAY_REWRITE_PLAN.md` (MasterBot's files, hands off) |

---

## 1. What Argi asked for

One folder-style **Preset Explorer** that replaces both preset systems.

- The first page is a **blank Quick Variations** folder, for saving variations of the current patch quickly. Nothing floods the list when the menu opens.
- Today's static presets move into **Factory**, **My Presets** and **Explore**.
- Every preset is its own item and **folders do the grouping**. There is no separate "grouped presets" manager.
- Buttons are **Save, Load, Remove, Rename**. There is no Update. Saving over an existing preset asks for confirmation.
- Clicking a row **only selects it**. Load is a confirm button and **pushes an undo point first**.
- **Fast audition**: a ▶ on every row plays the preset without replacing the live patch. A small spinner shows while it builds, then a test note plays.
- A **waveform thumbnail** per preset, captured at save time.
- A **circuit fingerprint** per preset (module types plus wiring). Matching fingerprints can morph and show a 🔗 icon. The morphing itself comes later with the Mutator work.
- Search, and sort by name or newest.
- References: 808 Lab's preset list (▶, thumbnail, tags, sort, star) and the XLN Addictive Drums browser (▶ with spinner, source folder tiles, info panel).

## 2. Short answers

| Question | Answer |
|----------|--------|
| Can the engine build a second circuit offscreen and play a note through it? | **Yes, and the code already does it.** Render Sample (`renderNodeGraphAudio`, `node-graph-render-output.js:84`) builds an `OfflineAudioContext`, creates its **own** AudioWorklet node with its own native WASM engine from a plan, and bounces to a buffer. The live engine is never touched. Audition reuses that path with the preset's plan and plays the resulting buffer. |
| Is the swap-in-and-restore fallback needed? | **No. Do not build it.** It would restart the live engine twice, run MasterBot's wake and rebuild twice, and risk leaving the preset in the autosaved session. See §6.5. |
| How does a test note play without breaking the MIDI rule? | Through the preset's own **Keyboard / Grid Keyboard module**, using the same `setKeyboardModuleSignal` message the on-screen keyboard uses. That is a signal sender, not MIDI. See §7. |
| How are waveform thumbnails captured? | From the same offline render, reduced to about 96 min/max peak pairs, stored on the preset, and drawn as an inline SVG path. No canvas. See §8. |
| How is the circuit fingerprint computed? | A hash of a canonical, sorted description of module ids and types, wires, modulation wires, and the *count* of structured data points. Knob values, positions, view and `paramMeta` are excluded. The existing `nodeGraphPatchFingerprint` hashes the whole patch including values, so it can't be reused. See §9. |

## 3. Findings: the two current systems (and a third that is dead)

### 3.1 Broom page circuit presets ("C-1, C#1 …")

The "broom" is the 🧹 **Ready** page (`patchDefaults` in `node-graph-unified-window.js:101`, panel `#nodePatchDefaultsPanel`, `index.html:2663-2818`). Its lower half is the circuit patch tools.

- **Code**: `public/node-graph-circuit-patches.js` (427 lines), loaded at `index.html:3902` and `perform.html:3884` as `?v=circuit-patches-6`.
- **UI**: `index.html:2804-2811` and `perform.html:2791-2798`. Buttons are `#nodeCircuitPatchSet/Update/Copy/Paste/Default` plus the list `#nodeCircuitPatchList`. It renders 128 slot buttons named by `nodeGraphCircuitPatchMidiName(i)`. Their `title=` attribute is a hover tooltip, which is not allowed.
- **Storage**: it lives **inside the patch JSON**, not in localStorage or on a server. The fields are `patch.circuitPatches` (128 slots, each `{values}` holding only the params that differ from the default), `patch.defaultCircuitPatch.values` (full param set) and `patch.activeCircuitPatch` (-1 for default, 0 to 127 for a slot). They are serialized in `node-graph-patch-serialization.js:112-114` and normalized in `node-graph-patch-core.js:1218-1222`. Because `recordNodeGraphHistory` serializes the whole patch, every undo snapshot carries them.
- **List, save, load**:
  - Set: `nodeGraphCaptureCircuitPatchSlot`. It records history, stores a param diff, and records history again.
  - Update: `nodeGraphUpdateCircuitPatchSlot`.
  - Load: `nodeGraphApplyCircuitPatchSlot(index)`. It calls `recordNodeGraphHistory()`, applies the values with `nodeGraphApplyCircuitPatchValues`, then does `commitNodeGraphPatch(patch, { liveParamsOnly: true, paramSyncIds })`. That is a params-only commit and the right model for same-circuit presets.
  - A slot that was never set falls back to the nearest lower set slot.
- **Consumers outside the file** (the removal surface):

| File | What it does with circuit patches |
|------|----------------------------------|
| `node-graph-slider-dragging.js:183`, `modules/additiveGraph/additive-graph-math.js:133` | Call `nodeGraphWriteActiveCircuitPatchParam` on every knob change so edits write into the active slot. |
| `node-graph-history.js:207` | Re-renders the slot list after undo or redo. |
| `node-graph-module-actions.js:1784-1788` | Binds and renders the list when Ready opens. |
| `node-graph-view-controls.js:2365, 3591-3604` and `modules/gridKeyboard/grid-keyboard.js:240, 308-318` | The keyboard mode **Trigger Patch**: a key press loads that note's slot, and `patch-set` styling marks filled slots. |
| `node-graph-view-controls.js:2726-2761`, `node-graph-module-factories.js:602`, `modules/keyboardController/keyboard-layout-settings.js:366` | The mode list and label. An unknown mode already normalizes to `"slide"` (`nodeGraphKeyboardMode`), so patches that saved `triggerPatch` degrade safely. |
| `lib/visual/piano-keys-draw.js:362, 405`, `styles.css:3514`, `styles.css:5721-5776` | `patch-set` key drawing and the slot grid CSS. |

- **Shipped data**: **0** of the patches under `patches/` and `saved-patches/` contain `circuitPatches`. Removal breaks no shipped patch. It could still orphan data in Argi's own sessions (see Open Question 6).

### 3.2 The 📄 "paper page" (Pages)

- **Code**: `public/node-graph-pages.js` (441 lines). Registry entry `pages` at `node-graph-unified-window.js:56-63`. Panel `#nodePagesPage` at `index.html:546-575` and `perform.html:542-571`. Window geometry at `node-graph-floating-windows.js:948` and `node-graph-unified-window.js:1641`. CSS `.node-pages-*` at `styles.css:4834-5010`.
- **Listing**: `loadNodeGraphPagePatchCatalog()` fetches `/soemdsp-sandbox/patches/index.json`, then `./patches/index.json`, then `/patches/index.json`. If all fail it falls back to the saved-patches API through `loadNodeGraphDemoPatchEntries`. Each entry is `{slug, label, name, folder, url, author, emoji}`, with at most one folder level. `renderNodeGraphPagesList()` draws it as DOM `<button>` rows. Folders sort "filter*" first.
- **Why it floods**: the root view draws every folder card and every root-level patch as soon as the window opens.
- **Storage format**: static files `patches/<folder>/<name>.json`, each a **full patch** of about 40 KB. `patches/index.json` is generated by `scripts/rebuild_page_patches.py` and `scripts/prepare_page_patches.py`. The server (`server.py:499-509`) serves `/patches/` and `/soemdsp-sandbox/patches/`. Server write endpoints are `/api/patches/save` (to `saved-patches/bankNNN-programNNN-*.json`) and `/api/patches/overwrite`. The server was not touched or restarted.
- **Load**: `handleNodeGraphPagePatchClick` does fetch, validate with `loadNodeGraphPatchFromScript`, arm the existing two-tap confirm (`confirmNodeGraphDefaultButtonClick`), then `commitNodeGraphScript(text)`, then `setNodeGraphCurrentSavedPatch`, `nodeGraphRefreshServerPatchFileBaseline` and `syncNodeGraphHeaderPatchTitle`. It **does not record a history step before the load.**
- **Existing violations to avoid copying**: `button.title = …` (hover tooltips) at `node-graph-pages.js:247`, and the confirm helper's 2-second `setTimeout` (`confirmNodeGraphDefaultButtonClick` in `node-graph-default-buttons.js`). Both are fine for legacy code but not for the new design.

### 3.3 A third, orphaned system (delete with this work)

`node-graph-file-actions.js:58, 415-545` has localStorage patch presets (`soemdsp-sandbox.patchPresets.v1`: `{name, text, updatedAt}`) with save, load and delete functions. The elements they need (`#nodePatchPresetName`, `#nodePatchPresetSelect`, `#nodePatchPresetLoadButton`, `#nodePatchPresetDeleteButton`) **do not exist in any HTML**, and nothing else calls the functions. It is dead code (APP_POLICY §10b). Confirm with one more search at implementation time, then delete it.

### 3.4 Module-level preset browsers (out of scope)

`modules/sabrinaReverb/sabrina-preset-browser.js` and `modules/pulseTrain/pulse-train-preset-browser.js` are per-module knob presets with their own localStorage keys. Leave them alone. Sabrina's "Preset Morph" is a useful precedent for the later morph work: it writes only the params that differ at the surrounding stops.

## 4. Findings: the normal patch load and commit flow

- **Single entry point**: `commitNodeGraphPatch(patch, options)` at `node-graph-patch-core.js:2122`. It holds the viewport "heavy" flush (`holdHeavyDepth`), runs `commitNodeGraphPatchBody`, then `queueNodeGraphPatchCommitNotify`. Listeners registered with `addNodeGraphPatchCommitListener` run **once per outer commit, in a microtask**. That is the event-driven hook MasterBot's code and Code boxes use, so any preset load that goes through this function wakes everything correctly. Nothing in the explorer builds DOM or geometry.
- **Full load** (circuit changes): `commitNodeGraphScript(text)` (`node-graph-script-status.js:29`) = `commitNodeGraphPatch(loadNodeGraphPatchFromScript(text), { status })`. This is what Pages does today. `loadNodeGraphPatchFromScript` validates, repairs unknown modules and wires, and throws on bad JSON.
- **Params-only load** (same circuit): `commitNodeGraphPatch(patch, { liveParamsOnly: true, paramSyncIds, status })`, as the broom does. It skips the DOM rebuild and the plan recompile and calls `scheduleNodeGraphLiveParameterSync`. This respects APP_POLICY §22 (editing preserves engine state), so delay tails and filter state survive a variation switch. This is the path for any preset whose fingerprint equals the live circuit's, and later for morphing.
- **`resetEditorView: true`** (init and file open) additionally resets zoom and pan and calls `nodeGraphPlateFacesAfterPatchLoad`. Pages doesn't pass it today. Presets shouldn't either: the camera stays where it is. Whether a different-circuit preset should reframe is Open Question 7.
- **Hook for MasterBot**: none needed. If a hook is ever wanted it should be another commit listener, not a call into her files.

## 5. Findings: undo

- History is **snapshot based**: `recordNodeGraphHistory()` (`node-graph-history.js:55`) serializes the live patch (drawings and sample bytes excluded) and pushes it, **deduping against the current top snapshot**. `undoNodeGraphPatch` and `redoNodeGraphPatch` move `historyIndex` and call `applyNodeGraphHistorySnapshot`, which commits with `record: false`.
- `commitNodeGraphPatchBody` records the **post-state** after each commit (`options.record !== false`). So the load itself creates the "after" step. The "before" step exists only if the previous edit was recorded.
- **Rule for Load**: call `recordNodeGraphHistory()` **immediately before** committing. If the live state was already the top snapshot it's a no-op (dedupe). Otherwise it pins the exact pre-load state. Then commit with the default `record` so the post-load state is recorded. One Ctrl+Z returns to exactly what Argi had. The broom code uses this same bracket.
- **Quick Variations and history**: variation records live outside the patch (see §10), so they don't bloat undo snapshots the way `circuitPatches` does.
- Save does not touch history. It doesn't change the patch. It only reads it.

## 6. Findings: audition feasibility

### 6.1 How the engine is built

- Audio is **one AudioWorklet processor per node** (`node-live-audio-processor`) that hosts a **native C++ graph compiled to WASM** (`native_modules/graph_engine/graph_engine.cpp`). The worklet source is about 35 files concatenated into one blob (`node-graph-live-runtime.js:3598-3690`).
- The WASM engine is **handle based**: `soemdsp_graph_create()` returns a handle, and `scripts/test_graph_engine.mjs` runs many graphs headless. Each processor instantiates its **own WASM instance** (`node-live-audio-worklet-native-load.js:81`), so a second node means a fully separate engine with its own state, voices, buffers and compile. Note `kMaxInstances = 4` (`graph_engine.cpp:2375`) is a per-WASM-instance pool. Nobody should try to share one instance between live and preview.
- Notes reach the circuit **only through signals**: Keyboard modules' own face signal (`setKeyboardModuleSignal`), a sequencer's own audition (`setSequencerAudition`), Play Keys bitmasks and so on. `vmNoteOn` and similar exist in the message list but APP_POLICY (MIDI boundary) forbids firing VoiceManager directly.

### 6.2 What already exists: Render Sample is a second offscreen engine

`renderNodeGraphAudio()` (`node-graph-render-output.js:84-335`) does the following every time Render is clicked:

1. `plan = nodeGraphBuildLivePlan()` (from the live patch).
2. `new OfflineAudioContext(2, frames, rate)`.
3. `createNodeGraphLiveWorkletNode(offlineCtx, plan)` (`node-graph-live-runtime.js:3679`). This runs `addModule` on the blob, creates the `AudioWorkletNode`, sends the memory budget and the native module WASM bytes.
4. `port.postMessage({ type: "setPlan", plan, … })` and `{ type: "setSpeed", speed: 1 }`.
5. Waits for a `nativeGraphStatus: "compiled"` message from the node (or error).
6. `await offlineCtx.startRendering()`, then runs the bounce through the native Speaker Protector (`createNodeGraphNativeEarProtector`) and clamps.

So "build a second circuit offscreen and render a note through it" is not a research question. It runs today, against the live patch. The audition differs in only three ways:

- It builds the plan from a **candidate patch**: `nodeGraphBuildLivePlanForPatch(patch)` (`node-graph-live-plan-runtime.js:80`) already exists, takes any patch, uses `visualSinks: []` so no scope data is produced, and is **currently unreferenced** (a ready-made hook).
- It posts a **test note** (§7).
- It plays the returned buffer through a normal `AudioBufferSourceNode`.

### 6.3 Options compared

| | A. Offline render, cache buffer, play it (**recommended**) | B. Second realtime worklet node, kept alive | C. Swap preset in, restore after (fallback) |
|---|---|---|---|
| Live patch touched? | No | No | **Yes, twice** |
| Live engine state | Untouched | Untouched | Restarts or recompiles; delay tails, phases and filters lost (violates §22) |
| MasterBot's wake and rebuild | Not run | Not run | Runs on the swap **and** on the restore |
| Undo and history | Untouched | Untouched | Needs `record:false`, careful restore, risk of stray steps |
| Autosave | Untouched | Untouched | Must suppress `saveNodeGraphWorkingPatchToUserSettings`, or a tab close mid-audition saves the preset over Argi's patch |
| Cost per first play | Build plan + load worklet + WASM instantiate + render N seconds faster than realtime (time depends on the circuit; **not measured**, see 6.6) | One-time load; later plan swaps are cheaper | Two full patch commits |
| Cost per replay | **About zero** (cached buffer) | Cheap | Two full commits again |
| Gives a thumbnail for free | **Yes** (same buffer) | No | No |
| Interactive (hold a key, tweak, hear live) | No: fixed-length note | Yes | Yes, but destructive |
| Risk | Medium-low: reuse of proven path | Medium: a second always-on engine uses audio-thread CPU and memory budget; its messages need a separate handler | **High** |

**Recommendation: Option A.** It is safe, deterministic, and gives both the audition and the thumbnail from one mechanism. Option B is the natural upgrade if Argi later wants "hold the key and tweak" auditioning. Option C is not recommended even as a fallback.

### 6.4 What Option A needs changed (small, none in MasterBot's files)

1. **Quiet message handler.** `createNodeGraphLiveWorkletNode` hardwires `workletNode.port.onmessage = handleNodeGraphLiveWorkletMessage` (`node-graph-live-runtime.js:3704`). That handler writes global live state: scope frame batches, node levels, `arpFace`, `vmDebug` (`:1986-2056`). Add an optional `onMessage` parameter that defaults to today's handler. The audition passes a tiny handler that only watches `nativeGraphStatus`. (Render Sample probably has the same leak today. That is worth knowing but is not this task.)
2. **Shared render helper.** Pull the context, plan, wait, render and ear-protect core out of `renderNodeGraphAudio` into one function, something like `nodeGraphRenderPlanToBuffers(plan, { seconds, onReady })`. Render Sample and the audition both call it, so there is no copy of the engine code (APP_POLICY §5). This is the riskiest edit in the plan, because `renderNodeGraphAudio` is also a UI function. Do it as its own stage with its own check (Stage 3).
3. **No new timers.** Today's code has a 15 s timeout, a 50 ms settle `setTimeout` and a 5 s `nodeGraphLiveAwaitStartup` race. The audition helper should wait on events only: the node's `nativeGraphStatus` message, the node's `processorerror`, and `OfflineAudioContext` completion. A stuck build is handled by the ▶ button turning into a **Stop** button that discards the job. See Open Question 4 for the one place the shared startup race still has a timeout.
4. **Playback context.** Play the buffer on a small explorer-owned `AudioContext`, created on the first ▶ click (a user gesture), not on the live context. That way a stopped transport doesn't get a misleading "playing" state (APP_POLICY §6) and the buffer never passes through the live graph. The source's `onended` event clears the spinner and the playing state.
5. **Ear protection.** Keep the native Speaker Protector pass from Render Sample on every audition buffer. A preset must never be able to blast Argi's ears.

### 6.5 Why not the fallback (Option C), in detail

`commitNodeGraphPatch` on a different circuit rebuilds the module DOM, recompiles the plan (`scheduleNodeGraphLivePlanSync`), runs MasterBot's wake, geometry and plate rebuild, writes a history step, and autosaves the working patch. Doing that twice for a half-second preview, and then needing to get back to byte-identical state, leaves too many ways to lose Argi's work. If the offline path ever turns out to be impossible, the right fallback is Option B, not C.

### 6.6 Cost estimate and risks

Nothing was timed because the investigation did not run the app.

- **Build time**: the first audition of a session loads the worklet blob (about 35 files, mostly from the HTTP cache) and instantiates a WASM engine. That is the spinner. Replays are instant from the buffer cache. Measure once (a single timed audition in the console, not a loop) at the end of Stage 3 and write the number into this doc.
- **CPU**: the offline bounce runs faster than real time, but a heavy circuit (large reverbs, additive banks) could take longer than the note. Show the spinner for as long as it takes and allow Stop. Render jobs are **serialized**, one at a time, so thumbnail jobs and audition jobs never compete.
- **Memory**: each audition engine allocates the same memory budget as the live one (APP_POLICY §23), transiently. Check once that memory returns after about 20 auditions. Any leak lives in worklet teardown, which the existing Render Sample path shares.
- **Limits of a fixed-length offline note** (document in the UI as a small info line, not a tooltip):
  - Modules that need main-thread feeds are silent or wrong: Music Player (stripped by the efficient-product filter), mic input, Code boxes, host CV feeders, portals to the outside.
  - Presets without any note source (drones, self-running sequencers) just render from cold start with the transport sped to 1.
  - A preset with a sequencer plays its own pattern, not a held note.
  - Chaos and noise use a cold start, so the audition is "a new take". APP_POLICY §5 explicitly allows this.
- **Size of the work**: about 2 to 3 focused slices for the audition itself (helper extraction, quiet handler, explorer wiring). See §12.

## 7. Findings: the test note

The rule: only the MIDI module handles MIDI, and voices only hear notes over cables. The test note must not use `vmNoteOn`, WebMIDI, or any VoiceManager side channel.

- **Keyboard and Grid Keyboard modules are signal senders.** Their face sends `{ type: "setKeyboardModuleSignal", nodeId, signal, atFrame }` to the worklet (`node-graph-live-runtime.js:3099`, handled at `node-live-audio-worklet-events.js:653`). The worklet's `_normalizeKeyboardSignalPayload` fills in every other field, so a minimal payload works: `{ gate: 1, velocity: 0.8, midi: N }`. The module then drives its **own wired outs** (Play Keys, Pitch, F, Gate, Trigger, Velocity), which is exactly the allowed path.
- **`atFrame: -1`** means "apply now". The worklet treats stamps more than one second ahead as "play now" too, so don't pre-queue a far-future note-off.
- **Note length**: post gate-on before `startRendering`, call `offlineCtx.suspend(holdSeconds)`, post gate-off in the suspend callback, then `offlineCtx.resume()`. This is event-driven (no `setTimeout`) and works for any hold length. Then the render continues for a short release tail.
- **Which note**: that Keyboard's last struck note is already saved with the patch (`renderNodeGraphKeyboardSignal`: "A struck note is this keyboard's last signal"). Use it, else C4 (60). A patch can carry a `testNote` override on the preset record (§10).
- **Which node**: every module of type `keyboard` or `gridKeyboard` in the candidate patch (`nodeGraphKeyboardIsType`). With several keyboards, play all with the same note. With **no** keyboard the ▶ still renders the circuit from cold (it may be a drone or sequencer patch) and the row shows "no note source" in its info panel so a silent result isn't a mystery.
- **Sequencer audition** (`setSequencerAudition`) is the right path for sequencer-fed presets with no keyboard, and is a Stage 6 extension. Trigger and impulse buttons (`impulseButtonTrigger` message) are the same idea for drum presets.

## 8. Findings: waveform thumbnails

- **Source**: the same bounce as the audition. After the ear-protect pass, `renderNodeGraphAudio` already averages L and R into `samples` and computes `peak` and `rms`. The helper returns those buffers.
- **Reduction**: split the note into 96 buckets, store min and max per bucket as `Int8` (-127 to 127), 192 bytes per preset. Normalize by the buffer's peak so quiet presets are still readable, and keep the raw `peak` as a separate number for an optional level badge.
- **Drawing**: an inline SVG `<path>` (one `M…L…` polygon from the min/max pairs). The panel is a normal DOM menu, `createElementNS` is already used elsewhere in the app, and it needs no canvas and no GL context. This sidesteps the GL-only display rule, which governs **module displays**. A list thumbnail is not a module display. Scales cleanly on phones.
- **Capture at save time without making Save slow**:
  1. Save writes the record immediately with `thumb: null`.
  2. A render job is queued (serialized, see §6.6). When it finishes, the record is updated with `thumb` and the row repaints (a promise resolution, no polling).
  3. Rows with `thumb: null` show a flat placeholder line.
  4. Factory presets (static files) fill their thumbnails lazily on first audition, or on first view of the folder if Argi wants it (Open Question 8). Thumbnails for factory presets can also be generated once by a script into `patches/index.json` later.

## 9. Findings: the circuit fingerprint

`nodeGraphPatchFingerprint` (`node-graph-patch-serialization.js:200`) is an FNV-1a hash of `serializeNodeGraphPatch(patch)`. That includes knob values, positions, camera and `paramMeta`, so it changes on every tweak. It identifies a *patch revision*, not a *circuit*. A new function is needed.

Patch shape, confirmed from `patches/init.json` and a scan of 128 shipped patches:

- `nodes[]` with `id`, `type`, `params` (values), `paramMeta` (limits and tooltips, ignored: limits come only from parameter definitions), `gx/gy/widthGu/ui/traceDisplaySettings` (layout and cosmetics), and **module-level data objects** such as `stepGraph.graph.nodes[]` (the Step Graph points), `stepRegister.stepRegister`, `keyboard.chordMemory`.
- Wires: `connections[]` (`sourceNode.sourcePort -> destinationNode.destinationPort`), `modulations[]` (`sourceNode.sourcePort -> destinationNode.destinationParam`), `graphConnections[]`, plus `bypassedNodes[]`.

**Canonical form** (then FNV-1a to 8 hex, same hash style the app already uses):

```
circuit = {
  nodes:  sorted by id: [id, type, shape],
  wires:  sorted: "srcId.srcPort>dstId.dstPort",
  mods:   sorted: "srcId.srcPort>dstId.dstParam",
  graphs: sorted: "srcId.srcPort>dstId.dstPort",
  bypass: sorted ids
}
shape = per-module structured-data counts, e.g. stepGraph: graph.nodes.length
```

- **Included**: module ids and types, every wire and modulation wire with its port names, graph connections, bypassed ids, and for modules with editable data points the **number** of points.
- **Excluded**: every knob value, positions, sizes, view, display settings, `paramMeta`, `info`, drawings, samples, `tracePoints` on wires (cosmetic).
- **Data-point counts** come from a small per-type table (`stepGraph` -> `graph.nodes.length`, `stepRegister` -> step count, and so on). Anything not in the table is ignored, so a new module is morphable by default until it's added. Whether the *shape names and curve kinds* of Step Graph segments also count is Open Question 5.
- **Morphable** means `preset.fingerprint === other.fingerprint`. In the UI: 🔗 on the row, plus a note on whether the row matches the **live** circuit (that decides the params-only load path in §4).
- A dedicated pure function with a small node-based test (headless, like `scripts/test_graph_engine.mjs`) is cheap and worth it: a fingerprint bug silently breaks morphing later.

## 10. Data model and storage

### 10.1 Records

```
PresetFolder {
  id: string,            // "quick" | "user" | "factory" | uuid for user folders
  name: string,
  kind: "quick" | "user" | "factory",
  order: number
}

Preset {
  id: string,            // uuid (user) or "factory:<slug>"
  folderId: string,
  name: string,          // unique within its folder (Save over same name = confirm)
  patch: string,         // full serialized patch (what Pages loads today)
  fingerprint: string,   // circuitFingerprint(patch), 8 hex
  thumb: { v: 1, n: 96, min: number[], max: number[], peak: number } | null,
  testNote: { midi: number, velocity: number } | null,
  starred: boolean,
  tags: string[],        // reserved for the 808 Lab style tag chips, empty at first
  createdAt: number, updatedAt: number,
  rev: number            // bumps on overwrite; invalidates cached audition buffers
}
```

### 10.2 Where it lives

- **User presets (Quick Variations, My Presets, user folders)**: **IndexedDB**, database `soemdsp-sandbox.presets`, stores `folders` and `presets`, indexes on `folderId`, `fingerprint`, `updatedAt`. Reason: a full patch is about 40 KB, so 100 presets is about 4 MB and would blow the roughly 5 MB localStorage quota. IndexedDB is async and event-driven (promises/requests), so no polling.
- **Not inside the patch JSON.** The old `circuitPatches` rode inside every patch and every undo snapshot. Keeping presets outside keeps patch files and history small. The cost is portability: presets don't travel with an exported patch. A folder **Export / Import** (JSON file) in Stage 6 covers that.
- **Factory**: read-only, from the existing `patches/index.json` catalog (`loadNodeGraphPagePatchCatalog` logic, moved into the explorer). Its folders become second-level groups. Nothing is copied into IndexedDB until the user does "Save to My Presets" on one.
- **No server work.** Adding endpoints to `server.py` would need a server restart, which is off limits, and isn't necessary.
- **Storing a variation as a full patch** is simplest and always correct. Params-only load is derived at load time when fingerprints match: diff the preset's `nodes[].params` against the live ones and send `paramSyncIds`. A later optimization could store a params map and a shared base.

### 10.3 Audition cache

In-memory only: `Map<presetId, { rev, buffer }>`, a few entries (LRU, about 8), dropped when the panel closes. Buffers are not persisted (about 0.5 MB each). Thumbnails are persisted (192 bytes).

## 11. UI layout

The explorer is a **menu panel** in the unified window (like Pages today), so it is DOM, not a circuit-builder UI. It follows the existing paper-page panel chrome: heading with move / title / close, `.node-unified-window-nav-host`, one scrolling body, resize handle. No `title=` tooltips anywhere; use `aria-label` and the docked tips panel description fields where help text is needed. No timers, no polling. States change on events.

Wide layout:

```
┌ ✥  Presets · explorer                                  × ┐
│ [🚀 🎛️ 🕹️ 📄 ⚙ …]  (unified nav)                         │
├───────────────────────────────────────────────────────────┤
│ [ search ………………… ]   Sort: [Newest ▾]   [☆ only]         │
├──────────────┬────────────────────────────────────────────┤
│ SOURCES      │ ▶  Name                      ▁▃▇▅▂   🔗  ☆ │
│ ▣ Quick      │ ▶  Name                      ▁▂▃▂▁       ☆ │
│   Variations │ ⟳  Name (building…)          ──────      ☆ │
│ ▢ My Presets │                                            │
│ ▢ Factory    │   (Quick Variations opens blank:           │
│   ▸ filter…  │    "Nothing saved yet. Save captures       │
│   ▸ drums…   │     the circuit you are on.")              │
│ ▢ Explore    │                                            │
│ + New folder ├────────────────────────────────────────────┤
│              │ INFO  name · folder · 🔗 morphs with live   │
│              │ circuit · note source: Keyboard · age       │
├──────────────┴────────────────────────────────────────────┤
│ [ Save ]  [ Load ]  [ Remove ]  [ Rename ]                 │
└───────────────────────────────────────────────────────────┘
```

Phone layout (narrow window or touch): the left rail collapses into a **horizontal chip strip** above the list, the info panel collapses into the selected row, and the action bar stays sticky at the bottom. Every row is at least 44 px tall and ▶ is a 44 px target. No hover-only controls (hover is never required, and tooltips are not used).

- **Rows**: ▶ (becomes a spinner while building, then ■ while playing), name, SVG thumbnail, 🔗 when `fingerprint` equals the live circuit's, ☆ star. A click on the row **only selects**. A click on ▶ auditions that row and does not select it.
- **Save**: captures the live patch into the open folder. Name defaults to "Variation N" in Quick Variations. If the name exists in the folder, the button turns into a confirm state ("Overwrite?") before writing. Overwrite bumps `rev` and re-queues the thumbnail.
- **Load**: a confirm button. First click arms "Confirm Load" (and shows what will happen: "same circuit: values only" or "different circuit: replaces the patch"). Second click does `recordNodeGraphHistory()`, then the commit (§4). Disabled when nothing is selected.
- **Remove**: also two-tap confirm.
- **Rename**: inline text field on the selected row (Enter commits, Escape cancels).
- **Confirm state clears on events, not on a timer**: selecting another row, clicking any other button, a pointer-down elsewhere in the panel, or closing the panel.
- **Audition sound**: only one audition at a time. Starting another stops the first. Closing the panel stops it.
- **Explore** (see Open Question 1): a flat, searchable view over every source, so nothing is hidden but nothing loads on open.
- **Empty state is deliberate**: opening the panel shows Quick Variations, blank.

## 12. Staged build order

Each stage ships on its own, with `?v=` suffixes bumped in both `public/index.html` and `public/perform.html`, and no dead code left behind.

| Stage | Work | Check |
|-------|------|-------|
| **0** | This doc. | Argi answers the open questions. |
| **1: Data and fingerprint** | `circuitFingerprint()` (pure, with a headless test script), the IndexedDB store module (folders and presets, CRUD, no UI), the factory catalog reader moved out of `node-graph-pages.js`. | Test script passes. Same circuit with different knobs gives the same hash. A new wire gives a different hash. |
| **2: Explorer shell** | New panel replaces Pages: folder rail, search, sort, rows, select-only click, Save, Rename, Remove, Load with confirm and the history bracket. Quick Variations opens blank. Factory and Explore listings read the old catalog. Remove `node-graph-pages.js` list code. | Opens blank. Load then Ctrl+Z restores the exact prior patch. No hover tooltips. Works at phone width. |
| **3: Audition** | `onMessage` option on `createNodeGraphLiveWorkletNode`. Extract the shared offline render helper from `renderNodeGraphAudio`. Wire ▶: build plan from candidate patch, test note, buffer cache, explorer-owned `AudioContext`, spinner, Stop. | Live patch, undo stack and autosave untouched while auditioning. Render Sample still behaves as before. Record one timing and one before/after memory reading in this doc. |
| **4: Thumbnails** | Peak reduction, SVG path, queued save-time render job, lazy factory thumbnails. | Save returns instantly and the thumbnail appears afterwards. |
| **5: Remove the broom circuit presets** | Delete `node-graph-circuit-patches.js`, the Ready page tool block and list, the CSS, the `patch.circuitPatches / activeCircuitPatch / defaultCircuitPatch` serialization and normalization, the history, module-actions, slider and additive-graph hooks, and the **Trigger Patch** keyboard mode with its `patch-set` styling. Delete the orphaned localStorage patch presets in `node-graph-file-actions.js`. | Ready page keeps Write Defaults, Hide Unused, Hide Wires and the info fields. Old patches that still carry the fields load silently. A keyboard saved in Trigger Patch becomes Slide. |
| **6: Polish** | Stars, tags, user folders (new, rename, delete), folder Export / Import, link-icon polish, sequencer and trigger-button note sources for audition. | |
| **Later** | Morphing between presets that share a fingerprint, as part of the Mutator work (`docs/MUTATOR_PLAN.md`). The fingerprint and the params-only load path built here are its foundation. | |

Stage 5 could run earlier than Stage 2 if Argi wants the broom gone first, but the explorer would then have nothing replacing it for a while. The order above removes the broom only after the explorer's variations work.

## 13. Files to touch

**New**
- `public/node-graph-preset-explorer.js` (panel, list, actions)
- `public/node-graph-preset-store.js` (IndexedDB)
- `public/node-graph-circuit-fingerprint.js` (fingerprint)
- `public/node-graph-preset-audition.js` (audition and thumbnail jobs)
- `scripts/test_circuit_fingerprint.mjs`
- CSS: new `.node-presets-*` block in `public/styles.css`

**Edit**
- `public/index.html`, `public/perform.html`: swap the Pages panel markup, remove the circuit tools block, script tags with `?v=` bumps. Both files currently carry other agents' uncommitted changes, so commit only these hunks.
- `public/node-graph-pages.js`: replace with the explorer, or delete after its catalog logic moves.
- `public/node-graph-unified-window.js` and `node-graph-floating-windows.js`: relabel only. **Keep the `pages` registry key and window geometry key** so saved window positions don't reset.
- `public/node-graph-live-runtime.js`: optional `onMessage` parameter (Stage 3).
- `public/node-graph-render-output.js`: extract the shared render helper (Stage 3).
- `public/node-graph-live-plan-runtime.js`: none expected (`nodeGraphBuildLivePlanForPatch` already exists). If it turns out to read live state, fix it there.
- `public/styles.css`: remove `.node-circuit-patch-*` (5721-5776) and `.node-pages-*` once replaced, and the `patch-set` pad style (3514).
- Stage 5 removals: `node-graph-circuit-patches.js` (delete), `node-graph-patch-serialization.js`, `node-graph-patch-core.js`, `node-graph-history.js`, `node-graph-module-actions.js`, `node-graph-slider-dragging.js`, `modules/additiveGraph/additive-graph-math.js`, `node-graph-view-controls.js`, `modules/gridKeyboard/grid-keyboard.js`, `node-graph-module-factories.js`, `modules/keyboardController/keyboard-layout-settings.js`, `lib/visual/piano-keys-draw.js`, `node-graph-file-actions.js` (dead presets).
- `docs/APP_POLICY.md`: one-line note if Argi wants the audition rule written down.

**Do not touch (MasterBot's module display rewrite)**
`node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and any cull, present or camera code. This plan needs none of them. Loads go through `commitNodeGraphPatch` and its commit listeners, so her wake, layout, geometry and plate rebuild runs on its own.

## 14. Rules check

- **Events only**: IndexedDB requests, promises, `OfflineAudioContext` completion and suspend, `AudioBufferSourceNode.onended`, worklet `message`/`processorerror`, and DOM events. No `setTimeout` or `setInterval` is introduced. The confirm state clears on events instead of using the 2-second helper. One existing timeout inside shared startup code is flagged in Open Question 4.
- **No hover tooltips**: no `title=`. `aria-label` and the docked tips panel only.
- **Phone friendly**: single column at narrow widths, 44 px targets, nothing hover-only.
- **No dead code**: the broom circuit presets, Trigger Patch mode, the orphaned localStorage patch presets and the old Pages list are all deleted in the same work.
- **Menu panel, not a circuit-builder UI**: DOM like the Pages panel it replaces. Thumbnails are SVG, with no 2D canvas.
- **Parameter limits** come only from parameter definitions. The fingerprint ignores `paramMeta`, and params-only loads apply values only.
- **Names**: Canvas and Mini Canvas where the explorer mentions them. Nothing in this design needs either.
- **MIDI boundary**: the test note enters through the preset's Keyboard module signal, not `vmNoteOn` and not WebMIDI.
- **Servers and app**: no server endpoint is added, so no restart is needed.

## 15. Open questions for Argi

1. **Factory vs Explore.** Recommended: **Factory** = the read-only static catalog (`patches/`, with its subfolders), and **Explore** = a flat search over *all* sources (Quick, My Presets, Factory). Is that what you meant, or should Explore be the old full list under a different name?
2. **Quick Variations scope.** Recommended: one global folder (simple), with 🔗 showing which rows share the circuit you are on now. The alternative is one Quick Variations set *per circuit*, filtered by fingerprint, so a different circuit always opens blank.
3. **Save targets.** Quick Variations saves into itself. Should Save in My Presets or Factory-copy folders also work from the same Save button, or only from the open folder? (Recommended: always the open folder; Factory is read-only, so Save there offers "Save to My Presets".)
4. **A one-timeout exception.** `createNodeGraphLiveWorkletNode` has a 5 second `nodeGraphLiveAwaitStartup` race. Strict "no timers" would need a variant of it for the audition. OK to leave it as shared legacy code, or should I add a timer-free startup path?
5. **Fingerprint strictness.** Should Step Graph segment shapes (smoothstep, exponential …) and bypass state count toward "same circuit"? Recommended: point **count** and bypass count; shapes and curve values are morphable.
6. **Old broom data.** No shipped patch has it, but your own sessions may. Delete outright, or do a one-time import that turns your existing slots into Quick Variations first?
7. **Reframing on load.** When Load swaps in a *different* circuit, keep the camera where it is (like Pages today) or reframe to the new patch?
8. **Factory thumbnails.** Fill them lazily when a row is first auditioned, render the whole visible folder on open (heavier, but nicer), or pre-generate once with a script into `patches/index.json`?
9. **Trigger Patch keyboard mode.** Recommended: delete it with the broom. Or keep the mode and make it load Quick Variation number N when you press key N? (That needs the explorer to expose "load variation by index", and is one more thing to maintain.)
10. **Audition length and note.** Default note C4 (or the keyboard's last note), 1 second held plus a release tail of about 1.5 seconds. Right feel? And should ▶ be tap-to-play, tap-again-to-stop (recommended), or hold-to-play?
11. **Presets with no note source.** Render from cold (drones, sequencers) and say "no note source" in the info panel, or disable ▶?
12. **Tags and stars.** Both are in the data model but not in the first UI. Do you want stars in Stage 2 (cheap) or Stage 6?
