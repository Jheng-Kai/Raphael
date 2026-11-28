"""What a member says while it works is in the owner's language (R-LANG-05).

A CLI brain writes notes of its own between its tool calls, and a member on one (brain
cli:claude) posted them in English ("The popover helper already supports submenus...") to an owner who writes Chinese: a
message here, a progress line there. The owner's language is read from their own words, never from the interface, and a
CLI is told that every text it writes is in it; a note that still comes out in another language is not shown (the step it
came with keeps its label).
"""

from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.agent.progress_updates import ProgressUpdates
from raphael_core.conversation_language import detect_language, in_language
from raphael_core.messaging.words import plain_replies
from raphael_core.worker.loop import ToolOutcome
from .test_service import make_rig  # noqa: F401

ENGLISH = ("The popover helper already supports submenus (placement: \"beside\"), which is exactly the pops out to the right "
           "behavior Alex described. Checking how existing code closes just the submenu.")
ENGLISH_OPENING = "I will read the notes first."
CHINESE_OPENING = "我先把筆記讀過一遍"
CHINESE = "選單的做法已經有了，我接著改關閉的部分"


# --- reading the language -------------------------------------------------------------------------------------------


def test_one_english_word_says_nothing_about_the_owners_language_but_a_chinese_message_does():
    assert detect_language("continue") == "en"  # the guess, for callers that must pick one
    assert detect_language("continue", firm=True) is None
    assert detect_language("ok", firm=True) is None and detect_language("src/ui.ts", firm=True) is None
    assert detect_language("繼續做，測試完告訴我", firm=True) == "zh-TW"
    assert detect_language("please check that the build is fine and tell me", firm=True) == "en"


@pytest.mark.parametrize("language,text,fits", [
    ("zh-TW", ENGLISH, False),
    ("zh-TW", ENGLISH_OPENING, False),
    ("zh-TW", CHINESE, True),
    ("zh-TW", "改好 languages.ts 了，接著跑測試", True),  # a Chinese line that names a file
    ("zh-TW", "`ui.ts`", True),  # no letters of any language to be wrong
    ("zh-TW", "12 / 18", True),
    ("zh-CN", ENGLISH, False),
    ("ja", ENGLISH, False),
    ("ja", "テストを実行します", True),
    ("ko", ENGLISH, False),
    ("ko", "테스트를 실행합니다", True),
    ("en", ENGLISH, True),
    ("en", CHINESE, False),
    ("en", "I will read the notes first, 小晴.", True),  # an English line that names the owner's word
    ("fr", ENGLISH, True),  # the Latin-script languages are one family: their words say too little to hide a line for
    (None, ENGLISH, True),  # no language known, nothing held back
    ("xx", ENGLISH, True),
])
def test_a_line_is_in_the_owners_language_when_it_is_mostly_in_its_script(language, text, fits):
    assert in_language(text, language) is fits


def test_a_cli_is_told_plainly_that_every_text_it_writes_is_in_the_owners_language():
    named = cli.language_rule("zh-TW")
    assert "including each note between tool calls" in named and "Traditional Chinese" in named
    assert "unless your persona or the owner specifies another language" in named
    assert "Use the reply-language rule" in cli.language_rule(None)
    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=None), sessions=None, member_id=5, model="cli:claude:fake",
                       ledger=None, language="en", plain=True, system="", user="x", tools=[], progress=print,
                       thinking=lambda text: None, event=lambda text: None, execute=None, owner_language="zh-TW")
    assert named in loop.system


def test_a_cli_hands_work_to_a_colleague_only_with_raphaels_handoff():
    # Codex 0.167 has sub-agent tools of its own whatever its feature flags say; asked to hand work on, a member called
    # followup_task with the colleague's name, Codex refused it, and nothing was handed on (live S03, 0 of 6 before this line).
    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=None), sessions=None, member_id=5, model="cli:codex:fake",
                       ledger=None, language="en", plain=True, system="", user="x", tools=[], progress=print,
                       thinking=lambda text: None, event=lambda text: None, execute=None)
    assert "A colleague gets work only through handoff, parts of your job through delegate_task, never spawn_agent, followup_task" in loop.system


@pytest.mark.parametrize("model", ["cli:claude:fake", "cli:codex:fake", "cli:antigravity:fake"])
def test_every_cli_brain_is_told_the_same_way_to_hand_work_on(model):
    """Whatever the program, a colleague gets work only through `handoff` (a turn with a reply schema has no tools at all)."""
    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=None), sessions=None, member_id=5, model=model,
                       ledger=None, language="en", plain=True, system="", user="x", tools=[], progress=print,
                       thinking=lambda text: None, event=lambda text: None, execute=None)
    assert ("A colleague gets work only through handoff, parts of your job through delegate_task, never spawn_agent, followup_task "
            "or another sub-agent tool.") in loop.system


