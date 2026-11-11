"""The question card's shape: sub-line, described choices, several choices, skip, and what an ordinary message does to it."""
import pytest

from raphael_core.agent.harness_tools import ASK_OWNER, DEFINITIONS
from raphael_core.agent.owner_questions import answer_from_text, closed_by_message, model_result, question_input
from raphael_core.messaging.words import question_text

from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed
from .test_owner_questions import wired  # noqa: F401
from background.conftest import plugins, report, until  # noqa: F401

FULL = {"question": "What first?", "subtitle": "Pick the one that matters most.", "multiple": True, "skip": True,
        "options": ["Mail", {"label": "Calendar", "description": "Today and this week"}, {"label": "Notes"}]}


def test_every_new_field_is_accepted_and_kept_for_all_readers():
    assert question_input(FULL) == {
        "question": "What first?", "options": ["Mail", "Calendar", "Notes"], "free_text": True,
        "subtitle": "Pick the one that matters most.", "descriptions": ["", "Today and this week", ""],
        "multiple": True, "skip": True}
    # A card without the new fields is stored as it always was.
    assert question_input({"question": "Which day?", "options": ["Monday"]}) == {"question": "Which day?", "options": ["Monday"], "free_text": True}


@pytest.mark.parametrize("change", [
    {"subtitle": ""}, {"subtitle": "  "}, {"subtitle": 3}, {"subtitle": None}, {"subtitle": "x" * 121}, {"subtitle": "one\ntwo"},
    {"options": [{"label": "Mail", "colour": "red"}]}, {"options": [{"description": "no label"}]}, {"options": [{"label": ""}]},
    {"options": [{"label": "Mail", "description": ""}]}, {"options": [{"label": "Mail", "description": "x" * 121}]},
    {"options": [{"label": "Mail", "description": "two\nlines"}]}, {"options": [{"label": "x" * 81}]}, {"options": [3, "Mail"]},
    {"options": ["Mail", {"label": "Mail"}]}, {"options": ["a", "b", "c", "d", "e"]}, {"options": ["Mail"]},
    {"multiple": "yes"}, {"multiple": None}, {"skip": "yes"}, {"skip": 1},
])
def test_a_malformed_card_field_is_refused(change):
    with pytest.raises(ValueError):
        question_input({**FULL, **change})


def test_several_choices_need_at_least_two_rows_and_a_card_needs_something_to_answer_with():
    with pytest.raises(ValueError):
        question_input({"question": "Which?", "multiple": True, "options": ["Mail"]})
    with pytest.raises(ValueError):
        question_input({"question": "Which?", "multiple": True})
    with pytest.raises(ValueError):
        question_input({"question": "Which?", "skip": True, "free_text": False})
    assert question_input({"question": "Which?", "skip": True})["skip"] is True


def test_the_tool_definition_names_what_the_validator_reads():
    schema = DEFINITIONS[ASK_OWNER]["parameters"]["properties"]
    assert set(schema) == {"question", "subtitle", "options", "multiple", "skip", "free_text"}
    assert schema["subtitle"]["maxLength"] == 120 and schema["options"]["maxItems"] == 4
    row = schema["options"]["items"]["oneOf"][1]
    assert set(row["properties"]) == {"label", "description"} and row["required"] == ["label"]


async def test_a_malformed_card_in_a_real_turn_is_bad_arguments_and_opens_nothing(wired, client):
    agent, background = wired
    client.chats = [chat("Asking.", (ASK_OWNER, {"question": "Which?", "multiple": True, "options": ["Mail"]})), chat("Never mind.")]
    await typed(agent, "Plan my week")
    [turn] = await agent.turns()
    assert not turn.get("owner_questions") and "bad_arguments" in str(client.chat_calls[-1]["messages"])


async def ask_card(agent, client, **card):
    client.chats = [chat("I need to know.", (ASK_OWNER, {"question": "What first?", **card}))]
    await typed(agent, "Set me up")
    [turn] = await agent.turns()
    [question] = turn["owner_questions"]
    return turn, question


async def finish(background, question):
    await until(lambda: background.task(question["task_id"]).state in ("done", "failed", "limit"))
    assert background.task(question["task_id"]).state == "done"
    return background.client.chat_calls[-1]["messages"][-1]


async def test_the_card_reaches_the_app_with_every_field(wired, client):
    agent, _ = wired
    _, question = await ask_card(agent, client, **FULL)
    assert question["subtitle"] == "Pick the one that matters most." and question["descriptions"] == ["", "Today and this week", ""]
    assert question["multiple"] is True and question["skip"] is True and question["state"] == "asked"


