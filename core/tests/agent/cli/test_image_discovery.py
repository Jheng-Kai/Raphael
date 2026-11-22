import pytest

from raphael_core.agent.cli import discovery


@pytest.mark.parametrize(("pathext", "chosen"), [
    (".EXE;.CMD;.PS1", "command"),
    (".PS1;.CMD;.EXE", "powershell"),
])
@pytest.mark.parametrize("on_path", [False, True])
def test_windows_npm_discovery_uses_pathext_with_a_lean_path(tmp_path, monkeypatch, pathext, chosen, on_path):
    npm = tmp_path / "npm"
    npm.mkdir()
    (npm / "codex").write_text("#!/bin/sh\n", encoding="utf-8")
    for entry in ("command", "powershell"):
        (npm / f"{entry}.js").touch()
    (npm / "codex.cmd").write_text('@node "%~dp0\\command.js" %*', encoding="utf-8")
    (npm / "codex.ps1").write_text('& node "$basedir/powershell.js" $args', encoding="utf-8")
    node = tmp_path / "node.exe"
    node.touch()
    monkeypatch.setattr(discovery.sys, "platform", "win32")
    monkeypatch.setattr(discovery, "_registered_windows_node", lambda: str(node))
    brains = discovery.CliBrains(home=tmp_path, environ={
        "APPDATA": str(tmp_path), "PATH": str(npm) if on_path else "", "PATHEXT": pathext,
    })
    assert brains.command("codex") == [str(node), str(npm / f"{chosen}.js")]

    monkeypatch.setattr(discovery, "_registered_windows_node", lambda: None)
    brains.invalidate("codex")
    assert brains.command("codex") is None
