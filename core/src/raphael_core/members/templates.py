"""Portable member recipes: explicit public fields only, never grants or private state."""

import json
import re
from pathlib import PurePosixPath

from ..bots.homes import redact_secrets
from ..protocol import invalid_params
from .store import clean_name, clean_role, clean_instructions, clean_personality, clean_title, clean_prompt, clean_schedule

MAX_BYTES = 512 * 1024
FIELDS = ("name", "role", "personality", "instructions", "reply_style")


def findings(value):
    """Return locations and warning classes, never matched credential values."""
    result = []
    def walk(item, path):
        if isinstance(item, str):
            if redact_secrets(item) != item or re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*[\"']?[^\s\"']{8,}", item, re.I):
                result.append({"kind": "secret", "path": path})
            if re.search(r"ignore (?:all |previous |prior )*instructions|system prompt|忽略.*(?:指令|規則)", item, re.I):
                result.append({"kind": "injection", "path": path})
        elif isinstance(item, dict):
            for key, child in item.items():
                if key not in (*FIELDS, "description", "skills", "routines", "connections", "text", "files", "prompt", "title", "format", "version", "schedule", "when"):
                    walk(key, f"{path}.fileName")
                walk(child, f"{path}.{key}" if key in (*FIELDS, "description", "skills", "routines", "connections", "text", "files", "prompt", "title") else f"{path}.file")
        elif isinstance(item, list):
            for index, child in enumerate(item):
                walk(child, f"{path}[{index}]")
    walk(value, "template")
    return result


def description(value):
    if not isinstance(value, str) or len(value.strip()) > 280:
        raise invalid_params("description must be a string of at most 280 characters")
    return value.strip()


def checked(value, *, review=False):
    if not isinstance(value, dict) or set(value) - {"description"} != {"format", "version", *FIELDS, "skills", "routines", "connections"}:
        raise invalid_params("Invalid member template fields")
    if value["format"] != "raphael-member" or type(value["version"]) is not int or value["version"] != 1:
        raise invalid_params("Unsupported member template")
    if max(len(json.dumps(value).encode()), len(json.dumps(value, ensure_ascii=False, indent=2).encode()) + 1) > MAX_BYTES:
        raise invalid_params("Member template is too large")
    if "description" in value:
        value = {**value, "description": description(value["description"])}
    clean_name(value["name"])
    clean_role(value["role"])
    clean_personality(value["personality"])
    clean_instructions(value["instructions"])
    if value["reply_style"] not in ("full", "conversational"):
        raise invalid_params("Invalid reply style")
    for key, maximum in (("skills", 40), ("routines", 50), ("connections", 30)):
        if not isinstance(value[key], list) or len(value[key]) > maximum:
            raise invalid_params("Invalid template list")
    file_count = 1
    for skill in value["skills"]:
        if not isinstance(skill, dict) or not {"text"} <= set(skill) <= {"text", "files"} or not isinstance(skill["text"], str) or not 0 < len(skill["text"].encode()) <= 128 * 1024:
            raise invalid_params("Invalid template skill")
        files = skill.get("files", {})
        if not isinstance(files, dict) or len(files) > 100:
            raise invalid_params("Invalid template skill files")
        file_count += 1 + len(files)
        if file_count > 100:
            raise invalid_params("Member template has too many files")
        for name, content in files.items():
            if not isinstance(name, str):
                raise invalid_params("Invalid template dependency path")
            path = PurePosixPath(name)
            if (len(name) > 300 or "\\" in name or ":" in name
                    or path.is_absolute() or path.as_posix() != name or any(p in (".", "..") or p.startswith(".") for p in path.parts)
                    or path.suffix.lower() not in (".md", ".txt", ".json", ".py", ".sh", ".js", ".ts", ".ps1", ".toml", ".yaml", ".yml")
                    or path.name.casefold() in ("skill.md", "memory.md", "user.md", "soul.md")
                    or not isinstance(content, str) or "\x00" in content or len(content.encode()) > 128 * 1024):
                raise invalid_params("Only safe, public text dependencies belong in a skill recipe")
    from .events import clean_when
    for routine in value["routines"]:
        if not isinstance(routine, dict) or set(routine) != {"title", "prompt", "schedule", "when"}:
            raise invalid_params("Invalid template routine")
        clean_title(routine["title"])
        clean_prompt(routine["prompt"])
        if (routine["schedule"] is None) == (routine["when"] is None):
            raise invalid_params("Invalid template trigger")
        clean_when(routine["when"]) if routine["when"] is not None else clean_schedule(routine["schedule"])
    if any(not isinstance(c, str) or not c.strip() or len(c) > 100 for c in value["connections"]):
        raise invalid_params("Invalid template connection")
    # Public instructions may themselves contain copied credentials; refuse them too.
    if not review and any(f["kind"] == "secret" for f in findings(value)):
        raise invalid_params("Remove private credentials from the member recipe first")
    return value


