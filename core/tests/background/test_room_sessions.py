"""A CLI member in a room goes on in its own native session for each room thread, sent only what is new, and a renewed
session is given the thread's summary and its newest messages (owner, 2026-11-11, harness plan of 2026-11-09, section A:
each reply used to be a fresh session that saw only the messages after the member's cursor)."""
import json

import pytest

from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.cli.loop import Sessions
from raphael_core.background.cli import RoomCliSessions, room_conversation
from .conftest import until
from .test_room_cli import Brains
from .test_room_meeting import meeting  # noqa: F401


async def ask(rooms, room, text, key):
    await rooms._send({"room_id": room["id"], "text": text, "request_id": key, "ui_language": "en"})
    await until(lambda: rooms._exchanges.latest(room["id"])["state"] == "done")


def play(monkeypatch, calls, window=None, used=0, session="native-1"):
    async def run(driver, **kwargs):
        calls.append(kwargs)
        yield Event("session", kwargs.get("session") or session)
        if window:
            yield Event("usage", data={"input_tokens": used, "context_window": window})
        yield Event("final", f"Answer {len(calls)}.")
    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)


async def test_a_cli_member_resumes_its_session_and_is_sent_only_what_is_new(meeting, monkeypatch, tmp_path):
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model="cli:claude")
    rig.service.use_cli(Brains(tmp_path))
    calls = []
    play(monkeypatch, calls)
    await ask(rooms, room, "@Alice FIRST-QUESTION about the plan", "one")
    await ask(rooms, room, "@Alice SECOND-QUESTION about the budget", "two")
    first, second = calls
    assert first["session"] is None and "FIRST-QUESTION" in first["user"]
    assert second["session"] == "native-1"  # the same native session, not a fresh one
    assert "SECOND-QUESTION" in second["user"] and "FIRST-QUESTION" not in second["user"]
    assert "Answer 1." in second["user"]  # its own reply comes back in what is new
    # The team and the board were sent whole once, and a second time only if they changed.
    assert "Room team" not in second["user"] and "TeamContextSnapshot" in first["user"]
    [row] = rig.conn.execute("SELECT room_id, member_id, brain, session_id FROM room_cli_sessions").fetchall()
    assert tuple(row) == (room["id"], alice.id, "cli:claude", "native-1")


async def test_the_session_is_the_members_own_in_that_thread_and_in_no_other(meeting, monkeypatch, tmp_path):
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model="cli:claude")
    rig.service.use_cli(Brains(tmp_path))
    calls = []
    play(monkeypatch, calls)
    await ask(rooms, room, "@Alice in the main room", "main")
    message = rig.conn.execute("SELECT id FROM room_messages WHERE member_id IS NULL").fetchone()[0]
    thread = (await rooms._thread_open({"room_id": room["id"], "message_id": message}))["thread_id"]
    await rooms._send({"room_id": room["id"], "thread_id": thread, "text": "@Alice in the side thread", "request_id": "side", "ui_language": "en"})
    await until(lambda: rooms._exchanges.latest(room["id"], thread)["state"] == "done")
    assert calls[1]["session"] is None  # another thread: another session
    rows = rig.conn.execute("SELECT thread_id FROM room_cli_sessions ORDER BY thread_id").fetchall()
    assert len(rows) == 2 and rows[0][0] != rows[1][0]


async def test_another_model_never_resumes_a_session_it_did_not_make(meeting, monkeypatch, tmp_path):
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model="cli:claude:one")
    rig.service.use_cli(Brains(tmp_path))
    calls = []
    play(monkeypatch, calls)
    await ask(rooms, room, "@Alice first", "one")
    members.store.update_member(alice.id, model="cli:claude:two")
    await ask(rooms, room, "@Alice second", "two")
    assert calls[1]["session"] is None  # a changed model starts its own, and never reads the other's


