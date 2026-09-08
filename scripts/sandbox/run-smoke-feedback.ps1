# run-smoke-feedback.ps1 - THE way to run the post-release END-TO-END feedback smoke test.
#
#   npm run smoke:release
#   powershell -ExecutionPolicy Bypass -File scripts\sandbox\run-smoke-feedback.ps1
#
# ============================== ON-DEMAND ONLY ==============================
# NOT in CI. NOT in `npm test`. NOT in `npm run test:e2e`. NOT in any run-all.
# This boots a VM, downloads the PUBLISHED installer, and files a REAL bug report against the
# LIVE ingest API - a real DSQL row and a real S3 object, which it then DELETES. Run it
# deliberately, once, after a release has been published. That is the whole point of it.
# ============================================================================
#
# WHAT IT PROVES, which nothing else in this repo does: that the artifact a user actually
# downloads, installed on a machine that has never seen this project, can carry a bug report
# with an attached log slice all the way to the operator's backlog - through the shipped
# validator, the live per-install quota, the live kill switch, the presign and the bucket pin -
# AND that the slice which arrives has been scrubbed of third-party chat.
#
# THE PROOF IS A BOOBY-TRAPPED LOG. The mocked EverQuest log this script synthesizes
# (scripts/smokeLog.mts) puts the run's NONCE on every combat line and CHAT_MARKER on every
# chat line. Downstream, the slice that comes back out of S3 must contain the nonce (real
# content travelled) and must NOT contain the marker (the scrub ran). Those two facts are the
# test; everything else is plumbing that gets them there.
#
# AND A SECOND LEG, since the telemetry client was lit: the same installed build, launched
# plainly and left running for two flush ticks, must land its anonymous usage counts in the
# live tables. The guest echoes the app's own analyticsId; this script polls analytics_install
# for it plus a session counter in usage_daily, then wipes the row with the shipped
# `analytics wipe --id` path. It runs AFTER the feedback checks and their cleanup, so the row a
# human would otherwise have to triage is always tidied first.
#
# WHAT RUNS WHERE:
#   HOST (this file)  nonce + synthesized log -> mapped folder; VM lifecycle; then the cloud
#                     half via `node --import tsx scripts/smoke-feedback.mts verify` and
#                     `... verify-telemetry`, which read the LIVE cluster through
#                     src/main/triage/store.ts (AWS profile 'eqc' by default) and clean up
#                     after a pass.
#   GUEST (in the VM) scripts\sandbox\smoke-feedback.ps1 - plant the log, download + checksum
#                     the installer, install /S, launch it with EQ_SMOKE_FEEDBACK=<nonce>,
#                     relay the app's one stdout line back as OUTCOME:, then relaunch it
#                     plainly for the telemetry leg and relay ANALYTICSID:.
#
# THE VERDICTS:
#   PASS            the report and its scrubbed slice were found in the cloud and deleted, AND
#                   the install's analytics row + a session counter were found and the row
#                   deleted.
#   CLOSED          the feedback server answered `closed` - the operator's kill switch is ON.
#                   The client-side plumbing is PROVEN (we reached the API and got a deliberate
#                   refusal); there is no row to verify. NOT a failure; exits 0.
#   LIT-BUT-CLOSED  the same thing for telemetry: `telemetry_accepting` is off, so every batch
#                   was refused by design and no row exists to check. NOT a failure; exits 0.
#   FAIL            anything else. On a failure NOTHING that failed is cleaned up - the row, the
#                   object, the guest's captured stdout and the VM's verdict file are evidence.
#
# The sandbox lifecycle (single-instance guard, off-primary parking, results polling, force
# teardown) is NOT reimplemented here: it is shared with the tier-2 installer harness in
# sandbox-lifecycle.ps1.
#
# ASCII only (see smoke-feedback.ps1 for why).

[CmdletBinding()]
param(
  # Minimize instead of parking on a second monitor, even if one is available.
  [switch]$Minimize,
  # Give up on the VM half after this long (download + install + submit + the telemetry dwell).
  # Raised 1800 -> 2100 by JOS-269: the guest's telemetry dwell grew from 150 s to 390 s when the
  # flush cadence went 60 s -> 5 min, and a budget that was sized before that would have started
  # cutting off otherwise healthy runs.
  [int]$TimeoutSeconds = 2100,
  # Give up on the cloud half after this long (row appears + slice lands).
  [int]$CloudTimeoutSeconds = 600,
  # Give up on the telemetry leg after this long. The guest has ALREADY flushed by the time this
  # starts (it sits on the app for a full flush tick), so this is slack for the ingest + aggregate
  # and is not a function of the client's cadence.
  [int]$TelemetryTimeoutSeconds = 300,
  # The AWS profile the triage store authenticates with. Same default as the CLI.
  [string]$AwsProfile = 'eqc',
  # Leave the VM running after the results land (for poking at it by hand).
  [switch]$KeepOpen,
  # Leave the report row + slice in the backlog after a PASS (for looking at them).
  [switch]$NoCleanup
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'sandbox-lifecycle.ps1')

