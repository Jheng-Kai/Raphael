"""Claude Code's models: the CLI's answer, the older models its own program file still runs, and the saved aliases.

Nothing here starts the real CLI, reads the real program or spends anything: the answer is what the installed CLI
(2.1.323) gave `initialize` on 2026-11-14, and the program is a trimmed copy of its two tables (fixtures/)."""

import json
import os
import sys
from datetime import date
from pathlib import Path

import pytest

from raphael_core.agent.cli import claude_registry as registry
from raphael_core.agent.cli.claude_registry import claude_program, claude_registry, parse_models, parse_retirements, running
from raphael_core.agent.cli.discovery import CliBrains, brain_effort, brain_ref
from raphael_core.agent.cli.models import claude_cli_models, claude_models, claude_rows, find_model

BUNDLE = Path(__file__).parent / "fixtures" / "claude_code_bundle.js"
TODAY = date(2026, 11, 14)

EFFORTS = ["low", "medium", "high", "xhigh", "max"]
# What the installed CLI (2.1.323) answered `initialize` with on 2026-11-14: the models it offers, by alias.
INITIALIZE = [
    {"value": "default", "resolvedModel": "claude-opus-5-5", "displayName": "Default (recommended)",
     "description": "Use the default model (currently Opus 5.5) \u00b7 $4/$20 per Mtok", "supportsEffort": True, "supportedEffortLevels": EFFORTS},
    {"value": "opus", "resolvedModel": "claude-opus-5-5", "displayName": "Opus",
     "description": "Opus 5.5 \u00b7 Best for everyday, complex tasks \u00b7 $4/$20 per Mtok", "supportsEffort": True, "supportedEffortLevels": EFFORTS},
    {"value": "claude-fable-5-2[1m]", "resolvedModel": "claude-fable-5-2", "displayName": "Fable",
     "description": "Fable 5.2 \u00b7 Most capable for your hardest and longest-running tasks", "supportsEffort": True, "supportedEffortLevels": EFFORTS},
    {"value": "sonnet", "resolvedModel": "claude-sonnet-5-5", "displayName": "Sonnet",
     "description": "Sonnet 5.5 \u00b7 Efficient for routine tasks \u00b7 $2/$10 per Mtok", "supportsEffort": True, "supportedEffortLevels": EFFORTS},
    {"value": "haiku", "resolvedModel": "claude-haiku-5-5", "displayName": "Haiku",
     "description": "Haiku 5.5 \u00b7 Fastest for quick answers \u00b7 $0.10/$0.50 per Mtok ($0.50/$2.50 for prompts over 100k)",
     "supportsEffort": True, "supportedEffortLevels": EFFORTS},
]


@pytest.fixture(autouse=True)
def forget_reads():
    registry._READ.clear()


@pytest.fixture
def bundle():
    return BUNDLE.read_bytes()


def listed(models):
    return [(model["id"].removeprefix("cli:claude:"), model["name"]) for model in models]


def test_the_registry_table_gives_each_model_its_id_version_and_depths(bundle):
    by_id = {model["id"]: model for model in parse_models(bundle)}
    # Entries without a first-party id cannot be run and the lookalike object before the table is no entry.
    assert list(by_id) == ["claude-3-5-haiku", "claude-haiku-5-5", "claude-sonnet-4-5", "claude-sonnet-5-5", "claude-opus-4-1",
                           "claude-opus-4-5", "claude-opus-5-5", "claude-fable-5-2", "claude-mythos-5"]
    assert by_id["claude-opus-4-1"]["model"] == "claude-opus-4-1-20250805" and by_id["claude-opus-4-1"]["name"] == "Opus 4.1"
    assert by_id["claude-opus-5-5"]["efforts"] == EFFORTS and by_id["claude-opus-5-5"]["default_effort"] == "medium"
    assert by_id["claude-opus-4-5"]["efforts"] == [] and by_id["claude-opus-4-5"]["default_effort"] is None
    assert by_id["claude-fable-5-2"]["family"] == "fable"


def test_the_retirement_table_says_what_has_stopped_and_what_will(bundle):
    retirements = parse_retirements(bundle)
    assert retirements["claude-opus-4-1-20250805"] == ("retired", date(2026, 8, 5))
    assert retirements["claude-3-5-haiku-20241022"][0] == "retired"
    assert retirements["claude-sonnet-4-5"] == ("deprecated", date(2026, 11, 30))
    assert "claude-opus-5-5" not in retirements


def test_a_model_that_has_stopped_is_not_offered_and_one_that_will_says_when(bundle):
    models, retirements = parse_models(bundle), parse_retirements(bundle)
    kept = {model["id"]: model for model in running(models, retirements, TODAY)}
    assert "claude-opus-4-1" not in kept and "claude-3-5-haiku" not in kept
    assert kept["claude-sonnet-4-5"]["retires"] == date(2026, 11, 30) and kept["claude-opus-5-5"]["retires"] is None
    assert "claude-sonnet-4-5" not in {model["id"] for model in running(models, retirements, date(2026, 12, 1))}


