"""Raphael's Chrome, with tab capabilities scoped to a single turn or task."""

import asyncio
import json
import logging
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from weakref import WeakValueDictionary

import httpx

from ..messaging.channels.base import ChannelError
from ..messaging.channels.socket import GatewaySocket
from ..paths import owner_only_directory
from .host_desktop import DesktopChrome
from .host_view import Screencast

logger = logging.getLogger(__name__)


class BrowserError(ValueError):
    pass


class ChromeProcessTree:
    """Own the Raphael Chrome process group, including children that outlive Chrome's leader."""

    def __init__(self, process):
        self.process = process
        self.job = None
        if os.name == "nt":
            from ..agent.cli.process import _WindowsJob
            self.job = _WindowsJob(process.pid)

    def empty(self):
        if self.job:
            return self.job.empty()
        try:
            os.killpg(self.process.pid, 0)
        except ProcessLookupError:
            return True
        return False

    async def close(self):
        try:
            async with asyncio.timeout(2):
                await self.process.wait()
                while not self.empty():
                    await asyncio.sleep(0.05)
        except TimeoutError:
            pass
        finally:
            if self.job:
                try:
                    if not self.job.empty():
                        self.job.terminate()
                        with suppress(TimeoutError):
                            async with asyncio.timeout(1):
                                while not self.job.empty():
                                    await asyncio.sleep(0.05)
                finally:
                    # The kernel's kill-on-close covers any member still running.
                    self.job.close()
            elif not self.empty():
                with suppress(ProcessLookupError):
                    os.killpg(self.process.pid, signal.SIGKILL)
        with suppress(TimeoutError):
            await asyncio.wait_for(self.process.wait(), 2)


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
            self.event("Browser.disconnected", {}, None)

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
    conversation: int | None = None
    turn_id: int | None = None
    finished: bool = False
    disconnected: bool = False
    cast: Screencast | None = field(default=None, repr=False)
    closed: asyncio.Event = field(default_factory=asyncio.Event, repr=False)


