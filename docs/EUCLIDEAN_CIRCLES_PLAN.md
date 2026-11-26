# Euclidean Circles: plan

Status: native + browser v1 implemented (2026-11-25) in the isolated
`codex/euclidean-sequencer` worktree. Inspired by Sturmian Grid, but drawn as
concentric rings instead of a grid. Not merged into master.

## Idea

A Euclidean rhythm spreads k hits as evenly as possible over n steps. It is the
same "even spacing" idea Sturmian Grid uses: a Euclidean ring is just a Sturmian
line with rational slope k/n. Each lane is a circle, hits are dots on the circle,
and a playhead hand sweeps around clockwise. Lanes with different step counts
show polyrhythms naturally as rings with different dot spacing.

## Module: Euclidean Sequencer (key `euclideanSequencer`)

Mirrors Sturmian Grid's shape so it patches the same way:

- **Inputs:** Restart (↺), Adv (▶), ƒ. Same rules as Sturmian: a wired ƒ replaces
  Rate, and a wired Adv owns Rate and ƒ.
- **Outputs:** Kick ⎍, Snare ⎍, Hat ⎍, Melody ⎍ (one per ring), plus ♯/♭ pitch and ƒ
  for the Melody ring.
- Engine-owned clock in graph_engine, like Sturmian. The face only displays and
  edits. No MIDI.

## Per-ring parameters (×4 rings)

- **Steps** n (1–32)
- **Hits** k (0–n). The limit is defined in the parameter definitions, not clamped in draw code.
- **Rotate**: offset in steps (wraparound).
- **Accent / velocity**: optional. Trigger height for hits on the "strong" positions.

Global: Rate, Swing, Reset after (bars), Semitone Offset, Pitch Range, and Pitch
Source for the Melody ring.

## Sturmian-flavoured extras (v1: 2 and 3; 1 and 4 deferred)

1. **Fractional hits.** Let k be continuous; the ring uses a Sturmian rotation
   (slope k/n plus ρ) so between integers it morphs smoothly instead of jumping.
2. **Drift.** Like Sturmian's Drift and Bar walk, Rotate advances each loop for
   evolving variations.
3. **Pitch from position.** Melody pitch from the hit's angle around the ring or
   its index (Classic/Tile-style maps from Sturmian).
4. **Ring coupling.** Optional "ring resets ring" chaining (e.g. ring 2 advances
   only on ring 1 hits).

## Display (WebGL, pixel-for-pixel)

- Four concentric rings (outer = Kick by default, or user order). Step ticks
  sit around each ring. Hits are filled dots and rests are faint ticks.
- One playhead hand per ring (rings with different n move at the same step
  rate, so their hands drift apart). Or, optionally, a single shared hand in
  "bar" mode, where each ring spans one bar.
- A dot flashes or glows when it fires, and the glow decays in time.
- Direct edit on the face: drag a ring to rotate it, scroll or drag outward on
  a ring to change k, and click a dot to toggle a manual override (open).
- Ring colours follow the existing lane colours from Sturmian.

## Rules for the builder

- Parameter definitions are the only source of limits (e.g. Hits <= Steps is enforced in the
  definition and engine logic, not by clamps in the draw code).
- No MIDI. Pitch is a plain signal output; the inputs are signals.
- Fill in the `tooltip` fields in the definitions, with no hover pop-ups in the UI.
- The display is WebGL via `public/lib/visual/gl-line-renderer.js`, pixel-for-pixel. Rings and
  dots stay still unless a parameter changes, and hit flashes are welcome. Display scaling never
  fakes clipping.
- CRLF line endings; bump `?v=` only for changed scripts; commit only your own hunks.

## Files (expected)

