# Squash only unpushed commits on a repo into one commit and fast-forward push.
# Never force-pushes, never reset --hard, never discards work.
#
#   powershell -File scripts\release_squash_push.ps1 -Repo <path> -Branch master -Message "..."
#   powershell -File scripts\release_squash_push.ps1 -Repo <path> -MessageFile C:\temp\msg.txt -DryRun
param(
    [Parameter(Mandatory = $true)]
    [string]$Repo,
    [string]$Branch = "",
    [string]$Message = "",
    [string]$MessageFile = "",
    [string[]]$AddPath = @(),
    [switch]$NoPush,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib\release-common.ps1")

$Repo = (Resolve-Path -LiteralPath $Repo).Path
if ([string]::IsNullOrWhiteSpace($Branch)) { $Branch = Get-RepoBranch $Repo }
if ([string]::IsNullOrWhiteSpace($Branch)) { throw "Could not determine branch for $Repo" }

$current = Get-RepoBranch $Repo
if ($current -ne $Branch) { throw "$(Split-Path -Leaf $Repo) must be on $Branch (currently '$current')." }

if ([string]::IsNullOrWhiteSpace($Message) -and [string]::IsNullOrWhiteSpace($MessageFile)) {
    throw "Pass -Message or -MessageFile."
}
if (-not [string]::IsNullOrWhiteSpace($MessageFile)) {
    $Message = [System.IO.File]::ReadAllText($MessageFile)
}

Write-Host "release_squash_push $(Split-Path -Leaf $Repo) ($Branch)" -ForegroundColor Cyan

Invoke-Git $Repo fetch -q origin
if (-not $DryRun) { Invoke-PullRebase $Repo $Branch }

$ahead = Get-TrackedAheadCount $Repo $Branch
$dirty = @(Get-GitLines $Repo status --porcelain)
Write-Host "  ahead of origin/${Branch}: $ahead commit(s)"
if ($dirty.Count -gt 0) {
    Write-Host "  uncommitted:"
    $dirty | ForEach-Object { Write-Host "    $_" }
}

if ($ahead -eq 0 -and $dirty.Count -eq 0 -and $AddPath.Count -eq 0) {
    Write-Host "  nothing to squash; already in sync with origin/$Branch"
    exit 0
}

$stamp = Get-Date -Format "HHmm"
$backup = "backup-presquash-$stamp"
$exists = @(& git.exe -C $Repo branch --list $backup)
if ($exists) { $backup = "backup-presquash-$stamp-$PID" }

if ($DryRun) {
    Write-Host "  dry-run: would create $backup, soft-reset to origin/$Branch, commit, and $(if ($NoPush) { 'not push' } else { 'fast-forward push' })"
    exit 0
}

if ($AddPath.Count -gt 0) {
    Invoke-Git $Repo add -- $AddPath
} elseif ($dirty.Count -gt 0) {
    throw "Uncommitted changes in $Repo. Pass -AddPath for the files to include, or commit them first."
}

# Backup the current tip (including any just-staged work that is already committed).
# Staged-only files live in the index and will be in the new squash commit; the
# backup branch points at the pre-reset HEAD so the unpushed commits stay reachable.
Invoke-Git $Repo branch $backup
Write-Host "  backup branch: $backup ($(git.exe -C $Repo rev-parse --short $backup))"

Invoke-Git $Repo reset --soft "origin/$Branch"
New-CommitFromFile $Repo $Message
Assert-FastForwardPush $Repo $Branch
$newSha = (Get-GitLines $Repo rev-parse HEAD) -join ""
Write-Host "  squash commit: $newSha"

if ($NoPush) {
    Write-Host "  not pushed (-NoPush)"
    exit 0
}

Invoke-Git $Repo push origin $Branch
Write-Host "  pushed origin/$Branch ($($newSha.Substring(0,8)))" -ForegroundColor Green
exit 0
