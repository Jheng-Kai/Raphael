"""What a Chrome no one sees cannot ask: a permission prompt, a passkey sheet, the site's own sign-in prompt (HTTP
authentication) and a file chooser. Headless on a Mac (#308), on a desktop of its own on Windows, each was left waiting
for an answer nobody could give. A permission and a passkey are now answered at once, a sign-in prompt by the owner in
the view, and a file chooser by the member's browser_upload or the owner's own files."""

import asyncio
import base64
import contextlib
import os
import sys
from pathlib import Path

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
    # Chrome gets a copy in the private profile, read through the file opened in the work folder.
    [(method, params, session)] = browser.cdp.calls
    copy = Path(params["files"][0])
    assert (method, params["backendNodeId"], session) == ("DOM.setFileInputFiles", 7, "session")
    assert copy.name == "report.pdf" and copy.read_bytes() == b"%PDF" and copy.is_relative_to(browser.profile / "uploads")
    assert tab.chooser is None
    with pytest.raises(BrowserError, match="browser_chooser_changed"):
        await upload("report.pdf")


@pytest.mark.skipif(os.name == "nt", reason="links need privileges on Windows; its open handle's final path is the same check")
async def test_browser_upload_never_sends_a_file_swapped_for_a_link_after_its_checks(tmp_path, conn):
    """The member's own commands can change its work folder while browser_upload runs: a file, or a folder on its path,
    swapped for a link to a private file once the checks passed must not reach the site (Codex review of #348)."""
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    workspace = tools.folders(1)[0]
    (workspace / "docs").mkdir(parents=True)
    secret = tmp_path / "keys"
    secret.mkdir()
    (secret / "report.pdf").write_text("a private key")
    browser, tab = prompt_tab(workspace, tools.browser)
    staged = browser.member_upload

    def swapped(swap):
        async def member_upload(path, allowed, limit):
            swap()
            return await staged(path, allowed, limit)
        return member_upload

    def file_to_link():
        (workspace / "report.pdf").unlink()
        (workspace / "report.pdf").symlink_to(secret / "report.pdf")

    def folder_to_link():
        (workspace / "docs" / "report.pdf").unlink()
        (workspace / "docs").rmdir()
        (workspace / "docs").symlink_to(secret)

    # A folder above the work folder itself: its whole path leads into another copy of the same names.
    other = tmp_path / "other"
    (other / workspace.relative_to(tmp_path) / "docs").mkdir(parents=True)
    (other / workspace.relative_to(tmp_path) / "docs" / "report.pdf").write_text("a private key")
    above = tmp_path / workspace.relative_to(tmp_path).parts[0]

    def above_to_link():
        above.rename(tmp_path / "moved")
        above.symlink_to(other / above.name)

    for name, swap in (("report.pdf", file_to_link), ("docs/report.pdf", folder_to_link), ("docs/report.pdf", above_to_link)):
        if swap is above_to_link:
            (workspace / "docs").unlink()
            (workspace / "docs").mkdir()
        (workspace / name).write_text("the member's report")
        browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 7}, "session")
        browser.member_upload = swapped(swap)
        with pytest.raises(BrowserError, match="browser_upload_path"):
            await tools.upload(1, browser, tab, {"chooser_id": tab.chooser["chooser_id"], "paths": [name]}, "user")
    assert browser.cdp.calls == [] and not (browser.profile / "uploads").exists()


@pytest.mark.skipif(os.name == "nt", reason="links need privileges on Windows")
async def test_an_upload_that_fails_keeps_none_of_its_copies(tmp_path, conn):
    """Copies are made one by one before Chrome gets them: a later file refused, or a chooser the page replaced while they
    were made, leaves none behind in the private profile (Codex review of #348)."""
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    workspace = tools.folders(1)[0]
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "a.pdf").write_text("a")
    (workspace / "b.pdf").write_text("b")
    (tmp_path / "private.txt").write_text("private")
    browser, tab = prompt_tab(workspace, tools.browser)
    staged = browser.member_upload

    async def then(path, allowed, limit, after):
        copy = await staged(path, allowed, limit)
        after()
        return copy

    def swap_b():
        (workspace / "b.pdf").unlink()
        (workspace / "b.pdf").symlink_to(tmp_path / "private.txt")

    def replace_chooser():
        browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectMultiple", "backendNodeId": 8}, "session")

    for after, error in ((swap_b, "browser_upload_path"), (replace_chooser, "browser_chooser_changed")):
        (workspace / "b.pdf").unlink()
        (workspace / "b.pdf").write_text("b")
        browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectMultiple", "backendNodeId": 7}, "session")
        chooser_id = tab.chooser["chooser_id"]
        browser.member_upload = lambda path, allowed, limit, after=after: then(path, allowed, limit, after)
        with pytest.raises(BrowserError, match=error):
            await tools.upload(1, browser, tab, {"chooser_id": chooser_id, "paths": ["a.pdf", "b.pdf"]}, "user")
        assert list((browser.profile / "uploads").iterdir()) == []
    assert browser.cdp.calls == []


