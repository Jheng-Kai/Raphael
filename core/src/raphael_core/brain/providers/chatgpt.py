"""ChatGPT plan inference through public Responses, in Raphael's own guarded tool loop."""

import json
import time

import httpx

from ..model_ref import EFFORTS
from ..openrouter import (
    ChatTurn, ChatToolCall, Completion, OpenRouterError, TextCompletion, ToolCall, ToolPlan, request_timeout, retry_after_of,
)
from ..streams import Packets
from .chatgpt_auth import RESOURCE, failure


def _answering(packet):
    """The answer has begun: words or a call are arriving. The model's reasoning and the bookkeeping events are not."""
    kind = packet.get("type")
    return isinstance(kind, str) and kind.endswith(".delta") and "reasoning" not in kind


def _input(messages):
    items, instructions = [], []
    for message in messages:
        role = message["role"]
        if role == "system":
            instructions.append(message.get("content") or "")
        elif role == "tool":
            items.append({"type": "function_call_output", "call_id": message["tool_call_id"],
                          "output": message.get("content") or ""})
        elif message.get("responses_output"):
            items.extend(message["responses_output"])
        else:
            content = message.get("content")
            if content:
                if isinstance(content, list):
                    parts = []
                    for part in content:
                        if part.get("type") == "text":
                            parts.append({"type": "input_text", "text": part["text"]})
                        elif part.get("type") == "image_url":
                            parts.append({"type": "input_image", "image_url": part["image_url"]["url"]})
                        else:
                            raise OpenRouterError(0, "unsupported", "Unsupported ChatGPT input")
                    content = parts
                items.append({"role": role, "content": content})
            for call in message.get("tool_calls", []):
                items.append({"type": "function_call", "call_id": call["id"],
                    "name": call["function"]["name"], "namespace": "raphael",
                    "arguments": call["function"]["arguments"]})
    return items, "\n\n".join(instructions)


def _cut_by_output_limit(response):
    details = response.get("incomplete_details") if isinstance(response, dict) else None
    return isinstance(details, dict) and details.get("reason") == "max_output_tokens"


