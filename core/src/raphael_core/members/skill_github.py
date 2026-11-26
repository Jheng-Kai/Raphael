"""GitHub as a source of skills: a repository, a folder, one SKILL.md or a skills.sh page, read as the files of one commit.

The API names the commit and lists its files; only the files of the chosen skill folders (and what their documents
link to) are downloaded from the raw host, each checked against the hash the listing names. No repository is ever
downloaded whole, so its size is no limit; no redirect leaves GitHub's API; no link or submodule is followed.
Every failure names its cause (network, rate limit, not found, no SKILL.md): see skill_errors.py.
"""

import asyncio
import hashlib
import json
import re
from dataclasses import dataclass, field
from urllib.parse import quote, unquote, urlsplit

import httpx

from .skill_errors import no_skill, oversized_package, too_many_files
from .skill_library import MAX_ARCHIVE_ENTRIES, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, junk
from .skill_references import MemorySource, attach_shared
from .store import MemberError

API = "https://api.github.com"
RAW = "https://raw.githubusercontent.com"
NAME = re.compile(r"[A-Za-z0-9_.-]+")
# Listings are JSON read whole: a reply bigger than this is no listing.
MAX_LISTING_BYTES = 64 * 1024 * 1024
PARALLEL = 8
# A ref may hold slashes (feature/x): how many leading segments of a link are tried as a ref before the link is refused.
MAX_REF_SEGMENTS = 8
# Hidden folders a skill may live in; any other folder starting with a dot (.git, .github) holds no skill.
HIDDEN_SKILL_FOLDERS = frozenset({".claude", ".agents", ".codex"})


@dataclass(frozen=True)
class Target:
    repo: str
    # What follows the repository in a tree, blob or raw link, before the ref is told from the path.
    rest: tuple = ()
    # The folder of a link that names no ref (owner/repo/folder).
    path: str = ""
    # A link that names one SKILL.md, and the skill of a skills.sh page.
    file: bool = False
    skill: str = ""

    @property
    def label(self):
        """What a package made of this source is called: its skill, its folder, else its repository."""
        folder = self.path.rsplit("/", 1)[-1] or (self.rest[-1] if len(self.rest) > 1 else "")
        return self.skill or folder or self.repo.split("/")[1]


def _fail(reason, message, kind="source", **detail):
    return MemberError(kind, message, reason=reason, **detail)


def parse(source):
    """Where a skill source points: raises the plain refusal of a source GitHub cannot serve (before any request)."""
    if not isinstance(source, str) or not source.strip():
        raise _fail("empty", "give a GitHub link, owner/repo or a skills.sh link")
    text = source.strip()
    if "://" not in text:
        head = text.split("/", 1)[0].lower()
        if head in ("github.com", "www.github.com", "skills.sh", "www.skills.sh", "raw.githubusercontent.com"):
            text = "https://" + text
    if "://" in text:
        try:
            url = urlsplit(text)
            port = url.port
        except ValueError:
            raise _fail("invalid", f"{text} is not a link", file=text[:200]) from None
        host = (url.hostname or "").lower()
        if url.scheme != "https" or url.username or url.password or port:
            raise _fail("insecure", "a skill link is a plain https:// link", file=text[:200])
        # A pasted address often carries ?tab=readme or #readme: neither names anything.
        parts = [unquote(part) for part in url.path.strip("/").split("/") if part]
        if host in ("github.com", "www.github.com"):
            return _github_link(parts, text)
        if host == "raw.githubusercontent.com":
            if len(parts) < 4 or parts[-1] != "SKILL.md":
                raise _fail("not_skill_file", "a raw link must name a SKILL.md file", file=text[:200])
            return _repository(parts[:2], rest=tuple(parts[2:-1]), file=True)
        if host in ("skills.sh", "www.skills.sh"):
            if len(parts) < 2 or len(parts) > 3:
                raise _fail("invalid", "a skills.sh link is skills.sh/owner/repo or skills.sh/owner/repo/skill", file=text[:200])
            return _repository(parts[:2], skill=parts[2] if len(parts) == 3 else "")
        raise _fail("host", f"{host or text} is not a source: use a GitHub or skills.sh link, owner/repo, a file or a folder",
                    host=host or text[:100])
    parts = [part for part in text.split("/") if part]
    if len(parts) < 2:
        raise _fail("invalid", f"{text} is not owner/repo", file=text[:200])
    return _repository(parts[:2], path="/".join(parts[2:]))


