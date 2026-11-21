"""Raphael's Chrome, with tab capabilities scoped to a single turn or task."""

import asyncio
import json
import logging
import os
import re
import secrets
import shutil
import sys
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from ..messaging.channels.base import ChannelError
from ..messaging.channels.socket import GatewaySocket
from ..paths import owner_only_directory

logger = logging.getLogger(__name__)


class BrowserError(ValueError):
    pass


def chrome_executable():
    if sys.platform == "win32":
        for variable in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            if root := os.environ.get(variable):
                path = Path(root) / "Google/Chrome/Application/chrome.exe"
                if path.is_file():
                    return path
    elif sys.platform == "darwin":
        for root in (Path("/Applications"), Path.home() / "Applications"):
            path = root / "Google Chrome.app/Contents/MacOS/Google Chrome"
            if path.is_file():
                return path
    elif executable := shutil.which("google-chrome"):
        return Path(executable)
    return None


def page_url(value):
    try:
        url = urlsplit(value)
        if value == "about:blank" or (url.scheme in ("http", "https") and url.hostname and not url.username
                                      and not url.password and not any(ord(char) < 32 for char in value)):
            return value
    except ValueError:
        pass
    raise BrowserError("browser_url")


class DevTools:
    def __init__(self, socket, event):
        self.socket, self.event = socket, event
        self.sequence = 0
        self.pending = {}
        self.reader = asyncio.create_task(self.read())

    async def read(self):
        try:
            while True:
                message = await self.socket.recv()
                if reply := self.pending.get(message.get("id")):
                    if not reply.done():
                        reply.set_result(message)
                elif "method" in message:
                    self.event(message["method"], message.get("params", {}), message.get("sessionId"))
        except (OSError, EOFError, ChannelError, ValueError):
            pass
        finally:
            for reply in self.pending.values():
                if not reply.done():
                    reply.set_result({"error": {}})

    async def call(self, method, params=None, *, session=None):
        if self.reader.done():
            raise BrowserError("chrome_disconnected")
        self.sequence += 1
        identifier = self.sequence
        reply = self.pending[identifier] = asyncio.get_running_loop().create_future()
        try:
            async with asyncio.timeout(25):
                await self.socket.send({"id": identifier, "method": method, "params": params or {},
                                        **({"sessionId": session} if session else {})})
                result = await reply
        finally:
            self.pending.pop(identifier, None)
        if "error" in result:
            raise BrowserError("chrome_command_failed")
        return result.get("result", {})

    async def close(self):
        self.reader.cancel()
        await asyncio.gather(self.reader, return_exceptions=True)
        with suppress(OSError):
            await self.socket.__aexit__(None, None, None)


@dataclass
class Tab:
    id: str
    target: str
    session: str
    scope: tuple
    member: int
    workspace: Path
    refs: dict = field(default_factory=dict)
    frames: set = field(default_factory=set)
    handoff: bool = False


