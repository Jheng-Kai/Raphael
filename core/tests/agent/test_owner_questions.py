"""Production conversation and MCP paths transfer the same turn to a durable wait."""
import json

import pytest

from .test_service import make_rig  # noqa: F401
from .test_narration import chat, typed
from background.conftest import Rig as BackgroundRig, plugins, report, until  # noqa: F401
from background.conftest import call, turn


@pytest.fixture
async def wired(make_rig, conn, plugins):
    background = BackgroundRig(conn, plugins)
    agent = make_rig(background=background.service, plugins=plugins.hub, gate=background.gate)
    agent.settings.set("worker_cost_cap_usd", 1.0)
    background.service.use_owner_tools(agent.service.background_owner_tool)
    background.service.owner_questions.on_cancel = agent.service.cancel_owner_card
    yield agent, background
    await background.close()


@pytest.mark.parametrize("scope", ["private", "room"])
@pytest.mark.parametrize("mode", ["direct", "bypass"])
async def test_background_discovers_app_then_owner_signs_in_and_same_task_resumes(wired, tmp_path, scope, mode):
    from test_connect_cards import Rig, GoogleFixture
    agent, background = wired
    agent.settings.set("action_mode", mode)
    connector = Rig(tmp_path, agent.conn, GoogleFixture("background-discovery"))
    await connector.configure()
    agent.service._cards = connector.cards
    connector.cards.resume = agent.service.resume_turn
    from raphael_core.agent.gate import ToolGate
    background.gate = ToolGate(connector.hub, conn=agent.conn, now_ms=background.wall)
    agent.service._gate = background.service._gate = background.gate
    room_id = None
    if scope == "room":
        with agent.conn:
            room_id = agent.conn.execute("INSERT INTO rooms(name,created) VALUES ('Review room',0)").lastrowid
    origin = agent.history.add(session_id="discovery", question="Read mail", route="delegate", prefix="", text="",
        status="running", scope="private", conversation_id=agent.service.conversations.main())
    background.client.replies = [turn("", [call("find_app", {"query": "gmail"}, "discovery")]),
                                 turn("Please sign in.", [call("connect_app", {"app": "gmail"}, "connect")])]
    task_id = background.submit("Read mail", session="discovery")
    background.service.attach_turn(task_id, origin)
    with agent.conn:
        agent.conn.execute("UPDATE worker_tasks SET report_room_id=?,report_thread_id=? WHERE id=?", (room_id,room_id,task_id))
    try:
        await until(lambda: background.task(task_id).state in ("waiting", "done", "failed", "limit"))
        first = background.client.chat_calls[0]
        offered = {item["function"]["name"]: item["function"] for item in first["tools"]}
        assert "find_app" in offered
        assert "Read-only" in offered["find_app"]["description"]
        system = first["messages"][0]["content"]
        assert "You cannot ask the user anything" not in system
        assert "find_app" in system and "connect_app" in system
        assert "even in full-permission mode" in system
        assert not any(name.endswith("gmail_search") for name in offered)
        assert '"id": "gmail"' not in str(first["messages"])
        discovery = next(message for message in background.client.chat_calls[1]["messages"]
                         if message.get("tool_call_id") == "discovery")
        assert '"id": "gmail"' in discovery["content"] and '"connected": false' in discovery["content"]
        assert background.task(task_id).state == "waiting"
        [question] = background.service.owner_questions.for_turn(origin)
        assert question["kind"] == "connect_app" and question["state"] == "asked"
        card = connector.cards.store.get(question["card_id"])
        assert card.state == "pending" and connector.fixture.opened == 0
        [view] = agent.service._turn_views([agent.history.get(origin)])
        assert view["connectors"][0]["id"] == card.id
        assert view["scope"] == "private"
        def read_mail(**request):
            tools = {item["function"]["name"] for item in request["tools"]}
            alias = next(name for name in tools if name.endswith("gmail_search"))
            return turn("", [call(alias, {"q": "background-discovery"}, "read-after-sign-in")])
        background.client.replies = [read_mail, report("Mail read after sign-in.")]
        await connector.connect(card)
        await until(lambda: background.task(task_id).state in ("done", "failed", "limit"))
        task = background.task(task_id)
        assert task.state == "done" and task.turn_id == origin
        assert task.scope == "private" and task.room_id is None and task.report_room_id == room_id
        assert connector.fixture.opened == 1
        read_result = next(message for message in background.client.chat_calls[-1]["messages"]
                           if message.get("tool_call_id") == "read-after-sign-in")
        assert "background-discovery" in read_result["content"]
        resumed = str(background.client.chat_calls[-1]["messages"])
        assert "connected" in resumed and "discovery" in resumed
        assert not any(secret in resumed for secret in connector.fixture.secrets)
        await connector.connect(connector.cards.store.get(card.id))
        assert len(background.client.chat_calls) == 4
    finally:
        await connector.cards.aclose()