def _github_link(parts, text):
    if len(parts) < 2:
        raise _fail("invalid", "a GitHub link names a repository: github.com/owner/repo", file=text[:200])
    if len(parts) == 2:
        return _repository(parts)
    kind = parts[2]
    if kind not in ("tree", "blob", "raw") or len(parts) < 4:
        raise _fail("invalid", "a GitHub link names a repository, a folder (tree) or a SKILL.md (blob)", file=text[:200])
    rest = tuple(parts[3:])
    if kind == "tree":
        return _repository(parts[:2], rest=rest)
    if rest[-1] != "SKILL.md":
        raise _fail("not_skill_file", f"{'/'.join(rest)} is not a SKILL.md: link its folder (tree) or the SKILL.md itself",
                    file="/".join(rest))
    return _repository(parts[:2], rest=rest[:-1], file=True)


def _repository(parts, *, rest=(), path="", file=False, skill=""):
    if rest[:1] == ("refs",) and rest[1:2] in (("heads",), ("tags",)):
        rest = rest[2:]
    owner, repo = parts[0], parts[1].removesuffix(".git")
    if not NAME.fullmatch(owner) or not NAME.fullmatch(repo) or owner in (".", "..") or repo in (".", ".."):
        raise _fail("invalid", f"{owner}/{repo} is not a GitHub repository", file=f"{owner}/{repo}"[:200])
    for part in (*rest, *path.split("/")):
        if part in (".", "..") or any(ord(char) < 32 or char in "\\" for char in part):
            raise _fail("invalid", "a skill link holds no . or .. folder", file="/".join(rest) or path)
    return Target(f"{owner}/{repo}", rest=rest, path=path, file=file, skill=skill)


def label(source):
    return parse(source).label


def refetchable(source):
    try:
        parse(source)
    except MemberError:
        return False
    return True


# ------------------------------------------------------------------------------------------------ the network

def _timeout_error():
    return MemberError("download", "GitHub did not answer in time", reason="timeout")


def _network_error(error):
    return MemberError("download", f"GitHub could not be reached ({type(error).__name__})", reason="network",
                       host="github.com")


class Client:
    """One import's requests: bounded replies, redirects only inside GitHub's API, and a plain cause for each failure."""

    def __init__(self, client):
        self.http = client

    async def get(self, url, *, limit, accept="application/vnd.github+json", expect=()):
        """The body of `url`, or None when the status is one of `expect`; any other failure is a MemberError."""
        for _ in range(4):
            try:
                async with self.http.stream("GET", url, headers={"Accept": accept}) as response:
                    if response.is_redirect:
                        location = response.headers.get("location", "")
                        if urlsplit(url).hostname == "api.github.com" and urlsplit(location).hostname == "api.github.com":
                            url = location
                            continue
                        raise MemberError("source", "GitHub sent the request somewhere else, which is not followed",
                                          reason="redirect", host=urlsplit(location).hostname or "")
                    if response.status_code in expect:
                        return None
                    self._status(response)
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data.extend(chunk)
                        if len(data) > limit:
                            raise MemberError("size", "GitHub's answer is larger than any listing", reason="listing")
                    return bytes(data)
            except MemberError:
                raise
            except httpx.TimeoutException:
                raise _timeout_error() from None
            except httpx.HTTPError as error:
                raise _network_error(error) from None
        raise MemberError("source", "GitHub sent the request around in a circle", reason="redirect")

    @staticmethod
    def _status(response):
        code = response.status_code
        if code < 400:
            return
        limited = code == 429 or (code == 403 and (response.headers.get("x-ratelimit-remaining") == "0"
                                                    or "retry-after" in response.headers))
        if limited:
            raise MemberError("download", "GitHub's request limit is reached for now: try again in a while", reason="rate_limit")
        raise MemberError("download", f"GitHub answered {code}", reason="status", status=code)

    async def json(self, url, *, limit=MAX_LISTING_BYTES, expect=()):
        body = await self.get(url, limit=limit, expect=expect)
        if body is None:
            return None
        try:
            value = json.loads(body)
        except ValueError:
            raise MemberError("download", "GitHub sent an answer that is not a listing", reason="status", status=0) from None
        return value


