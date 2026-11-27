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
