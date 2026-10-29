import json
from pathlib import Path

import pytest

from raphael_core.evaluate.design_cli import CliReviewer, subscription_environment
from raphael_core.evaluate.design_judge import batch_prompt, parse_batch, run_judge
from test_design_judge import RULES, make_run


class FakeReviewer:
    model = "subscription-model"
    version = "installed-cli 1.0"
    command = ["installed-cli"]

    def __init__(self, *, score=4, invalid=False):
        self.calls = []
        self.score, self.invalid = score, invalid

    async def identify(self):
        return "cli:fake:model:1.0"

    async def review(self, prompt, images):
        identifiers = json.loads(prompt.splitlines()[-1])
        self.calls.append({"images": len(images), "prompt": prompt})
        return "{}" if self.invalid else json.dumps({"reviews": [{"image": image, "score": self.score, "findings": []} for image in identifiers]})


def setup(root):
    run = make_run(root)
    spec = root / ".agents/product"
    spec.mkdir(parents=True)
    (spec / "RULES.md").write_text(RULES)
    features = root / ".agents/skills/verify-raphael/features"
    features.mkdir(parents=True)
    (features / "home.md").write_text("npm run look -- home --theme both --width 1120,720")
    reference = root / "reference.png"
    reference.write_bytes(b"\x89PNGreference")
    return run, reference


def test_subscription_environment_removes_api_credentials_and_endpoint_overrides():
    env = subscription_environment({"PATH": "bin", "HOME": "home", "CODEX_HOME": "auth", "OPENROUTER_API_KEY": "secret",
        "OPENAI_API_KEY": "secret", "ANTHROPIC_AUTH_TOKEN": "secret", "ANTHROPIC_BASE_URL": "https://openrouter.ai",
        "CLAUDE_CODE_USE_BEDROCK": "1", "CLAUDECODE": "1"})
    assert env == {"PATH": "bin", "HOME": "home", "CODEX_HOME": "auth"}


@pytest.mark.parametrize("brain", ["claude", "codex"])
async def test_cli_default_never_constructs_api_client_and_caches_each_image(tmp_path, monkeypatch, brain):
    import raphael_core.brain.openrouter as api
    monkeypatch.setattr(api, "OpenRouterClient", lambda *_: pytest.fail("subscription judge touched OpenRouter"))
    run, reference = setup(tmp_path)
    reviewer = FakeReviewer()
    assert await run_judge(run, brain=brain, root=tmp_path, references=[reference], reviewer=reviewer) == 0
    assert len(reviewer.calls) == 2 and all(call["images"] == 4 for call in reviewer.calls)
    assert await run_judge(run, brain=brain, root=tmp_path, references=[reference], reviewer=reviewer) == 0
    assert len(reviewer.calls) == 2
    reports = [json.loads(path.read_text()) for path in tmp_path.glob("app/.look/judge-*/report.json")]
    assert all(report["brain"] == brain and report["openrouter_requests"] == 0 for report in reports)
    assert sorted(report["requests"] for report in reports) == [0, 2]


@pytest.mark.parametrize("score,invalid,limit,error", [(3, False, 2, None), (4, True, 2, "invalid_review"), (4, False, 1, "judge_budget_exhausted")])
async def test_cli_refuses_low_scores_bad_schema_and_request_exhaustion(tmp_path, score, invalid, limit, error):
    run, reference = setup(tmp_path)
    reviewer = FakeReviewer(score=score, invalid=invalid)
    assert await run_judge(run, brain="codex", root=tmp_path, references=[reference], reviewer=reviewer, max_requests=limit) == 1
    report = json.loads(next(tmp_path.glob("app/.look/judge-*/report.json")).read_text())
    assert any(row["failed"] for row in report["results"])
    if error:
        assert any(row.get("error") == error for row in report["results"])
    assert len(reviewer.calls) <= limit


def test_batch_requires_every_candidate_and_cannot_downgrade_hard_rules():
    rows = [{"image": "home.png"}]
    prompt = batch_prompt(RULES, ["Home"], rows)
    assert "FIRST 1 images" in prompt and '"reviews"' in prompt
    review = {"image": "home.png", "score": 5, "findings": [{"rule_id": "R-UI-01", "hard": False, "detail": "Visible issue"}]}
    assert parse_batch(json.dumps({"reviews": [review]}), rows, RULES)[0]["failed"]
    for values in ([], [review, review], [{**review, "image": "other.png"}]):
        with pytest.raises(ValueError):
            parse_batch(json.dumps({"reviews": values}), rows, RULES)


