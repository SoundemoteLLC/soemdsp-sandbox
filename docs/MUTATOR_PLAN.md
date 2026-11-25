# Mutators — Design Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi); revised with Argi's decisions |
| **Date** | 2026-11-23 |
| **Status** | **SIGNED OFF** 2026-11-23. Design only, no code yet. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Supersedes** | `docs/KEY_PATCHER_DESIGN.md` (rev 3), `docs/FUTURE_PLANNING.md` seeds "Keytracking / pitch-tracking modulation UI" and "Dimensional parameter prototyping" |
| **Related** | `docs/APP_POLICY.md` (Pitch convention, MIDI boundary, Gate contract, VoiceManager), `docs/PARAM_SURFACES.md`, `docs/GATES_TRIGGERS.md`, `docs/SMOOTH_STEP_GRAPH_AND_KNOB_OVERHAUL_PLAN.md`, `docs/B-058_VOICE_PARAMETER_MODULATION_DIRTY_VOICES.md`, `public/node-graph-segment-curves.js` / `library/include/soemdsp/math/segment_curves.h` |

---

## 1. What a Mutator is

A **Mutator** is part of the instrument brain: it makes a patch sound right across the keyboard (and, later, other musical axes) by driving several parameters from one shared note axis. It has to be robust and integrated. **Workflow wins over flexibility.** One play-and-pin gesture works the same on every lane.

- There can be **any number of Mutators**, including **several Pitch Mutators** in one circuit (for example one per instrument).
- Each Mutator is a **normal sandbox canvas module**. The user names it and gives it a color. That **name is also its overlay tab name**; renaming the module renames the tab and the other way around, and they stay in sync.
- **One Mutator drives multiple parameters**, each in its own lane, all drawn together on one keyboard.

Two lane kinds:

1. **Frequency lane** — values are real Hz on a log axis. The Mutator emits that frequency as a real signal on **Freq Out**, which is wired into a module's **FREQUENCY** input. That input overrides the module's Frequency knob. Modules have frequency inputs, not pitch inputs.
2. **Knob lanes** — for ordinary 0–1 / normal parameters. Keyframes store **relative offsets**, as a fraction of the parameter's range in **slider space**. At play time:

   `final = clamp(base + sum of offsets)`

   Limits come **only** from the parameter definition.

The workflow: **play a note → pin → play another note → pin.** Pin Keyframe and Auto-Pin write at the sounding note.

---

## 2. What exists today (research summary)

| Area | Today | Consequence for Mutators |
|------|-------|--------------------------|
| Parameter definitions | `public/node-graph-module-definitions.js` and per-module `*-register.js` (`parameters: [{ key, label, min, max, mid, step, nonlinearSlider, kind, unit, choices, wraparound, hardClamp, ... }]`). | Definitions are the only source of ranges and clamp behavior. Knob-lane offsets are fractions of that slider-space range. The Mutator does not store its own min/max. |
| Param values in patches | Stored as DOMAIN on `node.params`. Unit 0–1 is a UI map only (`PARAM_SURFACES.md`). | The knob's stored `base` stays in DOMAIN as today. Knob-lane keyframes store **slider-space offsets**, not DOMAIN. The Frequency lane stores **Hz**. |
| Modulation | `patch.modulations: [{ sourceNode, sourcePort, destinationNode, destinationParam }]`. `effective = applyMod(smooth(knob), MOD)`. Native: knob → `set_param` → `Control.target` → smoother → `control_effective`. Graph-audio MOD is per-sample `ParamModEdge`. | Knob bindings are **not cables** and must not go in `patch.modulations`. Existing MOD cables still run on top of `final`. Frequency is a normal **Freq Out** wire into a FREQUENCY input, which already overrides the Frequency knob. Any other custom wiring stays on the canvas. |
| Knob write path | `setNodeSliderValue` / `commitNodeSliderDragValue` (`node-graph-slider-dragging.js`) → `syncNodeGraphPatchParameterFromSlider` → live sync. | This is the hook for play-to-pin, for arm-and-turn binding, and for shifting a whole lane when a bound knob is turned without pinning. |
| MIDI | Only `keyboardController` (catalog "MIDI") and `midiCc` (MIDI CC, saved `midiLag` migrates) touch MIDI. MIDI outputs: Play Keys (blue), Gate, Trigger, `pitch` (`♯/♭`), Frequency (`ƒ`), Velocity (gold, 0–1). | Mutators **never see MIDI**. They read and write **plain signals**: Gate in/out, Freq in/out, Velocity. See §4. |
| Polyphony | Meta Voices / Metamodule. VoiceManager assigns notes from Play Keys cables. Each voice is a compiled replica. Interior per-voice buses: **Voice ƒ, Voice Gate, Voice Trigger, Voice Idle**. | A Mutator inside a Metamodule, with Freq In from **Voice ƒ**, naturally runs per voice. See §5 and B-058. |
| Curves | `node-graph-segment-curves.js` (JS) and `segment_curves.h` (C++) are the single source for Rational / Exponential / Log / Smoothstep / Smootherstep / Hold, skew −1..+1 (`nodeGraphSegmentCurve01(p, shape, contour)`). | Lane segments reuse this exactly. No new curve math. |
| Prior design | `KEY_PATCHER_DESIGN.md` (rev 3): DOMAIN keyframes per key, Alt/Ctrl-click grammar, writes knob values into the patch on every note, shell params only, blue Note I/O. | Keep sparse keys, deliberate binding, Step Graph curves. Drop the rest (see §11). |

