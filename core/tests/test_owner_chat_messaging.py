"""Current messaging facts and repeated setup use the service's own state."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.card_context import messaging_state
from raphael_core.agent.self_check import snapshot
from raphael_core.agent.speaker import Speaker
from raphael_core.messaging.service import secret_name
from test_chat_setup_share import rig, chat, live_said  # noqa: F401


@pytest.mark.parametrize("platform", ["telegram", "slack", "discord"])
async def test_self_check_and_setup_report_current_token_enabled_and_paired(rig, platform):
    member = rig.member.id
    account = rig.messaging._member_type(member, platform)
    assert (await rig.messaging._connect(account, {"token": "synthetic-token"}))["ok"]
    board = rig.messaging._running[account].switchboard
    code = board.pairing.issue("private-user", "private-chat", "Private name")
    first = await rig.messaging._approve(account, {"code": code})
    assert first["approved"]
    await asyncio.sleep(0)
    before = rig.messaging._store._path.read_bytes()
    second = await rig.messaging._approve(account, {"code": code})
    assert second["approved"] and second["already_paired"]
    assert "already paired" in second["text"]
    assert rig.messaging._store._path.read_bytes() == before
    assert len(rig.messaging._config.channel(account).allowed) == 1
    ask = SimpleNamespace(scope="private", nested=False, speaker=Speaker(id=member), conversation_id=None)
    facts = snapshot(rig.agent.service, ask)["messaging"]
    fact = next(row for row in facts if row["platform"] == platform)
    assert fact["token_present"] and fact["enabled"] and fact["paired"]
    assert fact["allowed_count"] == 1 and fact["pending_count"] == 0
    public = json.dumps(facts)
    assert all(secret not in public for secret in ("synthetic-token", "private-user", "private-chat", code))
    rig.brain.chats = [chat("", ("connect_messaging", {"platform": platform})), live_said("Already paired.")]
    checks = len(rig.checks)
    await rig.ask("setup-" + platform)
    assert len(rig.checks) == checks
    result = next(m["content"] for m in rig.brain.chat_calls[-1]["messages"] if m["role"] == "tool")
    assert "already paired" in result and "Settings" not in result
    await rig.messaging._set_enabled(account, {"enabled": False})
    fact = next(row for row in snapshot(rig.agent.service, ask)["messaging"] if row["platform"] == platform)
    assert fact["token_present"] and fact["paired"] and not fact["enabled"] and not fact["running"]
    rig.vault.delete(secret_name(account, "token"))
    fact = next(row for row in snapshot(rig.agent.service, ask)["messaging"] if row["platform"] == platform)
    assert not fact["token_present"]
    assert "token_present=false" in messaging_state(rig.messaging, member)
    rig.brain.chats = [chat("", ("connect_messaging", {"platform": platform})), live_said("Use the secure card.")]
    result = await rig.ask("setup-" + platform, session="missing-token")
    assert len(rig.cards.cards_of(result["turn_id"])) == 1
    ask.scope = "exchange"
    assert snapshot(rig.agent.service, ask)["messaging"] == []
