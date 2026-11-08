"""Portable recipes never carry private state or grant connected-app access."""
import json

import pytest

from raphael_core.protocol import RpcError


@pytest.fixture
async def rig(rig):
    from agent.conftest import FakeActions, FakeOpenRouter
    from agent.test_service import Rig as AgentRig
    from .test_answering import live_said
    client = FakeOpenRouter()
    client.chats = [live_said("I am Editor. What would you like me to take off your plate?")]
    agent = AgentRig(rig.conn, client, FakeActions(), team=rig.service, memory=rig.memory)
    yield rig
    await agent.aclose()


async def test_export_preview_and_import_keep_only_the_recipe(rig):
    service = rig.service
    original = (await rig.call("members.create", {"name": "Writer", "role": "Editor", "instructions": "Publish a clear guide", "avatar": "slime:shuna"}))["member"]
    identifier = original["id"]
    skill = service.capabilities.keep_recipe(identifier, "---\nname: editing\ndescription: Check clarity\n---\nVerify claims.", {"references/check.md": "Check the source", "scripts/check.py": "print('checked')"})
    service.capabilities.homes.keep(identifier, "MEMORY.md", "PRIVATE-MEMORY")
    await rig.call("routines.create", {"member_id": identifier, "title": "Review", "prompt": "Review the goal", "schedule": {"kind": "daily", "time": "09:00"}})
    exported = await rig.call("members.template", {"action": "export", "id": identifier})
    value = exported["template"]
    raw = json.dumps(value)
    assert "PRIVATE-MEMORY" not in raw and "avatar" not in value and "model" not in value and "tools" not in value
    before = len(service.store.members())
    assert (await rig.call("members.template", {"action": "preview", "template": value}))["template"] == value
    assert len(service.store.members()) == before
    copied = (await rig.call("members.template", {"action": "import", "template": value, "name": "Editor"}))["member"]
    assert copied["tools"] == [] and copied["role"] == "Editor"
    assert service.capabilities.skills(copied["id"])[0]["name"] == "editing"
    copied_skill = service.capabilities.owned_skills(copied["id"])[0]
    assert (service.capabilities._path(copied["id"], copied_skill["id"]).parent / "scripts/check.py").read_text() == "print('checked')"
    [routine] = service.store.routines(copied["id"])
    assert not routine.enabled and routine.next_run_ms is None
    assert "PRIVATE-MEMORY" not in service.capabilities.homes.path(copied["id"], "MEMORY.md").read_text()
    assert rig.background.submitted == []
    [greeting] = service._history.list(member_id=copied["id"])
    assert greeting.source == "greeting" and greeting.question == ""


async def test_template_refuses_extra_fields_secrets_and_invalid_recipes_without_mutation(rig):
    new = (await rig.call("members.create", {"name": "Writer"}))["member"]
    value = (await rig.call("members.template", {"action": "export", "id": new["id"]}))["template"]
    for patch in ({"memory": "private"}, {"tools": ["srv-1"]}, {"instructions": "password: correct-horse-battery-staple"}, {"skills": [{"text": "x", "source": "https://example.test"}]},
                  {"skills": [{"text": "x", "files": {"../escape.md": "private"}}]}, {"skills": [{"text": "x", "files": {"MEMORY.md": "private"}}]}, {"skills": [{"text": "x", "files": {"owner.png": "picture"}}]}):
        with pytest.raises(RpcError):
            await rig.call("members.template", {"action": "import", "template": {**value, **patch}, "name": "Copy"})
        assert len(rig.service.store.members()) == 1


async def test_a_stored_greeting_with_old_choices_still_loads(rig):
    new = (await rig.call("members.create", {"name": "Writer"}))["member"]
    detail = json.dumps({"kind": "greeting", "options": ["An old suggestion"]})
    rig.service._history.add(session_id="legacy", question="", route="greeting", prefix="",
                            text="An old greeting", detail=detail, status="done", source="greeting", member_id=new["id"])
    [turn] = rig.service._history.list(member_id=new["id"])
    assert turn.detail == detail and turn.text == "An old greeting"


@pytest.fixture
def app_connections(rig, monkeypatch):
    connections = [{"id": f"composio:{slug}", "name": name, "enabled": True, "services": [slug]}
                   for slug, name in [("notion", "Notion"), ("github", "GitHub"), ("huggingface", "Hugging Face"),
                                      ("gmail", "Gmail"), ("googlecalendar", "Google Calendar"),
                                      ("mobbin", "Mobbin MCP"), ("googledrive", "Google Drive")]]
    monkeypatch.setattr(rig.service, "_connections", lambda: connections)
    return connections


