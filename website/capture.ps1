# Burst screen capture for the website screenshots: full primary display + every EQ Zera / eqgame
# window, every $Interval seconds for $Seconds seconds, into $Out. DPI-aware so captures are at
# physical resolution. Usage: powershell -File capture.ps1 -Seconds 240 -Interval 1.5
param([int]$Seconds = 240, [double]$Interval = 1.5, [string]$Out = "$env:TEMP\eqzera-shots")
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Native {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
[void][Native]::SetProcessDPIAware()
New-Item -ItemType Directory -Force $Out | Out-Null
$primary = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
function Grab([System.Drawing.Rectangle]$r, [string]$file) {
  if ($r.Width -le 0 -or $r.Height -le 0) { return }
  $bmp = New-Object System.Drawing.Bitmap $r.Width, $r.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Location, [System.Drawing.Point]::Empty, $r.Size)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$end = (Get-Date).AddSeconds($Seconds); $i = 0
while ((Get-Date) -lt $end) {
  $stamp = (Get-Date).ToString('HHmmss')
  Grab $primary (Join-Path $Out ("screen-{0:D3}-{1}.png" -f $i, $stamp))
  foreach ($p in (Get-Process | Where-Object { $_.ProcessName -in @('EQ Zera', 'eqgame') })) {
    $r = New-Object Native+RECT
    if ($p.MainWindowHandle -ne 0 -and [Native]::GetWindowRect($p.MainWindowHandle, [ref]$r)) {
      $rect = New-Object System.Drawing.Rectangle $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)
      $name = ($p.ProcessName + '-' + $p.MainWindowTitle) -replace '[^A-Za-z0-9]+', '-'
      Grab $rect (Join-Path $Out ("{0}-{1:D3}-{2}.png" -f $name, $i, $stamp))
    }
  }
  $i++
  Start-Sleep -Milliseconds ([int]($Interval * 1000))
}
"captured $i rounds into $Out"
