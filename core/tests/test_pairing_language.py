"""Conversation-following pairing and speaker language, with fake transports only."""

import pytest

from agent.test_narration import chat
from agent.test_service import until
from members.test_answering import live_said
from raphael_core.agent.answers import MESSAGE_BREAK, parse_reply
from raphael_core.agent.cli.drivers import Driver, Event
from raphael_core.messaging.cards import LINKS
from raphael_core.messaging.service import member_account
from test_chat_setup_share import rig, setup_card  # noqa: F401


async def connected(rig, platform="telegram", owner=None):
    card = await setup_card(rig, platform, owner)
    rig.brain.chats = [live_said("Message the bot to pair here.")]
    await rig.agent.call("integrations.card_save", {"id": card.id, "value": "synthetic-" + platform})
    await rig.cards.idle()
    return card, rig.messaging._running[member_account(card.member_id, platform)]


@pytest.mark.parametrize("platform", list(LINKS))
@pytest.mark.parametrize("owner", [0, 1])
async def test_late_pairing_is_a_new_bottom_turn_and_replacement_updates_it(rig, platform, owner):
    card, running = await connected(rig, platform, owner)
    rig.brain.chats = [live_said("Still here.")]
    last = await rig.ask(None, member_id=owner, text="We have talked since setup", session="later")
    first = running.switchboard.pairing.issue("U1", "D1", "First visitor")
    turns = await rig.agent.turns(member_id=owner)
    [turn] = [t for t in turns if t.get("pairings")]
    assert turn["id"] > last["turn_id"] > card.turn_id
    assert turn["question"] == "" and turn["status"] == "done"
    assert turn["source"] == "messaging" and turn["route"] == "pairing"
    pairing = turn["pairings"][0]
    assert pairing["code"] == first
    assert ("agent.turn", {"turn_id": turn["id"], "member_id": owner}) in rig.events
    second = running.switchboard.pairing.issue("U2", "D2", "Second visitor")
    current = await rig.agent.turns(member_id=owner)
    assert len(current) == len(turns)
    [updated] = [t for t in current if t.get("pairings")]
    assert updated["id"] == turn["id"]
    assert updated["pairings"][0]["id"] == pairing["id"]
    assert updated["pairings"][0]["code"] == second
    assert running.switchboard.pairing.take(first) is None
    assert len(running.switchboard.pairing.pending()) == 1
    answer = await rig.agent.call("messaging.pairing.answer", {"id": pairing["id"], "approve": True})
    assert answer["card"]["state"] == "approved"
    assert [u.user_id for u in rig.messaging._config.channel(member_account(owner, platform)).allowed] == ["U2"]


@pytest.mark.parametrize("platform", list(LINKS))
@pytest.mark.parametrize("enabled", [True, False])
async def test_reconnect_reports_existing_bot_and_shows_waiting_card_without_token(rig, platform, enabled):
    card, running = await connected(rig, platform)
    code = running.switchboard.pairing.issue("U1", "D1", "Owner")
    if not enabled:
        await rig.messaging._set_enabled(member_account(card.member_id, platform), {"enabled": False})
    checks = len(rig.checks)
    rig.brain.chats = [chat("", ("connect_messaging", {"platform": platform})), live_said("Already connected.")]
    result = await rig.ask("setup-" + platform, session="reconnect")
    assert not rig.cards.cards_of(result["turn_id"])
    assert len(rig.checks) == checks
    tool_result = next(m["content"] for m in rig.brain.chat_calls[-1]["messages"] if m["role"] == "tool")
    assert "already connected" in tool_result and "Do not ask for a token" in tool_result
    if enabled:
        [pairing] = rig.messaging.cards.views([result["turn_id"]])[result["turn_id"]]
        assert pairing["code"] == code
        assert "pairing card" in tool_result
    else:
        assert "panel" in tool_result and not rig.messaging.cards.views([result["turn_id"]])


