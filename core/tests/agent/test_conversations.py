"""One main conversation per member and a separate quick conversation for Raphael."""

import json
import sqlite3

import pytest

from raphael_core.protocol import RpcError
from .test_service import make_rig  # noqa: F401
from .test_narration import chat


@pytest.mark.parametrize("method", ["conversations.create", "conversations.rename", "conversations.delete"])
async def test_removed_conversation_rpcs_are_unknown(make_rig, method):
    rig = make_rig()
    from raphael_core.protocol import METHOD_NOT_FOUND
    with pytest.raises(RpcError) as error:
        await rig.call(method, {"id": rig.service.conversations.main(), "title": "Unused"})
    assert error.value.code == METHOD_NOT_FOUND


def test_removed_conversation_management_tools_are_not_offered():
    from raphael_core.management import ACTIONS
    assert not {"conversation_create", "conversation_rename", "conversation_delete"} & {action.name for action in ACTIONS}


def test_only_main_can_lazily_create_a_standard_conversation(conn):
    from raphael_core.agent.conversations import Conversations
    conversations = Conversations(conn)
    assert not hasattr(conversations, "create")
    assert conversations.main(1) == conversations.main(1)
    assert len(conversations.list(1)) == 1
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO conversations(member_id,title,created_at_ms,updated_at_ms) VALUES(1,'Duplicate',1,1)")


async def test_quick_starts_clean_and_main_preserves_context(make_rig, client):
    rig = make_rig()
    first = rig.service.conversations.get(rig.service.conversations.main())
    client.chats.append(chat('{"prefix":"Answer","text":"Saved secret","detail":""}'))
    await rig.call("agent.ask", {"session_id": "one", "text": "Remember the cobalt elephant", "source": "app", "ui_language": "en", "conversation_id": first["id"]})
    second = rig.service.conversations.get(rig.service.conversations.quick())
    client.chats.append(chat('{"prefix":"Answer","text":"Hello","detail":""}'))
    await rig.call("agent.ask", {"session_id": "two", "text": "Hello", "source": "app", "ui_language": "en", "conversation_id": second["id"], "destination": "quick"})
    assert "cobalt elephant" not in json.dumps(client.chat_calls[-1])
    first_turns = await rig.call("agent.history.list", {"conversation_id": first["id"]})
    assert [turn["question"] for turn in first_turns["turns"]] == ["Remember the cobalt elephant"]
    assert first_turns["turns"][0]["conversation_id"] == first["id"]
    listed = (await rig.call("conversations.list", {"member_id": 0}))["conversations"]
    assert next(c for c in listed if c["id"] == first["id"])["title"] == "Remember the cobalt elephant"


async def test_the_words_typed_are_listed_newest_first_across_conversations_and_never_the_rest(make_rig):
    rig = make_rig()
    named = rig.service.conversations.get(rig.service.conversations.main())

    def say(question, *, route="answer", **more):
        rig.wall.now += 1000
        return rig.history.add(session_id=f"s{rig.wall.now}", question=question, route=route, prefix="", text="the answer", status="done", **more)

    say("first", source="app")
    say("said aloud", source="voice")
    say("second", source="app", conversation_id=named["id"])
    say("second", source="app")  # the same words twice in a row are one entry
    say("from a phone", source="telegram")
    say("for a draft", source="app", route="draft")
    say("   ", source="app")
    say("a routine", source="routine")
    assert (await rig.call("agent.history.sent", {}))["texts"] == ["second", "first"]
    assert (await rig.call("agent.history.sent", {"limit": 1}))["texts"] == ["second"]
    assert (await rig.call("agent.history.sent", {"limit": 0}))["texts"] == ["second"]
    say("first", source="app", conversation_id=named["id"])
    assert (await rig.call("agent.history.sent", {}))["texts"] == ["first", "second", "first"]
    with pytest.raises(RpcError):
        await rig.call("agent.history.sent", {"limit": "many"})


async def test_data_counts_only_conversations_with_records_and_clears_only_raphael(make_rig):
    rig = make_rig()
    rig.history.add(session_id="chief", question="Synthetic chief", route="answer", prefix="", text="Answer", status="done")
    rig.history.add(session_id="member", member_id=1, question="Synthetic member", route="answer", prefix="", text="Answer", status="done")
    listed = (await rig.call("conversations.list", {"member_id": 0}))["conversations"]
    assert sum(c["turn_count"] > 0 for c in listed) == 1
    rig.service._background.forget_member = lambda member_id: None
    await rig.call("agent.history.clear", {"member_id": 0})
    assert sum(c["turn_count"] for c in (await rig.call("conversations.list", {"member_id": 0}))["conversations"]) == 0
    assert rig.history.list(member_id=1)


