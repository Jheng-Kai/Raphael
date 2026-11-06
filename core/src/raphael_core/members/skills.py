"""Host-owned skill revisions and bounded generated Markdown; guidance grants no execution."""

import json
import re
from contextlib import nullcontext
from datetime import datetime

from ..bots.homes import HomeError, digest


def skill_plugin(text, source=""):
    """Packaging is metadata, never a capability or authority."""
    if source.startswith("plugin:"):
        return source[7:].strip()[:100]
    if source.startswith("local:"):
        parts = source[6:].replace("\\", "/").split("/")
        for index in range(len(parts) - 3):
            if parts[index:index + 2] == ["plugins", "cache"]:
                return parts[index + 3][:100]
    front = text[:4096].split("---", 2)
    match = re.search(r"^plugin:[ \t]*([^\r\n]+)$", front[1], re.M) if len(front) == 3 and not front[0].strip() else None
    return match[1].strip().strip("\"'")[:100] if match else ""


def slash_part(name):
    return re.sub(r"[^\w-]+", "-", name.casefold()).strip("-") or "skill"


def stored_skill_name(name, plugin):
    # Keep packaging namespaces inside the existing table's unique member/name identity.
    return f"{plugin}:{name}" if plugin else name


def slash_skills(skills, commands):
    """One stable namespace for discovery and execution, scoped to this member."""
    counts = {}
    for item in [*commands, *[skill for skill in skills if skill["enabled"]]]:
        name = slash_part(item["name"])
        counts[name] = counts.get(name, 0) + 1
    used = {command["name"].casefold() for command in commands}
    result = []
    for skill in skills:
        name = slash_part(skill["name"])
        token = f"{slash_part(skill.get('plugin') or 'skill')}:{name}" if counts.get(name, 0) > 1 else name
        if token in used:
            token += f"-{skill['id']}"
        if skill["enabled"]:
            used.add(token)
        result.append({**skill, "slash_name": token})
    return result


