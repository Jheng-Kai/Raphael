"""Synthetic dictations only; no subscription, private corpus or provider access."""

import copy
import json
import re
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from raphael_core.brain.cleanup import build_system_prompt
from raphael_core.evaluate.cleanup import Case
from raphael_core.evaluate import cleanup_compare as compare


PROMPTS = Path(__file__).parents[2] / "src/raphael_core/brain/prompts"


def case(text, **kwargs):
    return Case("synthetic", text, [], [], [], **kwargs)


def judgment(winner="B"):
    return {"facts": [{"id": "f1", "kind": "condition", "meaning": "Keep the review condition."}],
            "A": {"kept": ["f1"], "missing": [], "wrong_additions": [], "language_kept": True,
                  "structure": {"lead_sentence": True, "topics_separated": True, "enumerations_formatted": True}},
            "B": {"kept": ["f1"], "missing": [], "wrong_additions": [], "language_kept": True,
                  "structure": {"lead_sentence": True, "topics_separated": True, "enumerations_formatted": True}},
            "enumerates": True, "winner": winner, "reason": "The points are easier to follow."}


def row():
    score = {**judgment()["A"], "numbered_items": 3, "checks_failed": [], "characters": 80}
    return {"case": "synthetic", "scores": {"old": copy.deepcopy(score), "new": copy.deepcopy(score)},
            "winner": "new", "enumerates": True,
            "outputs": {"old": {"latency_ms": 100}, "new": {"latency_ms": 80}}}


def test_shipped_candidate_uses_the_real_renderer_and_matches_production():
    original = build_system_prompt([], [])
    template = (PROMPTS / "cleanup_candidate.md").read_text(encoding="utf-8")
    assert template == (PROMPTS / "cleanup_system.md").read_text(encoding="utf-8")
    assert len(template) < 3500
    synthetic = case("嗯請找 Zinnia")
    synthetic = replace(synthetic, dictionary=["Zinnia", "{target_app}"])
    rendered = compare.render(template, synthetic)
    assert "Zinnia" in rendered
    assert "{languages}" not in rendered and "{script_rules}" not in rendered
    assert "Traditional characters with Taiwan usage" in rendered
    assert '{"text": "<the cleaned text>"}' in rendered
    assert "Target app: unknown" in rendered
    assert build_system_prompt([], []) == original
    assert original.startswith("Edit dictation into the clear text the speaker would type after thinking it through.")


@pytest.mark.parametrize(("text", "cleaned", "needles", "items", "paragraphs"), [
    ("嗯嗯那個郵件星期二寄不對星期四寄給 Neris 只有主管核准才寄不要先寄",
     "只有主管核准後，星期四才把郵件寄給 Neris，不要先寄。",
     ["星期四", "Neris", "只有", "不要先寄"], 0, 1),
    ("修復有幾步第一個 check logs 再來 retry 最後 keep backup 不要刪",
     "修復有幾步：\n\n1. check logs。\n2. retry。\n3. keep backup，不要刪。",
     ["check logs", "retry", "keep backup", "不要刪"], 3, 2),
    ("我講三件事嗯工作室租金 4700 不含水電再來測試 Cedar API timeout 45 秒最後去車站如果下雨就搭計程車",
     "我講三件事：\n\n1. 工作室租金 4700，不含水電。\n2. 測試 Cedar API，timeout 45 秒。\n3. 去車站，如果下雨就搭計程車。",
     ["4700", "不含水電", "Cedar API", "timeout 45", "如果下雨", "計程車"], 3, 2),
])
def test_synthetic_structure_and_facts(text, cleaned, needles, items, paragraphs):
    synthetic = case(text, must_contain_ci=needles)
    result = compare.lexical_scores(synthetic, cleaned)
    assert result["checks_failed"] == []
    assert result["numbered_items"] == items
    assert result["paragraphs"] == paragraphs
    assert not result["numbers_missing_literal"]
    if items:
        assert result["lead_in"]


def test_literal_numbers_exclude_list_ordinals_and_flag_added_numbers():
    scores = compare.lexical_scores(case("設定 35 秒"), "1. 設定 35 秒。\n2. 改成 88 秒。")
    assert scores["numbers_added_literal"] == ["88"]
    assert scores["numbers_missing_literal"] == []
    scores = compare.lexical_scores(case("預算4700元，稅率5％"), "預算4700元，稅率8％。")
    assert scores["numbers_missing_literal"] == ["5％"]
    assert scores["numbers_added_literal"] == ["8％"]


def test_long_three_topic_message_keeps_separate_paragraphs_and_qualifications():
    speech = (
        "嗯我把今天要交代的事情一起說一下好了工作室那邊 Neris 說屋頂已經修好了"
        "但是下雨的時候還是要再看一次因為之前只有晴天看過不要現在就簽驗收單"
        "租金每個月 4700 元不含水電這部分我下午再跟他確認然後講一下 Cedar API 的測試"
        "昨天那個 timeout 我本來說設 30 秒不對還是改成 45 秒好了不過只改 staging"
        "正式環境先不要碰 logs 還是要留下來等 reviewer 看完才可以清理"
        "對了車站接人的部分我要另外說因為 Zinnia 的班次是晚上 8 點到"
        "如果下雨就搭計程車沒有下雨就走路不用先替我訂車到時候我會再傳訊息"
    )
    cleaned = (
        "今天要交代工作室、Cedar API 測試和車站接人的事情。\n\n"
        "Neris 說工作室屋頂已修好，但之前只在晴天看過，下雨時還要再看一次，不要現在就簽驗收單。"
        "租金每月 4700 元，不含水電，我下午再跟他確認。\n\n"
        "Cedar API 的 timeout 改成 45 秒，只改 staging，正式環境先不要碰。"
        "logs 要留到 reviewer 看完才可以清理。\n\n"
        "Zinnia 的班次晚上 8 點到。如果下雨就搭計程車，沒下雨就走路，不用先替我訂車，我到時會再傳訊息。"
    )
    scores = compare.lexical_scores(case(speech, must_contain_ci=[
        "Neris", "4700", "不含水電", "不要現在就簽驗收單", "Cedar API", "45", "staging",
        "正式環境先不要碰", "reviewer", "Zinnia", "8", "如果下雨", "不用先替我訂車",
    ]), cleaned)
    assert scores["checks_failed"] == []
    assert scores["paragraphs"] == 4
    # Literal diagnostics deliberately flag superseded numbers; semantic judging resolves them.
    assert scores["numbers_missing_literal"] == ["30"]


