"""Owner chat transports share management while nested and shared scopes stay closed."""

from dataclasses import replace

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.service import _Ask, _AT_THIS_COMPUTER
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.background.snapshot import take_snapshot
from raphael_core.worker.loop import Outcome
from .test_answering import client, setup, typed, live_said  # noqa: F401


@pytest.mark.parametrize("source", ["telegram", "slack", "discord", "connector"])
@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_owner_chat_sources_offer_management_in_the_production_loop(setup, client, monkeypatch, source, brain):
    rig, _ = setup
    observed = []
    def check(tools):
        observed.append(True)
        assert "member_create" in {item["function"]["name"] for item in tools}
    if brain == "api":
        def reply(**kwargs):
            check(kwargs["tools"])
            return live_said("Ready.")
        client.chats = [reply]
    else:
        rig.settings.set("agent_model", "cli:codex:test")
        async def work(loop):
            check(loop.tools)
            loop._queue.put_nowait(Outcome("done", final="Ready."))
        monkeypatch.setattr(CliLoop, "_work", work)
    result = await typed(rig, "Create a member", 0, source=source, language="en")
    assert result["status"] == "done"
    assert observed
    assert _AT_THIS_COMPUTER == frozenset({"voice", "overlay", "app"})


@pytest.mark.parametrize("source", ["telegram", "slack", "discord", "connector"])
@pytest.mark.parametrize("blocked", ["nested", "room", "exchange", "depth", "background", "peers"])
def test_shared_and_nested_requests_keep_management_closed(source, blocked):
    from raphael_core.agent.service import AgentService
    ask = _Ask(session_id="owner", text="Create a member", language="en", source=source, speaker=RAPHAEL)
    if blocked == "nested":
        ask.peer = 1
    elif blocked in ("room", "exchange"):
        ask.scope = blocked
    elif blocked == "depth":
        ask.speaker = replace(RAPHAEL, depth=1)
    elif blocked == "background":
        ask.background_owner = True
    else:
        ask.exchange_speakers = ("One", "Two")
    assert not AgentService._management_chat(ask)


@pytest.mark.parametrize("query", ["member_create", "Create a member", "group_delete"])
def test_find_tools_explains_withheld_management(query):
    snapshot = take_snapshot(None, interactive=True, owner_management=False)
    definitions, lines = snapshot.find(query)
    assert not any(item["function"]["name"] == "member_create" for item in definitions)
    assert "member management is not offered in this chat" in "\n".join(lines)
