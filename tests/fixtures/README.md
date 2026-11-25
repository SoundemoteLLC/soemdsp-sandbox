# Test fixtures

## view-real-guitar-pluck.json

Used by `scripts/perf_view_real.mjs` (Stage 0 of `docs/MODULE_DISPLAY_REWRITE_PLAN.md`).

This is a byte-for-byte copy of `patches/game/guitar pluck.json` (21 modules, with Viewport In/Out, Screen Bend and live displays). It is the **best available stand-in** for the patch Argi tests on `http://127.0.0.1:8766/`. That patch lives in the browser's working-patch storage, not in a file the server can read, and the running 8765/8766/8080 servers are never touched by tests.

To capture the exact 8766 patch later: on 8766 open DevTools and run `copy(JSON.stringify(__viewExportPatch(), null, 2))`, paste it into `tests/fixtures/view-real-8766.json`, then run

    set VIEW_PATCH=tests/fixtures/view-real-8766.json
    node scripts/perf_view_real.mjs

`VIEW_TILE=n` adds n shifted copies of the ordinary modules for a bigger patch.