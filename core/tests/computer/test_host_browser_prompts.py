"""What a Chrome no one sees cannot ask: a permission prompt, a passkey sheet, the site's own sign-in prompt (HTTP
authentication) and a file chooser. Headless on a Mac (#308), on a desktop of its own on Windows, each was left waiting
for an answer nobody could give. A permission and a passkey are now answered at once, a sign-in prompt by the owner in
the view, and a file chooser by the member's browser_upload or the owner's own files."""

import asyncio
import base64
import contextlib
import os
import sys

import pytest

from raphael_core.agent.policy import Tier
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import host_browser, host_page
from raphael_core.computer.host_browser import BrowserError, HostBrowser, Tab, chrome_executable, headless_chrome, mac_screen
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN

NATIVE = pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")),
                            reason="Google Chrome is unavailable or this is CI")


class Recorder:
    """A CDP connection that answers every command and remembers it."""

    def __init__(self):
        self.calls = []
        self.reader = asyncio.get_running_loop().create_future()

    async def call(self, method, params=None, *, session=None):
        self.calls.append((method, params, session))
        if method == "Target.attachToTarget":
            return {"sessionId": "session"}
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "frame", "url": "about:blank"}}}
        return {}


def prompt_tab(tmp_path, browser=None):
    browser = browser or HostBrowser(tmp_path / "profile")
    browser.cdp = Recorder()
    tab = Tab("tab", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    return browser, tab


async def settled(browser):
    await asyncio.sleep(0)
    await asyncio.gather(*browser.background)


def challenge(request, source="Server"):
    return {"requestId": request, "authChallenge": {"origin": "https://intranet.example.test", "realm": "Staff",
                                                    "scheme": "Basic", "source": source}}


def cancel(request):
    return "Fetch.continueWithAuth", {"requestId": request, "authChallengeResponse": {"response": "CancelAuth"}}, "session"


async def test_every_tab_hands_over_its_file_chooser_and_sign_in_prompt_and_holds_no_passkey(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    browser.cdp = cdp = Recorder()
    browser.owned_targets["target"] = 1
    tab = await browser._attach_tab("target", 1, tmp_path, 10)
    try:
        sent = {method: params for method, params, session in cdp.calls if session == "session"}
        assert sent["Page.setInterceptFileChooserDialog"] == {"enabled": True}
        assert sent["Fetch.enable"] == {"patterns": [{"urlPattern": "*", "resourceType": "Document",
                                                      "requestStage": "Request"}], "handleAuthRequests": True}
        assert sent["WebAuthn.enable"] == {"enableUI": False}
        options = sent["WebAuthn.addVirtualAuthenticator"]["options"]
        # It holds no passkey and verifies no one, so each request ends at once instead of waiting for a sheet.
        assert (options["transport"], options["isUserVerified"], options["automaticPresenceSimulation"]) == (
            "internal", False, True)
        assert tab.ready
    finally:
        browser._forget_tab(tab)


async def test_a_permission_a_page_asks_for_is_settled_before_any_page_runs():
    granted = {permission["name"] for permission, setting in host_browser.PERMISSIONS if setting == "granted"}
    denied = {permission["name"] for permission, setting in host_browser.PERMISSIONS if setting == "denied"}
    assert {"notifications", "geolocation", "camera", "microphone", "clipboard-read", "display-capture"} <= denied
    assert "storage-access" in granted and not granted & denied
    # The clipboard is the owner's own on Windows: a page never gets to write it unasked.
    assert "clipboard-write" not in granted | denied


async def test_a_paused_document_request_goes_on_at_once_unchanged(tmp_path):
    browser, tab = prompt_tab(tmp_path)
    browser._event("Fetch.requestPaused", {"requestId": "r1", "request": {"url": "https://example.test/"}}, "session")
    await settled(browser)
    assert browser.cdp.calls == [("Fetch.continueRequest", {"requestId": "r1"}, "session")]


async def test_a_sites_sign_in_prompt_waits_for_the_owner_and_a_proxys_is_refused(tmp_path):
    browser, tab = prompt_tab(tmp_path)
    try:
        browser._event("Fetch.authRequired", challenge("proxy", "Proxy"), "session")
        await settled(browser)
        assert tab.auth is None and browser.cdp.calls[-1] == cancel("proxy")
        browser._event("Fetch.authRequired", challenge("first"), "session")
        first = tab.auth
        assert (first["origin"], first["realm"], first["scheme"]) == ("https://intranet.example.test", "Staff", "basic")
        assert tab.auth_opened.is_set()
        # A newer prompt replaces it, and the older one is cancelled.
        browser._event("Fetch.authRequired", challenge("second"), "session")
        await settled(browser)
        assert cancel("first") in browser.cdp.calls
        second = tab.auth
        assert second["auth_id"] != first["auth_id"]
        await browser.answer_auth(tab, second, ("staff", "s3cret"))
        assert browser.cdp.calls[-1] == ("Fetch.continueWithAuth", {"requestId": "second", "authChallengeResponse": {
            "response": "ProvideCredentials", "username": "staff", "password": "s3cret"}}, "session")
        assert tab.auth is None and not tab.auth_opened.is_set() and tab.auth_timer is None
        # One left by a navigation Chrome abandoned for another goes with the next document.
        browser._event("Fetch.authRequired", challenge("third"), "session")
        browser._event("Page.frameNavigated", {"frame": {"id": "frame", "url": "https://example.test/"}}, "session")
        assert tab.auth is None and tab.auth_timer is None
    finally:
        browser._forget_tab(tab)


async def test_an_unanswered_sign_in_prompt_is_cancelled_so_the_site_refuses_instead(tmp_path, monkeypatch):
    monkeypatch.setattr(host_browser, "AUTH_WAIT_S", 0.01)
    browser, tab = prompt_tab(tmp_path)
    browser._event("Fetch.authRequired", challenge("waiting"), "session")
    await asyncio.wait_for(tab.auth_timer, 2)
    assert tab.auth is None and browser.cdp.calls[-1] == cancel("waiting")


async def test_a_navigation_that_meets_a_sign_in_prompt_reports_it_at_once(tmp_path):
    browser, tab = prompt_tab(tmp_path)

    async def navigation():
        browser._event("Fetch.authRequired", challenge("r"), "session")
        await asyncio.sleep(30)
        return {}, []

    async def read():
        return {"tab_id": tab.id}, []

    try:
        data, blocks = await asyncio.wait_for(HostComputerTools.guarded(tab, navigation), 5)
        assert data["status"] == "sign_in_prompt" and data["sign_in_prompt"] == tab.auth and blocks == []
        assert "request_takeover" in data["note"] and "sign_in" in data["note"]
        # The page shown before stays usable while the prompt waits, and each result names the prompt.
        data, _ = await HostComputerTools.guarded(tab, read)
        assert data == {"tab_id": tab.id, "sign_in_prompt": tab.auth}
        browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectMultiple", "backendNodeId": 7},
                       "session")
        data, _ = await HostComputerTools.guarded(tab, read)
        assert data["file_chooser"] == {"chooser_id": tab.chooser["chooser_id"], "mode": "multiple"}
        assert tab.chooser_node == 7
    finally:
        browser._forget_tab(tab)


async def test_going_elsewhere_cancels_the_sign_in_prompt_the_page_left(tmp_path, monkeypatch):
    browser, tab = prompt_tab(tmp_path)
    browser._event("Fetch.authRequired", challenge("left"), "session")

    async def page_work(browser, tab, name, arguments, approver):
        return {"tab_id": tab.id}, []

    monkeypatch.setattr(HostComputerTools, "page_work", staticmethod(page_work))
    data, _ = await HostComputerTools.page_call(browser, tab, "browser_navigate", {"url": "https://example.test/"}, "user")
    assert data == {"tab_id": tab.id} and tab.auth is None and cancel("left") in browser.cdp.calls


async def test_browser_upload_gives_the_chooser_work_files_only(tmp_path, conn):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    assert tools.base_tier("browser_upload") == Tier.T2 and "browser_upload" in tools.definitions
    workspace = tools.folders(1)[0]
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "report.pdf").write_bytes(b"%PDF")
    (workspace / "notes.txt").write_text("notes")
    (workspace / ".raphael-recovery").mkdir()
    (workspace / ".raphael-recovery" / "old.txt").write_text("private")
    outside = tmp_path / "outside.txt"
    outside.write_text("not the member's")
    browser, tab = prompt_tab(workspace, tools.browser)
    browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 7}, "session")
    chooser = tab.chooser

    async def upload(*paths, chooser_id=chooser["chooser_id"], approver="user"):
        return await tools.upload(1, browser, tab, {"chooser_id": chooser_id, "paths": list(paths)}, approver)

    # Files leave for the site: only the owner's yes for this very upload lets them go, as for an outward click.
    with pytest.raises(BrowserError, match="browser_owner_approval_required"):
        await upload("report.pdf", approver="auto")

    with pytest.raises(BrowserError, match="browser_chooser_changed"):
        await upload("report.pdf", chooser_id="old")
    with pytest.raises(BrowserError, match="browser_upload_count"):
        await upload("report.pdf", "notes.txt")
    for path in (str(outside), "../../outside.txt", "missing.pdf", ".", ".raphael-recovery/old.txt", "~/.ssh/id_rsa"):
        with pytest.raises(BrowserError, match="browser_upload_path"):
            await upload(path)
    if os.name != "nt":
        (workspace / "link.txt").symlink_to(outside)
        with pytest.raises(BrowserError, match="browser_upload_path"):
            await upload("link.txt")
    assert browser.cdp.calls == []
    result = await upload("report.pdf")
    assert (result["status"], result["files"]) == ("files_chosen", ["report.pdf"])
    assert browser.cdp.calls == [("DOM.setFileInputFiles", {"files": [str((workspace / "report.pdf").resolve())],
                                                            "backendNodeId": 7}, "session")]
    assert tab.chooser is None
    with pytest.raises(BrowserError, match="browser_chooser_changed"):
        await upload("report.pdf")


