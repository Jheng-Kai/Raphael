"""Host startup uses fake processes only; never launch Docker Desktop."""

import asyncio
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer.desktop_host import DockerDesktop


@pytest.fixture
def host(monkeypatch):
    desktop = DockerDesktop()
    monkeypatch.setattr(desktop, "executable", lambda: Path("Docker Desktop.exe"))
    monkeypatch.setattr("raphael_core.computer.desktop_host.shutil.which", lambda name: "docker.exe")
    return desktop


def process(code=0, stderr=b""):
    return type("Process", (), {"returncode": code, "wait": AsyncMock(return_value=code),
                               "communicate": AsyncMock(return_value=(b"", stderr))})()


async def test_start_prefers_detached_cli_without_a_window(host, monkeypatch):
    monkeypatch.setattr('raphael_core.computer.desktop_host.sys.platform', 'linux')
    spawn = AsyncMock(side_effect=[process(), process()])
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    await host.start()
    args, options = spawn.call_args
    assert args == ("docker.exe", "desktop", "start", "--detach")
    assert options == dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
    assert all("Docker Desktop.exe" not in call.args for call in spawn.call_args_list)


@pytest.mark.parametrize("diagnostic", [
    b"docker: 'desktop' is not a docker command.\nSee 'docker --help'",
    b'unknown command "desktop" for "docker"',
    b"docker: unknown command: docker desktop\nRun 'docker --help' for more information",
])
async def test_old_cli_falls_back_only_for_missing_desktop_command(host, monkeypatch, diagnostic):
    monkeypatch.setattr('raphael_core.computer.desktop_host.sys.platform', 'linux')
    spawn = AsyncMock(side_effect=[process(1, diagnostic), process()])
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    await host.start()
    assert spawn.call_args.args == ("Docker Desktop.exe",)
    assert spawn.call_args_list[0].args == ("docker.exe", "desktop", "start", "--help")
    assert spawn.call_args.kwargs["creationflags"] == subprocess.CREATE_NO_WINDOW
    await asyncio.sleep(0)


async def test_general_cli_error_does_not_open_gui(host, monkeypatch):
    monkeypatch.setattr('raphael_core.computer.desktop_host.sys.platform', 'linux')
    spawn = AsyncMock(return_value=process(1, b"permission denied"))
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(OSError, match="docker_start_failed"):
        await host.start()
    assert spawn.await_count == 1


async def test_missing_cli_uses_installed_gui(host, monkeypatch):
    monkeypatch.setattr("raphael_core.computer.desktop_host.shutil.which", lambda name: None)
    monkeypatch.setattr(Path, "is_file", lambda path: False)
    spawn = AsyncMock(return_value=process())
    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    assert host.installed()
    await host.start()
    assert spawn.call_args.args == ("Docker Desktop.exe",)
    await asyncio.sleep(0)


def test_cli_installation_is_found_outside_path(host, monkeypatch, tmp_path):
    monkeypatch.setenv("ProgramFiles", str(tmp_path))
    cli = tmp_path / "Docker/Docker/resources/bin/docker.exe"
    cli.parent.mkdir(parents=True)
    cli.touch()
    monkeypatch.setattr("raphael_core.computer.desktop_host.shutil.which", lambda name: None)
    monkeypatch.setattr(host, "executable", lambda: None)
    assert host.installed()
    assert host.cli() == cli


async def test_windows_owner_launch_uses_installed_executable_without_shell(host, monkeypatch):
    spawn = AsyncMock(return_value=process())
    monkeypatch.setattr('raphael_core.computer.desktop_host.sys.platform', 'win32')
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    await host.start()
    assert spawn.call_args.args == ('Docker Desktop.exe',)
    assert 'shell' not in spawn.call_args.kwargs
    await asyncio.sleep(0)


async def test_macos_owner_launch_uses_installed_docker_app(host, monkeypatch):
    spawn = AsyncMock(return_value=process())
    monkeypatch.setattr('raphael_core.computer.desktop_host.sys.platform', 'darwin')
    monkeypatch.setattr(Path, 'is_dir', lambda path: path.as_posix() == '/Applications/Docker.app')
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    await host.start()
    assert spawn.call_args.args == ('/usr/bin/open', '-a', '/Applications/Docker.app')
    assert 'creationflags' not in spawn.call_args.kwargs
    await asyncio.sleep(0)
