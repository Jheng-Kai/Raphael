"""ChatGPT plan inference through public Responses, in Raphael's own guarded tool loop."""

import asyncio
import base64
import binascii
import json
import logging
import time

import httpx

from ..meter import responses as responses_usage
from ..model_ref import EFFORTS
from ..openrouter import (
    ChatTurn, ChatToolCall, Completion, OpenRouterError, TextCompletion, ToolCall, ToolPlan, request_timeout, retry_after_of,
)
from ..streams import Packets
from .chatgpt_auth import RESOURCE, failure

logger = logging.getLogger(__name__)


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
        self._unlisted_efforts = set()

    def _effort(self, model, requested):
        if requested != "none":
            return requested
        row = next((row for row in self.auth.model_rows if row.get("id") == model), None)
        levels = row.get("reasoning_efforts", []) if row else []
        least = next((effort for effort in EFFORTS if effort in levels), None)
        if least is None and model not in self._unlisted_efforts:
            self._unlisted_efforts.add(model)
            logger.debug("ChatGPT reasoning metadata unavailable for %s; retaining backend default", model)
        return least

    async def generate_image(self, *, model, prompt, square=False, timeout_s=240):
        """Request one hosted image on this plan, without borrowing Codex or API credentials."""
        from ...services.attachments import Attachment, MAX_IMAGE_BYTES, sniff_ok

        token = await self.auth.access_token()
        session = self.auth.session()
        body = {"model": model, "input": [{"role": "user", "content": prompt}],
                "instructions": "Generate exactly one image. Do not call other tools.",
                "store": False, "stream": True, "tools": [{"type": "image_generation",
                    "output_format": "png", **({"size": "1024x1024"} if square else {})}],
                "tool_choice": {"type": "image_generation"}}
        completed, output = None, []
        try:
            async with asyncio.timeout(timeout_s):
                async with self.auth.http().stream("POST", RESOURCE + "/responses", json=body,
                        headers={"Authorization": "Bearer " + token}, timeout=timeout_s,
                        follow_redirects=False) as response:
                    if not response.is_success:
                        await response.aread()
                        try:
                            error = response.json()
                        except ValueError:
                            error = {}
                        raise failure(response.status_code, error, response.headers.get("x-request-id"))
                    async for packet in Packets(response, timeout_s, lambda packet: False):
                        kind = packet.get("type")
                        if kind in ("response.failed", "response.incomplete", "error"):
                            raise failure(200, packet.get("response", packet))
                        if kind == "response.output_item.done":
                            output.append(packet["item"])
                        elif kind == "response.completed":
                            completed = packet["response"]
            self.auth.check_session(session)
            if not isinstance(completed, dict) or completed.get("status") != "completed":
                raise OpenRouterError(200, "bad_response", "ChatGPT returned no completed image")
            items = completed.get("output") or output
            if any(part.get("type") == "refusal" for item in items if isinstance(item, dict)
                   for part in item.get("content", []) if isinstance(part, dict)):
                raise OpenRouterError(200, "content_policy", "ChatGPT declined the image")
            images = [item for item in items if isinstance(item, dict) and item.get("type") == "image_generation_call"]
            if len(images) != 1 or images[0].get("status") != "completed":
                raise ValueError
            encoded = images[0].get("result")
            if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_IMAGE_BYTES + 2) // 3):
                raise ValueError
            raw = base64.b64decode(encoded, validate=True)
            mime = next(mime for mime in ("image/png", "image/jpeg", "image/webp") if sniff_ok(mime, raw))
            if len(raw) > MAX_IMAGE_BYTES:
                raise ValueError
            return Attachment("generated." + {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime], mime, raw)
        except (TimeoutError, httpx.TimeoutException):
            raise OpenRouterError(0, "timeout", "ChatGPT image timed out") from None
        except httpx.TransportError:
            raise OpenRouterError(0, "network", "ChatGPT image was interrupted") from None
        except (ValueError, TypeError, KeyError, StopIteration, binascii.Error):
            raise OpenRouterError(200, "bad_response", "ChatGPT returned no valid image") from None

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

    async def chat_tools(self, *, model, messages, tools, timeout_s, max_tokens, fallbacks=(), reasoning_effort="none",
                         _retain_reasoning=True, _cache_key=None, session=None, cache_ttl=None):
        """One turn of a conversation. `session` names the conversation: as Codex does (core/src/client.rs,
        requests/headers.rs), it is the prompt cache key and the `session-id` header, from which ChatGPT
        derives cache affinity, so every turn of it lands where its prefix is cached. The cache's lifetime
        is the service's own (`cache_ttl` is for Anthropic prompts)."""
        token = await self.auth.access_token()
        login = self.auth.session()
        items, instructions = _input(messages)
        body = {"model": model, "input": items, "store": False, "stream": True}
        if _retain_reasoning:
            body["include"] = ["reasoning.encrypted_content"]
        if _cache_key or session:
            body["prompt_cache_key"] = _cache_key or session
        if instructions:
            body["instructions"] = instructions
        effort = self._effort(model, reasoning_effort)
        if effort is not None:
            body["reasoning"] = {"effort": effort}
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
                    headers={"Authorization": "Bearer " + token, **({"session-id": session} if session else {})},
                    timeout=request_timeout(timeout_s), follow_redirects=False) as response:
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
        if completed is None:
            # The connection closed before the reply was whole, with no error: a cut connection, asked again like one.
            raise OpenRouterError(0, "network", "ChatGPT response ended early")
        if completed.get("status") != ("incomplete" if cut else "completed") or not isinstance(completed.get("output"), list):
            raise OpenRouterError(200, "tool_broken", "ChatGPT stream ended without completed inference")
        self.auth.check_session(login)
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
            finish_reason="length" if cut else "", usage=responses_usage(usage))

    async def chat_text(self, *, model, system, user, timeout_s, max_tokens, fallbacks=(), plugins=(), reasoning_effort="none",
                        _cache_key="raphael-text"):
        if plugins:
            raise OpenRouterError(0, "unsupported", "ChatGPT does not support OpenRouter plugins")
        result = await self.chat_tools(model=model, messages=[{"role": "system", "content": system},
            {"role": "user", "content": user}], tools=[], timeout_s=timeout_s,
            max_tokens=max_tokens, reasoning_effort=reasoning_effort,
            _retain_reasoning=False, _cache_key=_cache_key)
        return TextCompletion(result.content, result.model, 0.0, result.prompt_tokens,
                              result.completion_tokens, result.latency_ms, [], usage_known=True, usage=result.usage)

    async def complete_json(self, *, schema, schema_name, system, user, **kwargs):
        import jsonschema

        result = await self.chat_text(system=system + "\nReturn only a JSON object matching this schema: " + json.dumps(schema),
                                      user=user, _cache_key="raphael-cleanup" if schema_name == "cleaned_dictation"
                                      else "raphael-json-" + schema_name, **kwargs)
        try:
            from ..structured import structured_object
            data = structured_object(result.text, schema)
            if not isinstance(data, dict):
                raise ValueError
        except (ValueError, jsonschema.ValidationError):
            raise OpenRouterError(200, "invalid_request", "ChatGPT returned invalid structured output") from None
        return Completion(data, result.model, 0.0, result.prompt_tokens, result.completion_tokens, result.latency_ms,
                          usage=result.usage)

    async def plan_tools(self, *, system, user, **kwargs):
        result = await self.chat_tools(messages=[{"role": "system", "content": system},
            {"role": "user", "content": user}], _retain_reasoning=False, _cache_key="raphael-planner", **kwargs)
        return ToolPlan([ToolCall(call.name, call.arguments) for call in result.calls], result.model,
                        0.0, result.prompt_tokens, result.completion_tokens, result.latency_ms)

    async def transcribe(self, **kwargs):
        raise OpenRouterError(0, "unsupported", "ChatGPT plan does not support transcription")

    async def key_info(self, key=None, timeout_s=5):
        raise OpenRouterError(0, "unsupported", "ChatGPT plan has no quota meter endpoint")

    async def aclose(self):
        await self.auth.aclose()
