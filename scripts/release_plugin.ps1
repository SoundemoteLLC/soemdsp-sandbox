# Commit the plugin VERSION bump (VERSION file only), push main, tag, and
# push the tag so .github/workflows/release.yml builds Windows / macOS / Linux
# and mirrors the assets to SoundemoteLLC/soemdsp-sandbox. CI checks out
# sandbox master itself; this repo does not vendor a sandbox copy.
#
# Leaves dirty submodules and untracked build logs alone.
#
#   powershell -File scripts\release_plugin.ps1 -Version 0.22.0 -NotesFile notes.txt
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$Notes = "",
    [string]$NotesFile = "",
    [string]$Message = "",
    [switch]$NoWait,
    [int]$WaitMinutes = 8,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\release-common.ps1")

$Version = Get-VersionNumber $Version
$tag = "v$Version"
$plugin = Get-SiblingRepo "soemdsp-sandbox-audioplugin"
$pluginVersionPath = Join-Path $plugin "VERSION"
$pluginRepo = "elanhickler/soemdsp-sandbox-audioplugin"

if (!(Test-Path (Join-Path $plugin ".git"))) { throw "Plugin repo not found: $plugin" }
$branch = Get-RepoBranch $plugin
if ($branch -ne "main") { throw "Plugin must be on main (currently '$branch')." }

$onDisk = (Get-Content -LiteralPath $pluginVersionPath -Raw).Trim()
$fileVer = Get-VersionNumber $onDisk
if ($fileVer -ne $Version) {
    if ($DryRun) {
        Write-Host "  dry-run: plugin VERSION is '$onDisk'; bump would set $Version alpha before tagging"
        exit 0
    }
    throw "Plugin VERSION is '$onDisk' but this release is $Version. Run release_bump_version.ps1 first."
}

if (-not [string]::IsNullOrWhiteSpace($NotesFile)) {
    $Notes = [System.IO.File]::ReadAllText($NotesFile)
}
if ([string]::IsNullOrWhiteSpace($Notes)) {
    $Notes = "Sandbox $Version, built from the soemdsp-sandbox-audioplugin $tag tag."
}
if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "soemdsp-sandbox v$Version release"
}

Write-Host "release_plugin $tag" -ForegroundColor Cyan

# Refuse to touch anything except VERSION.
$dirty = @(Get-GitLines $plugin status --porcelain)
$unexpected = @($dirty | Where-Object {
    $path = $_.Substring(3).Trim('"').Replace("\", "/")
    $path -ne "VERSION"
})
if ($unexpected.Count -gt 0) {
    Write-Host "  leaving other dirty / untracked paths alone:"
    $unexpected | ForEach-Object { Write-Host "    $_" }
}

$versionDirty = @($dirty | Where-Object { $_.Substring(3).Trim('"').Replace("\", "/") -eq "VERSION" })
$existingTag = @(& git.exe -C $plugin tag --list $tag)

if ($DryRun) {
    if ($versionDirty.Count -gt 0) { Write-Host "  dry-run: would commit VERSION, push main, tag $tag, push tag" }
    elseif ($existingTag) { Write-Host "  dry-run: tag $tag already exists locally" }
    else { Write-Host "  dry-run: VERSION already committed; would tag $tag and push" }
    exit 0
}

Invoke-PullRebase $plugin "main"

if ($versionDirty.Count -gt 0) {
    Invoke-Git $plugin add -- VERSION
    New-CommitFromFile $plugin $Message
    Write-Host "  committed VERSION"
}

Assert-FastForwardPush $plugin "main"
$sha = (Get-GitLines $plugin rev-parse HEAD) -join ""
$ahead = Get-TrackedAheadCount $plugin "main"
if ($ahead -gt 0) {
    Invoke-Git $plugin push origin main
    Write-Host "  pushed origin/main ($($sha.Substring(0,8)))" -ForegroundColor Green
} else {
    Write-Host "  origin/main already has $($sha.Substring(0,8))"
}

if (@(& git.exe -C $plugin tag --list $tag).Count -eq 0) {
    Invoke-Git $plugin tag $tag
    Write-Host "  created tag $tag"
}
Invoke-Git $plugin push origin $tag
Write-Host "  pushed tag $tag" -ForegroundColor Green

# Pre-create the draft so CI uploads into notes we wrote, instead of a generic body.
$view = Invoke-GhQuiet release view $tag -R $pluginRepo
if ($view.ExitCode -ne 0) {
    $created = Invoke-GhQuiet release create $tag -R $pluginRepo --draft --target $sha --title $tag --notes $Notes
    if ($created.ExitCode -ne 0) { throw "Failed to create draft release $tag on $pluginRepo`n$($created.Output)" }
    Write-Host "  created draft release $tag"
} else {
    Write-Host "  release $tag already exists on $pluginRepo"
}

Start-Sleep -Seconds 8
$runs = Invoke-GhQuiet run list -R $pluginRepo --workflow "Release Sandbox" -L 5 --json databaseId,status,conclusion,headBranch,event,url,displayTitle,createdAt
$runList = @()
if ($runs.ExitCode -eq 0 -and $runs.Output) { $runList = @($runs.Output | ConvertFrom-Json) }
$match = $runList | Where-Object { $_.headBranch -eq $tag -or $_.displayTitle -like "*$tag*" } | Select-Object -First 1
if ($match) {
    Write-Host "  Actions: $($match.status) $($match.conclusion) $($match.url)"
} else {
    Write-Host "  Actions run for $tag not visible yet. Check https://github.com/$pluginRepo/actions"
}

if ($NoWait -or $WaitMinutes -le 0) { return }
if (-not $match) { return }

$deadline = (Get-Date).AddMinutes($WaitMinutes)
while ((Get-Date) -lt $deadline) {
    $infoRes = Invoke-GhQuiet run view $match.databaseId -R $pluginRepo --json status,conclusion,url
    if ($infoRes.ExitCode -eq 0) {
        $info = $infoRes.Output | ConvertFrom-Json
        Write-Host "  Actions: $($info.status) $($info.conclusion) $($info.url)"
        if ($info.status -eq "completed") { return }
    }
    Start-Sleep -Seconds 90
}
Write-Host "  still running after $WaitMinutes min; later: gh release view $tag -R SoundemoteLLC/soemdsp-sandbox"
exit 0
