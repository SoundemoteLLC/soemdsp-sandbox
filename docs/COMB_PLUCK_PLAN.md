# Comb Resonator / Comb Pluck split — plan

Status: **built 2026-11-17** (commits 84272ea8 modules + wiring, 07cc2ed8
displays; see "6. As built" at the end). Argi approved the split and the name
"Comb Pluck" on 2026-11-17.
Mode Resonator was renamed **Mode Ping** (t367u, display label only: the
internal key `modeResonator`, the native type and `mode_resonator.cpp` keep
their names so patches still load). The family is Comb Resonator, Comb Pluck
and Mode Ping.
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
- ~~Triangle~~ / ~~Saw~~: dropped (t365s993). Only Bump, Noise and the
  later Edge really worked as taps. Shape is now Bump 0 / Noise 1 / Edge 2.
- **Noise**: windowed noise burst (Hann window, Fluvv or white source).
  Breathy "pff" taps and snare-ish combs.

**Soft** (0 … 1): one softness control that every shape respects:
- Bump: window power, so it goes from a gentle cos² to a narrower, punchier cosⁿ.
  As built (t360u): q = 4 · (qMax/4)^(1 − √Soft), qMax = (n_pts/(0.6π))², so
  Soft 0 is a spike about one sample wide (0.6 table points), a near-click,
  and Soft 1 the old gentle hump; the zero-mean step keeps it DC-free.
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
| shape | Shape | Bump / Noise / Edge |
| soft | Soft | per-shape softness (see Exciter) |
| width | Width | exciter length as a fraction of the period |
| retrigger | Retrigger | Stack / Choke |
| level | Level | output level; ring peak kept roughly constant across Frequency × Decay (impulse-normalized like Mode Ping); trigger height scales it |

No Hold, Topology, or Depth: Hold is infinite sustain (not a pluck),
Feedforward has no ring, and Depth is feedforward-only. Those stay on the effect.

All limits live in the definition. Fill every per-control `tooltip` field. There are no hover pop-ups.

## 2b. Mode Ping becomes strictly triggered

Argi (2026-11-17): Mode Ping should be triggered strictly and keep its own
(pole-based, modal) sound, so its audio-input effect role goes away.

- Inputs: `Trigger` (rising edge, same latch, velocity-scaled) and `f` (ƒ).
  **Remove the audio inputs** (Mono, Left, Right).
- Gets the same built-in exciter as Comb Pluck (Shape: Bump / Noise / Edge,
  Soft, Width relative to the period) and the same Retrigger
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
1. Exciter shapes: Bump, Noise, Edge, each with a Soft morph (Triangle and Saw
   were built, then dropped in t365s993).
2. Width: relative to the period.
3. Retrigger: a switch with Stack and Choke.
4. Trigger height scales the hit.
5. Mono out.
7. Displays: the hit view is fine, plus a live playback animation over time.

6. Mode Ping: drop its effect role. It becomes a **strict triggered
   generator** with its own sound (see section 2b). No separate Mode Pluck.

No open questions left; ready to build on Argi's go.

## 6. As built (2026-11-17)

- Shared code: `library/include/soemdsp/filter/comb_core.h` (Comb Resonator
  and Comb Pluck; Comb Resonator output is bit-identical to before over 200k
  samples) and `library/include/soemdsp/trigger/pluck_exciter.h` (trigger
  latch, exciter, Stack / Choke, face taps; Comb Pluck and Mode Ping).
- Comb Pluck = graph type 266 (`native_modules/comb_pluck/comb_pluck.cpp`),
  graph version 359. Slots: decay=timeNumerator, damping=shape,
  invert=stages, shape=waveform, soft=center, width=width, retrigger=mode,
  level=amplitude. Mode Ping adds shape / soft / width / retrigger on the
  same slots.
- Trigger: fires above 0.5, re-arms below 0.4; velocity = peak of the first
  16 samples after the edge. A velocity gate that never rises above 0.5
  never fires (the fire threshold is fixed).
- Exciter: n = round(Width x fs / f) samples (at least 3), sampled at the
  sample midpoints; zero mean by a Hann-weighted correction, peak 1. Noise is
  counter-hash noise, simulated once at the edge so the mean, peak and |E(f)|
  are exact for the samples played.
- Choke: the old ring fades over 2 ms, is cleared, then the new burst starts
  (the hit lands 2 ms after the edge). Stack adds into the ring.
- Comb Pluck Level: the first loop pass is the burst itself, so a hit peaks at
  about Level x velocity. Mode Ping: 1/|E(f)| normalization latched per
  hit (at most 64x). No clip (t365, as the combs): the old clamp11 in the
  pole loop is gone; a NaN / Inf ring resets y1 / y2 to 0 and outputs 0.
