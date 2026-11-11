"""Per-member Telegram ownership through the production gateway, with a fake Bot API only."""

import asyncio
import json
import logging
from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from raphael_core.app import App
from raphael_core.messaging.config import MessagingStore
from raphael_core.messaging.core import Answer, session_target
from raphael_core.messaging.service import MessagingService, member_account, secret_name
from raphael_core.protocol import RpcError
from .test_telegram import OWNER, settle

TOKENS = [f"{identity}:FakeTokenForMemberAccountOnly_123456789" for identity in (100001, 100002, 100003)]


class Bots:
    def __init__(self):
        self.updates = defaultdict(list)
        self.sent = defaultdict(list)
        self.changed = defaultdict(asyncio.Event)
        self.polling = set()
        self.checking = asyncio.Event()
        self.release_check = None
        self.reply_statuses = defaultdict(list)

    def message(self, token, text=None, *, user=OWNER, private=True, **extra):
        self.updates[token].append({"update_id": len(self.updates[token]) + 1, "message": {
            "chat": {"id": user, "type": "private" if private else "group"},
            "from": {"id": user, "is_bot": False, "first_name": "Owner"},
            **({"text": text} if text is not None else {}), **extra}})
        self.changed[token].set()

    async def __call__(self, request):
        if request.url.path.startswith("/file/bot"):
            return httpx.Response(200, content=b"%PDF-1.7\n")
        token, _, method = request.url.path.removeprefix("/bot").partition("/")
        if token not in TOKENS:
            return httpx.Response(401, json={"ok": False})
        body = json.loads(request.content or b"{}")
        if method == "getMe":
            self.checking.set()
            if self.release_check is not None:
                await self.release_check.wait()
            result = {"id": int(token.split(":")[0]), "username": f"member_{TOKENS.index(token)}_bot"}
        elif method == "getUpdates":
            offset = body.get("offset") or 0
            result = [update for update in self.updates[token] if update["update_id"] >= offset]
            if not result:
                self.changed[token].clear()
                self.polling.add(token)
                try:
                    await self.changed[token].wait()
                finally:
                    self.polling.discard(token)
                result = [update for update in self.updates[token] if update["update_id"] >= offset]
        elif method == "sendMessage":
            if self.reply_statuses[token]:
                status = self.reply_statuses[token].pop(0)
                return httpx.Response(status, json={"ok": False, "parameters": {"retry_after": 0}})
            self.sent[token].append(body)
            result = True
        elif method == "getFile":
            result = {"file_path": "document.pdf"}
        else:
            result = True
        return httpx.Response(200, json={"ok": True, "result": result})


@pytest.fixture
async def rig(tmp_path):
    app = App(data_dir=tmp_path, fake_llm=True, load_kit=lambda: SimpleNamespace())
    bots = Bots()
    client = httpx.AsyncClient(transport=httpx.MockTransport(bots), trust_env=False)
    app.messaging._http = client
    app.messaging._owns_http = False
    members = [app.members.store.create_member(name=name).id for name in ("Ada", "Lin")]
    async def call(method, member=members[0], **params):
        return await app.call(f"messaging.member.{method}", {"member_id": member, **params})
    async def pair(member, token):
        assert (await call("connect", member, token=token))["ok"]
        bots.message(token, "/start")
        await settle(lambda: bool(bots.sent[token]))
        code = (await call("status", member))["pending"][0]["code"]
        assert (await call("approve", member, code=code))["approved"]
        await settle(lambda: len(bots.sent[token]) == 2)
        bots.sent[token].clear()
    try:
        yield SimpleNamespace(app=app, bots=bots, http=client, members=members, call=call, pair=pair, directory=tmp_path)
    finally:
        await app.aclose()
        await client.aclose()


async def test_bad_token_never_reaches_the_vault_or_metadata(rig, caplog):
    caplog.set_level(logging.INFO)
    for token in ("not-a-token", "999999:WrongTokenWhichMustNotBeStored_12345"):
        assert await rig.call("connect", token=token) == {"ok": False, "reason": "invalid_token"}
        assert token not in caplog.text
    assert rig.app.vault.names() == []
    assert not (rig.directory / "messaging.json").exists()
    assert not (await rig.call("status"))["connected"]


@pytest.mark.parametrize("member", [None, True, -1, 9999, "1"])
async def test_member_rpc_requires_an_existing_integer_member(rig, member):
    with pytest.raises(RpcError):
        await rig.call("connect", member, token=TOKENS[0])
    assert not rig.app.messaging._running


