"""What the assistant does to this computer, behind an interface a test can replace.

`DeviceActions` is everything the assistant does that only the system can do: open a page or a page
of the settings, press a media key, lock the screen, list and start the apps of the Start menu (the
Applications folders on a Mac), and put text on the clipboard. `WindowsActions` does them with
ctypes, `os.startfile` and PowerShell, and imports nothing of Windows at import time; `MacActions`
does them with `open`, `osascript` and `pbcopy`; the tests give both fakes for all of it.
`NullActions` does nothing, for a core that runs without a device (the fake LLM of the end-to-end
runs). `system_actions` is the one of the system the core runs on.

Every method blocks for a moment or more (PowerShell takes seconds), so the assistant calls them
on a worker thread, never on the event loop.
"""

import base64
import binascii
import ctypes
import json
import os
import plistlib
import re
import subprocess
import sys
import time
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .opening import SETTINGS_URIS, validate_url

# The virtual-key codes of the keys that change the volume and drive the media that plays.
VIRTUAL_KEYS = {
    "volume_up": 0xAF,
    "volume_down": 0xAE,
    "volume_mute": 0xAD,
    "play_pause": 0xB3,
    "next_track": 0xB0,
    "previous_track": 0xB1,
}
KEYEVENTF_KEYUP = 0x0002
# No console window flashes up for the helper processes.
CREATE_NO_WINDOW = 0x08000000
CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002
# Get-StartApps takes a few seconds the first time; this is the longest it is waited for.
START_APPS_TIMEOUT_S = 30.0
# Another program may hold the clipboard for a moment: it is tried this many times, this far apart.
CLIPBOARD_ATTEMPTS = 10
CLIPBOARD_RETRY_S = 0.05
_MAX_KEY_PRESSES = 20

# The names and ids of the Start menu apps, as JSON in base64: the bytes are plain ASCII, so the
# console's code page cannot garble a Chinese or Japanese name on the way out of PowerShell.
_LIST_APPS_SCRIPT = (
    "Get-StartApps | ConvertTo-Json -Compress | ForEach-Object "
    "{ [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_)) }"
)
# The Start menu folders hold a shortcut for each app that was installed the old way. Some of
# them are not apps: the one that uninstalls the app.
_START_MENU_FOLDER = ("Microsoft", "Windows", "Start Menu", "Programs")
_NOT_APPS = ("uninstall", "解除安裝", "解除安装", "アンインストール")
_MAX_SHORTCUTS = 5000
_NOT_AN_ID = re.compile(r"[\x00-\x1f]")
# The Start menu also holds links to web pages and settings, with an id such as "https://..." or
# "ms-settings:about"; explorer.exe does not start those as apps. (An id such as "C:\..." is a
# path, and a colon followed by a backslash is no link.)
_A_LINK = re.compile(r"[A-Za-z][A-Za-z0-9+.-]+:(?!\\)")


@dataclass(frozen=True)
class StartApp:
    name: str  # as the Start menu shows it, in the language of Windows
    app_id: str  # what `explorer.exe shell:AppsFolder\<id>` starts


def _start_menu_folders() -> list[Path]:
    """The Start menu folders of this user and of all users."""
    folders = []
    for variable in ("APPDATA", "PROGRAMDATA"):
        base = os.environ.get(variable)
        if base:
            folders.append(Path(base, *_START_MENU_FOLDER))
    return folders


def _name_key(name: str) -> str:
    return unicodedata.normalize("NFKC", name).casefold().strip()


class DeviceActions(Protocol):
    def open_url(self, url: str) -> None:
        """Open a web page (`https://`, or `http://` when it was asked for so) in the default
        browser; ValueError for an address `opening.validate_url` refuses."""
        ...

    def open_settings(self, uri: str) -> None:
        """Open a page of the Windows settings (an `ms-settings:` address of
        `opening.SETTINGS_URIS`); ValueError for any other."""
        ...

    def press_key(self, name: str, times: int = 1) -> None:
        """Press and release a key of VIRTUAL_KEYS, `times` times."""
        ...

    def lock_screen(self) -> None: ...

    def list_start_apps(self) -> list[StartApp]:
        """The apps of the Start menu. OSError if they cannot be listed."""
        ...

    def launch_app(self, app_id: str) -> None:
        """Start an app of the Start menu by its id."""
        ...

    def copy_to_clipboard(self, text: str) -> None:
        """Replace the clipboard with `text`. OSError if the clipboard cannot be written."""
        ...


