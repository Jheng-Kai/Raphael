"""An owner's message edited after its member answered it keeps what came before as a version (R-UI-163).

The first exchange (the message and what the member answered it with) stays as version 1, the edit is version 2 in the same
place, and the member answers it anew; the owner can read either again (`agent.history.version`), while every model, summary
and search reads the newest alone. A message that was not answered yet is only replaced, as before (R-UI-158).
"""

import asyncio
import json

import pytest

from raphael_core.protocol import RpcError
from .test_message_edits import routine, say, team_rig, thread  # noqa: F401
from .test_service import make_rig  # noqa: F401


def listed(rig):
    return rig.call("agent.history.list", {"member_id": rig.member, "conversation_id": rig.conversation})


async def version(rig, turn_id, number):
    return await rig.call("agent.history.version", {"member_id": rig.member, "conversation_id": rig.conversation,
                                                    "turn_id": turn_id, "version": number})


def said(view):
    """What the member answered in a turn as the app reads it: its reply lines, or its answer when it has none."""
    replies = [line["text"] for line in view["messages"] if line["kind"] == "reply"]
    return replies or [view["text"]]


async def test_an_answered_message_edited_keeps_the_first_exchange_as_version_one_in_the_same_place(team_rig, client):
    rig = team_rig
    first = await say(rig, client, "one", "Plan a trip to Kyoto", "Kyoto plan")
    seven = routine(rig, "r7", "seven o'clock")
    edited = await say(rig, client, "one-edited", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=first["turn_id"])
    assert edited["turn_id"] == first["turn_id"]
    # The thread holds the newest version in the message's place, above what came after it, and says how many there are.
    turns = (await listed(rig))["turns"]
    assert [turn["id"] for turn in turns] == [seven, first["turn_id"]]
    newest = turns[1]
    assert (newest["question"], newest["text"], newest["version"], newest["versions"]) == ("Plan a trip to Osaka", "Osaka plan", 2, 2)
    assert "version" not in turns[0] and "versions" not in turns[0]
    # The first exchange is there to read again: the words the owner sent and what the member answered them with.
    earlier = await version(rig, first["turn_id"], 1)
    assert (earlier["version"], earlier["versions"]) == (1, 2)
    old = earlier["turn"]
    assert (old["id"], old["question"], old["status"], old["version"], old["versions"]) == (first["turn_id"], "Plan a trip to Kyoto", "done", 1, 2)
    assert "Kyoto plan" in " ".join(said(old))
    assert old["steps"] == [] and old["task"] is None and old["reactions"] == {}
    # Switching back reads the turn itself.
    again = await version(rig, first["turn_id"], 2)
    assert (again["turn"]["question"], again["turn"]["text"], again["version"], again["versions"]) == ("Plan a trip to Osaka", "Osaka plan", 2, 2)


async def test_a_third_edit_makes_three_versions_each_with_its_own_answer(team_rig, client):
    rig = team_rig
    first = await say(rig, client, "one", "Plan a trip to Kyoto", "Kyoto plan")
    await say(rig, client, "two", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=first["turn_id"])
    await say(rig, client, "three", "Plan a trip to Nara", "Nara plan", replace_turn_id=first["turn_id"])
    [turn] = (await listed(rig))["turns"]
    assert (turn["question"], turn["version"], turn["versions"]) == ("Plan a trip to Nara", 3, 3)
    one, two = (await version(rig, first["turn_id"], 1))["turn"], (await version(rig, first["turn_id"], 2))["turn"]
    assert (one["question"], two["question"]) == ("Plan a trip to Kyoto", "Plan a trip to Osaka")
    assert "Kyoto plan" in " ".join(said(one)) and "Osaka plan" in " ".join(said(two))