@pytest.mark.parametrize(("field", "value", "reason"), [
    ("kept", [], "lost_facts"),
    ("wrong_additions", ["A fabricated deadline."], "wrong_additions"),
    ("language_kept", False, "language_changed"),
    ("checks_failed", ["Missing required name"], "deterministic_regression"),
    ("numbered_items", 0, "missing_list"),
])
def test_per_case_diagnostics_remain_visible_with_overall_wins(field, value, reason):
    bad = row()
    bad["scores"]["new"][field] = value
    summary = compare.summarize([row(), row(), bad], 3)
    assert reason in summary["regressions"][0]["reasons"]
    assert not summary["ship_candidate"]


def test_missing_fact_identity_cannot_be_replaced_by_an_equal_fact_count():
    bad = row()
    bad["scores"]["new"]["kept"] = ["other"]
    assert "lost_facts" in compare.case_gate(bad)


def test_gate_requires_noise_even_when_all_cases_win():
    assert not compare.summarize([row()], 1)["ship_candidate"]
    assert compare.summarize([row()], 1)["switch_gate"]["status"] == "noise_required"
    assert not compare.summarize([row()], 2)["ship_candidate"]
    assert not compare.summarize([], 0)["ship_candidate"]
    tied = row()
    tied["winner"] = "old"
    assert not compare.summarize([row(), tied], 2)["ship_candidate"]
    assert not compare.summarize([{"error": "TimeoutError"}], 1)["ship_candidate"]


@pytest.mark.parametrize("mutation", ["duplicate", "unknown", "overlap", "unassigned"])
def test_judge_must_account_for_every_fact_once(mutation):
    value = judgment()
    if mutation == "duplicate":
        value["facts"] *= 2
    elif mutation == "unknown":
        value["A"]["kept"] = ["unknown"]
    elif mutation == "overlap":
        value["A"]["missing"] = ["f1"]
    else:
        value["A"]["kept"] = []
    with pytest.raises(ValueError):
        compare.validate_judgment(value)


def test_judge_cannot_silently_drop_declared_long_case_facts():
    with pytest.raises(compare.ComparisonError, match="omitted_expected_fact"):
        compare.validate_judgment(judgment(), ["required-1"])


def structure_expectation():
    return {"topics": [
        {"id": "room", "meaning": "Room access", "anchors": ["東門"]},
        {"id": "budget", "meaning": "Budget and consent", "anchors": ["預算"]},
        {"id": "notice", "meaning": "Notice recipients", "anchors": ["通知"]},
    ], "min_numbered_items": 3, "lead_sentence": True, "paragraphs_per_topic": True}


def test_long_structure_checks_measure_topic_blocks_lists_and_opening():
    synthetic = compare.ComparisonCase(**compare.asdict(case("安排東門檢查預算通知")),
                                       structure=structure_expectation())
    text = "請確認場地、費用與聯絡安排。\n\n東門檢查如下：\n\n1. 開門。\n2. 量寬。\n3. 留走道。\n\n預算等同意才支付。\n\n通知只寄內部。"
    metrics = compare.lexical_scores(synthetic, text)
    assert metrics["structure_checks_failed"] == []
    assert metrics["topic_blocks_literal"] == {"room": [2], "budget": [4], "notice": [5]}
    flat = compare.lexical_scores(synthetic, "1. 東門檢查預算通知。")
    assert set(flat["structure_checks_failed"]) == {
        "too_few_numbered_items", "missing_lead_paragraph", "too_few_topic_paragraphs"}


@pytest.mark.parametrize(("field", "reason"), [
    ("lead_sentence", "missing_lead_sentence"),
    ("topics_separated", "mixed_topics"),
    ("enumerations_formatted", "unformatted_enumeration"),
])
def test_long_structure_diagnostics_remain_visible_with_fact_retention_and_clarity_wins(field, reason):
    bad = row()
    bad["expected_structure"] = structure_expectation()
    bad["scores"]["new"]["structure"][field] = False
    bad["scores"]["new"]["structure_checks_failed"] = []
    bad["scores"]["old"]["structure_checks_failed"] = []
    result = compare.summarize([bad], 1)
    assert not result["ship_candidate"]
    assert reason in result["regressions"][0]["reasons"]
    assert result["new"]["scored_structure_cases"] == 1
    assert result["new"][field + "_cases"] == 0


def test_all_fifteen_authored_scripts_have_long_speech_facts_and_structure():
    path = Path(__file__).parent / "data/cleanup_long_cases.jsonl"
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    loaded = compare.read_cases([path])
    assert len(loaded) == len(entries) == 15
    assert len({entry["id"] for entry in entries}) == 15
    for entry, (_, synthetic, _) in zip(entries, loaded):
        units = len(re.findall(r"[\u3400-\u9fff]|[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?", synthetic.input))
        assert 2 <= units / 220 <= 5
        assert units == entry["speech_estimate"]["units"]
        assert not entry["speech_estimate"]["measured_audio"]
        assert len(synthetic.input) < 1500
        assert "嗯" in synthetic.input and "不對" in synthetic.input
        assert len(synthetic.expected_facts) >= 12
        assert len(synthetic.must_contain) >= 8
        assert len(synthetic.structure["topics"]) == 3
        assert synthetic.structure["min_numbered_items"] >= 3
        assert all(needle in synthetic.input for needle in synthetic.must_contain)
        assert compare.render((PROMPTS / "cleanup_candidate.md").read_text(encoding="utf-8"), synthetic)


@pytest.mark.parametrize("stdout", [
    "{}", '{"type":"turn.failed"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
    '{"type":"turn.completed"}\n{"type":"item.completed","item":{"type":"agent_message","text":"{\\\"text\\\":42}"}}',
])
def test_codex_protocol_rejects_incomplete_failed_and_invalid_replies(stdout):
    with pytest.raises(Exception):
        compare.parse_reply("codex", stdout, compare.CLEANUP_SCHEMA)


