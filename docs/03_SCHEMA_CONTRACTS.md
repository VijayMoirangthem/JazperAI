# 03 — Schema & Interface Contracts

Pydantic v2 models (target: `backend/core/contracts/*.py`). Wire format: **JSON-RPC 2.0** over `/ws`; server→client events are notifications (`method` = topic, no `id`). Spec refs: §12 (topics, MCP), §17 (trace IDs), §21 (SRE/Chaos), §25 (directory/RBAC/RLS), §11 (HITL tiers). Field names beyond what the spec states are **[proposed]**.

## 1. Common envelope

```python
from __future__ import annotations
from datetime import datetime
from enum import Enum, IntEnum
from typing import Annotated, Any, Literal, Union
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

class Tenant(str, Enum):            # §11 logical partitions
    CREATE_ORIGINS = "create_origins"
    BAEIT = "baeit"
    BOARDMINT = "boardmint"

class HitlTier(IntEnum):            # §11, §13, §14
    AUTONOMOUS = 1
    NOTIFICATION_GATED = 2
    EXPLICIT_AUTH = 3

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, use_enum_values=False)

class TraceContext(Strict):         # §17 global trace + parent-child correlation
    trace_id: UUID
    span_id: UUID
    parent_id: UUID | None = None
    directive_id: UUID | None = None      # originating Sir Jasper directive
    tenant: Tenant

class EventEnvelope(Strict):
    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["agent-state-change", "diff-stream",
                    "human-intervention-request", "execution-log"]
    params: "Event"
    seq: int = Field(ge=0, description="per-topic monotonic, for replay/ordering")
    ts: datetime
    ctx: TraceContext
```

## 2. IPC event topics (§12)

```python
class AgentState(str, Enum):
    IDLE = "idle"; PLANNING = "planning"; WORKING = "working"
    WAITING_TOOL = "waiting_tool"; WAITING_HUMAN = "waiting_human"
    TESTING = "testing"; REPAIRING = "repairing"; ROLLED_BACK = "rolled_back"
    ESCALATED = "escalated"; ERROR = "error"; DEPRECATED = "deprecated"

class AgentStateChange(Strict):
    topic: Literal["agent-state-change"] = "agent-state-change"
    agent_id: UUID
    agent_slug: str                       # e.g. "baeit.backend_services_bot"
    from_state: AgentState | None
    to_state: AgentState
    status_bubble: str | None = Field(None, max_length=140)   # §7 office bubbles
    graph_node: str | None = None
    attempt: int | None = Field(None, ge=0, le=3)             # §10 recursion cap
    reason: str | None = None

class DiffHunk(Strict):
    id: str
    old_start: int; old_lines: int; new_start: int; new_lines: int
    patch: str                            # unified-diff body

class DiffStream(Strict):
    topic: Literal["diff-stream"] = "diff-stream"
    stream_id: UUID
    path: str                             # workspace-relative, normalized, no ..
    branch: str = Field(pattern=r"^agent-patch/[A-Za-z0-9._/-]+$")   # §10
    base_sha: str = Field(pattern=r"^[0-9a-f]{7,40}$")
    op: Literal["begin", "hunk", "end", "abort"]
    hunks: list[DiffHunk] = []
    chunk_index: int = Field(ge=0)
    final: bool = False
    provenance: "Provenance"

class Provenance(Strict):               # §15 IP audit
    agent_id: UUID
    model_provider: str
    model_id: str
    prompt_hash: str
    signature: str | None = None         # commit signature once committed

class HumanInterventionRequest(Strict):
    topic: Literal["human-intervention-request"] = "human-intervention-request"
    request_id: UUID
    tier: HitlTier
    action: str                          # e.g. "git.merge_main", "payment.authorize"
    summary: str = Field(max_length=2000)
    payload_ref: str | None = None       # pointer; never raw secrets
    requested_by_agent: UUID
    eligible_approvers: list[UUID]       # Directory user ids (§25 designated counterparts)
    expires_at: datetime | None = None
    default_on_timeout: Literal["deny"] = "deny"
    allowed_responses: list[Literal["approve", "reject", "modify", "delegate"]]

class ExecutionLog(Strict):
    topic: Literal["execution-log"] = "execution-log"
    level: Literal["debug", "info", "warn", "error"]
    agent_id: UUID | None
    component: str                        # "langgraph.node:verify", "mcp:github"
    message: str
    latency_ms: float | None = None
    tokens_in: int | None = None; tokens_out: int | None = None
    cost_usd: float | None = None
    prev_hash: str                        # tamper-evident chain (§17)
    entry_hash: str

Event = Annotated[
    Union[AgentStateChange, DiffStream, HumanInterventionRequest, ExecutionLog],
    Field(discriminator="topic")]
EventEnvelope.model_rebuild()
```

