"""Public CLI model metadata. Discovery never starts a conversation."""

import asyncio
import json
import re
import tempfile
import tomllib

from .claude_registry import claude_registry
from .process import Child

# What is shown until the CLI has answered (`claude_cli_models`), and if it never does: the CLI's own words for the
# newest model of each family, which name no version because this list knows none.
CLAUDE_EFFORTS = ("low", "medium", "high", "xhigh", "max")
CLAUDE_MODELS = (
    ("opus", "Claude Opus", "Complex reasoning and demanding work", CLAUDE_EFFORTS),
    ("fable", "Claude Fable", "The toughest, longest work", CLAUDE_EFFORTS),
    ("sonnet", "Claude Sonnet", "Balanced speed and reasoning", CLAUDE_EFFORTS),
    ("haiku", "Claude Haiku", "Fast everyday tasks", CLAUDE_EFFORTS),
)
EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
RUNNABLE = re.compile(r"[\w./-]{1,200}")
# `claude-opus-5-5`, `claude-opus-4-1-20250805`, and the older `claude-3-5-haiku-20241022`.
ID_VERSION = (re.compile(r"claude-(?P<family>[a-z]+)-(?P<major>\d{1,2})(?:-(?P<minor>\d{1,2}))?(?:-\d{8})?"),
              re.compile(r"claude-(?P<major>\d{1,2})(?:-(?P<minor>\d{1,2}))?-(?P<family>[a-z]+)(?:-\d{8})?"))


def read_settings(path, *, toml=False):
    try:
        text = path.read_text(encoding="utf-8-sig")
        value = tomllib.loads(text) if toml else json.loads(text)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def claude_models(folder):
    config = read_settings(folder / "settings.json")
    default = config.get("model") or "sonnet"
    models = [{"id": f"cli:claude:{alias}", "name": name, "description": description,
               "reasoning_efforts": list(efforts), "default_effort": "high" if efforts else None,
               "is_default": default == alias}
              for alias, name, description, efforts in CLAUDE_MODELS]
    if not any(model["is_default"] for model in models) and isinstance(default, str) and RUNNABLE.fullmatch(default):
        models.append({"id": f"cli:claude:{default}", "name": default.replace("-", " ").title(),
                       "description": "Configured CLI model", "is_default": True})
    return models


def claude_identity(identifier):
    """The family and version an id names: `("opus", "5.5")`, or None for an id that names neither."""
    for pattern in ID_VERSION:
        match = pattern.fullmatch(identifier)
        if match:
            return match["family"], ".".join(part for part in (match["major"], match["minor"]) if part)
    return None


def claude_name(display, description, identifier):
    """Claude Code's name for a model with its version: its own `displayName` when that has one ("Opus 5.5"), else the
    first words of its description ("Opus 5.5 · Best for ..."), else the version its id names."""
    display = display.removeprefix("Claude ").strip()
    if re.search(r"\d", display):
        return f"Claude {display}"
    head = (description or "").partition(" · ")[0].strip()
    if display and re.fullmatch(rf"{re.escape(display)} \d+(?:\.\d+)*", head, flags=re.I):
        return f"Claude {head}"
    named = claude_identity(identifier)
    if named and (not display or display.lower() == named[0]):
        return f"Claude {named[0].title()} {named[1]}"
    return f"Claude {display}" if display else f"Claude {identifier}"


def claude_description(display, description):
    """What the CLI says of a model, without its own name and its price: the list is not a price list."""
    parts = [part.strip() for part in (description or "").split(" · ")]
    if parts and display and re.fullmatch(rf"{re.escape(display)} \d+(?:\.\d+)*", parts[0], flags=re.I):
        parts = parts[1:]
    return " · ".join(part for part in parts if part and not part.startswith("$"))


def alias_ids(model):
    """The ids a model is also saved under: Claude Code takes a family's alias (`opus`) for its newest model."""
    prefix = model["id"].rpartition(":")[0]
    return [f"{prefix}:{alias}" for alias in model.get("aliases", ())]


def find_model(models, reference):
    """The row a saved reference (an id or an alias) stands for, or None."""
    return next((m for m in models if m["id"] == reference), None) or next((m for m in models if reference in alias_ids(m)), None)


