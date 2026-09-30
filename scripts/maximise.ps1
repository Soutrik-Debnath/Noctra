<#
  Maximise the app's main window, for the screenshot pass.

  Matching by title is not available: while a track plays, the window is titled `Track - Artist` on
  purpose (that is what alt-tab and the taskbar preview show), so a `-Title Noctra` search finds the
  card and maximises the wrong window. The process id is stable and unique to this app.

  Usage: powershell -File scripts/maximise.ps1 -AppPid 2656
#>
param(
  [Parameter(Mandatory = $true)][int]$AppPid,
  [string]$SkipTitle = "Noctra Mini"
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class M {
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool Callback(IntPtr h, IntPtr l);
}
"@

$targets = New-Object System.Collections.Generic.List[IntPtr]
$cb = {
  param($h, $l)
  $owned = [uint32]0
  [void][M]::GetWindowThreadProcessId($h, [ref]$owned)
  if ($owned -eq [uint32]$AppPid -and [M]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][M]::GetWindowText($h, $sb, 256)
    if ($sb.ToString() -ne $SkipTitle) { [void]$script:targets.Add($h) }
  }
  return $true
}
[void][M]::EnumWindows($cb, [IntPtr]::Zero)
if ($targets.Count -eq 0) { Write-Error "no visible window owned by pid $AppPid"; exit 2 }
foreach ($h in $targets) { [void][M]::ShowWindow($h, 3) }  # 3 = SW_MAXIMIZE
Write-Output "maximised $($targets.Count) window(s) of pid $AppPid"