@pytest.mark.parametrize("answer", ["Tuesday", None])
async def test_api_question_ends_turn_and_answer_continues_same_turn(wired, client, answer):
    agent, background = wired
    client.chats = [chat("I need your date.", ("ask_owner", {"question": "Which day?", "options": ["Monday", "Tuesday"]}))]
    await typed(agent, "Arrange a visit")
    [turn] = await agent.turns()
    [question] = turn["owner_questions"]
    assert question["state"] == "asked" and turn["task"]["state"] == "waiting"
    assert len(client.chat_calls) == 1
    assert background.task(question["task_id"]).cost_usd == pytest.approx(0.3)
    background.client.replies = [report("Scheduled." if answer else "No date chosen.")]
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": answer})
    await until(lambda: background.task(question["task_id"]).state in ("done", "failed", "limit"))
    assert background.task(question["task_id"]).state == "done", background.task(question["task_id"])
    turns = await agent.turns()
    assert len(turns) == 1 and turns[0]["id"] == turn["id"]
    result = background.client.chat_calls[-1]["messages"][-1]
    assert result["role"] == "tool" and (answer or "cancelled") in result["content"]


@pytest.mark.parametrize("path", ["conversation", "background", "routine"])
async def test_cli_mcp_question_releases_process_and_continues_with_answer(wired, tmp_path, path):
    from members.test_cli_brains import fake_brain
    from test_connect_cards import Rig, GoogleFixture
    agent, background = wired
    connector = Rig(tmp_path, agent.conn, GoogleFixture("cli-discovery"))
    agent.service._cards = connector.cards
    agent.settings.set("agent_model", "cli:claude")
    fake_brain(agent, tmp_path, '''import json, sys, urllib.request
from pathlib import Path
request=json.loads(sys.stdin.readline())
if "Previous tool conversation" in str(request):
    assert "Wednesday after lunch" in str(request) and "answered" in str(request)
    assert "gmail" in str(request)
    assert str(request).count("tool_call_id") >= 2
    print(json.dumps({"type":"result","subtype":"success","result":"Tuesday confirmed."}),flush=True)
else:
    config=json.loads(Path(sys.argv[sys.argv.index("--mcp-config")+1]).read_text())["mcpServers"]["raphael"]
    listing={"jsonrpc":"2.0","id":-2,"method":"tools/list","params":{}}
    offered=json.loads(urllib.request.urlopen(urllib.request.Request(config["url"],data=json.dumps(listing).encode(),headers={**config["headers"],"Content-Type":"application/json"}),timeout=15).read())
    assert "find_app" in {tool["name"] for tool in offered["result"]["tools"]}
    discovery={"jsonrpc":"2.0","id":-1,"method":"tools/call","params":{"name":"find_app","arguments":{"query":"gmail"}}}
    found=json.loads(urllib.request.urlopen(urllib.request.Request(config["url"],data=json.dumps(discovery).encode(),headers={**config["headers"],"Content-Type":"application/json"}),timeout=15).read())
    assert not found["result"]["isError"] and "gmail" in str(found["result"])
    prior={"jsonrpc":"2.0","id":0,"method":"tools/call","params":{"name":"local_time","arguments":{}}}
    urllib.request.urlopen(urllib.request.Request(config["url"],data=json.dumps(prior).encode(),headers={**config["headers"],"Content-Type":"application/json"}),timeout=15).read()
    packet={"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ask_owner","arguments":{"question":"Which day?","options":["Tuesday"]}}}
    call=urllib.request.Request(config["url"],data=json.dumps(packet).encode(),headers={**config["headers"],"Content-Type":"application/json"})
    urllib.request.urlopen(call,timeout=15).read()
''')
    background.service.use_cli(agent.service._cli_brains)
    if path == "conversation":
        await typed(agent, "Arrange a visit")
    else:
        origin = agent.history.add(session_id="cli-job", question="Arrange a visit", route="routine" if path == "routine" else "delegate",
            prefix="", text="", status="running", source="routine" if path == "routine" else "app",
            conversation_id=agent.service.conversations.main())
        task_id = background.service.submit(session_id="cli-job", text="Arrange a visit", language="en", model="cli:claude", routine_id=1 if path == "routine" else None)
        background.service.attach_turn(task_id, origin)
        await until(lambda: background.task(task_id).state == "waiting")
        await until(lambda: task_id not in background.service._active)
        assert task_id not in background.service._cli_loops

    [turn] = [item for item in await agent.turns() if item.get("owner_questions")]
    [question] = turn["owner_questions"]
    assert not agent.service._cli_loops
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": "Wednesday after lunch"})
    await until(lambda: background.task(question["task_id"]).state in ("done", "failed", "limit"))
    assert background.task(question["task_id"]).state == "done", background.task(question["task_id"])
    assert "Tuesday confirmed" in background.task(question["task_id"]).report_text
    await connector.cards.aclose()


