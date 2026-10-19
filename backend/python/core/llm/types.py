from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Tier = Literal["light", "standard", "frontier"]


class Usage(BaseModel):
    """Extracted on every call; feeds FinOps (P2-08)."""
    model_config = ConfigDict(extra="forbid")
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    latency_ms: int = 0


class LLMRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: list[dict]
    system: str = ""
    tier: Tier = "standard"
    max_tokens: int = 1024
    temperature: float = 0.7
    cache_system: bool = True  # prompt-cache marker on the static system prompt


class LLMResult(BaseModel):
    text: str
    usage: Usage
    stop_reason: str | None = None
    fallback_from: list[str] = Field(default_factory=list)  # providers that failed before this one answered


class ProviderError(Exception):
    def __init__(self, msg: str, retryable: bool = True, retry_after: float | None = None):
        super().__init__(msg)
        self.retryable = retryable
        self.retry_after = retry_after  # seconds the server asked us to wait (429)
