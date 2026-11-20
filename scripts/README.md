# Sandbox scripts

Run these from File Explorer or a terminal. All paths below are relative to the
`soemdsp-sandbox` repository.

| Task | Entry point | Effect |
| --- | --- | --- |
| Start the local sandbox | `scripts/start_sandbox_debug.cmd` | Restarts the debug server at `http://127.0.0.1:8766/`. Does not build WASM. |
| Preview the sandbox on soundemote-io | `scripts/soundemote_io_preview.cmd` | Builds native modules, runs the smoke report, copies the release sandbox into the sibling `soundemote-io` repo, and starts its local site at `http://localhost:8080/`. No commit or push. |
| Send patches live | `scripts/soundemote_io_publish_patches.cmd` | Preflights and commits sandbox patches, copies them to `soundemote-io`, updates its catalog, then commits and pushes both repos. No WASM build. |
| Publish a full release | `scripts/soundemote_io_publish.cmd` | Builds, runs the smoke report, syncs the site copy, commits, and pushes both repos. **This goes live.** Does not bump `VERSION`, tag the plugin, or update soundemote-com. |
| Full product release | `scripts/release_all.ps1` | Bumps every version stamp, squashes unpushed sandbox commits, pushes, tags the plugin so GitHub Actions builds the downloads, publishes soundemote-io, and updates soundemote-com only after the public assets exist. Pass `-DryRun` first. **This goes live.** |
| Run the smoke report alone | `node scripts/smoke.mjs` | Compares the rendered `smoke_test` patch with its reference WAV. It currently reports mismatches without a nonzero exit code. Read its output. |

The three `soundemote_io_*.cmd` wrappers use `scripts/soundemote_io.ps1`.
`scripts/sync_soundemote_io.ps1` is the lower-level copy step; it replaces the
site's vendored sandbox tree but does not commit or push. Run it only when that
full copy is intended. `scripts/prepare_page_patches.ps1` is the patch preflight.

## Release scripts

These live next to the publish wrappers and share `scripts/lib/release-common.ps1`.
Run them from a PowerShell prompt. They never force-push, never `reset --hard`,
and never discard work. `release_all.ps1` is the usual entry point; the others
are the steps it runs, and can be used on their own (for example to finish the
soundemote-com download bump after Actions finishes).

| Script | Effect |
| --- | --- |
| `scripts/release_bump_version.ps1` | Writes `Sandbox Alpha x.y.z` to the sandbox `VERSION` file, `x.y.z alpha` to the plugin `VERSION` file, and the next `yyyy.MM.dd.N` stamp to `BUILD_NUMBER` in `server.py`. Does not commit. |
| `scripts/release_squash_push.ps1` | Creates a `backup-presquash-HHMM` branch, soft-resets to `origin/<branch>`, commits with a UTF-8 no-BOM message file, and fast-forward pushes. Refuses if the push would need `--force`. Pulls with `git pull --rebase --autostash` first if origin has moved. |
| `scripts/release_plugin.ps1` | Commits only the plugin `VERSION` file, pushes `main`, tags `v<version>`, and pushes the tag so `.github/workflows/release.yml` builds Windows, macOS, and Linux and mirrors the archives to `SoundemoteLLC/soemdsp-sandbox`. Leaves dirty submodules and build logs alone. CI checks out sandbox `master` itself. |
| `scripts/release_sites.ps1` | Publishes soundemote-io via `soundemote_io.ps1`. Updates `soundemote-com/src/content/products/sandbox.json` only after the public `v<version>` assets exist and each download URL returns 200. If Actions is still running, re-run with `-SkipIo` later. |
| `scripts/release_all.ps1` | Runs the steps above in order. `-DryRun` prints the plan. `-SkipNativeBuild` reuses the last WASM build. `-NoWait` returns as soon as the plugin tag is pushed. |

`scripts/build_native_modules.ps1` builds WASM without starting a server or
publishing. `scripts/start_soundemote_sites.cmd` starts the three sibling site
dev servers without copying or building anything. `scripts/generate_vs_project.bat`
generates the optional Visual Studio solution. Ignored experiments live under
`scripts/_scratch/` and are not part of the release workflow.