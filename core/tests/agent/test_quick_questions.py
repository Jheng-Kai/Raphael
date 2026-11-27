"""A quick question is one more turn of Raphael's one conversation, answered the quick way, on the ordinary turn stream."""

import json
import asyncio
import sqlite3
from dataclasses import replace

import pytest

from raphael_core.agent.conversations import Conversations
from raphael_core.brain.db import connect
from raphael_core.brain.openrouter import ChatTurn
from raphael_core.protocol import INVALID_PARAMS, RpcError
from .test_service import make_rig  # noqa: F401
from .test_narration import chat
from .conftest import decision


@pytest.mark.parametrize("saved,levels,expected", [("medium", ("low", "high"), "low"), ("none", ("low", "high"), "low"), ("high", (), "none")])
async def test_api_effort_respects_selected_models_supported_levels(make_rig, client, saved, levels, expected):
    from .test_plugin_model import llm
    entry = replace(llm("openai/quick"), reasoning_efforts=levels)
    rig = make_rig(models=lambda: [entry])
    rig.settings.set("quick_model", entry.id)
    rig.settings.set("quick_effort", saved)
    client.chats.append(chat('{"text":"Hello","prefix":"Answer"}'))
    await rig.call("agent.ask", {"session_id": "effort", "text": "Hello", "ui_language": "en",
        "source": "app", "destination": "quick", "conversation_id": rig.service.conversations.main(0)})
    assert client.chat_calls[-1]["reasoning_effort"] == expected


async def test_quick_effort_is_independent_of_the_answers_reference_effort(make_rig, client):
    from .test_plugin_model import llm
    entry = replace(llm("openai/reasoner"), reasoning_efforts=("low", "high"))
    rig = make_rig(models=lambda: [entry])
    rig.settings.set("agent_model", entry.id + "?effort=high")
    rig.settings.set("quick_model", entry.id)
    rig.settings.set("quick_effort", "low")
    client.chats.append(chat('{"text":"Quick answer","prefix":"Answer"}'))
    await rig.call("agent.ask", {"session_id": "quick-effort", "text": "Hello", "ui_language": "en",
        "source": "app", "destination": "quick", "conversation_id": rig.service.conversations.main(0)})
    assert client.chat_calls[-1]["model"] == entry.id
    assert client.chat_calls[-1]["reasoning_effort"] == "low"
    settings = rig.service._read_settings()
    assert settings.model == entry.id + "?effort=high" and rig.service._effort(settings) == "high"


def test_an_old_database_ends_with_one_conversation_for_raphael_and_never_makes_a_quick_one(tmp_path):
    from raphael_core.brain import db
    path = tmp_path / "v27.db"
    with sqlite3.connect(path) as raw:
        for version in range(1, 28):
            step = db._MIGRATIONS[version]
            step(raw) if callable(step) else raw.executescript(step)
        raw.execute("UPDATE conversations SET title='Formal' WHERE id=1")
    conn = connect(path)
    try:
        store = Conversations(conn)
        assert store.get(1)["title"] == "Formal" and store.get(1)["kind"] == "standard"
        assert [(row["id"], row["kind"]) for row in store.list(0)] == [(1, "standard")]
        assert store.destination(0, None, quick=True) == 1 and not hasattr(store, "quick")
        assert conn.execute("SELECT COUNT(*) FROM conversations WHERE kind = 'quick'").fetchone()[0] == 0
    finally:
        conn.close()


async def test_a_quick_question_is_written_to_raphaels_one_conversation_and_reads_what_was_typed_there(make_rig, client):
    notices = []
    rig = make_rig(notify=lambda method, params: notices.append((method, params)))
    main = rig.service.conversations.main()
    rig.seed("typed earlier", "private project", conversation_id=main)
    for n in range(2):
        client.decisions.append(decision("unclear"))
        client.chats.append(chat('{"progress":"Checking the clock.","text":"Noon","prefix":"Answer"}'))
        result = await rig.call("agent.ask", {"session_id": f"quick-{n}", "text": f"question {n}",
            "ui_language": "en", "destination": "quick"})
        assert result["status"] == "done"
    assert [t.question for t in rig.history.list(conversation_id=main)] == ["question 1", "question 0", "typed earlier"]
    assert "typed earlier" in json.dumps(client.chat_calls[0]) and "question 0" in json.dumps(client.chat_calls[-1])
    assert len(client.decide_calls) == 2
    assert not client.json_calls
    progress = [p for m, p in notices if m == "agent.progress"]
    assert len(progress) == 2
    assert progress[0]["text"] == rig.history.messages([result["turn_id"]])[result["turn_id"]][0]["text"]
    assert [(c["id"], c["kind"]) for c in (await rig.call("conversations.list"))["conversations"]] == [(main, "standard")]
    assert rig.conn.execute("SELECT COUNT(*) FROM conversations WHERE kind = 'quick'").fetchone()[0] == 0


