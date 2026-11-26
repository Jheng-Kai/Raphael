"""Raphael's Chrome, with member-owned tabs and tab-local input."""

import asyncio
import errno
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
import stat
import subprocess
import sys
import threading
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


# What a page of Raphael's Chrome may do without asking, as a normal profile lets it, and what it is refused: no one
# answers a permission prompt there (headless on a Mac, a desktop of its own on Windows), so a request would wait for
# ever. Refusing agrees with what the page reads in Notification.permission. Adapted from OpenMausBot's table, without
# clipboard-write: on Windows the clipboard is the owner's own.
PERMISSIONS = (
    *(({"name": name}, "granted") for name in ("storage-access", "top-level-storage-access", "persistent-storage",
                                                "background-sync")),
    *(({"name": name}, "denied") for name in (
        "notifications", "geolocation", "camera", "microphone", "clipboard-read", "midi", "accelerometer", "gyroscope",
        "magnetometer", "ambient-light-sensor", "idle-detection", "local-network-access", "window-management",
        "display-capture", "nfc", "payment-handler")),
    ({"name": "midi", "sysex": True}, "denied"),
)
# A member's Chrome holds no passkey: the owner's passkeys live on their own phone or computer. A Chrome no one sees has
# nowhere to show its passkey sheet, so a request never ended and the sheet held the tab. This authenticator holds no
# passkey and verifies no one: every passkey or security-key request (sign-in, conditional, registration) ends at once
# with NotAllowedError, as a dismissed sheet does, the page offers its other ways in, and no credential is ever made.
# Adapted from OpenMausBot's.
NO_PASSKEY = {"protocol": "ctap2", "ctap2Version": "ctap2_1", "transport": "internal", "hasResidentKey": True,
              "hasUserVerification": True, "isUserVerified": False, "automaticPresenceSimulation": True}
# Each document request pauses for Chrome's sign-in prompt (HTTP authentication), which no one would see, and goes on at
# once unchanged; the prompt waits for the owner in the view, and is cancelled when no one answers it in time.
AUTH_PATTERNS = [{"urlPattern": "*", "resourceType": "Document", "requestStage": "Request"}]
AUTH_WAIT_S = 300
# What of a cookie Chrome is given again (`Storage.setCookies`) when it carries a session's over to another Chrome.
COOKIE_FIELDS = ("name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "priority", "sourceScheme",
                 "sourcePort", "partitionKey")
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


def opened_path(descriptor):
    """Where an open file really is on Windows, as its handle's final path says: a link or junction swapped in since its
    path was checked does not change it. None when Windows cannot say."""
    import ctypes
    import msvcrt
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetFinalPathNameByHandleW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
    kernel.GetFinalPathNameByHandleW.restype = ctypes.c_uint32
    buffer = ctypes.create_unicode_buffer(32768)
    length = kernel.GetFinalPathNameByHandleW(msvcrt.get_osfhandle(descriptor), buffer, len(buffer), 0)
    if not 0 < length < len(buffer):
        return None
    final = buffer.value
    return Path("\\\\" + final[8:] if final.startswith("\\\\?\\UNC\\") else final.removeprefix("\\\\?\\"))


# A folder opened only to pass through it (O_SEARCH on a Mac, O_PATH on Linux): one the owner may cross but not list still
# opens, as it does for a path.
PASS_THROUGH = (getattr(os, "O_SEARCH", 0) or getattr(os, "O_PATH", 0) or os.O_RDONLY) | FOLDER


def opened_without_links(path):
    """The file at the resolved `path`, opened for reading with every folder from the file system's root down opened from
    the one before it and nothing opened through a link (macOS and Linux): no link swapped in anywhere on its way after a
    check can lead elsewhere."""
    folder = os.open(path.anchor, PASS_THROUGH)
    try:
        for part in path.parts[1:-1]:
            inner = os.open(part, PASS_THROUGH, dir_fd=folder)
            os.close(folder)
            folder = inner
        return os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
    finally:
        os.close(folder)