Sandbox policy: **no hover text or tooltips anywhere.** Mutator labels, chips, and buttons stand on their own. Do not add `tooltip` / `title` / `inputTooltips` / `outputTooltips` for Mutators.

---

## 3. Data model

Each Mutator is a canvas module (`pitchMutator` for the first slice; more types can share the same engine later) with a user-visible **name** and **color**.

**Jacks (real signals, ordinary cables):** Gate in, Gate out, Freq in, Freq out, Velocity. Custom graph wiring on top of that is done on the canvas as usual.

**Knob bindings are not cables.** They are stored only on the Mutator (`lane.target`). In the circuit they show as **colored rings** on the bound knobs, in that Mutator's color, and as **binding chips** in the overlay.

### Frequency lane

- Keyframes: `(note axis x → Hz)`.
- Drawn and interpolated **log in real Hz** (this is a wire, not a knob). The bake table stores log2(Hz) and exponentiates on read, so interpolation between notes stays in log frequency.
- At play time the looked-up Hz is written to **Freq Out** as a real signal. Wire Freq Out to a module's FREQUENCY input to override that module's Frequency knob.

### Knob lanes

- One lane per bound parameter (`target: { nodeId, paramKey }`).
- Keyframes: `(note axis x → offset)`, where `offset` is a **fraction of the parameter's range in slider space** (the knob's 0–1 position). Interpolation between keys is **linear in that slider space**.
- Several Mutators may bind the same knob. Their offsets **sum**:

  `finalSlider = clamp(baseSlider + sum of offsets)`

  Then the knob's **own slider curve** (`nonlinearSlider` / mid / skew in the parameter definition) maps that 0–1 position to DOMAIN. The Mutator never stores the curve. `clamp` uses only the parameter definition (including `hardClamp` / `constraint` / `wraparound` as those flags already mean).
- `base` is the knob's ordinary stored value, read as its current slider-space position.
- Discrete or choice parameters **hold / snap**. They do not slide between keys; the held value updates at the next key (ZOH).

### Range changes

Do the simple thing. Offsets stay as fractions of the **current** slider-space range. If a parameter's min/max changes, the sounding mutated values just shift, and that is acceptable. The same trade applies if the knob's slider curve changes later: the Mutator still plays the same 0–1 positions, and the new curve maps them to values. Smart range or curve migration is a maybe-never later step.

### Lane / keyframe schema (on the Mutator node)

```json
{
  "id": "pm-1",
  "type": "pitchMutator",
  "name": "Lead",
  "color": "#c45a7a",
  "mutator": {
    "freqLane": {
      "keys": [
        { "x": 36, "hz": 65.41, "shape": "rational", "skew": 0 },
        { "x": 60, "hz": 261.63, "shape": "smoothstep", "skew": 0.3 },
        { "x": 84, "hz": 1046.5 }
      ]
    },
    "lanes": [
      {
        "id": "L1",
        "target": { "nodeId": "lp-3", "paramKey": "cutoff" },
        "keys": [
          { "x": 36, "offset": -0.15, "shape": "rational", "skew": 0 },
          { "x": 60, "offset": 0.25 }
        ]
      }
    ]
  }
}
```

