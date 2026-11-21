"""Whatever shape a model's output takes, the owner reads its words and never the protocol (R-TEXT-11).

One table of shapes meets every path that turns model output into words the owner sees: the reply of an API model,
the ChatGPT sign-in path and a CLI that writes structured replies (`parse_reply`), speech while a turn works
(`public_reply`), a progress or thinking line (`public_line`), a CLI that writes its reply as words (`literal`) and a whole
turn through the request API, both as the final answer and beside a tool call. A new path that turns output into a message
belongs in `PATHS` below: the table then runs it against every shape."""
import json

import pytest

from raphael_core.agent.answers import AgentFailure, parse_reply, public_reply
from raphael_core.background.service import report_from
from raphael_core.brain.textnorm import public_line
from .conftest import decision
from .test_narration import chat, typed
from .test_service import make_rig  # noqa: F401

REPORT = "Checked all three members.\n\n### 1. The daily reminder\n\n- It is off"
EARLY = "All three are checked."
STEP = "Putting the results together"


def obj(**fields):
    return json.dumps(fields, ensure_ascii=False)


PROGRESS = obj(thinking="Records checked", progress=STEP, messages=[EARLY])
FINAL = obj(text=REPORT, messages=[REPORT], memory=[], need={})
BOTH = f"{EARLY}\n\n{REPORT}"
BACKSLASH_N = chr(92) + "n"

FAILS = None  # the turn fails: the owner is told it failed, never shown the output
WRITTEN = "written"  # a CLI that writes words shows what it wrote: authored JSON stays as it is


class Authored(str):
    """Words that are JSON an author put in a reply: shown as they are, by a path that reads no protocol out of words."""

# name -> (what a model wrote, what the owner reads from an API model, what the owner reads from a CLI that writes words)
SHAPES = {
    "one object": (FINAL, REPORT, REPORT),
    "progress object, then the reply, nothing between": (PROGRESS + FINAL, BOTH, BOTH),
    "progress object, blank line, the reply": (PROGRESS + "\n\n" + FINAL, BOTH, BOTH),
    "two progress objects, then the reply": (PROGRESS + PROGRESS + FINAL, f"{EARLY}\n\n{EARLY}\n\n{REPORT}", f"{EARLY}\n\n{EARLY}\n\n{REPORT}"),
    "the reply object, then words": (FINAL + "\nThanks!", f"{REPORT}\n\nThanks!", WRITTEN),
    "words, then the reply object": ("Here you go:\n" + FINAL, f"Here you go:\n\n{REPORT}", WRITTEN),
    "a progress object, then words": (PROGRESS + "\nDone.", f"{EARLY}\n\nDone.", WRITTEN),
    "a progress object, then words on its line": (PROGRESS + " and the answer is 42", f"{EARLY}\n\nand the answer is 42", WRITTEN),
    "the reply in a code block": ("```json\n" + FINAL + "\n```", REPORT, REPORT),
    "both objects in one code block": ("```json\n" + PROGRESS + FINAL + "\n```", BOTH, BOTH),
    "an object in a code block each": ("```json\n" + PROGRESS + "\n```\n```json\n" + FINAL + "\n```", BOTH, WRITTEN),
    "words, then the reply in a code block": ("Here you go:\n```json\n" + FINAL + "\n```", f"Here you go:\n\n{REPORT}", WRITTEN),
    "the reply in a code block, then words": ("```json\n" + FINAL + "\n```\nThanks", f"{REPORT}\n\nThanks", WRITTEN),
    "the reply cut off": (FINAL[:40], "Checked all three members.", "Checked all three members."),
    # What stood before a cut object is the answer with a broken tail; a turn fails only when nothing stands before it.
    # A cut object is forgiven only when plain words written outside any object stand before it. Objects alone before it are
    # progress, and the answer is missing, whatever they said.
    "a progress object that said something, then the reply cut off": (PROGRESS + FINAL[:40], FAILS, WRITTEN),
    "a progress object with no message, then the reply cut off": (obj(thinking="t", progress="p") + FINAL[:40], FAILS, WRITTEN),
    "a progress object, words, then the reply cut off": (
        PROGRESS + "\nA clean answer.\n" + '{"text": "unfinished', f"{EARLY}\n\nA clean answer.", WRITTEN),
    "words, then the reply cut off": ("Here you go:\n" + FINAL[:40], "Here you go:", WRITTEN),
    "words, then a cut object of fields": ('A clean answer.\n{"text": "unfinished', "A clean answer.", WRITTEN),
    # Objects at the start, words, then objects that end the text are one reply: what the earlier objects said, the words,
    # what the last object says.
    "a progress object, words, then the reply object": (
        obj(thinking="Check the example.") + "\nDuplicate prose.\n" + obj(text="A clean answer."),
        "Duplicate prose.\n\nA clean answer.", WRITTEN),
    "a message, words, then the reply object": (
        obj(thinking="t", messages=["First."]) + "\nBetween.\n" + obj(text="Last."), "First.\n\nBetween.\n\nLast.", WRITTEN),
    # An object with none of the protocol's fields is the member's own content: it stays where it stands.
    "a progress object, words, then an object of the member's own": (
        obj(thinking="Check the example.") + '\nA clean answer.\n{"metadata":{"ignored":true}}',
        'A clean answer.\n{"metadata":{"ignored":true}}', WRITTEN),
    "progress objects with words between, and no reply": (
        "```json\n" + obj(thinking="One.", progress="Two.") + "\n```\nDuplicate prose.\n" + obj(thinking="Three.", progress="Four."),
        "Duplicate prose.", WRITTEN),
    "an array": ("[" + FINAL + "]", FAILS, WRITTEN),
    "a reply with fields of its own": (obj(text="hi", say_ja="やあ"), "hi", WRITTEN),
    "words that hold an object": (obj(text='Use {"a": 1} here'), 'Use {"a": 1} here', 'Use {"a": 1} here'),
    "the reply as the text of a reply": (obj(text=FINAL), REPORT, Authored(FINAL)),
    "both objects as the text of a reply": (obj(text=PROGRESS + FINAL), BOTH, Authored(PROGRESS + FINAL)),
    "both objects as one message": (obj(messages=[PROGRESS + FINAL]), BOTH, Authored(PROGRESS + FINAL)),
    "the reply written as a string": (json.dumps(FINAL), REPORT, WRITTEN),
    "a line break written out in the object": ('{"text":"a' + BACKSLASH_N + 'b"}', "a\nb", "a\nb"),
    "a line break typed in the object": ('{"text":"a\nb"}', "a\nb", "a\nb"),
    "no text, two messages": (obj(text="", messages=["One.", "Two."]), "One.\n\nTwo.", "One.\n\nTwo."),
    "messages with empty strings": (obj(text="x", messages=["", "  "]), "x", "x"),
    "a progress object that has messages": (PROGRESS, EARLY, EARLY),
    "a progress object that has none": (obj(thinking="t", progress="p"), FAILS, WRITTEN),
    "an object that lost its braces": ('"text": "hi", "messages": ["hi"]}', "hi", WRITTEN),
}


