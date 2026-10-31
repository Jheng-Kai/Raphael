"""A model call that streams: the reply is read as it arrives, a long think is not a dead connection, a connection that
went quiet is. Every request goes to an httpx.MockTransport (the stream is an async generator that waits where a model
would), so no test touches the network."""

import asyncio
import json

import httpx
import pytest

from raphael_core import retry_utils
from raphael_core.brain.openrouter import ChatToolCall, OpenRouterClient, OpenRouterError, request_timeout
from raphael_core.brain.providers.clients import CompatibleProvider
from raphael_core.failures import classify

MESSAGES = [{"role": "system", "content": "Work."}, {"role": "user", "content": "tea?"}]
TOOLS = [{"type": "function", "function": {"name": "Notes__look", "description": "d", "parameters": {"type": "object"}}}]


def chunk(delta=None, finish=None, **rest):
    return {"id": "gen-1", "model": "openai/gpt-6-luna", "choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}], **rest}


def sse(*events):
    """Server-sent events: a dict is a data packet, a string is a line of its own (a comment, [DONE])."""
    return "".join(f"data: {json.dumps(e)}\n\n" if isinstance(e, dict) else f"{e}\n\n" for e in events).encode()


def streaming(*parts, status=200, headers=None):
    """A response whose body arrives in parts; a number is a wait, in seconds, before the next part."""

    async def body():
        for part in parts:
            if isinstance(part, (int, float)):
                await asyncio.sleep(part)
            else:
                yield part

    return httpx.Response(status, headers={"content-type": "text/event-stream", **(headers or {})}, content=body())


async def call(handler, make=None, **overrides):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = (make or (lambda http: OpenRouterClient(lambda: "sk-or-v1-test", http=http)))(http)
        args = {"model": "openai/gpt-6-luna", "fallbacks": [], "messages": MESSAGES, "tools": TOOLS, "timeout_s": 5, "max_tokens": 100}
        return await client.chat_tools(**{**args, **overrides})


async def test_the_reply_is_asked_for_as_a_stream():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return streaming(sse(chunk({"content": "Hi"}, "stop"), "data: [DONE]"))

    await call(handler)
    assert seen[0]["stream"] is True and seen[0]["messages"] == MESSAGES


async def test_words_calls_and_usage_come_back_as_the_turn_the_whole_reply_would_have_been():
    events = [
        ": OPENROUTER PROCESSING",
        chunk({"role": "assistant", "content": ""}),
        chunk({"reasoning": "thinking that is never published"}),
        chunk({"content": "Looking "}),
        chunk({"content": "now."}),
        chunk({"tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "Notes__look", "arguments": ""}}]}),
        chunk({"tool_calls": [{"index": 0, "function": {"arguments": '{"topic":'}}]}),
        chunk({"tool_calls": [{"index": 0, "function": {"arguments": ' "tea"}'}}]}),
        chunk({"tool_calls": [{"index": 1, "id": "call_2", "type": "function", "function": {"name": "Notes__note", "arguments": "{}"}}]}),
        chunk({}, "tool_calls"),
        chunk(usage={"prompt_tokens": 500, "completion_tokens": 30, "cost": 0.0004}) | {"choices": []},
        "data: [DONE]",
    ]
    turn = await call(lambda request: streaming(sse(*events)))
    assert turn.content == "Looking now."
    assert turn.calls == [
        ChatToolCall("call_1", "Notes__look", {"topic": "tea"}, '{"topic": "tea"}'),
        ChatToolCall("call_2", "Notes__note", {}, "{}"),
    ]
    assert (turn.model, turn.cost_usd, turn.prompt_tokens, turn.completion_tokens, turn.usage_known) == (
        "openai/gpt-6-luna", 0.0004, 500, 30, True)


async def test_a_packet_may_be_split_across_the_pieces_the_network_delivers():
    whole = sse(chunk({"content": "Hello."}, "stop"), "data: [DONE]")
    turn = await call(lambda request: streaming(whole[:20], whole[20:55], whole[55:]))
    assert turn.content == "Hello."


async def test_a_server_that_ignores_the_stream_and_answers_whole_is_still_read():
    body = {"model": "m", "choices": [{"message": {"role": "assistant", "content": "Whole."}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "cost": 0.1}}
    turn = await call(lambda request: httpx.Response(200, json=body))
    assert turn.content == "Whole." and turn.cost_usd == 0.1


async def test_a_server_that_says_done_has_finished_whether_or_not_it_named_a_reason():
    assert (await call(lambda request: streaming(sse(chunk({"content": "Hi."}), "data: [DONE]")))).content == "Hi."
    last = b"data: " + json.dumps(chunk({"content": "Hi."}, "stop")).encode()  # no blank line after the final event
    assert (await call(lambda request: streaming(last))).content == "Hi."


async def test_a_reply_that_stops_before_it_finished_is_a_broken_connection_not_a_short_answer():
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(sse(chunk({"content": "Half an ans"}))))
    assert error.value.kind == "network" and classify(error.value).transient


async def test_a_packet_that_is_not_json_is_a_bad_response_and_not_a_hang():
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(b"data: {not json\n\n"))
    assert error.value.kind == "bad_response"
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(b"data: {not json\n\n"), make=compatible, model="gpt-4.1")
    assert error.value.kind == "error"


async def test_an_error_the_provider_reports_inside_the_stream_is_a_server_error():
    events = [chunk({"content": "part"}), {"error": {"code": 502, "message": "Provider disconnected"}, **chunk({"content": ""}, "error")}]
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(sse(*events)))
    assert error.value.kind == "server" and classify(error.value).transient


