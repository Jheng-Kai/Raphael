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
    skill = service.capabilities.keep_recipe(identifier, "---\nname: Editing\ndescription: Check clarity\n---\nVerify claims.", {"references/check.md": "Check the source", "scripts/check.py": "print('checked')"})
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
    assert service.capabilities.skills(copied["id"])[0]["name"] == "Editing"
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


async def test_greeting_choices_use_only_connected_apps_and_the_role_without_a_brain(rig):
    # Keep the historical contract name: stored local choices remain readable without a model call.
    new = (await rig.call("members.create", {"name": "Writer"}))["member"]
    detail = json.dumps({"kind": "greeting", "options": ["An old suggestion"]})
    rig.service._history.add(session_id="legacy", question="", route="greeting", prefix="",
                            text="An old greeting", detail=detail, status="done", source="greeting", member_id=new["id"])
    [turn] = rig.service._history.list(member_id=new["id"])
    assert turn.detail == detail and turn.text == "An old greeting"
