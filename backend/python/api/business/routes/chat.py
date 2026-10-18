"""COOS — Business Platform: Jazper-for-business chat-with-tools endpoint.

Stateless, non-streaming JSON endpoint: given a message (+ optional prior
turns), runs a tool-calling loop against BUSINESS_TOOLS and returns the final
answer plus the list of tools invoked. Separate track from the personal-OS
chat/agent routes — no shared state, no session persistence (yet).
"""

from __future__ import annotations

import json
from typing import Optional

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

from core.providers.ai_provider import ai_provider
from api.business.tools import BUSINESS_TOOLS, execute_business_tool

router = APIRouter()
log = structlog.get_logger()

MAX_TOOL_ITERATIONS = 4

BUSINESS_SYSTEM_PROMPT = (
    "You are Jazper, the AI operating the COOS business platform. You have tools to manage "
    "clients. Use them when the user asks to create, list, look up, update, or remove a client. "
    "Be direct and confirm what action you took. If no tool applies, just answer normally."
)


class ChatRequest(BaseModel):
    message: str
    history: Optional[list[dict]] = None


@router.post("")
async def chat(body: ChatRequest):
    messages: list[dict] = (
        [{"role": "system", "content": BUSINESS_SYSTEM_PROMPT}]
        + (body.history or [])
        + [{"role": "user", "content": body.message}]
    )

    tools_called: list[str] = []
    final_text = ""

    for _ in range(MAX_TOOL_ITERATIONS):
        buffer_parts: list[str] = []
        tool_call = None

        async for chunk in ai_provider.stream_with_tools(
            messages,
            tools=BUSINESS_TOOLS,
            model=None,
            temperature=0.3,
            max_tokens=800,
        ):
            if isinstance(chunk, dict):
                if chunk.get("tool_call"):
                    tool_call = chunk
                # ignore __usage__ and any other sentinel dicts
                continue
            buffer_parts.append(chunk)

        buffer = "".join(buffer_parts).strip()

        if tool_call:
            tools_called.append(tool_call["name"])
            messages.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": tool_call["id"],
                    "type": "function",
                    "function": {
                        "name": tool_call["name"],
                        "arguments": json.dumps(tool_call["arguments"]),
                    },
                }],
            })
            tool_result = await execute_business_tool(tool_call["name"], tool_call["arguments"])
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": tool_result,
            })
            # loop again so the model can react to the tool result
            continue

        # No tool call this round — this is the final answer.
        final_text = buffer
        break

    if not final_text:
        final_text = "I completed the requested actions."

    return {"response": final_text, "tool_calls_made": tools_called}
