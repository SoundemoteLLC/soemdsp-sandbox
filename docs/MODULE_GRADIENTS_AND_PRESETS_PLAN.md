# Module Gradients and Presets: Design Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-24 (updated with Argi's decisions the same day) |
| **Status** | **BRIEF for implementation.** Argi's decisions are incorporated. Investigation and design only in this commit; no feature code. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Replaces** | `docs/PRESET_EXPLORER_PLAN.md` (deleted earlier). Findings that still apply are in §11. |
| **Replaces in the app** | The broom page circuit presets (`node-graph-circuit-patches.js`) and the 📄 Pages menu (`node-graph-pages.js`). Trigger Patch is removed and is **not** replaced. |
| **Related** | `docs/MUTATOR_PLAN.md`, `docs/APP_POLICY.md`, `docs/MODULE_DISPLAY_REWRITE_PLAN.md` (MasterBot's files, hands off). A1 touches `node-graph-live-plan-runtime.js` only after coordination with MasterBot (§14). |
| **Not this work** | The **Patch View box** (a red box with handles, saved in the patch, that sets what loading a patch frames, with the + origin at its center) is a separate feature being built now. This plan does not implement it and does not add a competing reframe rule. Load uses whatever that feature defines once it lands. |

---

## 1. The design in one picture

```
Preset system             (Preset Explorer: factory + user presets,
                           Save Preset, Save Variation, Load, Remove, Rename,
                           first-iteration ▶ = live playback)
   ^
Preset variations         (whole patch JSON files next to the patch)
   ^
Mutators                  (later: drive gradient positions from pitch or velocity)
   ^
Gradients                 (base layer: a patch-level 1D strip of snapshots;
                           offsets on top of sliders; one gradient can span modules)
```

Two systems, kept separate:

- **Gradients** are a *patch feature*. They live in the patch (`patch.gradients`), know nothing about files, and work without any preset code. They are **not** owned by a module: one gradient can hold parameters from several modules.
- **The Preset system** (Explorer plus variations) is a *file feature*. A variation is a **complete patch file** (graph points, gradients, wires and all), filed next to its parent. The Explorer is how you save and load those files.

They touch in two places: a variation, being a full patch, has its own copy of the gradients; Mutators (later) drive gradient positions. The preset system is **not playable**. Gradients are played only through Mutators driving them.

## 2. Short answers

| Question | Answer |
|----------|--------|
| What is a gradient? | A patch-level 1D strip (position **0 to 1**) with snapshot stops. One position drives it. Stops store **offsets** from the first snapshot, added on top of each slider like modulation. A gradient can include sliders from **several modules**. |
| How do params get registered? | Snapshot, move sliders, snapshot again. Every morphable param that moved is registered automatically. There is **no remove UI** and no upfront registering. Untouched sliders have zero offset. To drop a param, move it back to base at the stops, or undo. An offset that is zero at every stop drops out automatically. |
| How do several gradients combine? | Offsets **add up** (also with later Mutator offsets). The sum is clamped only by the parameter definition's min and max. |
| Do wires change when a gradient runs? | **Never.** Gradients only offset sliders. Graph points (Step Graph, Smooth Graph) are not gradient params. The page shows one plain line when something holds still, for example `Holds still: Step Graph`. No badges, no tooltips, no pop-ups. |
| Choice and switch params? | They **do** take part. Between two stops they **snap at the halfway point** (`t < 0.5` keeps the earlier stop, otherwise the later). |
| Position? | **0..1**, linear interpolation between stops. Hold the end value outside the end stops for now (revisit after Argi plays with it). Curves are a later idea with no UI design yet. |
| Where is a gradient edited? | **Only on the Gradients page** (the old broom page). No gradient UI in Display Settings, module Settings, or anywhere else. No Settings shortcut. |
| How do sliders show the offset? | The **existing slider ghost** already shows the final value; it must include gradient offsets. No new marker. While a gradient is being edited, its sliders get a **1–2 px outline**. Sliders, not knobs. |
| How do Mutators fit? | A Mutator knob lane **is** a gradient whose position axis is the note (mapped to 0..1). Gradients are the data layer; the Mutator becomes an axis-to-position router. See §5. |
| What is a variation? | A **whole patch JSON** file (same format as any patch, graph points included) stored next to its parent as `mypresets__variations/mypresets__<name>.json`. |
| Untitled patches? | They get a generic auto name (`Untitled 1`, `Untitled 2`, …). **Save is never disabled.** |
| Hosted / static site? | **Load-only.** Users keep their own files in the app or the plugin. No IndexedDB user presets. |
| First-iteration audition? | ▶ **turns the circuit on and plays it live.** No test note, no offline render. If nothing sounds, that is fine. A later **robust audition** stage brings back the offline path, the MIDI-module preview, and a dedicated preview variation. |
| Trigger Patch? | **Removed entirely.** There is no Trigger Variation. |
| DAW automation of a gradient? | **Never inside the circuit builder.** A later stage registers **50 generic plugin parameter slots** that can be assigned to sliders, Mutators or gradient positions. |

# Part A: Gradients

## 3. What is worth borrowing from soundemote-dev (briefly)

soundemote-dev's `/interface/preset-browser` is a UI prototype with no audio and no play buttons. It also combines presets and morphing in one panel, which this design does *not* do. Do not copy it. The only ideas worth borrowing for the **gradient strip** are: a short strip with draggable stop handles, a thin white playhead, a `linear-gradient` background that is a picture of the blend, and blend in normalized 0..1 space. Our position range is 0..1 (not 0..127). Our stop hue comes from stop order, not a name hash. No `title=` tooltips.

## 4. Design

### 4.1 Data model (patch-level, not per module)

```
patch.gradients = [
  {
    id: "g1",                      // unique inside the patch
    name: "Gradient 1",            // auto "Gradient 1", "Gradient 2", …; user can rename
    enabled: true,                 // false after Gradient to Module; skipped by the offset sum
    position: 0,                   // 0..1, the one value that drives the strip
    origin: {                      // slider-space base values at the first snapshot
      "filter-1": { cutoff: 0.31, res: 0.20 },
      "amp-1":    { level: 0.50 }
    },
    params: [                      // registered params, in display order
      { nodeId: "filter-1", key: "cutoff" },
      { nodeId: "filter-1", key: "res" },
      { nodeId: "amp-1",    key: "level" }
    ],
    stops: [
      { id: "s1", pos: 0,   off: {} },
      { id: "s2", pos: 1,   off: { "filter-1": { cutoff: 0.40, res: -0.05 } } },
      { id: "s3", pos: 0.5, off: { "filter-1": { cutoff: 0.10 } } }
        // a missing key means offset 0
    ]
  }
]
```

- Values are in **slider space** (normalized knob travel, 0..1), the same space `docs/MUTATOR_PLAN.md` uses. The slider curve and the definition's min and max map slider space to the domain (`nodeGraphParameterDefinitionMetadata`, `node-graph-parameter-metadata.js:522`). A log Hz slider and a linear slider therefore blend the same way.
- A stop stores **offsets**, not absolute values. If the user later moves a slider's base, the gradient still means "this much more or less than wherever the slider is". The stop at the origin holds zero offsets, so a position on that stop equals the plain sliders.
- Interpolation of continuous params is **linear** in slider space between neighbouring stops. Position is **0..1**.
- **Hold outside the ends** for now: before the first stop and after the last, the offset holds the end value. Revisit this after Argi has used it. **Curves** (ease, step-graph shapes on a segment) would be nice later; that is extra UI with no design yet, so it is listed in §15 and is not part of these stages.
- Gradients are normalized in `node-graph-patch-core.js` next to other patch-level fields (where `circuitPatches` used to be) and serialized with the patch. Unknown ids and keys are dropped. A disabled gradient is kept in the file but does not contribute offsets.

**Duplicate and delete of modules** that a gradient references is **not decided here.** After Stage A3, settle it with a **clickable prototype** (does delete drop those params, does duplicate copy them into the new node, do dangling refs stay). Until then, applying a gradient must skip missing node or param ids without crashing, and must not silently rewrite the stored list.

### 4.2 Capture: snapshot, move, snapshot

1. **First snapshot** creates a gradient named `Gradient N` (next unused N), `enabled: true`, `origin` = the current **base** values of sliders in the patch, one stop at position 0, and an empty `params` list. Nothing else is asked.
2. The user moves sliders as usual (any modules).
3. **Later snapshots** (default position 1, or wherever the playhead is): for every morphable param whose base slider value differs from `origin` by more than an epsilon (1e-4 of slider travel), the param is registered and the stop stores its offset.
4. A param that moves for the first time at a later stop joins `params`. Earlier stops get an implicit zero for it.
5. **No ✕, no remove row, no discard page, no `skipped` list.** Untouched sliders have zero offset and are not listed. To take a param out: move it back to its origin value at every stop, or undo. If a registered param's offset is **zero at every stop**, it is dropped from `params` and from the stops automatically. A later snapshot can register it again if it has moved.

A snapshot reads **base** params (`node.params`), never the final (offset) values, so a gradient never learns from its own output or from another gradient. Gradients never write the base.

Re-snapshot on an existing stop replaces it. Moving a stop is a drag. **Set start** re-records `origin` from the current bases. **Dragging the position (playhead) records one undo step** on release, not per pointer-move. Stop drags are the same: one undo step on release.

### 4.3 What a gradient moves, and what snaps

**Continuous** numeric params (no `choices`, not an integer-only step) interpolate linearly in slider space.

**Choice and switch** params (a definition with `choices`, including on/off) take part and **snap at the halfway point** between neighbouring stops: with `t = (pos - posA) / (posB - posA)`, `t < 0.5` uses stop A's stored value (origin + offset, in the param's own units / indices), otherwise stop B's. Two stops at the same position switch hard there.