@pytest.mark.parametrize("selected,expected", [("", ""), ("openai/quick", "openai/quick")])
async def test_model_and_effort_follow_the_quick_flag_not_the_conversation(make_rig, client, selected, expected):
    rig = make_rig()
    rig.settings.set("quick_model", selected)
    rig.settings.set("quick_effort", "medium")
    main = rig.service.conversations.main()
    for source in ("voice", "app"):
        if source == "voice":
            client.decisions.append(decision("unclear"))
        client.chats.append(chat('{"text":"Hello","prefix":"Answer"}'))
        await rig.call("agent.ask", {"session_id": source, "text": "Hello", "ui_language": "en",
            "source": source, "destination": "quick", "conversation_id": main})
        if not expected:
            assert client.chat_calls == []
            continue
        assert client.chat_calls[-1]["model"] == expected
        assert client.chat_calls[-1]["reasoning_effort"] == "medium"
    # the same conversation, asked without the flag, is answered by the answer model at its own effort
    client.chats.append(chat('{"text":"Hello","prefix":"Answer"}'))
    await rig.call("agent.ask", {"session_id": "typed", "text": "Hello", "ui_language": "en",
        "source": "app", "conversation_id": main})
    assert client.chat_calls[-1]["reasoning_effort"] == "none"
    assert rig.service._read_settings(quick=True).quick and not rig.service._read_settings().quick


async def test_overlay_retains_full_quick_history_below_half_window(make_rig, client):
    rig = make_rig()
    quick = rig.service.conversations.main(0)
    for n in range(12):
        rig.seed(f"quick-seed-{n:02}", "Earlier answer", conversation_id=quick)
    client.chats.append(chat('{"text":"Hello","prefix":"Answer"}'))
    await rig.call("agent.ask", {"session_id": "overlay", "text": "Hello", "ui_language": "en", "source": "overlay",
                                 "destination": "quick"})
    prompt = json.dumps(client.chat_calls[-1])
    assert "quick-seed-00" in prompt
    assert "quick-seed-05" in prompt
    assert "quick-seed-06" in prompt and "quick-seed-11" in prompt
    assert client.chat_calls[-1]["reasoning_effort"] == "low"


async def test_latency_logs_only_timings(make_rig, client, caplog):
    rig = make_rig()
    client.decisions.append(decision("unclear"))
    client.chats.append(chat('{"progress":"Public step","prefix":"Answer","text":"PRIVATE_WORD_SENTINEL"}'))
    caplog.set_level("INFO", logger="raphael_core.agent.service")
    await rig.call("agent.ask", {"session_id": "timed", "text": "QUESTION_SENTINEL", "ui_language": "en", "transcript_ms": 25,
                                 "destination": "quick"})
    records = [r for r in caplog.records if r.msg == "Quick latency ms: %s"]
    trace = json.loads(records[-1].args[0])
    assert "speech_start" not in trace
    assert 25 <= trace["routing"] <= trace["first_step"] <= trace["final_answer"]
    assert "SENTINEL" not in " ".join(r.getMessage() for r in records)
    assert not rig.service._latency_traces


