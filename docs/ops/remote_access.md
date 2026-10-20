# Remote access (Plan V3 W8)

**Rule: never expose the raw API.** The backend has a guard (`core/remote_guard.py`): any request that arrives through a tunnel (public Host header or proxy headers such as `CF-Connecting-IP`) can only use `/remote/v1/*` and `/health`; everything else (files, secrets, system, connectors, workspaces, the desktop API) answers 403. This is enforced in the backend, so it holds even if the tunnel is configured to forward everything. 4 tests prove it (`tests/test_remote.py`).

## What is built
- Pairing: `POST /api/remote/pair/start` (local only) gives an 8-character code valid 5 minutes. The phone calls `POST /remote/v1/pair/complete`.
- Per-device secret (stored hashed), 15-minute access tokens (HS256, key in the OS vault `REMOTE_JWT_KEY`), refresh with device id + secret, instant revocation (`DELETE /api/remote/devices/{id}`), rate limit 240 requests/min per device, audit entries for pair/revoke/approve.
- Tier-3 approvals from a phone additionally need the device secret (`confirm`), which the app only sends after a biometric prompt.
- Remote surface: `me, bots, bots/{slug}/card, chat/stream, approvals, approvals/{id}/respond, comms/threads, comms/thread, status, notifications, voice/transcribe, voice/speak, push/register`. Contract: `docs/mobile/version1/MOBILE_SPEC_V1.md` section 7.

## Option A (recommended): Cloudflare Tunnel + Cloudflare Access
Needs a Cloudflare account and a domain on it (free plan is enough). The tunnel is outbound only: no router ports are opened.
```
winget install --id Cloudflare.cloudflared
cloudflared tunnel login                              # opens the browser, pick your domain
cloudflared tunnel create jasper
cloudflared tunnel route dns jasper jasper.YOURDOMAIN.com
```
Create `C:\Users\vijay\.cloudflared\config.yml`:
```
tunnel: jasper
credentials-file: C:\Users\vijay\.cloudflared\<TUNNEL-ID>.json
ingress:
  - hostname: jasper.YOURDOMAIN.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```
Run it as a Windows service so it survives reboots: `cloudflared service install`.
Zero Trust dashboard → Access → Applications → Add → Self-hosted → `jasper.YOURDOMAIN.com`. Policy: **Service Auth** with a service token (Zero Trust → Access → Service Auth → Create). The app sends the token as two headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) stored in the phone's secure store. Result: two independent locks (Cloudflare Access, then the device token).
Then tell the backend its public URL (so pairing shows it): `curl -X PUT http://127.0.0.1:8000/api/remote/public-url -H "Content-Type: application/json" -d "{\"url\":\"https://jasper.YOURDOMAIN.com\"}"`.
Add Cloudflare WAF rate limiting on the hostname if you want an extra layer.

## Option B: Tailscale (private, nothing public)
Install Tailscale on the PC and phone, then `tailscale serve --bg --https=443 http://127.0.0.1:8000`. The phone uses `https://<pc-name>.<tailnet>.ts.net`. Only your devices can reach it; the guard still limits it to `/remote/v1`. Good for personal use; no domain needed.

## Verify (run from outside your network, or with a fake Host header)
```
curl -s -o NUL -w "%{http_code}\n" https://jasper.YOURDOMAIN.com/api/v1/system/secrets      -> 403 (Access or the guard)
curl -s -o NUL -w "%{http_code}\n" https://jasper.YOURDOMAIN.com/remote/v1/me               -> 401 (reachable, needs a token)
curl -s -o NUL -w "%{http_code}\n" -H "Host: x.example.com" http://127.0.0.1:8000/api/v1/bots/tree   -> 403
```

## Operating notes
- Revoke a lost phone: Connections → Phones → Revoke (or the DELETE call above). Its tokens stop working immediately.
- Rotate the signing key (invalidates all sessions): in Python `vault.set("REMOTE_JWT_KEY", secrets.token_urlsafe(48))`.
- gzip and ETag are worth adding at the tunnel (Cloudflare does gzip/brotli automatically).
- The PC must be on for the phone to work. A sleeping PC makes the app show "Cannot reach your computer".

## Not done yet
Push sending from the backend (the phone registers its token; the sender is the next backend item), a QR code in the desktop UI (the pairing code is shown as text), and a Cloudflare setup on your account (needs your login).
