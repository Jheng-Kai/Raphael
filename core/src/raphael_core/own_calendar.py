"""The app's own calendar: one-time events the owner and every member add, change and remove.

It is the one thing in the app that can be changed by hand. Everything else the calendar shows is
computed and only read here (`home`): a routine's occurrences come from its schedule, a Google event
from the connection. "Calendar" means this one unless the owner names another (`means_own_calendar`).

A timed event is two instants. An all-day event is two local dates, the last included, so that it
stays on its date wherever the owner's computer is. Both the window (`calendar.*`) and the tools
(`calendar_*`) go through one check of what they are given.
"""

import re
import sqlite3
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, tzinfo
from typing import Any

from .clock import wall_clock_ms
from .protocol import INVALID_PARAMS, RpcError

TITLE_MAX = 120
NOTES_MAX = 2000
DEFAULT_LENGTH_MS = 3_600_000
# The most a tool reads at once: enough for a month's grid, never the whole table.
LIST_MAX_DAYS = 62
LIST_DEFAULT_DAYS = 7

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_WORDS = re.compile(r"行事曆|行程|日曆|日历|calendar|カレンダー|予定|スケジュール|schedule", re.IGNORECASE)
_OTHER_CALENDARS = re.compile(r"google|gcal|谷歌|グーグル|outlook|notion|apple|icloud|calendly", re.IGNORECASE)
# What the model is told of a refusal, by its kind: fixed words, never what it sent.
_INSTRUCTIONS = {
    "bad_title": "Give the event a short title.",
    "bad_notes": f"Keep notes to at most {NOTES_MAX} characters.",
    "bad_time": "Give start and end as YYYY-MM-DDTHH:MM in the owner's local time, or YYYY-MM-DD for all day.",
    "bad_range": "The end must not come before the start. Give dates as YYYY-MM-DD, and a period of at most "
                 f"{LIST_MAX_DAYS} days when listing.",
    "not_found": "There is no such event: only entries of source own can be changed, by the id calendar_list gives.",
}


class CalendarError(ValueError):
    """What is wrong with a call, as a public kind; never holds what the call was given."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind
        self.instruction = _INSTRUCTIONS[kind]


def means_own_calendar(text: object) -> bool:
    """Whether the owner's words are about a calendar and name no other: then it is this one."""
    return isinstance(text, str) and bool(_WORDS.search(text)) and not _OTHER_CALENDARS.search(text)


@dataclass(frozen=True)
class CalendarEvent:
    id: int
    title: str
    all_day: bool
    start_ms: int | None
    end_ms: int | None
    start_date: str | None
    end_date: str | None
    notes: str
    added_by: int | None  # a member's id; None: the owner

    def span_ms(self, zone: tzinfo | None) -> tuple[int, int]:
        """When it starts and when it is over: for an all-day event, the midnights around its dates here."""
        if not self.all_day:
            return self.start_ms, self.end_ms
        return _midnight(self.start_date, zone), _midnight(self.end_date, zone, 1)


def _midnight(day: str, zone: tzinfo | None, after: int = 0) -> int:
    moment = datetime.fromisoformat(day) + timedelta(days=after)
    return int(moment.replace(tzinfo=zone).timestamp() * 1000)


def _local_date(at_ms: int, zone: tzinfo | None) -> str:
    return datetime.fromtimestamp(at_ms / 1000, zone).date().isoformat()


def _when(value: object, zone: tzinfo | None) -> int | str:
    """`value` as the core keeps it: a date stays its text, a time of day becomes an instant."""
    if not isinstance(value, str):
        raise CalendarError("bad_time")
    text = value.strip()
    try:
        if _DATE.fullmatch(text):
            return date.fromisoformat(text).isoformat()
        moment = datetime.fromisoformat(text)
        return int((moment if moment.tzinfo else moment.replace(tzinfo=zone)).timestamp() * 1000)
    except (ValueError, OverflowError, OSError):
        raise CalendarError("bad_time") from None


def _title(value: object) -> str:
    title = " ".join(value.split())[:TITLE_MAX] if isinstance(value, str) else ""
    if not title:
        raise CalendarError("bad_title")
    return title


