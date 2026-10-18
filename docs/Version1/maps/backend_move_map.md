# Backend move map (P1-03)
Root kept at `backend/python/` (deviation: avoids .env/start.bat/uvicorn changes). Depth under root preserved so `__file__`-relative paths stay valid.

| old package | new package |
|---|---|
| app.routes | api.routes |
| app.business | api.business |
| app.agents | agents.roster |
| app.workers | agents.workers |
| app.core | core |
| app.providers | core.providers |
| app.scheduler | core.scheduler |
| app.system | core.system |
| app.services | core.services |
| app.tools | mcp.tools |
| app.db | memory.db |

Not done (deferred): service split into memory/ (P1-10), personal-assistant crews, mcp registry. 179 files moved, see git diff for rewrites rewritten.
