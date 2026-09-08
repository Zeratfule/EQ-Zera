# sandbox-lifecycle.ps1 - the shared HOST-side Windows Sandbox lifecycle.
#
# DOT-SOURCE THIS, never run it: it defines functions and nothing else.
#
#   . (Join-Path $PSScriptRoot 'sandbox-lifecycle.ps1')
#
# EXTRACTED VERBATIM from run-installer-test.ps1 when a SECOND harness needed the same four
# hard-won behaviours. They were learned the hard way once and there must be exactly one copy:
#
#   1. SINGLE-INSTANCE GUARD. Only ONE Windows Sandbox instance is allowed machine-wide; a
#      leftover VM makes the next launch fail with "Only one running instance of Windows
#      Sandbox is allowed". So every run force-closes a stale client first.
#   2. FORCE TEARDOWN. Both graceful paths (an in-guest shutdown, closing the window) raise a
#      modal confirmation ON THE HOST DESKTOP. The user is gaming there. Kill the process.
#   3. OFF-PRIMARY PARKING. The VM window is moved to the first NON-PRIMARY monitor and pushed
#      to the bottom of the z-order WITHOUT stealing focus (SWP_NOACTIVATE). Single-monitor
#      machines minimize instead. The primary monitor stays clear.
#   4. RE-ASSERTED PLACEMENT. The VM window likes to re-raise itself, so the results poll
#      re-parks it on every tick rather than placing it once and hoping.
#
# ASCII only. These files sit beside guest scripts that MUST be ASCII (the sandbox runs Windows
# PowerShell 5.1, which reads a BOM-less .ps1 as ANSI and dies on a stray non-ASCII byte); one
# rule for the whole folder is easier to keep than two.

Add-Type -AssemblyName System.Windows.Forms | Out-Null
if (-not ('EqSandboxWin32' -as [type])) {
  Add-Type -Namespace '' -Name 'EqSandboxWin32' -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
'@
}
$HWND_BOTTOM = [IntPtr]1
$SWP_NOACTIVATE = 0x0010
$SWP_NOOWNERZORDER = 0x0200
$SW_SHOWMINNOACTIVE = 7

function Stop-Sandbox {
  # Force-kill: the graceful paths (in-guest shutdown, window close) both raise a modal
  # confirmation on the host desktop, which is exactly what we are avoiding.
  $procs = @(Get-Process -Name 'WindowsSandbox*' -ErrorAction SilentlyContinue)
  if (-not $procs.Count) { return $false }
  foreach ($p in $procs) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch {} }
  Start-Sleep -Seconds 6
  return $true
}

function Get-SandboxWindow {
  $p = Get-Process -Name 'WindowsSandboxClient' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  return $p
}

function Set-SandboxPlacement {
  param([Parameter(Mandatory = $true)][IntPtr]$Hwnd, [switch]$Minimize)
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $target = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
  if ($Minimize -or $null -eq $target) {
    [EqSandboxWin32]::ShowWindow($Hwnd, $SW_SHOWMINNOACTIVE) | Out-Null
    return 'minimized'
  }
  $b = $target.WorkingArea
  [EqSandboxWin32]::SetWindowPos($Hwnd, $HWND_BOTTOM, $b.X, $b.Y, $b.Width, $b.Height,
    ($SWP_NOACTIVATE -bor $SWP_NOOWNERZORDER)) | Out-Null
  return "parked on $($target.DeviceName) at $($b.X),$($b.Y) ($($b.Width)x$($b.Height)), z-order bottom"
}

# Launch a .wsb and park its window. Returns $true when the window was found and placed;
# $false means we never saw it, which is a warning and not a reason to stop waiting.
function Start-SandboxRun {
  param([Parameter(Mandatory = $true)][string]$Wsb, [switch]$Minimize)
  Start-Process -FilePath "$env:SystemRoot\System32\WindowsSandbox.exe" -ArgumentList $Wsb
  Write-Host "launched $(Split-Path -Leaf $Wsb) at $(Get-Date -Format o)"
  for ($i = 0; $i -lt 60; $i++) {
    $proc = Get-SandboxWindow
    if ($proc) {
      Write-Host "placement: $(Set-SandboxPlacement -Hwnd $proc.MainWindowHandle -Minimize:$Minimize)"
      return $true
    }
    Start-Sleep -Seconds 1
  }
  Write-Warning 'sandbox window never appeared - continuing to wait for results anyway'
  return $false
}

# Poll for the mapped results file, re-asserting placement on every tick. Returns $true if the
# file appeared. The extra 2 s after it does is for the guest's write to settle - a mapped
# folder is a network redirector, and a half-written verdict reads as a corrupt one.
function Wait-SandboxResult {
  param(
    [Parameter(Mandatory = $true)][string]$ResultFile,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
    [switch]$Minimize
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $ResultFile) { Start-Sleep -Seconds 2; return $true }
    $proc = Get-SandboxWindow
    if ($proc) { Set-SandboxPlacement -Hwnd $proc.MainWindowHandle -Minimize:$Minimize | Out-Null }
    Start-Sleep -Seconds 3
  }
  return $false
}