async def test_a_refusal_before_the_stream_starts_is_the_error_it_earns_with_the_wait_the_provider_asked_for():
    def handler(request):
        return httpx.Response(429, json={"error": {"message": "slow down"}}, headers={"Retry-After": "30"})

    with pytest.raises(OpenRouterError) as error:
        await call(handler)
    assert error.value.kind == "rate_limit" and 29 <= classify(error.value).retry_after <= 30


# --- silence -----------------------------------------------------------------------------------------------


async def test_a_model_that_thinks_in_silence_is_waited_for_up_to_the_silence_it_is_given():
    turn = await call(lambda request: streaming(0.3, sse(chunk({"content": "Done."}, "stop"), "data: [DONE]")), timeout_s=2)
    assert turn.content == "Done."


async def test_a_connection_that_says_nothing_for_longer_than_that_is_a_timeout():
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(5, sse(chunk({"content": "Late."}, "stop"))), timeout_s=0.2)
    assert error.value.kind == "timeout" and classify(error.value).transient


async def test_keep_alive_comments_while_it_thinks_are_traffic_so_the_wait_has_no_other_end():
    parts = [sse(": OPENROUTER PROCESSING"), 0.1] * 6 + [sse(chunk({"content": "Done."}, "stop"), "data: [DONE]")]
    turn = await call(lambda request: streaming(*parts), timeout_s=0.25)
    assert turn.content == "Done."


async def test_once_the_answer_is_flowing_a_gap_is_a_dead_connection_not_a_thought(monkeypatch):
    monkeypatch.setattr(retry_utils, "STREAM_STALL_S", 0.2)
    parts = [sse(chunk({"content": "The answer "})), 5, sse(chunk({"content": "goes on."}, "stop"))]
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(*parts), timeout_s=3)
    assert error.value.kind == "timeout"


async def test_thinking_that_streams_is_not_the_answer_so_a_gap_in_it_is_still_a_thought(monkeypatch):
    monkeypatch.setattr(retry_utils, "STREAM_STALL_S", 0.1)
    parts = [sse(chunk({"reasoning": "hm"})), 0.3, sse(chunk({"content": "Done."}, "stop"), "data: [DONE]")]
    assert (await call(lambda request: streaming(*parts), timeout_s=3)).content == "Done."


def test_connecting_has_its_own_short_limit_and_the_rest_waits_as_long_as_it_is_told():
    timeout = request_timeout(1800)
    assert (timeout.connect, timeout.read, timeout.write) == (30.0, 1800, 1800)
    assert request_timeout(5).connect == 5


