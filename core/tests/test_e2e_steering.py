"""End to end: what the owner writes while a member works, in the core as the Tauri app runs it.

The core is a child process speaking JSON-RPC on stdio, with the fake LLM (a native journey's script decides only what the
model chooses), a data directory of its own and a keyring that fails on every use. No key, no network, no cost. The
member's turn ends with a question for the owner and never reads the words written meanwhile: they are answered next, as a
turn of their own (R-QUEUE-10). Once the owner answers, that work goes on in the background, in the real worker process
(`python -m raphael_core --worker`): words written to it there are settled when its model reads them, and answered as a turn
of their own when it is stopped first (R-QUEUE-11).
"""

import re
import time

import pytest
from test_e2e import Core

WORK = "[native-steer:ask] Plan the visit"
SAID = "Also book a table"
LATER = "Make it for four people"
ASK = {"ui_language": "en", "source": "app", "member_id": 0}
WORKER = re.compile(rb"The worker is running \(pid \d+\)")


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


def asked_then_answered(core):
    """Raphael's turn asks the owner a question and is parked in the background; the owner answers it, and the work goes on
    in the worker process, its model thinking for a few seconds at its next step."""
    asked = core.call("agent.ask", {**ASK, "session_id": "e2e-work", "text": WORK})
    assert "error" not in asked, (asked, core.log())
    [question] = turn_of(core, WORK)["owner_questions"]
    result(core, "owner_questions.answer", {"id": question["id"], "answer": "Monday"})
    wait_for(core, lambda: WORKER.search(bytes(core.stderr)))
    time.sleep(0.5)  # the worker's model is at work now: what is written next reaches it there
    said = result(core, "agent.ask", {**ASK, "session_id": "e2e-later", "text": LATER})
    assert said.get("steered") is True, said  # handed to the work in the worker, not run here


def test_words_written_to_background_work_that_is_stopped_before_reading_them_are_answered_as_their_own_turn(spawn):
    core = spawn(RAPHAEL_TEST_NATIVE="1", RAPHAEL_NATIVE_THINK_S="3")
    asked_then_answered(core)
    result(core, "worker.cancel", {})  # while its model still thinks: the words are never read there
    wait_for(core, lambda: (turn_of(core, LATER).get("route"), turn_of(core, LATER).get("status")) == ("answer", "done"), timeout=90)
    assert turn_of(core, LATER)["text"]
    assert core.close() == 0
    assert b"Traceback" not in bytes(core.stderr), core.log()


def test_words_background_work_reads_are_settled_there_once_and_a_restart_never_runs_them(spawn):
    core = spawn(RAPHAEL_TEST_NATIVE="1", RAPHAEL_NATIVE_THINK_S="3")
    asked_then_answered(core)
    wait_for(core, lambda: turn_of(core, WORK) and any(note["method"] == "worker.changed" and note["params"]["state"] == "done"
                                                       for note in core.notifications), timeout=90)
    later = turn_of(core, LATER)
    assert (later["route"], later["status"]) == ("owner_input", "done"), later  # read by the work, not a turn of its own
    assert core.close() == 0
    assert b"Traceback" not in bytes(core.stderr), core.log()
    again = spawn(RAPHAEL_TEST_NATIVE="1")
    later = turn_of(again, LATER)
    assert (later["route"], later["status"]) == ("owner_input", "done"), later
    assert again.close() == 0
