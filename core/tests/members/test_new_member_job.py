"""A member made with only a name greets the owner, asks what it is for, and keeps the answer."""

import pytest

from agent.test_narration import chat
from raphael_core.agent.harness_tools import definitions_for
from raphael_core.agent.speaker import RAPHAEL, Speaker

from .test_answering import client, setup, member, typed, live_said  # noqa: F401


@pytest.fixture(autouse=True)
def member_rpc(setup):
    rig, team = setup
    team.members.register(rig.rpc)


async def made(rig, **fields):
    return (await rig.call("members.create", {"greet": True, **fields}))["member"]


@pytest.mark.parametrize("language,words", [("zh-TW", "你想請我"), ("en", "What would you like"), ("ja", "お手伝い")])
async def test_it_speaks_first_in_the_window_language_without_a_model(setup, client, language, words):
    rig, team = setup
    new = await made(rig, name="Mia", ui_language=language)
    [turn] = await rig.turns(member_id=new["id"])
    assert "Mia" in turn["text"] and words in turn["text"]
    assert turn["question"] == "" and turn["status"] == "done" and turn["cost_usd"] == 0
    assert client.chat_calls == []
    [conversation] = (await rig.call("conversations.list", {"member_id": new["id"]}))["conversations"]
    assert conversation["title"] == ""


async def test_a_member_the_chief_makes_says_nothing_of_itself(setup):
    rig, team = setup
    new = (await rig.call("members.create", {"name": "Mia"}))["member"]
    assert await rig.turns(member_id=new["id"]) == []


def test_only_a_member_with_no_job_is_offered_the_tool():
    assert "set_my_job" in dict(definitions_for(Speaker(id=3, name="Mia")))
    assert "set_my_job" not in dict(definitions_for(Speaker(id=3, name="Mia", role="Researcher")))
    assert "set_my_job" not in dict(definitions_for(Speaker(id=3, name="Mia", instructions="Read the news")))
    assert "set_my_job" not in dict(definitions_for(RAPHAEL))


async def test_the_owners_answer_becomes_its_job_and_the_next_turn_runs_on_it(setup, client):
    rig, team = setup
    new = await made(rig, name="Mia")
    client.chats = [chat("", ("set_my_job", {"role": "信件管家", "instructions": "每天整理未讀信件，重要的先問我。"})),
                    live_said("好，我負責每天整理未讀信件。")]
    await typed(rig, "幫我每天整理未讀信件，重要的先問我", new["id"])
    prompt = client.chat_calls[0]["messages"][0]["content"]
    assert "set_my_job" in prompt and "have no job yet" in prompt
    assert "<new_member_step>" in client.chat_calls[0]["messages"][-1]["content"]
    saved = team.members.store.member(new["id"])
    assert (saved.role, saved.instructions) == ("信件管家", "每天整理未讀信件，重要的先問我。")
    client.chats = [live_said("好的。")]
    await rig.call("agent.ask", {"session_id": "s2", "text": "今天呢", "ui_language": "zh-TW", "source": "app", "member_id": new["id"]})
    prompt = client.chat_calls[-1]["messages"][0]["content"]
    assert "每天整理未讀信件" in prompt and "have no job yet" not in prompt
    assert "<new_member_step>" not in client.chat_calls[-1]["messages"][-1]["content"]
    assert not any(item["function"]["name"] == "set_my_job" for item in client.chat_calls[-1]["tools"])


async def test_a_cli_brain_is_told_and_offered_it_through_mcp(setup, tmp_path, monkeypatch):
    import httpx

    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Driver, Event

    rig, team = setup
    (tmp_path / ".codex").mkdir()
    (tmp_path / ".codex/auth.json").touch()
    rig.service._cli_brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["unused-test-boundary"]})
    rig.settings.set("agent_model", "cli:codex:test")
    new = await made(rig, name="Mia")
    seen = {}

    async def run(driver, **kwargs):
        seen["system"] = kwargs["system"]
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}, trust_env=False) as http:
            async def rpc(method, params):
                response = await http.post(kwargs["endpoint"], json={"jsonrpc": "2.0", "id": method, "method": method, "params": params})
                return response.json()["result"]

            seen["tools"] = {tool["name"] for tool in (await rpc("tools/list", {}))["tools"]}
            seen["call"] = await rpc("tools/call", {"name": "set_my_job", "arguments": {"role": "信件管家", "instructions": "整理信件"}})
        yield Event("final", "好，我負責整理信件。")

    monkeypatch.setattr(Driver, "run", run)
    await typed(rig, "幫我整理信件", new["id"])
    assert "have no job yet" in seen["system"]
    assert "set_my_job" in seen["tools"]
    assert seen["call"]["isError"] is False
    assert team.members.store.member(new["id"]).role == "信件管家"


async def test_a_job_it_has_cannot_be_rewritten_by_the_tool(setup):
    rig, team = setup
    from raphael_core.protocol import RpcError
    existing = member(team, name="Ada", role="Original", instructions="Keep this")
    with pytest.raises(RpcError):
        await team.members.set_my_job(existing.id, {"role": "Hacked", "instructions": "Do something else"})
    with pytest.raises(RpcError):
        await team.members.set_my_job(0, {"role": "Hacked", "instructions": "Do something else"})
    assert team.members.store.member(existing.id).role == "Original"