def claude_older(registry, listed, families):
    """The models of the CLI's registry that still run and are not in its answer, of the families it offers: a family
    at a time, in the order the CLI gave them, the newest first."""
    def version(entry):
        return tuple(int(part) for part in re.findall(r"\d+", entry["name"]))
    fresh = [entry for entry in registry if entry["family"] in families and entry["model"] not in listed and entry["id"] not in listed]
    older = []
    for family in families:
        for entry in sorted((entry for entry in fresh if entry["family"] == family), key=version, reverse=True):
            levels = [level for level in entry["efforts"] if level in EFFORTS]
            retires = entry.get("retires")
            older.append({"id": f"cli:claude:{entry['model']}", "name": f"Claude {entry['name']}",
                          "description": f"Retires {retires:%B} {retires.day}, {retires.year}" if retires else "",
                          "reasoning_efforts": levels, "default_effort": "high" if "high" in levels else None,
                          "aliases": [], "is_default": False})
    return older


def claude_rows(rows, config, registry=()):
    """The CLI's own list (`initialize`) as this app's rows, in its order, then the older models of its registry that
    still run. A row's id is the exact model it runs; the alias the CLI also takes for it (`opus`) is kept in
    `aliases`, so that a member saved with the alias finds its model. The CLI's "default" names one of the others."""
    chosen = config.get("model")
    chosen = re.sub(r"\[\w+\]$", "", chosen) if isinstance(chosen, str) else None
    fallback = next((row.get("resolvedModel") for row in rows if row.get("value") == "default"), None)
    models, families = [], []
    for row in rows:
        value, resolved = row.get("value"), row.get("resolvedModel")
        identifier = next((item for item in (resolved, value) if isinstance(item, str) and RUNNABLE.fullmatch(item)), None)
        if value == "default" or identifier is None:
            continue
        display = row.get("displayName") or ""
        word = display.split()[0].lower() if display.split() else ""
        family = word if word.isalpha() else (claude_identity(identifier) or ("", ""))[0]
        if family and family not in families:
            families.append(family)
        named = (value if isinstance(value, str) and RUNNABLE.fullmatch(value) else None, display.lower() if display.isalpha() else None)
        levels = [level for level in row.get("supportedEffortLevels") or [] if level in EFFORTS]
        models.append({"id": f"cli:claude:{identifier}", "name": claude_name(display, row.get("description"), identifier),
                       "description": claude_description(display, row.get("description")), "reasoning_efforts": levels,
                       "default_effort": "high" if "high" in levels else None,
                       "aliases": list(dict.fromkeys(item for item in named if item and item != identifier)), "is_default": False})
    models += claude_older(registry, {model["id"].rpartition(":")[2] for model in models}, families)
    key = chosen or fallback
    if key:
        for model in models:
            if key in (model["id"].rpartition(":")[2], *model["aliases"]):
                model["is_default"] = True
                break
    return models


async def claude_cli_models(command, environ, folder):
    """Asks the CLI what it offers over its control channel: no message is sent, so no turn runs and nothing is
    spent. No settings are loaded, so the owner's hooks do not run either; their default is read from the file.
    The older models it still runs come from its own program file (claude_registry.py); when that gives none, the
    list is what the CLI said."""
    with tempfile.TemporaryDirectory(prefix="raphael-cli-", ignore_cleanup_errors=True) as empty:
        child = Child([*command, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                       "--no-session-persistence", "--strict-mcp-config", "--tools", "", "--setting-sources", ""],
                      environ=environ, cwd=empty)
        try:
            async with asyncio.timeout(20):
                await child.start()
                await child.send({"type": "control_request", "request_id": "models", "request": {"subtype": "initialize"}})
                while True:
                    line = await child.process.stdout.readline()
                    if not line:
                        raise ValueError("model_list_unavailable")
                    packet = json.loads(line)
                    if packet.get("type") == "control_response":
                        answer = packet.get("response") or {}
                        if answer.get("subtype") != "success":
                            raise ValueError("model_list_unavailable")
                        rows = (answer.get("response") or {}).get("models")
                        if not isinstance(rows, list) or not rows:
                            raise ValueError("model_list_unavailable")
                        break
        finally:
            await child.kill()
    registry = await asyncio.to_thread(claude_registry, command)
    return claude_rows(rows, read_settings(folder / "settings.json"), registry)


