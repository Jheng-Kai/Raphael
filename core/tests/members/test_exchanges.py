"""Room exchanges: everyone reads and decides for themselves, addresses are answered, member turns one at a time."""
import pytest
from raphael_core.agent.history import AgentHistory
from raphael_core.members.rooms import RoomsService


class Decision:
    """The members' own decisions: each name given speaks the next time it reads the room, by the urgency given or 0.5."""

    def __init__(self, *speakers, **urgency):
        self.speakers = list(speakers)
        self.urgency = urgency
        self.calls = []

    def can_ask(self, model):
        return not model.startswith("cli:")

    async def room_listener(self, **kwargs):
        self.calls.append(kwargs)
        name = kwargs["member"]["name"]
        speak = name in self.speakers
        if speak:
            self.speakers.remove(name)
        return {"speak": speak, "urgency": self.urgency.get(name, .5), "reason": "fixture"}


@pytest.fixture
def exchange(rig):
    service = RoomsService(rig.conn, members=rig.service, background=rig.background, decision=Decision())
    service.register(rig.rpc)
    return service


async def test_routing_cost_counts_toward_exchange_cap_and_deleted_rooms_leave_no_queue(rig, exchange):
    room, ids = await team(rig)
    class CostlyDecision(Decision):
        async def room_listener(self, **kwargs):
            kwargs["ledger"].add(model="fake/router", cost_usd=10)
            return await super().room_listener(**kwargs)
    exchange._exchanges.decision = CostlyDecision("Alice")
    await send(rig, room, "Choose a lead")
    result = await history(rig, room)
    assert result["exchange"]["cost"] == 30 and result["exchange"]["reason"] == "cost"
    assert not rig.background.submitted
    await rig.call("rooms.delete", {"room_id":room["id"]})
    assert not rig.conn.execute("SELECT 1 FROM room_exchanges").fetchone()
    assert not exchange._exchanges.attachments


async def team(rig, **patch):
    ids = [(await rig.call("members.create", {"name":name, "role":role}))["member"]["id"]
           for name, role in (("Alice","PM"), ("Bob","CTO"))]
    return (await rig.call("rooms.create", {"name":"Plans", "member_ids":[0,*ids], **patch}))["room"], ids


async def send(rig, room, text, key="one", **patch):
    return await rig.call("rooms.send", {"room_id":room["id"], "text":text, "request_id":key, **patch})


async def finish(rig, exchange, text, cost=.001):
    task_id, turn = rig.background.attached[-1]
    AgentHistory(rig.conn).resolve(turn, prefix="", text=text, status="done", cost_usd=cost)
    rig.background.store.finish(task_id,'done',prefix='',text=text,detail=None,reason=None)
    exchange.turn_arrived(turn)
    await exchange.wait_idle()


async def history(rig, room):
    return await rig.call("rooms.messages", {"room_id":room["id"]})


