"""Event words and read slugs; paths come only from the selected read's reply."""

import json
from collections import deque
from copy import deepcopy
from types import SimpleNamespace

from ..connectors.response import unwrap_envelope, unwrap_read
from ..connectors.http import ConnectorFailure
from .events import MAX_ITEMS, MAX_ITEM_CHARS, _PATH, failure_message

# No result paths belong in this catalogue.
EVENTS = (
    ("gmail-mail", "gmail", "GMAIL_FETCH_EMAILS", "", ("新郵件", "New mail", "新着メール"), {"max_results": 20, "include_payload": False, "verbose": False}),
    ("calendar-event", "googlecalendar", "GOOGLECALENDAR_EVENTS_LIST", "", ("新行程", "New event", "新しい予定"), {"calendarId": "primary", "maxResults": 50, "singleEvents": True, "orderBy": "updated"}),
    ("github-issue", "github", "GITHUB_LIST_REPOSITORY_ISSUES", "repository", ("新 Issue", "New issue", "新しい Issue"), {"per_page": 20, "sort": "created", "direction": "desc", "state": "all"}),
    ("github-pr", "github", "GITHUB_LIST_PULL_REQUESTS", "repository", ("新 PR", "New pull request", "新しい PR"), {"per_page": 20, "sort": "created", "direction": "desc", "state": "all"}),
    ("github-commit", "github", "GITHUB_LIST_COMMITS", "repository", ("新 Commit", "New commit", "新しい Commit"), {"per_page": 20}),
    ("github-failure", "github", "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY", "repository", ("工作流程失敗", "Workflow failed", "ワークフロー失敗"), {"per_page": 20, "status": "failure"}),
    ("slack-message", "slack", "SLACK_FETCH_CONVERSATION_HISTORY", "channel", ("頻道新訊息", "New channel message", "チャンネルの新着メッセージ"), {"limit": 20}),
    ("linear-issue", "linear", "LINEAR_LIST_LINEAR_ISSUES", "", ("新 Issue", "New issue", "新しい Issue"), {"first": 20}),
    ("notion-page", "notion", "NOTION_SEARCH_NOTION_PAGE", "", ("新頁面", "New page", "新しいページ"), {"page_size": 20, "direction": "descending", "timestamp": "last_edited_time"}),
)


def connected_apps(connections):
    # The integrations view reports ACTIVE managed accounts as ready.
    return [c for c in connections if c.get("enabled", True) and c.get("status") == "ready" and not c.get("error")]


def available_events(connections, language="en"):
    index = 0 if language == "zh-TW" else 2 if language == "ja" else 1
    return [{"id": identifier, "toolkit": toolkit, "slug": slug, "input": field,
             "label": words[index], "app": app["id"], "app_name": app.get("name", app["id"])}
            for app in connected_apps(connections) if app.get("source") == "composio"
            for identifier, toolkit, slug, field, words, _ in EVENTS if toolkit in app.get("services", [])]


def _detect(payload, prefix):
    queue = deque([(payload, prefix.split(".") if prefix else [])])
    visited = 0
    unidentified = False
    while queue:
        value, segments = queue.popleft()
        visited += 1
        if visited > 10000:
            raise ValueError("response")
        if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            for key in ("id", "messageId", "number", "sha", "ts", "node_id", "threadId"):
                if all(type(item.get(key)) in (str, int) and 0 < len(str(item[key])) <= 500 for item in value):
                    if len(value) > MAX_ITEMS or any(len(json.dumps(item, ensure_ascii=False)) > MAX_ITEM_CHARS for item in value):
                        raise ValueError("response")
                    path = ".".join(segments)
                    if len(path) > 200 or any("." in part or not _PATH.fullmatch(part) for part in segments):
                        raise ValueError("response")
                    return path, key
            unidentified = True
        children = value.items() if isinstance(value, dict) else enumerate(value) if isinstance(value, list) else ()
        for key, child in children:
            queue.append((child, [*segments, str(key)]))
    raise ValueError("identity" if unidentified else "empty")


def detect_items(data):
    """First object list with a common stable id, in breadth-first order."""
    return _detect(*unwrap_envelope(data))


async def pick_event(service, member_id, identifier, value):
    language = service._language()
    choice = next((e for e in available_events(service._connections(), language) if e["id"] == identifier), None)
    name = choice["app_name"] if choice else "App"
    if choice is None or service._events is None:
        return {"event_error": failure_message(language, name, stop=True)}
    args = deepcopy(next(entry[5] for entry in EVENTS if entry[0] == identifier))
    if choice["input"]:
        if not isinstance(value, str) or not value.strip() or len(value) > 500:
            return {"event_error": failure_message(language, name)}
        if choice["input"] == "repository":
            owner, _, repo = value.strip().partition("/")
            args.update(owner=owner, repo=repo)
        else:
            args["channel"] = value.strip()
    when = {"app": choice["app"], "event": {"tool": "mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL",
            "arguments": {"tools": [{"tool_slug": choice["slug"], "arguments": args}]}, "items": "", "id": "id"},
            "filter": {"field": "", "equals": ""}}
    # Discovery samples existing events; only subsequent polls move the time window.
    probe = deepcopy(when)
    if identifier == "calendar-event":
        probe["event"]["arguments"]["tools"][0]["arguments"]["maxResults"] = 10
        when["event"]["since"] = {"arg": "updatedMin", "format": "iso"}
    routine = SimpleNamespace(member_id=member_id, when=probe)
    try:
        result = await service._events.read(routine)
        if result is None:
            return {"event_error": failure_message(language, name, stop=True)}
        if not result.ok or result.truncated:
            return {"event_error": failure_message(language, name)}
        if choice not in available_events(service._connections(), language) or service._events._tool(routine) is None:
            return {"event_error": failure_message(language, name, stop=True)}
        when["event"]["items"], when["event"]["id"] = _detect(*unwrap_read(result))
        return {"when": when}
    except ValueError as error:
        reason = str(error)
        if reason in ("empty", "identity"):
            words = {
                "zh-TW": (f"目前沒有可用的{name}項目。出現新項目後，請再試一次。", f"無法辨識{name}項目，暫時無法設定此事件。請稍後重試。"),
                "ja": (f"{name}に利用できる項目がありません。項目が届いてから再試行してください。", f"{name}の項目を識別できないため、このイベントはまだ設定できません。再試行してください。"),
                "en": (f"No {name} items are available yet. Try again after an item arrives.", f"Could not identify {name} items, so this event cannot be set up yet. Try again later."),
            }
            return {"event_error": words.get(language, words["en"])[reason == "identity"]}
        return {"event_error": failure_message(language, name)}
    except (KeyError, IndexError, TypeError, AttributeError, TimeoutError, ConnectorFailure):
        return {"event_error": failure_message(language, name)}
