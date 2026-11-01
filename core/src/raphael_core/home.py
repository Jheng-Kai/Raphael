"""A bounded, read-only home projection of existing services and conversation records."""

import asyncio
import logging
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any, NotRequired, TypedDict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .clock import wall_clock_ms
from .connectors.http import ConnectorFailure
from .members.schedule import next_run
from .members.store import ROUTINE_RUN_STATUS_SQL
from .own_calendar import CalendarStore, own_item
from .protocol import RpcError, invalid_params

TODAY_LIMIT = 12
REPORT_LIMIT = 8
CALENDAR_LIMIT = 24
CALENDAR_EVENT_LIMIT = 2500
CALENDAR_READ_TIMEOUT = 12
CALENDAR_RANGE_LIMIT = 24
# What the calendar can say of Google, so that "not connected" and "could not read it" are never taken for "no events".
GOOGLE_CONNECTED = "connected"
GOOGLE_NOT_CONNECTED = "not_connected"
GOOGLE_UNREADABLE = "unreadable"
logger = logging.getLogger(__name__)


class HomeItem(TypedDict):
    id: str
    kind: str
    title: str
    summary: str
    at_ms: int
    member_id: int
    name: str
    avatar: str
    turn_id: int | None
    conversation_id: int | None
    routine_id: int | None
    all_day: bool
    # When it is over, for an entry that has a length (an own event, a connected one).
    end_ms: NotRequired[int]
    # An own event's: its id in the store, its notes and the member who added it (None: the owner).
    event_id: NotRequired[int]
    notes: NotRequired[str]
    added_by: NotRequired[int | None]
    rhythm: NotRequired[bool]
    rhythm_schedule: NotRequired[dict]
    run_status: NotRequired[str]


class DictationNumbers(TypedDict):
    words: int
    time_saved_seconds: float
    speed_wpm: float | None
    audio_seconds: float
    daily: list[int]


class HomeUsage(TypedDict):
    month_usd: float
    limit_usd: float
    daily: list[float]
    allowances: dict[str, Any]


class Overview(TypedDict):
    generated_at_ms: int
    report: dict[str, Any]
    today: list[HomeItem]
    reports: list[HomeItem]
    calendar: list[HomeItem]
    calendar_days: list[str]
    calendar_events: list[HomeItem]
    calendar_google: str
    calendar_items: list[HomeItem]
    calendar_counts: dict[str, int]
    usage: HomeUsage
    dictation: DictationNumbers
    counts: dict[str, int]


async def no_calendar_events(start_ms: int, end_ms: int) -> list[HomeItem]:
    """Keep the projection usable without a calendar service."""
    return []


def _event_end(event: dict, at: int, zone: tzinfo) -> int:
    """When a connected event is over; a day's length when it does not say (its last date is exclusive, as ours ends are)."""
    try:
        end = event["end"]
        when = datetime.fromisoformat(end.get("dateTime") or end["date"])
        over = int((when if when.tzinfo else when.replace(tzinfo=zone)).timestamp() * 1000)
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError, OSError):
        return at + (3_600_000 if "dateTime" in event.get("start", {}) else 86_400_000)
    return over if over > at else at + 3_600_000


