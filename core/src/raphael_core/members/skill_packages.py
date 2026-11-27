"""Team library packages, access and transactional document replacement."""

import asyncio
import json
import os
import shutil
import tempfile
import uuid
from contextlib import ExitStack
from datetime import datetime
from pathlib import Path

from ..bots.homes import atomic, redact_secrets
from .capabilities import MAX_SKILL_BYTES, skill_metadata
from .skill_errors import not_utf8, oversized_file
from .skill_names import family, with_name
from .skill_library import SHARED, stage_files
from .skill_plugins import folded_path, inside_folder
from .skill_sources import validate_files
from .skills import skill_plugin, stored_skill_name
from .store import MemberError


def refetchable(origin, source):
    if origin != "source":
        return False
    if source.startswith("local:"):
        return Path(source[6:]).exists()
    from . import skill_git
    from .skill_github import refetchable as github

    return skill_git.is_address(source) or github(source)


def refreshable(origin, source, skills):
    """Whether a package can be read again from where it came. A group (skills joined one by one, R-SKILL-20) is read from
    the source of each skill."""
    if origin == "group":
        return bool(skills) and all(refetchable("source", skill["_source"]) for skill in skills)
    return refetchable(origin, source)


def restore_file(backup, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    backup.rename(path)


def told_apart(held, new):
    """What tells two packages of one name apart: the first of their (version, source) that both have and that differs,
    else the first each has."""
    for one, other in zip(held, new):
        if one and other and one != other:
            return one, other
    return next((one for one in held if one), ""), next((other for other in new if other), "")


def taken_by(conn, member, stored, incoming="", *, incoming_version="", incoming_source="", own_key=None):
    """A name that is taken, as a refusal, and the package that holds it. A switched-off skill keeps its name (#313), so the
    owner is told where it is and that it is off, to remove that one skill. `incoming` is the package that brings the
    other skill of that name, when it has one of its own: both sides are named. Two packages can go by one name (a plugin
    imported again from another version folder): each is then named with its version, or its source when the version is
    the same or unknown, so the owner can tell which is which. `own_key` is the package the other skill is in already, when it
    is not a package that comes in (a rename), so a name shared with itself is not two packages."""
    row = conn.execute(
        "SELECT s.enabled, s.package_key, p.enabled AS package_enabled, COALESCE(t.name,p.name) AS package, t.version AS version, "
        "COALESCE(t.source,p.source) AS source FROM member_skills s "
        "LEFT JOIN skill_packages p ON p.key=s.package_key LEFT JOIN skill_sets t ON t.id=s.set_id "
        "WHERE s.member_id=? AND s.name=? COLLATE NOCASE", (member, stored)).fetchone()
    text = f"a skill named {stored} already exists"
    package = row["package"] if row and row["package"] else ""
    off = bool(package and (not row["enabled"] or row["package_enabled"] == 0))
    if package and row["package_key"] != own_key and (package.casefold() == incoming.casefold() or conn.execute(
            "SELECT COUNT(*) FROM skill_packages WHERE name=? COLLATE NOCASE", (package,)).fetchone()[0] > 1):
        held_detail, new_detail = told_apart(*(tuple(part.removeprefix("local:") for part in parts)
                                               for parts in ((row["version"] or "", row["source"] or ""), (incoming_version, incoming_source))))
        # What only repeats the name (an upload is its own file name) tells nothing.
        held_detail, new_detail = (detail if detail.casefold() != package.casefold() else "" for detail in (held_detail, new_detail))
        package = f"{package} ({held_detail})" if held_detail else package
        incoming = f"{incoming} ({new_detail})" if incoming and new_detail else incoming
    if package:
        text += f' in the package "{package}"'
        if off:
            text += " (switched off)"
    if incoming:
        text += f', and the package "{incoming}" has one too'
    return MemberError("taken", text, reason="clash", skill=stored, held_by=package, off=off, incoming=incoming), package


class SkillPackages:
    def __init__(self, capabilities):
        self.cap = capabilities
        self.conn = capabilities.conn

    def validate_access(self, access):
        if access == "all":
            return
        if not isinstance(access, list) or any(type(i) is not int for i in access) or len(set(access)) != len(access):
            raise MemberError("access", "access must be all or distinct member ids")
        if set(access) - {m.id for m in self.cap.members.members()}:
            raise MemberError("access", "access contains an unknown member")

    def row(self, key):
        if not isinstance(key, str):
            raise MemberError("key", "give the package key")
        row = self.conn.execute("SELECT * FROM skill_packages WHERE key=?", (key,)).fetchone()
        if row is None:
            raise MemberError("not_found", "no such skill package")
        return row

    def _view_inputs(self, key):
        row = self.row(key)
        skills = [{"id": s["id"], "name": s["name"].rsplit(":", 1)[-1], "description": s["description"],
                   "enabled": bool(s["enabled"]), "_source": s["source"]} for s in self.conn.execute(
                       "SELECT * FROM member_skills WHERE package_key=? ORDER BY id", (key,))]
        plugin = self.conn.execute("SELECT * FROM skill_sets WHERE id=?", (key[4:],)).fetchone() if key.startswith("set:") else None
        return row, skills, plugin

    def view(self, key):
        return self._view(*self._view_inputs(key))

    async def view_async(self, key):
        return await asyncio.to_thread(self._view, *self._view_inputs(key))

    def _view(self, row, skills, plugin):
        key = row["key"]
        # A group's skills each come from their own source: it has none of its own to show.
        name, source = row["name"], "" if row["origin"] == "group" else row["source"]
        skipped_links, skipped_references = {}, {}
        plugin_manifest = False
        if plugin is None:
            home = self.cap.homes.home(SHARED)
            for skill in skills:
                info = self.cap._package_info_at(home / "skills" / str(skill["id"]) / "SKILL.md")
                plugin_manifest |= info.get("plugin_manifest") is True
                if info.get("skipped_links"):
                    skipped_links[str(skill["id"])] = info["skipped_links"]
                if info.get("skipped_references"):
                    skipped_references[str(skill["id"])] = info["skipped_references"]
        version = description = ""
        updatable = refreshable(row["origin"], source, skills)
        skills = [{key: value for key, value in skill.items() if key != "_source"} for skill in skills]
        if plugin is not None:
            name, version, source, description = (plugin[k] for k in ("name", "version", "source", "description"))
            info = json.loads(plugin["metadata"])
            updatable = bool(info.get("marketplace")) or refetchable("source", source)
            kind = "plugin"
            if info.get("skipped_links"):
                skipped_links["plugin"] = info["skipped_links"]
        else:
            kind = "single" if len(skills) == 1 else "pack"
            if kind == "single":
                description = skills[0]["description"]
            if plugin_manifest:
                kind = "plugin"
        return {"key": key, "name": name, "kind": kind, "source": source, "description": description,
                "version": version, "enabled": bool(row["enabled"]), "access": json.loads(row["access"]),
                "updatable": updatable, "skills": skills,
                **({"skipped_links": skipped_links} if skipped_links else {}),
                **({"skipped_references": skipped_references} if skipped_references else {})}

    def list(self):
        return self._list_views(self._list_inputs())

    async def list_async(self):
        return await asyncio.to_thread(self._list_views, self._list_inputs())

    def _list_inputs(self):
        return [self._view_inputs(r[0]) for r in self.conn.execute("SELECT key FROM skill_packages")]

    def _list_views(self, inputs):
        packages = [self._view(*row) for row in inputs]
        return sorted(packages, key=lambda p: p["name"].casefold())

    def for_member(self, member_id):
        rows = self.conn.execute(
            "SELECT p.key,COALESCE(t.name,p.name) AS name,COUNT(s.id) AS skills FROM skill_packages p "
            "LEFT JOIN skill_sets t ON p.key='set:'||t.id LEFT JOIN member_skills s ON s.package_key=p.key AND s.enabled "
            "WHERE p.enabled AND (p.access=? OR ? IN (SELECT value FROM json_each(p.access))) "
            "GROUP BY p.key ORDER BY name COLLATE NOCASE", ('"all"', member_id))
        return [dict(row) for row in rows]

    def apply_changes(self, key, *, access=None, enabled=None, skill=None):
        if access is not None:
            self.conn.execute("UPDATE skill_packages SET access=? WHERE key=?", (json.dumps(access), key))
        if enabled is not None:
            self.conn.execute("UPDATE skill_packages SET enabled=? WHERE key=?", (enabled, key))
        if skill:
            self.conn.execute("UPDATE member_skills SET enabled=? WHERE id=? AND package_key=?",
                              (skill["enabled"], skill["id"], key))

    async def install(self, member, documents, source, origin, label, *, access=None, name=None, key=None,
                      required_skill=None, local=None, enabled=None, skill=None, skill_switches=None, skipped=None):
        """Write a complete snapshot before publishing its folders and rows. A new import of several skills skips each
        skill whose name is taken and appends it to `skipped` (its name and who holds it); the rest is installed."""
        self.cap.check(member)
        if access is not None:
            self.validate_access(access)
        old = {}
        aliases = {}
        incoming = name or (label if len(documents) > 1 else "")
        if key is not None:
            incoming = self.row(key)["name"]
            old = {r["name"].casefold(): r for r in self.conn.execute(
                "SELECT id,name FROM member_skills WHERE package_key=?", (key,))}
            # A skill the owner renamed is still the skill its source calls by the name it had (see rename_skill).
            home = self.cap.homes.home(SHARED) / "skills"
            for row in old.values():
                upstream = self.cap._package_info_at(home / str(row["id"]) / "SKILL.md").get("upstream_name")
                if isinstance(upstream, str) and upstream:
                    aliases[upstream.casefold()] = row["name"].rsplit(":", 1)[-1]
        elif local and local.get("previous"):
            previous = local["previous"]
            old[previous["name"].casefold()] = previous
        taken = {r[0].casefold() for r in self.conn.execute(
            "SELECT name FROM member_skills WHERE member_id=? AND (? IS NULL OR package_key IS NOT ?) AND id IS NOT ?",
            (member, key, key, local["previous"]["id"] if local and local.get("previous") else None))}
        from .skill_names import unique_skill_name

        prepared = []
        plugin_manifest = False
        skipping = key is None and not local and len(documents) > 1
        refused = None
        for skill_source, files in documents:
            plugin_manifest |= getattr(files, "plugin_manifest", False)
            skipped_links = getattr(files, "skipped_links", [])
            skipped_references = getattr(files, "skipped_references", [])
            shown = getattr(files, "folder", "") + "SKILL.md"
            files = validate_files(files)
            raw = files["SKILL.md"]
            if len(raw) > MAX_SKILL_BYTES:
                raise oversized_file(shown, len(raw), MAX_SKILL_BYTES)
            try:
                text = redact_secrets(raw.decode("utf-8-sig"))
            except UnicodeError:
                raise not_utf8(shown) from None
            if "\x00" in text:
                raise not_utf8(shown)
            upstream = None
            if aliases:
                slug, _ = skill_metadata(text, path=shown)
                if slug.casefold() in aliases:
                    upstream, text = slug, with_name(text, aliases[slug.casefold()])
            previous_slug = None
            if old:
                slug, _ = skill_metadata(text, path=shown)
                previous = stored_skill_name(slug, skill_plugin(text, skill_source)).casefold()
                if previous in old:
                    previous_slug = old[previous]["name"].rsplit(":", 1)[-1]
                elif local:
                    previous_slug = local["previous"]["name"].rsplit(":", 1)[-1]
            slug, desc = skill_metadata(text, writing=True, previous_name=previous_slug, path=shown)
            stored = stored_skill_name(slug, skill_plugin(text, skill_source))
            if stored.casefold() in taken:
                if slug == skill_metadata(text)[0]:
                    error, package = taken_by(self.conn, member, stored, incoming, incoming_source=source)
                    if not skipping:
                        raise error
                    refused = refused or error
                    if skipped is not None:
                        skipped.append({"name": stored, "held_by": package})
                    continue
                plugin = skill_plugin(text, skill_source)
                prefix = stored[:-len(slug)].casefold()
                slug = unique_skill_name(slug, {name[len(prefix):] for name in taken if name.startswith(prefix)})
                stored = stored_skill_name(slug, plugin)
            taken.add(stored.casefold())
            metadata = {"source": source, "origin": origin, "files": [p for p in files if p != "SKILL.md"]}
            if upstream:
                metadata["upstream_name"] = upstream
            if plugin_manifest:
                metadata["plugin_manifest"] = True
            if local:
                metadata.update(local["metadata"])
            if skipped_links:
                metadata["skipped_links"] = skipped_links
            if skipped_references:
                metadata["skipped_references"] = skipped_references
            if origin in ("template", "copy"):
                metadata = None
            prepared.append((stored, desc, skill_source, validate_files({**files, "SKILL.md": text.encode()}), metadata))
        if required_skill is not None and not any(
                old[name.casefold()]["id"] == required_skill for name, *_ in prepared if name.casefold() in old):
            raise MemberError("not_found", "the refreshed package no longer has that skill")
        if not prepared and refused:
            raise refused
        if not prepared:
            raise MemberError("not_found", "no SKILL.md found")
        # A skill imported alone whose name begins as another's does joins it: one plugin, not two loose skills (R-SKILL-20).
        join = self._group_for(member, key, local, documents, origin, prepared)
        revision = self.cap.skill_revision()
        root = self.cap.homes.home(member) / "skills"
        temp = await stage_files(self._write, root, prepared, local, discard=shutil.rmtree)
        try:
            self.cap.check(member)
            if self.cap.skill_revision() != revision:
                raise MemberError("not_found", "the skill library changed during import")
            if access is not None:
                self.validate_access(access)
            key, ids = self._publish(member, source, origin, label, access, name, join[0] if join else key, old, prepared, root,
                                     temp, local, enabled, skill, skill_switches, len(documents) == 1,
                                     regroup=join[1] if join else None)
        finally:
            await asyncio.to_thread(shutil.rmtree, temp)
        stamp = datetime.now().isoformat()
        await self.cap._mirror_async(member, {i: {"updated_at": stamp} for i in ids})
        return key, ids

    def _group_for(self, member, key, local, documents, origin, prepared):
        """`(package key, new name)` of the package a lone new shared skill joins, else None. It joins a package that is one
        skill from a source, pasted or uploaded, or a group, that holds a skill of its name's family (skill_names.family):
        the first becomes a group named by the family, and keeps who may use it. A package of an import of several skills,
        a plugin set and a skill refreshed in place are never joined."""
        if member != SHARED or key is not None or local or len(documents) != 1 or len(prepared) != 1 or origin not in ("source", "paste", "upload"):
            return None
        wanted = family(prepared[0][0])
        if not wanted:
            return None
        held = {}
        for row in self.conn.execute(
                "SELECT s.name,p.key,p.origin FROM member_skills s JOIN skill_packages p ON p.key=s.package_key "
                "WHERE s.member_id=? AND s.set_id IS NULL AND p.key NOT LIKE 'set:%' ORDER BY p.name COLLATE NOCASE,s.id", (SHARED,)):
            held.setdefault((row["key"], row["origin"]), []).append(row["name"])
        for (package, kind), names in held.items():
            if (kind == "group" or len(names) == 1 and kind in ("source", "paste", "upload")) and any(family(n) == wanted for n in names):
                return package, None if kind == "group" else wanted
        return None

    def _write(self, root, prepared, local):
        temp = self._make_staging(root)
        try:
            for index, (_, _, _, files, metadata) in enumerate(prepared):
                folder = temp / str(index)
                if local:
                    for path, data in local["preserved"].items():
                        if path not in files:
                            atomic(self.cap.homes.safe(folder / path), data)
                for path, data in files.items():
                    atomic(self.cap.homes.safe(folder / path), data)
                if metadata is not None:
                    atomic(self.cap.homes.safe(folder / ".raphael-source.json"), json.dumps(metadata).encode())
            return temp
        except BaseException:
            shutil.rmtree(temp)
            raise

    def _publish(self, member, source, origin, label, access, name, key, old, prepared, root, temp, local,
                 enabled, skill, skill_switches, single=None, regroup=None):
        # What was imported decides a new package's defaults (a single skill is open to all, a package is not), never what
        # is left of it after a taken name was skipped (#313).
        single = len(prepared) == 1 if single is None else single
        ids = []
        with ExitStack() as rollback:
            with self.conn:
                if member == SHARED and key is None:
                    key = "pack:" + uuid.uuid4().hex
                    default = "all" if single else []
                    self.conn.execute("INSERT INTO skill_packages(key,name,source,origin,access) VALUES (?,?,?,?,?)",
                                      (key, name or (prepared[0][0].rsplit(":", 1)[-1] if single else label), source, origin,
                                       json.dumps(default if access is None else access)))
                for index, (stored, desc, skill_source, _, _) in enumerate(prepared):
                    existing = old.pop(stored.casefold(), None)
                    if local and old:
                        existing = old.popitem()[1]
                    if existing:
                        identifier = existing["id"]
                        self.conn.execute("UPDATE member_skills SET name=?,description=?,source=? WHERE id=?",
                                          (stored, desc, skill_source, identifier))
                    else:
                        active = skill_switches[index] if skill_switches is not None else member == SHARED or enabled is not False
                        identifier = self.conn.execute(
                            "INSERT INTO member_skills(member_id,name,description,source,package_key,enabled) VALUES (?,?,?,?,?,?)",
                            (member, stored, desc, skill_source, key, active)).lastrowid
                    ids.append(identifier)
                    target = self.cap.homes.safe(root / str(identifier))
                    self._backup(target, temp, rollback)
                    staged = temp / str(index)
                    staged.rename(target)
                    rollback.callback(target.rename, staged)
                for row in old.values():
                    self._backup(self.cap.homes.safe(root / str(row["id"])), temp, rollback)
                    self.conn.execute("DELETE FROM member_skills WHERE id=?", (row["id"],))
                if regroup:
                    self.conn.execute("UPDATE skill_packages SET name=?,origin='group' WHERE key=?", (regroup, key))
                if key is not None:
                    self.apply_changes(key, access=access, enabled=enabled, skill=skill)
            rollback.pop_all()
        return key, ids

    def _commit(self, member, rollback, overrides=None):
        mirror = self.cap.homes.safe(self.cap.homes.state(member) / "skills.json")
        if mirror.is_file():
            rollback.callback(atomic, mirror, mirror.read_bytes())
        else:
            rollback.callback(mirror.unlink, missing_ok=True)
        self.cap._mirror(member, overrides)
        self.conn.commit()

    @staticmethod
    def _backup(target, temp, rollback):
        if target.exists():
            backup = Path(temp) / ("old-" + target.name)
            target.rename(backup)
            rollback.callback(backup.rename, target)

    def delete(self, key):
        root, folders, identifier = self._delete_inputs(key)
        root = self.cap.homes.safe(root)
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as temp, ExitStack() as rollback, self.conn:
            self._delete_folders(key, identifier, folders, temp, rollback)
            self._commit(SHARED, rollback)
            rollback.pop_all()

    async def delete_async(self, key):
        root, folders, identifier = self._delete_inputs(key)
        revision = self.cap.skill_revision()
        temp = await stage_files(self._make_staging, root, discard=shutil.rmtree)
        try:
            if self.cap.skill_revision() != revision:
                raise MemberError("not_found", "the skill library changed during removal")
            with ExitStack() as rollback:
                with self.conn:
                    self._delete_folders(key, identifier, folders, temp, rollback)
                rollback.pop_all()
        finally:
            await asyncio.to_thread(shutil.rmtree, temp)
        await self.cap._mirror_async(SHARED)

    def _skill_delete_inputs(self, key, skill_id):
        row, skills, plugin = self._view_inputs(key)
        if type(skill_id) is not int or skill_id not in {s["id"] for s in skills}:
            raise MemberError("not_found", "no such skill in this package")
        home = self.cap.homes.home(SHARED)
        if plugin is None:
            return home / "skills", home / "skills" / str(skill_id), len(skills), []
        part = self.conn.execute("SELECT set_kind,set_key FROM member_skills WHERE id=?", (skill_id,)).fetchone()
        base = home / plugin["folder"]
        if part["set_kind"] != "skill":
            return home / "skills", base / ".raphael-commands" / part["set_key"], len(skills), []
        # A skill may hold another skill's folder (skills/outer/inner/SKILL.md): that one keeps its own files.
        # Paths are compared ignoring case: Windows keeps skills/Outer and skills/outer/inner in one folder tree.
        nested = [base / r["set_key"] for r in self.conn.execute(
            "SELECT set_key FROM member_skills WHERE set_id=? AND set_kind='skill' AND id<>?", (plugin["id"], skill_id))
            if folded_path(r["set_key"]).startswith(folded_path(part["set_key"]) + "/")]
        return home / "skills", base / part["set_key"], len(skills), nested

    @staticmethod
    def _own_entries(folder, skip):
        """The files and links under `folder`, outside every folder of `skip`. A link or junction is listed as itself and never
        entered, so what it points to (maybe outside the library) is neither read nor moved."""
        found = []
        pending = [folder]
        while pending:
            with os.scandir(pending.pop()) as entries:
                for entry in sorted(entries, key=lambda e: e.name):
                    if any(inside_folder(entry.path, other) for other in skip):
                        continue
                    if entry.is_symlink() or entry.is_junction() or not entry.is_dir(follow_symlinks=False):
                        found.append(Path(entry.path))
                    else:
                        pending.append(entry.path)
        return sorted(found)

    def _remove_own_files(self, folder, nested, temp, rollback):
        """Move the files of `folder` that lie outside every folder of `nested` into `temp`, undoing it with `rollback`."""
        folder = self.cap.homes.safe(folder)
        if not nested:
            self._backup(folder, temp, rollback)
            return
        # A folder already gone from the disk (removed by hand) has nothing to move: its record still goes.
        if not folder.is_dir():
            return
        skip = [self.cap.homes.safe(path) for path in nested]
        moved = []
        for path in self._own_entries(folder, skip):
            backup = Path(temp) / f"old-file-{len(moved)}"
            path.rename(backup)
            rollback.callback(restore_file, backup, path)
            moved.append(path.parent)
        # The emptied folders go with it; a folder that still holds a nested skill stays.
        for parent in sorted({d for path in moved for d in (path, *path.parents) if d.is_relative_to(folder)},
                             key=lambda d: len(d.parts), reverse=True):
            try:
                parent.rmdir()
            except OSError:
                pass

    def rename_skill(self, key, skill_id, name):
        """Give one skill of a package another name (its document and its row), and keep the name its source calls it by, so
        that an update of the package finds it again and leaves it renamed. A plugin's skills keep the plugin's names."""
        from .skill_names import normalize_skill_name, with_name

        row, skills, plugin = self._view_inputs(key)
        if plugin is not None:
            raise MemberError("scope", "a plugin keeps the names of its skills: delete a skill to free its name", reason="plugin")
        current = next((s for s in skills if s["id"] == skill_id), None)
        if type(skill_id) is not int or current is None:
            raise MemberError("not_found", "no such skill in this package")
        if not isinstance(name, str) or not name.strip():
            raise MemberError("name", "give the skill a name")
        slug = normalize_skill_name(name)
        if slug.casefold() == current["name"].casefold():
            return self.view(key)
        held = self.conn.execute("SELECT id FROM member_skills WHERE member_id=? AND name=? COLLATE NOCASE AND id<>?",
                                 (SHARED, stored_skill_name(slug, ""), skill_id)).fetchone()
        if held:
            raise taken_by(self.conn, SHARED, slug, row["name"], own_key=key)[0]
        _, text = self.cap.document(SHARED, skill_id)
        path = self.cap.homes.home(SHARED) / "skills" / str(skill_id) / "SKILL.md"
        info = self.cap._package_info_at(path)
        self.cap.rewrite_skill(SHARED, skill_id, with_name(text, slug))
        if info:
            atomic(self.cap.homes.safe(path.parent / ".raphael-source.json"),
                   json.dumps({**info, "upstream_name": info.get("upstream_name") or current["name"]}).encode())
        return self.view(key)

    async def delete_skill_async(self, key, skill_id):
        """Remove one skill of a package (its files too) and leave the others; the package's view is returned, or None
        when it was the last skill and the package went with it."""
        root, folder, count, nested = self._skill_delete_inputs(key, skill_id)
        if count == 1:
            await self.delete_async(key)
            return None
        revision = self.cap.skill_revision()
        temp = await stage_files(self._make_staging, root, discard=shutil.rmtree)
        try:
            if self.cap.skill_revision() != revision:
                raise MemberError("not_found", "the skill library changed during removal")
            with ExitStack() as rollback:
                with self.conn:
                    self._remove_own_files(folder, nested, temp, rollback)
                    self.conn.execute("DELETE FROM member_skills WHERE id=? AND package_key=?", (skill_id, key))
                rollback.pop_all()
        finally:
            await asyncio.to_thread(shutil.rmtree, temp)
        await self.cap._mirror_async(SHARED)
        return await self.view_async(key)

    def _make_staging(self, root):
        root = self.cap.homes.safe(root)
        root.mkdir(parents=True, exist_ok=True)
        return Path(tempfile.mkdtemp(prefix="pack-", dir=root))

    def _delete_inputs(self, key):
        _, skills, plugin = self._view_inputs(key)
        home = self.cap.homes.home(SHARED)
        if plugin:
            return home / "skills", [home / plugin["folder"]], plugin["id"]
        root = home / "skills"
        return root, [root / str(skill["id"]) for skill in skills], None

    def _delete_folders(self, key, identifier, folders, temp, rollback):
        for folder in folders:
            self._backup(self.cap.homes.safe(folder), temp, rollback)
        self.conn.execute("DELETE FROM member_skills WHERE package_key=?", (key,))
        if identifier is not None:
            self.conn.execute("DELETE FROM skill_sets WHERE id=?", (identifier,))
        self.conn.execute("DELETE FROM skill_packages WHERE key=?", (key,))