@pytest.mark.parametrize("brain", ["api", "codex", "claude", "gemini"])
@pytest.mark.parametrize("owner", [0, 1])
@pytest.mark.parametrize("ui", ["zh-TW", "en"])
async def test_own_japanese_language_and_english_progress_survive_other_interface(rig, monkeypatch, brain, owner, ui):
    instruction = "Always reply in Japanese, including progress and thinking."
    if owner:
        rig.team.members.store.update_member(owner, instructions=instruction)
    else:
        rig.agent.settings.set("first_bot_profile", {"name": "Raphael", "instructions": instruction})
    captured = []
    if brain == "api":
        rig.brain.chats = [chat('{"thinking":"Checking the plan.","progress":"Checking now."}', ("local_time", {})), live_said("日本語で答えます。")]
    else:
        rig.agent.settings.set("agent_model", "cli:" + brain)
        monkeypatch.setattr(rig.agent.service._cli_brains, "command", lambda name: ["fake-only"])
        monkeypatch.setattr(rig.agent.service._cli_brains, "available", lambda *args, **kwargs: True)

        async def run(driver, **kwargs):
            captured.append(kwargs)
            yield Event("text_delta", text="Checking now.\n")
            yield Event("tool_start", data={"id": "time", "name": "local_time"})
            yield Event("tool_end", data={"id": "time", "name": "local_time", "ok": True})
            yield Event("final", text="日本語で答えます。")

        monkeypatch.setattr(Driver, "run", run)
    result = await rig.agent.call("agent.ask", {"session_id": "language", "member_id": owner, "source": "app", "text": "Please explain", "ui_language": ui})
    if brain == "api":
        prompt = str(rig.brain.chat_calls[0]["messages"])
    else:
        prompt = captured[0]["system"] + captured[0]["user"]
    assert instruction in prompt
    assert "The interface language never selects" in prompt
    for stale in ("Owner's UI language:", "in the owner's UI language", "Reply ONLY in", "By default use", "By default reply in"):
        assert stale not in prompt
    assert result["text"] == "日本語で答えます。"
    messages = rig.agent.history.messages([result["turn_id"]])[result["turn_id"]]
    assert any(m["kind"] == "progress" and "Checking now." in m["text"] for m in messages)


@pytest.mark.parametrize("ui", ["en", "zh-TW", "ja"])
def test_reply_script_is_authored_not_selected_by_interface(ui):
    reply = parse_reply({"text": "软件检查", "messages": ["软件检查"], "detail": "软件资料"}, ui, plain=True)
    assert reply.text == "软件检查" and reply.detail == "软件资料" and reply.messages == ["软件检查"]


async def test_greeting_obeys_own_language_not_app_language(rig):
    rig.team.members.store.update_member(rig.member.id, instructions="Always speak Japanese.")
    rig.brain.chats = [live_said("何をお手伝いしましょうか。")]
    result = rig.agent.service.start_greeting(rig.member.id, "en")
    await until(lambda: rig.agent.history.get(result["turn_id"]).status == "done")
    system = rig.brain.chat_calls[0]["messages"][0]["content"]
    assert "Always speak Japanese." in system
    assert "app language" not in system and "The interface language never selects" in system