def leaks(words: str) -> bool:
    """Whether words show the protocol: an object where the words should be, its fields, or its line breaks written out."""
    shown = words.strip()
    return (shown.startswith(("{", "[", '"{', "```json")) and '"' in shown or BACKSLASH_N in words
            or any(f'"{field}"' in words for field in ("thinking", "progress", "memory", "need")))


def read(call):
    try:
        return call().text
    except AgentFailure:
        return FAILS


def parsed(raw, **kwargs):
    return lambda: parse_reply(raw, "en", long=True, **kwargs)


# Each path: what it returns for a model's output, and which column of SHAPES says what the owner reads from it.
PATHS = {
    "reply, Raphael": (lambda raw: read(parsed(raw)), 1),
    "reply, a member": (lambda raw: read(parsed(raw, plain=True)), 1),
    "speech, whole": (lambda raw: (reply.text if (reply := public_reply(raw, "en", plain=True)) else FAILS), 1),
    "CLI, written reply": (lambda raw: read(parsed(raw, plain=True, literal=True)), 2),
    "background report": (lambda raw: (report.text if (report := report_from(raw, "en", plain=True, long=True)) else FAILS), 1),
    "background report, a member's CLI": (
        lambda raw: (report.text if (report := report_from(raw, "en", plain=True, long=True, literal=True)) else FAILS), 2),
}


@pytest.mark.parametrize("path", PATHS)
@pytest.mark.parametrize("shape", SHAPES)
def test_every_shape_reads_the_same_on_every_path_that_makes_a_reply(shape, path):
    raw, *reads = SHAPES[shape]
    run, column = PATHS[path]
    shown = run(raw)
    expected = reads[column - 1]
    if path == "speech, whole" and shape == "the reply cut off":
        expected = FAILS  # an unfinished live message is still withheld
    if expected == WRITTEN:
        assert shown == raw.strip()  # authored words on a path that does not read protocol out of words
    else:
        assert shown == expected
        assert shown is FAILS or isinstance(expected, Authored) or not leaks(shown)


