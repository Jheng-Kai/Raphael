"""Raphael's Chrome, with member-owned tabs and tab-local input."""

import asyncio
import json
import logging
import os
import platform
import plistlib
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from ..messaging.channels.base import ChannelError
from ..messaging.channels.socket import GatewaySocket
from ..paths import owner_only_directory
from .host_desktop import DesktopChrome
from .host_view import Screencast

logger = logging.getLogger(__name__)
VIEWPORT = (1280, 900)

FAVICON = """(async () => {
    const link = [...document.querySelectorAll('link[rel~="icon"]')].at(-1);
    const url = new URL(link?.href || "/favicon.ico", location.href);
    if (!["http:", "https:", "data:"].includes(url.protocol)) return "";
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url.href;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    canvas.getContext("2d").drawImage(image, 0, 0, 24, 24);
    return canvas.toDataURL("image/png");
})()"""


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


DOWNLOADS = Path(".raphael") / "downloads"  # where a page's download is placed in the member's work folder (#331)
IGNORE = "# Raphael's own files, such as members' downloads.\n*\n"
# Where a folder can be opened relative to another, each folder of `.raphael/downloads` is opened from the one before it
# and never through a link, so nothing can swap a link in between a check and the write (macOS and Linux).
HANDLES = (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY")
           and {os.open, os.mkdir, os.unlink} <= os.supports_dir_fd)
FOLDER = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
NEW_FILE = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)


def place_by_handle(workspace, name, data):
    folders = [os.open(workspace, FOLDER)]
    try:
        for part in DOWNLOADS.parts:
            with suppress(FileExistsError):
                os.mkdir(part, dir_fd=folders[-1])
            folders.append(os.open(part, FOLDER, dir_fd=folders[-1]))  # a link here fails to open (O_NOFOLLOW)
            if part == DOWNLOADS.parts[0]:
                try:
                    ignore = os.open(".gitignore", NEW_FILE, 0o644, dir_fd=folders[-1])
                except FileExistsError:
                    continue
                try:
                    with os.fdopen(ignore, "w", encoding="utf-8") as file:
                        file.write(IGNORE)
                except OSError:
                    # Half written, it would stand in for the whole one forever: gone, the next download writes it again.
                    with suppress(OSError):
                        os.unlink(".gitignore", dir_fd=folders[-1])
                    raise
        for index in range(1000):
            candidate = name if not index else f"{index}-{name}"
            try:
                output = os.open(candidate, NEW_FILE, 0o644, dir_fd=folders[-1])
            except FileExistsError:
                continue
            try:
                with os.fdopen(output, "wb") as file:
                    shutil.copyfileobj(data, file)
            except OSError:
                with suppress(OSError):
                    os.unlink(candidate, dir_fd=folders[-1])
                raise
            return workspace / DOWNLOADS / candidate
        return None
    finally:
        for folder in folders:
            os.close(folder)


def opened_in(file, folder):
    """Whether the file just created is in `folder`, as its open handle says on Windows: a link or junction swapped in
    after the folders were checked is seen there, before anything is written."""
    if os.name != "nt":
        return Path(os.path.realpath(file.name)).parent == folder
    import ctypes
    import msvcrt
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetFinalPathNameByHandleW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
    kernel.GetFinalPathNameByHandleW.restype = ctypes.c_uint32
    buffer = ctypes.create_unicode_buffer(32768)
    length = kernel.GetFinalPathNameByHandleW(msvcrt.get_osfhandle(file.fileno()), buffer, len(buffer), 0)
    if not 0 < length < len(buffer):
        return False
    final = buffer.value
    final = "\\\\" + final[8:] if final.startswith("\\\\?\\UNC\\") else final.removeprefix("\\\\?\\")
    return os.path.normcase(os.path.dirname(final)) == os.path.normcase(str(folder))


def remove_made(path, made):
    """Removes the file this placer created at `path` only while the path still leads to that very file: a link swapped
    in since would lead it to a file of the project, which stays."""
    with suppress(OSError):
        there = os.stat(path)
        if (there.st_dev, there.st_ino) == (made.st_dev, made.st_ino):
            os.unlink(path)


