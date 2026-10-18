"""Per-request tenancy context (spec §11): SET LOCAL app.principal_id / app.tenants inside the transaction."""
from dataclasses import dataclass, field

from fastapi import Header


@dataclass(frozen=True)
class RequestContext:
    principal_id: str
    tenants: tuple[str, ...] = field(default_factory=tuple)


def apply_context(cur, ctx: RequestContext) -> None:
    """Call at the start of every transaction; values are transaction-local."""
    cur.execute("SET LOCAL ROLE app_runtime")
    cur.execute(
        "SELECT set_config('app.principal_id', %s, true), set_config('app.tenants', %s, true)",
        (ctx.principal_id, ",".join(ctx.tenants)),
    )


async def request_context(
    x_principal_id: str = Header(default=""), x_tenants: str = Header(default="")
) -> RequestContext:
    return RequestContext(x_principal_id, tuple(t for t in x_tenants.split(",") if t))
