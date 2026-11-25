"""CLI availability and credential-file existence, never credential contents."""

import asyncio
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from .process import Child, subscription_env
from .records import workspace_root
from .terminal_login import TerminalSignIn
from .models import runnable_model, claude_cli_models, claude_models, codex_models, antigravity_models, find_model
from ...brain.model_ref import CLI_NAMES as NAMES

logger = logging.getLogger(__name__)

# Claude Code keeps its sign-in on a Mac in the login Keychain, as a password item of this name, not in a file.
CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials"
# How long a look at the Keychain stands for the next ones.
KEYCHAIN_TTL_S = 30


def keychain_stamp(service=CLAUDE_KEYCHAIN_SERVICE, account=None):
    """When the Keychain item of `service` (and `account`, when one is named) last changed, or None without one: `security`
    prints the item's attributes alone (never its secret, `-g`/`-w` are not given) and asks the owner nothing."""
    try:
        found = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", service, *(["-a", account] if account else [])],
                               capture_output=True, text=True, errors="replace", timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if found.returncode != 0:
        return None
    return next((line.strip() for line in found.stdout.splitlines() if '"mdat"' in line), "present")


# Antigravity CLI (`agy` 1.5 and later) keeps its Google sign-in in the system's own store, never in a file Raphael reads: on a
# Mac in the login Keychain, as a password item of this service and account, and on Windows in Credential Manager under this
# target (#283, R-CLI-SIGNIN-05).
ANTIGRAVITY_KEYCHAIN = ("gemini", "antigravity")
ANTIGRAVITY_CREDENTIAL = "gemini:antigravity*"


def antigravity_keychain_stamp():
    """When Antigravity's Keychain item last changed on a Mac, or None without one (its attributes alone, as `keychain_stamp`)."""
    return keychain_stamp(*ANTIGRAVITY_KEYCHAIN)


def credential_stamp(target=ANTIGRAVITY_CREDENTIAL):
    """When a Windows Credential Manager item matching `target` last changed, or None without one: CredEnumerateW lists
    the items' attributes, and only their LastWritten time is read, never the secret they hold."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    class FileTime(ctypes.Structure):
        _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]

    class Credential(ctypes.Structure):
        _fields_ = [("Flags", wintypes.DWORD), ("Type", wintypes.DWORD), ("TargetName", wintypes.LPWSTR),
                    ("Comment", wintypes.LPWSTR), ("LastWritten", FileTime), ("CredentialBlobSize", wintypes.DWORD),
                    ("CredentialBlob", ctypes.c_void_p), ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD),
                    ("Attributes", ctypes.c_void_p), ("TargetAlias", wintypes.LPWSTR), ("UserName", wintypes.LPWSTR)]

    try:
        advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        enumerate_ = advapi.CredEnumerateW
        enumerate_.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
                               ctypes.POINTER(ctypes.POINTER(ctypes.POINTER(Credential))))
        enumerate_.restype = wintypes.BOOL
        count, found = wintypes.DWORD(), ctypes.POINTER(ctypes.POINTER(Credential))()
        if not enumerate_(target, 0, ctypes.byref(count), ctypes.byref(found)):
            return None  # ERROR_NOT_FOUND, or none to say
        try:
            times = [(found[i].contents.LastWritten.high << 32) | found[i].contents.LastWritten.low for i in range(count.value)]
        finally:
            advapi.CredFree(found)
        return max(times) if times else None
    except (OSError, AttributeError, ValueError):
        return None


# "gemini" is Google's Antigravity CLI (`agy`), which replaced Gemini CLI.
LOGIN = {"claude": "claude auth login", "codex": "codex login", "gemini": "agy"}
EXECUTABLE = {"claude": "claude", "codex": "codex", "gemini": "agy"}
# The CLIs asked for their models in the background.
MODEL_LISTS = ("claude", "codex", "gemini")
DISCOVERY_TTL_S = 60
# A CLI whose sign-in was refused is not asked to start a routine again for this long, unless its credentials change or a
# sign-in finishes first: after that the next run asks the CLI itself, so a sign-in done anywhere is found out (R-CLI-SIGNIN-03).
SIGNIN_LOST_S = 30 * 60
# While a CLI's sign-in is lost its credentials are looked at this often, so a sign-in done anywhere ends the notice; nothing
# is looked at while no sign-in is lost (R-CLI-SIGNIN-06).
SIGNIN_WATCH_S = 10
# Antigravity that said it has no sign-in is asked again this often while the app is used, and at once when its stored sign-in
# changes (R-CLI-SIGNIN-07).
SIGNED_OUT_ASK_S = 5 * 60
# While the app's sign-in window for Antigravity is open its stored sign-in is looked at this often, so the sign-in is found
# without waiting for the window to end; agy itself is asked this long after its last answer for the first minutes, then at
# most once a minute, and no more once the window has been open for half an hour (R-CLI-SIGNIN-08).
SIGNIN_LOOK_S = 2
SIGNIN_ASK_S = 10
SIGNIN_ASK_FAST_FOR_S = 5 * 60
SIGNIN_ASK_LATER_S = 60
SIGNIN_ASK_UNTIL_S = 30 * 60


def brain_ref(value):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"cli:(claude|codex|gemini)(?::([A-Za-z0-9][A-Za-z0-9._/-]{0,199}))?(?:\?effort=(none|minimal|low|medium|high|xhigh|max))?", value)
    return (match[1], match[2]) if match else None


def brain_effort(value):
    return value.partition("?effort=")[2] or None if brain_ref(value) else None


def cli_available(installed, logged_in, disconnected=False):
    """The single eligibility rule for discovery, catalogs, allowances and turns."""
    return bool(installed) and logged_in is True and not bool(disconnected)


WINDOWS_LAUNCHERS = (".exe", ".bat", ".cmd", ".ps1")


def _windows_path(path):
    return [folder for part in path.split(";") if (folder := Path(part.strip().strip('"'))).is_absolute()]


def _windows_node(path):
    return next((str(folder / "node.exe") for folder in _windows_path(path) if (folder / "node.exe").is_file()), None)


def _registered_windows_node():
    """Find Node in the configured Windows PATH if the desktop inherited an older one."""
    import winreg

    for hive, location in ((winreg.HKEY_CURRENT_USER, "Environment"),
                           (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
        try:
            with winreg.OpenKey(hive, location) as key:
                path, kind = winreg.QueryValueEx(key, "Path")
            if kind == winreg.REG_EXPAND_SZ:
                path = winreg.ExpandEnvironmentStrings(path)
        except OSError:
            continue
        if isinstance(path, str) and (node := _windows_node(path)):
            return node
    return None


def _suffixes(environ):
    if sys.platform != "win32":
        return (".exe", ".cmd", ".ps1", "")
    # npm also installs an extensionless POSIX script, which Windows cannot launch.
    listed = environ.get("PATHEXT", "").lower().split(";")
    return [suffix for suffix in dict.fromkeys((*listed, *WINDOWS_LAUNCHERS)) if suffix in WINDOWS_LAUNCHERS]


def _path_candidates(executable, environ):
    """The command's places on PATH, the one lookup discovery makes outside its own known folders."""
    path_value = environ.get("PATH", "")
    if sys.platform == "win32":
        return [folder / (executable + suffix) for folder in _windows_path(path_value) for suffix in _suffixes(environ)]
    found = shutil.which(executable, path=path_value)
    return [Path(found)] if found else []


