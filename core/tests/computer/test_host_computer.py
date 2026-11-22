import asyncio
import contextlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from raphael_core.agent.data_floor import DataFloor
from raphael_core.agent.policy import Tier
from raphael_core.computer.host_browser import BrowserError, HostBrowser, Tab, chrome_executable
from raphael_core.computer import host_page
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN, COMPUTER_STATUS_KEY, VmTools
from raphael_core.brain.settings import SettingsStore

@pytest.mark.parametrize("installed", [False, True])
async def test_both_tools_are_offered_with_read_only_status(tmp_path, conn, monkeypatch, installed):
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
    tools = VmTools(SimpleNamespace(offered=lambda: []), vm, attachments=None)
    tools.host_computer = HostComputerTools(vm, conn, BROWSER_OPEN)
    await tools.prepare(1)
    offered = tools.offered_for(1)
    assert any(tool.name == "vm_exec" for tool in offered)
    assert {tool.alias_group for tool in offered if tool.name == "browser_open"} == {None, "computer_chrome"}
    assert tools.active_transport(1, 2) is None
    result = await tools.call(COMPUTER_STATUS_KEY, {}, approver="auto")
    assert result.ok
    assert json.loads(result.text) == {
        "docker": {"installed": installed, "running": installed, "sign_ins": "Docker browser profile"},
        "host_chrome": {"available": True, "sign_ins": "Shared Raphael Chrome profile"},
    }
    assert probes == (["info"] if installed else [])
    if not installed:
        docker_open = next(tool.key for tool in offered if tool.name == "browser_open" and tool.alias_group is None)
        assert (await tools.call(docker_open, {"url": "https://example.invalid"}, approver="auto")).kind == "docker_missing"