### Client → server RPC methods
| Method | Params | Result |
|---|---|---|
| `session.subscribe` / `unsubscribe` | `{topics: [..], tenant?, agent_ids?}` | `{subscription_id}` |
| `task.submit` | `{to: agent_slug, text, attachments[], tenant}` | `{task_id, trace_id}` |
| `diff.decision` | `{stream_id, hunk_ids[], decision: accept\|reject}` | `{applied: bool}` |
| `hitl.respond` | `{request_id, response, approver_id, note?}` | `{accepted}` |
| `chat.send` / `chat.typing` / `chat.read` | thread id, text, attachments | receipt (ticks, §7) |
| `registry.refresh` | `{}` | `{tools_added[], tools_removed[]}` |
Errors use JSON-RPC codes; domain codes: `-32001 forbidden (RBAC/RLS)`, `-32002 budget_exceeded`, `-32003 tier3_required`, `-32004 recursion_limit`, `-32005 sandbox_violation`.

## 3. MCP tool registration & capability discovery (§12, §14)

```python
class PermissionScope(str, Enum):
    READ = "read"; WRITE = "write"; DELETE = "delete"; EXTERNAL_SIDE_EFFECT = "external_side_effect"
    FINANCIAL = "financial"; ADMIN = "admin"

class Transport(str, Enum):
    STDIO = "stdio"; HTTP_SSE = "http_sse"; STREAMABLE_HTTP = "streamable_http"

class SandboxSpec(Strict):
    kind: Literal["subprocess", "container"]
    image: str | None = None
    cpu_limit: float = 1.0; mem_mb: int = 512; timeout_s: int = 60
    network: Literal["none", "egress_allowlist"] = "egress_allowlist"
    egress_allowlist: list[str] = []
    fs_mounts: list[str] = []            # read-only unless listed with :rw
    host_write: Literal[False] = False   # §10 no direct host writes

class ToolDescriptor(Strict):
    name: str = Field(pattern=r"^[a-z][a-z0-9_.-]{2,63}$")   # "github.create_branch"
    description: str
    input_schema: dict[str, Any]         # JSON Schema; validated before every call
    output_schema: dict[str, Any] | None = None
    scopes: list[PermissionScope]
    hitl_tier: HitlTier                  # derived from scopes unless overridden upward
    idempotent: bool = False
    rate_limit_per_min: int = 60

class ConnectorManifest(Strict):
    connector_id: str                    # "github", "google_workspace", "slack", ...
    version: str
    display_name: str
    category: Literal["developer", "communication", "project", "travel", "hr", "other"]
    transport: Transport
    command: list[str] | None = None; url: str | None = None
    auth: Literal["none", "api_key", "oauth2", "service_account"]
    oauth: "OAuthConfig | None" = None
    credential_keys: list[str] = []      # names in OS vault; values NEVER in manifest
    sandbox: SandboxSpec
    tenants_allowed: list[Tenant]        # per-division scoping
    budgets: "ConnectorBudget"
    tools: list[ToolDescriptor] = []     # filled after discovery

class OAuthConfig(Strict):
    auth_url: str; token_url: str; scopes: list[str]
    redirect: Literal["loopback"] = "loopback"; pkce: bool = True
    refresh_rotation: bool = True

class ConnectorBudget(Strict):
    requests_per_min: int = 60; daily_cost_cap_usd: float | None = None

class ConnectorStatus(str, Enum):
    INSTALLED="installed"; AUTHORIZING="authorizing"; STARTING="starting"
    READY="ready"; DEGRADED="degraded"; STOPPED="stopped"; FAILED="failed"

class CapabilityDiscoveryResult(Strict):
    connector_id: str; status: ConnectorStatus
    tools: list[ToolDescriptor]; resources: list[dict[str, Any]] = []
    handshake_ms: float; registry_version: int      # bumps → hot reload event
    errors: list[str] = []

class ToolInvocation(Strict):
    call_id: UUID; tool: str; arguments: dict[str, Any]
    ctx: TraceContext; caller_agent: UUID; on_behalf_of: UUID | None = None   # Directory user
```
Lifecycle: `POST /api/mcp/connectors` (manifest) → vault handshake → spawn per `SandboxSpec` → `initialize`/`tools/list` → persist → publish `tool-registry-changed` (internal topic) → crews re-read registry at next graph node (hot discovery, §14). Every call: JSON-Schema validate → RBAC/scope check → tier gate → rate/budget check → execute → audit log (payload hashed; PII redacted).

