"""The unique primary contact also holds the chief role, read fresh by every Bot and brain."""

import json
import sqlite3

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.team import primary_contact_prompt, roster_prompt
from raphael_core.brain import db
from raphael_core.protocol import INVALID_PARAMS, RpcError

from .conftest import Rig
from .test_answering import client, setup, member, typed, live_said  # noqa: F401
from .test_answering import decision
from .test_cli_brains import fake_brain
from .test_exchanges import exchange, finish, history, send, team, meeting_source  # noqa: F401


async def make(rig, name, **fields):
    return (await rig.call("members.create", {"name": name, "role": name + " role", **fields}))["member"]["id"]


def flagged(rig):
    return [row[0] for row in rig.conn.execute("SELECT id FROM members WHERE primary_contact = 1 ORDER BY id")]


def primary(rig):
    """The chief of staff as the store has it: 0 is nobody (Raphael is never it)."""
    return rig.service.primary_id()


async def refused(rig, params):
    with pytest.raises(RpcError) as caught:
        await rig.call("members.set_primary", params)
    assert caught.value.code == INVALID_PARAMS
    return (caught.value.data or {}).get("kind")


# --- one at a time, and kept ---------------------------------------------------------------------


def test_the_method_is_registered(rig):
    assert "members.set_primary" in set(rig.rpc.methods())


async def test_nobody_is_the_chief_until_a_slime_is_made_and_then_the_first_one_is_for_everyone(rig):
    alone = rig.service.team_context(0, "en")
    assert (alone["primary_id"], alone["chief_id"]) == (None, None)
    alice = await make(rig, "Alice")
    bob = await make(rig, "Bob")
    assert flagged(rig) == [alice]
    for who in (0, alice, bob):
        context = rig.service.team_context(who, "en")
        assert (context["primary_id"], context["chief_id"]) == (alice, alice)


async def test_exactly_one_member_is_the_primary_and_choosing_another_moves_it(rig):
    alice, bob = await make(rig, "Alice"), await make(rig, "Bob")
    before = rig.service.team_context(0, "en")
    assert await rig.call("members.set_primary", {"id": bob}) == {"primary_id": bob}
    assert flagged(rig) == [bob] and primary(rig) == bob
    assert rig.service.team_context(0, "en")["revision"] != before["revision"]
    await rig.call("members.set_primary", {"id": alice})
    assert flagged(rig) == [alice] and primary(rig) == alice
    # Raphael is never chosen: it is the app's guide, not a slime
    assert await refused(rig, {"id": 0}) == "raphael"
    assert flagged(rig) == [alice]


async def test_the_window_is_told_the_primary_by_the_list_it_reads_the_roster_from(rig):
    alice = await make(rig, "Alice")
    await rig.call("members.set_primary", {"id": alice})
    listed = await rig.call("members.list", {"ui_language": "en"})
    assert (listed["team_context"]["primary_id"], listed["team_context"]["chief_id"]) == (alice, alice)
    # no member's row has a second opinion of it: the roster is the one place it is read from
    assert not any("primary" in key for member_view in listed["members"] for key in member_view)


async def test_a_change_is_announced_once_and_choosing_the_same_member_again_announces_nothing(rig):
    await make(rig, "Alice")
    bob = await make(rig, "Bob")
    rig.notes.clear()
    await rig.call("members.set_primary", {"id": bob})
    await rig.call("members.set_primary", {"id": bob})
    assert [method for method, _ in rig.notes].count("members.changed") == 1


@pytest.mark.parametrize("params,kind", [({"id": 999}, "not_found"), ({"id": 0}, "raphael"), ({"id": -1}, None), ({"id": "1"}, None),
                                          ({"id": True}, None), ({"id": 1.0}, None), ({}, None)])
async def test_only_a_member_that_is_there_can_be_chosen(rig, params, kind):
    alice = await make(rig, "Alice")
    assert await refused(rig, params) == kind
    assert flagged(rig) == [alice] and primary(rig) == alice


