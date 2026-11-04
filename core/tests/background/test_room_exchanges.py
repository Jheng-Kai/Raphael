"""A small fake team completes an exchange through the real background worker."""
from datetime import timezone

import pytest

from members.conftest import QuietModel
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.members.rooms import RoomsService
from raphael_core.members.service import MembersService
from raphael_core.memory.service import MemoryService
from .conftest import report, until


async def test_api_room_team_talks_through_shared_worker_and_ends_by_itself(make_rig, conn, tmp_path):
    rig = make_rig()
    memory = MemoryService(conn, tmp_path / "memory", QuietModel(), MemoryKeyStore(), quiet_s=3600, start_delay_s=3600)
    members = MembersService(conn, tmp_path, background=rig.service, memory=memory, now_ms=rig.wall, tz=timezone.utc)
    memory.member_exists = members.member_exists
    members.register(rig.rpc)
    rooms = RoomsService(conn, members=members, background=rig.service)
    rooms.register(rig.rpc)

    async def unused(*args, **kwargs):
        pytest.fail("No team administration is needed")

    rig.service.use_memory(memory)
    rig.service.use_team(members, unused)
    notify = rig.service._notify
    def arrived(method, params):
        notify(method, params)
        if method == "agent.turn":
            rooms.turn_arrived(params["turn_id"])
    rig.service._notify = arrived
    alice = members.store.create_member(name="Alice", role="PM", personality="PRECISE-PLANNER")
    bob = members.store.create_member(name="Bob", role="CTO", personality="CAUTIOUS-ENGINEER")
    memory.shared.edit_document("BRAND-GOLD\n", None)
    memory.own(alice.id).edit_document("ALICE-PRIVATE\n", None)
    rig.client.replies.extend(report(text) for text in (
        "@Alice lead the release plan", "@Bob I propose shipping today", "@Alice I disagree: test first",
        "Agreed, I own testing",
    ))
    try:
        room = (await rig.rpc.call("rooms.create", {"name":"Release", "member_ids":[0,alice.id,bob.id]}))["room"]
        await rig.rpc.call("rooms.send", {"room_id":room["id"], "text":"Discuss a release plan", "request_id":"team", "language":"en"})
        await until(lambda: rooms._exchanges.latest(room["id"])["state"] == "done", timeout=10)
        messages = (await rig.rpc.call("rooms.messages", {"room_id":room["id"]}))["messages"]
        assert [m["member_id"] for m in messages] == [None,0,alice.id,bob.id,alice.id]
        assert [m["reply_to_member"] for m in messages[2:]] == [0,alice.id,bob.id]
        assert all(m["kind"] == "message" for m in messages)
        assert len(rig.client.chat_calls) == 4 and not rig.client.replies and rig.reports() == []
        await until(lambda: not rig.service.activity.running)
        for identifier in (0, alice.id, bob.id):
            activity = [data['state'] for method, data in rig.notifications
                        if method == 'member.activity' and data['member_id'] == identifier]
            assert activity[:2] == ['waiting', 'thinking'] and activity[-2:] == ['done', 'idle']
        assert rig.client.chat_calls[3]["tools"]
        assert "PRECISE-PLANNER" in rig.client.chat_calls[1]["messages"][0]["content"]
        assert "CAUTIOUS-ENGINEER" in rig.client.chat_calls[2]["messages"][0]["content"]
        assert "I disagree: test first" in str(rig.client.chat_calls[3]["messages"])
        # A room reads the team's shared notes; what the owner told Alice alone stays out of it.
        alice_turn = str(rig.client.chat_calls[1]["messages"])
        assert "BRAND-GOLD" in alice_turn and "ALICE-PRIVATE" not in alice_turn
        assert "history_search" not in [tool["function"]["name"] for tool in rig.client.chat_calls[1]["tools"]]
    finally:
        await rooms.aclose()
        await members.aclose()
        await memory.aclose()


async def test_room_roles_keep_shared_notes_and_normal_tools_without_rounds(make_rig, conn, tmp_path):
    rig = make_rig()
    memory = MemoryService(conn, tmp_path / "memory", QuietModel(), MemoryKeyStore(), quiet_s=3600, start_delay_s=3600)
    members = MembersService(conn, tmp_path, background=rig.service, memory=memory, now_ms=rig.wall, tz=timezone.utc)
    memory.member_exists = members.member_exists
    members.register(rig.rpc)
    rooms = RoomsService(conn, members=members, background=rig.service)
    rooms.register(rig.rpc)

    async def unused(*args, **kwargs):
        pytest.fail("No team administration is needed")

    rig.service.use_memory(memory)
    rig.service.use_team(members, unused)
    notify = rig.service._notify
    def arrived(method, params):
        notify(method, params)
        if method == "agent.turn":
            rooms.turn_arrived(params["turn_id"])
    rig.service._notify = arrived
    alice = members.store.create_member(name="Alice", role="PM", personality="PRECISE-PLANNER")
    bob = members.store.create_member(name="Bob", role="Mail", personality="CAUTIOUS-ENGINEER")
    memory.shared.edit_document("SHARED-REPORT\n", None)
    memory.own(alice.id).edit_document("PRIVATE-REPORT\n", None)
    rig.client.replies.extend(report(text) for text in (
        "Who reads today's mail? @Bob", "I can read it.",
    ))
    try:
        room = await rooms.meeting({"member_ids": [0, alice.id, bob.id], "agenda": "@Alice who reads today's mail?",
                                    "roles": {str(alice.id): "moderator", str(bob.id): "participant"}}, "en", 2**50 - 1)
        await until(lambda: rooms._exchanges.latest(room["room_id"])["state"] in ("done", "stopped"), timeout=10)
        messages = (await rig.rpc.call("rooms.messages", {"room_id": room["room_id"]}))["messages"]
        assert [message["member_id"] for message in messages] == [None, alice.id, bob.id]
        assert all(message["kind"] == "message" for message in messages)
        assert len(rig.client.chat_calls) == 2 and not rig.client.replies
        for request in rig.client.chat_calls:
            tools = {tool["function"]["name"] for tool in request["tools"]}
            assert {"find_app", "connect_app", "ask_owner", "handoff"} <= tools
            assert "history_search" not in tools
            given = str(request["messages"])
            assert "SHARED-REPORT" in given and "PRIVATE-REPORT" not in given
            assert "only discusses who does what" not in given
            assert "no fixed rounds and no automatic conclusion" in given
    finally:
        await rooms.aclose()
        await members.aclose()
        await memory.aclose()