async def test_two_bots_route_to_two_existing_private_conversations_and_reply_from_each(rig, caplog):
    caplog.set_level(logging.INFO)
    one, two = rig.members
    await rig.pair(one, TOKENS[0])
    await rig.pair(two, TOKENS[1])
    await settle(lambda: set(TOKENS[:2]) <= rig.bots.polling)
    rig.bots.message(TOKENS[0], "Question for Ada")
    rig.bots.message(TOKENS[1], "Question for Lin")
    await settle(lambda: all(rig.bots.sent[token] for token in TOKENS[:2]))
    for member, question, token in ((one, "Question for Ada", TOKENS[0]), (two, "Question for Lin", TOKENS[1])):
        turns = (await rig.app.call("agent.history.list", {"member_id": member}))["turns"]
        assert len(turns) == 2 and turns[0]["question"] == question
        assert turns[1]["route"] == "pairing" and turns[1]["source"] == "messaging"
        assert turns[1]["pairings"][0]["member_id"] == member
        assert turns[1]["pairings"][0]["state"] == "approved"
        assert turns[1]["conversation_id"] == turns[0]["conversation_id"]
        assert turns[0]["session_id"] == f"member:{member}:telegram:{OWNER}"
        assert turns[0]["conversation_id"] == rig.app.agent.conversations.main(member)
        assert turns[0]["source"] == "telegram"
        assert all(sent["chat_id"] == OWNER for sent in rig.bots.sent[token])
    assert (await rig.app.call("agent.history.list", {"member_id": 0}))["turns"] == []
    overview = await rig.app.call("messaging.accounts")
    assert {row["member_id"] for row in overview["accounts"]} == {0, one, two}
    assert all(row["paired"] for row in overview["accounts"] if row["member_id"])
    persisted = (rig.directory / "messaging.json").read_text(encoding="utf-8")
    for token in TOKENS:
        assert token not in persisted and token not in json.dumps(overview) and token not in caplog.text
    assert rig.app.vault.get(secret_name(member_account(one), "bot_token")) == TOKENS[0]
    assert rig.app.vault.get(secret_name(member_account(two), "bot_token")) == TOKENS[1]


async def test_pairing_is_not_shared_between_members_and_group_messages_are_ignored(rig):
    one, two = rig.members
    await rig.pair(one, TOKENS[0])
    await rig.call("connect", two, token=TOKENS[1])
    rig.bots.message(TOKENS[1], "not paired with Lin")
    await settle(lambda: bool(rig.bots.sent[TOKENS[1]]))
    code = (await rig.call("status", two))["pending"][0]["code"]
    assert not (await rig.call("approve", one, code=code))["approved"]
    assert not (await rig.call("status", two))["paired"]
    [turn] = (await rig.app.call("agent.history.list", {"member_id": two}))["turns"]
    assert turn["route"] == "pairing" and turn["question"] == "" and turn["text"] == ""
    assert turn["pairings"][0]["member_id"] == two
    assert turn["pairings"][0]["code"] == code and turn["pairings"][0]["state"] == "pending"
    rig.bots.message(TOKENS[0], "group", private=False)
    await asyncio.sleep(0.02)
    assert not rig.bots.sent[TOKENS[0]]


async def test_whole_reply_all_parts_html_splitting_and_worker_notices_use_the_member_bot(rig, monkeypatch):
    member = rig.members[0]
    await rig.pair(member, TOKENS[0])
    async def ask(*args, **kwargs):
        return Answer("unused summary", parts=["**first message** " + "x" * 4500, "second message and conclusion"])
    monkeypatch.setattr(rig.app.messaging, "_ask", ask)
    rig.bots.reply_statuses[TOKENS[0]] = [429]
    rig.bots.message(TOKENS[0], "long answer")
    await settle(lambda: len(rig.bots.sent[TOKENS[0]]) == 3)
    sent = rig.bots.sent[TOKENS[0]]
    assert "<b>first message</b>" in sent[0]["text"]
    assert sum(message["text"].count("x") for message in sent) == 4500
    assert sent[-1]["text"] == "second message and conclusion"
    assert all(message["parse_mode"] == "HTML" for message in sent)
    session = f"member:{member}:telegram:{OWNER}"
    store = rig.app.background._store
    task = store.create(session_id=session, member_id=member, language="en", text="background work")
    store.finish(task, "done", prefix="", text="short summary", detail=None, reason=None)
    rig.app.background._final_words[task] = ["**whole report**", "final conclusion"]
    rig.app._worker_notice("worker.report", {"task_id": task})
    await settle(lambda: len(sent) == 5)
    assert [message["text"] for message in sent[-2:]] == ["<b>whole report</b>", "final conclusion"]
    assert not rig.bots.sent[TOKENS[1]] and not rig.bots.sent[TOKENS[2]]


