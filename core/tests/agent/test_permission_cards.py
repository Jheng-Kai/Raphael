"""The permission card of a typed private chat (P08c): the question the gate asks, said in the thread for
that exact action, with 允許一次, 一律允許 and 拒絕, bound to its digest, and the owner's rules around it.

The plugins are real ones over in-memory servers and the model is a fake; the card follows the production
`agent.confirm`. No test spends money or touches the network."""

import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.permissions import PermissionCards, qualifies
from raphael_core.agent import permissions as permission_module
from raphael_core.agent.plugins import PluginTool
from raphael_core.agent.policy import Tier
from raphael_core.agent.plugins import PlannedCall
from raphael_core.agent.safety import ASK, DENY, SEEDS, SafetyGuard, SafetyJudge, SafetyRules, narrow_scope
from raphael_core.brain.openrouter import ChatToolCall, ChatTurn, Decision
from raphael_core.brain.settings import SettingsStore

from .conftest import FakeOpenRouter, decision, noul, tool_plan
from .test_plugins import calls, plugins  # noqa: F401
from .test_service import make_rig  # noqa: F401


def chat(text, *tool_calls):
    return ChatTurn(text, [ChatToolCall(str(n), name, args, json.dumps(args)) for n, (name, args) in enumerate(tool_calls)],
                    "fake/model", 0.3, 10, 10, 1)


def finished(text="好了。"):
    return chat(json.dumps({"prefix": "Answer", "text": text, "detail": ""}))


async def typed(rig, text="Save an example", member_id=0, session="live"):
    return await rig.call("agent.ask", {"session_id": session, "text": text, "ui_language": "en", "source": "app",
                                        "member_id": member_id})


class Judge(FakeOpenRouter):
    """Jev, who says no rule falls under an action unless a test has directed him otherwise."""

    async def decide(self, **kwargs):
        if self.decisions:
            return await super().decide(**kwargs)
        self.decide_calls.append(kwargs)
        return Decision(answers={key: noul(0.0) for key in kwargs["questions"]}, cost_usd=0, latency_ms=1)


class Owner:
    """A rig whose assistant has the permission cards and the owner's rules, with a judge a test directs."""

    def __init__(self, conn, plugins, make_rig):
        self.conn, self.plugins = conn, plugins
        self.rules = SafetyRules(conn)
        self.judge = Judge()
        self.gate = ToolGate(plugins.hub, conn=conn, safety=SafetyGuard(self.rules, SafetyJudge(self.judge)))
        self.cards = PermissionCards(conn)
        self.rig = make_rig(plugins=plugins.hub, gate=self.gate, permissions=self.cards)

    def judged(self, *matches):
        """The judge says the rules `matches` (by id) fall under the next action, and no other."""
        self.judge.decisions.append(lambda **kwargs: Decision(
            answers={key: noul(0.93 if int(key.removeprefix("rule_")) in matches else 0.0) for key in kwargs["questions"]},
            cost_usd=0, latency_ms=1))

    def cards_of(self, turn_id):
        return self.cards.store.for_turns([turn_id]).get(turn_id, [])

    async def view(self, turn_id):
        turns = (await self.rig.call("agent.history.list", {"limit": 50}))["turns"]
        return next(turn for turn in turns if turn["id"] == turn_id)

    async def confirm(self, asked, approved=True, **extra):
        return await self.rig.call("agent.confirm", {"id": asked["confirm"]["id"], "approved": approved, **extra})


@pytest.fixture
def owner(conn, plugins, make_rig):
    return Owner(conn, plugins, make_rig)


def script(client, text="記下牛奶", tool="Notes__note", arguments=None):
    client.decisions.append(decision("answer"))
    client.chats = [chat("I will do it.", (tool, arguments or {"text": text})), finished()]


def test_message_preview_contains_only_typed_delivery_fields():
    tool = PluginTool("mcp:sample/send_message", "Sample", "send_message", "", {
        "properties": {key: {"type": "string"} for key in ("workspace", "channel", "thread_ts", "text", "api_key")}
    }, Tier.T2)
    preview_message = getattr(permission_module, "message_preview", lambda *_: None)
    args = {"workspace": "Sample studio", "channel": "#planning", "thread_ts": "123.456", "text": "Review the sample plan.", "api_key": "synthetic-secret"}
    assert preview_message(tool, args) == {"workspace": "Sample studio", "to": "#planning", "thread": "123.456", "body": "Review the sample plan."}
    assert preview_message(PluginTool(tool.key, tool.server, "read_message", "", tool.schema, Tier.T2), args) is None


