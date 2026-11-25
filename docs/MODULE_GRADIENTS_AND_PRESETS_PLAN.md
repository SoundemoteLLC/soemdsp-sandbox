# Module Gradients and Presets: Design Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-24 |
| **Status** | **DRAFT for Argi's review.** Investigation and design only. No feature code written. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Replaces** | `docs/PRESET_EXPLORER_PLAN.md` (the first draft, deleted in the same commit). Its findings that still apply are carried into §11. |
| **Replaces in the app** | The broom page circuit presets (`node-graph-circuit-patches.js`) and the 📄 Pages menu (`node-graph-pages.js`) |
| **Related** | `docs/MUTATOR_PLAN.md`, `docs/APP_POLICY.md`, `docs/MODULE_DISPLAY_REWRITE_PLAN.md` (MasterBot's files, hands off) |

---

## 1. The design in one picture

```
Preset system                  (Preset Explorer: factory + user presets, audition, Save/Load/Remove/Rename)
   ^
Preset variations              (files next to the patch: params + gradient positions)
   ^
Mutators                       (later: drive gradient positions from pitch or velocity)
   ^
Module gradients               (base layer: a 1D strip of snapshots per module, offsets on top of the knobs)
```

Two systems, kept separate:

- **Module gradients** are a *patch feature*. They live inside the patch, know nothing about files, and work without any preset code.
- **The Preset system** (Explorer plus variations) is a *file feature*. A variation only stores values and gradient **positions**. It never stores or changes a gradient's shape.

They touch in exactly two places: a variation records each gradient's position, and Mutators (later) drive gradient positions.

## 2. Short answers

| Question | Answer |
|----------|--------|
| What is a gradient? | A per-module 1D strip (position 0 to 127) with snapshot stops. One position drives it. Each stop stores how far the module's knobs moved from the first snapshot. The result is an **offset** added on top of the knob, like modulation. |
| How do params get registered? | **Remove-first.** Snapshot, move knobs, snapshot again: every continuous param that moved is registered automatically. You delete the unwanted ones. There is no upfront registering. |
| How do several gradients combine? | Offsets **add up** (also with later Mutator offsets). The sum is clamped only by the parameter definition's min and max. Nothing is hardcoded. |
| Do wires change? | **Never.** Params only. Modules or data with no morph logic (Step Graph and Smooth Graph points, choices, switches, integers) are not included. The page shows one plain line under the bar: `Holds still: Step Graph`. No badges, no tooltips, no pop-ups. |
| Where does the strip get edited? | **On the gradient page (the old broom page), only.** Module Display Settings gets nothing. Reasons in §4.8. |
| How do Mutators fit? | A Mutator knob lane **is** a gradient whose position axis is the note. Recommended merge: gradients are the data layer, the Mutator becomes an axis-to-position router. See §5. |
| Do variations fit how patches are stored today? | **Not as-is.** The write endpoints are flat and basename-only, in both `server.py` and the plugin's C++ API, and the pages catalog is one folder deep. It works with a small, matching pair of new endpoints plus a catalog script change. See §7. |
| Can the plugin audition? | **No.** The plugin WebView has no AudioWorklet (the native engine plays). ▶ is hidden there. Loading and saving work. See §8.6. |
| Can a gradient become real modules later? | **Yes, feasible.** One Smooth Graph per registered param (Linear curve), fed by one Knob that carries the position, wired through the normal param modulation cable. See §6. |

## 3. What is worth borrowing from soundemote-dev (read-only, briefly)

soundemote-dev's `/interface/preset-browser` is a UI prototype with no audio and **no play buttons**. It also combines presets and morphing in one panel, which is exactly what this design does *not* do. It is a reference for the strip's look only. Nothing from it is copied as a design.

Worth borrowing for the gradient strip:

- A **short strip with draggable handles** at integer positions, with a thin white **playhead line**.
- A **strip background that is a picture of the blend**: a `linear-gradient` between one hue per stop, so you see the shape at a glance.
- **Stops that snapshot the current sound**, added by clicking an empty spot on the strip.
- **Blend in normalized 0..1 space**, so a wide-range param and a narrow one blend the same way.
- Keys 1 to 9 to jump between stops, and a short **20-deep undo** for strip edits (here this is the app's normal undo).

Not borrowed: preset lists, categories, tags, padlocks, a global glide slider, name-hash colors (our hue comes from the stop's order, not a name), `title=` tooltips (forbidden here), localStorage state (ours lives in the patch).

# Part A: Module gradients

## 4. Design

### 4.1 Data model (inside the patch, on the node)

```
node.gradients = [
  {
    id: "g1",                 // unique inside the node
    name: "Bright",           // optional, auto "Gradient 1"
    position: 0,              // 0..127, the one value that drives the strip
    origin: { cutoff: 0.31, res: 0.20 },  // slider-space base values at the first snapshot
    params: ["cutoff", "res"],            // registered (live) params, in display order
    skipped: ["gain"],                    // removed by the user; later snapshots don't re-add them
    stops: [
      { id: "s1", pos: 0,   off: {} },                         // origin, always pos 0, offsets all 0
      { id: "s2", pos: 127, off: { cutoff: 0.40, res: -0.05 } },
      { id: "s3", pos: 64,  off: { cutoff: 0.10 } }            // a missing key means 0
    ]
  }
]
```

- Values are in **slider space** (the normalized knob travel, 0..1), the same space `docs/MUTATOR_PLAN.md` uses for its offsets. The slider curve and the definition's min and max map slider space to the real domain (`nodeGraphParameterDefinitionMetadata`, `node-graph-parameter-metadata.js:522`). So one gradient behaves the same on a log Hz knob and a linear knob.
- A stop stores **offsets**, not absolute values. If the knob's base is moved later, the gradient still means "this much more or less than wherever the knob is". Stop 0 is the origin and holds zero offsets, so position 0 equals the plain knob.
- Hold outside the ends: before the first stop and after the last stop the offset holds the end value.
- Gradients are normalized in `node-graph-patch-core.js` next to the other node-level data (`chordMemory`, around line 910) and serialized with the node. Unknown ids and keys are dropped. The module duplicate and paste paths must copy `gradients` (verify at implementation whether they clone node objects wholesale). A deleted module takes its gradients with it. No gradient ever references another node, so deleting or re-wiring never leaves a dangling reference.

### 4.2 Capture: snapshot, move, snapshot (remove-first)

1. **First snapshot** on a module: creates a gradient with `origin` = the module's base params, one stop at 0, and an empty `params` list. The page asks for nothing else.
2. The user moves knobs on the module as usual.
3. **Second snapshot** at a position (default 127, or where the playhead is): for every param whose base slider value differs from `origin` by more than an epsilon (1e-4 of slider travel) and that is not `skipped`, the param is **registered automatically** and the stop stores its offset.
4. Later snapshots do the same. A param that moves for the first time at stop 3 joins `params`, and earlier stops get an implicit zero for it.
5. The gradient page lists the registered params as rows. A ✕ on a row removes it: its offsets are deleted from every stop, and it goes into `skipped` so a later snapshot doesn't resurrect it.

A snapshot reads **base** params, never the final (offset) values, so a gradient never learns from its own output or from another gradient's. While snapshotting, the module's gradients are simply not consulted, because the snapshot reads `node.params`, which gradients never write.

Re-snapshot on an existing stop replaces it. Moving a stop is a drag. **Set start** re-records `origin` from the current knobs, for the case where the user changed the base on purpose and wants the gradient to follow.

### 4.3 What a gradient can and can't move

Morphable means a continuous numeric param by its **definition**:

- no `choices` (so not a choice, switch or on/off), and
- not an integer step (step 1 or larger and whole, e.g. Steps, Seed).

Everything else **holds still**: choice and integer params, and module-level data: Step Graph and Smooth Graph points, `stepRegister`, `chordMemory`. Detection happens at snapshot time (a choice param that differs between snapshots is not registered, and its label goes on the holds-still line) and by module type for data modules.

The page shows one plain line under the bar when something holds still, for example `Holds still: Step Graph` or `Holds still: Waveform`. Nothing else: no badge on the module, no tooltip, no pop-up.

Open question 5 asks whether choices should instead snap at the midpoint between stops (as Sabrina's morph does).

### 4.4 Layering: gradients are offsets, like modulation

```
finalSlider = clamp01( baseSlider + sum(gradient offsets) + sum(later Mutator offsets) )
final value = definition's slider curve and min/max map finalSlider into the domain
```

- The clamp is the definition's own range (slider 0..1 maps to min..max). Nothing is hardcoded and nothing is per-gradient.
- The knob stays fully adjustable. The user moves the base, and the gradient moves relative to it.
- Wire modulation is applied after this, natively, exactly as today (`unitAdd` then the native clamp to min and max, B-082). A cable and a gradient on the same param add.
- `node.params` (the base) is **never rewritten** by a gradient. That keeps saving, undo, snapshots and variations honest.

**Engine hook.** The first Pitch Mutator slice already applies offsets on the main thread to the live params and leaves the base alone: `pitchMutatorApplyLiveParams` (`public/node-graph-pitch-mutator-overlay.js`) is called from `nodeGraphBuildLiveParameterNodes` (`node-graph-live-plan-runtime.js`, near lines 191 and 333). Stage A1 generalizes that call into one **param offset provider list**: gradients first, then the Pitch Mutator. Both go through the same function, so there is exactly one place where "effective param" is computed (APP_POLICY §5, no duplicate engine code). Later this becomes the native offset-table hook the Mutator plan already describes (per-voice tables, ZOH).

**Updates are events.** A change of a gradient position or stop calls the existing param update path (`scheduleNodeGraphLiveParameterSync`, `sendNodeGraphLiveParameterUpdate`). No timers or polling.

**Plugin note (important).** In the DAW plugin there is no AudioWorklet. `public/plugin-host.js` diffs `node.params` after page param edits (`copyParams`, lines ~201-232) and posts `param` events to the native engine. A gradient offset isn't in `node.params`, so that diff would miss it. The plugin host's diff must read the **effective** params from the same provider function. That is a one-function change in `plugin-host.js` (a sandbox file, not MasterBot's) and is listed in §12.

### 4.5 Position

- One position per gradient, 0 to 127 (float), saved on the gradient (`position`). 127 matches MIDI CC and note numbers, which is what Mutators will use later.
- Set by dragging on the strip, by loading a variation, and later by a Mutator, which **adds** to it (clamped to 0..127).
- No wire is added. A future "drive position from a cable" is not part of this plan, because wires never change here.

### 4.6 Several gradients per module

A module can have any number of gradients, each with its own params list and position. Gradients are independent. Two gradients registering the same param just add. The page shows each gradient as its own strip row.

### 4.7 The gradient page (the old broom page)

The broom page (🧹, `patchDefaults`, panel `#nodePatchDefaultsPanel`, `index.html:2663-2818`) loses the circuit-patch half (§9) and becomes the **gradient page**. It is a DOM menu panel like the paper-page panel it sits beside, which is allowed (the WebGL-only rule is for circuit-builder UIs). Layout, top to bottom:

1. A filter row: **All** or **Selected module**. Selecting a module on the Canvas switches the list to it (a selection event, no polling).
2. One **card per gradient**, grouped under its module's name:
   - The **strip**: 44 px tall for touch, full width, with 28 px wide handles, a white playhead line and number labels staggered on alternate stops. Its background is a `linear-gradient` through one hue per stop (hue from stop order: `hsl(order * 137.5, 55%, 50%)`).
   - Tap an empty spot to add a stop there (a snapshot of the module's current base). Drag a stop to move it. Drag anywhere else to move the playhead. Drag-release records one undo step.
   - Buttons: **Snapshot**, **Delete stop**, **Rename**, **Delete gradient**, **Set start**.
   - The registered param rows: label, the offset **at the playhead** as a plain number (`+0.12`), and ✕.
   - The plain `Holds still: …` line under the bar when something holds still.
3. A **Snapshot a module** button at the top, for the selected module, which makes a new gradient.

Phone-friendly: one column, 44 px rows, no hover-only affordance. Strip handles are the only pointer-drag targets. This is a DOM panel, so there is no GL work and no touch of the module display code.

The knob itself is **not** redrawn to show the offset in v1. That would be a module display change (MasterBot's files). The offset is readable on the gradient page instead. Open question 8.

### 4.8 Where the strip is edited: recommendation

**Only on the gradient page.** Not in Display Settings, not both.

- Display Settings (`traceDisplaySettings`, the 📺 page) is the settings of a module's *display*. Not every module has a display, and gradients are about knobs.
- A strip needs full width and a list of param rows. Display Settings is a narrow per-module form.
- One editor means no second code path to maintain (no dead or duplicate UI) and no state shown in two places.
- The page still reaches a single module in one tap, through the **Selected module** filter.

If Argi wants a shortcut, the module's Settings could later show one plain line, like `Gradients: 2`, that opens the page filtered to the module. That is an open question (9), not part of the plan.

## 5. Mutators: how this fits `docs/MUTATOR_PLAN.md`

The Mutator plan has per-knob **lanes**: keyframes over an axis (pitch or velocity), summed offsets in slider space, clamped by the definition, ZOH between keys, a per-voice baked table, a Freq lane that isn't an offset. A lane for a knob is exactly "a gradient with one param, whose position axis is the note".

**Proposed merge (cleanest):**

1. **Gradients are the data layer.** A strip of stops with offsets in slider space, as defined in §4.1.
2. **A Mutator becomes an axis-to-position router.** Its binding is `(gradient, axis, position curve)`. The axis is pitch or velocity. The curve maps the axis to a position 0..127 and reuses the Step Graph shapes the Mutator plan already uses.
3. The Mutator **keeps** what is not an offset: the Freq lane (Hz isn't a slider offset), the overlay, the MIDI policy, polyphony and LUT baking, and the `Pin Keyframe` gesture. Pin Keyframe now means "write a stop at the position the current note maps to" into a gradient that the Mutator owns and shows on the gradient page.
4. One engine hook serves both: offset tables indexed by an axis, summed (§4.4).
5. The rules the Mutator plan signed off stay as they are: summing, clamp to the definition, ZOH, per-voice LUT, the B-058 check.

**Order:** build gradients first, then rebase the already-coded first-slice Pitch Mutator onto them (Stage A5). Until then nothing changes for the Mutator.

Where the position comes from for a Mutator-driven gradient: `position = clamp(0..127, gradient.position + mutatorPosition)`. A gradient driven by a Mutator still has a manual base position the user can drag.

## 6. Later stage: Gradient to Module

**What it does.** A **Convert to module** action on a gradient builds real graph modules that reproduce what the gradient does, wires them to the same params, and leaves the patch working without the gradient. Future stage, after A5.

**Feasibility: yes.** Everything it needs exists today.

| Piece | What exists |
|-------|-------------|
| A curve source | **Smooth Graph** (`smoothGraph`): free dots, `smoothingMode` Linear, Input mode. It has an `In` port and an `Out` port. Its data is `node.graph = { cursorX, nodes: [{ x, y, c, shape }] }`. |
| A position source | A **Knob** module carrying the position (it is the existing way to hold one value and feed a cable). |
| The wire | An ordinary `modulations[]` entry `Out -> destinationNode.destinationParam` (the same entries as `"sourceNode"/"sourcePort"/"destinationNode"/"destinationParam"` in shipped patches). The native side adds a modulation cable in the unit band and then clamps to min and max, which is the same rule as §4.4. |

**What it builds.**

1. One **Position Knob** per gradient, named after it, value = `position / 127` (the graph's In range tops out at ±1).
2. For each registered param, one **Smooth Graph**:
   - Mode `Input`, Curve `Linear` (the strip interpolates linearly, so a Linear curve matches it exactly), `inputMin 0`, `inputMax 1`.
   - One dot per stop: `x = stop.pos / 127`, `y` = the stop's offset for that param. A dot at `x = 1` is added if the last stop is before 127, so the graph holds the end value the way the strip does. Steps 0 (free X), Lock Ends off.
   - Wired `Position Knob.Out -> Graph.In` and `Graph.Out -> target.param`.
3. Several gradients on one param become several cables to that param, which add (as gradient offsets do).
4. Modules are placed next to the source module (spawn helper), in a single commit with one undo point (`recordNodeGraphHistory()` before).
5. The gradient is then **removed**, or kept with a `disabled` flag, so the offset isn't applied twice (open question 10).

**How the position input feeds the graphs.** The Position Knob's output goes to every graph's `In`. In `Input` mode the graph reads `In` mapped through In Min and In Max to its x axis, so knob value 0..1 sweeps the dots from the first stop to the last. Moving the Knob (or modulating it, which is also how a Mutator-style pitch or velocity could drive it later) then moves every graph together. This is the same one-position-drives-everything idea as the strip.

**Needs checking before this stage starts** (not assumed here):

- The Smooth Graph's `y` range and how its `Out` maps to modulation. The default curve runs `y = 1` to `y = 0`, so `Out` may be 0..1. A gradient offset can be negative. If `Out` is unipolar, the conversion needs the graph's Skew or a bipolar mapping to reach negative offsets, and **that must be confirmed in `smooth_graph.cpp`** first.
- The cable scaling: whether a modulation value of 1.0 equals full slider travel (offsets are slider fractions of -1..1).
- Params that were `Holds still` are not converted, and the page says so on the same plain line.
- It adds modules and wires, so it is a topology edit. That is fine for authoring in the browser. The DAW plugin locks topology edits, so this action is hidden there.
- Limits: a gradient with `n` params builds `n + 1` modules. A cap (and a confirm step) is worth adding for gradients with many params.

# Part B: The Preset system

## 7. Preset variations as files

### 7.1 What a variation is

A **variation** is a saved set of knob values for **one patch**, plus the position of each gradient. It does **not** contain wires, modules, gradient stops, or module data (Step Graph points and so on). Loading one is a params-only commit, so **wires never change** and the circuit's engine state (delay tails, filters) survives, as APP_POLICY §22 requires.

Gradients themselves are saved **inside the patch**, as in §4.1.

### 7.2 Argi's naming, and the on-disk layout

```
mypresets.json
mypresets__variations/
    mypresets__Bright.json
    mypresets__Dark.json
    mypresets__1.json          (auto-numbered when no name is given)
```

Naming rules:

- Folder: `<patch stem>__variations/`. File: `<patch stem>__<name>.json`. The display name is everything after the **first** `__`.
- No name given: the next unused whole number (`1`, `2`, `3`, …), natural-sorted in the list.
- Names are sanitized: no `\ / : * ? " < > |`, no control characters, no `..`, trimmed, max 64 characters, no Windows reserved names, and **case-insensitively unique** (Windows and macOS file systems).

### 7.3 Does it work with how patches are stored today? (checked)

| Host | Where patches live | What works today | What the layout needs |
|------|--------------------|------------------|-----------------------|
| **Dev server and standalone app** (`server.py`) | Shipped: `patches/` (static, read-only, one folder deep in the catalog). User: `saved-patches/*.json`, flat. | Static GET of any file under `patches/` (including a folder), via `serve_page_patch` (path-safe). User API: `/api/patches`, `/api/patches/meta`, `/api/patches/file?name=`, `POST /api/patches/save` (writes `bankNNN-programNNN-<title>.json`), `POST /api/patches/overwrite?filename=` (**basename only**, with `expectedMtimeMs` and `expectedSize` conflict checks). | **Subfolders can't be written or listed.** There is no remove or rename endpoint for patches at all. A few new endpoints are needed (§7.4), and a server restart to load them (Argi's call, never done by me). |
| **DAW plugin WebView** (`soemdsp-sandbox-audioplugin`) | Shipped: the read-only pack (`Sandbox-perform/patches`). User: `Documents/Sandbox/Patches/`. | `src/ui/sandbox-api.cpp` re-implements the same `/api/patches*` API in C++ (`listPatches` uses a **non-recursive** `findChildFiles`). | The same new endpoints must be mirrored there (a **separate repo**, so this is a plugin-side task, not done here). Overwriting a shipped patch already writes a copy into the user folder, so variations of a shipped patch go to the user folder too. |
| **Static web site** (soundemote.io style) | Read-only `patches/` over HTTP. | Reading factory presets. | **No write API.** User presets and variations can't be saved to files there. Fall back to download/import or IndexedDB (open question 3). |

**Conclusion:** the folder layout is sound and **keeps working for factory variations with no server change** (they are just more static files), but saving user variations needs a matching pair of new endpoints in `server.py` and the plugin's `sandbox-api.cpp`.

### 7.4 The real mechanism

**A flat, safe API over the folder layout.** The client never sends a path. It sends `base` (the patch's stem) and `name`. The server or plugin builds the path itself, so there is no traversal surface.

| Endpoint | Does |
|----------|------|
| `GET /api/variations?base=<stem>` | Lists the variations of a base: user folder plus, for a shipped base, the shipped folder (a user variation wins on the same name). Returns `{name, source, bytes, modifiedUtc}`. |
| `GET /api/variations/file?base=&name=` | Returns one file. |
| `POST /api/variations/save` | Writes `<user dir>/<stem>__variations/<stem>__<name>.json`. No name: auto-number. Refuses an existing name unless `overwrite=1` with the `expectedMtimeMs` and `expectedSize` check the patch overwrite already uses. |
| `POST /api/variations/rename` and `.../remove` | Rename and delete, same validation. |

Plus, because the Explorer's Remove and Rename for user **presets** have no endpoint today either: `POST /api/patches/rename` and `.../remove` on the same pattern. Renaming a preset **renames its `__variations` folder and file prefixes in the same call**, so the pair never splits.

**The factory catalog.** `scripts/rebuild_page_patches_index.py` builds `patches/index.json` for root plus one folder, so a root `mypresets__variations/` would show up as a *folder of patches*. The script must skip any `*__variations` directory as a catalog folder and instead add `variations: ["Bright","Dark","1"]` to the base's entry. That also lets the Explorer show a variation count without any extra request.

**Variation file format** (small, a few KB):

```
{
  "format": { "kind": "soemdsp-sandbox-variation", "version": 1 },
  "base": { "file": "mypresets.json", "fingerprint": "a1b2c3d4" },
  "info": { "name": "Bright", "created": "2026-11-24T00:00:00Z", "thumb": [ ... ] },
  "params": { "<nodeId>": { "<key>": <value>, ... } },
  "gradients": { "<nodeId>": { "<gradientId>": <position> } }
}
```

- `params` holds **every** param value of the patch at save time (choices too), so a variation is a faithful capture even if the base file is edited later. It carries no `paramMeta`, so limits keep coming from definitions only.
- `base.fingerprint` is the **circuit fingerprint** of §11.6, used only to flag a variation as **stale** when the base's wiring has changed since. A stale variation still loads: it applies whatever nodes and params still exist and skips the rest.
- `info.thumb` is the waveform thumbnail (§8.5), captured at save time where audition is available.
- The loader validates `format.kind` and `version` like `validate_node_patch_payload` does for patches.

**Untitled patches** (not yet saved to a file) have no stem, so there is nowhere to put variations. The Variation Save button is **disabled with one plain line** (`Save the patch first`) until the patch has a name. Open question 4 asks whether to keep a session-only list instead.

## 8. Preset Explorer

The 📄 page icon in the command center now opens the Explorer. It replaces `node-graph-pages.js` and its list. It is a DOM menu panel (same status as the paper-page panel it replaces).

### 8.1 Layout

1. **Search** (a simple text filter on name, folder and author. Nothing else for now).
2. **The 3-way switch: Both / Factory / User.**
3. **One list**, folder-style: factory presets (from `patches/index.json`) and user presets (from `/api/patches`) in the same list. Folders group, with Factory folders and User presets interleaved by name. Each row shows the name, a source mark (Factory or User), a small waveform thumbnail, and a ▶ button.
4. A preset row with variations is a **folder** you open: its children are its variations (`mypresets__variations/`), shown as rows with the same ▶ and thumbnail.
5. **Buttons:** Save, Load, Remove, Rename.

Phone-friendly: one column, 44 px rows, ▶ is a 44 px target, no hover.

### 8.2 Selecting and confirming

- Tapping a row **only selects it**.
- **Load** and **overwrite** use an inline confirm step on the same button (it becomes "Confirm Load" until the selection or panel changes). It is cleared by selection, panel-close and commit events, **not by a timer** (the old confirm helper uses a 2 second `setTimeout`, so it isn't reused).
- Before a Load, `recordNodeGraphHistory()` is called, so one Ctrl+Z returns to exactly what was there (§11.2).
- Factory presets are read-only, so Remove and Rename are disabled for them, and Save on a Factory row offers "Save as user preset".

### 8.3 What Save, Load, Remove and Rename mean

| Button | Preset row selected | Variation row selected |
|--------|---------------------|------------------------|
| **Save** | Saves the live patch as a **user preset** (new, or overwrite the selected user preset after the confirm). | Saves a **variation** of that patch (new, or overwrite the selected one after the confirm). |
| **Load** | Full patch load (§11.1). | Params-only load. Circuit unchanged. |
| **Remove** | Deletes the user preset **and its variations folder** (confirm). | Deletes the variation (confirm). |
| **Rename** | Renames preset and its variations folder together. | Renames the variation. |

To save a variation of the open patch the user selects it (or one of its variations) and presses Save. Whether to add an explicit "Variation | Preset" choice on Save is open question 2.

### 8.4 Audition (▶)

Reuses the existing offscreen path, so the live patch is never touched. Option A of the first draft, unchanged:

- Build a candidate patch (for a variation: the base patch with the variation's values applied), make a plan with `nodeGraphBuildLivePlanForPatch(patch)` (`node-graph-live-plan-runtime.js:80`, currently unreferenced, `visualSinks: []`), and run it through an `OfflineAudioContext` with its **own** worklet node and WASM engine, exactly as Render Sample does (`renderNodeGraphAudio`, `node-graph-render-output.js:84`).
- The result plays on a small Explorer-owned `AudioContext` created on the first ▶ tap (a user gesture), through the native ear protector. The buffer is cached per row.
- A spinner on the row while it builds. The ▶ becomes a Stop that discards the job. Jobs are serialized.
- Tap again to stop. Details and costs are in §11.3 to §11.5.

### 8.5 Waveform thumbnail

- From the same bounce: ~96 min and max pairs (`Int8`, ~192 bytes), normalized to the peak, drawn as an inline SVG `<path>` (no canvas, no GL).
- **User presets and variations:** stored in the file at save time, in `info.thumb` (for variations) and in the preset's `info.thumb`. The patch `info` normalizer (`normalizeNodeGraphPatchInfo`, `node-graph-patch-normalizers.js:42`) currently drops unknown keys, so `thumb` has to be added to it. A row without one shows a flat line.
- **Factory presets:** thumbnails fill lazily, the first time a row is auditioned, and are cached in IndexedDB keyed by file and size. Pre-generating them into `patches/index.json` can come later (open question 7).

### 8.6 What the plugin can and can't do

The plugin has no AudioWorklet (`setNodeGraphLiveOutputEnabled(true)` is a no-op there, the native engine plays). The offline render therefore can't run, so **▶ is hidden in the plugin** and thumbnails come only from files that already have them. Search, the 3-way switch, Save, Load, Remove and Rename work through the plugin's own `/api/*` mirror. A **params-only** Load never sends a `patch` event to the native engine, so loading a **variation** in the DAW doesn't rebuild the graph and doesn't click. A full preset Load does rebuild it ("expect a click on patch load", `docs/DESIGNER_IN_PLUGIN.md`).

## 9. The broom page, and Trigger Patch becoming Trigger Variation

### 9.1 Broom page

- **Remove** the C-1, C#1 slots and their data: no import, as decided. `patch.circuitPatches`, `defaultCircuitPatch` and `activeCircuitPatch` are dropped from serialize and normalize, so old patches that still have them load and the data just disappears on the next save. No shipped patch contains them (0 of the patches under `patches/` and `saved-patches/`).
- The page keeps its slot in the command center and becomes the **gradient page** (§4.7).

### 9.2 Trigger Patch keyboard mode, repurposed

Today the Keyboard and Grid Keyboard modes include **Trigger Patch**: a key press loads that note's circuit-patch slot, and `patch-set` styling marks filled keys. It goes with the slots (Stage 1) and returns as **Trigger Variation**.

**Proposal:**

- A key press loads the **Nth variation of the current patch**. Variations are ordered the way the Explorer lists them (natural sort, so `1, 2, 10` not `1, 10, 2`). Key `k` counts up from a base key (default C2, MIDI 36, a setting on the keyboard module), so the first variation sits on the base key and the rest follow upward.
- Keys with a variation get the existing `patch-set` look (reuse of `lib/visual/piano-keys-draw.js`). Keys past the last variation are inert.
- A key press is a **params-only load** with **no confirm**, because it is a performance gesture. Before the first trigger after any other edit, `recordNodeGraphHistory()` pins the pre-state, then triggers commit with `record: false`, so a performance run adds no flood of undo steps. One Ctrl+Z returns to the state before playing.
- It is pointer-only on the module face, like the mode today. Hardware MIDI never reaches it (APP_POLICY MIDI boundary: only the MIDI module handles MIDI).
- The list is read from the Explorer's variation cache for the loaded patch. A change to that list (a save, remove or rename) repaints the keys on an event.
- The mode id is new (`triggerVariation`). An unknown mode already normalizes to `"slide"` (`nodeGraphKeyboardMode`), so patches that saved `triggerPatch` degrade safely.

Optional later: a **Glide** (ms) on the keyboard module so a trigger eases to the new values using the gradient positions.

## 10. The circuit fingerprint (reduced role)

The fingerprint is no longer used for "morph links". It is used for one thing: a variation records its base's fingerprint so the Explorer can show a variation as **stale** when the base's wiring changed (§7.4). The design in §11.6 is unchanged.

## 11. Findings carried over from the first draft (still apply)

### 11.1 The normal load and commit flow

- **Single entry point:** `commitNodeGraphPatch(patch, options)` (`node-graph-patch-core.js:2122`). Listeners from `addNodeGraphPatchCommitListener` run **once per outer commit, in a microtask**. That is the event hook MasterBot's wake uses, so any preset load through this function wakes everything correctly. No Explorer code builds DOM or geometry.
- **Full load** (a different circuit): `commitNodeGraphScript(text)` (`node-graph-script-status.js:29`) = `commitNodeGraphPatch(loadNodeGraphPatchFromScript(text), { status })`. After it: `setNodeGraphCurrentSavedPatch`, `nodeGraphRefreshServerPatchFileBaseline`, `syncNodeGraphHeaderPatchTitle`.
- **Params-only load** (variations, Trigger Variation): `commitNodeGraphPatch(patch, { liveParamsOnly: true, paramSyncIds, status })`. It skips the DOM rebuild and the plan recompile and calls `scheduleNodeGraphLiveParameterSync`.
- **`resetEditorView`** is not passed, so the camera stays where it is. Whether a different-circuit Load should reframe is open question 11.
- **Hook for MasterBot:** none needed. If one is ever wanted it is another commit listener, not a call into her files.

### 11.2 Undo

- Snapshot-based: `recordNodeGraphHistory()` (`node-graph-history.js:55`) dedupes against the top snapshot. Commits record the post-state unless `record: false`.
- **Rule for Load:** call `recordNodeGraphHistory()` immediately before committing. One Ctrl+Z then returns to exactly the pre-load state.
- Variation files live outside the patch, so they don't bloat undo snapshots. Gradients live in the patch, so each gradient edit records one step (one per drag release, not per frame).
- Save never touches history.

### 11.3 How the engine and the offline render work

- One AudioWorklet processor per node, each hosting a **native C++ graph compiled to WASM**, with its own WASM instance and handle (`kMaxInstances = 4` is per instance). A second node is a fully separate engine.
- Notes reach a circuit **only through signals** (Keyboard and Grid Keyboard faces, a sequencer's own audition). `vmNoteOn` is off limits (MIDI boundary).
- Render Sample already does the whole job: `OfflineAudioContext`, `createNodeGraphLiveWorkletNode(offlineCtx, plan)` (`node-graph-live-runtime.js:3679`), `setPlan` and `setSpeed`, wait for `nativeGraphStatus: "compiled"`, `startRendering`, ear protector.

### 11.4 What the audition needs changed (none in MasterBot's files)

1. **Quiet message handler:** an optional `onMessage` on `createNodeGraphLiveWorkletNode` (default: today's handler, which writes global live state).
2. **Shared render helper** pulled out of `renderNodeGraphAudio` (something like `nodeGraphRenderPlanToBuffers(plan, { seconds, onReady })`). Render Sample and the audition both call it. This is the riskiest edit, so it is its own stage with its own check.
3. **Events only:** wait on the node's `nativeGraphStatus`, `processorerror` and `OfflineAudioContext` completion. The shared startup race (`nodeGraphLiveAwaitStartup`, 5 s) is legacy shared code (open question 6).
4. A separate Explorer-owned `AudioContext`, so a stopped transport never shows a misleading playing state.
5. The ear protector on every audition buffer.

### 11.5 Limits of a fixed-length offline note

Modules needing main-thread feeds are silent or wrong (Music Player, mic input, Code boxes, host CV feeders, portals). Presets without a note source render from cold. A sequencer plays its own pattern. Chaos and noise are a new take each time (APP_POLICY §5 allows this). Show this as one plain info line, not a tooltip. **Nothing was timed**, because the investigation didn't run the app. Measure one audition at the end of Stage B3 and write the number here.

### 11.6 The test note and the circuit fingerprint

- **Test note:** post `setKeyboardModuleSignal { nodeId, signal: { gate: 1, velocity, midi }, atFrame: -1 }` to the candidate patch's `keyboard` and `gridKeyboard` modules (the same message the on-screen keyboard sends: a signal sender, not MIDI). Note-off uses `OfflineAudioContext.suspend(hold)` then `resume()`, with no timers. Which note: the keyboard's last struck note, else C4 (60). With no keyboard the circuit renders from cold.
- **Fingerprint:** `nodeGraphPatchFingerprint` (`node-graph-patch-serialization.js:200`) hashes everything including values, so it can't be reused. A new pure function hashes (FNV-1a, 8 hex) a canonical, sorted description: module ids and types, `connections`, `modulations`, `graphConnections`, `bypassedNodes`, and the **count** of data points for modules with editable points (`stepGraph.graph.nodes.length`, `stepRegister`, and so on). Excluded: every value, `paramMeta`, positions, view, display settings, gradients. A small headless test (like `scripts/test_graph_engine.mjs`) is worth it.

### 11.7 The removal surface (broom presets, Pages, orphan code)

| File | What it does with circuit patches or Pages |
|------|--------------------------------------------|
| `public/node-graph-circuit-patches.js` (427 lines), loaded at `index.html:3902` and `perform.html:3884` | The whole circuit-patch system. **Delete.** |
| `index.html:2663-2818` and `perform.html` (the broom panel), tool block `index.html:2804-2811`, `perform.html:2791-2798` | Slot buttons and `#nodeCircuitPatch*`. Replaced by the gradient page. The slot buttons use `title=`, a hover tooltip, which is not allowed. |
| `node-graph-patch-serialization.js:112-114`, `node-graph-patch-core.js:1218-1222` | Serialize and normalize `circuitPatches`, `defaultCircuitPatch`, `activeCircuitPatch`. **Remove.** |
| `node-graph-history.js:207`, `node-graph-module-actions.js:1784-1788` | Re-render the slot list after undo and on open. **Remove.** |
| `node-graph-slider-dragging.js:183`, `modules/additiveGraph/additive-graph-math.js:133` | `nodeGraphWriteActiveCircuitPatchParam` on every knob change. **Remove.** |
| `node-graph-view-controls.js` (2365, 2726-2761, 3591-3604), `modules/gridKeyboard/grid-keyboard.js` (240, 308-318), `node-graph-module-factories.js:602`, `modules/keyboardController/keyboard-layout-settings.js:366` | Trigger Patch mode and its label. Replaced by Trigger Variation at Stage B4. |
| `lib/visual/piano-keys-draw.js:362,405`, `styles.css:3514` and `5721-5776` | `patch-set` drawing and slot grid CSS. The `patch-set` key look is reused. |
| `public/node-graph-pages.js` (441 lines), registry `pages` at `node-graph-unified-window.js:56-63`, `node-graph-floating-windows.js:948`, `node-graph-unified-window.js:1641`, panel `#nodePagesPage` (`index.html:546-575`, `perform.html:542-571`), `styles.css:4834-5010` | The paper-page menu, replaced by the Explorer. Its `button.title` (`node-graph-pages.js:247`) is a forbidden tooltip. |
| `public/node-graph-file-actions.js:58, 415-545` | An **orphaned** localStorage preset system (`soemdsp-sandbox.patchPresets.v1`). The elements it needs exist in no HTML, and nothing calls it. Dead code (APP_POLICY §10b). Re-confirm with one search, then delete. |

Left alone: `modules/sabrinaReverb/sabrina-preset-browser.js` and `modules/pulseTrain/pulse-train-preset-browser.js` (per-module knob presets with their own localStorage).

## 12. Staged build order

Two tracks that share only Stage 1 and the variation save of gradient positions.

**Stage 1. Removal (both tracks).** Delete the broom circuit presets, Trigger Patch mode and the orphan file-actions presets. The broom page is left as an empty shell for Stage A3. Check: patches that saved circuit data or `triggerPatch` still load.

**Track A: gradients**

- **A1. Offset provider refactor.** Generalize `pitchMutatorApplyLiveParams` into one param offset provider list with no behavior change. Check: the Pitch Mutator sounds the same. Plugin: make the `plugin-host.js` diff read effective params.
- **A2. Gradient data and engine effect, no UI.** Normalize and serialize `node.gradients`, copy on duplicate, the slider-space offset sum and clamp, the morphable predicate. Check with a headless script (`scripts/test_gradients.mjs`): sum of two gradients, clamp at both ends, base never rewritten, hold outside the ends.
- **A3. Gradient page: list, strip, snapshot, remove-first, position.** Single editor. Check on a phone viewport.
- **A4. Holds-still line and the Selected-module filter.**
- **A5. Rebase the first-slice Pitch Mutator on gradients** (§5).
- **A6. Later: Gradient to Module** (§6).

**Track B: presets**

- **B1. Variations store.** New endpoints in `server.py` and `sandbox-api.cpp` (plugin repo), catalog script change, the file format and validation, a pure-JS client wrapper. Check with the server restarted by Argi.
- **B2. Explorer UI.** Search, the 3-way switch, the one list, folders, Save, Load, Remove, Rename, confirm plus undo point. No audition yet.
- **B3. Audition and thumbnails.** The quiet handler, the shared render helper, ▶ and the test note, `info.thumb`. Measure one audition.
- **B4. Trigger Variation keyboard mode.**
- **B5. Factory variations and thumbnail pre-generation** (optional).

## 13. Files to touch

(Nothing here is MasterBot's. See §14.)

**Track A**

- `public/node-graph-patch-core.js` (normalize `gradients`, drop circuit patch fields)
- `public/node-graph-patch-serialization.js`
- `public/node-graph-live-plan-runtime.js` (the provider call sites near lines 191 and 333)
- `public/node-graph-pitch-mutator-overlay.js`, `public/pitch-mutator-engine.js` (A1, A5)
- `public/plugin-host.js` (effective-param diff)
- New: `public/node-graph-gradients.js` (model, capture, offset provider), `public/node-graph-gradient-page.js` (UI), `scripts/test_gradients.mjs`
- `public/index.html` and `public/perform.html` (script tags, panel markup) and `public/styles.css`
- `public/node-graph-module-actions.js` (bind the page on open), `public/node-graph-history.js`

**Track B**

- `server.py` (variation, patch rename and remove endpoints), `scripts/rebuild_page_patches_index.py` (skip `*__variations`, add `variations`), `scripts/prepare_page_patches.py` if it reads the folders
- `public/node-graph-patch-normalizers.js` (`info.thumb`)
- New: `public/node-graph-preset-store.js` (client wrapper), `public/node-graph-preset-explorer.js` (UI), `public/node-graph-preset-audition.js`
- `public/node-graph-render-output.js` and `public/node-graph-live-runtime.js` (the shared helper and the quiet handler, B3)
- `public/node-graph-unified-window.js`, `public/node-graph-floating-windows.js` (the `pages` registry entry points to the Explorer)
- Keyboard: `public/node-graph-view-controls.js`, `public/modules/gridKeyboard/grid-keyboard.js`, `public/node-graph-module-factories.js`, `public/modules/keyboardController/keyboard-layout-settings.js`, `public/lib/visual/piano-keys-draw.js`
- Deleted: `public/node-graph-circuit-patches.js`, `public/node-graph-pages.js`, the orphan preset block in `public/node-graph-file-actions.js`

**Other repo (not touched by me):** `soemdsp-sandbox-audioplugin/src/ui/sandbox-api.cpp` and `sandbox-api.h` (mirror the new endpoints, keep non-recursive listing out of the way).

## 14. Rules check

- **MasterBot's files:** none planned for edit: `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and any cull, present or camera code. That is why the knob is **not** redrawn with the offset in v1.
- **Events only, no timers or polling:** position and stop edits, commits, selection and confirm clearing all run on events. The audition waits on worklet messages and context completion. `plugin-host.js` has its own legacy timers, which are unchanged (the diff just reads effective params).
- **Phone-friendly, no hover tooltips:** 44 px rows, a 44 px tall strip, 28 px handles, no `title=`, no hover-only action. The info lines are plain text.
- **No dead code:** Stage 1 deletes the broom presets, Pages and the orphan localStorage presets.
- **WebGL-only for circuit-builder UIs:** the gradient page and Explorer are DOM menu panels like the paper-page panel they replace. The strip is DOM or inline SVG. No module display code is touched.
- **Parameter limits come only from parameter definitions:** the gradient clamp, variation values and Gradient to Module all use the definition's min, max and slider curve. Nothing is hardcoded and no `paramMeta` is stored in a variation.
- **MIDI boundary:** the test note is a Keyboard module signal. Trigger Variation is pointer-only.
- **Names:** Canvas and Mini Canvas where mentioned. Nothing here needs either by name.
- **Servers and app:** nothing is restarted by this plan. New endpoints need a server restart that Argi chooses to do. No server on 8765, 8080, 8090, 8081, 8082 or 8084 is touched.
- **soundemote-dev:** read-only, never edited.

## 15. Open questions for Argi

1. **Save semantics.** Is "select a preset or variation, then Save" right (§8.3), or do you want an explicit **Variation | Preset** choice on Save?
2. **Untitled patches.** A patch with no file can't hold variations (Save is disabled with one line). Is that OK, or should a session-only list exist until it is saved?
3. **Static site.** The hosted site has no write API. Should user presets and variations there fall back to browser storage (IndexedDB), or be read-only?
4. **Variation contents.** A variation holds every param value plus gradient positions, never module data (Step Graph points and so on). Should Step Graph and Smooth Graph points ride along, given the "Holds still" idea?
5. **Choices in gradients.** "Holds still" for choice params, or snap at the midpoint between stops (as Sabrina's morph does)?
6. **A one-timeout exception.** `createNodeGraphLiveWorkletNode` has a 5 s startup race (`nodeGraphLiveAwaitStartup`). Leave it as shared legacy, or add a timer-free startup path for the audition?
7. **Factory thumbnails.** Fill lazily on first audition, render the whole visible folder on open, or pre-generate once into `patches/index.json`?
8. **Knob feedback.** Should the knob itself show the gradient offset (a ring or a second marker)? It would need a module display change, so it waits for MasterBot's rewrite.
9. **Module shortcut.** A one-line `Gradients: 2` in the module's Settings that opens the page filtered to it, or nothing?
10. **After Convert to module.** Remove the gradient, or keep it with a `disabled` flag?
11. **Reframing on load.** When Load swaps in a different circuit, keep the camera (like Pages today) or reframe?
12. **Audition length and note.** Default C4 (or the keyboard's last note), 1 s hold plus a ~1.5 s tail. Tap to play, tap again to stop (recommended)? Presets with no note source: render from cold with a "no note source" line (recommended), or disable ▶?
13. **Removed params.** A ✕-removed param stays removed for later snapshots. Do you also want a "restore removed" action, or is deleting and re-snapshotting enough?
14. **Trigger Variation base key.** Default C2 (MIDI 36) on the keyboard module, variations by natural sort. Or should each variation carry its own key assignment?
15. **Gradient positions in the plugin.** A DAW-automatable position is out of scope here. Do you want it as a later slot (the plugin currently has 32 fixed parameters)?