class HostBrowser:
    def __init__(self, profile, *, idle_seconds=900, headless=False):
        self.profile = Path(profile)
        self.staging = self.profile / "downloads"
        self.idle_seconds, self.headless = idle_seconds, headless
        self.lock = asyncio.Lock()
        self.process = self.cdp = self.idle = None
        self.tabs, self.downloads = {}, {}
        self.owned_targets = {}
        self.startup_url = None
        self.current = {}
        self.transfers = {}

    def busy(self, member):
        if member in self.transfers.values():
            return True
        if self.cdp is None or self.cdp.reader.done():
            return False
        return (any(tab.member == member for tab in self.tabs.values())
                or any(owner == member for owner, _, _ in self.downloads.values()))

    def checked_url(self, url):
        checked = page_url(url)
        try:
            if urlsplit(checked).port != self.cdp.socket.port:
                return checked
        except ValueError:
            pass
        raise BrowserError("browser_url")

    async def _connect(self):
        try:
            port, path = (self.profile / "DevToolsActivePort").read_text(encoding="ascii").splitlines()
            if not 0 < int(port) < 65536 or not re.fullmatch(r"/devtools/browser/[0-9a-f-]{36}", path):
                return None
            socket = GatewaySocket("127.0.0.1", port=int(port), path=path, tls=False, message_limit=24_000_000)
            await socket.__aenter__()
        except (OSError, EOFError, ValueError, ChannelError, TimeoutError):
            return None
        return DevTools(socket, self._event)

    async def start(self):
        """Called under lock. Returns whether a new Chrome window was started."""
        if self.cdp is not None and not self.cdp.reader.done():
            return False
        if self.cdp is not None:
            await self.cdp.close()
            self.cdp = None
            self.tabs.clear()
            self.owned_targets.clear()
            self.startup_url = None
            self.current.clear()
            self.downloads.clear()
        executable = chrome_executable()
        if executable is None:
            raise BrowserError("chrome_missing")
        if self.profile.is_symlink() or self.staging.is_symlink():
            raise BrowserError("chrome_profile")
        owner_only_directory(self.profile)
        self.staging.mkdir(exist_ok=True)
        # Chrome's ordinary download setting also stays inside the private profile.
        preferences = self.profile / "Default" / "Preferences"
        if not preferences.exists() and not preferences.parent.exists():
            preferences.parent.mkdir()
            preferences.write_text(json.dumps({"download": {"default_directory": str(self.staging),
                                                              "prompt_for_download": False}}), encoding="utf-8")
        self.cdp = await self._connect()
        started = self.cdp is None
        try:
            if started:
                self.startup_url = f"about:blank#raphael-{secrets.token_hex(16)}"
                self.process = await asyncio.create_subprocess_exec(
                    str(executable), f"--user-data-dir={self.profile}", "--remote-debugging-address=127.0.0.1",
                    "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
                    "--disable-background-mode", "--disable-background-networking", "--disable-session-crashed-bubble",
                    *(("--headless=new", "--disable-gpu") if self.headless else ()), self.startup_url,
                    stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                async with asyncio.timeout(20):
                    while self.cdp is None:
                        self.cdp = await self._connect()
                        if self.cdp is not None:
                            break
                        if self.process.returncode not in (None, 0):
                            raise BrowserError("chrome_start_failed")
                        await asyncio.sleep(0.15)
            await self.cdp.call("Browser.setDownloadBehavior",
                                {"behavior": "allowAndName", "downloadPath": str(self.staging), "eventsEnabled": True})
            await self.cdp.call("Target.setDiscoverTargets", {"discover": True, "filter": [{"type": "page"}]})
            return started
        except BaseException:
            await self._stop()
            raise

    def _event(self, method, params, session):
        if method in ("Target.targetCreated", "Target.targetInfoChanged"):
            info = params["targetInfo"]
            if info["type"] == "page" and (owner := self.owned_targets.get(info.get("openerId"))) is not None:
                self.owned_targets.setdefault(info["targetId"], owner)
        elif method == "Target.detachedFromTarget":
            # Losing the session does not destroy the target. Keep its owner for cleanup.
            for identifier, tab in list(self.tabs.items()):
                if tab.session == params.get("sessionId"):
                    self.tabs.pop(identifier, None)
            self._schedule_idle()
        elif method == "Page.frameNavigated":
            for tab in self.tabs.values():
                if tab.session == session:
                    tab.refs.clear()
                    tab.frames.add(params["frame"]["id"])
        elif method == "Page.frameDetached":
            for tab in self.tabs.values():
                if tab.session == session:
                    tab.refs.clear()
                    tab.frames.discard(params["frameId"])
        elif method == "Browser.downloadWillBegin":
            guid, frame = params["guid"], params["frameId"]
            for tab in self.tabs.values():
                if frame in tab.frames:
                    self.downloads[guid] = (tab.member, tab.workspace, params["suggestedFilename"])
                    break
        elif method == "Browser.downloadProgress" and params["state"] in ("completed", "canceled"):
            guid = params["guid"]
            download = self.downloads.pop(guid, None)
            if download and params["state"] == "completed":
                member, workspace, name = download
                task = asyncio.create_task(asyncio.to_thread(self._place_download, guid, workspace, name))
                self.transfers[task] = member
                task.add_done_callback(self.transfers.pop)
            self._schedule_idle()

    def _place_download(self, guid, workspace, suggested):
        name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "_", suggested)[:180].strip(" .")
        if not name or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\..*)?", name):
            name = "download"
        if not re.fullmatch(r"[0-9a-f-]{36}", guid):
            return
        source = self.staging / guid
        try:
            if workspace.resolve() != workspace or source.is_symlink():
                return
            workspace.mkdir(parents=True, exist_ok=True)
            for index in range(1000):
                path = workspace / (name if not index else f"{index}-{name}")
                with source.open("rb") as data:
                    try:
                        output = path.open("xb")
                    except FileExistsError:
                        continue
                    try:
                        with output:
                            shutil.copyfileobj(data, output)
                    except OSError:
                        path.unlink(missing_ok=True)
                        raise
                source.unlink()
                return
        except OSError:
            # Chrome keeps the staged file if it could not be placed in the work folder.
            return

    async def _take_startup_target(self):
        url, self.startup_url = self.startup_url, None
        if url is None:
            return None
        # Chrome can publish the DevTools port before its command-line page appears.
        try:
            async with asyncio.timeout(3):
                while True:
                    listing = await self.cdp.call("Target.getTargets")
                    for info in listing["targetInfos"]:
                        if info["type"] == "page" and info["url"] == url:
                            return info["targetId"]
                    await asyncio.sleep(0.05)
        except TimeoutError:
            return None

    async def new_tab(self, scope, member, workspace):
        target = await self._take_startup_target()
        if target is None:
            target = (await self.cdp.call("Target.createTarget", {"url": "about:blank", "background": True}))["targetId"]
        self.owned_targets[target] = scope
        tab = None
        try:
            session = (await self.cdp.call("Target.attachToTarget", {"targetId": target, "flatten": True}))["sessionId"]
            tab = Tab(secrets.token_urlsafe(18), target, session, scope, member, workspace)
            self.tabs[tab.id] = tab
            await self.command(tab, "Page.enable")
            tree = await self.command(tab, "Page.getFrameTree")
            tab.frames.add(tree["frameTree"]["frame"]["id"])
        except BaseException:
            if tab is not None:
                self.tabs.pop(tab.id, None)
            await self._close_targets(lambda: {target} & self.owned_targets.keys())
            raise
        self.current[scope] = tab.id
        return tab

    async def command(self, tab, method, params=None):
        if self.tabs.get(tab.id) is not tab:
            raise BrowserError("browser_tab_changed")
        return await self.cdp.call(method, params, session=tab.session)

    def tab(self, scope, *identifiers):
        ids = {identifier for identifier in identifiers if identifier is not None}
        selected = ids or {self.current.get(scope)}
        matches = [tab for tab in self.tabs.values() if tab.scope == scope and (selected == {tab.id} or not ids)]
        if not matches:
            raise BrowserError("browser_tab_required")
        tab = next((tab for tab in matches if tab.id in selected), matches[-1])
        self.current[scope] = tab.id
        return tab

    async def focus(self, tab):
        async with self.lock:
            await self._focus(tab)

    async def _focus(self, tab):
        await self.command(tab, "Page.bringToFront")
        await self.cdp.call("Target.activateTarget", {"targetId": tab.target})

    async def close_scope(self, scope):
        async with self.lock:
            self.current.pop(scope, None)
            for tab in list(self.tabs.values()):
                if tab.scope == scope:
                    self.tabs.pop(tab.id, None)
            await self._close_targets(lambda: {target for target, owner in self.owned_targets.items() if owner == scope})
            self._schedule_idle()

    async def _close_targets(self, owned):
        """Reconcile against Chrome after close; an accepted close is only a request."""
        requested = set()
        try:
            async with asyncio.timeout(4):
                while remaining := owned():
                    for target in remaining - requested:
                        try:
                            reply = await self.cdp.call("Target.closeTarget", {"targetId": target})
                        except (BrowserError, OSError):
                            continue
                        if reply.get("success") is not False:
                            requested.add(target)
                    listing = await self.cdp.call("Target.getTargets")
                    live = {info["targetId"] for info in listing["targetInfos"]}
                    for target in remaining - live:
                        self.owned_targets.pop(target, None)
                    if owned():
                        await asyncio.sleep(0.05)
        except (BrowserError, OSError, TimeoutError):
            # Retain ownership for the next cleanup or shutdown if Chrome has not confirmed removal.
            logger.warning("Chrome did not confirm closure of %d member page targets", len(owned()))

    def _schedule_idle(self):
        if self.idle is not None:
            self.idle.cancel()
            self.idle = None
        if not self.tabs and not self.downloads and self.cdp is not None:
            self.idle = asyncio.create_task(self._idle())

    async def _idle(self):
        await asyncio.sleep(self.idle_seconds)
        async with self.lock:
            if not self.tabs and not self.downloads:
                self.idle = None
                await self._stop()

    async def _stop(self):
        cdp, process = self.cdp, self.process
        self.cdp = self.process = None
        self.tabs.clear()
        self.owned_targets.clear()
        self.startup_url = None
        self.current.clear()
        self.downloads.clear()
        try:
            if cdp is not None:
                try:
                    async with asyncio.timeout(4):
                        await cdp.call("Browser.close")
                except (BrowserError, TimeoutError, OSError):
                    pass
                await cdp.close()
        finally:
            if process is not None and process.returncode is None:
                try:
                    await asyncio.wait_for(process.wait(), 5)
                except TimeoutError:
                    try:
                        process.kill()
                    except ProcessLookupError:
                        pass
                    await process.wait()
            await asyncio.gather(*self.transfers, return_exceptions=True)

    async def aclose(self):
        async with self.lock:
            if self.idle is not None:
                self.idle.cancel()
                await asyncio.gather(self.idle, return_exceptions=True)
                self.idle = None
            await self._stop()