def create_in(folder, name, write):
    """A new file `name` in `folder`, by path: True once written whole, False when the name is taken, None when it was
    created where a link swapped in since leads (removed again, nothing written there). A failed write removes the
    half-written file, which would otherwise stand for the whole one."""
    path = folder / name
    try:
        file = path.open("xb")
    except FileExistsError:
        return False
    made = os.fstat(file.fileno())
    try:
        with file:
            inside = opened_in(file, folder)
            if inside:
                write(file)
    except OSError:
        remove_made(path, made)
        raise
    if not inside:
        remove_made(path, made)
        return None
    return True


def place_by_path(workspace, name, data):
    """Windows, which opens no folder relative to another: each folder is checked to be no link or junction, and each
    created file to be in its folder before anything is written."""
    folder = workspace / DOWNLOADS
    for part in (folder.parent, folder):
        if part.is_symlink() or part.is_junction():
            return None
        part.mkdir(exist_ok=True)
        if part.resolve() != part:
            return None
    if create_in(folder.parent, ".gitignore", lambda file: file.write(IGNORE.encode())) is None:
        return None
    for index in range(1000):
        candidate = name if not index else f"{index}-{name}"
        placed = create_in(folder, candidate, lambda file: shutil.copyfileobj(data, file))
        if placed is None:
            return None
        if placed:
            return folder / candidate
    return None


def headless_chrome():
    """Whether Raphael's Chrome runs with no window at all (#308). Windows hides it on a desktop of its own
    (`DesktopChrome`), where it draws as any shown window does. A Mac has no such desktop: it keeps every window on a
    screen and a Chrome it starts takes the front, so there Chrome runs in its own headless mode, the whole Chrome with no
    window, as OpenMausBot runs its browser. The view streams it as before (`Screencast`) and the owner works it there.
    RAPHAEL_MAC_HEADED=1 brings the old window back, to compare on a Mac."""
    return sys.platform == "darwin" and os.environ.get("RAPHAEL_MAC_HEADED") != "1"


def mac_chrome_version(executable):
    """The installed Chrome's version from its app bundle (`Info.plist`), read without starting it: "" when it cannot be."""
    try:
        with open(Path(executable).parents[1] / "Info.plist", "rb") as file:
            version = plistlib.load(file).get("CFBundleShortVersionString", "")
    except (OSError, IndexError, ValueError, plistlib.InvalidFileException):
        return ""
    return version if isinstance(version, str) and re.fullmatch(r"\d+(?:\.\d+){1,3}", version) else ""


def mac_user_agent(version):
    """The user agent of the ordinary Chrome of a Mac (Chrome reports its major version and a fixed macOS version), so a
    page sees no HeadlessChrome in a request: a site that refuses headless browsers, Google's sign-in first, sees Chrome."""
    return (f"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{version.split('.')[0]}.0.0.0 Safari/537.36")


def mac_user_agent_metadata(version):
    """What `navigator.userAgentData` and the client hints say, as the ordinary Chrome of a Mac says it: its brands
    without HeadlessChrome."""
    major = version.split(".")[0]
    return {
        "brands": [{"brand": "Google Chrome", "version": major}, {"brand": "Chromium", "version": major},
                   {"brand": "Not_A Brand", "version": "24"}],
        "fullVersionList": [{"brand": "Google Chrome", "version": version}, {"brand": "Chromium", "version": version},
                            {"brand": "Not_A Brand", "version": "24.0.0.0"}],
        "fullVersion": version, "platform": "macOS", "platformVersion": "",
        "architecture": "arm" if platform.machine() == "arm64" else "x86", "model": "", "mobile": False,
        "bitness": "64", "wow64": False,
    }


def window_arguments(mac_version):
    """Where Chrome's window goes off Windows: none in headless (with the Mac's user agent when its version is known),
    else far off every screen, which Linux keeps."""
    if headless_chrome():
        return ["--headless=new", *([f"--user-agent={mac_user_agent(mac_version)}"] if mac_version else [])]
    return ["--window-position=-32000,-32000"]


def dialog_message(message):
    """A dialog's message as the member and the owner see it: whole up to 2000 characters, else its first and last
    thousand around a mark, with how many characters are left out between them, so that no long text pushes what it
    asks out of sight. The safety check reads the whole message (`Tab.dialog_text`)."""
    if len(message) <= 2000:
        return {"message": message}
    return {"message": f"{message[:1000]}\n…\n{message[-1000:]}", "omitted": len(message) - 2000}


