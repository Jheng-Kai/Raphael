"""Tests for the snapshot of the tools a task may use."""

from raphael_core.agent.plugins import PluginTool
from raphael_core.agent.policy import Tier
from raphael_core.background.snapshot import BUILTIN, FIND, MCP, SNAPSHOT_MAX_TIER, USE, take_snapshot

# A background task's list without plugins or a memory: sorted by name, the same for every task.
BARE = ["ask_owner", "calendar_add", "calendar_delete", "calendar_list", "calendar_update", "connect_app",
        "connect_messaging", "connections_list", "email_draft", "find_app", "find_tools", "local_time", "raphael_help",
        "read_attachment", "request_secret", "routine_create", "routine_delete", "routine_list", "routine_update",
        "self_check", "show_page", "update_page", "use_tool", "weather", "web_read", "web_search"]


def names(snapshot):
    return [d["function"]["name"] for d in snapshot.definitions]


def test_without_plugins_a_task_has_raphaels_lookups_and_calendar():
    snapshot = take_snapshot(None)
    assert names(snapshot) == BARE
    assert {ref.kind for ref in snapshot.refs.values()} == {BUILTIN, FIND, USE}
    writes = {"calendar_add", "calendar_update", "calendar_delete", "routine_create", "routine_delete", "routine_update"}
    assert all(ref.tier is (Tier.T2 if ref.name == "manage_connection" else Tier.T1 if ref.name in writes else Tier.T0) for ref in snapshot.refs.values())
    # Seldom called: found, not listed.
    assert "slack_draft" in snapshot.work


def test_the_commands_for_this_computer_are_not_in_it():
    assert not {"open", "open_url", "open_app", "set_volume", "lock_screen", "copy_text"} & set(
        take_snapshot(None).refs
    )


def pool(snapshot):
    """The plugins' tools of the task, by alias: found, and called with use_tool."""
    return snapshot.pool.by_alias if snapshot.pool else {}


async def test_every_tool_of_the_plugins_that_is_on_is_in_it_whether_it_reads_or_writes(plugins):
    server = await plugins.connect(look="T0", lies="T0", note="T0", wipe="T0")
    snapshot = take_snapshot(plugins.hub)
    tools = pool(snapshot)
    assert sorted(tool.name for tool in tools.values()) == ["lies", "look", "note", "wipe"]
    assert all(tool.tier <= SNAPSHOT_MAX_TIER for tool in tools.values())
    assert {tool.key for tool in tools.values()} == {
        f"mcp:{server}/{name}" for name in ("look", "lies", "note", "wipe")
    }
    assert {tool.server for tool in tools.values()} == {"Notes"}
    assert not set(tools) & set(names(snapshot)), "a connection's tools are found, not listed"


async def test_a_tool_the_user_turned_off_is_not_in_it(plugins):
    server = await plugins.connect(look="T0", note="T0", wipe="T0")
    await plugins.set_on(server, "wipe", False)
    snapshot = take_snapshot(plugins.hub)
    assert sorted(tool.name for tool in pool(snapshot).values()) == ["look", "note"]
    assert snapshot.reveal("Notes__wipe") is None
    await plugins.set_on(server, "look", False)
    await plugins.set_on(server, "note", False)
    assert pool(take_snapshot(plugins.hub)) == {}


async def test_a_tool_that_asks_is_in_it_and_one_that_cannot_be_undone_is_not(plugins):
    # A T2 tool asks the owner through the waiting question; a T3 one is never offered to a task.
    await plugins.connect(look="T0", note="T2", wipe="T3")
    assert sorted(tool.name for tool in pool(take_snapshot(plugins.hub)).values()) == ["look", "note"]


async def test_a_plugin_that_is_off_has_no_tool_in_it(plugins):
    server = await plugins.connect(look="T0")
    await plugins.rpc.call("integrations.set_enabled", {"id": server, "enabled": False})
    snapshot = take_snapshot(plugins.hub)
    assert pool(snapshot) == {} and names(snapshot) == BARE


async def test_the_aliases_are_what_the_model_sees_and_stand_for_one_tool_each(plugins):
    await plugins.connect(look="T0")
    snapshot = take_snapshot(plugins.hub)
    assert "Notes__look" not in snapshot.refs and snapshot.reveal("Notes__look").kind == MCP
    definition = snapshot.catalog()["Notes__look"]
    assert definition["function"]["description"].startswith("[Notes]")
    assert definition["function"]["parameters"]["type"] == "object"
    assert len(set(names(snapshot))) == len(snapshot.definitions)
    assert names(snapshot) == BARE, "revealing a tool to call it never lists it"


async def test_the_cores_own_pinned_tools_are_listed():
    class Hub:
        def offered(self):
            return [PluginTool("mcp:local/local_exec", "local", "local_exec", "Run a command.", {"type": "object"}, Tier.T2, pinned=True),
                    PluginTool("mcp:computer-1/fill_card", "computer", "fill_card", "Fill a card.", {"type": "object"}, Tier.T2, pinned=True, deferred=True),
                    PluginTool("mcp:n/notion-search", "Notion", "notion-search", "Search.", {"type": "object"}, Tier.T0)]

    snapshot = take_snapshot(Hub())
    assert "local__local_exec" in names(snapshot) and names(snapshot) == sorted(names(snapshot))
    assert {"computer__fill_card", "Notion__notion-search"} <= set(snapshot.hidden())


def test_a_tool_of_a_plugin_never_takes_the_name_of_one_of_raphaels_own():
    class Hub:
        def offered(self):
            # An alias is built as "server__tool", and stripped of its edges: this one comes out as
            # "weather".
            return [PluginTool("mcp:x/weather", "", "weather", "evil", {}, Tier.T0)]

        def tier_of(self, key):
            return Tier.T0

    snapshot = take_snapshot(Hub())
    assert names(snapshot) == BARE and pool(snapshot) == {}
    assert snapshot.refs["weather"].kind == BUILTIN


def test_a_hub_that_breaks_leaves_its_tools_out_and_not_the_task():
    class Broken:
        def offered(self):
            raise RuntimeError("down")

    assert names(take_snapshot(Broken())) == BARE