def resolve_command(path, environ=None):
    path = Path(path).resolve()
    environ = os.environ if environ is None else environ
    suffix = path.suffix.lower()
    if sys.platform == "win32" and suffix not in WINDOWS_LAUNCHERS:
        raise ValueError("unsupported_launcher")
    if suffix not in (".cmd", ".ps1", ".bat"):
        return [str(path)]
    # Only recognize npm's quoted JavaScript entry point; never execute shim text.
    text = path.read_text(encoding="utf-8-sig")
    match = re.search(r'["\'](?:%~dp0|%dp0%|\$basedir)[/\\]([^"\'\r\n]+\.(?:js|cjs|mjs))["\']', text, re.I)
    if not match:
        raise ValueError("unsupported_shim")
    entry = (path.parent / match[1].replace("\\", "/")).resolve()
    if not entry.is_file() or not entry.is_relative_to(path.parent):
        raise ValueError("unsupported_shim")
    node = path.parent / "node.exe"
    path_value = environ.get("PATH", "")
    if node.is_file():
        found = str(node)
    elif sys.platform == "win32":
        found = _windows_node(path_value) or _registered_windows_node()
    else:
        found = shutil.which("node", path=path_value)
    if not found:
        raise ValueError("node_missing")
    return [found, str(entry)]


def owners_keychain(home):
    """The Keychain look for Claude Code's sign-in: only for the owner's own home (none given) on a Mac."""
    return keychain_stamp if home is None and sys.platform == "darwin" else None


def owners_credentials(home):
    """The look at Antigravity's sign-in in the system's store, only for the owner's own home (none given): the Keychain on a
    Mac, Credential Manager on Windows (R-CLI-SIGNIN-05)."""
    if home is not None:
        return None
    return {"darwin": antigravity_keychain_stamp, "win32": credential_stamp}.get(sys.platform)


