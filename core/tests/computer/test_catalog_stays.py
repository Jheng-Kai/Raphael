"""A member's computer tools are the same list before and after the driver is asked, and each says what it is for.

A CLI brain reads its tool list once and a provider caches it. The list kept with the code used to be older than the
driver in the image (other parameters, some the driver refuses), so the member's first use of its computer replaced
all thirty tools, the CLI turn started again and that first call's result was lost (real members, 2026-11-12).
"""

from copy import deepcopy
import json

import pytest

from raphael_core.agent.plugins import DESCRIPTION_CHARS
from raphael_core.background.snapshot import take_snapshot
from raphael_core.computer.vm_catalog import DRIVER_TOOLS, offline_catalog
from raphael_core.computer.vm_tools import SHARED_CONTRACT, SHARED_NOTED, VM_CONTRACT, VmTools
from raphael_core.services.attachment_store import AttachmentStore

from raphael_core.computer.vm_bridge import normalize_schema

from .fixtures.driver_contract import KEPT, SCHEMAS, catalog
from .fixtures.generate_driver_tools import reduce_schema
from .test_vm import Bridge, EmptyHub, desktop, per_bot_desktop  # noqa: F401


def listing(change=None):
    """What the driver in the image answers to tools/list (its own long words for each tool included), with the
    tools Raphael does not offer."""
    tools = {tool["name"]: {**tool, "description": tool["description"] * 20} for tool in catalog()["tools"]}
    tools["future_driver_admin_tool"] = {"name": "future_driver_admin_tool", "description": "Not offered.",
                                         "inputSchema": {"type": "object"}}
    if change:
        change(tools)
    return {"tools": list(tools.values())}


def driver(change=None):
    class Driver(Bridge):
        calls = []

        async def request(self, method, params=None):
            return listing(change) if method == "tools/list" else await super().request(method, params)
    return Driver


@pytest.fixture(params=["desktop", "per_bot_desktop"], ids=["shared", "per-bot"])
def computer(request):
    # One of the two: both write the kind of computer into the same settings.
    return request.getfixturevalue(request.param)


def test_the_kept_list_is_the_capture_the_doubles_check_calls_against():
    # One capture, two files: what a member is offered and what a double refuses cannot come from different drivers.
    assert KEPT.keys() == DRIVER_TOOLS.keys() == SCHEMAS.keys()
    assert {name: reduce_schema(normalize_schema(schema)) for name, schema in KEPT.items()} == SCHEMAS
    for name, item in offline_catalog().items():
        assert "session" in KEPT[name]["properties"], "kept as the driver gives it"
        assert "session" not in item["parameters"]["properties"] and "session" not in item["validation"]["properties"]


async def test_asking_the_pinned_driver_changes_nothing_a_member_was_offered(computer, tmp_path):
    vm, target, _ = computer
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=driver())
    await hub.prepare()
    snapshot = take_snapshot(hub)
    offered = json.dumps(snapshot.definitions, ensure_ascii=False)
    checked = {key: deepcopy(schema) for key, schema in hub.schemas.items()}
    assert sum(item["function"]["name"].startswith("computer__") for item in snapshot.definitions) >= len(DRIVER_TOOLS)

    await hub._discover(target)

    assert target.key in hub.listed and "future_driver_admin_tool" not in {tool.name for tool in hub.offered()}
    assert [tool["name"] for tool in catalog()["tools"]] != list(DRIVER_TOOLS), "the driver lists in its own order"
    assert snapshot.refresh_computer(hub, 0) is False, "a CLI turn starts again when this is true"
    # To the byte: an API brain's provider caches the list by its text.
    assert json.dumps(snapshot.definitions, ensure_ascii=False) == offered
    assert hub.schemas == checked, "what a call is checked against before the driver is asked is the driver's own"


async def test_a_driver_that_lists_something_else_is_still_taken(computer, tmp_path):
    def newer(tools):
        tools["click"]["inputSchema"]["properties"]["future_parameter"] = {"type": "boolean"}
        del tools["drag"]
    vm, target, _ = computer
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=driver(newer))
    await hub.prepare()
    snapshot = take_snapshot(hub)
    await hub._discover(target)
    assert snapshot.refresh_computer(hub, 0) is True
    listed = {item["function"]["name"]: item["function"] for item in snapshot.definitions}
    assert "future_parameter" in listed["computer__click"]["parameters"]["properties"]
    assert "computer__drag" not in listed and "computer__vm_exec" in listed


async def test_every_computer_tool_says_what_it_is_for_first_and_is_read_whole(computer, tmp_path):
    vm, target, _ = computer
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=driver())
    await hub.prepare()
    snapshot = take_snapshot(hub)
    shown = {name.removeprefix("computer__"): item["function"]["description"]
             for name, item in snapshot.catalog().items() if name.startswith("computer__")}
    tools = {tool.name: tool for tool in hub.offered()}
    assert shown.keys() == tools.keys() and set(DRIVER_TOOLS) < shown.keys()
    for name, tool in tools.items():
        assert shown[name] == "[computer] " + tool.description, f"{name} is cut"
        assert not tool.description.startswith(VM_CONTRACT), f"{name} opens with the approval rule, not what it does"
        assert tool.description.endswith(SHARED_CONTRACT) == bool(target.container and name in SHARED_NOTED)
    for name, line in DRIVER_TOOLS.items():
        assert tools[name].description.startswith(line + " " + VM_CONTRACT)
    # Cut at the length a plugin's description is, every one of these read as the same words (and none said what
    # it did): the opening of each is its own.
    openings = {description[:DESCRIPTION_CHARS // 8] for description in shown.values()}
    assert len(openings) == len(shown)
    # Shown whole, their length is the core's to keep: the whole computer, in every request of every member.
    # Measured 2026-11-13: 17.8 thousand characters in all (18.4 at a seat); the longest is the shell's, 1304 at a seat.
    # 2026-11-14: the outward-action rule is one sentence on each tool and whole in the shared contract once: 10.0
    # thousand (10.6 at a seat). The ceiling keeps the room the file tools need and no more.
    assert sum(map(len, shown.values())) <= 14_000
    assert max(map(len, shown.values())) <= 1_400
