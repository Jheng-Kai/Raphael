"""Conversation setup and sharing through the real harness with synthetic channels and brains."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from agent.conftest import FakeActions, FakeOpenRouter
from agent.test_narration import chat
from agent.test_service import Rig as AgentRig
from members.test_answering import Team, live_said
from messaging.test_switchboard import FakeChannel, settle
from raphael_core.agent.harness_tools import definitions_for, tool
from raphael_core.agent.owner_questions import OWNER_CARDS
from raphael_core.agent.policy import Tier
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.connectors.secret_cards import SecretCards
from raphael_core.integrations.service import IntegrationsService
from raphael_core.integrations.vault import MemoryVault
from raphael_core.messaging.cards import LINKS, MessagingCards
from raphael_core.messaging.channels.base import ChannelError, ChannelType, Identity, Incoming
from raphael_core.messaging.config import MessagingStore
from raphael_core.messaging.service import MessagingService, member_account, secret_name
from raphael_core.protocol import INVALID_PARAMS, RpcError


@pytest.fixture
async def rig(conn, tmp_path):
    team = Team(conn, tmp_path)
    brain = FakeOpenRouter()
    vault, events, checks, channels = MemoryVault(), [], [], {}
    hub = IntegrationsService(conn, tmp_path, vault)
    now = [1_800_000_000_000]
    notify = lambda method, params: events.append((method, params))
    team.members._notify = notify
    cards = SecretCards(conn, hub, notify=notify, now_ms=lambda: now[0])
    agent = AgentRig(conn, brain, FakeActions(), team=team.members, memory=team.memory, secret_cards=cards, notify=notify)
    team.members.register(agent.rpc)
    cards.register(agent.rpc)
    gate = [None]
    def channel_type(platform):
        async def check(values, http):
            checks.append((platform, values["token"]))
            if gate[0]:
                await gate[0].wait()
            if values["token"] in ("invalid", "offline"):
                raise ChannelError("network" if values["token"] == "offline" else "unauthorized")
            return Identity(values["token"], platform + "_bot")
        def make(values, http):
            channel = FakeChannel()
            channel.kind = platform
            channels[platform, values["token"]] = channel
            return channel
        return ChannelType(platform, ("token",), lambda params: {"token": params["token"]}, check, make)
    messaging = MessagingService(MessagingStore(tmp_path), vault, ask=AsyncMock(return_value="Answer"), stop=AsyncMock(), language=lambda: "en",
        types={key: channel_type(key) for key in LINKS}, members=lambda: {0: "Raphael", **{m.id: m.name for m in team.members.store.members()}})
    messaging.cards = MessagingCards(conn, messaging, notify, now_ms=lambda: now[0])
    cards.messaging = messaging
    messaging.register(agent.rpc)
    agent.rpc.register("messaging.pairing.answer", messaging.cards.answer)
    member = team.members.store.create_member(name="Editor", role="Writer", instructions="Make public guides clear", avatar="slime:shuna")
    async def ask(intent, *, member_id=member.id, text="Set up", session="panel"):
        return await agent.call("agent.ask", {"session_id": session, "member_id": member_id, "text": text, "source": "app", "ui_language": "en", "intent": intent})
    try:
        yield SimpleNamespace(conn=conn, team=team, agent=agent, brain=brain, vault=vault, events=events, cards=cards, messaging=messaging,
                              member=member, ask=ask, checks=checks, channels=channels, now=now, gate=gate)
    finally:
        await cards.aclose()
        await messaging.aclose()
        await agent.aclose()
        await team.memory.aclose()


@pytest.mark.parametrize("intent", ["setup-telegram", "setup-slack", "setup-discord", "share-template"])
async def test_panel_intent_is_beside_owner_words_and_not_in_visible_history(rig, intent):
    name = "share_template" if intent == "share-template" else "connect_messaging"
    args = {"description": "I make public guides clear."} if name == "share_template" else {"platform": intent[6:]}
    rig.brain.chats = [chat("", (name, args)), live_said("Use the card.")]
    result = await rig.ask(intent, text="Owner words exactly")
    prompt = rig.brain.chat_calls[0]["messages"][-1]["content"]
    assert "<question>\nOwner words exactly\n</question>" in prompt
    assert "<panel_intent_step>" in prompt and "</panel_intent_step>" in prompt
    assert ("Call share_template now" if name == "share_template" else "Call connect_messaging with platform " + intent[6:] + " now") in prompt
    if intent == "setup-slack":
        assert "im:read, im:history, chat:write, files:read, files:write" in prompt
    [turn] = await rig.agent.turns(member_id=rig.member.id)
    assert turn["question"] == "Owner words exactly" and turn["status"] == "done"
    assert turn["templates"] if name == "share_template" else turn["secrets"]
    assert result["turn_id"] == turn["id"]


@pytest.mark.parametrize("intent,member", [("bad", 1), (True, 1), ([], 1), ("share-template", 0)])
async def test_unknown_intents_and_raphael_sharing_are_invalid_before_a_turn(rig, intent, member):
    with pytest.raises(RpcError) as error:
        await rig.ask(intent, member_id=member)
    assert error.value.code == INVALID_PARAMS
    assert rig.conn.execute("SELECT COUNT(*) FROM agent_turns").fetchone()[0] == 0
    assert not rig.brain.chat_calls


async def setup_card(rig, platform="telegram", member_id=None, session="panel"):
    owner = rig.member.id if member_id is None else member_id
    rig.brain.chats = [chat("", ("connect_messaging", {"platform": platform})), live_said("Copy your bot token to the card.")]
    result = await rig.ask("setup-" + platform, member_id=owner, session=session)
    [card] = rig.cards.cards_of(result["turn_id"])
    return card


@pytest.mark.parametrize("platform", list(LINKS))
@pytest.mark.parametrize("owner", [0, 1])
async def test_card_validation_secret_scoping_and_single_resume(rig, platform, owner):
    card = await setup_card(rig, platform, owner)
    assert (card.kind, card.server_id, card.secret, card.member_id) == ("messaging", platform, "bot_token", owner)
    assert card.view()["platform"] == platform and card.view()["link"] == LINKS[platform]
    for value, expected in (("invalid", "invalid"), ("offline", "offline")):
        reply = await rig.agent.call("integrations.card_save", {"id": card.id, "value": value})
        assert not reply["saved"] and reply["card"]["state"] == "failed" and reply["card"]["error"] == expected
        assert rig.vault.names() == []
    rig.brain.chats = [live_said("Message @" + platform + "_bot now to pair.")]
    token = "synthetic-credential-" + platform
    one, two = await asyncio.gather(*[rig.agent.call("integrations.card_save", {"id": card.id, "value": token}) for _ in range(2)])
    await rig.cards.idle()
    assert one["saved"] and not two["saved"]
    assert rig.checks.count((platform, token)) == 1
    assert rig.vault.names() == [secret_name(member_account(owner, platform), "token")]
    assert rig.vault.get(rig.vault.names()[0]) == token
    assert rig.cards.store.get(card.id).state == "resumed"
    resumed = [t for t in await rig.agent.turns(member_id=owner) if t["source"] == "connector"]
    assert len(resumed) == 1
    assert "@" + platform + "_bot" in rig.brain.chat_calls[-1]["messages"][-1]["content"]
    prompt = rig.brain.chat_calls[-1]["messages"][-1]["content"]
    assert platform.title() + ": not paired; allowed people=0; pending pairings=0" in prompt
    assert "No allowed person yet; send the bot a message to pair, then review its pairing card." in prompt
    assert "any message now to pair" not in prompt
    rows = [list(row) for row in rig.conn.execute("SELECT * FROM secret_cards")]
    assert token not in json.dumps([rows, rig.events, resumed])
    rig.brain.chats = [chat("", ("connect_messaging", {"platform": platform})), live_said("Nothing is needed.")]
    result = await rig.ask("setup-" + platform, member_id=owner, session="again")
    assert rig.cards.cards_of(result["turn_id"]) == []
    assert "@" + platform + "_bot" in json.dumps(rig.brain.chat_calls[-1])


@pytest.mark.parametrize("platform", list(LINKS))
@pytest.mark.parametrize("owner", [0, 1])
async def test_approved_pairing_is_visible_to_the_next_real_harness_prompt(rig, platform, owner):
    card = await setup_card(rig, platform, owner)
    token = "synthetic-paired-" + platform
    rig.brain.chats = [live_said("The bot credential is saved.")]
    await rig.agent.call("integrations.card_save", {"id": card.id, "value": token})
    await rig.cards.idle()
    account = member_account(owner, platform)
    rig.messaging._running[account].switchboard.pairing.issue("synthetic-user", "synthetic-chat", "Synthetic person")
    row = rig.conn.execute("SELECT id FROM messaging_pairing_cards ORDER BY rowid DESC LIMIT 1").fetchone()
    approved = await rig.agent.call("messaging.pairing.answer", {"id": row["id"], "approve": True})
    assert approved["card"]["state"] == "approved"
    rig.brain.chats = [live_said("Hello. You can talk over the paired bot.")]
    result = await rig.ask(None, member_id=owner, text="Hello", session="after-pairing")
    assert result["status"] == "done"
    prompt = rig.brain.chat_calls[-1]["messages"][-1]["content"]
    assert platform.title() + ' pairing card for "Synthetic person": approved.' in prompt
    assert platform.title() + ": paired; allowed people=1; pending pairings=0" in prompt
    assert "The owner can talk over this bot." in prompt
    assert "send the bot" not in prompt and "any message now to pair" not in prompt
    assert token not in prompt and approved["card"]["code"] not in prompt


async def test_cancelled_card_while_token_check_waits_never_connects_or_resumes(rig):
    card = await setup_card(rig)
    rig.gate[0] = asyncio.Event()
    saving = asyncio.create_task(rig.agent.call("integrations.card_save", {"id": card.id, "value": "synthetic-secret"}))
    await settle(lambda: bool(rig.checks))
    rig.cards.cancel_session("panel")
    rig.gate[0].set()
    assert not (await saving)["saved"]
    assert not rig.vault.names() and not rig.messaging._running
    assert rig.cards.store.get(card.id).state == "cancelled"


@pytest.mark.parametrize("approve", [True, False])
async def test_pairing_arrives_in_new_turn_delta_and_answer_is_idempotent(rig, approve):
    card = await setup_card(rig, "slack")
    rig.brain.chats = [live_said("Message the bot.")]
    await rig.agent.call("integrations.card_save", {"id": card.id, "value": "synthetic-slack"})
    await rig.cards.idle()
    account = member_account(rig.member.id, "slack")
    running = rig.messaging._running[account]
    await rig.channels["slack", "synthetic-slack"].inbox.put(Incoming(user="U1", chat="D1", name="Someone", text="Hello"))
    await settle(lambda: bool(running.switchboard.pairing.pending()))
    code = running.switchboard.pairing.pending()[0][0].code
    turn_id = rig.conn.execute("SELECT turn_id FROM messaging_pairing_cards ORDER BY rowid DESC").fetchone()[0]
    [pairing] = rig.messaging.cards.views([turn_id])[turn_id]
    assert {k: pairing[k] for k in ("platform", "member_id", "code", "who", "state")} == {"platform": "slack", "member_id": rig.member.id, "code": code, "who": "Someone", "state": "pending"}
    assert rig.now[0] + 599900 <= pairing["expires_at_ms"] <= rig.now[0] + 600000
    assert turn_id > card.turn_id
    assert ("agent.turn", {"turn_id": turn_id, "member_id": rig.member.id}) in rig.events
    delta = await rig.agent.call("agent.history.list", {"member_id": rig.member.id, "after_id": card.turn_id, "turn_ids": [card.turn_id]})
    assert next(t for t in delta["turns"] if t["id"] == turn_id)["pairings"] == [pairing]
    method = "messaging.pairing.answer"
    answer = await rig.agent.call(method, {"id": pairing["id"], "approve": approve})
    assert answer["card"]["state"] == ("approved" if approve else "rejected")
    assert await rig.agent.call(method, {"id": pairing["id"], "approve": not approve}) == answer
    assert bool(rig.messaging._config.channel(account).allowed) == approve
    assert running.switchboard.pairing.pending() == []


async def test_panel_connections_deliver_chat_pairing_and_expired_cards_cannot_approve(rig):
    owner = rig.member.id
    await rig.agent.call("messaging.member.connect", {"member_id": owner, "token": "panel-token"})
    account = member_account(owner)
    rig.messaging._running[account].switchboard.pairing.issue("U1", "D1", "Panel only")
    assert rig.conn.execute("SELECT member_id FROM messaging_pairing_cards").fetchone()[0] == owner
    card = await setup_card(rig, "discord")
    rig.brain.chats = [live_said("Pair now.")]
    await rig.agent.call("integrations.card_save", {"id": card.id, "value": "discord-token"})
    await rig.cards.idle()
    rig.messaging._running[member_account(owner, "discord")].switchboard.pairing.issue("U2", "D2", "Later")
    turn_id = rig.conn.execute("SELECT turn_id FROM messaging_pairing_cards ORDER BY rowid DESC").fetchone()[0]
    [pairing] = rig.messaging.cards.views([turn_id])[turn_id]
    rig.now[0] += 600001
    answer = await rig.agent.call("messaging.pairing.answer", {"id": pairing["id"], "approve": True})
    assert answer["card"]["state"] == "expired"
    assert not rig.messaging._config.channel(member_account(owner, "discord")).allowed


async def test_member_platforms_default_and_route_and_disconnect_independently(rig):
    owner = rig.member.id
    for platform in LINKS:
        params = {"member_id": owner, **({"platform": platform} if platform != "telegram" else {})}
        assert (await rig.agent.call("messaging.member.connect", {**params, "token": platform}))["ok"]
        kind = member_account(owner, platform)
        rig.messaging._config.channel(kind).allowed = []
        code = rig.messaging._running[kind].switchboard.pairing.issue("U1", "D1", "Owner")
        assert (await rig.agent.call("messaging.member.approve", {**params, "code": code}))["approved"]
        await rig.channels[platform, platform].inbox.put(Incoming(user="U1", chat="D1", name="Owner", text="Hello"))
    await settle(lambda: rig.messaging._ask.await_count == 3)
    assert {call.args[0] for call in rig.messaging._ask.await_args_list} == {f"member:{owner}:{p}:D1" for p in LINKS}
    accounts = (await rig.agent.call("messaging.accounts"))["accounts"]
    assert {a["platform"] for a in accounts if a["member_id"] == owner} == set(LINKS)
    await rig.agent.call("messaging.member.set_enabled", {"member_id": owner, "platform": "slack", "enabled": False})
    assert not (await rig.agent.call("messaging.member.status", {"member_id": owner, "platform": "slack"}))["running"]
    assert (await rig.agent.call("messaging.member.status", {"member_id": owner}))["running"]
    await rig.messaging.remove_member(owner)
    assert not rig.messaging._running and not rig.vault.names()


async def test_template_card_is_snapshot_with_review_export_publish_and_description_import(rig):
    rig.brain.chats = [chat("", ("share_template", {"description": "  I clarify public guides.  "})), live_said("Review my recipe.")]
    result = await rig.ask("share-template")
    [view] = rig.team.members.template_cards.views([result["turn_id"]])[result["turn_id"]]
    assert view["description"] == "I clarify public guides." and view["state"] == "draft"
    assert view["counts"] == {"skills": 0, "routines": 0} and view["avatar"] == "slime:shuna"
    rig.team.members.store.update_member(rig.member.id, instructions="Changed after snapshot")
    review = await rig.agent.call("members.template_card", {"id": view["id"]})
    assert review["template"]["instructions"] == "Make public guides clear"
    saved = await rig.agent.call("members.template_card_export", {"id": view["id"]})
    assert json.loads(saved["text"]) == review["template"] and "\n  " in saved["text"]
    assert rig.team.members.template_cards.views([result["turn_id"]])[result["turn_id"]][0]["state"] == "saved"
    published = await rig.agent.call("members.template_card_publish", {"id": view["id"]})
    from pathlib import Path
    assert json.loads((Path(published["folder"]) / "member.raphael-member").read_text(encoding="utf-8")) == review["template"]
    latest = rig.team.members.template_cards.views([result["turn_id"]])[result["turn_id"]][0]
    assert latest["state"] == "published" and latest["url"] == published["url"]
    await rig.agent.call("members.template_card_export", {"id": view["id"]})
    assert rig.team.members.template_cards.views([result["turn_id"]])[result["turn_id"]][0]["state"] == "saved"
    for index, description in enumerate(("I clarify public guides.", "x" * 280)):
        rig.brain.chats = [live_said("Hello.")]
        imported = await rig.agent.call("members.template", {"action": "import", "name": "Copy" + str(index), "template": {**review["template"], "description": description}})
        assert imported["member"]["blurb"] == description
        assert rig.team.members.store.member(imported["member"]["id"]).blurb == description
        copied = await rig.agent.call("members.duplicate", {"id": imported["member"]["id"]})
        assert copied["member"]["blurb"] == description
        updated = await rig.agent.call("members.update", {"id": copied["member"]["id"], "blurb": description})
        assert updated["member"]["blurb"] == description


async def test_secret_findings_block_snapshot_export_and_publish_even_after_live_member_is_clean(rig):
    rig.team.members.store.update_member(rig.member.id, instructions="api_key: synthetic_private_credential_123456789")
    rig.brain.chats = [chat("", ("share_template", {"description": "I write guides."})), live_said("Review first.")]
    result = await rig.ask("share-template")
    [view] = rig.team.members.template_cards.views([result["turn_id"]])[result["turn_id"]]
    assert view["findings"] == [{"kind": "secret", "path": "template.instructions"}]
    rig.team.members.store.update_member(rig.member.id, instructions="Clean now")
    for method in ("members.template_card_export", "members.template_card_publish"):
        with pytest.raises(RpcError, match="Remove private credentials from the member recipe first"):
            await rig.agent.call(method, {"id": view["id"]})
    assert rig.team.members.template_cards.views([result["turn_id"]])[result["turn_id"]][0]["state"] == "draft"
    rig.agent.history.delete(result["turn_id"])
    with pytest.raises(RpcError):
        await rig.agent.call("members.template_card", {"id": view["id"]})


def test_tools_have_owner_card_tier_and_member_only_share_offer():
    assert "connect_messaging" in OWNER_CARDS and tool("connect_messaging").tier == Tier.T0
    assert "share_template" not in dict(definitions_for(RAPHAEL))


@pytest.mark.parametrize("value", [True, 7, None, "x" * 281])
async def test_template_description_validation_has_no_card_side_effect(rig, value):
    with pytest.raises(RpcError):
        rig.team.members.template_cards.show(1, rig.member.id, value)
    assert not rig.conn.execute("SELECT * FROM member_template_cards").fetchall()


@pytest.mark.parametrize("method", ["status", "connect", "disconnect", "set_enabled", "approve", "reject", "remove_user"])
@pytest.mark.parametrize("platform", ["unsupported", None, [], True])
async def test_member_methods_reject_bad_platforms_before_mutation(rig, method, platform):
    with pytest.raises(RpcError) as error:
        await rig.agent.call("messaging.member." + method, {"member_id": rig.member.id, "platform": platform})
    assert error.value.code == INVALID_PARAMS
    assert not rig.vault.names() and not rig.messaging._running


async def test_panel_reconnect_detaches_card_and_deleted_turn_cleans_card_rows(rig):
    card = await setup_card(rig)
    rig.brain.chats = [live_said("Pair now.")]
    await rig.agent.call("integrations.card_save", {"id": card.id, "value": "chat-token"})
    await rig.cards.idle()
    account = member_account(rig.member.id)
    rig.messaging._running[account].switchboard.pairing.issue("U1", "D1", "First")
    await rig.agent.call("messaging.member.connect", {"member_id": rig.member.id, "token": "panel-token"})
    turn_id = rig.conn.execute("SELECT turn_id FROM messaging_pairing_cards ORDER BY rowid DESC").fetchone()[0]
    [pairing] = rig.messaging.cards.views([turn_id])[turn_id]
    assert pairing["state"] == "expired"
    rig.messaging._running[account].switchboard.pairing.issue("U2", "D2", "Panel")
    assert len(rig.messaging.cards.views([turn_id])[turn_id]) == 1
    assert rig.conn.execute("SELECT COUNT(*) FROM messaging_pairing_cards").fetchone()[0] == 2
    for row in rig.conn.execute("SELECT turn_id FROM messaging_pairing_cards").fetchall():
        rig.agent.history.delete(row[0])
    rig.agent.history.delete(card.turn_id)
    assert rig.conn.execute("SELECT COUNT(*) FROM secret_cards").fetchone()[0] == 0
    assert rig.conn.execute("SELECT COUNT(*) FROM messaging_pairing_cards").fetchone()[0] == 0
    assert rig.conn.execute("SELECT COUNT(*) FROM messaging_card_accounts").fetchone()[0] == 0


async def test_connected_member_platforms_and_card_origin_survive_restart(rig):
    card = await setup_card(rig, "discord")
    rig.brain.chats = [live_said("Pair now.")]
    await rig.agent.call("integrations.card_save", {"id": card.id, "value": "discord-token"})
    await rig.cards.idle()
    account = member_account(rig.member.id, "discord")
    rig.messaging._running[account].switchboard.pairing.issue("U1", "D1", "Before restart")
    await rig.messaging.aclose()
    restarted = MessagingService(rig.messaging._store, rig.vault, ask=rig.messaging._ask, stop=rig.messaging._stop,
        language=lambda: "en", types=rig.messaging._base_types, members=rig.messaging._members)
    restarted.cards = MessagingCards(rig.conn, restarted, lambda method, params: rig.events.append((method, params)), now_ms=lambda: rig.now[0])
    try:
        restarted.start()
        assert restarted._member_view(rig.member.id, "discord")["running"]
        turn_id = rig.conn.execute("SELECT turn_id FROM messaging_pairing_cards").fetchone()[0]
        [old] = restarted.cards.views([turn_id])[turn_id]
        assert old["state"] == "expired"
        code = restarted._running[account].switchboard.pairing.issue("U2", "D2", "After restart")
        new_turn_id = rig.conn.execute("SELECT turn_id FROM messaging_pairing_cards ORDER BY rowid DESC LIMIT 1").fetchone()[0]
        assert new_turn_id > turn_id
        assert restarted.cards.views([new_turn_id])[new_turn_id][-1]["code"] == code
        assert restarted.handles(f"member:{rig.member.id}:discord:D2")
        [pending] = restarted.cards.views([new_turn_id])[new_turn_id]
        assert (await restarted.cards.answer({"id": pending["id"], "approve": True}))["card"]["state"] == "approved"
        await restarted.report(f"member:{rig.member.id}:discord:D2", "Delivered")
        assert ("D2", "Delivered") in rig.channels["discord", "discord-token"].sent
    finally:
        await restarted.aclose()


def test_migration_preserves_pending_secret_cards_and_adds_conversation_cleanup(tmp_path, monkeypatch):
    from raphael_core.brain import db
    from raphael_core.agent.history import AgentHistory
    from raphael_core.connectors.secret_cards import SecretCardStore
    with monkeypatch.context() as patch:
        patch.setattr(db, "LATEST_VERSION", 69)
        conn = db.connect(tmp_path / "before.db")
    history = AgentHistory(conn)
    turn = history.add(session_id="old", question="Check", route="answer", prefix="", text="", status="done", source="app")
    old = SecretCardStore(conn).open(turn_id=turn, member_id=0, conversation_id=None, server_id="old-server", kind="header", secret="Authorization", name="Existing", language="en")
    db.migrate(conn)
    assert SecretCardStore(conn).get(old.id) == old
    new = SecretCardStore(conn).open(turn_id=turn, member_id=0, conversation_id=None, server_id="slack", kind="messaging", secret="bot_token", name="Slack", language="en")
    assert new.view()["platform"] == "slack"
    history.delete(turn)
    assert conn.execute("SELECT COUNT(*) FROM secret_cards").fetchone()[0] == 0
    conn.close()