@pytest.mark.parametrize("brain", ["api", "codex", "claude", "gemini"])
@pytest.mark.parametrize("owner", [0, 1])
@pytest.mark.parametrize(("variant", "expected"), [
    ("zh-TW", "這個軟體已檢查。"), ("zh-HK", "這個軟件已檢查。"),
    ("zh-CN", "这个软件已检查。"), ("en-US", "这个软件已检查。"),
])
async def test_owner_script_covers_api_cli_messages_and_public_narration(rig, monkeypatch, brain, owner, variant, expected):
    import json
    rig.agent.settings.set("languages", [variant])
    original = "这个软件已检查。"
    japanese = "日本の学校へ行きます。"
    payload = json.dumps({"text": original, "messages": [original, japanese], "detail": original})
    if brain == "api":
        rig.brain.chats = [chat(json.dumps({"thinking": original, "progress": original}), ("local_time", {})), chat(payload)]
    else:
        rig.agent.settings.set("agent_model", "cli:" + brain)
        monkeypatch.setattr(rig.agent.service._cli_brains, "command", lambda name: ["fake-only"])
        monkeypatch.setattr(rig.agent.service._cli_brains, "available", lambda *args, **kwargs: True)

        async def run(driver, **kwargs):
            yield Event("text_delta", text=original)
            yield Event("thinking", text=original)
            yield Event("tool_start", data={"id": "time", "name": "local_time"})
            yield Event("tool_end", data={"id": "time", "name": "local_time", "ok": True})
            # Ordinary CLI turns author plain messages, not the API's JSON reply envelope.
            yield Event("final", text=f"{original}\n{MESSAGE_BREAK}\n{japanese}")

        monkeypatch.setattr(Driver, "run", run)
    result = await rig.agent.call("agent.ask", {"session_id": "script", "member_id": owner, "source": "app",
                                               "text": "Please check", "ui_language": "en"})
    saved = rig.agent.history.get(result["turn_id"])
    assert result["text"] == saved.text == expected + "\n\n" + japanese
    assert result["messages"] == [expected, japanese]
    assert saved.detail == (expected if brain == "api" else None)
    messages = rig.agent.history.messages([saved.id])[saved.id]
    for kind in ("thinking", "progress"):
        lines = [m["text"] for m in messages if m["kind"] == kind]
        assert len(lines) == 1 and expected in lines[0]
    replies = [m["text"] for m in messages if m["kind"] == "reply"]
    assert expected in replies[0] and japanese in replies[1]


@pytest.mark.parametrize("brain", ["api", "codex", "claude", "gemini"])
@pytest.mark.parametrize(("authored", "expected"), [
    ("软件检查。", "軟體檢查。"), ("日本の学校へ行きます。", "日本の学校へ行きます。"),
])
async def test_greeting_uses_owner_script_on_an_english_interface(rig, monkeypatch, brain, authored, expected):
    rig.agent.settings.set("languages", ["zh-TW"])
    if brain == "api":
        rig.brain.chats = [live_said(authored)]
    else:
        rig.agent.settings.set("agent_model", "cli:" + brain)
        monkeypatch.setattr(rig.agent.service._cli_brains, "command", lambda name: ["fake-only"])
        monkeypatch.setattr(rig.agent.service._cli_brains, "available", lambda *args, **kwargs: True)

        async def run(driver, **kwargs):
            yield Event("final", text=authored)

        monkeypatch.setattr(Driver, "run", run)
    result = rig.agent.service.start_greeting(rig.member.id, "en")
    await until(lambda: rig.agent.history.get(result["turn_id"]).status == "done")
    saved = rig.agent.history.get(result["turn_id"])
    assert saved.text == expected
    assert [m["text"] for m in rig.agent.history.messages([saved.id])[saved.id]] == [expected]

@pytest.mark.parametrize("state", ["approved", "rejected", "expired"])
async def test_terminal_pairing_updates_in_place_then_next_code_adds_a_turn(rig, state):
    card, running = await connected(rig)
    code = running.switchboard.pairing.issue("U1", "D1", "First")
    [row] = rig.conn.execute("SELECT * FROM messaging_pairing_cards").fetchall()
    before = len(await rig.agent.turns(member_id=card.member_id))
    if state == "expired":
        rig.now[0] += 600001
        rig.messaging.cards.sweep()
    else:
        await rig.agent.call("messaging.pairing.answer", {"id": row["id"], "approve": state == "approved"})
    [updated] = rig.messaging.cards.views([row["turn_id"]])[row["turn_id"]]
    assert updated["state"] == state and updated["code"] == code
    assert len(await rig.agent.turns(member_id=card.member_id)) == before
    assert ("agent.turn", {"turn_id": row["turn_id"], "member_id": card.member_id}) in rig.events
    next_code = running.switchboard.pairing.issue("U2", "D2", "Next")
    [latest] = rig.conn.execute("SELECT * FROM messaging_pairing_cards ORDER BY rowid DESC LIMIT 1").fetchall()
    assert latest["turn_id"] > row["turn_id"] and latest["code"] == next_code
    assert len(await rig.agent.turns(member_id=card.member_id)) == before + 1


