"""P1-04: /api/v1 aliases for every /api route + OpenAPI deprecation flags.

Legacy paths stay untouched; v1 paths are additive aliases.
"""
from fastapi import FastAPI
from fastapi.routing import APIRoute

# audit §3.3 candidates: flagged only, never removed here.
DEPRECATED_MODULES = {
    "plugins", "webhooks", "automation", "workflows", "chain_loop",
    "suggestions", "timeline", "activity", "history", "search", "stats", "onboarding",
    "export_data", "db_changes", "alert_config", "notifications", "dashboard",
    "company_dashboard", "voyager",
}


def add_v1_aliases(app: FastAPI) -> None:
    originals = [r for r in app.router.routes if isinstance(r, APIRoute)]
    for r in originals:
        mod = r.endpoint.__module__.rsplit(".", 1)[-1]
        if mod in DEPRECATED_MODULES and r.endpoint.__module__.startswith("api.routes"):
            r.deprecated = True  # DEPRECATED(V1)
        if not r.path.startswith("/api/") or r.path.startswith("/api/v1/"):
            continue
        app.add_api_route(
            "/api/v1/" + r.path[len("/api/"):],
            r.endpoint,
            methods=sorted(r.methods or []),
            name=f"{r.name}_v1",
            response_model=r.response_model,
            status_code=r.status_code,
            tags=r.tags,
            dependencies=r.dependencies,
            response_class=r.response_class,
            deprecated=r.deprecated,
        )
