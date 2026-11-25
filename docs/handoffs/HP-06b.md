## HP-06b: Plugin mirror of the variations / rename / remove API
**Owner:** Moth (plugin repo `soemdsp-sandbox-audioplugin`, separate repo, separate commits) · **Size:** M · **Depends on:** HP-06 · **Phase:** B

**Goal.** The DAW plugin WebView serves the same endpoints as `server.py`, so the Explorer works there.

**Scope.** `src/ui/sandbox-api.cpp` (+ `.h`): the existing handlers are `/api/patches`, `/file`, `/meta`, `/save`, `/overwrite` (lines ~391 to 403); `listPatches` uses a **non-recursive** `findChildFiles` and filters bank/program 0 to 127 (~118 to 142). Add `/api/variations*`, `/api/patches/rename`, `/api/patches/remove` with identical validation and naming rules (HP-06). User folder is `Documents/Sandbox/Patches/`; the shipped pack (`Sandbox-perform/patches`) is read-only, and overwriting a shipped patch already writes a user copy, so variations of a shipped patch go to the **user** folder. Apply D-P1.

**Rules.** The plugin repo has dirty submodules (`libs/clap-libs/clap-wrapper`, `libs/sst/sst-clap-helpers`) and untracked `build_*.log`; do not commit those. Release process is separate (tag `-win` rebuilds only Windows); do not cut a release unless Argi asks.

**Acceptance.** A self-contained regression test or scripted request set that matches HP-06's Python test results on a temp user folder; manual: variation save/list/rename/remove from the Explorer inside the plugin; ▶ and Load work (native engine plays).
