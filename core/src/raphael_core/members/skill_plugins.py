"""Plugin sets in the shared capability store; manifests are data, never code.

Source fields follow installed Claude marketplace/plugin manifests and CLI help:
relative folders, GitHub repositories, URL and git-subdir sources. Other sources
remain visible with a refusal reason. GitHub reads are pinned to resolved commits.
"""

import asyncio
import hashlib
import json
import os
import re
import shutil
import tempfile
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlsplit

import httpx

from ..bots.homes import atomic
from .store import MemberError
from .skill_errors import oversized_file, oversized_package, too_many_files
from .skill_library import (SHARED, MAX_ARCHIVE_ENTRIES, MAX_DISCOVERY_DEPTH, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES,
                            MAX_DISCOVERY_ENTRIES, junk, linked, location, roots, stage_files, version_key, walk)

# A manifest or a tree listing is JSON read whole: these only keep a reply that is no manifest from filling memory.
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_TREE_BYTES = 64 * 1024 * 1024
REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
SHA = re.compile(r"[a-fA-F0-9]{40}")


def relative_path(value):
    if not isinstance(value, str) or not value or re.search(r'[\\:<>"|?*\x00-\x1f]', value):
        raise MemberError("source", "invalid plugin path")
    value = value.removeprefix("./").rstrip("/")
    parts = value.split("/")
    if value.startswith("/") or any(p in ("", ".", "..") or p.endswith((".", " ")) for p in parts):
        raise MemberError("source", "invalid plugin path")
    if any(re.fullmatch(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", p, re.I) for p in parts):
        raise MemberError("source", "invalid plugin path")
    return value


def json_object(data):
    try:
        value = json.loads(data.decode("utf-8-sig"))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise MemberError("source", "invalid plugin manifest") from None


def local_files(folder):
    """Bound the entire set, including hidden manifests, without following links."""
    from .skill_sources import folder_snapshot

    # A link inside the plugin to a file of it is that file's copy; any other is named and left out, never followed.
    return folder_snapshot(folder, byte_limit=MAX_PACKAGE_BYTES, entry_limit=MAX_PACKAGE_FILES, depth_limit=MAX_DISCOVERY_DEPTH,
                           skill_links=True).finish(skill=False)


def local_stamp(folder):
    entries, size, count = [], 0, 0
    for directory, dirs, names in os.walk(folder, followlinks=False):
        dirs[:] = [name for name in dirs if not junk(name)]
        names[:] = [name for name in names if not junk(name)]
        count += len(dirs) + len(names)
        if count > MAX_ARCHIVE_ENTRIES or len(Path(directory).relative_to(folder).parts) > MAX_DISCOVERY_DEPTH:
            raise MemberError("size", f"{directory} holds more than a plugin can: pick the folder of the plugin itself",
                              reason="scan")
        for name in [*dirs, *names]:
            if linked(Path(directory) / name):
                shown = (Path(directory) / name).relative_to(folder).as_posix()
                raise MemberError("source", f"{shown} is a link, and links are not followed", reason="linked", file=shown)
        for name in names:
            path = Path(directory) / name
            info = path.stat()
            size += info.st_size
            entries.append((path.relative_to(folder).as_posix(), info.st_size, info.st_mtime_ns))
            if size > MAX_PACKAGE_BYTES:
                raise oversized_package(entries[-1][0], size, MAX_PACKAGE_BYTES)
            if len(entries) > MAX_PACKAGE_FILES:
                raise too_many_files(len(entries), MAX_PACKAGE_FILES, entries[-1][0])
    return hashlib.sha256(json.dumps(sorted(entries)).encode()).hexdigest()


def directories(folder, remaining):
    result = []
    with os.scandir(folder) as scan:
        for entry in scan:
            remaining[0] -= 1
            if remaining[0] < 0:
                raise MemberError("size", "plugin scan limit reached")
            path = Path(entry.path)
            if entry.is_dir(follow_symlinks=False) and not linked(path) and not entry.name.startswith(".") and entry.name != "node_modules":
                result.append(path)
    return result


def manifest_from(files):
    data = files.get(".claude-plugin/plugin.json")
    if data is None:
        raise MemberError("source", "a plugin needs .claude-plugin/plugin.json", reason="no_manifest")
    if len(data) > MAX_MANIFEST_BYTES:
        raise oversized_file(".claude-plugin/plugin.json", len(data), MAX_MANIFEST_BYTES)
    manifest = json_object(data)
    if not isinstance(manifest.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", manifest["name"]):
        raise MemberError("source", "invalid plugin name")
    # A manifest need not name a version (Claude's own does not): such a plugin has none.
    if not isinstance(manifest.get("version", ""), str) or len(manifest.get("version", "")) > 100:
        raise MemberError("source", "the version of a plugin must be text of at most 100 characters")
    manifest.setdefault("version", "")
    return manifest


def component_paths(manifest, kind):
    extra = manifest.get(kind, [])
    if isinstance(extra, str):
        extra = [extra]
    if not isinstance(extra, list) or any(not isinstance(p, str) for p in extra):
        raise MemberError("source", "unsupported plugin component paths")
    return [kind, *[relative_path(p) for p in extra]]


def folded_path(path):
    """A path as Windows (and macOS) compare it: separators normalised, case ignored. A GitHub plugin can hold skills/Outer and
    skills/outer/inner, which both pass the import checks yet share one directory tree there (#313)."""
    return str(path).replace("\\", "/").casefold()


def inside_folder(path, folder):
    """Whether `path` is `folder` or lies under it, compared with folded_path."""
    path, folder = folded_path(path), folded_path(folder)
    return path == folder or path.startswith(folder + "/")


def without_skipped(files, parts, gone):
    """The plugin's files minus those of the skipped parts. A file belongs to the deepest skill folder that holds it, so a
    skill nested in a skipped one (skills/outer/inner/SKILL.md) keeps its own files (#313). Folders are compared ignoring case."""
    folders = [folded_path(PurePosixPath(part["key"]).parent) for part in parts if part["kind"] == "skill"]
    dropped = {folded_path(PurePosixPath(part["key"]).parent) for part in gone if part["kind"] == "skill"}
    commands = {part["key"] for part in gone if part["kind"] == "command"}

    def owner(path):
        path = folded_path(path)
        return max((f for f in folders if path.startswith(f + "/")), key=len, default=None)

    return {path: data for path, data in files.items() if path not in commands and owner(path) not in dropped}


def plugin_parts(files, *, existing_names=None):
    from .capabilities import MAX_SKILL_BYTES, skill_metadata
    from .skill_names import unique_skill_name
    from ..bots.homes import redact_secrets

    manifest = manifest_from(files)
    parts = []
    taken = set()
    skills = component_paths(manifest, "skills")
    commands = component_paths(manifest, "commands")
    for path, data in sorted(files.items()):
        kind = None
        if path.endswith("/SKILL.md") and any(path.startswith(root + "/") for root in skills):
            kind = "skill"
        elif path.endswith(".md") and any(path == root or path.startswith(root + "/") for root in commands):
            kind = "command"
        if kind is None:
            continue
        if len(data) > MAX_SKILL_BYTES:
            raise oversized_file(path, len(data), MAX_SKILL_BYTES)
        try:
            text = data.decode("utf-8-sig")
        except UnicodeError:
            raise MemberError("source", "plugin documents must be UTF-8") from None
        if "\x00" in text:
            raise MemberError("source", "plugin documents must be UTF-8")
        text = redact_secrets(text)
        if kind == "command":
            name = PurePosixPath(path).stem
            match = re.search(r"^description:[ \t]*([^\r\n]+)", text, re.M)
            description = match[1].strip().strip("\"'") if match else name
            text = "---\nname: " + json.dumps(name, ensure_ascii=False) + "\ndescription: " + json.dumps(description, ensure_ascii=False) + "\n---\n" + text
        key = str(PurePosixPath(path).parent) if kind == "skill" else path
        name, description = skill_metadata(text, writing=True, previous_name=(existing_names or {}).get(key))
        name = unique_skill_name(name, taken)
        taken.add(name.casefold())
        parts.append({"key": path, "kind": kind, "name": name, "description": description, "text": text})
    return manifest, parts


def mcp_servers(files, manifest):
    """Only public settings and secret names reach the owner's existing MCP cards."""
    declarations = []
    if ".mcp.json" in files:
        if len(files[".mcp.json"]) > MAX_MANIFEST_BYTES:
            raise MemberError("size", "MCP declaration is too large")
        declarations.append(json_object(files[".mcp.json"]))
    extra = manifest.get("mcpServers", [])
    if isinstance(extra, (str, dict)):
        extra = [extra]
    if not isinstance(extra, list):
        raise MemberError("source", "unsupported MCP declarations")
    for value in extra:
        if isinstance(value, str):
            path = relative_path(value)
            if path not in files or len(files[path]) > MAX_MANIFEST_BYTES:
                raise MemberError("source", "missing MCP declaration")
            value = json_object(files[path])
        if not isinstance(value, dict):
            raise MemberError("source", "unsupported MCP declaration")
        declarations.append(value)
    servers = {}
    for declaration in declarations:
        items = declaration.get("mcpServers", declaration)
        if not isinstance(items, dict):
            raise MemberError("source", "invalid MCP declaration")
        for name, value in items.items():
            if not isinstance(name, str) or not isinstance(value, dict):
                raise MemberError("source", "invalid MCP declaration")
            transport = "http" if value.get("type") in ("http", "sse") or "url" in value else "stdio"
            if not isinstance(value.get("env", {}), dict) or not isinstance(value.get("headers", {}), dict):
                raise MemberError("source", "invalid MCP declaration")
            fields = {"name": name, "transport": transport, "command": value.get("command", ""),
                             "args": value.get("args", []), "url": value.get("url", ""),
                             "env": list(value.get("env", {})), "headers": list(value.get("headers", {}))}
            from ..integrations.config import parse_new_server
            try:
                parse_new_server({**fields, "env": [{"name": k, "value": "validation-only"} for k in fields["env"]], "headers": [{"name": k, "value": "validation-only"} for k in fields["headers"]]}, [])
            except (ValueError, TypeError):
                raise MemberError("source", "invalid MCP declaration") from None
            servers[name] = fields
    return list(servers.values())


async def get_bytes(client, url, limit):
    async with client.stream("GET", url, headers={"Accept": "application/vnd.github+json"}) as response:
        if response.is_redirect:
            raise MemberError("source", "plugin redirects are not accepted")
        response.raise_for_status()
        data = bytearray()
        async for chunk in response.aiter_bytes():
            data.extend(chunk)
            if len(data) > limit:
                raise MemberError("size", "plugin download is too large")
        return bytes(data)


def github_repo(value):
    if isinstance(value, str) and len(value) <= 201 and REPO.fullmatch(value) and all(p not in (".", "..") for p in value.split("/")):
        return value
    raise MemberError("source", "a marketplace is a GitHub owner/repo")


async def commit(client, repo, ref="HEAD"):
    if not isinstance(ref, str) or not ref or len(ref) > 200:
        raise MemberError("source", "invalid GitHub reference")
    if SHA.fullmatch(ref):
        return ref.lower()
    data = json_object(await get_bytes(client, f"https://api.github.com/repos/{repo}/commits/{quote(ref, safe='')}", MAX_MANIFEST_BYTES))
    if not isinstance(data.get("sha"), str) or not SHA.fullmatch(data["sha"]):
        raise MemberError("source", "GitHub did not resolve a commit")
    return data["sha"].lower()


def source_target(source, marketplace, catalog_sha):
    if isinstance(source, str) and source.startswith("./"):
        return {"repo": marketplace, "path": relative_path(source), "ref": catalog_sha}
    if not isinstance(source, dict):
        raise MemberError("unsupported", "only GitHub plugin sources are installable")
    kind = source.get("source")
    if kind == "github":
        repo = github_repo(source.get("repo"))
    elif kind in ("url", "git-subdir"):
        value = source.get("url", "")
        if not isinstance(value, str) or len(value) > 1000:
            raise MemberError("unsupported", "only HTTPS GitHub plugin sources are installable")
        url = urlsplit(value)
        if url.scheme != "https" or url.netloc != "github.com" or url.query or url.fragment:
            raise MemberError("unsupported", "only HTTPS GitHub plugin sources are installable")
        repo = github_repo(url.path.strip("/").removesuffix(".git"))
    else:
        raise MemberError("unsupported", "plugin source type is not supported yet")
    if source.get("headersHelper"):
        raise MemberError("unsupported", "plugin download helpers are not executed")
    return {"repo": repo, "path": relative_path(source.get("path")) if kind == "git-subdir" else "",
            "ref": source.get("sha") or source.get("ref") or "HEAD"}


async def catalog(repo):
    github_repo(repo)
    from .capabilities import DOWNLOAD_SECONDS, DOWNLOAD_STALL_SECONDS

    try:
        async with asyncio.timeout(DOWNLOAD_SECONDS), httpx.AsyncClient(timeout=DOWNLOAD_STALL_SECONDS, follow_redirects=False, trust_env=False) as client:
            sha = await commit(client, repo)
            data = json_object(await get_bytes(client, f"https://raw.githubusercontent.com/{repo}/{sha}/.claude-plugin/marketplace.json", MAX_MANIFEST_BYTES))
            if not isinstance(data.get("name"), str) or not isinstance(data.get("plugins"), list):
                raise MemberError("source", "invalid marketplace manifest")
            plugins, names = [], set()
            for entry in data["plugins"]:
                if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", entry["name"]) or entry["name"] in names:
                    raise MemberError("source", "invalid or duplicate marketplace plugin")
                names.add(entry["name"])
                item = {"name": entry["name"], "description": str(entry.get("description", "")), "version": entry.get("version", "") if isinstance(entry.get("version", ""), str) else "", "installable": False}
                try:
                    target = source_target(entry.get("source"), repo, sha)
                    target["commit"] = await commit(client, target["repo"], target.pop("ref"))
                    prefix = target["path"] + "/" if target["path"] else ""
                    raw = await get_bytes(client, f"https://raw.githubusercontent.com/{target['repo']}/{target['commit']}/{prefix}.claude-plugin/plugin.json", MAX_MANIFEST_BYTES)
                    manifest = manifest_from({".claude-plugin/plugin.json": raw})
                    if manifest["name"] != entry["name"] or (item["version"] and item["version"] != manifest["version"]):
                        raise MemberError("source", "listed plugin name or version differs from its manifest")
                    item.update(version=manifest["version"], description=item["description"] or str(manifest.get("description", "")), target=target, installable=True)
                except (MemberError, httpx.HTTPError, ValueError, TypeError) as error:
                    item["reason"] = str(error) if isinstance(error, MemberError) else "plugin manifest is unavailable"
                plugins.append(item)
            return {"repo": repo, "name": data["name"], "plugins": plugins}
    except MemberError:
        raise
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError):
        raise MemberError("download", "could not read the GitHub marketplace") from None


async def download_plugin(target):
    from .capabilities import DOWNLOAD_SECONDS, DOWNLOAD_STALL_SECONDS

    try:
        async with asyncio.timeout(DOWNLOAD_SECONDS), httpx.AsyncClient(timeout=DOWNLOAD_STALL_SECONDS, follow_redirects=False, trust_env=False) as client:
            repo, sha, prefix = target["repo"], target["commit"], target["path"]
            tree = json_object(await get_bytes(client, f"https://api.github.com/repos/{repo}/git/trees/{sha}?recursive=1", MAX_TREE_BYTES))
            entries = tree.get("tree")
            if tree.get("truncated") or not isinstance(entries, list) or len(entries) > MAX_ARCHIVE_ENTRIES:
                raise MemberError("size", "GitHub lists this plugin only in part: it holds too many files", reason="listing")
            files, size, folded = {}, 0, set()
            for entry in entries:
                if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                    raise MemberError("source", "invalid GitHub plugin tree")
                path = entry.get("path", "")
                if prefix and not path.startswith(prefix + "/"):
                    continue
                if entry.get("type") == "tree":
                    continue
                if entry.get("type") != "blob" or entry.get("mode") not in ("100644", "100755"):
                    raise MemberError("source", "linked plugin packages are not supported")
                key = relative_path(path[len(prefix) + 1:] if prefix else path)
                declared = entry.get("size")
                if junk(key):
                    continue
                if type(declared) is not int or declared < 0:
                    raise MemberError("source", f"GitHub gave no size for {key}")
                if declared > MAX_PACKAGE_BYTES - size:
                    raise oversized_package(key, size + declared, MAX_PACKAGE_BYTES)
                if len(files) >= MAX_PACKAGE_FILES:
                    raise too_many_files(len(files) + 1, MAX_PACKAGE_FILES, key)
                if key.casefold() in folded or len(key.split("/")) > MAX_DISCOVERY_DEPTH + 1:
                    raise MemberError("archive", f"{key} is named twice, or twice in letters of another case, or nested too deep",
                                      reason="path", file=key)
                folded.add(key.casefold())
                data = await get_bytes(client, f"https://raw.githubusercontent.com/{repo}/{sha}/{quote(path, safe='/')}", MAX_PACKAGE_BYTES - size)
                if len(data) != declared:
                    raise MemberError("source", "plugin file size differs from its GitHub tree")
                size += len(data)
                files[key] = data
            return files
    except MemberError:
        raise
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError):
        raise MemberError("download", "could not download the GitHub plugin") from None


@dataclass
class PluginInstall:
    identity: str
    manifest: dict
    previous: object
    old: dict
    retained: set
    components: list
    files: dict
    source: str
    marketplace: str
    target: dict | None
    access: str | list | None
    servers: list
    revision: tuple
    skipped: list = field(default_factory=list)
    links: list = field(default_factory=list)


class PluginSets:
    def plugin_root(self, identifier):
        row = self.conn.execute("SELECT folder FROM skill_sets WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise MemberError("not_found", "no such plugin set")
        return self.homes.safe(self.homes.home(SHARED) / row[0])

    def unify_library(self):
        """Plugins made before the library was one folder lived in `skill-sets` beside `skills`: each moves into `skills`, and
        its row follows it. A move that stopped half way is finished by the next call; nothing is copied."""
        library = self.homes.home(SHARED)
        old, new = library / "skill-sets", library / "skills"
        if not old.is_dir() or not self.conn.execute("SELECT 1 FROM sqlite_master WHERE name='skill_sets'").fetchone():
            return
        new.mkdir(parents=True, exist_ok=True)
        for row in self.conn.execute("SELECT id,folder FROM skill_sets WHERE folder LIKE 'skill-sets/%'").fetchall():
            name = row["folder"].split("/", 1)[1]
            source, target = old / name, new / name
            if source.is_dir() and not target.exists():
                try:
                    self.homes.safe(source).rename(self.homes.safe(target))
                except OSError:
                    continue  # something holds the folder now: the plugin stays where it is, and the next start moves it
            if target.is_dir():
                with self.conn:
                    self.conn.execute("UPDATE skill_sets SET folder=? WHERE id=?", (f"skills/{name}", row["id"]))
        with suppress(OSError):
            old.rmdir()

    def local_plugins(self):
        """Only manifests and skill documents are opened during discovery."""
        result = {}
        remaining = [MAX_DISCOVERY_ENTRIES]
        for root in roots(self.skill_home)[3:]:
            if not root.is_dir() or any(linked(p) for p in (root, *root.parents)):
                continue
            try:
                for market in sorted(directories(root, remaining)):
                    if not market.is_dir() or linked(market) or market.name.startswith("."):
                        continue
                    for plugin in sorted(directories(market, remaining)):
                        if not plugin.is_dir() or linked(plugin):
                            continue
                        versions = directories(plugin, remaining)
                        for folder in sorted(versions, key=lambda p: (version_key(p.name), p.stat().st_mtime_ns), reverse=True):
                            metadata = folder / ".claude-plugin/plugin.json"
                            if not metadata.is_file() or linked(metadata) or linked(metadata.parent) or metadata.stat().st_size > MAX_MANIFEST_BYTES:
                                continue
                            try:
                                manifest = manifest_from({".claude-plugin/plugin.json": metadata.read_bytes()})
                                children, command_count = [], 0
                                for directory, dirs, files in walk(folder, remaining):
                                    for path, info in files:
                                        relative = path.relative_to(folder).as_posix()
                                        if relative.endswith(".md") and any(relative == p or relative.startswith(p + "/") for p in component_paths(manifest, "commands")):
                                            command_count += 1
                                        if path.name == "SKILL.md" and any(relative.startswith(p + "/") for p in component_paths(manifest, "skills")):
                                            from .skill_library import describe
                                            children.append(describe(directory, root, remaining))
                                            dirs[:] = []
                                item = {"kind": "plugin", "name": manifest["name"], "version": manifest["version"],
                                        "description": str(manifest.get("description", "")), "source": "local:" + str(folder.resolve()),
                                        "plugin": manifest["name"], "skill_count": len(children), "command_count": command_count, "skills": children}
                                result[(str(root), market.name, plugin.name)] = item
                                break
                            except (MemberError, OSError, UnicodeError):
                                continue
            except (OSError, MemberError):
                continue
        return list(result.values())

    def plugin_sources(self):
        plugins = self.local_plugins()
        prefixes = tuple(item["source"].replace("\\", "/") + "/" for item in plugins)
        return [s for s in self.local_sources() if not s["source"].replace("\\", "/").startswith(prefixes)] + plugins

    def set_skill_path(self, identifier):
        row = self.conn.execute("SELECT s.folder,k.set_key,k.set_kind FROM member_skills k JOIN skill_sets s ON s.id=k.set_id WHERE k.id=?", (identifier,)).fetchone()
        if row is None:
            return None
        key = row["set_key"] if row["set_kind"] == "skill" else ".raphael-commands/" + row["set_key"]
        return self.homes.safe(self.homes.home(SHARED) / row["folder"] / key / "SKILL.md")

    def _plugin_set_inputs(self, identifier=None):
        rows = self.conn.execute("SELECT * FROM skill_sets WHERE (? IS NULL OR id=?) ORDER BY id", (identifier, identifier))
        result = []
        for row in rows:
            info = json.loads(row["metadata"])
            latest = None
            if info.get("marketplace"):
                found = self.conn.execute("SELECT catalog FROM skill_marketplaces WHERE repo=?", (info["marketplace"],)).fetchone()
                latest = next((p for p in json.loads(found[0])["plugins"] if p["name"] == row["name"]), None) if found else None
            counts = dict(self.conn.execute("SELECT set_kind,COUNT(*) FROM member_skills WHERE set_id=? GROUP BY set_kind", (row["id"],)))
            result.append((row, info, latest, counts))
        return result

    def plugin_sets(self, identifier=None):
        return self._plugin_set_views(self._plugin_set_inputs(identifier))

    async def plugin_sets_async(self, identifier=None):
        return await asyncio.to_thread(self._plugin_set_views, self._plugin_set_inputs(identifier))

    def _plugin_set_views(self, inputs):
        result = []
        for row, info, latest, counts in inputs:
            if info.get("marketplace"):
                changed = bool(latest and latest["installable"] and version_key(latest["version"]) > version_key(row["version"]))
            elif row["source"].startswith("local:"):
                try:
                    changed = local_stamp(self._newest_version(row["source"])) != info.get("fingerprint")
                except (MemberError, OSError):
                    changed = None
            else:
                # A plugin from a GitHub link has no folder to compare: whether it moved on is asked of GitHub on an update.
                changed = None
            result.append({"id": row["id"], "name": row["name"], "version": row["version"], "description": row["description"],
                           "source": row["source"], "skill_count": counts.get("skill", 0), "command_count": counts.get("command", 0),
                           "source_changed": changed, "marketplace": info.get("marketplace", ""), "mcp_servers": info.get("mcp_servers", [])})
        return result

    def install_set(self, source, files, *, marketplace="", target=None, access=None, expected_id=None, require_new=False, required_skill=None):
        """Install synchronously through the same plan, writer and transaction."""
        plan = self._plan_set(source, files, marketplace=marketplace, target=target, access=access,
                              expected_id=expected_id, require_new=require_new, required_skill=required_skill)
        folder, info = self._write_set(plan)
        try:
            identifier = self._commit_set(plan, folder, info)
        except BaseException:
            self._discard_set(folder)
            raise
        self._discard_previous_set(plan)
        self._mirror(SHARED)
        return {**self.plugin_sets(identifier)[0], **({"skipped": plan.skipped} if plan.skipped else {})}

    async def _install_set_async(self, source, files, *, enabled=None, skill=None, **options):
        plan = self._plan_set(source, files, **options)
        folder, info = await stage_files(self._write_set, plan, discard=lambda staged: self._discard_set(staged[0]))
        try:
            identifier = self._commit_set(plan, folder, info, enabled=enabled, skill=skill)
        except BaseException:
            await asyncio.to_thread(self._discard_set, folder)
            raise
        installed = self._plugin_set_inputs(identifier)
        await asyncio.to_thread(self._discard_previous_set, plan)
        await self._mirror_async(SHARED)
        view = (await asyncio.to_thread(self._plugin_set_views, installed))[0]
        return {**view, **({"skipped": plan.skipped} if plan.skipped else {})}

    def _plan_set(self, source, files, *, marketplace="", target=None, access=None, expected_id=None,
                  require_new=False, required_skill=None, identity=None):
        from .skills import stored_skill_name

        manifest = manifest_from(files)
        links = list(getattr(files, "skipped_links", []))
        if len(files) > MAX_PACKAGE_FILES:
            raise too_many_files(len(files), MAX_PACKAGE_FILES)
        if sum(len(data) for data in files.values()) > MAX_PACKAGE_BYTES:
            raise oversized_package("", sum(len(data) for data in files.values()), MAX_PACKAGE_BYTES)
        identity = identity or (f"github:{marketplace}:{manifest['name']}" if marketplace else "local:" + str(Path(source[6:]).parent))
        previous = self.conn.execute("SELECT * FROM skill_sets WHERE identity=?", (identity,)).fetchone()
        if previous and require_new:
            raise MemberError("taken", f"a package named {previous['name']} already exists")
        if expected_id is not None and (not previous or previous["id"] != expected_id):
            raise MemberError("not_found", "the plugin set changed during refresh")
        if access is not None:
            from .skill_packages import SkillPackages
            SkillPackages(self).validate_access(access)
        old = {row["set_key"]: dict(row) for row in self.conn.execute("SELECT * FROM member_skills WHERE set_id=?", (previous["id"],))} if previous else {}
        _, parts = plugin_parts(files, existing_names={key: row["name"].partition(":")[2] for key, row in old.items()})
        own = self.conn.execute("SELECT name FROM member_skills WHERE member_id=-1 AND (set_id IS NULL OR set_id IS NOT ?)", (previous["id"] if previous else None,))
        taken = {r[0].casefold() for r in own}
        from .skill_packages import taken_by

        # A new plugin installs what it can: a skill whose name is taken is left out and reported with who holds it (#313).
        # A refresh keeps its skills as they were, so a clash there still refuses it.
        skipped, refused, left, gone = [], None, [], []
        for part in parts:
            name = stored_skill_name(part["name"], manifest["name"])
            if name.casefold() not in taken:
                left.append(part)
                continue
            error, package = taken_by(self.conn, SHARED, name, manifest["name"])
            if previous:
                raise error
            refused = refused or error
            skipped.append({"name": name, "held_by": package})
            gone.append(part)
        if not left and refused:
            raise refused
        if skipped:
            files = without_skipped(files, parts, gone)
            parts = left
        # A moved component keeps its switch and id. An in-place rename also keeps
        # its path identity, unless the old name belongs to another new component.
        by_name = {row["name"].casefold(): row for row in old.values()}
        incoming = {stored_skill_name(part["name"], manifest["name"]).casefold() for part in parts}
        retained = set()
        components = []
        for part in parts:
            key = str(PurePosixPath(part["key"]).parent) if part["kind"] == "skill" else part["key"]
            stored = stored_skill_name(part["name"], manifest["name"])
            existing = by_name.get(stored.casefold())
            if not existing and key in old and old[key]["name"].casefold() not in incoming:
                existing = old[key]
            if existing:
                retained.add(existing["id"])
            components.append((part, key, stored, existing))
        if required_skill is not None and required_skill not in retained:
            raise MemberError("not_found", "the refreshed package no longer has that skill")
        checked = {}
        for key, data in files.items():
            path = relative_path(key)
            if path.split("/")[0].casefold().startswith(".raphael"):
                raise MemberError("source", "reserved plugin metadata path")
            checked[path] = data
        return PluginInstall(identity, manifest, previous, old, retained, components, checked,
                             source, marketplace, target, access, mcp_servers(files, manifest), self.skill_revision(), skipped, links)

    def _write_set(self, plan):
        # A plugin lives in the one folder the library keeps its skills in, so one mount of it shows them all.
        root = self.homes.safe(self.homes.home(SHARED) / "skills")
        root.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix="set-", dir=root))
        try:
            files = dict(plan.files)
            for part, *_ in plan.components:
                key = part["key"] if part["kind"] == "skill" else f".raphael-commands/{part['key']}/SKILL.md"
                files[key] = part["text"].encode()
            for key, data in files.items():
                atomic(self.homes.safe(folder / key), data)
            servers = json.loads(json.dumps(plan.servers).replace("${CLAUDE_PLUGIN_ROOT}", str(folder).replace("\\", "/")))
            info = {"marketplace": plan.marketplace, "target": plan.target, "mcp_servers": servers,
                    **({"skipped_links": plan.links} if plan.links else {}),
                    "fingerprint": local_stamp(Path(plan.source[6:])) if plan.source.startswith("local:") else None}
            return folder, info
        except BaseException:
            self._discard_set(folder)
            raise

    def _commit_set(self, plan, folder, info, *, enabled=None, skill=None):
        from .skill_packages import SkillPackages

        previous = self.conn.execute("SELECT * FROM skill_sets WHERE identity=?", (plan.identity,)).fetchone()
        if previous != plan.previous or self.skill_revision() != plan.revision:
            raise MemberError("not_found", "the plugin set changed during refresh")
        access = plan.access
        if access is not None:
            SkillPackages(self).validate_access(access)
        manifest = plan.manifest
        with self.conn:
            values = (manifest["name"], manifest["version"], plan.source, str(manifest.get("description", "")), folder.relative_to(self.homes.home(SHARED)).as_posix(), json.dumps(info))
            if previous:
                identifier = previous["id"]
                self.conn.execute("UPDATE skill_sets SET name=?,version=?,source=?,description=?,folder=?,metadata=? WHERE id=?", (*values, identifier))
            else:
                identifier = self.conn.execute("INSERT INTO skill_sets(name,version,source,description,folder,metadata,identity) VALUES (?,?,?,?,?,?,?)", (*values, plan.identity)).lastrowid
            # What was imported decides the default, not what is left of it after a taken name was skipped (#313).
            if access is None and not previous and len(plan.components) + len(plan.skipped) == 1:
                access = "all"
            if previous:
                # Free both unique names before applying moves and renames in this transaction.
                self.conn.execute("UPDATE member_skills SET name=char(0)||id,set_key=NULL WHERE set_id=?", (identifier,))
            for part, key, stored, existing in plan.components:
                if existing:
                    self.conn.execute("UPDATE member_skills SET name=?,description=?,source=?,set_kind=?,set_key=? WHERE id=?",
                                      (stored, part["description"], "plugin:" + manifest["name"], part["kind"], key, existing["id"]))
                else:
                    self.conn.execute("INSERT INTO member_skills(member_id,name,description,source,set_id,set_key,set_kind) VALUES (-1,?,?,?,?,?,?)", (stored, part["description"], "plugin:" + manifest["name"], identifier, key, part["kind"]))
            for removed in plan.old.values():
                if removed["id"] not in plan.retained:
                    self.conn.execute("DELETE FROM member_skills WHERE id=?", (removed["id"],))
            SkillPackages(self).apply_changes(f"set:{identifier}", access=access, enabled=enabled, skill=skill)
        return identifier

    def _discard_set(self, folder):
        shutil.rmtree(self.homes.safe(folder))

    def _discard_previous_set(self, plan):
        if plan.previous:
            self._discard_set(self.homes.home(SHARED) / plan.previous["folder"])

    async def import_plugin(self, source=None, *, set_id=None, marketplace=None, name=None, access=None, require_new=False,
                            required_skill=None, enabled=None, skill=None):
        revision = self.skill_revision()
        target = identity = None
        if set_id is not None:
            previous = self.conn.execute("SELECT * FROM skill_sets WHERE id=?", (set_id,)).fetchone()
            if previous is None:
                raise MemberError("not_found", "no such plugin set")
            info = json.loads(previous["metadata"])
            source, marketplace, name = previous["source"], info.get("marketplace"), previous["name"]
        if marketplace:
            from .capabilities import DOWNLOAD_SECONDS

            try:
                async with asyncio.timeout(DOWNLOAD_SECONDS):
                    data = await self.add_marketplace(marketplace)
                    plugin = next((p for p in data["plugins"] if p["name"] == name), None)
                    if not plugin or not plugin["installable"]:
                        raise MemberError("source", "this marketplace plugin is not installable")
                    files = await download_plugin(plugin["target"])
            except TimeoutError:
                raise MemberError("download", "the plugin download exceeded one hour") from None
            manifest = manifest_from(files)
            if manifest["name"] != plugin["name"] or manifest["version"] != plugin["version"]:
                raise MemberError("source", "download differs from the listed plugin version")
            source, target = f"github:{marketplace}/{name}", plugin["target"]
        elif isinstance(source, str) and source.startswith("local:"):
            source, files, identity = await asyncio.to_thread(self._local_plugin_snapshot, source)
        else:
            from .skill_github import fetch_plugin

            files, identity = await fetch_plugin(source)
            source = source.strip()
        if set_id is not None and revision != self.skill_revision():
            raise MemberError("not_found", "the plugin set changed during refresh")
        return await self._install_set_async(source, files, marketplace=marketplace or "", target=target, access=access,
                                             expected_id=set_id, require_new=require_new, required_skill=required_skill,
                                             enabled=enabled, skill=skill, identity=identity)

    def _newest_version(self, source):
        """The folder a local plugin is read from: the newest installed version of a plugin the CLIs cache, or the folder
        itself when it is anywhere else."""
        from .skill_sources import local_path

        try:
            folder, root = location(self.skill_home, source)
        except MemberError:
            return local_path(source)
        if root.name != "cache" or len(folder.relative_to(root).parts) != 3:
            return local_path(source)
        versions = [p for p in directories(folder.parent, [MAX_DISCOVERY_ENTRIES]) if (p / ".claude-plugin/plugin.json").is_file()]
        if not versions:
            raise MemberError("not_found", "no installed version of that plugin", reason="source", file=str(folder))
        return max(versions, key=lambda p: (version_key(p.name), p.stat().st_mtime_ns))

    async def import_tree(self, tree, *, access=None):
        """Install a source that is a plugin of any kind (skill_layouts.PluginTree): its whole tree is the set."""
        return await self._install_set_async(tree.source, tree.files, access=access, require_new=True, identity=tree.identity)

    def _local_plugin_snapshot(self, source):
        from .skill_layouts import folder_is_plugin, normalized

        folder = self._newest_version(source)
        if not folder_is_plugin(folder):
            raise MemberError("not_found" if not folder.exists() else "source",
                              f"{folder} is not a plugin: it has no .claude-plugin/plugin.json",
                              reason="source" if not folder.exists() else "no_manifest", file=str(folder))
        # The versions a CLI caches are one plugin; a folder anywhere else is a plugin of its own.
        try:
            cached = location(self.skill_home, source)[1].name == "cache"
        except MemberError:
            cached = False
        files = normalized(local_files(folder), folder.name)
        if files is None:
            raise MemberError("source", f"{folder} lists no plugin of its own", reason="no_manifest", file=str(folder))
        return "local:" + str(folder), files, None if cached else "local:" + str(folder)

    async def add_marketplace(self, repo):
        data = await catalog(repo)
        with self.conn:
            self.conn.execute("INSERT INTO skill_marketplaces(repo,name,catalog) VALUES (?,?,?) ON CONFLICT(repo) DO UPDATE SET name=excluded.name,catalog=excluded.catalog", (repo, data["name"], json.dumps(data)))
        return data

    def delete_set(self, identifier):
        from .skill_packages import SkillPackages

        if not self.conn.execute("SELECT 1 FROM skill_sets WHERE id=?", (identifier,)).fetchone():
            return False
        SkillPackages(self).delete(f"set:{identifier}")
        return True
