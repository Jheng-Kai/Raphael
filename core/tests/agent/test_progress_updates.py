"""Long work tells the owner how it goes (R-PROGRESS-01).

Owner, 2026-11-14: 「他現在又開始不講任何進度了…不然我其實不太知道它目前的進度，我可能會覺得它是不是當機了」. A member's task of
37 minutes and 71 calls wrote 142 steps and not one message. Two minutes into a run with no message, then five minutes
after the last, the next tool result asks for a two-sentence update, and what the member says next is a message, not
progress in the folded work. The clock is the test's: no test waits.
"""

import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.progress_updates import FIRST_UPDATE_S, IN_MESSAGES, NEXT_UPDATE_S, ProgressUpdates
from raphael_core.messaging.words import plain_replies
from raphael_core.worker.loop import ToolOutcome
from .test_narration import chat, typed
from .test_service import make_rig  # noqa: F401

ASKED = "since you last told the owner anything"


class Clock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now


def asked(text):
    return ASKED in text


def minutes(text):
    return int(text.split("It has been ", 1)[1].split(" minutes", 1)[0])


# --- the clock -----------------------------------------------------------------------------------------------------


def test_the_first_word_is_owed_after_two_minutes_and_the_next_five_minutes_after_the_last():
    assert (FIRST_UPDATE_S, NEXT_UPDATE_S) == (120.0, 300.0)
    clock = Clock()
    updates = ProgressUpdates(clock)
    clock.now += 119
    assert not updates.due() and updates.reminder() == ""
    clock.now += 1
    assert updates.due() and minutes(updates.reminder()) == 2
    # One reminder at a time: one nobody answered is said again only after another five minutes.
    clock.now += 299
    assert updates.due() and updates.reminder() == ""
    clock.now += 1
    assert minutes(updates.reminder()) == 7
    updates.shown()
    assert not updates.due()
    clock.now += 299
    assert updates.reminder() == ""
    clock.now += 1
    assert minutes(updates.reminder(IN_MESSAGES)) == 5 and updates.reminder() == ""


def test_a_run_that_told_the_owner_something_lately_is_asked_for_nothing():
    clock = Clock()
    updates = ProgressUpdates(clock)
    clock.now += 100
    updates.shown()  # the opening, say
    clock.now += 150  # four minutes into the run, two and a half after the message
    assert not updates.due() and updates.reminder() == ""
    updates.restart()  # the owner answered a card: the run starts again
    clock.now += 119
    assert updates.reminder() == ""


# --- a CLI brain ----------------------------------------------------------------------------------------------------


def cli_run(monkeypatch, tmp_path, steps, final="The summary is ready.", *, opening=None):
    """A CLI turn whose steps (`steps`: what it says before a step, and how long the step takes) go through the loop's own
    MCP callback, on the test's clock. Returns what the loop's results said, the messages and the progress lines."""
    clock = Clock()
    seen = SimpleNamespace(results=[], said=[], progress=[])

    async def execute(identifier, name, arguments):
        clock.now += steps[int(identifier)][1]
        return ToolOutcome(True, content=f"note {identifier} read")

    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=tmp_path), sessions=None, member_id=5,
                       model="cli:claude:fake", ledger=None, language="en", plain=True, system="",
                       user="Summarize the notes", tools=[], progress=seen.progress.append, thinking=lambda text: None,
                       event=lambda text: None, execute=execute, reply=lambda reply: seen.said.extend(reply.messages),
                       updates=ProgressUpdates(clock))

    class FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            if opening:
                yield Event("text_delta", opening + "\n<<<next message>>>\n")
                yield Event("message", opening + "\n<<<next message>>>\n")
            for index, (speech, _) in enumerate(steps):
                if speech:  # plain words between steps, as Claude Code and Codex write them
                    yield Event("text_delta", speech)
                    yield Event("message", speech)
                yield Event("tool_start", data={"id": str(index), "name": "mcp__raphael__notes_look"})
                seen.results.append((await loop._tool(str(index), "notes_look", {})).content)
                yield Event("tool_end", data={"id": str(index), "ok": True})
            yield Event("message", final, data={"id": "answer", "final": True})
            yield Event("final", final)

    async def work():
        await loop._attempt("claude", ["fake"], "fake", SimpleNamespace(url="unused", token="fake", computer_url=None),
                            None, tmp_path)

    monkeypatch.setattr(cli, "Driver", FakeDriver)
    monkeypatch.setattr(loop, "_work", work)
    return loop, seen


async def test_a_cli_turn_is_asked_for_a_word_at_two_minutes_then_five_and_its_update_is_a_message(monkeypatch, tmp_path):
    steps = [("I will read the notes one by one.", 50), ("The first note is read.", 50), ("The second note is read.", 50),
             ("Three notes are read. Next I compare them with the plan.", 50), ("Comparing the fourth.", 100),
             ("Comparing the fifth.", 100), ("Comparing the sixth.", 100),
             ("Six notes are compared. Next I write the summary.", 10)]
    loop, seen = cli_run(monkeypatch, tmp_path, steps)
    outcome = await loop.run()
    assert outcome.status == "done"
    asked_at = [index for index, text in enumerate(seen.results) if asked(text)]
    # 150 s into the run (the first result past two minutes), then 350 s after the update (the first past five).
    assert asked_at == [2, 6]
    assert minutes(seen.results[2]) == 2 and minutes(seen.results[6]) == 5
    # After the result, outside the data it wraps; the records of the turn keep the result as it came.
    assert seen.results[2].index("note 2 read") < seen.results[2].index("It has been")
    assert seen.results[2].index("</") < seen.results[2].index("It has been")
    kept = json.dumps([loop.tool_messages, loop._receipts], ensure_ascii=False)
    assert ASKED not in kept and "note 2 read" in kept
    assert seen.said == ["Three notes are read. Next I compare them with the plan.",
                         "Six notes are compared. Next I write the summary.", "The summary is ready."]
    for line in ("I will read the notes one by one.", "The first note is read.", "The second note is read.",
                 "Comparing the fourth.", "Comparing the sixth."):
        assert line in seen.progress
    assert not any("Next I" in line for line in seen.progress)