async def test_bedrock_and_the_whole_reply_calls_connect_at_the_same_limit():
    from raphael_core.brain.providers.bedrock import BedrockProvider

    seen = []

    def handler(request):
        seen.append(request.extensions["timeout"])
        if request.url.host.startswith("bedrock"):
            return httpx.Response(200, json={"output": {"message": {"content": [{"text": "x"}]}}, "stopReason": "end_turn"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}, "finish_reason": "stop"}]})

    credentials = json.dumps({"key_id": "access", "secret": "secret"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        bedrock = BedrockProvider("bedrock", "https://bedrock-runtime.us-east-1.amazonaws.com", lambda: credentials,
                                  region="us-east-1", http=http)
        await bedrock.chat_text(model="anthropic.claude-test-v1:0", system="s", user="u", timeout_s=1800, max_tokens=10)
        await OpenRouterClient(lambda: "sk-or-v1-test", http=http).chat_text(model="m", system="s", user="u", timeout_s=1800, max_tokens=10)
    assert [t["connect"] for t in seen] == [30.0, 30.0] and [t["read"] for t in seen] == [1800, 1800]


async def test_a_dead_host_is_given_up_on_at_the_connect_limit_not_the_silence(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.extensions["timeout"])
        return streaming(sse(chunk({"content": "x"}, "stop")))

    await call(handler, timeout_s=1800)
    assert seen[0]["connect"] == 30.0 and seen[0]["read"] == 1800


# --- the other providers that speak the same wire --------------------------------------------------------------


def compatible(http):
    return CompatibleProvider("openai", "https://api.openai.com/v1", lambda: "sk-test", http=http)


async def test_an_openai_compatible_provider_streams_too_and_asks_for_the_usage():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        events = [chunk({"content": "Hi."}, "stop"), chunk(usage={"prompt_tokens": 7, "completion_tokens": 2}) | {"choices": []}, "data: [DONE]"]
        return streaming(sse(*events))

    turn = await call(handler, make=compatible, model="gpt-4.1")
    assert seen[0]["stream"] is True and seen[0]["stream_options"] == {"include_usage": True}
    assert (turn.content, turn.prompt_tokens, turn.completion_tokens) == ("Hi.", 7, 2)
    assert turn.usage_known is False  # a price it does not know is not a free call


def test_the_kinds_that_stream_are_kinds_there_are():
    from raphael_core.brain.providers.clients import STREAMING_KINDS
    from raphael_core.brain.providers.presets import BY_KIND

    assert STREAMING_KINDS <= BY_KIND.keys()
    # The ones that speak another wire than the OpenAI chat completions are never among them.
    assert not STREAMING_KINDS & {"anthropic", "bedrock", "vertex", "google", "mistral"}


async def test_a_provider_not_known_to_stream_the_openai_way_is_asked_for_the_whole_reply():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "Whole."}, "finish_reason": "stop"}]})

    mistral = lambda http: CompatibleProvider("mistral", "https://api.mistral.ai/v1", lambda: "sk-test", http=http)
    assert (await call(handler, make=mistral, model="mistral-large")).content == "Whole."
    assert "stream" not in seen[0] and "stream_options" not in seen[0]


async def test_an_openai_compatible_provider_that_answers_whole_is_still_read():
    body = {"choices": [{"message": {"content": "Whole."}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1}}
    assert (await call(lambda request: httpx.Response(200, json=body), make=compatible, model="gpt-4.1")).content == "Whole."


async def test_a_compatible_provider_that_cuts_the_stream_off_is_a_timeout(monkeypatch):
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(5), make=compatible, model="gpt-4.1", timeout_s=0.2)
    assert error.value.kind == "timeout"


async def test_a_refusal_that_streams_in_is_still_a_refusal():
    events = [chunk({"refusal": "I cannot "}), chunk({"refusal": "help."}, "stop"), "data: [DONE]"]
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(sse(*events)), make=compatible, model="gpt-4.1")
    assert error.value.kind == "refusal" and "cannot" not in str(error.value)


async def test_a_compatible_provider_that_fails_while_answering_is_a_server_error_to_try_again():
    events = [chunk({"content": "part"}), {"error": {"message": "The server had an error while processing your request"}}]
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: streaming(sse(*events)), make=compatible, model="gpt-4.1")
    assert error.value.kind == "server" and classify(error.value).transient


async def test_a_context_the_compatible_provider_cannot_take_is_told_apart_from_a_refusal():
    body = {"error": {"code": "context_length_exceeded", "message": "This model's maximum context length is 8192 tokens."}}
    with pytest.raises(OpenRouterError) as error:
        await call(lambda request: httpx.Response(400, json=body), make=compatible, model="gpt-4.1")
    assert error.value.kind == "context_overflow"