class NullActions:
    """A device that does nothing."""

    def open_url(self, url: str) -> None:
        pass

    def open_settings(self, uri: str) -> None:
        pass

    def press_key(self, name: str, times: int = 1) -> None:
        pass

    def lock_screen(self) -> None:
        pass

    def list_start_apps(self) -> list[StartApp]:
        return []

    def launch_app(self, app_id: str) -> None:
        pass

    def copy_to_clipboard(self, text: str) -> None:
        pass


def _bind_user32() -> Any:
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.keybd_event.argtypes = [wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, ctypes.c_size_t]
    user32.keybd_event.restype = None
    user32.LockWorkStation.argtypes = []
    user32.LockWorkStation.restype = wintypes.BOOL
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.EmptyClipboard.argtypes = []
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.CloseClipboard.argtypes = []
    user32.CloseClipboard.restype = wintypes.BOOL
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user32.SetClipboardData.restype = wintypes.HANDLE
    return user32


def _bind_kernel32() -> Any:
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalUnlock.restype = wintypes.BOOL
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.restype = wintypes.HGLOBAL
    return kernel32


class WindowsActions:
    """`DeviceActions` on Windows. The libraries it calls are loaded when first needed, and can be
    given instead (`user32`, `kernel32`, `startfile`, `run`, `popen`, `sleep`) so that a test
    presses nothing. `start_menu` is the Start menu folders to read shortcuts from (the user's and
    all users', by default)."""

    def __init__(
        self,
        *,
        user32: Any = None,
        kernel32: Any = None,
        startfile: Callable[[str], None] | None = None,
        run: Callable[..., subprocess.CompletedProcess] = subprocess.run,
        popen: Callable[..., Any] = subprocess.Popen,
        sleep: Callable[[float], None] = time.sleep,
        start_menu: Iterable[Path] | None = None,
    ) -> None:
        self._user32 = user32
        self._kernel32 = kernel32
        self._startfile = startfile
        self._run = run
        self._popen = popen
        self._sleep = sleep
        self._start_menu = None if start_menu is None else list(start_menu)

    @property
    def user32(self) -> Any:
        if self._user32 is None:
            self._user32 = _bind_user32()
        return self._user32

    @property
    def kernel32(self) -> Any:
        if self._kernel32 is None:
            self._kernel32 = _bind_kernel32()
        return self._kernel32

    def open_url(self, url: str) -> None:
        # startfile runs whatever it is given (a program, a document, any protocol), so nothing
        # but a page of the public web goes to it.
        if validate_url(url, allow_http=True) is None:
            raise ValueError("Only a page of the public web can be opened")
        self._start(url)

    def open_settings(self, uri: str) -> None:
        if uri not in SETTINGS_URIS:
            raise ValueError("Only a page of the Windows settings can be opened")
        self._start(uri)

    def _start(self, target: str) -> None:
        startfile = self._startfile or os.startfile  # type: ignore[attr-defined]
        startfile(target)

    def press_key(self, name: str, times: int = 1) -> None:
        if name not in VIRTUAL_KEYS:
            raise ValueError(f"Unknown key {name!r}")
        if not 1 <= times <= _MAX_KEY_PRESSES:
            raise ValueError(f"A key is pressed between 1 and {_MAX_KEY_PRESSES} times")
        code = VIRTUAL_KEYS[name]
        for _ in range(times):
            self.user32.keybd_event(code, 0, 0, 0)
            self.user32.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)

    def lock_screen(self) -> None:
        if not self.user32.LockWorkStation():
            raise OSError("The screen could not be locked")

    def list_start_apps(self) -> list[StartApp]:
        """The apps of the Start menu: those PowerShell lists (the store's apps, and the others
        by their id) and the shortcuts of the Start menu folders, which need no PowerShell and so
        are there when it is slow or fails. OSError if neither gives anything and PowerShell
        failed."""
        failure: Exception | None = None
        try:
            apps = self._powershell_apps()
        except (OSError, subprocess.SubprocessError) as error:
            apps, failure = [], error
        seen = {_name_key(app.name) for app in apps}
        for shortcut in self._shortcuts():
            if _name_key(shortcut.name) not in seen:
                seen.add(_name_key(shortcut.name))
                apps.append(shortcut)
        if not apps and failure is not None:
            raise failure
        return apps

    def _folders(self) -> list[Path]:
        return _start_menu_folders() if self._start_menu is None else self._start_menu

    def _shortcuts(self) -> list[StartApp]:
        """The shortcuts of the Start menu folders, each as an app whose id is the path."""
        found: list[StartApp] = []
        for folder in self._folders():
            for directory, _, files in os.walk(folder):
                for file in sorted(files):
                    stem, dot, suffix = file.rpartition(".")
                    if not dot or suffix.lower() != "lnk" or not stem.strip():
                        continue
                    if any(word in stem.casefold() for word in _NOT_APPS):
                        continue
                    found.append(StartApp(stem.strip(), str(Path(directory, file))))
                    if len(found) >= _MAX_SHORTCUTS:
                        return found
        return found

    def _powershell_apps(self) -> list[StartApp]:
        completed = self._run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", _LIST_APPS_SCRIPT],
            capture_output=True,
            timeout=START_APPS_TIMEOUT_S,
            creationflags=CREATE_NO_WINDOW,
            check=False,
        )
        if completed.returncode != 0:
            raise OSError(f"Get-StartApps ended with {completed.returncode}")
        try:
            output = completed.stdout.strip()
            if not output:
                return []
            listed = json.loads(base64.b64decode(output, validate=True).decode("utf-8"))
        except (binascii.Error, ValueError):  # not base64, not UTF-8, not JSON
            raise OSError("The list of apps could not be read") from None
        if isinstance(listed, dict):  # ConvertTo-Json writes one app as an object
            listed = [listed]
        if not isinstance(listed, list):
            raise OSError("The list of apps could not be read")
        apps = []
        for entry in listed:
            name = entry.get("Name") if isinstance(entry, dict) else None
            app_id = entry.get("AppID") if isinstance(entry, dict) else None
            if not isinstance(name, str) or not isinstance(app_id, str):
                continue
            name, app_id = name.strip(), app_id.strip()
            if name and app_id and not _A_LINK.match(app_id):
                apps.append(StartApp(name, app_id))
        return apps

    def launch_app(self, app_id: str) -> None:
        if not app_id.strip() or _NOT_AN_ID.search(app_id):
            raise ValueError("Not an app id")
        if app_id.strip().lower().endswith(".lnk"):
            self._start(str(self._shortcut(app_id.strip())))
            return
        # Not waited for: explorer.exe ends with an exit code that means nothing here.
        self._popen(
            ["explorer.exe", f"shell:AppsFolder\\{app_id.strip()}"],
            creationflags=CREATE_NO_WINDOW,
        )

    def _shortcut(self, path: str) -> Path:
        """`path` if it is a shortcut that is in a folder of the Start menu: nothing else is
        started by its path. ValueError if it is not."""
        resolved = Path(path).resolve()
        for folder in self._folders():
            if resolved.is_file() and folder.resolve() in resolved.parents:
                return resolved
        raise ValueError("Not a shortcut of the Start menu")

    def copy_to_clipboard(self, text: str) -> None:
        data = (text + "\0").encode("utf-16-le")
        kernel32, user32 = self.kernel32, self.user32
        handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        if not handle:
            raise OSError("No memory for the clipboard")
        try:
            pointer = kernel32.GlobalLock(handle)
            if not pointer:
                raise OSError("The clipboard memory could not be locked")
            try:
                ctypes.memmove(pointer, data, len(data))
            finally:
                kernel32.GlobalUnlock(handle)
            self._open_clipboard()
            try:
                user32.EmptyClipboard()
                if not user32.SetClipboardData(CF_UNICODETEXT, handle):
                    raise OSError("The clipboard did not take the text")
                handle = None  # the clipboard owns the memory now
            finally:
                user32.CloseClipboard()
        finally:
            if handle:
                kernel32.GlobalFree(handle)

    def _open_clipboard(self) -> None:
        for attempt in range(CLIPBOARD_ATTEMPTS):
            if self.user32.OpenClipboard(None):
                return
            if attempt < CLIPBOARD_ATTEMPTS - 1:
                self._sleep(CLIPBOARD_RETRY_S)
        raise OSError("The clipboard is busy")


