"""Owner engine recovery and state diagnosis use fake Docker and fake launchers only."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
from dataclasses import replace

import pytest

from raphael_core.computer.vm import LocalVm, VmError
from raphael_core.computer.viewer import DesktopViewer
from raphael_core.protocol import RpcError


@pytest.mark.parametrize('installed,expected', [(True, 'docker_stopped'), (False, 'docker_missing')])
async def test_local_preflight_distinguishes_installation_from_stopped_engine(tmp_path, installed, expected):
    desktop = SimpleNamespace(installed=lambda: installed, start=AsyncMock())
    vm = LocalVm(tmp_path, runner=AsyncMock())
    vm.desktop = desktop
    vm.available = AsyncMock(return_value=False)
    assert (await vm.status(vm.target()))['error'] == expected
    desktop.start.assert_not_awaited()


async def test_granted_member_use_never_starts_the_host_engine_implicitly(tmp_path):
    desktop = SimpleNamespace(installed=lambda: True, start=AsyncMock())
    vm = LocalVm(tmp_path, runner=AsyncMock())
    vm.desktop = desktop
    vm.available = AsyncMock(return_value=False)
    with pytest.raises(VmError, match='docker_stopped'):
        await vm.ensure_engine(vm.target())
    desktop.start.assert_not_awaited()


async def test_owner_start_uses_existing_wait_and_clears_engine_progress(tmp_path):
    desktop = SimpleNamespace(installed=lambda: True, start=AsyncMock())
    vm = LocalVm(tmp_path, runner=AsyncMock())
    vm.desktop = desktop
    vm.available = AsyncMock(side_effect=[False, False, True])
    viewer = DesktopViewer(vm)
    viewer.unwatched_status = AsyncMock(return_value={'state':'missing', 'ready':False, 'image':True})
    try:
        result = await viewer.status({'start_docker':True, 'host':'', 'member_id':0})
        assert result['state'] == 'missing'
        assert vm.available.await_count == 3
        desktop.start.assert_awaited_once()
        assert not vm.preparation
    finally:
        await viewer.aclose()


async def test_remote_start_refuses_before_any_local_launcher_or_engine_wait(tmp_path):
    desktop = SimpleNamespace(installed=lambda: True, start=AsyncMock())
    vm = LocalVm(tmp_path, runner=AsyncMock())
    vm.desktop = desktop
    target = replace(vm.target(), remote='sample-host')
    vm.target = lambda member=0: target
    vm.available = AsyncMock(return_value=False)
    viewer = DesktopViewer(vm)
    try:
        assert (await vm.status(target))['error'] == 'remote_unavailable'
        vm.available.reset_mock()
        with pytest.raises(RpcError, match='only be started on this PC'):
            await viewer.status({'start_docker':True, 'host':'sample-host'})
        vm.available.assert_not_awaited()
        desktop.start.assert_not_awaited()
    finally:
        await viewer.aclose()


async def test_failed_owner_launch_does_not_leave_a_permanent_starting_state(tmp_path):
    desktop = SimpleNamespace(installed=lambda: True, start=AsyncMock(side_effect=OSError()))
    vm = LocalVm(tmp_path, runner=AsyncMock())
    vm.desktop = desktop
    vm.available = AsyncMock(return_value=False)
    viewer = DesktopViewer(vm)
    try:
        with pytest.raises(VmError, match='docker_start_failed'):
            await viewer.status({'start_docker':True, 'host':''})
        assert not vm.preparation
    finally:
        await viewer.aclose()


async def test_library_handles_open_only_the_captured_members_local_roots(tmp_path):
    vm = LocalVm(tmp_path, runner=AsyncMock())
    target = vm.target(1)
    target.workspace.mkdir(parents=True, exist_ok=True)
    found = target.workspace / 'sample.md'
    found.write_text('sample')
    viewer = DesktopViewer(vm, member_exists=lambda member: member == 1)
    try:
        assert (await viewer.team_file({'path':'member-file:1:workspace:sample.md'})) == {'path':str(found), 'reads':True}
        for handle in ('member-file:0:workspace:sample.md', 'member-file:1:workspace:../outside.md', 'member-file:1:workspace:C:/outside.md'):
            with pytest.raises(RpcError):
                await viewer.team_file({'path':handle})
        vm.target = lambda member=0: replace(target, remote='sample-host')
        with pytest.raises(RpcError):
            await viewer.team_file({'path':'member-file:1:workspace:sample.md'})
    finally:
        await viewer.aclose()
