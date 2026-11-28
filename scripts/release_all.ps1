# Full Sandbox release: bump version, squash unpushed sandbox commits, push,
# tag the plugin (GitHub Actions builds the downloads), publish soundemote-io,
# and bump soundemote-com only after the public assets are live.
#
#   powershell -File scripts\release_all.ps1 -DryRun
#   powershell -File scripts\release_all.ps1 -Version 0.22.0
#   powershell -File scripts\release_all.ps1 -SkipNativeBuild -NoWait
param(
    [string]$Version = "",
    [switch]$SkipNativeBuild,
    [switch]$SkipSmoke,
    [switch]$NoWait,
    [int]$WaitMinutes = 8,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\release-common.ps1")

$sandbox = Get-SandboxRepo
$plugin = Get-SiblingRepo "soemdsp-sandbox-audioplugin"
$io = Get-SiblingRepo "soundemote-io"
$com = Get-SiblingRepo "soundemote-com"

foreach ($repo in @($sandbox, $plugin, $io, $com)) {
    if (!(Test-Path (Join-Path $repo ".git"))) { throw "Missing repository: $repo" }
}

$currentLabel = Get-SandboxVersionLabel $sandbox
$current = Get-VersionNumber $currentLabel
$currentBuild = Get-BuildNumber $sandbox

if ([string]::IsNullOrWhiteSpace($Version)) {
    if ($currentLabel -match 'Sandbox Alpha' -and (Get-Content -LiteralPath (Join-Path $plugin "VERSION") -Raw).Trim() -eq "$current alpha" -and (Get-GitLines $sandbox status --porcelain -- VERSION).Count -gt 0) {
        # VERSION already bumped in the working tree.
        $Version = $current
    } else {
        $Version = Get-NextFreeVersion (Get-NextMinor $current)
    }
} else {
    $Version = Get-VersionNumber $Version
}

# If VERSION is still the previous release, the bump step will advance it.
$pluginVerNow = Get-VersionNumber ((Get-Content -LiteralPath (Join-Path $plugin "VERSION") -Raw).Trim())
$needsBump = ($pluginVerNow -ne $Version) -or ((Get-SandboxVersionLabel $sandbox) -notlike "*$Version*")

$nextBuild = if ($needsBump -or ((Get-BuildNumber $sandbox) -eq $currentBuild -and $pluginVerNow -ne $Version)) {
    Get-NextBuildNumber (Get-BuildNumber $sandbox)
} else {
    Get-BuildNumber $sandbox
}
# After bump, read the real stamp from disk; this is only for dry-run / plan text.
if (-not $needsBump) { $nextBuild = Get-BuildNumber $sandbox }

Write-Host "release_all" -ForegroundColor Cyan
Write-Host "  current: $currentLabel  build $(Get-BuildNumber $sandbox)"
Write-Host "  release: Sandbox Alpha $Version"
Write-Host "  sandbox: $sandbox"
Write-Host "  plugin:  $plugin"
Write-Host "  io:      $io"
Write-Host "  com:     $com"

Invoke-Git $sandbox fetch -q origin
$ahead = Get-TrackedAheadCount $sandbox "master"
Write-Host "  sandbox is $ahead commit(s) ahead of origin/master"
$sandboxDirty = @(Get-GitLines $sandbox status --porcelain)
if ($sandboxDirty.Count -gt 0) {
    Write-Host "  sandbox uncommitted:"
    $sandboxDirty | ForEach-Object { Write-Host "    $_" }
}

$notesBody = @"
Sandbox Alpha $Version

- Gradient Command Center: per-gradient Edit and Snapshot controls, stop selection and duplication, and continuous Blend playback
- Gradient parameters: clear Edit-mode indication, parameter-colored curves and outlines, and direct parameter settings
- Pitch Quantizer: clickable keyboard keys, display settings, and a continuous Fretting control
- Module clipboard: whole-module duplication with Ctrl+D alongside copy and paste
- Updated soundemote-io release copy and refreshed Sandbox download links for Windows, macOS, and Linux
"@

if ($DryRun) {
    Write-Host ""
    Write-Host "dry-run plan:"
    Write-Host "  1. bump VERSION + BUILD_NUMBER (today's next stamp) if needed"
    Write-Host "  2. prepare page patches; include init.json and these release scripts"
    if ($SkipNativeBuild) { Write-Host "  3. skip WASM build" } else { Write-Host "  3. build native modules + regenerate catalog" }
    Write-Host "  4. squash unpushed sandbox commits (backup-presquash-HHMM), fast-forward push, tag v$Version"
    Write-Host "  5. commit plugin VERSION only, push main, tag v$Version, start Actions"
    Write-Host "  6. publish soundemote-io (Lovable deploys main)"
    Write-Host "  7. bump soundemote-com sandbox.json only after public v$Version assets return 200"
    Write-Host ""
    Write-Host "GitHub release notes:"
    Write-Host $notesBody
    & (Join-Path $PSScriptRoot "release_bump_version.ps1") -Version $Version -DryRun
    & (Join-Path $PSScriptRoot "release_squash_push.ps1") -Repo $sandbox -Branch master -Message "Sandbox Alpha $Version" -DryRun
    & (Join-Path $PSScriptRoot "release_plugin.ps1") -Version $Version -DryRun
    & (Join-Path $PSScriptRoot "release_sites.ps1") -Version $Version -DryRun
    exit 0
}

# ---- 1. bump ----
if ($needsBump) {
    & (Join-Path $PSScriptRoot "release_bump_version.ps1") -Version $Version
    if ($LASTEXITCODE -ne 0) { throw "release_bump_version.ps1 failed." }
}
$build = Get-BuildNumber $sandbox
$label = Get-SandboxVersionLabel $sandbox
Write-Host "  using $label (build $build)"

# ---- 2. patches preflight ----
Write-Host ""
Write-Host "== Preparing patches" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "prepare_page_patches.ps1")
if ($LASTEXITCODE -ne 0) { throw "prepare_page_patches.ps1 failed." }

