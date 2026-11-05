"""The approved transport and private-page hardening, using fake SSH and drivers."""

import asyncio

import pytest

from raphael_core.computer import remote_host
from raphael_core.computer.remote_host import RemoteSession
from raphael_core.computer.vm_tools import vm_scope
from .test_login_visibility import Browser, rig
from .test_vm import desktop


@pytest.mark.parametrize("available", [True, False])
async def test_docker_forward_is_private_or_falls_back_without_a_tcp_listener(tmp_path, monkeypatch, available):
    launches = []
    class Process:
        returncode = None
        def kill(self): self.returncode = -1
        async def wait(self): return self.returncode
    async def launch(*args, **kwargs):
        launches.append(args)
        return Process()
    class Writer:
        def write(self, data): pass
        async def drain(self): pass
        def close(self): pass
        async def wait_closed(self): pass
    class Reader:
        async def read(self, size): return b"HTTP/1.0 200 OK\r\n\r\nOK"
    async def connect(*args): return Reader(), Writer()
    monkeypatch.setattr(asyncio, "open_connection", connect)
    session = RemoteSession("test-host", launch=launch)
    session._socket_path = lambda: tmp_path / "docker.sock"
    async def probe(endpoint): return available
    session._probe = probe
    try:
        endpoint = await session.endpoint()
        assert endpoint == (f"unix://{(tmp_path / 'docker.sock').as_posix()}" if available else None)
        assert all("127.0.0.1:" not in arg and "-D" not in arg for args in launches for arg in args)
        assert all(args[args.index("-L") + 1].endswith("docker.sock:/var/run/docker.sock") for args in launches)
        assert bool(session.process) == available
    finally:
        await session.close()


@pytest.mark.parametrize("change", ["same-origin", "time", "other-tab", "different-origin-fields-remain", "different-origin-clear", "different-origin-incomplete", "different-origin-unknown", "unreadable"])
async def test_private_page_requires_changed_origin_and_absent_fields(desktop, tmp_path, monkeypatch, change):
    hub, tools, reference = await rig(desktop, tmp_path)
    original = Browser.request
    async def request(self, method, params=None):
        data = await original(self, method, params)
        if method != "tools/list":
            if change != "different-origin-unknown":
                data["structuredContent"]["truncated"] = change == "different-origin-incomplete"
            data["structuredContent"]["nodes"] = [] if change in ("different-origin-clear", "different-origin-incomplete", "different-origin-unknown") else [
                {"ref": "u", "role": "textbox", "value": "sensitive display value"}, {"ref": "p", "role": "textbox"}]
        return data
    monkeypatch.setattr(Browser, "request", request)
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(tools["fill_login"], {"reference": reference, "site": "https://example.com",
            "target_id": "tab", "username_ref": "u", "password_ref": "p"}, approver="auto")).ok
        args = {"target_id": "tab"}
        if change == "same-origin": Browser.url = "https://example.com/done"
        elif change == "time": hub.vm.clock = lambda: 1000000
        elif change == "other-tab": args["target_id"] = "other"
        elif change.startswith("different-origin"): Browser.url = "https://other.example/done"
        elif change == "unreadable":
            async def broken(*args): raise OSError("offline")
            monkeypatch.setattr(hub, "_connection", broken)
        result = await hub.call(tools["get_browser_state"], args, approver="auto")
        if change == "different-origin-clear":
            assert not result.blocks
            assert (await hub.call(tools["get_browser_state"], args, approver="auto")).blocks
        elif change != "unreadable":
            assert not result.blocks
            assert "Private fields are hidden" in result.text
            assert "sensitive display value" not in result.text
        else:
            assert not result.blocks and hub.private_pages
    await hub.aclose()


async def test_read_revocation_does_not_probe_or_return_a_private_tree(desktop, tmp_path, monkeypatch):
    hub, tools, _ = await rig(desktop, tmp_path)
    original = Browser.request
    async def revoke(self, method, params=None):
        data = await original(self, method, params)
        if method == "tools/call" and params["name"] == "get_browser_state":
            hub.vm.grants.set(0, False)
        return data
    monkeypatch.setattr(Browser, "request", revoke)
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tools["get_browser_state"], {"target_id": "tab"}, approver="auto")
        assert not result.ok and result.kind == "computer_permission_required" and not result.blocks
    await hub.aclose()


async def test_unsupported_socket_transport_uses_ssh_for_each_command(desktop, monkeypatch, tmp_path):
    from dataclasses import replace
    vm, target, runtime = desktop
    target = replace(target, remote="test-host")
    vm.real_transport = True
    session = RemoteSession("test-host")
    def unsupported(): raise OSError("AF_UNIX not supported")
    session._socket_path = unsupported
    vm.remote_sessions["test-host"] = session
    for _ in range(3):
        assert await vm.transport(target) == ["--host", "ssh://test-host"]
    assert session.process is None
    await vm.aclose()


async def test_private_socket_directory_is_restricted_and_cleaned(tmp_path, monkeypatch):
    secured = []
    folder = tmp_path / "ssh-private"
    folder.mkdir()
    monkeypatch.setattr(remote_host.tempfile, "mkdtemp", lambda **kwargs: str(folder))
    monkeypatch.setattr(remote_host, "owner_only_directory", lambda path: secured.append(path))
    session = RemoteSession("test-host")
    assert session._socket_path() == folder / "docker.sock"
    assert secured == [folder]
    (folder / "docker.sock").write_bytes(b"")
    await session.close()
    assert not folder.exists()


async def test_viewer_uses_owned_ssh_pipes_without_a_socks_listener():
    launches = []
    class Input:
        def write(self, data): pass
        async def drain(self): pass
        def close(self): pass
    class Process:
        returncode = None
        stdout, stdin = object(), Input()
        def kill(self): self.returncode = -1
        async def wait(self): return self.returncode
    process = Process()
    async def launch(*args, **kwargs):
        launches.append((args, kwargs))
        return process
    session = RemoteSession("test-host", launch=launch)
    reader, writer = await session.connect_viewer("172.17.0.2")
    assert reader is process.stdout
    args = launches[0][0]
    assert args[args.index("-W") + 1] == "172.17.0.2:6901"
    assert "-D" not in args and "-L" not in args
    writer.close()
    await writer.wait_closed()
    assert process.returncode == -1
    with pytest.raises(ValueError):
        await session.connect_viewer("8.8.8.8")
    assert len(launches) == 1


async def test_navigation_after_capture_cannot_release_the_captured_private_picture(desktop, tmp_path, monkeypatch):
    hub, tools, reference = await rig(desktop, tmp_path)
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(tools["fill_login"], {"reference": reference, "site": "https://example.com",
            "target_id": "tab", "username_ref": "u", "password_ref": "p"}, approver="auto")).ok
        original = Browser.request
        async def navigate_after_capture(self, method, params=None):
            data = await original(self, method, params)
            if method != "tools/list":
                data["structuredContent"].update(nodes=[], truncated=False)
                # The returned pixels precede navigation. The subsequent safety probe sees a safe page.
                Browser.url = "https://other.example/done"
            return data
        monkeypatch.setattr(Browser, "request", navigate_after_capture)
        first = await hub.call(tools["get_browser_state"], {"target_id": "tab"}, approver="auto")
        assert not first.blocks
        assert (await hub.call(tools["get_browser_state"], {"target_id": "tab"}, approver="auto")).blocks
    await hub.aclose()
