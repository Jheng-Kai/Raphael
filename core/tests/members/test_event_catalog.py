"""Catalogue detection uses synthetic upstream fixtures, never account content."""

import copy
import json
from datetime import datetime, timezone

import pytest

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.plugins import PluginResult, PluginTool
from raphael_core.agent.policy import Tier
from raphael_core.members.events import POLL_MS
from raphael_core.worker.guards import MAX_RESULT_CHARS


def envelope(payload, *, nested=False):
    return {"successful": True, "error": None, "log_id": "synthetic-log", "data": {
        "total_count": 1, "success_count": 1, "error_count": 0, "results": [{"index": 0,
        "tool_slug": "SYNTHETIC_READ", "response": {
        "successful": True, "data": {"response_data": payload} if nested else payload}}]}}


@pytest.mark.parametrize("label,payload,path,identity", [
    ("observed_gmail_fields_synthetic_items", {"messages": [{"messageId": "mail-1"}], "nextPageToken": "synthetic-next", "resultSizeEstimate": 1}, "messages", "messageId"),
    ("observed_calendar_fields_synthetic_items", {"accessRole": "owner",
        "defaultReminders": [{"method": "popup", "minutes": 10}], "description": "Synthetic calendar", "etag": "synthetic-etag", "items": [{"id": "event-1"}],
        "kind": "calendar#events", "nextPageToken": "synthetic-next", "summary": "Calendar", "timeZone": "UTC", "updated": "2026-11-01T00:00:00Z"}, "items", "id"),
    ("unobserved_github_issues", [{"id": 1, "number": 3}], "", "id"),
    ("unobserved_github_prs", [{"number": 4}], "", "number"),
    ("unobserved_github_commits", [{"sha": "abc123"}], "", "sha"),
    ("unobserved_github_workflows", {"total_count": 1, "workflow_runs": [{"id": 8, "conclusion": "failure"}]}, "workflow_runs", "id"),
    ("unobserved_slack", {"ok": True, "messages": [{"ts": "123.001", "text": "Hello"}]}, "messages", "ts"),
    ("unobserved_linear", {"issues": [{"id": "issue-1"}], "page_info": {"has_next_page": False}}, "issues", "id"),
    ("unobserved_notion", {"object": "list", "results": [{"id": "page-1", "object": "page"}]}, "results", "id"),
])
@pytest.mark.parametrize("nested", [False, True])
def test_detects_observed_wrappers_and_unobserved_upstream_fixtures(label, payload, path, identity, nested):
    from raphael_core.members.event_catalog import detect_items
    data = envelope(payload, nested=nested)
    original = copy.deepcopy(data)
    prefix = "data.results.0.response.data" + (".response_data" if nested else "")
    assert detect_items(data) == (prefix + ("." + path if path else ""), identity)
    assert data == original


@pytest.mark.parametrize("payload,reason", [
    ({"items": []}, "empty"), ({"items": [{"text": "Hello"}]}, "identity"),
    ({"items": [{"id": "a"}, {"number": 2}]}, "identity"),
    ({"items": [{"id": True}]}, "identity"),
    ({"bad.key": [{"id": "item-1"}]}, "response"),
    ({"reminders": [{"method": "popup"}], "items": [{"title": "No identity"}]}, "identity"),
])
def test_empty_or_wholly_unidentifiable_reply_is_retryable(payload, reason):
    from raphael_core.members.event_catalog import detect_items
    with pytest.raises(ValueError, match=reason):
        detect_items(envelope(payload))


def test_detector_is_breadth_first_and_uses_common_identity_priority():
    from raphael_core.members.event_catalog import detect_items
    assert detect_items(envelope({"deep": {"items": [{"id": "deep"}]}, "items": [{"id": "", "ts": "1"}, {"ts": "2"}]})) == ("data.results.0.response.data.items", "ts")
    with pytest.raises(ValueError):
        detect_items({"successful": True, "data": {"error_count": 1, "results": []}})


def test_detector_continues_breadth_first_past_unidentified_lists():
    from raphael_core.members.event_catalog import detect_items
    payload = {"defaultReminders": [{"nested": [{"id": "deep"}]}], "items": [{"id": "near"}]}
    assert detect_items(envelope(payload)) == ("data.results.0.response.data.items", "id")
    assert detect_items(envelope({"reminders": [{"nested": [{"id": "deep"}]}]})) == ("data.results.0.response.data.reminders.0.nested", "id")


