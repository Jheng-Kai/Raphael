"""What the member reads about the Computer panel never sends the owner there instead of an answer (#344): a member asked a
question in chat told the owner to look at a blank panel. The answer goes in the reply; the panel shows a page only when
the owner asked to see one."""

import re

import pytest

from raphael_core.agent import persona
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer import host_page
from raphael_core.computer.host_browser import HostBrowser, Tab
from raphael_core.computer.host_computer import WORDS, HostComputerTools
from raphael_core.computer.takeover import TAKEOVER
from raphael_core.computer.vm import LocalVm
from raphael_core.computer.vm_tools import BROWSER_OPEN

SENDS_TO_PANEL = re.compile(r"say where to look|point to the Computer panel|sees? it in the app's Computer panel"
                            r"|can (see|watch) this (page|tab) in the app's Computer panel", re.IGNORECASE)


async def member_texts(tmp_path, conn):
    tools = HostComputerTools(LocalVm(tmp_path, settings=SettingsStore(conn)), conn, BROWSER_OPEN)
    browser = HostBrowser(tmp_path / "browser")
    tab = Tab("tab", "target", "session", 1, tmp_path)

    async def snapshot(browser, tab, arguments):
        return {}, []

    host_page_snapshot, host_page.snapshot = host_page.snapshot, snapshot
    try:
        data, _ = await HostComputerTools.page_work(browser, tab, "get_browser_state", {}, "user")
    finally:
        host_page.snapshot = host_page_snapshot
    return {
        "browser_open": tools.definitions["browser_open"]["description"],
        "browser_state_view": data["view"],
        "browser_background_only": WORDS["browser_background_only"],
        "request_takeover": TAKEOVER["description"],
        "contract": persona._contract(),
    }


async def test_no_text_the_member_reads_sends_the_owner_to_the_panel_instead_of_answering(tmp_path, conn):
    for name, text in (await member_texts(tmp_path, conn)).items():
        assert not SENDS_TO_PANEL.search(text), name
        if "Computer panel" in text:
            assert "reply" in text, name


async def test_the_contract_says_the_answer_goes_in_the_reply_and_the_panel_only_shows_a_page_asked_for(tmp_path, conn):
    contract = (await member_texts(tmp_path, conn))["contract"]
    assert "Always answer in your reply" in contract
    assert "Only when the owner asked to see a page" in contract