class ConnectedCalendar:
    """Read the private Google calendar through its existing connector policy."""

    def __init__(self, router, connectors, *, now_ms=wall_clock_ms, notify=None):
        self.router, self.connectors = router, connectors
        self.failed = False  # the last read of a connected calendar did not come back
        self.now_ms, self.notify = now_ms, notify
        self._cache = OrderedDict()
        self._attempts = OrderedDict()
        self._tasks = {}

    async def aclose(self):
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _connectors(self) -> dict[str, dict]:
        return {c["id"]: c for c in (await self.router.call("connectors.status", {"refresh": False})).get("connectors", [])}

    @staticmethod
    def _readable(connectors: dict[str, dict]) -> bool:
        google = connectors.get("google")
        return bool(google and google["status"] == "ACTIVE" and "calendar_list_events" in google["enabled_tools"])

    @staticmethod
    def _composio_readable(connectors: dict[str, dict]) -> bool:
        toolkit = connectors.get("composio:googlecalendar", {})
        return (toolkit.get("status") == "ACTIVE" and toolkit.get("enabled", True)
                and "GOOGLECALENDAR_EVENTS_LIST" in toolkit.get("enabled_tools", [])
                and "GOOGLECALENDAR_EVENTS_LIST" not in toolkit.get("disabled_tools", []))

    async def state(self) -> str:
        """What the owner is told of Google beside the calendar. Reads no provider."""
        connectors = await self._connectors()
        toolkit = connectors.get("composio:googlecalendar")
        if self._readable(connectors) or self._composio_readable(connectors):
            return GOOGLE_UNREADABLE if self.failed else GOOGLE_CONNECTED
        if any(c and c["status"] == "EXPIRED" for c in (connectors.get("google"), toolkit)):
            return GOOGLE_UNREADABLE
        return GOOGLE_NOT_CONNECTED

    async def __call__(self, start_ms: int, end_ms: int) -> list[HomeItem]:
        key = (start_ms, end_ms)
        connections = await self._connectors()
        if not (self._readable(connections) or self._composio_readable(connections)):
            self._cache.clear()
            self._attempts.clear()
            return []
        if key not in self._tasks and self.now_ms() - self._attempts.get(key, -60_000) >= 60_000:
            self._keep(self._attempts, key, self.now_ms())
            self._tasks[key] = asyncio.create_task(self._refresh(key))
        elif key in self._attempts:
            self._attempts.move_to_end(key)
        return self._kept(start_ms, end_ms) or []

    @staticmethod
    def _keep(store, key, value):
        store[key] = value
        store.move_to_end(key)
        while len(store) > CALENDAR_RANGE_LIMIT:
            store.popitem(last=False)

    def _kept(self, start_ms, end_ms):
        key = (start_ms, end_ms)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        # A member's narrower list can reuse the same reading that the month's window drew.
        for (first, last), items in reversed(self._cache.items()):
            if first <= start_ms and last >= end_ms:
                self._cache.move_to_end((first, last))
                return [item for item in items if start_ms <= item["at_ms"] < end_ms]
        return None

    async def read(self, start_ms: int, end_ms: int) -> list[HomeItem]:
        """A member waits for its first reading; the window always returns immediately."""
        await self(start_ms, end_ms)
        kept = self._kept(start_ms, end_ms)
        if kept is not None:
            return kept
        task = self._tasks.get((start_ms, end_ms))
        if task is not None:
            result = await asyncio.shield(task)
            if result is not None:
                return result
        return self._kept(start_ms, end_ms) or []

    async def _refresh(self, key):
        before = (self._cache.get(key, []), self.failed)
        try:
            async with asyncio.timeout(CALENDAR_READ_TIMEOUT):
                connections = await self._connectors()
                direct = self._readable(connections)
                if not (direct or self._composio_readable(connections)):
                    return []
                start_ms, end_ms = key
                args = {
                    "calendarId": "primary", "singleEvents": True, "orderBy": "startTime", "maxResults": CALENDAR_EVENT_LIMIT,
                    "timeMin": datetime.fromtimestamp(start_ms / 1000, UTC).isoformat(),
                    "timeMax": datetime.fromtimestamp(end_ms / 1000, UTC).isoformat(),
                }
                response = await self.connectors.call_google("calendar_list_events", args) if direct else await self.connectors.call_calendar(args)
                current = await self._connectors()
                if not (self._readable(current) if direct else self._composio_readable(current)):
                    self._cache.clear()
                    return
                items = self._parse(response, start_ms, end_ms)
                if key in self._attempts:
                    self._keep(self._cache, key, items)
                self.failed = False
                return items
        except Exception as exc:
            # Provider failures must not hide pending work or expose private diagnostics; the window says it could not read.
            logger.warning("Google Calendar could not be read: %s", type(exc).__name__)
            self.failed = True
        finally:
            self._tasks.pop(key, None)
            if before != (self._cache.get(key, []), self.failed) and self.notify:
                self.notify("calendar.changed", {})

    @staticmethod
    def _parse(response, start_ms, end_ms):
        try:
            zone = ZoneInfo(response.get("timeZone", "UTC"))
        except (ValueError, TypeError, ZoneInfoNotFoundError):
            zone = UTC
        events = []
        for event in response.get("items", [])[:CALENDAR_EVENT_LIMIT]:
            if not isinstance(event, dict) or event.get("status") == "cancelled" or not isinstance(event.get("id"), str):
                continue
            try:
                start = event["start"]
                when = datetime.fromisoformat(start.get("dateTime") or start["date"])
                if when.tzinfo is None:
                    when = when.replace(tzinfo=zone)
                at = int(when.timestamp() * 1000)
            except (KeyError, TypeError, ValueError, OverflowError, OSError):
                continue
            if start_ms <= at < end_ms:
                title = event.get("summary") or "Untitled event"
                events.append({"id": f"event:{event['id']}", "kind": "event", "title": " ".join(title.split())[:120],
                               "summary": "", "at_ms": at, "end_ms": _event_end(event, at, zone), "member_id": 0, "name": "Google Calendar", "avatar": "",
                               "turn_id": None, "conversation_id": None, "routine_id": None, "all_day": "dateTime" not in start})
        return events