class FakeCli:
    model = "fake-subscription"

    def __init__(self, *, judge=False, fail=False):
        self.judge, self.fail, self.calls = judge, fail, []

    async def identify(self):
        return "fake-cli 1"

    async def call(self, instructions, data, schema):
        self.calls.append((instructions, data))
        if self.fail:
            raise TimeoutError("private text must not leak")
        if self.judge:
            payload = json.loads(data)
            assert set(payload) == {"input", "reference", "languages", "required", "required_any",
                                    "expected_facts", "structure", "A", "B"}
            assert "old" not in data and "new" not in data
            winner = "A" if payload["A"].startswith("修復") else "B"
            value = judgment(winner)
            for fact in payload["expected_facts"]:
                value["facts"].append({**fact, "kind": "point"})
                for label in ("A", "B"):
                    value[label]["kept"].append(fact["id"])
            return value, {"latency_ms": 1, "usage": {}}
        text = "修復如下：\n\n1. 看 logs。\n2. 等核准。" if instructions.startswith("new") else "1. 看 logs。\n2. 等核准。"
        return {"text": text}, {"latency_ms": 2, "usage": {}}


async def test_complete_blind_comparison_balances_order_and_writes_private_artifact(tmp_path):
    cleaner, judge = FakeCli(), FakeCli(judge=True)
    cases = [(str(i), case("第一個看 logs 再來等核准"), "") for i in range(4)]
    report = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, tmp_path / "run")
    assert not report["summary"]["ship_candidate"]
    assert [call[0] for call in cleaner.calls] == ["old", "new", "new", "old"] * 2
    assert report["summary"]["wins"]["new"] == 4
    assert json.loads((tmp_path / "run/report.json").read_text(encoding="utf-8")) == report
    assert all("blind_mapping" in r for r in report["rows"])
    assert sum(r["blind_mapping"]["A"] == "new" for r in report["rows"]) == 2


async def test_long_case_expectations_reach_blind_judge_and_summary(tmp_path):
    synthetic = compare.ComparisonCase(**compare.asdict(case("第一個看 logs 再來等核准")),
                                       expected_facts=("Approval must precede sending.",),
                                       structure=structure_expectation())
    judge = FakeCli(judge=True)
    report = await compare.compare([("long", synthetic, "")], {"old": "old", "new": "new"},
                                   FakeCli(), judge, tmp_path / "run")
    payload = json.loads(judge.calls[0][1])
    assert payload["expected_facts"] == [{"id": "required-1", "meaning": "Approval must precede sending."}]
    assert payload["structure"] == synthetic.structure
    assert report["schema_version"] == 3
    assert not report["summary"]["ship_candidate"]
    assert "too_few_numbered_items" in report["summary"]["regressions"][0]["reasons"]
    assert report["summary"]["new"]["scored_structure_cases"] == 1
    assert report["summary"]["structure_wins"] == {"old": 0, "new": 1, "tie": 0}


@pytest.mark.parametrize("field", ["min_numbered_items", "topics"])
def test_malformed_structure_metadata_fails_before_cli(tmp_path, field):
    entry = {"id": "synthetic", "input": "安排東門檢查預算通知", "structure": structure_expectation()}
    entry["structure"][field] = -1
    path = tmp_path / "synthetic.jsonl"
    path.write_text(json.dumps(entry), encoding="utf-8")
    with pytest.raises(Exception):
        compare.read_cases([path])


async def test_timeout_stops_without_retries_and_retains_partial_evidence(tmp_path):
    cleaner = FakeCli(fail=True)
    report = await compare.compare([("a", case("等核准"), ""), ("b", case("先等"), "")],
                                   {"old": "old", "new": "new"}, cleaner, FakeCli(judge=True), tmp_path / "run")
    assert not report["summary"]["complete"]
    assert len(cleaner.calls) == 1
    artifact = (tmp_path / "run/report.json").read_text(encoding="utf-8")
    assert "private text must not leak" not in artifact
    assert report["rows"][0]["stage"] == "old"


async def test_subscription_preflight_failure_keeps_report_and_makes_no_model_call(tmp_path):
    cleaner = FakeCli()

    async def unavailable():
        raise compare.ComparisonError("subscription_login_required")

    cleaner.identify = unavailable
    report = await compare.compare([("a", case("等核准"), "")], {"old": "old", "new": "new"},
                                   cleaner, FakeCli(judge=True), tmp_path / "run")
    assert report["preflight_error_code"] == "subscription_login_required"
    assert not report["summary"]["ship_candidate"]
    assert not cleaner.calls
    assert (tmp_path / "run/report.json").exists()


@pytest.mark.parametrize(("brain", "status"), [
    ("codex", "Logged in using an API key"),
    ("claude", '{"loggedIn":true,"authMethod":"apiKey","apiProvider":"firstParty"}'),
])
async def test_preflight_refuses_api_billing_even_when_cli_is_logged_in(brain, status):
    cli = compare.SubscriptionCli(brain, "fake-model", commands={brain: ["unused"]}, environ={})

    async def execute(command, prompt, cwd):
        return 0, "fake-cli 1" if "--version" in command else status, ""

    cli.runner.execute = execute
    with pytest.raises(compare.ComparisonError, match="subscription_login_required"):
        await cli.identify()


def test_private_loader_preserves_requirements_and_reference_without_cross_file_id_collision(tmp_path):
    paths = []
    for number in range(2):
        path = tmp_path / f"cases{number}.jsonl"
        path.write_text(json.dumps({"id": "same", "input": "嗯收到 Zinnia 的 29 元款項",
                                   "reference": "收到 Zinnia 的 29 元款項。",
                                   "must_contain_ci": ["Zinnia"], "must_not_contain": ["99"]}), encoding="utf-8")
        paths.append(path)
    loaded = compare.read_cases(paths)
    assert [item[0] for item in loaded] == ["0:same", "1:same"]
    assert loaded[0][2] == "收到 Zinnia 的 29 元款項。"
    assert loaded[0][1].must_contain_ci == ["Zinnia"]


