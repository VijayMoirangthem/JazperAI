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