def _notes(value: object) -> str:
    if not isinstance(value, str) or len(value) > NOTES_MAX:
        raise CalendarError("bad_notes")
    return value.strip()


def _row(row: sqlite3.Row) -> CalendarEvent:
    return CalendarEvent(row["id"], row["title"], bool(row["all_day"]), row["start_ms"], row["end_ms"],
                         row["start_date"], row["end_date"], row["notes"], row["added_by"])


class CalendarStore:
    """The `calendar_events` table. Used on the event loop, which owns `conn`."""

    def __init__(self, conn: sqlite3.Connection, *, now_ms: Callable[[], int] = wall_clock_ms) -> None:
        self.conn, self.now_ms = conn, now_ms

    def get(self, event_id: int) -> CalendarEvent | None:
        row = self.conn.execute("SELECT * FROM calendar_events WHERE id = ?", (event_id,)).fetchone()
        return None if row is None else _row(row)

    def between(self, start_ms: int, end_ms: int, zone: tzinfo | None) -> list[CalendarEvent]:
        """The events that touch the period, the earliest first."""
        rows = self.conn.execute(
            "SELECT * FROM calendar_events WHERE (all_day = 0 AND start_ms < ? AND end_ms > ?)"
            " OR (all_day = 1 AND start_date <= ? AND end_date >= ?) ORDER BY id",
            (end_ms, start_ms, _local_date(end_ms - 1, zone), _local_date(start_ms, zone)),
        )
        return sorted(map(_row, rows), key=lambda event: (event.span_ms(zone)[0], event.id))

    def add(self, fields: Mapping[str, Any], added_by: int | None) -> CalendarEvent:
        now = self.now_ms()
        with self.conn:
            event_id = self.conn.execute(
                "INSERT INTO calendar_events (title, all_day, start_ms, end_ms, start_date, end_date, notes, added_by,"
                " created_at_ms, updated_at_ms) VALUES (:title, :all_day, :start_ms, :end_ms, :start_date, :end_date,"
                " :notes, :added_by, :now, :now)", {**fields, "added_by": added_by, "now": now},
            ).lastrowid
        return self.get(event_id)

    def update(self, event_id: int, fields: Mapping[str, Any]) -> CalendarEvent:
        with self.conn:
            self.conn.execute(
                "UPDATE calendar_events SET title = :title, all_day = :all_day, start_ms = :start_ms, end_ms = :end_ms,"
                " start_date = :start_date, end_date = :end_date, notes = :notes, updated_at_ms = :now WHERE id = :id",
                {**fields, "id": event_id, "now": self.now_ms()},
            )
        return self.get(event_id)

    def delete(self, event_id: int) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM calendar_events WHERE id = ?", (event_id,))


def _event_fields(args: Mapping[str, Any], zone: tzinfo | None, current: CalendarEvent | None = None) -> dict[str, Any]:
    """The row `args` asks for, on top of `current` for a change: what is left out stays. A moved event
    keeps how long it lasts, and a date without a time makes it all-day."""
    title = _title(args.get("title")) if "title" in args or current is None else current.title
    notes = _notes(args["notes"]) if args.get("notes") is not None else current.notes if current else ""
    start = _when(args["start"], zone) if args.get("start") is not None else None
    end = _when(args["end"], zone) if args.get("end") is not None else None
    if current is None and start is None:
        raise CalendarError("bad_time")
    if "all_day" in args and type(args["all_day"]) is not bool:
        raise CalendarError("bad_time")
    all_day = args.get("all_day", isinstance(start, str) if start is not None else current.all_day)
    if start is None:
        start = current.start_date if current.all_day else current.start_ms
    if all_day:
        first = start if isinstance(start, str) else _local_date(start, zone)
        if end is None:
            length = 0
            if current is not None and current.all_day:
                length = (date.fromisoformat(current.end_date) - date.fromisoformat(current.start_date)).days
            last = (date.fromisoformat(first) + timedelta(days=length)).isoformat()
        else:
            last = end if isinstance(end, str) else _local_date(end, zone)
        if last < first:
            raise CalendarError("bad_range")
        return {"title": title, "notes": notes, "all_day": 1, "start_ms": None, "end_ms": None, "start_date": first, "end_date": last}
    begin = start if isinstance(start, int) else _midnight(start, zone) + 9 * DEFAULT_LENGTH_MS
    if end is None:
        length = current.end_ms - current.start_ms if current is not None and not current.all_day else DEFAULT_LENGTH_MS
        finish = begin + length
    else:
        finish = end if isinstance(end, int) else _midnight(end, zone, 1)
    if finish <= begin:
        raise CalendarError("bad_range")
    return {"title": title, "notes": notes, "all_day": 0, "start_ms": begin, "end_ms": finish, "start_date": None, "end_date": None}


