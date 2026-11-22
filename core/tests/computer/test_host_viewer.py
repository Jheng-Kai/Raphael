"""The real loopback relay with fake CDP, plus the opt-in native Chrome journey."""

import asyncio
import base64
import json
import os
from types import SimpleNamespace

import httpx
import pytest

from raphael_core.computer import host_page
from raphael_core.computer.host_browser import ChromeProcessTree, HostBrowser, Tab, chrome_executable
from raphael_core.computer.host_view import Screencast
from raphael_core.computer.viewer import DesktopViewer
from raphael_core.computer.vm import LocalVm
from raphael_core.protocol import RpcError

from .test_host_computer import serve


class Cdp:
    def __init__(self, browser):
        self.browser = browser
        self.calls = []
        self.reader = asyncio.get_running_loop().create_future()

    async def call(self, method, params=None, *, session=None):
        self.calls.append((method, params, session))
        if method == "Page.startScreencast":
            self.frame(session)

    def frame(self, session):
        self.browser._event("Page.screencastFrame", {
            "sessionId": 19, "data": base64.b64encode(session.encode()).decode(),
            "metadata": {"deviceWidth": 1280, "deviceHeight": 700},
        }, session)


def host_viewer(root):
    vm = LocalVm(root)
    viewer = DesktopViewer(vm)
    viewer.active_transport = lambda member, conversation: "host"
    viewer.host_browser = HostBrowser(root / "chrome")
    return viewer, viewer.host_browser


def fake_tab(browser, member, conversation):
    identifier = str(member)
    scope = ("turn", member, conversation)
    tab = Tab(identifier, identifier, "cdp-" + identifier, scope, member, browser.profile,
              conversation=conversation)
    tab.cast = Screencast(browser, tab)
    browser.tabs[identifier] = tab
    browser.select(tab)
    return tab


async def expect_eventually(predicate):
    async with asyncio.timeout(5):
        while not predicate():
            await asyncio.sleep(0.01)


