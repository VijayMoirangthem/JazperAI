# Cloud development foundation (draft)

This branch adds a minimal GitHub Codespaces environment and a non-deploying GitHub Actions smoke check.

## Open in Codespaces
1. In GitHub, open the JazperAI repository.
2. Select the `chore/cloud-dev-foundation` branch.
3. Choose **Code → Codespaces → Create codespace on chore/cloud-dev-foundation**.
4. Wait for the container to build. Python 3.11 and Node.js 20 should be available.

The Codespace intentionally does **not** automatically start Docker, PostgreSQL, Redis, MinIO, the backend, or frontend. It also does not install the entire monorepo's dependencies on creation. This avoids surprise resource usage and allows an incremental audit.

## CI
The smoke workflow runs for pull requests and manual dispatch. It verifies Python syntax and tool availability. It is **not** a full test suite or evidence that Jazper runs end-to-end.

## Next steps
- Inventory which frontend (Next.js vs Electron/Vite) is currently supported and identify the right startup commands.
- Validate backend requirements, database migrations, and environment variables in an isolated test environment.
- Add targeted backend and frontend tests after determining which dependencies and scripts are authoritative.
- Evaluate a dedicated managed PostgreSQL database and persistent worker hosting, without touching Baeit production.
- Implement secrets via GitHub Codespaces secrets or a cloud secret manager. Never commit credentials.

## Cost and security
Codespaces and GitHub Actions usage may count against account quotas or incur charges. Confirm billing limits before extended use. Keep production credentials out of development environments. Production deployments require separate approval.