async def test_several_chosen_rows_reach_the_resumed_turn_as_a_list(wired, client):
    agent, background = wired
    _, question = await ask_card(agent, client, **FULL)
    background.client.replies = [report("Mail and notes it is.")]
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": ["Mail", "Notes"]})
    told = await finish(background, question)
    assert told["role"] == "tool" and '"answer": ["Mail", "Notes"]' in told["content"]
    assert background.service.owner_questions.get(question["id"])["state"] == "answered"


async def test_chosen_rows_and_the_owners_own_words_make_one_list(wired, client):
    agent, background = wired
    _, question = await ask_card(agent, client, **FULL)
    background.client.replies = [report("Done.")]
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": ["Mail", "My bank"]})
    assert '"answer": ["Mail", "My bank"]' in (await finish(background, question))["content"]


@pytest.mark.parametrize("card,answer", [
    ({"options": ["Mail", "Notes"]}, ["Mail"]),
    ({**FULL, "free_text": False}, ["Mail", "Else"]),
    (FULL, []), (FULL, ["Mail", "Mail"]), (FULL, ["Mail", "A", "B"]), (FULL, ["Mail", 3]), (FULL, ["Mail", "  "]),
])
async def test_a_list_that_the_card_does_not_allow_is_refused_and_the_card_still_waits(wired, client, card, answer):
    agent, background = wired
    _, question = await ask_card(agent, client, **card)
    with pytest.raises(Exception):
        await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": answer})
    assert background.service.owner_questions.get(question["id"])["state"] == "asked"


async def test_a_skip_is_an_answer_and_the_member_is_told_so(wired, client):
    agent, background = wired
    _, question = await ask_card(agent, client, **FULL)
    background.client.replies = [report("Carrying on without it.")]
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "skip": True})
    told = await finish(background, question)
    assert '"skipped": true' in told["content"] and "do not ask it again" in told["content"] and "cancel" not in told["content"].lower()
    saved = background.service.owner_questions.get(question["id"])
    assert saved["state"] == "answered" and saved["result"] == {"state": "answered", "skipped": True}


async def test_a_card_without_a_skip_row_cannot_be_skipped(wired, client):
    agent, background = wired
    _, question = await ask_card(agent, client, options=["Mail", "Notes"])
    with pytest.raises(Exception):
        await background.rpc.call("owner_questions.answer", {"id": question["id"], "skip": True})
    with pytest.raises(Exception):
        await background.rpc.call("owner_questions.answer", {"id": question["id"], "skip": "yes"})
    assert background.service.owner_questions.get(question["id"])["state"] == "asked"


async def test_an_ordinary_message_closes_the_waiting_card_and_the_member_is_told(wired, client):
    agent, background = wired
    turn, question = await ask_card(agent, client, **FULL)
    client.chats = [chat("Lunch is at noon.")]
    background.client.replies = [report("Left the question for later.")]
    await typed(agent, "When is lunch?")
    told = await finish(background, question)
    saved = background.service.owner_questions.get(question["id"])
    assert saved["state"] == "cancelled" and saved["result"] == closed_by_message("When is lunch?")
    assert "unanswered" in told["content"] and "When is lunch?" in told["content"]
    page = await agent.rpc.call("agent.history.list", {"limit": 5})
    assert page["pending_questions"] == []
    # The message itself was answered as an ordinary message, in a turn of its own.
    assert any(item["question"] == "When is lunch?" and "Lunch is at noon." in item["text"] for item in await agent.turns())
    assert turn["id"] in [item["id"] for item in await agent.turns()]


async def test_the_closed_card_is_not_closed_again_and_a_new_question_can_be_open(wired, client):
    agent, background = wired
    _, question = await ask_card(agent, client, options=["Mail", "Notes"])
    client.chats = [chat("Fine."), chat("Fine again.")]
    background.client.replies = [report("Ok.")]
    await typed(agent, "First thing")
    await finish(background, question)
    await typed(agent, "Second thing")
    assert background.service.owner_questions.get(question["id"])["result"]["said"] == "First thing"


async def test_a_quick_question_in_the_other_conversation_leaves_the_card_waiting(wired, client):
    agent, background = wired
    _, question = await ask_card(agent, client, options=["Mail", "Notes"])
    client.chats = [chat("Hello.")]
    await agent.call("agent.ask", {"session_id": "quick-one", "text": "Hi there", "ui_language": "en", "source": "overlay", "destination": "quick"})
    assert background.service.owner_questions.get(question["id"])["state"] == "asked"


