# Running Jazper day to day

## Start
Double-click `start.bat`. It stops anything stale, starts PostgreSQL/Redis/MinIO (Docker), applies database migrations, starts the
backend (`scripts/run_backend.bat`) and the app (Vite, http://localhost:5173), waits until both answer, then opens the browser.
Nothing else needs doing. Re-run it after editing backend `.py` files or installing packages.

## Self-healing
* **Backend crash or kill:** `run_backend.bat` restarts it after 3 seconds (verified by killing the process).
* **Google login:** a keep-alive checks every 30 minutes (and 45 s after start) that Google still accepts the saved login. If it was
  revoked or expired, you get a notification and the Google sign-in page opens by itself, pre-filled with your account; click
  **Continue** once and the tab closes itself. It opens at most once per 12 hours. Disable the auto-open with
  `GOOGLE_AUTO_RECONNECT=0` in `backend/python/.env`.
* **Chat when Google is down:** Jazper shows a Reconnect card and a plain sentence, never a raw API error.

## Why Google logins expire, and the one-time fix
Google must be given consent by the account owner, so the click above cannot be automated. It only recurs weekly if the Google Cloud
OAuth app is in **Testing** status (Google expires those logins after 7 days; likely, not confirmed). Permanent fix, done once in the
Google Cloud Console: APIs & Services -> OAuth consent screen -> **Publish app** (In production). For a personal app with only your own
account you can ignore the "unverified app" warning (Advanced -> Continue). After that the login lasts until you revoke it.

## Email
Ask in chat ("latest emails today", "any email from X?", "show me the full email from X about Y"). To write a proper reply with
attachments, use the Gmail panel (compose/reply). Replying by chat works through the `send_email` tool.

## Phone, away from home (own ecosystem: Tailscale, no third party)
* **Both devices on the same Tailscale account**, PC on and signed in to Windows. The PC address never changes:
  `https://vjpc.tail283cae.ts.net` (`tailscale serve` is saved and Tailscale is a Windows service that starts by itself).
* **Alerts:** the phone app runs a small foreground service ("Jasper is listening") that keeps one long-poll open to
  `/remote/v1/events`. New notifications (mail, runs, ...) and Tier-2/3 approvals arrive as normal Android notifications within seconds.
  No Google/Expo/Telegram push service is involved. It restarts when the app is opened (it does not start by itself after a phone
  reboot). On some phones (OnePlus, Xiaomi) set **Battery -> Jasper -> Unrestricted** so the system does not stop it.
* **Voice conversation:** Settings -> *Voice conversation* (or the chat menu) lets you talk and hear the answer. Speech is transcribed
  with language auto-detection (English, Hindi, Hinglish) and each reply is spoken in a matching voice (Hindi voice for Devanagari,
  an Indian-English voice for Hinglish, the bot's own voice for English).
* **Approvals:** Tier 2 can be answered with a tap; Tier 3 needs the biometric prompt (the app releases the device secret only after it).
  Rejecting never needs it.
* **After a PC restart:** Docker Desktop and Tailscale start by themselves, but the **backend does not** unless you run `start.bat`
  (or enable the optional sign-in task below). Until then the phone shows "Can't reach Jasper".

### Optional: start the backend automatically at Windows sign-in
`scripts/jasper-autostart.ps1` waits for Docker, makes sure the database is up and runs the self-restarting backend hidden. It is not
registered by default (it is a persistent system change). To enable, once, in PowerShell:

    $a = New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "D:\Projects\COOS\scripts\jasper-autostart.ps1"'
    $t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName "Jasper Backend (autostart)" -Action $a -Trigger $t -Settings $s

Remove it with `Unregister-ScheduledTask -TaskName "Jasper Backend (autostart)" -Confirm:$false`. If you also run `start.bat` afterwards,
close its FastAPI window first (two backends cannot share port 8000).