def startup_pages(startup_url):
    """The pages Chrome opens at its start: the startup marker, and a blank tab left unowned that keeps a windowed Chrome
    alive when the last member tab closes, even when that closure comes from the page. Headless Chrome takes one page only
    (on more it exits at once: "Multiple targets are not supported in headless mode") and stays alive with none."""
    return [startup_url] if headless_chrome() else [startup_url, "about:blank"]


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
    member: int
    workspace: Path
    refs: dict = field(default_factory=dict)
    frames: set = field(default_factory=set)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)
    conversation: int | None = None
    turn_id: int | None = None
    work: tuple | None = None
    finished: bool = False
    disconnected: bool = False
    cast: Screencast | None = field(default=None, repr=False)
    closed: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    view_id: str = ""
    opener: "Tab | None" = field(default=None, repr=False)
    title: str = ""
    url: str = "about:blank"
    favicon: str = ""
    ready: bool = True
    main_frame: str = ""
    viewport: tuple = (0, 0)
    document: int = 0
    # The JavaScript dialog that blocks the page (#336), set while it is open: Chrome holds every script and input of the
    # page until the dialog is answered, which a headless Chrome never draws.
    dialog: dict | None = None
    dialog_text: str | None = ""  # its whole message for the safety check (None: too long to judge); `dialog` shows its ends
    dialog_opened: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    @property
    def view(self):
        return self.view_id or self.id