# ---- 3. native build + catalog ----
if (-not $SkipNativeBuild) {
    Write-Host ""
    Write-Host "== Building native modules (WASM)" -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "build_native_modules.ps1")
    if ($LASTEXITCODE -ne 0) { throw "build_native_modules.ps1 failed." }
    Write-Host "== Regenerating native module catalog" -ForegroundColor Cyan
    python (Join-Path $PSScriptRoot "generate_native_modules_catalog.py")
    if ($LASTEXITCODE -ne 0) { throw "generate_native_modules_catalog.py failed." }
} else {
    Write-Host "== Skipping native module build" -ForegroundColor Cyan
}

if (-not $SkipSmoke) {
    Write-Host "== Smoke test (reports only, never blocks)" -ForegroundColor Cyan
    Push-Location $sandbox
    try { node (Join-Path $PSScriptRoot "smoke.mjs") } finally { Pop-Location }
}

# ---- 4. squash + push sandbox, tag ----
$msgPath = Join-Path $env:TEMP "soemdsp-release-$Version.txt"
$squashMessage = @"
Sandbox Alpha $Version (build $build)

$($notesBody.Trim())
"@
Write-Utf8NoBom $msgPath ($squashMessage.TrimEnd() + "`n")

$trackedPatchPaths = @(Get-GitLines $sandbox ls-files -- patches)
$add = @(
    "VERSION",
    "server.py",
    "scripts/README.md",
    "scripts/soundemote_io.ps1",
    "scripts/release_all.ps1",
    "scripts/release_bump_version.ps1",
    "scripts/release_squash_push.ps1",
    "scripts/release_plugin.ps1",
    "scripts/release_sites.ps1",
    "scripts/lib/release-common.ps1",
    "public/native-modules-catalog.json",
    "native_modules"
)
$add += $trackedPatchPaths

Write-Host ""
Write-Host "== Squashing and pushing soemdsp-sandbox" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "release_squash_push.ps1") -Repo $sandbox -Branch master -MessageFile $msgPath -AddPath $add
if ($LASTEXITCODE -ne 0) { throw "release_squash_push.ps1 failed." }

$sandboxSha = (Get-GitLines $sandbox rev-parse HEAD) -join ""
$sandboxTag = "v$Version"
if (@(& git.exe -C $sandbox tag --list $sandboxTag).Count -eq 0) {
    Invoke-Git $sandbox tag $sandboxTag
}
# Pushing an existing equal tag is ok; refuse to move a different tag.
$tagSha = (Get-GitLines $sandbox rev-parse $sandboxTag) -join ""
if ($tagSha -ne $sandboxSha) {
    throw "Tag $sandboxTag already points at $tagSha, not $sandboxSha. Not moving it."
}
Invoke-Git $sandbox push origin $sandboxTag
Write-Host "  sandbox tag $sandboxTag -> $($sandboxSha.Substring(0,8))" -ForegroundColor Green

# ---- 5. plugin tag (starts Actions) ----
$notesPath = Join-Path $env:TEMP "soemdsp-release-notes-$Version.md"
Write-Utf8NoBom $notesPath ($notesBody.TrimEnd() + "`n")
Write-Host ""
Write-Host "== Plugin release" -ForegroundColor Cyan
$pluginArgs = @{ Version = $Version; NotesFile = $notesPath; WaitMinutes = $WaitMinutes }
if ($NoWait) { $pluginArgs["NoWait"] = $true }
& (Join-Path $PSScriptRoot "release_plugin.ps1") @pluginArgs
if ($LASTEXITCODE -ne 0) { throw "release_plugin.ps1 failed." }

# ---- 6. soundemote-io (does not need plugin assets) ----
Write-Host ""
Write-Host "== Sites (soundemote-io now; soundemote-com after public assets)" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "release_sites.ps1") -Version $Version -Build $build -SkipNativeBuild -SkipSmoke -SkipSandboxCommit
if ($LASTEXITCODE -ne 0) { throw "release_sites.ps1 failed." }

Write-Host ""
Write-Host "release_all finished for Sandbox Alpha $Version (build $build)." -ForegroundColor Green
Write-Host "  sandbox: $sandboxSha"
Write-Host "  If soundemote-com was skipped because Actions is still building, run:"
Write-Host "    powershell -File scripts\release_sites.ps1 -Version $Version -SkipIo"
exit 0