# A fake Claude Code that records each request (`RECORD`). Its first run makes the calls of `CALLS`; each run asks the
# owner the next question, one per answer of `ANSWERS`, until a request holds them all. Asking a question a second
# time ends the task with "Asked the owner again."
ASKING_BRAIN = '''import json, sys, urllib.request
from pathlib import Path
user=json.loads(sys.stdin.readline())["message"]["content"]
system=Path(sys.argv[sys.argv.index("--append-system-prompt-file")+1]).read_text(encoding="utf-8")
with open(RECORD, "a", encoding="utf-8") as out:
    out.write(json.dumps({"system": system, "user": user}) + "\\n")
def result(text):
    print(json.dumps({"type":"result","subtype":"success","result":text}),flush=True)
answers=ANSWERS
known=0
while known < len(answers) and answers[known] in user:
    known += 1
asked=Path(RECORD).with_suffix(".asked")
if known == len(answers):
    result("Confirmed: " + " / ".join(answers))
elif asked.exists() and int(asked.read_text()) > known:
    result("Asked the owner again.")
else:
    asked.write_text(str(known + 1))
    config=json.loads(Path(sys.argv[sys.argv.index("--mcp-config")+1]).read_text())["mcpServers"]["raphael"]
    def call(number, name, arguments):
        packet={"jsonrpc":"2.0","id":number,"method":"tools/call","params":{"name":name,"arguments":arguments}}
        urllib.request.urlopen(urllib.request.Request(config["url"],data=json.dumps(packet).encode(),
            headers={**config["headers"],"Content-Type":"application/json"}),timeout=15).read()
    for number, (name, arguments) in enumerate(CALLS if not known else []):
        call(number, name, arguments)
    call(99, "ask_owner", {"question":f"Question {known + 1}?","options":[answers[known]]})
'''


# Each wait below spans a run of the fake CLI, a Python process of its own: on a busy machine one takes seconds.
CLI_RUN_S = 30