async def made_off_loop(make, *args):
    """What `make(*args)` makes in the private profile (a path in a folder of its own), made in a thread. A caller gone
    first (cancelled, or the core shutting down) leaves the thread to finish, and what it made is removed with its folder:
    by the caller when the thread was done first, else by the thread itself. One lock hands it over, so it is never both
    or neither. (Chrome's start also empties the profile's uploads.)"""
    lock, state = threading.Lock(), {"made": None, "abandoned": False}

    def run():
        made = make(*args)
        with lock:
            state["made"] = made
            abandoned = state["abandoned"]
        if abandoned:
            shutil.rmtree(made.parent, ignore_errors=True)
        return made

    try:
        return await asyncio.shield(asyncio.ensure_future(asyncio.to_thread(run)))
    except asyncio.CancelledError:
        with lock:
            state["abandoned"] = True
            made = state["made"]
        if made is not None:
            shutil.rmtree(made.parent, ignore_errors=True)
        raise


def opened_in(file, folder):
    """Whether the file just created is in `folder`, as its open handle says on Windows: a link or junction swapped in
    after the folders were checked is seen there, before anything is written."""
    if os.name != "nt":
        return Path(os.path.realpath(file.name)).parent == folder
    final = opened_path(file.fileno())
    return final is not None and os.path.normcase(os.path.dirname(final)) == os.path.normcase(str(folder))


def created(path):
    """A new file at `path`, open for writing, and how to remove it again. Windows removes it through its own handle, so
    no link or junction swapped in since can lead the removal to another file. Elsewhere this placer runs only under
    test (every folder there opens relative to another), and the removal checks the path still leads to the file."""
    if os.name != "nt":
        file = path.open("xb")
        made = os.fstat(file.fileno())

        def remove():
            with suppress(OSError):
                there = os.stat(path)
                if (there.st_dev, there.st_ino) == (made.st_dev, made.st_ino):
                    os.unlink(path)

        return file, remove
    import ctypes
    import msvcrt
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                   wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetFileInformationByHandle.restype = wintypes.BOOL
    # GENERIC_WRITE | DELETE | FILE_READ_ATTRIBUTES, shared for reading, CREATE_NEW, FILE_ATTRIBUTE_NORMAL.
    handle = kernel.CreateFileW(str(path), 0x40000000 | 0x00010000 | 0x80, 0x1, None, 1, 0x80, None)
    if handle is None or handle == ctypes.c_void_p(-1).value:
        error = ctypes.get_last_error()
        if error in (80, 183):  # ERROR_FILE_EXISTS, ERROR_ALREADY_EXISTS
            raise FileExistsError(errno.EEXIST, os.strerror(errno.EEXIST), str(path))
        raise ctypes.WinError(error)

    class Disposition(ctypes.Structure):
        _fields_ = [("DeleteFile", wintypes.BOOLEAN)]

    def dispose(opened):
        # FileDispositionInfo: the file this handle opened goes when the handle closes, wherever its path now leads.
        kernel.SetFileInformationByHandle(opened, 4, ctypes.byref(Disposition(True)), ctypes.sizeof(Disposition))

    try:
        descriptor = msvcrt.open_osfhandle(handle, os.O_WRONLY | os.O_BINARY)
    except OSError:
        # Left empty, the new file would stand for a whole one: a first `.gitignore` would never be written again.
        dispose(handle)
        kernel.CloseHandle(handle)
        raise
    try:
        file = os.fdopen(descriptor, "wb")
    except OSError:
        dispose(handle)
        os.close(descriptor)
        raise
    return file, lambda: dispose(msvcrt.get_osfhandle(file.fileno()))


def create_in(folder, name, write):
    """A new file `name` in `folder`, by path: True once written whole, False when the name is taken, None when it was
    created where a link swapped in since leads (removed again, nothing written there). A failed write removes the
    half-written file, which would otherwise stand for the whole one."""
    try:
        file, remove = created(folder / name)
    except FileExistsError:
        return False
    with file:
        if not opened_in(file, folder):
            remove()
            return None
        try:
            write(file)
            file.flush()
        except OSError:
            remove()
            raise
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


