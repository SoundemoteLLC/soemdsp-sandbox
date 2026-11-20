# Bump Sandbox VERSION files and the server.py build stamp together.
# Does not commit. Default version is the next free minor (0.21.0 -> 0.22.0).
#
#   powershell -File scripts\release_bump_version.ps1
#   powershell -File scripts\release_bump_version.ps1 -Version 0.22.0 -DryRun
param(
    [string]$Version = "",
    [switch]$DryRun,
    [string]$BackupDir = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\release-common.ps1")

$sandbox = Get-SandboxRepo
$plugin = Get-SiblingRepo "soemdsp-sandbox-audioplugin"
$serverPath = Join-Path $sandbox "server.py"
$sandboxVersionPath = Join-Path $sandbox "VERSION"
$pluginVersionPath = Join-Path $plugin "VERSION"

$currentLabel = Get-SandboxVersionLabel $sandbox
$current = Get-VersionNumber $currentLabel
$currentBuild = Get-BuildNumber $sandbox
$nextBuild = Get-NextBuildNumber $currentBuild

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = Get-NextFreeVersion (Get-NextMinor $current)
} else {
    $Version = Get-VersionNumber $Version
    if (Test-VersionTaken $Version) { throw "Version $Version already exists as a tag or GitHub release." }
}

$newSandboxLabel = "Sandbox Alpha $Version"
$newPluginLabel = "$Version alpha"

Write-Host "release_bump_version" -ForegroundColor Cyan
Write-Host "  sandbox VERSION: $currentLabel -> $newSandboxLabel"
Write-Host "  plugin VERSION:  $((Get-Content -LiteralPath $pluginVersionPath -Raw).Trim()) -> $newPluginLabel"
Write-Host "  BUILD_NUMBER:    $currentBuild -> $nextBuild"

if ($DryRun) {
    Write-Host "  dry-run: no files written"
    exit 0
}

if ([string]::IsNullOrWhiteSpace($BackupDir)) { $BackupDir = New-ReleaseBackupDir }
Copy-Backup $sandboxVersionPath $BackupDir "VERSION.bak"
Copy-Backup $pluginVersionPath $BackupDir "plugin-VERSION.bak"
Copy-Backup $serverPath $BackupDir "server.py.bak"
Write-Host "  backup: $BackupDir"

Write-Utf8NoBom $sandboxVersionPath ($newSandboxLabel + "`n")
Write-Utf8NoBom $pluginVersionPath ($newPluginLabel + "`n")

$text = [System.IO.File]::ReadAllText($serverPath)
$updated = [regex]::Replace($text, 'BUILD_NUMBER\s*=\s*"[^"]*"', "BUILD_NUMBER = `"$nextBuild`"")
if ($updated -eq $text) { throw "Could not find BUILD_NUMBER in server.py" }
$bytes = [System.IO.File]::ReadAllBytes($serverPath)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
if ($hasBom) {
    [System.IO.File]::WriteAllText($serverPath, $updated, (New-Object System.Text.UTF8Encoding $true))
} else {
    Write-Utf8NoBom $serverPath $updated
}

Write-Host "  wrote VERSION files and BUILD_NUMBER $nextBuild" -ForegroundColor Green
Write-Output @{ Version = $Version; Build = $nextBuild; BackupDir = $BackupDir } | Out-Null
exit 0