def _not_found(repo, reason="repo", **detail):
    if reason == "repo":
        return MemberError("not_found", f"GitHub has no repository {repo}, or it is private", reason="repo", repo=repo)
    return MemberError("not_found", f"{repo}: {detail.get('file', '')} was not found", reason=reason, repo=repo, **detail)


async def resolve(client, target):
    """`(commit, ref, folder)`: the commit a link names now, the ref it named ("" for the default branch) and its folder."""
    repo = target.repo
    if not target.rest:
        found = await client.json(f"{API}/repos/{repo}/commits/HEAD", limit=1024 * 1024, expect=(404, 409, 422))
        if found is None:
            raise _not_found(repo)
        return _sha(found), "", target.path
    for count in range(1, min(len(target.rest), MAX_REF_SEGMENTS) + 1):
        ref = "/".join(target.rest[:count])
        found = await client.json(f"{API}/repos/{repo}/commits/{quote(ref, safe='')}", limit=1024 * 1024, expect=(404, 409, 422))
        if found is not None:
            return _sha(found), ref, "/".join(target.rest[count:])
    if await client.json(f"{API}/repos/{repo}", limit=1024 * 1024, expect=(404,)) is None:
        raise _not_found(repo)
    raise MemberError("not_found", f"{repo} has no branch, tag or commit named as this link says", reason="ref", repo=repo,
                      file="/".join(target.rest[:1]))


def _sha(found):
    sha = found.get("sha") if isinstance(found, dict) else None
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise MemberError("download", "GitHub did not name a commit", reason="status", status=0)
    return sha


@dataclass
class Listing:
    repo: str
    commit: str
    files: dict = field(default_factory=dict)  # repository path -> (size, sha, mode)