**Other discrete integer-step params** without choices (for example Seed, a Steps count) use the same halfway snap, because a blend such as Seed 3.7 is meaningless.

**Not gradient params:** module-level data that is not a slider — Step Graph and Smooth Graph points, `stepRegister`, `chordMemory`. Those hold still under a gradient. (They *are* included when you save a **variation**, because a variation is a whole patch. That is a file concern, not a gradient concern.)

The Gradients page shows one plain line under the bar when a gradient's modules include something that holds still, for example `Holds still: Step Graph`. Nothing else: no badge, no tooltip, no pop-up.

### 4.4 Layering: gradients are offsets, like modulation

```
finalSlider = clamp01( baseSlider + sum(enabled gradient offsets) + sum(later Mutator offsets) )
final value = definition's slider curve and min/max map finalSlider into the domain
```

Choice, switch and other discrete params do not use this sum; they snap as in §4.3.

- The clamp is the definition's own range. Nothing is hardcoded and nothing is per-gradient.
- The slider stays fully adjustable. The user moves the base; the gradient moves relative to it.
- Wire modulation is applied after this, natively, exactly as today (`unitAdd`, then the native clamp to min and max, B-082). A cable and a gradient on the same param add.
- `node.params` (the base) is **never rewritten** by a gradient. Saving, undo, snapshots and variations stay honest.

**Engine hook.** The first Pitch Mutator slice already applies offsets on the main thread to the live params and leaves the base alone: `pitchMutatorApplyLiveParams` (`public/node-graph-pitch-mutator-overlay.js`) is called from `nodeGraphBuildLiveParameterNodes` (`node-graph-live-plan-runtime.js`, near lines 191 and 333). Stage A1 generalizes that call into one **param offset provider list**: gradients first, then the Pitch Mutator. Both go through the same function, so there is exactly one place where "effective param" is computed (APP_POLICY §5). Later this becomes the native offset-table hook the Mutator plan already describes (per-voice tables, ZOH).

**A1 is pending coordination with MasterBot**, because it edits `node-graph-live-plan-runtime.js`. Do not start A1 until she agrees, or use a hook she approves. See §14.

**Updates are events.** A change of a gradient position or stop calls the existing param update path (`scheduleNodeGraphLiveParameterSync`, `sendNodeGraphLiveParameterUpdate`). No timers or polling.