async def test_a_renewed_panel_follows_the_active_transport_for_its_conversation(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    activity = {}
    viewer.active_transport = lambda member, conversation: activity.get((member, conversation))
    browser.cdp = Cdp(browser)
    fake_tab(browser, 1, 10)
    params = {"member_id": 1, "conversation_id": 10}
    try:
        assert (await viewer.status(params))["transport"] == "idle"
        activity[1, 10] = "host"
        opened = await viewer.open(params)
        assert (await viewer.status(params))["transport"] == "host"
        activity[1, 11] = "docker"
        assert (await viewer.renew(opened))["transport"] == "host"
        activity[1, 10] = "docker"
        async def missing():
            return False
        viewer.vm.installed = missing
        moved = await viewer.renew(opened)
        assert moved["transport"] == "docker" and moved["error"] == "docker_missing"
    finally:
        await viewer.aclose()


async def test_shutdown_aborts_open_host_stream_and_unparsed_connection(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    tab = fake_tab(browser, 1, 10)
    opened = await viewer.open({"member_id": 1, "conversation_id": 10})
    reader, writer = await asyncio.open_connection("127.0.0.1", int(viewer.origin.rsplit(":", 1)[1]))
    try:
        async with httpx.AsyncClient(trust_env=False, timeout=2) as client:
            async with client.stream("GET", opened["url"].replace("host.html", "host-frames")) as feed:
                lines = feed.aiter_lines()
                await anext(lines)
                assert tab.cast.watchers and viewer.sessions
                await asyncio.wait_for(viewer.aclose(), 2)
                assert not viewer.relay.thread.is_alive()
                assert await reader.read() == b""
                assert not tab.cast.watchers
                assert any(method == "Page.stopScreencast" for method, _, _ in cdp.calls)
    finally:
        writer.close()
        await writer.wait_closed()


async def test_close_kills_profile_children_even_after_the_leader_exits(tmp_path):
    browser = HostBrowser(tmp_path)
    children = {101, 102}
    closed = []

    class Job:
        def empty(self):
            return not children

        def terminate(self):
            children.clear()

        def close(self):
            closed.append(True)

    async def exited():
        return 0

    process = SimpleNamespace(wait=exited, pid=100, returncode=0)
    tree = ChromeProcessTree.__new__(ChromeProcessTree)
    tree.process, tree.job = process, Job()
    browser.process, browser.process_tree = process, tree
    await asyncio.wait_for(browser.aclose(), 3)
    assert not children and closed == [True]


async def test_host_viewer_streams_only_watched_member_tabs_and_acks_every_frame(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    one, two = fake_tab(browser, 1, 10), fake_tab(browser, 2, 20)
    try:
        assert (await viewer.status({"member_id": 1, "conversation_id": 11}))["state"] == "absent"
        with pytest.raises(RpcError, match="desktop unavailable"):
            await viewer.open({"member_id": 1, "conversation_id": 11})
        first = await viewer.open({"member_id": 1, "conversation_id": 10})
        second = await viewer.open({"member_id": 2, "conversation_id": 20})
        assert first["url"].endswith("/host.html")
        assert not cdp.calls
        cdp.frame(two.session)
        await expect_eventually(lambda: len(cdp.calls) == 1)
        assert cdp.calls == [("Page.screencastFrameAck", {"sessionId": 19}, two.session)]
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            assert (await client.get(first["url"])).status_code == 200
            assert (await client.get(first["url"].replace("host.html", "vnc.html"))).status_code == 403
            assert not one.cast.watchers
            async with client.stream("GET", first["url"].replace("host.html", "host-frames")) as feed:
                frame = json.loads(await anext(feed.aiter_lines()))
                assert base64.b64decode(frame["image"]).decode() == one.session
                assert not two.cast.watchers
                assert ("Page.screencastFrameAck", {"sessionId": 19}, one.session) in cdp.calls
            await expect_eventually(lambda: any(call[0] == "Page.stopScreencast" for call in cdp.calls))
            assert not one.cast.watchers and one.cast.latest is None
            async with client.stream("GET", second["url"].replace("host.html", "host-frames")) as feed:
                lines = feed.aiter_lines()
                assert base64.b64decode(json.loads(await anext(lines))["image"]).decode() == two.session
                browser._event("Target.targetDestroyed", {"targetId": two.target}, None)
                assert await anext(lines, None) is None
            assert one.id in browser.tabs
    finally:
        await viewer.aclose()


async def test_host_viewer_gate_and_handback_use_the_same_tab(tmp_path):
    viewer, browser = host_viewer(tmp_path)
    cdp = browser.cdp = Cdp(browser)
    tab = fake_tab(browser, 1, 10)
    card = SimpleNamespace(id="request", turn_id=23, reason="sign_in")
    finished = []

    def finish(value):
        assert not browser.held and value is card
        finished.append(value)

    viewer.handbacks = SimpleNamespace(
        browser_request=lambda member, conversation: (tab, card) if (member, conversation) == (1, 10) and not finished else (None, None),
        finish=finish,
    )
    try:
        params = {"member_id": 1, "conversation_id": 10}
        assert (await viewer.status(params))["host_request"]["request_id"] == card.id
        with pytest.raises(RpcError, match="desktop unavailable"):
            await viewer.open({**params, "preview": True})
        opened = await viewer.open(params)
        owner = {"session": opened["session"], "takeover": card.id}
        url = opened["url"].replace("host.html", "host-input")
        async with httpx.AsyncClient(trust_env=False, timeout=5) as client:
            async with client.stream("GET", opened["url"].replace("host.html", "host-frames")) as feed:
                lines = feed.aiter_lines()
                await anext(lines)
                text = {"type": "text", "text": "Sample"}
                assert (await client.post(url, json=text, headers={"Origin": viewer.origin})).status_code == 403
                assert (await viewer.control({**owner, "held": True}))["control"] == "owner"
                assert browser.held == {tab.scope}
                assert (await client.post(url, json=text, headers={"Origin": "http://example.invalid"})).status_code == 403
                events = [
                    {"type": "mousePressed", "x": 20, "y": 30, "button": "left", "buttons": 1, "count": 1},
                    {"type": "keyDown", "key": "Tab", "code": "Tab", "virtual": 9},
                    text,
                ]
                for event in events:
                    assert (await client.post(url, json=event, headers={"Origin": viewer.origin})).status_code == 204
                assert [call[0] for call in cdp.calls if call[0].startswith("Input.")] == [
                    "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText"]
                assert all(call[2] == tab.session for call in cdp.calls)
                with pytest.raises(RpcError, match="desktop request changed"):
                    await viewer.control({**owner, "held": False, "takeover": "old"})
                returned = await viewer.control({**owner, "held": False})
                assert returned["control"] == "member" and "host_request" not in returned
                assert finished == [card]
                assert [call[1]["type"] for call in cdp.calls if call[0].startswith("Input.dispatch")][-2:] == [
                    "keyUp", "mouseReleased"]
                assert (await client.post(url, json=text, headers={"Origin": viewer.origin})).status_code == 403
                with pytest.raises(RpcError, match="desktop request changed"):
                    await viewer.control({**owner, "held": False})
    finally:
        await viewer.aclose()


@pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")), reason="Google Chrome is unavailable or this is CI")
async def test_native_headless_chrome_frames_and_owner_input(tmp_path):
    viewer, browser = host_viewer(tmp_path.resolve())
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    async with site:
        try:
            await browser.start()
            one = await browser.new_tab(("turn", 1, 10), 1, tmp_path, 10)
            two = await browser.new_tab(("task", 2), 2, tmp_path)
            url = f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}"
            for tab in (one, two):
                assert await host_page.navigate(browser, tab, url)
            first = await viewer.open({"member_id": 1, "conversation_id": 10})
            second = await viewer.open({"member_id": 2})
            async with httpx.AsyncClient(trust_env=False, timeout=10) as client:
                async with client.stream("GET", first["url"].replace("host.html", "host-frames")) as left:
                    async with client.stream("GET", second["url"].replace("host.html", "host-frames")) as right:
                        lines = [left.aiter_lines(), right.aiter_lines()]
                        for stream in lines:
                            frame = json.loads(await anext(stream))
                            assert base64.b64decode(frame["image"]).startswith(b"\xff\xd8")
                        position = await browser.command(one, "Runtime.evaluate", {"expression":
                            "JSON.stringify(document.querySelector('#name').getBoundingClientRect())", "returnByValue": True})
                        rect = json.loads(position["result"]["value"])
                        events = [
                            {"type": kind, "x": rect["x"] + 10, "y": rect["y"] + 5, "button": "left",
                             "buttons": buttons, "count": 1}
                            for kind, buttons in (("mousePressed", 1), ("mouseReleased", 0))
                        ] + [{"type": "text", "text": "Owner typed in the viewer"}]
                        endpoint = first["url"].replace("host.html", "host-input")
                        headers = {"Origin": viewer.origin}
                        assert (await client.post(endpoint, json=events[-1], headers=headers)).status_code == 403
                        await viewer.control({"session": first["session"], "held": True})
                        for event in events:
                            assert (await client.post(endpoint, json=event, headers=headers)).status_code == 204
                        for tab, expected in ((one, events[-1]["text"]), (two, "")):
                            result = await browser.command(tab, "Runtime.evaluate", {
                                "expression": "document.querySelector('#name').value", "returnByValue": True})
                            assert result["result"]["value"] == expected
        finally:
            try:
                await viewer.aclose()
            finally:
                await browser.aclose()
                await asyncio.sleep(0.1)  # Chrome's connections to the test site end; their transports close