async def test_a_renewed_session_is_given_the_summary_and_the_newest_messages(meeting, monkeypatch, tmp_path):
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model="cli:claude")
    rig.service.use_cli(Brains(tmp_path))
    calls = []
    play(monkeypatch, calls, window=100_000, used=85_000)  # a session that reports itself nearly full is renewed on the next reply
    await ask(rooms, room, "@Alice FIRST-QUESTION", "one")
    thread = rig.conn.execute("SELECT thread_id FROM room_messages WHERE member_id IS NULL").fetchone()[0]
    rooms.summaries._save(room["id"], thread, "Decisions:\n- the plan has three parts", 1)
    await ask(rooms, room, "@Alice SECOND-QUESTION", "two")
    second = calls[1]
    assert second["session"] is None  # the session was given up for a fresh one
    assert "Decisions:\n- the plan has three parts" in second["user"]
    assert "SECOND-QUESTION" in second["user"] and "TeamContextSnapshot" in second["user"]
    assert second["user"].index("Decisions:") < second["user"].index("SECOND-QUESTION")


async def test_sessions_go_with_their_room_their_member_and_the_clear_all_paths(meeting, monkeypatch, tmp_path):
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model="cli:claude")
    rig.service.use_cli(Brains(tmp_path))
    play(monkeypatch, [])
    await ask(rooms, room, "@Alice hello", "one")
    count = lambda: rig.conn.execute("SELECT COUNT(*) FROM room_cli_sessions").fetchone()[0]
    assert count() == 1
    sessions = Sessions(rig.conn)
    sessions.clear_member(alice.id + 1)
    assert count() == 1
    sessions.clear_member(alice.id)
    assert count() == 0
    await ask(rooms, room, "@Alice again", "two")
    assert count() == 1
    sessions.clear()
    assert count() == 0
    await ask(rooms, room, "@Alice and again", "three")
    rooms.summaries._save(room["id"], 1, "kept", 1)
    await rooms._delete({"room_id": room["id"]})
    assert count() == 0 and not rig.conn.execute("SELECT 1 FROM room_thread_summaries").fetchone()


async def test_a_member_who_leaves_the_room_takes_its_sessions_with_it(meeting, monkeypatch, tmp_path):
    rig, members, rooms, room, alice = meeting
    members.store.update_member(alice.id, model="cli:claude")
    rig.service.use_cli(Brains(tmp_path))
    play(monkeypatch, [])
    await ask(rooms, room, "@Alice hello", "one")
    bob = members.store.create_member(name="Bob", role="CTO")
    await rooms._update({"room_id": room["id"], "member_ids": [0, bob.id]})
    assert rig.conn.execute("SELECT COUNT(*) FROM room_cli_sessions").fetchone()[0] == 0


async def test_a_session_of_a_deleted_room_is_not_revived_by_a_late_notification(meeting):
    rig, members, rooms, room, alice = meeting
    store = RoomCliSessions(rig.conn)
    thread = rig.conn.execute("SELECT id FROM room_threads WHERE room_id=?", (room["id"],)).fetchone()[0]
    key = room_conversation(room["id"], thread)
    store.put(alice.id, "cli:claude", "native-1", key)
    store.put_context(alice.id, "cli:claude", "native-1", {"turn": 4}, key)
    assert store.get(alice.id, "cli:claude", key) == "native-1" and store.get_context(alice.id, "cli:claude", "native-1", key) == {"turn": 4}
    assert store.get_context(alice.id, "cli:claude", "other", key) is None
    store.put(alice.id, "cli:claude", "native-2", key)  # another session id starts without the old cursor
    assert store.get_context(alice.id, "cli:claude", "native-2", key) is None
    await rooms._delete({"room_id": room["id"]})
    store.put(alice.id, "cli:claude", "late", key)
    assert store.get(alice.id, "cli:claude", key) is None
    # Any other conversation id is a loop's own, kept in memory.
    store.put(alice.id, "cli:claude", "task-session", "room-task-9")
    assert store.get(alice.id, "cli:claude", "room-task-9") == "task-session"
    assert rig.conn.execute("SELECT COUNT(*) FROM room_cli_sessions").fetchone()[0] == 0
