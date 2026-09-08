# run-installer-test.ps1 - THE way to run the tier-2 clean-machine installer test.
# Runs on the HOST. Wraps installer-test.wsb so the whole thing is hands-off and stays
# out of the way of whatever is on the primary monitor (the user games there).
#
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\run-installer-test.ps1
#
# What it does:
#   1. Pre-flight: force-closes any stale sandbox (only ONE Windows Sandbox instance is
#      allowed machine-wide - a leftover VM makes the next launch fail with
#      "Only one running instance of Windows Sandbox is allowed"), and verifies a
#      CURRENT installer artifact exists before booting a VM to test nothing.
#   2. Launches the .wsb, waits for the WindowsSandboxClient window, then parks it on the
#      first NON-PRIMARY monitor and pushes it to the bottom of the z-order, never
#      stealing focus (SWP_NOACTIVATE). Single-monitor machines minimize instead.
#   3. Polls for the mapped results file, then force-kills the client so teardown is
#      non-interactive (an in-guest shutdown pops a modal on the host desktop).
#   4. Prints the verdict and exits 0 on PASS, 1 on anything else.
#
# Steps 1-3 are NOT implemented here: they are the shared host-side sandbox lifecycle and live
# in sandbox-lifecycle.ps1, dot-sourced below, because run-smoke-feedback.ps1 needs exactly the
# same four behaviours and a second copy of them would be a second thing to get wrong.
#
# ASCII only (see installer-test.ps1 for why).

[CmdletBinding()]
param(
  # Minimize instead of parking on a second monitor, even if one is available.
  [switch]$Minimize,
  # Give up waiting for results after this long.
  [int]$TimeoutSeconds = 900,
  # Leave the VM running after the results land (for poking at it by hand).
  [switch]$KeepOpen
)

$ErrorActionPreference = 'Stop'
$sandboxDir = $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $sandboxDir '..\..')
$wsb = Join-Path $sandboxDir 'installer-test.wsb'
$resultsDir = Join-Path $sandboxDir 'results'
$resultFile = Join-Path $resultsDir 'result.txt'
$releaseDir = Join-Path $repoRoot 'release'
$setupGlob = 'everquest-companion-Setup-*.exe'

. (Join-Path $PSScriptRoot 'sandbox-lifecycle.ps1')

Write-Host "=== tier-2 clean-machine installer test (Windows Sandbox) ==="

# --- 1. Pre-flight -----------------------------------------------------------------
if (-not (Test-Path $wsb)) { throw "missing harness config: $wsb" }
if (Stop-Sandbox) { Write-Host 'pre-flight: closed a stale Windows Sandbox instance' }

$setup = Get-ChildItem -Path $releaseDir -Recurse -Filter $setupGlob -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) {
  $stale = @(Get-ChildItem -Path $releaseDir -Recurse -Filter '*Setup*.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
  $msg = "no $setupGlob under $releaseDir - run 'npm run dist' to COMPLETION first"
  if ($stale.Count) { $msg += " (found only stale-named build(s): $($stale -join ', '))" }
  throw $msg
}
$ageMin = [math]::Round(((Get-Date) - $setup.LastWriteTime).TotalMinutes, 1)
Write-Host "installer: $($setup.FullName)"
Write-Host "           built $($setup.LastWriteTime.ToString('o')) ($ageMin min ago)"
if ($ageMin -gt 120) { Write-Warning "that build is $ageMin minutes old - tier 2 must test the CURRENT 'npm run dist' output" }

if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Path $resultsDir | Out-Null }
# Clear stale verdicts ONLY - results/.gitkeep is tracked, don't nuke the whole folder.
Get-ChildItem $resultsDir -Filter 'result*.txt' -Force -ErrorAction SilentlyContinue |
  Remove-Item -Force -Confirm:$false

# --- 2. Launch + park --------------------------------------------------------------
Start-SandboxRun -Wsb $wsb -Minimize:$Minimize | Out-Null

# --- 3. Wait for results, re-asserting placement (the VM window likes to re-raise) ---
Wait-SandboxResult -ResultFile $resultFile -TimeoutSeconds $TimeoutSeconds -Minimize:$Minimize | Out-Null

# --- 4. Teardown + verdict ---------------------------------------------------------
if (-not $KeepOpen) {
  if (Stop-Sandbox) { Write-Host 'teardown: sandbox closed' }
}
else { Write-Host 'teardown: -KeepOpen set, VM left running' }

if (-not (Test-Path $resultFile)) {
  Write-Host "RESULT: FAIL - no $resultFile after $TimeoutSeconds s (harness never reported)"
  exit 1
}
$content = Get-Content $resultFile
$content | ForEach-Object { Write-Host $_ }
if ($content -contains 'RESULT: PASS') { exit 0 }
exit 1
