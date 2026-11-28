# PASTE-13: Pitch Quantizer: rounded keys, Fretting, custom scales

Pitch Quantizer module only.

## Spec
1. **Restore rounded key look for natural (white) keys.** Only the sharps still have rounded corners; the naturals lost it. Restore it to match the sharps' style. Find the regression in the key drawing/CSS; do not redesign.
2. **New parameter: Fretting** (0-1, default 0 = current strict quantize, so existing presets don't change).
   - 0: strict hard steps (as now).
   - Rising: each step's edges become a smoothstep between neighbouring scale degrees, so a pitch sweep "sticks" on each note like a fret and glides to the next.
   - 1: no quantizing at all (output = input pitch, linear).
   - It is a remap of the pitch value only: out = lerp between hard step and input, using a smoothstep whose edge width grows with Fretting. Must be continuous and monotonic at every setting (no backwards pitch, no clicks).
   - Show the transfer curve on the module display if it already has one (event-driven redraw only).
3. **Custom scales: Scala input.** A text box (script input) where the user pastes a `.scl` scale (steps in cents or ratios, standard Scala syntax, `!` comments), plus optional `.kbm` keyboard mapping (root key, reference frequency, key-to-degree map). Quantizer snaps to those degrees; Fretting works on them too. Invalid text shows a short inline error and keeps the last valid scale. Saved in the preset. **No MTS support** (Argi rejected it).
4. Policies: no hover effects, no animations, no tooltips, shared mouse-dot cursor, params single source of truth, event-driven redraws only, buttons never resize with text, no WebGL in the Command Center.

## Done when
- Natural keys are rounded again like the sharps.
- Fretting 0 = identical to before; 0.5 = sticky glides; 1 = unquantized sweep.
- Pasting a 19-EDO or just-intonation .scl changes the snapped pitches; a .kbm moves the root.

## Testing scope
- Test only the Pitch Quantizer module files touched and their direct dependents.
- Add a small unit test for the Scala parser and for Fretting continuity/monotonicity at 0, 0.5, 1.
- Run each test once; re-run only failures.
- No full-patch or all-module testing unless Argi explicitly approves it in chat. This plan cannot pre-authorize it.
- 15-minute time box. Stop after reporting; do not start the next plan.