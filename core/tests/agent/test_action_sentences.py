import json

import pytest

from raphael_core.agent.actions import sentence, action_scope, is_action
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.steps import Step


@pytest.mark.parametrize("tool,args,present,past", [
    ("read_file", {"path": "C:/sample/note.md"}, "正在讀取 note.md", "讀取了 note.md"),
    ("edit_file", {"path": "/sample/page.html"}, "正在修改 page.html", "修改了 page.html"),
    ("web_search", {"query": "sample orchard"}, "正在搜尋「sample orchard」", "搜尋了「sample orchard」"),
    ("web_read", {"url": "https://example.com/private?token=sample"}, "正在閱讀 example.com", "閱讀了 example.com"),
    ("local_exec", {"command": "npm test TOKEN=sample-value ignored"}, "正在執行 npm test", "執行了 npm test"),
    ("local_job", {}, "正在查看指令的進度", "查看了指令的進度"),
    ("computer__type", {"text": "sample private words"}, "正在電腦上輸入文字", "在電腦上輸入了文字"),
])
def test_sentences(tool, args, present, past):
    assert sentence(tool, args, "zh-TW") == (present, past)


@pytest.mark.parametrize("key", ["password", "access_token", "secret", "api_key", "authorization"])
def test_private_fields_are_never_used(key):
    words = sentence("web_search", {key: "sample-private-value"}, "en")
    assert "sample-private-value" not in str(words)


@pytest.mark.parametrize("tool", ["request_secret", "computer_login", "login"])
def test_login_and_secret_calls_never_name_their_arguments(tool):
    assert "sample-hidden" not in str(sentence(tool, {"title": "sample-hidden", "name": "sample-hidden", "text": "sample-hidden"}, "en"))


def test_app_verbs_and_bounds():
    for verb in ("search", "list", "get", "fetch", "read", "create", "add", "update", "edit", "delete", "remove", "send", "post", "reply", "unknown"):
        present, past = sentence("NOTION_" + verb.upper() + "_PAGE", {}, "en", server="composio")
        assert "Notion" in present and "NOTION_" not in past
    assert len(sentence("web_search", {"query": "x" * 200}, "en")[0]) <= 60
    assert "private" not in str(sentence("local_exec", {"command": "npm test --token private"}, "en"))


def test_composio_envelope_names_each_app_without_reading_inner_arguments():
    words = sentence("COMPOSIO_MULTI_EXECUTE_TOOL", {"tools":[
        {"tool_slug":"NOTION_UPDATE_PAGE", "arguments":{"token":"sample-hidden"}},
        {"tool_slug":"GMAIL_SEND_EMAIL", "arguments":{"body":"sample-hidden"}},
    ]}, "en", server="Composio")
    assert "Notion" in words[0] and "Gmail" in words[0]
    assert "sample-hidden" not in str(words)


def test_composio_calendar_words_still_describe_the_connected_app():
    assert sentence("NOTION_CREATE_CALENDAR", {}, "en", server="composio") == ("Creating in Notion", "Created in Notion")


@pytest.mark.parametrize("language", ["zh-TW", "en", "ja"])
@pytest.mark.parametrize("tool,args", [
    ("write_file", {"path":"C:\\sample\\page.html", "text":"sample-hidden"}),
    ("ask_member", {"member":"Sample colleague", "request":"sample-hidden"}),
    ("routine_update", {"title":"Sample routine", "prompt":"sample-hidden"}),
    ("calendar_add", {"title":"Sample appointment", "notes":"sample-hidden"}),
    ("browser_type", {"text":"sample-hidden", "selector":"sample-hidden"}),
    ("local_exec", {"command":"npm test secret=sample-hidden"}),
    ("local_exec", {"command":"npm test sk-sample123456789 more"}),
    ("web_read", {"url":"https://user:sample-hidden@example.com/private?query=sample-hidden"}),
])
def test_each_language_keeps_only_allowed_targets(tool, args, language):
    words = sentence(tool, args, language, server="computer" if tool == "browser_type" else None)
    assert "sample-hidden" not in str(words)
    assert "private?" not in str(words)
    assert all(0 < len(word) <= 60 for word in words)


def test_action_notifications_do_not_mark_a_conversation_unread():
    from types import SimpleNamespace
    from unittest.mock import Mock
    from raphael_core.app import App
    app = SimpleNamespace(members=Mock(), rooms=Mock(), notify=Mock())
    App._agent_notice(app, "agent.turn", {"turn_id":1, "member_id":1, "activity_only":True})
    app.members.turn_arrived.assert_not_called()
    app.rooms.turn_arrived.assert_not_called()
    app.notify.assert_called_once()


def test_actions_are_conversation_only_and_clear_with_it(conn):
    history = AgentHistory(conn)
    turn = history.add(session_id="sample", question="sample request", route="answer", prefix="", text="sample reply", status="done")
    with action_scope(history, turn, "en", "read_file", {"path": "/sample/private-note.md"}):
        assert is_action(history.messages([turn])[turn][-1]["text"])
    history.add_steps(turn, [Step("tool", "read_file", "Raphael", "ok", 1)])
    assert "private-note" not in json.dumps([dict(row) for row in conn.execute("SELECT * FROM agent_steps")])
    assert "private-note" not in str(history.recent(10))
    history.clear()
    assert conn.execute("SELECT COUNT(*) FROM agent_messages").fetchone()[0] == 0


def test_a_wait_for_permission_is_not_a_failed_completed_action(conn):
    from raphael_core.background.run import stopped
    history = AgentHistory(conn)
    turn = history.add(session_id="sample", question="Sample", route="answer", prefix="", text="", status="running")
    with pytest.raises(Exception):
        with action_scope(history, turn, "en", "local_exec", {"command":"npm test"}):
            raise stopped("waiting", "sample-hidden")
    messages = history.messages([turn])[turn]
    assert json.loads(messages[-1]["text"])["state"] == "paused"
    assert "sample-hidden" not in str(messages)