@pytest.mark.parametrize("brain", ["claude", "codex"])
async def test_commands_are_read_only_subscription_and_attach_the_images(tmp_path, brain):
    reviewer = CliReviewer(brain, "test-model", environ={"PATH": "", "OPENROUTER_API_KEY": "secret"}, commands={brain: ["cli"]})
    commands = []
    async def execute(command, prompt, cwd):
        commands.append((command, prompt, cwd))
        if brain == "claude":
            return 0, '\n'.join(json.dumps(packet) for packet in [
                {"message": {"content": [{"type": "tool_use", "id": "read-0", "name": "Read", "input": {"file_path": str(cwd / "image-0.png").replace("\\", "/")}}]}},
                {"message": {"content": [{"type": "tool_result", "tool_use_id": "read-0", "content": "image", "is_error": False}]}},
                {"type": "result", "subtype": "success", "modelUsage": {"claude-test": {}}, "structured_output": {"reviews": []}},
            ]), ""
        return 0, '\n'.join([json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": '{"reviews":[]}'}}), '{"type":"turn.completed"}']), ""
    reviewer.execute = execute
    assert json.loads(await reviewer.review("review", [b"\x89PNGimage"])) == {"reviews": []}
    command, prompt, cwd = commands[0]
    assert not Path(cwd).exists()
    assert "secret" not in json.dumps(command) and "OPENROUTER_API_KEY" not in reviewer.environ
    if brain == "claude":
        assert command[command.index("--tools") + 1] == "Read" and "--setting-sources" in command
        assert "image-0.png" in prompt
    else:
        assert "--ignore-user-config" in command and "-i" in command and "model_provider=\"openai\"" in command
        assert "features.shell_tool=false" in command and "--sandbox" in command


@pytest.mark.parametrize("brain,auth,accepted", [
    ("claude", {"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty"}, True),
    ("claude", {"loggedIn": True, "authMethod": "api_key", "apiProvider": "firstParty"}, False),
    ("codex", "Logged in using ChatGPT", True), ("codex", "Logged in using an API key", False),
])
async def test_identify_accepts_only_subscription_authentication(brain, auth, accepted):
    reviewer = CliReviewer(brain, "model", environ={"PATH": ""}, commands={brain: ["cli"]})
    async def execute(command, *_):
        return (0, "CLI 1.0", "") if "--version" in command else (0, json.dumps(auth) if isinstance(auth, dict) else auth, "")
    reviewer.execute = execute
    if accepted:
        assert await reviewer.identify() == f"cli:{brain}:model:CLI 1.0"
    else:
        with pytest.raises(ValueError, match="judge_subscription_login_required"):
            await reviewer.identify()


async def test_cli_error_event_is_redacted_and_stops_before_scoring():
    reviewer = CliReviewer("claude", "model", environ={"PATH": ""}, commands={"claude": ["cli"]})
    async def execute(*_):
        return 1, json.dumps({"type": "result", "is_error": True, "errors": ["Connection error. token=secret-value"]}), ""
    reviewer.execute = execute
    with pytest.raises(ValueError, match="judge_cli_failed"):
        await reviewer.review("review", [b"\x89PNGimage"])
    assert "Connection error" in str(reviewer.calls[0]["error_events"])
    assert "secret-value" not in str(reviewer.calls)


@pytest.mark.parametrize("returned", [False, True])
async def test_claude_cannot_score_an_image_that_read_never_returned_or_failed(returned):
    reviewer = CliReviewer("claude", "model", environ={"PATH": ""}, commands={"claude": ["cli"]})
    async def execute(_command, _prompt, cwd):
        blocks = [{"type": "tool_use", "id": "read-0", "name": "Read", "input": {"file_path": str(cwd / "image-0.png")}}]
        if returned:
            blocks.append({"type": "tool_result", "tool_use_id": "read-0", "is_error": True, "content": "Read denied"})
        return 0, json.dumps({"message": {"content": blocks}}) + '\n' + json.dumps({"type": "result", "subtype": "success", "structured_output": {"reviews": []}}), ""
    reviewer.execute = execute
    with pytest.raises(ValueError, match="judge_images_not_read"):
        await reviewer.review("review", [b"\x89PNGimage"])