@pytest.mark.parametrize("slug,arguments,expected", [
    ("GMAIL_SEND_EMAIL", {"recipient_email": "reader@example.invalid", "body": "Email body", "subject": "Plan"},
     {"to": "reader@example.invalid", "body": "Email body", "subject": "Plan"}),
    ("GMAIL_REPLY_TO_THREAD", {"recipient_email": "reader@example.invalid", "message_body": "Reply body", "thread_id": "thread-1"},
     {"to": "reader@example.invalid", "body": "Reply body", "thread": "thread-1"}),
    ("SLACK_SEND_MESSAGE", {"channel": "#planning", "markdown_text": "**Exact** words", "fallback_text": "Fallback", "thread_ts": "1.2"},
     {"to": "#planning", "body": "**Exact** words", "thread": "1.2"}),
    ("SLACK_SEND_MESSAGE", {"channel": "#planning", "fallback_text": "Fallback only"}, {"to": "#planning", "body": "Fallback only"}),
    ("SLACK_CHAT_POST_MESSAGE", {"channel": "#planning", "text": "Plain words"}, {"to": "#planning", "body": "Plain words"}),
    ("MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE", {"channel_id": "channel-1", "content": "Team words", "subject": "Plan"},
     {"to": "channel-1", "body": "Team words", "subject": "Plan"}),
    ("MICROSOFT_TEAMS_TEAMS_POST_CHAT_MESSAGE", {"chat_id": "chat-1", "content": "Chat words"}, {"to": "chat-1", "body": "Chat words"}),
    ("MICROSOFT_TEAMS_SEND_MESSAGE_TO_SELF", {"content": "Personal words"}, None),
    ("TELEGRAM_SEND_MESSAGE", {"chat_id": "chat-1", "text": "Telegram words"}, {"to": "chat-1", "body": "Telegram words"}),
    ("TELEGRAM_SEND_MESSAGE", {"chat_id": 123, "text": "Numeric recipient"}, None),
    ("WHATSAPP_SEND_MESSAGE", {"to_number": "+12025550123", "text": "WhatsApp words"}, {"to": "+12025550123", "body": "WhatsApp words"}),
    ("WHATSAPP_SEND_INTERACTIVE_BUTTONS", {"to_number": "+12025550123", "body_text": "Choose a time", "buttons": [{"id": "1"}]},
     {"to": "+12025550123", "body": "Choose a time"}),
    ("LINKEDIN_CREATE_LINKED_IN_POST", {"commentary": "Not a mapped field"}, None),
    ("LINKEDIN_CREATE_COMMENT_ON_POST", {"message": {"text": "Nested content is not a string"}}, None),
    ("TWITTER_CREATION_OF_A_POST", {"text": "Public words"}, None),
    ("GITHUB_CREATE_A_REPLY_FOR_A_REVIEW_COMMENT", {"body": "Review reply", "owner": "sample", "repo": "project"}, None),
    ("GITHUB_CREATE_AN_ISSUE_COMMENT", {"body": "Not a mapped send verb"}, None),
    ("SLACK_SEND_MESSAGE", {"channel": {"id": "private"}, "markdown_text": ["Not a string"]}, None),
    ("SLACK_SEND2_MESSAGE", {"channel": "#planning", "text": "Not a whole-word verb"}, None),
    ("DISCORDBOT_CROSSPOST_MESSAGE", {"channel_id": "channel-1", "text": "Not a whole-word verb"}, None),
    *[(slug, {"to": "reader", "body": "Never a send preview"}, None) for slug in
      ("GMAIL_SEND_DRAFT", "GMAIL_LIST_SEND_AS", "GMAIL_PATCH_SEND_AS", "GMAIL_SETTINGS_SEND_AS_GET",
       "GMAIL_UPDATE_SEND_AS", "LINKEDIN_DELETE_POST", "TWITTER_GET_POST_CONTENT", "TWITTER_LIST_POSTS")],
    ("NOTION_SEND_FILE_UPLOAD", {"file_upload_id": "file-1", "file_content_base64": "sample"}, None),
])
def test_composio_envelope_reaches_the_real_card_spec(owner, monkeypatch, slug, arguments, expected):
    from raphael_core.connectors.store import Connector

    service = owner.rig.service
    toolkit = "microsoft_teams" if slug.startswith("MICROSOFT_TEAMS_") else slug.split("_")[0].lower()
    app_name = {"gmail": "Gmail", "slack": "Slack", "microsoft_teams": "Microsoft Teams"}.get(toolkit, toolkit.title())
    entry = Connector(f"composio:{toolkit}", "composio", name=app_name, enabled_tools=[slug])
    monkeypatch.setattr(service._plugins, "managed", SimpleNamespace(store=SimpleNamespace(connectors={entry.id: entry})))
    specs, actions = [], []
    def opened(ask, action, route, text, ledger, *, card):
        specs.append(card)
        actions.append(action)
        return {"confirm": {"id": "envelope-question"}}
    monkeypatch.setattr(service, "_open_question", opened)
    monkeypatch.setattr(service, "_always_offered", lambda *_: False)
    envelope = {"tools": [{"tool_slug": slug, "arguments": {**arguments, "api_key": "synthetic-secret", "unrelated": {"raw": "private"}}}]}
    original = json.loads(json.dumps(envelope))
    tool = PluginTool("mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL", "Composio", "COMPOSIO_MULTI_EXECUTE_TOOL", "", {"properties": {"tools": {"type": "array"}}}, Tier.T2)
    service._ask_plugin(SimpleNamespace(language="en", speaker=SimpleNamespace(name="Alex")), PlannedCall(tool, envelope), [], None)
    [spec] = specs
    assert spec.message == expected
    assert (spec.service, spec.tool) == (app_name, slug)
    assert envelope == original and actions[0].args == original


