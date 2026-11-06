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
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlsplit

import httpx

from ..bots.homes import atomic
from .store import MemberError
from .skill_library import (SHARED, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, MAX_DISCOVERY_ENTRIES,
                            linked, location, roots, version_key, walk)

MAX_MANIFEST_BYTES = 256 * 1024
MAX_TREE_BYTES = 4 * 1024 * 1024
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
    files, size, folded, entries = {}, 0, set(), 0
    if any(linked(p) for p in (folder, *folder.parents)):
        raise MemberError("source", "linked plugin packages are not supported")
    for directory, dirs, names in os.walk(folder, followlinks=False):
        entries += len(dirs) + len(names)
        if entries > MAX_DISCOVERY_ENTRIES:
            raise MemberError("size", "plugin scan limit reached")
        if len(Path(directory).relative_to(folder).parts) > 12:
            raise MemberError("size", "plugin package nesting is too deep")
        for name in [*dirs, *names]:
            if linked(Path(directory) / name):
                raise MemberError("source", "linked plugin packages are not supported")
        for name in names:
            path = Path(directory) / name
            key = relative_path(path.relative_to(folder).as_posix())
            if key.casefold() in folded:
                raise MemberError("source", "ambiguous plugin path")
            folded.add(key.casefold())
            if not path.is_file():
                raise MemberError("source", "plugins contain only regular files")
            if len(files) >= MAX_PACKAGE_FILES or path.stat().st_size > MAX_PACKAGE_BYTES - size:
                raise MemberError("size", "plugin package is too large")
            with path.open("rb") as stream:
                data = stream.read(MAX_PACKAGE_BYTES - size + 1)
            size += len(data)
            if size > MAX_PACKAGE_BYTES:
                raise MemberError("size", "plugin package is too large")
            files[key] = data
    return files


