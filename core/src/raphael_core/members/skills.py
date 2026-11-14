"""Host-owned skill revisions and bounded generated Markdown; guidance grants no execution."""

import json
import re
from contextlib import nullcontext
from datetime import datetime, timedelta

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


# At most this many NEW learned skills a member gets in this window (owner, 2026-11-11: "他現在一直建立 skills").
# Changes to an existing skill are not counted.
NEW_SKILL_CAP = 1
NEW_SKILL_WINDOW = timedelta(hours=24)


class GrowingSkills:
    def new_skills_in_window(self, member_id):
        """How many skills this member learned (not imported, not the owner's) within `NEW_SKILL_WINDOW`."""
        since = datetime.now() - NEW_SKILL_WINDOW
        count = 0
        for skill in self.owned_skills(member_id):
            if skill.get("provenance") != "learned" or not skill.get("learned_at"):
                continue
            try:
                count += datetime.fromisoformat(skill["learned_at"]) >= since
            except ValueError:
                continue
        return count

    def check_new_learned_skill(self, member_id, text):
        """Before a learned skill is created: refuse one near an existing skill (it is a change to that one) and a second
        new one in a day. The refusal reaches a model as an instruction, so it says what to do instead."""
        from .capabilities import skill_metadata
        from .skill_names import similar_skill
        from ..bots.homes import redact_secrets
        if not isinstance(text, str):
            raise HomeError("skill requires text")
        name, description = skill_metadata(redact_secrets(text), writing=True)
        near = similar_skill(name, description, self.owned_skills(member_id))
        if near is not None:
            raise HomeError(f"a similar skill already exists: '{near['name']}' (id {near['id']}). Read it with skill_read "
                            "and update that skill with its id and expected_hash instead of creating another")
        if self.new_skills_in_window(member_id) >= NEW_SKILL_CAP:
            raise HomeError("a new skill was already learned in the last day; update an existing skill, or wait")

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
        identifier = args.get("id")
        if identifier is not None:
            self.require_owned(member_id, identifier)
        skills = self.owned_skills(member_id)
        previous = next((s for s in skills if s["id"] == identifier), {})
        name, _ = skill_metadata(redact_secrets(text), writing=True, previous_name=previous.get("name"))
        source = previous.get("source", "")
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

    def reference_hashes(self, member_id, identifier):
        folder = self._path(member_id, identifier).parent / "references"
        owner = self.skill_owner(member_id, identifier)
        return {str(path.relative_to(self.homes.home(owner))).replace("\\", "/"): digest(self.homes.safe(path).read_bytes())
                for path in sorted(folder.rglob("*")) if path.is_file()}
