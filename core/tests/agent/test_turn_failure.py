"""Durable public failure metadata never contains provider diagnostics or credentials."""

import json
import time

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.discovery import CliBrains
from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.history import AgentHistory
from raphael_core.brain import db
from raphael_core.brain.openrouter import OpenRouterError

from .test_narration import chat, typed
from .test_service import make_rig  # noqa: F401


async def test_chatgpt_usage_limit_is_durable_in_history_and_live_events(make_rig, client):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))
    rig.settings.set("agent_model", "@chatgpt:gpt-6-sol?effort=high")
    error = OpenRouterError(429, "usage_limit", "Usage limit reached PRIVATE_PROVIDER_PACKET")
    error.retry_after = 7200
    client.chats = [error]
    result = await typed(rig, "Summarize the synthetic project")
    [turn] = await rig.turns()
    failure = turn["failure"]
    assert turn["status"] == "error"
    assert failure.keys() == {"kind", "provider", "resets_at"}
    assert failure["kind"] == "usage_limit" and failure["provider"] == "chatgpt"
    assert time.time() + 7100 < failure["resets_at"] < time.time() + 7300
    assert AgentHistory(rig.conn).get(result["turn_id"]).failure == failure
    saved = json.loads(rig.conn.execute("SELECT failure FROM agent_turns WHERE id=?", (turn["id"],)).fetchone()[0])
    assert saved == failure and "PRIVATE" not in json.dumps(saved)
    terminal = [data for method, data in notes if method == "agent.turn" and not data.get("activity_only")][-1]
    assert terminal["failure"] == failure
    delta = await rig.call("agent.history.list", {"conversation_id": turn["conversation_id"], "after_id": 0})
    assert delta["turns"][0]["failure"] == failure