@pytest.mark.parametrize("source", ["voice", "app"])
async def test_quick_cli_passes_effort_rebuilds_a_legacy_session_then_resumes(make_rig, client, tmp_path, monkeypatch, source):
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Event
    from raphael_core.agent.cli import loop as production

    calls = []

    class Driver:
        def __init__(self, *args, **kwargs):
            self.effort = kwargs["effort"]

        async def run(self, **kwargs):
            calls.append({**kwargs, "effort": self.effort})
            yield Event("session", "new-native-session")
            yield Event("final", "Quick answer.")

        async def interrupt(self):
            pass

    monkeypatch.setattr(production, "Driver", Driver)
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    brains._models["codex"] = [{"id": "cli:codex:fast", "reasoning_efforts": ["low", "medium"]}]
    rig = make_rig(cli_brains=brains)
    quick = rig.service.conversations.main(0)
    rig.settings.set("quick_model", "cli:codex:fast")
    for n in range(12):
        rig.seed(f"quick-seed-{n:02}", "Earlier answer", conversation_id=quick)
    model = "cli:codex:fast?effort=low"
    rig.service._cli_sessions.put(0, model, "unbounded-native-history", quick)
    result = await rig.call("agent.ask", {"session_id": "cli", "text": "Hello", "ui_language": "en", "source": source,
        "destination": "quick", "conversation_id": quick})
    assert result["text"] == "Quick answer."
    assert calls[0]["session"] is None and calls[0]["effort"] == "low"
    assert "quick-seed-00" in calls[0]["user"]
    assert "quick-seed-11" in calls[0]["user"]
    assert rig.service._cli_sessions.get(0, model, quick) == "new-native-session"
    await rig.call("agent.ask", {"session_id": "cli-next", "text": "Continue", "ui_language": "en", "source": source,
        "destination": "quick", "conversation_id": quick})
    assert calls[1]["session"] == "new-native-session" and calls[1]["effort"] == "low"
    assert "quick-seed-00" not in calls[1]["user"] and "quick-seed-11" not in calls[1]["user"]
    assert not client.decide_calls and not client.json_calls


async def test_cli_turns_record_the_model_that_answered_and_keep_separate_sessions(make_rig, client, tmp_path, monkeypatch):
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Event
    from raphael_core.agent.cli import loop as production

    runs = []

    class Driver:
        def __init__(self, *args, model, effort, **kwargs):
            self.model, self.effort = model, effort

        async def run(self, *, session, **kwargs):
            runs.append((self.model, self.effort, session))
            # The CLI's thread names the model that really answers, which need not be the one asked for.
            yield Event("model", {"fast": "fast-2026"}.get(self.model, self.model))
            yield Event("session", session or f"thread-{len(runs)}")
            yield Event("final", "Answer.")

        async def interrupt(self):
            pass

    monkeypatch.setattr(production, "Driver", Driver)
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    brains._models["codex"] = [{"id": "cli:codex:fast", "reasoning_efforts": ["low", "medium"]},
                               {"id": "cli:codex:deep", "reasoning_efforts": ["high"]}]
    rig = make_rig(cli_brains=brains)
    rig.settings.set("agent_model", "cli:codex:deep?effort=high")
    rig.settings.set("quick_model", "cli:codex:fast")
    rig.settings.set("quick_effort", "low")
    main = rig.service.conversations.main()
    for n in range(2):
        await rig.call("agent.ask", asking(session=f"quick-{n}", destination="quick"))
        await rig.call("agent.ask", asking(session=f"formal-{n}", source="app", conversation_id=main))
    assert runs == [("fast", "low", None), ("deep", "high", None), ("fast", "low", "thread-1"), ("deep", "high", "thread-2")]
    turns = rig.history.list(conversation_id=main)
    assert {turn.model for turn in turns if turn.session_id.startswith("quick")} == {"cli:codex:fast-2026?effort=low"}
    assert {turn.model for turn in turns if turn.session_id.startswith("formal")} == {"cli:codex:deep?effort=high"}
    # one conversation, one thread per model
    assert rig.service._cli_sessions.get(0, "cli:codex:fast?effort=low", main) == "thread-1"
    assert rig.service._cli_sessions.get(0, "cli:codex:deep?effort=high", main) == "thread-2"


def answered(text):
    """A model's reply that names the model it was, as a provider's response does."""
    return lambda **kwargs: ChatTurn(json.dumps({"prefix": "Answer", "text": text}), [], kwargs["model"], .001, 10, 10, 1)


def asking(**params):
    return {"session_id": params.pop("session", "s"), "text": params.pop("text", "hello"), "ui_language": "en", **params}


@pytest.mark.parametrize("params", [
    {"destination": "quick", "conversation_id": 999999},
    {"source": "app", "conversation_id": 999999},
    {"destination": "formal"},
    {"destination": "QUICK"},
    {"destination": True},
])
async def test_a_wrong_destination_or_conversation_is_refused_and_nothing_runs(make_rig, client, params):
    rig = make_rig()
    main = rig.service.conversations.main()
    with pytest.raises(RpcError) as refused:
        await rig.call("agent.ask", asking(**params))
    assert refused.value.code == INVALID_PARAMS
    assert client.decide_calls == [] and client.chat_calls == []
    assert rig.history.list(conversation_id=main) == []