class HostBrowser:
    def __init__(self, profile):
        self.profile = Path(profile)
        self.staging = self.profile / "downloads"
        self.lock = asyncio.Lock()
        self.process = self.cdp = None
        self.process_tree = None
        self.tabs, self.downloads = {}, {}
        # Where a finished download is placed for a member (`HostComputerTools.download_folder`); its tab's folder without it.
        self.download_to = None
        self.owned_targets = {}
        self.startup_url = None
        self.mac_version = ""  # the installed Chrome's version where it runs headless (`headless_chrome`)
        self.current = {}
        self.owner_closed = {}
        self.owner_closed_current = {}
        self.transfers = {}
        self.placed = {}  # member -> the downloads placed since its last Chrome result (#331)
        self.held = {}
        self.handback = {}
        self.acknowledgements = set()
        self.popups = {}
        self.icons = {}
        self.changed = asyncio.Event()

    def notify_view(self):
        self.changed.set()
        self.changed = asyncio.Event()

    def member_tabs(self, member):
        return [tab for tab in self.tabs.values() if tab.member == member and tab.ready]

    def selected(self, member):
        return self.tabs.get(self.current.get(member))

    @asynccontextmanager
    async def action_lock(self, tab):
        try:
            async with asyncio.timeout(2):
                await tab.lock.acquire()
        except TimeoutError:
            raise BrowserError("browser_tab_busy") from None
        try:
            if not self.live(tab):
                raise BrowserError("browser_tab_changed")
            yield
        finally:
            tab.lock.release()

    def live(self, tab):
        return self.cdp is not None and not self.cdp.reader.done() and self.tabs.get(tab.id) is tab

    @staticmethod
    def lineage(tab):
        while tab is not None:
            yield tab
            tab = tab.opener

    def related_tabs(self, first, second):
        return any(tab is first for tab in self.lineage(second)) or any(tab is second for tab in self.lineage(first))

    def handback_tab(self, tab):
        selected = self.selected(tab.member)
        if selected is not None and self.related_tabs(tab, selected):
            return selected
        return next((item for item in self.lineage(tab) if self.live(item)), None)

    def member_blocked(self, tab):
        handback = self.handback.get(tab.member)
        return self.held.get(tab.member) is tab or (handback is not None and self.related_tabs(tab, handback))

    def _forget_tab(self, tab):
        self.tabs.pop(tab.id, None)
        tab.closed.set()
        if task := self.icons.pop(tab.id, None):
            task.cancel()
        if tab.cast is not None:
            tab.cast.close()
        if self.current.get(tab.member) == tab.id:
            self.current.pop(tab.member)
            previous = next((item for item in self.lineage(tab.opener) if self.tabs.get(item.id) is item),
                            next(iter(reversed(self.member_tabs(tab.member))), None))
            if previous is not None:
                self.select(previous)
        if self.held.get(tab.member) is tab:
            self.held[tab.member] = self.selected(tab.member)
        self.notify_view()

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
            pages = startup_pages(self.startup_url)
            self.mac_version = mac_chrome_version(executable) if headless_chrome() else ""
            if os.name == "nt":
                self.process = DesktopChrome([*argv, *pages])
            else:
                self.process = await asyncio.create_subprocess_exec(
                    *argv, *window_arguments(self.mac_version), *pages, stdin=asyncio.subprocess.DEVNULL,
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
            if info["type"] == "page":
                self._page_target(info)
        elif method in ("Target.detachedFromTarget", "Target.targetDestroyed"):
            # Losing the session does not destroy the target. Keep its owner for cleanup.
            for tab in list(self.tabs.values()):
                if tab.session == params.get("sessionId") or tab.target == params.get("targetId"):
                    self._forget_tab(tab)
            if method == "Target.targetDestroyed":
                self.owned_targets.pop(params["targetId"], None)
        elif method == "Page.frameNavigated":
            for tab in self.tabs.values():
                if tab.session == session:
                    tab.refs.clear()
                    tab.frames.add(params["frame"]["id"])
                    if "parentId" not in params["frame"]:
                        tab.document += 1
                        tab.main_frame = params["frame"]["id"]
                        self._update_page(tab, url=params["frame"]["url"])
        elif method in ("Page.loadEventFired", "Page.navigatedWithinDocument"):
            for tab in self.tabs.values():
                if tab.session == session:
                    if method == "Page.navigatedWithinDocument" and params["frameId"] == tab.main_frame:
                        self._update_page(tab, url=params["url"])
                    if method == "Page.loadEventFired":
                        self._refresh_icon(tab)
                    break
        elif method == "Page.frameDetached":
            for tab in self.tabs.values():
                if tab.session == session:
                    tab.refs.clear()
                    tab.frames.discard(params["frameId"])
        elif method == "Page.javascriptDialogOpening":
            for tab in self.tabs.values():
                if tab.session == session:
                    kind, message = params.get("type", "alert"), str(params.get("message", ""))
                    tab.dialog_text = message if len(message) <= 200_000 else None
                    tab.dialog = {"dialog_id": secrets.token_hex(6), "type": kind, **dialog_message(message),
                                  **({"default_prompt": str(params.get("defaultPrompt", ""))[:2000]}
                                     if kind == "prompt" else {})}
                    tab.dialog_opened.set()
                    break
        elif method == "Page.javascriptDialogClosed":
            for tab in self.tabs.values():
                if tab.session == session:
                    tab.dialog = None
                    tab.dialog_opened.clear()
                    break
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
                if self.download_to is not None:
                    workspace = self.download_to(member)
                task = asyncio.create_task(asyncio.to_thread(self._place_download, guid, workspace, name))
                self.transfers[task] = member
                task.add_done_callback(self.transfers.pop)
                task.add_done_callback(lambda done: self._placed(member, workspace, done))

    def _page_target(self, info):
        target = info["targetId"]
        for tab in self.tabs.values():
            if tab.target == target:
                self._update_page(tab, title=info.get("title"), url=info.get("url"))
                return
        opener = info.get("openerId")
        if target in self.owned_targets or (member := self.owned_targets.get(opener)) is None:
            return
        self.owned_targets[target] = member
        parent = next((tab for tab in self.tabs.values() if tab.target == opener), None)
        pending = self.popups.get(opener)
        if parent or pending:
            task = asyncio.create_task(self._adopt_popup(self.cdp, info, member, parent, pending))
            self.popups[target] = task
            task.add_done_callback(lambda _: self._popup_finished(target))

    def _popup_finished(self, target):
        self.popups.pop(target, None)
        self.notify_view()

    async def wait_handback_closed(self, tab):
        while self.handback_tab(tab) is not None:
            await self.changed.wait()

    async def _adopt_popup(self, cdp, info, member, parent, pending):
        target = info["targetId"]
        if pending is not None:
            parent = await asyncio.shield(pending)
        if parent is None or self.cdp is not cdp or self.owned_targets.get(target) != member:
            return None
        try:
            async with asyncio.timeout(5):
                tab = await self._attach_tab(target, member, parent.workspace, parent.conversation,
                                             info=info, opener=parent)
        except (BrowserError, OSError, TimeoutError, KeyError):
            return None
        if self.owned_targets.get(target) != member or self.cdp is not cdp:
            self._forget_tab(tab)
            return None
        if self.held.get(member) is parent:
            self.held[member] = tab
            self.select(tab)
        else:
            self.select_for_member(tab)
        return tab

    async def wait_popups(self, member):
        pending = [task for target, task in self.popups.items() if self.owned_targets.get(target) == member]
        if pending:
            await asyncio.gather(*(asyncio.shield(task) for task in pending), return_exceptions=True)

    def _update_page(self, tab, *, title=None, url=None):
        if title is not None:
            tab.title = title[:512]
        if url and url != tab.url:
            tab.url = url
            tab.favicon = ""
            if task := self.icons.pop(tab.id, None):
                task.cancel()

    def _refresh_icon(self, tab):
        if not tab.url.startswith(("https://", "http://")) or tab.id in self.icons:
            return
        task = self.icons[tab.id] = asyncio.create_task(self._read_icon(tab))
        task.add_done_callback(lambda done: self.icons.pop(tab.id, None) if self.icons.get(tab.id) is done else None)

    async def _read_icon(self, tab):
        # Read the site's icon in Chrome, under the page's own origin and CORS policy.
        from . import host_page

        try:
            async with asyncio.timeout(2):
                icon, _ = await host_page.evaluate(self, tab, FAVICON, await_promise=True)
                if isinstance(icon, str) and len(icon) < 8192 and icon.startswith("data:image/png;base64,"):
                    tab.favicon = icon
        except (BrowserError, OSError, TimeoutError, KeyError):
            pass

    @staticmethod
    async def _ack_frame(cdp, session, frame):
        if cdp is not None:
            with suppress(BrowserError, OSError, TimeoutError):
                await cdp.call("Page.screencastFrameAck", {"sessionId": frame}, session=session)

    def _placed(self, member, workspace, task):
        if not task.cancelled() and task.exception() is None and (path := task.result()) is not None:
            self.placed.setdefault(member, []).append(path.relative_to(workspace).as_posix())

    def take_downloads(self, member):
        """The downloads placed for the member since it was last told, as paths in its work folder."""
        return self.placed.pop(member, [])

    def _place_download(self, guid, workspace, suggested):
        """Place a finished download in `.raphael/downloads` of the work folder (#331), never at its root: a page can start
        a download without a click, and a file such as conftest.py or a Makefile at a project's root runs with the
        project's next test or build. A `.gitignore` there keeps the folder out of git, a link there is never followed,
        and a name in use gets a numbered name. Returns the placed path, or None."""
        name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "_", suggested)[:180].strip(" .")
        if not name or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\..*)?", name):
            name = "download"
        if not re.fullmatch(r"[0-9a-f-]{36}", guid):
            return None
        source = self.staging / guid
        try:
            if workspace.resolve() != workspace or source.is_symlink():
                return None
            workspace.mkdir(parents=True, exist_ok=True)
            with source.open("rb") as data:
                placed = (place_by_handle if HANDLES else place_by_path)(workspace, name, data)
            if placed is not None:
                source.unlink()
            return placed
        except OSError:
            # Chrome keeps the staged file if it could not be placed in the work folder.
            return None

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

    async def open_tab(self, member, workspace, conversation, *, new=False):
        async with self.lock:
            started = await self.start()
            selected = self.selected(member)
            if new or selected is None:
                return await self.new_tab(member, workspace, conversation), started
            return selected, started

    async def restart_if_disconnected(self):
        if self.cdp is not None and self.cdp.reader.done():
            async with self.lock:
                await self.start()

    async def _create_target(self):
        # Each tab has its own compositor surface even while a peer's tab is shown.
        bounds = {"left": -32000, "top": -32000} if os.name != "nt" else {}
        return (await self.cdp.call("Target.createTarget", {"url": "about:blank", "newWindow": True,
                                                            "background": True, **bounds}))["targetId"]

    async def new_tab(self, member, workspace, conversation=None, *, previous=None):
        target = await self._take_startup_target()
        if target is None:
            target = await self._create_target()
        self.owned_targets[target] = member
        try:
            tab = await self._attach_tab(target, member, workspace, conversation, opener=previous)
        except BaseException:
            await self._close_targets(lambda: {target} & self.owned_targets.keys())
            raise
        self.select_for_member(tab)
        return tab

    async def _attach_tab(self, target, member, workspace, conversation, *, info=None, opener=None):
        session = (await self.cdp.call("Target.attachToTarget", {"targetId": target, "flatten": True}))["sessionId"]
        if self.owned_targets.get(target) != member:
            raise BrowserError("browser_tab_changed")
        previous = opener or self.selected(member)
        tab = Tab(secrets.token_urlsafe(18), target, session, member, workspace, conversation=conversation,
                  turn_id=opener.turn_id if opener else None, work=opener.work if opener else None,
                  finished=bool(opener and opener.finished), ready=False,
                  view_id=previous.view if previous else "", opener=opener)
        tab.cast = Screencast(self, tab)
        self.tabs[tab.id] = tab
        if info:
            self._update_page(tab, title=info.get("title"), url=info.get("url"))
        try:
            await self.command(tab, "Page.enable")
            if headless_chrome():
                # No window holds the focus in headless: each page is told it has it, and it names itself as the ordinary
                # Chrome of a Mac in navigator.userAgentData too (the request's user agent is set at the start).
                await self.command(tab, "Emulation.setFocusEmulationEnabled", {"enabled": True})
                if self.mac_version:
                    await self.command(tab, "Emulation.setUserAgentOverride", {
                        "userAgent": mac_user_agent(self.mac_version),
                        "userAgentMetadata": mac_user_agent_metadata(self.mac_version)})
            await self.resize(tab, *VIEWPORT)
            tree = await self.command(tab, "Page.getFrameTree")
            frame = tree["frameTree"]["frame"]
            tab.main_frame = frame["id"]
            tab.frames.add(tab.main_frame)
            tab.ready = True
            self._refresh_icon(tab)
            return tab
        except BaseException:
            self._forget_tab(tab)
            raise

    async def resize(self, tab, width, height):
        async with tab.cast.lock:
            if tab.viewport != (width, height):
                await self.command(tab, "Emulation.setDeviceMetricsOverride", {
                    "width": width, "height": height, "deviceScaleFactor": 1, "mobile": False,
                })
                tab.viewport = (width, height)

    async def activate(self, tab):
        if not self.live(tab):
            raise BrowserError("browser_tab_changed")
        await self.command(tab, "Page.bringToFront")
        if not self.live(tab):
            raise BrowserError("browser_tab_changed")
        self.select(tab)

    def select(self, tab):
        previous = self.current.get(tab.member)
        self.current[tab.member] = tab.id
        if previous != tab.id:
            self.notify_view()

    def select_for_member(self, tab):
        current = self.selected(tab.member)
        if current is None or not self.member_blocked(current) or self.member_blocked(tab):
            self.select(tab)

    async def answer_dialog(self, tab, dialog, accept, text=None):
        """Answer the JavaScript dialog that blocks the tab (#336): the member's browser_dialog, or the owner in the view."""
        await self.command(tab, "Page.handleJavaScriptDialog",
                           {"accept": accept, **({"promptText": text} if text is not None else {})})
        if tab.dialog is dialog:  # unless Chrome already reported it closed and another opened
            tab.dialog = None
            tab.dialog_opened.clear()
        tab.refs.clear()

    async def command(self, tab, method, params=None):
        cdp = self.cdp
        if cdp is None or self.tabs.get(tab.id) is not tab:
            raise BrowserError("browser_tab_changed")
        return await cdp.call(method, params, session=tab.session)

    def tab(self, member, *identifiers):
        ids = {identifier for identifier in identifiers if identifier is not None}
        identifier = next(iter(ids), self.current.get(member))
        tab = self.tabs.get(identifier)
        if len(ids) > 1 or tab is None or tab.member != member or not tab.ready or not self.live(tab):
            raise BrowserError("browser_tab_required")
        return tab

    async def close_tab(self, tab, *, by_owner=False):
        was_current = self.selected(tab.member) is tab
        if by_owner:
            self.owner_closed[tab.id] = tab.member
            if len(self.owner_closed) > 512:
                self.owner_closed.pop(next(iter(self.owner_closed)))
        await self._close_targets(lambda: {tab.target} & self.owned_targets.keys())
        if tab.target in self.owned_targets:
            if by_owner:
                self.owner_closed.pop(tab.id, None)
            raise BrowserError("chrome_command_failed")
        if self.tabs.get(tab.id) is tab:
            self._forget_tab(tab)
        if by_owner and was_current:
            self.owner_closed_current[tab.member] = tab.id

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
                    if not owned():
                        return
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

    async def _stop(self):
        cdp, process, tree = self.cdp, self.process, self.process_tree
        self.cdp = self.process = None
        self.process_tree = None
        background = [*self.popups.values(), *self.icons.values()]
        for task in background:
            task.cancel()
        await asyncio.gather(*background, return_exceptions=True)
        for tab in list(self.tabs.values()):
            self._forget_tab(tab)
        self.owned_targets.clear()
        self.startup_url = None
        self.current.clear()
        self.held.clear()
        self.handback.clear()
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
            await self._stop()
