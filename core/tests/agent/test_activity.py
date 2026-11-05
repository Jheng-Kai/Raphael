"""Member activity through real turns with fake models and tools only."""

import asyncio

import pytest

from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed
from .test_plugins import plugins, calls  # noqa: F401


def states(notes, member=0):
    return [data["state"] for method, data in notes
            if method == "member.activity" and data["member_id"] == member]


async def test_real_turn_reports_tool_and_completion(make_rig, client):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))
    client.chats = [chat("Checking.", ("local_time", {})), chat("Finished.")]
    await typed(rig)
    assert states(notes) == ["thinking", "working", "thinking", "done", "idle"]


async def test_failed_turn_stays_error_until_the_next_turn(make_rig, client):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))
    client.chats = [RuntimeError("fake model failed")]
    await typed(rig)
    assert states(notes) == ["thinking", "error"]
    assert rig.service.activity.state(0) == "error"
    client.chats = [chat("Recovered.")]
    await typed(rig)
    assert states(notes)[-3:] == ["thinking", "done", "idle"]


async def test_cancelled_model_turn_releases_activity(make_rig, client):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))
    entered = asyncio.Event()

    async def slow(**kwargs):
        entered.set()
        await asyncio.Event().wait()

    client.chats = [slow]
    task = asyncio.create_task(typed(rig))
    await asyncio.wait_for(entered.wait(), 2)
    assert rig.service.activity.state(0) == "thinking"
    await rig.call("agent.cancel", {"session_id": "live"})
    await task
    assert states(notes) == ["thinking", "idle"]
    assert not rig.service.activity.running


async def test_exception_inside_tool_does_not_leave_work_running(make_rig, client, monkeypatch):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))

    async def broken(*args, **kwargs):
        assert rig.service.activity.state(0) == "searching"
        raise RuntimeError("fake tool failed")

    monkeypatch.setattr(rig.service._tools, "web_read", broken)
    url = "https://reference.example/activity"
    client.chats = [chat("Checking.", ("web_read", {"url": url})), chat("Could not check."), chat("Could not check.")]
    await typed(rig, f"Read {url}")
    assert states(notes)[:3] == ["thinking", "searching", "thinking"]
    assert states(notes)[-1] in ("idle", "error")
    assert not rig.service.activity.running


async def test_approval_card_is_idle_and_resumes_tracking(make_rig, plugins, client):
    await plugins.connect(note="T2")
    notes = []
    rig = make_rig(plugins=plugins.hub, notify=lambda method, data: notes.append((method, data)))
    client.chats = [chat("Saving.", ("Notes__note", {"text": "example"})), chat("Saved.")]
    result = await typed(rig)
    assert result["status"] == "confirm"
    assert states(notes)[-1] == "idle" and "done" not in states(notes)
    await rig.confirm(result["confirm"]["id"])
    assert states(notes)[-2:] == ["done", "idle"]
    assert "working" in states(notes)


async def test_private_member_uses_the_same_snapshot_as_its_notifications(make_rig, client, conn, tmp_path):
    from types import SimpleNamespace
    from raphael_core.members.service import MembersService

    notes = []
    members = MembersService(conn, tmp_path, background=SimpleNamespace(),
                             notify=lambda method, data: notes.append((method, data)))
    member = members.store.create_member(name="Reader", role="Research")
    rig = make_rig(team=members)
    members.register(rig.rpc)

    async def model(**kwargs):
        response = await rig.call("members.list", {})
        row = next(row for row in response["members"] if row["id"] == member.id)
        assert row["activity"] == "thinking"
        return chat("Finished.")

    client.chats = [model]
    try:
        await typed(rig, member_id=member.id)
        assert states(notes, member.id) == ["thinking", "done", "idle"]
        response = await rig.call("members.list", {})
        assert next(row for row in response["members"] if row["id"] == member.id)["activity"] == "idle"
        assert rig.service.activity is members.activity
    finally:
        await members.aclose()


@pytest.mark.parametrize("card", ["waiting_apps", "waiting_secrets", "waiting_computer"])
async def test_owner_card_finishes_idle_without_done(make_rig, monkeypatch, card):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))

    async def held(ask, settings, ledger, loop=None):
        setattr(ask, card, True if card == "waiting_computer" else ["fake card"])
        return rig.service._finish(ask, "answer", "answer", "Owner input needed.", ledger)

    monkeypatch.setattr(rig.service, "_narrated", held)
    await typed(rig)
    assert states(notes) == ["thinking", "idle"]


async def test_cancelled_tool_releases_search_activity(make_rig, client, monkeypatch):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))
    entered = asyncio.Event()

    async def slow(*args, **kwargs):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(rig.service._tools, "web_read", slow)
    url = "https://reference.example/activity"
    client.chats = [chat("Reading.", ("web_read", {"url": url}))]
    task = asyncio.create_task(typed(rig, f"Read {url}"))
    await asyncio.wait_for(entered.wait(), 2)
    assert rig.service.activity.state(0) == "searching"
    await rig.call("agent.cancel", {"session_id": "live"})
    await task
    assert states(notes)[-1] == "idle" and not rig.service.activity.running


async def test_confirmed_local_command_has_its_own_activity_scope(make_rig, client, monkeypatch):
    import dataclasses
    from raphael_core.agent import commands
    from raphael_core.agent.policy import Tier
    from .test_service import ask_to_copy

    monkeypatch.setitem(commands.COMMANDS, "copy_text",
                        dataclasses.replace(commands.COMMANDS["copy_text"], tier=Tier.T2))
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))
    rig.seed("question", "answer")
    asked = await ask_to_copy(rig, client)
    assert states(notes)[-1] == "idle"
    notes.clear()
    await rig.confirm(asked["confirm"]["id"], True)
    assert states(notes) == ["thinking", "working", "thinking", "done", "idle"]


async def test_confirmed_admin_batch_tracks_the_actual_tool(make_rig, monkeypatch):
    from types import SimpleNamespace

    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))

    async def execute(*args, **kwargs):
        assert rig.service.activity.state(0) == "working"
        return []

    rig.service._team = SimpleNamespace(plan_admin_batch=lambda *args, **kwargs: [],
        speaker=lambda member: SimpleNamespace(name="Raphael"), admin_batch=execute)
    monkeypatch.setattr(rig.service._gate, "check_admin_batch", lambda *args: None)
    monkeypatch.setattr(rig.service, "_outcome", lambda *args, **kwargs: {"status": "done"})
    pending = SimpleNamespace(language="en", action=SimpleNamespace(args={"operations": []}))
    ask = SimpleNamespace(speaker=SimpleNamespace(id=0), ledger=SimpleNamespace(total=0),
        admin_pending=[], waiting_apps=[], waiting_secrets=[], waiting_computer=False,
        scope="private", nested=False, quick=False, exchange_speakers=None, source="app", background_owner=False)
    followup = SimpleNamespace(ask=ask, admin_batch=True)
    await rig.service._confirm_plugin(pending, None, followup)
    assert states(notes) == ["thinking", "working", "thinking", "done", "idle"]
