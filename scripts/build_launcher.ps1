# Builds "Sir Jasper AI.exe" (icon embedded) in the project root and a Desktop shortcut. Re-run after moving the project folder.
$root = Split-Path $PSScriptRoot -Parent
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$icon = Join-Path $root 'desktop\icon.ico'
if (-not (Test-Path $icon)) { & (Join-Path $PSScriptRoot 'make_icon.ps1') }
$exe = Join-Path $root 'Sir Jasper AI.exe'
& $csc /nologo /target:winexe /optimize+ "/win32icon:$icon" "/out:$exe" (Join-Path $PSScriptRoot 'launcher.cs')
if (-not (Test-Path $exe)) { throw 'compile failed' }
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Sir Jasper AI.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $exe; $s.WorkingDirectory = $root; $s.IconLocation = $icon; $s.Description = 'Sir Jasper AI'; $s.Save()
Write-Host "built $exe and shortcut $lnk"