def local_stamp(folder):
    entries, size, count = [], 0, 0
    for directory, dirs, names in os.walk(folder, followlinks=False):
        count += len(dirs) + len(names)
        if count > MAX_DISCOVERY_ENTRIES or len(Path(directory).relative_to(folder).parts) > 12:
            raise MemberError("size", "plugin scan limit reached")
        for name in [*dirs, *names]:
            if linked(Path(directory) / name):
                raise MemberError("source", "linked plugin packages are not supported")
        for name in names:
            path = Path(directory) / name
            info = path.stat()
            size += info.st_size
            entries.append((path.relative_to(folder).as_posix(), info.st_size, info.st_mtime_ns))
            if size > MAX_PACKAGE_BYTES or len(entries) > MAX_PACKAGE_FILES:
                raise MemberError("size", "plugin package is too large")
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
    if data is None or len(data) > MAX_MANIFEST_BYTES:
        raise MemberError("source", "a plugin needs .claude-plugin/plugin.json")
    manifest = json_object(data)
    if not isinstance(manifest.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", manifest["name"]):
        raise MemberError("source", "invalid plugin name")
    if not isinstance(manifest.get("version"), str) or not manifest["version"] or len(manifest["version"]) > 100:
        raise MemberError("source", "a plugin needs a version")
    return manifest


def component_paths(manifest, kind):
    extra = manifest.get(kind, [])
    if isinstance(extra, str):
        extra = [extra]
    if not isinstance(extra, list) or len(extra) > 40 or any(not isinstance(p, str) for p in extra):
        raise MemberError("source", "unsupported plugin component paths")
    return [kind, *[relative_path(p) for p in extra]]


def plugin_parts(files):
    from .capabilities import MAX_SKILL_BYTES, skill_metadata
    from ..bots.homes import redact_secrets

    manifest = manifest_from(files)
    parts = []
    for path, data in sorted(files.items()):
        kind = None
        if path.endswith("/SKILL.md") and any(path.startswith(root + "/") for root in component_paths(manifest, "skills")):
            kind = "skill"
        elif path.endswith(".md") and any(path == root or path.startswith(root + "/") for root in component_paths(manifest, "commands")):
            kind = "command"
        if kind is None:
            continue
        if len(data) > MAX_SKILL_BYTES:
            raise MemberError("size", "skill document is too large")
        try:
            text = data.decode("utf-8-sig")
        except UnicodeError:
            raise MemberError("source", "plugin documents must be UTF-8") from None
        if "\x00" in text:
            raise MemberError("source", "plugin documents must be UTF-8")
        text = redact_secrets(text)
        if kind == "command":
            name = PurePosixPath(path).stem
            match = re.search(r"^description:[ \t]*([^\r\n]+)", text[:4096], re.M)
            description = match[1].strip().strip("\"'") if match else name
            text = "---\nname: " + json.dumps(name) + "\ndescription: " + json.dumps(description) + "\n---\n" + text
        name, description = skill_metadata(text)
        parts.append({"key": path, "kind": kind, "name": name, "description": description, "text": text})
    if len(parts) > 40 or len({p["name"].casefold() for p in parts}) != len(parts):
        raise MemberError("source", "plugin has too many or duplicate skill and command names")
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
    if not isinstance(extra, list) or len(extra) > 16:
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
            if not isinstance(name, str) or not isinstance(value, dict) or len(servers) >= 16:
                raise MemberError("source", "invalid MCP declaration")
            transport = "http" if value.get("type") in ("http", "sse") or "url" in value else "stdio"
            if not isinstance(value.get("env", {}), dict) or not isinstance(value.get("headers", {}), dict):
                raise MemberError("source", "invalid MCP declaration")
            fields = {"name": name[:40], "transport": transport, "command": value.get("command", ""),
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
    try:
        async with asyncio.timeout(45), httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
            sha = await commit(client, repo)
            data = json_object(await get_bytes(client, f"https://raw.githubusercontent.com/{repo}/{sha}/.claude-plugin/marketplace.json", MAX_MANIFEST_BYTES))
            if not isinstance(data.get("name"), str) or not isinstance(data.get("plugins"), list) or len(data["plugins"]) > 200:
                raise MemberError("source", "invalid marketplace manifest")
            plugins, names = [], set()
            for entry in data["plugins"]:
                if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", entry["name"]) or entry["name"] in names:
                    raise MemberError("source", "invalid or duplicate marketplace plugin")
                names.add(entry["name"])
                item = {"name": entry["name"], "description": str(entry.get("description", ""))[:1000], "version": entry.get("version", "") if isinstance(entry.get("version", ""), str) else "", "installable": False}
                try:
                    target = source_target(entry.get("source"), repo, sha)
                    target["commit"] = await commit(client, target["repo"], target.pop("ref"))
                    prefix = target["path"] + "/" if target["path"] else ""
                    raw = await get_bytes(client, f"https://raw.githubusercontent.com/{target['repo']}/{target['commit']}/{prefix}.claude-plugin/plugin.json", MAX_MANIFEST_BYTES)
                    manifest = manifest_from({".claude-plugin/plugin.json": raw})
                    if manifest["name"] != entry["name"] or (item["version"] and item["version"] != manifest["version"]):
                        raise MemberError("source", "listed plugin name or version differs from its manifest")
                    item.update(version=manifest["version"], description=item["description"] or str(manifest.get("description", ""))[:1000], target=target, installable=True)
                except (MemberError, httpx.HTTPError, ValueError, TypeError) as error:
                    item["reason"] = str(error) if isinstance(error, MemberError) else "plugin manifest is unavailable"
                plugins.append(item)
            return {"repo": repo, "name": data["name"], "plugins": plugins}
    except MemberError:
        raise
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError):
        raise MemberError("download", "could not read the GitHub marketplace") from None


async def download_plugin(target):
    try:
        async with asyncio.timeout(120), httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
            repo, sha, prefix = target["repo"], target["commit"], target["path"]
            tree = json_object(await get_bytes(client, f"https://api.github.com/repos/{repo}/git/trees/{sha}?recursive=1", MAX_TREE_BYTES))
            entries = tree.get("tree")
            if tree.get("truncated") or not isinstance(entries, list) or len(entries) > MAX_DISCOVERY_ENTRIES:
                raise MemberError("size", "plugin tree is incomplete or too large")
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
                if type(declared) is not int or declared < 0 or declared > MAX_PACKAGE_BYTES - size or len(files) >= MAX_PACKAGE_FILES:
                    raise MemberError("size", "plugin package is too large")
                if key.casefold() in folded or len(key.split("/")) > 13:
                    raise MemberError("source", "ambiguous or deeply nested plugin path")
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


class PluginSets:
    def plugin_root(self, identifier):
        row = self.conn.execute("SELECT folder FROM skill_sets WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise MemberError("not_found", "no such plugin set")
        return self.homes.safe(self.homes.home(SHARED) / row[0])

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
                                        "description": str(manifest.get("description", ""))[:1000], "source": "local:" + str(folder.resolve()),
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

    def plugin_sets(self):
        result = []
        for row in self.conn.execute("SELECT * FROM skill_sets ORDER BY id"):
            info = json.loads(row["metadata"])
            changed = False
            if info.get("marketplace"):
                found = self.conn.execute("SELECT catalog FROM skill_marketplaces WHERE repo=?", (info["marketplace"],)).fetchone()
                latest = next((p for p in json.loads(found[0])["plugins"] if p["name"] == row["name"]), None) if found else None
                changed = bool(latest and latest["installable"] and version_key(latest["version"]) > version_key(row["version"]))
            else:
                try:
                    folder, root = location(self.skill_home, row["source"])
                    versions = directories(folder.parent, [MAX_DISCOVERY_ENTRIES])
                    latest = max(versions, key=lambda p: (version_key(p.name), p.stat().st_mtime_ns))
                    changed = local_stamp(latest) != info.get("fingerprint")
                except (MemberError, OSError):
                    changed = None
            counts = dict(self.conn.execute("SELECT set_kind,COUNT(*) FROM member_skills WHERE set_id=? GROUP BY set_kind", (row["id"],)))
            result.append({"id": row["id"], "name": row["name"], "version": row["version"], "description": row["description"],
                           "source": row["source"], "skill_count": counts.get("skill", 0), "command_count": counts.get("command", 0),
                           "source_changed": changed, "marketplace": info.get("marketplace", ""), "mcp_servers": info.get("mcp_servers", [])})
        return result

    def install_set(self, source, files, *, marketplace="", target=None):
        """Validate everything before one database commit; failed installs leave grants intact."""
        from .capabilities import MAX_SKILLS
        from .skills import stored_skill_name

        manifest, parts = plugin_parts(files)
        if len(files) > MAX_PACKAGE_FILES or sum(len(data) for data in files.values()) > MAX_PACKAGE_BYTES:
            raise MemberError("size", "plugin package is too large")
        identity = f"github:{marketplace}:{manifest['name']}" if marketplace else "local:" + str(Path(source[6:]).parent)
        previous = self.conn.execute("SELECT * FROM skill_sets WHERE identity=?", (identity,)).fetchone()
        old = {row["set_key"]: dict(row) for row in self.conn.execute("SELECT * FROM member_skills WHERE set_id=?", (previous["id"],))} if previous else {}
        current = self.conn.execute("SELECT COUNT(*) FROM member_skills WHERE member_id=-1").fetchone()[0]
        if current - len(old) + len(parts) > MAX_SKILLS:
            raise MemberError("full", "shared skill limit reached")
        own = self.conn.execute("SELECT name FROM member_skills WHERE member_id=-1 AND (set_id IS NULL OR set_id IS NOT ?)", (previous["id"] if previous else None,))
        taken = {r[0].casefold() for r in own}
        if any(stored_skill_name(p["name"], manifest["name"]).casefold() in taken for p in parts):
            raise MemberError("taken", "a skill with that plugin name already exists")
        public_servers = mcp_servers(files, manifest)
        root = self.homes.safe(self.homes.home(SHARED) / "skill-sets")
        root.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix="set-", dir=root))
        try:
            for key, data in files.items():
                if key.split("/")[0].casefold().startswith(".raphael"):
                    raise MemberError("source", "reserved plugin metadata path")
                atomic(self.homes.safe(folder / relative_path(key)), data)
            for part in parts:
                path = folder / part["key"] if part["kind"] == "skill" else folder / ".raphael-commands" / part["key"] / "SKILL.md"
                atomic(self.homes.safe(path), part["text"].encode())
            public_servers = json.loads(json.dumps(public_servers).replace("${CLAUDE_PLUGIN_ROOT}", str(folder).replace("\\", "/")))
            info = {"marketplace": marketplace, "target": target, "mcp_servers": public_servers,
                    "fingerprint": local_stamp(Path(source[6:])) if source.startswith("local:") else None}
            with self.conn:
                values = (manifest["name"], manifest["version"], source, str(manifest.get("description", ""))[:1000], folder.relative_to(self.homes.home(SHARED)).as_posix(), json.dumps(info))
                if previous:
                    identifier = previous["id"]
                    self.conn.execute("UPDATE skill_sets SET name=?,version=?,source=?,description=?,folder=?,metadata=? WHERE id=?", (*values, identifier))
                else:
                    identifier = self.conn.execute("INSERT INTO skill_sets(name,version,source,description,folder,metadata,identity) VALUES (?,?,?,?,?,?,?)", (*values, identity)).lastrowid
                for part in parts:
                    key = str(PurePosixPath(part["key"]).parent) if part["kind"] == "skill" else part["key"]
                    stored = stored_skill_name(part["name"], manifest["name"])
                    existing = old.pop(key, None)
                    if existing:
                        self.conn.execute("UPDATE member_skills SET name=?,description=?,source=?,set_kind=? WHERE id=?", (stored, part["description"], "plugin:" + manifest["name"], part["kind"], existing["id"]))
                    else:
                        self.conn.execute("INSERT INTO member_skills(member_id,name,description,source,set_id,set_key,set_kind) VALUES (-1,?,?,?,?,?,?)", (stored, part["description"], "plugin:" + manifest["name"], identifier, key, part["kind"]))
                for removed in old.values():
                    self.conn.execute("DELETE FROM member_skills WHERE id=?", (removed["id"],))
        except BaseException:
            shutil.rmtree(self.homes.safe(folder))
            raise
        if previous:
            shutil.rmtree(self.homes.safe(self.homes.home(SHARED) / previous["folder"]))
        self._mirror(SHARED)
        return next(s for s in self.plugin_sets() if s["id"] == identifier)

    async def import_plugin(self, source=None, *, set_id=None, marketplace=None, name=None):
        if set_id is not None:
            previous = self.conn.execute("SELECT * FROM skill_sets WHERE id=?", (set_id,)).fetchone()
            if previous is None:
                raise MemberError("not_found", "no such plugin set")
            info = json.loads(previous["metadata"])
            source, marketplace, name = previous["source"], info.get("marketplace"), previous["name"]
        if marketplace:
            data = await self.add_marketplace(marketplace)
            plugin = next((p for p in data["plugins"] if p["name"] == name), None)
            if not plugin or not plugin["installable"]:
                raise MemberError("source", "this marketplace plugin is not installable")
            files = await download_plugin(plugin["target"])
            manifest = manifest_from(files)
            if manifest["name"] != plugin["name"] or manifest["version"] != plugin["version"]:
                raise MemberError("source", "download differs from the listed plugin version")
            return self.install_set(f"github:{marketplace}/{name}", files, marketplace=marketplace, target=plugin["target"])
        folder, root = location(self.skill_home, source)
        if root.name != "cache" or len(folder.relative_to(root).parts) != 3:
            raise MemberError("source", "choose an installed plugin folder")
        versions = [p for p in directories(folder.parent, [MAX_DISCOVERY_ENTRIES]) if (p / ".claude-plugin/plugin.json").is_file()]
        if not versions:
            raise MemberError("not_found", "no installed version of that plugin")
        folder = max(versions, key=lambda p: (version_key(p.name), p.stat().st_mtime_ns))
        return self.install_set("local:" + str(folder), local_files(folder))

    async def add_marketplace(self, repo):
        data = await catalog(repo)
        with self.conn:
            self.conn.execute("INSERT INTO skill_marketplaces(repo,name,catalog) VALUES (?,?,?) ON CONFLICT(repo) DO UPDATE SET name=excluded.name,catalog=excluded.catalog", (repo, data["name"], json.dumps(data)))
        return data

    def delete_set(self, identifier):
        row = self.conn.execute("SELECT folder FROM skill_sets WHERE id=?", (identifier,)).fetchone()
        if row is None:
            return False
        with self.conn:
            self.conn.execute("DELETE FROM member_skills WHERE set_id=?", (identifier,))
            self.conn.execute("DELETE FROM skill_sets WHERE id=?", (identifier,))
        shutil.rmtree(self.homes.safe(self.homes.home(SHARED) / row["folder"]))
        self._mirror(SHARED)
        return True
