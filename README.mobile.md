# Jasper Mobile

Phone companion for the Jasper desktop app (React Native, Expo, TypeScript). **Not built yet**: this folder is reserved; the app is built milestone by milestone by following
`docs/mobile/version1/promptsMobileV1.md` (specification: `docs/mobile/version1/MOBILE_SPEC_V1.md`).

The backend side already exists: `backend/python/api/routes/remote.py` (pairing, auth, chat stream, approvals, comms, voice, push token) and `backend/python/core/remote_guard.py`
(a tunnel can only reach `/remote/v1/*`). Exposure through Cloudflare Tunnel is described in `docs/ops/remote_access.md`.