def export(service, member_id, *, review=False):
    member = service.store.member(member_id)
    if member is None:
        raise invalid_params("No such member")
    result = {"format": "raphael-member", "version": 1, **{key: getattr(member, key) for key in FIELDS},
              "skills": [export_skill(service.capabilities, member_id, s["id"])
                         for s in service.capabilities.owned_skills(member_id)],
              "routines": [{"title": r.title, "prompt": r.prompt,
                            "schedule": r.schedule.to_json() if r.schedule else None, "when": r.when}
                           for r in service.store.routines(member_id)],
              "connections": []}
    result["connections"] = used_connections(service, member, result)
    return checked(result, review=review)


def used_connections(service, member, recipe):
    """An explicit grant list wins; otherwise infer only this member's app evidence."""
    connections = service._connections()
    if member.tools is not None:
        return list(dict.fromkeys(c["name"] for c in connections if c["id"] in member.tools))
    # Include declarations and packaged references as well as the skill body. No private memory.
    documents = [json.dumps(recipe["skills"], ensure_ascii=False), json.dumps(recipe["routines"], ensure_ascii=False)]
    calls = list(service._conn.execute(
        "SELECT s.server,s.tool FROM agent_steps s JOIN agent_turns t ON t.id=s.turn_id"
        " WHERE t.member_id=? AND s.kind='tool' AND s.outcome IN ('ok','error','timeout')"
        " UNION SELECT s.server,s.tool FROM worker_steps s JOIN worker_tasks t ON t.id=s.task_id"
        " WHERE t.member_id=? AND s.kind='tool' AND s.outcome IN ('ok','error','timeout')"
        " UNION SELECT a.server,a.tool FROM tool_audit a JOIN worker_tasks t ON t.id=a.task_id"
        " WHERE t.member_id=? AND a.outcome IN ('ok','error','timeout')", (member.id, member.id, member.id)))
    aliases = {"googlecalendar": ("Google Calendar", "calendar_list_events", "calendar"),
               "googledrive": ("Google Drive", "drive_list_files"), "gmail": ("Gmail", "gmail_list_messages"),
               "huggingface": ("Hugging Face",), "github": ("GitHub",)}

    def mentions(text, token):
        # Spaces, hyphens and underscores in toolkit slugs are equivalent, but word substrings are not.
        words = re.findall(r"[^\W_]+", token.casefold())
        if not words:
            return False
        return re.search(r"(?<![^\W_])" + r"[\s_:\-/]*".join(map(re.escape, words)) + r"(?![^\W_])", text.casefold()) is not None

    result = []
    for connection in connections:
        identifier, name = connection["id"], connection["name"]
        tokens = [identifier, name, re.sub(r"\s+(?:MCP|server|connector)$", "", name, flags=re.I), *connection.get("services", [])]
        for token in list(tokens):
            slug = re.sub(r"[^a-z0-9]", "", token.casefold().removeprefix("composio:"))
            tokens.extend(aliases.get(slug, ()))
        # Per-member receipts supply both server ids and connector tool slugs. Global last-used is not evidence.
        evidence = documents + [f"{row['server'] or ''} {row['tool'] or ''}" for row in calls]
        if any(mentions(text, token) for text in evidence for token in tokens):
            if name not in result:
                result.append(name)
    return result


def export_skill(capabilities, member_id, identifier):
    from .skill_library import package
    snapshot = package(capabilities._path(member_id, identifier).parent)
    snapshot.pop(".raphael-source.json", None)
    try:
        text = snapshot.pop("SKILL.md").decode("utf-8-sig")
        files = {name: data.decode("utf-8") for name, data in snapshot.items()}
    except UnicodeError:
        raise invalid_params("Remove pictures and binary/private files from this skill before sharing") from None
    return {"text": text, **({"files": files} if files else {})}


async def handle(service, params):
    action = params.get("action")
    if action in ("catalog", "catalog-preview", "publish", "folder"):
        from .member_catalog import handle as catalog_handle
        return await catalog_handle(service, params)
    if action == "review":
        value = export(service, service._member_id(params), review=True)
        return {"template": value, "findings": findings(value)}
    if action == "export":
        return {"template": export(service, service._member_id(params))}
    if action == "import" and params.get("catalog_id"):
        from .member_catalog import client
        value = await client(service).package(params["catalog_id"], require_fresh=True)
        if params.get("template") != value:
            raise invalid_params("Template changed; review the current package before adding it")
    else:
        value = checked(params.get("template"))
    if action == "preview":
        return {"template": value, "findings": findings(value)}
    if action != "import":
        raise invalid_params("Invalid template action")
    # Nothing is installed or granted during preview. Imports get no connection tools.
    made = await service._create({**{key: value[key] for key in FIELDS},
                                  **({"blurb": value["description"]} if "description" in value else {}),
                                  "name": params.get("name", value["name"]), "tools": [],
                                  "avatar": params.get("avatar", "slime:color:blue"),
                                  "group_id": params.get("group_id"), "greet": True,
                                  "ui_language": params.get("ui_language")})
    identifier = made["member"]["id"]
    try:
        for skill in value["skills"]:
            kept = service.capabilities.keep_recipe(identifier, skill["text"], skill.get("files", {}))
            service.capabilities.update_skill(identifier, kept["id"], False)
        for routine in value["routines"]:
            service.store.create_routine(member_id=identifier, **routine, enabled=False, next_run_ms=None)
    except Exception:
        # Never leave a partly imported recipe presented as complete.
        await service._delete({"id": identifier})
        raise
    service._changed()
    return made
