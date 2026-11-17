# Comb Resonator / Comb Pluck split — plan

Status: **plan only, nothing built.** Argi approved the split and the name
"Comb Pluck" on 2026-11-17. Implement after the open questions below are settled.
Old patches: **not a concern** (no migration, no legacy jack). Argi briefly
flagged Pixel Grid + Comb Resonator patches, but none exist on disk, and he said
to drop it (2026-11-17).

## Why

Today `combResonator` is two things at once:

- an **effect** (Mono / Left / Right audio in, stereo comb out), and
- a **generator** (a `Trigger` jack).

The Trigger jack isn't a trigger. In `graph_engine.cpp`,
`process_comb_resonator` just does `g.mixMono[f] += g.mixTrigger[f]` every sample.
A held gate goes in as a DC step, so you get a thud at note-on, another at note-off,
and with + polarity and long Decay the DC piles up until it hits the ±1 clamp.
Feeding it a longer exciter (e.g. one polyBLEP triangle cycle) helps, but it
sounds flangey whenever the exciter is longer than the loop (1/f): the comb
echoes the exciter back while the exciter is still playing, and that overlap is
a comb filter on itself.

So: split it into a strict effect and a strict generator.

## 1. Comb Resonator (effect, strict)

- Inputs: `In` (Mono), `Left`, `Right`, `f` (ƒ). **Remove `Trigger`.**
- Outputs unchanged: Mono / Left / Right.
- Parameters unchanged: Frequency, Decay, Hold, Damping, Topology, Polarity, Depth, Amplitude.
- Native: drop `hasTrig` / `mixTrigger` from `process_comb_resonator`.
- Update definition `inputs`, `inputTooltips`, the metadata JSON in
  `comb_resonator.cpp`, and the comment block in `graph_engine.cpp`.
- Optional cleanup while there: the metadata JSON says Decay max 10 and
  Amplitude max 2, but the definition says 60 and 1. Parameter definitions are
  the only source of truth for limits, so the native JSON should match them, not
  override them.

## 2. Comb Pluck (generator, new module)

Key: `combPluck`, label "Comb Pluck", category next to Comb Resonator.

### Jacks
- In: `Trigger` (rising edge), `f` (ƒ, absolute Hz, same law as oscillators via `resolve_osc_hz`).
- Out: `Mono` (mono only, per Argi).
- **No audio input.** That's the effect's job.
- **No MIDI.** Trigger is a plain signal (MIDI module gate, keyboard, clock, etc.).

### Trigger
- Rising-edge latch: fire when Trigger crosses up through 0.5, re-arm when it
  drops back below (small hysteresis, e.g. 0.4). Same pattern as the Vactrol
  Retrigger / Step Register Clock latches. Latch state lives on the Node and
  persists across blocks.
- A held gate rings exactly once; note-off is silent.
- Retrigger while ringing: add a new exciter into the running loop (natural,
  like plucking a ringing string). See open question on choke.

### Exciter (the "tap")
Built in, band-limited, zero-DC, and always **shorter than the loop** so it
can't flange. Answers from Argi (2026-11-17) folded in.

**Shape** (switch), one single-cycle burst per trigger:
- **Bump**: raised-cosine (Hann) pulse. The purest "tap", with no sharp corners.
- **Triangle**: one bipolar zero-mean triangle cycle (Argi's polyBLEP-triangle
  test already sounded like a nice tap).
