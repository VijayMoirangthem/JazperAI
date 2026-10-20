# Registers the daily Jasper backup (current user, no admin needed). Runs scripts\backup_minio.py at 03:00; if the PC was off or asleep it runs
# as soon as possible afterwards (StartWhenAvailable). Remove with:  Unregister-ScheduledTask -TaskName "Jasper Backup" -Confirm:$false
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"
$script = Join-Path $root "scripts\backup_minio.py"
$action = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Jasper Backup" -Action $action -Trigger $trigger -Settings $settings -Description "Encrypted Postgres/Redis backup to MinIO with hash verification (Plan V3 W7)" -Force | Out-Null
Get-ScheduledTask -TaskName "Jasper Backup" | Select-Object TaskName, State | Format-Table -HideTableHeaders
