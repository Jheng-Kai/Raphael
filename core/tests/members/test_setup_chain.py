"""A new member sets itself up by cards, one step at a time (R-COLLEAGUE-02, R-JOB-01).

The greeting is the member's own line with one question card; the owner's answer starts a turn of its own in which the
member saves its job, connects the one missing app, asks which first task and starts it. Fake brains only: the API one
is scripted, the CLI one is a driver that speaks to the member's MCP server as a native CLI does.
"""
import asyncio
import json

import httpx
import pytest

from agent.conftest import FakeActions
from agent.test_narration import chat, use
from agent.test_service import Rig
from background.conftest import Rig as BackgroundRig, plugins, report, until  # noqa: F401
from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.protocol import INVALID_PARAMS, RpcError
from .test_answering import Team, client, live_said  # noqa: F401

FIRST_CARD = {"question": "What should I take on first?", "options": ["Mail", "Schedule and reminders", "Research"], "free_text": True}
TASK_CARD = {"question": "Which first task?", "options": ["Sort today's mail", "Draft replies"], "free_text": True}
ANSWER = "Mail: keep my inbox answered every day"


@pytest.fixture
async def chain(conn, tmp_path, client, plugins):
    """The agent with a real background worker for its cards, and the members' service for the team."""
    team = Team(conn, tmp_path)
    background = BackgroundRig(conn, plugins)
    rig = Rig(conn, client, FakeActions(), team=team.members, memory=team.memory, background=background.service,
              plugins=plugins.hub, gate=background.gate)
    rig.settings.set("worker_cost_cap_usd", 1.0)
    background.service.use_team(team.members, rig.service.team_tool)
    background.service.use_owner_tools(rig.service.background_owner_tool)
    background.service.owner_questions.on_cancel = rig.service.cancel_owner_card
    team.members.register(rig.rpc)
    rig.background, rig.team = background, team
    yield rig
    await rig.aclose()
    await background.close()
    await team.memory.aclose()


