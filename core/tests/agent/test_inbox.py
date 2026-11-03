import asyncio
import base64
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli import loop as cli
from raphael_core.agent.cli.drivers import Event
from raphael_core.brain.settings import SettingsStore

from .test_service import make_rig, until  # noqa: F401
from .test_narration import chat, typed


async def blocked_cli(make_rig, monkeypatch, tmp_path, brain="claude"):
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    active = 0

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def interrupt(self):
            pass

        async def run(self, **kwargs):
            nonlocal active
            active += 1
            assert active == 1
            calls.append(kwargs)
            try:
                if len(calls) == 1:
                    started.set()
                    await release.wait()
                yield Event("final", f"Answer {len(calls)}")
            finally:
                active -= 1

    monkeypatch.setattr(cli, "Driver", Driver)
    rig = make_rig()
    rig.service._cli_brains.home = tmp_path
    monkeypatch.setattr(rig.service._cli_brains, "command", lambda name: ["fake"])
    monkeypatch.setattr(rig.service._cli_brains, "available", lambda *a, **k: True)
    SettingsStore(rig.conn).set("agent_model", f"cli:{brain}:fake")
    first = asyncio.create_task(typed(rig, "Request A"))
    await asyncio.wait_for(started.wait(), 2)
    return rig, first, release, calls


async def test_cli_busy_input_is_admitted_immediately_and_answers_a_b_c_in_order(make_rig, monkeypatch, tmp_path):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        b = await asyncio.wait_for(typed(rig, "Request B"), .5)
        c = await asyncio.wait_for(typed(rig, "Request C"), .5)
        assert b["status"] == c["status"] == "queued"
        assert [t["question"] for t in reversed(await rig.turns())] == ["Request A", "Request B", "Request C"]
        release.set()
        assert (await first)["text"] == "Answer 1"
        await until(lambda: len(calls) == 3 and not rig.service._drains)
        assert [t["text"] for t in reversed(await rig.turns())] == ["Answer 1", "Answer 2", "Answer 3"]
        assert "Request B" in calls[1]["user"] and "Request C" in calls[2]["user"]
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


async def test_fifty_messages_have_no_cap_and_drain_in_order(make_rig, monkeypatch, tmp_path):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        for n in range(1, 50):
            assert (await asyncio.wait_for(typed(rig, f"Queued request {n:02}"), .5))["status"] == "queued"
        release.set()
        await first
        await until(lambda: len(calls) == 50 and not rig.service._drains)
        for n, call in enumerate(calls[1:], 1):
            assert f"Queued request {n:02}" in call["user"]
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


@pytest.mark.parametrize('with_id', [True, False])
async def test_withdrawn_queued_message_never_calls_the_model(make_rig, monkeypatch, tmp_path, with_id):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        reply = await asyncio.wait_for(typed(rig, "Withdraw this"), .5)
        turn = rig.service.turn(reply["turn_id"])
        await rig.call("agent.history.retract", {"session_id": turn.session_id, **({'turn_id': turn.id} if with_id else {})})
        release.set()
        await first
        await until(lambda: not rig.service._drains)
        assert len(calls) == 1
        row = rig.conn.execute("SELECT state,outcome FROM agent_inbox WHERE turn_id=?", (turn.id,)).fetchone()
        assert tuple(row) == ("terminal", "cancelled")
        assert 'Withdraw this' not in rig.service._history.sent(50)
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


async def test_stop_returns_all_queued_payloads_in_order_and_does_not_drain(make_rig, monkeypatch, tmp_path):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path)
    try:
        b = await asyncio.wait_for(typed(rig, "Second request"), .5)
        attachment = {"name": "example.txt", "mime": "text/plain", "data": base64.b64encode(b"example").decode()}
        await asyncio.wait_for(rig.call("agent.ask", {"session_id": "with-file", "source": "app", "text": "Third request", "ui_language": "en", "attachments": [attachment]}), .5)
        running = next(t for t in await rig.turns() if t["status"] == "running")
        stopped = await rig.call("agent.history.stop", {"session_id": running["session_id"]})
        assert [item["text"] for item in stopped["returned"]] == ["Second request", "Third request"]
        assert stopped["returned"][1]["attachments"][0]["name"] == "example.txt"
        release.set()
        await first
        await until(lambda: not rig.service._drains)
        assert len(calls) == 1
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


@pytest.mark.parametrize('ending', ['failure', 'limit', 'cancel'])
async def test_unread_steer_survives_loop_end_as_the_next_turn(make_rig, client, ending):
    rig = make_rig()
    started, release = asyncio.Event(), asyncio.Event()

    async def failing(**kwargs):
        started.set()
        await release.wait()
        if ending == 'limit':
            from raphael_core.worker.loop import Stop
            raise Stop('limit_model')
        raise ValueError("synthetic failure")

    client.chats = [failing, *([chat("Reached the limit")] if ending == 'limit' else []), chat("Recovered addition")]
    first = asyncio.create_task(typed(rig, "Original"))
    await asyncio.wait_for(started.wait(), 2)
    assert (await typed(rig, "Important addition"))["steered"]
    if ending == 'cancel':
        await rig.call('agent.cancel', {'session_id': 'live'})
    release.set()
    await asyncio.gather(first, return_exceptions=True)
    await until(lambda: any(t.text == "Recovered addition" for t in rig.service._history.list()))
    assert "Important addition" in str(client.chat_calls[-1]["messages"])