async def test_disconnect_stops_only_its_poller_and_deletes_only_its_secret(rig):
    one, two = rig.members
    await rig.pair(one, TOKENS[0])
    await rig.pair(two, TOKENS[1])
    running = rig.app.messaging._running[member_account(one)]
    state = await rig.call("disconnect", one)
    assert not state["connected"] and not state["running"] and not state["paired"]
    assert running.task.done() and TOKENS[0] not in rig.bots.polling
    assert rig.app.vault.get(secret_name(member_account(one), "bot_token")) is None
    assert rig.app.vault.get(secret_name(member_account(two), "bot_token")) == TOKENS[1]
    assert (await rig.call("status", two))["running"]


async def test_member_deletion_cancels_inflight_bot_work_and_deletes_credentials(rig, monkeypatch):
    member = rig.members[0]
    await rig.pair(member, TOKENS[0])
    entered, cancelled = asyncio.Event(), asyncio.Event()
    async def ask(*args, **kwargs):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    monkeypatch.setattr(rig.app.messaging, "_ask", ask)
    rig.bots.message(TOKENS[0], "in-flight")
    await asyncio.wait_for(entered.wait(), 1)
    running = rig.app.messaging._running[member_account(member)]
    assert await rig.app.call("members.delete", {"id": member}) == {"deleted": True}
    assert running.task.done() and cancelled.is_set()
    assert rig.app.vault.get(secret_name(member_account(member), "bot_token")) is None
    assert member_account(member) not in rig.app.messaging._config.channels
    with pytest.raises(RpcError):
        await rig.call("connect", member, token=TOKENS[0])
    assert not rig.bots.sent[TOKENS[0]]


async def test_saved_member_bots_restart_once_with_the_same_pairings(rig):
    for member, token in zip(rig.members, TOKENS):
        await rig.pair(member, token)
    previous = rig.app.messaging
    await previous.aclose()
    restarted = MessagingService(MessagingStore(rig.directory), rig.app.vault,
        ask=previous._ask, stop=previous._stop, language=lambda: "en", http=rig.http, members=previous._members)
    try:
        restarted.start()
        tasks = [running.task for running in restarted._running.values()]
        restarted.start()
        assert [running.task for running in restarted._running.values()] == tasks
        assert len(tasks) == 2
        assert all(restarted._member_view(member)["paired"] for member in rig.members)
    finally:
        await restarted.aclose()


async def test_raphael_keeps_its_original_account_session_and_secret(rig):
    await rig.pair(0, TOKENS[2])
    await rig.pair(rig.members[0], TOKENS[0])
    rig.bots.message(TOKENS[2], "Question for Raphael")
    await settle(lambda: bool(rig.bots.sent[TOKENS[2]]))
    turns = (await rig.app.call("agent.history.list", {"member_id": 0}))["turns"]
    assert len(turns) == 2 and turns[0]["session_id"] == f"telegram:{OWNER}"
    assert turns[1]["route"] == "pairing" and turns[1]["pairings"][0]["member_id"] == 0
    assert turns[1]["pairings"][0]["state"] == "approved"
    assert rig.app.vault.get(secret_name("telegram", "bot_token")) == TOKENS[2]
    assert (await rig.app.call("messaging.telegram.status"))["bot"]["username"] == "member_2_bot"
    await rig.call("disconnect", rig.members[0])
    assert (await rig.app.call("messaging.telegram.status"))["running"]


async def test_same_bot_cannot_be_polled_by_two_members_or_by_a_member_and_raphael(rig):
    await rig.pair(rig.members[0], TOKENS[0])
    assert await rig.call("connect", rig.members[1], token=TOKENS[0]) == {"ok": False, "reason": "bot_in_use"}
    assert await rig.app.call("messaging.telegram.connect", {"token": TOKENS[0]}) == {"ok": False, "reason": "bot_in_use"}
    assert len(rig.app.messaging._running) == 1


