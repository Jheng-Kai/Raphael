"""Replies that arrive as server-sent events, read for as long as they keep arriving.

A model that thinks says nothing for minutes, and a connection that died says nothing either. They are told apart by
what came before: while the answer has not begun, the connection may stay quiet for as long as it is given (any line at
all, a keep-alive comment included, starts that wait again); once the answer flows, a gap of `STREAM_STALL_S` is a
connection that is gone. A stream that goes quiet raises `httpx.ReadTimeout`, one that ends before its answer was
complete `httpx.RemoteProtocolError`: the errors the callers already turn into a timeout and a network failure.

Adapted from NousResearch/hermes-agent and opencode (MIT); see core/packaging/licenses.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Callable

import httpx

from .. import retry_utils


class MalformedStream(ValueError):
    """A packet of the stream is not a JSON object."""


def _packet(payload: str) -> dict:
    try:
        packet = json.loads(payload)
    except ValueError:
        raise MalformedStream("A packet of the stream is not JSON") from None
    if not isinstance(packet, dict):
        raise MalformedStream("A packet of the stream is not an object")
    return packet


class Packets:
    """The `data:` packets of a stream as dicts, until `[DONE]` or the end; `finished` says the server sent `[DONE]`.

    `quiet_s` is how long the stream may say nothing before the answer begins, and `answering(packet)` says when it
    has. A packet that is not a JSON object raises MalformedStream."""

    def __init__(self, response: httpx.Response, quiet_s: float, answering: Callable[[dict], bool]) -> None:
        self._response, self._quiet_s, self._answering = response, quiet_s, answering
        self.finished = False

    async def __aiter__(self) -> AsyncIterator[dict]:
        lines = self._response.aiter_lines().__aiter__()
        limit, data = self._quiet_s, []
        while True:
            try:
                line = await asyncio.wait_for(lines.__anext__(), limit)
            except StopAsyncIteration:
                break
            except TimeoutError:
                raise httpx.ReadTimeout("The stream went quiet") from None
            if line.startswith("data:"):
                data.append(line[5:].lstrip())
            if line or not data:  # a comment, a field we do not use, or a blank line between events
                continue
            payload, data = "\n".join(data), []
            if payload == "[DONE]":
                self.finished = True
                return
            if not payload:
                continue
            packet = _packet(payload)
            yield packet
            if limit == self._quiet_s and self._answering(packet):
                limit = min(self._quiet_s, retry_utils.STREAM_STALL_S)
        if (payload := "\n".join(data)) == "[DONE]":  # the last event had no blank line after it
            self.finished = True
        elif payload:
            yield _packet(payload)


def _answering(packet: dict) -> bool:
    """Words or a call have begun to arrive. The first, empty chunk and the model's reasoning are not the answer."""
    for choice in packet.get("choices") or ():
        delta = choice.get("delta") if isinstance(choice, dict) else None
        if isinstance(delta, dict) and (delta.get("content") or delta.get("tool_calls")):
            return True
    return False


async def chat_completion(response: httpx.Response, quiet_s: float) -> dict:
    """The chunks of a chat completion stream, as the body the same completion would have had if it had not streamed."""
    text: list[str] = []
    refusal: list[str] = []
    calls: dict[int, dict] = {}
    usage: dict = {}
    model = finish = error = None
    packets = Packets(response, quiet_s, _answering)
    async for packet in packets:
        if isinstance(packet.get("error"), dict):
            error = packet["error"]
        if isinstance(packet.get("usage"), dict):
            usage = packet["usage"]
        model = packet.get("model") or model
        for choice in packet.get("choices") or ():
            if not isinstance(choice, dict):
                continue
            finish = choice.get("finish_reason") or finish
            delta = choice.get("delta")
            if not isinstance(delta, dict):
                continue
            if isinstance(delta.get("content"), str):
                text.append(delta["content"])
            if isinstance(delta.get("refusal"), str):
                refusal.append(delta["refusal"])
            for part in delta.get("tool_calls") or ():
                if not isinstance(part, dict):
                    continue
                call = calls.setdefault(part["index"] if type(part.get("index")) is int else len(calls),
                                        {"type": "function", "function": {"name": "", "arguments": ""}})
                if isinstance(part.get("id"), str) and part["id"]:
                    call["id"] = part["id"]
                function = part.get("function") if isinstance(part.get("function"), dict) else {}
                for field in ("name", "arguments"):
                    if isinstance(function.get(field), str):
                        call["function"][field] += function[field]
    if finish is None and error is None and not packets.finished:
        raise httpx.RemoteProtocolError("The stream ended before the answer was complete")
    message = {"role": "assistant", "content": "".join(text), "tool_calls": [calls[i] for i in sorted(calls)]}
    if refusal:
        message["refusal"] = "".join(refusal)
    body = {"model": model, "choices": [{"message": message, "finish_reason": finish}], "usage": usage}
    if error is not None:
        body["error"] = error
    return body
