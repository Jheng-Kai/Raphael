"""The app's own calendar is every member's tool: asked to add to 今天的行程, a fake model really calls it
and the event lands in the store and on Home, whichever brain answered."""

import json
from datetime import datetime, timezone

import pytest

from agent.test_narration import chat
from raphael_core.home import HomeOverview
from raphael_core.protocol import RpcError
from .test_answering import client, setup, member, typed, live_said  # noqa: F401
from .test_cli_brains import fake_brain

TODAY = "2026-10-21"


@pytest.fixture
def home(setup):
    rig, team = setup
    rig.wall.now = int(datetime.fromisoformat(TODAY).replace(tzinfo=timezone.utc).timestamp() * 1000)

    async def status(_):
        return {"spend": {"month_usd": 0, "limit_usd": 20, "daily": [0] * 14}, "openrouter": {"state": "ok"}}

    async def stats(_):
        return {"all": {"words": 0, "audio_seconds": 0}, "time_saved_seconds": 0, "speed_wpm": None, "by_day": []}

    for name, handler in [("status.get", status), ("stats.summary", stats)]:
        rig.rpc.register(name, handler)
    team.members.register(rig.rpc)
    overview = HomeOverview(rig.conn, rig.rpc, team.members, now_ms=rig.wall, tz=timezone.utc)
    overview.register()
    rig.service._calendar.register(rig.rpc)
    rig.service._calendar.shown = overview.between
    rig.service._calendar.google_state = overview.google_state
    return overview


async def own_items(rig):
    value = await rig.call("home.overview")
    return [item for item in value["calendar_events"] if item["kind"] == "own"]


async def test_a_request_to_add_to_todays_schedule_lands_in_the_store_and_on_home(setup, client, home):
    rig, team = setup
    secretary = member(team, name="秘書長")
    client.chats = [
        chat("我加到今天的行程。", ("calendar_add", {"title": "牙醫", "start": f"{TODAY}T15:00", "notes": "帶健保卡"})),
        live_said("已加到今天的行程。"),
    ]
    result = await typed(rig, "把牙醫加到今天的行程", secretary.id)
    assert result["status"] == "done"
    assert "calendar_add" in {tool["function"]["name"] for tool in client.chat_calls[0]["tools"]}
    [item] = await own_items(rig)
    assert item["title"] == "牙醫" and item["notes"] == "帶健保卡" and not item["all_day"]
    assert item["end_ms"] - item["at_ms"] == 3_600_000
    assert item["added_by"] == secretary.id and item["name"] == "秘書長"
    value = await rig.call("home.overview")
    assert [row["title"] for row in value["calendar_items"]] == ["牙醫"]
    assert value["calendar_counts"] == {TODAY: 1} and TODAY in value["calendar_days"]
    assert [row["title"] for row in value["calendar"]] == ["牙醫"]
    # Home's inbox is what needs the owner; an event on the calendar is not.
    assert value["today"] == []
    [turn] = (await rig.call("agent.history.list", {"member_id": secretary.id}))["turns"]
    assert [json.loads(m["text"]) for m in turn["messages"] if m["kind"] == "event"] == [{
        "type": "calendar", "action": "created", "id": item["event_id"], "name": "牙醫", "date": TODAY,
        "text": "已加入行程 · 10/21 15:00 牙醫",
    }]


async def test_a_subscription_brain_reaches_the_same_calendar_through_its_mcp_bridge(setup, tmp_path, home):
    rig, team = setup
    secretary = member(team, name="秘書長", model="cli:claude")
    fake_brain(rig, tmp_path, '''import json, sys, urllib.request
from pathlib import Path
config=json.loads(Path(sys.argv[sys.argv.index("--mcp-config")+1]).read_text())["mcpServers"]["raphael"]
json.loads(sys.stdin.readline())
def call(packet):
    request=urllib.request.Request(config["url"],data=json.dumps(packet).encode(),headers={**config["headers"],"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(request,timeout=15))
names=[tool["name"] for tool in call({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}})["result"]["tools"]]
assert {"calendar_list","calendar_add","calendar_update","calendar_delete"} <= set(names), names
added=call({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"calendar_add","arguments":{"title":"牙醫","start":"TODAY"}}})
assert not added["result"]["isError"], added
print(json.dumps({"type":"result","subtype":"success","result":"已加到今天的行程。"}),flush=True)
'''.replace("TODAY", TODAY))
    result = await typed(rig, "把牙醫加到今天的行程", secretary.id)
    assert result["text"] == "已加到今天的行程。"
    [item] = await own_items(rig)
    assert item["title"] == "牙醫" and item["all_day"] and item["added_by"] == secretary.id