@pytest.mark.parametrize("text,answer", [("A, C", ["Mail", "Notes"]), ("b", ["Calendar"]), ("mail and notes", ["Mail", "Notes"]),
                                         ("Calendar", ["Calendar"]), ("skip", None), ("something else entirely", ["something else entirely"])])
async def test_a_chat_reply_that_names_the_choices_is_the_answer(wired, client, text, answer):
    agent, background = wired
    _, question = await ask_card(agent, client, **FULL)
    background.client.replies = [report("Got it.")]
    reply = await agent.call("agent.ask", {"session_id": "tg-reply", "text": text, "ui_language": "en", "source": "telegram"})
    assert reply["steered"] is True and reply["text"] == ""
    await finish(background, question)
    saved = background.service.owner_questions.get(question["id"])["result"]
    assert saved == ({"state": "answered", "skipped": True} if answer is None else {"state": "answered", "answer": answer})


async def test_a_chat_reply_to_a_card_that_takes_no_words_of_its_own_closes_it(wired, client):
    agent, background = wired
    _, question = await ask_card(agent, client, options=["Mail", "Notes"], free_text=False)
    client.chats = [chat("Sure.")]
    background.client.replies = [report("Ok.")]
    await agent.call("agent.ask", {"session_id": "tg-other", "text": "what time is it", "ui_language": "en", "source": "telegram"})
    await finish(background, question)
    assert background.service.owner_questions.get(question["id"])["result"]["by"] == "message"


def test_answers_typed_in_a_chat_are_read_by_the_cards_own_rules():
    single = {"options": ["Mail", "Notes"], "free_text": False}
    assert answer_from_text(single, "B") == {"state": "answered", "answer": "Notes"}
    assert answer_from_text(single, "A and B") is None and answer_from_text(single, "hello") is None and answer_from_text(single, "E") is None
    assert answer_from_text({**single, "multiple": True}, "A、B") == {"state": "answered", "answer": ["Mail", "Notes"]}
    assert answer_from_text({**single, "skip": True}, "略過") == {"state": "answered", "skipped": True}
    assert answer_from_text(single, "skip") is None and answer_from_text(single, "   ") is None


def test_what_the_member_is_told_names_the_owners_own_words():
    assert model_result({"state": "answered", "answer": "Mail"}) == {"state": "answered", "answer": "Mail"}
    told = model_result(closed_by_message("  Not now, check my calendar "))
    assert told["unanswered"] is True and told["owner_said_instead"] == "Not now, check my calendar"
    assert model_result({"state": "answered", "skipped": True})["skipped"] is True


def test_a_card_written_for_a_chat_has_its_lettered_rows_hints_and_skip():
    written = question_text("en", question_input(FULL))
    assert written.splitlines() == [
        "What first?", "Pick the one that matters most.", "", "A. Mail", "B. Calendar — Today and this week", "C. Notes", "",
        "Choose all that apply: reply with letters, for example A, C.", "Reply \"skip\" to skip it.", "Or write your own answer."]
    plain = question_text("zh-TW", question_input({"question": "哪一天？", "options": ["週一", "週二"], "free_text": False}))
    assert plain.splitlines() == ["哪一天？", "", "A. 週一", "B. 週二", "", "回覆選項字母（例如 A）。"]
    assert question_text("fr", question_input({"question": "Q?"})) == "Q?"


async def test_the_card_that_waits_in_a_room_thread_is_closed_by_what_the_owner_writes(wired, client):
    agent, background = wired
    with agent.conn:
        room_id = agent.conn.execute("INSERT INTO rooms(name,created) VALUES ('Scheduling',0)").lastrowid
    origin = agent.history.add(session_id="room-q", question="Arrange a visit", route="delegate", prefix="", text="", status="running",
                               scope="room", room_id=room_id, thread_id=room_id)
    task_id = background.submit()
    background.service.attach_turn(task_id, origin)
    opened = background.service.owner_questions.open(background.task(task_id), "ask_owner", question_input(FULL))
    other = background.service.owner_questions.close_for_message(said="elsewhere", room_id=room_id, thread_id=room_id + 1)
    assert other is False and background.service.owner_questions.get(opened["id"])["state"] == "asked"
    background.service.owner_questions.close_for_message(said="Let us talk first", room_id=room_id, thread_id=room_id)
    assert background.service.owner_questions.get(opened["id"])["result"] == closed_by_message("Let us talk first")