async def test_a_member_hidden_from_the_sidebar_is_not_offered_and_cannot_be_chosen(rig):
    alice = await make(rig, "Alice")
    await rig.call("members.update", {"id": alice, "hidden": True})
    assert await refused(rig, {"id": alice}) == "hidden"
    assert primary(rig) == 0


async def test_a_primary_that_is_hidden_hands_the_role_on_and_nobody_holds_it_while_all_are_hidden(rig):
    alice, bob, carol = await make(rig, "Alice"), await make(rig, "Bob"), await make(rig, "Carol")
    await rig.call("members.set_primary", {"id": alice})
    await rig.call("members.update", {"id": bob, "hidden": True})
    assert primary(rig) == alice
    await rig.call("members.update", {"id": alice, "hidden": True})
    assert flagged(rig) == [carol]
    await rig.call("members.update", {"id": carol, "hidden": True})
    assert flagged(rig) == [] and primary(rig) == 0
    await rig.call("members.update", {"id": alice, "hidden": False})
    assert primary(rig) == alice


async def test_a_primary_that_is_deleted_hands_the_role_on_and_a_later_member_is_not_the_primary(rig):
    alice, bob = await make(rig, "Alice"), await make(rig, "Bob")
    await rig.call("members.set_primary", {"id": alice})
    await rig.call("members.delete", {"id": alice})
    assert flagged(rig) == [bob]
    newer = await make(rig, "Carol")
    assert newer != alice and primary(rig) == bob


async def test_a_copy_of_the_primary_is_not_a_second_primary(rig):
    alice = await make(rig, "Alice")
    await rig.call("members.set_primary", {"id": alice})
    copy = (await rig.call("members.duplicate", {"id": alice}))["member"]["id"]
    assert flagged(rig) == [alice] and copy != alice


def test_the_database_itself_refuses_a_second_primary(conn):
    conn.executemany("INSERT INTO members(name, position, created_at_ms) VALUES (?, ?, 1)", [("Alice", 0), ("Bob", 1)])
    conn.execute("UPDATE members SET primary_contact = 1 WHERE name = 'Alice'")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE members SET primary_contact = 1 WHERE name = 'Bob'")


async def test_the_primary_is_kept_when_the_core_restarts(tmp_path):
    path = tmp_path / "raphael.db"
    first = Rig(db.connect(path), tmp_path)
    alice = await make(first, "Alice")
    await make(first, "Bob")
    await first.call("members.set_primary", {"id": alice})
    await first.close()
    first.conn.close()
    second = Rig(db.connect(path), tmp_path)
    try:
        assert primary(second) == alice and flagged(second) == [alice]
        assert (await second.call("members.list", {"ui_language": "en"}))["team_context"]["primary_id"] == alice
    finally:
        await second.close()
        second.conn.close()


async def test_raphaels_team_overview_names_the_primary_too(rig):
    alice = await make(rig, "Alice")
    assert (await rig.service.admin_tool(0, "team_overview", {}))["primary_id"] == alice
    bob = await make(rig, "Bob")
    await rig.call("members.set_primary", {"id": bob})
    assert (await rig.service.admin_tool(alice, "team_overview", {}))["primary_id"] == bob


# --- choosing changes nothing else -----------------------------------------------------------------

STATE = ("worker_tasks", "agent_turns", "agent_messages", "conversations", "rooms", "room_members", "room_messages",
         "room_exchanges", "room_reply_intents", "routines", "member_unread", "member_groups", "task_outbox", "settings")


def dump(rig):
    def rows(table):
        return [tuple(row) for row in rig.conn.execute(f"SELECT * FROM {table} ORDER BY 1")]
    members = [tuple(row) for row in rig.conn.execute(
        "SELECT id, name, role, instructions, avatar, group_id, model, position, pinned, hidden FROM members ORDER BY id")]
    return {table: rows(table) for table in STATE} | {"members": members}