@pytest.mark.parametrize("brain", ["claude", "codex", "gemini"])
async def test_cli_usage_limit_keeps_its_provider_and_reset(make_rig, tmp_path, monkeypatch, brain):
    reset = time.time() + 7200

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            yield Event("error", "usage_limit", {"kind": "usage_limit", "reason": "Usage limit reached",
                "resets_at": reset, "detail": "PRIVATE_STDERR Authorization: Bearer synthetic-secret"})

        async def interrupt(self):
            pass

    monkeypatch.setattr(cli, "Driver", Driver)
    brains = CliBrains(home=tmp_path, environ={}, commands={brain: ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    brains._models[brain] = [{"id": f"cli:{brain}:sample"}]
    notes = []
    rig = make_rig(cli_brains=brains, notify=lambda method, data: notes.append((method, data)))
    rig.settings.set("agent_model", f"cli:{brain}:sample")
    await typed(rig, "Summarize a synthetic project")
    [turn] = await rig.turns()
    assert turn["status"] == "error"
    # The reset passes through the clock once more on its way to the turn: equal to the millisecond is not the point.
    assert turn["failure"] == {"kind": "usage_limit", "provider": f"cli:{brain}", "resets_at": pytest.approx(reset, abs=1)}
    assert "PRIVATE" not in json.dumps(turn["failure"])
    terminal = [data for method, data in notes if method == "agent.turn" and not data.get("activity_only")][-1]
    assert terminal["failure"] == turn["failure"]


async def test_done_turn_has_no_failure(make_rig, client):
    notes = []
    rig = make_rig(notify=lambda method, data: notes.append((method, data)))
    client.chats = [chat(json.dumps({"prefix": "Answer", "text": "Synthetic answer.", "detail": ""}))]
    await typed(rig)
    [turn] = await rig.turns()
    assert turn["status"] == "done" and turn["failure"] is None
    terminal = [data for method, data in notes if method == "agent.turn" and not data.get("activity_only")][-1]
    assert terminal["failure"] is None


def test_turn_failure_migration_preserves_old_rows_and_reopens(tmp_path, monkeypatch):
    path = tmp_path / "before-turn-failure.db"
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 73)
        conn = db.connect(path)
    assert "failure" not in {row[1] for row in conn.execute("PRAGMA table_info(agent_turns)")}
    conn.execute("INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status) "
                 "VALUES(1,'legacy','Synthetic question','answer','','Synthetic error','error')")
    conn.commit()
    conn.close()
    conn = db.connect(path)
    assert AgentHistory(conn).list()[0].failure is None
    assert conn.execute("SELECT text,failure FROM agent_turns").fetchone()[1] is None
    failure = {"kind": "usage_limit", "provider": "chatgpt", "resets_at": None}
    new_id = AgentHistory(conn).add(session_id="new", question="Synthetic", route="answer", prefix="", text="Failed",
                                  status="error", failure=failure)
    db.migrate(conn)
    conn.close()
    conn = db.connect(path)
    assert AgentHistory(conn).get(1).text == "Synthetic error"
    assert AgentHistory(conn).get(new_id).failure == failure
    conn.close()


def test_storage_only_keeps_failure_allowlist_and_clears_it_on_success(conn):
    history = AgentHistory(conn)
    turn_id = history.add(session_id="sample", question="Synthetic", route="answer", prefix="", text="Failed",
        status="error", failure={"kind": "usage_limit", "provider": "openrouter", "resets_at": None,
            "reason": "PRIVATE", "stderr": "PRIVATE", "token": "synthetic-secret"})
    safe = {"kind": "usage_limit", "provider": "openrouter", "resets_at": None}
    assert history.get(turn_id).failure == safe
    assert json.loads(conn.execute("SELECT failure FROM agent_turns WHERE id=?", (turn_id,)).fetchone()[0]) == safe
    history.resolve(turn_id, prefix="", text="Recovered", status="done", failure=safe)
    assert history.get(turn_id).failure is None
    assert conn.execute("SELECT failure FROM agent_turns WHERE id=?", (turn_id,)).fetchone()[0] is None


@pytest.mark.parametrize("raw", ["broken JSON", '{"kind":"PRIVATE","provider":"chatgpt"}',
    '{"kind":"usage_limit","provider":"Authorization: Bearer private"}'])
def test_damaged_failure_does_not_break_history_or_publish_private_fields(conn, raw):
    history = AgentHistory(conn)
    turn_id = history.add(session_id="sample", question="Synthetic", route="answer", prefix="", text="Failed", status="error")
    conn.execute("UPDATE agent_turns SET failure=? WHERE id=?", (raw, turn_id))
    conn.commit()
    assert history.get(turn_id).failure is None


async def test_a_failed_room_turn_keeps_the_same_public_failure_view_but_is_no_bubble(make_rig, tmp_path):
    from raphael_core.members.rooms import RoomsService
    from raphael_core.members.service import MembersService

    rig = make_rig()
    members = MembersService(rig.conn, tmp_path, background=rig.service._background)
    peer = members.store.create_member(name="Synthetic peer")
    rooms = RoomsService(rig.conn, members=members, background=rig.service._background)
    rooms.turn_view = lambda turn: rig.service._turn_views([turn])[0]
    try:
        room = (await rooms._create({"name": "Synthetic room", "member_ids": [0, peer.id]}))["room"]
        thread = rig.conn.execute("SELECT id FROM room_threads WHERE room_id=?", (room["id"],)).fetchone()[0]
        failure = {"kind": "usage_limit", "provider": "chatgpt", "resets_at": None}
        turn_id = rig.history.add(session_id="room-failure", question="Synthetic", route="room", prefix="", text="Failed",
            status="error", source="room", scope="room", room_id=room["id"], thread_id=thread, failure=failure)
        with rig.conn:
            rig.conn.execute("INSERT INTO room_messages(room_id,thread_id,member_id,turn_id,text,created) VALUES(?,?,0,?,'Failed',1)",
                             (room["id"], thread, turn_id))
        messages = (await rooms._messages({"room_id": room["id"]}))["messages"]
        # A reply that failed is no bubble in the room (its blocked intent is its status line); the turn keeps the same
        # public failure view for its private record.
        assert not [message for message in messages if message.get("turn_id") == turn_id]
        assert rooms.turn_view(rig.history.get(turn_id))["failure"] == failure
        rig.history.resolve(turn_id, prefix="", text="Recovered", status="done")
        messages = (await rooms._messages({"room_id": room["id"]}))["messages"]
        assert next(message for message in messages if message.get("turn_id") == turn_id)["turn"]["failure"] is None
    finally:
        await rooms.aclose()
        await members.aclose()


@pytest.mark.parametrize("reset", [float("nan"), float("inf"), -1, True, "PRIVATE", 10 ** 1000])
def test_invalid_reset_metadata_cannot_become_public_text_or_invalid_json(conn, reset):
    history = AgentHistory(conn)
    turn_id = history.add(session_id="sample", question="Synthetic", route="answer", prefix="", text="Failed", status="error",
        failure={"kind": "usage_limit", "provider": "chatgpt", "resets_at": reset})
    assert history.get(turn_id).failure["resets_at"] is None