def test_main_refuses_output_in_source_tree(tmp_path):
    assert compare.main(["--old", "absent", "--new", "absent", "--out", str(tmp_path / "source")]) == 2


def test_one_command_entry_runs_both_prompts_without_any_api_client(tmp_path, monkeypatch):
    import raphael_core.brain.openrouter as api
    from raphael_core.brain.secrets import CredentialKeyStore

    def forbidden(*args, **kwargs):
        pytest.fail("The comparison must not use API clients or read credentials")

    monkeypatch.setattr(api, "OpenRouterClient", forbidden)
    monkeypatch.setattr(CredentialKeyStore, "get", forbidden)
    selected = []

    def factory(brain, model, **kwargs):
        selected.append((brain, model))
        return FakeCli(judge=brain == "claude")

    monkeypatch.setattr(compare, "SubscriptionCli", factory)
    paths = []
    for name in ("old", "new"):
        path = tmp_path / f"{name}.md"
        path.write_text(name + " {languages} {script_rules} {target_app} {dictionary}", encoding="utf-8")
        paths.append(path)
    corpus = tmp_path / "synthetic.jsonl"
    corpus.write_text(json.dumps({"id": "a", "input": "第一個看 logs 再來等核准"}), encoding="utf-8")
    out = tmp_path / "eval/data/run"
    assert compare.main(["--old", str(paths[0]), "--new", str(paths[1]),
                         "--cases", str(corpus), "--out", str(out)]) == 1
    assert selected == [("codex", "gpt-6-luna"), ("claude", "haiku")]
    assert (out / "summary.md").exists()


@pytest.mark.parametrize("brain", ["codex", "claude"])
async def test_fake_cli_subprocess_uses_subscription_only_isolation(tmp_path, brain):
    script = tmp_path / "fake_cli.py"
    script.write_text('''import json, os, sys
args = sys.argv[1:]
assert not any("API_KEY" in k or "AUTH_TOKEN" in k or "BASE_URL" in k for k in os.environ)
if "--version" in args:
    print("fake-cli 1")
elif "status" in args:
    print(json.dumps({"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty"}) if "auth" in args else "Logged in using ChatGPT")
else:
    assert sys.stdin.read() == "<transcript>synthetic</transcript>"
    if "exec" in args:
        assert "--ignore-user-config" in args and "--ignore-rules" in args
        assert 'forced_login_method="chatgpt"' in args
        assert 'features.shell_tool=false' in args
        assert 'mcp_servers={}' in args
        print(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": json.dumps({"text": "Synthetic."})}}))
        print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 5}}))
    else:
        assert args[args.index("--tools") + 1] == ""
        assert args[args.index("--setting-sources") + 1] == ""
        print(json.dumps({"type": "result", "subtype": "success", "structured_output": {"text": "Synthetic."}}))
''', encoding="utf-8")
    import os
    env = {**os.environ, "OPENAI_API_KEY": "fake-key", "ANTHROPIC_AUTH_TOKEN": "fake-token",
           "ANTHROPIC_BASE_URL": "https://invalid.example", "CLAUDE_CODE_OAUTH_TOKEN": "fake-oauth"}
    cli = compare.SubscriptionCli(brain, "fake-model", commands={brain: [sys.executable, str(script)]}, environ=env)
    assert await cli.identify() == "fake-cli 1"
    value, metadata = await cli.call("Edit synthetic speech.", "<transcript>synthetic</transcript>", compare.CLEANUP_SCHEMA)
    assert value == {"text": "Synthetic."}
    assert metadata["latency_ms"] >= 0


def synthetic_cases(count):
    return [(str(i), case("Keep the review condition."), "") for i in range(count)]


class ScriptedJudge(FakeCli):
    def __init__(self, actions):
        super().__init__(judge=True)
        self.actions = iter(actions)
        self.requests = []

    async def call(self, instructions, data, schema):
        self.requests.append((instructions, data, copy.deepcopy(schema)))
        value, metadata = await super().call(instructions, data, schema)
        action = next(self.actions, "valid")
        if action == "json":
            raise json.JSONDecodeError("private response must not leak", "PRIVATE_INVALID_RESPONSE", 0)
        if action == "schema":
            compare.validate({"PRIVATE_INVALID_RESPONSE": True}, schema)
        if action == "incomplete":
            raise compare.ComparisonError("cli_incomplete")
        if action == "timeout":
            raise TimeoutError("PRIVATE_INVALID_RESPONSE")
        if action == "cancel":
            raise compare.asyncio.CancelledError()
        if action == "partition":
            value["A"]["kept"] = []
        if action == "duplicate":
            value["facts"] *= 2
        if action == "omitted":
            value["facts"] = value["facts"][:1]
            for label in ("A", "B"):
                value[label]["kept"] = ["f1"]
        if action == "regression":
            label = "A" if json.loads(data)["A"].startswith("修復") else "B"
            value[label]["wrong_additions"] = ["An invented action."]
        return value, metadata


@pytest.mark.parametrize("action", ["json", "schema", "incomplete", "partition", "duplicate", "omitted"])
async def test_invalid_judgment_retries_identical_request_once_without_recleaning(tmp_path, capsys, action):
    synthetic = compare.ComparisonCase(**compare.asdict(case("Keep the review condition.")),
                                       expected_facts=("Keep the condition.",))
    cleaner, judge = FakeCli(), ScriptedJudge([action, "valid"])
    report = await compare.compare([("a", synthetic, "")], {"old": "old", "new": "new"},
                                   cleaner, judge, tmp_path / "run")
    assert len(cleaner.calls) == len(judge.calls) == 2
    assert judge.requests[0] == judge.requests[1]
    assert report["summary"]["judge_retries"] == 1
    assert report["summary"]["judge_failed_cases"] == 0
    assert report["summary"]["wins"] == {"old": 0, "new": 1, "tie": 0}
    assert compare.comparison_exit_code(report) == 1
    summary = (tmp_path / "run/summary.md").read_text(encoding="utf-8")
    assert "Judge retries: 1; judge failures: 0" in summary
    assert "Judge retry: a: valid" in summary
    diagnostic = json.dumps(report["rows"][0]["judge_attempts"]) + capsys.readouterr().out + summary
    assert "PRIVATE_INVALID_RESPONSE" not in diagnostic
    assert "private response must not leak" not in diagnostic