# --- the loop --------------------------------------------------------------------------------------------------------


def run_loop(monkeypatch, tmp_path, speeches, *, owner_language, final="整理好了", opening=None, clock=None):
    """A CLI turn that says `speeches` before its steps (one step after each) and then its answer; the loop's output."""
    seen = SimpleNamespace(progress=[], said=[], thinking=[])

    async def execute(identifier, name, arguments):
        if clock is not None:
            clock[0] += 200
        return ToolOutcome(True, content="read")

    loop = cli.CliLoop(brains=SimpleNamespace(environ={}, home=tmp_path), sessions=None, member_id=5, model="cli:claude:fake",
                       ledger=None, language="en", plain=True, system="", user="整理筆記", tools=[],
                       progress=seen.progress.append, thinking=seen.thinking.append, event=lambda text: None, execute=execute,
                       reply=lambda reply: seen.said.extend(reply.messages), owner_language=owner_language,
                       updates=ProgressUpdates(lambda: clock[0]) if clock is not None else None)

    class FakeDriver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            if opening:
                yield Event("text_delta", opening + "\n<<<next message>>>\n")
                yield Event("message", opening + "\n<<<next message>>>\n")
            for index, speech in enumerate(speeches):
                yield Event("text_delta", speech)
                yield Event("message", speech)
                yield Event("thinking", f"thinking {index}")
                yield Event("tool_start", data={"id": str(index), "name": "mcp__raphael__notes_look"})
                await loop._tool(str(index), "notes_look", {})
                yield Event("tool_end", data={"id": str(index), "ok": True})
            yield Event("message", final, data={"id": "answer", "final": True})
            yield Event("final", final)

    async def work():
        await loop._attempt("claude", ["fake"], "fake", SimpleNamespace(url="unused", token="fake", computer_url=None),
                            None, tmp_path)

    monkeypatch.setattr(cli, "Driver", FakeDriver)
    monkeypatch.setattr(loop, "_work", work)
    return loop, seen


async def test_a_note_between_tool_calls_in_another_language_is_not_shown_to_a_chinese_owner(monkeypatch, tmp_path):
    loop, seen = run_loop(monkeypatch, tmp_path, [ENGLISH, CHINESE, "Now editing languages.ts."], owner_language="zh-TW",
                          opening=ENGLISH_OPENING)
    outcome = await loop.run()
    assert outcome.status == "done"
    assert seen.progress == [CHINESE]  # the English notes show nothing: the steps keep their own labels
    assert seen.said == ["整理好了"]  # not even the English opening is shown as the message of the turn


async def test_the_opening_in_the_owners_language_still_stands_as_the_message_and_its_notes_as_progress(monkeypatch, tmp_path):
    loop, seen = run_loop(monkeypatch, tmp_path, [CHINESE, ENGLISH], owner_language="zh-TW", opening=CHINESE_OPENING)
    await loop.run()
    assert seen.said == [CHINESE_OPENING, "整理好了"] and seen.progress == [CHINESE]


async def test_the_word_that_is_owed_after_two_minutes_is_not_shown_when_it_is_in_another_language(monkeypatch, tmp_path):
    clock = [1000.0]
    loop, seen = run_loop(monkeypatch, tmp_path, ["Nothing yet.", ENGLISH, "還在整理，已經過了一半"], owner_language="zh-TW",
                          clock=clock)
    await loop.run()
    assert not any("popover" in line or "Nothing yet" in line for line in seen.said + seen.progress)
    assert seen.said[-1] == "整理好了" and "還在整理，已經過了一半" in seen.said + seen.progress


async def test_thinking_in_another_language_is_not_shown_either(monkeypatch, tmp_path):
    loop, seen = run_loop(monkeypatch, tmp_path, [CHINESE], owner_language="zh-TW")
    await loop.run()
    assert not any(line.isascii() and line.strip() for line in seen.thinking)


async def test_an_owner_whose_language_is_not_known_yet_holds_nothing_back(monkeypatch, tmp_path):
    loop, seen = run_loop(monkeypatch, tmp_path, [ENGLISH, CHINESE], owner_language=None)
    await loop.run()
    assert seen.progress == [ENGLISH, CHINESE]


