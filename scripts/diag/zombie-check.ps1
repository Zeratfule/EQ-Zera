# Zombie-process check: how many exited processes the kernel is still holding, and whether the leak is live.
# No admin needed. Run after a reboot (with a suspect driver disabled) to see whether the leak is gone.
#   powershell -ExecutionPolicy Bypass -File scripts\diag\zombie-check.ps1
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ZC {
  [DllImport("ntdll.dll")] public static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int ret);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static byte[] Query(int cls, int size) {
    int ret;
    for (;;) {
      IntPtr p = Marshal.AllocHGlobal(size);
      try {
        int st = NtQuerySystemInformation(cls, p, size, out ret);
        if (st == 0) { byte[] b = new byte[ret > 0 ? ret : size]; Marshal.Copy(p, b, 0, b.Length); return b; }
        if ((uint)st != 0xC0000004u) throw new Exception("NtQuerySystemInformation status 0x" + st.ToString("X"));
        size = (ret > size ? ret : size * 2) + (1 << 20);
      } finally { Marshal.FreeHGlobal(p); }
    }
  }
}
"@
function Get-PoolTag([string]$tag) {
  $pt = [ZC]::Query(22, 4MB)
  $count = [BitConverter]::ToUInt32($pt, 0)
  for ($i = 0; $i -lt $count; $i++) {
    $b = 8 + $i*40
    if ([Text.Encoding]::ASCII.GetString($pt, $b, 4) -eq $tag) {
      return [pscustomobject]@{
        Outstanding = [BitConverter]::ToUInt32($pt, $b+24) - [BitConverter]::ToUInt32($pt, $b+28)
        NonPagedMB  = [math]::Round([BitConverter]::ToUInt64($pt, $b+32) / 1MB, 1)
      }
    }
  }
}
$os = Get-CimInstance Win32_OperatingSystem
$up = (Get-Date) - $os.LastBootUpTime
$proc = Get-PoolTag 'Proc'
$liveCount = (Get-Process).Count
"Uptime {0:d\.hh\:mm}; live processes {1}; kernel process objects {2:N0} ({3} MB nonpaged)" -f $up, $liveCount, $proc.Outstanding, $proc.NonPagedMB
"Zombies (objects minus live): {0:N0}" -f ($proc.Outstanding - $liveCount)
"Free memory: {0:N0} MB of {1:N0} MB" -f ($os.FreePhysicalMemory/1KB), ($os.TotalVisibleMemorySize/1KB)

# Live test: spawn 50 processes that exit at once; a healthy kernel releases them within a few seconds.
$before = (Get-PoolTag 'Proc').Outstanding
$pids = @()
for ($i = 0; $i -lt 50; $i++) {
  $p = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" -ArgumentList '/c','exit' -WindowStyle Hidden -PassThru
  $p.WaitForExit(); $pids += $p.Id; $p.Dispose()
}
Start-Sleep -Seconds 4
$after = (Get-PoolTag 'Proc').Outstanding
$openable = 0
foreach ($id in $pids) {
  $h = [ZC]::OpenProcess(0x1000, $false, [uint32]$id)
  if ($h -ne [IntPtr]::Zero) { $openable++; [void][ZC]::CloseHandle($h) }
}
"Spawn test: 50 exited processes, {0} still held by the kernel; Proc objects {1:N0} -> {2:N0}" -f $openable, $before, $after
if ($openable -gt 5) { "RESULT: LEAK STILL PRESENT" } else { "RESULT: no leak" }
