"""The kinds of plugin a source can be, read as one: a Claude Code plugin, a Codex or Cursor plugin, a marketplace and a bare
layout of commands and agents. Whatever the maker, the library keeps the plugin's whole tree (commands, agents, hooks,
scripts, binaries and large assets) and reads its skills and commands from it; the tree is data and nothing in it runs.

A tree that is none of these is not a plugin here, and imports as the skills it holds (skill_sources.py).
"""

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from .skill_plugins import component_paths, relative_path
from .store import MemberError

CLAUDE = ".claude-plugin/plugin.json"
# The same manifest under the name another maker gives it: read for its name, skills, commands and MCP servers.
OTHER_MANIFESTS = (".codex-plugin/plugin.json", ".cursor-plugin/plugin.json")
# A marketplace lists plugins that sit in folders of its own tree.
MARKETPLACES = (".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", ".cursor-plugin/marketplace.json")
HOOKS = "hooks/hooks.json"
_DOCUMENTS = re.compile(r"(?:commands|agents)/[^/]+\.md")
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}")
MAX_JSON_BYTES = 4 * 1024 * 1024


class Tree(dict):
    """The files of a plugin, `{path: bytes}`, with the paths of the links in it that could not be kept (a link is never followed:
    one that names a file inside the plugin is that file's copy, any other is named here and left out)."""

    def __init__(self, files=(), skipped_links=()):
        super().__init__(files)
        self.skipped_links = list(skipped_links)


@dataclass
class PluginTree:
    """A source that is a plugin: its whole tree, where it came from, and who it is (a second import of it is a refresh)."""

    files: dict
    source: str
    identity: str
    label: str = ""


def is_plugin(paths):
    """Whether a tree, given by its paths from its root, is a plugin of a kind the library reads. A root that holds a SKILL.md is
    one skill, whatever else is beside it."""
    paths = set(paths)
    if "SKILL.md" in paths:
        return False
    if CLAUDE in paths or any(path in paths for path in (*OTHER_MANIFESTS, *MARKETPLACES)) or HOOKS in paths:
        return True
    return any(_DOCUMENTS.fullmatch(path) for path in paths)


def folder_is_plugin(folder):
    """The same of a folder on this computer, by looking only at its root."""
    folder = Path(folder)

    def has(relative):
        return folder.joinpath(*relative.split("/")).is_file()

    if has("SKILL.md"):
        return False
    if any(has(path) for path in (CLAUDE, *OTHER_MANIFESTS, *MARKETPLACES, HOOKS)):
        return True
    for name in ("commands", "agents"):
        try:
            with os.scandir(folder / name) as entries:
                if any(entry.name.endswith(".md") and entry.is_file() for entry in entries):
                    return True
        except OSError:
            continue
    return False


def slug(text):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9._-]", "-", str(text).lower())).strip("-.") or "plugin"


def _object(data):
    if len(data) > MAX_JSON_BYTES:
        raise MemberError("source", "a plugin manifest is too large")
    try:
        value = json.loads(data.decode("utf-8-sig"))
    except (ValueError, UnicodeError):
        raise MemberError("source", "invalid plugin manifest") from None
    return value if isinstance(value, dict) else {}


def _paths(value):
    """The folders or files a manifest names, as paths from the plugin root; what is no path is left out."""
    values = [value] if isinstance(value, str) else value if isinstance(value, list) else []
    found = []
    for item in values:
        if isinstance(item, str) and item.strip("./"):
            try:
                found.append(relative_path(item))
            except MemberError:
                continue
    return found


def _name(value, label):
    return value if isinstance(value, str) and _NAME.fullmatch(value) else slug(value if isinstance(value, str) and value else label)


def normalized(files, label):
    """The tree of a plugin with the manifest the library reads: a Claude Code plugin as it is, any other kind with
    `.claude-plugin/plugin.json` written from what it declares (its own manifest stays in the tree). None when the tree is no plugin
    or a marketplace that lists no plugin of its own tree."""
    if not is_plugin(files):
        return None
    links = getattr(files, "skipped_links", [])
    if CLAUDE in files:
        return Tree(files, links)
    declared = {}
    for path in OTHER_MANIFESTS:
        if path in files:
            declared = _object(files[path])
            break
    skills, commands = list(_paths(declared.get("skills"))), list(_paths(declared.get("commands")))
    market = next((path for path in MARKETPLACES if path in files), None)
    if market and not declared:
        listed = _object(files[market])
        found = _marketplace(files, listed)
        if not found[0] and not found[1] and not any(_DOCUMENTS.fullmatch(path) for path in files):
            return None
        skills, commands = found
        declared = {"name": listed.get("name"), "description": listed.get("description", "")}
    manifest = {"name": _name(declared.get("name"), label),
                "version": declared["version"] if isinstance(declared.get("version"), str) else "",
                "description": declared["description"] if isinstance(declared.get("description"), str) else "",
                **({"skills": skills} if skills else {}), **({"commands": commands} if commands else {}),
                **({"mcpServers": declared["mcpServers"]} if isinstance(declared.get("mcpServers"), (str, dict, list)) else {})}
    # The folders of the declared kinds must resolve like the ones the library already reads.
    component_paths(manifest, "skills")
    component_paths(manifest, "commands")
    return Tree({**files, CLAUDE: json.dumps(manifest, ensure_ascii=False).encode()}, links)


def _marketplace(files, listed):
    """The skill and command folders of the plugins a marketplace lists from its own tree (a plugin of another repository is not
    in this tree and is left out)."""
    skills, commands = [], []
    entries = listed.get("plugins") if isinstance(listed.get("plugins"), list) else []
    for entry in entries:
        source = entry.get("source") if isinstance(entry, dict) else None
        if not isinstance(source, str) or not (source.startswith("./") or source == "."):
            continue
        try:
            base = "" if source.strip("./") == "" else relative_path(source)
        except MemberError:
            continue
        prefix = base + "/" if base else ""
        inner = _object(files[prefix + CLAUDE]) if prefix + CLAUDE in files else {}
        for kind, into in (("skills", skills), ("commands", commands)):
            declared = _paths(entry.get(kind)) or _paths(inner.get(kind))
            for path in ([prefix + kind] if base else []) + [prefix + path for path in declared]:
                if path not in into:
                    into.append(path)
    return skills, commands