async def test_search_clear_and_permanent_default_entry(make_rig):
    rig = make_rig()
    default = next(c for c in (await rig.call("conversations.list", {"member_id": 0}))["conversations"] if c["kind"] == "standard")
    turn_id = rig.history.add(session_id="voice", question="cobalt elephant", route="answer", prefix="", text="hello", status="done")
    assert rig.history.get(turn_id).conversation_id == default["id"]
    assert len((await rig.call("conversations.list", {"member_id": 0, "query": "cobalt"}))["conversations"]) == 1
    await rig.call("conversations.clear", {"id": default["id"]})
    assert rig.history.get(turn_id) is None
    assert rig.history.search("elephant") == []
    replacement = next(c for c in (await rig.call("conversations.list", {"member_id": 0}))["conversations"] if c["kind"] == "standard")
    assert replacement["id"] == default["id"]


async def test_list_has_one_main_for_a_member_and_main_plus_quick_for_raphael(make_rig):
    from raphael_core.members.store import MemberStore
    rig = make_rig()
    member = MemberStore(rig.conn).create_member(name="Researcher")
    main = rig.service.conversations.main(member.id)
    chief = rig.service.conversations.main()
    quick = rig.service.conversations.quick()
    listed = rig.service.conversations.list(member.id)
    assert [(c["id"], c["kind"]) for c in listed] == [(main, "standard")]
    assert {(c["id"], c["kind"]) for c in (await rig.call("conversations.list"))["conversations"]} == {(chief, "standard"), (quick, "quick")}


async def test_listing_raphael_lazily_includes_both_permanent_conversations(make_rig):
    rig = make_rig()
    listed = (await rig.call("conversations.list"))["conversations"]
    assert sorted(c["kind"] for c in listed) == ["quick", "standard"]


@pytest.mark.parametrize("conversation_id", [True, -1, "1", 999999])
async def test_invalid_conversation_never_runs_a_model(make_rig, conversation_id):
    rig = make_rig()
    with pytest.raises(RpcError):
        await rig.call("agent.ask", {"session_id": "bad", "text": "hello", "source": "app", "ui_language": "en", "conversation_id": conversation_id})
    assert await rig.turns() == []


async def test_search_reaches_quick_and_turn_delete_clears_native_context(make_rig):
    rig = make_rig()
    conversation = rig.service.conversations.get(rig.service.conversations.quick())
    turn_id = rig.history.add(session_id="named", question="Cobalt discovery", route="answer", prefix="", text="Answer", status="done", conversation_id=conversation["id"])
    rig.service._cli_sessions.put(0, "cli:codex", "native-context", conversation["id"])
    hits = (await rig.call("messages.search", {"query": "Cobalt"}))["turns"]
    assert [(hit["id"], hit["conversation_id"], hit["conversation_title"]) for hit in hits] == [(turn_id, conversation["id"], "Cobalt discovery")]
    around = await rig.call("agent.history.list", {"conversation_id": conversation["id"], "around_id": turn_id})
    assert around["turns"][0]["id"] == turn_id
    with pytest.raises(RpcError):
        await rig.call("agent.history.delete", {"turn_id": turn_id})
    await rig.call("agent.history.delete", {"turn_id": turn_id, "conversation_id": conversation["id"]})
    assert rig.service._cli_sessions.get(0, "cli:codex", conversation["id"]) is None
    assert (await rig.call("messages.search", {"query": "Cobalt"}))["turns"] == []


async def test_owner_context_reaches_main_conversation_and_desktop_context(make_rig, client):
    rig = make_rig()
    rig.settings.set('owner_name', 'Named Owner')
    conversation = rig.service.conversations.get(rig.service.conversations.main())
    client.chats.append(chat('{"prefix":"Answer","text":"Hello","detail":""}'))
    await rig.call('agent.ask', {'session_id':'named-owner','text':'Hello','source':'app','ui_language':'en','conversation_id':conversation['id']})
    assert 'Named Owner' in json.dumps(client.chat_calls[-1])
    assert '<owner_context>' in rig.service._before_run(conversation_id=conversation['id'])