- `x`: position on the shared note axis (MIDI note number under the `♯/♭` convention: 69 = A4). Integer when Snap is on; fractional allowed so glide and bend still have a place on the curve.
- `hz`: Frequency-lane value in real Hz.
- `offset`: knob-lane value, fraction of slider-space range. Lanes interpolate this linearly in slider space.
- `shape` / `skew`: the Step Graph segment that **leaves** this key toward the next one. The last key's shape is unused. Frequency-lane shapes are applied in log Hz; knob-lane shapes are applied in slider space.
- Outside the first and last keys, the value holds the end key. A lane with one key is constant. A Frequency lane with zero keys leaves Freq Out unset (no override). A knob lane with zero keys contributes a zero offset.
- Discrete or choice params hold / snap: store the held slider position or the choice, and do not interpolate between keys.

---

## 4. Where the axis value comes from (MIDI policy)

Only MIDI modules ingest MIDI. Mutators read **signals**.

| Jack | Role |
|------|------|
| **Freq In** | Sounding frequency as a real Hz signal (MIDI `ƒ`, Keyboard, Voice ƒ, Sturmian Grid `ƒ`, Arp, Pitch Quantizer, Pitch Detector, and so on). The overlay playhead converts it to a note with the A440 law (`69 + 12·log2(ƒ/440)`) so pin and display sit on the keyboard. |
| **Freq Out** | Mutated frequency in Hz, from the Frequency lane. |
| **Gate In / Gate Out** | Note activity. Pass-through or Mutator-generated audition gates; never a hidden MIDI path. |
| **Velocity** | Plain 0–1 velocity signal (used more in later slices). |

Rules:
- Mutators never see MIDI and never call VoiceManager.
- An unwired Freq In falls back to the overlay's **audition position** (the last key tapped on the keyboard strip). The overlay is a signal UI only.
- The axis is read as a continuous signal, so glide and pitch bend move the playhead and the looked-up values smoothly. Snap affects only where keyframes are written, not how the axis is read.
- Voice ƒ already includes a Metamodule's Octave / Semitone / Cents offsets. That is the natural poly Freq In. There is no separate pitch input on the Mutator.

---

## 5. Polyphony

| Placement | Behavior |
|-----------|----------|
| **Inside a Metamodule, Freq In from Voice ƒ** | Every voice replica runs its own Mutator on its own frequency, so each voice gets its own Freq Out and knob offsets. Keyframe data lives on the template node and is shared by all replicas (**one 128-entry LUT per lane**, read by every voice). |
| On the root graph, Freq In from a mono `ƒ` | One value for the whole patch, following the last or held note. Fine for mono and legato leads. Chords get the last note's timbre. |
| Root Mutator targeting a param inside a Metamodule | Same as the row above: one value for all voices. Allowed, but not the poly path. |

Work needed for true per-voice mutation:
1. Wire Freq In to **Voice ƒ** (already exists). Later, a **Voice Velocity** bus (0–1, latched at note-on) next to Voice ƒ / Gate / Trigger / Idle, if a Velocity lane or Velocity Mutator needs it. Check first whether Voice Gate already carries velocity as its height under the Gate contract (its catalog text says 1/0).
2. A knob-lane target inside a voice is a voice-local `nodeId|paramKey` (the template id); each replica resolves it to its own node.
3. **Note-start snap**: when a voice's Trigger fires, the mutated param's smoother jumps straight to the new target instead of gliding from the previous note's value. Otherwise a reused voice audibly sweeps from the old note's cutoff. This interacts with **B-058** (voice dirty state), so fix or verify B-058 before the polyphony slice.

---

## 6. Capture: play, pin, play, pin

**Pin Keyframe** writes (or updates) a key on the active lane at the **sounding note**. **Auto-Pin** does the same whenever the bound control is edited while a note is sounding. This one gesture is used on every lane, Frequency and knob alike.

When a pin happens:
1. Read the current axis `x` from Freq In (or the audition key). Snap it to the nearest semitone when Snap is on.
2. If a key exists at that `x` within the snap tolerance, update its `hz` or `offset`. Otherwise insert a new key with the current segment-shape defaults.
3. For a knob lane, the offset is whatever delta takes the current knob `base` to the value the user just set, as a fraction of slider-space range.
4. Rebake that lane's table (§8) and push it once. Do not rewrite `node.params[key]` (the knob `base` stays put).
5. Bound knobs show the **sounding final** value (`base + sum of offsets`), so what you see is what you hear. The Mutator's colored ring marks the binding.