@pytest.mark.parametrize("shape", SHAPES)
def test_speech_while_a_turn_works_never_shows_the_protocol(shape):
    raw = SHAPES[shape][0]
    for explicit in (False, True):
        reply = public_reply(raw, "en", plain=True, explicit=explicit)
        assert reply is None or not any(leaks(message) for message in [reply.text, *reply.messages])


@pytest.mark.parametrize("language", ["auto", "zh-TW", "ja", "en"])
@pytest.mark.parametrize("shape", SHAPES)
def test_a_progress_or_thinking_line_never_shows_the_protocol(shape, language):
    line = public_line(SHAPES[shape][0], language)
    assert not leaks(line) and "{" not in line and "}" not in line


def test_the_last_progress_object_and_the_reply_object_are_two_messages_and_no_braces():
    """What the owner saw: the final answer was the last progress object followed by the reply object."""
    reply = parse_reply(PROGRESS + FINAL, "en", long=True)
    assert reply.messages == [EARLY, REPORT]
    assert reply.text == BOTH and reply.detail is None
    assert not leaks(reply.text)


async def phase(rig, client, model_output, *, beside_a_tool):
    client.decisions.append(decision("answer", time=0.95))
    final = obj(prefix="Answer", text="Done.", detail="")
    client.chats = [chat(model_output, ("local_time", {})), chat(final)] if beside_a_tool else [chat(model_output)]
    result = await typed(rig, "Check the members")
    [turn] = await rig.turns()
    return result, turn


@pytest.mark.parametrize("beside_a_tool", [False, True], ids=["final answer", "beside a tool call"])
@pytest.mark.parametrize("shape", SHAPES)
async def test_a_whole_turn_stores_no_protocol_whatever_the_model_wrote(make_rig, client, shape, beside_a_tool):
    rig = make_rig()
    _, turn = await phase(rig, client, SHAPES[shape][0], beside_a_tool=beside_a_tool)
    for message in turn["messages"]:
        if message["kind"] in ("progress", "thinking", "reply"):
            assert not leaks(message["text"].replace("《Answer. ", "").removesuffix("》")), (shape, message)
    assert not leaks(turn["text"] or "")
    if not beside_a_tool and SHAPES[shape][1] is not FAILS:
        assert turn["status"] == "done"
        assert BOTH in turn["text"] or SHAPES[shape][1] in turn["text"]


async def test_a_whole_turn_whose_last_words_are_a_progress_object_and_the_reply_object_shows_both_as_words(make_rig, client):
    rig = make_rig()
    result, turn = await phase(rig, client, PROGRESS + FINAL, beside_a_tool=False)
    replies = [message["text"] for message in turn["messages"] if message["kind"] == "reply"]
    assert [reply.removeprefix("《Answer. ").removesuffix("》") for reply in replies] == [EARLY, REPORT] or replies == [f"《Answer. {BOTH}》"]
    assert result["status"] == "done" and not leaks(result["text"])


@pytest.mark.parametrize("brain", ["codex", "claude"])
@pytest.mark.parametrize("ends", ["whole", "cut"])
async def test_a_reply_that_streams_in_is_never_stored_or_told_as_a_part_of_an_object(make_rig, monkeypatch, tmp_path, brain, ends):
    """Nothing is drawn from a reply while it is received: only what the loop has made of a whole message is stored, and the
    stored words never show a part of an object, at any point of the stream, on a CLI that writes the objects."""
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Event
    brains = CliBrains(home=tmp_path, environ={}, commands={brain: ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    full = PROGRESS + FINAL
    pieces = [full[start:start + 23] for start in range(0, len(full), 23)]
    seen, told = [], []

    async def run(driver, **kwargs):
        stored = lambda: [row[0] for row in rig.service._conn.execute("SELECT text FROM agent_messages WHERE kind IN ('progress','reply','thinking')")]
        for piece in pieces if ends == "whole" else pieces[:-2]:
            yield Event("text_delta", piece)
            seen.extend(stored())
        if ends == "whole":
            yield Event("final", full)

    monkeypatch.setattr("raphael_core.agent.cli.loop.Driver.run", run)
    rig = make_rig(cli_brains=brains, notify=lambda method, data: told.append((method, data)))
    rig.settings.set("agent_model", f"cli:{brain}:test")
    await rig.call("agent.ask", {"session_id": "stream", "text": "Check the members", "ui_language": "en", "source": "app",
                                 "member_id": 0})
    final = [row[0] for row in rig.service._conn.execute("SELECT text FROM agent_messages WHERE kind IN ('progress','reply','thinking')")]
    for text in [*seen, *final, *(data.get("text", "") for method, data in told if method == "agent.progress")]:
        assert not leaks(text.replace("《Answer. ", "").removesuffix("》")), text
    if ends == "whole":
        assert any(REPORT in text for text in final)
