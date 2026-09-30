$exe = 'D:\Noctra Project\src-tauri\target\debug\noctra.exe'
$si = New-Object System.Diagnostics.ProcessStartInfo
$si.FileName = $exe
$si.WorkingDirectory = 'D:\Noctra Project'
$si.UseShellExecute = $false
$si.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9223'
$p = [System.Diagnostics.Process]::Start($si)
Write-Output "started pid=$($p.Id)"
