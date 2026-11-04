"""Structured receipts have one public reading, never their transport keys."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.memory.conversation import turn_text
from raphael_core.protocol import RpcError
from .test_service import make_rig  # noqa: F401


@pytest.mark.parametrize("kind", ["routine", "calendar", "meeting", "skill_learned"])
def test_history_search_and_model_context_read_event_words(conn, kind):
    history = AgentHistory(conn)
    turn_id = history.add(session_id="sample", question="", route="answer", prefix="", text="", status="done")
    event = {"type": kind, "action": "created", "id": 987654321, "room_id": 876543219,
             "name": "Sample orchard", "text": "已建立 · Sample orchard"}
    history.add_message(turn_id, "event", json.dumps(event))
    for query in (kind, "created", "987654321", "876543219"):
        assert history.search(query) == [], query
    assert [turn.id for turn in history.search("orchard")] == [turn_id]
    assert history.search("orchard")[0].messages == [event["text"]]
    [turn] = history.recent(10)
    assert turn.messages == [event["text"]]
    assert event["text"] in turn_text(turn, detail=True)
    assert '"type"' not in turn_text(turn, detail=True)


@pytest.mark.parametrize("method", ["agent.history.search", "messages.search"])
async def test_both_search_rpcs_find_receipt_titles_but_not_transport_keys(make_rig, method):
    rig = make_rig()
    turn_id = rig.history.add(session_id="sample", question="", route="answer", prefix="", text="", status="done")
    rig.history.add_message(turn_id, "event", json.dumps({"type": "routine", "action": "created", "id": 987654321,
                                                       "name": "Sample orchard", "text": "已建立 · Sample orchard"}))
    for query in ("routine", "created", "987654321"):
        assert (await rig.call(method, {"query": query}))["turns"] == []
    assert [turn["id"] for turn in (await rig.call(method, {"query": "orchard"}))["turns"]] == [turn_id]


def test_saved_indexes_from_before_the_projection_are_repaired(conn):
    from raphael_core.memory.terms import index_terms
    history = AgentHistory(conn)
    turn_id = history.add(session_id="sample", question="", route="answer", prefix="", text="", status="done")
    raw = json.dumps({"type": "meeting", "room_id": 987654321, "name": "Sample orchard"})
    history.add_message(turn_id, "event", raw)
    terms = index_terms("", raw, "")
    conn.execute("UPDATE agent_turns_fts SET pairs=?, chars=? WHERE rowid=?", (terms.pairs, terms.chars, turn_id))
    conn.commit()
    reopened = AgentHistory(conn)
    assert reopened.search("987654321") == []
    assert [turn.id for turn in reopened.search("orchard")] == [turn_id]


@pytest.mark.parametrize("kind", ["routine", "calendar", "meeting", "skill_learned"])
async def test_voice_and_telegram_deliver_answers_without_event_transport(make_rig, kind):
    from raphael_core.app import App
    voice = SimpleNamespace(speaks=lambda: True, say=AsyncMock())
    rig = make_rig(speaker=voice)
    turn_id = rig.history.add(session_id="sample", question="Check samples", route="answer", prefix="", text="Samples checked.", status="done")
    raw = json.dumps({"type": kind, "action": "created", "id": 987654321, "name": "Sample orchard"})
    rig.history.add_message(turn_id, "event", raw)
    await rig.call("agent.speak", {"turn_id": turn_id})
    voice.say.assert_awaited_once_with("", "Samples checked.", turn_id=turn_id)
    with pytest.raises(RpcError, match="message_seq must name an answer"):
        await rig.call("agent.speak", {"turn_id": turn_id, "message_seq": 1})
    reply = {"status": "done", "prefix": "", "text": "Samples checked.", "turn_id": turn_id,
             "messages": [{"kind": "event", "text": raw}]}
    app = SimpleNamespace(call=AsyncMock(return_value=reply), agent=rig.service, attachment_store=None)
    answer = await App._ask_from_messaging(app, "telegram:sample", "Check samples", "en", "telegram")
    assert str(answer) == "Samples checked." and answer.files == []
