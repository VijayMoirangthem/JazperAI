# COOS AI-Native IDE — Security Specification

**Last Updated:** 2026-08-11  
**Security Model:** Defense-in-Depth with Permission-Gated Tool Execution

---

## 1. Tool Permission Hierarchy

AI agents must operate under strict permission boundaries. The system enforces 7 permission levels:

| Level | Name | Allowed Actions | Approval Required? |
|---|---|---|---|
| **Level 0** | Read-Only | Read files, search code, list directories | No |
| **Level 1** | Code Edit | Write files, apply patches, create files | No (Logged in `evolution_log`) |
| **Level 2** | Safe Command | Run linter, typecheck, unit tests | No |
| **Level 3** | Package Install| `npm install`, `pip install` | **Yes** (Human gate) |
| **Level 4** | File Delete | Remove files / directories | **Yes** (Human gate) |
| **Level 5** | Network / Secret| Access external APIs, modify `.env` | **Restricted / Blocked** |
| **Level 6** | System Destructive | `git reset --hard`, `rm -rf`, `docker system prune` | **Blocked by default** |

---

## 2. Path Traversal & Restricted Files Safeguards

- **Path Normalization:** Every path passed to file endpoints is resolved via `_safe_resolve()` against `_PROJECT_ROOT`. Traversal sequences (`..`) raise an immediate 400 error.
- **Restricted Files:** Access to sensitive environment files (`.env`, `.env.local`, `.env.production`) is permanently blocked for agent `write_file` tools.
- **Destructive Command Filters:** Command execution engine inspects commands against a regex blacklist: `rm -rf`, `rmdir /s`, `format`, `shutdown`, `reboot`, fork bombs.

---

## 3. Secret Management & Isolation

- API keys and database credentials stay in `.env.local` and environment variables. Agents never receive raw `.env` files in prompt context.
- Docker containers run with restricted user privileges (`non-root`) and memory caps.