async def test_choosing_a_primary_changes_no_room_task_exchange_conversation_or_member(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice status")
    waiting = rig.background.store.create(session_id="s", language="en", text="Work Alice has not started", member_id=ids[0])
    done = rig.background.store.create(session_id="d", language="en", text="Work Bob finished", member_id=ids[1])
    rig.background.store.finish(done, "done", prefix="", text="Done.", detail=None, reason=None)
    AgentHistory(rig.conn).add(session_id="h", question="Hello", route="answer", prefix="", text="Hi", status="done", member_id=ids[1])
    submitted, state = list(rig.background.submitted), dump(rig)
    await rig.call("members.set_primary", {"id": ids[1]})
    await rig.call("members.set_primary", {"id": ids[0]})
    # nothing was handed on, run again, ended or moved: every row of the work, the rooms and the threads is as it was
    assert dump(rig) == state
    assert rig.background.submitted == submitted
    assert rig.background.store.get(waiting).member_id == ids[0] and rig.background.store.get(done).state == "done"


async def test_new_room_membership_requires_the_current_chief(rig, exchange):
    room, ids = await team(rig)
    await rig.call("members.set_primary", {"id": ids[0]})
    listed = (await rig.call("rooms.list"))["rooms"]
    assert [sorted(r["member_ids"]) for r in listed] == [[rig.lead, *ids]] and listed[0]["membership_state"] == "ready"
    await rig.call("rooms.update", {"room_id": room["id"], "member_ids": ids})
    # a room made by the primary's own choice, or by a meeting, has it as well
    with pytest.raises(RpcError):
        await rig.call("rooms.create", {"name": "No chief", "member_ids": [rig.lead, ids[1]]})
    assert (await exchange.meeting({"member_ids": [rig.lead, *ids], "agenda": "Plan"}, "en", meeting_source(rig, 7)))["member_ids"] == [rig.lead, *ids]
    # and it is still there once the primary has been deleted
    await rig.call("members.delete", {"id": ids[0]})
    assert rig.service.primary_id() == rig.lead  # the role went to the next slime in the sidebar's order
    rooms = (await rig.call("rooms.list"))["rooms"]
    assert next(r for r in rooms if r["id"] == room["id"])["membership_state"] == "needs_adjustment"
    assert next(r for r in rooms if r["id"] != room["id"])["membership_state"] == "ready"


@pytest.mark.parametrize("switch", ["never", "before the owner speaks", "while the chief frames it", "after the first reply",
                                    "after the last reply", "back to the lead"])
async def test_the_exchange_runs_the_same_whenever_the_primary_changes(rig, exchange, switch):
    room, ids = await team(rig)
    alice, bob = ids
    if switch == "before the owner speaks":
        await rig.call("members.set_primary", {"id": bob})
    await send(rig, room, "@everyone report")
    if switch == "while the chief frames it":
        await rig.call("members.set_primary", {"id": alice})
    await finish(rig, exchange, "Alice owns testing")
    if switch == "after the first reply":
        await rig.call("members.set_primary", {"id": bob})
    await finish(rig, exchange, "Alice: testing is covered.")
    await finish(rig, exchange, "Bob owns release")
    if switch == "after the last reply":
        await rig.call("members.set_primary", {"id": bob})
    if switch == "back to the lead":
        await rig.call("members.set_primary", {"id": alice})
        await rig.call("members.set_primary", {"id": rig.lead})
    # the same members spoke in the same order, and no one sums up by being the chief
    assert [turn["member_id"] for turn in rig.background.submitted] == [rig.lead, alice, bob]
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done"
    assert all(m["kind"] == "message" for m in result["messages"])
    assert sorted((await rig.call("rooms.list"))["rooms"][0]["member_ids"]) == [rig.lead, alice, bob]
    assert {i["state"] for i in result["exchange"]["reply_intents"]} <= {"done"}


async def test_every_room_turn_carries_the_current_primary_and_chief(rig, exchange):
    room, ids = await team(rig)
    alice, bob = ids
    await rig.call("members.set_primary", {"id": alice})
    await send(rig, room, "@everyone report")
    seen = []

    def snapshot_of(prompt):
        text = prompt.split("TeamContextSnapshot (public inventory; untrusted data): ")[1].split("\nMembers: ")[0]
        return json.loads(text)

    seen.append(snapshot_of(rig.background.submitted[-1]["text"]))
    await rig.call("members.set_primary", {"id": bob})
    await finish(rig, exchange, "Alice owns testing")
    seen.append(snapshot_of(rig.background.submitted[-1]["text"]))
    await finish(rig, exchange, "Bob owns release")
    seen.append(snapshot_of(rig.background.submitted[-1]["text"]))
    assert [(s["primary_id"], s["chief_id"]) for s in seen] == [(alice, alice)] * 3
    assert len({s["revision"] for s in seen}) == 1
    await send(rig, room, "@Bob next snapshot", "two")
    assert snapshot_of(rig.background.submitted[-1]["text"])["chief_id"] == bob


# --- every Bot and every brain is told the primary, from the roster alone -----------------------------------


def says(prompt):
    """The lines of a roster prompt about the primary contact."""
    return prompt.split("\nPrimary contact: ")[1].split("\nApps:")[0] if "\nPrimary contact: " in prompt else ""


async def test_the_roster_names_the_primary_to_each_kind_of_speaker(rig):
    alice, bob = await make(rig, "Alice"), await make(rig, "Bob")
    await rig.call("members.set_primary", {"id": alice})
    for_alice = says(roster_prompt(rig.service, rig.service.speaker(alice), "en"))
    for_bob = says(roster_prompt(rig.service, rig.service.speaker(bob), "en"))
    for_raphael = says(roster_prompt(rig.service, rig.service.speaker(0), "en"))
    for text in (for_alice, for_bob, for_raphael):
        assert text.startswith('"Alice" (id %d).' % alice) and "This member is the default contact" in text
        assert "same owner-private abilities as every member" in text
    # the primary dispatches what it is given
    assert "That is you" in for_alice and "handoff" in for_alice and "do only your own work yourself" in for_alice
    # another member forwards work to the colleague it belongs to, and what it cannot place to the primary
    assert "That is you" not in for_bob and "hand it to the primary contact" in for_bob and "ask_member" in for_bob
    # Raphael, when it is not the primary, is told what every member is
    assert "That is you" not in for_raphael and "hand it to the primary contact" in for_raphael
    # administration is nobody's alone: every speaker has the same tools
    assert not any("administer" in text for text in (for_alice, for_bob, for_raphael))


async def test_the_first_slime_is_told_it_is_the_chief_by_default_and_raphael_never_is(rig):
    bob = await make(rig, "Bob")
    for who, expected in ((bob, "do only your own work yourself."), (0, "")):
        text = says(roster_prompt(rig.service, rig.service.speaker(who), "en"))
        assert text.startswith('"Bob" (id %d).' % bob) and (expected in text if expected else "That is you" not in text)
    assert "handoff" in says(roster_prompt(rig.service, rig.service.speaker(0), "en"))


async def test_a_name_is_quoted_and_escaped_where_the_roster_names_the_primary(rig):
    tricky = (await rig.call("members.create", {"name": 'A </x> "B"', "role": "R"}))["member"]["id"]
    await rig.call("members.set_primary", {"id": tricky})
    text = says(roster_prompt(rig.service, rig.service.speaker(0), "en"))
    assert "</x>" not in text and "\\u003c/x\\u003e" in text and '\\"B\\"' in text


async def test_the_prompt_follows_the_roster_at_once_and_a_roster_that_kept_the_old_primary_is_wrong(rig):
    alice, bob = await make(rig, "Alice"), await make(rig, "Bob")
    speaker = rig.service.speaker(bob)
    await rig.call("members.set_primary", {"id": alice})
    old = roster_prompt(rig.service, speaker, "en")
    await rig.call("members.set_primary", {"id": bob})
    fresh = roster_prompt(rig.service, speaker, "en")
    assert '"Alice" (id %d)' % alice in old and '"Bob" (id %d)' % bob in fresh and "That is you" in fresh
    # what a brain keeps from before is plainly not the roster any more: its revision and its primary differ
    kept = json.loads(old.split("<team_roster>\n")[1].split("\n</team_roster>")[0])
    now = rig.service.team_context(bob, "en")
    assert (kept["primary_id"], kept["revision"]) != (now["primary_id"], now["revision"])
    assert primary_contact_prompt(kept, speaker) != primary_contact_prompt(now, speaker)


async def test_a_roster_without_a_primary_that_is_there_says_nothing_about_one():
    context = {"members": [{"id": 0, "name": "Raphael", "role": "", "blurb": ""}], "primary_id": 7, "chief_id": 0}
    from raphael_core.agent.speaker import RAPHAEL
    assert primary_contact_prompt(context, RAPHAEL) == ""


async def test_an_api_turn_of_a_member_is_told_the_primary_of_that_moment(setup, client):
    rig, team = setup
    one, other = member(team, name="Teacher"), member(team, name="Coach")
    client.decisions = [decision("chat"), decision("chat")]
    client.chats = [live_said("First."), live_said("Second.")]
    await typed(rig, "Hello", one.id, language="en")
    team.members.store.set_primary(other.id)
    await typed(rig, "Again", one.id, language="en")
    # The team comes with each turn's message, so the member reads the primary of that moment while its system
    # prompt stays the one the provider cached.
    first, second = (call["messages"][1]["content"] for call in client.chat_calls)
    assert says(first).startswith('"Teacher" (id %d).' % one.id) and says(second).startswith('"Coach" (id %d).' % other.id)
    assert "hand it to the primary contact" in says(second)
    assert client.chat_calls[0]["messages"][0]["content"] == client.chat_calls[1]["messages"][0]["content"]


async def test_a_resumed_cli_thread_is_told_the_primary_it_has_now_not_the_one_it_began_with(setup, tmp_path, client):
    rig, team = setup
    teacher = member(team, model="cli:codex")
    writer = member(team, name="Writer", role="Writes")
    inputs = tmp_path / "inputs.jsonl"
    fake_brain(rig, tmp_path, '''import json, sys
def send(value): print(json.dumps(value), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize": send({"id":msg["id"], "result":{}})
    elif msg.get("method") in ("thread/start", "thread/resume"):
        send({"id":msg["id"], "result":{"thread":{"id":"primary-session"}}})
    elif msg.get("method") == "turn/start":
        with open(INPUTS, "a", encoding="utf-8") as out:
            out.write(json.dumps(msg["params"]["input"][0]["text"]) + "\\n")
        send({"method":"item/completed", "params":{"item":{"type":"agentMessage", "id":"final", "phase":"final_answer", "text":"Noted."}}})
        send({"method":"turn/completed", "params":{"turn":{"status":"completed"}}})
        break
'''.replace("INPUTS", repr(str(inputs))), name="codex")
    chief = team.members.store.member(team.members.primary_id())
    await typed(rig, "Who is the primary contact?", teacher.id, language="en")
    team.members.store.set_primary(writer.id)
    await typed(rig, "And now?", teacher.id, language="en")
    first, second = [json.loads(line) for line in inputs.read_text(encoding="utf-8").splitlines()]
    assert says(first).startswith('"%s" (id %d).' % (chief.name, chief.id))
    assert 'And now?' in second
    assert says(second).startswith('"Writer" (id %d).' % writer.id)


async def test_every_member_is_told_raphael_is_no_member_and_how_to_ask_it(rig):
    # The owner asked a member to "ask 拉斐爾". Raphael is no slime, so the snapshot never lists it; told only of a chief,
    # the member took the primary contact for Raphael (「盧米納斯（原拉斐爾）」) and asked the wrong one.
    luminous, knowledge = await make(rig, "盧米納斯"), await make(rig, "知識庫")
    await rig.call("members.set_primary", {"id": luminous})
    for language, name in (("zh-TW", "拉斐爾"), ("en", "Raphael"), ("ja", "ラファエル")):
        text = roster_prompt(rig.service, rig.service.speaker(knowledge), language)
        assert f"{name} (Raphael) is the app itself" in text
        assert "never the primary contact and never a member renamed" in text
        assert f'ask_member (member "{name}")' in text
    # Raphael itself is not told about itself.
    assert "is the app itself" not in roster_prompt(rig.service, rig.service.speaker(0), "zh-TW")
    # And ask_member reaches it by that name.
    assert rig.service.find("拉斐爾").id == 0