@pytest.mark.parametrize(("mutation", "counts"), [
    ("unknown", {"unassigned_count": 1, "unknown_count": 1, "overlap_count": 0}),
    ("overlap", {"unassigned_count": 0, "unknown_count": 0, "overlap_count": 1}),
    ("unassigned", {"unassigned_count": 1, "unknown_count": 0, "overlap_count": 0}),
])
def test_partition_diagnostic_contains_only_side_and_counts(mutation, counts):
    value = judgment()
    if mutation == "unknown":
        value["A"]["kept"] = ["PRIVATE_UNKNOWN_ID"]
    elif mutation == "overlap":
        value["A"]["missing"] = ["f1"]
    else:
        value["A"]["kept"] = []
    with pytest.raises(compare.ComparisonError) as caught:
        compare.validate_judgment(value)
    assert compare.failure_reason(caught.value) == {
        "reason": "incomplete_fact_partition", "details": {"side": "A", **counts}}


async def test_two_invalid_replies_mark_unscored_failure_and_continue(tmp_path):
    cleaner, judge = FakeCli(), ScriptedJudge(["json", "partition", "valid"])
    report = await compare.compare(synthetic_cases(2), {"old": "old", "new": "new"},
                                   cleaner, judge, tmp_path / "run")
    assert len(cleaner.calls) == 4 and len(judge.calls) == 3
    failed, scored = report["rows"]
    assert failed["status"] == "judge_failed" and scored["status"] == "scored"
    assert "winner" not in failed and "scores" not in failed
    assert failed["error_code"] == "incomplete_fact_partition"
    assert report["summary"]["complete"]
    assert report["summary"]["scored_cases"] == 1
    assert report["summary"]["wins"] == {"old": 0, "new": 1, "tie": 0}
    assert report["summary"]["new"]["kept_facts"] == 1
    assert not report["summary"]["ship_candidate"]
    assert compare.comparison_exit_code(report) == 1
    summary = (tmp_path / "run/summary.md").read_text(encoding="utf-8")
    assert "Judge retries: 1; judge failures: 1" in summary
    assert "Judge failed: 0: incomplete_fact_partition" in summary
    assert "Judge retry: 0: invalid incomplete_fact_partition" in summary


@pytest.mark.parametrize("failures", [0, 1, 3, 4])
async def test_fourth_judge_failed_case_stops_but_three_continue(tmp_path, failures):
    cleaner, judge = FakeCli(), ScriptedJudge(["partition"] * (failures * 2))
    report = await compare.compare(synthetic_cases(5), {"old": "old", "new": "new"},
                                   cleaner, judge, tmp_path / "run")
    attempted = 4 if failures == 4 else 5
    assert len(report["rows"]) == attempted
    assert len(cleaner.calls) == attempted * 2
    assert len(judge.calls) == attempted + failures
    assert report["summary"]["judge_failed_cases"] == failures
    assert report["summary"]["judge_retries"] == failures
    assert report["summary"]["wins"]["new"] == attempted - failures
    assert compare.comparison_exit_code(report) == (2 if failures == 4 else 1)


async def test_judge_transport_failure_is_not_retried_and_later_case_runs(tmp_path):
    judge = ScriptedJudge(["timeout", "valid"])
    report = await compare.compare(synthetic_cases(2), {"old": "old", "new": "new"},
                                   FakeCli(), judge, tmp_path / "run")
    assert len(judge.calls) == 2
    assert report["summary"]["judge_retries"] == 0
    assert report["summary"]["judge_failed_cases"] == 1
    assert compare.comparison_exit_code(report) == 1
    assert "PRIVATE_INVALID_RESPONSE" not in json.dumps(report)


async def test_retry_success_still_enforces_every_scored_case_gate(tmp_path):
    report = await compare.compare(synthetic_cases(2), {"old": "old", "new": "new"},
                                   FakeCli(), ScriptedJudge(["json", "regression", "valid"]), tmp_path / "run")
    assert report["summary"]["wins"]["new"] == 2
    assert report["summary"]["judge_failed_cases"] == 0
    assert report["summary"]["regressions"] == [{"case": "0", "reasons": ["wrong_additions"]}]
    assert compare.comparison_exit_code(report) == 1


async def test_complete_resume_preserves_rows_without_preflight_or_model_calls(tmp_path):
    out, cases = tmp_path / "run", synthetic_cases(2)
    first = await compare.compare(cases, {"old": "old", "new": "new"}, FakeCli(), FakeCli(judge=True), out)
    cleaner, judge = FakeCli(), FakeCli(judge=True)

    async def forbidden():
        pytest.fail("A fully scored resume needs no CLI preflight")

    cleaner.identify = judge.identify = forbidden
    resumed = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert resumed["rows"] == first["rows"]
    assert resumed["resume"] == {"reused_scored_rows": 2, "cached_cleanup_outputs": 4}
    assert not cleaner.calls and not judge.calls
    assert compare.comparison_exit_code(resumed) == 1


async def test_failed_judge_resume_reuses_both_cleanups_and_keeps_other_completed_rows(tmp_path):
    out, cases = tmp_path / "run", synthetic_cases(2)
    first = await compare.compare(cases, {"old": "old", "new": "new"},
                                  FakeCli(), ScriptedJudge(["json", "json", "valid"]), out)
    cleaner, judge = FakeCli(), ScriptedJudge(["valid"])
    resumed = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert not cleaner.calls and len(judge.calls) == 1
    assert resumed["rows"][0]["outputs"] == first["rows"][0]["outputs"]
    assert resumed["rows"][1] == first["rows"][1]
    assert resumed["summary"]["judge_failed_cases"] == 0
    assert resumed["summary"]["judge_retries"] == 1
    assert "error" not in resumed["rows"][0]
    assert "judge_failure" not in resumed["rows"][0]
    assert compare.comparison_exit_code(resumed) == 1


