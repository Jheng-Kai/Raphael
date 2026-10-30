"""Offline envelopes and production agent/gate/MCP execution, with no live sessions."""
import json

import httpx
import pytest

from raphael_core.agent.plugins import make_offer, tool_key
from raphael_core.agent.policy import Tier
from raphael_core.connectors.service import COMPOSIO_SERVER, META_EXECUTE
from test_connectors import Platform, connected
from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed

READ, WRITE = "GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"


def envelope(slug=READ, **optional):
    return {"tools": [{"tool_slug": slug, "arguments": {}}], **optional}


@pytest.mark.parametrize("optional", [
    {}, {"thought": "Read latest email"}, {"current_step": "Fetching", "current_step_metric": "1/1"},
    {"sync_response_to_workbench": False}, {"session_id": "synthetic-session"},
    {"thought": "Read", "current_step": "Fetching", "current_step_metric": "1/1",
     "sync_response_to_workbench": False, "session_id": "synthetic-session"},
])
async def test_documented_optional_fields_are_accepted(tmp_path, conn, optional):
    _, service, hub, _, _ = await connected(tmp_path, conn)
    args = envelope(**optional)
    assert service.allow_call(COMPOSIO_SERVER, META_EXECUTE, args, "auto")
    assert service.tier(COMPOSIO_SERVER, META_EXECUTE, args) == Tier.T1
    assert hub.tier_for_call(tool_key(COMPOSIO_SERVER, META_EXECUTE), args) == Tier.T1


@pytest.mark.parametrize("args", [
    {"tools": []}, {"tools": "GMAIL_FETCH_EMAILS"}, {"tools": [None]},
    {"tools": [{"tool_slug": READ, "arguments": {}, "other": True}]},
    {"tools": [{"tool_slug": READ, "arguments": []}]},
    *[envelope(**extra) for extra in ({"unknown": "x"}, {"thought": 1}, {"current_step": []},
      {"current_step_metric": 1}, {"session_id": None}, {"sync_response_to_workbench": 0},
      {"sync_response_to_workbench": True})],
])
async def test_unknown_fields_bad_types_and_workbench_sync_are_blocked(tmp_path, conn, args):
    _, service, hub, _, fake = await connected(tmp_path, conn)
    before = len(fake.requests)
    assert not service.allow_call(COMPOSIO_SERVER, META_EXECUTE, args, "user")
    assert hub.tier_for_call(tool_key(COMPOSIO_SERVER, META_EXECUTE), args) is None
    assert not (await hub.call(tool_key(COMPOSIO_SERVER, META_EXECUTE), args, approver="user")).ok
    assert len(fake.requests) == before


async def test_read_write_mixed_disabled_and_draft_policy_match_the_page(tmp_path, conn):
    router, service, hub, _, _ = await connected(tmp_path, conn)
    entry = service.store.connectors["composio:gmail"]
    items = (await router.call("connectors.tools", {"id": entry.id}))["items"]
    for item in items:
        args = envelope(item["slug"])
        assert service.tier(COMPOSIO_SERVER, META_EXECUTE, args) == (Tier.T1 if item["kind"] == "read" else Tier.T2)
        assert service.allow_call(COMPOSIO_SERVER, META_EXECUTE, args, "auto") == (item["kind"] == "read")
    mixed = {"tools": [*envelope()["tools"], *envelope(WRITE)["tools"]]}
    assert service.tier(COMPOSIO_SERVER, META_EXECUTE, mixed) == Tier.T2
    assert not service.allow_call(COMPOSIO_SERVER, META_EXECUTE, mixed, "auto")
    assert service.allow_call(COMPOSIO_SERVER, META_EXECUTE, mixed, "user")
    entry.draft_only = True
    assert not service.allow_call(COMPOSIO_SERVER, META_EXECUTE, envelope(WRITE), "user")
    assert service.allow_call(COMPOSIO_SERVER, META_EXECUTE, envelope(), "auto")
    entry.disabled_tools.append(READ)
    assert not service.allow_call(COMPOSIO_SERVER, META_EXECUTE, envelope(), "user")
    assert service.tier(COMPOSIO_SERVER, META_EXECUTE, envelope()) is None


class FakeComposioMcp(Platform):
    def __init__(self):
        super().__init__(["ACTIVE"])
        self.called = []

    def __call__(self, request):
        if request.url.host == "app.composio.dev" and request.method == "POST":
            body = json.loads(request.content)
            if body.get("method") == "tools/list":
                self.requests.append(request)
                result = {"tools": [
                    {"name": "COMPOSIO_SEARCH_TOOLS", "inputSchema": {"type": "object"}},
                    {"name": META_EXECUTE, "inputSchema": {"type": "object", "required": ["tools"],
                        "properties": {"tools": {"type": "array"}, "current_step": {"type": "string"},
                                       "sync_response_to_workbench": {"type": "boolean"}}}},
                ]}
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})
            if body.get("method") == "tools/call":
                params = body["params"]
                self.called.append(params)
                if params["name"] == "COMPOSIO_SEARCH_TOOLS":
                    text = json.dumps({"tool_slug": READ, "schema": {"type": "object"}, "current_step": "Fetch latest email"})
                else:
                    text = "Synthetic latest email: Release review at 10 AM."
                self.requests.append(request)
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"],
                    "result": {"content": [{"type": "text", "text": text}]}})
        return super().__call__(request)


@pytest.mark.parametrize("slug", [READ, WRITE])
async def test_agent_search_execute_answer_and_permission_card(make_rig, client, tmp_path, conn, slug):
    fake = FakeComposioMcp()
    router, service, hub, _, _ = await connected(tmp_path, conn, fake)
    if slug == READ:
        await router.call("connectors.set_tools", {"id": "composio:gmail", "disabled_tools": [WRITE, "GMAIL_DELETE_MESSAGE"]})
    rig = make_rig(plugins=hub)
    aliases = {tool.name: alias for alias, tool in make_offer(hub.offered()).by_alias.items()}
    args = envelope(slug, current_step="Fetch latest email", sync_response_to_workbench=False)

    async def execute_after_discovery(**kwargs):
        assert kwargs["messages"][-1]["role"] == "tool"
        assert READ in kwargs["messages"][-1]["content"]
        assert [call["name"] for call in fake.called] == ["COMPOSIO_SEARCH_TOOLS"]
        return chat("I will read the latest email.", (aliases[META_EXECUTE], args))

    client.chats = [chat("I will find your mail reader.", (aliases["COMPOSIO_SEARCH_TOOLS"], {})),
                    execute_after_discovery,
                    chat(json.dumps({"messages": ["Your latest email says release review is at 10 AM."]}))]
    result = await typed(rig, "Read my latest email")
    if slug == WRITE:
        assert result["status"] == "confirm"
        assert [call["name"] for call in fake.called] == ["COMPOSIO_SEARCH_TOOLS"]
        result = await rig.confirm(result["confirm"]["id"])
    else:
        assert result["status"] == "done" and "confirm" not in result
    assert result["status"] == "done" and "10 AM" in result["text"]
    assert [call["name"] for call in fake.called] == ["COMPOSIO_SEARCH_TOOLS", META_EXECUTE]
    assert fake.called[-1]["arguments"] == args
    assert len(client.chat_calls) == 3