async def test_template_infers_only_gmail_and_calendar_from_routine(rig, app_connections):
    member = (await rig.call("members.create", {"name": "Inbox"}))["member"]["id"]
    await rig.call("routines.create", {"member_id": member, "title": "Morning inbox", "prompt": "Check Gmail and Google Calendar.",
                  "schedule": {"kind": "daily", "time": "09:00"}})
    value = (await rig.call("members.template", {"action": "export", "id": member}))["template"]
    assert value["connections"] == ["Gmail", "Google Calendar"]


async def test_template_without_app_use_has_no_connections(rig, app_connections):
    member = (await rig.call("members.create", {"name": "Writer"}))["member"]["id"]
    value = (await rig.call("members.template", {"action": "export", "id": member}))["template"]
    assert value["connections"] == []


@pytest.mark.parametrize("tools,expected", [([], []), (["composio:github"], ["GitHub"])])
async def test_explicit_app_list_wins_over_all_inferred_uses(rig, app_connections, tools, expected):
    member = (await rig.call("members.create", {"name": "Inbox", "tools": tools}))["member"]["id"]
    await rig.call("routines.create", {"member_id": member, "title": "Gmail", "prompt": "Check Google Calendar.",
                  "schedule": {"kind": "daily", "time": "09:00"}})
    value = (await rig.call("members.template", {"action": "export", "id": member}))["template"]
    assert value["connections"] == expected


async def test_template_reads_skill_requirements_and_references_without_private_memory(rig, app_connections):
    member = (await rig.call("members.create", {"name": "Researcher"}))["member"]["id"]
    rig.service.capabilities.keep_recipe(member, "---\nname: research\ndescription: Check sources\nrequires: [huggingface]\n---\nRead the attached reference.",
                                        {"references/source.md": "Read Google Drive documents."})
    rig.service.capabilities.homes.keep(member, "MEMORY.md", "Use Notion and GitHub privately.")
    value = (await rig.call("members.template", {"action": "export", "id": member}))["template"]
    assert value["connections"] == ["Hugging Face", "Google Drive"]


async def test_template_tool_records_belong_only_to_the_exported_member(rig, app_connections):
    from raphael_core.agent.history import AgentHistory
    member = (await rig.call("members.create", {"name": "Researcher"}))["member"]["id"]
    history = AgentHistory(rig.conn, rig.wall)
    turn = history.add(session_id="test", question="Read", route="answer", prefix="", text="Done", status="done", member_id=member)
    other = history.add(session_id="other", question="Read", route="answer", prefix="", text="Done", status="done", member_id=0)
    rig.conn.execute("INSERT INTO agent_steps(turn_id,n,at_ms,kind,tool,server,outcome) VALUES(?,1,?,'tool','GMAIL_FETCH_EMAILS','composio','ok')", (turn, rig.wall.now))
    rig.conn.execute("INSERT INTO agent_steps(turn_id,n,at_ms,kind,tool,server,outcome) VALUES(?,1,?,'tool','NOTION_SEARCH','composio','ok')", (other, rig.wall.now))
    rig.conn.execute("INSERT INTO agent_steps(turn_id,n,at_ms,kind,tool,server,outcome) VALUES(?,2,?,'tool','search','composio:github','denied')", (turn, rig.wall.now))
    task = rig.background.submit(session_id="worker", text="Read", language="en", model="", member_id=member)
    rig.conn.execute("INSERT INTO worker_steps(task_id,n,at_ms,kind,tool,server,outcome) VALUES(?,1,?,'tool','GOOGLECALENDAR_EVENTS_LIST','composio','ok')", (task, rig.wall.now))
    rig.conn.execute("INSERT INTO tool_audit(at_ms,server,tool,approver,outcome,task_id) VALUES(?, 'composio:googledrive','list','auto','ok',?)", (rig.wall.now, task))
    value = (await rig.call("members.template", {"action": "export", "id": member}))["template"]
    assert value["connections"] == ["Gmail", "Google Calendar", "Google Drive"]


async def test_template_matching_does_not_match_word_substrings(rig, app_connections):
    member = (await rig.call("members.create", {"name": "Writer"}))["member"]["id"]
    await rig.call("routines.create", {"member_id": member, "title": "Notional planning", "prompt": "Review githubish examples and gmailbox notes.",
                  "schedule": {"kind": "daily", "time": "09:00"}})
    value = (await rig.call("members.template", {"action": "export", "id": member}))["template"]
    assert value["connections"] == []


async def test_template_matches_an_app_name_without_its_transport_suffix(rig, monkeypatch):
    monkeypatch.setattr(rig.service, "_connections", lambda: [{"id": "srv-custom", "name": "Mobbin MCP"}])
    member = (await rig.call("members.create", {"name": "Designer"}))["member"]["id"]
    await rig.call("routines.create", {"member_id": member, "title": "Design inspiration", "prompt": "Read Mobbin for inspiration.",
                  "schedule": {"kind": "daily", "time": "09:00"}})
    value = (await rig.call("members.template", {"action": "export", "id": member}))["template"]
    assert value["connections"] == ["Mobbin MCP"]
