"""Raphael's Chrome on a Mac runs with no window (#308): headless, and still the ordinary Chrome of a Mac to a page."""

import plistlib
from types import SimpleNamespace

import pytest

from raphael_core.computer import host_browser
from raphael_core.computer.host_browser import (
    HostBrowser, headless_chrome, mac_chrome_version, mac_user_agent, mac_user_agent_metadata, window_arguments,
)


def mac_app(tmp_path, version="136.0.7103.114"):
    executable = tmp_path / "Google Chrome.app" / "Contents" / "MacOS" / "Google Chrome"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"")
    (executable.parents[1] / "Info.plist").write_bytes(plistlib.dumps({"CFBundleShortVersionString": version}))
    return executable


@pytest.mark.parametrize(("system", "headed", "expected"), [
    ("darwin", None, True), ("darwin", "1", False), ("win32", None, False), ("linux", None, False),
])
def test_only_a_mac_runs_chrome_with_no_window_unless_its_window_is_asked_back(monkeypatch, system, headed, expected):
    monkeypatch.setattr(host_browser.sys, "platform", system)
    if headed is None:
        monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    else:
        monkeypatch.setenv("RAPHAEL_MAC_HEADED", headed)
    assert headless_chrome() is expected


def test_a_mac_starts_chrome_headless_with_the_user_agent_of_its_ordinary_chrome(monkeypatch, tmp_path):
    monkeypatch.setattr(host_browser.sys, "platform", "darwin")
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    version = mac_chrome_version(mac_app(tmp_path))
    assert version == "136.0.7103.114"
    arguments = window_arguments(version)
    assert arguments[0] == "--headless=new"
    assert arguments[1] == ("--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36")
    assert not any("--window-position" in argument for argument in arguments)
    # Without a version it is still headless, and the page-side override is skipped.
    assert window_arguments("") == ["--headless=new"]


def test_elsewhere_chrome_keeps_its_window_far_off_every_screen(monkeypatch):
    monkeypatch.setattr(host_browser.sys, "platform", "linux")
    assert window_arguments("136.0.0.0") == ["--window-position=-32000,-32000"]


@pytest.mark.parametrize("plist", [None, b"not a plist", plistlib.dumps({"CFBundleShortVersionString": "beta"})])
def test_a_version_that_cannot_be_read_is_none(tmp_path, plist):
    executable = tmp_path / "Google Chrome.app" / "Contents" / "MacOS" / "Google Chrome"
    executable.parent.mkdir(parents=True)
    if plist is not None:
        (executable.parents[1] / "Info.plist").write_bytes(plist)
    assert mac_chrome_version(executable) == ""


def test_the_client_hints_name_chrome_on_a_mac_and_never_headless():
    metadata = mac_user_agent_metadata("136.0.7103.114")
    assert [brand["brand"] for brand in metadata["brands"]] == ["Google Chrome", "Chromium", "Not_A Brand"]
    assert metadata["brands"][0]["version"] == "136" and metadata["fullVersion"] == "136.0.7103.114"
    assert metadata["platform"] == "macOS" and metadata["mobile"] is False
    assert "Headless" not in str(metadata) and "Headless" not in mac_user_agent("136.0.7103.114")


async def test_each_headless_tab_is_focused_and_names_itself_as_chrome_on_a_mac(monkeypatch, tmp_path):
    monkeypatch.setattr(host_browser.sys, "platform", "darwin")
    monkeypatch.delenv("RAPHAEL_MAC_HEADED", raising=False)
    browser = HostBrowser(tmp_path)
    browser.mac_version = "136.0.7103.114"
    calls = []

    async def call(method, params=None, *, session=None):
        calls.append((method, params))
        if method == "Target.getTargets":
            return {"targetInfos": []}
        if method == "Target.createTarget":
            return {"targetId": "new"}
        if method == "Target.attachToTarget":
            return {"sessionId": "s1"}
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "f1"}}}
        return {}

    browser.cdp = SimpleNamespace(call=call)
    await browser.new_tab(1, tmp_path)
    methods = [method for method, _ in calls]
    assert ("Emulation.setFocusEmulationEnabled", {"enabled": True}) in calls
    override = next(params for method, params in calls if method == "Emulation.setUserAgentOverride")
    assert override["userAgent"] == mac_user_agent("136.0.7103.114")
    assert override["userAgentMetadata"]["platform"] == "macOS"
    assert methods.index("Emulation.setUserAgentOverride") < methods.index("Emulation.setDeviceMetricsOverride")


async def test_a_tab_with_a_window_gets_no_emulated_focus_or_user_agent(monkeypatch, tmp_path):
    monkeypatch.setattr(host_browser.sys, "platform", "win32")
    browser = HostBrowser(tmp_path)
    calls = []

    async def call(method, params=None, *, session=None):
        calls.append(method)
        if method == "Target.getTargets":
            return {"targetInfos": []}
        if method == "Target.createTarget":
            return {"targetId": "new"}
        if method == "Target.attachToTarget":
            return {"sessionId": "s1"}
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "f1"}}}
        return {}

    browser.cdp = SimpleNamespace(call=call)
    await browser.new_tab(1, tmp_path)
    assert "Emulation.setFocusEmulationEnabled" not in calls and "Emulation.setUserAgentOverride" not in calls