async def test_the_member_answering_version_two_never_reads_version_one(team_rig, client, conn):
    rig = team_rig
    first = await say(rig, client, "one", "Plan a trip to Kyoto", "Kyoto plan")
    with conn:
        conn.execute("INSERT INTO agent_conversation_cli_sessions(conversation_id, brain, session_id) VALUES (?, 'codex', 'resume-1')", (rig.conversation,))
        conn.execute("INSERT INTO conversation_summaries(member_id, text, through_turn_id, updated_at_ms) VALUES (?, 'Kyoto summary', ?, 1)",
                     (rig.member, first["turn_id"]))
    await say(rig, client, "two", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=first["turn_id"])
    answering = json.dumps(client.chat_calls[-1], ensure_ascii=False, default=str)
    assert "Osaka" in answering and "Kyoto" not in answering
    # The brain's resume session and the summary held the first words: they are forgotten, as in any retraction.
    assert conn.execute("SELECT COUNT(*) FROM agent_conversation_cli_sessions WHERE conversation_id=?", (rig.conversation,)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM conversation_summaries WHERE member_id=?", (rig.member,)).fetchone()[0] == 0
    # The next message reads the newest version as the conversation so far, never the first.
    await say(rig, client, "three", "And the hotel?", "Hotel near the station")
    later = json.dumps(client.chat_calls[-1], ensure_ascii=False, default=str)
    assert "Osaka" in later and "Kyoto" not in later
    # Nor does the search, the model's or the owner's.
    assert (await rig.call("agent.history.search", {"query": "Kyoto", "member_id": rig.member}))["turns"] == []
    recent = rig.history.recent(10, member_id=rig.member, conversation_id=rig.conversation, unfinished=True)
    assert not any("Kyoto" in (turn.question + turn.text + " ".join(turn.messages)) for turn in recent)


async def test_a_message_its_member_has_not_answered_yet_is_only_replaced(team_rig, client):
    rig = team_rig
    entered = asyncio.Event()

    async def thinking(**kwargs):
        entered.set()
        await asyncio.Event().wait()

    client.chats.append(thinking)
    rig.wall.now += 1000
    request = asyncio.create_task(rig.call("agent.ask", {"session_id": "one", "text": "Plan a trip to Kyoto", "ui_language": "en",
                                                         "source": "app", "member_id": rig.member, "conversation_id": rig.conversation}))
    await entered.wait()
    [running] = (await listed(rig))["turns"]
    assert running["status"] == "running" and running["messages"] == []
    edited = await say(rig, client, "one-edited", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=running["id"])
    await request  # the old work was stopped by the edit
    [turn] = (await listed(rig))["turns"]
    assert (turn["id"], turn["question"], turn["text"]) == (running["id"], "Plan a trip to Osaka", "Osaka plan") and edited["turn_id"] == running["id"]
    assert "version" not in turn and "versions" not in turn
    assert rig.history.versions(running["id"]) == []


async def test_a_message_answered_while_its_member_still_works_is_kept_and_the_work_is_stopped(team_rig, client):
    rig = team_rig
    entered, stopped = asyncio.Event(), asyncio.Event()

    async def working(**kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            stopped.set()
            raise

    client.chats.append(working)
    rig.wall.now += 1000
    request = asyncio.create_task(rig.call("agent.ask", {"session_id": "one", "text": "Plan a trip to Kyoto", "ui_language": "en",
                                                         "source": "app", "member_id": rig.member, "conversation_id": rig.conversation}))
    await entered.wait()
    [running] = (await listed(rig))["turns"]
    rig.history.add_message(running["id"], "progress", "Looking at trains")
    rig.history.add_message(running["id"], "reply", "First part of the Kyoto plan")
    await say(rig, client, "one-edited", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=running["id"])
    await request
    assert stopped.is_set()  # stopped as Stop stops it
    [turn] = (await listed(rig))["turns"]
    assert (turn["question"], turn["version"], turn["versions"]) == ("Plan a trip to Osaka", 2, 2)
    old = (await version(rig, running["id"], 1))["turn"]
    assert old["question"] == "Plan a trip to Kyoto" and old["status"] == "cancelled"
    assert "First part of the Kyoto plan" in [line["text"] for line in old["messages"] if line["kind"] == "reply"]
    # Its work lines are not words to read again.
    assert all(line["kind"] in ("reply", "media", "event") for line in old["messages"])


async def test_versions_go_with_their_turn_and_never_reach_a_turn_given_its_id_later(team_rig, client):
    rig = team_rig
    first = await say(rig, client, "one", "Plan a trip to Kyoto", "Kyoto plan")
    await say(rig, client, "two", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=first["turn_id"])
    assert len(rig.history.versions(first["turn_id"])) == 1
    await rig.call("agent.history.delete", {"turn_id": first["turn_id"], "member_id": rig.member, "conversation_id": rig.conversation})
    assert rig.history.versions(first["turn_id"]) == []
    # SQLite gives a deleted newest row's id to the next row: that turn has no versions of the one that was there.
    again = await say(rig, client, "three", "A new question", "A new answer")
    assert again["turn_id"] == first["turn_id"]
    [turn] = (await listed(rig))["turns"]
    assert "versions" not in turn
    await say(rig, client, "four", "A new question, said better", "Better answer", replace_turn_id=again["turn_id"])
    assert [(row["version"], row["question"]) for row in rig.history.versions(again["turn_id"])] == [(1, "A new question")]


async def test_clearing_the_conversation_takes_the_versions_too(team_rig, client, conn):
    rig = team_rig
    first = await say(rig, client, "one", "Plan a trip to Kyoto", "Kyoto plan")
    await say(rig, client, "two", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=first["turn_id"])
    await rig.call("conversations.clear", {"id": rig.conversation})
    assert conn.execute("SELECT COUNT(*) FROM agent_turn_versions").fetchone()[0] == 0


async def test_another_version_is_read_only_in_its_own_conversation(team_rig, client):
    rig = team_rig
    first = await say(rig, client, "one", "Plan a trip to Kyoto", "Kyoto plan")
    await say(rig, client, "two", "Plan a trip to Osaka", "Osaka plan", replace_turn_id=first["turn_id"])
    for bad in ({"version": 3}, {"version": 0}, {"turn_id": first["turn_id"] + 99}, {"conversation_id": rig.conversation + 99}):
        with pytest.raises(RpcError) as error:
            await rig.call("agent.history.version", {"member_id": rig.member, "conversation_id": rig.conversation,
                                                     "turn_id": first["turn_id"], "version": 1, **bad})
        assert error.value.code == -32602
    # Raphael's thread does not reach a member's message.
    with pytest.raises(RpcError):
        await rig.call("agent.history.version", {"turn_id": first["turn_id"], "version": 1})


async def test_a_message_never_edited_has_one_version(team_rig, client):
    rig = team_rig
    first = await say(rig, client, "one", "Plan a trip to Kyoto", "Kyoto plan")
    only = await version(rig, first["turn_id"], 1)
    assert (only["version"], only["versions"], only["turn"]["question"]) == (1, 1, "Plan a trip to Kyoto")
    assert "versions" not in only["turn"]


def test_the_versions_table_and_its_trigger_come_with_migration_87(tmp_path):
    from raphael_core.brain import db
    from unittest.mock import patch
    path = tmp_path / "v86.db"
    with patch.object(db, "LATEST_VERSION", 86):
        old = db.connect(path)
    assert old.execute("SELECT 1 FROM sqlite_master WHERE name='agent_turn_versions'").fetchone() is None
    with old:
        old.execute("INSERT INTO agent_turns (id, created_at_ms, session_id, question, route, prefix, text, status)"
                    " VALUES (5, 1, 's', 'kept', 'chat', '', 'answer', 'done')")
    old.close()
    conn = db.connect(path)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION >= 87
    assert conn.execute("SELECT question FROM agent_turns WHERE id=5").fetchone()[0] == "kept"
    assert conn.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='agent_turn_versions_delete'").fetchone()
    with conn:
        conn.execute("INSERT INTO agent_turn_versions (turn_id, version, created_at_ms, replaced_at_ms, session_id, question,"
                     " source, route, prefix, text, status) VALUES (5, 1, 1, 2, 's0', 'first', 'app', 'chat', '', 'a', 'done')")
    with pytest.raises(Exception):
        with conn:
            conn.execute("INSERT INTO agent_turn_versions (turn_id, version, created_at_ms, replaced_at_ms, session_id, question,"
                         " source, route, prefix, text, status) VALUES (5, 0, 1, 2, 's0', 'none', 'app', 'chat', '', 'a', 'done')")
    with conn:
        conn.execute("DELETE FROM agent_turns WHERE id=5")
    assert conn.execute("SELECT COUNT(*) FROM agent_turn_versions").fetchone()[0] == 0
    conn.close()