# ---------- macOS ----------

# The pane of System Settings that does on a Mac what each page of the Windows settings does. The
# model names the pages as on Windows (`opening.SETTINGS_PAGES`); a page with no pane of its own opens
# the nearest one (proxies and the data used are in Network, the night light is in Displays). An entry
# that is a path is an app (fonts are Font Book's).
_PANE = "x-apple.systempreferences:"
MAC_SETTINGS = {
    "ms-settings:about": _PANE + "com.apple.SystemProfiler.AboutExtension",
    "ms-settings:activation": _PANE + "com.apple.SystemProfiler.AboutExtension",
    "ms-settings:appsfeatures": _PANE + "com.apple.settings.Storage",
    "ms-settings:backup": _PANE + "com.apple.Time-Machine-Settings.extension",
    "ms-settings:batterysaver": _PANE + "com.apple.Battery-Settings.extension",
    "ms-settings:bluetooth": _PANE + "com.apple.BluetoothSettings",
    "ms-settings:clipboard": _PANE + "com.apple.Keyboard-Settings.extension",
    "ms-settings:colors": _PANE + "com.apple.Appearance-Settings.extension",
    "ms-settings:connecteddevices": _PANE + "com.apple.BluetoothSettings",
    "ms-settings:datausage": _PANE + "com.apple.Network-Settings.extension",
    "ms-settings:dateandtime": _PANE + "com.apple.Date-Time-Settings.extension",
    "ms-settings:defaultapps": _PANE + "com.apple.Desktop-Settings.extension",
    "ms-settings:developers": _PANE + "com.apple.settings.PrivacySecurity.extension",
    "ms-settings:devices-touchpad": _PANE + "com.apple.Trackpad-Settings.extension",
    "ms-settings:display": _PANE + "com.apple.Displays-Settings.extension",
    "ms-settings:easeofaccess": _PANE + "com.apple.Accessibility-Settings.extension",
    "ms-settings:easeofaccess-display": _PANE + "com.apple.Accessibility-Settings.extension",
    "ms-settings:easeofaccess-keyboard": _PANE + "com.apple.Accessibility-Settings.extension",
    "ms-settings:easeofaccess-magnifier": _PANE + "com.apple.Accessibility-Settings.extension",
    "ms-settings:easeofaccess-narrator": _PANE + "com.apple.Accessibility-Settings.extension",
    "ms-settings:fonts": "/System/Applications/Font Book.app",
    "ms-settings:gaming-gamebar": _PANE + "com.apple.Game-Center-Settings.extension",
    "ms-settings:lockscreen": _PANE + "com.apple.Lock-Screen-Settings.extension",
    "ms-settings:mousetouchpad": _PANE + "com.apple.Mouse-Settings.extension",
    "ms-settings:multitasking": _PANE + "com.apple.Desktop-Settings.extension",
    "ms-settings:network": _PANE + "com.apple.Network-Settings.extension",
    "ms-settings:network-airplanemode": _PANE + "com.apple.Network-Settings.extension",
    "ms-settings:network-ethernet": _PANE + "com.apple.Network-Settings.extension",
    "ms-settings:network-mobilehotspot": _PANE + "com.apple.Sharing-Settings.extension",
    "ms-settings:network-proxy": _PANE + "com.apple.Network-Settings.extension",
    "ms-settings:network-vpn": _PANE + "com.apple.NetworkExtensionSettingsUI.NESettingsUIExtension",
    "ms-settings:network-wifi": _PANE + "com.apple.wifi-settings-extension",
    "ms-settings:nightlight": _PANE + "com.apple.Displays-Settings.extension",
    "ms-settings:notifications": _PANE + "com.apple.Notifications-Settings.extension",
    "ms-settings:optionalfeatures": _PANE + "com.apple.systempreferences.GeneralSettings",
    "ms-settings:otherusers": _PANE + "com.apple.Users-Groups-Settings.extension",
    "ms-settings:personalization": _PANE + "com.apple.Appearance-Settings.extension",
    "ms-settings:personalization-background": _PANE + "com.apple.Wallpaper-Settings.extension",
    "ms-settings:personalization-start": _PANE + "com.apple.Desktop-Settings.extension",
    "ms-settings:powersleep": _PANE + "com.apple.Battery-Settings.extension",
    "ms-settings:printers": _PANE + "com.apple.Print-Scan-Settings.extension",
    "ms-settings:privacy": _PANE + "com.apple.settings.PrivacySecurity.extension",
    "ms-settings:privacy-location": _PANE + "com.apple.preference.security?Privacy_LocationServices",
    "ms-settings:privacy-microphone": _PANE + "com.apple.preference.security?Privacy_Microphone",
    "ms-settings:project": _PANE + "com.apple.Displays-Settings.extension",
    "ms-settings:quiethours": _PANE + "com.apple.Focus-Settings.extension",
    "ms-settings:recovery": _PANE + "com.apple.Transfer-Reset-Settings.extension",
    "ms-settings:regionlanguage": _PANE + "com.apple.Localization-Settings.extension",
    "ms-settings:remotedesktop": _PANE + "com.apple.Sharing-Settings.extension",
    "ms-settings:signinoptions": _PANE + "com.apple.Touch-ID-Settings.extension",
    "ms-settings:sound": _PANE + "com.apple.Sound-Settings.extension",
    "ms-settings:speech": _PANE + "com.apple.Keyboard-Settings.extension",
    "ms-settings:startupapps": _PANE + "com.apple.LoginItems-Settings.extension",
    "ms-settings:storagesense": _PANE + "com.apple.settings.Storage",
    "ms-settings:taskbar": _PANE + "com.apple.Desktop-Settings.extension",
    "ms-settings:themes": _PANE + "com.apple.Appearance-Settings.extension",
    "ms-settings:troubleshoot": _PANE + "com.apple.systempreferences.GeneralSettings",
    "ms-settings:typing": _PANE + "com.apple.Keyboard-Settings.extension",
    "ms-settings:usb": _PANE + "com.apple.settings.PrivacySecurity.extension",
    "ms-settings:windowsdefender": _PANE + "com.apple.settings.PrivacySecurity.extension",
    "ms-settings:windowsupdate": _PANE + "com.apple.Software-Update-Settings.extension",
    "ms-settings:yourinfo": _PANE + "com.apple.systempreferences.AppleIDSettings",
}
# How far one press of a volume key moves the output volume (of 100): a sixteenth, as the Mac's own
# keys do.
MAC_VOLUME_STEP = 6.25
# NX_KEYTYPE_PLAY, NX_KEYTYPE_NEXT, NX_KEYTYPE_PREVIOUS: the media keys of a Mac keyboard, which go to
# the app that plays now as they do on the keyboard.
MAC_MEDIA_KEYS = {"play_pause": 16, "next_track": 17, "previous_track": 18}
# A media key as the keyboard sends it: a system-defined event (14) of subtype 8, down then up.
_MEDIA_KEY_SCRIPT = (
    "ObjC.import('AppKit'); ObjC.import('CoreGraphics');"
    "function key(code, down) {"
    " var ev = $.NSEvent.otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2("
    "14, $.NSZeroPoint, down ? 0xa00 : 0xb00, 0, 0, $(), 8, (code << 16) | ((down ? 0xa : 0xb) << 8), -1);"
    " $.CGEventPost(0, ev.CGEvent); }"
    "for (var i = 0; i < TIMES; i++) { key(CODE, true); key(CODE, false); }"
)
# The players told directly when the media key cannot be sent; one that does not run is never started.
_MAC_PLAYERS = ("com.apple.Music", "com.spotify.client")
_MAC_PLAYER_COMMANDS = {"play_pause": "playpause", "next_track": "next track", "previous_track": "previous track"}
# The folders whose apps are the Mac's Start menu, each with its subfolders one level down.
MAC_APP_FOLDERS = (
    Path("/Applications"),
    Path("/Applications/Utilities"),
    Path("/System/Applications"),
    Path("/System/Applications/Utilities"),
    Path.home() / "Applications",
)
_BUNDLE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]*")
MAC_HELPER_TIMEOUT_S = 10.0
_LOGIN_FRAMEWORK = "/System/Library/PrivateFrameworks/login.framework/Versions/Current/login"