Turning a bound knob **without** pinning **shifts the whole lane**: the same slider-space delta is added to every key's offset (and clamped per the definition). This does not rewrite `base`. There is no third path that edits the unmutated knob value from a bound turn.

**Binding** is deliberate (no auto-bind of every touched knob). **Arm the Mutator, then turn knobs to bind them.** Arming is a control in the overlay (a no-modifier, phone-friendly toggle). There is no right-click "Add to Mutator" flow. Once bound, a chip appears in the overlay and a ring in the Mutator's color appears on the knob. With the Mutator armed, turning an already-bound knob follows the pin / shift-whole-lane rules above, and does not re-bind it.

Undo: each pin is one undo step (one step per drag gesture, not per pointer move).

---

## 7. UI

The editor is a **horizontal docked overlay**, not a vertical Command Center page and not a packed module face.

- The Command Center gets a **Mutators** menu that **toggles the overlay on and off**, the same way the mini canvas toggle works.
- **Tabs** along the overlay, one per Mutator, labeled with the module's name. Selecting a tab shows that Mutator only.
- A Mutator's view shows **all of its lanes together** on **one shared keyboard / note axis**, so the relationships between parameters are visible (frequency on a log Hz scale, knob lanes as offset curves against the same keys).
- **Edit one lane at a time.** The active lane is drawn at full strength; the others are drawn faint.
- **Pin Keyframe** and **Auto-Pin** live in the overlay, next to the keyboard. Tapping a key sets the audition note (and, if Freq In is unwired, the playhead).
- **Binding chips** in the overlay list the bound knobs. **Colored rings** on the canvas knobs use the Mutator's color.
- **Arm** lives in the overlay. With the Mutator armed, turning a canvas knob binds it.
- A dedicated **Mutator inspection view**, in the same spirit as the debug menu, lets you see ownership on the circuit: each Mutator **paints a box** around everything it controls, in its color and/or with numbers. This works **alongside** the knob rings (rings stay; boxes show the grouping). It is a circuit overlay, not a replacement for the horizontal editor.
- **No hover text, no tooltips, no `title=` attributes.** Labels, chips, and buttons name themselves.

The canvas module is still a normal module: name, color, and the signal jacks. It is not the place where lanes are sculpted.

---

## 8. Runtime and CPU

**Bake in JS, look up natively.**

- When a lane changes (pin, bind, load), JS evaluates it with `nodeGraphSegmentCurve01` into a table and pushes it once (stickiness contract: push on change only):
  - Every lane: **128 entries**, one per MIDI note, plus linear interpolation between entries for fractional pitch (bend / glide).
  - The Frequency lane's table is **log2(Hz)**; readback exponentiates with one `exp2`. Interpolation between table entries stays in log frequency. Freq Out is always real Hz.
  - Knob-lane tables store **slider-space offsets** and interpolate them **linearly**. At play time: `finalSlider = clamp(baseSlider + sum of tables)` across Mutators bound to that param, then the knob's own slider curve maps that 0–1 position to DOMAIN.
- Frequency is a normal signal on Freq Out (graph audio / control, same as any `ƒ` wire). Knob offsets need one new native hook, e.g. `soemdsp_graph_set_param_mutation(...)` (name can match the offset table). In the param's `Control`, the summed offset is applied to `base` to produce `target` before the smoother. Then `effective = applyMod(smooth(final), MOD)` as today.
- **Cost**: per mutated knob, per sample, one table index plus a lerp (about 6 flops, plus `exp2` for a log frequency lane). It runs only while the axis is moving. When the axis sample equals the last one (the common case between notes), it keeps the cached target and skips the rest. Effectively control-rate with no extra latency.
- When Freq In comes from a graph audio node, Freq Out and any sample-accurate mutated params enter the sample path (same rule as `ParamModEdge` in `PARAM_SURFACES.md`). Update `scripts/check_graph_engine_contracts.py` so a mutated param counts as "needs sample-accurate controls".
- Discrete / choice params stay ZOH / hold-snap: the hold lookup updates at most once per block (the existing `NATIVE_GRAPH_DISCRETE_PARAMS` rule).
- Full / live JS evaluator: the same tables and the same lookup in `readNodeGraphLiveEffectiveParam`, so live and render agree (no dual formulas).
- The shared curve file stays the source of truth: JS bakes with the JS copy and native only reads tables, so `segment_curves.h` needs no change for the first slices.

