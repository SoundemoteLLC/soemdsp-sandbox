# Known Bugs

This is the shared list of bugs Argi has reported, kept here for every bot and his AI engine. Check this list when working in a related area. When a bug is fixed, mark it fixed (with the commit hash and date) or remove it. New bugs go at the top of the Open section.

## Open

### Text redraws during drag, pan, zoom, and wire pull

These four reports probably share a root cause: text in the GL text and label rendering rebuilds or re-renders when it shouldn't. MasterBot owns the viewport, text, and culling rendering code and is partway through a module display rewrite (`docs/MODULE_DISPLAY_REWRITE_PLAN.md`).

#### Module drag redraws text on every pixel

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** Clicking a module's title to drag it makes the text redraw before the module has even moved. After that, the text redraws on every pixel the mouse moves.
- **Notes:** Grouped with the other text-redraw reports above.

#### WASD panning leaves text blurry

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** Panning with WASD seems to make text rebuild. After panning stops, the text stays blurry for about a second.
- **Notes:** Grouped with the other text-redraw reports above.

#### Zoom then middle-mouse triggers a leftover text redraw

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** After zooming, simply pressing the middle mouse button down triggers another text redraw it doesn't need. The redraw after the zoom may not have finished, and the mouse-down completes it — or something else is going on.
- **Notes:** Grouped with the other text-redraw reports above.

#### Wire drag from Flower Child re-renders text

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** Dragging a wire out of the Flower Child filter makes text re-render. This is probably not limited to that one module.
- **Notes:** Grouped with the other text-redraw reports above.

### Deleting Viewport Out dims or hides the workspace grid

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** Deleting the Viewport Out module makes the circuit builder grid lines dim until they seem to disappear, as if Viewport Out has to exist for the workspace background to render correctly.
- **Notes:** MasterBot owns viewport and workspace rendering. See also the module display rewrite in `docs/MODULE_DISPLAY_REWRITE_PLAN.md`.

### Keyboard key color highlighting is missing or intermittent

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** Keyboard key color highlighting (blue, gold, and the other highlight colors) doesn't work, or works only sometimes, on any click, including Shift-click and Ctrl-click.
- **Notes:** None yet.

### Refresh does not save camera view or patch-view visibility

- **Reported:** 2026-11-25, by Argi
- **Symptoms:** After a refresh, the camera viewpoint isn't saved, and neither is whether patch view is visible or hidden. The view you get after a refresh isn't the centered patch view (it isn't centered on the patch), though the modules stay in view.
- **Notes:** Two related persistence misses: camera viewpoint, and patch-view visible/invisible.

## Logged earlier

These were already on the earlier bug log. Fixed items include their commit hashes.

### Music Player will not replay after a track ends — FIXED

- **Fixed in:** `7553e6e8`
- **Notes:** Previously logged 2026-11-20 (via MasterBot from Argi). The Music Player module would not replay music after it finished playing.

### Screen Glass effects render unevenly on rectangular aspects — FIXED

- **Fixed in:** `6bd82f17`
- **Notes:** Previously logged 2026-11-20 (via MasterBot from Argi). Screen Glass effects like screen fringe rendered unevenly: a rectangular aspect made horizontal edges sharper or softer than vertical ones. Likely needed aspect-correct distances so all sides match.

### MIDI Listen dropdowns

- **Status:** open
- **Notes:** Logged earlier. No detail recorded yet.

### Monitor DOM graphics

- **Status:** open
- **Notes:** Logged earlier. No detail recorded yet.

### Elan's `cursor: move` breaks the no-arrow-cursor lint

- **Status:** open, waiting on Argi's decision
- **Notes:** `cursor: move` at `styles.css` around line 12715 (`cfbaa592`) breaks the no-arrow-cursor lint (APP_POLICY §24).
