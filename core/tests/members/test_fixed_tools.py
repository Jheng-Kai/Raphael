"""A member's tool list stays the same, byte for byte, through a conversation (owner, 2026-11-09, decision 2).

The list is the first block of every prompt: a list that followed the request's words, the tools
find_tools showed or a connection that came or went started the cache again. The tools a member uses
in most turns are listed, sorted by name; any other is found with find_tools and called with use_tool,
so finding one never changes the list."""

import json

import httpx
import pytest

from agent.test_narration import chat
from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.management import MANAGEMENT_TOOLS
from .test_answering import client, setup, typed, live_said  # noqa: F401

# Requests whose words used to choose different tools: none, the folders, the group chats.
QUESTIONS = ("What is on my calendar today?", "Delete the folder Reports", "Rename the group chat Review")


def cli_brain(rig, tmp_path):
    (tmp_path / ".codex").mkdir(exist_ok=True)
    (tmp_path / ".codex/auth.json").touch()
    rig.service._cli_brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["unused-test-boundary"]})
    rig.settings.set("agent_model", "cli:codex:test")


def mcp(endpoint, token):
    http = httpx.AsyncClient(headers={"Authorization": "Bearer " + token}, trust_env=False)

    async def rpc(method, params):
        response = await http.post(endpoint, json={"jsonrpc": "2.0", "id": method, "method": method, "params": params})
        return response.json()["result"]
    return http, rpc


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_three_turns_of_one_conversation_send_the_same_tools(setup, client, tmp_path, monkeypatch, brain):
    rig, team = setup
    team.members.register(rig.rpc)
    sent = []
    if brain == "api":
        def answer(**kwargs):
            sent.append(json.dumps(kwargs["tools"], ensure_ascii=False))
            return live_said("Noted.")
        client.chats = [answer] * len(QUESTIONS)
    else:
        cli_brain(rig, tmp_path)

        async def run(driver, *, endpoint, token, **kwargs):
            http, rpc = mcp(endpoint, token)
            async with http:
                sent.append(json.dumps((await rpc("tools/list", {}))["tools"], ensure_ascii=False))
            yield Event("final", "Noted.")
        monkeypatch.setattr(Driver, "run", run)
    for question in QUESTIONS:
        assert (await typed(rig, question, 0, language="en"))["status"] == "done"
    assert len(sent) == len(QUESTIONS)
    assert sent[1] == sent[0] and sent[2] == sent[0]
    names = [item["function"]["name"] if "function" in item else item["name"] for item in json.loads(sent[0])]
    listed = [name for name in names if name != "approve"]
    assert listed == sorted(listed), "the list is sorted by name"
    assert {"find_tools", "use_tool"} <= set(names) and not set(names) & MANAGEMENT_TOOLS


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_a_tool_outside_the_list_is_found_and_called_while_the_list_stays(setup, client, tmp_path, monkeypatch, brain):
    rig, team = setup
    team.members.register(rig.rpc)
    rig.settings.set("action_mode", "bypass")
    lists = []
    if brain == "api":
        def discover(**kwargs):
            lists.append(json.dumps(kwargs["tools"], ensure_ascii=False))
            return chat("Find the action.", ("find_tools", {"query": "create a folder"}))

        def create(**kwargs):
            lists.append(json.dumps(kwargs["tools"], ensure_ascii=False))
            found = kwargs["messages"][-1]["content"]
            # The search returns what a direct call needs: the name and the whole input schema.
            assert "group_create" in found and '"parameters"' in found
            return chat("Create it.", ("use_tool", {"name": "group_create", "arguments": {"name": "Discovered"}}))

        def finish(**kwargs):
            lists.append(json.dumps(kwargs["tools"], ensure_ascii=False))
            return live_said("Finished.")
        client.chats = [discover, create, finish]
    else:
        cli_brain(rig, tmp_path)

        async def run(driver, *, endpoint, token, **kwargs):
            http, rpc = mcp(endpoint, token)
            async with http:
                lists.append(json.dumps((await rpc("tools/list", {}))["tools"], ensure_ascii=False))
                found = await rpc("tools/call", {"name": "find_tools", "arguments": {"query": "create a folder"}})
                assert not found["isError"] and "group_create" in found["content"][0]["text"]
                lists.append(json.dumps((await rpc("tools/list", {}))["tools"], ensure_ascii=False))
                made = await rpc("tools/call", {"name": "use_tool", "arguments": {
                    "name": "group_create", "arguments": {"name": "Discovered"}}})
                assert not made["isError"], made
                lists.append(json.dumps((await rpc("tools/list", {}))["tools"], ensure_ascii=False))
            yield Event("final", "Finished.")
        monkeypatch.setattr(Driver, "run", run)
    assert (await typed(rig, "Do the change we discussed", 0, language="en"))["status"] == "done"
    assert team.members.store.group_by_name("Discovered")
    assert len(lists) == 3 and lists[1] == lists[0] and lists[2] == lists[0]
    assert "group_create" not in lists[0]
