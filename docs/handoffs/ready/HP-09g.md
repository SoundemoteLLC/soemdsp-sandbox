## HP-09g: Mutator outputs (pitch, f, 0-1)
**Owner:** big AI · **Size:** S · **Depends on:** HP-09f (`97ba2b9d`, local, not pushed) · **Phase:** A

**Current state (do not redo).** The Pitch Mutator has **Pitch In** plus the **Pitch knob** (0-127); the playhead is the sum, clamped to the keyboard for the lookup only. Its one output today is `f` in Hz. Feedback routing is allowed (Argi t469u).

Events only. Keep it small: no new smoothing, no new controls.

**1. Three outputs (t478u).** The Pitch Mutator gets:
- `pitch`: note units, the mixed Pitch In + knob (the playhead value, same units as the Keyboard's pitch out).
- `f`: Hz, as it is today. Do not change it.
- a 0-1 output: the lane value normalized.
Port labels use the app's symbols where they exist (the pitch symbol for `pitch`). Update the native engine, worklet port map, module definition and overlay as needed; saved cables on `f` must keep working.

**2. Pitch In status text (t481u).** In the overlay's status line, show the app's pitch symbol where the word "Pitch In" appears, not the word. (The port label already uses the symbol, `84ac677a`.) Argi will say if he dislikes it.

**3. Decided, no change.**
- Mutators may bind other Mutators' knobs; feedback is allowed (t476u, t469u). Do not add blocking.
- A knob value of 0 stays as is: 0 + 0 = MIDI 0, accepted (t481u). After item 4, that note is named C-2.

**4. Note naming, app-wide (t483u).** MIDI 0 is C-2 and MIDI 60 is C3 (modern industry standard). Apply it from one shared helper to every note-name display: keyboards, Mutator, status text, and readouts. No other convention should remain.

**Acceptance (one line each).**
1. A Mutator shows `pitch`, `f` and 0-1 outputs with symbol labels; each carries its units (note, Hz, 0-1) when patched to a meter or param, and existing `f` cables still work.
2. The overlay status line uses the pitch symbol, not the word "Pitch In".
3. No code change for this item; a Mutator can still bind another Mutator's knob, and knob 0 behaves as before.
4. The lowest key reads C-2, MIDI 60 reads C3, and no other note-name convention is left anywhere.
Report which checks were headless Chrome only. Restart the 8766 server and Ctrl+F5 if the wasm changed.
