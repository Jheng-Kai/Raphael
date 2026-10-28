"""Native diagnostic opt-in and redaction never require real credentials or a CLI."""

import asyncio
import json
import sys
from types import SimpleNamespace

from raphael_core.agent.cli import native_diagnostics as diagnostics
from raphael_core.agent.cli.drivers import Driver, codex_home
from raphael_core.agent.cli.process import Child


def opt_in(monkeypatch, tmp_path):
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    monkeypatch.setenv("RAPHAEL_FAKE_LLM", "1")
    monkeypatch.setenv("RAPHAEL_DATA_DIR", str(tmp_path / "data"))


def test_diagnostics_are_absent_without_native_opt_in_and_in_packaged_core(monkeypatch, tmp_path, caplog):
    opt_in(monkeypatch, tmp_path)
    monkeypatch.delenv("RAPHAEL_TEST_NATIVE")
    diagnostics.capture("error", "private diagnostic")
    assert Child(["unused"]).stderr_tail is None
    assert diagnostics.directory("workspaces") is None
    monkeypatch.setenv("RAPHAEL_TEST_NATIVE", "1")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    diagnostics.capture("error", "private diagnostic")
    assert Child(["unused"]).stderr_tail is None
    assert "private diagnostic" not in caplog.text


def test_redaction_preserves_cause_but_never_credentials(monkeypatch, tmp_path, caplog):
    opt_in(monkeypatch, tmp_path)
    diagnostics.capture("event", {"message": "403 forbidden; Bearer short-token; access_token='another-secret'; https://example.com/oauth?state=secret; known-short; " + "X" * 80,
                                  "tokens": {"access_token": "hidden"}, "details": "sandbox unavailable"}, ["known-short"])
    assert "403 forbidden" in caplog.text and "sandbox unavailable" in caplog.text
    for secret in ["short-token", "another-secret", "known-short", "hidden", "state=secret", "X" * 80]:
        assert secret not in caplog.text


async def test_stderr_tail_is_bounded_and_error_event_is_redacted(monkeypatch, tmp_path, caplog):
    opt_in(monkeypatch, tmp_path)
    child = Child(["unused"])
    stream = asyncio.StreamReader()
    stream.feed_data(b"x" * 20000 + b"\npermission denied; Bearer synthetic-token\n")
    stream.feed_eof()
    child.process = SimpleNamespace(stderr=stream)
    await child._drain()
    assert len(child.stderr_tail) <= 16384 and b"permission denied" in child.stderr_tail
    driver = Driver("codex", ["unused"])
    packet = {"method": "error", "params": {"error": {"message": "invalid model; Bearer synthetic-token"}}}
    stdout = asyncio.StreamReader()
    stdout.feed_data((json.dumps(packet) + "\n").encode())
    driver.child = SimpleNamespace(process=SimpleNamespace(stdout=stdout))
    assert await driver._read() == packet
    driver.native_diagnostic("stderr-tail", child.stderr_tail.decode())
    assert "invalid model" in caplog.text and "permission denied" in caplog.text
    assert "synthetic-token" not in caplog.text


async def test_native_codex_state_stays_in_run_while_login_source_stays_owner(monkeypatch, tmp_path):
    opt_in(monkeypatch, tmp_path)
    owner = tmp_path / "owner"
    (owner / ".codex").mkdir(parents=True)
    auth = owner / ".codex" / "auth.json"
    original = json.dumps({"tokens": {"access_token": "synthetic-access", "id_token": "synthetic-id", "refresh_token": "never-copy"}})
    auth.write_text(original)
    home, environ, borrowed = await codex_home(tmp_path / "workspace", {}, owner=owner)
    assert home.is_relative_to(tmp_path / "data" / "cli")
    assert environ["CODEX_HOME"] == str(home)
    assert borrowed["tokens"]["access_token"] == "synthetic-access"
    assert borrowed["tokens"]["refresh_token"] == ""
    assert auth.read_text() == original
    assert not (owner / ".raphael").exists()
