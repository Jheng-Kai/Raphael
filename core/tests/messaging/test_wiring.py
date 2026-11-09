"""The messaging service inside the whole core: a message goes through the same entry as a spoken
question, and a report of the background worker reaches the chat that handed the task over."""

import asyncio
from types import SimpleNamespace

import pytest

from raphael_core.app import App


@pytest.fixture
async def app(tmp_path):
    made = App(data_dir=tmp_path, fake_llm=True, load_kit=lambda: SimpleNamespace())
    yield made
    await made.aclose()


async def test_the_telegram_methods_are_registered(app):
    assert "messaging.telegram.status" in app.methods()
    assert (await app.call("messaging.telegram.status", {}))["connected"] is False


@pytest.mark.parametrize("kind", ["telegram", "slack", "discord"])
async def test_quiet_member_background_completion_returns_full_result_to_platform(app, monkeypatch, kind):
    member = app.members.store.create_member(name="Platform member", role="Writer")
    sent = []
    async def report(session, text, **kwargs):
        sent.append((session, text))
    monkeypatch.setattr(app.messaging, "report", report)
    store = app.background._store
    session = f"{kind}:42"
    identifier = store.create(session_id=session, language="en", text="Write the full result", member_id=member.id)
    paragraphs = ["First part " + "x" * 3000, "Final result"]
    full = "\n\n".join(paragraphs)
    store.finish(identifier, "done", prefix="", text=full, detail="Work receipts only", reason=None)
    assert store.get(identifier).quiet
    # Simulate restart: the in-memory forwarding cache is empty.
    app._worker_notice("worker.changed", {"task_id": identifier, "state": "done"})
    await asyncio.sleep(0)
    assert sent == [(session, full)]


@pytest.mark.parametrize("background", [False, True])
async def test_telegram_receives_readable_forms_from_conversation_and_background(app, monkeypatch, background):
    source = '```chart\n{"type":"line","title":"Visitors","units":"people","labels":["Mon"],"series":[{"name":"Visits","values":[3]}]}\n```'
    if background:
        sent = []

        async def report(session, text):
            sent.append(text)

        monkeypatch.setattr(app.messaging, "report", report)
        task_id = app.background._store.create(session_id="telegram:42", language="en", text="report")
        app.background._store.finish(task_id, "done", prefix="", text=source, detail=None, reason=None)
        app._worker_notice("worker.report", {"task_id": task_id})
        await asyncio.sleep(0)
        [text] = sent
    else:
        async def call(method, params=None):
            return {"status": "done", "prefix": "", "text": source}

        monkeypatch.setattr(app, "call", call)
        result = await app._ask_from_messaging("telegram:42", "report", "en", "telegram")
        text = result.text
    assert text == "Visitors\nMon: Visits 3 people"


async def test_a_message_is_asked_like_a_spoken_question_and_lands_in_the_history(app):
    text = await app._ask_from_messaging("telegram:42", "你好", "zh-TW", "telegram")
    assert text.strip()
    turns = (await app.call("agent.history.list", {}))["turns"]
    assert [t["session_id"] for t in turns] == ["telegram:42"]
    assert turns[0]["question"] == "你好"
    assert turns[0]["source"] == "telegram"


@pytest.mark.parametrize("kind", ["telegram", "slack", "discord"])
async def test_private_messaging_after_fold_appends_to_main(tmp_path, monkeypatch, kind):
    from raphael_core import paths
    from raphael_core.agent.conversations import Conversations
    from raphael_core.agent.history import AgentHistory
    from raphael_core.brain import db

    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 67)
        connection = db.connect(paths.db_path(tmp_path))
    main = Conversations(connection).main()
    extra = connection.execute("INSERT INTO conversations(member_id,title,created_at_ms,updated_at_ms) VALUES(0,'Old',1,2)").lastrowid
    with connection:
        previous = connection.execute(
            "INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status,conversation_id)"
            " VALUES(1,'previous-message','Earlier message','answer','','Saved answer','done',?)", (extra,),
        ).lastrowid
        AgentHistory(connection)._index(previous, "Earlier message", "Saved answer", None)
    connection.commit()
    connection.close()
    app = App(data_dir=tmp_path, fake_llm=True, load_kit=lambda: SimpleNamespace())
    try:
        answer = await app._ask_from_messaging(f"{kind}:42", "Continue reviewing", "en", kind)
        assert answer.strip()
        turns = (await app.call("agent.history.list"))["turns"]
        assert len(turns) == 2 and {t["conversation_id"] for t in turns} == {main}
        assert next(t for t in turns if t["id"] == previous)["text"] == "Saved answer"
        assert next(t for t in turns if t["id"] != previous)["source"] == kind
    finally:
        await app.aclose()