@pytest.mark.parametrize("params", [{}, {"source": "voice"}, {"source": "overlay"}, {"source": "app"}])
async def test_a_spoken_question_to_raphael_names_no_destination_because_there_is_one_conversation(make_rig, client, params):
    rig = make_rig()
    client.decisions.append(decision("unclear"))
    client.chats.append(chat('{"text":"Hello.","prefix":"Answer"}'))
    reply = await rig.call("agent.ask", asking(**params))
    assert reply["status"] == "done"
    assert [turn.id for turn in rig.history.list(conversation_id=rig.service.conversations.main())] == [reply["turn_id"]]


def test_only_raphael_has_a_quick_destination(conn):
    with pytest.raises(RpcError, match="Raphael"):
        Conversations(conn).destination(1, None, quick=True)


async def test_a_quick_and_a_typed_request_in_turn_are_each_answered_by_their_own_model_in_one_conversation(make_rig, client):
    rig = make_rig()
    rig.settings.set("agent_model", "openai/formal")
    rig.settings.set("quick_model", "openai/quick")
    main = rig.service.conversations.main()
    client.decisions.append(decision("unclear"))
    client.chats = [answered("Quick answer"), answered("Formal answer")]
    quick_reply = await rig.call("agent.ask", asking(session="q", text="QUICK_NONCE", destination="quick"))
    formal_reply = await rig.call("agent.ask", asking(session="f", text="FORMAL_NONCE", source="app", conversation_id=main))
    quick_turn, formal_turn = reversed(rig.history.list(conversation_id=main))
    assert (quick_turn.id, quick_turn.question, quick_turn.text, quick_turn.model) == (
        quick_reply["turn_id"], "QUICK_NONCE", "Quick answer", "openai/quick")
    assert (formal_turn.id, formal_turn.question, formal_turn.text, formal_turn.model) == (
        formal_reply["turn_id"], "FORMAL_NONCE", "Formal answer", "openai/formal")
    quick_call, formal_call = client.chat_calls
    assert quick_call["model"] == "openai/quick" and "FORMAL_NONCE" not in json.dumps(quick_call)
    assert formal_call["model"] == "openai/formal" and "QUICK_NONCE" in json.dumps(formal_call)  # it reads what was said before


@pytest.fixture
def copying_asks_first(monkeypatch):
    from raphael_core.agent import commands
    from raphael_core.agent.policy import Tier
    monkeypatch.setitem(commands.COMMANDS, "copy_text", replace(commands.COMMANDS["copy_text"], tier=Tier.T2))


@pytest.mark.usefixtures("copying_asks_first")
async def test_a_message_typed_in_the_conversation_replaces_the_question_a_quick_ask_left_waiting(make_rig, client, actions):
    # A fixed command for this PC is a quick question's alone (R-PC-01). Its question waits in Raphael's one conversation,
    # so what is typed there next replaces it, as in any conversation.
    rig = make_rig()
    main = rig.service.conversations.main()
    rig.seed("Weather", "24 degrees.", conversation_id=main)
    client.decisions.append(decision("command", "copy_text"))
    waiting = await rig.ask("copy that")
    assert waiting["status"] == "confirm" and waiting["conversation_id"] == main
    client.chats.append(chat('{"text":"Hello."}'))
    typed_reply = await rig.call("agent.ask", asking(session="typed-hello", text="hello", source="app", conversation_id=main))
    assert typed_reply["text"] == "Hello."
    assert not actions.calls
    assert [turn.question for turn in rig.history.list(conversation_id=main)][:2] == ["hello", "copy that"]


@pytest.mark.usefixtures("copying_asks_first")
async def test_a_quick_confirmation_continues_in_the_one_conversation(make_rig, client, actions):
    rig = make_rig()
    main = rig.service.conversations.main()
    rig.seed("Weather", "24 degrees.", conversation_id=main)
    client.decisions.append(decision("command", "copy_text"))
    waiting = await rig.ask("copy that")
    assert waiting["status"] == "confirm" and waiting["conversation_id"] == main
    assert (await rig.confirm(waiting["confirm"]["id"], True))["status"] == "done"
    assert ("copy_to_clipboard", "24 degrees.") in [call[:2] for call in actions.calls]
    assert [(turn.question, turn.status) for turn in rig.history.list(conversation_id=main)] == [
        ("copy that", "done"), ("Weather", "done")]