async def test_a_copy_whose_upload_was_stopped_meanwhile_is_removed_once_made(tmp_path, conn, monkeypatch):
    """A copy is made in a thread, which a stopped upload (the member's turn stopped, a timeout) cannot stop: once made it
    is removed, so no copy stays that Chrome never gets (Codex review of #348)."""
    import threading
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    workspace = tools.folders(1)[0]
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "a.pdf").write_text("a")
    browser, tab = prompt_tab(workspace, tools.browser)
    browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 7}, "session")
    started, release = threading.Event(), threading.Event()
    copy = browser._copy_upload

    def slow(*args):
        made = copy(*args)  # made whole, and the upload is stopped before it is handed back
        started.set()
        release.wait(5)
        return made

    monkeypatch.setattr(browser, "_copy_upload", slow)
    upload = asyncio.ensure_future(tools.upload(1, browser, tab, {"chooser_id": tab.chooser["chooser_id"], "paths": ["a.pdf"]},
                                                "user"))
    await asyncio.to_thread(started.wait, 5)
    upload.cancel()
    with pytest.raises(asyncio.CancelledError):
        await upload
    release.set()
    for _ in range(200):
        await asyncio.sleep(0.01)
        if (browser.profile / "uploads").exists() and not list((browser.profile / "uploads").iterdir()):
            break
    assert list((browser.profile / "uploads").iterdir()) == [] and browser.cdp.calls == []


@pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="folder modes; root crosses any folder")
async def test_a_folder_the_owner_may_cross_but_not_list_still_uploads_its_files(tmp_path, conn):
    """A folder on the way that may be crossed but not listed (mode 0111) lets the path be read, so the file opened through
    it uploads too (Codex review of #348)."""
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    workspace = tools.folders(1)[0]
    (workspace / "docs").mkdir(parents=True)
    (workspace / "docs" / "report.pdf").write_text("report")
    browser, tab = prompt_tab(workspace, tools.browser)
    (browser.profile / "uploads").mkdir(parents=True, exist_ok=True)
    browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 7}, "session")
    os.chmod(workspace, 0o111)
    try:
        result = await tools.upload(1, browser, tab, {"chooser_id": tab.chooser["chooser_id"], "paths": ["docs/report.pdf"]},
                                    "user")
    finally:
        os.chmod(workspace, 0o755)
    assert result["files"] == ["report.pdf"]
    [(_, params, _)] = browser.cdp.calls
    assert Path(params["files"][0]).read_text() == "report"


def test_a_copy_still_being_made_when_the_core_shuts_down_is_removed_once_made(tmp_path):
    """Shutting down cancels every task, the copy's own too, while its thread goes on: the thread removes what it made."""
    import threading
    started, release = threading.Event(), threading.Event()

    def make():
        started.set()
        release.wait(5)
        folder = tmp_path / "uploads" / "a1"
        folder.mkdir(parents=True)
        (folder / "a.pdf").write_text("a")
        return folder / "a.pdf"

    async def main():
        asyncio.ensure_future(host_browser.made_off_loop(make))
        await asyncio.to_thread(started.wait, 5)
        threading.Timer(0.1, release.set).start()

    asyncio.run(main())
    assert release.is_set() and list((tmp_path / "uploads").iterdir()) == []


async def test_a_copy_made_just_before_the_core_shuts_down_is_removed_too(tmp_path):
    """The thread may finish just as shutting down cancels every task, before its result comes back: the copy is removed
    all the same (Codex review of #348)."""
    import threading
    import time
    started, go = threading.Event(), threading.Event()

    def make():
        started.set()
        go.wait(5)
        folder = tmp_path / "uploads" / "a1"
        folder.mkdir(parents=True)
        (folder / "a.pdf").write_text("a")
        return folder / "a.pdf"

    copy = asyncio.ensure_future(host_browser.made_off_loop(make))
    await asyncio.to_thread(started.wait, 5)
    go.set()
    time.sleep(0.2)  # the thread finishes while the loop is held: its result is not back yet
    me = asyncio.current_task()
    for task in asyncio.all_tasks():
        if task is not me:
            task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await copy
    await asyncio.sleep(0.05)
    assert list((tmp_path / "uploads").iterdir()) == []


