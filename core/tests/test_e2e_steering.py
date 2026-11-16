"""End to end: what the owner writes while a member works, in the core as the Tauri app runs it.

The core is a child process speaking JSON-RPC on stdio, with the fake LLM (a native journey's script decides only what the
model chooses), a data directory of its own and a keyring that fails on every use. No key, no network, no cost. The
member's turn ends with a question for the owner and never reads the words written meanwhile: they are answered next, as a
turn of their own (R-QUEUE-10).
"""

import time

import pytest
from test_e2e import Core

WORK = "[native-steer:ask] Plan the visit"
SAID = "Also book a table"


@pytest.fixture
def spawn(tmp_path):
    started: list[Core] = []

    def make(**env):
        core = Core(tmp_path, **env)
        started.append(core)
        return core

    yield make
    for core in started:
        core.dispose()


def result(core, method, params=None, **kwargs):
    reply = core.call(method, params, **kwargs)
    assert "error" not in reply, (method, reply, core.log())
    return reply["result"]


def turn_of(core, question):
    return next((turn for turn in result(core, "agent.history.list", {"member_id": 0})["turns"]
                 if turn["question"] == question), {})


def wait_for(core, predicate, timeout=60.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, f"timed out\n{core.log()}"
        time.sleep(0.2)


def test_words_written_while_a_member_works_are_answered_after_its_turn_ends_without_reading_them(spawn):
    # Every model call of this journey thinks for three seconds: long enough to write to the work while it runs.
    core = spawn(RAPHAEL_TEST_NATIVE="1", RAPHAEL_NATIVE_THINK_S="3")
    ask = {"ui_language": "en", "source": "app", "member_id": 0}
    working = core.send("agent.ask", {**ask, "session_id": "e2e-work", "text": WORK})
    wait_for(core, lambda: turn_of(core, WORK).get("status") == "running")
    time.sleep(0.5)
    said = result(core, "agent.ask", {**ask, "session_id": "e2e-said", "text": SAID})
    assert said.get("steered") is True, said  # handed to the work under way, which its model then never reads
    asked = core.wait(working, "agent.ask")
    assert "error" not in asked, (asked, core.log())
    wait_for(core, lambda: (turn_of(core, SAID).get("route"), turn_of(core, SAID).get("status")) == ("answer", "done"), timeout=90)
    assert turn_of(core, SAID)["text"]
    assert [question["state"] for question in turn_of(core, WORK)["owner_questions"]] == ["asked"]
    assert core.close() == 0
    assert b"Traceback" not in bytes(core.stderr), core.log()
