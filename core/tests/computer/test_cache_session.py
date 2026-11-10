"""Every model call of a run on the owner's desktop reads the prefix the call before it cached (owner, 2026-11-09,
decisions 1 and 4): one name for the run's cache at its provider, kept for an hour, on every step."""

import asyncio
import json

import httpx

from agent.test_narration import chat, use
from brain.test_openrouter_chat_tools import reply as http_reply, tool_call
from raphael_core.brain.openrouter import OpenRouterClient

from .conftest import FakeModel, drive, reply
from .rig import decision
from .test_handback import Desktop, hands_over
from .test_operate import PRESS_SEVEN, operating, shell  # noqa: F401
from .test_run import LOOK_AND_PRESS_SEVEN, answering

HOUR = {"type": "ephemeral", "ttl": "1h"}


def cached(calls):
    """The cache name and lifetime each model call gave its provider."""
    return [(call.get("session"), call.get("cache_ttl")) for call in calls]


def unmarked(message):
    """A message as the run wrote it, without the cache marker that rode on its content."""
    content = message.get("content")
    if isinstance(content, list) and len(content) == 1 and "cache_control" in content[0]:
        return {**message, "content": content[0]["text"]}
    return message


async def test_every_step_of_a_run_names_one_cache_and_keeps_it_for_an_hour(make_run, shell):
    answering(shell)
    model = FakeModel(*LOOK_AND_PRESS_SEVEN)
    run = make_run(model)
    _, final = await drive(run, [(True, False)])
    assert final.status == "done"
    # A run that began in no conversation goes by its own id.
    assert cached(model.calls) == [(f"raphael-computer-0-{run.run_id}", "1h")] * len(LOOK_AND_PRESS_SEVEN)


async def test_a_run_the_owner_gave_the_computer_back_to_reads_the_same_cache(make_run, shell):
    desktop = Desktop(shell)
    model = FakeModel(*hands_over([reply(content="已上傳。")]))
    run = make_run(model, handback=True)
    run.start()
    await asyncio.wait_for(run.next_event(), 5)  # the sign-in is the owner's
    before = len(model.calls)
    desktop.signed_in = True
    assert run.give_back()
    final = await asyncio.wait_for(run.next_event(), 5)
    assert final.status == "done" and len(model.calls) > before
    assert cached(model.calls) == [(f"raphael-computer-0-{run.run_id}", "1h")] * len(model.calls)


async def test_a_run_begun_in_a_private_conversation_is_named_after_it(operating, client):
    client.chats.extend([
        chat("", use("computer", {"request": "在小算盤按七"})),
        *PRESS_SEVEN,
        chat(json.dumps({"prefix": "Answer", "text": "已按下「七」。", "detail": ""})),
    ])  # fmt: skip
    asked = await operating.call("agent.ask", {"session_id": "s1", "text": "在小算盤按七", "ui_language": "zh-TW",
                                               "source": "app"})  # fmt: skip
    assert asked["status"] == "confirm"
    done = await operating.confirm(asked["confirm"]["id"])
    assert done["status"] == "done"
    main = operating.service.conversations.main(0)
    calls = cached(client.chat_calls)
    # The conversation and the run are two prefixes, each with its own name, both kept for an hour.
    assert calls[0] == (f"raphael-0-{main}", "1h")
    assert calls[1:1 + len(PRESS_SEVEN)] == [(f"raphael-computer-0-{main}", "1h")] * len(PRESS_SEVEN)


async def test_a_spoken_quick_request_names_the_quick_conversation(operating, client):
    client.decisions.append(decision("operate"))
    client.chats.extend(PRESS_SEVEN)
    asked = await operating.ask("在小算盤按七")
    done = await operating.confirm(asked["confirm"]["id"])
    assert done["status"] == "done"
    quick = operating.service.conversations.quick()
    assert cached(client.chat_calls) == [(f"raphael-computer-0-{quick}", "1h")] * len(PRESS_SEVEN)


async def test_each_request_of_a_run_begins_with_the_prefix_the_one_before_it_cached(make_run, shell):
    answering(shell)
    script = [
        http_reply(calls=[tool_call("computer_apps", "{}", "c1")], finish="tool_calls"),
        http_reply(calls=[tool_call("computer_look", json.dumps({"window": 7}), "c2")], finish="tool_calls"),
        http_reply(calls=[tool_call("computer_act", json.dumps({"window": 7, "element": 3, "action": "click",
                                                                "final": False}), "c3")], finish="tool_calls"),
        http_reply("已按下「七」。"),
    ]  # fmt: skip
    seen = []

    def handler(request):
        seen.append(request)
        return script.pop(0)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        run = make_run(OpenRouterClient(lambda: "sk-or-v1-test", http=http))
        run.model = "anthropic/claude-sonnet-5.5"
        _, final = await drive(run, [(True, False)])
    assert final.status == "done" and len(seen) == 4
    bodies = [json.loads(request.content) for request in seen]
    # Every step goes where the one before it went: the same upstream, never the fastest of the moment.
    assert [request.headers["x-session-id"] for request in seen] == [f"raphael-computer-0-{run.run_id}"] * 4
    assert all(body["provider"] == {"require_parameters": True, "data_collection": "deny"} for body in bodies)
    for body in bodies:
        assert body["messages"][0]["content"][-1]["cache_control"] == HOUR  # the system prompt keeps the hour
        assert "cache_control" in body["messages"][-1]["content"][-1]  # what the next call reads up to
    # Each request starts with all the one before it sent, up to the marker on its last message.
    sent = [[unmarked(message) for message in body["messages"]] for body in bodies]
    for earlier, later in zip(sent, sent[1:]):
        assert later[:len(earlier)] == earlier