async def greet(rig, client, *, name="Mia", line="Hi, I'm Mia, your new colleague.", card=FIRST_CARD, language="en", **fields):
    """Make a member whose model greets with `line` and the question card; the member and its greeting turn."""
    client.chats.append(chat(line, ("ask_owner", card)))
    new = (await rig.call("members.create", {"name": name, "greet": True, "ui_language": language, **fields}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: rig.history.get(turn["id"]).status != "running")
    return new, (await rig.turns(member_id=new["id"]))[0]


async def answer(rig, question, text):
    return await rig.background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": text})


async def say(rig, text, member_id):
    rig.said = getattr(rig, "said", 0) + 1
    return await rig.call("agent.ask", {"session_id": f"owner-{rig.said}", "text": text, "ui_language": "en", "source": "app", "member_id": member_id})


async def setup_turn(rig, member_id, count=2):
    """The turn that goes on from the answer, once it is there and done."""
    await until(lambda: len(rig.conn.execute("SELECT id FROM agent_turns WHERE member_id=?", (member_id,)).fetchall()) >= count)
    turns = await rig.turns(member_id=member_id)
    return next(turn for turn in turns if turn["session_id"].startswith("setup-"))


def step_view(turns, turn_id):
    return next(turn for turn in turns if turn["id"] == turn_id)


def offered(call):
    return [item["function"]["name"] for item in call["tools"]]


# --- the first message ---------------------------------------------------------------------------------------------------


async def test_the_greeting_is_the_members_own_line_with_one_question_card(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    assert (turn["route"], turn["source"], turn["status"], turn["question"], turn["text"]) == ("greeting", "greeting", "done", "", "Hi, I'm Mia, your new colleague.")
    assert [item["text"] for item in turn["messages"] if item["kind"] == "reply"] == ["Hi, I'm Mia, your new colleague."]
    [question] = turn["owner_questions"]
    assert (question["kind"], question["state"], question["question"], question["options"], question["free_text"]) == (
        "ask_owner", "asked", FIRST_CARD["question"], FIRST_CARD["options"], True)
    assert turn["task"]["state"] == "waiting"
    # The card stands after the words that came with it: it is sent with the time it was asked.
    [line] = [item for item in turn["messages"] if item["kind"] == "reply"]
    assert question["created_at_ms"] >= line["at_ms"]
    assert rig.background.task(question["task_id"]).text == ""  # the request of a greeting is no words of the owner's
    assert offered(client.chat_calls[0]) == ["ask_owner"]
    system = client.chat_calls[0]["messages"][0]["content"]
    assert "call ask_owner once" in system and "<new_member" not in system
    assert not client.chat_calls[0]["fallbacks"]
    # The card is a question like any other: durable, found in the conversation, answerable.
    page = await rig.call("agent.history.list", {"member_id": new["id"]})
    assert [item["id"] for item in page["pending_questions"]] == [question["id"]]


async def test_the_card_is_the_everyday_question_card_and_nothing_else_is_offered(chain, client):
    rig = chain
    client.chats.append(chat("Hello.", ("self_check", {})))
    new = (await rig.call("members.create", {"name": "Mia", "greet": True}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: rig.history.get(turn["id"]).status == "error")
    assert offered(client.chat_calls[0]) == ["ask_owner"]
    assert not rig.background.service.owner_questions.for_turn(turn["id"])
    assert rig.history.get(turn["id"]).text != "Hello."


@pytest.mark.parametrize("card", [{"question": ""}, {"question": "Which?", "options": ["a", "a"]}, {"question": "Which?", "options": list("abcde")}])
async def test_a_card_the_question_tool_refuses_is_no_card(chain, client, card):
    rig = chain
    client.chats.append(chat("Hello.", ("ask_owner", card)))
    new = (await rig.call("members.create", {"name": "Mia", "greet": True}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: len(client.chat_calls) >= 2 or rig.history.get(turn["id"]).status == "error")
    assert not rig.background.service.owner_questions.for_turn(turn["id"])


async def test_a_card_without_the_members_words_is_a_failed_greeting_that_is_written_again(chain, client):
    rig = chain
    client.chats.append(chat("", ("ask_owner", FIRST_CARD)))
    new = (await rig.call("members.create", {"name": "Mia", "greet": True}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: rig.history.get(turn["id"]).status == "error")
    assert not rig.background.service.owner_questions.for_turn(turn["id"])
    assert rig.conn.execute("SELECT count(*) FROM worker_tasks WHERE state='waiting'").fetchone()[0] == 0
    # The same retry as before: the failed one goes, the new one is a line and a card.
    client.chats.append(chat("Hi again, I'm Mia.", ("ask_owner", FIRST_CARD)))
    retry = await rig.call("members.greet", {"id": new["id"]})
    await until(lambda: rig.history.get(retry["turn_id"]).status == "done")
    [saved] = await rig.turns(member_id=new["id"])
    assert saved["id"] == retry["turn_id"] and saved["text"] == "Hi again, I'm Mia." and saved["owner_questions"][0]["state"] == "asked"


async def test_a_greeting_that_failed_is_written_again_with_its_card(chain, client):
    rig = chain
    client.chats.append(RuntimeError("synthetic brain failure"))
    new = (await rig.call("members.create", {"name": "Mia", "greet": True}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: rig.history.get(turn["id"]).status == "error")
    client.chats.append(chat("I'm Mia.", ("ask_owner", FIRST_CARD)))
    retry = await rig.call("members.greet", {"id": new["id"]})
    await until(lambda: rig.history.get(retry["turn_id"]).status == "done")
    [saved] = await rig.turns(member_id=new["id"])
    assert saved["text"] == "I'm Mia." and [item["state"] for item in saved["owner_questions"]] == ["asked"]


async def test_a_model_that_only_writes_a_line_still_greets(chain, client):
    rig = chain
    client.chats.append(chat("Hi, I'm Mia."))
    new = (await rig.call("members.create", {"name": "Mia", "greet": True}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: rig.history.get(turn["id"]).status == "done")
    saved = rig.history.get(turn["id"])
    assert saved.text == "Hi, I'm Mia." and not rig.background.service.owner_questions.for_turn(turn["id"])


async def test_what_is_known_goes_into_the_greeting_for_the_options(chain, client):
    rig = chain
    rig.team.members.store.create_member(name="Calendar", role="Manage appointments")
    rig.team.members._connections = lambda: [{"name": "Gmail", "enabled": True, "state": "ready"},
                                             {"name": "Offline", "enabled": True, "state": "unreadable"}]
    rig.settings.set("owner_about", "I run the Filia project")
    await greet(rig, client)
    system = client.chat_calls[0]["messages"][0]["content"]
    for known in ("Manage appointments", "Gmail", "Filia"):
        assert known in system
    assert "Offline" not in system
    assert "gaps in other members' roles" in system and "mail, schedule and reminders, research, documents" in system


async def test_a_cli_brain_greets_with_its_line_and_the_one_card(chain, monkeypatch):
    rig = chain
    seen = {}

    async def run(driver, **kwargs):
        seen["system"], seen["no_tools"] = kwargs["system"], kwargs["no_tools"]
        # Native permission stays denied; the card is a call to the member's own MCP server.
        assert await kwargs["permission"]({"method": "synthetic_action"}) == "deny"
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}, trust_env=False) as http:
            async def rpc(method, params):
                reply = (await http.post(kwargs["endpoint"], json={"jsonrpc": "2.0", "id": method, "method": method, "params": params})).json()
                return reply.get("result") or {"isError": True, **reply}
            seen["tools"] = [tool["name"] for tool in (await rpc("tools/list", {}))["tools"]]
            seen["other"] = await rpc("tools/call", {"name": "local_time", "arguments": {}})
            yield Event("session", "synthetic-greeting-session")
            yield Event("text_delta", "Hi, I'm Mia, your new colleague.")
            await rpc("tools/call", {"name": "ask_owner", "arguments": FIRST_CARD})

    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["unused-test-boundary"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    monkeypatch.setattr(Driver, "run", run)
    new = (await rig.call("members.create", {"name": "Mia", "greet": True, "model": "cli:codex:test", "ui_language": "en"}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: rig.history.get(turn["id"]).status == "done")
    [saved] = await rig.turns(member_id=new["id"])
    assert seen["no_tools"] is True and seen["tools"] == ["ask_owner"] and seen["other"]["isError"] is True
    assert saved["text"] == "Hi, I'm Mia, your new colleague." and saved["route"] == "greeting"
    [question] = saved["owner_questions"]
    assert question["state"] == "asked" and question["options"] == FIRST_CARD["options"]
    assert saved["task"]["state"] == "waiting"
    assert not rig.service._cli_loops


async def test_a_cli_member_goes_through_the_same_steps(chain, monkeypatch):
    rig = chain
    runs = []

    async def run(driver, **kwargs):
        runs.append(kwargs)
        async with httpx.AsyncClient(headers={"Authorization": "Bearer " + kwargs["token"]}, trust_env=False) as http:
            async def rpc(method, params):
                reply = (await http.post(kwargs["endpoint"], json={"jsonrpc": "2.0", "id": method, "method": method, "params": params})).json()
                return reply.get("result") or {"isError": True, **reply}
            yield Event("session", f"synthetic-session-{len(runs)}")
            if len(runs) == 1:  # the greeting
                yield Event("text_delta", "Hi, I'm Mia, your new colleague.")
                await rpc("tools/call", {"name": "ask_owner", "arguments": FIRST_CARD})
            else:  # the turn that goes on from the answer: the job, one sentence, the next card
                assert "set_my_job" in [tool["name"] for tool in (await rpc("tools/list", {}))["tools"]]
                saved = await rpc("tools/call", {"name": "set_my_job", "arguments": {"role": "Inbox colleague", "instructions": "Answer my mail daily"}})
                assert saved["isError"] is False
                yield Event("text_delta", "Got it, I keep your inbox answered.")
                await rpc("tools/call", {"name": "ask_owner", "arguments": TASK_CARD})

    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["unused-test-boundary"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *args, **kwargs: True)
    monkeypatch.setattr(Driver, "run", run)
    new = (await rig.call("members.create", {"name": "Mia", "greet": True, "model": "cli:codex:test", "ui_language": "en"}))["member"]
    [turn] = await rig.turns(member_id=new["id"])
    await until(lambda: rig.history.get(turn["id"]).status == "done")
    [first] = (await rig.turns(member_id=new["id"]))[0]["owner_questions"]
    await answer(rig, first, ANSWER)
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    step = step_view(await rig.turns(member_id=new["id"]), step["id"])
    assert rig.team.members.store.member(new["id"]).role == "Inbox colleague"
    assert "<new_member_setup>" in runs[1]["user"] and FIRST_CARD["question"] in runs[1]["user"] and not runs[1].get("no_tools")
    assert [item["text"] for item in step["messages"] if item["kind"] == "reply"] == ["Got it, I keep your inbox answered."]
    assert any(item["kind"] == "event" and json.loads(item["text"]) == {"type": "job_set", "name": "Inbox colleague"} for item in step["messages"])
    [second] = step["owner_questions"]
    assert second["state"] == "asked" and second["question"] == TASK_CARD["question"]
    assert not rig.service._cli_loops


# --- the steps after the answer ------------------------------------------------------------------------------------------


async def test_the_answer_starts_a_turn_that_saves_the_job_says_so_and_asks_the_first_task(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    [question] = turn["owner_questions"]
    client.chats += [chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Keep my inbox answered every day"})),
                     chat("Got it, I keep your inbox answered.", ("ask_owner", TASK_CARD))]
    await answer(rig, question, ANSWER)
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    step = next(item for item in await rig.turns(member_id=new["id"]) if item["id"] == step["id"])
    # (a) the job is saved, the thread says so in one quiet line, and the member says it in one sentence
    saved = rig.team.members.store.member(new["id"])
    assert (saved.role, saved.instructions) == ("Inbox colleague", "Keep my inbox answered every day")
    events = [json.loads(item["text"]) for item in step["messages"] if item["kind"] == "event" and item["text"].startswith("{")]
    assert {"type": "job_set", "name": "Inbox colleague"} in events
    assert [item["text"] for item in step["messages"] if item["kind"] == "reply"] == ["Got it, I keep your inbox answered."]
    # (c) one more card, and the first one stays answered where it was asked
    [second] = step["owner_questions"]
    assert (second["state"], second["question"], second["options"]) == ("asked", TASK_CARD["question"], TASK_CARD["options"])
    first = next(item for item in await rig.turns(member_id=new["id"]) if item["id"] == turn["id"])
    assert [(q["state"], q["result"]["answer"]) for q in first["owner_questions"]] == [("answered", ANSWER)]
    assert first["task"]["state"] == "done" and first["text"] == "Hi, I'm Mia, your new colleague."
    # The owner's answer is the card's: the turn is marked, its words are the answer
    assert step["setup"] is True and step["question"] == ANSWER
    # What the model is told: the card it asked, the order, and that the job tool is there
    call = client.chat_calls[1]
    assert "set_my_job" in offered(call) and "have no job yet" in call["messages"][0]["content"]
    told = call["messages"][-1]["content"]
    assert "<new_member_setup>" in told and FIRST_CARD["question"] in told and "<new_member_step>" not in told
    assert "ask_owner" in offered(call)
    # One open card at a time
    assert [item["id"] for item in (await rig.call("agent.history.list", {"member_id": new["id"]}))["pending_questions"]] == [second["id"]]


async def test_the_first_task_answer_starts_that_task(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    client.chats += [chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Keep my inbox answered"})),
                     chat("Inbox it is.", ("ask_owner", TASK_CARD))]
    await answer(rig, turn["owner_questions"][0], ANSWER)
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    [second] = next(item for item in await rig.turns(member_id=new["id"]) if item["id"] == step["id"])["owner_questions"]
    rig.background.client.replies = [report("Sorted today's mail.")]
    await answer(rig, second, "Sort today's mail")
    await until(lambda: rig.background.task(second["task_id"]).state in ("done", "failed", "limit"))
    assert rig.background.task(second["task_id"]).state == "done"
    assert "Sort today's mail" in rig.background.client.chat_calls[-1]["messages"][-1]["content"]
    turns = await rig.turns(member_id=new["id"])
    assert len(turns) == 2  # the greeting, and the turn that set up and started the task


async def test_a_clear_job_and_task_in_the_answer_collapse_the_steps(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    client.chats += [chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Answer my mail daily"})),
                     chat("Your job is the inbox; I'm sorting today's mail now.")]
    await answer(rig, turn["owner_questions"][0], "Answer my mail every day, start with today's inbox")
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    step = next(item for item in await rig.turns(member_id=new["id"]) if item["id"] == step["id"])
    assert not step.get("owner_questions") and step["text"] == "Your job is the inbox; I'm sorting today's mail now."
    assert rig.team.members.store.member(new["id"]).role == "Inbox colleague"
    assert "clear job and a clear first task" in client.chat_calls[1]["messages"][-1]["content"]


async def test_a_member_made_with_a_job_only_answers_its_card(chain, client):
    rig = chain
    new, turn = await greet(rig, client, role="Researcher", instructions="Find clear answers")
    client.chats += [chat("Starting with the market report.")]
    await answer(rig, turn["owner_questions"][0], "Research the market")
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    call = client.chat_calls[1]
    assert "set_my_job" not in offered(call) and "have no job yet" not in call["messages"][0]["content"]
    told = call["messages"][-1]["content"]
    assert "<new_member_setup>" in told and "act on it" in told and "Research the market" in told
    assert rig.team.members.store.member(new["id"]).role == "Researcher"


async def test_a_one_off_answer_saves_nothing_and_is_just_answered(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    client.chats.append(chat("It is ten past four."))
    await answer(rig, turn["owner_questions"][0], "What time is it?")
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    assert not rig.team.members.store.member(new["id"]).role
    assert not step_view(await rig.turns(member_id=new["id"]), step["id"]).get("owner_questions")


# --- leaving the chain -----------------------------------------------------------------------------------------------


async def test_typing_instead_of_answering_closes_the_card_and_is_an_ordinary_message(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    [question] = turn["owner_questions"]
    client.chats.append(chat("I can sort mail, plan your day or look things up."))
    result = await say(rig, "What can you do?", new["id"])
    assert result["text"] == "I can sort mail, plan your day or look things up."
    [first, typed_turn] = sorted(await rig.turns(member_id=new["id"]), key=lambda item: item["id"])
    assert [q["state"] for q in first["owner_questions"]] == ["cancelled"] and first["task"]["state"] == "done"
    assert typed_turn["question"] == "What can you do?" and not typed_turn.get("setup")
    # No set-up is pushed: the ordinary new-member rule is all it is told, and no second card is asked.
    told = client.chat_calls[1]["messages"][-1]["content"]
    assert "<new_member_step>" in told and "never bring the set-up up again" in told and "<new_member_setup>" not in told
    assert not rig.background.service.owner_questions.pending()
    with pytest.raises(RpcError) as caught:
        await rig.call("members.greet", {"id": new["id"]})
    assert caught.value.code == INVALID_PARAMS


async def test_closing_the_card_ends_the_set_up_quietly(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    calls = len(client.chat_calls)
    await answer(rig, turn["owner_questions"][0], None)
    await asyncio.sleep(0.1)
    [first] = await rig.turns(member_id=new["id"])
    assert [q["state"] for q in first["owner_questions"]] == ["cancelled"]
    assert first["task"]["state"] == "done" and first["text"] == "Hi, I'm Mia, your new colleague."
    assert len(client.chat_calls) == calls and not rig.team.members.store.member(new["id"]).role
    assert not rig.background.service.owner_questions.pending()


# --- the name ----------------------------------------------------------------------------------------------------------


async def test_a_new_name_given_in_the_answer_is_taken_with_the_rename_path_and_a_line(chain, client):
    rig = chain
    rig.settings.set("action_mode", "bypass")
    new, turn = await greet(rig, client)
    client.chats += [chat("", use("member_update", {"id": new["id"], "name": "Jia"})),
                     chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Answer my mail daily"})),
                     chat("Jia here, the inbox is mine.", ("ask_owner", TASK_CARD))]
    await answer(rig, turn["owner_questions"][0], "Call yourself Jia and answer my mail daily")
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    step = next(item for item in await rig.turns(member_id=new["id"]) if item["id"] == step["id"])
    assert rig.team.members.store.member(new["id"]).name == "Jia"
    lines = [json.loads(item["text"]) for item in step["messages"] if item["kind"] == "event" and item["text"].startswith("{")]
    assert {"type": "renamed", "name": "Jia", "text": "Renamed to Jia"} in lines


async def test_without_a_name_in_the_answer_the_name_is_never_touched(chain, client):
    rig = chain
    rig.settings.set("action_mode", "bypass")
    new, turn = await greet(rig, client)
    client.chats += [chat("", use("member_update", {"id": new["id"], "name": "Zed"})),
                     chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Answer my mail daily"})),
                     chat("Staying Mia.", ("ask_owner", TASK_CARD))]
    await answer(rig, turn["owner_questions"][0], "Answer my mail daily")
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    assert rig.team.members.store.member(new["id"]).name == "Mia"
    refused = next(message for message in client.chat_calls[2]["messages"] if message.get("role") == "tool")
    assert "owner_name_required" in refused["content"] or "did not give you a new one" in refused["content"]


# --- the app that is missing ---------------------------------------------------------------------------------------------


async def test_a_missing_app_is_asked_once_and_then_the_first_task(chain, client, tmp_path):
    from test_connect_cards import Rig as Connectors, GoogleFixture
    rig = chain
    rig.settings.set("action_mode", "bypass")
    connectors = Connectors(tmp_path, rig.conn, GoogleFixture("setup-chain"))
    await connectors.configure()
    rig.service._cards = connectors.cards
    connectors.cards.resume = rig.service.resume_turn
    try:
        new, turn = await greet(rig, client)
        client.chats += [chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Answer my mail daily"})),
                         chat("", ("find_app", {"query": "gmail"})),
                         chat("Mail needs your Gmail.", ("connect_app", {"app": "gmail"}))]
        await answer(rig, turn["owner_questions"][0], "Answer my mail daily")
        step = await setup_turn(rig, new["id"])
        await until(lambda: rig.history.get(step["id"]).status != "running" and rig.history.get(step["id"]).text)
        step = next(item for item in await rig.turns(member_id=new["id"]) if item["id"] == step["id"])
        [shown] = step["connectors"]
        assert shown["app"] == "gmail" and shown["state"] == "pending" and step["setup"] is True
        assert not step.get("owner_questions")
        # Nothing but the connect card is asked, and the connect card is for that one app.
        client.chats += [chat("The mail is connected.", ("ask_owner", TASK_CARD))]
        await connectors.connect(connectors.cards.store.get(shown["id"]))
        await until(lambda: any(item.source == "connector" for item in rig.history.list(member_id=new["id"])))
        resumed = next(item for item in rig.history.list(member_id=new["id"]) if item.source == "connector")
        await until(lambda: rig.history.get(resumed.id).status != "running")
        told = client.chat_calls[-1]["messages"][-1]["content"]
        assert "<new_member_setup>" in told and "has connected the app you asked for" in told
        [card] = next(item for item in await rig.turns(member_id=new["id"]) if item["id"] == resumed.id)["owner_questions"]
        assert card["question"] == TASK_CARD["question"] and card["state"] == "asked"
    finally:
        await connectors.cards.aclose()


# --- a restart ---------------------------------------------------------------------------------------------------------


async def test_a_restart_keeps_the_card_and_the_chain_goes_on_from_the_answer(chain, client, conn, plugins):
    rig = chain
    new, turn = await greet(rig, client)
    [question] = turn["owner_questions"]
    # Another process opens the same data (the first one is not asked for anything again).
    background = BackgroundRig(conn, plugins)
    restarted = Rig(conn, client, FakeActions(), team=rig.team.members, memory=rig.team.memory, background=background.service,
                    plugins=plugins.hub, gate=background.gate)
    try:
        background.service.use_team(rig.team.members, restarted.service.team_tool)
        background.service.use_owner_tools(restarted.service.background_owner_tool)
        restarted.service.start()
        assert background.task(question["task_id"]).state == "waiting"
        pending = (await restarted.call("agent.history.list", {"member_id": new["id"]}))["pending_questions"]
        assert [item["id"] for item in pending] == [question["id"]] and not client.chat_calls[1:]
        client.chats += [chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Answer my mail daily"})),
                         chat("On it.", ("ask_owner", TASK_CARD))]
        await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": ANSWER})
        step = await setup_turn(restarted, new["id"])
        await until(lambda: restarted.history.get(step["id"]).status == "done")
        assert background.task(question["task_id"]).state == "done"
        assert rig.team.members.store.member(new["id"]).role == "Inbox colleague"
        [second] = step_view(await restarted.turns(member_id=new["id"]), step["id"])["owner_questions"]
        assert second["question"] == TASK_CARD["question"] and second["state"] == "asked"
    finally:
        await restarted.aclose()
        await background.close()


async def test_an_answer_given_before_the_agent_took_over_is_carried_on_when_it_does(chain, client):
    rig = chain
    new, turn = await greet(rig, client)
    [question] = turn["owner_questions"]
    service = rig.background.service
    service._setup = None  # the last run ended between the answer and the start of the set-up
    await answer(rig, question, ANSWER)
    assert rig.background.task(question["task_id"]).state == "waiting" and len(client.chat_calls) == 1
    client.chats += [chat("", ("set_my_job", {"role": "Inbox colleague", "instructions": "Answer my mail daily"})),
                     chat("On it.", ("ask_owner", TASK_CARD))]
    service.use_setup(rig.service.begin_setup)
    service.recover_owner_waits()
    step = await setup_turn(rig, new["id"])
    await until(lambda: rig.history.get(step["id"]).status == "done")
    assert rig.team.members.store.member(new["id"]).role == "Inbox colleague"
    assert rig.background.task(question["task_id"]).state == "done"
    service.recover_owner_waits()
    assert len(client.chat_calls) == 3  # the answer starts the set-up once


# --- the everyday rule -------------------------------------------------------------------------------------------------


def test_the_question_tool_says_when_to_ask_in_the_words_of_the_rule():
    from raphael_core.agent.harness_tools import DEFINITIONS
    text = DEFINITIONS["ask_owner"]["description"]
    assert "fits two to four choices" in text and "decide the rest yourself" in text and "never ask what the app or you can find out" in text
    assert "One card at a time" in text and "Prefer deciding routine details" not in text