- No clip in either comb (2026-11-17, Argi: "don't let it inf but let it
  explode, the output will mute if bad things happen"). Comb Resonator's
  +/-1 clamp (which flattened tall bursts every pass in Feedback, so the
  ring seemed to damp itself) and Comb Pluck's +/-8 safety clamp are gone.
  Only guard: comb_nonfinite_reset (comb_core.h) zeroes the delay line,
  damping and Thiran state if the loop sum is NaN / Inf or too big for the
  float delay line, and that sample outputs 0.
- DC trap (2026-11-17, t360u): with + polarity in Feedback the loop writes
  y - m, m = the mean of the last D written samples (one loop period: running
  sum plus a trapezoid integral over the fractional D, linear between
  samples). A partial with period D/k has zero mean over D, so every harmonic
  passes with no pitch, gain or phase change (the trapezoid error is second
  order in k/D; a plain N-sample sum with a frac-weighted tail was first
  order: the engine tuning check read 3.2 cents worst case at 1234.5 Hz with
  it, 2.0 with the trapezoid); only the
  0 Hz loop mode is removed (DC loop gain g/2 instead of g). Chosen over a
  5-20 Hz one-pole in the loop because that shifts each partial by a
  different phase: compensated at the fundamental, the upper partials would
  still go about 275 x fc / f cents flat (12 cents at 5 Hz on 110 Hz). With
  − polarity DC already cancels every pass, so the trap is off there.
- Low Cut (t361u, Comb Pluck and Comb Resonator, slot hpfFrequency, 1 Hz to
  5 kHz in the definition): Comb Pluck = a zero-phase one-pole highpass on
  the exciter burst (forward then backward with the forward ringing past the
  end continued in closed form; the shift it makes at the two end samples is
  taken back out with edge shapes decaying at the filter's own rate, so no
  long ramp puts lows back in; then zero-mean again; identity at 1 Hz), the
  bottom edge of the burst spectrum next to Soft as the top edge.
  Comb Resonator = a one-pole highpass on the input. Both sit outside the
  loop: a variable highpass inside it would detune the partials against each
  other and shorten their decays, so Decay and tuning stay exact. Mode
  Resonator has no Low Cut (its 1/|E(f)| normalization would cancel it at f).
- Exciter table: each burst is rendered at the edge into a 2048-point table
  (one point per sample up to 2048 samples, else resampled and read back
  with linear interpolation), so zero-mean, Low Cut, peak and |E(f)| are
  exact on the samples played.
- Seed + Noise Hit (t360u, Comb Pluck and Mode Ping, slots seed and
  lfoStyle; Seed 0..16777215 in the definition): the Noise shape hashes
  index i with kSeedBase ^ Seed * kSeedMul. Noise Hit New (default) also
  xors a per-instance salt and continues the instance's counter, so every
  hit and every module differs (New with Seed 0 is the old stream exactly).
  Same drops the salt and starts at index 0, so every hit replays one burst
  and the same Seed sounds the same in any module; the hit view draws that
  burst exactly (for New it is a representative).
- Edge (t360u, Shape 4, Comb Pluck and Mode Ping): one ramp-and-drop
  cycle. The ramp rises 0 -> 1 over the first 1 - d of the burst along the
  Step Graph Rational curve (segment_curves.h segment_rational01 / JS twin
  nodeGraphSegmentRational01, one source of truth), bent by the new Curve
  knob (-1..+1, saturate slot, default 0 = straight saw); the drop falls
  1 -> 0 over the last d with a raised-cosine. Soft sets d geometrically from
  half a table point (Soft 0: the last sample is still the top, so the burst
  ends on a one-sample cliff) to half the burst (Soft 1). Then the usual
  table pipeline (zero-mean via m * hann, Low Cut, peak 1), so it is DC-free
  and over inside Width; the zero-mean step pulls the middle of the ramp
  below 0, like a saw. Soft is reused for the drop (it is the shape's
  sharpness, as for the others) and Curve is the one new control.
- Triangle / Saw dropped (t365s993): Shape is Bump 0 / Noise 1 / Edge 2 in
  both modules (definition max 2, pluck_exciter.h kShapeMax 2, Comb Pluck
  default Bump). The harmonic-series code (raw_tonal, a / K, kMaxHarmonics)
  is gone. Saved patches: validateNodeGraphPatch maps the old index when the
  saved Shape range max is >= 3 or the value is above 2 (0 Bump, 1 Triangle
  -> Bump, 2 Saw -> Edge, 3 Noise -> 1, 4 Edge -> 2) and resets the saved max
  to 2 so it migrates once; the DSP and the hit view clamp to 0..2 anyway.
- Width's cap below one period is the definition's max (0.9); the DSP does
  not clamp it again.
- Display `pluckHitFace` (`public/modules/combPluck/pluck-hit-display.js`),
  shared by all three modules. The exciter inset is a strip at the left edge
  (one period, burst at its start, shape name under it), separate from the
  time plot so it never covers the curve. The top-partial curve is the 8th
  partial (or the highest under Nyquist). Taps: __Elapsed (Phase01),
  __Peak (Saw, 20 ms release follower), __Vel (Ramp), __Hits (Square).
  Display Settings: Background / Curve / Live / Text colours, Stack fade (s),
  Live (on). Comb Resonator in Feedforward shows its magnitude response.
- Tests: `scripts/test_graph_engine.mjs` section 5a (one hit per held gate,
  velocity, hysteresis, Level, Stack / Choke, every Shape, 1/e at Decay, Mode
  strictly triggered, Comb Resonator Trigger gone; no clip: a height-10 burst
  rings at the same Decay as a quiet one, tuning within 3 cents, a runaway
  loop resets instead of going Inf).