def headless_chrome(shown=False):
    """Whether Raphael's Chrome runs with no window at all (#308). Windows hides it on a desktop of its own
    (`DesktopChrome`), where it draws as any shown window does. A Mac has no such desktop: it keeps every window on a
    screen and a Chrome it starts takes the front, so there Chrome runs in its own headless mode, the whole Chrome with no
    window, as OpenMausBot runs its browser. The view streams it as before (`Screencast`) and the owner works it there.
    RAPHAEL_MAC_HEADED=1 brings the old window back, to compare on a Mac. A Chrome started to be seen (`shown`, for a
    certificate the owner chooses in Chrome's own window, #345) is never headless."""
    return not shown and sys.platform == "darwin" and os.environ.get("RAPHAEL_MAC_HEADED") != "1"


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


def mac_screen():
    """The Mac's main display in points, as a page of its ordinary Chrome sees it, or a 14-inch MacBook Pro's when it
    cannot be read or is smaller than Raphael's 1280 × 900 window: headless Chrome's own 800 × 600 screen, smaller than
    its window, tells a page it is headless."""
    try:
        import ctypes

        class Rect(ctypes.Structure):
            _fields_ = [(name, ctypes.c_double) for name in ("x", "y", "width", "height")]

        graphics = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        graphics.CGMainDisplayID.restype = ctypes.c_uint32
        graphics.CGDisplayBounds.argtypes = [ctypes.c_uint32]
        graphics.CGDisplayBounds.restype = Rect
        bounds = graphics.CGDisplayBounds(graphics.CGMainDisplayID())
        size = round(bounds.width), round(bounds.height)
    except (OSError, AttributeError, ValueError):
        size = (0, 0)
    return size if 1280 <= size[0] <= 8192 and 960 <= size[1] <= 8192 else (1512, 982)


def window_arguments(mac_version, screen=(1512, 982), shown=False):
    """Where Chrome's window goes off Windows: none in headless (with the Mac's screen, and its user agent when its version
    is known), else far off every screen, which Linux keeps. A Chrome started to be seen has its window where Chrome puts it."""
    if shown:
        return []
    if headless_chrome():
        return ["--headless=new", f"--screen-info={{0,0 {screen[0]}x{screen[1]}}}",
                *([f"--user-agent={mac_user_agent(mac_version)}"] if mac_version else [])]
    return ["--window-position=-32000,-32000"]


def dialog_message(message):
    """A dialog's message as the member and the owner see it: whole up to 2000 characters, else its first and last
    thousand around a mark, with how many characters are left out between them, so that no long text pushes what it
    asks out of sight. The safety check reads the whole message (`Tab.dialog_text`)."""
    if len(message) <= 2000:
        return {"message": message}
    return {"message": f"{message[:1000]}\n…\n{message[-1000:]}", "omitted": len(message) - 2000}


def startup_pages(startup_url, shown=False):
    """The pages Chrome opens at its start: the startup marker, and a blank tab left unowned that keeps a windowed Chrome
    alive when the last member tab closes, even when that closure comes from the page. Headless Chrome takes one page only
    (on more it exits at once: "Multiple targets are not supported in headless mode") and stays alive with none."""
    return [startup_url] if headless_chrome(shown) else [startup_url, "about:blank"]


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
    # Where the last navigation was going while it has not arrived (it asked for a certificate, or is still waiting for one).
    requested: str = ""
    main_frame: str = ""
    viewport: tuple = (0, 0)
    document: int = 0
    # The JavaScript dialog that blocks the page (#336), set while it is open: Chrome holds every script and input of the
    # page until the dialog is answered, which a headless Chrome never draws.
    dialog: dict | None = None
    dialog_text: str | None = ""  # its whole message for the safety check (None: too long to judge); `dialog` shows its ends
    dialog_opened: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    # The site's sign-in prompt (HTTP authentication) waiting for the owner, which Chrome would draw as its own dialog.
    auth: dict | None = None
    auth_request: str | None = field(default=None, repr=False)
    auth_opened: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    auth_timer: "asyncio.Task | None" = field(default=None, repr=False)
    # The page's file chooser, which Chrome hands over instead of drawing: answered with browser_upload or by the owner.
    chooser: dict | None = None
    chooser_node: int | None = field(default=None, repr=False)
    # The HTML5 drag Chrome reports while a member's drag intercepts them: what the page put in the drag, to drop it with.
    drag: dict | None = field(default=None, repr=False)

    @property
    def view(self):
        return self.view_id or self.id