@pytest.mark.parametrize("metadata", [[{"method": "popup"}] * 1001, [{"description": "x" * 32_001}]])
def test_unidentified_metadata_does_not_consume_the_item_array_limits(metadata):
    from raphael_core.members.event_catalog import detect_items
    assert detect_items(envelope({"metadata": metadata, "items": [{"id": "event-1"}]})) == ("data.results.0.response.data.items", "id")


@pytest.mark.parametrize("items", [[{"id": "a"}] * 1001, [{"id": "a", "description": "x" * 32_001}]])
def test_detected_items_still_obey_the_engine_limits(items):
    from raphael_core.members.event_catalog import detect_items
    with pytest.raises(ValueError, match="response"):
        detect_items(envelope({"items": items}))


class CatalogueHub:
    def __init__(self):
        self.payload = {"messages": [{"id": "old"}]}
        self.calls = []
        self.ok, self.read = True, True

    def offered(self):
        return [PluginTool("mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL", "connectors_composio", "COMPOSIO_MULTI_EXECUTE_TOOL", "Read", {}, Tier.T1)]

    def tier_of(self, key):
        return Tier.T1

    def kind_of(self, server, tool):
        return "read" if self.read else "write"

    def event_tool_belongs(self, app, key, args):
        return app.startswith("composio:") and len(args["tools"]) == 1

    async def call(self, key, args, **scope):
        self.calls.append((key, args, scope))
        return PluginResult(self.ok, None if self.ok else "network", json.dumps(envelope(self.payload)))


def setup(rig):
    hub = CatalogueHub()
    rig.service.use_event_tools(ToolGate(hub, conn=rig.conn))
    rig.service._connections = lambda: [
        {"id": "composio:gmail", "name": "Gmail", "source": "composio", "services": ["gmail"], "status": "ready", "enabled": True},
        {"id": "composio:github", "name": "GitHub", "source": "composio", "services": ["github"], "status": "ready", "enabled": True},
        {"id": "composio:slack", "name": "Slack", "source": "composio", "services": ["slack"], "status": "unchecked", "enabled": True},
    ]
    return hub


async def test_owner_and_member_pick_identical_when_and_first_poll_is_baseline(rig):
    hub = setup(rig)
    owner = await rig.call("routines.list", {"member_id": 0, "event": "gmail-mail"})
    member = await rig.service.routine_tool(0, "routine_list", {"event": "gmail-mail"})
    assert owner == member
    assert len(hub.calls) == 2 and all(call[2]["approver"] == "auto" for call in hub.calls)
    assert owner["event_apps"] == ["Gmail", "GitHub"]
    assert len(owner["events"]) == 5
    assert all("items" not in entry and "id_path" not in entry for entry in owner["events"])
    fields = {"member_id": 0, "title": "New mail", "prompt": "Prepare a draft", "when": owner["when"]}
    first = (await rig.call("routines.create", fields))["routine"]
    second = (await rig.service.routine_tool(0, "routine_create", {k: v for k, v in fields.items() if k != "member_id"}))["routine"]
    assert first["when"] == second["when"]
    await rig.service.poll_events()
    assert rig.background.submitted == []
    hub.payload["messages"].append({"id": "new"})
    rig.wall.now += POLL_MS
    await rig.service.poll_events()
    assert len(rig.background.submitted) == 2


@pytest.mark.parametrize("mode", ["empty", "identity", "network", "write", "disconnected"])
async def test_failed_pick_creates_nothing_and_can_be_retried(rig, mode):
    hub = setup(rig)
    if mode == "empty": hub.payload = {"messages": []}
    if mode == "identity": hub.payload = {"messages": [{"body": "Hello"}]}
    if mode == "network": hub.ok = False
    if mode == "write": hub.read = False
    if mode == "disconnected": rig.service._connections = lambda: []
    result = await rig.call("routines.list", {"member_id": 0, "event": "gmail-mail"})
    assert "when" not in result and result["event_error"]
    assert rig.service.store.routines() == []
    assert len(hub.calls) == (0 if mode in ("write", "disconnected") else 1)
    setup(rig)
    assert "when" in await rig.call("routines.list", {"member_id": 0, "event": "gmail-mail"})


async def test_repository_is_plain_input_and_failure_filter_is_in_the_read(rig):
    hub = setup(rig)
    hub.payload = {"workflow_runs": [{"id": 1}]}
    result = await rig.call("routines.list", {"member_id": 0, "event": "github-failure", "value": "team name/repo.name"})
    assert "when" in result
    assert hub.calls[0][1] == {"tools": [{"tool_slug": "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY", "arguments": {"owner": "team name", "repo": "repo.name", "per_page": 20, "status": "failure"}}]}