- **Saw**: one cycle of the DSF saw (same closed-form kernel as the DSF
  oscillator's Saw + Bright). Soft goes from sine to a sharp saw.
- **Noise**: windowed noise burst (Hann window, Fluvv or white source).
  Breathy "pff" taps and snare-ish combs.

**Soft** (0 … 1): one softness control that every shape respects:
- Bump: window power, so it goes from a gentle cos² to a narrower, punchier cosⁿ.
- Triangle: rounds the corners (band-limit tilt) toward a sine.
- Saw: DSF geometric rolloff, exactly like DSF Bright (soft = sine, hard = sharp
  saw). Nonlinear taper like Bright, with sensitivity near the soft end.
- Noise: tilts the burst from white (hard) toward dark / brown (soft).

**Width** (Argi picked width): exciter length as a fraction of the loop period
(1/f), capped below one period (about 0.05 … 0.9). Narrow gives a bright tick or
"pong", wide gives a round "pow" or thump. Because it's tied to the period, the timbre
tracks pitch. Width is latched at the trigger edge.

**Retrigger** (switch, Argi wants both):
- **Stack**: a new hit adds into the ringing loop (like re-plucking a ringing string).
- **Choke**: a new hit clears the loop first (short fade to avoid a click),
  then rings fresh.

**Velocity**: the trigger's height scales the hit (Argi: "scale"). Rising
edge detection is unchanged; the level sampled just after the edge (peak over
the first few samples) sets the hit amplitude, so a MIDI module gate carrying
velocity plays dynamics.

**Output**: mono only.

### Resonator core
Reuse the existing comb math (Thiran fractional delay, loop one-pole damping,
feedback gain from Decay) so both modules ring identically. Prefer factoring a
shared `comb_core` (header or shared functions) used by both
`comb_resonator.cpp` and a new `comb_pluck.cpp`, rather than copy-paste.

### Parameters (proposal)
| Key | Label | Notes |
|---|---|---|
| frequency | Frequency | 10–20000 Hz, mid 110 (same as Comb Resonator) |
| decay | Decay | seconds to 1/e, same law as Comb Resonator |
| damping | Damping | loop lowpass, 0 bright … 1 dark |
| invert | Polarity | + (all harmonics) / − (odd, hollow, octave down) |
| shape | Shape | Bump / Triangle / Saw / Noise |
| soft | Soft | per-shape softness (see Exciter) |
| width | Width | exciter length as a fraction of the period |
| retrigger | Retrigger | Stack / Choke |
| level | Level | output level; ring peak kept roughly constant across Frequency × Decay (impulse-normalized like Mode Resonator); trigger height scales it |

No Hold, Topology, or Depth: Hold is infinite sustain (not a pluck),
Feedforward has no ring, and Depth is feedforward-only. Those stay on the effect.

All limits live in the definition. Fill every per-control `tooltip` field. There are no hover pop-ups.

## 2b. Mode Resonator becomes strictly triggered

Argi (2026-11-17): Mode Resonator should be triggered strictly and keep its own
(pole-based, modal) sound, so its audio-input effect role goes away.

- Inputs: `Trigger` (rising edge, same latch, velocity-scaled) and `f` (ƒ).
  **Remove the audio inputs** (Mono, Left, Right).
- Gets the same built-in exciter as Comb Pluck (Shape: Bump / Triangle / Saw /
  Noise, Soft, Width relative to the period) and the same Retrigger
  switch (Stack / Choke). The exciter code is shared, not copied.
- Keeps its own resonator (poles, its own Decay / Hold / Amplitude law). That's
  what makes it sound different from Comb Pluck.
- Mono out. Gets the same hit view and live playback display.
- Native: in `process_mode_resonator`, stop summing audio and Trigger into
  the input. Feed it only the exciter output.

## 3. Displays: dial in "pongs" and "pows"

Both modules get a face display drawn in WebGL via
`public/lib/visual/gl-line-renderer.js`, pixel-for-pixel, following the usual
display settings (background color etc.).

### Comb Pluck display: "hit view"
Plots one hit over time, **computed from the math, not recorded audio**:

- **Envelope curve:** the ring's amplitude over time, `exp(-t/τ)`
  (τ = Decay), normalized by Level, starting from the exciter peak.
- **Bright vs. body:** a second, fainter curve for the top partials' decay when
  Damping > 0 (high partials lose energy faster per loop), so you can see "pow"
  (body dies fast and dark) vs. "pong" (long and bright).
- **Exciter inset:** the tap's shape and width at the left edge, so Shape, Soft and Width are visible.
- **Markers:** −20 / −40 / −60 dB ticks or a T60 marker, so you can read "how long" at a glance.
- **Time axis** auto-ranges to the decay (e.g. shows about 1.2 × T60), so short
  pows and long pongs both fill the display. Axis changes smoothly; **no clipping
  of the trace**: the curve only touches the top when the signal really peaks there.
- **Live playback (Argi wants this):** on each hit, a playhead sweeps
  left to right across the predicted curve in real time, and the actual output's
  envelope draws in behind it as it rings, so you watch the pong or pow happen
  and see how it compares to the prediction. Details:
  - The playhead starts on the trigger edge (from the engine, sample-accurate,
    reported to the UI like other live display taps) and moves at real time
    against the display's time axis.
  - The live trace is the measured peak envelope of the output (per display
    pixel column), drawn brighter than the predicted curve, with a short glow
    or fading tail behind the playhead.
  - Stack: a new hit restarts the playhead and keeps the old trace fading out
    underneath. Choke: a new hit clears the old trace.
  - Idle: the last hit stays drawn (dimmed) until the next one.
  - A Live toggle in display settings, on by default. Off shows just the
    predicted curve.
  - When the decay is longer than the display window, the playhead parks at
    the right edge with the trace still decaying, rather than the axis jumping.

### Comb Resonator display
Same decay-over-time view (envelope from Decay / Damping / Hold, with Hold
drawn as a flat line), plus optionally the comb's magnitude response
(peaks at k·f, or odd harmonics for −) since as an effect its "color" matters
as much as its tail. The response view only applies in Feedforward mode, or
as a toggle.

## 4. Files touched (expected)

- `native_modules/comb_resonator/comb_resonator.cpp`: metadata, maybe factor core
- `native_modules/comb_pluck/comb_pluck.cpp` (new)
- `native_modules/graph_engine/graph_engine.cpp`: new type id, create/destroy,
  process function, trigger latch state, drop Trigger from the comb
- `scripts/build_native_modules.ps1`, `public/native-modules-catalog.json`,
  combined wasm rebuild
- `public/node-graph-module-definitions.js`: edit `combResonator`, add `combPluck`
- JS mirrors / plan files that list modules: `node-graph-execution-plan.js`,
  `node-graph-live-plan-runtime.js`, `node-graph-efficient-product.js`,
  `node-live-audio-worklet-*` (set/clear plan, native exports, core),
  `node-graph-module-store.js`, `node-graph-module-scope-defaults.js`
- Display face file(s) and `index.html` / `perform.html` cache tags for changed scripts only
- `docs/APP_POLICY.md` module table, `docs/module_faces_inventory.json`
- Check `patches/foley/gotsound.json`, which uses the comb. Old patches aren't a
  concern, but if it's a shipped preset it should be rewired to Comb Pluck.

Coordinate with MasterBot / Misty before touching shared files
(`graph_engine.cpp`, index/perform HTML, gl-line-renderer).

## 5. Decisions and open questions

Decided 2026-11-17:
1. Exciter shapes: Bump, Triangle, Saw (DSF soft-to-sharp), Noise, each with a Soft morph.
2. Width: relative to the period.
3. Retrigger: a switch with Stack and Choke.
4. Trigger height scales the hit.
5. Mono out.
7. Displays: the hit view is fine, plus a live playback animation over time.

6. Mode Resonator: drop its effect role. It becomes a **strict triggered
   generator** with its own sound (see section 2b). No separate Mode Pluck.

No open questions left; ready to build on Argi's go.
