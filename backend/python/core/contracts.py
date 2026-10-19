"""Event contracts (docs/03_SCHEMA_CONTRACTS.md §1-2): subset needed by the bus; extended as features land."""
from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, Literal, Union
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentState(str, Enum):
    IDLE = "idle"
    PLANNING = "planning"
    WORKING = "working"
    WAITING_TOOL = "waiting_tool"
    WAITING_HUMAN = "waiting_human"
    TESTING = "testing"
    REPAIRING = "repairing"
    ROLLED_BACK = "rolled_back"
    ESCALATED = "escalated"
    ERROR = "error"
    DEPRECATED = "deprecated"


class AgentStateChange(Strict):
    topic: Literal["agent-state-change"] = "agent-state-change"
    agent_id: UUID
    agent_slug: str
    from_state: AgentState | None = None
    to_state: AgentState
    status_bubble: str | None = Field(None, max_length=140)
    graph_node: str | None = None
    attempt: int | None = Field(None, ge=0, le=3)
    reason: str | None = None


class DiffHunk(Strict):
    id: str
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    patch: str


class DiffStream(Strict):
    topic: Literal["diff-stream"] = "diff-stream"
    stream_id: UUID
    path: str
    branch: str = Field(pattern=r"^agent-patch/[A-Za-z0-9._/-]+$")
    base_sha: str = Field(pattern=r"^[0-9a-f]{7,40}$")
    op: Literal["begin", "hunk", "end", "abort"]
    hunks: list[DiffHunk] = []
    chunk_index: int = Field(ge=0)
    final: bool = False


class HumanInterventionRequest(Strict):
    topic: Literal["human-intervention-request"] = "human-intervention-request"
    request_id: UUID
    tier: Literal[1, 2, 3]
    action: str
    summary: str = Field(max_length=2000)


class ExecutionLog(Strict):
    topic: Literal["execution-log"] = "execution-log"
    run_id: UUID
    stream: Literal["stdout", "stderr", "system"] = "stdout"
    line: str


Event = Annotated[Union[AgentStateChange, DiffStream, HumanInterventionRequest, ExecutionLog], Field(discriminator="topic")]
TOPICS = ("agent-state-change", "diff-stream", "human-intervention-request", "execution-log")


class TraceContext(Strict):
    trace_id: UUID = Field(default_factory=uuid4)
    span_id: UUID = Field(default_factory=uuid4)
    parent_id: UUID | None = None
    tenant: Literal["create_origins", "baeit", "boardmint"] = "create_origins"


class EventEnvelope(Strict):
    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["agent-state-change", "diff-stream", "human-intervention-request", "execution-log"]
    params: dict[str, Any]
    seq: int = Field(ge=0)
    ts: datetime
    ctx: TraceContext


def now() -> datetime:
    return datetime.now(timezone.utc)
