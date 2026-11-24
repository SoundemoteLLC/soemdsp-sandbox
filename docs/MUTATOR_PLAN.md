# Mutators — Design Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-23 |
| **Status** | Draft — design only, no code yet |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Supersedes** | `docs/KEY_PATCHER_DESIGN.md` (rev 3), `docs/FUTURE_PLANNING.md` seeds "Keytracking / pitch-tracking modulation UI" and "Dimensional parameter prototyping" |
| **Related** | `docs/APP_POLICY.md` (Pitch convention, MIDI boundary, Gate contract, VoiceManager), `docs/PARAM_SURFACES.md`, `docs/GATES_TRIGGERS.md`, `docs/SMOOTH_STEP_GRAPH_AND_KNOB_OVERHAUL_PLAN.md`, `docs/B-058_VOICE_PARAMETER_MODULATION_DIRTY_VOICES.md`, `public/node-graph-segment-curves.js` / `library/include/soemdsp/math/segment_curves.h` |

---

## 1. What a Mutator is

A **Mutator** makes a parameter's value depend on a musical axis, so that a patch can sound right across the whole keyboard or the whole velocity range.

- **Pitch Mutator**: axis = MIDI note number 0–127 (the `♯/♭` pitch convention: 69 = A4, not normalized).
- **Velocity Mutator**: axis = velocity 0–1 (the gold `Velocity` convention).
- Later: Mod Wheel, aftertouch / pressure, note age, per-note random, X/Y pads. They all share one engine and differ only in axis and face.

Each Mutator holds **lanes**. A lane is bound to one destination parameter and stores a sparse list of **keyframes** `(axis position → DOMAIN value)`. Between keyframes, the value follows a **Step Graph segment curve** (shape + skew −1..+1). At play time, the Mutator reads the current axis value from a **signal** and sets each bound parameter's base value.

The workflow Argi asked for: **play a note → tweak knobs → play another note → tweak**. Turning a mutated knob records or edits the keyframe at the note that is sounding.

---

## 2. What exists today (research summary)

| Area | Today | Consequence for Mutators |
|------|-------|--------------------------|
| Parameter definitions | `public/node-graph-module-definitions.js` and per-module `*-register.js` (`parameters: [{ key, label, min, max, mid, step, nonlinearSlider, kind, unit, choices, wraparound, hardClamp, tooltip }]`). | Lane value ranges, interpolation space (Hz → log) and discrete/hold behavior come **only** from these definitions. The Mutator never stores its own min/max. |
| Param values in patches | Stored as DOMAIN on `node.params`. Unit 0–1 is a UI map only (`PARAM_SURFACES.md`). | Keyframes store DOMAIN values. Never slider-unit positions. |
| Modulation | `patch.modulations: [{ sourceNode, sourcePort, destinationNode, destinationParam }]`. `effective = applyMod(smooth(knob), MOD)`. Native: knob → `set_param` → `Control.target` → smoother → `control_effective`. Graph-audio MOD is per-sample `ParamModEdge`. Controller MOD is cyan `set_param_mod`. | Mutators should replace the **knob** (the base), not add another MOD. That way existing MOD cables still work on top, unchanged. |
| Knob write path | `setNodeSliderValue` / `commitNodeSliderDragValue` (`node-graph-slider-dragging.js`) → `syncNodeGraphPatchParameterFromSlider` → live sync. | This is the hook for "tweak knob → record keyframe". |
| MIDI | Only `keyboardController` (catalog "MIDI") and `midiCc` (MIDI CC, saved `midiLag` migrates) touch MIDI. MIDI outputs: Play Keys (blue), Gate, Trigger, `pitch` (`♯/♭`), Frequency (`ƒ`), Velocity (gold, 0–1). | A Mutator's axis is a **plain signal input**: `♯/♭` for pitch, `Velocity` for velocity. Mutators never see MIDI. |
| Polyphony | Meta Voices / Metamodule. VoiceManager assigns notes from Play Keys cables. Each voice is a compiled replica. Interior per-voice buses: **Voice ƒ, Voice Gate, Voice Trigger, Voice Idle**. | No per-voice `♯/♭` bus and no per-voice Velocity bus exist yet. True per-voice mutation needs them (see §5). |
| Curves | `node-graph-segment-curves.js` (JS) and `segment_curves.h` (C++) are the single source for Rational / Exponential / Log / Smoothstep / Smootherstep / Hold, skew −1..+1 (`nodeGraphSegmentCurve01(p, shape, contour)`). | Lane segments reuse this exactly. No new curve math. |
| Sturmian Grid | `sturmianGrid`: Kick/Snare/Hat/Melody triggers, `♯/♭`, `ƒ`, Restart / Adv / ƒ inputs, WebGL face, Display Settings for stroke alphas. | Good audition rhythm source for the Velocity Mutator (§8). |
| Tips | Docked tips panel shows `tooltip` / `inputTooltips` / `outputTooltips`. No hover popups. | All Mutator help text goes into those fields. |
| Prior design | `KEY_PATCHER_DESIGN.md` (rev 3): DOMAIN keyframes per key, Alt/Ctrl-click grammar, writes knob values into the patch on every note, shell params only, blue Note I/O. | Keep its good parts (DOMAIN storage, sparse keys, manual include, lin/log/hold). Drop the parts that don't fit (see §12). |