class GrowingSkills:
    def skill_details(self, member_id, skill):
        path = self._path(member_id, skill["id"])
        relative = f"skills/{skill['id']}/SKILL.md"
        state = self.homes.safe(self.homes.state(member_id) / "skills.json")
        previous = next((s for s in json.loads(state.read_text(encoding="utf-8")) if s["id"] == skill["id"]), {}) if state.exists() else {}
        revision = digest(path.read_bytes()) if path.exists() else None
        updated = previous.get("updated_at")
        if revision != previous.get("revision") or not updated:
            # Normal reads use the mirror; do not load every memory/skill body in the journal.
            folder = self.homes.safe(self.homes.state(member_id) / "journal")
            for journal in sorted(folder.glob("*.json"), reverse=True):
                entry = json.loads(self.homes.safe(journal).read_text(encoding="utf-8"))
                if entry.get("path") == relative and entry.get("applied"):
                    updated = datetime.strptime(entry["id"].split("-")[0], "%Y%m%dT%H%M%S%f").isoformat()
                    break
        provenance = previous.get("provenance") or (skill["source"] if skill["source"] in ("learned", "owner") else "imported")
        with path.open(encoding="utf-8") if path.exists() else nullcontext(None) as document:
            metadata = document.read(4096) if document else ""
            plugin = skill_plugin(metadata, skill["source"])
        name = skill["name"]
        if plugin and metadata:
            from .capabilities import skill_metadata
            name = skill_metadata(metadata)[0]
        return {**skill, "name": name, **({"plugin": plugin} if plugin else {}), "provenance": provenance,
                "revision": revision,
                "learned_at": previous.get("learned_at") or (updated if provenance == "learned" else None),
                "updated_at": updated, **self.source_details(member_id, skill["id"])}

    def validate_skill(self, member_id, args):
        """Bot writes always validate the structure and use optimistic document revisions."""
        self.check(member_id)
        text = args.get("text")
        if not isinstance(text, str) or any(not re.search(rf"^## {section}\s*$", text, re.M)
                                               for section in ("When to use", "Procedure", "Pitfalls", "Verification")):
            raise HomeError("skill requires When to use, Procedure, Pitfalls and Verification sections")
        provenance = args.get("provenance", "learned")
        if provenance not in ("learned", "imported", "owner"):
            raise HomeError("invalid skill provenance")
        references = args.get("references", {})
        if not isinstance(references, dict) or len(references) > 8:
            raise HomeError("at most eight references are allowed")
        for name, content in references.items():
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(?:md|txt|json)", name):
                raise HomeError("invalid reference name")
            if not isinstance(content, str) or "\x00" in content or len(content.encode("utf-8")) > 8000:
                raise HomeError("reference must be bounded UTF-8 text")
        from .capabilities import MAX_SKILL_BYTES, MAX_SKILLS, skill_metadata
        from ..bots.homes import redact_secrets
        if len(text.encode("utf-8")) > MAX_SKILL_BYTES or "\x00" in text:
            raise HomeError("skill must be bounded UTF-8 text")
        name, _ = skill_metadata(redact_secrets(text))
        identifier = args.get("id")
        if identifier is not None:
            self.require_owned(member_id, identifier)
        skills = self.owned_skills(member_id)
        source = next((s["source"] for s in skills if s["id"] == identifier), "")
        if any(s["id"] != identifier and s["name"].casefold() == name.casefold() and s.get("plugin", "").casefold() == skill_plugin(text, source).casefold() for s in skills):
            raise HomeError("a skill with that name already exists")
        if identifier is None and len(skills) >= MAX_SKILLS:
            raise HomeError("member skill limit reached")
        if identifier is not None:
            if type(identifier) is not int:
                raise HomeError("invalid skill id")
            skill, _ = self.document(member_id, identifier)
            if not args.get("expected_hash") or args["expected_hash"] != skill["revision"]:
                raise HomeError("skill changed; read it again before writing")
            names = {relative.rsplit("/", 1)[-1] for relative in self.reference_hashes(member_id, identifier)}
            if len(names | references.keys()) > 8:
                raise HomeError("at most eight references are allowed")

    def manage_skill(self, member_id, args):
        self.validate_skill(member_id, args)
        identifier = args.get("id")
        provenance = args.get("provenance", "learned")
        if identifier is None:
            skill = self.keep_skill(member_id, provenance, args["text"], mirror=False)
        else:
            skill = self.rewrite_skill(member_id, identifier, args["text"], mirror=False)
        for name, content in args.get("references", {}).items():
            self.homes.keep(member_id, f"skills/{skill['id']}/references/{name}", content)
        learned_at = skill.get("learned_at")
        if provenance == "learned" and not learned_at:
            learned_at = datetime.now().isoformat()
        self._mirror(member_id, {skill["id"]: {"provenance": provenance, "learned_at": learned_at}})
        return self._skill(member_id, skill["id"])

    def undo_revision(self, member_id):
        """The latest metadata snapshot is the single undo boundary, including deletion."""
        entries = [item for item in self.homes.journal(member_id) if item.get("state") == "skills.json" and item.get("applied")]
        return entries[-1]["id"] if entries and entries[-1].get("before") is not None else None

    def undo_skills(self, member_id, revision):
        self.check(member_id)
        if not revision or revision != self.undo_revision(member_id):
            raise HomeError("skill revision is no longer current")
        entries = self.homes.journal(member_id)
        entry = next(item for item in entries if item["id"] == revision)
        state = self.homes.safe(self.homes.state(member_id) / "skills.json")
        if digest(state.read_bytes()) != entry["after_hash"]:
            raise HomeError("skill state changed; read it again before reverting")
        current_hashes = {}
        for skill in json.loads(state.read_text(encoding="utf-8")):
            current_hashes[f"skills/{skill['id']}/SKILL.md"] = skill["revision"]
            current_hashes.update(skill.get("references", {}))
            if self.reference_hashes(member_id, skill["id"]) != skill.get("references", {}):
                raise HomeError("skill references changed; read them again before reverting")
        for relative, expected in current_hashes.items():
            path = self.homes.path(member_id, relative)
            current = digest(path.read_bytes()) if path.exists() else None
            if current != expected:
                raise HomeError("skill document changed; read it again before reverting")
        restored = json.loads(entry["before"])
        documents = {}
        for skill in restored:
            wanted = {f"skills/{skill['id']}/SKILL.md": skill["revision"], **skill.get("references", {})}
            for relative, expected in wanted.items():
                path = self.homes.path(member_id, relative)
                current = path.read_bytes().decode("utf-8") if path.exists() else None
                if relative not in current_hashes:
                    latest = next((item for item in reversed(entries) if item.get("path") == relative and item.get("applied")), None)
                    expected_current = latest["after_hash"] if latest else None
                    if digest(None if current is None else current.encode("utf-8")) != expected_current:
                        raise HomeError("skill document changed; read it again before reverting")
                    current_hashes[relative] = expected_current
                if digest(None if current is None else current.encode("utf-8")) == expected:
                    documents[relative] = current
                    continue
                previous = next((item["before"] for item in reversed(entries) if item.get("path") == relative
                                 and item.get("before_hash") == expected and item.get("applied")), None)
                if previous is None:
                    raise HomeError("skill document revision is unavailable")
                documents[relative] = previous
        current_paths = {f"skills/{s['id']}/SKILL.md" for s in self.owned_skills(member_id)}
        for skill in self.owned_skills(member_id):
            current_paths.update(self.reference_hashes(member_id, skill["id"]))
        for relative in current_paths - documents.keys():
            self.homes.delete(member_id, relative, expected_hash=current_hashes[relative])
        for relative, text in documents.items():
            self.homes.write(member_id, relative, text, expected_hash=current_hashes[relative])
        with self.conn:
            self.conn.execute("DELETE FROM member_skills WHERE member_id = ?", (member_id,))
            self.conn.executemany("INSERT INTO member_skills(id,member_id,name,description,enabled,source) VALUES (?,?,?,?,?,?)",
                                 [(s["id"], member_id, stored_skill_name(s["name"], s.get("plugin")), s["description"], s["enabled"], s["source"]) for s in restored])
        self._mirror(member_id, {s["id"]: {key: s.get(key) for key in ("provenance", "learned_at")} for s in restored})

    def reference_hashes(self, member_id, identifier):
        folder = self._path(member_id, identifier).parent / "references"
        owner = self.skill_owner(member_id, identifier)
        return {str(path.relative_to(self.homes.home(owner))).replace("\\", "/"): digest(self.homes.safe(path).read_bytes())
                for path in sorted(folder.rglob("*")) if path.is_file()}
