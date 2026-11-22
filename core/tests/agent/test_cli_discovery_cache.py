"""Executable/version discovery is bounded, but login eligibility stays live."""

import threading

import pytest

from raphael_core.agent.cli import discovery
from raphael_core.agent.cli.discovery import CliBrains


async def test_executable_and_version_cache_expires_and_keeps_auth_fresh(tmp_path, monkeypatch):
    now, found, probes = [0.0], [], []
    script = tmp_path / "fake-cli"
    script.touch()
    monkeypatch.setattr(discovery, "_path_candidates", lambda name, environ: found.append(name) or [script])
    monkeypatch.setattr(discovery, "resolve_command", lambda path, environ: [str(path)])
    brains = CliBrains(home=tmp_path, environ={}, clock=lambda: now[0])
    monkeypatch.setattr(brains, "_needs_models", lambda name: False)

    async def version(name, command):
        probes.append(name)
        return {"version": "synthetic 1.0"}

    monkeypatch.setattr(brains, "_read_version", version)
    try:
        first = await brains.list()
        (tmp_path / ".codex").mkdir()
        (tmp_path / ".codex" / "auth.json").touch()
        second = await brains.list()
        assert first["clis"][1]["logged_in"] is False and second["clis"][1]["logged_in"] is True
        assert len(found) == len(probes) == 3
        now[0] = 61
        await brains.list()
        assert len(found) == len(probes) == 6
        brains.disconnect("codex")
        await brains.list()
        assert len(found) == len(probes) == 7
        assert brains.login("codex") == {"started": False, "reconnected": True}
        await brains.list()
        assert len(found) == len(probes) == 8
    finally:
        await brains.aclose()


async def test_cold_discovery_runs_off_the_event_loop_and_missing_commands_are_cached(tmp_path, monkeypatch):
    threads = []
    main = threading.get_ident()
    brains = CliBrains(home=tmp_path, environ={})
    monkeypatch.setattr(brains, "_needs_models", lambda name: False)
    monkeypatch.setattr(discovery, "_path_candidates", lambda *args: threads.append(threading.get_ident()) or [])
    try:
        await brains.list()
        await brains.list()
        assert len(threads) == 3 and all(thread != main for thread in threads)
    finally:
        await brains.aclose()


async def test_newly_available_cli_fills_the_answer_and_quick_questions_but_never_the_tidying(conn, tmp_path, monkeypatch):
    from raphael_core.brain.settings import SettingsStore
    settings = SettingsStore(conn)
    notices = []
    brains = CliBrains(home=tmp_path, commands={"codex": ["synthetic"]}, settings=settings,
                       notify=lambda method, params: notices.append((method, params)))
    monkeypatch.setattr(brains, "logged_in", lambda name: name == "codex")
    monkeypatch.setattr(brains, "_needs_models", lambda name: False)
    async def version(*args):
        return {}
    monkeypatch.setattr(brains, "_read_version", version)
    brains._models["codex"] = [{"id": "cli:codex:mini"}, {"id": "cli:codex:large", "is_default": True}]
    try:
        await brains.list()
        await brains.list()
        assert settings.get("agent_model") == "cli:codex:large"
        assert settings.get("quick_model") == "cli:codex:mini"
        assert settings.get("cleanup_model") == settings.get("stt_cloud_model") == ""
        assert notices == [("models.filled", {"source": "Codex CLI", "roles": ["answer", "quick"]})]
    finally:
        await brains.aclose()