class CliBrains:
    def __init__(self, *, home=None, environ=None, commands=None, notify=None, settings=None, clock=time.monotonic, keychain=None,
                 credentials=None):
        # The looks at the sign-ins kept in the system's store: Claude Code's Keychain item on a Mac (`keychain`) and
        # Antigravity's Keychain or Credential Manager item (`credentials`); name -> (until when a look stands, its stamp).
        self._keychain = keychain if keychain is not None else owners_keychain(home)
        self._credentials = credentials if credentials is not None else owners_credentials(home)
        self._store_seen = {}
        # What Antigravity itself last said of its sign-in, listing its models the way a run starts it: (signed in, the stamp
        # of its stored sign-in then). It stands while that stamp does (R-CLI-SIGNIN-07).
        self._verdict = {}
        self._agy_lock = asyncio.Lock()
        self.home = Path.home() if home is None else Path(home)
        self.environ = dict(os.environ if environ is None else environ)
        self.commands = commands
        self.notify = notify
        self.settings = settings
        # The window of each model (`cli:<brain>:<model>`) its CLI last reported, for the next loop of it (loop.py).
        self.context_windows = {}
        self._disconnected = set()
        # A sign-in the owner is finishing in the CLI's own console, how the last one ended ("done" or "stopped"), and the
        # ones this app ended itself.
        self._signing = {}
        self._signed = {}
        self._cancelled = set()  # the windows (processes) this app ended
        self._closed = False
        # Antigravity's sign-in: the stamp of its stored sign-in when the window opened, the look that finds it while the
        # window is open, and a window that ended whose sign-in is still being asked about (R-CLI-SIGNIN-08).
        self._sign_in_start = {}
        self._sign_in_watch = {}
        self._checking = {}
        # A CLI that refused its sign-in during a run: name -> (cause, when, credential stamp). The routine gate forgets it after
        # `SIGNIN_LOST_S`; the notice (`sign_in_cause`) stays until something says the sign-in is back.
        self._lost = {}
        self._lost_watch = None
        # Told the name of a CLI whose sign-in came back: the cleanup of the failures it left (background service).
        self.on_back = []
        self._previous = None
        self._lock = asyncio.Lock()
        self._watcher = None
        self._last_used = 0.0
        self._models = {}
        self._fill_after_refresh = set()
        self._model_refresh = None
        self._models_at = {}
        self._clock = clock
        self._commands_cache = {}
        self._versions = {}
        self._discovery_generation = {}
        self._command_lock = threading.RLock()

    def command(self, name):
        # Cache misses too: an uninstalled CLI must not rescan all roots on every Home read.
        with self._command_lock:
            cached = self._commands_cache.get(name)
            if cached and self._clock() < cached[0]:
                return list(cached[1]) if cached[1] is not None else None
            command = self._find_command(name)
            self._commands_cache[name] = (self._clock() + DISCOVERY_TTL_S, tuple(command) if command else None)
            return list(command) if command else None

    def invalidate(self, name=None):
        """Forget executable/version discovery after an app-controlled install, login or removal."""
        with self._command_lock:
            for identifier in (NAMES if name is None else (name,)):
                self._commands_cache.pop(identifier, None)
                self._versions.pop(identifier, None)
                self._store_seen.pop(identifier, None)
                self._discovery_generation[identifier] = self._discovery_generation.get(identifier, 0) + 1

    def _find_command(self, name):
        if self.commands is not None:
            return self.commands.get(name)
        executable = EXECUTABLE.get(name, name)
        roots = [self.home / ".local" / "bin", self.home / ".bun" / "bin"]
        if sys.platform == "darwin":
            # An app opened from Finder has none of the shell's PATH: the places Homebrew, npm, Volta
            # and Claude Code's own installer put these commands on a Mac.
            roots.extend([Path("/opt/homebrew/bin"), Path("/usr/local/bin"), self.home / ".npm-global" / "bin",
                          self.home / ".volta" / "bin", self.home / ".claude" / "local"])
        if self.environ.get("APPDATA"):
            roots.append(Path(self.environ["APPDATA"]) / "npm")
        if self.environ.get("LOCALAPPDATA"):
            local = Path(self.environ["LOCALAPPDATA"])
            roots.extend([local / "Microsoft" / "WinGet" / "Links", local / "Programs" / executable,
                          local / "Programs" / "Claude", local / "npm", local / "agy" / "bin"])
        candidates = _path_candidates(executable, self.environ)
        candidates.extend(root / (executable + suffix) for root in roots for suffix in _suffixes(self.environ))
        for path in candidates:
            if path.is_file():
                try:
                    return resolve_command(path, self.environ)
                except (ValueError, OSError):
                    continue
        return None

    def _credential_files(self, name):
        claude = Path(self.environ.get("CLAUDE_CONFIG_DIR", self.home / ".claude"))
        codex = Path(self.environ.get("CODEX_HOME", self.home / ".codex"))
        # Antigravity keeps no sign-in file: `~/.gemini/oauth_creds.json` and `google_accounts.json` were the retired Gemini
        # CLI's, and agy reads neither, so they would call an agy that never signed in signed in (R-CLI-SIGNIN-07).
        return {
            "claude": (claude / ".credentials.json", claude / "credentials.json"),
            "codex": (codex / "auth.json",),
            "gemini": (),
        }[name]

    def logged_in(self, name):
        try:
            if any(path.is_file() for path in self._credential_files(name)):
                return True
        except OSError:
            return None
        stored = self._store_item(name, fresh=False)
        if name == "gemini":
            # Antigravity keeps its sign-in in the system's store, the Keychain on a Mac and Credential Manager on Windows
            # (R-CLI-SIGNIN-05), and the item being there is the sign-in. What agy itself last said stands over it while the
            # item is as it was then: a sign-in it keeps elsewhere, or an item it can no longer use (R-CLI-SIGNIN-07).
            verdict = self._verdict.get(name)
            return verdict[0] if verdict is not None and verdict[1] == stored else stored is not None
        # Claude Code on a Mac keeps its sign-in in the Keychain (R-CLI-SIGNIN-04): the item being there is the sign-in.
        if name == "claude" and stored is not None:
            return True
        # Claude also uses OS credential storage. Settings alone do not establish a Google login.
        return None if name == "claude" else False

    def _store(self, name):
        """The look at this CLI's sign-in in the system's store, or None where it keeps none there (or none is asked here)."""
        return {"claude": self._keychain, "gemini": self._credentials}.get(name)

    def _store_item(self, name, *, fresh):
        """The stamp of this CLI's sign-in in the system's store, or None (none, or no store here); a look stands for
        KEYCHAIN_TTL_S unless a `fresh` one is asked for."""
        look = self._store(name)
        if look is None:
            return None
        seen = self._store_seen.get(name)
        if fresh or seen is None or self._clock() >= seen[0]:
            seen = self._store_seen[name] = (self._clock() + KEYCHAIN_TTL_S, look())
        return seen[1]

    def _store_seen_item(self, name):
        """The stamp the last look at this CLI's store found, without looking again."""
        seen = self._store_seen.get(name)
        return seen[1] if seen else None

    def _credential_stamp(self, name):
        """When the CLI's credential files last changed (never what they hold): a sign-in done anywhere moves it."""
        stamp = []
        for path in self._credential_files(name):
            try:
                stamp.append(path.stat().st_mtime_ns)
            except OSError:
                stamp.append(None)
        # A sign-in rewrites the item in the system's store instead of a file: Claude Code's Keychain item on a Mac, and
        # Antigravity's Keychain item on a Mac or its Credential Manager item on Windows.
        if self._store(name) is not None:
            stamp.append(self._store_item(name, fresh=True))
        return tuple(stamp)

    def sign_in_lost(self, name, cause):
        """A run of this CLI was refused for its sign-in (`expired` or `signed_out`): routines that start next are not run
        into the same refusal (`sign_in_missing`), and the app says so until it is back (`sign_in_cause`). The app is told
        once, when it becomes lost (or its cause changes), not at every refused run."""
        if name not in NAMES or cause not in ("expired", "signed_out"):
            return
        if name == "gemini":
            # What agy said before the refusal no longer stands: it is asked again at the next read (R-CLI-SIGNIN-07).
            self._models_at.pop(name, None)
        before = self._lost.get(name)
        self._lost[name] = (cause, self._clock(), self._credential_stamp(name))
        if before is None or before[0] != cause:
            self._changed()
        self._watch_lost()

    def sign_in_back(self, name):
        """A run of this CLI took its turn: it is signed in. Says so (once) only when it was lost."""
        self._came_back(name)

    def sign_in_cause(self, name):
        """`expired` or `signed_out` while this CLI's last run was refused for its sign-in and nothing since says it is back (a
        run that was answered, a sign-in that finished, other credential files); `SIGNIN_LOST_S` does not end it."""
        lost = self._lost.get(name)
        return lost[0] if lost else None

    def sign_in_missing(self, name):
        """What the routine gate asks: `sign_in_cause`, but None once `SIGNIN_LOST_S` has passed so the next routine asks
        the CLI itself, and None (and back) when its credential files have changed."""
        lost = self._lost.get(name)
        if lost is None:
            return None
        cause, at, stamp = lost
        if self._credential_stamp(name) != stamp:
            self._came_back(name)
            return None
        return None if self._clock() - at >= SIGNIN_LOST_S else cause

    def _changed(self):
        self._previous = None
        if self.notify:
            self.notify("brains.changed", {})

    def _came_back(self, name, *, always=False):
        """This CLI's sign-in stands again. The app is told and the cleanup runs when it was lost, or when `always` (a sign-in
        finished in the app's console, which may follow a restart that forgot the record)."""
        held = self._lost.pop(name, None) is not None
        if held:
            self._changed()
        if held or always:
            for callback in list(self.on_back):
                try:
                    callback(name)
                except Exception as error:  # the CLI's path never fails for what follows its sign-in
                    logger.warning("The cleanup after a CLI sign-in failed: %s", type(error).__name__)

    def _watch_lost(self):
        """Look at the credentials of the CLIs that are lost about every `SIGNIN_WATCH_S`; none while nothing is lost."""
        if self._lost_watch is not None or not self._lost:
            return
        try:
            self._lost_watch = asyncio.get_running_loop().create_task(self._watch_lost_loop())
        except RuntimeError:
            self._lost_watch = None  # no loop (a plain call): the next refused run starts it

    async def _watch_lost_loop(self):
        try:
            while self._lost:
                await asyncio.sleep(SIGNIN_WATCH_S)
                await self.check_lost()
        finally:
            self._lost_watch = None

    async def check_lost(self):
        """One look at the credentials of every CLI that is lost, off the loop (a Mac's stamp may ask the Keychain): a
        changed stamp means its sign-in was done somewhere."""
        for name in list(self._lost):
            stamp = await asyncio.to_thread(self._credential_stamp, name)
            lost = self._lost.get(name)
            if lost is not None and stamp != lost[2]:
                self._came_back(name)

    def disconnected(self, name):
        if self.settings is not None:
            return name in self.settings.get("disconnected_clis")
        return name in self._disconnected

    def _set_disconnected(self, name, value):
        if name not in NAMES:
            raise ValueError("cli_unknown")
        if self.settings is not None:
            items = [item for item in self.settings.get("disconnected_clis") if item != name]
            if value:
                items.append(name)
            self.settings.set("disconnected_clis", items)
        elif value:
            self._disconnected.add(name)
        else:
            self._disconnected.discard(name)

    def available(self, name, *, command=None, logged_in=None):
        if command is None:
            command = self.command(name)
        if logged_in is None:
            logged_in = self.logged_in(name) if command else False
        return cli_available(command, logged_in, self.disconnected(name))

    def _claude_folder(self):
        return Path(self.environ.get("CLAUDE_CONFIG_DIR", self.home / ".claude"))

    def _known_models(self, name):
        """The list the CLI gave; Claude's has a known first answer, so its menu is never empty."""
        return self._models.get(name) or (claude_models(self._claude_folder()) if name == "claude" else [])

    def antigravity_model(self, reference):
        """Resolve previously saved family ids to a listed variant before starting the CLI."""
        _, model = brain_ref(reference)
        row = find_model(self._known_models("gemini"), reference.partition("?")[0])
        if row and row.get("effort_models"):
            chosen = row["effort_models"].get(brain_effort(reference)) or runnable_model(row)
            return brain_ref(chosen)[1]
        return model

    def model_ids(self, reference):
        """Equivalent ids explicitly reported for this CLI model."""
        name, model = brain_ref(reference)
        row = find_model(self._known_models(name), reference.partition("?effort=")[0])
        return (row["id"].rpartition(":")[2], *row.get("aliases", ())) if row else (model,)

    def model_name(self, reference):
        """What the owner calls a brain's model, with no depth and no id: the CLI's own name for it, else the CLI's."""
        found = brain_ref(reference)
        if not found:
            return None
        base = reference.partition("?effort=")[0]
        # A member saved with Claude Code's alias (`opus`) is named by the model the alias is now.
        row = find_model(self._known_models(found[0]), base)
        return row["name"] if row and row.get("name") else NAMES[found[0]]

    def with_effort(self, model, effort):
        """Resolve quick effort from discovered choices without spawning a discovery process."""
        name, _ = brain_ref(model)
        base = model.partition("?effort=")[0]
        models = self._known_models(name)
        entry = find_model(models, base) or next((m for m in models if base in m.get("effort_models", {}).values()), None)
        if entry is None and base == f"cli:{name}":
            entry = next((m for m in models if m.get("is_default")), None)
            if entry is not None:
                base = entry["id"]
        if entry is None:
            return f"{base}?effort={effort}"
        levels = entry.get("reasoning_efforts", [])
        if not levels:
            return base
        chosen = effort if effort in levels else next((e for e in ("low", "medium", "none", "minimal") if e in levels), levels[0])
        return entry.get("effort_models", {}).get(chosen) or f"{base}?effort={chosen}"

    def _fill_models(self, name):
        from ...brain.first_models import recommendations
        from ...brain.settings import SettingsStore
        if isinstance(self.settings, SettingsStore):
            rows = self._known_models(name) or [{"id": f"cli:{name}"}]
            # A subscription program answers and takes quick questions; dictation's tidying stays fast, so it is never filled
            # with a program started for every phrase, and the program hears nothing (R-DEFAULT-05).
            runnable = [{**row, "id": runnable_model(row)} for row in rows]
            choices = {role: model for role, model in recommendations(runnable).items() if role in ("answer", "quick")}
            self.settings.fill_models(NAMES[name], choices, self.notify)

    async def _one(self, name):
        command = await asyncio.to_thread(self.command, name)
        logged_in = await asyncio.to_thread(self.logged_in, name) if command else False
        disconnected = self.disconnected(name)
        available = cli_available(command, logged_in, disconnected)
        models = await asyncio.to_thread(self._known_models, name) if available else []
        item = {"id": name, "name": NAMES[name], "installed": bool(command),
                "logged_in": logged_in, "disconnected": disconnected, "available": available,
                "login_command": LOGIN[name], "models": models,
                "signing_in": self._signing_in(name), "login_result": self._signed.get(name),
                "sign_in_lost": self.sign_in_cause(name)}
        if command:
            cached = self._versions.get(name)
            if cached and self._clock() < cached[0] and cached[1] == tuple(command):
                version = cached[2]
            else:
                generation = self._discovery_generation.get(name, 0)
                version = await self._read_version(name, command)
                if generation == self._discovery_generation.get(name, 0):
                    self._versions[name] = (self._clock() + DISCOVERY_TTL_S, tuple(command), version)
            item.update(version)
        return item

    async def _read_version(self, name, command):
        child = Child([*command, "--version"], environ=self.environ)
        try:
            async with asyncio.timeout(2):
                await child.start()
                line = await child.process.stdout.readline()
                await child.process.wait()
            if child.process.returncode == 0:
                return {"version": " ".join(line.decode("utf-8", errors="replace").split())[:120]}
        except (OSError, ValueError, TimeoutError):
            return {"notes": "Version check unavailable"}
        finally:
            await child.kill()
        return {}

    async def list(self, _params=None):
        self._last_used = asyncio.get_running_loop().time()
        async with self._lock:
            value = {"clis": list(await asyncio.gather(*(self._one(name) for name in NAMES)))}
            before = {item["id"] for item in (self._previous or {}).get("clis", []) if item["available"]}
            for item in value["clis"]:
                if item["available"] and item["id"] not in before:
                    if item["models"] or not self._needs_models(item["id"]):
                        self._fill_models(item["id"])
                    else:
                        self._fill_after_refresh.add(item["id"])
            if self._previous is not None and self._previous != value and self.notify:
                self.notify("brains.changed", {})
            self._previous = value
        if self._watcher is None:
            self._watcher = asyncio.create_task(self._watch())
        if self._model_refresh is None and any(self._needs_models(name) for name in MODEL_LISTS):
            self._model_refresh = asyncio.create_task(self._refresh_models())
        return value

    def _needs_models(self, name):
        verdict = self._verdict.get(name)
        if self._models.get(name):
            lifetime = 3600
        elif verdict is not None and verdict[0] is False:
            # Antigravity said it has no sign-in: asked again now when its stored sign-in changed, else now and then.
            if verdict[1] != self._store_seen_item(name):
                return True
            lifetime = SIGNED_OUT_ASK_S
        else:
            lifetime = 60
        return name not in self._models_at or self._last_used - self._models_at[name] > lifetime

    def _may_list(self, name, command):
        """Whether this CLI's models are asked for now: an available CLI's; and Antigravity's whenever it is installed and
        connected, since its list is also what it says of its own sign-in (R-CLI-SIGNIN-07)."""
        if name == "gemini":
            return bool(command) and not self.disconnected(name)
        return self.available(name, command=command)

    def _antigravity_folder(self):
        """The private Gemini folder Antigravity is asked in, as a member's run is (drivers.py `antigravity_home`): none of the
        owner's own agy settings, servers or rules, and the owner's own home, so its sign-in is read where agy keeps it."""
        return workspace_root(self.home) / "models" / "antigravity" / ".gemini"

    async def _ask_antigravity(self, command):
        """Antigravity's own verdict on its sign-in, from listing its models the way a member's run starts it: its models when
        it is signed in, None when it says it is not. Either is remembered with the stamp of the stored sign-in it was given
        (R-CLI-SIGNIN-07); a list that says neither raises, and the verdict before it stands."""
        async with self._agy_lock:
            stamp = await asyncio.to_thread(self._store_item, "gemini", fresh=True)
            folder = self._antigravity_folder()
            await asyncio.to_thread(folder.mkdir, parents=True, exist_ok=True)
            try:
                models = await antigravity_models(command, self.environ,
                    self.home / ".gemini" / "antigravity-cli" / "settings.json", gemini_dir=folder, cwd=folder.parent)
            except ValueError as error:
                if str(error) != "signed_out":
                    raise
                models = None
            was = self.logged_in("gemini")
            self._verdict["gemini"] = (models is not None, stamp)
            if models is None:
                self._models.pop("gemini", None)
            if self.logged_in("gemini") != was:
                self._changed()
            return models

    async def _refresh_one(self, name):
        command = await asyncio.to_thread(self.command, name)
        if not self._needs_models(name) or not self._may_list(name, command):
            return
        try:
            if name == "claude":
                models = await claude_cli_models(command, self.environ, self._claude_folder(),
                                                 cwd=workspace_root(self.home) / "models")
            elif name == "codex":
                models = await codex_models(command, self.environ,
                    Path(self.environ.get("CODEX_HOME", self.home / ".codex")) / "config.toml")
            else:
                models = await self._ask_antigravity(command)
                if models is None:
                    # It said it has no sign-in: that is its answer, asked again later or when its stored sign-in changes.
                    self._models_at[name] = asyncio.get_running_loop().time()
                    return
            if models != self._models.get(name):
                self._models[name] = models
                if self.notify:
                    self.notify("brains.changed", {})
        except (OSError, ValueError, TimeoutError):
            # The owner may be looking at an empty list: the next read tries again soon, a known list can wait.
            self._models_at[name] = asyncio.get_running_loop().time() - (0 if self._models.get(name) else 50)
            return
        finally:
            if name in self._fill_after_refresh:
                self._fill_after_refresh.discard(name)
                if self.available(name, command=command):
                    self._fill_models(name)
        self._models_at[name] = asyncio.get_running_loop().time()

    async def _refresh_models(self):
        try:
            await asyncio.gather(*(self._refresh_one(name) for name in MODEL_LISTS))
        finally:
            self._model_refresh = None

    def _purge_raphael_credentials(self, name):
        # Only known driver-owned copies; the CLI's own home is never removed or logged out.
        paths = []
        if name == "codex":
            root = self.home / ".raphael" / "codex-brains"
            paths = list(root.glob("*/auth.json"))
        elif name == "gemini":
            root = self.home / ".raphael" / "cli-workspaces"
            paths = list(root.glob("*/*/gemini/home/.gemini/config/mcp_config.json"))
        else:
            # Claude uses the user's login directly and keeps no credential copy.
            return
        if not root.resolve().is_relative_to((self.home / ".raphael").absolute()):
            raise ValueError("cli_credential_path")
        for path in paths:
            if not path.parent.resolve().is_relative_to(root.resolve()):
                raise ValueError("cli_credential_path")
            path.unlink(missing_ok=True)

    def disconnect(self, name):
        self.invalidate(name)
        self._set_disconnected(name, True)
        self._purge_raphael_credentials(name)
        self._previous = None
        if self.notify:
            self.notify("brains.changed", {})
        return {"disconnected": True}

    def login(self, name, *, again=False):
        """Start the CLI's own sign-in in a console of its own. A sign-in that ran out leaves its credentials in place, so
        `again` starts it even then (the file proves nothing about the session); without it a CLI that already has them is
        only connected again. Raphael learns how it ended from the process (`signing_in`, `login_result`), never from
        the CLI's credentials; Antigravity, which has no sign-in command and stays open after one, from its stored
        sign-in's date and its own word instead (R-CLI-SIGNIN-08)."""
        if name not in NAMES:
            raise ValueError("cli_unknown")
        self.invalidate(name)
        command = self.command(name)
        if not command:
            raise ValueError("cli_missing")
        if self._signing_in(name):
            return {"started": True, "running": True}
        if self.logged_in(name) is True and not again:
            self._reconnect(name)
            self._fill_models(name)
            if self.notify:
                self.notify("brains.changed", {})
            return {"started": False, "reconnected": True}
        if os.name != "nt" and sys.platform != "darwin":
            raise ValueError("cli_missing")
        arguments = {"claude": ["auth", "login"], "codex": ["login"], "gemini": []}[name]
        # Antigravity's sign-in is found by its stored sign-in written anew since the window opened (R-CLI-SIGNIN-08): the look
        # `logged_in` just took, fresh after `invalidate`.
        start = self._store_seen_item(name) if name == "gemini" else None
        if sys.platform == "darwin":
            # A Mac signs in in a Terminal window, followed as the console's process is on Windows.
            process = TerminalSignIn([*command, *arguments])
        else:
            process = subprocess.Popen([*command, *arguments], env=subscription_env(self.environ),
                                       creationflags=subprocess.CREATE_NEW_CONSOLE, close_fds=True)
        self._signing[name] = process
        self._signed.pop(name, None)
        self._reconnect(name)
        self._follow_login(name, process)
        if name == "gemini":
            self._sign_in_start[name] = start
            self._look_for_sign_in(name, process, start)
        if self.notify:
            self.notify("brains.changed", {})
        return {"started": True}

    def cancel_login(self, name):
        """End the sign-in this app started and is waiting for; the owner closed nothing, so no failure is told."""
        if name not in NAMES:
            raise ValueError("cli_unknown")
        process = self._signing.get(name)
        if process is not None and process.poll() is None:
            self._cancelled.add(process)
            process.terminate()
        elif (check := self._checking.pop(name, None)) is not None:
            check.cancel()
            self.invalidate(name)
            self._previous = None
            if self.notify:
                self.notify("brains.changed", {})
        return {"cancelled": True}

    def _signing_in(self, name):
        process = self._signing.get(name)
        return process is not None and process.poll() is None or name in self._checking

    async def _sign_in_there(self, name, start, *, ask=True):
        """Whether Antigravity's sign-in is there since its window opened: its stored sign-in written anew (the Keychain on a
        Mac, Credential Manager on Windows), or, when `ask`, agy itself saying it is signed in, which also finds a sign-in it
        keeps anywhere else (R-CLI-SIGNIN-07, R-CLI-SIGNIN-08)."""
        stamp = await asyncio.to_thread(self._store_item, name, fresh=True)
        if stamp is not None and stamp != start:
            return True
        if not ask:
            return False
        try:
            command = await asyncio.to_thread(self.command, name)
            return bool(command) and await self._ask_antigravity(command) is not None
        except (OSError, ValueError, TimeoutError):
            return False

    def _look_for_sign_in(self, name, process, start):
        """Antigravity has no sign-in command: `agy` signs in on its own screen and then stays open on its conversation, so
        its window does not end with the sign-in. While the window is open the sign-in is looked for (R-CLI-SIGNIN-08)."""
        if self._closed:
            return
        try:
            task = asyncio.get_running_loop().create_task(self._sign_in_look(name, process, start))
        except RuntimeError:
            return  # no loop (a plain call): the window's end settles it
        self._stop_looking(name)
        self._sign_in_watch[name] = task

    def _stop_looking(self, name):
        task = self._sign_in_watch.pop(name, None)
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    async def _sign_in_look(self, name, process, start):
        """Every SIGNIN_LOOK_S the stored sign-in is looked at, and agy asked now and then (SIGNIN_ASK_S, counted from its last
        answer so asks never run back to back). Once it is there the sign-in is done while agy goes on: the app is told, and
        the window is left to the owner to close. A window this app is ending is not settled here."""
        opened, asked = self._clock(), None
        try:
            while True:
                await asyncio.sleep(SIGNIN_LOOK_S)
                if self._signing.get(name) is not process or process.poll() is not None or process in self._cancelled:
                    return
                open_for = self._clock() - opened
                every = SIGNIN_ASK_S if open_for < SIGNIN_ASK_FAST_FOR_S else SIGNIN_ASK_LATER_S
                ask = open_for < SIGNIN_ASK_UNTIL_S and (asked is None or self._clock() - asked >= every)
                found = await self._sign_in_there(name, start, ask=ask)
                if ask:
                    asked = self._clock()
                if (found and self._signing.get(name) is process and process.poll() is None
                        and process not in self._cancelled):
                    del self._signing[name]
                    self._sign_in_start.pop(name, None)
                    release = getattr(process, "release", None)
                    if release is not None:
                        release()
                    self._settle_login(name, True)
                    return
        finally:
            if self._sign_in_watch.get(name) is asyncio.current_task():
                del self._sign_in_watch[name]

    async def _check_sign_in(self, name, start):
        """The window of Antigravity's sign-in ended before its sign-in was found: whether it is there now settles it, and a
        look that fails settles it `stopped` rather than leave it under way."""
        try:
            found = await self._sign_in_there(name, start)
        except Exception as error:
            logger.warning("Looking for Antigravity's sign-in failed: %s", type(error).__name__)
            found = False
        finally:
            if self._checking.get(name) is asyncio.current_task():
                del self._checking[name]
        self._settle_login(name, found)

    def _follow_login(self, name, process):
        """Wait for the sign-in's process off the loop, and settle it on the loop when it ends."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        def wait():
            code = process.wait()
            if loop is None:
                self._login_ended(name, process, code)
            else:
                try:
                    loop.call_soon_threadsafe(self._login_ended, name, process, code)
                except RuntimeError:  # the loop is closed with the app
                    pass

        threading.Thread(target=wait, name=f"{name}-sign-in", daemon=True).start()

    def _login_ended(self, name, process, code):
        if self._closed or self._signing.get(name) is not process:
            return
        del self._signing[name]
        self._stop_looking(name)
        start = self._sign_in_start.pop(name, None)
        if process in self._cancelled:
            self._cancelled.discard(process)
            self.invalidate(name)
            self._previous = None
            if self.notify:
                self.notify("brains.changed", {})
            return
        if name != "gemini":
            # The CLI's own verdict is its exit.
            self._settle_login(name, code == 0)
            return
        # Antigravity's window ends when the owner closes it, signed in or not, so its exit says nothing: the sign-in being
        # there does (R-CLI-SIGNIN-08). It is asked off the loop, and the sign-in is still under way meanwhile.
        try:
            self._checking[name] = asyncio.get_running_loop().create_task(self._check_sign_in(name, start))
        except RuntimeError:
            stamp = self._store_item(name, fresh=True)
            self._settle_login(name, stamp is not None and stamp != start or self.logged_in(name) is True)

    def _settle_login(self, name, done):
        """How the app's sign-in ended, told once: `done` when the CLI is signed in, else `stopped`."""
        self.invalidate(name)
        self._signed[name] = "done" if done else "stopped"
        if done:
            self._came_back(name, always=True)
            self._reconnect(name)
            self._fill_models(name)
        self._previous = None
        if self.notify:
            self.notify("brains.changed", {})

    def _reconnect(self, name):
        self._set_disconnected(name, False)
        self._models_at.pop(name, None)
        self._previous = None

    async def _watch(self):
        try:
            while asyncio.get_running_loop().time() - self._last_used < 180:
                await asyncio.sleep(60)
                previous = self._last_used
                await self.list()
                self._last_used = previous
        finally:
            self._watcher = None

    async def aclose(self):
        self._closed = True
        tasks = [*self._sign_in_watch.values(), *self._checking.values()]
        self._sign_in_watch.clear()
        self._checking.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self._lost_watch:
            self._lost_watch.cancel()
            await asyncio.gather(self._lost_watch, return_exceptions=True)
        if self._model_refresh:
            self._model_refresh.cancel()
            await asyncio.gather(self._model_refresh, return_exceptions=True)
        if self._watcher:
            self._watcher.cancel()
            await asyncio.gather(self._watcher, return_exceptions=True)
