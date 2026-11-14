"""Owner message retraction and replacement through the conversation RPC boundary."""

import asyncio

import pytest

from raphael_core.background.tasks import TaskStore
from raphael_core.protocol import RpcError
from .conftest import FakeActions, FakeOpenRouter
from .test_service import Rig, make_rig  # noqa: F401
from .test_narration import chat


@pytest.fixture
async def rig(conn):
    made = Rig(conn, FakeOpenRouter(), FakeActions())
    yield made
    await made.aclose()


async def test_retraction_cancels_a_running_request_and_removes_it_after_reload(rig):
    entered = asyncio.Event()

    async def waiting(**kwargs):
        entered.set()
        await asyncio.Event().wait()

    rig.client.chat_tools = waiting
    request = asyncio.create_task(rig.call("agent.ask", {
        "session_id": "draft-1", "text": "Typo", "ui_language": "en", "source": "app",
    }))
    await entered.wait()
    [turn] = (await rig.call("agent.history.list", {}))["turns"]
    assert turn["status"] == "running"
    rig.history.add_message(turn["id"], "reply", "Partial answer")
    result = await rig.call("agent.history.retract", {"session_id": "draft-1", "member_id": 0})
    assert result["deleted"] == 1
    await request
    assert (await rig.call("agent.history.list", {}))["turns"] == []
    assert (await rig.call("agent.history.search", {"query": "Typo"}))["turns"] == []
    assert rig.history.messages([turn["id"]]) == {}


async def test_retraction_before_delivery_prevents_a_late_request(rig):
    await rig.call("agent.history.retract", {"session_id": "late", "member_id": 0})
    await rig.call("agent.ask", {"session_id": "late", "text": "Never sent", "ui_language": "en", "source": "app"})
    assert (await rig.call("agent.history.list", {}))["turns"] == []
    assert rig.client.chat_calls == []


async def test_an_edit_replaces_the_old_turn_only_when_the_new_request_is_sent(rig):
    rig.client.chats.append(chat('{"prefix":"答","text":"Original answer","detail":"","memory":[]}'))
    old = await rig.call("agent.ask", {"session_id": "old", "text": "Original", "ui_language": "en", "source": "app"})
    assert len((await rig.call("agent.history.list", {}))["turns"]) == 1
    rig.client.chats.append(chat('{"prefix":"答","text":"Corrected answer","detail":"","memory":[]}'))
    await rig.call("agent.ask", {
        "session_id": "new", "text": "Corrected", "ui_language": "en", "source": "app",
        "replace_turn_id": old["turn_id"],
    })
    [turn] = (await rig.call("agent.history.list", {}))["turns"]
    assert turn["question"] == "Corrected" and turn["text"] == "Corrected answer"
    assert (await rig.call("agent.history.search", {"query": "Original"}))["turns"] == []


async def test_retraction_cannot_target_a_different_thread_or_session(rig):
    turn = rig.history.add(session_id="kept", question="Keep", route="chat", prefix="", text="Answer", status="done")
    with pytest.raises(RpcError) as error:
        await rig.call("agent.history.retract", {"session_id": "other", "turn_id": turn, "member_id": 0})
    assert error.value.code == -32602
    assert len((await rig.call("agent.history.list", {}))["turns"]) == 1


async def test_retraction_detaches_old_worker_history_before_sqlite_reuses_an_id(rig, conn):
    old = rig.history.add(session_id="old", question="Old", route="delegate", prefix="", text="Done", status="done")
    tasks = TaskStore(conn)
    task = tasks.create(session_id="old", text="Old task", language="en")
    tasks.attach_turn(task, old)
    await rig.call("agent.history.retract", {"session_id": "old", "turn_id": old, "member_id": 0})
    new = rig.history.add(session_id="new", question="New", route="chat", prefix="", text="New answer", status="done")
    assert tasks.for_turns([new]) == {}


# --- an edited message stands where it stood (owner, 2026-11-14) ----------------------------------------------------------

@pytest.fixture
async def team_rig(make_rig, conn, tmp_path):
    """A member's own conversation, as the app opens it, with the notifications the app hears."""
    from types import SimpleNamespace
    from raphael_core.members.service import MembersService

    notes = []
    members = MembersService(conn, tmp_path, background=SimpleNamespace(), notify=lambda method, data: notes.append((method, data)))
    member = members.store.create_member(name="PM", role="Project manager")
    rig = make_rig(team=members, notify=lambda method, data: notes.append((method, data)))
    members.register(rig.rpc)
    rig.member, rig.notes, rig.members = member.id, notes, members
    rig.conversation = rig.service.conversations.main(member.id)
    yield rig
    await members.aclose()


async def say(rig, client, session, words, reply, **more):
    client.chats.append(chat('{"prefix":"答","text":"%s","detail":"","memory":[]}' % reply))
    rig.wall.now += 1000
    return await rig.call("agent.ask", {"session_id": session, "text": words, "ui_language": "en", "source": "app",
                                        "member_id": rig.member, "conversation_id": rig.conversation, **more})


def routine(rig, session, text):
    rig.wall.now += 1000
    return rig.history.add(session_id=session, question=session, route="answer", prefix="", text=text, status="done",
                           source="routine", member_id=rig.member, conversation_id=rig.conversation)


async def thread(rig):
    turns = (await rig.call("agent.history.list", {"member_id": rig.member, "conversation_id": rig.conversation}))["turns"]
    return [(turn["id"], turn["question"], turn["text"]) for turn in turns]