async def test_interruption_during_judge_keeps_each_completed_cleanup_checkpoint(tmp_path):
    class InterruptedJudge(FakeCli):
        async def call(self, instructions, data, schema):
            raise compare.asyncio.CancelledError()

    out, cases = tmp_path / "run", synthetic_cases(1)
    cleaner = FakeCli()
    with pytest.raises(compare.asyncio.CancelledError):
        await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, InterruptedJudge(), out)
    checkpoint = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert len(cleaner.calls) == 2
    assert set(checkpoint["rows"][0]["outputs"]) == {"old", "new"}
    cleaner, judge = FakeCli(), FakeCli(judge=True)
    resumed = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert not cleaner.calls and len(judge.calls) == 1
    assert compare.comparison_exit_code(resumed) == 1


async def test_resume_after_first_invalid_reply_uses_only_remaining_retry(tmp_path):
    out, cases = tmp_path / "run", synthetic_cases(1)
    interrupted = ScriptedJudge(["partition", "cancel"])
    with pytest.raises(compare.asyncio.CancelledError):
        await compare.compare(cases, {"old": "old", "new": "new"}, FakeCli(), interrupted, out)
    cleaner, judge = FakeCli(), ScriptedJudge(["partition", "valid"])
    resumed = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert not cleaner.calls and len(judge.calls) == 1
    assert judge.requests[0] == interrupted.requests[0]
    assert resumed["summary"]["judge_failed_cases"] == 1
    assert resumed["summary"]["judge_retries"] == 1
    assert compare.comparison_exit_code(resumed) == 1


async def test_three_unscored_cases_finish_without_wins_or_switch_permission(tmp_path):
    report = await compare.compare(synthetic_cases(3), {"old": "old", "new": "new"},
                                   FakeCli(), ScriptedJudge(["json"] * 6), tmp_path / "run")
    assert report["summary"]["complete"]
    assert report["summary"]["scored_cases"] == 0
    assert report["summary"]["judge_failed_cases"] == 3
    assert report["summary"]["wins"] == {"old": 0, "new": 0, "tie": 0}
    assert not report["summary"]["ship_candidate"]
    assert compare.comparison_exit_code(report) == 1


async def test_cleanup_failure_stops_without_retry_and_resume_only_runs_missing_outputs(tmp_path):
    class FailSecondCleanup(FakeCli):
        async def call(self, instructions, data, schema):
            self.fail = bool(self.calls)
            return await super().call(instructions, data, schema)

    out, cases = tmp_path / "run", synthetic_cases(2)
    cleaner, judge = FailSecondCleanup(), FakeCli(judge=True)
    first = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert len(cleaner.calls) == 2 and not judge.calls
    assert first["summary"]["cleanup_failed_cases"] == 1
    assert compare.comparison_exit_code(first) == 2
    assert set(first["rows"][0]["outputs"]) == {"old"}
    cleaner = FakeCli()
    resumed = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert [request[0] for request in cleaner.calls] == ["new", "new", "old"]
    assert resumed["rows"][0]["outputs"]["old"] == first["rows"][0]["outputs"]["old"]
    assert compare.comparison_exit_code(resumed) == 1


async def test_legacy_interruption_resumes_after_scored_prefix_without_repeating_cached_cleanup(tmp_path):
    out, cases = tmp_path / "run", synthetic_cases(4)
    previous = await compare.compare(cases, {"old": "old", "new": "new"}, FakeCli(), FakeCli(judge=True), out)
    previous["schema_version"] = 2
    previous.pop("case_manifest")
    previous["rows"] = previous["rows"][:3]
    for entry in previous["rows"]:
        entry.pop("status")
        entry.pop("judge_attempts")
    failed = previous["rows"][-1]
    for key in ("winner", "scores", "facts", "reason", "judge"):
        failed.pop(key)
    failed.update(stage="judge", error="ComparisonError", error_code="incomplete_fact_partition")
    (out / "report.json").write_text(json.dumps(previous), encoding="utf-8")
    cleaner, judge = FakeCli(), FakeCli(judge=True)
    resumed = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert len(cleaner.calls) == len(judge.calls) == 2
    assert resumed["rows"][:2] == previous["rows"][:2]
    assert resumed["rows"][2]["outputs"] == failed["outputs"]
    assert resumed["resume"] == {"reused_scored_rows": 2, "cached_cleanup_outputs": 6}
    assert resumed["legacy_resume"] == {"schema_version": 2, "verified_row_ids": 3,
                                         "full_input_fingerprints_available": False}
    assert resumed["rows"][2]["judge_attempts"][0]["legacy"]
    assert resumed["rows"][2]["judge_attempts"][1]["retry"]
    assert resumed["summary"]["judge_retries"] == 1
    assert resumed["case_manifest"] == compare.case_manifest(cases)
    assert compare.comparison_exit_code(resumed) == 1


@pytest.mark.parametrize(("change", "code"), [
    ("prompt", "resume_prompt_hash_mismatch"),
    ("model", "resume_models_mismatch"),
    ("seed", "resume_seed_mismatch"),
    ("rubric", "resume_judge_instructions_sha256_mismatch"),
    ("order", "resume_case_list_mismatch"),
    ("count", "resume_case_list_mismatch"),
    ("content", "resume_case_manifest_mismatch"),
    ("reference", "resume_case_manifest_mismatch"),
    ("unattempted", "resume_case_manifest_mismatch"),
])
async def test_mismatched_resume_refuses_before_calls_or_writes(tmp_path, change, code):
    out, cases = tmp_path / "run", synthetic_cases(2)
    templates = {"old": "old", "new": "new"}
    previous = await compare.compare(cases, templates, FakeCli(), FakeCli(judge=True), out)
    cleaner, judge, seed = FakeCli(), FakeCli(judge=True), 0
    if change == "prompt":
        templates["new"] += " changed"
    elif change == "model":
        cleaner.model = "changed"
    elif change == "seed":
        seed = 1
    elif change == "rubric":
        previous["judge_instructions_sha256"] = "changed"
    elif change == "order":
        cases.reverse()
    elif change == "count":
        cases.pop()
    else:
        key, synthetic, reference = cases[1]
        if change == "reference":
            reference = "Changed reference."
        else:
            synthetic = replace(synthetic, input="Changed condition.")
        cases[1] = (key, synthetic, reference)
        if change == "unattempted":
            previous["rows"] = previous["rows"][:1]
    path = out / "report.json"
    path.write_text(json.dumps(previous), encoding="utf-8")
    before = path.read_bytes()

    async def forbidden():
        pytest.fail("Resume validation must precede CLI preflight")

    cleaner.identify = judge.identify = forbidden
    with pytest.raises(compare.ComparisonError, match=code):
        await compare.compare(cases, templates, cleaner, judge, out, seed=seed)
    assert path.read_bytes() == before
    assert not cleaner.calls and not judge.calls