def test_owner_input_tickets_distinguish_read_from_leftover():
    from raphael_core.worker.owner_input import OwnerInput
    inbox = OwnerInput()
    assert inbox.add("Read", ticket="one")
    assert inbox.drain() == [{"role": "user", "content": "Read"}]
    assert inbox.add("Unread", ticket="two")
    assert inbox.consumed("one")
    assert inbox.leftover() == ["two"]
    assert not inbox.consumed("two")


@pytest.mark.parametrize("refused", [False, True])
async def test_codex_steer_uses_the_active_ids_and_refusal_does_not_fail_the_turn(refused):
    from raphael_core.agent.cli.drivers import Driver
    driver = Driver("codex", ["fake"])
    packets, sent = asyncio.Queue(), []
    ready = asyncio.Event()

    async def send(packet):
        sent.append(packet)
        method = packet.get('method')
        if method == 'initialize':
            await packets.put({'id': packet['id'], 'result': {}})
        elif method == 'thread/start':
            await packets.put({'id': packet['id'], 'result': {'thread': {'id': 'thread-one'}}})
        elif method == 'turn/start':
            await packets.put({'id': packet['id'], 'result': {'turn': {'id': 'turn-one'}}})
            await packets.put({'method': 'item/started', 'params': {'item': {'type': 'mcpToolCall', 'id': 'tool', 'tool': 'local_time'}}})
        elif method == 'turn/steer':
            await packets.put({'id': packet['id'], **({'error': {'message': 'ActiveTurnNotSteerable'}} if refused else {'result': {'turnId': 'turn-one'}})})

    driver.child = SimpleNamespace(send=send, cwd='.')
    driver._read = packets.get

    async def consume():
        events = []
        async for event in driver._rpc('Original', 'Persona', '', '', None, None):
            events.append(event)
            if event.kind == 'tool_start':
                ready.set()
        return events

    task = asyncio.create_task(consume())
    try:
        await asyncio.wait_for(ready.wait(), 2)
        assert await driver.steer('New condition') is not refused
        steer = next(packet for packet in sent if packet.get('method') == 'turn/steer')
        assert steer['params'] == {'threadId': 'thread-one', 'expectedTurnId': 'turn-one', 'input': [{'type': 'text', 'text': 'New condition'}]}
        await packets.put({'method': 'item/completed', 'params': {'item': {'type': 'agentMessage', 'text': 'Original answer'}}})
        await packets.put({'method': 'turn/completed', 'params': {'turn': {'status': 'completed'}}})
        assert (await task)[-1] == Event('final', 'Original answer')
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.parametrize('accepted', [True, False])
async def test_codex_receipt_at_completion_consumes_once_or_queues_for_next_turn(make_rig, monkeypatch, tmp_path, accepted):
    rig, first, release, calls = await blocked_cli(make_rig, monkeypatch, tmp_path, brain='codex')
    loop = rig.service._owner_loops[(0, rig.service.conversations.main(0))]
    async def steer(text):
        release.set()
        await asyncio.sleep(0)
        return accepted
    loop.driver.steer = steer
    try:
        addition = await typed(rig, 'Next condition')
        await first
        await until(lambda: not rig.service._drains)
        assert bool(addition.get('steered')) is accepted
        row = rig.service._inbox.get(addition['turn_id'])
        assert row['outcome'] == ('steered' if accepted else 'completed')
        assert len(calls) == (1 if accepted else 2)
    finally:
        release.set()
        await asyncio.gather(first, return_exceptions=True)


@pytest.mark.parametrize('quick', [False, True])
async def test_a_message_while_background_work_runs_in_its_conversation_joins_that_work(make_rig, quick):
    rig = make_rig()
    joined = []

    async def steer(member_id, conversation_id, text):
        joined.append((member_id, conversation_id, text))
        return True

    rig.service._background.steer = steer
    params = {"session_id": "joining", "text": "Also check the second file", "ui_language": "en", "source": "app"}
    answer = await rig.call("agent.ask", {**params, "destination": "quick"} if quick else params)
    assert answer["steered"] is True
    assert [text for *_, text in joined] == ["Also check the second file"]
    if not quick:
        assert rig.service._inbox.get(answer["turn_id"])["outcome"] == "steered"
    assert not rig.service._drains


async def test_a_message_the_background_work_turns_down_waits_for_its_own_turn(make_rig, client):
    rig = make_rig()

    async def steer(member_id, conversation_id, text):
        return False

    rig.service._background.steer = steer
    client.chats = [chat("Done separately.")]
    answer = await typed(rig, "A separate question")
    assert "steered" not in answer and answer["text"] == "Done separately."
    await until(lambda: not rig.service._drains)
    assert rig.service._inbox.get(answer["turn_id"])["outcome"] == "completed"
    assert len(client.chat_calls) == 1
