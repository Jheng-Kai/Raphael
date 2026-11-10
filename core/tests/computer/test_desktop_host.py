"""Host startup uses fake processes only; never launch Docker Desktop."""

import asyncio
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import desktop_host
from raphael_core.computer.desktop_host import DockerDesktop, engine_pipe_missing


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


@pytest.fixture
def docker_config(tmp_path, monkeypatch):
    """A Windows PC whose docker CLI uses Docker Desktop's own context; the pipe list is a fake."""
    (tmp_path / "config.json").write_text('{"currentContext": "desktop-linux"}', encoding="utf-8")
    monkeypatch.setattr(desktop_host.sys, "platform", "win32")
    monkeypatch.setenv("DOCKER_CONFIG", str(tmp_path))
    monkeypatch.delenv("DOCKER_HOST", raising=False)
    monkeypatch.delenv("DOCKER_CONTEXT", raising=False)
    return tmp_path


def test_a_missing_docker_desktop_pipe_answers_down_without_asking_docker(docker_config, monkeypatch):
    monkeypatch.setattr(desktop_host.os, "listdir", lambda path: ["mojo.1", "docker_cli"])
    assert engine_pipe_missing() is True
    monkeypatch.setattr(desktop_host.os, "listdir", lambda path: ["mojo.1", "dockerDesktopLinuxEngine"])
    assert engine_pipe_missing() is False


@pytest.mark.parametrize("doubt", ["host", "context", "other_context", "no_config", "list_fails", "not_windows"])
def test_any_doubt_leaves_the_decision_to_docker_info(docker_config, monkeypatch, doubt):
    monkeypatch.setattr(desktop_host.os, "listdir", lambda path: ["mojo.1"])
    if doubt == "host":
        monkeypatch.setenv("DOCKER_HOST", "tcp://sample-host:2375")
    elif doubt == "context":
        monkeypatch.setenv("DOCKER_CONTEXT", "sample")
    elif doubt == "other_context":
        (docker_config / "config.json").write_text('{"currentContext": "default"}', encoding="utf-8")
    elif doubt == "no_config":
        (docker_config / "config.json").unlink()
    elif doubt == "list_fails":
        def fail(path):
            raise OSError()
        monkeypatch.setattr(desktop_host.os, "listdir", fail)
    else:
        monkeypatch.setattr(desktop_host.sys, "platform", "linux")
    assert engine_pipe_missing() is False


async def test_the_engine_check_skips_the_docker_call_when_the_pipe_is_missing(tmp_path, monkeypatch):
    from raphael_core.computer.vm import LocalVm
    vm = LocalVm(tmp_path)  # No injected runner: the real transport, whose Docker call must not be made.
    called = []
    async def run(args, **kwargs):
        called.append(args)
        raise AssertionError("docker must not be asked")
    vm.run = run
    monkeypatch.setattr(desktop_host, "engine_pipe_missing", lambda: True)
    assert await vm.available() is False and called == []