## 4. SRE: incidents, RCA, ChaosBot (§21–22)

```python
class FailureClass(str, Enum):      # §21 taxonomy
    CONTEXT_OVERFLOW="context_overflow"; PROVIDER_TIMEOUT="provider_timeout"
    RATE_LIMIT="rate_limit"; TOOL_SCHEMA_MISMATCH="tool_schema_mismatch"
    AST_TEST_ASSERTION="ast_test_assertion"; RECURSION_LIMIT="recursion_limit"
    BUDGET_EXHAUSTED="budget_exhausted"; SANDBOX_VIOLATION="sandbox_violation"
    CACHE_EVICTION="cache_eviction"; MERGE_CONFLICT="merge_conflict"; UNKNOWN="unknown"

class Severity(str, Enum): SEV1="sev1"; SEV2="sev2"; SEV3="sev3"; SEV4="sev4"

class IncidentTelemetry(Strict):
    incident_id: UUID; detected_at: datetime; detector: str
    severity: Severity; failure_class: FailureClass
    tenant: Tenant; crew: str; agent_id: UUID | None
    ctx: TraceContext
    task_id: UUID | None
    stack_trace: str | None; tool_failure: dict[str, Any] | None
    prompt_ref: str; response_ref: str | None           # pointers into audit store
    context_window_tokens: int | None
    metrics: "SloSnapshot"

class SloSnapshot(Strict):
    tier1_latency_ms_p95: float | None; multihop_latency_s_p95: float | None
    tool_success_rate: float | None; error_budget_burn_rate: float | None
    recursion_violations: int = 0

class RemediationAction(Strict):
    runbook_id: str; step: str
    status: Literal["pending", "running", "done", "failed", "rolled_back"]
    owner: Literal["incident_response_bot", "devops_bot", "human"]
    due: datetime | None = None

class RcaReport(Strict):
    rca_id: UUID; incident_id: UUID; created_at: datetime
    summary: str; root_cause: str; failure_class: FailureClass
    contributing_factors: list[str]
    timeline: list[tuple[datetime, str]]
    impact: dict[str, Any]                  # tasks failed, tokens burned, cost_usd
    actions: list[RemediationAction]
    blameless: Literal[True] = True
    memory_update: str | None = None        # self-healing memory note (§21)
    notified: list[UUID]                    # Sir Jasper, VP Tech & Ops

class FaultVector(str, Enum):
    API_RATE_LIMIT="api_rate_limit"; MODEL_LATENCY="model_latency"
    CORRUPT_TOOL_SCHEMA="corrupt_tool_schema"; NETWORK_TIMEOUT="network_timeout"
    SUBPROCESS_KILL="subprocess_kill"; CACHE_EVICTION="cache_eviction"

class ChaosExperiment(Strict):
    experiment_id: UUID; name: str
    environment: Literal["staging", "sandbox"]       # never "production" (validator)
    vector: FaultVector; target: str                 # connector/agent/provider
    params: dict[str, Any]                           # e.g. {"latency_ms": 8000}
    duration_s: int = Field(le=900)
    blast_radius: list[Tenant]
    hypotheses: list[str]                            # e.g. "recursion depth never > 3"
    assertions: list[Literal["recursion_cap_held", "rollback_executed",
                             "fallback_model_used", "hitl_escalated", "no_data_loss"]]
    abort_conditions: list[str]

class ChaosResult(Strict):
    experiment_id: UUID; passed: bool
    assertions: dict[str, bool]; resilience_score: float = Field(ge=0, le=1)
    incidents: list[UUID]
```
Validators to add: `ChaosExperiment.environment != "production"`; `duration_s` capped; experiments blocked when error budget is exhausted.

## 5. Hybrid directory, RBAC & RLS (§25, §11, §16)