@pytest.mark.parametrize("kind", ["telegram", "slack", "discord"])
async def test_a_question_that_needs_a_yes_is_refused_not_left_open(app, monkeypatch, kind):
    calls = []
    real = app.call

    async def call(method, params=None):
        calls.append(method)
        if method == "agent.ask":
            return {
                "status": "confirm",
                "turn_id": 0,
                "confirm": {"id": "c1", "prefix": "《問》", "text": "開啟嗎？"},
            }
        return await real(method, params)

    monkeypatch.setattr(app, "call", call)
    text = await app._ask_from_messaging(f"{kind}:42", "open it", "en", kind)
    assert "confirmation" in text.lower()
    assert calls == ["agent.ask", "agent.confirm"]


async def test_the_files_of_a_message_go_to_the_assistant_as_the_app_sends_them(app, monkeypatch):
    from raphael_core.services.attachments import checked, from_wire

    sent = []

    async def call(method, params=None):
        sent.append((method, params))
        return {"status": "done", "prefix": "《答》", "text": "a cat"}

    monkeypatch.setattr(app, "call", call)
    photo = checked("photo.jpg", "image/jpeg", b"\xff\xd8\xff\xe0" + b"\x00" * 16)
    pdf = checked("a.pdf", "application/pdf", b"%PDF-1.7\n")
    text = await app._ask_from_messaging("telegram:42", "", "en", "telegram", attachments=[photo, pdf])
    assert text == "a cat"  # the app strips the 《答。…》 frame, so the chat gets the words only
    [(method, params)] = sent
    assert method == "agent.ask"
    assert params["text"] == "" and params["source"] == "telegram"
    assert from_wire(params["attachments"]) == [photo, pdf]


async def test_a_message_without_files_asks_as_before(app, monkeypatch):
    sent = []

    async def call(method, params=None):
        sent.append(params)
        return {"status": "done", "prefix": "", "text": "hi"}

    monkeypatch.setattr(app, "call", call)
    await app._ask_from_messaging("telegram:42", "hello", "en", "telegram")
    assert "attachments" not in sent[0]


async def test_the_report_of_a_task_from_telegram_is_sent_to_that_chat(app, monkeypatch):
    sent = []

    async def report(session, text):
        sent.append((session, text))

    monkeypatch.setattr(app.messaging, "report", report)
    store = app.background._store
    task_id = store.create(session_id="telegram:42", language="en", text="do")
    store.finish(task_id, "done", prefix="《告》", text="finished", detail="more", reason=None)
    app._worker_notice("worker.report", {"task_id": task_id})
    await asyncio.sleep(0)
    # With no reply written by this process, the stored detail (the whole report) is sent, unframed.
    assert sent == [("telegram:42", "finished")]


async def test_a_background_report_reaches_telegram_whole(app, monkeypatch):
    """The conclusion of a long report is not lost to the one-line `report_text`."""
    sent = []

    async def report(session, text, **kw):
        sent.append((session, text))

    monkeypatch.setattr(app.messaging, "report", report)
    store = app.background._store
    full = "Findings\n\n- first point " + "x" * 120 + "\n- second point\n\n**Conclusion:** ship it."
    task_id = store.create(session_id="telegram:42", language="en", text="do")
    store.finish(task_id, "done", prefix="《告》", text="Findings", detail=None, reason=None)
    app.background._final_words[task_id] = [full]
    app._worker_notice("worker.report", {"task_id": task_id})
    await asyncio.sleep(0)
    assert sent == [("telegram:42", full)]
    assert len(full) > 90 and "\n" in full and full.endswith("ship it.")


async def test_a_limit_report_sends_its_whole_last_word(app, monkeypatch):
    sent = []

    async def report(session, text, **kw):
        sent.append(text)

    monkeypatch.setattr(app.messaging, "report", report)
    store = app.background._store
    task_id = store.create(session_id="telegram:42", language="en", text="do")
    whole = "Done: A, B. Not done: C. Next: " + "d" * 400
    store.finish(task_id, "limit", prefix="", text=whole[:100] + "…", detail=whole, reason="limit_steps")
    app._worker_notice("worker.report", {"task_id": task_id})
    await asyncio.sleep(0)
    assert sent == [whole]