$sandboxDir = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $sandboxDir '..\..')).Path
$wsb = Join-Path $sandboxDir 'smoke-feedback.wsb'
$resultsDir = Join-Path $sandboxDir 'results'
$resultFile = Join-Path $resultsDir 'smoke-result.txt'
$nonceFile = Join-Path $resultsDir 'smoke-nonce.txt'
$mockLogFile = Join-Path $resultsDir 'smoke-log.txt'
$helper = Join-Path $repoRoot 'scripts\smoke-feedback.mts'

$verdict = New-Object System.Collections.Generic.List[object]
function Add-Verdict($stage, $ok, $detail) {
  $r = 'FAIL'
  # $null means SKIP - a stage that never ran is not a stage that failed.
  if ($null -eq $ok) { $r = 'SKIP' } elseif ($ok) { $r = 'PASS' }
  $verdict.Add([pscustomobject]@{ Stage = $stage; Result = $r; Detail = $detail })
}
function Show-Verdict($banner) {
  Write-Host ''
  Write-Host $banner
  $verdict | Format-Table -AutoSize | Out-String | Write-Host
}

Write-Host '=== post-release end-to-end feedback smoke test (Windows Sandbox + live cloud) ==='
Write-Host 'ON-DEMAND ONLY: this files a REAL report against the LIVE api and then deletes it.'

# --- 1. Pre-flight ------------------------------------------------------------------
if (-not (Test-Path $wsb)) { throw "missing harness config: $wsb" }
if (-not (Test-Path $helper)) { throw "missing cloud helper: $helper" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node is not on PATH - the host half synthesizes the log and reads the cloud through tsx'
}
# The .wsb carries ABSOLUTE HostFolder paths. A repo that moved would silently map somebody
# else's folder (or nothing), and the guest would sit there waiting for a nonce that never
# arrives - a 30-minute timeout instead of a one-line error.
$wsbText = Get-Content $wsb -Raw
if ($wsbText -notlike "*$repoRoot*") {
  throw "smoke-feedback.wsb maps a different repo path than $repoRoot - edit its HostFolder entries"
}
if (Stop-Sandbox) { Write-Host 'pre-flight: closed a stale Windows Sandbox instance' }

if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Path $resultsDir | Out-Null }
# Clear stale smoke artifacts ONLY - results/.gitkeep is tracked and the tier-2 harness's
# result.txt lives here too; don't nuke the folder.
Get-ChildItem $resultsDir -Filter 'smoke-*' -Force -ErrorAction SilentlyContinue |
  Remove-Item -Force -Confirm:$false

# --- 2. The nonce + the booby-trapped log --------------------------------------------
# Uppercase alphanumerics only: it is grepped by PowerShell, matched by a regex in the guest,
# embedded in EverQuest log lines, and searched for with a SQL-free `includes` on the far end.
$nonce = 'EQSMOKE' + ([guid]::NewGuid().ToString('N').Substring(0, 12)).ToUpper()
Write-Host "nonce: $nonce"
# Five minutes of slack so a host/cloud clock skew cannot put the row below the query floor.
$sinceMs = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) - 300000

& node --import tsx $helper gen-log --nonce $nonce --out $mockLogFile
if (-not (Test-Path $mockLogFile)) { throw "the log synthesizer wrote nothing to $mockLogFile" }
Set-Content -Path $nonceFile -Value $nonce -Encoding ascii
Add-Verdict 'mock log synthesized' $true (Split-Path -Leaf $mockLogFile)

# --- 3. Launch + park + wait ----------------------------------------------------------
Start-SandboxRun -Wsb $wsb -Minimize:$Minimize | Out-Null
$landed = Wait-SandboxResult -ResultFile $resultFile -TimeoutSeconds $TimeoutSeconds -Minimize:$Minimize

if (-not $KeepOpen) {
  if (Stop-Sandbox) { Write-Host 'teardown: sandbox closed' }
}
else { Write-Host 'teardown: -KeepOpen set, VM left running' }

if (-not $landed) {
  Add-Verdict 'guest run' $false "no $resultFile after $TimeoutSeconds s (harness never reported)"
  Show-Verdict 'RESULT: FAIL'
  exit 1
}

# --- 4. Read the guest's verdict ------------------------------------------------------
Write-Host ''
Write-Host '--- guest verdict ---'
$guest = @(Get-Content $resultFile)
$guest | ForEach-Object { Write-Host "  $_" }
$outcome = ''
$reportId = ''
$analyticsId = ''
foreach ($line in $guest) {
  if ($line -match '^OUTCOME:\s*(\S+)') { $outcome = $Matches[1] }
  if ($line -match '^REPORTID:\s*(\S+)') { $reportId = $Matches[1] }
  if ($line -match '^ANALYTICSID:\s*(\S+)') { $analyticsId = $Matches[1] }
}
$guestPass = ($guest -contains 'RESULT: PASS')
Add-Verdict 'guest run' $guestPass "outcome=$outcome reportId=$reportId"