def _iso(at_ms: int, zone: tzinfo | None) -> str:
    return datetime.fromtimestamp(at_ms / 1000, zone).astimezone(zone).isoformat(timespec="minutes")


def _fields(args: Mapping[str, Any], zone: tzinfo | None, current: CalendarEvent | None = None) -> dict[str, Any]:
    try:
        fields = _event_fields(args, zone, current)
        # Validate both projection and readback before a write; Windows cannot represent every parsed instant.
        if fields["all_day"]:
            _midnight(fields["start_date"], zone)
            _midnight(fields["end_date"], zone, 1)
        else:
            _iso(fields["start_ms"], zone)
            _iso(fields["end_ms"], zone)
        return fields
    except (ValueError, OverflowError, OSError) as error:
        if isinstance(error, CalendarError):
            raise
        raise CalendarError("bad_time") from None


class OwnCalendar:
    """The calendar's writes and what a tool reads. `shown` is everything the calendar shows, from Home's
    projection (`home.HomeOverview.between`); without it, a list holds the own events alone."""

    def __init__(self, conn: sqlite3.Connection, *, notify: Callable[[str, dict], None] | None = None,
                 now_ms: Callable[[], int] = wall_clock_ms, tz: tzinfo | None = None) -> None:
        self.store = CalendarStore(conn, now_ms=now_ms)
        self.notify, self.now_ms = notify, now_ms
        self.zone: Callable[[], tzinfo | None] = lambda: tz
        self.shown: Callable[[int, int, tzinfo | None], Awaitable[list[dict]]] | None = None
        self.google_state: Callable[[], Awaitable[str]] | None = None

    def register(self, router) -> None:
        router.register("calendar.add", self._rpc(lambda args: self.add(args, None)))
        router.register("calendar.update", self._rpc(self.update))
        router.register("calendar.delete", self._rpc(self.delete))

    @staticmethod
    def _rpc(change):
        async def handler(params: dict) -> dict:
            try:
                return change(params)
            except CalendarError as error:
                raise RpcError(INVALID_PARAMS, f"Invalid params: {error.kind}", {"kind": error.kind}) from None
        return handler

    def _changed(self) -> None:
        if self.notify is not None:
            self.notify("calendar.changed", {})

    def view(self, event: CalendarEvent) -> dict[str, Any]:
        zone = self.zone()
        when = (event.start_date, event.end_date) if event.all_day else (_iso(event.start_ms, zone), _iso(event.end_ms, zone))
        return {"id": event.id, "title": event.title, "start": when[0], "end": when[1], "all_day": event.all_day,
                "notes": event.notes, "added_by": event.added_by}

    def _existing(self, args: Mapping[str, Any]) -> CalendarEvent:
        event_id = args.get("id")
        event = self.store.get(event_id) if type(event_id) is int else None
        if event is None:
            raise CalendarError("not_found")
        return event

    def add(self, args: Mapping[str, Any], added_by: int | None) -> dict[str, Any]:
        event = self.store.add(_fields(args, self.zone()), added_by)
        self._changed()
        return {"event": self.view(event)}

    def update(self, args: Mapping[str, Any]) -> dict[str, Any]:
        current = self._existing(args)
        event = self.store.update(current.id, _fields(args, self.zone(), current))
        self._changed()
        return {"event": self.view(event)}

    def delete(self, args: Mapping[str, Any]) -> dict[str, Any]:
        event = self._existing(args)
        self.store.delete(event.id)
        self._changed()
        return {"deleted": True, "event": self.view(event)}

    async def tool(self, member_id: int, name: str, args: Mapping[str, Any]) -> dict[str, Any]:
        """A `calendar_*` tool for a speaker. Every member shares the one calendar, so any of them changes
        what any other added; a write keeps who added the event. CalendarError for a bad call."""
        if name == "calendar_list":
            return await self.listing(args)
        if name == "calendar_add":
            return self.add(args, member_id)
        return self.update(args) if name == "calendar_update" else self.delete(args)

    async def listing(self, args: Mapping[str, Any]) -> dict[str, Any]:
        zone = self.zone()
        now = self.now_ms()
        today = _local_date(now, zone)
        first = _when(args["start"], zone) if args.get("start") is not None else today
        first = first if isinstance(first, str) else _local_date(first, zone)
        if args.get("end") is None:
            last = (date.fromisoformat(first) + timedelta(days=LIST_DEFAULT_DAYS - 1)).isoformat()
        else:
            last = _when(args["end"], zone)
            last = last if isinstance(last, str) else _local_date(last, zone)
        if last < first:
            raise CalendarError("bad_range")
        # A longer period is read for its first LIST_MAX_DAYS days and says so, with what it did not read (R-CAL-08): a call
        # that only said "bad_range" failed six times in the owner's use and told the model nothing it could mend at once.
        latest = (date.fromisoformat(first) + timedelta(days=LIST_MAX_DAYS - 1)).isoformat()
        asked_end = last
        if last > latest:
            last = latest
        start_ms, end_ms = _midnight(first, zone), _midnight(last, zone, 1)
        if self.shown is None:
            items = [own_item(event, zone) for event in self.store.between(start_ms, end_ms, zone)]
        else:
            items = await self.shown(start_ms, end_ms, zone)
        listed = {"now": _iso(now, zone), "today": today, "start": first, "end": last,
                  "items": [self._listed(item, zone) for item in items]}
        if asked_end != last:
            more = (date.fromisoformat(last) + timedelta(days=1)).isoformat()
            listed["cut"] = {"limit_days": LIST_MAX_DAYS, "asked_end": asked_end, "read": f"{first} to {last}",
                             "note": f"The period was longer than {LIST_MAX_DAYS} days: only {first} to {last} is listed. "
                                     f"For the rest ask again from {more}."}
        # No Google entry means none only when this says connected: a model must not report "nothing" for what it could not read.
        return {**listed, "google": await self.google_state()} if self.google_state else listed

    @staticmethod
    def _listed(item: Mapping[str, Any], zone: tzinfo | None) -> dict[str, Any]:
        end_ms = item.get("end_ms")
        if item.get("all_day"):
            when = {"start": _local_date(item["at_ms"], zone), "all_day": True}
            if end_ms is not None:
                when["end"] = _local_date(end_ms - 1, zone)
        else:
            when = {"start": _iso(item["at_ms"], zone), "all_day": False}
            if end_ms is not None:
                when["end"] = _iso(end_ms, zone)
        if item["kind"] == "own":
            return {"source": "own", "id": item["event_id"], "title": item["title"], **when, "notes": item["notes"],
                    "added_by": "owner" if item["added_by"] is None else item["name"]}
        if item["kind"] == "routine":
            return {"source": "routine", "routine_id": item["routine_id"], "title": item["title"], **when, "member": item["name"]}
        return {"source": "google", "title": item["title"], **when}


def own_item(event: CalendarEvent, zone: tzinfo | None, name: str = "", avatar: str = "") -> dict[str, Any]:
    """An own event as Home and the Calendar page read it, among what is computed."""
    start_ms, end_ms = event.span_ms(zone)
    return {"id": f"own:{event.id}", "kind": "own", "title": event.title, "summary": "", "at_ms": start_ms, "end_ms": end_ms,
            "member_id": -1 if event.added_by is None else event.added_by, "name": name, "avatar": avatar, "turn_id": None,
            "conversation_id": None, "routine_id": None, "all_day": event.all_day, "event_id": event.id, "notes": event.notes,
            "added_by": event.added_by}
