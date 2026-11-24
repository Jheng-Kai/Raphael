import asyncio
import base64
import contextlib
import json
import os
import struct
from pathlib import Path
from types import SimpleNamespace

import pytest

from raphael_core.agent.data_floor import DataFloor
from raphael_core.agent.policy import Tier
from raphael_core.computer.host_browser import BrowserError, HostBrowser, Tab, chrome_executable
from raphael_core.computer import host_page
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN, COMPUTER_STATUS_KEY, VmTools, vm_scope
from raphael_core.brain.settings import SettingsStore


def add_tab(browser, identifier, member, root, *, shown=True):
    tab = Tab(identifier, "target-" + identifier, "session-" + identifier, member, root)
    browser.tabs[tab.id] = tab
    browser.owned_targets[tab.target] = member
    if shown:
        browser.select(tab)
    return tab


async def host_call(tools, name, arguments, *, member=1, turn_id=1, task_id=None, approver="auto"):
    key = next(tool.key for tool in tools.offered(member) if tool.name == name)
    scope = ("turn", member, 3) if task_id is None else ("task", task_id)
    return await tools.call(key, arguments, member=member, scope=scope, turn_id=turn_id,
                            conversation_id=3, private=True, approver=approver, language="en", announce=None)


@pytest.mark.parametrize("installed", [False, True])
async def test_only_the_assigned_computer_is_offered_with_read_only_status(tmp_path, conn, monkeypatch, installed):
    vm = LocalVm(tmp_path, settings=SettingsStore(conn))
    vm.desktop = SimpleNamespace(installed=lambda: installed)
    vm.real_transport = False
    probes = []

    async def available(target=None):
        probes.append("info")
        return True

    async def unexpected(*args, **kwargs):
        pytest.fail("Listing computer tools or reading status must not take a Docker seat or start it")

    monkeypatch.setattr(vm, "available", available)
    monkeypatch.setattr(vm, "seat", unexpected)
    monkeypatch.setattr(vm, "start", unexpected)
    monkeypatch.setattr("raphael_core.computer.host_browser.chrome_executable", lambda: "chrome")
    tools = VmTools(SimpleNamespace(offered=lambda: []), vm, attachments=None, conn=conn)
    tools.host_computer = HostComputerTools(vm, conn, BROWSER_OPEN)
    await tools.prepare(0)
    offered = tools.offered_for(0)
    assert not any(tool.name == "vm_exec" for tool in offered)
    host_open = next(tool.key for tool in offered if tool.name == "browser_open")
    result = await tools.call(COMPUTER_STATUS_KEY, {}, approver="auto")
    assert result.ok and json.loads(result.text) == {"computer": "host", "available": True}
    assert not probes
    with conn:
        tools.set_computer_mode(0, "docker")
    await tools.prepare(0)
    offered = tools.offered_for(0)
    assert any(tool.name == "vm_exec" for tool in offered)
    assert all(tool.name != "suggest_computer" and tool.key != host_open for tool in offered)
    assert (await tools.call(host_open, {"url": "https://example.invalid"}, approver="auto")).kind == "computer_changed"
    result = await tools.call(COMPUTER_STATUS_KEY, {}, approver="auto")
    assert result.ok
    assert json.loads(result.text) == {"computer": "docker", "installed": installed, "running": installed}
    assert probes == (["info"] if installed else [])
    if not installed:
        docker_open = next(tool.key for tool in offered if tool.name == "browser_open" and tool.alias_group is None)
        result = await tools.call(docker_open, {"url": "https://example.invalid"}, approver="auto")
        assert result.kind == "docker_missing" and "Chrome" not in result.text


