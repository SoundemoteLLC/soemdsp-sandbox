# soemdsp-sandbox cursors

Cursor assets for the modular WebUI live here.

**Default cursor is a tiny white +** (`--node-dot-cursor` / `--node-default-cursor` on `:root` in `styles.css`), not the OS arrow. Any surface without an explicit `cursor:` inherits that.

**Adjust, drag, and resize** use the custom mouse-dot (`--node-adjust-cursor`, which aliases `--node-slider-dot-cursor` / `slider-drag-dot.svg`). Set it only through that shared CSS variable, the `.node-adjust-cursor` class, or `nodeGraphAdjustCursor()` in `node-graph-slider-dragging.js`. Never use left-right, up-down, diagonal, or all-direction arrow cursors. `scripts/test_no_arrow_cursors.mjs` fails if those values come back.

Never use hand / finger (`pointer`) or grab-hand cursors. Allowed exceptions: `text` for typing, and the OS arrow for **module move** (`--node-module-move-cursor: default`).

**Module move** uses the OS arrow (`--node-module-move-cursor: default`) whenever a module-move surface is hovered (drag handle, title row, solid shell, empty IO-row band, parameter chrome, etc.) and while `.dsp-node.dragging`. Jacks keep the tiny +; sliders / pads / graph face keep their own cursors. Floating-window drag uses the mouse-dot (`--node-move-cursor` is an alias of `--node-adjust-cursor`).

- `slider-drag-dot.svg`: centered white dot cursor used while dragging or adjusting values, and for resize handles.

Keep cursor files small, high-contrast, and explicit about hotspot expectations in CSS.