async def test_a_file_the_owner_chose_keeps_its_name_in_the_private_profile(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    stored = tmp_path / "store" / "a1b2c3"
    stored.parent.mkdir()
    stored.write_bytes(b"invoice")
    placed = browser.owner_upload(stored, "Invoice 11.pdf")
    assert placed.name == "Invoice 11.pdf" and placed.read_bytes() == b"invoice"
    assert placed.is_relative_to(browser.profile / "uploads")


PAGE = b"""<title>Prompts</title>
<input type="file" id="file" onchange="document.body.dataset.chosen = [...this.files].map(f => f.name + ':' + f.size).join()">
<button id="pick" onclick="document.getElementById('file').click()">Choose a file</button>"""


async def serve(reader, writer):
    try:
        with contextlib.suppress(asyncio.IncompleteReadError, ConnectionError):
            head = (await reader.readuntil(b"\r\n\r\n")).decode("latin-1")
            if head.split(" ", 2)[1].startswith("/staff"):
                if "Authorization: Basic " + base64.b64encode(b"staff:s3cret").decode() in head:
                    status, extra, body = "200 OK", "", b"<title>Staff area</title>Signed in"
                else:
                    status, extra, body = "401 Unauthorized", 'WWW-Authenticate: Basic realm="Staff"\r\n', b"Refused"
            else:
                status, extra, body = "200 OK", "", PAGE
            writer.write(f"HTTP/1.1 {status}\r\nConnection: close\r\nContent-Type: text/html\r\n{extra}"
                         f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
            await writer.drain()
    finally:
        writer.close()


@contextlib.asynccontextmanager
async def prompt_page(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    try:
        tab, _ = await browser.open_tab(1, tmp_path, 10)
        # A name, not an address: a passkey's relying party must be a domain.
        base = f"http://localhost:{site.sockets[0].getsockname()[1]}"
        assert await host_page.navigate(browser, tab, base + "/")
        yield browser, tab, base
    finally:
        await browser.aclose()
        site.close()


async def page_value(browser, tab, expression, *, await_promise=False):
    return (await host_page.evaluate(browser, tab, expression, await_promise=await_promise))[0]


@NATIVE
async def test_native_chrome_refuses_permission_prompts_and_ends_passkey_requests_at_once(tmp_path):
    async with prompt_page(tmp_path) as (browser, tab, base):
        states = await page_value(browser, tab, "Promise.all(['geolocation', 'notifications', 'camera', 'microphone']"
                                                ".map(name => navigator.permissions.query({name}).then(r => r.state)))",
                                  await_promise=True)
        assert states == ["denied"] * 4
        loop = asyncio.get_running_loop()
        started = loop.time()
        request = ("navigator.credentials.get({publicKey: {challenge: new Uint8Array(16), timeout: 60000, "
                   "userVerification: 'required'}}).then(() => 'signed in', error => error.name)")
        assert await page_value(browser, tab, request, await_promise=True) == "NotAllowedError"
        created = ("navigator.credentials.create({publicKey: {challenge: new Uint8Array(16), rp: {name: 'Site'}, "
                   "user: {id: new Uint8Array(8), name: 'staff', displayName: 'Staff'}, pubKeyCredParams: "
                   "[{type: 'public-key', alg: -7}], timeout: 60000}}).then(() => 'made', error => error.name)")
        assert await page_value(browser, tab, created, await_promise=True) == "NotAllowedError"
        assert loop.time() - started < 10


@NATIVE
async def test_native_chrome_hands_the_sites_sign_in_prompt_to_the_owner(tmp_path):
    async with prompt_page(tmp_path) as (browser, tab, base):
        data, _ = await asyncio.wait_for(HostComputerTools.page_call(
            browser, tab, "browser_navigate", {"url": base + "/staff"}, "user"), 15)
        assert data["status"] == "sign_in_prompt" and data["sign_in_prompt"]["realm"] == "Staff"
        # A wrong answer: the site asks again.
        first = tab.auth
        await browser.answer_auth(tab, first, ("staff", "wrong"))
        async with asyncio.timeout(10):
            while tab.auth is None or tab.auth is first:
                await asyncio.sleep(0.05)
        await browser.answer_auth(tab, tab.auth, ("staff", "s3cret"))
        async with asyncio.timeout(10):
            while not tab.url.endswith("/staff"):
                await asyncio.sleep(0.05)
        assert tab.auth is None and await page_value(browser, tab, "document.title") == "Staff area"


@NATIVE
async def test_native_chrome_hands_over_its_file_chooser(tmp_path):
    async with prompt_page(tmp_path) as (browser, tab, base):
        state, _ = await HostComputerTools.page_call(browser, tab, "get_browser_state", {}, "user")
        pick = next(row["ref"] for row in state["refs"] if row["name"] == "Choose a file")
        data, _ = await HostComputerTools.page_call(browser, tab, "browser_click", {"ref": pick}, "user")
        async with asyncio.timeout(5):
            while tab.chooser is None:
                await asyncio.sleep(0.05)
        assert tab.chooser["mode"] == "single"
        chosen = tmp_path / "report.txt"
        chosen.write_text("twelve bytes")
        await browser.choose_files(tab, tab.chooser, [chosen])
        async with asyncio.timeout(5):
            while not await page_value(browser, tab, "document.body.dataset.chosen || ''"):
                await asyncio.sleep(0.05)
        assert await page_value(browser, tab, "document.body.dataset.chosen") == "report.txt:12"
        assert tab.chooser is None


@NATIVE
@pytest.mark.skipif(sys.platform != "darwin" or not headless_chrome(), reason="the screen is headless Chrome's on a Mac")
async def test_native_headless_chrome_reports_the_macs_own_screen(tmp_path):
    async with prompt_page(tmp_path) as (browser, tab, base):
        width, height = mac_screen()
        sizes = await page_value(browser, tab, "[screen.width, screen.height, outerWidth, outerHeight]")
        assert sizes == [width, height, 1280, 900]