class HomeOverview:
    def __init__(self, conn, router, members, *, now_ms=wall_clock_ms, tz: tzinfo | None = None,
                 calendar_events: Callable[[int, int], Awaitable[list[HomeItem]]] = no_calendar_events):
        self.conn, self.router, self.members = conn, router, members
        self.now_ms, self.tz, self.calendar_events = now_ms, tz, calendar_events
        self.own = CalendarStore(conn, now_ms=now_ms)
        self._calendar_failed = False
        self.timezone_name = getattr(tz, "key", None)
        self.timezone_changed = None
        self._allowance_task = None
        self._calendar_task = None
        self._calendar_key = None
        self._calendar = []

    def register(self):
        self.router.register("home.overview", self.read)

    def zone(self) -> tzinfo | None:
        """The owner's time zone as the window last said it, which is what a member's words about today mean too."""
        return ZoneInfo(self.timezone_name) if self.timezone_name else self.tz

    async def _sync_timezone(self):
        try:
            await self.timezone_changed()
        except Exception as exc:
            logger.warning("Desktop time zone sync failed: %s", type(exc).__name__)

    async def _allowances(self, refresh):
        if not refresh:
            return await self.router.call("usage.allowances", {"refresh": False})
        # Concurrent refreshes share one CLI read, without persisting a second allowance store.
        if self._allowance_task is None or self._allowance_task.done():
            self._allowance_task = asyncio.create_task(self.router.call("usage.allowances"))
        try:
            return await asyncio.wait_for(asyncio.shield(self._allowance_task), timeout=12)
        except (RpcError, TimeoutError):
            return await self.router.call("usage.allowances", {"refresh": False})

    async def _events(self, start, end, refresh):
        if isinstance(self.calendar_events, ConnectedCalendar):
            return await self.calendar_events(start, end)
        key = (start, end)
        if not refresh:
            return self._calendar if self._calendar_key == key else []
        if self._calendar_task is None or self._calendar_task.done() or self._calendar_key != key:
            if self._calendar_key != key:
                self._calendar = []
            self._calendar_key = key
            self._calendar_task = asyncio.create_task(self.calendar_events(start, end))
        try:
            events = await asyncio.wait_for(asyncio.shield(self._calendar_task), timeout=12)
            if self._calendar_key == key:
                self._calendar = events
            self._calendar_failed = False
            return events
        except (ConnectionError, TimeoutError):
            logger.warning("Home calendar is temporarily unavailable")
            self._calendar_failed = True
            return []

    async def google_state(self) -> str:
        """What the calendar says of Google. A member's list and the window read the same words."""
        if self._calendar_failed:
            return GOOGLE_UNREADABLE
        state = getattr(self.calendar_events, "state", None)
        if state is None:
            return GOOGLE_NOT_CONNECTED
        try:
            return await state()
        except (ConnectorFailure, RpcError, TimeoutError):
            return GOOGLE_UNREADABLE

    def _own_items(self, start: int, end: int, zone: tzinfo | None, people: dict[int, dict]) -> list[HomeItem]:
        """The own events that touch the period, named by who added them when a member did and is still here."""
        def of(event):
            member = people.get(event.added_by, {})
            return own_item(event, zone, member.get("name", ""), member.get("avatar", ""))
        return [of(event) for event in self.own.between(start, end, zone)]

    def _due(self, routine, start: int, end: int, zone: tzinfo | None) -> list[int]:
        """When a routine runs or has run in a period: what its schedule says from then on, and its past runs."""
        if routine.schedule is None:
            return []
        completed = self.conn.execute("SELECT COUNT(*) FROM routine_runs WHERE routine_id=?", (routine.id,)).fetchone()[0]
        remaining = CALENDAR_LIMIT if routine.schedule.max_runs is None else max(0, routine.schedule.max_runs - completed)
        due = next_run(routine.schedule, start - 1, tz=zone) if routine.schedule.max_runs is None else routine.next_run_ms
        at = []
        for _ in range(min(42 * 24, 42 * 24 if routine.schedule.max_runs is None else remaining)):
            if due is None or due >= end:
                break
            if due >= start:
                at.append(due)
            due = next_run(routine.schedule, due, tz=zone)
        at += [run["at"] for run in self.conn.execute(
            "SELECT COALESCE(scheduled, started) AS at FROM routine_runs WHERE routine_id=? AND COALESCE(scheduled, started)>=? AND COALESCE(scheduled, started)<?",
            (routine.id, start, end))]
        return sorted(set(at))

    async def between(self, start: int, end: int, zone: tzinfo | None) -> list[HomeItem]:
        """Everything the calendar shows in a period, for a member who reads it (`calendar_list`): own events,
        routine occurrences and, when connected, Google events read now. An unavailable connection adds none."""
        people = {m["id"]: m for m in (await self.router.call("members.list", {}))["members"]}
        items = self._own_items(start, end, zone, people)
        for routine in self.members.store.routines():
            if routine.enabled and routine.next_run_ms is not None and routine.member_id in people:
                member = people[routine.member_id]
                items += [{"id": f"routine:{routine.id}:{at}", "kind": "routine", "title": " ".join(routine.title.split())[:120], "summary": "",
                           "at_ms": at, "member_id": routine.member_id, "name": member["name"], "avatar": member.get("avatar", ""),
                           "turn_id": None, "conversation_id": None, "routine_id": routine.id, "all_day": False}
                          for at in self._due(routine, start, end, zone)]
        try:
            read = self.calendar_events.read if isinstance(self.calendar_events, ConnectedCalendar) else self.calendar_events
            items += [event for event in await read(start, end) if start <= event["at_ms"] < end]
            self._calendar_failed = False
        except (ConnectionError, TimeoutError):
            self._calendar_failed = True
        return sorted(items, key=lambda value: (value["at_ms"], value["id"]))

    async def read(self, params: dict) -> Overview:
        refresh = params.get("refresh", False)
        if type(refresh) is not bool:
            raise invalid_params("refresh must be a boolean")
        zone = self.tz
        if "tz" in params:
            try:
                if not isinstance(params["tz"], str) or len(params["tz"]) > 100:
                    raise ValueError
                zone = ZoneInfo(params["tz"])
            except (ValueError, ZoneInfoNotFoundError):
                raise invalid_params("tz must be an IANA time zone") from None
            changed = self.timezone_name != zone.key
            self.timezone_name = zone.key
            if changed and self.timezone_changed:
                # Reconciling desktops can recreate a container; Home must answer without waiting for it.
                self._timezone_task = asyncio.create_task(self._sync_timezone())
        now = self.now_ms()
        day = datetime.fromtimestamp(now / 1000, zone).replace(hour=0, minute=0, second=0, microsecond=0)
        start, tomorrow, end = [int((day + timedelta(days=n)).timestamp() * 1000) for n in (0, 1, 7)]
        first = day.replace(day=1)
        if "month" in params:
            try:
                value = params["month"]
                if not isinstance(value, str) or len(value) != 7:
                    raise ValueError
                first = datetime.strptime(value + "-01", "%Y-%m-%d").replace(tzinfo=zone)
                if first.strftime("%Y-%m") != value:
                    raise ValueError
            except ValueError:
                raise invalid_params("month must use YYYY-MM") from None
        grid_start = first - timedelta(days=first.weekday())
        month_start, month_end = [int((grid_start + timedelta(days=n)).timestamp() * 1000) for n in (0, 42)]
        roster = (await self.router.call("members.list", {k: params[k] for k in ("ui_language",) if k in params}))["members"]
        people = {m["id"]: m for m in roster}

        def item(kind, key, mid, title, at, *, summary="", turn=None, conversation=None, routine=None) -> HomeItem:
            member = people[mid]
            return {"id": f"{kind}:{key}", "kind": kind, "title": " ".join(title.split())[:120],
                    "summary": " ".join(summary.split())[:160], "at_ms": at, "member_id": mid,
                    "name": member["name"], "avatar": member.get("avatar", ""),
                    "turn_id": turn, "conversation_id": conversation, "routine_id": routine, "all_day": False}

        reports = []
        # Rank completed reports, rather than the latest turn, which can still be a question.
        rows = self.conn.execute(
            "SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY created_at_ms DESC, id DESC) AS rank"
            " FROM agent_turns WHERE status = 'done' AND (text != '' OR detail IS NOT NULL)) WHERE rank = 1"
            " ORDER BY created_at_ms DESC, id DESC")
        for row in rows:
            mid = row["member_id"]
            if mid not in people or not people[mid]["unread"]:
                continue
            reports.append(item("report", row["id"], mid, row["question"], row["created_at_ms"],
                                summary=row["text"] or row["detail"] or "", turn=row["id"], conversation=row["conversation_id"]))
        today = []
        for row in self.conn.execute("SELECT * FROM agent_turns WHERE status='confirm' ORDER BY created_at_ms, id"):
            if row["member_id"] in people:
                today.append(item("question", row["id"], row["member_id"], row["text"] or row["question"], row["created_at_ms"],
                                  turn=row["id"], conversation=row["conversation_id"]))
        for row in self.conn.execute(
            "SELECT q.*, t.turn_id, a.conversation_id FROM worker_questions q JOIN worker_tasks t ON t.id=q.task_id"
            " LEFT JOIN agent_turns a ON a.id=t.turn_id WHERE q.state='waiting' AND t.state='waiting' ORDER BY q.created_at_ms, q.id"):
            if row["member_id"] in people:
                today.append(item("question", f"worker:{row['id']}", row["member_id"], row["text"], row["created_at_ms"],
                                  turn=row["turn_id"], conversation=row["conversation_id"]))
        calendar = []
        calendar_days = set()
        month_items, month_counts, month_seen = {}, {}, set()

        def month_day(value, key):
            identity = value.get("id", f"event:{value['at_ms']}:{value['title']}"), key
            if identity in month_seen:
                return
            month_seen.add(identity)
            month_counts[key] = month_counts.get(key, 0) + 1
            candidates = month_items.setdefault(key, [])
            candidates.append(value)
            candidates.sort(key=lambda item: (0 if item.get("all_day") and not item.get("rhythm") else 1 if item.get("rhythm") else 2, item["at_ms"], item.get("id", "")))
            del candidates[3:]
            calendar_days.add(key)

        def month_item(value):
            # An entry that goes on past midnight is there on each of its days, from its midnight and with no time of its own.
            first = datetime.fromtimestamp(value["at_ms"] / 1000, zone)
            last = datetime.fromtimestamp((max(value.get("end_ms", 0), value["at_ms"] + 1) - 1) / 1000, zone).date()
            if month_start <= value["at_ms"] < month_end:
                month_day(value, first.date().isoformat())
            for n in range(1, (last - first.date()).days + 1):
                day = first.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=n)
                at = int(day.timestamp() * 1000)
                if month_start <= at < month_end:
                    month_day({**value, "at_ms": at, "all_day": True}, day.date().isoformat())
        for routine in self.members.store.routines():
            if routine.schedule is None or not routine.enabled or routine.next_run_ms is None or routine.member_id not in people:
                continue
            due = routine.next_run_ms
            completed = self.conn.execute("SELECT COUNT(*) FROM routine_runs WHERE routine_id=?", (routine.id,)).fetchone()[0]
            remaining = CALENDAR_LIMIT if routine.schedule.max_runs is None else max(0, routine.schedule.max_runs - completed)
            # At most one page of occurrences per routine, even for hourly schedules.
            for _ in range(min(CALENDAR_LIMIT, remaining)):
                if due is None or due >= end:
                    break
                if due >= start:
                    occurrence = item("routine", f"{routine.id}:{due}", routine.member_id, routine.title, due, routine=routine.id)
                    calendar.append(occurrence)
                    if due < tomorrow:
                        today.append(occurrence)
                due = next_run(routine.schedule, due, tz=zone)
            # The month marks every scheduled day, independently of the bounded seven-day preview.
            schedule = routine.schedule
            minute = lambda time: int(time[:2]) * 60 + int(time[3:])
            rhythm = schedule.kind == "every" and schedule.hours < 24 and (
                not schedule.from_time or minute(schedule.to_time) - minute(schedule.from_time) >= schedule.hours * 60)
            marked = set()
            for at in self._due(routine, month_start, month_end, zone):
                if not rhythm:
                    month_item(item("routine", f"{routine.id}:{at}", routine.member_id, routine.title, at, routine=routine.id))
                    continue
                day = datetime.fromtimestamp(at / 1000, zone).replace(hour=0, minute=0, second=0, microsecond=0)
                key = day.date().isoformat()
                if key not in marked:
                    marked.add(key)
                    value = item("routine", f"{routine.id}:{key}", routine.member_id, routine.title, int(day.timestamp()*1000), routine=routine.id)
                    value.update(id=f"rhythm:{routine.id}:{key}", rhythm=True, rhythm_schedule=schedule.to_json(), all_day=True,
                                 end_ms=int((day + timedelta(days=1)).timestamp()*1000))
                    month_item(value)
            if rhythm:
                for run in self.conn.execute(
                    f"SELECT r.*, COALESCE(r.scheduled,r.started) AS at, {ROUTINE_RUN_STATUS_SQL} AS current_status"
                    " FROM routine_runs r LEFT JOIN agent_turns t ON t.id=r.turn_id WHERE r.routine_id=? AND COALESCE(r.scheduled,r.started)>=? AND COALESCE(r.scheduled,r.started)<? ORDER BY at,r.id",
                    (routine.id, month_start, month_end)):
                    if run["current_status"] in ("error", "confirm"):
                        value = item("routine", f"{routine.id}:{run['at']}", routine.member_id, routine.title, run["at"], routine=routine.id, turn=run["turn_id"])
                        value["run_status"] = run["current_status"]
                        month_item(value)
        events, allowances = await asyncio.gather(self._events(month_start, month_end, refresh), self._allowances(refresh))
        events = [*self._own_items(month_start, month_end, zone, people), *events]
        for event in events:
            month_item(event)
        calendar.extend(event for event in events if start <= event["at_ms"] < end)
        today.sort(key=lambda r: (0 if r["kind"] == "question" else 1, r["at_ms"], r["id"]))
        calendar.sort(key=lambda r: (r["at_ms"], r["id"]))
        status = await self.router.call("status.get")
        stats = await self.router.call("stats.summary", {"days": 14})
        spend = status["spend"]
        return {"generated_at_ms": now, "report": status, "today": today[:TODAY_LIMIT], "reports": reports[:REPORT_LIMIT],
                "calendar": calendar[:CALENDAR_LIMIT], "calendar_days": sorted(calendar_days), "calendar_events": events,
                "calendar_google": await self.google_state(), "counts": {"today": len(today), "reports": len(reports), "calendar": len(calendar)},
                "calendar_items": [value for key in sorted(month_items) for value in month_items[key]], "calendar_counts": month_counts,
                "usage": {"month_usd": spend["month_usd"], "limit_usd": spend["limit_usd"], "daily": spend["daily"][-14:], "allowances": allowances},
                "dictation": {"words": stats["all"]["words"], "audio_seconds": stats["all"]["audio_seconds"],
                              "time_saved_seconds": stats["time_saved_seconds"], "speed_wpm": stats.get("speed_wpm"),
                              "daily": [day["words"] for day in stats.get("by_day", [])][-14:]}}
