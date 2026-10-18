from openai import AsyncOpenAI, RateLimitError, APIConnectionError, APIStatusError
from core.config import settings
from typing import AsyncGenerator
from dataclasses import dataclass
import time
import re
import json
import threading
import structlog

log = structlog.get_logger()

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)

# Matches the "thinking out loud" preamble models produce before answering:
#   "The user is asking..." / "I need to..." / "1. **Analyze:** ..." etc.
_REASONING_PREAMBLE_RE = re.compile(
    r"^(?:"
    r"(?:The user (?:is asking|has (?:asked|provided|said)|wants)|"
    r"I (?:need to|must|will|should|am going to|have to)|"
    r"Let me |Looking at |Reviewing |Based on the (?:context|previous|image|prompt)|"
    r"Analyzing |Re-examining )"
    r".*\n*"
    r"|"
    r"\d+\.\s+(?:\*\*[^*\n]+\*\*[:\s]?|[A-Z][^.\n]{0,60}:)[^\n]*\n*"  # numbered steps
    r")+",
    re.MULTILINE,
)


def _strip_reasoning(text: str) -> tuple[str, str]:
    """
    Separate chain-of-thought preamble from the real answer.
    Returns (clean_answer, reasoning) — reasoning is empty string if none detected.
    """
    m = _REASONING_PREAMBLE_RE.match(text)
    if not m:
        return text, ""
    reasoning = m.group(0).strip()
    answer = text[m.end():].strip()
    # If stripping removed everything it was a valid list, not reasoning — return as-is
    return (answer, reasoning) if answer else (text, "")


@dataclass
class ChatResult:
    content: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    duration_ms: int