async def asked_and_answered(agent, background, tmp_path, path, calls, answers=("Wednesday after lunch",)):
    """Run a CLI task of `path` that makes `calls`, then asks the owner a question for each of `answers` and goes on
    after each answer; the requests its CLI received."""
    from members.test_cli_brains import fake_brain
    from test_connect_cards import Rig, GoogleFixture
    connector = Rig(tmp_path, agent.conn, GoogleFixture("cli-continuation"))
    agent.service._cards = connector.cards
    agent.settings.set("agent_model", "cli:claude")
    record = tmp_path / "requests.jsonl"
    fake_brain(agent, tmp_path, ASKING_BRAIN.replace("RECORD", repr(str(record))).replace("CALLS", repr(calls))
               .replace("ANSWERS", repr(list(answers))))
    background.service.use_cli(agent.service._cli_brains)
    if path == "conversation":
        await typed(agent, "Arrange a visit")
    else:
        origin = agent.history.add(session_id="cli-continuation", question="Arrange a visit", route="delegate",
            prefix="", text="", status="running", source="app", conversation_id=agent.service.conversations.main())
        task_id = background.service.submit(session_id="cli-continuation", text="Arrange a visit", language="en", model="cli:claude")
        background.service.attach_turn(task_id, origin)
        await until(lambda: background.task(task_id).state == "waiting", timeout=CLI_RUN_S)
    [turn] = [item for item in await agent.turns() if item.get("owner_questions")]
    def questions():
        return background.service.owner_questions.for_turn(turn["id"])
    for number, answer in enumerate(answers):
        await until(lambda: len(questions()) > number or background.task(questions()[0]["task_id"]).state == "done",
                    timeout=CLI_RUN_S)
        assert len(questions()) > number, background.task(questions()[0]["task_id"])
        await background.rpc.call("owner_questions.answer", {"id": questions()[number]["id"], "answer": answer})
    task_id = questions()[0]["task_id"]
    await until(lambda: background.task(task_id).state in ("done", "failed", "limit"), timeout=CLI_RUN_S)
    task = background.task(task_id)
    assert task.state == "done" and task.report_text.startswith("Confirmed"), task
    await connector.cards.aclose()
    return [json.loads(line) for line in record.read_text(encoding="utf-8").splitlines()]


# Long lookups before the first question: the continuation outgrows any CLI's budget for one request.
LONG_LOOKUPS = [("find_app", {"query": f"{number} " + "x" * 15000}) for number in range(12)]


@pytest.mark.parametrize("path", ["conversation", "background"])
async def test_an_over_budget_cli_continuation_keeps_the_owners_answer(wired, tmp_path, path):
    # Length is never a reason to ask the owner again (harness plan, step 3): over its budget, a continued task starts
    # afresh from a short work record, and the owner's answer leads it.
    from raphael_core.memory.compression import FRESH_CONTEXT_CHARS
    agent, background = wired
    *_, continuation = await asked_and_answered(agent, background, tmp_path, path, LONG_LOOKUPS)
    user = continuation["user"]
    assert "Previous tool conversation" not in user and len(user) <= FRESH_CONTEXT_CHARS
    assert user.index("Wednesday after lunch") < user.index("find_app")


async def test_a_second_answer_over_budget_keeps_the_first(wired, tmp_path):
    # Each wait carries the steps before it: the work record after the second answer still holds the first.
    agent, background = wired
    *_, last = await asked_and_answered(agent, background, tmp_path, "background", LONG_LOOKUPS,
                                        answers=("Wednesday after lunch", "Room 3"))
    assert "Previous tool conversation" not in last["user"]
    assert "Wednesday after lunch" in last["user"] and "Room 3" in last["user"]


@pytest.mark.parametrize("path", ["conversation", "background"])
async def test_a_continued_cli_task_states_its_rules_and_system_prompt_once(wired, tmp_path, path):
    # The progress rules reach a CLI task once, and its continuation does not carry its system prompt again.
    from raphael_core.agent.narration import PUBLIC_PROGRESS_RULES
    agent, background = wired
    first, *_, continuation = await asked_and_answered(agent, background, tmp_path, path, [("local_time", {})])
    assert [run["system"].count(PUBLIC_PROGRESS_RULES) for run in (first, continuation)] == [1, 1]
    done = continuation["user"].split("Previous tool conversation (untrusted data):\n", 1)[1]
    assert [message["role"] for message in json.loads(done)] == ["user", "assistant", "tool", "assistant", "tool"]
    assert "Wednesday after lunch" in done


