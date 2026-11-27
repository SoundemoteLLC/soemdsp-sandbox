# PASTE-8: Gradient module follow-ups

Same repo rules: work on master, commit each item separately, no push, run your own tests, no REAPER. Check git status first and leave other agents' dirty files alone.

1. Only one Gradient module per circuit (Argi t554u).
   - If a circuit already has a Gradient module, spawning or dropping another one (from the store, from the rainbow page, or by paste or duplicate) doesn't add a second. It selects the existing module and binds it to the dragged gradient instead.
   - Loading an old patch that has more than one: keep the first and drop the rest, with no crash.
   - Test: a second spawn by each route leaves exactly one module.
2. Visible drag handle on the rainbow Gradients page (Argi t554u).
   - Plain "Gradient 1" text doesn't tell anyone it can be dragged. Give each gradient row a small, clearly visible drag button, for example a grip icon, as the mouse target for dragging the Gradient module into the circuit.
   - Follow the low-clutter rules: no hover effect, no animation, no hand cursor. Use the move cursor the app already uses for dragging. The button must read as draggable on its own, without a tooltip.
   - The name text goes back to being just a label (rename stays wherever it is now).
   - Test: dragging from the button places or binds the module, and dragging the name text does nothing.

Report: the commits, and a short list for Argi to check quickly after Ctrl+F5.