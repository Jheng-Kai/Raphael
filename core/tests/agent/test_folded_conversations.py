"""History, search, pending questions and admission use the folded main conversation."""

from types import SimpleNamespace

import pytest

from raphael_core.agent.conversations import Conversations
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.owner_questions import OwnerQuestions
from raphael_core.brain import db
from raphael_core.protocol import INVALID_PARAMS, RpcError
from .test_narration import chat
from .test_service import Rig


@pytest.fixture
async def folded(tmp_path, monkeypatch, client, actions):
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 67)
        conn = db.connect(tmp_path / "folded.db")
    main = Conversations(conn).main()
    extra = conn.execute("INSERT INTO conversations(member_id,title,created_at_ms,updated_at_ms) VALUES(0,'Old',1,2)").lastrowid
    history = AgentHistory(conn)
    tid = history.add(session_id="old", question="Cobalt evidence", route="answer", prefix="", text="Saved answer", status="done", conversation_id=extra)
    task = conn.execute("INSERT INTO worker_tasks(created_at_ms,state,session_id,turn_id,language,text) VALUES(1,'waiting','old',?,'en','Choose a source')", (tid,)).lastrowid
    questions = OwnerQuestions(conn)
    question = questions.open(SimpleNamespace(id=task, turn_id=tid, member_id=0), "ask_owner", {"question": "Which source?", "options": [], "free_text": True})
    conn.commit()
    db.migrate(conn)
    rig = Rig(conn, client, actions)
    rig.service._background.owner_questions = questions
    try:
        yield rig, main, extra, tid, question
    finally:
        await rig.aclose()
        conn.close()


async def test_folded_history_search_pending_questions_and_default_admission(folded, client):
    rig, main, extra, tid, question = folded
    page = await rig.call("agent.history.list")
    assert [(t["id"], t["conversation_id"]) for t in page["turns"]] == [(tid, main)]
    assert [q["id"] for q in page["pending_questions"]] == [question["id"]]
    for method in ("agent.history.search", "messages.search"):
        found = (await rig.call(method, {"query": "Cobalt"}))["turns"]
        assert [(t["id"], t["conversation_id"]) for t in found] == [(tid, main)]
    client.chats.append(chat('{"text":"Read the saved evidence."}'))
    await rig.call("agent.ask", {"session_id": "new", "text": "Continue reviewing", "source": "app", "ui_language": "en"})
    turns = (await rig.call("agent.history.list"))["turns"]
    assert len(turns) == 2 and {t["conversation_id"] for t in turns} == {main}


@pytest.mark.parametrize("method,params", [
    ("agent.history.list", {}),
    ("agent.history.search", {"query": "Cobalt"}),
    ("agent.history.delete", {"turn_id": 1}),
    ("agent.ask", {"session_id": "stale", "text": "Continue", "source": "app", "ui_language": "en"}),
    ("conversations.clear", {}),
])
async def test_folded_ids_are_refused_as_invalid_params(folded, client, method, params):
    rig, main, extra, tid, question = folded
    params = {**params, "id" if method == "conversations.clear" else "conversation_id": extra}
    with pytest.raises(RpcError) as error:
        await rig.call(method, params)
    assert error.value.code == INVALID_PARAMS
    assert not client.chat_calls
    assert rig.history.get(tid).conversation_id == main
