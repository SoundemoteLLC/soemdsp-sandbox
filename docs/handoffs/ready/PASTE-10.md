# PASTE-10: stable release pass (bugs only, no new features)

Date: 2026-11-27. Goal: a stable release. Fix what's below in order, commit each item separately, skip anything that's already done, and don't push. Check `docs/KNOWN_BUGS.md` first. Log new bugs at the top of Open, and mark fixed bugs with the commit hash and date.

Rules: no setInterval or polling, no hover text or tooltips, no arrow cursors (`docs/APP_POLICY.md` §24), no WebGL in the Command Center (§26), audio only while playing. Stay off the Mix and Stereo Mix files. Stage only your own files, merge (never rebase), and use your own test port. Never restart Argi's servers.

## Blockers

1. **Boot timing (silent patch data loss).** The page reports "ready" before the `data-boot-defer` scripts have loaded, so a patch loaded right then can lose modules (seen with Analog Distortion). Make "ready" mean ready: patch load and module spawn wait until every deferred script that registers module types has run, using an event or promise, not polling. Test it: load a factory patch at the earliest moment on a throttled CPU (Playwright CPU throttling), and every module must survive.
2. **Green test suite.** Run one browser at a time on a quiet machine. Fix each failure or triage it:
   - **Spectral Warp** (control row layout) and **Spectrum Circle** (missing `spectrumDbFloor` settings field). Fix the code if the face regressed, or update the test if it's stale. Say which one you did.
   - **`test_graph_overhaul`** errors on load. Find out why and fix it.
   - **`test_no_arrow_cursors`**: replace the 9 arrow cursors in `styles.css` with the shared mouse dot per §24. **Leave Elan's `cursor: move` (around line 12715) alone**. Argi decides on that one separately. If the test flags it, exempt that one line with a comment pointing to this note.
   - **Sturmian rows, t-display collapse, paused display plate:** fix them if they're real regressions, or update the tests if they're stale. Say which.

## Should fix if cheap

3. **Deleting Viewport Out dims the workspace grid.** Try once more with a direct repro: add Viewport In and Viewport Out, delete Out, and compare the grid. If you can't reproduce it, leave it in KNOWN_BUGS as a known issue and move on.
4. **Debug module-chain line in the G window overflows at phone width.** Let it wrap or clip to the window width. It's debug-only, so keep the fix small.

## Leave open, Argi checks by eye

- Blur after a WASD pan, and the text redraw when you zoom then press the middle button. The probes are clean. Don't change code for these unless you find a clear cause. Leave both open in KNOWN_BUGS for Argi's visual check.

## Final smoke

5. Full suite (one browser at a time). Load every factory patch, then save, load and clone each one. Spawn every store module. Check phone width on 🌈, the Mutator page, 🧩 and G. Then report a ranked list of anything that's not fixed.

## Report back

For each item, the commit and what changed (fixed code or updated test), plus the final suite result and anything still open. Give Argi a short Ctrl+F5 checklist that includes the WASD-pan and zoom-plus-middle-button visual checks.

## Step 0, TOP PRIORITY (Argi, newest; do this before everything above)

Two regressions reported by Argi on current master. Both are release blockers.

1. **Middle mouse no longer pans or zooms the workspace.** WASDQE still works. Suspects: `167b8490` (title actions now require the left button), the PASTE-9 A3 change (zoom then middle-press text redraw), or the PASTE-9 merge of `bugfix/text-keyboard`. Bisect if it isn't obvious. Fix it without undoing the title right-click fix or the A2/A3 text fixes.
2. **No module can be dragged in.** That covers the module store (MIDI modules and every other kind) and probably the 🌈 and Mutator drag grips too. Suspects: PASTE-8 (`fe0da7dc` store change, `3151be00` grips, `89bda771`) or the same pointer and button change as item 1. Fix it so every store module, gradient and mutator drag-in works again.

For both: add a browser regression test (middle-drag pans, middle-drag plus wheel or the usual zoom gesture zooms, and dragging a module from the store places it, including a MIDI module and a gradient from 🌈). Commit them separately. The final smoke check must cover both.

## STEP 0: input blockers (Argi, newest, do these FIRST; release blockers)

Argi reports these on current master after PASTE-9. They probably come from one shared regression in the pointer and gesture path, from the text-gesture work (`82380fa0`, `fdfda54f`, `7b79bcda`) or `167b8490` (titles left-button only). Find the cause with `git bisect` or by reading those diffs; don't guess.

1. **Middle mouse no longer pans or zooms the workspace.** WASDQE still works.
2. **No module can be dragged in** from the store, the 🌈 Gradients page or the Mutator page (MIDI modules included).
3. **Snake select can't select a wire.**

For each one: fix it, add a browser test that does the real gesture (middle-drag pans, middle plus wheel or zoom gesture zooms, drag-in spawns a module where it's dropped, snake select selects a crossed wire), and confirm the PASTE-9 text fixes still hold (zero text rebuilds during drag and pan). Commit each one separately. Then do the rest of this paste.

### Step 0 leads from Moth (read from the diffs, nothing was run)

- **Strongest suspect: `fdfda54f`** (`node-graph-gl-graph.js`, `node-graph-wires.js`). Check:
  - (a) the new `if (state.wireDragging || state.portMovePointer) return;` in the document pointermove in `node-graph-wires.js`. A stale flag left set would freeze later gestures and snake select.
  - (b) `nodeGraphGridKeyboardGlPointerDown` runs before the shared plate and title hit test, and it calls preventDefault, stopPropagation and setPointerCapture. It must return false for non-keyboard hits.
  - (c) `drawNodeGraphWires({gesture:true})` and `nodeGraphGlGraphPresent({retainPlates})` skip rebuilds during gestures. Check that hit rects don't go stale.
- **`167b8490`:** unlikely to be the main cause, but the title branch of `nodeGraphGlHitPointerDown` (around line 6200) returns early on a non-left button, which swallows a middle press on a title. Let it fall through to pan instead of returning.
- Bisect `82380fa0^`..HEAD on the three repros. All three dying together points to one shared pointerdown or pointermove early return. The three are already logged in `docs/KNOWN_BUGS.md`; update that entry when they're fixed.