- graph_engine.cpp: new process function + state (copy Sturmian's clock/Adv/Restart handling, factored).
- public/modules/euclidCircles/ (register, ui, glsl, css), following sturmianGrid's layout.
- public/node-graph-module-definitions.js / module-store / execution plan / parameter metadata / efficient-product.
- Native wasm rebuild, index/perform cache tags for changed scripts only, docs/module_faces_inventory.json.

## Decisions (Argi, 2026-11-17)

1. **Name:** "Euclidean Sequencer" (key `euclideanSequencer`).
2. **Four fixed rings**, like Sturmian Grid's four lanes.
3. **Each ring has its own step length** (polyrhythm); all rings advance at the same step rate.
4. **Extras for v1:** pitch from position (the Melody ring's ♯/♭ pitch output comes from the
   hit's position or index around the ring, using Sturmian-style Classic/Tile pitch maps, plus
   Pitch Range and Semitone Offset) and **Drift** (Rotate advances each loop for evolving
   variations, with Reset after N bars). Fractional hits and ring coupling are deferred.
5. **Editing is by dragging the rings on the display:** drag around a ring to rotate it, drag
   in or out on a ring to change its hits, and use sliders as well for exact values.

---

# Euclidean Sequencer implementation checkpoint

Branch: `codex/euclidean-sequencer`. Browser module and native engine integrated.

## Completed

- Native core in `native_modules/graph_engine/euclidean_sequencer.h`.
- Engine process dispatch: type 284 (281 was claimed by master's Spectral Warble during integration).
- Four independent lengths and hit counts, rotating patterns and per-loop Drift.
- Shared engine `gate_hit` detection for Restart / Adv. Adv overrides f / Rate.
- One-sample lane triggers; latched melody position, pitch and Hz outputs.
- Continuous internal phase per ring. External Adv advances discretely.
- Reset after is explicitly global advance events (steps), not an undefined bar.
- Work per sample is bounded: four lanes, at most one advance per sample.
- No fixed 32-step DSP ceiling; Steps/Hits are structural integer counts.
- Native type, parameter and port binding; efficient-product registration.
- Module Browser entry, 7 GU spawn width, standard parameter controls/tooltips.
- Shared WebGL2 picture-device shader face, with no private GL context or
  Canvas2D/SVG fallback. Fixed module-space backing across workspace zoom.
- Explicit native telemetry: Steps, Hits, effective Rotate, phase, hit counter,
  last hit position and elapsed hit age. No inferred UI clock or missed hits.
- Angular ring drag edits Rotate; radial drag edits Hits through shared slider
  writes/commits. Shift is fine adjustment. No wheel parameter editing.
- Rebuilt standalone graph engine and combined WASM.

## Verification performed

Temporary native WASM proof (outside the repository, not a new permanent smoke):
all n=1..128 and k=0..n produce exactly k hits, rotation preserves hit count,
unequal rings advance independently, external clock ownership, reset, 8 Hz at
48 kHz, per-ring loop drift and automatic restart pass.

The native build passes. Browser acceptance confirms shader compilation, live
per-ring telemetry, angular Rotate editing and radial Hits editing. Render
Sample produces two one-sample Kick pulses over one second at the default
8 Hz step rate / 16 Steps / 4 Hits. The existing canonical smoke reference
remains sample-exact: zero difference on all 88200 channel samples.

## Remaining

1. Architect listening/interaction acceptance before merging. Recheck that type
   284 remains unique when integrating newer master changes.
2. Decide Swing's exact clock law before adding it. Adv must own incoming timing.
3. Manual per-dot overrides, accent velocity, fractional Hits, ring coupling
   and alternate shared-bar view remain deferred, not exposed as working.

## Native slot mapping

Lane Vol 1..4: Steps; Lane Bias 1..4: Hits.
Bleed2/3/4 and Phase: lane Rotate (steps).
Frequency: Rate (Hz); LFO Amplitude: Drift (steps per ring loop).
Oversample: Reset after (steps); Offset: Semitone Offset (st).
Width: Pitch Range (st); Mode: stable Classic=0 / Position=1 enum IDs.

Output ports: Mono/Left/Right/Saw are Kick/Snare/Hat/Melody triggers;
Ramp/Square are pitch/Hz; Tri/Sine/Trisaw/Phase01 are per-ring phase taps.
Use canonical public `pitch` with the shared note-name helper, not a copied
Sturmian `Pitch` label or hardcoded octave name. Clock detection and musical
Hz conversion already call the existing shared library; no library changes.