class ChatGPTProvider:
    def __init__(self, auth):
        self.auth = auth

    async def models(self, timeout_s=5):
        token = await self.auth.access_token()
        session = self.auth.session()
        body = await self.auth.request("GET", RESOURCE + "/models", headers={"Authorization": "Bearer " + token})
        self.auth.check_session(session)
        if not isinstance(body.get("models"), list):
            raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT model list")
        rows = []
        for row in body["models"]:
            if not isinstance(row, dict) or row.get("visibility") != "list":
                continue
            if not isinstance(row.get("slug"), str) or not row["slug"] or not isinstance(row.get("display_name"), str):
                raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT model metadata")
            levels = row.get("supported_reasoning_levels")
            efforts = [level["effort"] for level in levels if isinstance(level, dict) and level.get("effort") in EFFORTS] if isinstance(levels, list) else []
            default = row.get("default_reasoning_level")
            window = next((row[key] for key in ("context_window", "max_context_window")
                           if type(row.get(key)) is int and row[key] > 0), None)
            rows.append({"id": row["slug"], "slug": row["slug"], "name": row["display_name"],
                "display_name": row["display_name"], "tools": True, "vision": True,
                "context": window, "price_in": None, "price_out": None,
                "reasoning_efforts": efforts, "default_effort": default if default in efforts else None})
        self.auth.model_rows = rows
        return rows

    async def chat_tools(self, *, model, messages, tools, timeout_s, max_tokens, fallbacks=(), reasoning_effort="none"):
        token = await self.auth.access_token()
        session = self.auth.session()
        items, instructions = _input(messages)
        body = {"model": model, "input": items, "store": False, "stream": True,
                "include": ["reasoning.encrypted_content"]}
        if instructions:
            body["instructions"] = instructions
        if reasoning_effort != "none":
            body["reasoning"] = {"effort": reasoning_effort}
        if tools:
            body["tools"] = [{"type": "namespace", "name": "raphael",
                "description": "Raphael's local guarded tools", "tools": [
                    {"type": "function", "name": tool["function"]["name"],
                     "description": tool["function"].get("description", ""),
                     "parameters": tool["function"]["parameters"], "strict": False} for tool in tools]}]
        started = time.perf_counter()
        completed, streamed, cut = None, [], False
        try:
            async with self.auth.http().stream("POST", RESOURCE + "/responses", json=body,
                    headers={"Authorization": "Bearer " + token}, timeout=request_timeout(timeout_s), follow_redirects=False) as response:
                if not response.is_success:
                    await response.aread()
                    try:
                        error_body = response.json()
                    except ValueError:
                        error_body = {}
                    raise failure(response.status_code, error_body, response.headers.get("x-request-id"),
                                  retry_after_of(response, error_body))
                async for packet in Packets(response, timeout_s, _answering):
                    kind = packet.get("type")
                    if kind == "response.incomplete" and _cut_by_output_limit(packet.get("response")):
                        completed, cut = packet["response"], True  # what it wrote is still a reply, cut short
                    elif kind in ("response.failed", "response.incomplete", "error"):
                        raise failure(200, packet.get("response", packet), response.headers.get("x-request-id"))
                    if kind == "response.output_item.done":
                        streamed.append(packet["item"])
                    if kind == "response.completed":
                        completed = packet["response"]
                        if not isinstance(completed, dict):
                            raise ValueError
        except httpx.TimeoutException:
            raise OpenRouterError(0, "timeout", "ChatGPT response timed out") from None
        except httpx.TransportError:
            raise OpenRouterError(0, "network", "ChatGPT response was interrupted") from None
        except (ValueError, TypeError, KeyError):
            raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT response stream") from None
        if completed is None or completed.get("status") != ("incomplete" if cut else "completed") or not isinstance(completed.get("output"), list):
            raise OpenRouterError(200, "tool_broken", "ChatGPT stream ended without completed inference")
        self.auth.check_session(session)
        # The plan endpoint streams its items and closes with an empty `output`.
        output, text, calls = completed["output"] or streamed, [], []
        for item in output:
            if not isinstance(item, dict):
                raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT output item")
            if item.get("type") == "message":
                if not isinstance(item.get("content"), list):
                    raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT message")
                for part in item["content"]:
                    if not isinstance(part, dict):
                        raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT content")
                    if part.get("type") == "refusal":
                        raise OpenRouterError(200, "refused", "ChatGPT declined the request")
                    if part.get("type") == "output_text":
                        if not isinstance(part.get("text"), str):
                            raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT text")
                        text.append(part["text"])
            elif item.get("type") == "function_call":
                raw = item.get("arguments", "")
                if not all(isinstance(item.get(key), str) and item[key] for key in ("call_id", "name")) or not isinstance(raw, str):
                    raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT function call")
                try:
                    arguments = json.loads(raw)
                except (ValueError, TypeError):
                    arguments = None
                name = item.get("name", "")
                if item.get("namespace", "raphael") != "raphael":
                    name = "__unknown_namespace__"
                calls.append(ChatToolCall(item["call_id"], name, arguments, raw))
        usage = completed.get("usage") or {}
        if not isinstance(usage, dict) or any(type(usage.get(key, 0)) is not int or usage.get(key, 0) < 0
                for key in ("input_tokens", "output_tokens")):
            raise OpenRouterError(200, "invalid_request", "Invalid ChatGPT usage")
        # Subscription usage is not a dollar price or an invented remaining-quota meter.
        return ChatTurn("".join(text), calls, completed.get("model", model), 0.0,
            int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0)),
            int((time.perf_counter() - started) * 1000), usage_known=True, responses_output=output,
            finish_reason="length" if cut else "")

    async def chat_text(self, *, model, system, user, timeout_s, max_tokens, fallbacks=(), plugins=(), reasoning_effort="none"):
        if plugins:
            raise OpenRouterError(0, "unsupported", "ChatGPT does not support OpenRouter plugins")
        result = await self.chat_tools(model=model, messages=[{"role": "system", "content": system},
            {"role": "user", "content": user}], tools=[], timeout_s=timeout_s,
            max_tokens=max_tokens, reasoning_effort=reasoning_effort)
        return TextCompletion(result.content, result.model, 0.0, result.prompt_tokens,
                              result.completion_tokens, result.latency_ms, [], usage_known=True)

    async def complete_json(self, *, schema, schema_name, system, user, **kwargs):
        import jsonschema

        result = await self.chat_text(system=system + "\nReturn only a JSON object matching this schema: " + json.dumps(schema),
                                      user=user, **kwargs)
        try:
            from ..structured import structured_object
            data = structured_object(result.text, schema)
            if not isinstance(data, dict):
                raise ValueError
        except (ValueError, jsonschema.ValidationError):
            raise OpenRouterError(200, "invalid_request", "ChatGPT returned invalid structured output") from None
        return Completion(data, result.model, 0.0, result.prompt_tokens, result.completion_tokens, result.latency_ms)

    async def plan_tools(self, *, system, user, **kwargs):
        result = await self.chat_tools(messages=[{"role": "system", "content": system},
            {"role": "user", "content": user}], **kwargs)
        return ToolPlan([ToolCall(call.name, call.arguments) for call in result.calls], result.model,
                        0.0, result.prompt_tokens, result.completion_tokens, result.latency_ms)

    async def transcribe(self, **kwargs):
        raise OpenRouterError(0, "unsupported", "ChatGPT plan does not support transcription")

    async def key_info(self, key=None, timeout_s=5):
        raise OpenRouterError(0, "unsupported", "ChatGPT plan has no quota meter endpoint")

    async def aclose(self):
        await self.auth.aclose()