async def test_calendar_list_answers_from_everything_the_calendar_shows(setup, client, home):
    rig, team = setup
    secretary = member(team, name="秘書長")
    await team.members.routine_tool(secretary.id, "routine_create", {"title": "每日信件", "prompt": "看信", "schedule": {"kind": "daily", "time": "23:30"}})

    async def google(start, end):
        return [{"id": "event:g1", "kind": "event", "title": "外部會議", "summary": "", "at_ms": rig.wall.now + 3_600_000, "end_ms": rig.wall.now + 7_200_000,
                 "member_id": 0, "name": "Google Calendar", "avatar": "", "turn_id": None, "conversation_id": None, "routine_id": None, "all_day": False}]

    home.calendar_events = google
    await rig.call("calendar.add", {"title": "牙醫", "start": f"{TODAY}T15:00"})
    client.chats = [chat("", ("calendar_list", {})), live_said("今天有三件事。")]
    await typed(rig, "今天的行程有什麼", secretary.id)
    seen = next(m for m in client.chat_calls[1]["messages"] if m.get("role") == "tool")
    listed = json.loads(seen["content"].split(">", 1)[1].rsplit("<", 1)[0]) if seen["content"].startswith("<") else json.loads(seen["content"])
    assert listed["today"] == TODAY
    sources = {item["title"]: item["source"] for item in listed["items"]}
    assert sources == {"牙醫": "own", "每日信件": "routine", "外部會議": "google"}
    own = next(item for item in listed["items"] if item["source"] == "own")
    assert own["added_by"] == "owner" and type(own["id"]) is int
    routine = next(item for item in listed["items"] if item["source"] == "routine")
    assert routine["member"] == "秘書長" and "id" not in routine
    # The list changes nothing, so nothing asks about it.
    [turn] = (await rig.call("agent.history.list", {"member_id": secretary.id}))["turns"]
    assert [step["tool"] for step in turn["steps"]] == ["calendar_list"]
    assert not [m for m in turn["messages"] if m["kind"] == "event"]


async def test_any_member_changes_and_removes_what_any_other_added(setup, client, home):
    rig, team = setup
    first, second = member(team, name="甲"), member(team, name="乙")
    added = (await rig.call("calendar.add", {"title": "牙醫", "start": f"{TODAY}T15:00", "end": f"{TODAY}T16:30"}))["event"]
    client.chats = [chat("", ("calendar_update", {"id": added["id"], "start": f"{TODAY}T17:00"})), live_said("改好了。")]
    await typed(rig, "牙醫改到五點", first.id)
    [item] = await own_items(rig)
    assert item["end_ms"] - item["at_ms"] == 90 * 60_000, "moving an event keeps how long it lasts"
    assert item["added_by"] is None, "who added it stays the owner"
    client.chats = [chat("", ("calendar_delete", {"id": added["id"]})), live_said("刪掉了。")]
    await typed(rig, "取消牙醫", second.id)
    assert await own_items(rig) == []
    [turn] = (await rig.call("agent.history.list", {"member_id": second.id}))["turns"]
    assert [json.loads(m["text"]) for m in turn["messages"] if m["kind"] == "event"] == [{
        "type": "calendar", "action": "deleted", "id": added["id"], "name": "牙醫", "date": TODAY,
        "text": "已刪除行程 · 10/21 17:00 牙醫",
    }]


