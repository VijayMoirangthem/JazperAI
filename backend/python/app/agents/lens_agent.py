"""
Lens — Vision Agent
Analyses images and camera frames. Requires vision-capable model.
"""
from app.agents.base_agent import BaseAgent, AgentTrace


class LensAgent(BaseAgent):
    name = "Lens"
    emoji = "📷"
    description = (
        "Vision agent. Call Lens when the user has attached an image or camera frame and asks "
        "about it — reading text, describing content, identifying objects, analysing documents. "
        "Lens requires an image to be present in the context."
    )
    model = "meta-llama/llama-4-scout-17b-16e-instruct"

    async def _run(
        self,
        task: str,
        context: dict,
        session_id: str,
        trace: AgentTrace,
        emit,
    ) -> str:
        from app.providers.ai_provider import ai_provider

        image = context.get("image")
        if not image:
            return "No image provided. Please attach an image for Lens to analyse."

        data_url = image if image.startswith("data:") else f"data:image/jpeg;base64,{image}"

        t0 = await self._emit_tool(emit, trace, "vision_analyse", task, {"has_image": True})

        system = (
            "You are Lens, a vision analysis assistant. Describe or read the image accurately "
            "and directly. No preamble. Answer exactly what was asked about the image."
        )
        messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": task},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            },
        ]
        trace.system_prompt = system
        trace.messages_sent = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"[image attached] {task}"},
        ]

        result = await ai_provider.chat(
            messages=messages,
            model=self.model,
            temperature=0.2,
            max_tokens=512,
        )

        await self._emit_tool_result(
            emit, trace, "vision_analyse",
            result.content[:200], {"has_image": True}, result.content, t0
        )

        trace.tokens_prompt = result.prompt_tokens
        trace.tokens_completion = result.completion_tokens
        trace.tokens_total = result.total_tokens

        return result.content