def _lock_with_login_framework() -> None:
    """Locks the screen at once, as Control-Command-Q does, with the login framework's own call."""
    login = ctypes.CDLL(_LOGIN_FRAMEWORK)
    login.SACLockScreenImmediate.restype = ctypes.c_int
    if login.SACLockScreenImmediate() != 0:
        raise OSError("The screen could not be locked")


class MacActions:
    """`DeviceActions` on macOS. The processes it starts (`run`), the lock (`lock`) and the folders of
    apps (`app_folders`) can be given instead, so that a test opens, presses and locks nothing."""

    def __init__(
        self,
        *,
        run: Callable[..., subprocess.CompletedProcess] = subprocess.run,
        lock: Callable[[], None] | None = None,
        app_folders: Iterable[Path] | None = None,
    ) -> None:
        self._run = run
        self._lock = lock or _lock_with_login_framework
        self._folders = list(MAC_APP_FOLDERS if app_folders is None else app_folders)

    def _helper(self, args: list[str], *, input: bytes | None = None) -> subprocess.CompletedProcess:
        completed = self._run(
            args, input=input, capture_output=True, timeout=MAC_HELPER_TIMEOUT_S, check=False,
            env={**os.environ, "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"},
        )
        if completed.returncode != 0:
            raise OSError(f"{Path(args[0]).name} ended with {completed.returncode}")
        return completed

    def open_url(self, url: str) -> None:
        # `open` opens whatever it is given (an app, a file, any scheme), so nothing but a page of the
        # public web goes to it.
        if validate_url(url, allow_http=True) is None:
            raise ValueError("Only a page of the public web can be opened")
        self._helper(["/usr/bin/open", "--", url])

    def open_settings(self, uri: str) -> None:
        if uri not in SETTINGS_URIS or uri not in MAC_SETTINGS:
            raise ValueError("Only a page of the settings can be opened")
        target = MAC_SETTINGS[uri]
        if target.startswith("/"):
            self._helper(["/usr/bin/open", "-a", target])
        else:
            self._helper(["/usr/bin/open", "--", target])

    def press_key(self, name: str, times: int = 1) -> None:
        if name not in VIRTUAL_KEYS:
            raise ValueError(f"Unknown key {name!r}")
        if not 1 <= times <= _MAX_KEY_PRESSES:
            raise ValueError(f"A key is pressed between 1 and {_MAX_KEY_PRESSES} times")
        if name in ("volume_up", "volume_down"):
            step = MAC_VOLUME_STEP * times * (1 if name == "volume_up" else -1)
            self._helper(["/usr/bin/osascript", "-e",
                          f"set volume output volume ((output volume of (get volume settings)) + {step:g})"])
        elif name == "volume_mute":
            # A press turns the sound off or back on: an even number of presses changes nothing.
            if times % 2:
                self._helper(["/usr/bin/osascript", "-e",
                              "set volume output muted (not (output muted of (get volume settings)))"])
        else:
            self._media_key(name, times)

    def _media_key(self, name: str, times: int) -> None:
        script = _MEDIA_KEY_SCRIPT.replace("TIMES", str(times)).replace("CODE", str(MAC_MEDIA_KEYS[name]))
        try:
            self._helper(["/usr/bin/osascript", "-l", "JavaScript", "-e", script])
            return
        except (OSError, subprocess.SubprocessError):
            pass
        told = False
        for bundle in _MAC_PLAYERS:
            script = (f'if application id "{bundle}" is running then '
                      f'tell application id "{bundle}" to {_MAC_PLAYER_COMMANDS[name]}')
            for _ in range(times):
                try:
                    self._helper(["/usr/bin/osascript", "-e", script])
                    told = True
                except (OSError, subprocess.SubprocessError):
                    break
        if not told:
            raise OSError("The media key could not be sent")

    def lock_screen(self) -> None:
        try:
            self._lock()
            return
        except (OSError, AttributeError):
            pass
        self._helper(["/usr/bin/osascript", "-e",
                      'tell application "System Events" to keystroke "q" using {control down, command down}'])

    def list_start_apps(self) -> list[StartApp]:
        """The apps of the Applications folders (the system's, the person's), each named as Finder
        names it and known by its bundle identifier."""
        apps: list[StartApp] = []
        seen: set[str] = set()
        for bundle in self._bundles():
            app = self._describe(bundle)
            if app is None or _name_key(app.name) in seen:
                continue
            seen.add(_name_key(app.name))
            apps.append(app)
            if len(apps) >= _MAX_SHORTCUTS:
                break
        return apps

    def _bundles(self) -> list[Path]:
        found: list[Path] = []
        for folder in self._folders:
            try:
                entries = sorted(folder.iterdir())
            except OSError:
                continue
            for entry in entries:
                if entry.suffix == ".app":
                    found.append(entry)
                elif entry.is_dir() and not entry.name.startswith("."):
                    try:
                        found.extend(sorted(child for child in entry.iterdir() if child.suffix == ".app"))
                    except OSError:
                        continue
        return found

    @staticmethod
    def _describe(bundle: Path) -> StartApp | None:
        try:
            with open(bundle / "Contents" / "Info.plist", "rb") as file:
                info = plistlib.load(file)
        except (OSError, plistlib.InvalidFileException, ValueError):
            info = {}
        if not isinstance(info, dict):
            info = {}
        name = info.get("CFBundleDisplayName") or info.get("CFBundleName") or bundle.stem
        identifier = info.get("CFBundleIdentifier")
        if not isinstance(name, str) or not name.strip():
            name = bundle.stem
        app_id = identifier if isinstance(identifier, str) and _BUNDLE_ID.fullmatch(identifier) else str(bundle)
        return StartApp(name.strip(), app_id)

    def launch_app(self, app_id: str) -> None:
        if not app_id.strip() or _NOT_AN_ID.search(app_id):
            raise ValueError("Not an app id")
        app_id = app_id.strip()
        if _BUNDLE_ID.fullmatch(app_id) and not app_id.endswith(".app"):
            self._helper(["/usr/bin/open", "-b", app_id])
            return
        self._helper(["/usr/bin/open", "-a", str(self._bundle(app_id))])

    def _bundle(self, path: str) -> Path:
        """`path` if it is an app in one of the Applications folders: nothing else is started by its
        path. ValueError if it is not."""
        resolved = Path(path).resolve()
        if resolved.suffix == ".app" and resolved.is_dir():
            for folder in self._folders:
                if folder.resolve() in resolved.parents:
                    return resolved
        raise ValueError("Not an app of the Applications folders")

    def copy_to_clipboard(self, text: str) -> None:
        self._helper(["/usr/bin/pbcopy"], input=text.encode("utf-8"))


# The system the core runs on, as `system_actions` reads it (a test replaces it, not `sys.platform`).
PLATFORM = sys.platform


def system_actions() -> DeviceActions:
    """The actions of the system the core runs on."""
    return MacActions() if PLATFORM == "darwin" else WindowsActions()
