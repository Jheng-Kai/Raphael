"""Seat-only owner observations and in-memory relay input routing."""

import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.computer import rfb_view, teaching, viewer_relay
from raphael_core.computer.viewer import DesktopViewer, Session
from .test_seat_tools import SeatBridge, seat_tools, window
from .test_seat_wiring import shared_vm


def recorder_for(vm, target):
    viewer = DesktopViewer(vm)
    viewer.sessions['owner'] = Session(target, vm.clock() + 30, connection=(123, 'private'))
    viewer.owners[target.key] = 'owner'
    return teaching.Teaching(viewer, None, None)


async def test_shared_observation_uses_cheap_driver_rows_and_clipped_picture_only(seat_tools, monkeypatch):
    hub, vm, _ = seat_tools
    target = vm.target(2)
    client, _ = hub.connections[target.key]
    client.rows += [window(99, 0, 'xfdesktop.Xfdesktop')]
    client.rows[-1]['bounds'].update(x=0, y=0, width=3840, height=1800)
    client.rows += [window(98, 1400, 'xfce4-panel')]
    vm.viewer_connection = AsyncMock(side_effect=AssertionError('No per-event container metadata commands'))
    vm.window_bounds = AsyncMock(side_effect=AssertionError('No docker exec for teaching windows'))
    captured = []
    monkeypatch.setattr(rfb_view, 'capture', lambda *args: captured.append(args) or b'clipped')
    recorder = recorder_for(vm, target)
    observation = await recorder.observe(target)
    assert observation['safe'] and 'window_id=20' in observation['screen']
    assert 'window_id=10' not in observation['screen'] and 'window_id=99' not in observation['screen']
    # The seat's own panel is listed as the member's own list_windows lists it; the canvas-wide desktop is nobody's.
    assert 'window_id=98' in observation['screen']
    assert '600x400+20+30' in observation['screen']
    assert base64.b64decode(observation['images'][0]['data']) == b'clipped'
    assert captured == [(123, 'private', 2)]
    assert [name for name, _ in client.calls] == ['list_windows']
    vm.window_bounds.assert_not_awaited()
    vm.viewer_connection.assert_not_awaited()


@pytest.mark.parametrize('private', ['title', 'own_mark', 'moved_mark', 'payment'])
async def test_private_seat_teaching_withholds_text_and_pixels(seat_tools, monkeypatch, private):
    hub, vm, _ = seat_tools
    target = vm.target(2)
    client, session = hub.connections[target.key]
    if private == 'title':
        client.rows[1]['title'] = 'Sign in'
    elif private == 'own_mark':
        hub.private_pages[target.key, 'page', 'tab'] = {'origins': set()}
    elif private == 'payment':
        hub.payment_holds.add(target.key)
    else:
        other = vm.target(1)
        hub.private_pages[other.key, 'page', 'tab'] = {'computer': target.physical, 'window': 20}
    capture = AsyncMock(side_effect=AssertionError('Private pixels must not be read'))
    monkeypatch.setattr(rfb_view, 'capture', capture)
    result = await recorder_for(vm, target).observe(target)
    assert result == {'safe': False, 'screen': '', 'images': []}
    assert set(name for name, _ in client.calls) <= {'list_windows'}
    capture.assert_not_called()


async def test_changed_holder_and_failed_observer_are_unsafe(seat_tools):
    hub, vm, _ = seat_tools
    target = vm.target(2)
    vm.seats.release('', 2)
    recorder = recorder_for(vm, target)
    assert not (await recorder.observe(target))['safe']
    vm.seats.restore('', 2, 2, 10)
    client, _ = hub.connections[target.key]
    client.request = AsyncMock(side_effect=RuntimeError('driver failed'))
    assert not (await recorder.observe(target))['safe']


async def test_cold_observation_can_open_only_its_seat_connection_while_owner_holds(seat_tools, monkeypatch):
    hub, vm, _ = seat_tools
    target = vm.target(2)
    await hub._disconnect(target.key)
    observed = []
    class Bridge(SeatBridge):
        async def __aenter__(self):
            return self
        async def request(self, method, params, **kwargs):
            observed.append((params['name'], kwargs))
            return await super().request(method, params, **kwargs)
    hub.bridge = Bridge
    vm.hold(target, True)
    monkeypatch.setattr(rfb_view, 'capture', lambda *args: b'clipped')
    assert (await recorder_for(vm, target).observe(target))['safe']
    assert observed == [(name, {'owner_observation': True}) for name in
                        ('set_config', 'set_agent_cursor_enabled', 'list_windows')]


