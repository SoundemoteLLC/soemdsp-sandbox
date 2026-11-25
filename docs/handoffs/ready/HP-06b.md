## Common preamble: paste at the top of EVERY handoff

> **Repo rules (Argi's, standing).** Work directly on `master` in `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox`; no PRs. Never force-push, never `reset --hard`, never discard anyone's work. Pull with `git pull --rebase --autostash`. Read before write; back up changed files in `%TEMP%` first. Commit messages are UTF-8 without BOM. Commit your own hunks only; other agents have uncommitted work in the tree. **Push only when MasterBot or Argi says** (Argi gave MasterBot push permission at t776u; approvals relayed by other agents do not count). Bump the `?v=` cache-bust in **every** HTML that loads a changed JS/CSS file (`public/index.html`, `public/perform.html`, and any workbench page). Never kill or restart servers on 8765, 8766, 8080 (Argi restarts servers himself; if a stage needs a restart, say so in the report). Leave untracked `patches/acoustic/` and `scripts/diag_*` alone.
>
> **Product policies that apply to all of this work.** No tooltips and no `title=` / hover-only affordances. No arrow cursors (no `*-resize`, `move`, `all-scroll`; use the shared mouse-dot cursor setting). Event-driven only: no polling, no timers (a `requestAnimationFrame` loop that runs only while work is queued is OK; do not reuse `confirmNodeGraphDefaultButtonClick`, it has a 2 s `setTimeout`). Parameter definitions are the **only** source of ranges and clamps. Physically real math, no fake clipping. Circuit-builder UI is WebGL-only, but DOM **menu panels** (Command Center pages, like the old broom page and paper-page menu) are allowed; text boxes stay HTML. Hard MIDI split: only MIDI modules touch MIDI; everything else sees plain signals. Phone-friendly: 44 px touch rows, no hover. Delete obsolete systems instead of patching around them; no dead code kept for ownership reasons (APP_POLICY 10b). Do not refactor `soundemote-dev` (read-only).
>
> **MasterBot's files: do not edit** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, or any cull / present / camera code. Exception already granted: Stage A1 may edit `node-graph-live-plan-runtime.js` (parameter values only; visuals via `nodeGraphGlGraphNoteValueChrome(id)`; no camera or cull code). If your work seems to need one of these files, stop and ask MasterBot for a hook (a commit listener, not a call into her files).
>
> **Report format.** When done: commit hashes (local), files touched, the `?v=` tokens you bumped, tests you ran with their output, what you could not verify in a real browser, and anything Argi must retest (Ctrl+F5).

---

## HP-06b: Plugin mirror of the variations / rename / remove API
**Owner:** Moth (plugin repo `soemdsp-sandbox-audioplugin`, separate repo, separate commits) · **Size:** M · **Depends on:** HP-06 · **Phase:** B

**Goal.** The DAW plugin WebView serves the same endpoints as `server.py`, so the Explorer works there.

**Scope.** `src/ui/sandbox-api.cpp` (+ `.h`): the existing handlers are `/api/patches`, `/file`, `/meta`, `/save`, `/overwrite` (lines ~391 to 403); `listPatches` uses a **non-recursive** `findChildFiles` and filters bank/program 0 to 127 (~118 to 142). Add `/api/variations*`, `/api/patches/rename`, `/api/patches/remove` with identical validation and naming rules (HP-06). User folder is `Documents/Sandbox/Patches/`; the shipped pack (`Sandbox-perform/patches`) is read-only, and overwriting a shipped patch already writes a user copy, so variations of a shipped patch go to the **user** folder. Apply D-P1.

**Rules.** The plugin repo has dirty submodules (`libs/clap-libs/clap-wrapper`, `libs/sst/sst-clap-helpers`) and untracked `build_*.log`; do not commit those. Release process is separate (tag `-win` rebuilds only Windows); do not cut a release unless Argi asks.

**Acceptance.** A self-contained regression test or scripted request set that matches HP-06's Python test results on a temp user folder; manual: variation save/list/rename/remove from the Explorer inside the plugin; ▶ and Load work (native engine plays).