if (-not $guestPass) {
  Add-Verdict 'cloud verification' $null 'skipped - the guest never filed a report'
  Show-Verdict 'RESULT: FAIL (guest). Nothing was cleaned up; read smoke-result.txt + smoke-stdout.txt.'
  exit 1
}

# THE KILL SWITCH IS ITS OWN VERDICT. `closed` means we reached the live API and it
# deliberately refused - the client half is proven and there is no row to verify. Reporting
# that as a failure would train the operator to ignore a red result they themselves caused.
if ($outcome -eq 'closed') {
  Add-Verdict 'cloud verification' $null 'skipped - the server answered `closed` (kill switch on)'
  Show-Verdict 'RESULT: CLOSED - plumbing proven, intake is PAUSED. Re-run after `triage-feedback closed off`.'
  exit 0
}

if ($outcome -ne 'sent') {
  Add-Verdict 'cloud verification' $null "skipped - outcome was '$outcome', not 'sent'"
  Show-Verdict "RESULT: FAIL - the app reported '$outcome'. Nothing was cleaned up."
  exit 1
}

# --- 5. The cloud half ----------------------------------------------------------------
Write-Host ''
Write-Host "--- cloud verification (AWS profile '$AwsProfile') ---"
$verifyArgs = @('--import', 'tsx', $helper, 'verify', '--nonce', $nonce, '--profile', $AwsProfile,
  '--since-ms', "$sinceMs", '--timeout-sec', "$CloudTimeoutSeconds")
if ($NoCleanup) { $verifyArgs += '--no-cleanup' }
& node $verifyArgs
$cloudOk = ($LASTEXITCODE -eq 0)
Add-Verdict 'cloud verification' $cloudOk 'row + env, slice present, nonce kept, chat scrubbed'
if (-not $cloudOk) {
  Add-Verdict 'cleanup' $null 'skipped - a failing run leaves the row + slice as evidence'
  Add-Verdict 'telemetry leg' $null 'skipped - the feedback half failed first'
  Show-Verdict 'RESULT: FAIL (cloud). The report row and its slice were LEFT IN PLACE for inspection.'
  exit 1
}
$cleaned = 'forgot the slice + wiped the install'
if ($NoCleanup) { $cleaned = '-NoCleanup: left in the backlog on purpose' }
Add-Verdict 'cleanup' $true $cleaned

# --- 6. The telemetry leg -------------------------------------------------------------
# The OTHER thing a released build does on its own. It runs AFTER the feedback checks and their
# cleanup, deliberately: the feedback half is the one that leaves a real row in a human's
# backlog, so it gets verified and tidied before anything else is attempted.
#
# THREE OUTCOMES, and the middle one is not a failure: with `telemetry_accepting` closed the
# server answers every batch 503, no row is ever created, and there is nothing to find. The
# helper reports LIT-BUT-CLOSED and exits 0 - the same treatment the feedback kill switch gets.
# Flipping that switch is the owner's decision; this harness never touches it.
if (-not $analyticsId) {
  Add-Verdict 'telemetry leg' $false 'the guest echoed no ANALYTICSID (see smoke-result.txt step 7)'
  Show-Verdict 'RESULT: FAIL (telemetry). The feedback half passed and was cleaned up.'
  exit 1
}
Write-Host ''
Write-Host "--- telemetry verification (analyticsId $analyticsId) ---"
$teleArgs = @('--import', 'tsx', $helper, 'verify-telemetry', '--analytics-id', $analyticsId,
  '--profile', $AwsProfile, '--timeout-sec', "$TelemetryTimeoutSeconds")
if ($NoCleanup) { $teleArgs += '--no-cleanup' }
$teleOut = & node $teleArgs 2>&1
$teleOut | ForEach-Object { Write-Host "  $_" }
$teleOk = ($LASTEXITCODE -eq 0)
$closed = @($teleOut | Where-Object { "$_" -match 'TELEMETRY-RESULT: LIT-BUT-CLOSED' }).Count -gt 0

if ($closed) {
  Add-Verdict 'telemetry leg' $null 'LIT-BUT-CLOSED - telemetry_accepting is off; no row to verify'
  Show-Verdict 'RESULT: PASS (feedback) + LIT-BUT-CLOSED (telemetry). Open intake with `analytics open` to verify it.'
  exit 0
}
if ($teleOk) {
  $wiped = 'install row wiped (counters are anonymous sums and stay)'
  if ($NoCleanup) { $wiped = '-NoCleanup: the analytics_install row was left in place' }
  Add-Verdict 'telemetry leg' $true "install row + session counter found; $wiped"
  Show-Verdict 'RESULT: PASS'
  exit 0
}
Add-Verdict 'telemetry leg' $false 'no install row / no session counter before the timeout'
Show-Verdict 'RESULT: FAIL (telemetry). The feedback half passed and was cleaned up; the analytics row (if any) was left in place.'
exit 1
