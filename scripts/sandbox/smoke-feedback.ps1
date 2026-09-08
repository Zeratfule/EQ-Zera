# smoke-feedback.ps1 - runs INSIDE Windows Sandbox (invoked by smoke-feedback.wsb's
# LogonCommand). The GUEST half of the post-release end-to-end feedback smoke test.
#
# ON-DEMAND ONLY, after a release. Do not launch this .wsb directly and do not wire it into
# CI: it downloads the PUBLISHED installer and files a REAL bug report against the LIVE
# ingest API. Run it through the host wrapper:
#   npm run smoke:release      (scripts\sandbox\run-smoke-feedback.ps1)
# which generates the nonce, writes the mocked log, drives this VM, and then verifies + cleans
# up the row and the slice in the cloud.
#
# WHAT THIS PROVES that the tier-2 installer test cannot: that a machine which has only ever
# seen the PUBLISHED artifact can carry a user's bug report all the way to the operator's
# backlog - through the shipped validator, the live quota, the live kill switch, the presign,
# and the bucket pin - and that the log slice which arrives has been SCRUBBED. The host proves
# the far end; this script proves the near end and hands over one machine-readable outcome.
#
# AND, SINCE THE TELEMETRY CLIENT WAS LIT, a second leg: the same installed build, launched
# plainly and left running, must send its anonymous usage counts to the live ingest route. The
# guest hands the host the app's own analyticsId; the host looks for it in analytics_install,
# checks the counters moved, and then deletes that row. See step 7.
#
# THE HANDSHAKE with the host, over the one read-write mapped folder (C:\results):
#   host -> guest   smoke-nonce.txt   the run's nonce, one line
#                   smoke-log.txt     the synthesized EverQuest log (scripts/smokeLog.mts)
#   guest -> host   smoke-result.txt  the verdict, incl. OUTCOME:, REPORTID: and ANALYTICSID:
#                   smoke-stdout.txt  the app's captured stdout (kept for diagnosis)
#
# ASCII ONLY. The sandbox runs Windows PowerShell 5.1, which reads a BOM-less .ps1 as ANSI; a
# stray non-ASCII character inside a string is a parse error there and the whole harness dies
# before it can test anything.
#
# HARNESS RULES (inherited from installer-test.ps1, and they still apply):
#  * smoke-result.txt is written from a finally block - a harness that dies silently looks
#    exactly like a hung VM from the host side. Always leave a verdict behind.
#  * Teardown is the HOST launcher's job. Shutting the guest down from in here pops a modal on
#    the host desktop.

$ErrorActionPreference = 'Continue'
$result = 'C:\results\smoke-result.txt'
$stdoutFile = 'C:\results\smoke-stdout.txt'
$stderrFile = 'C:\results\smoke-stderr.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Log($m) { $lines.Add($m); Write-Host $m }
$pass = $true
function Check($name, $ok, $detail = '') {
  if ($ok) { Log "PASS  $name $detail" }
  else { Log "FAIL  $name $detail"; $script:pass = $false }
}

# The published release's PERMANENT links. The versioned asset carries the version in its
# filename and so cannot be hard-coded anywhere; build.yml uploads a byte copy under the
# stable name for exactly this reason (it is what the website's Download button uses too).
$releaseBase = 'https://github.com/jmoyers/everquest-companion/releases/latest/download'
$setupName = 'everquest-companion-Setup.exe'
$sumsName = 'SHA256SUMS.txt'

# EverQuest's canonical install root (src/main/log/discovery.ts EQ_ROOT). Planting the mocked
# log HERE is what makes the app's own discovery - drive sweep, no override, no env var - find
# a character to tail, exactly as it would on a real player's machine.
$eqLogsDir = 'C:\Users\Public\Daybreak Game Company\Installed Games\EverQuest Legends\Logs'
$eqLogName = 'eqlog_Smoketest_freeport.txt'

$appProcName = 'EQ Legends Companion'
$nonce = ''
$outcome = 'error'
$reportId = ''
# The anonymous usage-analytics id the installed app minted for itself, echoed to the host.
$analyticsId = ''
# How long the second (plain) launch is left running, and it is the ONE number in this file that
# is a function of the client's flush cadence - nothing leaves the machine except on a flush tick
# (stopTelemetry writes sessionEnd to the ring, it does not POST), so a dwell shorter than one
# tick makes this leg fail every single run.
#
# JOS-269 took the cadence 60 s -> 5 min. The old 150 s was two 60 s ticks plus slack; left alone
# it would now catch ZERO ticks. This is ONE tick (300 s) plus 90 s of slack for a cold VM's
# start-up and timer drift. Deliberately not two ticks: a second one would add ten minutes to
# every release smoke to re-prove what the first already proved, and the host still polls on top
# of this for the ingest + aggregate.
$telemetryDwellSec = 390

