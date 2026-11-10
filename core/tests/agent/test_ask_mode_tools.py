"""The 手動 mode (`action_mode = "ask"`): a yes on the card makes the call.

The plugins are real ones over in-memory servers and the brains are fakes (a scripted chat model, a fake
Claude Code CLI that calls Raphael's MCP server); no test spends money or touches the network."""

import json

import pytest

from raphael_core.agent.policy import Tier

from .test_narration import chat, typed, use
from .test_plugins import calls, plugins  # noqa: F401
from .test_service import make_rig  # noqa: F401
from .conftest import decision


@pytest.mark.parametrize("tool,arguments", [("Notes__look", {"topic": "tea"}), ("Notes__note", {"text": "tea"})])
async def test_api_brain_in_ask_mode_makes_a_t1_call_after_a_yes(make_rig, plugins, calls, client, tool, arguments):
    await plugins.connect(look="T1", note="T1")
    rig = make_rig(plugins=plugins.hub)
    rig.settings.set("action_mode", "ask")
    client.decisions.append(decision("answer"))
    client.chats = [chat("On it.", use(tool, arguments)),
                    chat(json.dumps({"prefix": "Answer", "text": "Done.", "detail": ""}))]
    asked = await typed(rig, "Look it up")
    assert asked["status"] == "confirm", asked
    assert calls == []
    done = await rig.confirm(asked["confirm"]["id"])
    assert done["text"] == "Done."
    assert calls == [tool.split("__")[1]]
    assert plugins.audit()[-1][3:] == ("user", "ok")


async def test_a_yes_to_a_call_the_plugin_tiers_by_its_arguments_makes_the_call(make_rig, plugins, calls, client, monkeypatch):
    # A router tool is one tier on offer and another once it is given its inputs (`tier_for_call`). The question is
    # asked at the tier of the call, so the yes that answers it covers that call and nothing above it.
    await plugins.connect(note="T2")
    monkeypatch.setattr(plugins.hub, "tier_for_call", lambda key, arguments: Tier.T3 if arguments.get("text") == "wire" else Tier.T2)
    rig = make_rig(plugins=plugins.hub)
    client.decisions.append(decision("answer"))
    client.chats = [chat("On it.", use("Notes__note", {"text": "wire"})),
                    chat(json.dumps({"prefix": "Answer", "text": "Done.", "detail": ""}))]
    asked = await typed(rig, "Send it")
    assert asked["status"] == "confirm" and asked["confirm"]["tier"] == "T3", asked
    done = await rig.confirm(asked["confirm"]["id"])
    assert done["text"] == "Done."
    assert calls == ["note"]


async def test_a_yes_still_does_not_cover_a_call_whose_tier_rose_after_the_question(make_rig, plugins, calls, client, monkeypatch):
    await plugins.connect(note="T2")
    tiers = {"now": Tier.T2}
    monkeypatch.setattr(plugins.hub, "tier_for_call", lambda key, arguments: tiers["now"])
    rig = make_rig(plugins=plugins.hub)
    client.decisions.append(decision("answer"))
    client.chats = [chat("On it.", use("Notes__note", {"text": "wire"}))]
    asked = await typed(rig, "Send it")
    assert asked["status"] == "confirm"
    tiers["now"] = Tier.T3
    await rig.confirm(asked["confirm"]["id"])
    assert calls == []