def agy_models(output, settings):
    """Group public model variants while retaining the exact runnable model refs."""
    default = read_settings(settings).get("model")
    families = {}
    for line in output.splitlines():
        identifier, sep, display = line.partition("\t")
        if not sep or not re.fullmatch(r"[\w./-]{1,200}", identifier):
            continue
        match = re.fullmatch(r"(.+)-(low|medium|high|xhigh|max)", identifier)
        family, effort = match.groups() if match else (identifier, None)
        maker = "Anthropic" if family.startswith("claude-") else "OpenAI" if family.startswith("gpt-") else "Google" if family.startswith("gemini-") else ""
        model = families.setdefault(family, {"id": f"cli:gemini:{identifier}", "provider": maker,
            "name": re.sub(r"\s+(Low|Medium|High|Xhigh|Max)$", "", display, flags=re.I) if effort else display,
            "reasoning_efforts": [], "effort_models": {}, "is_default": False})
        if effort and effort not in model["reasoning_efforts"]:
            model["id"] = f"cli:gemini:{family}"
            model["reasoning_efforts"].append(effort)
            model["effort_models"][effort] = f"cli:gemini:{identifier}"
        if default == display:
            model.update(is_default=True, default_effort=effort)
    for model in families.values():
        model["reasoning_efforts"].sort(key=EFFORTS.index)
    return list(families.values())


async def antigravity_models(command, environ, settings):
    child = Child([*command, "models"], environ=environ)
    try:
        async with asyncio.timeout(12):
            await child.start()
            output = bytearray()
            while chunk := await child.process.stdout.read(65536):
                output.extend(chunk)
                if len(output) > 2_000_000:
                    raise ValueError("model_list_unavailable")
            await child.process.wait()
            if child.process.returncode:
                raise ValueError("model_list_unavailable")
            return agy_models(output.decode("utf-8-sig", errors="replace"), settings)
    finally:
        await child.kill()


async def codex_models(command, environ, config_path):
    child = Child([*command, "app-server"], environ=environ)
    sequence = 0

    async def request(method, params):
        nonlocal sequence
        sequence += 1
        await child.send({"jsonrpc": "2.0", "id": sequence, "method": method, "params": params})
        while True:
            line = await child.process.stdout.readline()
            if not line:
                raise ValueError("model_list_unavailable")
            packet = json.loads(line)
            if packet.get("id") == sequence:
                if "error" in packet:
                    raise ValueError("model_list_unavailable")
                return packet.get("result") or {}

    try:
        # A first start on a busy computer can take this long, and nothing waits on it but the list.
        async with asyncio.timeout(30):
            await child.start()
            await request("initialize", {"clientInfo": {"name": "raphael", "version": "0.2.0"}, "capabilities": {}})
            await child.send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
            rows, cursor = [], None
            for _ in range(20):
                page = await request("model/list", {"cursor": cursor, "limit": 100})
                rows.extend(page.get("data", []))
                cursor = page.get("nextCursor")
                if not cursor:
                    break
    finally:
        await child.kill()
    config = read_settings(config_path, toml=True)
    models = []
    for row in rows:
        identifier = row.get("model") or row.get("id")
        if row.get("hidden") or not isinstance(identifier, str) or not re.fullmatch(r"[\w./-]{1,200}", identifier):
            continue
        levels = [item["reasoningEffort"] for item in row.get("supportedReasoningEfforts", [])
                  if isinstance(item, dict) and item.get("reasoningEffort") in EFFORTS]
        default = identifier == config["model"] if config.get("model") else bool(row.get("isDefault"))
        effort = config.get("model_reasoning_effort") if default else None
        effort = effort if effort in levels else row.get("defaultReasoningEffort")
        models.append({"id": f"cli:codex:{identifier}", "name": row.get("displayName") or identifier,
                       "description": row.get("description") or "", "is_default": default,
                       "reasoning_efforts": levels, "default_effort": effort if effort in levels else None})
    return models