try {
  Log '=== everquest-companion post-release feedback smoke test (guest) ==='
  Log "time: $(Get-Date -Format o)"
  Log "host: $env:COMPUTERNAME (sandbox)"

  # PS 5.1 negotiates SSL3/TLS1.0 by default; GitHub answers TLS1.2+ only, so without this
  # every download below fails with a bare "could not create SSL/TLS secure channel".
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  # Invoke-WebRequest's progress bar makes a 100 MB download take minutes in a VM.
  $ProgressPreference = 'SilentlyContinue'

  # 1. The nonce, handed over by the host through the mapped folder.
  if (-not (Test-Path 'C:\results\smoke-nonce.txt')) {
    Check 'nonce-received' $false 'C:\results\smoke-nonce.txt is missing - launch via run-smoke-feedback.ps1'
    return
  }
  $nonce = (Get-Content 'C:\results\smoke-nonce.txt' -Raw).Trim()
  Check 'nonce-received' ($nonce.Length -gt 0) "($nonce)"
  if ($nonce.Length -eq 0) { return }

  # 2. Plant the mocked log. The host SYNTHESIZED it (scripts/smokeLog.mts, one generator,
  #    unit-tested against the real shared scrub); the guest only copies it into place,
  #    because this VM has no Node and a second PowerShell generator would be a second thing
  #    to keep honest.
  if (-not (Test-Path 'C:\results\smoke-log.txt')) {
    Check 'mock-log-available' $false 'C:\results\smoke-log.txt is missing - the host did not generate it'
    return
  }
  New-Item -ItemType Directory -Path $eqLogsDir -Force | Out-Null
  $eqLog = Join-Path $eqLogsDir $eqLogName
  Copy-Item 'C:\results\smoke-log.txt' $eqLog -Force
  $planted = Test-Path $eqLog
  $lineCount = 0
  if ($planted) { $lineCount = (Get-Content $eqLog | Measure-Object -Line).Lines }
  Check 'mock-log-planted' $planted "($eqLog, $lineCount lines)"
  if (-not $planted) { return }

  # 3. Download the PUBLISHED installer + the published checksums.
  $sums = Join-Path $env:TEMP $sumsName
  $setup = Join-Path $env:TEMP $setupName
  try {
    Invoke-WebRequest -Uri "$releaseBase/$sumsName" -OutFile $sums -UseBasicParsing
  } catch { Log "download error ($sumsName): $($_.Exception.Message)" }
  Check 'checksums-downloaded' (Test-Path $sums) "$releaseBase/$sumsName"
  try {
    Invoke-WebRequest -Uri "$releaseBase/$setupName" -OutFile $setup -UseBasicParsing
  } catch { Log "download error ($setupName): $($_.Exception.Message)" }
  Check 'installer-downloaded' (Test-Path $setup) "$releaseBase/$setupName"
  if (-not (Test-Path $setup) -or -not (Test-Path $sums)) { return }
  Log "installer: $([math]::Round((Get-Item $setup).Length / 1MB, 1)) MB"

  # 3b. VERIFY BEFORE RUNNING IT. SHA256SUMS.txt is published per release for humans who click
  #     the website's Download button and get no signature check on the way in; this harness is
  #     one of those humans. Lines are "<hex>  <name>" (two spaces, GNU sha256sum format).
  $want = ''
  foreach ($line in (Get-Content $sums)) {
    $m = [regex]::Match($line, '^([0-9a-fA-F]{64})\s+(.+)$')
    if ($m.Success -and $m.Groups[2].Value.Trim() -eq $setupName) { $want = $m.Groups[1].Value.ToLower() }
  }
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash.ToLower()
  Check 'installer-sha256-listed' ($want.Length -eq 64) "(SHA256SUMS.txt names $setupName)"
  Check 'installer-sha256-matches' ($want -eq $got) "(want $want, got $got)"
  if ($want -ne $got) { return }

  # 4. Silent install (NSIS /S), same as the tier-2 harness.
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  Check 'installer-exit-0' ($p.ExitCode -eq 0) "(exit $($p.ExitCode))"
  Start-Sleep -Seconds 5
  $installDir = Join-Path $env:LOCALAPPDATA 'Programs\everquest-companion'
  $exe = Join-Path $installDir 'EQ Legends Companion.exe'
  Check 'app-exe-exists' (Test-Path $exe) $exe
  if (-not (Test-Path $exe)) { return }

  # 4b. The one-click installer is configured runAfterFinish, so the install may have LAUNCHED
  #     the app already. That instance holds the per-channel single-instance lock, and our
  #     env-armed launch below would see the lock taken and quit immediately without ever
  #     filing anything (src/main/index.ts). Reap it first.
  $stray = @(Get-Process -Name $appProcName -ErrorAction SilentlyContinue)
  if ($stray.Count) {
    Log "reaping $($stray.Count) auto-launched instance(s) so the smoke launch gets the single-instance lock"
    foreach ($s in $stray) { try { Stop-Process -Id $s.Id -Force -ErrorAction Stop } catch {} }
    Start-Sleep -Seconds 4
  }

  # 5. THE ACTUAL TEST. Launch the INSTALLED exe with EQ_SMOKE_FEEDBACK set; the hook in
  #    src/main/smokeFeedback.ts files one bug report through the ordinary submit path and
  #    quits. Electron on Windows is a GUI-subsystem binary with no attached console, so the
  #    only way to read its stdout is to hand it a real handle - which -RedirectStandardOutput
  #    does.
  $env:EQ_SMOKE_FEEDBACK = $nonce
  Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
  $app = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
  Check 'app-launched' ($null -ne $app) "(pid $($app.Id))"
  Wait-Process -Id $app.Id -Timeout 300 -ErrorAction SilentlyContinue
  $stillUp = Get-Process -Id $app.Id -ErrorAction SilentlyContinue
  Check 'app-exited-after-submit' ($null -eq $stillUp) '(the hook quits once the submit resolves)'
  if ($stillUp) { try { Stop-Process -Id $app.Id -Force -ErrorAction Stop } catch {} }
  Start-Sleep -Seconds 2

  # 6. Relay the hook's one machine-readable line.
  $captured = @()
  if (Test-Path $stdoutFile) { $captured = @(Get-Content $stdoutFile) }
  $hit = $captured | Where-Object { $_ -like 'EQ_SMOKE_RESULT*' } | Select-Object -Last 1
  Check 'smoke-result-line-found' ($null -ne $hit) "($($captured.Count) stdout line(s) captured)"
  if ($null -eq $hit) { return }
  Log "app said: $hit"
  $mo = [regex]::Match($hit, 'outcome=(\w+)')
  if ($mo.Success) { $outcome = $mo.Groups[1].Value }
  $mr = [regex]::Match($hit, 'reportId=(\S*)')
  if ($mr.Success) { $reportId = $mr.Groups[1].Value }
  $mn = [regex]::Match($hit, 'nonce=(\S+)')
  Check 'smoke-nonce-echoed' ($mn.Success -and $mn.Groups[1].Value -eq $nonce) "(app echoed '$($mn.Groups[1].Value)')"

  # 'sent' is the pass. 'closed' is the SERVER's kill switch - the plumbing worked and the
  # operator has paused intake; that is not this harness's failure and the HOST reports it as
  # its own verdict, so it is not marked FAIL here either.
  Check 'submit-outcome' ($outcome -eq 'sent' -or $outcome -eq 'closed') "(outcome=$outcome)"
  Check 'report-id-present' ($outcome -ne 'sent' -or $reportId.Length -gt 0) "(reportId=$reportId)"

  # 7. THE TELEMETRY LEG. The feedback half above proves one deliberate Send; this proves the
  #    other thing a released build does on its own - anonymous usage counts, on a 60 s timer.
  #
  #    WHY A SECOND LAUNCH: the smoke hook quits the app the moment the submit resolves, which
  #    is seconds. A flush tick is 60 s. So the app is started again, PLAINLY - no env var, no
  #    hook, nothing armed - and simply left running the way a player leaves it running.
  #
  #    WHY THE SETTINGS PATCH: nothing may be transmitted before the first-run notice has been
  #    seen, and `noticeShown` is set by exactly one thing - a click on that bar. There is no
  #    human in this VM to click it. So the guest answers it the way a user would, in the file
  #    the user's click would have written, BETWEEN the two launches. This does not bypass the
  #    consent gate, it SATISFIES it: the gate itself (and the fact that the app is silent until
  #    it is satisfied) is proven by tests/telemetryNet.test.mts and tests/e2e/telemetry.e2e.mts,
  #    which is where a gate belongs - here we are testing the wire.
  #
  #    NON-FATAL BY DESIGN: these checks do not touch $pass. A telemetry problem must not make
  #    the host skip the feedback cloud verification (which would also skip its cleanup and
  #    leave a real report row behind). The host reads ANALYTICSID: and renders this leg's
  #    verdict as its own line.
  $store = Join-Path $env:APPDATA 'everquest-companion\everquest-companion-progress.json'
  if (-not (Test-Path $store)) {
    Log "FAIL  telemetry-store-found ($store is missing - the app never wrote its settings)"
    return
  }
  Log "PASS  telemetry-store-found ($store)"
  try {
    # Patch by TARGETED REPLACEMENT, never a JSON round-trip, and write BOM-FREE. PS 5.1's
    # Set-Content -Encoding utf8 stamps a BOM; electron-store then treats the file as corrupt
    # on the next launch and regenerates defaults - a FRESH analyticsId and noticeShown=false,
    # so the relaunch collects and honorably never sends. Measured on this leg's first real
    # run: the guest echoed one id, the app minted another, the host found neither.
    $raw = [System.IO.File]::ReadAllText($store)
    $before = ($raw | ConvertFrom-Json)
    $id = $before.telemetry.analyticsId
    $patched = $raw -replace '"noticeShown"\s*:\s*false', '"noticeShown": true'
    [System.IO.File]::WriteAllText($store, $patched, (New-Object System.Text.UTF8Encoding($false)))
    $check = ([System.IO.File]::ReadAllText($store) | ConvertFrom-Json)
    if (-not $check.telemetry.noticeShown) { throw 'noticeShown did not patch' }
    if ($check.telemetry.analyticsId -ne $id) { throw 'analyticsId changed during the patch' }
    Log 'PASS  telemetry-notice-answered (noticeShown=true, id preserved, BOM-free)'
  } catch {
    Log "FAIL  telemetry-notice-answered ($($_.Exception.Message))"
    return
  }

  Remove-Item Env:\EQ_SMOKE_FEEDBACK -ErrorAction SilentlyContinue
  $tele = Start-Process -FilePath $exe -PassThru
  Log "telemetry: app relaunched (pid $($tele.Id)); leaving it up $telemetryDwellSec s for the 5 min flush"
  Start-Sleep -Seconds $telemetryDwellSec
  $up = Get-Process -Id $tele.Id -ErrorAction SilentlyContinue
  if ($up) { Log 'PASS  telemetry-app-stayed-up' } else { Log 'FAIL  telemetry-app-stayed-up (it exited early)' }
  try { Stop-Process -Id $tele.Id -Force -ErrorAction Stop } catch {}
  Start-Sleep -Seconds 3

  # The anonymous id the app minted for itself. The HOST looks for exactly this id in
  # analytics_install, and then deletes that row - the whole per-id footprint of the feature.
  try {
    $after = Get-Content $store -Raw | ConvertFrom-Json
    $analyticsId = [string]$after.telemetry.analyticsId
  } catch {
    $analyticsId = ''
  }
  if ($analyticsId -match '^[0-9a-fA-F-]{36}$') { Log "PASS  telemetry-analytics-id ($analyticsId)" }
  else { Log "FAIL  telemetry-analytics-id (got '$analyticsId')" }
}
catch {
  Check 'harness-completed' $false "unhandled error: $($_.Exception.Message)"
}
finally {
  Log ''
  Log "NONCE: $nonce"
  Log "OUTCOME: $outcome"
  Log "REPORTID: $reportId"
  # Empty when the telemetry leg never got that far - the host renders that as its own verdict
  # rather than as a feedback failure.
  Log "ANALYTICSID: $analyticsId"
  if ($pass) { Log 'RESULT: PASS' } else { Log 'RESULT: FAIL' }
  try { Set-Content -Path $result -Value ($lines -join "`r`n") } catch { Write-Host "could not write ${result}: $_" }
}