async def test_mention_and_reply_target_do_not_force_a_discussion(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice status")
    assert [s["member_id"] for s in rig.background.submitted] == [ids[0]]
    await finish(rig, exchange, "Ready")
    messages = (await history(rig, room))["messages"]
    alice = next(m for m in messages if m["member_id"] == ids[0])
    await send(rig, room, "More details", "two", reply_to=alice["id"])
    assert rig.background.submitted[-1]["member_id"] == ids[0]
    assert (await history(rig, room))["messages"][-1]["reply_reference"]["author_kind"] == "owner"


async def test_a_saved_default_responder_speaks_without_anyone_being_asked(rig, exchange):
    room, ids = await team(rig, default_responder="member:2")
    await send(rig, room, "Hello")
    assert rig.background.submitted[-1]["member_id"] == ids[1]
    assert not exchange._exchanges.decision.calls


async def test_decider_and_worker_read_only_the_origin_thread(rig, exchange):
    room, ids = await team(rig)
    with rig.conn:
        rig.conn.execute("INSERT INTO room_messages(room_id,text,created) VALUES (?,'Other thread secret',1)", (room['id'],))
        thread = rig.conn.execute("INSERT INTO room_threads(room_id,created) VALUES (?,1)", (room['id'],)).lastrowid
    decision = Decision("Alice")
    exchange._exchanges.decision = decision
    await send(rig, room, "Current thread question", thread_id=thread)
    assert [m['text'] for m in decision.calls[0]['transcript']] == ['Current thread question']
    assert 'Other thread secret' not in rig.background.submitted[-1]['text']
    assert 'Current thread question' in rig.background.submitted[-1]['text']


async def test_everyone_is_sequential_a_pass_is_hidden_and_no_one_sums_up(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@everyone report")
    assert len(rig.background.submitted) == 1
    await finish(rig, exchange, "Alice owns testing")
    assert rig.background.submitted[-1]["member_id"] == ids[0]
    assert "Alice owns testing" in rig.background.submitted[-1]["text"]
    await finish(rig, exchange, "(pass)")
    assert rig.background.submitted[-1]["member_id"] == ids[1]
    await finish(rig, exchange, "Bob owns release")
    result = await history(rig, room)
    assert all(m["text"] != "(pass)" for m in result["messages"])
    assert all(m["kind"] != "wrapup" for m in result["messages"])
    assert result["exchange"]["state"] == "done"
    assert result["exchange"]["turns_taken"] == 3


async def test_a_removed_default_responder_is_presented_as_auto_for_room_editing(rig, exchange):
    room, ids = await team(rig, default_responder="member:1")
    await rig.call("members.delete", {"id":ids[0]})
    [view] = (await rig.call("rooms.list", {}))["rooms"]
    assert view["default_responder"] == "auto"
    await rig.call("rooms.update", {"room_id":room["id"], "member_ids":view["member_ids"], "default_responder":view["default_responder"]})


async def test_explicit_handoffs_survive_the_fourth_hop_and_repeated_speakers(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@Alice plan")
    for text in ("@Bob check", "@Alice disagree", "@Bob please revise", "@Alice check again"):
        await finish(rig, exchange, text)
    assert [s["member_id"] for s in rig.background.submitted] == [ids[0],ids[1],ids[0],ids[1],ids[0]]
    await finish(rig, exchange, 'Ready')
    assert (await history(rig, room))["exchange"]["hops"] == 4
    assert (await history(rig, room))["exchange"]["state"] == "done"


async def test_colleagues_read_what_was_said_and_the_talk_stops_when_no_one_has_more(rig, exchange):
    room, ids = await team(rig)
    exchange._exchanges.decision = Decision("Bob", "Alice")
    await send(rig, room, "@Alice plan")
    await finish(rig, exchange, "Ship today")
    assert rig.background.submitted[-1]["member_id"] == ids[1]
    await finish(rig, exchange, "Test first")
    assert rig.background.submitted[-1]["member_id"] == ids[0]
    await finish(rig, exchange, "Fair, test first")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done"
    assert [m["member_id"] for m in result["messages"]] == [None, ids[0], ids[1], ids[0]]


async def test_interjection_preempts_old_queue_stop_and_duplicate_notifications(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@everyone report")
    first = rig.background.attached[-1][1]
    await send(rig, room, "@Bob only after testing", "two")
    assert len(rig.background.submitted) == 1
    await finish(rig, exchange, "Current turn finishes")
    assert rig.background.submitted[-1]["member_id"] == ids[1]
    exchange.turn_arrived(first)
    await exchange.wait_idle()
    assert len(rig.background.submitted) == 2
    await rig.call("rooms.stop", {"room_id":room["id"]})
    await finish(rig, exchange, "Done")
    assert (await history(rig, room))["exchange"]["state"] == "stopped"
    assert len(rig.background.submitted) == 2


async def test_only_stop_cancels_the_replies_and_the_work_assigned_to_members(rig, exchange):
    cancelled = []

    async def cancel_room(room_id, *, work=True):
        cancelled.append(work)

    rig.background.cancel_room = cancel_room
    room, ids = await team(rig)
    await send(rig, room, "@Alice build the program")
    await send(rig, room, "@Bob check the logo", "two")
    assert cancelled == []
    await rig.call("rooms.stop", {"room_id":room["id"]})
    assert cancelled == [True]


async def test_cost_and_restart_stop_without_replay(rig, exchange):
    room, ids = await team(rig)
    await send(rig, room, "@everyone report")
    await finish(rig, exchange, "@Alice continue", cost=10)
    assert len(rig.background.submitted) == 1
    assert (await history(rig, room))["exchange"]["reason"] == "cost"
    await send(rig, room, "@Alice again", "two")
    restored = RoomsService(rig.conn, members=rig.service, background=rig.background)
    assert (await restored._messages({"room_id":room["id"]}))["exchange"]["state"] == "stopped"
    assert len(rig.background.submitted) == 2


async def test_six_explicit_recipients_all_answer(rig, exchange):
    room, ids = await team(rig)
    extra = [(await rig.call("members.create", {"name":f"Person{i}"}))["member"]["id"] for i in range(3)]
    await rig.call("rooms.update", {"room_id":room["id"], "member_ids":[0,*ids,*extra]})
    await send(rig, room, "@everyone report")
    for _ in range(6):
        await finish(rig, exchange, "Progress confirmed")
    result = await history(rig, room)
    assert result["exchange"]["state"] == "done" and result["exchange"]["turns_taken"] == 6
    assert len(rig.background.submitted) == 6
    assert {i['recipient_id'] for i in result['exchange']['reply_intents'] if i['state']=='done'} == {0,*ids,*extra}


async def test_a_cli_brain_reads_the_room_in_a_real_turn_and_others_are_asked(rig, exchange):
    room, ids = await team(rig)
    from raphael_core.protocol import RpcError
    with pytest.raises(RpcError):
        await rig.call("rooms.update", {"room_id":room["id"], "member_ids":ids})
    exchange._settings.set("agent_model", "cli:codex:gpt-5.6-terra")
    await send(rig, room, "Status")
    assert rig.background.submitted[-1]["member_id"] == 0
    decision = exchange._exchanges.decision
    assert sorted(call["member"]["name"] for call in decision.calls) == ["Alice", "Bob"]
    assert not any(call["model"].startswith("cli:") for call in decision.calls)
    for responder in ("member:999", "wrong", True):
        with pytest.raises(RpcError):
            await rig.call("rooms.update", {"room_id":room["id"], "default_responder":responder})