SMALL_READS = [
    ("gmail-mail", "gmail", "GMAIL_FETCH_EMAILS", {"max_results": 20, "include_payload": False, "verbose": False}, "max_results"),
    ("calendar-event", "googlecalendar", "GOOGLECALENDAR_EVENTS_LIST", {"calendarId": "primary", "maxResults": 50, "singleEvents": True, "orderBy": "updated"}, "maxResults"),
    ("github-issue", "github", "GITHUB_LIST_REPOSITORY_ISSUES", {"per_page": 20, "sort": "created", "direction": "desc", "state": "all"}, "per_page"),
    ("github-pr", "github", "GITHUB_LIST_PULL_REQUESTS", {"per_page": 20, "sort": "created", "direction": "desc", "state": "all"}, "per_page"),
    ("github-commit", "github", "GITHUB_LIST_COMMITS", {"per_page": 20}, "per_page"),
    ("github-failure", "github", "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY", {"per_page": 20, "status": "failure"}, "per_page"),
    ("slack-message", "slack", "SLACK_FETCH_CONVERSATION_HISTORY", {"limit": 20}, "limit"),
    ("linear-issue", "linear", "LINEAR_LIST_LINEAR_ISSUES", {"first": 20}, "first"),
    ("notion-page", "notion", "NOTION_SEARCH_NOTION_PAGE", {"page_size": 20, "direction": "descending", "timestamp": "last_edited_time"}, "page_size"),
]


def synthetic_window(identifier, count):
    """Observed Gmail/Calendar envelope fields, synthetic items; other shapes unobserved."""
    prose = "Synthetic item details for a delegated task. " * 14
    if identifier == "gmail-mail":
        return {"messages": [{"messageId": f"mail-{n}", "threadId": f"thread-{n}", "snippet": prose,
            "labelIds": ["INBOX"], "sender": "sender@example.com", "subject": "Synthetic mail"} for n in range(count)],
            "nextPageToken": "synthetic-next", "resultSizeEstimate": count}
    if identifier == "calendar-event":
        return {"accessRole": "owner", "defaultReminders": [{"method": "popup", "minutes": 10}],
            "description": "Synthetic calendar", "etag": "synthetic-etag",
            "items": [{"id": f"event-{n}", "summary": "Synthetic meeting", "description": prose,
                "start": {"dateTime": "2026-11-02T09:00:00Z"}, "end": {"dateTime": "2026-11-02T10:00:00Z"},
                "updated": "2026-11-02T08:00:00Z"} for n in range(count)],
            "kind": "calendar#events", "nextPageToken": "synthetic-next", "summary": "Calendar", "timeZone": "UTC", "updated": "2026-11-02T08:00:00Z"}
    if identifier in ("github-issue", "github-pr"):
        return [{"id": n + 1, "number": n + 1, "title": "Synthetic issue", "body": prose, "state": "open"} for n in range(count)]
    if identifier == "github-commit":
        return [{"sha": f"{n:040x}", "commit": {"message": prose, "author": {"name": "Sample", "date": "2026-11-02T08:00:00Z"}}} for n in range(count)]
    if identifier == "github-failure":
        return {"total_count": count, "workflow_runs": [{"id": n + 1, "name": "Synthetic workflow", "display_title": prose,
            "status": "completed", "conclusion": "failure"} for n in range(count)]}
    if identifier == "slack-message":
        return {"ok": True, "messages": [{"ts": f"123.{n:06}", "text": prose, "user": "SYNTHETIC"} for n in range(count)], "has_more": True}
    if identifier == "linear-issue":
        return {"issues": [{"id": f"issue-{n}", "title": "Synthetic issue", "description": prose} for n in range(count)], "page_info": {"has_next_page": True}}
    return {"object": "list", "results": [{"id": f"page-{n}", "object": "page", "properties": {"title": {"type": "title",
        "title": [{"plain_text": prose}]}}} for n in range(count)], "has_more": True, "next_cursor": "synthetic-next"}


@pytest.mark.parametrize("identifier,toolkit,slug,expected,limit", SMALL_READS,
    ids=[("observed_envelope_" if row[1] in ("gmail", "googlecalendar") else "unobserved_") + row[0] for row in SMALL_READS])