async def test_copies_chrome_was_given_stay_for_the_page_even_when_the_answer_is_lost(tmp_path, conn):
    """Once the files are handed to Chrome, the page may send them later whatever became of Chrome's answer: a failed or
    stopped call after that point keeps them (until Chrome starts again)."""
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    workspace = tools.folders(1)[0]
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "a.pdf").write_text("a")
    browser, tab = prompt_tab(workspace, tools.browser)
    browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 7}, "session")
    recorder = browser.cdp

    async def lost(method, params=None, *, session=None):
        recorder.calls.append((method, params, session))
        raise BrowserError("chrome_command_failed")

    recorder.call = lost
    with pytest.raises(BrowserError, match="chrome_command_failed"):
        await tools.upload(1, browser, tab, {"chooser_id": tab.chooser["chooser_id"], "paths": ["a.pdf"]}, "user")
    [(_, params, _)] = recorder.calls
    assert Path(params["files"][0]).read_text() == "a"


@pytest.mark.skipif(sys.platform != "darwin" or not os.path.isdir("/System/Volumes/Data/private"),
                    reason="a Mac's data volume spells every folder a second way")
async def test_a_work_folder_spelled_through_the_macs_data_volume_still_uploads(tmp_path, conn):
    """A Mac reaches one folder as /private/var/… and as /System/Volumes/Data/private/var/…; a work folder kept the second
    way is the member's all the same, and its files upload (Codex review of #348)."""
    root = Path("/System/Volumes/Data") / tmp_path.resolve().relative_to("/")
    tools = HostComputerTools(LocalVm(root, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    workspace = tools.folders(1)[0]
    (workspace / "docs").mkdir(parents=True)
    (workspace / "docs" / "report.pdf").write_text("report")
    browser, tab = prompt_tab(workspace, tools.browser)
    browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 7}, "session")
    result = await tools.upload(1, browser, tab, {"chooser_id": tab.chooser["chooser_id"], "paths": ["docs/report.pdf"]},
                                "user")
    assert result["files"] == ["report.pdf"]
    [(_, params, _)] = browser.cdp.calls
    assert Path(params["files"][0]).read_text() == "report"


async def test_files_made_ready_for_a_chooser_since_replaced_go_to_none(tmp_path):
    """The owner's files are stored and copied before they are given: a chooser the page opened meanwhile, or one gone,
    gets none of them, and its own element is never given another chooser's files (Codex review of #348)."""
    browser, tab = prompt_tab(tmp_path)
    browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 7}, "session")
    first = tab.chooser
    browser._event("Page.fileChooserOpened", {"frameId": "frame", "mode": "selectSingle", "backendNodeId": 8}, "session")
    with pytest.raises(BrowserError, match="browser_chooser_changed"):
        await browser.choose_files(tab, first, [tmp_path / "a.txt"])
    assert browser.cdp.calls == [] and tab.chooser is not None and tab.chooser_node == 8
    second, tab.chooser = tab.chooser, None
    with pytest.raises(BrowserError, match="browser_chooser_changed"):
        await browser.choose_files(tab, second, [tmp_path / "a.txt"])
    assert browser.cdp.calls == []


async def test_a_file_the_owner_chose_keeps_its_name_in_the_private_profile(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    stored = tmp_path / "store" / "a1b2c3"
    stored.parent.mkdir()
    stored.write_bytes(b"invoice")
    placed = browser.owner_upload(stored, "Invoice 11.pdf")
    assert placed.name == "Invoice 11.pdf" and placed.read_bytes() == b"invoice"
    assert placed.is_relative_to(browser.profile / "uploads")


async def test_an_owner_copy_that_fails_partway_leaves_nothing(tmp_path, monkeypatch):
    """Not hard-linked (another disk), the owner's file is copied, and a disk full partway leaves no half file behind."""
    browser = HostBrowser(tmp_path / "profile")
    stored = tmp_path / "store" / "a1b2c3"
    stored.parent.mkdir()
    stored.write_bytes(b"invoice")

    def full(source, target):
        Path(target).write_bytes(b"inv")
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(host_browser.os, "link", lambda *args: (_ for _ in ()).throw(OSError(18, "cross-device")))
    monkeypatch.setattr(host_browser.shutil, "copyfile", full)
    with pytest.raises(OSError):
        browser.owner_upload(stored, "Invoice 11.pdf")
    assert list((browser.profile / "uploads").iterdir()) == []


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
