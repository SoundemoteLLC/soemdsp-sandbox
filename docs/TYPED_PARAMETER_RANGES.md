# Typed Parameter Maximum

Committing a numeric value above a module parameter's current maximum expands
that instance's saved maximum to the accepted value. Minimum, midpoint,
default, aliases, smoothing and other metadata stay unchanged. The value and
range form one history change and survive patch serialization/reload.

The shared `updateNodeSliderCurrentValue` path covers face editors, number-only
controls and mirrored readouts. Math expressions are parsed first; display
inverses convert shown units back to parameter units before range expansion.
Exposed Metamodule controls synchronize the underlying child and shell range.

Fixed choices, seed codes and wraparound parameters retain their existing
semantics. Resource-constrained/hard-clamped controls retain their hard limits;
a separately declared hardMax can permit expansion up to that limit. Typing
does not remove native structural limits. Automation, modulation and ordinary
slider dragging do not silently rewrite ranges. In-range edits never shrink
the maximum; editing the range explicitly in Parameter Settings still works.

Tests:

- `node scripts/test_typed_parameter_maximum.mjs`
- `node scripts/test_typed_parameter_maximum_browser.mjs`

The browser test exercises Release 1000 -> 5000, Parameter Settings, undo/redo,
expressions, invalid/cancelled edits, another module, converted units and saved
patch reload. UI-settings writes are blocked in the test browser.