async def test_existing_folder_without_report_is_never_overwritten(tmp_path):
    out = tmp_path / "run"
    out.mkdir()
    evidence = out / "unrelated.txt"
    evidence.write_text("Keep this evidence.", encoding="utf-8")
    with pytest.raises(compare.ComparisonError, match="output_exists_without_report"):
        await compare.compare(synthetic_cases(1), {"old": "old", "new": "new"},
                              FakeCli(), FakeCli(judge=True), out)
    assert list(out.iterdir()) == [evidence]


@pytest.mark.parametrize(("brain", "stdout", "reason"), [
    ("codex", "[]", "invalid_cli_packet"),
    ("codex", '{"type":"item.completed","item":[]}', "invalid_cli_packet"),
    ("codex", '{"type":"item.completed","item":{"type":"agent_message","text":42}}', "invalid_result_json"),
    ("claude", '{"type":"result","subtype":"success","result":42}', "invalid_result_json"),
])
def test_malformed_cli_envelope_has_safe_retryable_reason(brain, stdout, reason):
    with pytest.raises(compare.ComparisonError) as caught:
        compare.parse_reply(brain, stdout, compare.JUDGE_SCHEMA)
    assert compare.failure_reason(caught.value) == {"reason": reason, "details": {}}
    assert compare.invalid_judge_reply(caught.value)


def calibrated_cases(count=1):
    structure = {"topics": [
        {"id": "logs", "meaning": "Log review", "anchors": ["logs"]},
        {"id": "approval", "meaning": "Approval", "anchors": ["approval"]},
    ], "min_numbered_items": 2, "lead_sentence": True, "paragraphs_per_topic": True}
    synthetic = compare.ComparisonCase(**compare.asdict(case("Check logs then wait for approval.")),
                                       structure=structure)
    return [(str(i), synthetic, "") for i in range(count)]


class CalibratedCleaner(FakeCli):
    async def call(self, instructions, data, schema):
        self.calls.append((instructions, data))
        text = ("Review plan.\n\n1. Check logs.\n\n2. Wait for approval."
                if instructions.startswith("new") else "Check logs then wait for approval.")
        return {"text": text}, {"latency_ms": 1, "usage": {}}


class CalibratedJudge(FakeCli):
    async def call(self, instructions, data, schema):
        self.calls.append((instructions, data))
        payload = json.loads(data)
        good = {label: payload[label].startswith("Review plan.") for label in ("A", "B")}
        value = judgment(next((label for label in good if good[label]), "tie"))
        value["facts"].append({"id": "f2", "kind": "condition", "meaning": "Wait for approval."})
        for label in ("A", "B"):
            inferior = any(good.values()) and not good[label]
            value[label].update(kept=["f1"] if inferior else ["f1", "f2"],
                                missing=["f2"] if inferior else [],
                                wrong_additions=["An unsupported action."] if inferior else [],
                                language_kept=not inferior,
                                structure={key: good[label] for key in compare.STRUCTURE_SCORE["properties"]})
        return value, {"latency_ms": 1, "usage": {}}


async def fake_noise(tmp_path, cases, template="old"):
    return await compare.compare(cases, {"old": template, "new": template},
                                 CalibratedCleaner(), CalibratedJudge(), tmp_path / "control")


async def test_fake_cli_requires_noise_and_passes_only_beyond_all_spreads(tmp_path):
    cases = calibrated_cases()
    noise = await fake_noise(tmp_path, cases)
    without = await compare.compare(cases, {"old": "old", "new": "new"},
                                    CalibratedCleaner(), CalibratedJudge(), tmp_path / "without")
    assert without["summary"]["switch_gate"]["status"] == "noise_required"
    assert compare.comparison_exit_code(without) == 1
    assert "No switch recommendation without --noise" in (tmp_path / "without/summary.md").read_text(encoding="utf-8")
    with_noise = await compare.compare(cases, {"old": "old", "new": "new"},
                                       CalibratedCleaner(), CalibratedJudge(), tmp_path / "with", noise=noise)
    gate = with_noise["summary"]["switch_gate"]
    assert gate["status"] == "passed"
    assert all(metric["improvement"] > metric["noise_spread"] for metric in gate["metrics"].values())
    assert gate["factual_regression_cases"] == gate["noise_factual_regression_cases"] == 0
    assert compare.comparison_exit_code(with_noise) == 0
    summary = (tmp_path / "with/summary.md").read_text(encoding="utf-8")
    assert "Switch gate: passed (noise-v1-strict)" in summary and "Noise spread" in summary
    assert "rows" not in with_noise["noise_calibration"]


async def test_noise_threshold_is_strict_and_perfect_language_ties_are_not_exempt(tmp_path):
    cases = calibrated_cases()
    noise = await fake_noise(tmp_path, cases)
    noise["rows"][0]["scores"]["old"]["wrong_additions"] = ["Control-only action."]
    noise["summary"]["old"]["wrong_additions"] = 999  # Must recompute from rows.
    report = await compare.compare(cases, {"old": "old", "new": "new"},
                                   CalibratedCleaner(), CalibratedJudge(), tmp_path / "run", noise=noise)
    gate = report["summary"]["switch_gate"]
    assert gate["metrics"]["wrong_additions"] == {
        "old": 1, "new": 0, "improvement": 1, "noise_spread": 1, "passed": False}
    assert compare.comparison_exit_code(report) == 1
    rows = copy.deepcopy(report["rows"])
    rows[0]["scores"]["old"]["language_kept"] = True
    summary = compare.summarize(rows, 1, noise=report["noise_calibration"])
    assert summary["switch_gate"]["metrics"]["language_kept_cases"] == {
        "old": 1, "new": 1, "improvement": 0, "noise_spread": 0, "passed": False}
    assert not summary["ship_candidate"]