@pytest.mark.parametrize("verdict", ["run", "ask", "deny"])
async def test_a_calendar_write_obeys_the_same_safety_rule_as_other_writes(setup, client, monkeypatch, home, verdict):
    from raphael_core.agent.safety import Screening
    rig, team = setup
    secretary = member(team)
    screened = []

    async def screen(proposed, **kwargs):
        screened.append(proposed.tool)
        return Screening(verdict=verdict, rule="Check calendar changes")

    monkeypatch.setattr(rig.service._gate, "screen", screen)
    client.chats = [chat("", ("calendar_add", {"title": "牙醫", "start": f"{TODAY}T15:00"})), live_said("好了。")]
    result = await typed(rig, "加到今天的行程", secretary.id)
    assert screened == ["calendar_add"]
    if verdict == "ask":
        assert result["status"] == "confirm" and await own_items(rig) == []
        await rig.confirm(result["confirm"]["id"])
    assert len(await own_items(rig)) == (0 if verdict == "deny" else 1)


@pytest.mark.parametrize("arguments, kind", [
    ({"title": "", "start": f"{TODAY}T15:00"}, "bad_title"),
    ({"title": "牙醫", "start": "明天下午"}, "bad_time"),
    ({"title": "牙醫", "start": f"{TODAY}T15:00", "end": f"{TODAY}T14:00"}, "bad_range"),
    ({"title": "牙醫", "start": TODAY, "end": "2026-10-20"}, "bad_range"),
])
async def test_a_bad_call_changes_nothing_and_tells_the_model_how_to_say_it(setup, client, home, arguments, kind):
    rig, team = setup
    secretary = member(team)
    client.chats = [chat("", ("calendar_add", arguments)), live_said("我再確認。")]
    await typed(rig, "加到今天的行程", secretary.id)
    assert await own_items(rig) == []
    seen = next(m for m in client.chat_calls[1]["messages"] if m.get("role") == "tool")
    guidance = {"bad_title": "short title", "bad_time": "YYYY-MM-DDTHH:MM", "bad_range": "end must not come before the start"}
    assert guidance[kind] in seen["content"]
    assert "YYYY-MM-DD" in seen["content"] or kind == "bad_title"


