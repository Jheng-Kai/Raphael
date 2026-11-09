"""A conversation's prefix stays cached where its next turn goes (owner, 2026-11-09, decisions 1, 3 and 4)."""

import json

import httpx

from raphael_core.brain import prompt_cache
from raphael_core.brain.openrouter import OpenRouterClient

from .test_openrouter_chat_tools import MESSAGES, TOOLS, reply

HOUR = {"type": "ephemeral", "ttl": "1h"}


def test_breakpoints_close_the_system_prompt_and_the_last_three_messages_that_can_carry_one():
    messages = [*MESSAGES, {"role": "user", "content": "And the oolong?"}]
    marked = prompt_cache.mark(messages, TOOLS, "1h")
    assert marked[0]["content"] == [{"type": "text", "text": "Work.", "cache_control": HOUR}]
    # The assistant turn that only calls a tool has no content to carry a marker; the three after the system do.
    assert marked[2] == MESSAGES[2]
    assert [message["content"][-1]["cache_control"] for message in (marked[1], marked[3], marked[4])] == [HOUR] * 3
    # The caller's conversation is never changed.
    assert messages[0]["content"] == "Work." and messages[4]["content"] == "And the oolong?"
    # Five minutes is the marker without a lifetime.
    assert prompt_cache.mark(messages, TOOLS, "5m")[0]["content"][0]["cache_control"] == {"type": "ephemeral"}


def test_a_one_shot_request_writes_nothing_nobody_would_read():
    once = [{"role": "system", "content": "Summarise."}, {"role": "user", "content": "The text."}]
    assert prompt_cache.mark(once, [], "1h") == once
    assert prompt_cache.cache_options(None, None) == {}
    assert prompt_cache.cache_options("raphael-5-7", "1h") == {"session": "raphael-5-7", "cache_ttl": "1h"}


async def call(**options):
    seen = []

    def handler(request):
        seen.append(request)
        return reply("done")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await OpenRouterClient(lambda: "sk-or-v1-test", http=http).chat_tools(
            messages=MESSAGES, tools=TOOLS, timeout_s=8, max_tokens=900, fallbacks=[], **options)
    return seen[0], json.loads(seen[0].content)


async def test_a_named_conversation_stays_on_one_upstream_and_an_anthropic_prompt_is_marked():
    request, body = await call(model="anthropic/claude-sonnet-5.5", session="raphael-5-7", cache_ttl="1h")
    assert request.headers["x-session-id"] == "raphael-5-7"
    # The fastest upstream of the moment would hold no cache: a named conversation is not sorted by speed.
    assert body["provider"] == {"require_parameters": True, "data_collection": "deny"}
    assert body["messages"][0]["content"][0]["cache_control"] == HOUR
    # Other models cache by themselves; they get the same upstream and no markers.
    request, body = await call(model="openai/gpt-6-luna", session="raphael-5-7", cache_ttl="1h")
    assert body["messages"] == MESSAGES and request.headers["x-session-id"] == "raphael-5-7"
    # A call that names no conversation is routed as before.
    request, body = await call(model="openai/gpt-6-luna")
    assert "x-session-id" not in request.headers and body["provider"]["sort"] == "latency"