async def test_a_conclusion_of_several_messages_is_sent_message_by_message(app, monkeypatch):
    sent = []

    async def report(session, text, **kw):
        sent.append(text)

    monkeypatch.setattr(app.messaging, "report", report)
    store = app.background._store
    task_id = store.create(session_id="telegram:42", language="en", text="do")
    store.finish(task_id, "done", prefix="《告》", text="one", detail=None, reason=None)
    app.background._final_words[task_id] = ["《告。One", "Two", "Three》"]
    app._worker_notice("worker.report", {"task_id": task_id})
    await asyncio.sleep(0)
    assert sent == [["One", "Two", "Three"]]


def test_the_frame_is_stripped_like_the_app_does():
    from raphael_core.messaging.words import plain_replies

    assert plain_replies(["《答。First", "Second", "Last》"]) == ["First", "Second", "Last"]
    assert plain_replies(["《Answer. Done》"]) == ["Done"]
    assert plain_replies(["《告。a", "b》", "《答。c》"]) == ["a", "b", "c"]
    # A book title is no frame.
    assert plain_replies(["Read《三體》", "《三體》 is good"]) == ["Read《三體》", "《三體》 is good"]


async def test_every_message_of_a_foreground_reply_is_sent_in_order(app, monkeypatch):
    async def call(method, params=None):
        return {"status": "done", "prefix": "《答》", "text": "Third",
                "messages": ["《答。First", "Second", "Third》"]}

    monkeypatch.setattr(app, "call", call)
    answer = await app._ask_from_messaging("telegram:42", "q", "en", "telegram")
    assert answer.parts == ["First", "Second", "Third"]
    assert answer.text == "First\n\nSecond\n\nThird"


async def test_the_report_of_a_spoken_task_is_not_sent(app, monkeypatch):
    sent = []

    async def report(session, text):
        sent.append(session)

    monkeypatch.setattr(app.messaging, "report", report)
    store = app.background._store
    task_id = store.create(session_id="overlay-1", language="en", text="do")
    store.finish(task_id, "done", prefix="《告》", text="finished", detail=None, reason=None)
    app._worker_notice("worker.report", {"task_id": task_id})
    await asyncio.sleep(0)
    assert sent == []


async def test_stop_with_nothing_running_says_so(app):
    assert await app._stop_from_messaging("telegram:42") is False


async def test_stop_from_a_chat_stops_that_chats_tasks_and_turn_only(app, monkeypatch):
    stopped = []

    async def cancel_session(session):
        stopped.append(("worker", session))
        return False

    monkeypatch.setattr(app.background, "cancel_session", cancel_session)
    monkeypatch.setattr(app.agent, "stop_session", lambda s: stopped.append(("agent", s)) or True)
    assert await app._stop_from_messaging("telegram:42") is True
    assert stopped == [("agent", "telegram:42"), ("worker", "telegram:42")]


@pytest.mark.parametrize("room", [False, True])
async def test_a_voice_message_is_heard_with_the_dictation_engine_and_normalized(app, monkeypatch, room):
    import numpy as np

    from raphael_core.messaging import voice

    heard = []

    class Engine:
        def transcribe(self, samples, hints=()):
            heard.append((samples.size, list(hints)))
            return "你好"

    class Segmenter:
        def __init__(self, path, max_segment_s):
            self.max = max_segment_s

        def accept(self, samples):
            return [samples]

        def flush(self):
            return []

    monkeypatch.setattr(voice, "decoded_blocks", lambda audio: iter([np.zeros(1600, dtype="float32")]))
    monkeypatch.setattr(app, "_dictation_engine", lambda: Engine())
    app._kit = __import__("concurrent.futures").futures.Future()
    app._kit.set_result(SimpleNamespace(Segmenter=Segmenter))
    await app.call("dictionary.add", {"word": "Raphael"})
    calls = []
    original = app.call

    async def call(method, params):
        calls.append((method, params))
        return await original(method, params)

    monkeypatch.setattr(app, "call", call)
    text = await (app._transcribe_room(b"opus", "en") if room else app._transcribe_from_messaging(b"opus", "en"))
    assert text == "你好"
    assert heard == [(1600, ["Raphael"])]
    if room:
        assert any(method == "brain.finalize_dictation" and params["purpose"] == "agent" for method, params in calls)
        [history] = (await app.call("history.list", {}))["items"]
        assert history["kind"] == "ask" and history["target_app"] is None
        assert history["raw_text"] == history["text"] == text
        assert (await app.call("history.latest", {}))["item"] is None
