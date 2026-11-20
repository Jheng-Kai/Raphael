"""Team library packages, access and transactional document replacement."""

import json
import shutil
import tempfile
import uuid
from contextlib import ExitStack
from datetime import datetime
from pathlib import Path

from ..bots.homes import atomic, redact_secrets
from .capabilities import MAX_SKILLS, MAX_SKILL_BYTES, skill_metadata, skill_urls
from .skill_library import SHARED
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

    def view(self, key):
        row = self.row(key)
        skills = [{"id": s["id"], "name": s["name"].rsplit(":", 1)[-1], "description": s["description"],
                   "enabled": bool(s["enabled"])} for s in self.conn.execute(
                       "SELECT * FROM member_skills WHERE package_key=? ORDER BY id", (key,))]
        name, source = row["name"], row["source"]
        version = description = ""
        updatable = refetchable(row["origin"], source)
        if key.startswith("set:"):
            plugin = self.conn.execute("SELECT * FROM skill_sets WHERE id=?", (key[4:],)).fetchone()
            name, version, source, description = (plugin[k] for k in ("name", "version", "source", "description"))
            updatable = bool(json.loads(plugin["metadata"]).get("marketplace")) or refetchable("source", source)
            kind = "plugin"
        else:
            kind = "single" if len(skills) == 1 else "pack"
            if kind == "single":
                description = skills[0]["description"]
        return {"key": key, "name": name, "kind": kind, "source": source, "description": description,
                "version": version, "enabled": bool(row["enabled"]), "access": json.loads(row["access"]),
                "updatable": updatable, "skills": skills}

    def list(self):
        packages = [self.view(r[0]) for r in self.conn.execute("SELECT key FROM skill_packages")]
        return sorted(packages, key=lambda p: p["name"].casefold())

    def for_member(self, member_id):
        rows = self.conn.execute(
            "SELECT p.key,COALESCE(t.name,p.name) AS name,COUNT(s.id) AS skills FROM skill_packages p "
            "LEFT JOIN skill_sets t ON p.key='set:'||t.id LEFT JOIN member_skills s ON s.package_key=p.key AND s.enabled "
            "WHERE p.enabled AND (p.access=? OR ? IN (SELECT value FROM json_each(p.access))) "
            "GROUP BY p.key ORDER BY name COLLATE NOCASE", ('"all"', member_id))
        return [dict(row) for row in rows]

    def install(self, member, documents, source, origin, label, *, access=None, name=None, key=None, required_skill=None):
        """Publish a validated snapshot in one SQL transaction, restoring old folders on failure."""
        self.cap.check(member)
        if access is not None:
            self.validate_access(access)
        old = {}
        if key is not None:
            self.row(key)
            old = {r["name"].casefold(): r for r in self.conn.execute(
                "SELECT id,name FROM member_skills WHERE package_key=?", (key,))}
        taken = {r[0].casefold() for r in self.conn.execute(
            "SELECT name FROM member_skills WHERE member_id=? AND (? IS NULL OR package_key IS NOT ?)", (member, key, key))}
        if len(taken) + len(documents) > MAX_SKILLS:
            raise MemberError("full", "skill limit reached")
        prepared = []
        for skill_source, files in documents:
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
            slug, desc = skill_metadata(text, writing=True, previous_name=previous_slug)
            stored = stored_skill_name(slug, skill_plugin(text, skill_source))
            if stored.casefold() in taken:
                raise MemberError("taken", f"a skill named {slug} already exists")
            taken.add(stored.casefold())
            prepared.append((stored, desc, skill_source, {**files, "SKILL.md": text.encode()}))
        if required_skill is not None and not any(
                old[name.casefold()]["id"] == required_skill for name, *_ in prepared if name.casefold() in old):
            raise MemberError("not_found", "the refreshed package no longer has that skill")
        if not prepared:
            raise MemberError("not_found", "no SKILL.md found")
        root = self.cap.homes.safe(self.cap.homes.home(member) / "skills")
        root.mkdir(parents=True, exist_ok=True)
        ids = []
        with tempfile.TemporaryDirectory(dir=root) as temp, ExitStack() as rollback, self.conn:
            if member == SHARED and key is None:
                key = "pack:" + uuid.uuid4().hex
                default = "all" if len(prepared) == 1 else []
                self.conn.execute("INSERT INTO skill_packages(key,name,source,origin,access) VALUES (?,?,?,?,?)",
                                  (key, name or (prepared[0][0].rsplit(":", 1)[-1] if len(prepared) == 1 else label), source, origin,
                                   json.dumps(default if access is None else access)))
            for stored, desc, skill_source, files in prepared:
                existing = old.pop(stored.casefold(), None)
                if existing:
                    identifier = existing["id"]
                    self.conn.execute("UPDATE member_skills SET description=?,source=? WHERE id=?", (desc, skill_source, identifier))
                else:
                    identifier = self.conn.execute(
                        "INSERT INTO member_skills(member_id,name,description,source,package_key) VALUES (?,?,?,?,?)",
                        (member, stored, desc, skill_source, key)).lastrowid
                ids.append(identifier)
                target = self.cap.homes.safe(root / str(identifier))
                self._backup(target, temp, rollback)
                rollback.callback(shutil.rmtree, target, True)
                for path, data in files.items():
                    atomic(self.cap.homes.safe(target / path), data)
                metadata = {"source": source, "origin": origin, "files": [p for p in files if p != "SKILL.md"]}
                atomic(target / ".raphael-source.json", json.dumps(metadata).encode())
            for row in old.values():
                self._backup(self.cap.homes.safe(root / str(row["id"])), temp, rollback)
                self.conn.execute("DELETE FROM member_skills WHERE id=?", (row["id"],))
            stamp = datetime.now().isoformat()
            self._commit(member, rollback, {i: {"updated_at": stamp} for i in ids})
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
            backup = Path(temp) / target.name
            target.rename(backup)
            rollback.callback(backup.rename, target)

    def delete(self, key):
        package = self.view(key)
        home = self.cap.homes.home(SHARED)
        plugin = package["kind"] == "plugin"
        if plugin:
            identifier = int(key[4:])
            folders = [self.cap.plugin_root(identifier)]
            root = self.cap.homes.safe(home / "skill-sets")
        else:
            root = self.cap.homes.safe(home / "skills")
            folders = [self.cap.homes.safe(root / str(skill["id"])) for skill in package["skills"]]
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as temp, ExitStack() as rollback, self.conn:
            for folder in folders:
                self._backup(folder, temp, rollback)
            self.conn.execute("DELETE FROM member_skills WHERE package_key=?", (key,))
            if plugin:
                self.conn.execute("DELETE FROM skill_sets WHERE id=?", (identifier,))
            self.conn.execute("DELETE FROM skill_packages WHERE key=?", (key,))
            self._commit(SHARED, rollback)
            rollback.pop_all()