async def test_pairing_restart_and_deleted_turn_cannot_be_answered(rig):
    from raphael_core.messaging.cards import MessagingCards
    from raphael_core.protocol import RpcError
    card, running = await connected(rig)
    running.switchboard.pairing.issue("U1", "D1", "First")
    [row] = rig.conn.execute("SELECT * FROM messaging_pairing_cards").fetchall()
    restarted = MessagingCards(rig.conn, rig.messaging, now_ms=lambda: rig.now[0])
    assert (await restarted.answer({"id": row["id"], "approve": True}))["card"]["state"] == "expired"
    assert not rig.messaging._config.channel(member_account(card.member_id, "telegram")).allowed
    with rig.conn:
        rig.conn.execute("DELETE FROM agent_turns WHERE id=?", (row["turn_id"],))
    assert not restarted.views([row["turn_id"]])
    with pytest.raises(RpcError):
        await restarted.answer({"id": row["id"], "approve": True})
    restarted.close()


@pytest.mark.parametrize("platform", list(LINKS))
@pytest.mark.parametrize("owner", [0, 1])
async def test_platform_reply_uses_own_language_through_fake_channel(rig, platform, owner):
    from raphael_core.messaging.channels.base import Incoming
    from raphael_core.messaging.core import session_target
    from messaging.test_switchboard import settle
    instruction = "Always speak Japanese."
    if owner:
        rig.team.members.store.update_member(owner, instructions=instruction)
    else:
        rig.agent.settings.set("first_bot_profile", {"name": "Raphael", "instructions": instruction})
    async def ask(session, text, language, source, **options):
        target = session_target(session)
        result = await rig.agent.call("agent.ask", {"session_id": session, "text": text, "member_id": target[0],
                                                   "ui_language": language, "source": source})
        return result["text"]
    rig.messaging._ask = ask
    rig.messaging._language = lambda: "en"
    card, running = await connected(rig, platform, owner)
    code = running.switchboard.pairing.issue("U1", "D1", "Owner")
    await rig.messaging._approve(member_account(owner, platform), {"code": code})
    rig.brain.chats = [live_said("日本語の返事です。")]
    channel = rig.channels[platform, "synthetic-" + platform]
    await channel.inbox.put(Incoming(user="U1", chat="D1", name="Owner", text="Please explain"))
    await settle(lambda: any(text == "日本語の返事です。" for _, text in channel.sent))
    assert instruction in str(rig.brain.chat_calls[-1]["messages"])


@pytest.mark.parametrize("ui", ["en", "ja", "zh-TW"])
def test_pairing_notice_names_current_conversation_in_each_locale(ui):
    from raphael_core.messaging.words import words
    notice = words(ui, "pair", code="ABC123")
    assert "ABC123" in notice
    assert {"en": "member conversation", "ja": "メンバーとの会話", "zh-TW": "成員的對話"}[ui] in notice
    for stale in ("Settings", "設定", "settings", "訊息"):
        assert stale not in notice


@pytest.mark.parametrize("platform", list(LINKS))
def test_setup_guidance_and_help_keep_pairing_in_the_conversation(platform):
    from raphael_core.agent.harness_tools import CONNECT_MESSAGING, DEFINITIONS
    from raphael_core.agent.intents import instruction
    from raphael_core.agent.self_check import ABOUT, PANES
    text = instruction("setup-" + platform) + DEFINITIONS[CONNECT_MESSAGING]["description"] + ABOUT
    for expected in ("already connected", "pairing card", "panel", "disconnect", "owner approval"):
        assert expected in text
    for stale in ("Settings > Messaging", "Settings › Messaging", "設定 → 訊息", "設定 › 訊息", "設定 › メッセージ"):
        assert stale not in text
    assert "messaging" not in PANES