async def test_a_reminder_nobody_answered_comes_again_only_after_five_minutes(monkeypatch, tmp_path):
    loop, seen = cli_run(monkeypatch, tmp_path, [("", 60)] * 10)
    await loop.run()
    # Results at 60, 120, …, 600 s: asked at 120, 420 (300 later); 600 is not five minutes after 420.
    assert [index for index, text in enumerate(seen.results) if asked(text)] == [1, 6]
    assert seen.said == ["The summary is ready."]


async def test_a_cli_turn_whose_opening_was_shown_lately_is_asked_for_nothing_yet(monkeypatch, tmp_path):
    loop, seen = cli_run(monkeypatch, tmp_path, [("", 100), ("Reading on.", 100), ("", 90)],
                         opening="I will read every note, then write the summary.")
    await loop.run()
    # The opening counts: 290 s after it, nothing is owed, and what it said meanwhile stays progress.
    assert not any(asked(text) for text in seen.results)
    assert seen.said == ["I will read every note, then write the summary.", "The summary is ready."]
    assert "Reading on." in seen.progress


async def test_a_turn_with_no_clock_never_asks(monkeypatch, tmp_path):
    loop, seen = cli_run(monkeypatch, tmp_path, [("Reading.", 200), ("Still reading.", 200)])
    loop.updates = None  # a meeting's reply, a routine, a greeting
    await loop.run()
    assert not any(asked(text) for text in seen.results)
    assert seen.said == ["The summary is ready."] and "Still reading." in seen.progress


# --- a conversation turn, through the service ----------------------------------------------------------------------


def replies(rig):
    return plain_replies([row[0] for row in rig.conn.execute(
        "SELECT text FROM agent_messages WHERE kind='reply' ORDER BY turn_id,seq")])


def progress(rig):
    return [row[0] for row in rig.conn.execute("SELECT text FROM agent_messages WHERE kind='progress' ORDER BY seq")]


def kept_results(rig):
    return " ".join(row[0] or "" for row in rig.conn.execute("SELECT redacted_result FROM turn_tool_events"))


@pytest.mark.parametrize("brain", ["claude", "codex"])
async def test_a_cli_conversation_turn_gets_the_reminder_and_shows_its_update(make_rig, monkeypatch, brain):
    rig = make_rig()
    rig.settings.set("agent_model", f"cli:{brain}:fake")
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    steps = [("I will check the time a few times.", 70), ("The first reading is in.", 70),
             ("Two readings are in. Next I compare them.", 30)]
    results = []

    async def run(driver, **kwargs):
        [loop] = rig.service._cli_loops
        for index, (speech, seconds) in enumerate(steps):
            yield Event("text_delta", speech)
            yield Event("message", speech, data={"id": f"said-{index}"})
            yield Event("tool_start", data={"id": str(index), "name": "local_time"})
            rig.clock.now += seconds
            results.append((await loop._tool(f"call-{index}", "local_time", {})).content)
            yield Event("tool_end", data={"id": str(index), "ok": True})
        yield Event("message", "Both readings agree.", data={"id": "answer", "final": True})
        yield Event("final", "Both readings agree.")

    monkeypatch.setattr(cli.Driver, "run", run)
    await typed(rig)
    assert [asked(text) for text in results] == [False, True, False]
    assert replies(rig) == ["Two readings are in. Next I compare them.", "Both readings agree."]
    assert any("first reading" in line for line in progress(rig))
    assert not any("compare them" in line for line in progress(rig))
    assert kept_results(rig) and ASKED not in kept_results(rig)


async def test_an_api_conversation_turn_is_asked_for_an_update_in_messages(make_rig, client):
    rig = make_rig()
    update = "Two readings are in. Next I compare them with the calendar."

    def step(at, *, progress_line="Checking the time.", messages=None, reminded=False):
        def answer(**kwargs):
            last = kwargs["messages"][-1]
            if last.get("role") == "tool":
                assert asked(last["content"]) is reminded
                if reminded:
                    assert last["content"].endswith(IN_MESSAGES)
            rig.clock.now = at
            body = {"progress": progress_line, **({"messages": messages} if messages else {})}
            return chat(json.dumps(body), ("local_time", {}))
        return answer

    def final(**kwargs):
        assert asked(kwargs["messages"][-1]["content"]) and minutes(kwargs["messages"][-1]["content"]) == 5
        return chat(json.dumps({"prefix": "Answer", "text": "Both readings agree.", "detail": ""}))

    client.chats = [step(1060), step(1130, progress_line="Checking it again."),
                    step(1130, messages=[update], reminded=True), step(1300), step(1431), final]
    result = await typed(rig)
    assert result["text"] == "Both readings agree."
    assert replies(rig) == [update, "Both readings agree."]
    assert any("Checking it again." in line for line in progress(rig))
    assert not any("compare them" in line for line in progress(rig))
    assert kept_results(rig) and ASKED not in kept_results(rig)
    assert "update a reminder asks for" in client.chat_calls[0]["messages"][0]["content"]