async def test_connect_cannot_restore_a_member_deleted_while_getme_is_pending(rig):
    rig.bots.release_check = asyncio.Event()
    pending = asyncio.create_task(rig.call("connect", token=TOKENS[0]))
    await rig.bots.checking.wait()
    await rig.app.call("members.delete", {"id": rig.members[0]})
    rig.bots.release_check.set()
    with pytest.raises(RpcError):
        await pending
    assert not rig.app.messaging._running
    assert rig.app.vault.names() == []


async def test_reconnect_keeps_only_the_same_bots_pairing_and_replaces_its_poller(rig):
    member = rig.members[0]
    await rig.pair(member, TOKENS[0])
    previous = rig.app.messaging._running[member_account(member)]
    assert (await rig.call("connect", token=TOKENS[0]))["status"]["paired"]
    assert previous.task.done()
    changed = await rig.call("connect", token=TOKENS[1])
    assert changed["ok"] and not changed["status"]["paired"]
    assert rig.app.vault.get(secret_name(member_account(member), "bot_token")) == TOKENS[1]
    assert len(rig.app.messaging._running) == 1


async def test_stop_and_pairing_revocation_are_scoped_to_one_member(rig, monkeypatch):
    one, two = rig.members
    await rig.pair(one, TOKENS[0])
    await rig.pair(two, TOKENS[1])
    stop = AsyncMock(return_value=True)
    monkeypatch.setattr(rig.app.messaging, "_stop", stop)
    rig.bots.message(TOKENS[0], "/stop")
    await settle(lambda: bool(rig.bots.sent[TOKENS[0]]))
    stop.assert_awaited_once_with(f"member:{one}:telegram:{OWNER}")
    await rig.call("remove_user", one, user_id=str(OWNER))
    assert not (await rig.call("status", one))["paired"]
    assert (await rig.call("status", two))["paired"]
    before = len(rig.bots.sent[TOKENS[0]])
    await rig.app.messaging.report(f"member:{one}:telegram:{OWNER}", "must not leave")
    assert len(rig.bots.sent[TOKENS[0]]) == before
    assert not rig.bots.sent[TOKENS[1]]


async def test_vault_deletion_failure_prevents_false_disconnect_and_member_deletion(rig, monkeypatch):
    member = rig.members[0]
    await rig.pair(member, TOKENS[0])
    def fail(name): raise OSError("fake vault refusal")
    monkeypatch.setattr(rig.app.vault, "delete", fail)
    with pytest.raises(RpcError, match="secrets could not be removed"):
        await rig.app.call("members.delete", {"id": member})
    assert rig.app.members.member_exists(member)
    assert member not in rig.app.members.deleting
    assert not rig.app.messaging._running
    assert rig.app.vault.get(secret_name(member_account(member), "bot_token")) == TOKENS[0]


async def test_member_attachments_and_confirmation_refusal_use_the_same_owner_boundary(rig, monkeypatch):
    member = rig.members[0]
    await rig.pair(member, TOKENS[0])
    calls = []
    async def call(method, params=None):
        calls.append((method, params))
        return {"status": "confirm", "confirm": {"id": "permission", "text": "Confirm on the computer"}}
    monkeypatch.setattr(rig.app, "call", call)
    rig.bots.message(TOKENS[0], caption="read this", document={"file_id": "pdf", "file_name": "report.pdf", "mime_type": "application/pdf", "file_size": 9})
    await settle(lambda: bool(rig.bots.sent[TOKENS[0]]))
    assert [method for method, _ in calls] == ["agent.ask", "agent.confirm"]
    request = calls[0][1]
    assert request["member_id"] == member and request["conversation_id"] == rig.app.agent.conversations.main(member)
    assert request["text"] == "read this" and request["attachments"][0]["name"] == "report.pdf"
    assert calls[1][1] == {"id": "permission", "approved": False}


@pytest.mark.parametrize("session", ["member:0:telegram:1", "member:01:telegram:1", "member:x:telegram:1", "member:1:unsupported:1", "member:1:telegram:"])
async def test_malformed_member_sessions_never_fall_back_to_raphael(rig, session):
    assert session_target(session) is None and not rig.app.messaging.handles(session)
    with pytest.raises(RpcError):
        await rig.app._ask_from_messaging(session, "private", "en", "telegram")