async def test_noise_allows_case_regressions_only_up_to_control_count(tmp_path):
    cases = calibrated_cases(3)
    noise = await fake_noise(tmp_path, cases)
    report = await compare.compare(cases, {"old": "old", "new": "new"},
                                   CalibratedCleaner(), CalibratedJudge(), tmp_path / "run", noise=noise)
    rows = copy.deepcopy(report["rows"])
    rows[0]["scores"]["new"].update(kept=["f2"], missing=["f1"], wrong_additions=["An unsupported action."])
    failed = compare.summarize(rows, 3, noise=report["noise_calibration"])
    assert compare.factual_regressions(failed) == 1  # Both reasons on one case count once.
    assert all(metric["passed"] for metric in failed["switch_gate"]["metrics"].values())
    assert failed["switch_gate"]["reasons"] == ["factual_regressions_above_noise"]
    noise["rows"][0]["scores"]["new"]["wrong_additions"] = ["Control-only action."]
    calibration = compare.calibrate_noise(noise, report)
    passed = compare.summarize(rows, 3, noise=calibration)
    assert passed["switch_gate"]["factual_regression_cases"] == 1
    assert passed["switch_gate"]["noise_factual_regression_cases"] == 1
    assert passed["regressions"] and passed["ship_candidate"]


@pytest.mark.parametrize(("change", "code"), [
    ("different_prompts", "noise_requires_identical_prompts"),
    ("wrong_baseline", "noise_baseline_prompt_mismatch"),
    ("models", "noise_models_mismatch"),
    ("seed", "noise_seed_mismatch"),
    ("judge_instructions_sha256", "noise_judge_instructions_sha256_mismatch"),
    ("case_manifest", "noise_case_manifest_mismatch"),
    ("incomplete", "noise_incomplete"),
    ("failed_judge", "noise_incomplete"),
    ("invalid", "noise_report_invalid"),
])
async def test_invalid_noise_refuses_before_output_or_cli_calls(tmp_path, change, code):
    cases = calibrated_cases()
    noise = await fake_noise(tmp_path, cases)
    if change == "different_prompts":
        noise["prompts"]["new"]["sha256"] = "changed"
    elif change == "wrong_baseline":
        for label in ("old", "new"):
            noise["prompts"][label]["sha256"] = "changed"
    elif change == "incomplete":
        noise["summary"]["complete"] = False
    elif change == "failed_judge":
        noise["rows"][0]["status"] = "judge_failed"
    elif change == "invalid":
        noise = {}
    else:
        noise[change] = "changed"
    cleaner, judge = CalibratedCleaner(), CalibratedJudge()

    async def forbidden():
        pytest.fail("Noise validation must precede preflight")

    cleaner.identify = judge.identify = forbidden
    out = tmp_path / "run"
    with pytest.raises(compare.ComparisonError, match=code):
        await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out, noise=noise)
    assert not cleaner.calls and not judge.calls and not out.exists()


async def test_completed_resume_can_recompute_gate_without_model_calls(tmp_path):
    cases = calibrated_cases()
    noise = await fake_noise(tmp_path, cases)
    out = tmp_path / "run"
    first = await compare.compare(cases, {"old": "old", "new": "new"},
                                  CalibratedCleaner(), CalibratedJudge(), out)
    cleaner, judge = CalibratedCleaner(), CalibratedJudge()
    resumed = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out, noise=noise)
    assert resumed["rows"] == first["rows"] and not cleaner.calls and not judge.calls
    assert compare.comparison_exit_code(resumed) == 0
    without = await compare.compare(cases, {"old": "old", "new": "new"}, cleaner, judge, out)
    assert without["noise_calibration"] is None
    assert compare.comparison_exit_code(without) == 1


async def test_judge_failed_case_cannot_authorize_switch_even_with_aggregate_gains(tmp_path):
    cases = calibrated_cases(3)
    noise = await fake_noise(tmp_path, cases)
    report = await compare.compare(cases, {"old": "old", "new": "new"},
                                   CalibratedCleaner(), CalibratedJudge(), tmp_path / "run", noise=noise)
    rows = copy.deepcopy(report["rows"])
    rows[-1] = {"case": rows[-1]["case"], "status": "judge_failed", "error_code": "invalid_json"}
    summary = compare.summarize(rows, 3, noise=report["noise_calibration"])
    assert all(metric["passed"] for metric in summary["switch_gate"]["metrics"].values())
    assert "incomplete_evidence" in summary["switch_gate"]["reasons"]
    assert not summary["ship_candidate"]


def test_noise_option_runs_through_cli_with_fake_clients_only(tmp_path, monkeypatch):
    fields = " {languages} {script_rules} {target_app} {dictionary}"
    templates = {label: label + fields for label in ("old", "new")}
    prompt_paths = {}
    for label, template in templates.items():
        prompt_paths[label] = tmp_path / (label + ".md")
        prompt_paths[label].write_text(template, encoding="utf-8")
    corpus = tmp_path / "synthetic.jsonl"
    _, synthetic, _ = calibrated_cases()[0]
    corpus.write_text(json.dumps(compare.asdict(synthetic)) + "\n", encoding="utf-8")
    cases = compare.read_cases([corpus])
    noise = compare.asyncio.run(fake_noise(tmp_path, cases, templates["old"]))
    control = tmp_path / "noise.json"
    control.write_text(json.dumps(noise), encoding="utf-8")
    monkeypatch.setattr(compare, "SubscriptionCli", lambda brain, model, **kwargs:
                        CalibratedCleaner() if brain == "codex" else CalibratedJudge())
    out = tmp_path / "eval/data/run"
    assert compare.main(["--old", str(prompt_paths["old"]), "--new", str(prompt_paths["new"]),
                         "--cases", str(corpus), "--out", str(out), "--noise", str(control)]) == 0
    result = json.loads((out / "report.json").read_text(encoding="utf-8"))
    assert result["summary"]["ship_candidate"]