async def test_two_members_do_not_wait_for_the_same_chrome_action_lock(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    first_tab = add_tab(browser, "first", 1, tmp_path)
    second_tab = add_tab(browser, "second", 2, tmp_path)
    entered, finish = asyncio.Event(), asyncio.Event()

    async def snapshot(browser, tab, arguments):
        if tab is first_tab:
            entered.set()
            await finish.wait()
        return {"tab_id": tab.id}, []

    monkeypatch.setattr(host_page, "snapshot", snapshot)
    first = asyncio.create_task(host_call(tools, "get_browser_state", {}))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        second = await asyncio.wait_for(host_call(tools, "get_browser_state", {}, member=2), 1)
        assert second.ok and json.loads(second.text)["tab_id"] == second_tab.id
        assert not first.done()
    finally:
        finish.set()
        await first
    assert first.result().ok


async def test_a_later_turn_and_a_task_share_tabs_but_wait_only_for_the_same_tab(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    first = add_tab(browser, "first", 1, tmp_path)
    peer = add_tab(browser, "peer", 2, tmp_path)
    other = add_tab(browser, "other", 1, tmp_path, shown=False)
    entered, resume = asyncio.Event(), asyncio.Event()
    observed = []

    async def snapshot(browser, tab, arguments):
        observed.append(tab.id)
        if tab is first and len(observed) == 2:
            entered.set()
            await resume.wait()
        return {"tab_id": tab.id}, []

    monkeypatch.setattr(host_page, "snapshot", snapshot)
    assert (await host_call(tools, "get_browser_state", {})).ok
    tools.finish_work(turn_id=1)
    assert first.finished
    listing = await host_call(tools, "browser_tabs", {}, turn_id=2)
    assert [row["tab_id"] for row in json.loads(listing.text)["tabs"]] == [first.id, other.id]
    assert (await host_call(tools, "get_browser_state", {"tab_id": peer.id}, turn_id=2)).kind == "browser_tab_required"
    chat = asyncio.create_task(host_call(tools, "get_browser_state", {}, turn_id=2))
    task = asyncio.create_task(host_call(tools, "get_browser_state", {"tab_id": first.id}, task_id=8, turn_id=3))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        second = await asyncio.wait_for(host_call(tools, "get_browser_state", {"tab_id": other.id}, task_id=9), 1)
        assert second.ok and json.loads(second.text)["tab_id"] == other.id
        assert not task.done() and observed == [first.id, first.id, other.id]
    finally:
        resume.set()
        assert all(result.ok for result in await asyncio.gather(chat, task))
    assert observed == [first.id, first.id, other.id, first.id]
    tools.finish_work(task_id=8)
    assert first.finished and browser.tab(1) is first


async def test_a_finished_tab_survives_past_the_old_idle_timeout(tmp_path, conn, monkeypatch):
    settings = SettingsStore(conn)
    tools = HostComputerTools(LocalVm(tmp_path, settings=settings), conn, BROWSER_OPEN)
    browser = tools.browser
    loop = asyncio.get_running_loop()
    cdp = browser.cdp = SimpleNamespace(reader=loop.create_future())
    tab = add_tab(browser, "earlier", 1, tmp_path)
    tab.work = (("turn", 1, 3), 7)
    now = loop.time()
    with monkeypatch.context() as clock:
        clock.setattr(loop, "time", lambda: now)
        tools.finish_work(turn_id=7)
        await asyncio.sleep(0)
        now += 901
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        listed = await host_call(tools, "browser_tabs", {}, turn_id=8)
        assert browser.cdp is cdp and tab.finished and browser.live(tab)
    assert json.loads(listed.text)["tabs"][0]["tab_id"] == tab.id


@pytest.mark.parametrize("mode", ["shared", "per-bot"])
async def test_host_files_use_the_same_local_workspace_and_team_as_docker(tmp_path, conn, mode):
    settings = SettingsStore(conn)
    settings.set("computer_vm_mode", mode)
    vm = LocalVm(tmp_path, settings=settings)
    tools = HostComputerTools(vm, conn, BROWSER_OPEN)
    target = vm.target(2)
    assert tools.folders(2) == (vm.member_workspace(target), target.shared)
    assert tools.folders(1)[0] != tools.folders(2)[0]
    assert tools.folders(1)[1] == tools.folders(2)[1]
    if mode == "shared":
        assert vm.member_workspace(target).relative_to(target.workspace).parts == ("members", target.key)
        routes = VmTools(SimpleNamespace(), vm, attachments=None)
        assert routes.member_file_path(target, "doc.txt") == vm.guest_workspace(target) + "/doc.txt"


async def test_host_writes_use_work_roots_and_need_an_explicit_yes_elsewhere(tmp_path, conn):
    machine = LocalVm(tmp_path / "data", settings=SettingsStore(conn))
    tools = HostComputerTools(machine, conn, BROWSER_OPEN)
    key = next(tool.key for tool in tools.offered(1) if tool.name == "write_file")
    work = ("turn", 1, 2)
    args = {"path": "notes.txt", "content": "kept"}
    assert tools.tier_for_call(key, args) == Tier.T0
    result = await tools.file_call(1, "write_file", args, "auto", work)
    assert result.ok, result.text
    assert (tools.folders(1)[0] / "notes.txt").read_text() == "kept"
    floor = DataFloor(conn, core_root=tmp_path)
    floor.work_file = tools.work_file
    assert floor.access(key, {**args, "path": str(tools.folders(1)[0] / "notes.txt")}) is None
    assert floor.access(key, {**args, "path": str(tools.browser.profile / "Preferences")}) == "write"
    outside = {"path": str(tmp_path / "other.txt"), "content": "approved"}
    assert tools.tier_for_call(key, outside) == Tier.T3 and tools.firm_for_call(key, outside)
    assert not tools.firm_for_call(key, args)
    assert (await tools.file_call(1, "write_file", outside, "auto", work)).kind == "approval_required"
    assert (await tools.file_call(1, "write_file", outside, "user", work)).ok
    assert Path(outside["path"]).read_text() == "approved"
    profile = {"path": str(tools.browser.profile / "DevToolsActivePort")}
    assert (await tools.file_call(1, "read_file", profile, "user", work)).kind == "protected_data"


async def test_host_writes_in_a_chosen_project_reach_only_that_project(tmp_path, conn):
    settings = SettingsStore(conn)
    project, other = tmp_path / "project", tmp_path / "other"
    project.mkdir()
    other.mkdir()
    settings.set("project_folders", [str(project), str(other)])
    settings.set("member_work_folder", {"1": str(project)})
    tools = HostComputerTools(LocalVm(tmp_path / "data", settings=settings), conn, BROWSER_OPEN)
    key = next(tool.key for tool in tools.offered(1) if tool.name == "write_file")
    work = ("turn", 1, 2)
    inside = {"path": str(project / "a.txt"), "content": "kept"}
    assert tools.tier_for_call(key, inside) == Tier.T0 and not tools.firm_for_call(key, inside)
    assert (await tools.file_call(1, "write_file", inside, "auto", work)).ok
    # Its own folder, the team folder and another remembered project are outside it now.
    own, team = tools.folders(1)
    for folder in (own, team, other):
        refused = {"path": str(folder / "b.txt"), "content": "no"}
        assert tools.tier_for_call(key, refused) == Tier.T3 and tools.firm_for_call(key, refused), folder
        assert (await tools.file_call(1, "write_file", refused, "auto", work)).kind == "approval_required"
        assert not (folder / "b.txt").exists()
    # A relative name is taken from the project, and `..` out of it is outside.
    assert tools.tier_for_call(key, {"path": "c.txt", "content": "x"}) == Tier.T0
    assert tools.tier_for_call(key, {"path": "../other/c.txt", "content": "x"}) == Tier.T3
    # The owner's yes is the way to another place; a member without a project chosen keeps to its own folder and the team's.
    assert (await tools.file_call(1, "write_file", {"path": str(other / "b.txt"), "content": "yes"}, "user", work)).ok
    assert (other / "b.txt").read_text() == "yes"
    assert tools.tier_for_call(key, {"path": str(own / "d.txt"), "content": "x"}) == Tier.T3
    assert tools.tier_for_call(key, {"path": "d.txt", "content": "x"}, ) == Tier.T0
    settings.set("member_work_folder", {})
    assert tools.tier_for_call(key, {"path": str(own / "d.txt"), "content": "x"}) == Tier.T0
    assert tools.tier_for_call(key, {"path": str(team / "d.txt"), "content": "x"}) == Tier.T0
    assert tools.tier_for_call(key, {"path": str(project / "d.txt"), "content": "x"}) == Tier.T3


async def test_a_download_is_placed_in_the_work_folder_the_member_has(tmp_path, conn):
    settings = SettingsStore(conn)
    project = tmp_path / "project"
    project.mkdir()
    settings.set("project_folders", [str(project)])
    tools = HostComputerTools(LocalVm(tmp_path / "data", settings=settings), conn, BROWSER_OPEN)
    assert tools.browser.download_to == tools.download_folder
    assert tools.download_folder(1) == tools.folders(1)[0]
    settings.set("member_work_folder", {"1": str(project)})
    assert tools.browser.download_to(1) == Path(os.path.realpath(project))


async def test_certificate_handoff_keeps_the_origin_and_tab_for_an_existing_private_task(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    key = next(tool.key for tool in tools.offered(1) if tool.name == "request_takeover")
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    tab = add_tab(browser, "original", 1, tmp_path)
    seen = []

    async def wait(**context):
        seen.append((context["turn_id"], context["conversation_id"], context["reason"]))
        assert context["tab"] is tab and browser.handback[1] is tab
        assert tab.work == (("task", 5), 2)

    async def snapshot(browser, active, arguments):
        assert active is tab
        return {"tab_id": "original"}, []

    monkeypatch.setattr(host_page, "snapshot", snapshot)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    result = await tools.call(key, {"reason": "certificate"}, member=1, scope=("task", 5), turn_id=2,
                              conversation_id=3, private=True, approver="auto", language="en", announce=None)
    assert seen == [(2, 3, "certificate")]
    assert result.ok and json.loads(result.text) == {"tab_id": "original", "status": "owner_finished"}
    assert not browser.handback


@pytest.mark.parametrize(("tool", "reason", "detail"), [
    ("browser_click", "two_factor", ""),
    ("request_takeover", "sign_in", "Sign in on the page."),
])
async def test_host_handoff_keeps_its_reason_on_the_waiting_card_without_chat(
    tmp_path, conn, monkeypatch, tool, reason, detail,
):
    vm = LocalVm(tmp_path, settings=SettingsStore(conn))
    hub = VmTools(SimpleNamespace(offered=lambda: []), vm, attachments=None, conn=conn)
    host = hub.host_computer = HostComputerTools(vm, conn, BROWSER_OPEN)
    key = next(offer.key for offer in host.offered(1) if offer.name == tool)
    browser = host.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    tab = add_tab(browser, "original", 1, tmp_path)
    progress, notices, waiting = [], [], []

    async def dispatch(*args, **kwargs):
        return {"owner_needed": reason, "detail": detail}, []

    async def wait(**card):
        assert browser.handback[1] is tab and card["tab"] is tab
        waiting.append((card["reason"], card["detail"]))
        assert progress == notices == []

    async def snapshot(*args):
        return {"tab_id": "original"}, []

    monkeypatch.setattr(host, "page_call", dispatch)
    monkeypatch.setattr(host_page, "snapshot", snapshot)
    host.cards = SimpleNamespace(wait_for_browser=wait)
    arguments = ({"reason": reason, "detail": detail} if tool == "request_takeover"
                 else {"target_id": "original", "tab_id": "original", "ref": "p0123abcd:0"})
    with vm_scope(("turn", 1, 3), private=True, turn_id=2, language="zh-TW",
                  notice=notices.append, progress=progress.append):
        result = await hub.call(key, arguments, approver="auto")
    assert result.ok and waiting == [(reason, detail)]
    assert progress == notices == []


@pytest.mark.parametrize("arguments", [{}, {"reason": "other"}, {"reason": "other", "detail": " \n "}])
async def test_requests_without_an_owner_step_never_open_a_takeover(tmp_path, conn, arguments):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    key = next(tool.key for tool in tools.offered(1) if tool.name == "request_takeover")
    result = await tools.call(key, arguments, member=1, scope=("turn", 1, 3), turn_id=2,
                              conversation_id=3, private=True, approver="auto", language="en", announce=None)
    assert not result.ok and result.kind == "takeover_reason_required"
    assert not tools.browser.tabs


async def test_showing_a_sign_in_page_does_not_request_control(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    key = next(tool.key for tool in tools.offered(1) if tool.name == "browser_open")
    browser = tools.browser
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    tab = add_tab(browser, "original", 1, tmp_path)

    async def open_tab(*args, **kwargs):
        return tab, False

    async def navigate(*args):
        return True

    async def snapshot(*args):
        return {"tab_id": "original", "owner_needed": "sign_in"}, []

    async def wait(**context):
        pytest.fail("Opening a page for viewing must not request control")

    monkeypatch.setattr(browser, "open_tab", open_tab)
    monkeypatch.setattr(host_page, "navigate", navigate)
    monkeypatch.setattr(host_page, "snapshot", snapshot)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    result = await tools.call(key, {"url": "https://example.invalid/login"}, member=1, scope=("turn", 1, 3),
                              turn_id=2, conversation_id=3, private=True, approver="auto", language="en", announce=None)
    assert result.ok and json.loads(result.text)["owner_needed"] == "sign_in"
    assert not browser.handback


async def test_tab_close_waits_for_chrome_and_keeps_other_targets(tmp_path):
    browser = HostBrowser(tmp_path)
    first = add_tab(browser, "first", 1, tmp_path, shown=False)
    second = add_tab(browser, "second", 1, tmp_path)
    other = add_tab(browser, "other", 2, tmp_path)
    targets = {first.target, second.target, other.target, "owner"}
    closing = {}
    polls = 0

    async def call(method, params=None):
        nonlocal polls
        if method == "Target.closeTarget":
            target = params["targetId"]
            assert target not in closing
            closing[target] = polls + 1
            return {"success": True}
        assert method == "Target.getTargets"
        polls += 1
        targets.difference_update(target for target, deadline in closing.items() if deadline < polls)
        return {"targetInfos": [{"targetId": target} for target in targets]}

    browser.cdp = SimpleNamespace(call=call, reader=asyncio.get_running_loop().create_future())
    await browser.close_tab(second)
    assert set(closing) == {second.target} and polls == 2
    assert targets == {first.target, other.target, "owner"}
    assert browser.owned_targets == {first.target: 1, other.target: 2}
    assert browser.tab(1) is first and browser.tab(2) is other


async def test_first_work_reuses_only_the_marked_chrome_startup_page(tmp_path):
    browser = HostBrowser(tmp_path)
    browser.startup_url = "about:blank#raphael-test"
    created = []

    async def call(method, params=None, *, session=None):
        if method == "Target.getTargets":
            return {"targetInfos": [{"targetId": "owner", "type": "page", "url": "about:blank"},
                                    {"targetId": "startup", "type": "page", "url": "about:blank#raphael-test"}]}
        if method == "Target.createTarget":
            created.append(params)
            return {"targetId": "new"}
        if method == "Target.attachToTarget":
            return {"sessionId": params["targetId"]}
        if method in ("Page.enable", "Emulation.setDeviceMetricsOverride"):
            return {}
        assert method == "Page.getFrameTree"
        return {"frameTree": {"frame": {"id": session}}}

    browser.cdp = SimpleNamespace(call=call)
    first = await browser.new_tab(1, tmp_path)
    second = await browser.new_tab(2, tmp_path)
    assert (first.target, second.target) == ("startup", "new")
    bounds = {"left": -32000, "top": -32000} if os.name != "nt" else {}
    assert created == [{"url": "about:blank", "newWindow": True, "background": True, **bounds}]
    assert "owner" not in browser.owned_targets


@pytest.mark.parametrize("backends", [[2], [2, 3]], ids=["unique", "ambiguous"])
async def test_changed_click_ref_retries_only_one_matching_role_and_name(tmp_path, backends):
    browser = HostBrowser(tmp_path)
    tab = add_tab(browser, "page", 1, tmp_path)
    tab.refs["old-ref"] = (1, {"name": "Preview", "role": "button", "actions": ["click"]})
    clicked = []
    reads = 0

    async def command(tab, method, params=None):
        nonlocal reads
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "main", "url": "https://example.invalid"}}}
        if method == "Page.createIsolatedWorld":
            return {"executionContextId": 42}
        if method == "Runtime.evaluate":
            text = {"title": "Current page", "text": "Preview"} if "location.href" in params["expression"] else ""
            return {"result": {"value": text}}
        if method == "DOM.resolveNode":
            return {"object": {"objectId": str(params["backendNodeId"])}}
        if method == "Runtime.callFunctionOn":
            clicked.append(int(params["objectId"]))
            return {"result": {"value": "browser_ref_changed" if clicked[-1] == 1 else ""}}
        if method == "Accessibility.getFullAXTree":
            reads += 1
            return {"nodes": [{"ignored": False, "role": {"value": "button"}, "name": {"value": "Preview"},
                               "backendDOMNodeId": backend} for backend in backends]}
        assert method == "Runtime.releaseObject"
        return {}

    browser.command = command
    browser.cdp = SimpleNamespace(socket=SimpleNamespace(port=12345))
    data, blocks = await host_page.act(browser, tab, "browser_click", {"ref": "old-ref"}, "auto")
    assert reads == 1 and not blocks
    if len(backends) == 1:
        assert clicked == [1, 2] and data["status"] == "delivered"
    else:
        assert clicked == [1] and data["status"] == "browser_ref_changed"
        assert data["page"]["title"] == "Current page" and len(data["refs"]) == 2
        assert all(row["ref"] in tab.refs for row in data["refs"])


@pytest.mark.parametrize(("target", "owner_needed", "error"), [
    ({"name": "Project name", "role": "Edit", "editable": True}, "", ""),
    ({"name": "Card number", "role": "Edit", "editable": True}, "payment", ""),
    ({"reason": "two_factor"}, "two_factor", ""),
    ({"name": "Send message", "role": "button"}, "", "browser_owner_approval_required"),
    ({"opaque": True}, "", "browser_action_refused"),
])
async def test_viewport_click_and_typing_check_the_page_before_dispatch(tmp_path, monkeypatch, target, owner_needed, error):
    browser = HostBrowser(tmp_path)
    tab = add_tab(browser, "page", 1, tmp_path)
    delivered = []

    async def evaluate(browser, tab, expression):
        return (target if "elementFromPoint" in expression else ""), 42

    async def command(tab, method, params=None):
        delivered.append((method, params))

    monkeypatch.setattr(host_page, "evaluate", evaluate)
    browser.command = command
    if error:
        with pytest.raises(BrowserError, match=error):
            await host_page.viewport_action(browser, tab, "click", {"x": 25, "y": 82}, "auto")
    else:
        click = await host_page.viewport_action(browser, tab, "click", {"x": 25, "y": 82}, "auto")
        typed = await host_page.viewport_action(browser, tab, "type_text", {"text": "Draft"}, "auto")
        if owner_needed:
            assert click["owner_needed"] == typed["owner_needed"] == owner_needed
        else:
            assert click["status"] == typed["status"] == "delivered"
            assert [(method, params.get("type")) for method, params in delivered] == [
                ("Input.dispatchMouseEvent", "mousePressed"), ("Input.dispatchMouseEvent", "mouseReleased"),
                ("Input.insertText", None),
            ]
            assert delivered[0][1]["x"] == 25 and delivered[0][1]["y"] == 82
            assert delivered[-1][1] == {"text": "Draft"}
    if error or owner_needed:
        assert not delivered


async def serve(reader, writer):
    try:
        try:
            request = await reader.readuntil(b"\r\n\r\n")
        except (asyncio.IncompleteReadError, ConnectionError):
            return  # Chrome's preconnect, closed without a request
        path = request.split(b" ")[1]
        if path == b"/login":
            content = b'<form><label>Password<input type="password" value="hidden-test-value"></label></form>'
        elif path == b"/download":
            content = b"download contents"
        elif path == b"/opener":
            content = (b'<title>Work page</title><button id="open-popup" onclick="window.open(\'/popup\',\'_blank\','
                       b'\'popup,width=280,height=250\')">Open sign-in</button>'
                       b'<a id="open-tab" href="/popup" target="_blank">Open verification</a>')
        elif path == b"/popup":
            content = (b'<title>Sign-in</title><label>Code<input id="name"></label>'
                       b'<button id="done" onclick="window.close()">Done</button>')
        elif path == b"/dynamic":
            content = b"""<title>Changing controls</title>
                <style>
                    body {margin: 0; min-height: 200vh}
                    input {position: fixed; left: 20px; top: 20px; width: 120px; height: 30px}
                    button {position: fixed; left: 200px; top: 20px; width: 100px; height: 30px}
                </style>
                <input aria-label="Project name"><output>Waiting</output><button>Preview</button>
                <script>
                    window.framesRendered = 0;
                    window.buttonPresses = 0;
                    window.previews = 0;
                    window.doubles = 0;
                    window.addEventListener('pointerdown', event => {
                        if (event.target.matches('button')) ++window.buttonPresses;
                    });
                    window.addEventListener('click', event => {
                        if (event.clientX >= 200 && event.clientX < 300) {
                            ++window.previews;
                            document.querySelector('output').textContent = document.querySelector('input').value;
                        }
                    });
                    window.addEventListener('dblclick', () => ++window.doubles);
                    function render() {
                        const button = document.querySelector('button');
                        button.replaceWith(button.cloneNode(true));
                        ++window.framesRendered;
                        requestAnimationFrame(render);
                    }
                    requestAnimationFrame(render);
                </script>"""
        else:
            content = (b'<title>Intranet test</title><label for="name">Project name</label><input id="name">'
                       b'<button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'#name\').value">Preview</button><output></output>')
        headers = (b"Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=report.txt\r\n"
                   if path == b"/download" else b"Content-Type: text/html\r\n")
        writer.write(b"HTTP/1.1 200 OK\r\nConnection: close\r\n" + headers +
                     f"Content-Length: {len(content)}\r\n\r\n".encode() + content)
        await writer.drain()
    finally:
        writer.close()
        with contextlib.suppress(ConnectionError):
            await writer.wait_closed()


# A hosted runner has Chrome but no desktop session, where it cannot finish starting: this is a native check, run locally.
@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_chrome_has_scoped_tabs_page_input_private_forms_and_downloads(tmp_path):
    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    url = f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"
    root = tmp_path.resolve()
    browser = HostBrowser(root / "browser")
    async with server:
        try:
            assert await browser.start()
            startup_url = browser.startup_url
            owner = (await browser.cdp.call("Target.createTarget", {"url": "about:blank"}))["targetId"]
            one = await browser.new_tab(1, root / "one")
            two = await browser.new_tab(2, root / "two")
            with pytest.raises(BrowserError, match="browser_tab_required"):
                browser.tab(1, two.id)
            with pytest.raises(BrowserError, match="browser_tab_required"):
                browser.tab(1, owner)
            assert await host_page.navigate(browser, one, url)
            data, images = await host_page.snapshot(browser, one, {"include_screenshot": True})
            assert data["page"]["title"] == "Intranet test" and images[0]["mimeType"] == "image/png"
            ref = next(node["ref"] for node in data["refs"] if node["name"] == "Project name")
            result, _ = await host_page.act(browser, one, "browser_type", {"ref": ref, "text": "Draft"}, "user")
            assert result["status"] == "delivered"
            data, _ = await host_page.snapshot(browser, one, {})
            ref = next(node["ref"] for node in data["refs"] if node["name"] == "Preview" and node["role"] == "button")
            result, _ = await host_page.act(browser, one, "browser_click", {"ref": ref}, "user")
            assert result["status"] == "delivered"
            data, _ = await host_page.snapshot(browser, one, {})
            assert "Draft" in data["page"]["text"]
            assert await host_page.navigate(browser, one, url + "/login")
            data, images = await host_page.snapshot(browser, one, {"include_screenshot": True})
            assert data["owner_needed"] == "sign_in" and not images
            assert not await host_page.navigate(browser, two, url + "/download")
            async with asyncio.timeout(10):
                while not (root / "two" / "report.txt").is_file():
                    await asyncio.sleep(0.05)
                await asyncio.gather(*browser.transfers)
            assert (root / "two" / "report.txt").read_text() == "download contents"
            await browser.close_tab(one)
            listing = await browser.cdp.call("Target.getTargets")
            targets = {item["targetId"] for item in listing["targetInfos"] if item["type"] == "page"}
            assert {owner, two.target} <= targets and one.target not in targets
            assert all(item["url"] != startup_url for item in listing["targetInfos"])
            await browser.cdp.call("Target.closeTarget", {"targetId": owner})
            await browser.close_tab(two)
            cdp = browser.cdp
            assert not browser.tabs and not cdp.reader.done()
            replacement, started = await browser.open_tab(1, root / "one", 3)
            assert not started and browser.cdp is cdp and browser.tab(1) is replacement
        finally:
            await browser.aclose()


@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_native_chrome_coordinates_work_across_turns_on_a_rerendering_page(tmp_path, conn):
    tools = HostComputerTools(LocalVm(tmp_path.resolve(), settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = tools.browser
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    async with site:
        try:
            url = f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}/dynamic"
            opened = await host_call(tools, "browser_open", {"url": url}, turn_id=1)
            assert opened.ok, opened.text
            tab = browser.tab(1)
            tools.finish_work(turn_id=1)
            listing = await host_call(tools, "browser_tabs", {}, turn_id=2)
            shown, = json.loads(listing.text)["tabs"]
            assert shown["tab_id"] == tab.id and shown["url"] == url and shown["shown"]
            state = await host_call(tools, "get_browser_state", {"tab_id": tab.id}, turn_id=2)
            assert state.ok and json.loads(state.text)["tab_id"] == tab.id
            shot = await host_call(tools, "get_desktop_state", {}, turn_id=2)
            assert shot.ok and struct.unpack(">II", base64.b64decode(shot.blocks[0]["data"])[16:24]) == (1280, 900)

            async def value(expression):
                answer = await browser.command(tab, "Runtime.evaluate", {"expression": expression, "returnByValue": True})
                return answer["result"]["value"]

            async def act(name, arguments, *, explicit=False):
                if explicit:
                    arguments = {**arguments, "tab_id": tab.id}
                result = await host_call(tools, name, arguments, turn_id=2)
                assert result.ok and json.loads(result.text)["status"] == "delivered", result.text

            await act("click", {"x": 40, "y": 36})
            await act("type_text", {"text": "Typed in turn two"})
            await act("press_key", {"key": "end"})
            await act("press_key", {"key": "!"})
            await act("browser_click", {"x": 220, "y": 36}, explicit=True)
            assert await value("document.querySelector('output').textContent") == "Typed in turn two!"
            assert await value("window.framesRendered") > 1 and await value("window.buttonPresses") == 1
            await act("double_click", {"x": 220, "y": 36})
            # The button is replaced every frame, so a press and release that straddle a frame land on different
            # elements and the browser fires no click for that pair; the double click still reaches the page.
            assert await value("window.previews") >= 2 and await value("window.doubles") >= 1
            await act("scroll", {"x": 500, "y": 600, "direction": "down", "amount": 3})
            async with asyncio.timeout(3):
                while not await value("scrollY > 0"):
                    await asyncio.sleep(0.025)
        finally:
            await tools.aclose()
