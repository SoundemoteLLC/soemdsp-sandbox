# Publish the sandbox copy to soundemote-io, then (only after public plugin
# assets exist and return 200) bump soundemote-com download links and sizes.
#
# Reuses scripts/soundemote_io.ps1 for the io site. Does not bump com until
# https://github.com/SoundemoteLLC/soemdsp-sandbox/releases/tag/v<version>
# has every CLAP / VST3 / AU / standalone archive.
#
#   powershell -File scripts\release_sites.ps1 -Version 0.22.0
#   powershell -File scripts\release_sites.ps1 -Version 0.22.0 -SkipIo
param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$Build = "",
    [switch]$SkipIo,
    [switch]$SkipCom,
    [switch]$SkipNativeBuild,
    [switch]$SkipSmoke,
    [switch]$SkipSandboxCommit,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\release-common.ps1")

$Version = Get-VersionNumber $Version
$tag = "v$Version"
$sandbox = Get-SandboxRepo
$io = Get-SiblingRepo "soundemote-io"
$com = Get-SiblingRepo "soundemote-com"
$comJson = Join-Path $com "src\content\products\sandbox.json"
$publicRepo = "SoundemoteLLC/soemdsp-sandbox"
if ([string]::IsNullOrWhiteSpace($Build)) { $Build = Get-BuildNumber $sandbox }

Write-Host "release_sites $tag (build $Build)" -ForegroundColor Cyan

if (-not $SkipIo) {
    if ($DryRun) {
        Write-Host "  dry-run: would publish soundemote-io via soundemote_io.ps1 -Mode publish"
    } else {
        $ioArgs = @{
            Mode = "publish"
            SkipBuildBump = $true
            SkipNativeBuild = [bool]$SkipNativeBuild
            SkipSmoke = [bool]$SkipSmoke
            SkipSandboxCommit = [bool]$SkipSandboxCommit
        }
        if (-not [string]::IsNullOrWhiteSpace($Build)) {
            $ioArgs["Message"] = "Sandbox Alpha $Version (build $Build)"
        }
        Write-Host "  soundemote_io.ps1 -Mode publish (SkipBuildBump/SkipNativeBuild=$SkipNativeBuild/SkipSmoke=$SkipSmoke/SkipSandboxCommit=$SkipSandboxCommit)"
        & (Join-Path $PSScriptRoot "soundemote_io.ps1") @ioArgs
        if ($LASTEXITCODE -ne 0) { throw "soundemote_io.ps1 publish failed (exit $LASTEXITCODE)." }
    }
}

if ($SkipCom) {
    Write-Host "  skipped soundemote-com"
    exit 0
}

$release = Get-ReleaseAssets $publicRepo $tag
if (-not (Test-RequiredAssetsPresent $release)) {
    $have = @()
    if ($release) { $have = @($release.assets | ForEach-Object { $_.name }) }
    Write-Host "  public $tag assets are not ready; not bumping soundemote-com."
    if ($release) {
        Write-Host "  draft=$($release.isDraft) url=$($release.url)"
        $have | ForEach-Object { Write-Host "    $_" }
    } else {
        Write-Host "  no release at https://github.com/$publicRepo/releases/tag/$tag"
    }
    $missing = @(Get-RequiredPluginAssets | Where-Object { $have -notcontains $_ })
    if ($missing.Count -gt 0) {
        Write-Host "  missing:"
        $missing | ForEach-Object { Write-Host "    $_" }
    }
    if ($DryRun) { return }
    exit 0
}

Write-Host "  public release: $($release.url)"
$sizeByName = @{}
foreach ($a in $release.assets) { $sizeByName[$a.name] = [int64]$a.size }

$failed = @()
foreach ($name in (Get-RequiredPluginAssets)) {
    $url = Get-PublicDownloadUrl $Version $name
    if (Test-UrlHttpOk $url) {
        Write-Host "  200 $url"
    } else {
        Write-Host "  FAIL $url" -ForegroundColor Yellow
        $failed += $url
    }
}
if ($failed.Count -gt 0) {
    throw "Download links are not all 200/206. Not bumping soundemote-com. Failed: $($failed -join ', ')"
}

if ($DryRun) {
    Write-Host "  dry-run: would set soundemote-com version to $Version and update sizes, then commit and push"
    exit 0
}

$bak = New-ReleaseBackupDir
Copy-Backup $comJson $bak "sandbox.json.bak"

$jsonText = [System.IO.File]::ReadAllText($comJson)
$doc = $jsonText | ConvertFrom-Json
$doc.version = $Version
foreach ($d in $doc.downloads) {
    if ($sizeByName.ContainsKey($d.filename)) {
        $d.size = [int64]$sizeByName[$d.filename]
    } else {
        throw "Public release has no asset named $($d.filename)"
    }
}
# ConvertFrom-Json / ConvertTo-Json would reflow the large about/listen blob.
# Patch only the version field and each download size in place instead.
$patched = [regex]::Replace($jsonText, '("version"\s*:\s*")[^"]+(")', { param($m) $m.Groups[1].Value + $Version + $m.Groups[2].Value }, 1)
foreach ($d in $doc.downloads) {
    $name = [regex]::Escape($d.filename)
    $size = [string]$sizeByName[$d.filename]
    $pattern = "(`"filename`"\s*:\s*`"$name`"\s*,\s*`r?`n\s*`"size`"\s*:\s*)\d+"
    $next = [regex]::Replace($patched, $pattern, { param($m) $m.Groups[1].Value + $size }, 1)
    if ($next -eq $patched) { throw "Could not patch size for $($d.filename) in sandbox.json" }
    $patched = $next
}
Write-Utf8NoBom $comJson $patched
Write-Host "  updated $comJson"

$comBranch = Get-RepoBranch $com
if ($comBranch -ne "main") { throw "soundemote-com must be on main (currently '$comBranch')." }
Invoke-PullRebase $com "main"
Invoke-Git $com add -- "src/content/products/sandbox.json"
$staged = Get-GitLines $com diff --cached --name-only
if ($staged.Count -eq 0) {
    Write-Host "  soundemote-com already has $Version sizes"
} else {
    New-CommitFromFile $com "Sandbox $Version downloads"
    Assert-FastForwardPush $com "main"
    Invoke-Git $com push origin main
    Write-Host "  pushed soundemote-com: Sandbox $Version downloads" -ForegroundColor Green
}

Write-Host "  download links verified for $tag" -ForegroundColor Green
exit 0
