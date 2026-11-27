"""Git addresses as sources of skills, fetched by the computer's own Git (R-SKILL-33).

An address that is not GitHub's own (an SSH address `git@host:group/repo.git`, `ssh://...`, or an https address of GitLab,
Bitbucket, a company's own Git host) is cloned shallowly by the system's `git`, signing in as the owner does in a terminal: the
keys and the agent of this account, the credential helper of this computer. Nothing is asked in the process (no prompt, no
password dialog): a sign-in that needs one fails with the words that tell the owner what to do. The repository is data: no hook,
no submodule and no program of it runs, and no transport but ssh and https is allowed. Its folder is read as a folder of this
computer is (skill_sources.local), then removed unless the material is handed to Raphael.
"""

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .store import MemberError

CLONE_SECONDS = 600
SSH_CONNECT_SECONDS = 20
# `git@host:group/repo.git`, with the space a person may leave after the colon and the `.git` they may leave out.
_SCP = re.compile(r"(?P<user>[A-Za-z0-9_][\w.-]*)@(?P<host>[A-Za-z0-9][A-Za-z0-9.-]*):[ \t]*(?P<path>[\w.~+%/-]+)")
_SSH = re.compile(r"ssh://(?:(?P<user>[A-Za-z0-9_][\w.-]*)@)?(?P<host>[A-Za-z0-9][A-Za-z0-9.-]*)(?::(?P<port>\d{1,5}))?/(?P<path>[\w.~+%/-]+)")
# An https address is a repository when it says so (`.git`) or when its host is a forge: the first label of a company's own
# (`gitlab.example.com`, `git.example.com`) or a well known host.
_FORGE_LABELS = frozenset({"gitlab", "git", "gitea", "forgejo", "bitbucket", "codeberg", "bitbucket-server"})
_FORGE_HOSTS = frozenset({"gitlab.com", "bitbucket.org", "codeberg.org", "git.sr.ht", "dev.azure.com", "ssh.dev.azure.com"})
# What is GitHub's own is read through its API as one commit's files (skill_github.py), whatever it is called.
_GITHUB_HOSTS = frozenset({"github.com", "www.github.com", "skills.sh", "www.skills.sh", "raw.githubusercontent.com"})
_CREDENTIALS = re.compile(r"(?<=://)[^/@\s]+:[^/@\s]*@")


@dataclass(frozen=True)
class Address:
    """A Git address: what `git clone` is given, the host it names and what the repository is called."""

    url: str
    host: str
    name: str
    scheme: str

    @property
    def key(self):
        return "git:" + self.url


def _name(path):
    parts = [part for part in path.split("/") if part and part != "-"]
    return (parts[-1] if parts else "repository").removesuffix(".git") or "repository"


def _bad_path(path):
    return any(part in (".", "..") for part in path.split("/")) or path.startswith("-")


def address(source):
    """The `Address` a text names, or None when it is no Git address (a path, a GitHub or skills.sh link, a page, text). The
    text of one line only, as a person wrote it: quotes and a space after the colon are forgiven. An https address that holds a
    password is refused before anything runs (`git_credentials`)."""
    if not isinstance(source, str):
        return None
    text = source.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1].strip()
    if not text or "\n" in text or "\r" in text or "\x00" in text or text.startswith(("-", "local:")):
        return None
    if text.startswith("git+ssh://"):
        text = text[4:]
    if text.startswith("ssh://"):
        found = _SSH.fullmatch(text)
        if not found or _bad_path(found["path"]) or (found["port"] and int(found["port"]) > 65535):
            return None
        return Address(text, found["host"].lower(), _name(found["path"]), "ssh")
    if text.startswith("https://"):
        try:
            url = urlsplit(text)
            port = url.port
        except ValueError:
            return None
        host = (url.hostname or "").lower()
        if not host or host in _GITHUB_HOSTS or port not in (None, 443):
            return None
        if url.password:
            raise MemberError("source", "leave the password or token out of the address", reason="git_credentials", host=host)
        # A forge's own web address names the repository before its `/-/` (GitLab's `/-/tree/main`).
        path = unquote(url.path.split("/-/", 1)[0]).strip("/")
        parts = [part for part in path.split("/") if part]
        forge = host in _FORGE_HOSTS or host.split(".")[0] in _FORGE_LABELS
        if len(parts) < 2 or _bad_path(path) or not (path.endswith(".git") or forge):
            return None
        user = f"{url.username}@" if url.username else ""
        return Address(f"https://{user}{host}/{path}", host, _name(path), "https")
    found = _SCP.fullmatch(text)
    if found and not _bad_path(found["path"]):
        return Address(f"{found['user']}@{found['host']}:{found['path']}", found["host"].lower(), _name(found["path"]), "ssh")
    return None


def is_address(source):
    try:
        return address(source) is not None
    except MemberError:
        return True


# --- the clone ---------------------------------------------------------------------------------------------------------

_SIGN_IN = ("permission denied", "authentication failed", "could not read username", "could not read password",
            "terminal prompts disabled", "repository not found", "access denied", "http basic", "returned error: 401",
            "returned error: 403", "returned error: 404", "not found or you don't have permission", "don't have permission",
            "does not appear to be a git repository", "could not read from remote repository", "publickey",
            "fatal: could not read", "no matching host key", "no supported authentication", "too many authentication failures")
