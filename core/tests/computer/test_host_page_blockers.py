"""What blocked a member on Raphael Chrome in the owner's Mac test of the headless Chrome (#308): a JavaScript dialog
that held the page (#336), an HTML select a ref could not choose (#329), and a download placed at the root of the
owner's project (#331)."""

import asyncio
import contextlib
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from raphael_core.computer import host_browser, host_page
from raphael_core.computer.host_browser import BrowserError, HostBrowser, Tab, chrome_executable
from raphael_core.computer.host_computer import HostComputerTools

NATIVE = pytest.mark.skipif(chrome_executable() is None or bool(os.environ.get("CI")),
                            reason="Google Chrome is unavailable or this is CI")


def dialog_tab(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    tab = Tab("tab", "target", "session", 1, tmp_path)
    browser.tabs[tab.id] = tab
    return browser, tab


def open_dialog(browser, kind="alert", message="Saved", **extra):
    browser._event("Page.javascriptDialogOpening", {"type": kind, "message": message, **extra}, "session")


async def test_a_dialog_that_opens_during_a_call_ends_the_wait_at_once(tmp_path):
    # Chrome answers no command of a page while its dialog is open: the call reports the dialog instead of timing out.
    browser, tab = dialog_tab(tmp_path)
    held = asyncio.get_running_loop().create_future()

    async def call(method, params=None, *, session=None):
        assert session == "session"
        return await held

    browser.cdp = SimpleNamespace(call=call)
    work = asyncio.create_task(HostComputerTools.page_call(browser, tab, "get_browser_state", {}, "user"))
    await asyncio.sleep(0.05)
    assert not work.done()
    open_dialog(browser, "confirm", "Delete the draft?")
    async with asyncio.timeout(1):
        data, blocks = await work
    assert data["status"] == "dialog_open" and blocks == []
    assert data["dialog"]["type"] == "confirm" and data["dialog"]["message"] == "Delete the draft?"
    assert "browser_dialog" in data["note"]
    # Every later page tool says the same without sending Chrome anything, until the dialog is answered.
    again, _ = await HostComputerTools.page_call(browser, tab, "click", {"x": 10, "y": 10}, "user")
    assert again["status"] == "dialog_open" and again["dialog"] == data["dialog"]
    held.cancel()


async def test_browser_dialog_answers_only_the_reported_dialog(tmp_path):
    browser, tab = dialog_tab(tmp_path)
    sent = []

    async def call(method, params=None, *, session=None):
        sent.append((method, params))
        return {}

    browser.cdp = SimpleNamespace(call=call)
    assert (await host_page.dialog_action(browser, tab, {"action": "inspect"}, "user"))["dialog"] is None
    assert (await host_page.dialog_action(browser, tab, {"action": "accept"}, "user"))["status"] == "no_dialog"
    open_dialog(browser, "prompt", "Name the copy", defaultPrompt="Draft")
    dialog = (await host_page.dialog_action(browser, tab, {"action": "inspect"}, "user"))["dialog"]
    assert dialog["default_prompt"] == "Draft"
    with pytest.raises(BrowserError, match="browser_dialog_changed"):
        await host_page.dialog_action(browser, tab, {"action": "accept", "dialog_id": "old"}, "user")
    result = await host_page.dialog_action(
        browser, tab, {"action": "accept", "dialog_id": dialog["dialog_id"], "prompt_text": "Copy 2"}, "user")
    assert result["status"] == "dialog_accepted" and tab.dialog is None and not tab.dialog_opened.is_set()
    assert sent == [("Page.handleJavaScriptDialog", {"accept": True, "promptText": "Copy 2"})]
    browser._event("Page.javascriptDialogClosed", {"result": True}, "session")
    open_dialog(browser, "confirm", "Leave the page?")
    with pytest.raises(BrowserError, match="browser_dialog_text"):
        await host_page.dialog_action(
            browser, tab, {"action": "accept", "dialog_id": tab.dialog["dialog_id"], "prompt_text": "yes"}, "user")
    result = await host_page.dialog_action(browser, tab, {"action": "dismiss", "dialog_id": tab.dialog["dialog_id"]}, "user")
    assert result["status"] == "dialog_dismissed" and sent[-1] == ("Page.handleJavaScriptDialog", {"accept": False})


@pytest.mark.parametrize(("kind", "message", "text"), [
    ("prompt", "Enter your password to continue", "hunter2"), ("confirm", "Pay $40 now?", None),
    # Past the 2000 characters a result shows, the payment is still read, and an invisible character does not hide it.
    ("confirm", "Context. " * 300 + "Pay $40 now?", None), ("confirm", "Pa\u200by $40 now?", None),
    ("confirm", "Ｐａｙ $40 now?", None),
    # A message too long to judge is only dismissed.
    ("alert", "Context. " * 25_000 + "Saved", None),
], ids=["password", "payment", "payment-past-what-is-shown", "zero-width", "fullwidth", "too-long"])
async def test_a_dialog_that_asks_for_the_owners_step_is_never_accepted(tmp_path, kind, message, text):
    # A headless dialog has no window the owner could answer: a sign-in or payment answer is refused, and it can be dismissed.
    browser, tab = dialog_tab(tmp_path)
    sent = []

    async def call(method, params=None, *, session=None):
        sent.append(method)
        return {}

    browser.cdp = SimpleNamespace(call=call)
    open_dialog(browser, kind, message)
    accept = {"action": "accept", "dialog_id": tab.dialog["dialog_id"], **({"prompt_text": text} if text else {})}
    with pytest.raises(BrowserError, match="browser_dialog_private"):
        await host_page.dialog_action(browser, tab, accept, "user")
    assert sent == []
    await host_page.dialog_action(browser, tab, {"action": "dismiss", "dialog_id": tab.dialog["dialog_id"]}, "user")
    assert sent == ["Page.handleJavaScriptDialog"]


async def test_an_answered_prompt_is_judged_as_pressing_ok_too(tmp_path):
    # An answer typed into a prompt that deletes still asks the owner first, as pressing OK on it would.
    browser, tab = dialog_tab(tmp_path)

    async def call(method, params=None, *, session=None):
        raise AssertionError(method)

    browser.cdp = SimpleNamespace(call=call)
    open_dialog(browser, "prompt", "Delete the draft? Type its name to confirm")
    with pytest.raises(BrowserError, match="browser_owner_approval_required"):
        await host_page.dialog_action(
            browser, tab, {"action": "accept", "dialog_id": tab.dialog["dialog_id"], "prompt_text": "Draft"}, "auto")


def test_a_long_dialog_shows_both_its_ends_and_says_what_is_left_out(tmp_path):
    # What a long message asks is often at its end: the owner and the member see both ends and how much is between.
    browser, tab = dialog_tab(tmp_path)
    open_dialog(browser, "confirm", "Context. " * 300 + "Pay $40 now?")
    message = tab.dialog["message"]
    assert message.startswith("Context. ") and message.endswith("Pay $40 now?") and "\n…\n" in message
    assert (len(message), tab.dialog["omitted"]) == (2003, 9 * 300 + 12 - 2000)
    browser._event("Page.javascriptDialogClosed", {"result": False}, "session")
    open_dialog(browser, "alert", "Saved")
    assert tab.dialog["message"] == "Saved" and "omitted" not in tab.dialog


def test_the_dialog_tool_is_offered_and_asks_like_page_input():
    assert HostComputerTools.base_tier("browser_dialog") == HostComputerTools.base_tier("browser_click")


def staged(browser, guid, data=b"page data"):
    browser.staging.mkdir(parents=True, exist_ok=True)
    (browser.staging / guid).write_bytes(data)


GUID = "0f5c2a1e-7d64-4b8a-9a51-3c2e8f6d1b70"


def test_a_download_lands_in_raphaels_own_folder_never_at_the_projects_root(tmp_path):
    # A page can start a download with no click; at a project's root, conftest.py or a Makefile runs with its next build.
    browser = HostBrowser(tmp_path / "profile")
    project = (tmp_path / "project").resolve()
    project.mkdir()
    (project / "conftest.py").write_text("# the owner's\n")
    staged(browser, GUID, b"import os")
    placed = browser._place_download(GUID, project, "conftest.py")
    assert placed == project / ".raphael" / "downloads" / "conftest.py"
    assert placed.read_bytes() == b"import os" and (project / "conftest.py").read_text() == "# the owner's\n"
    assert (project / ".raphael" / ".gitignore").read_text().splitlines()[-1] == "*"
    second = GUID[:-1] + "1"
    staged(browser, second, b"again")
    assert browser._place_download(second, project, "conftest.py").name == "1-conftest.py"
    assert (project / ".raphael" / "downloads" / "conftest.py").read_bytes() == b"import os"


@pytest.mark.skipif(os.name == "nt", reason="making a symbolic link needs a privilege on Windows")
@pytest.mark.parametrize("link", [".raphael", ".raphael/downloads"])
@pytest.mark.parametrize("by_handle", [True, False], ids=["by-handle", "by-path"])
def test_a_projects_own_raphael_link_is_never_followed(tmp_path, monkeypatch, link, by_handle):
    if by_handle and not host_browser.HANDLES:
        pytest.skip("this system opens no folder relative to another")
    monkeypatch.setattr(host_browser, "HANDLES", by_handle)
    browser = HostBrowser(tmp_path / "profile")
    project, elsewhere = (tmp_path / "project").resolve(), (tmp_path / "elsewhere").resolve()
    (project / link).parent.mkdir(parents=True)
    elsewhere.mkdir()
    (project / link).symlink_to(elsewhere, target_is_directory=True)
    staged(browser, GUID)
    assert browser._place_download(GUID, project, "authorized_keys") is None
    assert list(elsewhere.iterdir()) == [] and (browser.staging / GUID).exists()


def test_a_file_created_where_a_swapped_link_led_gets_nothing_written(tmp_path, monkeypatch):
    # By path (Windows), a link swapped in after the folders were checked is seen on the created file's handle.
    monkeypatch.setattr(host_browser, "HANDLES", False)
    monkeypatch.setattr(host_browser, "opened_in", lambda file, folder: False)
    browser = HostBrowser(tmp_path / "profile")
    project = (tmp_path / "project").resolve()
    project.mkdir()
    staged(browser, GUID, b"payload")
    assert browser._place_download(GUID, project, "conftest.py") is None
    assert (browser.staging / GUID).read_bytes() == b"payload"
    assert all(path.stat().st_size == 0 for path in (project / ".raphael" / "downloads").iterdir())


def test_the_created_file_is_found_in_its_folder(tmp_path):
    folder = tmp_path.resolve()
    with (folder / "report.txt").open("xb") as file:
        assert host_browser.opened_in(file, folder) and not host_browser.opened_in(file, folder / "other")


@pytest.mark.parametrize("by_handle", [True, False], ids=["by-handle", "by-path"])
def test_a_half_written_gitignore_is_removed_so_the_next_download_writes_it(tmp_path, monkeypatch, by_handle):
    if by_handle and not host_browser.HANDLES:
        pytest.skip("this system opens no folder relative to another")
    monkeypatch.setattr(host_browser, "HANDLES", by_handle)

    class Full:
        def __init__(self, file):
            self.file = file

        def __enter__(self):
            return self

        def __exit__(self, *error):
            self.file.close()

        def write(self, text):
            raise OSError("the disk is full")

        def __getattr__(self, name):
            return getattr(self.file, name)

    if by_handle:
        fdopen = os.fdopen
        monkeypatch.setattr(host_browser.os, "fdopen",
                            lambda fd, mode, **options: Full(fdopen(fd, mode, **options)) if mode == "w" else fdopen(fd, mode, **options))
    else:
        made = host_browser.created
        monkeypatch.setattr(host_browser, "created", lambda path:
                            (lambda file, remove: (Full(file), remove))(*made(path)) if path.name == ".gitignore" else made(path))
    browser = HostBrowser(tmp_path / "profile")
    project = (tmp_path / "project").resolve()
    project.mkdir()
    staged(browser, GUID)
    assert browser._place_download(GUID, project, "report.txt") is None
    assert not (project / ".raphael" / ".gitignore").exists() and (browser.staging / GUID).exists()
    monkeypatch.undo()
    monkeypatch.setattr(host_browser, "HANDLES", by_handle)
    assert browser._place_download(GUID, project, "report.txt") is not None
    assert (project / ".raphael" / ".gitignore").read_text().splitlines()[-1] == "*"


@pytest.mark.skipif(os.name == "nt", reason="making a symbolic link needs a privilege on Windows")
@pytest.mark.parametrize("swapped", [".raphael", ".raphael/downloads"])
def test_a_failed_write_never_removes_the_file_a_link_swapped_in_meanwhile_leads_to(tmp_path, monkeypatch, swapped):
    # By path, a link swapped in while a file is written would lead the clean-up of the half-written file to the
    # project's own file of that name.
    monkeypatch.setattr(host_browser, "HANDLES", False)
    project = (tmp_path / "project").resolve()
    project.mkdir()
    for name in (".gitignore", "report.txt"):
        (project / name).write_text("# the owner's\n")

    def swap(*args):
        (project / swapped).rename(project / "moved")
        (project / swapped).symlink_to(project, target_is_directory=True)
        raise OSError("the disk is full")

    class Swapping:
        def __init__(self, file):
            self.file = file

        def __enter__(self):
            return self

        def __exit__(self, *error):
            self.file.close()

        def __getattr__(self, name):
            return getattr(self.file, name)

        write = swap

    if swapped == ".raphael":
        open_path = Path.open
        monkeypatch.setattr(Path, "open", lambda path, mode="r", **options:
                            Swapping(open_path(path, mode, **options)) if path.name == ".gitignore" else open_path(path, mode, **options))
    with pytest.raises(OSError, match="the disk is full"):
        host_browser.place_by_path(project, "report.txt", SimpleNamespace(read=swap))
    assert (project / ".gitignore").read_text() == (project / "report.txt").read_text() == "# the owner's\n"


def test_a_download_is_placed_the_same_way_where_no_folder_opens_relative_to_another(tmp_path, monkeypatch):
    # Windows places by path, checking each folder for a link or junction.
    monkeypatch.setattr(host_browser, "HANDLES", False)
    test_a_download_lands_in_raphaels_own_folder_never_at_the_projects_root(tmp_path)


async def test_a_member_is_told_where_each_download_was_placed(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    project = (tmp_path / "project").resolve()
    tab = Tab("tab", "target", "session", 3, project)
    tab.frames.add("frame")
    browser.tabs[tab.id] = tab
    staged(browser, GUID)
    browser._event("Browser.downloadWillBegin", {"guid": GUID, "frameId": "frame", "suggestedFilename": "report.txt"}, None)
    browser._event("Browser.downloadProgress", {"guid": GUID, "state": "completed"}, None)
    await asyncio.gather(*browser.transfers)
    await asyncio.sleep(0)
    assert browser.take_downloads(3) == [".raphael/downloads/report.txt"] and browser.take_downloads(3) == []


PAGE = b"""<title>Blockers</title>
<select id="plain"><option value="">Please select an option</option><option value="1">Option 1</option>
<option value="2">Option 2</option></select>
<label>Size <select id="sized"><option value="s">Small</option><option value="l">Large</option></select></label>
<button id="alert" onclick="alert('Saved'); document.title = 'after alert'">Alert</button>
<button id="confirm" onclick="document.body.dataset.confirmed = confirm('Delete the draft?')">Confirm</button>
<button id="prompt" onclick="document.body.dataset.answer = prompt('Name the copy', 'Draft')">Prompt</button>"""


async def serve(reader, writer):
    try:
        with contextlib.suppress(asyncio.IncompleteReadError, ConnectionError):
            await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: text/html\r\n"
                         + f"Content-Length: {len(PAGE)}\r\n\r\n".encode() + PAGE)
            await writer.drain()
    finally:
        writer.close()


@contextlib.asynccontextmanager
async def blocker_page(tmp_path):
    browser = HostBrowser(tmp_path / "profile")
    site = await asyncio.start_server(serve, "127.0.0.1", 0)
    try:
        tab, _ = await browser.open_tab(1, tmp_path, 10)
        assert await host_page.navigate(browser, tab, f"http://127.0.0.1:{site.sockets[0].getsockname()[1]}/")
        yield browser, tab
    finally:
        await browser.aclose()
        site.close()


async def refs(browser, tab, role):
    data, _ = await HostComputerTools.page_call(browser, tab, "get_browser_state", {}, "user")
    return {row["name"]: row["ref"] for row in data["refs"] if row["role"] == role}


async def page_value(browser, tab, expression):
    return (await host_page.evaluate(browser, tab, expression))[0]  # an isolated world: the DOM, not the page's globals


@NATIVE
async def test_native_chrome_chooses_a_labelled_and_an_unlabelled_select_by_ref(tmp_path):
    async with blocker_page(tmp_path) as (browser, tab):
        selects = await refs(browser, tab, "combobox")
        assert set(selects) == {"", "Size"}
        result, _ = await HostComputerTools.page_call(browser, tab, "browser_select",
                                                      {"ref": selects[""], "label": "Option 2"}, "user")
        assert result["status"] == "delivered"
        selects = await refs(browser, tab, "combobox")
        result, _ = await HostComputerTools.page_call(browser, tab, "browser_select",
                                                      {"ref": selects["Size"], "value": "l"}, "user")
        assert result["status"] == "delivered"
        assert await page_value(browser, tab, "[document.getElementById('plain').value, "
                                              "document.getElementById('sized').value]") == ["2", "l"]


@NATIVE
async def test_native_chrome_reports_and_answers_alert_confirm_and_prompt(tmp_path):
    async with blocker_page(tmp_path) as (browser, tab):
        async def press(name):
            buttons = await refs(browser, tab, "button")
            async with asyncio.timeout(5):
                data, _ = await HostComputerTools.page_call(browser, tab, "browser_click", {"ref": buttons[name]}, "user")
            assert data["status"] == "dialog_open", data
            return data["dialog"]

        async def answer(dialog, action, **extra):
            data, _ = await HostComputerTools.page_call(
                browser, tab, "browser_dialog", {"action": action, "dialog_id": dialog["dialog_id"], **extra}, "user")
            return data["status"]

        alert = await press("Alert")
        assert (alert["type"], alert["message"]) == ("alert", "Saved")
        async with asyncio.timeout(3):
            blocked, _ = await HostComputerTools.page_call(browser, tab, "get_browser_state", {}, "user")
        assert blocked["status"] == "dialog_open"
        assert await answer(alert, "accept") == "dialog_accepted"
        async with asyncio.timeout(5):
            while await page_value(browser, tab, "document.title") != "after alert":
                await asyncio.sleep(0.05)
        confirm = await press("Confirm")
        assert await answer(confirm, "dismiss") == "dialog_dismissed"
        assert await page_value(browser, tab, "document.body.dataset.confirmed") == "false"
        prompt = await press("Prompt")
        assert prompt["default_prompt"] == "Draft"
        assert await answer(prompt, "accept", prompt_text="Copy 2") == "dialog_accepted"
        assert await page_value(browser, tab, "document.body.dataset.answer") == "Copy 2"
