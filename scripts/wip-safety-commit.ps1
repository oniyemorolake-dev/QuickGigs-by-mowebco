<#
  Safety net for the shared working tree (see AGENTS.md).

  Claude desktop's edits are only safe once they are a commit. Until then a stale
  editor buffer saving over the file destroys them with no conflict and no marker.
  This snapshots dirty files in Claude's zone -- root *.html plus qg-icons.js --
  into local WIP commits on a short cadence, so the worst case is a squash rather
  than lost work.

  Local commits only. This never pushes, never rebases, and never touches files:
  it only ever runs `git add -- <explicit paths>` and `git commit`.

  Stop it with:  Get-Content scripts\wip-safety.pid | ForEach-Object { Stop-Process -Id $_ }
#>
param(
  [int]$IntervalSeconds = 120
)

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$PID | Out-File -Encoding ascii "$repo\scripts\wip-safety.pid"

function Write-Log($msg) {
  "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg | Write-Output
}

Write-Log "watching root *.html + qg-icons.js every ${IntervalSeconds}s (local commits only, no push)"

while ($true) {
  # Never touch the index while git is mid-operation, or we corrupt someone's state.
  $busy = @('index.lock', 'rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'BISECT_LOG') |
            Where-Object { Test-Path (Join-Path "$repo\.git" $_) }

  if ($busy) {
    Write-Log "skip - git busy ($($busy -join ', '))"
  }
  else {
    # Porcelain lines are "XY path". Keep only Claude's zone: root-level .html
    # (no directory separator) and qg-icons.js. Renames and subfolders are skipped.
    $zone = @()
    foreach ($line in (git status --porcelain 2>$null)) {
      if ($line.Length -lt 4) { continue }
      $path = $line.Substring(3).Trim('"')
      if ($path -match '->') { continue }
      if ($path -match '[\\/]') { continue }
      if ($path -match '\.html$' -or $path -eq 'qg-icons.js') { $zone += $path }
    }

    if ($zone.Count -gt 0) {
      git add -- $zone 2>$null
      $staged = git diff --cached --name-only -- $zone
      if ($staged) {
        $subject = "wip: safety snapshot of $($zone.Count) file(s) in the HTML zone"
        $body    = "Automatic snapshot so an editor autosave cannot destroy unreviewed work.`n" +
                   "Squash or reword before it goes anywhere permanent.`n`nFiles:`n" +
                   (($zone | ForEach-Object { "  $_" }) -join "`n")
        git commit -q -m $subject -m $body 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Log "committed: $($zone -join ', ')" }
        else { Write-Log "commit failed for: $($zone -join ', ')" }
      }
    }
  }

  Start-Sleep -Seconds $IntervalSeconds
}
