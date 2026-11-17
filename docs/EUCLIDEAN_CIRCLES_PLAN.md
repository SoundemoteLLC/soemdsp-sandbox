# Euclidean Circles: plan

Status: plan only (2026-11-17). Inspired by Sturmian Grid, but drawn as concentric
rings instead of a grid. Nothing built yet.

## Idea

A Euclidean rhythm spreads k hits as evenly as possible over n steps. It is the
same "even spacing" idea Sturmian Grid uses: a Euclidean ring is just a Sturmian
line with rational slope k/n. Each lane is a circle, hits are dots on the circle,
and a playhead hand sweeps around clockwise. Lanes with different step counts
show polyrhythms naturally as rings with different dot spacing.

## Module (working name: Euclid Circles, key `euclidCircles`)

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

## Sturmian-flavoured extras (open, pick which)

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

## Files (expected)

- graph_engine.cpp: new process function + state (copy Sturmian's clock/Adv/Restart handling, factored).
- public/modules/euclidCircles/ (register, ui, glsl, css), following sturmianGrid's layout.
- public/node-graph-module-definitions.js / module-store / execution plan / parameter metadata / efficient-product.
- Native wasm rebuild, index/perform cache tags for changed scripts only, docs/module_faces_inventory.json.

## Open questions for Argi

1. Name: "Euclid Circles", "Euclidean Rings", or something else?
2. Four fixed lanes like Sturmian, or a variable ring count?
3. Each ring has its own step length (polyrhythm), or all rings fit one bar (polymeter in time)? Or both, via a switch?
4. Which Sturmian extras: fractional hits, drift, pitch from position, coupling?
5. Edit on the face (drag rings), or sliders only?