async def test_real_bridge_shared_owner_lane_allows_only_session_setup_and_windows(seat_tools):
    from raphael_core.computer.vm_bridge import CuaBridge
    from raphael_core.computer.vm import VmError
    hub, vm, _ = seat_tools
    target = vm.target(2)
    vm.hold(target, True)
    bridge = CuaBridge(vm, target)
    sent = []
    async def write(packet):
        sent.append(packet)
        bridge.pending[packet['id']].set_result({'content': []})
    bridge._write = write
    bridge.reader = asyncio.create_task(asyncio.Event().wait())
    try:
        for name, args in [('set_config', {'max_image_dimension': 1456}),
                           ('set_agent_cursor_enabled', {'enabled': False}), ('list_windows', {})]:
            await bridge.request('tools/call', {'name': name, 'arguments': {**args, 'session': 'owner-seat'}}, owner_observation=True)
        assert [packet['params']['name'] for packet in sent] == ['set_config', 'set_agent_cursor_enabled', 'list_windows']
        for name, args in [('get_accessibility_tree', {}), ('get_desktop_state', {}),
                           ('list_windows', {'session': 'owner-seat', 'pid': 1}),
                           ('type_text', {'session': 'owner-seat', 'text': 'secret'}),
                           ('set_agent_cursor_enabled', {'session': 'owner-seat', 'enabled': True})]:
            with pytest.raises(VmError, match='observation_only'):
                await bridge.request('tools/call', {'name': name, 'arguments': args}, owner_observation=True)
        assert (await bridge.request('tools/call', {'name': 'list_windows', 'arguments': {'session': 'member'}}))['isError']
        assert len(sent) == 3
    finally:
        bridge.reader.cancel()
        await asyncio.gather(bridge.reader, return_exceptions=True)


async def test_viewer_publishes_shared_core_recording_and_rechecks_input_authority(seat_tools):
    _, vm, _ = seat_tools
    viewer = DesktopViewer(vm)
    target = vm.target(2)
    viewer.sessions['owner'] = session = Session(target, vm.clock() + 30, member_id=2)
    viewer.owners[target.key] = 'owner'
    recording = SimpleNamespace(state='recording', relay_enabled=True)
    viewer.teaching = SimpleNamespace(active=lambda token: recording, relay_hook=lambda token: None, input=AsyncMock())
    policies = []
    viewer.relay = SimpleNamespace(publish=lambda token, policy: policies.append(policy))
    viewer.publish_session('owner')
    assert policies[-1].core_teaching and policies[-1].teaching is None
    message = b'\x04\x01\0\0\0\0\0A'
    await viewer._teach_core_input('owner', session.revision + 1, message)
    session.preview = True
    await viewer._teach_core_input('owner', session.revision, message)
    session.preview = False
    viewer.owners.clear()
    await viewer._teach_core_input('owner', session.revision, message)
    viewer.owners[target.key] = 'owner'
    session.expires = vm.clock()
    await viewer._teach_core_input('owner', session.revision, message)
    viewer.teaching.input.assert_not_awaited()
    session.expires += 30
    await viewer._teach_core_input('owner', session.revision, message)
    viewer.teaching.input.assert_awaited_once_with('owner', message)
    # The relay forwards the press after this returns: a recorder that cannot write must not end the owner's control.
    viewer.teaching.input.side_effect = OSError('synthetic full disk')
    await viewer._teach_core_input('owner', session.revision, message)
    assert viewer.teaching.input.await_count == 2
    recording.state = 'full'
    viewer.publish_session('owner')
    assert not policies[-1].core_teaching


async def test_shared_relay_dispatches_input_on_core_before_forward_without_observation_bridge(monkeypatch):
    order, forwarded = [], []
    relay = viewer_relay.ViewerRelay(None, None, None, None, None, None)
    message = b'\x04\x01\0\0\0\0\0A'
    class Gate:
        def __init__(self, allowed):
            self.packets = []
        def feed(self, data):
            self.packets = [(True, message, 2)]
            return b'accepted'
    class Input:
        async def read(self, limit):
            if not order:
                return b'packet'
            await asyncio.Event().wait()
    class Remote:
        async def read(self, limit):
            await asyncio.Event().wait()
    async def core_input(token, revision, data):
        order.append(('core', token, revision, data))
    async def on_main(coroutine):
        return await coroutine
    async def drain():
        order.append('forward')
        relay.publish('viewer', None)
    relay.core_input, relay.on_main = core_input, on_main
    relay.publish('viewer', viewer_relay.Policy(3, __import__('time').monotonic() + 10, True, None, True))
    peer = viewer_relay.Peer('viewer', 3, SimpleNamespace(), SimpleNamespace(drain=drain), None)
    monkeypatch.setattr(viewer_relay, 'RfbInputGate', Gate)
    relay.forward = lambda peer, data, **kwargs: forwarded.append(data) or True
    await asyncio.wait_for(relay.pump(peer, Input(), Remote()), 1)
    assert order == [('core', 'viewer', 3, message), 'forward'] and len(forwarded) == 1