async def listing(client, repo, commit, folder):
    """The files of `folder` at `commit`. A listing GitHub cuts short is read by folder instead."""
    sha = commit
    data = await client.json(f"{API}/repos/{repo}/git/trees/{sha}?recursive=1")
    walked = []
    if isinstance(data, dict) and data.get("truncated") and folder:
        for part in folder.split("/"):
            level = await client.json(f"{API}/repos/{repo}/git/trees/{sha}")
            entry = next((e for e in (level or {}).get("tree", []) if isinstance(e, dict) and e.get("path") == part
                          and e.get("type") == "tree"), None)
            if entry is None:
                raise MemberError("not_found", f"{folder} was not found in {repo}", reason="path", repo=repo, file=folder)
            sha = entry["sha"]
            walked.append(part)
        data = await client.json(f"{API}/repos/{repo}/git/trees/{sha}?recursive=1")
    if not isinstance(data, dict) or not isinstance(data.get("tree"), list):
        raise MemberError("download", "GitHub sent an unreadable listing", reason="status", status=0)
    if data.get("truncated") or len(data["tree"]) > MAX_ARCHIVE_ENTRIES:
        raise MemberError("size", "GitHub lists this repository only in part: link the folder of the skills "
                          "(github.com/owner/repo/tree/branch/folder)", reason="listing", repo=repo)
    base = "/".join(walked)
    result = Listing(repo, commit)
    for entry in data["tree"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
            raise MemberError("download", "GitHub sent an unreadable listing", reason="status", status=0)
        if entry.get("type") == "blob" or entry.get("type") == "commit":
            path = f"{base}/{entry['path']}" if base else entry["path"]
            kind = "submodule" if entry.get("type") == "commit" else entry.get("mode", "100644")
            size = entry.get("size", 0)
            result.files[path] = (size if type(size) is int else 0, str(entry.get("sha", "")), kind)
    return result


def _blob_sha(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


async def download(client, repo, commit, path, size, sha):
    """One file of the commit, as the listing names it: its size and its hash must be the ones listed."""
    url = f"{RAW}/{repo}/{commit}/{quote(path, safe='/')}"
    body = await client.get(url, limit=size + 1, accept="*/*", expect=(404,))
    if body is None:
        raise MemberError("not_found", f"{path} is in the listing of {repo} but GitHub does not serve it", reason="path",
                          repo=repo, file=path)
    if len(body) != size or (sha and _blob_sha(body) != sha):
        raise MemberError("download", f"{path} is not the file the commit lists: import again", reason="changed", file=path)
    return body


def discoverable(path):
    """Whether a SKILL.md at `path` can be a skill: not in a generated folder, and not in a hidden one other than the
    folders agent tools keep skills in."""
    parts = path.split("/")[:-1]
    return not junk(path) and all(not part.startswith(".") or part in HIDDEN_SKILL_FOLDERS for part in parts)


def slug(name):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]", "", re.sub(r"[\s_]+", "-", name.lower()))).strip("-")


def skill_folders(listed, folder, skill=""):
    """The folders of the skills below `folder`: that folder alone when it holds a SKILL.md, else every folder with one,
    the outermost where a skill holds another's document."""
    prefix = folder + "/" if folder else ""
    owns = sorted({path[:-len("SKILL.md")] for path in listed.files if path.startswith(prefix)
                   and path.rsplit("/", 1)[-1] == "SKILL.md" and discoverable(path[len(prefix):])})
    folders = []
    for own in owns:
        if not folders or not own.startswith(folders[-1]):
            folders.append(own)
    return folders


async def _skill_files(client, listed, own, others=(), *, used):
    """The files of one skill folder `own` ("" for the repository root): validated like any snapshot, then downloaded."""
    from .skill_sources import Snapshot

    snapshot = Snapshot(byte_limit=MAX_PACKAGE_BYTES - used[0], entry_limit=MAX_PACKAGE_FILES - used[1])
    snapshot.prefix = own
    wanted = []
    for path in sorted(listed.files):
        if not path.startswith(own) or junk(path[len(own):]) or any(path.startswith(other) for other in others):
            continue
        size, sha, mode = listed.files[path]
        relative = path[len(own):]
        if mode == "submodule":
            # Another repository nested here: it is not part of this one's commit.
            snapshot.files.skipped_links.append(relative)
            continue
        # A link inside the folder is read as the path it holds and resolved within the folder, as an archive's is.
        key = snapshot.entry(relative, False, 0 if mode == "120000" else size)
        wanted.append((key, path, size, sha, mode == "120000"))
    gate = asyncio.Semaphore(PARALLEL)

    async def one(relative, path, size, sha, link):
        async with gate:
            body = await download(client, listed.repo, listed.commit, path, size, sha)
        return relative, body, link

    for relative, body, link in await asyncio.gather(*(one(*item) for item in wanted)):
        if link:
            snapshot.links[relative] = body.decode("utf-8", "replace")
        else:
            snapshot.files[relative] = body
    return snapshot


async def fetch(source):
    """The skills of a GitHub source as the `(skill link, SkillFiles)` pairs the importer installs."""
    from .capabilities import DOWNLOAD_SECONDS, DOWNLOAD_STALL_SECONDS
    from .skill_sources import PLUGIN_MANIFEST

    target = parse(source)
    try:
        async with asyncio.timeout(DOWNLOAD_SECONDS), httpx.AsyncClient(timeout=DOWNLOAD_STALL_SECONDS, follow_redirects=False,
                                                                       trust_env=False) as http:
            client = Client(http)
            commit, ref, folder = await resolve(client, target)
            listed = await listing(client, target.repo, commit, folder)
            if target.file and f"{folder + '/' if folder else ''}SKILL.md" not in listed.files:
                raise MemberError("not_found", f"{folder + '/' if folder else ''}SKILL.md is not in {target.repo}",
                                  reason="path", repo=target.repo, file=f"{folder + '/' if folder else ''}SKILL.md")
            folders = skill_folders(listed, folder)
            if target.skill:
                folders = await _named(client, listed, folders, folder, target.skill)
            if not folders:
                raise no_skill(f"{target.repo}/{folder}" if folder else target.repo)
            used = [0, 0]
            result = []
            loop = asyncio.get_running_loop()
            sources = {}
            for own in folders:
                snapshot = await _skill_files(client, listed, own, used=used)
                files = snapshot.finish()
                files.folder = own
                plugin = _plugin_root(listed, own)
                files.plugin_manifest = plugin is not None
                # What the skill links to elsewhere in its plugin, else in the repository, comes with it.
                base = plugin or ""
                if own != base:
                    if base not in sources:
                        sources[base] = _source(client, listed, base, loop)
                    await asyncio.to_thread(attach_shared, files, snapshot, own[len(base):].rstrip("/"), sources[base])
                used[0] += snapshot.size
                used[1] += len(snapshot.explicit)
                result.append((f"https://github.com/{target.repo}/blob/{quote(ref or 'HEAD', safe='/')}/"
                               f"{quote(own, safe='/')}SKILL.md", files))
            return result
    except MemberError:
        raise
    except TimeoutError:
        raise _timeout_error() from None
    except httpx.HTTPError as error:
        raise _network_error(error) from None


async def fetch_plugin(source):
    """The files of the plugin a GitHub link names (its folder holds `.claude-plugin/plugin.json`), as `{path: bytes}`
    from its root, and the identity of that plugin. A link inside it is never followed."""
    from .capabilities import DOWNLOAD_SECONDS, DOWNLOAD_STALL_SECONDS

    target = parse(source)
    try:
        async with asyncio.timeout(DOWNLOAD_SECONDS), httpx.AsyncClient(timeout=DOWNLOAD_STALL_SECONDS, follow_redirects=False,
                                                                       trust_env=False) as http:
            client = Client(http)
            commit, ref, folder = await resolve(client, target)
            listed = await listing(client, target.repo, commit, folder)
            prefix = folder + "/" if folder else ""
            if prefix + ".claude-plugin/plugin.json" not in listed.files:
                raise MemberError("source", f"{target.repo}{'/' + folder if folder else ''} is not a plugin: it has no "
                                  ".claude-plugin/plugin.json", reason="no_manifest", repo=target.repo, file=folder)
            wanted, size, links = [], 0, []
            for path in sorted(listed.files):
                if not path.startswith(prefix) or junk(path[len(prefix):]):
                    continue
                length, sha, mode = listed.files[path]
                if mode in ("120000", "submodule"):
                    links.append(path[len(prefix):])
                    continue
                if len(wanted) >= MAX_PACKAGE_FILES:
                    raise too_many_files(len(wanted) + 1, MAX_PACKAGE_FILES, path[len(prefix):])
                if size + length > MAX_PACKAGE_BYTES:
                    raise oversized_package(path[len(prefix):], size + length, MAX_PACKAGE_BYTES)
                size += length
                wanted.append((path, length, sha))
            gate = asyncio.Semaphore(PARALLEL)

            async def one(path, length, sha):
                async with gate:
                    return path[len(prefix):], await download(client, target.repo, commit, path, length, sha)

            return dict(await asyncio.gather(*(one(*item) for item in wanted))), f"url:{target.repo}:{folder}"
    except MemberError:
        raise
    except TimeoutError:
        raise _timeout_error() from None
    except httpx.HTTPError as error:
        raise _network_error(error) from None


def _plugin_root(listed, own):
    """The folder (`""` or `a/b/`) of the plugin a skill sits in: the nearest `.claude-plugin/plugin.json` at its folder or
    above it; None when it sits in none."""
    path = own.rstrip("/")
    while True:
        if (f"{path}/.claude-plugin/plugin.json" if path else ".claude-plugin/plugin.json") in listed.files:
            return path + "/" if path else ""
        if not path:
            return None
        path = path.rpartition("/")[0]


def _source(client, listed, base, loop):
    """The files of the commit below `base` as a reference source: what a document links to is downloaded when it is asked
    for, from the worker thread that follows the links."""
    files = {path[len(base):]: ("linked" if mode in ("120000", "submodule") else size)
             for path, (size, sha, mode) in listed.files.items() if path.startswith(base) and not junk(path[len(base):])}

    def fetch(path):
        size, sha, _ = listed.files[base + path]
        return asyncio.run_coroutine_threadsafe(download(client, listed.repo, listed.commit, base + path, size, sha), loop).result()

    return MemorySource(files, fetch)


async def _named(client, listed, folders, folder, name):
    """The skills.sh skill `name`: the folder named so, else the skill whose document names it, else a lone root skill."""
    wanted = slug(name)
    by_folder = [own for own in folders if slug(own.rstrip("/").split("/")[-1]) == wanted]
    if by_folder:
        return by_folder
    from .capabilities import skill_metadata

    for own in folders:
        path = own + "SKILL.md"
        size, sha, mode = listed.files[path]
        try:
            text = (await download(client, listed.repo, listed.commit, path, size, sha)).decode("utf-8-sig")
            if slug(skill_metadata(text, writing=False)[0]) == wanted:
                return [own]
        except (MemberError, UnicodeError):
            continue
    if "" in folders or (folder and folder + "/" in folders):
        return [folders[0]]
    raise MemberError("not_found", f'no skill named "{name}" in {listed.repo}', reason="skill", repo=listed.repo, name=name)
