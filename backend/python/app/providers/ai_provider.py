from openai import AsyncOpenAI
from app.core.config import settings
from typing import AsyncGenerator
from dataclasses import dataclass
import time
import re
import json

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
        self.client = AsyncOpenAI(
            base_url=settings.AI_BASE_URL,
            api_key=settings.AI_API_KEY,
        )
        self.default_model = settings.AI_MODEL
        # LM Studio exposes extra sampling params not supported by cloud providers
        self._is_local = "localhost" in (settings.AI_BASE_URL or "") or "127.0.0.1" in (settings.AI_BASE_URL or "")

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
    ) -> ChatResult:
        start = time.monotonic()

        kwargs: dict = dict(
            model=model or self.default_model,
            messages=messages,
        )
        if temperature is not None:       kwargs["temperature"] = temperature
        if top_p is not None:             kwargs["top_p"] = top_p
        if presence_penalty is not None:  kwargs["presence_penalty"] = presence_penalty
        if frequency_penalty is not None: kwargs["frequency_penalty"] = frequency_penalty
        kwargs["max_tokens"] = max_tokens if max_tokens is not None else 2048
        if stop:                          kwargs["stop"] = stop
        if self._is_local:
            extra: dict = {"reasoning_effort": "low" if enable_thinking else "none"}
            if top_k is not None:         extra["top_k"] = top_k
            if min_p is not None:         extra["min_p"] = min_p
            if repeat_penalty is not None: extra["repeat_penalty"] = repeat_penalty
            kwargs["extra_body"] = extra

        response = await self.client.chat.completions.create(**kwargs)
        duration_ms = int((time.monotonic() - start) * 1000)
        usage = response.usage

        raw = response.choices[0].message.content or ""
        content = _THINK_RE.sub("", raw).strip() if enable_thinking else raw
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
    ) -> AsyncGenerator[str, None]:
        kwargs: dict = dict(model=model or self.default_model, messages=messages, stream=True)
        if temperature is not None:       kwargs["temperature"] = temperature
        if top_p is not None:             kwargs["top_p"] = top_p
        if presence_penalty is not None:  kwargs["presence_penalty"] = presence_penalty
        if frequency_penalty is not None: kwargs["frequency_penalty"] = frequency_penalty
        kwargs["max_tokens"] = max_tokens if max_tokens is not None else 2048
        if stop:                          kwargs["stop"] = stop
        if self._is_local:
            extra: dict = {"reasoning_effort": "low" if enable_thinking else "none"}
            if top_k is not None:         extra["top_k"] = top_k
            if min_p is not None:         extra["min_p"] = min_p
            if repeat_penalty is not None: extra["repeat_penalty"] = repeat_penalty
            kwargs["extra_body"] = extra

        kwargs["stream_options"] = {"include_usage": True}

        stream = await self.client.chat.completions.create(**kwargs)
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
    ) -> AsyncGenerator:
        """Single streaming call. Yields string chunks normally.
        If model decides to call a tool, yields a dict sentinel instead of content:
          {"tool_call": True, "name": "web_search", "query": "...", "id": "..."}
        Caller should execute the tool and call stream() again with results appended."""
        kwargs: dict = dict(
            model=model or self.default_model,
            messages=messages,
            stream=True,
            tools=tools,
            tool_choice="required" if force_tool else "auto",
        )
        if temperature is not None:       kwargs["temperature"] = temperature
        if top_p is not None:             kwargs["top_p"] = top_p
        if presence_penalty is not None:  kwargs["presence_penalty"] = presence_penalty
        if frequency_penalty is not None: kwargs["frequency_penalty"] = frequency_penalty
        kwargs["max_tokens"] = max_tokens if max_tokens is not None else 2048
        if stop:                          kwargs["stop"] = stop
        if self._is_local:
            # Keep thinking off for tool calls — reasoning can cause models to reason their
            # way out of calling tools ("I cannot access the internet") instead of using them.
            extra: dict = {"reasoning_effort": "none"}
            if top_k is not None:         extra["top_k"] = top_k
            if min_p is not None:         extra["min_p"] = min_p
            if repeat_penalty is not None: extra["repeat_penalty"] = repeat_penalty
            kwargs["extra_body"] = extra

        stream = await self.client.chat.completions.create(**kwargs)

        # Buffers for tool call accumulation and think-tag stripping
        tool_calls: dict[int, dict] = {}
        buffer = ""
        in_think = False
        think_done = False

        async for chunk in stream:
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

            # ── Tool call complete — yield sentinel ───────────────────────
            if finish_reason == "tool_calls" and tool_calls:
                tc = tool_calls[0]
                try:
                    args = json.loads(tc["arguments"])
                    query = args.get("query", "")
                except Exception:
                    args = {}
                    query = tc["arguments"]
                yield {
                    "tool_call": True,
                    "name": tc["name"],
                    "query": query,
                    "arguments": args,
                    "id": tc["id"],
                }
                return

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

    async def get_models(self) -> list[dict]:
        response = await self.client.models.list()
        return [{"id": m.id, "object": m.object} for m in response.data]

    async def embed(self, text: str) -> list[float] | None:
        from app.services.embedding_service import embed as local_embed
        return local_embed(text)

    def embed_sync(self, text: str) -> list[float] | None:
        """Synchronous embed — uses local sentence-transformers, no LM Studio needed."""
        from app.services.embedding_service import embed as local_embed
        return local_embed(text)


ai_provider = AIProvider()