**Plugin.** In the DAW plugin there is no AudioWorklet. `public/plugin-host.js` diffs `node.params` after page param edits (`copyParams`, around lines 201–232) and posts `param` events to the native engine. A gradient offset is not in `node.params`, so that diff would miss it. The plugin host's diff must read the **effective** params from the same provider function. That is a one-function change in `plugin-host.js` (a sandbox file, not MasterBot's).

**Gradient position is never automatable inside the circuit builder.** No cable into a gradient position, no builder-side automation lane. Host automation, if any, comes only from the later 50 generic plugin slots (§15).

### 4.5 Position

- One position per gradient, **0 to 1** (float), saved on the gradient as `position`.
- Set by dragging the playhead on the strip, by loading a patch or variation that contains the gradient, and later by a Mutator, which **adds** to it (clamped to 0..1).
- Linear interpolation between stops, as in §4.1.

### 4.6 Several gradients, spanning modules

The patch can have any number of gradients. Each has its own param list (any modules), its own stops and its own position. Two gradients that register the same param just add (when both are enabled). The Gradients page shows each gradient as its own strip row.

### 4.7 How sliders show this (no new knob visual)

- The **existing slider ghost** (`nodeGraphParameterGhostSignal` in `public/node-graph-ghost-sliders.js`) already folds the base and modulation cables into the value the user sees. That ghost must use the **final value, gradient offsets included** (and later Mutator offsets), then fold cables as it does today. There is **no new marker, ring, or second handle**.
- **While a gradient is being edited** (it is the selected card on the Gradients page), every **slider** in that gradient's `params` list gets a **1–2 px outline**. This is a highlight, not an editor. It is not shown on Knob modules. When the card is deselected or the page is closed, the outline goes away (a selection / panel event, no timer).
- Stay out of MasterBot's files when adding the outline. The ghost and slider face live in `node-graph-ghost-sliders.js` and the existing slider DOM, not in the GL graph files listed in §14. Confirm the exact paint site at implementation and do not reach for a listed MasterBot file.

### 4.8 The Gradients page (the old broom page)

The broom page (🧹, `patchDefaults`, panel `#nodePatchDefaultsPanel`, `index.html:2663-2818`) loses the circuit-patch half (§9) and becomes the **Gradients page**. It is a DOM menu panel, which is allowed (the WebGL-only rule is for circuit-builder UIs). This is the **only** gradient UI in the app.

Layout, top to bottom:

1. An optional filter: **All**, or **Touching the selected module** (a convenience; it does not mean the gradient is owned by that module). Selecting a module on the Canvas updates the filter on a selection event, no polling.
2. One **card per gradient**:
   - The auto name, editable (**Rename**).
   - The **strip**: about 44 px tall for touch, full width, with 28 px wide handles, a white playhead and number labels staggered on alternate stops. Its background is a `linear-gradient` through one hue per stop (hue from stop order: `hsl(order * 137.5, 55%, 50%)`).
   - Tap an empty spot to add a stop there (a snapshot of current bases). Drag a stop to move it. Drag anywhere else to move the playhead. Release records one undo step.
   - Buttons: **Snapshot**, **Delete stop**, **Rename**, **Delete gradient**, **Set start**.
   - The registered param rows: `Module · Param`, and the offset at the playhead as a plain number (`+0.12`). **No ✕.**
   - The plain `Holds still: …` line under the bar when something holds still.
3. A **Snapshot** button at the top, which starts a new gradient from the current bases (§4.2).

Phone-friendly: one column, 44 px rows, no hover-only affordance. Strip handles are the only pointer-drag targets. No GL work and no module-display rewrite.

### 4.9 Where the strip is edited

**Only on the Gradients page.** There is no gradient UI in Display Settings, no Snapshot button there, and no one-line shortcut in a module's Settings. Gradients are not tied to one module.

## 5. Mutators: how this fits `docs/MUTATOR_PLAN.md`

The Mutator plan has per-knob **lanes**: keyframes over an axis (pitch or velocity), summed offsets in slider space, clamped by the definition, ZOH between keys, a per-voice baked table, a Freq lane that is not an offset. A lane for a knob is exactly "a gradient with one param, whose position axis is the note".

**Merge:**

1. **Gradients are the data layer.** A strip of stops with offsets in slider space, as in §4.1, position 0..1.
2. **A Mutator becomes an axis-to-position router.** Its binding is `(gradient, axis, position curve)`. The axis is pitch or velocity. The curve maps the axis to a position 0..1 and reuses the Step Graph shapes the Mutator plan already uses.
3. The Mutator **keeps** what is not an offset: the Freq lane (Hz is not a slider offset), the overlay, the MIDI policy, polyphony and LUT baking, and the `Pin Keyframe` gesture. Pin Keyframe now means "write a stop at the position the current note maps to" into a gradient the Mutator owns, shown on the Gradients page.
4. One engine hook serves both: offset tables indexed by an axis, summed (§4.4).
5. The signed-off Mutator rules stay: summing, clamp to the definition, ZOH, per-voice LUT, the B-058 check.

**Order:** build gradients first, then rebase the already-coded first-slice Pitch Mutator onto them (Stage A5). Until then the Pitch Mutator is unchanged.

Where the position comes from for a Mutator-driven gradient: `position = clamp(0..1, gradient.position + mutatorPosition)`. A Mutator-driven gradient still has a manual base position the user can drag. Gradients are played **only** this way; the preset system does not trigger them from the keyboard.

## 6. Later stage: Gradient to Module

**What it does.** A **Convert to module** action on a gradient builds real graph modules that reproduce what the gradient does, wires them to the same params, and **keeps the gradient but turns it off** (`enabled: false`) so the offset is not applied twice. Future stage, after A5.

**Feasibility: yes.** Everything it needs exists today.