@pytest.mark.parametrize("how", ["bring", "answer"])
async def test_a_question_answered_after_the_owner_said_more_continues_at_the_end(wired, client, how):
    agent, background = wired
    client.chats = [chat("I need your date.", ("ask_owner", {"question": "Which day?", "options": ["Monday", "Tuesday"]})),
                    chat("Lunch is at noon.")]
    await typed(agent, "Arrange a visit")
    [asked] = await agent.turns()
    [question] = asked["owner_questions"]
    await typed(agent, "When is lunch?")
    page = await agent.rpc.call("agent.history.list", {"limit": 1})
    assert len(page["turns"]) == 1 and page["turns"][0]["id"] != asked["id"]
    assert [item["id"] for item in page["pending_questions"]] == [question["id"]]
    assert not background.service.owner_questions.in_conversation(conversation_id=99999, member_id=0)
    if how == "bring":
        moved = (await background.rpc.call("owner_questions.bring", {"id": question["id"]}))["turn_id"]
        assert moved != asked["id"]
        # Brought again, it stays where it now is.
        assert (await background.rpc.call("owner_questions.bring", {"id": question["id"]}))["turn_id"] == moved
    background.client.replies = [report("Scheduled for Tuesday.")]
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": "Tuesday"})
    await until(lambda: background.task(question["task_id"]).state in ("done", "failed", "limit"))
    turns = sorted(await agent.turns(), key=lambda item: item["id"])
    assert [item["id"] for item in turns][:2] == [asked["id"], turns[1]["id"]] and len(turns) == 3
    last = turns[-1]
    assert last["question"] == "" and [item["id"] for item in last["owner_questions"]] == [question["id"]]
    assert not turns[0].get("owner_questions")
    assert background.task(question["task_id"]).turn_id == last["id"]
    assert "Scheduled for Tuesday" in background.task(question["task_id"]).report_text


@pytest.mark.parametrize("stored_member", [0, None])
async def test_the_chiefs_pending_question_is_available_outside_the_loaded_page(wired, client, stored_member):
    agent, background = wired
    client.chats = [chat("Choose a day.", ("ask_owner", {"question": "Which day?", "options": ["Tuesday"]})),
                    chat("Lunch is at noon.")]
    await typed(agent, "Arrange a visit")
    [asked] = await agent.turns()
    [question] = asked["owner_questions"]
    conversation_id = agent.service.conversations.main(0)
    saved = agent.conn.execute("SELECT member_id, conversation_id FROM agent_turns WHERE id=?", (asked["id"],)).fetchone()
    assert tuple(saved) == (0, conversation_id)
    await typed(agent, "When is lunch?")
    if stored_member is None:
        # The current schema writes chief turns as 0; shadow it to exercise nullable compatibility rows.
        agent.conn.execute("CREATE TEMP TABLE agent_turns AS SELECT * FROM main.agent_turns")
        agent.conn.execute("UPDATE agent_turns SET member_id=NULL WHERE id=?", (asked["id"],))
    page = await agent.rpc.call("agent.history.list", {"limit": 1, "member_id": 0, "conversation_id": conversation_id})
    assert [item["id"] for item in page["turns"]] != [asked["id"]]
    assert len(page["turns"]) == 1
    assert [item["id"] for item in page["pending_questions"]] == [question["id"]]
    assert not background.service.owner_questions.in_conversation(conversation_id=conversation_id + 1, member_id=0)
    assert not background.service.owner_questions.in_conversation(conversation_id=conversation_id, member_id=1)


async def test_a_dismissed_or_latest_question_stays_where_it_is(wired, client):
    agent, background = wired
    client.chats = [chat("I need your date.", ("ask_owner", {"question": "Which day?", "options": ["Monday"]}))]
    await typed(agent, "Arrange a visit")
    [asked] = await agent.turns()
    [question] = asked["owner_questions"]
    assert (await background.rpc.call("owner_questions.bring", {"id": question["id"]}))["turn_id"] == asked["id"]
    background.client.replies = [report("No date chosen.")]
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": None})
    await until(lambda: background.task(question["task_id"]).state in ("done", "failed", "limit"))
    assert [item["id"] for item in await agent.turns()] == [asked["id"]]
    with pytest.raises(Exception):
        await background.rpc.call("owner_questions.bring", {"id": question["id"]})


async def test_room_speech_cannot_open_an_owner_question(wired):
    agent, background = wired
    with agent.conn:
        room_id = agent.conn.execute("INSERT INTO rooms(name,created) VALUES ('Scheduling',0)").lastrowid
    origin = agent.history.add(session_id="room-question", question="Arrange a visit", route="room", prefix="", text="",
        status="running", scope="room", room_id=room_id, thread_id=room_id)
    background.client.replies = [turn("", [call("ask_owner", {"question": "Which day?"}, "ask-day")]), report("Discuss the next step privately.")]
    task_id = background.submit()
    background.service.attach_turn(task_id, origin)
    await until(lambda: background.task(task_id).state in ("done", "failed", "limit"))
    assert not background.service.owner_questions.for_turn(origin)
    assert not background.service.owner_questions.in_conversation(room_id=room_id)
    offered = {item["function"]["name"] for item in background.client.chat_calls[0]["tools"]}
    assert "ask_owner" not in offered


