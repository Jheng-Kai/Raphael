"""Team library packages, access and transactional document replacement."""

import asyncio
import json
import shutil
import tempfile
import uuid
from contextlib import ExitStack
from datetime import datetime
from pathlib import Path

from ..bots.homes import atomic, redact_secrets
from .capabilities import MAX_SKILL_BYTES, skill_metadata, skill_urls
from .skill_library import SHARED, stage_files
from .skill_sources import validate_files
from .skills import skill_plugin, stored_skill_name
from .store import MemberError


def refetchable(origin, source):
    if origin != "source":
        return False
    if source.startswith("local:"):
        return Path(source[6:]).exists()
    try:
        skill_urls(source)
    except MemberError:
        return False
    return True


def taken_by(conn, member, stored):
    """A name that is taken, in words, and the package that holds it. A switched-off skill keeps its name (#313), so the
    owner is told where it is and that it is off, to remove that one skill."""
    row = conn.execute(
        "SELECT s.enabled, p.enabled AS package_enabled, COALESCE(t.name,p.name) AS package FROM member_skills s "
        "LEFT JOIN skill_packages p ON p.key=s.package_key LEFT JOIN skill_sets t ON t.id=s.set_id "
        "WHERE s.member_id=? AND s.name=? COLLATE NOCASE", (member, stored)).fetchone()
    text = f"a skill named {stored} already exists"
    package = row["package"] if row and row["package"] else ""
    if package:
        text += f' in the package "{package}"'
        if not row["enabled"] or row["package_enabled"] == 0:
            text += " (switched off)"
    return text, package


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
                   "enabled": bool(s["enabled"])} for s in self.conn.execute(
                       "SELECT * FROM member_skills WHERE package_key=? ORDER BY id", (key,))]
        plugin = self.conn.execute("SELECT * FROM skill_sets WHERE id=?", (key[4:],)).fetchone() if key.startswith("set:") else None
        return row, skills, plugin

    def view(self, key):
        return self._view(*self._view_inputs(key))

    async def view_async(self, key):
        return await asyncio.to_thread(self._view, *self._view_inputs(key))

    def _view(self, row, skills, plugin):
        key = row["key"]
        name, source = row["name"], row["source"]
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
        updatable = refetchable(row["origin"], source)
        if plugin is not None:
            name, version, source, description = (plugin[k] for k in ("name", "version", "source", "description"))
            updatable = bool(json.loads(plugin["metadata"]).get("marketplace")) or refetchable("source", source)
            kind = "plugin"
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
        if key is not None:
            self.row(key)
            old = {r["name"].casefold(): r for r in self.conn.execute(
                "SELECT id,name FROM member_skills WHERE package_key=?", (key,))}
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
            files = validate_files(files)
            raw = files["SKILL.md"]
            if len(raw) > MAX_SKILL_BYTES:
                raise MemberError("size", "skill document is too large")
            try:
                text = redact_secrets(raw.decode("utf-8-sig"))
            except UnicodeError:
                raise MemberError("skill", "skill must be UTF-8 Markdown") from None
            if "\x00" in text:
                raise MemberError("skill", "skill must be UTF-8 Markdown")
            previous_slug = None
            if old:
                slug, _ = skill_metadata(text)
                previous = stored_skill_name(slug, skill_plugin(text, skill_source)).casefold()
                if previous in old:
                    previous_slug = old[previous]["name"].rsplit(":", 1)[-1]
                elif local:
                    previous_slug = local["previous"]["name"].rsplit(":", 1)[-1]
            slug, desc = skill_metadata(text, writing=True, previous_name=previous_slug)
            stored = stored_skill_name(slug, skill_plugin(text, skill_source))
            if stored.casefold() in taken:
                if slug == skill_metadata(text)[0]:
                    message, package = taken_by(self.conn, member, stored)
                    if not skipping:
                        raise MemberError("taken", message)
                    refused = refused or message
                    if skipped is not None:
                        skipped.append({"name": stored, "held_by": package})
                    continue
                plugin = skill_plugin(text, skill_source)
                prefix = stored[:-len(slug)].casefold()
                slug = unique_skill_name(slug, {name[len(prefix):] for name in taken if name.startswith(prefix)})
                stored = stored_skill_name(slug, plugin)
            taken.add(stored.casefold())
            metadata = {"source": source, "origin": origin, "files": [p for p in files if p != "SKILL.md"]}
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
            raise MemberError("taken", refused)
        if not prepared:
            raise MemberError("not_found", "no SKILL.md found")
        revision = self.cap.skill_revision()
        root = self.cap.homes.home(member) / "skills"
        temp = await stage_files(self._write, root, prepared, local, discard=shutil.rmtree)
        try:
            self.cap.check(member)
            if self.cap.skill_revision() != revision:
                raise MemberError("not_found", "the skill library changed during import")
            if access is not None:
                self.validate_access(access)
            key, ids = self._publish(member, source, origin, label, access, name, key, old, prepared, root, temp, local,
                                     enabled, skill, skill_switches)
        finally:
            await asyncio.to_thread(shutil.rmtree, temp)
        stamp = datetime.now().isoformat()
        await self.cap._mirror_async(member, {i: {"updated_at": stamp} for i in ids})
        return key, ids

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
                 enabled, skill, skill_switches):
        ids = []
        with ExitStack() as rollback:
            with self.conn:
                if member == SHARED and key is None:
                    key = "pack:" + uuid.uuid4().hex
                    default = "all" if len(prepared) == 1 else []
                    self.conn.execute("INSERT INTO skill_packages(key,name,source,origin,access) VALUES (?,?,?,?,?)",
                                      (key, name or (prepared[0][0].rsplit(":", 1)[-1] if len(prepared) == 1 else label), source, origin,
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
            return home / "skills", home / "skills" / str(skill_id), len(skills)
        part = self.conn.execute("SELECT set_kind,set_key FROM member_skills WHERE id=?", (skill_id,)).fetchone()
        inside = part["set_key"] if part["set_kind"] == "skill" else ".raphael-commands/" + part["set_key"]
        return home / "skill-sets", home / plugin["folder"] / inside, len(skills)

    async def delete_skill_async(self, key, skill_id):
        """Remove one skill of a package (its files too) and leave the others; the package's view is returned, or None
        when it was the last skill and the package went with it."""
        root, folder, count = self._skill_delete_inputs(key, skill_id)
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
                    self._backup(self.cap.homes.safe(folder), temp, rollback)
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
            return home / "skill-sets", [home / plugin["folder"]], plugin["id"]
        root = home / "skills"
        return root, [root / str(skill["id"]) for skill in skills], None

    def _delete_folders(self, key, identifier, folders, temp, rollback):
        for folder in folders:
            self._backup(self.cap.homes.safe(folder), temp, rollback)
        self.conn.execute("DELETE FROM member_skills WHERE package_key=?", (key,))
        if identifier is not None:
            self.conn.execute("DELETE FROM skill_sets WHERE id=?", (identifier,))
        self.conn.execute("DELETE FROM skill_packages WHERE key=?", (key,))
