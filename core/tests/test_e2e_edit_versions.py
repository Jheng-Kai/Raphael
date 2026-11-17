"""End to end: the owner edits a message their member already answered, in the core as the Tauri app runs it (R-UI-163).

The core is a child process speaking JSON-RPC on stdio, with the fake LLM, a data directory of its own and a keyring that
fails on every use: no key, no network, no cost. The edit is written in the message's place as its second version, the first
exchange is read again through `agent.history.version`, and the database the core keeps reads the newest words alone, so
nothing that builds a model's context can read the first.
"""

import sqlite3

import pytest
from test_e2e import Core

ASK = {"ui_language": "en", "source": "app", "member_id": 0}


@pytest.fixture
def core(tmp_path):
    started = Core(tmp_path)
    yield started
    started.dispose()


def result(core, method, params=None):
    reply = core.call(method, params)
    assert "error" not in reply, (method, reply, core.log())
    return reply["result"]


def test_an_answered_message_edited_is_its_second_version_and_the_first_is_read_again(core, tmp_path):
    first = result(core, "agent.ask", {**ASK, "session_id": "e2e-first", "text": "Plan a trip to Kyoto"})
    [answered] = result(core, "agent.history.list", {"member_id": 0})["turns"]
    assert answered["status"] == "done" and answered["text"] and "versions" not in answered
    edited = result(core, "agent.ask", {**ASK, "session_id": "e2e-second", "text": "Plan a trip to Osaka", "replace_turn_id": first["turn_id"]})
    assert edited["turn_id"] == first["turn_id"]
    [turn] = result(core, "agent.history.list", {"member_id": 0})["turns"]
    assert (turn["id"], turn["question"], turn["status"], turn["version"], turn["versions"]) == (first["turn_id"], "Plan a trip to Osaka", "done", 2, 2)
    earlier = result(core, "agent.history.version", {"member_id": 0, "turn_id": first["turn_id"], "version": 1})
    assert (earlier["version"], earlier["versions"], earlier["turn"]["question"], earlier["turn"]["text"]) == (1, 2, "Plan a trip to Kyoto", answered["text"])
    assert result(core, "agent.history.search", {"query": "Kyoto", "member_id": 0})["turns"] == []
    missing = core.call("agent.history.version", {"member_id": 0, "turn_id": first["turn_id"], "version": 3})
    assert missing["error"]["code"] == -32602
    assert core.close() == 0
    assert b"Traceback" not in bytes(core.stderr), core.log()
    # What the core keeps: the conversation's turns hold the newest words alone; the first exchange is kept beside them.
    database = sqlite3.connect(tmp_path / "raphael.db")
    try:
        assert database.execute("SELECT question FROM agent_turns WHERE id = ?", (first["turn_id"],)).fetchall() == [("Plan a trip to Osaka",)]
        assert database.execute("SELECT COUNT(*) FROM agent_turns WHERE question LIKE '%Kyoto%'").fetchone()[0] == 0
        assert database.execute("SELECT turn_id, version, question FROM agent_turn_versions").fetchall() == [(first["turn_id"], 1, "Plan a trip to Kyoto")]
    finally:
        database.close()
