# Shared helpers for scripts/release_*.ps1. Dot-source from those scripts only.
$ErrorActionPreference = "Stop"

function Get-ScriptsDir {
    # These helpers live in scripts/lib, but callers also set $PSScriptRoot to
    # scripts/ when they are the entry point. Accept either.
    $here = $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($here)) { throw "PSScriptRoot is not set; run a scripts/*.ps1 file." }
    if ((Split-Path -Leaf $here) -eq "lib") { return (Split-Path -Parent $here) }
    return $here
}

function Get-ProgrammingRoot {
    return (Split-Path -Parent (Get-SandboxRepo))
}

function Get-SandboxRepo {
    return (Split-Path -Parent (Get-ScriptsDir))
}

function Get-SiblingRepo([string]$Name) {
    return (Join-Path (Get-ProgrammingRoot) $Name)
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Invoke-GhQuiet {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & gh.exe @args 2>&1
        return @{ ExitCode = $LASTEXITCODE; Output = [string]($output | Out-String) }
    } finally {
        $ErrorActionPreference = $old
    }
}
function Invoke-Git([string]$Repo) {
    & git.exe -C $Repo @args
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed in $Repo" }
}

function Get-GitLines([string]$Repo) {
    $out = @(& git.exe -C $Repo @args)
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed in $Repo" }
    return @($out | Where-Object { $_ -ne $null -and "$_" -ne "" })
}

function Get-SandboxVersionLabel([string]$Sandbox) {
    $path = Join-Path $Sandbox "VERSION"
    if (!(Test-Path -LiteralPath $path)) { throw "VERSION file not found: $path" }
    return (Get-Content -LiteralPath $path -Raw).Trim()
}

function Get-VersionNumber([string]$Text) {
    if ($Text -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
    throw "No x.y.z version in: $Text"
}

function Get-NextMinor([string]$Version) {
    $p = $Version.Split(".")
    if ($p.Count -lt 3) { throw "Version is not x.y.z: $Version" }
    return "{0}.{1}.0" -f $p[0], ([int]$p[1] + 1)
}

function Get-BuildNumber([string]$Sandbox) {
    $server = Get-Content -LiteralPath (Join-Path $Sandbox "server.py") -Raw
    if ($server -match 'BUILD_NUMBER\s*=\s*"([^"]+)"') { return $Matches[1] }
    return ""
}

function Get-NextBuildNumber([string]$Current) {
    $today = (Get-Date).ToString("yyyy.MM.dd")
    $n = 1
    if ($Current -match "^$([regex]::Escape($today))\.(\d+)$") { $n = [int]$Matches[1] + 1 }
    return "$today.$n"
}

function Test-VersionTaken([string]$Version) {
    $tag = "v$Version"
    $sandbox = Get-SandboxRepo
    $plugin = Get-SiblingRepo "soemdsp-sandbox-audioplugin"
    foreach ($repo in @($sandbox, $plugin)) {
        if (Test-Path (Join-Path $repo ".git")) {
            $local = @(& git.exe -C $repo tag --list $tag)
            if ($local) { return $true }
        }
    }
    foreach ($r in @("SoundemoteLLC/soemdsp-sandbox", "elanhickler/soemdsp-sandbox-audioplugin")) {
        $result = Invoke-GhQuiet release view $tag -R $r
        if ($result.ExitCode -eq 0) { return $true }
    }
    return $false
}

function Get-NextFreeVersion([string]$Start) {
    $v = $Start
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Test-VersionTaken $v)) { return $v }
        $v = Get-NextMinor $v
    }
    throw "Could not find a free version starting at $Start"
}

function New-ReleaseBackupDir {
    $stamp = Get-Date -Format "HHmm"
    $dir = Join-Path $env:TEMP "soemdsp-bak-$stamp-release"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    return $dir
}

function Copy-Backup([string]$Src, [string]$BackupDir, [string]$Name) {
    if (Test-Path -LiteralPath $Src) {
        Copy-Item -LiteralPath $Src -Destination (Join-Path $BackupDir $Name) -Force
    }
}

function Get-RepoBranch([string]$Repo) {
    return ((Get-GitLines $Repo branch --show-current) -join "")
}

function Get-TrackedAheadCount([string]$Repo, [string]$Branch) {
    return [int]((Get-GitLines $Repo rev-list --count "origin/$Branch..HEAD") -join "")
}

function Assert-FastForwardPush([string]$Repo, [string]$Branch) {
    $base = (Get-GitLines $Repo merge-base "origin/$Branch" "HEAD") -join ""
    $origin = (Get-GitLines $Repo rev-parse "origin/$Branch") -join ""
    if ($base -ne $origin) {
        throw "Push of $Repo would not be a fast-forward onto origin/$Branch. Refusing to push. Backup branch is unchanged."
    }
}

function Invoke-PullRebase([string]$Repo, [string]$Branch) {
    Invoke-Git $Repo fetch -q origin
    $behind = [int]((Get-GitLines $Repo rev-list --count "HEAD..origin/$Branch") -join "")
    if ($behind -gt 0) {
        Write-Host "  $(Split-Path -Leaf $Repo): origin/$Branch is $behind commit(s) ahead; pull --rebase --autostash"
        Invoke-Git $Repo pull --rebase --autostash origin $Branch
    }
}

function New-CommitFromFile([string]$Repo, [string]$Message) {
    $tmp = Join-Path $env:TEMP ("soemdsp-commit-{0}.txt" -f ([guid]::NewGuid().ToString("N")))
    try {
        $text = $Message.TrimEnd() + "`n"
        Write-Utf8NoBom $tmp $text
        Invoke-Git $Repo commit -F $tmp
    } finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}

function Get-RequiredPluginAssets {
    return @(
        "Sandbox-windows-clap.zip",
        "Sandbox-windows-vst3.zip",
        "Sandbox-windows-standalone.zip",
        "Sandbox-macos-clap.zip",
        "Sandbox-macos-vst3.zip",
        "Sandbox-macos-au.zip",
        "Sandbox-macos-standalone.zip",
        "Sandbox-linux-clap.tgz",
        "Sandbox-linux-vst3.tgz",
        "Sandbox-linux-standalone.tgz"
    )
}

function Get-PublicDownloadUrl([string]$Version, [string]$Filename) {
    return "https://github.com/SoundemoteLLC/soemdsp-sandbox/releases/download/v$Version/$Filename"
}

function Get-ReleaseAssets([string]$Repo, [string]$Tag) {
    $result = Invoke-GhQuiet release view $Tag -R $Repo --json 'tagName,isDraft,url,assets'
    if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.Output)) { return $null }
    try { return ($result.Output | ConvertFrom-Json) } catch { return $null }
}

function Test-RequiredAssetsPresent($Release) {
    if (-not $Release -or $Release.isDraft) { return $false }
    $names = @($Release.assets | ForEach-Object { $_.name })
    foreach ($need in (Get-RequiredPluginAssets)) {
        if ($names -notcontains $need) { return $false }
    }
    return $true
}

function Test-UrlHttpOk([string]$Url) {
    $code = (& curl.exe -sS -o NUL -w "%{http_code}" -L -r 0-0 --max-time 30 $Url).Trim()
    return ($code -eq "200" -or $code -eq "206")
}