async def test_a_change_of_a_removed_event_says_it_is_gone(setup, client, home):
    rig, team = setup
    secretary = member(team)
    client.chats = [chat("", ("calendar_delete", {"id": 404})), live_said("找不到。")]
    await typed(rig, "取消牙醫", secretary.id)
    seen = next(m for m in client.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "no such event" in seen["content"] and "calendar_list" in seen["content"]


# --- the window's own calls --------------------------------------------------------------------------


async def test_the_owner_adds_changes_and_removes_through_the_window_and_home_hears_of_it(setup, home):
    rig, team = setup
    notes = []
    rig.service._calendar.notify = lambda method, params: notes.append(method)
    added = (await rig.call("calendar.add", {"title": "  牙  醫 ", "start": f"{TODAY}T15:00", "end": f"{TODAY}T16:00", "notes": "帶健保卡"}))["event"]
    assert added["title"] == "牙 醫" and added["added_by"] is None
    changed = (await rig.call("calendar.update", {"id": added["id"], "title": "洗牙", "all_day": True}))["event"]
    assert changed["title"] == "洗牙" and changed["all_day"] and changed["start"] == TODAY and changed["end"] == TODAY
    [item] = await own_items(rig)
    midnight = item["at_ms"]
    assert item["end_ms"] - midnight == 86_400_000 and item["all_day"]
    await rig.call("calendar.delete", {"id": added["id"]})
    assert await own_items(rig) == []
    assert notes == ["calendar.changed"] * 3
    with pytest.raises(RpcError) as refused:
        await rig.call("calendar.delete", {"id": added["id"]})
    assert refused.value.data["kind"] == "not_found"


async def test_an_all_day_event_stays_on_its_date_whatever_the_time_zone(setup, home):
    rig, team = setup
    await rig.call("calendar.add", {"title": "連假", "start": "2026-10-21", "end": "2026-10-23", "all_day": True})
    for zone in ("Asia/Taipei", "America/Los_Angeles"):
        value = await rig.call("home.overview", {"tz": zone})
        days = sorted(key for key, count in value["calendar_counts"].items() if count)
        assert days == ["2026-10-21", "2026-10-22", "2026-10-23"], zone


async def test_a_multi_day_event_marks_every_day_of_the_month_and_is_one_event_to_change(setup, home):
    rig, team = setup
    await rig.call("calendar.add", {"title": "出差", "start": f"{TODAY}T22:00", "end": "2026-10-22T09:00"})
    value = await rig.call("home.overview")
    assert value["calendar_counts"] == {"2026-10-21": 1, "2026-10-22": 1}
    assert len([item for item in value["calendar_events"] if item["kind"] == "own"]) == 1


async def test_own_events_of_another_month_come_with_that_month(setup, home):
    rig, team = setup
    await rig.call("calendar.add", {"title": "年會", "start": "2026-12-15T10:00"})
    assert await own_items(rig) == []
    value = await rig.call("home.overview", {"month": "2026-12"})
    assert [item["title"] for item in value["calendar_events"] if item["kind"] == "own"] == ["年會"]


@pytest.mark.parametrize("fields", [
    {"start": "9999-12-31", "all_day": True},
    {"start": "9999-12-31T23:30:00+00:00"},
])
async def test_an_unrepresentable_end_is_refused_before_any_event_is_saved(setup, home, fields):
    rig, _ = setup
    with pytest.raises(RpcError) as refused:
        await rig.call("calendar.add", {"title": "Boundary", **fields})
    assert refused.value.data["kind"] == "bad_time"
    assert rig.conn.execute("SELECT COUNT(*) FROM calendar_events").fetchone()[0] == 0


# --- Google: never taken for an empty calendar ---------------------------------------------------------


class Connected:
    """The connection as `ConnectedCalendar` reads it, with a provider that answers or fails."""

    def __init__(self, connectors, fails=False):
        self.connectors, self.fails = connectors, fails

    async def call(self, method, params):
        assert method == "connectors.status" and params == {"refresh": False}
        return {"connectors": self.connectors}

    async def call_calendar(self, args):
        return await self.call_google("calendar_list_events", args)

    async def call_google(self, name, args):
        from raphael_core.connectors.http import ConnectorFailure
        if self.fails:
            raise ConnectorFailure("network")
        return {"timeZone": "UTC", "items": [{"id": "g1", "summary": "外部會議", "start": {"dateTime": f"{TODAY}T10:00:00+00:00"}, "end": {"dateTime": f"{TODAY}T11:30:00+00:00"}}]}


READABLE = {"id": "google", "status": "ACTIVE", "enabled_tools": ["calendar_list_events"]}


@pytest.mark.parametrize("fails", [False, True])
async def test_a_model_calendar_list_waits_for_its_first_slow_read(setup, client, home, fails):
    import asyncio
    from raphael_core.home import ConnectedCalendar
    rig, team = setup
    release = asyncio.Event()
    class Slow(Connected):
        async def call_calendar(self, args):
            await release.wait()
            return await super().call_calendar(args)
    link = Slow([{"id":"composio:googlecalendar","status":"ACTIVE","enabled_tools":["GOOGLECALENDAR_EVENTS_LIST"]}], fails)
    home.calendar_events = ConnectedCalendar(link, link)
    secretary = member(team)
    client.chats = [chat("", ("calendar_list", {})), live_said("Sample calendar checked")]
    reading = asyncio.create_task(typed(rig, "List my calendar", secretary.id))
    await asyncio.sleep(.03)
    assert not reading.done()
    release.set()
    await asyncio.wait_for(reading, 2)
    seen = next(m for m in client.chat_calls[-1]["messages"] if m.get("role") == "tool")
    assert f'"google": "{"unreadable" if fails else "connected"}"' in seen["content"]
    if not fails:
        assert '"source": "google"' in seen["content"]
        assert f'"start": "{TODAY}T10:00+00:00"' in seen["content"]
    await home.calendar_events.aclose()


@pytest.mark.parametrize("connectors, fails, state, titles", [
    ([], False, "not_connected", ["牙醫"]),
    ([{**READABLE, "enabled_tools": []}], False, "not_connected", ["牙醫"]),
    ([READABLE], False, "connected", ["外部會議", "牙醫"]),
    ([READABLE], True, "unreadable", ["牙醫"]),
    ([{**READABLE, "status": "EXPIRED"}], False, "unreadable", ["牙醫"]),
    ([{"id": "composio:googlecalendar", "status": "ACTIVE", "enabled_tools": ["GOOGLECALENDAR_EVENTS_LIST"]}], False, "connected", ["外部會議", "牙醫"]),
])
async def test_the_calendar_tells_not_connected_and_unreadable_from_nothing_and_own_events_always_show(setup, client, home, connectors, fails, state, titles):
    from raphael_core.home import ConnectedCalendar
    rig, team = setup
    link = Connected(connectors, fails)
    home.calendar_events = ConnectedCalendar(link, link)
    await rig.call("calendar.add", {"title": "牙醫", "start": f"{TODAY}T15:00"})
    await rig.call("home.overview", {"refresh": True})
    import asyncio
    await asyncio.gather(*home.calendar_events._tasks.values())
    value = await rig.call("home.overview")
    assert value["calendar_google"] == state
    assert [item["title"] for item in value["calendar_events"]] == titles or sorted(item["title"] for item in value["calendar_events"]) == sorted(titles)
    secretary = member(team)
    client.chats = [chat("", ("calendar_list", {})), live_said("好。")]
    await typed(rig, "今天的行程", secretary.id)
    seen = next(m for m in client.chat_calls[-1]["messages"] if m.get("role") == "tool")
    assert f'"google": "{state}"' in seen["content"]
    if state == "connected":
        assert "外部會議" in seen["content"]


async def test_a_google_event_has_its_length_and_a_read_that_works_again_clears_the_failure(setup, home):
    from raphael_core.home import ConnectedCalendar
    rig, team = setup
    link = Connected([READABLE], True)
    clock = [0]
    home.calendar_events = ConnectedCalendar(link, link, now_ms=lambda: clock[0])
    await rig.call("home.overview", {"refresh": True})
    import asyncio
    await asyncio.gather(*home.calendar_events._tasks.values())
    assert (await rig.call("home.overview"))["calendar_google"] == "unreadable"
    assert (await rig.call("home.overview"))["calendar_google"] == "unreadable", "the last read is what a local paint says"
    link.fails = False
    clock[0] = 60_000
    await rig.call("home.overview", {"refresh": True})
    await asyncio.gather(*home.calendar_events._tasks.values())
    value = await rig.call("home.overview")
    assert value["calendar_google"] == "connected"
    [event] = [item for item in value["calendar_events"] if item["kind"] == "event"]
    assert event["end_ms"] - event["at_ms"] == 90 * 60_000


async def test_a_connection_error_is_unreadable_too(setup, home):
    rig, team = setup

    async def unavailable(start, end):
        raise ConnectionError("Calendar unavailable")

    home.calendar_events = unavailable
    await rig.call("calendar.add", {"title": "牙醫", "start": f"{TODAY}T15:00"})
    value = await rig.call("home.overview", {"refresh": True})
    assert value["calendar_google"] == "unreadable" and [item["title"] for item in value["calendar_events"]] == ["牙醫"]


# --- "calendar" means ours ------------------------------------------------------------------------------


@pytest.mark.parametrize("words", ["行程", "行事曆", "日曆", "calendar", "schedule", "add an event", "カレンダー", "予定", "スケジュール"])
def test_find_tools_finds_the_calendar_by_the_plain_words_the_owner_would_use(words):
    from raphael_core.agent.plugins import PluginTool
    from raphael_core.agent.policy import Tier
    from raphael_core.background.snapshot import take_snapshot

    class Many:
        def offered(self):
            return [PluginTool(f"mcp:s:t{n}", "Service", f"tool_{n}", "Something else entirely", {"type": "object"}, Tier.T1) for n in range(60)]

    snapshot = take_snapshot(Many(), "something", interactive=True, max_tier=Tier.T3)
    assert "find_tools" in snapshot.refs and snapshot.hidden()
    _, lines = snapshot.find(words)
    assert [line for line in lines if line.startswith("calendar_")], (words, lines)


def test_every_path_is_offered_the_calendar():
    from raphael_core.agent.harness_tools import CALENDAR_TOOLS
    from raphael_core.agent.speaker import RAPHAEL, Speaker
    from raphael_core.background.snapshot import take_snapshot

    assert set(CALENDAR_TOOLS) == {"calendar_list", "calendar_add", "calendar_update", "calendar_delete"}
    for speaker in (RAPHAEL, Speaker(id=3, name="Mia", role="Researcher")):
        for interactive in (True, False):
            snapshot = take_snapshot(None, speaker=speaker, interactive=interactive)
            assert set(CALENDAR_TOOLS) <= set(snapshot.refs), (speaker.id, interactive)
            names = [item["function"]["name"] for item in snapshot.definitions]
            assert len(names) == len(set(names))


def test_the_tiers_follow_the_routines():
    from raphael_core.agent.harness_tools import TIERS
    from raphael_core.agent.policy import Tier

    assert TIERS["calendar_list"] == Tier.T0
    assert TIERS["calendar_add"] == TIERS["calendar_update"] == TIERS["calendar_delete"] == Tier.T1 == TIERS["routine_create"]


def test_the_shared_contract_and_the_help_say_whose_calendar_it_is():
    from raphael_core.agent.persona import _SHARED_CONTRACT
    from raphael_core.agent.self_check import ABOUT, ABOUT_INDEX

    for text in (_SHARED_CONTRACT, ABOUT):
        assert "calendar_add" in text and "Google" in text
    assert "in any language" in _SHARED_CONTRACT and "app's own calendar" in _SHARED_CONTRACT
    assert "行事曆" in ABOUT
    assert "alendar" in ABOUT_INDEX


@pytest.mark.parametrize("text", ["把牙醫加到今天的行程", "幫我連行事曆", "add it to my calendar", "カレンダーに入れて"])
async def test_connect_app_does_not_answer_a_calendar_request_with_google(setup, client, text):
    rig, team = setup

    class Cards:
        shown = []

        async def resolve(self, ident):
            from raphael_core.connectors.apps import APPS
            return APPS[ident]

        def show(self, **kwargs):
            self.shown.append(kwargs)

    rig.service._cards = Cards()
    secretary = member(team)
    client.chats = [chat("", ("connect_app", {"app": "googlecalendar"})), live_said("我用內部行事曆。")]
    await typed(rig, text, secretary.id)
    assert Cards.shown == []
    seen = next(m for m in client.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "calendar_add" in seen["content"]


async def test_connect_app_still_connects_google_when_the_owner_names_it(setup, client):
    rig, team = setup

    class Cards:
        shown = []

        async def resolve(self, ident):
            from raphael_core.connectors.apps import APPS
            return APPS[ident]

        def show(self, **kwargs):
            self.shown.append(kwargs)

    rig.service._cards = Cards()
    secretary = member(team)
    client.chats = [chat("", ("connect_app", {"app": "googlecalendar"})), live_said("請按連接。")]
    await typed(rig, "幫我連 Google 行事曆", secretary.id)
    assert len(Cards.shown) == 1


async def test_find_app_leaves_google_out_of_a_calendar_request(setup, client):
    rig, team = setup

    class Cards:
        async def find(self, query):
            return {"apps": [{"id": "googlecalendar", "name": "Google Calendar", "provider": "composio", "connected": False},
                             {"id": "notion", "name": "Notion", "provider": "composio", "connected": False}]}

    rig.service._cards = Cards()
    secretary = member(team)
    client.chats = [chat("", ("find_app", {"query": "calendar"})), live_said("用內部行事曆。")]
    await typed(rig, "加到今天的行程", secretary.id)
    seen = next(m for m in client.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "googlecalendar" not in seen["content"] and "calendar_add" in seen["content"]
    client.chats = [chat("", ("find_app", {"query": "calendar"})), live_said("有 Google 日曆。")]
    await typed(rig, "連 Google 行事曆", secretary.id)
    seen = next(m for m in client.chat_calls[3]["messages"] if m.get("role") == "tool")
    assert "googlecalendar" in seen["content"]
