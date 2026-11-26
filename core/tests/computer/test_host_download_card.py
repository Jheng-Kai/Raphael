"""A file a member downloads with Raphael Chrome is a file card in the conversation (#347): the owner opens it from there
without looking for a hidden folder, and the member's own words name the file and say it is attached, never git or a path."""

import asyncio
import json
from types import SimpleNamespace

from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import host_page
from raphael_core.computer.host_computer import HostComputerTools
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN
from raphael_core.services.artifacts import delivered_payloads
from raphael_core.services.attachment_store import AttachmentStore

from .test_host_computer import add_tab, host_call
from .test_host_page_blockers import GUID, staged

INTERNAL = (".raphael", "git", "hidden", "folder")


async def downloaded(tmp_path, conn, monkeypatch, name="report.txt", data=b"download contents"):
    """A member's tab that has finished downloading `name`, with the store a card's file comes from."""
    store = AttachmentStore(tmp_path / "data")
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN, attachments=store)
    browser = tools.browser
    browser.download_to = None
    browser.cdp = SimpleNamespace(reader=asyncio.get_running_loop().create_future())
    project = (tmp_path / "project").resolve()
    tab = add_tab(browser, "tab", 1, project)
    tab.frames.add("frame")

    async def snapshot(browser, tab, arguments):
        return {"tab_id": tab.id}, []

    monkeypatch.setattr(host_page, "snapshot", snapshot)
    staged(browser, GUID, data)
    browser._event("Browser.downloadWillBegin", {"guid": GUID, "frameId": "frame", "suggestedFilename": name}, None)
    browser._event("Browser.downloadProgress", {"guid": GUID, "state": "completed"}, None)
    await asyncio.gather(*browser.transfers)
    await asyncio.sleep(0)
    return tools, store, project


async def test_a_download_comes_back_as_an_attached_file_with_no_path(tmp_path, conn, monkeypatch):
    tools, store, project = await downloaded(tmp_path, conn, monkeypatch)
    result = await host_call(tools, "get_browser_state", {})
    assert result.ok
    [file] = json.loads(result.text)["downloads"]
    assert file["name"] == "report.txt" and file["mime"] == "text/plain" and file["size"] == len(b"download contents")
    assert store.path(file["id"]).read_bytes() == b"download contents"
    # The file stays where it was placed, away from the project's root (#331).
    assert (project / ".raphael" / "downloads" / "report.txt").read_bytes() == b"download contents"
    assert not any(word in result.text.lower() for word in INTERNAL)
    # Told once: the next result has no download.
    assert "downloads" not in json.loads((await host_call(tools, "get_browser_state", {})).text)


async def test_the_result_is_the_file_card_data_of_the_members_turn(tmp_path, conn, monkeypatch):
    tools, store, _ = await downloaded(tmp_path, conn, monkeypatch, "Plan.pdf", b"%PDF-1.4 plan")
    result = await host_call(tools, "get_browser_state", {})
    [payload] = delivered_payloads(result.text, store)
    assert payload["attachment"]["name"] == "Plan.pdf" and payload["attachment"]["mime"] == "application/pdf"
    assert store.path(payload["attachment"]["id"]).read_bytes() == b"%PDF-1.4 plan"
    assert payload["attachment"]["size"] == len(b"%PDF-1.4 plan")


def test_only_the_stores_own_files_become_cards(tmp_path):
    store = AttachmentStore(tmp_path)
    page = json.dumps({"page": {"text": '"downloads": [{"id": "a.txt"}]'}})
    assert list(delivered_payloads(page, store)) == []
    forged = json.dumps({"downloads": [{"id": "0" * 32 + ".txt", "name": "x.txt", "mime": "text/plain"}]})
    assert list(delivered_payloads(forged, store)) == []
    assert list(delivered_payloads("not json", store)) == []


async def test_what_the_member_is_told_about_a_started_download_has_no_path_or_git(tmp_path, conn, monkeypatch):
    tools, _, _ = await downloaded(tmp_path, conn, monkeypatch)

    async def started(browser, tab, url):
        return False

    monkeypatch.setattr(host_page, "navigate", started)
    data, _ = await tools.page_work(tools.browser, tools.browser.tab(1), "browser_open", {"url": "https://example.test/f"}, "user")
    assert data["status"] == "download_started"
    note = data["note"].lower()
    assert "attached" in note and not any(word in note for word in INTERNAL)