def test_without_the_retirement_table_nothing_is_offered_that_may_have_stopped(bundle):
    assert running(parse_models(bundle), None, TODAY) == []
    cut = bundle.replace(b'status:"retired"', b'status:"gone"')
    assert parse_retirements(cut) is None and parse_models(cut)


def test_the_program_is_read_from_its_file_and_a_file_that_cannot_be_read_gives_nothing(tmp_path):
    kept = claude_registry([str(BUNDLE)], TODAY)
    assert [model["id"] for model in kept] == ["claude-haiku-5-5", "claude-sonnet-4-5", "claude-sonnet-5-5", "claude-opus-4-5",
                                               "claude-opus-5-5", "claude-fable-5-2", "claude-mythos-5"]
    # The same file again is not read again.
    assert claude_registry([str(BUNDLE)], TODAY) == kept and len(registry._READ) == 1
    (tmp_path / "empty.js").write_bytes(b"")
    (tmp_path / "other.js").write_bytes(b"console.log('nothing of models here')")
    for command in ([str(tmp_path / "empty.js")], [str(tmp_path / "other.js")], [str(tmp_path / "missing.exe")], [], None):
        assert claude_registry(command, TODAY) == []


def test_the_npm_install_is_read_from_the_script_node_runs_not_from_node(tmp_path):
    script = tmp_path / "cli.js"
    script.write_bytes(b"")
    assert claude_program(["node.exe", str(script)]) == script
    assert claude_program(["C:/tools/claude.exe"]) == Path("C:/tools/claude.exe")
    assert claude_program(["python.exe", str(tmp_path / "gone.js")]) == Path("python.exe")


def test_the_list_gives_every_model_its_version_in_its_name_and_the_id_it_runs(bundle):
    models = claude_rows(INITIALIZE, {}, running(parse_models(bundle), parse_retirements(bundle), TODAY))
    assert listed(models) == [
        ("claude-opus-5-5", "Claude Opus 5.5"), ("claude-fable-5-2", "Claude Fable 5.2"),
        ("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-haiku-5-5", "Claude Haiku 5.5"),
        # then what the CLI's own program still runs of those families, a family at a time, newest first
        ("claude-opus-4-5-20251101", "Claude Opus 4.5"), ("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5")]
    # The id of a row is what `claude --model` is given: the driver's argument is the id after `cli:claude:`.
    for model in models:
        assert brain_ref(model["id"]) == ("claude", model["id"].removeprefix("cli:claude:"))
    assert all(model["name"].startswith("Claude ") and any(char.isdigit() for char in model["name"]) for model in models)
    assert [model["description"] for model in models[:4]] == [
        "Best for everyday, complex tasks", "Most capable for your hardest and longest-running tasks",
        "Efficient for routine tasks", "Fastest for quick answers"]
    assert models[5]["description"] == "Retires November 30, 2026" and models[4]["description"] == ""
    assert next(model for model in models if model["is_default"])["id"] == "cli:claude:claude-opus-5-5"
    assert sum(model["is_default"] for model in models) == 1


def test_each_model_has_its_own_depths(bundle):
    models = {m["id"].removeprefix("cli:claude:"): m for m in
              claude_rows(INITIALIZE, {}, running(parse_models(bundle), parse_retirements(bundle), TODAY))}
    assert models["claude-fable-5-2"]["reasoning_efforts"] == EFFORTS and models["claude-fable-5-2"]["default_effort"] == "high"
    assert models["claude-opus-4-5-20251101"]["reasoning_efforts"] == [] and models["claude-opus-4-5-20251101"]["default_effort"] is None


def test_a_model_the_cli_does_not_offer_this_account_is_not_listed(bundle):
    # Mythos is in the registry but no row of the CLI's answer is of its family.
    ids = [model["id"] for model in claude_rows(INITIALIZE, {}, running(parse_models(bundle), parse_retirements(bundle), TODAY))]
    assert not any("mythos" in identifier for identifier in ids)


def test_without_its_program_the_list_is_what_the_cli_answered_with_the_versions_it_gave():
    models = claude_rows(INITIALIZE, {})
    assert listed(models) == [("claude-opus-5-5", "Claude Opus 5.5"), ("claude-fable-5-2", "Claude Fable 5.2"),
                              ("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-haiku-5-5", "Claude Haiku 5.5")]


def test_a_version_is_read_from_the_id_when_the_cli_names_none():
    rows = [{"value": "opus", "resolvedModel": "claude-opus-5-5", "displayName": "Opus", "supportedEffortLevels": []},
            {"value": "claude-opus-4-1-20250805", "resolvedModel": "claude-opus-4-1-20250805", "displayName": "Opus"},
            {"value": "claude-3-5-haiku-20241022", "displayName": "Haiku"},
            {"value": "claude-opus-4-20250514", "displayName": "Opus"}, {"value": "mine", "displayName": "My model"}]
    assert [model["name"] for model in claude_rows(rows, {})] == [
        "Claude Opus 5.5", "Claude Opus 4.1", "Claude Haiku 3.5", "Claude Opus 4", "Claude My model"]