async def test_background_page_uses_existing_store_and_foreign_routines_stay_closed(wired):
    agent, background = wired
    origin = agent.history.add(session_id="job", question="Prepare", route="delegate", prefix="", text="",
                               status="running", conversation_id=agent.service.conversations.main())
    task_id = background.submit()
    background.service.attach_turn(task_id, origin)
    task = background.task(task_id)
    result = await agent.service.background_owner_tool(task, "show_page", {"title": "Choose", "html": "<button>Pick</button>"})
    assert result.ok
    assert agent.service.pages.store.shown_in([origin])[origin][0]["id"] == result.data["page_id"]
    for name in ("open", "copy_text", "computer"):
        assert not (await agent.service.background_owner_tool(task, name, {})).ok
    assert (await agent.service.background_owner_tool(task, "routine_list", {"member_id": 99})).error == "own_routines_only"
    await background.service._cancel({"task_id": task_id})


async def test_a_background_report_shows_its_card_without_waiting_for_the_owner(wired):
    agent, background = wired
    origin = agent.history.add(session_id="job", question="Report", route="delegate", prefix="", text="",
                               status="running", conversation_id=agent.service.conversations.main())
    task_id = background.submit()
    background.service.attach_turn(task_id, origin)
    task = background.task(task_id)
    report = {"sections": [{"kind": "text", "title": "Week", "text": "Three tasks finished."}]}
    shown = await agent.service.background_owner_tool(task, "show_page", {"title": "Weekly report", "report": report})
    assert shown.ok and "owner_card" not in shown.data
    [card] = agent.service.pages.store.shown_in([origin])[origin]
    assert card["id"] == shown.data["page_id"] and card["kind"] == "report"
    page = await agent.service.background_owner_tool(task, "show_page", {"title": "Choose", "html": "<button>Pick</button>"})
    assert page.data["owner_card"]["kind"] == "show_page"
    await background.service._cancel({"task_id": task_id})


@pytest.mark.parametrize("name", ["connect_app", "request_secret", "email_draft", "show_page"])
@pytest.mark.parametrize("cancel", [False, True])
@pytest.mark.parametrize("scope", ["private", "room"])
async def test_real_background_cards_reach_history_and_return_only_the_outcome(wired, tmp_path, name, cancel, scope):
    agent, background = wired
    cleanup = None
    if name == "connect_app":
        from test_connect_cards import Rig, GoogleFixture
        connector = Rig(tmp_path, agent.conn, GoogleFixture("background"))
        await connector.configure()
        agent.service._cards = connector.cards
        connector.cards.resume = agent.service.resume_turn
        cleanup = connector
        arguments = {"app": "gmail"}
    elif name == "request_secret":
        from test_secret_cards import Rig
        secret = Rig(tmp_path, agent.conn)
        await secret.connection()
        agent.service._secret_cards = secret.cards
        secret.cards.resume = agent.service.resume_turn
        arguments = {"connection": "Weather"}
    elif name == "email_draft":
        from raphael_core.agent.drafts import EmailDrafts
        agent.service._drafts = EmailDrafts(agent.conn, background.plugins.hub, background.gate)
        arguments = {"to": "owner@example.test", "subject": "Report", "body": "Prepared."}
    else:
        arguments = {"title": "Choose", "html": "<button>Tuesday</button>"}
    room_id = None
    if scope == "room":
        with agent.conn:
            room_id = agent.conn.execute("INSERT INTO rooms(name,created) VALUES ('Report room',0)").lastrowid
    origin = agent.history.add(session_id="job", question="Prepare report", route="delegate", prefix="", text="",
                               status="running", source="routine", scope="private", conversation_id=agent.service.conversations.main())
    background.client.replies = [turn("Your card is ready.", [call(name, arguments, "actual-card")])]
    task_id = background.submit()
    background.service.attach_turn(task_id, origin)
    with agent.conn:
        agent.conn.execute("UPDATE worker_tasks SET report_room_id=?,report_thread_id=? WHERE id=?", (room_id,room_id,task_id))
    await until(lambda: background.task(task_id).state == "waiting")
    assert not background.service.owner_questions.in_conversation(room_id=room_id) if room_id else True
    [view] = agent.service._turn_views([agent.history.get(origin)])
    assert view[{"connect_app": "connectors", "request_secret": "secrets", "email_draft": "drafts", "show_page": "pages"}[name]]
    [question] = view["owner_questions"]
    background.client.replies = [report("Owner cancelled." if cancel else "Owner finished.")]
    if cancel:
        await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": None})
    elif name == "connect_app":
        await connector.connect(connector.cards.store.get(question["card_id"]))
    elif name == "request_secret":
        await secret.router.call("integrations.card_save", {"id": question["card_id"], "value": "synthetic-secret-value"})
    elif name == "email_draft":
        draft = agent.service._drafts.store.get(question["card_id"])
        agent.service._drafts.store.claim_send(draft.id, draft.digest)
        agent.service._drafts.store.finish(draft.id, draft.digest, ok=True)
        agent.service.sync_owner_cards()
    else:
        await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": "Tuesday"})
    await until(lambda: background.task(task_id).state == "done")
    content = background.client.chat_calls[-1]["messages"][-1]["content"]
    assert "synthetic-secret-value" not in content
    assert ("cancelled" if cancel else {"connect_app": "connected", "request_secret": "saved", "email_draft": "sent", "show_page": "Tuesday"}[name]) in content
    if name == "show_page":
        assert question["card_id"] in content  # The resumed task can update the page it just showed.
    if cleanup:
        await cleanup.cards.aclose()


