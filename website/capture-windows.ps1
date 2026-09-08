# Capture every visible top-level window of the EQ Zera process (main window, overlays), by
# window title, every $Interval seconds for $Seconds seconds. DPI-aware, works across displays.
# Usage: powershell -File capture-windows.ps1 -Seconds 120 -Interval 2
param([int]$Seconds = 120, [double]$Interval = 2, [string]$Out = "$env:TEMP\eqzera-windows")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public static List<object[]> List(uint pid) {
    var o = new List<object[]>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h); var sb = new StringBuilder(n + 1); GetWindowText(h, sb, n + 1);
      RECT r; GetWindowRect(h, out r);
      o.Add(new object[] { sb.ToString(), r.L, r.T, r.R - r.L, r.B - r.T });
      return true;
    }, IntPtr.Zero);
    return o;
  }
}
"@
[void][Win]::SetProcessDPIAware()
New-Item -ItemType Directory -Force $Out | Out-Null
$end = (Get-Date).AddSeconds($Seconds); $i = 0
while ((Get-Date) -lt $end) {
  foreach ($p in (Get-Process -Name 'EQ Zera' -ErrorAction SilentlyContinue)) {
    foreach ($w in [Win]::List([uint32]$p.Id)) {
      $title, $x, $y, $wd, $ht = $w
      if ($wd -lt 200 -or $ht -lt 100) { continue }
      $bmp = New-Object System.Drawing.Bitmap $wd, $ht
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $wd, $ht))
      $name = ($title -replace '[^A-Za-z0-9]+', '-').Trim('-'); if (-not $name) { $name = 'untitled' }
      $bmp.Save((Join-Path $Out ("{0}-{1:D3}-{2}.png" -f $name, $i, (Get-Date).ToString('HHmmss'))), [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose()
    }
  }
  $i++; Start-Sleep -Milliseconds ([int]($Interval * 1000))
}
"captured $i rounds into $Out"
