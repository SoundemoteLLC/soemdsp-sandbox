# PASTE-8: Gradient module follow-ups

Same repo rules: work on master, commit each item separately, no push, run your own tests, no REAPER. Check git status first and leave other agents' dirty files alone.

1. Only one Gradient module per gradient (Argi t554u, t555u).
   - Each gradient can have at most one Gradient module bound to it. Different gradients can each have their own.
   - Spawning or dropping a module for a gradient that already has one (from the rainbow page, by paste or duplicate, or by switching a module's gradient on its face) doesn't make a second. It selects the existing module instead. Tapping a face to switch gradients skips any gradient that's already bound.
   - A plain spawn from the store binds to the first unbound gradient. If every gradient is already bound, it creates a new gradient for it.
   - Loading an old patch where two modules share a gradient: keep the first, unbind the rest (or drop them), with no crash.
   - Test: every route leaves at most one module per gradient.
2. Visible drag handle on the rainbow Gradients page (Argi t554u).
   - Plain "Gradient 1" text doesn't tell anyone it can be dragged. Give each gradient row a small, clearly visible drag button, for example a grip icon, as the mouse target for dragging the Gradient module into the circuit.
   - Follow the low-clutter rules: no hover effect, no animation, no hand cursor. Use the move cursor the app already uses for dragging. The button must read as draggable on its own, without a tooltip.
   - The name text goes back to being just a label (rename stays wherever it is now).
   - Test: dragging from the button places or binds the module, and dragging the name text does nothing.

Report: the commits, and a short list for Argi to check quickly after Ctrl+F5.