class HostBrowser:
    def __init__(self, profile, *, idle_seconds=900):
        self.profile = Path(profile)
        self.staging = self.profile / "downloads"
        self.idle_seconds = idle_seconds
        self.lock = asyncio.Lock()
        self.work_locks = WeakValueDictionary()
        self.opening = 0
        self.process = self.cdp = self.idle = None
        self.process_tree = None
        self.tabs, self.downloads = {}, {}
        self.owned_targets = {}
        self.startup_url = None
        self.current = {}
        self.transfers = {}
        self.held = set()
        self.acknowledgements = set()

    def work_lock(self, scope):
        lock = self.work_locks.get(scope)
        if lock is None:
            lock = self.work_locks[scope] = asyncio.Lock()
        return lock

    def live(self, tab):
        return self.cdp is not None and not self.cdp.reader.done() and self.tabs.get(tab.id) is tab

    def viewing_tab(self, member, conversation):
        return next((self.tabs[identifier] for identifier in reversed(self.current.values())
                     if identifier in self.tabs and self.tabs[identifier].member == member
                     and self.tabs[identifier].conversation in (conversation, None)), None)

    def _forget_tab(self, tab):
        self.tabs.pop(tab.id, None)
        tab.closed.set()
        if tab.cast is not None:
            tab.cast.close()
        if self.current.get(tab.scope) == tab.id:
            self.current.pop(tab.scope)
            if previous := next((other for other in reversed(self.tabs.values()) if other.scope == tab.scope), None):
                self.select(previous)

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

    async def _connect(self, endpoint=None):
        try:
            port, path = endpoint or (self.profile / "DevToolsActivePort").read_text(encoding="ascii").splitlines()
            if not 0 < int(port) < 65536 or not re.fullmatch(r"/devtools/browser/[0-9a-f-]{36}", path):
                return None
            socket = GatewaySocket("127.0.0.1", port=int(port), path=path, tls=False, message_limit=24_000_000)
            await socket.__aenter__()
        except (OSError, EOFError, ValueError, ChannelError, TimeoutError):
            return None
        return DevTools(socket, self._event)

    async def _connect_started(self, client, port):
        try:
            version = await client.get(f"http://127.0.0.1:{port}/json/version")
            version.raise_for_status()
            path = urlsplit(version.json()["webSocketDebuggerUrl"]).path
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return None
        cdp = await self._connect((port, path))
        if cdp is None:
            return None
        accepted = False
        try:
            listing = await cdp.call("Target.getTargets")
            if any(info["url"] == self.startup_url for info in listing["targetInfos"]):
                (self.profile / "DevToolsActivePort").write_text(f"{port}\n{path}\n", encoding="ascii")
                accepted = True
                return cdp
        except (BrowserError, OSError):
            pass
        finally:
            if not accepted:
                await cdp.close()
        return None

    @staticmethod
    async def _startup_page(reader, writer):
        try:
            # An unused Chrome preconnection must not hold up shutdown of the marker server.
            async with asyncio.timeout(2):
                await reader.readuntil(b"\r\n\r\n")
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            await writer.drain()
        except (OSError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            pass
        finally:
            writer.close()
            with suppress(OSError):
                await writer.wait_closed()

    async def start(self):
        """Called under lock. Returns whether a new Chrome process was started."""
        if self.cdp is not None and not self.cdp.reader.done():
            return False
        if self.cdp is not None:
            await self._stop()
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
        # An earlier Raphael release could leave a headed Chrome on this profile.
        # Close that process before launching so startup cannot reuse its desktop UI.
        if (previous := await self._connect()) is not None:
            self.cdp = previous
            await self._stop()
            async with asyncio.timeout(5):
                while (previous := await self._connect()) is not None:
                    await previous.close()
                    await asyncio.sleep(0.1)
        marker = await asyncio.start_server(self._startup_page, "127.0.0.1", 0)
        try:
            self.startup_url = f"http://127.0.0.1:{marker.sockets[0].getsockname()[1]}/{secrets.token_hex(16)}"
            # Chrome treats port zero as an automation launch. Select a loopback
            # port ourselves and verify the startup page before trusting it.
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            argv = [
                str(executable), f"--user-data-dir={self.profile}", "--remote-debugging-address=127.0.0.1",
                f"--remote-debugging-port={port}", "--no-first-run", "--no-default-browser-check",
                "--disable-background-mode", "--disable-background-networking", "--disable-session-crashed-bubble",
                "--window-size=1280,900", "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
            ]
            if os.name == "nt":
                self.process = DesktopChrome([*argv, self.startup_url])
            else:
                self.process = await asyncio.create_subprocess_exec(
                    *argv, "--window-position=-32000,-32000", self.startup_url, stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
            self.process_tree = ChromeProcessTree(self.process)
            if isinstance(self.process, DesktopChrome):
                self.process.resume()
            async with asyncio.timeout(20), httpx.AsyncClient(trust_env=False, timeout=1) as client:
                while self.cdp is None:
                    if self.process.returncode is not None:
                        raise BrowserError("chrome_start_failed")
                    self.cdp = await self._connect_started(client, port)
                    if self.cdp is None:
                        await asyncio.sleep(0.15)
            await self.cdp.call("Browser.setDownloadBehavior",
                                {"behavior": "allowAndName", "downloadPath": str(self.staging), "eventsEnabled": True})
            await self.cdp.call("Target.setDiscoverTargets", {"discover": True, "filter": [{"type": "page"}]})
            return True
        except BaseException:
            await self._stop()
            raise
        finally:
            marker.close()
            await marker.wait_closed()

    def _event(self, method, params, session):
        if method == "Browser.disconnected":
            if self.cdp is not None and self.cdp.reader is asyncio.current_task():
                for tab in list(self.tabs.values()):
                    tab.disconnected = True
                    self._forget_tab(tab)
        elif method == "Page.screencastFrame":
            task = asyncio.create_task(self._ack_frame(self.cdp, session, params["sessionId"]))
            self.acknowledgements.add(task)
            task.add_done_callback(self.acknowledgements.discard)
            for tab in self.tabs.values():
                if tab.session == session and tab.cast is not None:
                    tab.cast.frame(params)
                    break
        elif method in ("Target.targetCreated", "Target.targetInfoChanged"):
            info = params["targetInfo"]
            if info["type"] == "page" and (owner := self.owned_targets.get(info.get("openerId"))) is not None:
                self.owned_targets.setdefault(info["targetId"], owner)
        elif method in ("Target.detachedFromTarget", "Target.targetDestroyed"):
            # Losing the session does not destroy the target. Keep its owner for cleanup.
            for tab in list(self.tabs.values()):
                if tab.session == params.get("sessionId") or tab.target == params.get("targetId"):
                    self._forget_tab(tab)
            if method == "Target.targetDestroyed":
                self.owned_targets.pop(params["targetId"], None)
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

    @staticmethod
    async def _ack_frame(cdp, session, frame):
        if cdp is not None:
            with suppress(BrowserError, OSError, TimeoutError):
                await cdp.call("Page.screencastFrameAck", {"sessionId": frame}, session=session)

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

    async def open_tab(self, scope, member, workspace, conversation, *, new=False):
        self.opening += 1
        try:
            async with self.lock:
                started = await self.start()
            if new or not any(tab.scope == scope and not tab.finished for tab in self.tabs.values()):
                return await self.new_tab(scope, member, workspace, conversation), started
            return self.tab(scope), started
        finally:
            self.opening -= 1
            self._schedule_idle()

    async def new_tab(self, scope, member, workspace, conversation=None):
        target = await self._take_startup_target()
        if target is None:
            # A tab in its own window keeps a compositor surface even
            # when a peer member opens another tab.
            bounds = {"left": -32000, "top": -32000} if os.name != "nt" else {}
            target = (await self.cdp.call("Target.createTarget", {"url": "about:blank", "newWindow": True,
                                                                "background": True, **bounds}))["targetId"]
        self.owned_targets[target] = scope
        tab = None
        try:
            session = (await self.cdp.call("Target.attachToTarget", {"targetId": target, "flatten": True}))["sessionId"]
            tab = Tab(secrets.token_urlsafe(18), target, session, scope, member, workspace)
            tab.conversation = conversation
            tab.cast = Screencast(self, tab)
            self.tabs[tab.id] = tab
            await self.command(tab, "Page.enable")
            await self.command(tab, "Emulation.setDeviceMetricsOverride", {
                "width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False,
            })
            tree = await self.command(tab, "Page.getFrameTree")
            tab.frames.add(tree["frameTree"]["frame"]["id"])
        except BaseException:
            if tab is not None:
                self._forget_tab(tab)
            await self._close_targets(lambda: {target} & self.owned_targets.keys())
            raise
        self.select(tab)
        for scope in {other.scope for other in self.tabs.values()
                      if other.finished and other.scope != tab.scope and other.member == member and other.conversation == conversation}:
            await self.close_scope(scope)
        return tab

    def select(self, tab):
        self.current.pop(tab.scope, None)
        self.current[tab.scope] = tab.id

    async def command(self, tab, method, params=None):
        if self.tabs.get(tab.id) is not tab:
            raise BrowserError("browser_tab_changed")
        return await self.cdp.call(method, params, session=tab.session)

    def tab(self, scope, *identifiers):
        ids = {identifier for identifier in identifiers if identifier is not None}
        selected = ids or {self.current.get(scope)}
        matches = [tab for tab in self.tabs.values() if tab.scope == scope and not tab.finished and (selected == {tab.id} or not ids)]
        if not matches:
            raise BrowserError("browser_tab_required")
        tab = next((tab for tab in matches if tab.id in selected), matches[-1])
        self.select(tab)
        return tab

    async def close_scope(self, scope, *, keep_page=False):
        async with self.work_lock(scope):
            keep = self.tabs.get(self.current.get(scope)) if keep_page else None
            if keep is not None and (keep.handoff or self.viewing_tab(keep.member, keep.conversation) is not keep):
                keep = None
            if keep is not None:
                keep.finished = True
            else:
                self.current.pop(scope, None)
            for tab in list(self.tabs.values()):
                if tab.scope == scope and tab is not keep:
                    self._forget_tab(tab)
            await self._close_targets(lambda: {target for target, owner in self.owned_targets.items()
                                               if owner == scope and (keep is None or target != keep.target)})
            self._schedule_idle()

    async def _close_targets(self, owned):
        """Reconcile against Chrome after close; an accepted close is only a request."""
        cdp = self.cdp
        if cdp is None:
            return
        requested = {}
        try:
            async with asyncio.timeout(4):
                while self.cdp is cdp and (remaining := owned()):
                    now = asyncio.get_running_loop().time()
                    for target in remaining:
                        if target in requested and now - requested[target] < 0.5:
                            continue
                        try:
                            await cdp.call("Target.closeTarget", {"targetId": target})
                            requested[target] = now
                        except (BrowserError, OSError):
                            continue
                    listing = await cdp.call("Target.getTargets")
                    if self.cdp is not cdp:
                        return
                    live = {info["targetId"] for info in listing["targetInfos"]}
                    for target in remaining - live:
                        self.owned_targets.pop(target, None)
                    if owned():
                        await asyncio.sleep(0.05)
        except (BrowserError, OSError, TimeoutError):
            # Closing the last window can end CDP before the next query.
            # Unconfirmed targets stay tracked while a peer still uses Chrome.
            if self.cdp is cdp and cdp.reader.done():
                self.owned_targets.clear()

    def _schedule_idle(self):
        if self.idle is not None:
            self.idle.cancel()
            self.idle = None
        if not self.opening and all(tab.finished for tab in self.tabs.values()) and not self.downloads and self.cdp is not None:
            self.idle = asyncio.create_task(self._idle())

    async def _idle(self):
        reader = getattr(self.cdp, "reader", None)
        await asyncio.sleep(0 if reader is not None and reader.done() else self.idle_seconds)
        async with self.lock:
            if not self.opening and all(tab.finished for tab in self.tabs.values()) and not self.downloads:
                self.idle = None
                await self._stop()

    async def _stop(self):
        cdp, process, tree = self.cdp, self.process, self.process_tree
        self.cdp = self.process = None
        self.process_tree = None
        for tab in list(self.tabs.values()):
            self._forget_tab(tab)
        self.owned_targets.clear()
        self.startup_url = None
        self.current.clear()
        self.downloads.clear()
        try:
            if cdp is not None:
                try:
                    async with asyncio.timeout(2):
                        await cdp.call("Browser.close")
                except (BrowserError, TimeoutError, OSError):
                    pass
                with suppress(TimeoutError):
                    async with asyncio.timeout(0.5):
                        await cdp.close()
        finally:
            if tree is not None:
                try:
                    await tree.close()
                finally:
                    if isinstance(process, DesktopChrome):
                        process.close()
            elif isinstance(process, DesktopChrome):
                # Job assignment failed before the suspended Chrome could spawn.
                try:
                    if process.returncode is None:
                        process.kill()
                    with suppress(TimeoutError):
                        await asyncio.wait_for(process.wait(), 2)
                finally:
                    process.close()
            elif process is not None and process.returncode is None:
                # A failed job assignment must not leave an unowned Chrome tree.
                if os.name == "nt":
                    with suppress(OSError):
                        killer = await asyncio.create_subprocess_exec(
                            "taskkill.exe", "/PID", str(process.pid), "/T", "/F",
                            creationflags=subprocess.CREATE_NO_WINDOW, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        try:
                            await asyncio.wait_for(killer.wait(), 2)
                        except TimeoutError:
                            with suppress(ProcessLookupError):
                                killer.kill()
                if process.returncode is None:
                    with suppress(ProcessLookupError):
                        process.kill()
                with suppress(TimeoutError):
                    await asyncio.wait_for(process.wait(), 2)
            await asyncio.gather(*self.transfers, return_exceptions=True)
            await asyncio.gather(*self.acknowledgements, return_exceptions=True)

    async def aclose(self):
        async with self.lock:
            if self.idle is not None:
                self.idle.cancel()
                await asyncio.gather(self.idle, return_exceptions=True)
                self.idle = None
            await self._stop()