class AIProvider:
    def __init__(self):
        self.default_model = settings.AI_MODEL
        self._is_local = "localhost" in (settings.AI_BASE_URL or "") or "127.0.0.1" in (settings.AI_BASE_URL or "")

        # Build a pool from all non-empty keys — AI_API_KEY, AI_API_KEY2, AI_API_KEY3
        raw_keys = [settings.AI_API_KEY, settings.AI_API_KEY2, settings.AI_API_KEY3]
        keys = [k for k in raw_keys if k and k.strip()]
        if not keys:
            keys = ["lm-studio"]

        self._clients = [
            AsyncOpenAI(base_url=settings.AI_BASE_URL, api_key=k)
            for k in keys
        ]
        self._idx   = 0
        self._lock  = threading.Lock()

        # Per-key 429 timestamp: if set, that key is cooling down (60s window)
        self._rate_limited_until: dict[int, float] = {}

        # Local LM Studio fallback client (used when ALL primary keys are rate-limited)
        self._local_client: AsyncOpenAI | None = None
        if settings.LOCAL_FALLBACK_ENABLED and not self._is_local:
            try:
                self._local_client = AsyncOpenAI(
                    base_url=settings.LOCAL_FALLBACK_URL,
                    api_key="lm-studio",
                )
                log.info("AIProvider: local fallback client ready", url=settings.LOCAL_FALLBACK_URL)
            except Exception as exc:
                log.warning("AIProvider: local fallback init failed", error=str(exc))

    @property
    def client(self) -> AsyncOpenAI:
        with self._lock:
            return self._clients[self._idx % len(self._clients)]

    def _rotate(self, failed_idx: int) -> None:
        """Mark key as rate-limited and advance to the next available key."""
        now = time.monotonic()
        with self._lock:
            self._rate_limited_until[failed_idx] = now + 60.0   # cool-down 60s
            # Find next non-rate-limited key
            for offset in range(1, len(self._clients) + 1):
                candidate = (failed_idx + offset) % len(self._clients)
                if self._rate_limited_until.get(candidate, 0) <= now:
                    self._idx = candidate
                    return
            # All keys are rate-limited — idx stays where it is (will try local)
            self._idx = failed_idx

    def _all_primary_exhausted(self) -> bool:
        """True when every primary key is currently rate-limited."""
        now = time.monotonic()
        with self._lock:
            return all(
                self._rate_limited_until.get(i, 0) > now
                for i in range(len(self._clients))
            )

    async def _call_with_fallback(
        self,
        make_call,          # async callable(client, model, is_local) → result
        model: str,
        allow_local: bool,
    ):
        """
        Try primary keys in rotation. On RateLimitError, mark key and try next.
        If all primary keys exhausted AND allow_local AND local client available:
          → retry once against LM Studio with LOCAL_FALLBACK_MODEL.
        """
        tried: set[int] = set()
        while True:
            with self._lock:
                idx = self._idx
            if idx in tried:
                break
            tried.add(idx)
            client = self._clients[idx]
            try:
                return await make_call(client, model, False)
            except RateLimitError:
                self._rotate(idx)
                if self._all_primary_exhausted():
                    break
            except (APIConnectionError, APIStatusError) as exc:
                log.warning("AIProvider: primary key connection error — falling back to local",
                            error=str(exc))
                break  # skip remaining primary keys; go straight to local

        # All primary keys rate-limited or unreachable
        if allow_local and self._local_client is not None:
            local_model = settings.LOCAL_FALLBACK_MODEL
            log.warning("AIProvider: all primary keys rate-limited — falling back to local",
                        local_model=local_model)
            try:
                result = await make_call(self._local_client, local_model, True)
                return result
            except Exception as exc:
                log.error("AIProvider: local fallback also failed", error=str(exc))
                raise

        raise RateLimitError(
            message="All API keys are rate-limited and local fallback is unavailable.",
            response=None,  # type: ignore[arg-type]
            body=None,
        )

    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        top_k: int | None = None,
        min_p: float | None = None,
        presence_penalty: float | None = None,
        frequency_penalty: float | None = None,
        repeat_penalty: float | None = None,
        max_tokens: int | None = None,
        stop: list[str] | None = None,
        enable_thinking: bool = False,
        allow_local_fallback: bool = True,
    ) -> ChatResult:
        start      = time.monotonic()
        use_model  = model or self.default_model

        def _build_kwargs(m: str, is_local: bool) -> dict:
            kw: dict = dict(model=m, messages=messages)
            if temperature is not None:       kw["temperature"] = temperature
            if top_p is not None:             kw["top_p"] = top_p
            if presence_penalty is not None:  kw["presence_penalty"] = presence_penalty
            if frequency_penalty is not None: kw["frequency_penalty"] = frequency_penalty
            kw["max_tokens"] = max_tokens if max_tokens is not None else 2048
            if stop:                          kw["stop"] = stop
            if is_local or self._is_local:
                extra: dict = {"reasoning_effort": "low" if enable_thinking else "none"}
                if top_k is not None:          extra["top_k"] = top_k
                if min_p is not None:          extra["min_p"] = min_p
                if repeat_penalty is not None: extra["repeat_penalty"] = repeat_penalty
                kw["extra_body"] = extra
            return kw

        async def _call(client: AsyncOpenAI, m: str, is_local: bool):
            return await client.chat.completions.create(**_build_kwargs(m, is_local))

        response   = await self._call_with_fallback(_call, use_model, allow_local_fallback)
        duration_ms = int((time.monotonic() - start) * 1000)
        usage = response.usage

        raw     = response.choices[0].message.content or ""
        content = _THINK_RE.sub("", raw).strip() if enable_thinking else raw

        # If primary returned empty content and local fallback is available, retry once
        if not content and allow_local_fallback and self._local_client is not None and not self._is_local:
            log.warning("AIProvider: primary returned empty content — retrying with local fallback")
            local_model = settings.LOCAL_FALLBACK_MODEL
            response = await _call(self._local_client, local_model, True)  # raises on failure
            raw = response.choices[0].message.content or ""
            content = _THINK_RE.sub("", raw).strip() if enable_thinking else raw
            usage = response.usage
        return ChatResult(
            content=content,
            model=response.model,
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            total_tokens=usage.total_tokens if usage else 0,
            duration_ms=duration_ms,
        )

    async def stream(
        self,
        messages: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        top_k: int | None = None,
        min_p: float | None = None,
        presence_penalty: float | None = None,
        frequency_penalty: float | None = None,
        repeat_penalty: float | None = None,
        max_tokens: int | None = None,
        stop: list[str] | None = None,
        enable_thinking: bool = False,
        allow_local_fallback: bool = True,
    ) -> AsyncGenerator[str, None]:
        use_model = model or self.default_model

        def _build_kwargs(m: str, is_local: bool) -> dict:
            kw: dict = dict(model=m, messages=messages, stream=True)
            if temperature is not None:       kw["temperature"] = temperature
            if top_p is not None:             kw["top_p"] = top_p
            if presence_penalty is not None:  kw["presence_penalty"] = presence_penalty
            if frequency_penalty is not None: kw["frequency_penalty"] = frequency_penalty
            kw["max_tokens"] = max_tokens if max_tokens is not None else 2048
            if stop:                          kw["stop"] = stop
            if is_local or self._is_local:
                extra: dict = {"reasoning_effort": "low" if enable_thinking else "none"}
                if top_k is not None:          extra["top_k"] = top_k
                if min_p is not None:          extra["min_p"] = min_p
                if repeat_penalty is not None: extra["repeat_penalty"] = repeat_penalty
                kw["extra_body"] = extra
            kw["stream_options"] = {"include_usage": True}
            return kw

        async def _call(client: AsyncOpenAI, m: str, is_local: bool):
            return await client.chat.completions.create(**_build_kwargs(m, is_local))

        stream = await self._call_with_fallback(_call, use_model, allow_local_fallback)
        chunks: list[str] = []
        usage = None

        async for chunk in stream:
            if chunk.choices:
                delta = chunk.choices[0].delta.content
                if delta:
                    chunks.append(delta)
            if chunk.usage:
                usage = chunk.usage

        full = "".join(chunks)
        # 1. Strip <think>…</think> blocks
        full = re.sub(r"<think>.*?</think>", "", full, flags=re.DOTALL)
        full = re.sub(r"</?think>", "", full)
        # 2. Separate chain-of-thought reasoning from real answer
        answer, reasoning = _strip_reasoning(full.strip())
        # Emit reasoning as a separate sentinel so the caller can show/hide it
        if reasoning:
            yield json.dumps({"__reasoning__": reasoning})
        if answer:
            yield answer
        # Emit real token usage so callers can build accurate META events
        if usage:
            yield json.dumps({"__usage__": {
                "prompt": usage.prompt_tokens or 0,
                "completion": usage.completion_tokens or 0,
                "total": usage.total_tokens or 0,
            }})

    async def stream_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        model: str | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        top_k: int | None = None,
        min_p: float | None = None,
        presence_penalty: float | None = None,
        frequency_penalty: float | None = None,
        repeat_penalty: float | None = None,
        max_tokens: int | None = None,
        stop: list[str] | None = None,
        enable_thinking: bool = False,
        force_tool: bool = False,
        allow_local_fallback: bool = True,
    ) -> AsyncGenerator:
        """Single streaming call. Yields string chunks normally.
        If model decides to call a tool, yields a dict sentinel instead of content:
          {"tool_call": True, "name": "web_search", "query": "...", "id": "..."}
        Caller should execute the tool and call stream() again with results appended."""
        use_model = model or self.default_model
        _ = enable_thinking  # intentionally ignored — tool calls always use reasoning_effort=none

        def _build_kwargs(m: str, is_local: bool) -> dict:
            kw: dict = dict(
                model=m, messages=messages, stream=True,
                tools=tools, tool_choice="required" if force_tool else "auto",
                stream_options={"include_usage": True},
            )
            if temperature is not None:       kw["temperature"] = temperature
            if top_p is not None:             kw["top_p"] = top_p
            if presence_penalty is not None:  kw["presence_penalty"] = presence_penalty
            if frequency_penalty is not None: kw["frequency_penalty"] = frequency_penalty
            kw["max_tokens"] = max_tokens if max_tokens is not None else 2048
            if stop:                          kw["stop"] = stop
            if is_local or self._is_local:
                # Keep thinking off for tool calls
                extra: dict = {"reasoning_effort": "none"}
                if top_k is not None:          extra["top_k"] = top_k
                if min_p is not None:          extra["min_p"] = min_p
                if repeat_penalty is not None: extra["repeat_penalty"] = repeat_penalty
                kw["extra_body"] = extra
            return kw

        async def _call(client: AsyncOpenAI, m: str, is_local: bool):
            return await client.chat.completions.create(**_build_kwargs(m, is_local))

        stream = await self._call_with_fallback(_call, use_model, allow_local_fallback)

        # Buffers for tool call accumulation and think-tag stripping
        tool_calls: dict[int, dict] = {}
        buffer = ""
        in_think = False
        think_done = False
        usage = None
        _tool_call_sentinel: dict | None = None  # set when tool_calls finish_reason detected

        async for chunk in stream:
            # Capture usage from whichever chunk carries it (may be an empty trailing chunk)
            if chunk.usage:
                usage = chunk.usage

            if not chunk.choices:
                # Empty trailing chunk (Groq sends this for include_usage) — no content
                continue

            choice = chunk.choices[0]
            delta = choice.delta
            finish_reason = choice.finish_reason

            # ── Tool call deltas (model wants to search) ──────────────────
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls:
                        tool_calls[idx] = {"id": tc.id or "", "name": "", "arguments": ""}
                    if tc.id:
                        tool_calls[idx]["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            tool_calls[idx]["name"] += tc.function.name
                        if tc.function.arguments:
                            tool_calls[idx]["arguments"] += tc.function.arguments

            # ── Tool call complete — build sentinel, keep iterating for usage ─
            if finish_reason == "tool_calls" and tool_calls and not _tool_call_sentinel:
                tc = tool_calls[0]
                try:
                    args = json.loads(tc["arguments"])
                    query = args.get("query", "")
                except Exception:
                    args = {}
                    query = tc["arguments"]
                _tool_call_sentinel = {
                    "tool_call": True,
                    "name": tc["name"],
                    "query": query,
                    "arguments": args,
                    "id": tc["id"],
                }
                # Don't return — continue the loop so the trailing usage chunk is consumed
                continue

            if _tool_call_sentinel:
                # Already captured the tool call; skip any remaining content chunks
                continue

            # ── Normal content — strip think tags and stream ──────────────
            content = delta.content
            if not content:
                continue

            if think_done:
                yield content
                continue

            buffer += content

            if not in_think and "<think>" in buffer:
                in_think = True
                before = buffer.split("<think>", 1)[0]
                if before:
                    think_done = True
                    yield before
                    buffer = ""
                    in_think = False
                continue

            if in_think:
                if "</think>" in buffer:
                    after = buffer.split("</think>", 1)[1]
                    in_think = False
                    think_done = True
                    buffer = ""
                    if after:
                        yield after
            else:
                think_done = True
                yield buffer
                buffer = ""

        # ── After the stream: emit tool sentinel then usage (or just usage) ─
        if _tool_call_sentinel:
            yield _tool_call_sentinel
        if usage:
            yield json.dumps({"__usage__": {
                "prompt":     usage.prompt_tokens     or 0,
                "completion": usage.completion_tokens or 0,
                "total":      usage.total_tokens      or 0,
            }})

    async def claude_chat(
        self,
        messages: list[dict],
        max_tokens: int = 1500,
        temperature: float = 0.1,
        model: str | None = None,
    ) -> ChatResult:
        """
        Call Claude (Anthropic) directly — used for high-reasoning tasks:
        code diagnosis, IT repair, cover letter tailoring, job scoring.
        Falls back to primary Groq provider if CLAUDE_API_KEY is not set.
        """
        if not settings.CLAUDE_API_KEY:
            log.warning("claude_chat: no CLAUDE_API_KEY — falling back to primary provider")
            return await self.chat(messages, max_tokens=max_tokens, temperature=temperature)

        try:
            import anthropic as _anthropic
        except ImportError:
            log.warning("claude_chat: anthropic package not installed — falling back")
            return await self.chat(messages, max_tokens=max_tokens, temperature=temperature)

        client = _anthropic.AsyncAnthropic(api_key=settings.CLAUDE_API_KEY)
        use_model = model or settings.CLAUDE_MODEL

        # Separate system message from conversation
        system_parts = [m["content"] for m in messages if m["role"] == "system"]
        user_messages = [m for m in messages if m["role"] != "system"]
        system_text = "\n".join(system_parts) if system_parts else "You are a helpful assistant."

        start = time.monotonic()
        response = await client.messages.create(
            model=use_model,
            max_tokens=max_tokens,
            temperature=temperature,
            system=system_text,
            messages=user_messages,
        )
        duration_ms = int((time.monotonic() - start) * 1000)

        content = response.content[0].text if response.content else ""
        log.info("claude_chat: OK", model=use_model, tokens=response.usage.output_tokens,
                 duration_ms=duration_ms)
        return ChatResult(
            content=content,
            model=response.model,
            prompt_tokens=response.usage.input_tokens,
            completion_tokens=response.usage.output_tokens,
            total_tokens=response.usage.input_tokens + response.usage.output_tokens,
            duration_ms=duration_ms,
        )

    async def get_models(self) -> list[dict]:
        response = await self.client.models.list()
        return [{"id": m.id, "object": m.object} for m in response.data]

    async def embed(self, text: str) -> list[float] | None:
        from core.services.embedding_service import embed as local_embed
        return local_embed(text)

    def embed_sync(self, text: str) -> list[float] | None:
        """Synchronous embed — uses local sentence-transformers, no LM Studio needed."""
        from core.services.embedding_service import embed as local_embed
        return local_embed(text)


ai_provider = AIProvider()


def get_ai_provider() -> AIProvider:
    return ai_provider


def get_fallback_status() -> dict:
    """Return current provider health for the Topbar indicator."""
    provider = ai_provider
    now = time.monotonic()
    with provider._lock:
        rate_limited = [
            i for i in range(len(provider._clients))
            if provider._rate_limited_until.get(i, 0) > now
        ]
    all_exhausted = len(rate_limited) == len(provider._clients)
    return {
        "primary_keys":        len(provider._clients),
        "rate_limited_keys":   len(rate_limited),
        "all_primary_exhausted": all_exhausted,
        "local_fallback_available": provider._local_client is not None,
        "local_fallback_url":  getattr(provider._local_client, "base_url", None)
                               if provider._local_client else None,
        "local_fallback_model": provider._local_client and ai_provider._local_client is not None
                               and str(provider._local_client.base_url),
    }