---

## 9. How it composes

| Thing | Interaction |
|-------|-------------|
| Several Mutators on one knob | Offsets **sum**, then clamp per the definition. Each bound knob keeps its rings. The Mutator inspection view (like the debug menu) paints a box around everything each Mutator controls, in that Mutator's color and/or with numbers. |
| MOD cables on the same param | Unchanged: `effective = applyMod(smooth(final), MOD)`. A mutated cutoff can still have an LFO on top. That wiring is ordinary canvas cabling. |
| FREQUENCY inputs | Freq Out is a normal `ƒ` signal. The destination's FREQUENCY input already overrides its Frequency knob. |
| PARAM OUT jack on a mutated knob | Emits `final` (what the knob shows). |
| Pitch-tracking params (filter `sweep` in st, Keyboard tracking knobs) | They coexist. Tracking is a fixed law. A Mutator lane can add what tracking can't. |
| Metamodule expose | A Mutator inside a Metamodule is a normal interior module. Its face is not the editor; the overlay still is. Lanes target voice-local params. |
| Perform mode / plugin controllers | A controller write to a bound knob pins at the sounding note when Auto-Pin is on; otherwise it shifts the whole lane. |
| Bypass | A bypassed Mutator releases its knob offsets and does not drive Freq Out. Params fall back to `base`. |

---

## 10. Patch format and back-compat

- New node type `pitchMutator`, with structured state in `node.mutator` plus the module **name** and **color**. It serializes through `serializeNodeGraphPatch` like other structured node state (e.g. Music Player playlists).
- Knob bindings live only in `lane.target`. There are **no** new entries in `patch.modulations`, so older builds never misread a binding as a MOD cable. An older build that opens a Mutator patch hits the normal unknown-type path and plays the knob `base` values.
- Loading: a lane whose target node or param is missing is dropped with one warning (Key Patcher rule). Target param keys go through the same rename/alias migrations as MOD destinations (`node-graph-patch-migrations.js`).
- If a target definition's range has changed since the patch was saved, keep the stored offsets as-is (§3, Range changes).
- Copying or duplicating a Mutator together with its targets remaps `lane.target.nodeId` to the copies, the same way copying remaps MOD cables. Copying the Mutator alone keeps the original targets.
- No `patch.format` bump is needed for the first slice, because these are new types only.

---

## 11. What carries over from Key Patcher, and what doesn't

Kept: sparse keys, deliberate binding (no auto-spread of every touched knob), Step Graph segment curves, play-to-pin at the sounding note, "the sounding note is the edit point."

Dropped:
- **Writing knob values into `node.params` on every note.** That churns undo and autosave, isn't per-voice, and can't run at audio rate. Knob lanes store offsets; the engine applies them.
- **DOMAIN-valued knob keyframes.** Offsets are slider-space fractions. Only the Frequency lane stores a real unit (Hz).
- **Binding cables / a new cable kind.** Rings and chips instead.
- **Shell-exposed-params-only poly story.** Mutators run inside the voice instead.
- **Note In / Out / Thru routing role.** Mutators have Gate / Freq / Velocity jacks and are not note routers.
- **A vertical Command Center editor, or a packed module-face editor.** The editor is the horizontal overlay.
- **Alt-click snapshot / Ctrl-click edit-arm grammar.** Replaced by Pin Keyframe and Auto-Pin, which are phone friendly and need no modifier keys.
- **Hover text and tooltip fields** as the help surface. Labels stand on their own.

When this plan is accepted in code, mark `KEY_PATCHER_DESIGN.md` as superseded (a separate commit).

---

## 12. Build order

### First slice

One **named** Pitch Mutator module, **Freq Out**, **one knob lane**, the **horizontal overlay**, and the **Command Center Mutators toggle**.

Done when: you can name the module (the tab follows), wire Freq Out into a FREQUENCY input, bind one knob, pin a low note and a high note on both the frequency lane and the knob lane, and hear the values morph in between. The overlay shows both lanes on one keyboard, with only the active lane bright. The keyboard and lanes are one dense chromatic UI: graph above, equal-width note columns below, spanning MIDI 0–127, with a visible-key zoom (default C0–C8, so more of the range is on screen) and shared horizontal scroll/pan so every note can be pinned and played. The overlay is compact and DPR-sharp: slim keys, small crisp text, and hairline column marks. The patch reloads identically, including the saved view.