async def test_an_english_owner_sees_english_notes(monkeypatch, tmp_path):
    loop, seen = run_loop(monkeypatch, tmp_path, [ENGLISH, CHINESE], owner_language="en", final="The notes are done.")
    await loop.run()
    assert seen.progress == [ENGLISH]
    assert seen.said == ["The notes are done."]


# --- a conversation turn, through the service ------------------------------------------------------------------------


def stored(rig, kind):
    return [row[0] for row in rig.conn.execute("SELECT text FROM agent_messages WHERE kind=? ORDER BY turn_id,seq", (kind,))]


async def ask(rig, text, session, ui_language="en"):
    return await rig.call("agent.ask", {"session_id": session, "text": text, "ui_language": ui_language, "source": "app",
                                        "member_id": 0})


@pytest.mark.parametrize("ui_language", ["en", "zh-TW"])
async def test_the_owners_words_decide_the_language_a_member_works_in_and_a_one_word_message_follows_them(
        make_rig, monkeypatch, ui_language):
    rig = make_rig()
    rig.settings.set("agent_model", "cli:claude:fake")
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    systems = []

    async def run(driver, **kwargs):
        [loop] = rig.service._cli_loops
        systems.append((loop.owner_language, loop.system))
        for index, speech in enumerate((ENGLISH, CHINESE)):
            yield Event("text_delta", speech)
            yield Event("message", speech, data={"id": f"said-{index}"})
            yield Event("tool_start", data={"id": str(index), "name": "local_time"})
            await loop._tool(f"call-{index}", "local_time", {})
            yield Event("tool_end", data={"id": str(index), "ok": True})
        yield Event("message", "做好了", data={"id": "answer", "final": True})
        yield Event("final", "做好了")

    monkeypatch.setattr(cli.Driver, "run", run)
    await ask(rig, "幫我看一下現在幾點，順便確認日期", "chinese", ui_language)
    await ask(rig, "continue", "one-word", ui_language)
    assert [language for language, _ in systems] == ["zh-TW", "zh-TW"]  # `continue` is no word of the owner's language
    assert all(cli.language_rule("zh-TW") in system for _, system in systems)
    assert all("popover" not in line for line in plain_replies(stored(rig, "reply")) + stored(rig, "progress"))
    assert any(CHINESE in line for line in stored(rig, "progress"))


# --- an API model's notes between its tool calls are held to the same language -----------------------------------------


def said_before_a_tool(progress, thinking, messages=()):
    import json
    return json.dumps({"thinking": thinking, "progress": progress, "messages": list(messages)}, ensure_ascii=False)


@pytest.mark.parametrize("ui_language", ["en", "zh-TW"])
async def test_an_api_models_notes_in_another_language_are_not_shown_to_a_chinese_owner_and_its_answer_still_is(
        make_rig, client, ui_language):
    import json
    from .conftest import decision
    from .test_narration import chat
    rig = make_rig()
    client.decisions.append(decision("answer", time=0.95))
    client.chats = [
        chat(said_before_a_tool("I am checking the time now", "The owner wants the time, so I read the clock first.",
                                [ENGLISH]), ("local_time", {})),
        chat(said_before_a_tool("我再確認一下日期", "時鐘讀到了，接著核對日期。", [CHINESE]), ("local_time", {})),
        chat(json.dumps({"prefix": "Answer", "text": "Here is the time.", "detail": ""})),
    ]
    await ask(rig, "幫我看一下現在幾點，順便確認日期", "api-chinese", ui_language)
    shown = stored(rig, "progress") + stored(rig, "thinking") + plain_replies(stored(rig, "reply"))
    assert not any(in_language(line, "zh-TW") is False and line != "Here is the time." for line in shown), shown
    assert any("我再確認一下日期" in line for line in stored(rig, "progress"))
    assert any(CHINESE in line for line in stored(rig, "reply"))
    assert any("Here is the time." in line for line in stored(rig, "reply"))  # the answer is never held back


async def test_an_english_owner_sees_an_api_models_english_notes(make_rig, client):
    import json
    from .conftest import decision
    from .test_narration import chat
    rig = make_rig()
    client.decisions.append(decision("answer", time=0.95))
    client.chats = [chat(said_before_a_tool("I am checking the time now", "I read the clock first."), ("local_time", {})),
                    chat(json.dumps({"prefix": "Answer", "text": "Done.", "detail": ""}))]
    await ask(rig, "Please check the time and tell me the date too", "api-english")
    assert any("I am checking the time now" in line for line in stored(rig, "progress"))
    assert any("I read the clock first." in line for line in stored(rig, "thinking"))