async def test_a_spoken_quick_question_is_announced_before_the_router_returns(make_rig, client):
    notices = []
    rig = make_rig(notify=lambda method, params: notices.append((method, params)))
    quick = rig.service.conversations.main(0)
    routing, release = asyncio.Event(), asyncio.Event()

    async def slow_route(**kwargs):
        routing.set()
        await release.wait()
        return decision("unclear")

    client.decisions.append(slow_route)
    client.chats.append(answered("Bring an umbrella."))
    request = asyncio.create_task(rig.call(
        "agent.ask", asking(session="quick-transcript", text="Will it rain?", destination="quick"),
    ))
    try:
        await asyncio.wait_for(routing.wait(), 5)
        [pending] = rig.history.list(conversation_id=quick)
        assert (pending.question, pending.status, pending.text) == ("Will it rain?", "running", "")
        assert ("agent.turn", {"turn_id": pending.id, "member_id": 0, "failure": None}) in notices
        assert not request.done()
    finally:
        release.set()
        reply = await asyncio.wait_for(request, 5)
    [finished] = rig.history.list(conversation_id=quick)
    assert finished.id == pending.id == reply["turn_id"]
    assert (finished.status, finished.text) == ("done", "Bring an umbrella.")


async def test_editing_a_quick_transcript_during_routing_keeps_its_place(make_rig, client):
    rig = make_rig()
    quick = rig.service.conversations.main(0)
    routing, release = asyncio.Event(), asyncio.Event()

    async def slow_route(**kwargs):
        routing.set()
        await release.wait()
        return decision("unclear")

    client.decisions.append(slow_route)
    request = asyncio.create_task(rig.call(
        "agent.ask", asking(session="spoken", text="Will it hail?", destination="quick"),
    ))
    try:
        await asyncio.wait_for(routing.wait(), 5)
        [pending] = rig.history.list(conversation_id=quick)
        client.chats.append(answered("Bring an umbrella."))
        await asyncio.wait_for(rig.call("agent.ask", {
            "session_id": "corrected", "text": "Will it rain?", "ui_language": "en",
            "source": "app", "destination": "quick", "replace_turn_id": pending.id,
        }), 5)
    finally:
        release.set()
        await asyncio.wait_for(request, 5)
    [finished] = rig.history.list(conversation_id=quick)
    assert finished.id == pending.id
    assert (finished.question, finished.status, finished.text) == ("Will it rain?", "done", "Bring an umbrella.")


async def test_stop_ends_a_quick_question_in_its_place_and_its_late_answer_writes_nothing(make_rig, client):
    rig = make_rig()
    formal = rig.service.conversations.main()
    rig.seed("FORMAL_SENTINEL", "Formal answer", conversation_id=formal)
    entered, answer = asyncio.Event(), asyncio.Event()

    async def slow(**kwargs):
        entered.set()
        await answer.wait()
        return answered("LATE_ANSWER")(**kwargs)

    client.decisions.append(decision("unclear"))
    client.chats = [slow]
    asked = asyncio.ensure_future(rig.call("agent.ask", asking(session="quick-stop", destination="quick")))
    await asyncio.wait_for(entered.wait(), 5)
    assert await rig.call("agent.history.stop", {"session_id": "quick-stop", "member_id": 0}) == {"stopped": True}
    answer.set()
    reply = await asyncio.wait_for(asked, 5)
    await asyncio.sleep(0)
    stopped, earlier = rig.history.list(conversation_id=formal)
    assert reply["turn_id"] == 0 and stopped.status == "cancelled" and stopped.session_id == "quick-stop"
    assert "LATE_ANSWER" not in json.dumps([stopped.text, stopped.detail, rig.history.messages([stopped.id])])
    assert earlier.question == "FORMAL_SENTINEL" and earlier.text == "Formal answer"


async def test_a_restart_keeps_the_conversation_and_its_context(make_rig, client):
    before = make_rig()
    client.decisions.append(decision("unclear"))
    client.chats.append(answered("BEFORE_RESTART"))
    first = await before.call("agent.ask", asking(session="before", destination="quick"))
    after = make_rig()
    client.decisions.append(decision("unclear"))
    client.chats.append(answered("After restart"))
    second = await after.call("agent.ask", asking(session="after", destination="quick"))
    main = after.service.conversations.main()
    assert main == before.service.conversations.main()
    assert [turn.id for turn in after.history.list(conversation_id=main)] == [second["turn_id"], first["turn_id"]]
    assert "BEFORE_RESTART" in json.dumps(client.chat_calls[-1])