@pytest.mark.parametrize("tools", [[], [{"tool_slug": "SLACK_SEND_MESSAGE", "arguments": {"channel": "a", "text": "one"}}] * 2,
                                  [{"tool_slug": "SLACK_SEND_MESSAGE", "arguments": "not an object"}]])
def test_ambiguous_or_malformed_composio_envelopes_have_no_message_preview(tools):
    tool = PluginTool("mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL", "Composio", "COMPOSIO_MULTI_EXECUTE_TOOL", "", {}, Tier.T2)
    assert permission_module.message_preview(tool, {"tools": tools}) is None
    assert permission_module.permission_identity(tool, {"tools": tools}) == ("", "COMPOSIO_MULTI_EXECUTE_TOOL")


async def test_message_fields_survive_settlement_and_reopening_without_other_arguments(owner, plugins, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    first = owner.cards_of(asked["turn_id"])[0]
    message = {"to": "#planning", "body": "Review the sample plan.", "api_key": "synthetic-secret"}
    card = owner.cards.show(card_id="message-preview", turn_id=first.turn_id, member_id=first.member_id,
                            conversation_id=first.conversation_id, source="ask", kind="tool", service="Sample",
                            tool="send_message", summary="Send the sample message?", reason="", digest=first.digest,
                            always=False, language="en", wait_ms=10000, message=message)
    assert card.view()["message"] == {"to": "#planning", "body": "Review the sample plan."}
    owner.cards.answered(card.id, "allowed")
    reopened = PermissionCards(owner.conn)
    assert reopened.store.get(card.id).view()["message"] == card.view()["message"]
    assert reopened.store.get(card.id).state == "allowed"


async def test_a_connected_message_keeps_exact_delivery_fields_and_the_original_approval(owner, plugins, client):
    from mcp.server.mcpserver import MCPServer

    server = MCPServer("sample")
    delivered = []

    @server.tool()
    def send_message(channel: str, text: str, workspace: str, thread_ts: str) -> str:
        delivered.append({"channel": channel, "text": text, "workspace": workspace, "thread_ts": thread_ts})
        return "Delivered."

    plugins.servers.by_name["Sample"] = server
    added = await plugins.rpc.call("integrations.add", {"name": "Sample", "transport": "stdio", "command": "unused"})
    server_id = added["server"]["id"]
    await plugins.rpc.call("integrations.set_enabled", {"id": server_id, "enabled": True})
    await plugins.rpc.call("integrations.refresh", {"id": server_id})
    plugins.hub.strict["send_message"] = Tier.T2
    args = {"channel": "#planning", "text": "Review the sample plan.", "workspace": "Sample studio", "thread_ts": "123.456"}
    script(client, tool="Sample__send_message", arguments=args)
    asked = await typed(owner.rig)
    assert delivered == []
    view = await owner.view(asked["turn_id"])
    [card] = view["permissions"]
    assert card["message"] == {"workspace": "Sample studio", "to": "#planning", "thread": "123.456", "body": "Review the sample plan."}
    await owner.confirm(asked, True, digest=card["digest"])
    assert delivered == [args]
    assert (await owner.view(asked["turn_id"]))["permissions"][0]["message"] == card["message"]


async def test_composio_approval_executes_the_original_envelope_once_and_keeps_the_draft(owner, plugins, client):
    from mcp.server.mcpserver import MCPServer

    server, delivered = MCPServer("router"), []
    @server.tool()
    def COMPOSIO_MULTI_EXECUTE_TOOL(tools: list[dict]) -> str:
        delivered.append({"tools": tools})
        return "Delivered."
    plugins.servers.by_name["Composio"] = server
    added = await plugins.rpc.call("integrations.add", {"name": "Composio", "transport": "stdio", "command": "unused"})
    server_id = added["server"]["id"]
    await plugins.rpc.call("integrations.set_enabled", {"id": server_id, "enabled": True})
    await plugins.rpc.call("integrations.refresh", {"id": server_id})
    plugins.hub.strict["COMPOSIO_MULTI_EXECUTE_TOOL"] = Tier.T2
    envelope = {"tools": [{"tool_slug": "SLACK_SEND_MESSAGE", "arguments": {
        "channel": "#planning", "markdown_text": "Exact **sample** words\nSecond line", "thread_ts": "1.2", "unrelated": {"flag": True}}}]}
    script(client, tool="Composio__COMPOSIO_MULTI_EXECUTE_TOOL", arguments=envelope)
    asked = await typed(owner.rig)
    [card] = (await owner.view(asked["turn_id"]))["permissions"]
    assert delivered == []
    assert (card["service"], card["tool"]) == ("Slack", "SLACK_SEND_MESSAGE")
    assert card["message"] == {"to": "#planning", "thread": "1.2", "body": "Exact **sample** words\nSecond line"}
    await owner.confirm(asked, True, digest=card["digest"])
    assert delivered == [envelope]
    await owner.confirm(asked, True, digest=card["digest"])
    assert delivered == [envelope]
    assert (await owner.view(asked["turn_id"]))["permissions"][0]["message"] == card["message"]


# --- the card of a question ----------------------------------------------------------------------------


async def test_a_tool_that_asks_shows_a_card_for_that_exact_action_in_the_chat_that_asked(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    confirm = asked["confirm"]
    assert asked["status"] == "confirm" and calls == []
    [card] = owner.cards_of(asked["turn_id"])
    assert (card.id, card.source, card.kind, card.service, card.tool, card.state) == (
        confirm["id"], "ask", "tool", "Notes", "note", "pending")
    assert card.summary == "Allow Notes to run note (text: 記下牛奶)?" and card.reason == ""
    assert card.digest == confirm["digest"] and len(card.digest) == 64
    # Nothing the owner wrote asks, so 一律允許 can take effect: the question carries the three answers.
    assert card.always and (confirm["yes"], confirm["no"], confirm["always"]) == ("Allow once", "Deny", "Always allow")
    view = await owner.view(asked["turn_id"])
    assert view["permissions"] == [card.view()] and view["status"] == "confirm"


async def test_allowing_once_runs_the_call_once_and_the_card_says_so(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    answered = await owner.confirm(asked, True, digest=asked["confirm"]["digest"])
    assert answered["text"] == "好了。" and calls == ["note"]
    assert owner.cards_of(asked["turn_id"])[0].state == "allowed"
    assert [rule for rule in owner.rules.rules() if rule.scope] == []  # a once is a once: no rule was made
    # A replay of the very same yes runs nothing, and the card stays what it was.
    again = await owner.confirm(asked, True)
    assert again["turn_id"] == 0 and again["text"] != "好了。"
    assert calls == ["note"] and owner.cards_of(asked["turn_id"])[0].state == "allowed"


async def test_an_answer_for_another_digest_changes_nothing_and_the_question_still_waits(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    stale = await owner.confirm(asked, True, digest="0" * 64)
    assert stale["turn_id"] == 0 and calls == []
    assert owner.cards_of(asked["turn_id"])[0].state == "pending" and (await owner.view(asked["turn_id"]))["status"] == "confirm"
    proper = await owner.confirm(asked, True, digest=asked["confirm"]["digest"])
    assert proper["text"] == "好了。" and calls == ["note"]


async def test_inputs_changed_after_the_question_never_use_the_yes(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    followup = owner.rig.service._followups[asked["confirm"]["id"]]
    followup.call.arguments["text"] = "something nobody was asked about"  # changed after the question
    await owner.confirm(asked, True)
    assert calls == []  # the call was not made: the yes was for another digest
    assert plugins.audit()[-1][3:] == ("none", "blocked")


async def test_no_answer_in_thirty_seconds_expires_the_card_and_a_late_yes_runs_nothing(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    owner.rig.clock.now += 31
    late = await owner.confirm(asked, True)
    assert late["text"] != "好了。" and calls == []
    assert owner.cards_of(asked["turn_id"])[0].state == "expired"


async def test_a_no_runs_nothing_and_the_card_is_denied(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    await owner.confirm(asked, False)
    assert calls == [] and owner.cards_of(asked["turn_id"])[0].state == "denied"
    assert (await owner.view(asked["turn_id"]))["status"] == "denied"


async def test_a_core_that_started_again_has_no_question_so_the_old_card_is_expired(owner, plugins, calls, client, conn):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    restarted = PermissionCards(conn)
    assert restarted.store.get(asked["confirm"]["id"]).state == "expired" and calls == []


# --- Always ----------------------------------------------------------------------------------------------


async def test_always_keeps_a_narrow_rule_for_that_tool_and_the_next_request_asks_nothing(owner, plugins, calls, client):
    server_id = await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    await owner.confirm(asked, True, always=True)
    assert calls == ["note"] and owner.cards_of(asked["turn_id"])[0].state == "always"
    [rule] = [rule for rule in owner.rules.rules() if rule.scope]
    assert (rule.verdict, rule.scope) == ("allow", narrow_scope(f"mcp:{server_id}/note"))
    # A new request for the same tool is made at once: no question, no card.
    script(client, "記下雞蛋")
    second = await typed(owner.rig, session="live-2")
    assert second["status"] == "done" and calls == ["note", "note"]
    assert owner.cards_of(second["turn_id"]) == []


async def test_always_covers_one_tool_and_the_others_still_ask(owner, plugins, calls, client):
    await plugins.connect(note="T2", wipe="T2")
    script(client)
    asked = await typed(owner.rig)
    await owner.confirm(asked, True, always=True)
    script(client, tool="Notes__wipe", arguments={})
    other = await typed(owner.rig, "Wipe the notes", session="live-2")
    assert other["status"] == "confirm" and calls == ["note"]  # a narrow rule is for one tool


async def test_where_a_rule_asks_the_card_offers_no_always_and_makes_none(owner, plugins, calls, client):
    await plugins.connect(note="T1")
    owner.rules.ensure_seeded("en")
    asking = [rule for rule in owner.rules.rules() if rule.action == SEEDS["en"][2]][0]  # send an email or a message...
    owner.judged(asking.id)
    script(client)
    asked = await typed(owner.rig)
    [card] = owner.cards_of(asked["turn_id"])
    assert card.state == "pending" and not card.always and SEEDS["en"][2] in card.reason
    assert "always" not in asked["confirm"] and asked["confirm"]["yes"] == "Yes"
    # Pressing Always anyway (a client that was not told it was offered) makes no rule.
    await owner.confirm(asked, True, always=True)
    assert calls == ["note"] and [rule for rule in owner.rules.rules() if rule.scope] == []
    assert owner.cards_of(asked["turn_id"])[0].state == "allowed"


async def test_an_always_made_earlier_never_beats_an_ask_first_the_owner_wrote_later(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    script(client)
    asked = await typed(owner.rig)
    await owner.confirm(asked, True, always=True)
    owner.rules.ensure_seeded("en")
    asking = owner.rules.create("Save notes", ASK)
    owner.judged(asking.id)
    script(client, "記下雞蛋")
    second = await typed(owner.rig, session="live-2")
    assert second["status"] == "confirm"  # Ask first has the last word over Always
    [card] = owner.cards_of(second["turn_id"])
    assert not card.always and "Save notes" in card.reason and calls == ["note"]


async def test_a_never_refuses_without_a_card(owner, plugins, calls, client):
    await plugins.connect(note="T1")
    owner.rules.ensure_seeded("en")
    never = owner.rules.create("Save notes", DENY)
    owner.judged(never.id)
    script(client)
    result = await typed(owner.rig)
    assert result["status"] == "done" and calls == []
    assert owner.cards.store.for_turns([result["turn_id"]]) == {}


async def test_the_global_switch_offers_always_and_always_waives_it_for_that_tool_alone(owner, plugins, calls, client, conn):
    await plugins.connect(note="T1", wipe="T1")
    SettingsStore(conn).set("action_mode", "ask")
    owner.rules.ensure_seeded("en")
    for rule in owner.rules.rules():
        owner.rules.delete(rule.id)
    script(client)
    asked = await typed(owner.rig)
    [card] = owner.cards_of(asked["turn_id"])
    assert card.always and card.reason == ""  # nothing the owner wrote asks: only the switch
    await owner.confirm(asked, True, always=True)
    script(client, "again")
    assert (await typed(owner.rig, session="live-2"))["status"] == "done"  # the switch is waived for that tool
    script(client, tool="Notes__wipe", arguments={})
    assert (await typed(owner.rig, "Wipe the notes", session="live-3"))["status"] == "confirm"  # ... and not for another


# --- no way round a no -----------------------------------------------------------------------------------


async def test_a_no_is_remembered_by_the_request_so_that_no_other_way_to_the_same_end_is_asked_about(owner, plugins, calls, client):
    server_id = await plugins.connect(note="T2", wipe="T2")
    script(client)
    asked = await typed(owner.rig)
    followup = owner.rig.service._followups[asked["confirm"]["id"]]
    await owner.confirm(asked, False)
    assert followup.ask.declined == [(f"mcp:{server_id}/note", None)] and calls == []
    # What a continuing turn (a CLI brain's) meets next in that request: the tool again, or another one.
    service, ask = owner.rig.service, followup.ask
    same = await service._carry_out(ask, [followup.call], [], ask.ledger)
    assert [(result.ok, result.error) for result in same] == [(False, "declined")] and same[0].instruction
    other_tool = next(tool for tool in plugins.hub.offered() if tool.name == "wipe")
    other = await service._carry_out(ask, [PlannedCall(other_tool, {})], [], ask.ledger)
    assert [(result.ok, result.error) for result in other] == [(False, "declined")]
    assert calls == [] and owner.cards.store.for_turns([asked["turn_id"]])[asked["turn_id"]][0].state == "denied"


# --- who is shown a card ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("source", "quick", "nested", "scope", "shown"),
    [
        ("app", False, False, "private", True),
        ("connector", False, False, "private", True),  # a task resumed in the same thread
        ("voice", False, False, "private", True),  # said into the chat the owner is at
        ("voice", True, False, "private", False),  # a question spoken at the key: the overlay asks
        ("telegram", False, False, "private", False),  # a message from a phone
        ("app", True, False, "private", False),  # a quick question
        ("app", False, True, "private", False),  # a request one member handed another
        ("app", False, False, "room", False),  # a room
        ("member", False, False, "exchange", False),
    ],
)
def test_only_a_private_chat_the_owner_is_at_is_shown_a_card(source, quick, nested, scope, shown):
    assert qualifies(source=source, quick=quick, nested=nested, scope=scope) is shown


async def test_a_spoken_request_is_asked_by_the_overlay_and_has_no_card(owner, plugins, calls, client):
    await plugins.connect(note="T2")
    client.decisions.append(decision("answer"))
    client.plans.append(tool_plan(("Notes__note", {"text": "x"})))
    result = await owner.rig.ask("記下牛奶")
    assert result["status"] == "confirm" and owner.cards.views([result["turn_id"]]) == {}
    assert owner.cards_of(result["turn_id"])[0].context_only
    assert "digest" not in result["confirm"] and "always" not in result["confirm"]


async def test_a_call_that_cannot_be_undone_keeps_the_gold_card_that_is_held_to_confirm(owner, plugins, calls, client):
    await plugins.connect(note="T3")
    script(client)
    asked = await typed(owner.rig)
    # A click is not enough for what cannot be undone: no card in the thread, no 一律允許, and the overlay's question as before.
    assert asked["status"] == "confirm" and asked["confirm"]["tier"] == "T3"
    assert owner.cards.views([asked["turn_id"]]) == {} and "always" not in asked["confirm"]
    [stored] = owner.cards_of(asked["turn_id"])
    assert stored.context_only and stored.state == "pending"
    done = await owner.confirm(asked, True)
    assert done["text"] == "好了。" and calls == ["note"]
