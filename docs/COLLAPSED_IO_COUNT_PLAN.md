# Collapsed IO: drop the hidden-jack count — plan

Status: **plan only, not built.** Asked for by Argi via MasterBot on
2026-11-20. When a module's inputs/outputs are collapsed (IO view A, the
pills), the number beside each pill ("how many jacks are in here") should go.
He doesn't need to see the count.
Written by Badger from a read-only look at `HEAD` `ccd64e7b`.

## Where the count comes from

View A is set up in `public/node-graph-io-view.js` (`VIEWS.A.pills: true`).
The pill is drawn by the WebGL chrome in `public/node-graph-gl-graph.js`:

| What | Where | Role |
|---|---|---|
| `nodeGraphGlGraphIoPills(id)` | `node-graph-gl-graph.js` ~1253 | Measures each side; returns `{ x, y, count, connected }` per side. `count` = number of visible ports on that side. |
| chrome build, `pushPill(...)` | `node-graph-gl-graph.js` ~472–487 | Copies `count` into the pill and pushes a pseudo-jack (`port: "__pill"`) that gives the cutout. Comment: "its count beside it". |
| **`nodeGraphGlGraphDrawPill(batch, pill, …)`** | `node-graph-gl-graph.js` ~1369–1385 | **The only place the number is drawn:** `nodeGraphGlLinesText(batch, String(pill.count), cx + side*(r + 3*zoom), cy, …)` (11 px, weight 600, light blue). The doc comment also mentions the count. |
| `pillAt(point)` | `node-graph-io-view.js` ~160–175 | Hit test: the jack-sized square **plus** "the old strip inward of it, where the pill's count sits" (`w = pill.r * 3.4`). |
| pill pointerdown | `node-graph-io-view.js` ~198 | `pill.count === 1` → start that jack's wire directly. **Behaviour, not display: keep it.** |

There is no DOM/CSS element for the count: the `.pill` CSS rules in
`styles.css` are toolbar/status pills, unrelated. There is no patch field: the
IO view is saved in `localStorage` (`soemdsp-sandbox.ioView.v1`), not in the
patch. The strip height (`nodeGraphIoViewStripGu`, used by
`nodeGraphLayoutBShellHeightGu` in `node-graph-module-sizing.js`) is the IO
row itself and **does not reserve space for the number**, so module sizes
don't change.

## Change

1. `nodeGraphGlGraphDrawPill`: delete the `nodeGraphGlLinesText(... String(pill.count) ...)`
   block. Keep the connected dot (`nodeGraphGlLinesDot`). The pill's cutout
   (the pseudo-jack) is drawn elsewhere and is untouched, so the user still
   sees a jack-shaped hole per side, with a lit dot when a cable is
   connected. That stays the cue that the IO is collapsed. Update the doc
   comment ("a dot inside its jack cutout").
2. Fix the comments that mention the count: ~472 ("and its count beside
   it"), and the `nodeGraphGlGraphIoPills` JSDoc, which keeps `count` in the
   return value but says it is for behaviour (one-jack click), not shown.
3. Keep `count` in the data (`nodeGraphGlGraphIoPills`, `pushPill`), because
   `node-graph-io-view.js` uses `count === 1` for the one-jack shortcut.
4. Bump `?v=` for `node-graph-gl-graph.js` in `index.html` and `perform.html`
   (and for `node-graph-io-view.js` only if question 1 changes it).

## Side effects

- **Spacing / layout:** none. The number sat in the existing strip, inward of
  the cutout. Nothing measured it, and no module size changes.
- **Hit area:** `pillAt` still accepts clicks on the empty strip where the
  number was (`w = r * 3.4`). That is harmless, and it is a bigger target.
  See question 1.
- **Cables:** they still end at the pill (`nodeGraphGlGraphIoPillPoint`).
  No change.
- **Still visibly collapsed:** the cutout, the lit dot and the cables
  bundling into one point per side all remain. View B (Tab, or a pill click)
  still shows every jack.
- **One-jack sides:** they still start the wire on press. Without the "1",
  the user can't tell a one-jack pill from a many-jack pill before clicking.
  That is acceptable, since the outcome is visible at once.

## Open question for Argi

1. **Keep the wider click area where the number used to be?** Recommend
   **keep it**. It is invisible, makes the pill easier to hit, and changes
   nothing for neighbours. The alternative is to shrink the hitbox to the
   cutout only, in `pillAt`.