async def test_an_edited_message_stands_where_it_stood_among_the_routine_turns_that_came_after_it(team_rig, client):
    rig = team_rig
    first = await say(rig, client, "one", "first", "A1")
    second = await say(rig, client, "two", "second", "B1")
    seven, eight = routine(rig, "r7", "seven o'clock"), routine(rig, "r8", "eight o'clock")
    stood = rig.history.get(second["turn_id"]).created_at_ms
    rig.wall.now += 60_000
    edited = await say(rig, client, "two-edited", "second, said better", "B2", replace_turn_id=second["turn_id"])
    # The same message with new words: its own id and time, between what was before and after it.
    assert edited["turn_id"] == second["turn_id"] and edited["text"] == "B2"
    assert await thread(rig) == [(eight, "r8", "eight o'clock"), (seven, "r7", "seven o'clock"),
                                 (second["turn_id"], "second, said better", "B2"), (first["turn_id"], "first", "A1")]
    turn = rig.history.get(second["turn_id"])
    assert (turn.created_at_ms, turn.session_id, turn.status) == (stood, "two-edited", "done")
    # Nothing of the old words or the old reply is left in the search.
    assert [found["question"] for found in (await rig.call("agent.history.search", {"query": "second", "member_id": rig.member}))["turns"]] == ["second, said better"]
    assert (await rig.call("agent.history.search", {"query": "B1", "member_id": rig.member}))["turns"] == []


async def test_the_app_hears_of_the_removed_message_and_of_the_one_in_its_place(team_rig, client):
    rig = team_rig
    first = await say(rig, client, "one", "first", "A1")
    routine(rig, "r7", "seven o'clock")
    rig.notes.clear()
    await say(rig, client, "one-edited", "first, said better", "A2", replace_turn_id=first["turn_id"])
    told = [data["turn_id"] for method, data in rig.notes if method == "agent.turn" and data["member_id"] == rig.member]
    assert len(told) >= 2 and set(told) == {first["turn_id"]}


async def test_an_edit_of_the_newest_message_is_told_as_finished_again(team_rig, client):
    rig = team_rig
    await say(rig, client, "one", "first", "A1")
    last = await say(rig, client, "two", "second", "B1")
    rig.members._deliver_turn(rig.history.get(last["turn_id"]))
    assert [key for key in rig.members._delivered if key[0] == last["turn_id"]]
    edited = await say(rig, client, "two-edited", "second, said better", "B2", replace_turn_id=last["turn_id"])
    assert edited["turn_id"] == last["turn_id"]
    # The turn that was removed is forgotten, so its replacement, with the same id and time, is not taken for it.
    assert not [key for key in rig.members._delivered if key[0] == last["turn_id"]]
    rig.members._deliver_turn(rig.history.get(edited["turn_id"]))
    assert [key for key in rig.members._delivered if key[0] == last["turn_id"]]


async def test_an_edit_forgets_the_brains_resume_session_and_the_summary_which_hold_the_old_words(team_rig, client, conn):
    rig = team_rig
    first = await say(rig, client, "one", "first", "A1")
    with conn:
        conn.execute("INSERT INTO agent_conversation_cli_sessions(conversation_id, brain, session_id) VALUES (?, 'codex', 'resume-1')", (rig.conversation,))
        conn.execute("INSERT INTO conversation_summaries(member_id, text, through_turn_id, updated_at_ms) VALUES (?, 'old summary', ?, 1)",
                     (rig.member, first["turn_id"]))
    await say(rig, client, "one-edited", "first, said better", "A2", replace_turn_id=first["turn_id"])
    assert conn.execute("SELECT COUNT(*) FROM agent_conversation_cli_sessions WHERE conversation_id=?", (rig.conversation,)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM conversation_summaries WHERE member_id=?", (rig.member,)).fetchone()[0] == 0


async def test_an_edit_in_a_members_conversation_leaves_raphaels_thread_alone(team_rig, client):
    rig = team_rig
    client.chats.append(chat('{"prefix":"答","text":"C1","detail":"","memory":[]}'))
    await rig.call("agent.ask", {"session_id": "chief", "text": "chief words", "ui_language": "en", "source": "app"})
    first = await say(rig, client, "one", "first", "A1")
    await say(rig, client, "one-edited", "first, said better", "A2", replace_turn_id=first["turn_id"])
    assert [turn["question"] for turn in (await rig.call("agent.history.list", {}))["turns"]] == ["chief words"]


async def test_a_message_still_waiting_to_be_answered_is_withdrawn_and_its_replacement_is_written_at_the_end(team_rig, client):
    from raphael_core.agent.service import _Ask
    rig = team_rig
    waiting = _Ask(session_id="waiting", text="waiting", language="en", source="app", speaker=rig.service._speaker(rig.member), conversation_id=rig.conversation)
    queued = rig.service._inbox.admit(waiting, dict(text="waiting", language="en", source="app", attachments=[]))[0]["turn_id"]
    routine(rig, "r7", "seven o'clock")
    edited = await say(rig, client, "waiting-edited", "waiting, said better", "B2", replace_turn_id=queued)
    # Its row stays (withdrawn), so nothing can take its id: the replacement is an ordinary new turn.
    assert edited["turn_id"] != queued and rig.history.get(queued).status == "withdrawn"