_HOST_KEY = ("host key verification failed", "remote host identification has changed", "host key for")
_NETWORK = ("could not resolve", "name or service not known", "temporary failure in name resolution", "connection timed out",
            "connection refused", "network is unreachable", "no route to host", "failed to connect", "operation timed out",
            "connection reset", "timed out", "getaddrinfo", "connection closed by remote host", "kex_exchange_identification",
            "unable to connect")


def _clean(text, limit=300):
    """The last line git said, without an address's credentials."""
    lines = [line.strip() for line in _CREDENTIALS.sub("", text or "").splitlines() if line.strip()]
    useful = [line for line in lines if not line.lower().startswith(("hint:", "warning:"))] or lines
    return (useful[-1] if useful else "")[:limit]


def failure(stderr, where):
    """What git's error means, as the library's own refusal: who to sign in to, which host key, which host could not be reached."""
    low = (stderr or "").lower()
    host = where.host
    # The host key is checked before the sign-in: its refusal ends with "could not read from remote repository" too.
    if any(sign in low for sign in _HOST_KEY):
        return MemberError("source", f"{host} is not a host this computer's SSH trusts yet", reason="git_host_key", host=host)
    if any(sign in low for sign in _NETWORK) and "permission denied" not in low:
        return MemberError("download", f"{host} could not be reached", reason="git_network", host=host)
    if any(sign in low for sign in _SIGN_IN):
        return MemberError("source", f"{host} refused the sign-in, or has no repository there", reason="git_sign_in", host=host)
    return MemberError("download", "git could not fetch this address", reason="git_failed", host=host, why=_clean(stderr))


def _run(args, env, timeout):
    """One run of git with no input and no window; a seam the tests replace."""
    return subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=timeout, env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def _ssh_command(git, env):
    """The ssh git is told to use: the owner's own when set (the environment or git's config), else the system's ssh that
    never asks (BatchMode: a passphrase or a host key to accept is a failure that is said, not a prompt nobody sees)."""
    if env.get("GIT_SSH_COMMAND") or env.get("GIT_SSH"):
        return None
    try:
        configured = _run([git, "config", "--get", "core.sshCommand"], env, 10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        configured = ""
    return None if configured else f"ssh -o BatchMode=yes -o ConnectTimeout={SSH_CONNECT_SECONDS}"


def clone(where, folder, *, seconds=CLONE_SECONDS):
    """Clone `where` (an `Address`) shallowly into the empty `folder` with the system's git. A refusal says its cause."""
    git = shutil.which("git")
    if not git:
        raise MemberError("source", "git is not installed on this computer", reason="git_missing")
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "GIT_ASKPASS": "", "SSH_ASKPASS": "",
           "LC_ALL": "C", "LANGUAGE": "C"}
    ssh = _ssh_command(git, env)
    if ssh:
        env["GIT_SSH_COMMAND"] = ssh
    with tempfile.TemporaryDirectory(prefix="raphael-git-hooks-") as hooks:
        args = [git, "-c", f"core.hooksPath={hooks}", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never",
                "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", "clone", "--depth", "1",
                "--single-branch", "--no-tags", "--quiet", "--", where.url, str(folder)]
        try:
            done = _run(args, env, seconds)
        except subprocess.TimeoutExpired:
            raise MemberError("download", f"{where.host} did not answer in time", reason="git_network", host=where.host) from None
        except FileNotFoundError:
            raise MemberError("source", "git is not installed on this computer", reason="git_missing") from None
        except OSError as error:
            raise MemberError("download", "git could not run", reason="git_failed", host=where.host, why=_clean(str(error))) from None
    if done.returncode:
        raise failure(done.stderr, where)


async def fetch(where, parent, *, seconds=CLONE_SECONDS):
    """The folder `where` was cloned into, below `parent` (made if needed); nothing is left behind when it fails."""
    parent = Path(parent)
    parent.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix=where.name[:40] + "-", dir=parent))
    try:
        await asyncio.to_thread(clone, where, folder, seconds=seconds)
    except BaseException:
        await asyncio.to_thread(shutil.rmtree, folder, True)
        raise
    return folder


async def fetch_plugin(source, parent):
    """The whole tree of a Git address that is a plugin, as `(files, identity)` (what a refresh of a plugin set reads again)."""
    from .skill_layouts import folder_is_plugin, normalized
    from .skill_plugins import local_files

    where = address(source)
    folder = await fetch(where, parent)
    try:
        if not folder_is_plugin(folder):
            raise MemberError("source", f"{where.name} is not a plugin: it has no .claude-plugin/plugin.json", reason="no_manifest",
                              file=where.name)
        files = await asyncio.to_thread(lambda: normalized(local_files(folder), where.name))
        if files is None:
            raise MemberError("source", f"{where.name} lists no plugin of its own", reason="no_manifest", file=where.name)
        return files, where.key
    finally:
        await asyncio.to_thread(shutil.rmtree, folder, True)