---

## 3. Data model options

### Option A — Param overlay (no module)
Each parameter gets an optional `mutations: { pitch: [...], velocity: [...] }` block on the node. The axis comes from a patch-wide "pitch source".

- ✅ No extra module. The knob is the editor.
- ❌ It needs a hidden, patch-global pitch source. That conflicts with the signal-only, visibly wired model and with polyphony (which voice's pitch?).
- ❌ There's no natural place for the play/tweak face or the audition rhythm player.

### Option B — Mutator module whose lane outs are ordinary MOD cables
The Mutator outputs one DOMAIN signal per lane (`outputDomain` / REPLACE MOD), wired with normal modulation cables.

- ✅ It reuses everything (`ParamModEdge`, per-voice replicas, cables).
- ❌ REPLACE MOD fights other MOD cables on the same param. The order is ambiguous, and the knob becomes meaningless.
- ❌ It changes what MOD means for one source type. That's a new special case in a surface that is already subtle (B-082 clamping, VCA amp, etc.).

### Option C — Mutator module that sets the param's *base* (recommended)
The Mutator is a module (Pitch Mutator, Velocity Mutator). It has an **axis input jack** and a face. Each lane is bound to one `nodeId|paramKey` and is drawn as a cable from a lane outlet to the param row, with its own mark (for example a small `μ`). The engine order becomes:

```
base      = lane bound ? mutate(axis) : knob            // DOMAIN
effective = applyMod(smooth(base), MOD)                 // unchanged rule
```

- ✅ Existing MOD cables, smoothing, clamping and stickiness rules all stay as they are. The Mutator replaces only the thing the knob used to supply.
- ✅ The axis is a visible signal cable, which respects the MIDI boundary.
- ✅ It works per voice for free when the Mutator lives inside a Metamodule, because every voice replica has its own Mutator instance reading its own voice bus.
- ✅ The module has a home for each mutator's own UI.
- ❌ It needs one new native concept, a per-param mutation table (§9).
- ❌ It needs a new cable kind in the circuit builder (drawn and hit-tested like a MOD cable, stored differently).

**Recommendation: Option C.**

### Lane / keyframe schema (on the Mutator node)

```json
{
  "id": "pm-1",
  "type": "pitchMutator",
  "params": { "write": 1, "snap": 1, "viewLow": 24, "viewHigh": 96 },
  "mutator": {
    "axis": "pitch",
    "lanes": [
      {
        "id": "L1",
        "target": { "nodeId": "lp-3", "paramKey": "cutoff" },
        "space": "auto",
        "keys": [
          { "x": 36, "v": 180,  "shape": "rational", "skew": 0 },
          { "x": 60, "v": 900,  "shape": "smoothstep", "skew": 0.3 },
          { "x": 84, "v": 4200 }
        ]
      }
    ]
  }
}
```

- `x`: axis position. Pitch is a MIDI note (integer when Snap is on, fractional allowed). Velocity is 0–1.
- `v`: DOMAIN value in the target's real units. It is not clamped to the definition's min/max (same stickiness rule as typed knob values). It is hard-limited only when the definition says `hardClamp` / `constraint` / `wraparound`.
- `shape` / `skew`: describe the segment that **leaves** this key toward the next one (Step Graph convention). The last key's shape is unused.
- `space`: `auto` = interpolate in log2 for `kind: "frequency"` / Hz params, linear otherwise, and hold for `choices` / integer-step params. It can be overridden to `linear` / `log`.
- Outside the first and last keys, the value holds the end key's value. A lane with one key is a constant. A lane with zero keys is unbound, so the knob value applies.
- The lane target is the **single source of truth** for the binding. The cable is drawn from it, and deleting the cable deletes the lane (after confirmation in the docked panel, not a popup).

---

## 4. Where the axis value comes from (MIDI policy)

Only MIDI modules ingest MIDI. Mutators read **signals**:

| Mutator | Input jack | Typical wiring |
|---------|-----------|----------------|
| Pitch Mutator | `♯/♭` (white, MIDI note number) | Mono: MIDI `♯/♭` → Mutator. Poly: **Voice ♯/♭** (new per-voice bus) → Mutator inside the Metamodule. Also works from Keyboard, Sturmian Grid `♯/♭`, Arp, Pitch Quantizer, Pitch Detector. |
| Velocity Mutator | `Velocity` (gold, 0–1) | Mono: MIDI `Velocity`. Poly: **Voice Velocity** (new per-voice bus). |

Rules:
- An unwired axis falls back to the face's **audition position**: the last key or velocity tapped on the face (§7). The face is a signal UI only. It never fires VoiceManager notes or MIDI.
- The axis is read as a continuous signal, so glide and pitch bend move the value smoothly. Snap affects only where keyframes are written, not how the axis is read.
- An optional `ƒ` input on the Pitch Mutator converts Hz → note using the A440 law (`69 + 12·log2(ƒ/440)`), so a Voice ƒ wire works before Voice ♯/♭ exists. That is a stopgap. Voice ƒ includes the Metamodule's Octave / Semitones / Cents offsets, which may or may not be wanted (decision D3).

---

## 5. Polyphony

| Placement | Behavior |
|-----------|----------|
| **Inside a Metamodule, fed by Voice ♯/♭ / Voice Velocity** (recommended) | Every voice replica runs its own Mutator on its own note, so each voice gets its own cutoff, drive and so on. Keyframe data lives on the template node and is shared by all replicas (one LUT per lane, read by every voice). |
| On the root graph, fed by the MIDI `♯/♭` | One value for the whole patch, following the last or held note. Fine for mono and legato leads. Chords get the last note's timbre. |
| Root Mutator targeting a Metamodule shell-exposed param | Same as the row above: one value for all voices. Allowed, but not the poly path. |

Work needed for true per-voice mutation:
1. New interior buses **Voice ♯/♭** (`pitch`, the voice's note number before Octave/Semitone/Cents offsets) and **Voice Velocity** (0–1, latched at note-on), next to Voice ƒ / Gate / Trigger / Idle. Check first whether Voice Gate already carries velocity as its height under the Gate contract (its catalog text says 1/0).
2. A Mutator target inside a voice is a voice-local `nodeId|paramKey` (the template id), and each replica resolves it to its own node.
3. **Note-start snap**: when a voice's Trigger fires, the mutated param's smoother jumps straight to the new target instead of gliding from the previous note's value. Otherwise a reused voice audibly sweeps from the old note's cutoff. This interacts with **B-058** (voice dirty state), so fix or verify B-058 before Phase 3.

---

## 6. Capture: play → tweak → play → tweak

A Mutator has a **Write** switch (param, Off/On, default On while the face is showing).

When a bound param's knob is dragged, typed or stepped, and its Mutator has Write on:
1. Read the Mutator's current axis value `x` (live input, or the audition position). Snap it to the nearest semitone (Pitch, Snap on) or to the nearest 1/127 (Velocity).
2. If a key exists at that `x` within the snap tolerance, update its `v`. Otherwise insert a new key with the current segment-shape defaults.
3. Rebake that lane's table (§9) and push it once. Don't rewrite `node.params[key]` (the knob's stored base stays as the "unmutated" value used when the lane is cleared).
4. The knob thumb and readout show the **mutated** value at the current `x`, so what you see is what you hear. The param row gets the `μ` mark so it's clear the knob is being steered.

With Write off, the knob moves the **whole lane** up or down: in the lane's interpolation space it offsets every key by the same amount, as a trim. (Alternative: the knob is inert. See decision D2.)

Binding a param to a lane:
- From the Mutator, drag from the `+ lane` outlet onto any param row. This uses the same gesture as a MOD cable and creates the lane with one key at the current `x` holding the current knob value.
- Phone: tap `+ lane`, then tap the param row.
- Shortcut: **"Bind last touched"** in the Mutator's param band binds the last param the user moved.
- There's no auto-binding of every touched knob. Binding is always deliberate (carried over from Key Patcher).

Undo: each keyframe write is one undo step (one step per drag gesture, not per pointer move).

---

## 7. UI

Every Mutator has its own WebGL face (circuit-builder policy) and the usual LayoutA param band. All explanations go into `tooltip` / `inputTooltips` / `outputTooltips` for the docked tips panel. No hover popups. Touch targets are at least 40 px. Every gesture has a tap equivalent.

### 7.1 Pitch Mutator face

```
┌ Pitch Mutator ─────────────────────────────── ♯/♭ ●  ƒ ● ─┐
│ cutoff  ┊      ●━━━━━━━╮                          ┊        │  ← lane rows: value vs pitch
│ (lp-3)  ┊ ●━━━╯        ╰━━━━━━━━━━━━━━━●          ┊        │    dots = keys, line = curve
│ reso    ┊ ━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━┊        │    selected lane bright,
│ drive   ┊       ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┊        │    others dimmed
│         ┊                    ▼ 60 C4               ┊        │  ← playhead at live/audition pitch
│ ▌█▌█▌▐█▌█▌█▌▐█▌█▌▐█▌█▌█▌▐█▌█▌▐█▌█▌█▌▐█▌█▌▐█▌█▌█▌▐█▌█▌▐  │  ← keyboard strip (View Low..High)
│  •   •         •                       •                     │    • = any lane has a key here
└──────────────────────────────────────────────────────────────┘
 Write [On]  Snap [Semi]  View Low [C1]  View High [C7]  Bind last touched
```

- **Keyboard strip**: tap or press a key to set the audition pitch, which also emits on the audition outs (§7.3). The current axis value is highlighted. Small dots under keys show "some lane has a key here".
- **Lane rows**: one row per lane (title = param label, with the module name in the docked panel). The Y range comes from the param definition's min/max mapped through the param's **own slider map** (nonlinear / skew), so a lane looks like its knob. Values outside min/max extend the row's Y range rather than flattening at the edge (no fake clipping), and an edge arrow shows that the range was extended.
- **Edit grammar** (Step Graph's, so nothing new to learn):
  - Tap or drag a dot to select or move it. Horizontal movement is quantized to semitones when Snap is on.
  - Drag a segment vertically to change its **skew**. Long-press or double-tap the segment to cycle its **shape**.
  - Double-tap empty lane space to add a key there at the curve's current value.
  - Ctrl-click (desktop) or a two-finger tap (phone) on a dot deletes it.
  - Ctrl / Shift / Alt modifiers behave the same as the app-wide Skew control.
- **Zoom**: the View Low / High params set the visible pitch span. The face redraws continuously while zooming (no frozen display).
- Canvas / Mini Canvas: the face is a normal display tile and scales uniformly. The keyboard strip and dots follow the tile.

### 7.2 Velocity Mutator face

```
┌ Velocity Mutator ─────────────────────── Velocity ●  ▶ ● ↺ ●┐
│ attack  ┊ ●━━━━━━━━━━━━━━━━━╮                    ┊          │
│ cutoff  ┊ ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●  ┊          │  ← same lane rows, X = 0..1
│         ┊               ▼ 0.62                   ┊          │
│ 0 ▕▁▁▂▂▃▃▄▄▅▅▆▆▇▇██▕ 1        ▮ ▮ ▯ ▮ ▯ ▯ ▮ ▯ (audition)     │  ← velocity strip + rhythm
└──────────────────────────────────────────────────────────────┘
 Write [On]  Snap [1/127]  Audition [Off|Fixed|Sweep|Sturmian]  Rate  Bind last touched
```

- **Velocity strip**: a 0–1 ramp. Tap to set the audition velocity. Drag to scrub.
- **Audition** modes (all emit plain signals on the Mutator's own audition outs):
  - **Fixed**: repeat hits at the tapped velocity, at Rate. This is the "play a velocity, tweak" loop.
  - **Sweep**: hits climb from 0 to 1 and back, to hear the whole curve.
  - **Sturmian**: hit timing and velocity from a Sturmian pattern (Kick / Snare / Hat / Melody lanes map to fixed velocity tiers, or Level view gives a continuous per-hit velocity), so it sounds like a groove rather than a metronome.
- The hit indicator follows the Sturmian Grid face's binary-flash rule (filled for at least one frame, no fade).

### 7.3 Audition outputs (both Mutators)

Pitch: `Play Keys` (blue), `Gate`, `Trigger`, `♯/♭`, `ƒ`, `Velocity`. Velocity: `Gate` (height = velocity), `Trigger`, `Velocity`.

These follow the same rule as sequencer audition in `APP_POLICY.md`: the face mixes its preview note into **its own outputs**, and whatever is wired there (Meta Voices, an envelope) hears it. On a phone you can tune a patch without any MIDI hardware. The face never calls VoiceManager directly.

---

## 8. Reusing the Sturmian Grid

Two steps, smallest first:
1. **No new engine.** Add a `Velocity` output (0–1) to Sturmian Grid: the firing cell's continuous phase (what Level view shows), latched per hit. Wire Sturmian Kick → Gate and Sturmian Velocity → Velocity Mutator, and you already have rhythmic velocity audition. It's useful on its own too.
2. **Embedded audition (later).** The Velocity Mutator's Sturmian audition mode calls the same native Sturmian step code (shared helper in `library/`, no copy) with a fixed small parameter set (Rate, α, β, Steps). Its face reuses the Sturmian GLSL strip renderer in a one-row mini form.

---

## 9. Runtime and CPU

**Bake in JS, look up natively.**

- When a lane changes (key edit, bind, load), JS evaluates the lane with `nodeGraphSegmentCurve01` into a table and pushes it once (stickiness contract: push on change only):
  - Pitch: 128 entries (one per note), plus linear interpolation between entries for fractional pitch (bend / glide).
  - Velocity: 128 entries over 0–1.
  - Log-space lanes store log2(v) in the table and exponentiate on read (one `exp2` per read), so interpolation between table entries stays in the right space.
- Native gets one new export, e.g. `soemdsp_graph_set_param_mutation(handle, nodeIndex, paramIndex, tablePtr, len, flags)`, and a matching clear. In the param's `Control`, the mutation (if present) produces `target` from the axis sample before the smoother. That's the existing knob → target → smoother → effective chain with a different target producer.
- **Cost**: per mutated param, per sample, one table index plus a lerp (about 6 flops, plus `exp2` for log lanes). It runs only while the axis is moving. When the axis sample equals the last one (the common case between notes), it keeps the cached target and skips the rest. Effectively control-rate with no extra latency.
- When the axis comes from a graph audio node, the param enters the sample path (same rule as `ParamModEdge` in `PARAM_SURFACES.md`). Update `scripts/check_graph_engine_contracts.py` so a mutated param counts as "needs sample-accurate controls".
- Discrete / choice params stay ZOH: the hold lookup updates at most once per block (the existing `NATIVE_GRAPH_DISCRETE_PARAMS` rule).
- Full / live JS evaluator: same table and same lookup in `readNodeGraphLiveEffectiveParam`, so live and render agree (no dual formulas).
- The shared curve file stays the source of truth: JS bakes with the JS copy and native only reads tables, so `segment_curves.h` needs no change. If native baking is ever needed (it isn't for the MVP), use the C++ twin.

---

## 10. How it composes

| Thing | Interaction |
|-------|-------------|
| MOD cables on the same param | Unchanged: `effective = applyMod(smooth(mutatedBase), MOD)`. A pitch-mutated cutoff can still have an LFO on top. |
| PARAM OUT jack on that param | Emits the mutated base (what the knob shows). |
| Two Mutators on one param (pitch and velocity) | Not in the MVP: one lane per param. Later: lanes chain as **Pitch sets base → Velocity offsets** (a velocity lane in "offset" mode stores deltas). See decision D5. |
| Pitch-tracking params (filter `sweep` in st, Keyboard tracking knobs) | They coexist. Tracking is a fixed law. A Mutator lane can override any value tracking can't fix. |
| Metamodule expose | A Mutator inside a Metamodule can have its face exposed on the shell or Canvas like any display. Its lanes target voice-local params. |
| Perform mode / plugin controllers | A controller write to a mutated param writes a keyframe at the current note when Write is on, otherwise it trims. Same rule as the knob. |
| Bypass | A bypassed Mutator releases its lanes: params fall back to their knob values. |

---

## 11. Patch format and back-compat

- New node types `pitchMutator` and `velocityMutator`, with structured state in `node.mutator` (§3). It serializes through `serializeNodeGraphPatch` like other structured node state (e.g. Music Player playlists).
- Bindings live only in `lane.target`. There are **no** new entries in `patch.modulations`, so older builds never misread a lane as a MOD cable. An older build that opens a Mutator patch hits the normal unknown-type path and plays the knob values.
- Loading: a lane whose target node or param is missing is dropped with one warning (Key Patcher rule). Target param keys go through the same rename/alias migrations as MOD destinations (`node-graph-patch-migrations.js`).
- Choice targets store **choice names** as `v` (APP_POLICY name-based choice persistence), not indexes.
- Copying or duplicating a Mutator together with its targets remaps `lane.target.nodeId` to the copies, the same way copying remaps MOD cables. Copying the Mutator alone keeps the original targets.
- No `patch.format` bump is needed for the MVP because these are new types only.

---

## 12. What carries over from Key Patcher, and what doesn't

Kept: DOMAIN-only keyframes, sparse keys, deliberate binding (no auto-spread), lin / log / hold per param kind, "pin last touched".

Dropped:
- **Writing knob values into `node.params` on every note.** That churns undo and autosave, isn't per-voice, and can't run at audio rate. The Mutator sets the base inside the engine instead.
- **Shell-exposed-params-only poly story.** That gives one timbre for all voices. Mutators run inside the voice instead.
- **Note In / Out / Thru routing role.** Mutators have an axis input and audition outs only. They aren't note routers.
- **Alt-click snapshot / Ctrl-click edit-arm grammar.** It's replaced by "the sounding note is the edit point" and Write on/off, which is phone friendly and needs no modifier keys.

When this plan is accepted, mark `KEY_PATCHER_DESIGN.md` as superseded (a separate commit).

---

## 13. Build order

| Phase | Scope | Done when |
|-------|-------|-----------|
| **P1 — Pitch Mutator MVP (mono, JS live path)** | `pitchMutator` module, `♯/♭` input, lanes with keys and the shared curves, bake to table, JS live evaluator applies the base, knob write → keyframe (Write on/off), `μ` row mark, minimal WebGL face (keyboard strip + lane rows + dots + playhead), "Bind last touched", save/load. | Bind a filter cutoff, play C2 and set it dark, play C6 and set it bright, and notes in between morph. Patch reloads identically. |
| **P2 — Native path** | `soemdsp_graph_set_param_mutation`, `Control` target producer, sample-path rule and contract check, discrete ZOH, cache keys in `index.html` / `perform.html` (`?v=` appended). | Native and live match within float tolerance in a smoke test (`scripts/test_mutator_*.mjs`), and CPU with 8 mutated params shows no measurable change. |
| **P3 — Polyphony** | Voice ♯/♭ and Voice Velocity buses, template-shared lane tables across replicas, note-start smoother snap, B-058 verified. | A chord of C2+C6 plays two different cutoffs at once, with no sweep on voice reuse. |
| **P4 — Editing depth** | Per-segment shape and skew (Step Graph grammar), key drag and delete, view zoom, cable drawing and deletion, copy/remap, audition outs, Canvas / Mini Canvas tile. | Full play → tweak loop works on a phone with no MIDI hardware. |
| **P5 — Velocity Mutator** | `velocityMutator` with the same engine, velocity strip face, Sturmian Grid `Velocity` out, Fixed / Sweep audition, then the embedded Sturmian audition. | Tune an envelope's attack and a filter's drive over velocity while a Sturmian groove plays. |
| **P6 — Stacking and more axes** | Velocity lanes in offset mode on top of Pitch, then Mod Wheel / pressure / per-note random Mutators. | Decided after P5. |

---

## 14. Decisions for Argi

- **D1 — Data model.** Option C (Mutator module that sets the param's base, with its own cable kind) is recommended over A (per-param overlay, no module) and B (ordinary REPLACE MOD cable).
- **D2 — Knob behavior with Write off.** It trims the whole lane (recommended), or it's inert, or it edits the unmutated knob value.
- **D3 — Poly axis source.** Add Voice ♯/♭ and Voice Velocity buses (recommended), or rely on Voice ƒ → Hz-to-note conversion for now (this would include the Metamodule's Octave/Semitone/Cents offsets).
- **D4 — Interpolation space.** `auto` (log for Hz, linear otherwise, hold for choices), or always the param's own slider map (looks like "knob halfway").
- **D5 — Stacking.** One lane per param for the MVP, with Velocity-as-offset over Pitch later. Or allow several Mutators to chain on one param from day one.

## 15. Open questions (smaller)

- Does Voice Gate already carry velocity as height inside voices? (Its catalog text says 1/0.)
- Default View span for the Pitch Mutator: C1–C7 (24–96) or the whole 0–127?
- Should the `μ` mark replace the param row's normal MOD stripe, or sit next to it?