class HostBrowser:
    # How long a change of Chrome waits for the actions in flight on its tabs.
    SWAP_WAIT_S = 15

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
        # Chrome was started to be seen, for a certificate the owner chooses in its own window (`show_for_owner`). Only until
        # it stops: the next start is the background one again.
        self.shown = False
        self.current = {}
        self.owner_closed = {}
        self.owner_closed_current = {}
        self.transfers = {}
        self.placed = {}  # member -> the downloads placed since its last Chrome result (#331, #347)
        self.held = {}
        self.handback = {}
        self.acknowledgements = set()
        self.background = set()  # CDP answers sent from an event, which nothing waits for
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
        if tab.auth_timer is not None:
            tab.auth_timer.cancel()
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
        # Copies of files the owner chose for pages, kept while this Chrome may still read them (`owner_upload`).
        shutil.rmtree(self.profile / "uploads", ignore_errors=True)
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
            pages = startup_pages(self.startup_url, self.shown)
            headless = headless_chrome(self.shown)
            self.mac_version = mac_chrome_version(executable) if headless else ""
            if os.name == "nt":
                self.process = DesktopChrome([*argv, *pages], visible=self.shown)
            else:
                screen = mac_screen() if headless else None
                self.process = await asyncio.create_subprocess_exec(
                    *argv, *window_arguments(self.mac_version, screen, self.shown), *pages, stdin=asyncio.subprocess.DEVNULL,
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
            # A Chrome that does not know a permission keeps its own default for it.
            await asyncio.gather(*(self.cdp.call("Browser.setPermission", {"permission": permission, "setting": setting})
                                   for permission, setting in PERMISSIONS), return_exceptions=True)
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
        elif method == "Fetch.requestPaused":
            self._send(session, "Fetch.continueRequest", {"requestId": params["requestId"]})
        elif method == "Fetch.authRequired":
            self._auth_required(params, session)
        elif method == "Page.fileChooserOpened":
            for tab in self.tabs.values():
                if tab.session == session:
                    tab.chooser = {"chooser_id": secrets.token_hex(6),
                                   "mode": "multiple" if params.get("mode") == "selectMultiple" else "single"}
                    tab.chooser_node = params.get("backendNodeId")
                    self.notify_view()
                    break
        elif method == "Input.dragIntercepted":
            for tab in self.tabs.values():
                if tab.session == session:
                    tab.drag = params["data"]
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
                        # A new document: the old one's file input is gone, and a sign-in prompt still open belonged
                        # to a navigation Chrome left for this one.
                        if tab.chooser is not None or tab.auth is not None:
                            tab.chooser = tab.chooser_node = None
                            self._clear_auth(tab, tab.auth)
                            self.notify_view()
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
                task.add_done_callback(lambda done: self._placed(member, done))

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

    def _placed(self, member, task):
        if not task.cancelled() and task.exception() is None and (path := task.result()) is not None:
            self.placed.setdefault(member, []).append(path)

    def take_downloads(self, member):
        """The downloads placed for the member since it was last told, as the paths they were placed at."""
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

    async def show_for_owner(self, tab):
        """A page asked for a client certificate (#345). Chrome draws its chooser in a window, which a Chrome no one sees
        has none, so Chrome is started once more where the owner sees it, with every member's tab bound to it again
        (`_start_shown`), and the tab's window comes to the front. It stays so, the window out of the way once the owner is
        done (`tuck_away`): the certificate they chose is kept in the memory of that Chrome only. It is the background
        Chrome again only when Chrome starts anew (`_stop`), whether it idled out, quit or crashed."""
        async with self.lock:
            if not self.live(tab):
                raise BrowserError("browser_tab_changed")
            fresh = not self.shown
            if fresh:
                await self._start_shown(tab)
            await self._present(tab, fresh)

    async def _start_shown(self, first):
        """Stop Chrome and start it again to be seen, called under lock. Each tab keeps its identity (what the viewer, the
        owner's hold and a waiting card refer to) and is bound to a target of the new Chrome, given its setup again and
        opened at its page again; session cookies, which no Chrome keeps once it stops, are carried over. What a page held in
        memory is lost, as when Chrome starts anew. The tabs' locks are taken first, so no action runs on a tab meanwhile and
        one in flight is waited for; a tab still held after `SWAP_WAIT_S` leaves everything as it was."""
        held = []
        try:
            try:
                async with asyncio.timeout(self.SWAP_WAIT_S):
                    for item in list(self.tabs.values()):
                        await item.lock.acquire()
                        held.append(item)
            except TimeoutError:
                raise BrowserError("browser_tab_busy") from None
            tabs = [first, *(item for item in self.tabs.values() if item is not first and item.ready)]
            urls = {item.id: self._reopen_url(item) for item in tabs}
            cookies = await self._session_cookies()
            await self._stop(keep_tabs=True)
            self.shown = True
            try:
                await self.start()
                await self._restore_cookies(cookies)
                for item in tabs:
                    await self._rebind(item, first=item is first)
                for item in list(self.tabs.values()):
                    if item not in tabs:
                        self._forget_tab(item)  # it was being opened as Chrome stopped: nothing of it is left
            except BaseException:
                await self._stop()  # no tab is left bound to a Chrome that is gone
                raise
            for item in tabs:
                if urls[item.id]:
                    self._send(item.session, "Page.navigate", {"url": urls[item.id]})
            self.notify_view()
        finally:
            for item in held:
                item.lock.release()

    @staticmethod
    def _openable(url):
        """The page to open for `url`: none for a blank page or an address Chrome would not be sent to."""
        try:
            url = page_url(url)
        except BrowserError:
            return ""
        return "" if url == "about:blank" else url

    def _reopen_url(self, tab):
        """Where a tab goes again in another Chrome: where its last navigation was going, else the page it shows."""
        return self._openable(tab.requested or tab.url)

    async def _session_cookies(self):
        """The cookies of this Chrome that end with it (a session's). The profile keeps the others."""
        try:
            listing = await self.cdp.call("Storage.getCookies")
        except (BrowserError, OSError, TimeoutError):
            return []
        return [{key: cookie[key] for key in COOKIE_FIELDS if key in cookie}
                for cookie in listing.get("cookies", []) if cookie.get("session")]

    async def _restore_cookies(self, cookies):
        if not cookies:
            return
        try:
            await self.cdp.call("Storage.setCookies", {"cookies": cookies})
        except BrowserError:
            for cookie in cookies:  # one the new Chrome refuses must not cost the others
                with suppress(BrowserError):
                    await self.cdp.call("Storage.setCookies", {"cookies": [cookie]})

    async def _rebind(self, tab, *, first):
        """Bind the tab to a target of the Chrome just started: the window Chrome started with for the tab that asked for
        the certificate (the owner's screen), a window far off every screen for the others."""
        target = await self._take_startup_target() if first else None
        if target is None:
            target = await self._create_target()
        self.owned_targets[target] = tab.member
        session = (await self.cdp.call("Target.attachToTarget", {"targetId": target, "flatten": True}))["sessionId"]
        tab.target, tab.session = target, session
        tab.refs.clear()
        tab.frames.clear()
        tab.viewport = (0, 0)
        tab.chooser = tab.chooser_node = None
        tab.dialog, tab.dialog_text = None, ""
        tab.dialog_opened.clear()
        self._clear_auth(tab, tab.auth)
        tab.ready = False
        await self._set_up_tab(tab)
        await tab.cast.restart()

    async def _window(self, tab, bounds):
        window = (await self.cdp.call("Browser.getWindowForTarget", {"targetId": tab.target}))["windowId"]
        await self.cdp.call("Browser.setWindowBounds", {"windowId": window, "bounds": bounds})

    async def _present(self, tab, fresh):
        """The tab's window on the owner's screen, in front. A Chrome shown before may have it out of the way, and the page
        still waiting for its certificate is asked for again, as the chooser the owner left may be gone."""
        if not fresh:
            await self._window(tab, {"windowState": "normal", "left": 60, "top": 60})
            if url := self._openable(tab.requested):
                self._send(tab.session, "Page.navigate", {"url": url})
        await self.command(tab, "Page.bringToFront")

    async def tuck_away(self, tab):
        """The owner is done choosing: Chrome keeps running, and its window goes out of the way (minimized on a Mac, far off
        the screen on Windows). Only a Chrome shown for a certificate has anything to tuck away."""
        if self.shown and self.live(tab):
            await self._window(tab, {"windowState": "minimized"} if sys.platform == "darwin"
                               else {"left": -32000, "top": -32000})

    async def _create_target(self):
        # Each tab has its own compositor surface even while a peer's tab is shown.
        bounds = {"left": -32000, "top": -32000} if os.name != "nt" or self.shown else {}
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
            await self._set_up_tab(tab)
            return tab
        except BaseException:
            self._forget_tab(tab)
            raise

    async def _set_up_tab(self, tab):
        """What each tab is given on the Chrome it is bound to: again for the same tab when it is bound to another Chrome."""
        await self.command(tab, "Page.enable")
        await self.command(tab, "Page.setInterceptFileChooserDialog", {"enabled": True})
        await self.command(tab, "Fetch.enable", {"patterns": AUTH_PATTERNS, "handleAuthRequests": True})
        with suppress(BrowserError):  # a Chrome without the WebAuthn domain leaves passkey requests as they were
            await self.command(tab, "WebAuthn.enable", {"enableUI": False})
            await self.command(tab, "WebAuthn.addVirtualAuthenticator", {"options": NO_PASSKEY})
        if headless_chrome(self.shown):
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

    def _send(self, session, method, params):
        """A CDP command an event answers, which nothing waits for: Chrome may have dropped what it answers meanwhile."""
        cdp = self.cdp
        if cdp is None:
            return

        async def send():
            with suppress(BrowserError, OSError, TimeoutError):
                await cdp.call(method, params, session=session)

        task = asyncio.create_task(send())
        self.background.add(task)
        task.add_done_callback(self.background.discard)

    def _auth_required(self, params, session):
        """The site asks for a sign-in in Chrome's own prompt (HTTP authentication), which no one would see. A proxy's is
        never answered; a site's waits on its tab for the owner, the newest one when another comes."""
        challenge = params.get("authChallenge") or {}
        tab = next((tab for tab in self.tabs.values() if tab.session == session), None)
        if tab is None or challenge.get("source") == "Proxy":
            self._send(session, "Fetch.continueWithAuth",
                       {"requestId": params["requestId"], "authChallengeResponse": {"response": "CancelAuth"}})
            return
        if tab.auth is not None:
            self._send(session, "Fetch.continueWithAuth",
                       {"requestId": tab.auth_request, "authChallengeResponse": {"response": "CancelAuth"}})
            self._clear_auth(tab, tab.auth)
        tab.auth = auth = {"auth_id": secrets.token_hex(6), "origin": str(challenge.get("origin", ""))[:300],
                           "realm": str(challenge.get("realm", ""))[:300],
                           "scheme": str(challenge.get("scheme", "basic")).lower()[:40]}
        tab.auth_request = params["requestId"]
        tab.auth_opened.set()

        async def expire():
            await asyncio.sleep(AUTH_WAIT_S)
            if tab.auth is auth:
                tab.auth_timer = None
                with suppress(BrowserError, OSError, TimeoutError):
                    await self.answer_auth(tab, auth, None)

        tab.auth_timer = asyncio.create_task(expire())
        self.notify_view()

    def _clear_auth(self, tab, auth):
        if auth is None or tab.auth is not auth:
            return
        tab.auth = tab.auth_request = None
        tab.auth_opened.clear()
        if tab.auth_timer is not None and tab.auth_timer is not asyncio.current_task():
            tab.auth_timer.cancel()
        tab.auth_timer = None
        self.notify_view()

    async def answer_auth(self, tab, auth, credentials):
        """Answer the sign-in prompt that waits on the tab: the owner's (user name, password), or None to cancel it."""
        request = tab.auth_request
        self._clear_auth(tab, auth)
        response = ({"response": "ProvideCredentials", "username": credentials[0], "password": credentials[1]}
                    if credentials is not None else {"response": "CancelAuth"})
        await self.command(tab, "Fetch.continueWithAuth", {"requestId": request, "authChallengeResponse": response})

    async def choose_files(self, tab, chooser, paths):
        """Give the page's file chooser these files, as choosing them in Chrome's own dialog would: its input changes. Only
        the chooser they were chosen for takes them: one gone or replaced while they were made ready takes none."""
        if tab.chooser is not chooser:
            raise BrowserError("browser_chooser_changed")
        node = tab.chooser_node
        tab.chooser = tab.chooser_node = None
        self.notify_view()
        await self.command(tab, "DOM.setFileInputFiles", {"files": [str(path) for path in paths], "backendNodeId": node})

    async def member_upload(self, path, allowed, limit):
        """A copy, in a folder of its own in the private profile, of the member's file at the resolved and checked `path`
        for a page's file chooser, kept until this Chrome starts again. It is read through the file opened there, never
        through a link: on a Mac and on Linux every folder on its way is opened from the one before it and nothing opens
        through a link, and on Windows `allowed` judges where the open file really is (its final path). A link swapped in
        after the path was checked leads to no file outside the work folder (R-COMP-HOST-02). Nothing but a regular file
        of at most `limit` bytes is copied."""
        try:
            descriptor = (opened_without_links(path) if HANDLES
                          else os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0)))
        except (OSError, ValueError):
            raise BrowserError("browser_upload_path") from None
        source = os.fdopen(descriptor, "rb")
        try:
            status = os.fstat(source.fileno())
            if (not stat.S_ISREG(status.st_mode) or status.st_size > limit
                    or not HANDLES and ((really := opened_path(source.fileno())) is None or not allowed(really))):
                raise BrowserError("browser_upload_path")
        except BaseException:
            source.close()
            raise
        return await made_off_loop(self._copy_upload, source, path.name, limit)

    def _copy_upload(self, source, name, limit):
        """The copy itself, in a thread that owns `source` from here on and closes it."""
        with source:
            folder = self.profile / "uploads" / secrets.token_hex(8)
            folder.mkdir(parents=True)
            target = folder / name
            try:
                with target.open("xb") as copy:
                    left = limit
                    while chunk := source.read(min(1 << 20, left + 1)):
                        left -= len(chunk)
                        if left < 0:
                            raise BrowserError("browser_upload_path")  # it grew past the limit while copied
                        copy.write(chunk)
            except BaseException:
                shutil.rmtree(folder, ignore_errors=True)
                raise
        return target

    def owner_upload(self, source, name):
        """A copy of a file the owner chose for a page, under its own name in a folder of its own in the private profile,
        kept until this Chrome starts again: the page reads the file only when it sends it. A copy that fails leaves
        nothing (a disk full partway, say)."""
        folder = self.profile / "uploads" / secrets.token_hex(8)
        folder.mkdir(parents=True)
        target = folder / name
        try:
            try:
                os.link(source, target)  # the upload store is on the same disk: no second copy of a large file
            except OSError:
                shutil.copyfile(source, target)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        return target

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

    async def _stop(self, *, keep_tabs=False):
        """Stop Chrome. With `keep_tabs` the tabs, and what refers to them, stay for `show_for_owner` to bind them to the
        next Chrome; nothing else may use them meanwhile."""
        cdp, process, tree = self.cdp, self.process, self.process_tree
        self.cdp = self.process = None
        self.process_tree = None
        if keep_tabs and cdp is not None:
            cdp.event = lambda *args: None  # the old Chrome's targets going away forget no tab
        background = [*self.popups.values(), *self.icons.values(), *self.background]
        for task in background:
            task.cancel()
        await asyncio.gather(*background, return_exceptions=True)
        if not keep_tabs:
            self.shown = False  # the next Chrome is the background one again
            for tab in list(self.tabs.values()):
                self._forget_tab(tab)
            self.current.clear()
            self.held.clear()
            self.handback.clear()
        self.owned_targets.clear()
        self.startup_url = None
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