def test_a_saved_alias_is_found_and_its_model_named():
    models = claude_rows(INITIALIZE, {})
    assert find_model(models, "cli:claude:opus")["id"] == "cli:claude:claude-opus-5-5"
    # Fable's own value for the CLI carries a `[1m]` that is no id: the family's alias still finds it.
    assert find_model(models, "cli:claude:fable")["name"] == "Claude Fable 5.2"
    assert find_model(models, "cli:claude:claude-sonnet-5-5")["name"] == "Claude Sonnet 5.5"
    assert find_model(models, "cli:claude:unknown") is None
    assert [model["aliases"] for model in models] == [["opus"], ["fable"], ["sonnet"], ["haiku"]]


def test_a_member_saved_with_an_alias_keeps_it_and_is_shown_the_model_it_is_on(tmp_path):
    brains = CliBrains(home=tmp_path, environ={})
    brains._models["claude"] = claude_rows(INITIALIZE, {})
    assert brains.model_name("cli:claude:opus") == "Claude Opus 5.5"
    assert brains.model_name("cli:claude:haiku?effort=low") == "Claude Haiku 5.5"
    assert brains.model_name("cli:claude:claude-fable-5-2") == "Claude Fable 5.2"
    assert brains.model_name("cli:claude:unknown") == "Claude Code"
    # The depth is chosen from the model's own, and the reference stays the member's: nothing is saved under another id.
    assert brains.with_effort("cli:claude:opus", "max") == "cli:claude:opus?effort=max"
    assert brain_ref("cli:claude:opus?effort=max") == ("claude", "opus") and brain_effort("cli:claude:opus?effort=max") == "max"


def test_the_owner_default_may_be_an_alias_a_long_id_or_have_the_context_suffix(bundle):
    older = running(parse_models(bundle), parse_retirements(bundle), TODAY)
    for chosen, expected in (("sonnet", "claude-sonnet-5-5"), ("fable", "claude-fable-5-2"), ("opus[1m]", "claude-opus-5-5"),
                             ("claude-opus-4-5-20251101", "claude-opus-4-5-20251101"), ("claude-sonnet-5-5", "claude-sonnet-5-5")):
        default = [model["id"] for model in claude_rows(INITIALIZE, {"model": chosen}, older) if model["is_default"]]
        assert default == [f"cli:claude:{expected}"], chosen
    assert not any(model["is_default"] for model in claude_rows(INITIALIZE, {"model": "no-such-model"}, older))


def test_the_built_in_list_names_no_version_it_does_not_know(tmp_path):
    models = claude_models(tmp_path)
    assert listed(models) == [("opus", "Claude Opus"), ("fable", "Claude Fable"), ("sonnet", "Claude Sonnet"), ("haiku", "Claude Haiku")]
    assert not any(char.isdigit() for model in models for char in model["name"])


async def test_the_list_is_the_cli_answer_and_its_program_together(tmp_path, monkeypatch):
    seen = []

    def read(command):
        seen.append(command)
        return running(parse_models(BUNDLE.read_bytes()), parse_retirements(BUNDLE.read_bytes()), TODAY)
    monkeypatch.setattr("raphael_core.agent.cli.models.claude_registry", read)
    script = tmp_path / "claude.py"
    script.write_text('''import json, sys
sys.stdin.readline()
print(json.dumps({"type": "control_response", "response": {"subtype": "success", "response": {"models": json.loads(%r)}}}), flush=True)
''' % json.dumps(INITIALIZE), encoding="utf-8")
    command = [sys.executable, str(script)]
    models = await claude_cli_models(command, dict(os.environ), tmp_path)
    assert seen == [command]
    assert len(models) == 6 and models[4]["name"] == "Claude Opus 4.5"


async def test_when_the_program_cannot_be_read_the_menu_still_has_the_cli_models_with_their_versions(tmp_path):
    folder = tmp_path / ".claude"
    folder.mkdir()
    (folder / ".credentials.json").write_text("{}")
    script = tmp_path / "claude.py"
    script.write_text('''import json, sys
if "--version" in sys.argv: print("2.1.323"); raise SystemExit
sys.stdin.readline()
print(json.dumps({"type": "control_response", "response": {"subtype": "success", "response": {"models": json.loads(%r)}}}), flush=True)
''' % json.dumps(INITIALIZE), encoding="utf-8")
    brains = CliBrains(home=tmp_path, environ=dict(os.environ), commands={"claude": [sys.executable, str(script)]})
    try:
        await brains.list()
        await brains._model_refresh
        shown = next(c for c in (await brains.list())["clis"] if c["id"] == "claude")["models"]
        assert [model["name"] for model in shown] == ["Claude Opus 5.5", "Claude Fable 5.2", "Claude Sonnet 5.5", "Claude Haiku 5.5"]
    finally:
        await brains.aclose()
