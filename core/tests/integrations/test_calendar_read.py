"""Offline shared readings: windows return immediately and members await their first read."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from raphael_core.home import ConnectedCalendar, HomeOverview
from raphael_core.connectors.service import ConnectorsService
from raphael_core.connectors.store import Connector


def core_service():
    service = object.__new__(ConnectorsService)
    entry = Connector("composio:googlecalendar", "composio")
    entry.status, entry.enabled_tools = "ACTIVE", ["GOOGLECALENDAR_EVENTS_LIST"]
    service.store = SimpleNamespace(connectors={entry.id:entry})
    return service


def members():
    """What Home reads of the members service to name people: no members, no unread, no profile."""
    return SimpleNamespace(store=SimpleNamespace(routines=lambda: [], unread_from=lambda: {}),
                           _ui_language=lambda params: "en", first_bot_profile=lambda: {})


class Provider:
    def __init__(self):
        self.calls = []
        self.release = asyncio.Event()
        self.fail = False

    async def call(self, method, params):
        assert method == "connectors.status" and params == {"refresh": False}
        return {"connectors": [{"id": "composio:googlecalendar", "status": "ACTIVE",
                                "enabled_tools": ["GOOGLECALENDAR_EVENTS_LIST"]}]}

    async def call_calendar(self, args):
        self.calls.append(args)
        await self.release.wait()
        if self.fail:
            raise ValueError("private provider words")
        return {"items": [{"id": "sample", "summary": "Sample review",
                            "start": {"dateTime": "2026-10-24T09:00:00Z"}}]}


async def test_composio_calendar_returns_cached_items_immediately_and_notifies_only_changes(caplog):
    provider = Provider()
    now = [0]
    notices = []
    calendar = ConnectedCalendar(provider, provider, now_ms=lambda: now[0], notify=lambda *a: notices.append(a))
    start, end = 1792800000000, 1793404800000
    assert await calendar.state() == "connected"
    assert await asyncio.wait_for(calendar(start, end), .1) == []
    await asyncio.sleep(0)
    assert len(provider.calls) == 1
    assert await calendar(start, end) == []
    provider.release.set()
    await asyncio.gather(*calendar._tasks.values())
    assert (await calendar(start, end))[0]["title"] == "Sample review"
    assert await calendar.state() == "connected"
    assert notices == [("calendar.changed", {})]
    now[0] = 60_000
    provider.fail = True
    assert (await calendar(start, end))[0]["title"] == "Sample review"
    await asyncio.gather(*calendar._tasks.values())
    assert await calendar.state() == "unreadable"
    assert "private provider words" not in caplog.text
    assert len(provider.calls) == 2
    await calendar.aclose()


@pytest.mark.parametrize("fail", [False, True])
async def test_member_waits_for_first_read_while_window_returns_immediately(conn, fail):
    provider = Provider()
    provider.fail = fail
    calendar = ConnectedCalendar(provider, provider)
    home = HomeOverview(conn, provider, members(), calendar_events=calendar)
    start, end = 1792800000000, 1793404800000
    assert await asyncio.wait_for(calendar(start, end), .1) == []
    reading = asyncio.create_task(home.between(start, end, None))
    await asyncio.sleep(.01)
    assert not reading.done()
    provider.release.set()
    items = await asyncio.wait_for(reading, .2)
    assert [item["title"] for item in items] == ([] if fail else ["Sample review"])
    assert await calendar.state() == ("unreadable" if fail else "connected")
    await calendar.aclose()


async def test_calendar_keeps_only_the_24_most_recent_ranges():
    provider = Provider()
    provider.release.set()
    calendar = ConnectedCalendar(provider, provider, now_ms=lambda: 0)
    for i in range(24):
        await calendar(i, i+1)
        await asyncio.gather(*calendar._tasks.values())
    await calendar(0, 1)
    await calendar(24, 25)
    await asyncio.gather(*calendar._tasks.values())
    assert len(calendar._cache) == len(calendar._attempts) == 24
    assert (0, 1) in calendar._cache and (1, 2) not in calendar._cache
    assert (0, 1) in calendar._attempts and (1, 2) not in calendar._attempts
    await calendar.aclose()


async def test_member_first_read_timeout_reports_unreadable_without_holding_the_window(conn, monkeypatch):
    monkeypatch.setattr("raphael_core.home.CALENDAR_READ_TIMEOUT", .03)
    provider = Provider()
    calendar = ConnectedCalendar(provider, provider)
    home = HomeOverview(conn, provider, members(), calendar_events=calendar)
    assert await asyncio.wait_for(calendar(0, 1), .01) == []
    assert await asyncio.wait_for(home.between(0, 1, None), .2) == []
    assert await home.google_state() == "unreadable"
    await calendar.aclose()


async def test_member_reuses_a_covering_empty_read_without_waiting_for_a_new_one():
    provider = Provider()
    provider.release.set()
    calendar = ConnectedCalendar(provider, provider)
    assert await calendar.read(0, 10) == []
    provider.release.clear()
    assert await asyncio.wait_for(calendar.read(1, 2), .01) == []
    assert await calendar.state() == "connected"
    await calendar.aclose()


async def test_eviction_during_a_member_read_still_returns_the_actual_reading():
    provider = Provider()
    calendar = ConnectedCalendar(provider, provider)
    start, end = 1792800000000, 1793404800000
    reading = asyncio.create_task(calendar.read(start, end))
    await asyncio.sleep(0)
    for i in range(1, 25):
        await calendar(start-i, end+i)
    assert (start, end) not in calendar._attempts
    provider.release.set()
    assert (await reading)[0]["title"] == "Sample review"
    await asyncio.gather(*calendar._tasks.values())
    assert len(calendar._cache) == len(calendar._attempts) == 24
    await calendar.aclose()


async def test_direct_signin_wins_and_both_providers_share_event_parsing():
    provider = Provider()
    async def status(method, params):
        return {"connectors": [{"id":"google","status":"ACTIVE","enabled_tools":["calendar_list_events"]},
                                {"id":"composio:googlecalendar","status":"ACTIVE","enabled_tools":["GOOGLECALENDAR_EVENTS_LIST"]}]}
    provider.call = status
    async def direct(name, args):
        assert name == "calendar_list_events"
        return {"timeZone":"Asia/Taipei","items":[{"id":"sample","summary":"Sample review","start":{"date":"2026-10-24"}}]}
    provider.call_google = direct
    calendar=ConnectedCalendar(provider,provider)
    assert await calendar(1792713600000,1793404800000) == []
    await asyncio.gather(*calendar._tasks.values())
    items=await calendar(1792713600000,1793404800000)
    assert items[0]["all_day"] and items[0]["title"] == "Sample review"
    assert provider.calls == []
    await calendar.aclose()


@pytest.mark.parametrize("nested", [False, True])
async def test_composio_calendar_calls_only_the_read_slug_with_the_validated_envelope(nested):
    calls = []
    service = core_service()
    payload = {"items": [{"id": "sample"}]}
    async def call(key, args, *, approver):
        calls.append((key, args, approver))
        return SimpleNamespace(ok=True, mcp_result=None, text=json.dumps({"successful": True, "data": {"results": [
            {"response": {"data": {"response_data": payload} if nested else payload}}
        ], "error_count": 0}, "error": None}))
    service.hub = SimpleNamespace(call=call)
    service._execution = lambda args: [True]
    service.allow_call = lambda *args: True
    args = {"calendarId": "primary", "timeMin": "2026-10-24T00:00:00Z",
            "timeMax": "2026-10-31T00:00:00Z", "singleEvents": True,
            "orderBy": "startTime", "maxResults": 2500}
    assert await service.call_calendar(args) == payload
    assert calls == [("mcp:connectors_composio/COMPOSIO_MULTI_EXECUTE_TOOL",
                      {"tools": [{"tool_slug": "GOOGLECALENDAR_EVENTS_LIST", "arguments": args}]}, "auto")]


@pytest.mark.parametrize("payload", [
    {"successful": False}, {"successful": True, "error": "private"},
    {"data": {"results": [], "error_count": 0}},
    {"data": {"results": [{"response": {"data": {"items": []}}}], "error_count": 1}},
    {"data": {"results": [{"response": {"successful": False, "data": {"items": []}}}]}},
    {"data": {"results": [{"response": {"error": "private", "data": {"items": []}}}]}},
    {"data": {"results": [{"response": {"data": {"successful": False, "items": []}}}]}},
    {"data": {"results": [{"response": {"data": {"error_count": 1, "items": []}}}]}},
    {"data": {"results": [{"response": {"data": {"response_data": {"error": "private", "items": []}}}}]}},
])
async def test_provider_failure_is_never_an_empty_success(payload):
    from raphael_core.connectors.http import ConnectorFailure
    service = core_service()
    async def call(*args, **kwargs):
        return SimpleNamespace(ok=True, mcp_result=None, text=json.dumps(payload))
    service.hub = SimpleNamespace(call=call)
    service._execution = lambda args: [True]
    service.allow_call = lambda *args: True
    with pytest.raises(ConnectorFailure):
        await service.call_calendar({"calendarId": "primary", "timeMin": "2026-10-24T00:00:00Z",
                                     "timeMax": "2026-10-31T00:00:00Z", "singleEvents": True,
                                     "orderBy": "startTime", "maxResults": 2500})
