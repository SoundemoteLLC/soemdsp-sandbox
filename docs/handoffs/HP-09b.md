## HP-09b: Mutator stacked note names, plus unit 0-1
**Owner:** big AI · **Size:** S · **Depends on:** HP-09g (pushed at `17065c30`) · **Phase:** A

**Current state (do not redo).** Already in `17065c30` (d47bc6ef, ce2a5337, HP-09f, HP-09g):
- No scrollbars on the Mutator overlay; wheel, touch and view buttons still scroll.
- Cursors are the little + on hover and the little dot while pressed (no hand).
- Keys fit the 22px strip (the global button min-height no longer clips them).
- Mouse plays and drags keys and never pans; touch still drags the view; middle-mouse pan already worked (t420u) — keep it.
- Note names already use one shared helper (`nodeGraphKeyboardPitchLabel`): MIDI 0 = C-2, MIDI 60 = C3. Do not invent another convention.

**Report back.** When done, update `C:\Users\argit\Desktop\soemdsp-mutator-handoff.md`. That is the AI-to-Badger channel from now on. Put the commit hash, what changed, tests, and anything Argi must retest in that file. Do not rely on a chat message alone.

Events only. No tooltips, no `title=`, no arrow cursors.

**1. Stacked note names (t418u, still open).** The naming convention is done; the layout is not. C labels still clip into neighbouring black keys. For labeled keys, draw the octave number on top and the letter below (for example `4` over `C`), on the white key in the area below the black keys, so the label does not clip into or overlap a neighbouring black-key column. Black keys may need a shorter band with a label band underneath. Keep it phone-friendly. If the column is still too narrow at high key counts, shrink/fit the label rather than letting it overflow. Use the existing shared helper; the lowest C is C-2. Files: `public/node-graph-pitch-mutator-overlay.js`, `public/node-graph-pitch-mutator.css`. If a leftover bottom cut-off shows up while you do this, fix it; do not reopen the scrollbar / cursor / key-fit work.

**2. Unit 0-1 output (t488u).** The Mutator's `unit` output is the mixed playhead (Pitch In + Pitch knob), 0-127, mapped linearly to 0-1: `(Pitch In + knob) / 127`. It is not the bound knob's position on its own range (that was the HP-09g interpretation). MIDI 0 → 0, MIDI 127 → 1. Update the native engine, tests and any overlay copy that describes it.

**Out of scope.** Scrollbars, cursors, key fit, and the note-name convention. Gate/Freq audition and multi-lane editing (HP-12). Any GL files. Deferred: the VST lane table, `?product=full` Mutator offsets, the GL face value readout.

**Keep intact.** HP-09f key press/drag, touch drag-pan, middle-mouse pan, wheel scroll, pinch zoom, saved view.

**Acceptance (one line each).**
1. Every C label is stacked (octave over letter) and fully visible inside its key, with no overlap of a black-key rect, in the 0-127 view and the default view (lowest C reads C-2).
2. `unit` is (Pitch In + knob) / 127: MIDI 0 → 0, MIDI 60 → 60/127, MIDI 127 → 1; it does not follow the bound knob position.
`?v=` bumped for changed JS/CSS. Report which checks were headless Chrome only, in the desktop handoff file. Restart the 8766 server and Ctrl+F5 if the wasm changed.