| Piece | What exists |
|-------|-------------|
| A curve source | **Smooth Graph** (`smoothGraph`): free dots, `smoothingMode` Linear, Input mode. `In` and `Out` ports. Data is `node.graph = { cursorX, nodes: [{ x, y, c, shape }] }`. |
| A position source | A **Knob** module carrying the position (0..1). |
| The wire | An ordinary `modulations[]` entry `Out → destinationNode.destinationParam`. The native side adds a unit-band modulation and clamps to min and max, the same rule as §4.4. |

**What it builds.**

1. One **Position Knob** per gradient, named after it, value = `position` (already 0..1, which matches the graph's In range).
2. For each registered continuous param, one **Smooth Graph**: Mode `Input`, Curve `Linear`, `inputMin 0`, `inputMax 1`. One dot per stop: `x = stop.pos`, `y` = the stop's offset for that param. A dot at `x = 1` is added if the last stop is before 1, so the graph holds the end value the way the strip does. Steps 0 (free X), Lock Ends off. Wired `Position Knob.Out → Graph.In` and `Graph.Out → target.param`.
3. Choice and switch params are not converted into graphs (they snap; a Linear graph would not). They stay on the now-disabled gradient, or the page says so on the holds-still line.
4. Several gradients on one param become several cables to that param, which add.
5. Modules are placed next to the first involved module (spawn helper), in a single commit with one undo point (`recordNodeGraphHistory()` before).
6. The gradient is **kept and set `enabled: false`.**

**How the position input feeds the graphs.** The Position Knob's output goes to every graph's `In`. In `Input` mode the graph maps `In` through In Min and In Max onto its x axis, so knob 0..1 sweeps the dots from the first stop to the last. Moving the Knob (or modulating it) moves every graph together.

**Needs checking before this stage starts** (not assumed here):

- The Smooth Graph's `y` range and how `Out` maps to modulation. The default curve runs `y = 1` to `y = 0`, so `Out` may be unipolar, while a gradient offset can be negative. Confirm in `smooth_graph.cpp` first.
- Whether a modulation value of 1.0 equals full slider travel (offsets are slider fractions).
- This is a topology edit, so the action is hidden in the DAW plugin (topology is locked there).
- A gradient with `n` params builds `n + 1` modules. Add a cap and a confirm step for large ones.

# Part B: The Preset system

## 7. Preset variations as files

### 7.1 What a variation is

A **variation** is a **complete sandbox patch**: the same JSON format as any other patch (`format.kind: "soemdsp-sandbox-node-patch"`), including nodes, wires, params, graph points, gradients (stops and positions), and the rest. It is simply filed in a folder next to its parent.

Loading a variation is a **full patch load**, the same path as loading a preset (§11.1), with a confirm step and an undo point. It is not a params-only diff.

### 7.2 Naming and on-disk layout

```
mypresets.json
mypresets__variations/
    mypresets__Bright.json
    mypresets__Dark.json
    mypresets__1.json          (auto-numbered when no variation name is given)
```

- Folder: `<patch stem>__variations/`. File: `<patch stem>__<name>.json`. The display name is everything after the **first** `__`.
- No variation name given: the next unused whole number (`1`, `2`, `3`, …), natural-sorted in the list.
- Names are sanitized: no `\ / : * ? " < > |`, no control characters, no `..`, trimmed, max 64 characters, no Windows reserved names, and **case-insensitively unique** (Windows and macOS file systems).
- **Untitled patches** never block Save. If the live patch has no file name, assign the next unused `Untitled 1`, `Untitled 2`, … (case-insensitive, among user presets) and then write the file. Save Variation does the same for the parent if needed, then writes the variation.

### 7.3 Does it work with how patches are stored today? (checked)

| Host | Where patches live | What works today | What the layout needs |
|------|--------------------|------------------|-----------------------|
| **Dev server and standalone app** (`server.py`) | Shipped: `patches/` (static, read-only, one folder deep in the catalog). User: `saved-patches/*.json`, flat. | Static GET of any file under `patches/` (including a folder), via `serve_page_patch` (path-safe). User API: `/api/patches`, `/api/patches/meta`, `/api/patches/file?name=`, `POST /api/patches/save` (writes `bankNNN-programNNN-<title>.json`), `POST /api/patches/overwrite?filename=` (**basename only**, with `expectedMtimeMs` and `expectedSize` conflict checks). There is no patch remove or rename endpoint. | **Subfolders cannot be written or listed through the user API.** New endpoints are needed (§7.4). Loading them needs a **server restart that Argi chooses to do**; this plan never restarts the app. |
| **DAW plugin WebView** (`soemdsp-sandbox-audioplugin`) | Shipped: the read-only pack (`Sandbox-perform/patches`). User: `Documents/Sandbox/Patches/`. | `src/ui/sandbox-api.cpp` re-implements the same `/api/patches*` API in C++ (`listPatches` uses a **non-recursive** `findChildFiles`). | The same new endpoints must be mirrored there (a **separate repo**, not done in this sandbox work). Overwriting a shipped patch already writes a copy into the user folder, so variations of a shipped patch go to the user folder too. |
| **Static / hosted web** | Read-only `patches/` over HTTP. | Reading factory presets. | **Load-only.** Save, Remove and Rename are hidden. Users keep their own files in the app or the plugin (or a download, if one already exists). **No IndexedDB user presets.** |

**Conclusion:** the folder layout is sound, and **factory variations work with no server change** (they are just more static files). Saving user variations needs a matching pair of new endpoints in `server.py` and the plugin's `sandbox-api.cpp`.

### 7.4 The real mechanism

**A flat, safe API over the folder layout.** The client never sends a path. It sends `base` (the patch's stem) and `name`. The server or plugin builds the path itself, so there is no traversal surface. The body is a normal patch (`validate_node_patch_payload`).

| Endpoint | Does |
|----------|------|
| `GET /api/variations?base=<stem>` | Lists the variations of a base: user folder plus, for a shipped base, the shipped folder (a user variation wins on the same name). Returns `{name, source, bytes, modifiedUtc}`. |
| `GET /api/variations/file?base=&name=` | Returns one file. |
| `POST /api/variations/save` | Writes `<user dir>/<stem>__variations/<stem>__<name>.json`. No name: auto-number. Refuses an existing name unless `overwrite=1` with the `expectedMtimeMs` / `expectedSize` check the patch overwrite already uses. |
| `POST /api/variations/rename` and `.../remove` | Rename and delete, same validation. |

Plus, because the Explorer's Remove and Rename for user **presets** have no endpoint today either: `POST /api/patches/rename` and `.../remove` on the same pattern. Renaming a preset **renames its `__variations` folder and file prefixes in the same call**, so the pair never splits.

**The factory catalog.** `scripts/rebuild_page_patches_index.py` builds `patches/index.json` for root plus one folder, so a root `mypresets__variations/` would otherwise show up as a *folder of patches*. The script must skip any `*__variations` directory as a catalog folder and instead add `variations: ["Bright","Dark","1"]` to the base's entry. That also lets the Explorer show a variation count without an extra request.

A variation file does not need a second format kind. It is a normal patch. The Explorer knows it is a variation from its path.

## 8. Preset Explorer

The 📄 page icon in the command center now opens the Explorer. It replaces `node-graph-pages.js` and its list. It is a DOM menu panel (same status as the paper-page panel it replaces).

The app's **main save button does not change.** The Explorer has its own buttons.

### 8.1 Layout

1. **Search** (a simple text filter on name, folder and author. Nothing else for now).
2. **The 3-way switch: Both / Factory / User.**
3. **One list**, folder-style: factory presets (from `patches/index.json`) and user presets (from `/api/patches`) in the same list. Folders group, with Factory folders and User presets interleaved by name. Each row shows the name, a source mark (Factory or User), a small waveform thumbnail (or a flat placeholder until one exists), and a ▶ button.
4. A preset row with variations is a **folder** you open: its children are its variations (`mypresets__variations/`), shown as rows with the same ▶ and thumbnail.
5. **Buttons:** **Save Preset**, **Save Variation**, Load, Remove, Rename. Two separate save buttons, not one Save with a mode.

Phone-friendly: one column, 44 px rows, ▶ is a 44 px target, no hover.

### 8.2 Selecting and confirming

- Tapping a row **only selects it**.
- **Load** and **overwrite** (Save Preset or Save Variation onto an existing file) use an inline confirm step on the same button (it becomes "Confirm Load" / "Confirm Overwrite" until the selection or panel changes). It is cleared by selection, panel-close and commit events, **not by a timer** (the old confirm helper uses a 2 second `setTimeout`, so it is not reused).
- Before a Load, `recordNodeGraphHistory()` is called, so one Ctrl+Z returns to exactly what was there (§11.2).
- Factory presets are read-only, so Remove and Rename are disabled for them, and Save Preset on a Factory row offers "Save as user preset".

### 8.3 What the buttons mean

| Button | Action |
|--------|--------|
| **Save Preset** | Writes the live patch as a **user preset**. If a user preset is selected, this is an overwrite (confirm). If the live patch has no name, it becomes `Untitled N` first. |
| **Save Variation** | Writes the live patch as a **variation** of the current parent (the open / selected preset, or the live patch's own file). If a variation is selected, this is an overwrite (confirm). No variation name: auto-number. If the parent has no name, it becomes `Untitled N` first, then the variation is written. |
| **Load** | Full patch load of the selected preset or variation. Confirm, then undo point, then commit. |
| **Remove** | Deletes a user preset **and its variations folder** (confirm), or deletes a variation (confirm). |
| **Rename** | Renames a user preset and its variations folder together, or renames a variation. |

### 8.4 First-iteration audition (▶)

Do **not** build the offline-render test-note path in the first iteration.

▶ **turns the circuit on and plays it live**:

- If the row is not already the live patch, load it (undo point, **no** confirm — it is a play gesture) and start live playback, the same on/off the user uses to hear a patch.
- If it is already the live patch, only start playback.
- **No test note is injected.** If nothing sounds (no MIDI arriving, no running sequencer, no drone), that is fine.
- **Instrumentation, for now and for later preview wiring:** the **MIDI module** is the instrument input (pitch, gate and so on). That is also what makes a patch playable from a DAW. It will not always be present; when it is missing, silence is acceptable.

This path works in the **plugin** (the native engine plays), so ▶ is shown there.

A later **robust audition** stage (§12, after B3) brings back the offscreen `OfflineAudioContext` render, a test/preview note into the MIDI module when one is present, buffer caching, and the idea of a **dedicated preview variation** used only for that preview. Details of the offline path, already investigated, are in §11.3–11.5 so that stage does not have to re-investigate.

Keep the existing 5 second `nodeGraphLiveAwaitStartup` timeout as shared legacy code when that later stage uses the worklet startup. Do not add a timer-free variant for it.

### 8.5 Waveform thumbnails

- **First iteration:** draw them **lazily**. A row without peak data shows a flat placeholder line. When peak data exists, draw it as an inline SVG `<path>` of about 96 min/max pairs (no canvas, no GL). Do not pre-render a whole folder, and do not block Save on a render.
- **Later stage: a peaks cache folder**, in the style of REAPER's `.reapeaks`. Peak data is written once next to (or beside) the preset or variation and reused. Robust audition can fill that cache from an offline bounce. This is its own stage, after robust audition, not part of B3.

The patch `info` normalizer (`normalizeNodeGraphPatchInfo`, `node-graph-patch-normalizers.js:42`) currently drops unknown keys; if thumbs are ever stored on `info`, `thumb` has to be added to it. A peaks cache folder may make that unnecessary.

### 8.6 Hosted site and plugin

- **Hosted / static web:** the Explorer is **load-only**. Factory (and any shipped variations) can be loaded. Save Preset, Save Variation, Remove and Rename are hidden. No IndexedDB, no silent local user library.
- **Plugin:** Save, Load, Remove, Rename and first-iteration ▶ work through the plugin's `/api/*` mirror once the new endpoints exist. A full Load rebuilds the native graph ("expect a click on patch load", `docs/DESIGNER_IN_PLUGIN.md`). The later offline robust audition cannot run in the plugin (no AudioWorklet); keep ▶ as live playback there, or hide the robust preview only.

## 9. The broom page, and Trigger Patch

### 9.1 Broom page

- **Remove** the C-1, C#1 slots and their data: no import. `patch.circuitPatches`, `defaultCircuitPatch` and `activeCircuitPatch` are dropped from serialize and normalize, so old patches that still have them load and the data disappears on the next save. No shipped patch contains them (0 of the patches under `patches/` and `saved-patches/`).
- The page keeps its slot in the command center and becomes the **Gradients page** (§4.8).

### 9.2 Trigger Patch is removed, not replaced

The Keyboard and Grid Keyboard mode **Trigger Patch** (a key press loaded that note's circuit-patch slot; `patch-set` styling marked filled keys) is **deleted with the slots**. There is **no Trigger Variation** and no new keyboard mode. The preset system is not playable. Gradients are played only through Mutators.

Unknown modes already normalize to `"slide"` (`nodeGraphKeyboardMode`), so patches that saved `triggerPatch` degrade safely. `patch-set` key drawing can stay in the piano-key code if something else still uses it; otherwise it goes with the mode.

## 10. The circuit fingerprint (reduced role)

The fingerprint is not used for "morph links". It is a cheap identity for a circuit (module types and wiring, not values). A later UI can use it to mark that a variation's parent has changed shape; a variation is still a complete file and always loads. The computation is in §11.6.

## 11. Findings that the implementation should use

### 11.1 The normal load and commit flow

- **Single entry point:** `commitNodeGraphPatch(patch, options)` (`node-graph-patch-core.js:2122`). Listeners from `addNodeGraphPatchCommitListener` run **once per outer commit, in a microtask**. That is the event hook MasterBot's wake uses, so any preset or variation load through this function wakes everything correctly. No Explorer code builds DOM or geometry.
- **Full load** (presets and variations): `commitNodeGraphScript(text)` (`node-graph-script-status.js:29`) = `commitNodeGraphPatch(loadNodeGraphPatchFromScript(text), { status })`. After it: `setNodeGraphCurrentSavedPatch`, `nodeGraphRefreshServerPatchFileBaseline`, `syncNodeGraphHeaderPatchTitle`.
- **`resetEditorView`** is not passed by this work. Framing a load is the **Patch View box** feature, not this plan.
- **Hook for MasterBot:** none needed beyond the A1 question in §14. If another hook is ever wanted, it is a commit listener, not a call into her files.

### 11.2 Undo

- Snapshot-based: `recordNodeGraphHistory()` (`node-graph-history.js:55`) dedupes against the top snapshot. Commits record the post-state unless `record: false`.
- **Rule for Load:** call `recordNodeGraphHistory()` immediately before committing. One Ctrl+Z then returns to exactly the pre-load state. First-iteration ▶ that loads a different row uses the same bracket.
- Gradients live in the patch, so each gradient edit records one step (one per drag **release**, including position drags, not per frame).
- Save Preset and Save Variation never touch history.

### 11.3 Engine shape (needed now, and for later robust audition)

- One AudioWorklet processor per node, each hosting a **native C++ graph compiled to WASM**, with its own WASM instance and handle (`kMaxInstances = 4` is per instance). A second node is a fully separate engine.
- Notes reach a circuit **only through signals**. The **MIDI module** is the instrument input for pitch, gate and so on (DAW playability and future preview wiring). `vmNoteOn` is off limits (MIDI boundary). The MIDI module is not always in a circuit.
- In the browser, Render Sample already bounces through an `OfflineAudioContext` and its own worklet node (`renderNodeGraphAudio`, `node-graph-render-output.js:84`; `createNodeGraphLiveWorkletNode` at `node-graph-live-runtime.js:3679`). The plugin has no AudioWorklet; the native engine plays.

### 11.4 Later robust audition (not the first iteration)

When that stage is built, reuse Render Sample's offscreen path so the live patch is not touched:

1. Build a plan from the candidate with `nodeGraphBuildLivePlanForPatch(patch)` (`node-graph-live-plan-runtime.js:80`, currently unreferenced, `visualSinks: []`).
2. Add a quiet `onMessage` on `createNodeGraphLiveWorkletNode` (default: today's handler, which writes global live state).
3. Pull a shared helper out of `renderNodeGraphAudio` (something like `nodeGraphRenderPlanToBuffers`). This is the riskiest edit, so it is its own stage.
4. Wait on events only: `nativeGraphStatus`, `processorerror`, and `OfflineAudioContext` completion. Keep the existing 5 s `nodeGraphLiveAwaitStartup` race as shared legacy code.
5. Play the buffer on a small Explorer-owned `AudioContext` created on a user gesture, through the native ear protector. Cache the buffer per row.
6. Preview notes, if used, go into the candidate's **MIDI module** when one is present. A **dedicated preview variation** is the idea to try for a reliable preview sound. If there is no MIDI module and no preview variation, silence is acceptable.
7. Do **not** swap the live patch in and out as a fallback (it would restart the engine, run MasterBot's wake twice, and risk autosaving the preview over the user's patch).

### 11.5 Limits of a later offline note (for the robust stage)

Modules that need main-thread feeds are silent or wrong (Music Player, mic input, Code boxes, host CV feeders, portals). Chaos and noise are a new take each time (APP_POLICY §5 allows this). Show this as one plain info line, not a tooltip. Nothing was timed, because the investigation did not run the app. Measure one audition at the end of the robust-audition stage and write the number here.

### 11.6 The circuit fingerprint

`nodeGraphPatchFingerprint` (`node-graph-patch-serialization.js:200`) hashes everything including values, so it cannot be reused. A new pure function hashes (FNV-1a, 8 hex) a canonical, sorted description: module ids and types, `connections`, `modulations`, `graphConnections`, `bypassedNodes`, and the **count** of data points for modules with editable points (`stepGraph.graph.nodes.length`, `stepRegister`, and so on). Excluded: every value, `paramMeta`, positions, view, display settings, gradients. A small headless test (like `scripts/test_graph_engine.mjs`) is worth it.

### 11.7 The removal surface (broom presets, Trigger Patch, Pages, orphan code)

| File | What to do |
|------|------------|
| `public/node-graph-circuit-patches.js` (427 lines), loaded at `index.html:3902` and `perform.html:3884` | The whole circuit-patch system. **Delete.** |
| `index.html:2663-2818` and `perform.html` (the broom panel), tool block `index.html:2804-2811`, `perform.html:2791-2798` | Slot buttons and `#nodeCircuitPatch*`. Replaced by the Gradients page. The slot buttons use `title=`, a hover tooltip, which is not allowed. |
| `node-graph-patch-serialization.js:112-114`, `node-graph-patch-core.js:1218-1222` | Serialize and normalize `circuitPatches`, `defaultCircuitPatch`, `activeCircuitPatch`. **Remove.** Those sites are also where `patch.gradients` is added. |
| `node-graph-history.js:207`, `node-graph-module-actions.js:1784-1788` | Re-render the slot list after undo and on open. Retarget at the Gradients page, or remove and rebind there. |
| `node-graph-slider-dragging.js:183`, `modules/additiveGraph/additive-graph-math.js:133` | `nodeGraphWriteActiveCircuitPatchParam` on every slider change. **Remove.** |
| `node-graph-view-controls.js` (2365, 2726-2761, 3591-3604), `modules/gridKeyboard/grid-keyboard.js` (240, 308-318), `node-graph-module-factories.js:602`, `modules/keyboardController/keyboard-layout-settings.js:366` | Trigger Patch mode and its label. **Delete the mode.** Do not add a replacement. |
| `lib/visual/piano-keys-draw.js:362,405`, `styles.css:3514` and `5721-5776` | `patch-set` drawing and slot grid CSS. Delete with the mode if nothing else uses them. |
| `public/node-graph-pages.js` (441 lines), registry `pages` at `node-graph-unified-window.js:56-63`, `node-graph-floating-windows.js:948`, `node-graph-unified-window.js:1641`, panel `#nodePagesPage` (`index.html:546-575`, `perform.html:542-571`), `styles.css:4834-5010` | The paper-page menu, replaced by the Explorer. Its `button.title` (`node-graph-pages.js:247`) is a forbidden tooltip. |
| `public/node-graph-file-actions.js:58, 415-545` | An **orphaned** localStorage preset system (`soemdsp-sandbox.patchPresets.v1`). The elements it needs exist in no HTML, and nothing calls it. Dead code (APP_POLICY §10b). Re-confirm with one search, then delete. |

Left alone: `modules/sabrinaReverb/sabrina-preset-browser.js` and `modules/pulseTrain/pulse-train-preset-browser.js` (per-module slider presets with their own localStorage).

## 12. Staged build order

Two tracks that share only Stage 1.

**Stage 1. Removal (both tracks).** Delete the broom circuit presets, Trigger Patch (no replacement) and the orphan file-actions presets. Leave the broom page as an empty shell for Stage A3. Check: patches that saved circuit data or `triggerPatch` still load (the mode becomes `"slide"`).

**Track A: gradients**

- **A1. Offset provider refactor.** Generalize `pitchMutatorApplyLiveParams` into one param offset provider list with no behavior change. Check: the Pitch Mutator sounds the same. Plugin: make the `plugin-host.js` diff read effective params. **Do not start until MasterBot has agreed about `node-graph-live-plan-runtime.js` (§14).**
- **A2. Gradient data and engine effect, no UI.** Normalize and serialize `patch.gradients`, the slider-space offset sum and clamp, the morphable predicate, halfway snap for choice / switch / discrete params, hold outside the ends, auto-drop of all-zero params. Missing node ids are skipped at apply time. Check with a headless script (`scripts/test_gradients.mjs`).
- **A3. Gradients page:** list, strip, snapshot, auto names and rename, position 0..1, undo on drag release, Snapshot / Delete stop / Set start. After A3, use a **clickable prototype** to decide duplicate / delete module behavior, then record the decision in this doc.
- **A4. Holds-still line, the touching-selected-module filter, slider ghost uses the effective value, 1–2 px outline on sliders of the gradient being edited.**
- **A5. Rebase the first-slice Pitch Mutator on gradients** (§5).
- **A6. Later: Gradient to Module** (§6). Keep the gradient, set `enabled: false`.

**Track B: presets**

- **B1. Variations store.** New endpoints in `server.py` and `sandbox-api.cpp` (plugin repo), catalog script skips `*__variations` and lists names, a pure-JS client wrapper, `Untitled N` naming. Check with the server restarted by Argi.
- **B2. Explorer UI.** Search, the 3-way switch, the one list, folders, **Save Preset** and **Save Variation**, Load, Remove, Rename, confirm plus undo point. Hosted site is load-only. No audition yet.
- **B3. First-iteration audition.** ▶ loads if needed and starts live playback. No test note, no offline render. Lazy placeholder thumbnails.

**Later stages (after the tracks above, each its own work):**

- **Robust audition.** Offline render, quiet handler, shared render helper, preview through the MIDI module when present, dedicated preview variation, buffer cache. Keep the 5 s startup timeout. Measure one bounce.
- **Peaks cache folder**, in the style of REAPER's `.reapeaks`.
- **50 generic plugin parameter slots**, assignable to sliders, Mutators or gradient positions (plugin repo; today the plugin has 32 Knob `pluginId` slots, 0–31). Gradient position stays non-automatable inside the circuit builder.
- **Gradient position curves** (no UI design yet).
- Revisit **hold outside the end stops** after Argi has used the strip.

## 13. Files to touch

Nothing here is MasterBot's, except the **pending** A1 edit of `node-graph-live-plan-runtime.js` (§14).

**Track A**

- `public/node-graph-patch-core.js` (normalize `patch.gradients`, drop circuit-patch fields)
- `public/node-graph-patch-serialization.js`
- `public/node-graph-live-plan-runtime.js` (the provider call sites near lines 191 and 333 — **pending MasterBot**)
- `public/node-graph-pitch-mutator-overlay.js`, `public/pitch-mutator-engine.js` (A1, A5)
- `public/plugin-host.js` (effective-param diff)
- `public/node-graph-ghost-sliders.js` (ghost includes gradient offsets; 1–2 px outline while editing)
- New: `public/node-graph-gradients.js` (model, capture, offset provider), `public/node-graph-gradient-page.js` (UI), `scripts/test_gradients.mjs`
- `public/index.html` and `public/perform.html` (script tags, panel markup) and `public/styles.css`
- `public/node-graph-module-actions.js` (bind the page on open), `public/node-graph-history.js`

**Track B**

- `server.py` (variation, patch rename and remove endpoints), `scripts/rebuild_page_patches_index.py` (skip `*__variations`, add `variations`), `scripts/prepare_page_patches.py` if it reads the folders
- New: `public/node-graph-preset-store.js` (client wrapper), `public/node-graph-preset-explorer.js` (UI)
- `public/node-graph-unified-window.js`, `public/node-graph-floating-windows.js` (the `pages` registry entry points to the Explorer)
- First-iteration ▶ may need a small hook to start live playback; do not extract the offline helper until the robust-audition stage (`public/node-graph-render-output.js`, `public/node-graph-live-runtime.js`)
- Keyboard files only to **delete** Trigger Patch: `public/node-graph-view-controls.js`, `public/modules/gridKeyboard/grid-keyboard.js`, `public/node-graph-module-factories.js`, `public/modules/keyboardController/keyboard-layout-settings.js`, and `public/lib/visual/piano-keys-draw.js` if `patch-set` becomes unused
- Deleted: `public/node-graph-circuit-patches.js`, `public/node-graph-pages.js`, the orphan preset block in `public/node-graph-file-actions.js`

**Other repo (not touched by the sandbox work):** `soemdsp-sandbox-audioplugin/src/ui/sandbox-api.cpp` and `sandbox-api.h` (mirror the new endpoints). The 50 generic plugin slots are a later stage in that repo.

## 14. Rules check

- **MasterBot's files:** do not edit `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, or any cull, present or camera code. The slider ghost and the 1–2 px outline go through `node-graph-ghost-sliders.js` and the existing slider DOM, not those files.
- **Pending coordination (A1):** MasterBot is being asked whether Stage A1 may touch `node-graph-live-plan-runtime.js` (the live-parameter build that already calls `pitchMutatorApplyLiveParams`). Treat that as **not approved** until she says so. If she refuses, A1 must use a hook she approves; do not patch around her files.
- **Events only, no timers or polling:** position and stop edits, commits, selection, confirm clearing and the edit outline all run on events. Do not reuse `confirmNodeGraphDefaultButtonClick` (it has a 2 s timeout). Keep the existing 5 s worklet startup timeout as shared legacy when robust audition uses it. `plugin-host.js` has its own legacy timers, which stay; the diff just reads effective params.
- **Phone-friendly, no hover tooltips:** 44 px rows, a 44 px tall strip, 28 px handles, no `title=`, no hover-only action. Info lines are plain text.
- **No dead code:** Stage 1 deletes the broom presets, Trigger Patch, Pages and the orphan localStorage presets.
- **WebGL-only for circuit-builder UIs:** the Gradients page and Explorer are DOM menu panels like the paper-page panel they replace. The strip and thumbnails are DOM or inline SVG.
- **Parameter limits come only from parameter definitions:** the gradient clamp and halfway snap use the definition. Nothing is hardcoded.
- **MIDI boundary:** first-iteration ▶ injects no note. Later preview, if any, goes through the MIDI module, not `vmNoteOn`.
- **Names:** Canvas and Mini Canvas where mentioned. Nothing here needs either by name.
- **Servers and app:** nothing is restarted by this plan. New endpoints need a server restart that Argi chooses to do. No server on 8765, 8080, 8090, 8081, 8082 or 8084 is touched.
- **soundemote-dev:** read-only, never edited.

## 15. Parked and later (not open questions)

These are decided enough to implement, or explicitly parked. There is no remaining question list to block the first stages.

| Item | Status |
|------|--------|
| Save Preset and Save Variation are two buttons; the app's main save is unchanged | Decided, §8 |
| Variations are whole patch JSON, graph points included | Decided, §7 |
| Choice / switch (and other discrete) params snap at halfway | Decided, §4.3 |
| Untitled patches get `Untitled N`; Save is never disabled | Decided, §7.2 |
| Hosted site is load-only; no IndexedDB user presets | Decided, §8.6 |
| Keep the 5 s worklet startup timeout | Decided, §8.4 / §11.4 |
| Thumbnails are lazy; later a `.reapeaks`-style cache folder | Decided, §8.5 and later stages |
| First-iteration ▶ is live playback; robust audition later, including a dedicated preview variation | Decided, §8.4 / §11.4 |
| MIDI module is the instrument input; it may be absent | Decided, §8.4 |
| Slider ghost shows the final value; 1–2 px outline while editing; sliders only | Decided, §4.7 |
| Gradient UI only on the Gradients page; no Settings shortcut | Decided, §4.8–4.9 |
| No param remove UI; all-zero offsets drop out | Decided, §4.2 |
| Position is 0..1, linear interpolation; curves later (no design yet) | Decided, §4.1 / later stages |
| Hold outside the end stops for now; revisit after Argi plays with it | Decided for v1; revisit later |
| Dragging position is an undo step | Decided, §4.2 |
| Auto names `Gradient N`, renameable | Decided, §4.1 |
| Gradient to Module keeps the gradient and sets `enabled: false` | Decided, §6 |
| Trigger Patch is removed; no Trigger Variation | Decided, §9.2 |
| 50 generic plugin slots later; no builder-side automation of gradient position | Decided, later stages / §4.4 |
| Duplicate or delete of a module that a gradient references | **Parked:** decide with a clickable prototype after A3, then write the rule into §4.1 |
| Patch View box (load framing, + at center) | Separate feature, not these stages |
| A1 and `node-graph-live-plan-runtime.js` | **Pending** MasterBot, §14 |
| Smooth Graph `Out` range and cable scaling for Gradient to Module | Check in `smooth_graph.cpp` before A6, §6 |