### Later (not the first slice)

| Phase | Scope | Done when |
|-------|-------|-----------|
| **Native path** | Offset-table hook on `Control`, Freq Out in the native graph, sample-path rule and contract check, discrete ZOH, cache keys in `index.html` / `perform.html` (`?v=` appended). | Native and live match within float tolerance in a smoke test (`scripts/test_mutator_*.mjs`), and CPU with 8 mutated params shows no measurable change. |
| **Polyphony** | Freq In from Voice ƒ inside a Metamodule, template-shared lane tables across replicas, note-start smoother snap, B-058 verified. | A chord of C2+C6 plays two different cutoffs and two frequencies at once, with no sweep on voice reuse. |
| **Editing depth** | Several knob lanes, per-segment shape and skew, key drag and delete, rings and chips polished, the Mutator inspection view (colored/numbered boxes around controlled modules), copy/remap, audition from the overlay keyboard via Gate / Freq outs, more than one Mutator in a patch. (Visible-key zoom over MIDI 0–127, and the equal-width graph-plus-keyboard axis, are already in the first slice.) | Full play-and-pin loop, including on a phone with no MIDI hardware. Ownership boxes are visible when several Mutators share the circuit. |
| **More axes** | Velocity and other axes, only after the Pitch Mutator workflow is solid. | Decided then. |

---

## 13. Ideas (reference only)

Ingested from a Gemini "Brain / Mutators / Gradients" spec. **Not adopted** unless a decision in this document already says so.

- **Bias 0–1** on a lane or Mutator.
- **Block-rate, single-pass terminal gradients.**
- A **sculpting lock** while a lane is being edited.
- **Discrete parameters flipping at thresholds** rather than interpolating.
- A **Velocity Mutator** with a PLAIN / STURM pad, and trigger / gate height equal to velocity.
- **Concentric rings** when several Mutators bind the same knob (the sum of offsets is adopted; rings plus the inspection-view boxes are the adopted display, not concentric rings).

Related leftover from earlier drafts, also not adopted here: embedding a Sturmian Grid as the Velocity Mutator's audition player; a packed WebGL lane-row face on the module itself.

---

## 14. Implementation checks

These are not design blockers. The plan is signed off.

- Does Voice Gate already carry velocity as height inside voices? **No (checked 2026-11-25, HP-09, by reading the code, not by running a Metamodule in a browser).** `GATES_TRIGGERS.md` section 2 says velocity is the height of a Gate, and the Keyboard module does that on its own Gate out (`out = on ? velocity : 0`). The per-voice buses are different: `public/node-live-audio-worklet-native-graph.js`, the Metamodule bus feeder loop (~5440 to 5485), pushes `value = (gateOn || (wantsTrig && slotTriggerPulse(v))) ? 1 : 0` into each Voice Gate / Voice Trigger feeder, so Voice Gate is exactly 1 or 0 whatever the key velocity. VoiceManager voices do not hand the feeder a velocity. A Velocity lane or Velocity Mutator inside a Metamodule therefore needs the Voice Velocity bus described in section 5 (0 to 1, latched at note-on) or Voice Gate changed to carry velocity as its height under the Gate contract. Not built; no Velocity lane in the first slice.
- Keyboard span **decided as the full 0–127 MIDI range** with a **visible-key zoom** (default view **C0–C8**, showing more of the range; C1–C7 and 0–127 are presets). Horizontal scroll or pan reaches every note; the lanes share that axis, zoom, and scroll. The view is stored on the Mutator. (Argi, 2026-11-23.)
- Graph and keyboard are **one chromatic UI**: graph above, keyboard strip directly below, **equal-width columns** for every MIDI note (black keys are dark in the same row, not a piano layout). Each note column lines up with that note’s x-position in the lane. Faint column lines mark the black-key notes on the graph. (Argi, 2026-11-23.)
- The overlay is **dense and sharp** without WebGL: narrow equal key columns, a slim keyboard strip, compact labeled controls, small crisp text, and DPR-aware hairlines so more of the MIDI range fits in a smaller dock. (Argi, 2026-11-23.)
