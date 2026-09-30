<#
  Photograph a window where it actually sits, instead of what its webview thinks it painted.

  The desktop card is a transparent, borderless, always-on-top window: its own webview surface comes
  back with the glass areas empty, which erases the one thing the card is — a blur of whatever is
  behind it. A screen grab of the region keeps the backdrop, so the capture shows the card floating
  over the app the way it looks on a real desktop.

  Usage: powershell -File scripts/grab-window.ps1 -Title 'Noctra Mini' -Out docs/screenshots/06-mini.png
         -Hover      parks the real cursor in the middle of the region first, which is what triggers
                     the card's grow-on-hover state. A CDP synthetic pointer would not: the window is
                     a different process, and the hover is a CSS :hover on the card itself.
#>
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Margin = 0,
  [switch]$Hover,
  # Where the cursor parks, as an offset from the grabbed region's top-left. The centre is a lyric
  # line, which raises the "Play from here" tooltip instead of the card's artwork growth.
  [int]$HoverX = -1,
  [int]$HoverY = -1,
  [switch]$Center
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][Win]::SetProcessDPIAware()

$hwnd = [IntPtr]::Zero
$found = {
  param($h, $l)
  $sb = New-Object System.Text.StringBuilder 256
  [void][Win]::GetWindowText($h, $sb, 256)
  if ($sb.ToString() -eq $Title -and [Win]::IsWindowVisible($h)) {
    $script:hwnd = $h
    return $false
  }
  return $true
}
[void][Win]::EnumWindows($found, [IntPtr]::Zero)
if ($hwnd -eq [IntPtr]::Zero) { Write-Error "no visible window titled '$Title'"; exit 2 }

$rect = New-Object Win+RECT
[void][Win]::GetWindowRect($hwnd, [ref]$rect)

if ($Center) {
  # Park the card over the middle of the screen so the grab has the app behind it rather than the
  # desktop, and so a second run lands in the same place. Screen bounds, not WMI: querying the video
  # controller threw ArgumentNullException on a machine with more than one display entry.
  Add-Type -AssemblyName System.Windows.Forms
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
  $sx = [int]($b.Width / 2 - $w / 2)
  $sy = [int]($b.Height / 2 - $h / 2)
  [void][Win]::MoveWindow($hwnd, $sx, $sy, $w, $h, $true)
  Start-Sleep -Milliseconds 500
  [void][Win]::GetWindowRect($hwnd, [ref]$rect)
}

$x = $rect.Left - $Margin
$y = $rect.Top - $Margin
$w = ($rect.Right - $rect.Left) + 2 * $Margin
$h = ($rect.Bottom - $rect.Top) + 2 * $Margin

if ($Hover) {
  $hx = if ($HoverX -ge 0) { $x + $HoverX } else { $x + $w / 2 }
  $hy = if ($HoverY -ge 0) { $y + $HoverY } else { $y + $h / 2 }
  [void][Win]::SetCursorPos([int]$hx, [int]$hy)
  # The grow transition runs on --ease-out over ~420ms; shorter and the frame catches it mid-scale.
  Start-Sleep -Milliseconds 900
}

$bmp = New-Object System.Drawing.Bitmap([int]$w, [int]$h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([int]$x, [int]$y, 0, 0, (New-Object System.Drawing.Size([int]$w, [int]$h)))
# Save() takes a literal path; resolving it relative to whatever the caller's CWD happened to be is
# what made a failed grab look like a successful one, because the script still printed its size line.
if (-not [System.IO.Path]::IsPathRooted($Out)) { Write-Error "-Out must be an absolute path"; exit 3 }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "$Out  ${w}x${h}  hwnd=$hwnd"