async def test_small_catalogue_reads_fit_realistic_fixture_windows(rig, identifier, toolkit, slug, expected, limit):
    hub = setup(rig)
    rig.service._connections = lambda: [{"id": f"composio:{toolkit}", "name": toolkit, "source": "composio",
        "services": [toolkit], "status": "ready", "enabled": True}]

    async def bounded(key, args, **scope):
        hub.calls.append((key, copy.deepcopy(args), scope))
        count = args["tools"][0]["arguments"].get(limit, 100)
        text = json.dumps(envelope(synthetic_window(identifier, count)))
        return PluginResult(True, text=text, truncated=len(text) > MAX_RESULT_CHARS)

    hub.call = bounded
    result = await rig.call("routines.list", {"member_id": 0, "event": identifier, "value": "sample/repository" if toolkit == "github" else "C012345"})
    assert "when" in result, result
    scoped = {**expected, **({"owner": "sample", "repo": "repository"} if toolkit == "github" else {"channel": "C012345"} if toolkit == "slack" else {})}
    probe = {**scoped, "maxResults": 10} if toolkit == "googlecalendar" else scoped
    assert hub.calls[0][1] == {"tools": [{"tool_slug": slug, "arguments": probe}]}
    assert result["when"]["event"]["arguments"] == {"tools": [{"tool_slug": slug, "arguments": scoped}]}
    size = len(json.dumps(envelope(synthetic_window(identifier, expected[limit]))))
    assert size < MAX_RESULT_CHARS
    if toolkit == "gmail":
        assert size >= 6718 * 2  # The maintainer measured 6,718 characters for ten real items.
    if toolkit == "googlecalendar":
        assert result["when"]["event"]["since"] == {"arg": "updatedMin", "format": "iso"}
        assert "updatedMin" not in hub.calls[0][1]["tools"][0]["arguments"]


@pytest.mark.parametrize("identifier,toolkit,path,identity", [
    ("gmail-mail", "gmail", "messages", "messageId"),
    ("calendar-event", "googlecalendar", "items", "id"),
])
@pytest.mark.parametrize("structured", [False, True])
async def test_observed_envelopes_round_trip_through_numeric_poll_path(rig, identifier, toolkit, path, identity, structured):
    hub = setup(rig)
    rig.service._connections = lambda: [{"id": f"composio:{toolkit}", "name": toolkit, "source": "composio",
        "services": [toolkit], "status": "ready", "enabled": True}]
    hub.payload = synthetic_window(identifier, 1)

    async def observed(key, args, **scope):
        hub.calls.append((key, copy.deepcopy(args), scope))
        data = envelope(hub.payload)
        return PluginResult(True, text="Provider display" if structured else json.dumps(data), mcp_result={"structuredContent": data} if structured else None)

    hub.call = observed
    owner = await rig.call("routines.list", {"member_id": 0, "event": identifier})
    member = await rig.service.routine_tool(0, "routine_list", {"event": identifier})
    assert owner == member and "when" in owner
    assert owner["when"]["event"]["items"] == f"data.results.0.response.data.{path}"
    assert owner["when"]["event"]["id"] == identity
    routine = (await rig.service.routine_tool(0, "routine_create", {"title": "Synthetic event", "prompt": "Review new items", "when": owner["when"]}))["routine"]
    await rig.service.poll_events()
    assert rig.background.submitted == []
    first_check = rig.wall.now
    assert rig.service.store.routine(routine["id"]).poll_initialized
    if toolkit == "googlecalendar":
        stamp = datetime.fromtimestamp((first_check - 300_000) / 1000, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        assert hub.calls[-1][1]["tools"][0]["arguments"]["updatedMin"] == stamp
        assert hub.calls[-1][1]["tools"][0]["arguments"]["maxResults"] == 50
        original = hub.payload[path][0]
        hub.payload[path] = []
        rig.wall.now += POLL_MS
        await rig.service.poll_events()
        empty = rig.service.store.routine(routine["id"])
        assert empty.last_checked_ms == rig.wall.now and empty.poll_failures == 0 and not empty.last_error
        assert rig.background.submitted == []
        hub.payload[path] = [original]
    hub.payload[path].append({identity: "new-only", "summary": "Synthetic new item"})
    rig.wall.now += POLL_MS
    await rig.service.poll_events()
    assert len(rig.background.submitted) == 1 and "new-only" in rig.background.submitted[0]["text"]
    rig.wall.now += POLL_MS
    await rig.service.poll_events()
    assert len(rig.background.submitted) == 1
    assert rig.service.store.routine(routine["id"]).when == owner["when"]