async def test_two_members_do_not_wait_for_the_same_chrome_action_lock(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    entered, finish = asyncio.Event(), asyncio.Event()

    async def dispatch(name, arguments, approver, member, work, conversation, announce, *, turn_id=None):
        if member == 1:
            entered.set()
            await finish.wait()
        return {"member": member}, [], None

    monkeypatch.setattr(tools, "browser_call", dispatch)

    async def open_page(member):
        key = next(tool.key for tool in tools.offered(member) if tool.name == "browser_open")
        return await tools.call(key, {"url": "https://example.invalid"}, member=member, scope=("turn", member, 2),
                                turn_id=member, conversation_id=2, private=True, approver="auto", language="en", announce=None)

    first = asyncio.create_task(open_page(1))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        second = await asyncio.wait_for(open_page(2), 1)
        assert second.ok and json.loads(second.text) == {"member": 2}
        assert not first.done()
    finally:
        finish.set()
        await first
    assert first.result().ok


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
    assert tools.tier_for_call(key, outside) == Tier.T2
    assert (await tools.file_call(1, "write_file", outside, "auto", work)).kind == "approval_required"
    assert (await tools.file_call(1, "write_file", outside, "user", work)).ok
    assert Path(outside["path"]).read_text() == "approved"
    profile = {"path": str(tools.browser.profile / "DevToolsActivePort")}
    assert (await tools.file_call(1, "read_file", profile, "user", work)).kind == "protected_data"


async def test_certificate_handoff_keeps_the_origin_and_tab_for_an_existing_private_task(tmp_path, conn, monkeypatch):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    key = next(tool.key for tool in tools.offered(1) if tool.name == "request_takeover")
    tab = SimpleNamespace(handoff=False)
    seen = []
    explanations = []

    async def dispatch(name, arguments, approver, member, work, conversation, announce, *, turn_id=None):
        assert name == "request_takeover" and work == ("task", 5)
        return {"owner_needed": arguments["reason"]}, [], tab

    async def wait(**context):
        seen.append((context["turn_id"], context["conversation_id"], context["reason"]))
        assert context["tab"] is tab and tab.handoff

    async def snapshot(browser, active, arguments):
        assert active is tab and not tab.handoff
        return {"tab_id": "original"}, []

    monkeypatch.setattr(tools, "browser_call", dispatch)
    monkeypatch.setattr(host_page, "snapshot", snapshot)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    result = await tools.call(key, {"reason": "certificate"}, member=1, scope=("task", 5), turn_id=2,
                              conversation_id=3, private=True, approver="auto", language="en", announce=None,
                              explain=explanations.append)
    assert seen == [(2, 3, "certificate")]
    assert explanations == ["Please select your certificate in the Computer panel."]
    assert result.ok and json.loads(result.text) == {"tab_id": "original", "status": "owner_finished"}


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
    tab = SimpleNamespace(handoff=False)

    async def dispatch(name, arguments, approver, member, work, conversation, announce, *, turn_id=None):
        return {"tab_id": "original", "owner_needed": "sign_in"}, [], tab

    async def wait(**context):
        pytest.fail("Opening a page for viewing must not request control")

    monkeypatch.setattr(tools, "browser_call", dispatch)
    tools.cards = SimpleNamespace(wait_for_browser=wait)
    result = await tools.call(key, {"url": "https://example.invalid/login"}, member=1, scope=("turn", 1, 3),
                              turn_id=2, conversation_id=3, private=True, approver="auto", language="en", announce=None)
    assert result.ok and json.loads(result.text) == {"tab_id": "original", "owner_needed": "sign_in"}
    assert not tab.handoff


async def test_scope_close_waits_for_all_owned_targets_even_after_a_session_detaches(tmp_path):
    browser = HostBrowser(tmp_path)
    scope = ("one",)
    first = Tab("first-tab", "first", "first-session", scope, 1, tmp_path)
    second = Tab("second-tab", "second", "second-session", scope, 1, tmp_path)
    other = Tab("other-tab", "other", "other-session", ("two",), 2, tmp_path)
    browser.tabs.update({tab.id: tab for tab in (first, second, other)})
    browser.owned_targets.update({tab.target: tab.scope for tab in (first, second, other)})
    targets = {"first", "second", "other", "popup", "owner"}
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

    browser.cdp = SimpleNamespace(call=call)
    browser._event("Target.targetCreated", {"targetInfo": {"type": "page", "targetId": "popup", "openerId": "first"}}, None)
    browser._event("Target.detachedFromTarget", {"sessionId": "first-session"}, None)
    assert first.id not in browser.tabs and "first" in browser.owned_targets
    await browser.close_scope(scope)
    assert set(closing) == {"first", "second", "popup"}
    assert targets == {"other", "owner"}
    assert browser.owned_targets == {"other": other.scope}


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
    first = await browser.new_tab(("one",), 1, tmp_path)
    second = await browser.new_tab(("two",), 2, tmp_path)
    assert (first.target, second.target) == ("startup", "new")
    assert created == [{"url": "about:blank", "newWindow": True}]
    assert "owner" not in browser.owned_targets


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
    browser = HostBrowser(root / "browser", idle_seconds=0.05)
    async with server:
        try:
            assert await browser.start()
            startup_url = browser.startup_url
            owner = (await browser.cdp.call("Target.createTarget", {"url": "about:blank"}))["targetId"]
            one = await browser.new_tab(("one",), 1, root / "one")
            two = await browser.new_tab(("two",), 2, root / "two")
            with pytest.raises(BrowserError, match="browser_tab_required"):
                browser.tab(("one",), two.id)
            with pytest.raises(BrowserError, match="browser_tab_required"):
                browser.tab(("one",), owner)
            assert await host_page.navigate(browser, one, url)
            data, images = await host_page.snapshot(browser, one, {"include_screenshot": True})
            assert data["page"]["title"] == "Intranet test" and images[0]["mimeType"] == "image/png"
            ref = next(node["ref"] for node in data["refs"] if node["name"] == "Project name")
            assert (await host_page.act(browser, one, "browser_type", {"ref": ref, "text": "Draft"}, "user"))["status"] == "delivered"
            data, _ = await host_page.snapshot(browser, one, {})
            ref = next(node["ref"] for node in data["refs"] if node["name"] == "Preview" and node["role"] == "button")
            assert (await host_page.act(browser, one, "browser_click", {"ref": ref}, "user"))["status"] == "delivered"
            data, _ = await host_page.snapshot(browser, one, {})
            assert "Draft" in data["page"]["text"]
            assert await host_page.navigate(browser, one, url + "/login")
            data, images = await host_page.snapshot(browser, one, {"include_screenshot": True})
            assert data["owner_needed"] == "sign_in" and not images
            assert not await host_page.navigate(browser, two, url + "/download")
            async with asyncio.timeout(10):
                while not (root / "two" / "report.txt").is_file():
                    await asyncio.sleep(0.05)
            assert (root / "two" / "report.txt").read_text() == "download contents"
            await browser.close_scope(("one",))
            listing = await browser.cdp.call("Target.getTargets")
            targets = {item["targetId"] for item in listing["targetInfos"] if item["type"] == "page"}
            assert {owner, two.target} <= targets and one.target not in targets
            assert all(item["url"] != startup_url for item in listing["targetInfos"])
            await browser.close_scope(("two",))
            async with asyncio.timeout(10):
                while browser.cdp is not None:
                    await asyncio.sleep(0.05)
        finally:
            await browser.aclose()