```python
class PrincipalKind(str, Enum): HUMAN="human"; BOT="bot"
class EmploymentType(str, Enum): EMPLOYEE="employee"; CONTRACTOR="contractor"; INTERN="intern"; FOUNDER="founder"
class BotLifecycle(str, Enum):
    SPEC="spec"; INTERVIEW="interview"; BENCHMARK="benchmark"; PROBATION="probation"   # Tier1/2 only (§18)
    ACTIVE="active"; PIP="pip"; DEPRECATED="deprecated"

class Principal(Strict):
    id: UUID; kind: PrincipalKind; display_name: str
    tenant_memberships: list["TenantMembership"]
    avatar: "AvatarSpec"; presence: Literal["online","away","busy","offline"] = "offline"
    desk_room_id: str | None = None                  # §25 desk assignment
    created_at: datetime; disabled_at: datetime | None = None

class HumanProfile(Principal):
    kind: Literal[PrincipalKind.HUMAN] = PrincipalKind.HUMAN
    email: str; employment: EmploymentType
    expertise: list[str]; authority_level: int = Field(ge=0, le=5)
    is_tier3_approver_for: list[str] = []            # action classes
    mfa_enrolled: bool = False

class BotPersona(Principal):
    kind: Literal[PrincipalKind.BOT] = PrincipalKind.BOT
    role_title: str; crew: str; reports_to: UUID; dual_reports_to: UUID | None = None   # matrix §20
    lifecycle: BotLifecycle; model_policy: "ModelPolicy"
    allowed_tools: list[str]; max_tier: HitlTier       # probation ⇒ ≤ 2
    memory_namespace: str                              # §18
    token_budget: "TokenBudget"
    eval_ledger_ref: str                               # §19 immutable ledger
    id_card: dict[str, Any] = {}

class TenantMembership(Strict):
    tenant: Tenant; roles: list[str]                   # RBAC role names
    scopes: list[str]                                  # explicit permission strings

class AvatarSpec(Strict):
    sprite_sheet: str; palette: dict[str, str]; accessories: list[str] = []

class ModelPolicy(Strict):
    default_tier: Literal["light", "standard", "frontier"]
    allowed_models: list[str]; fallback_chain: list[str]
    prompt_cache: bool = True

class TokenBudget(Strict):
    per_request_soft: int; per_request_hard: int       # §11
    daily_soft: int; daily_hard: int
```

### Permission strings (RBAC) **[proposed]**
`<tenant>:<resource>:<verb>` e.g. `baeit:repo:write`, `boardmint:filing:submit` (Tier 3), `create_origins:treasury:approve` (Tier 3), `*:audit:read`. Roles: `founder`, `division_lead`, `engineer`, `intern_readonly`, `compliance_officer`, `bot_tier1`, `bot_tier2`, `auditor`.

### Postgres RLS blueprint (§11, §16)
```sql
-- Schemas: co (parent), baeit, boardmint, shared(directory, audit, registry)
CREATE ROLE app_runtime NOLOGIN;
-- Each request: SET LOCAL app.principal_id = '<uuid>'; SET LOCAL app.tenants = 'baeit,boardmint';
ALTER TABLE baeit.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE baeit.orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON baeit.orders
  USING ('baeit' = ANY (string_to_array(current_setting('app.tenants', true), ',')));

-- Unified memory (pgvector), shared table but RLS-partitioned:
CREATE TABLE shared.memory_chunks(
  id uuid PRIMARY KEY, tenant text NOT NULL, namespace text NOT NULL,
  principal_id uuid, content text NOT NULL, pii_redacted boolean NOT NULL DEFAULT true,
  embedding vector(1024), created_at timestamptz DEFAULT now(), expires_at timestamptz);
CREATE INDEX ON shared.memory_chunks USING hnsw (embedding vector_cosine_ops);
ALTER TABLE shared.memory_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY mem_tenant ON shared.memory_chunks
  USING (tenant = ANY (string_to_array(current_setting('app.tenants', true), ',')));

-- Audit: insert-only, hash-chained
CREATE TABLE shared.audit_log(
  seq bigserial PRIMARY KEY, ts timestamptz DEFAULT now(), tenant text, trace_id uuid,
  principal_id uuid, topic text, payload jsonb, prev_hash bytea, entry_hash bytea NOT NULL);
REVOKE UPDATE, DELETE, TRUNCATE ON shared.audit_log FROM PUBLIC, app_runtime;
```
Embedding dimension is **[assumption: 1024]**; must match the chosen embedding model. Existing table uses its own dimension (see `backend/infra/postgres/init.sql`) → migration needed.

## 6. Other contracts (referenced by roadmap)
- `BudgetEvent {scope, tenant, agent_id, model, tokens_in, tokens_out, cost_usd, cap_state: ok|soft|hard}` (FinOps, §11/§23).
- `AgentOnboardingRecord {stage: spec|interview|benchmark|clearance, scores{completion,hallucination,latency,token_eff,hitl_compliance}, certified_by[]}` (§18).
- `PipRecord {agent_id, trigger, started_at, iterations≤N, outcome: restored|deprecated, escalated_to}` (§19).
- `OkrNode {id, level: enterprise|division|bot, parent_id, metric_query, target, current}` (§20).
- `SpinoffBundleManifest {tenant, pg_dump_sha256, vector_rows, git_bundle_sha256, log_archive, encryption_key_id}` (§12).