async def test_room_draft_revisions_stay_in_their_room(wired):
    from raphael_core.agent.drafts import EmailDrafts
    agent, background = wired
    agent.service._drafts = EmailDrafts(agent.conn, background.plugins.hub, background.gate)
    tasks = []
    for name in ("Research", "Scheduling"):
        with agent.conn:
            room_id = agent.conn.execute("INSERT INTO rooms(name,created) VALUES (?,0)", (name,)).lastrowid
        origin = agent.history.add(session_id=name, question="Draft a report", route="delegate", prefix="", text="",
            status="running", scope="room", room_id=room_id, thread_id=room_id)
        task_id = background.service._store.create(session_id=name, text="Draft a report", language="en")
        background.service.attach_turn(task_id, origin)
        tasks.append(background.task(task_id))
    arguments = {"to": "owner@example.test", "subject": "Research report", "body": "Prepared."}
    first = await agent.service.background_owner_tool(tasks[0], "email_draft", arguments)
    second = await agent.service.background_owner_tool(tasks[1], "email_draft", {**arguments, "subject": "Scheduling report", "revise": True})
    first_id, second_id = first.data["owner_card"]["id"], second.data["owner_card"]["id"]
    assert first_id != second_id
    revised = await agent.service.background_owner_tool(tasks[0], "email_draft", {**arguments, "subject": "Revised research", "revise": True})
    assert revised.data["owner_card"]["id"] == first_id
    assert agent.service._drafts.store.get(second_id).subject == "Scheduling report"
    assert agent.service._drafts.store.get(first_id).turn_id == tasks[0].turn_id
    assert agent.service._drafts.store.open_in_chat(agent.service._drafts.store.get(first_id).holder_id, None) is None


async def test_allow_all_still_asks_what_only_the_owner_knows(wired, client):
    agent, background = wired
    agent.settings.set("action_mode", "bypass")
    client.chats = [chat("I need your date.", ("ask_owner", {"question": "Which day?", "options": ["Monday", "Tuesday"]}))]
    await typed(agent, "Arrange a visit")
    [turn] = await agent.turns()
    [question] = turn["owner_questions"]
    assert question["state"] == "asked" and turn["task"]["state"] == "waiting"
    background.client.replies = [report("Scheduled.")]
    await background.rpc.call("owner_questions.answer", {"id": question["id"], "answer": "Tuesday"})
    await until(lambda: background.task(question["task_id"]).state in ("done", "failed", "limit"))
    assert background.task(question["task_id"]).state == "done"
