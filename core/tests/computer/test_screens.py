"""Image screen contracts, exercised without Docker, X11 or real network sockets."""

from dataclasses import replace
from pathlib import Path
import struct
import subprocess
from types import ModuleType, SimpleNamespace

import pytest

from raphael_core.computer import vm as vm_module
from raphael_core.computer.vm import LABEL, VmError, compatible, run_args, screen_grid
from .test_vm import desktop


IMAGE = Path(vm_module.__file__).parent / 'image'
screens = ModuleType('image_screens')
helper = IMAGE / 'desktop/screens.py'
exec(compile(helper.read_text(encoding='utf-8'), str(helper), 'exec'), screens.__dict__)


@pytest.fixture(scope='module', autouse=True)
def image_build_context_stays_without_bytecode():
    yield
    assert not list(IMAGE.rglob('__pycache__'))


@pytest.mark.parametrize('count,canvas,origins', [
    (1, (1280, 900), [(0, 0)]),
    (2, (2560, 900), [(0, 0), (1280, 0)]),
    (3, (2560, 1800), [(0, 0), (1280, 0), (0, 900)]),
    (4, (2560, 1800), [(0, 0), (1280, 0), (0, 900), (1280, 900)]),
    (5, (3840, 1800), [(0, 0), (1280, 0), (2560, 0), (0, 900), (1280, 900)]),
    (6, (3840, 1800), [(0, 0), (1280, 0), (2560, 0), (0, 900), (1280, 900), (2560, 900)]),
])
def test_grid_has_only_requested_screens_and_the_full_canvas(count, canvas, origins):
    rectangles, actual = screens.grid(count)
    assert actual == canvas
    assert rectangles == [(x, y, 1280, 900) for x, y in origins]


@pytest.mark.parametrize('count', range(-1, 9))
@pytest.mark.parametrize('size', [(1280, 900), (640, 480)])
def test_host_and_guest_grids_match(count, size):
    assert screen_grid(count, *size) == screens.grid(count, *size)


@pytest.mark.parametrize('value,expected', [(None, 1), ('', 1), ('bad', 1), ('1.5', 1), ('-5', 1), ('0', 1), ('2', 2), ('6', 6), ('99', 6)])
def test_environment_screen_count_is_clamped(value, expected):
    assert screens.screen_count(value) == expected


@pytest.mark.parametrize('key,plain,cipher', [
    # FIPS DES example and the published all-zero DES known-answer vector.
    ('133457799BBCDFF1', '0123456789ABCDEF', '85E813540F0AB405'),
    ('0000000000000000', '0000000000000000', '8CA64DE9C1B123A7'),
])
def test_des_published_known_answer_vectors(key, plain, cipher):
    assert screens.des_encrypt(bytes.fromhex(key), bytes.fromhex(plain)) == bytes.fromhex(cipher)


def test_vnc_key_reverses_each_byte_then_truncates_and_null_pads():
    assert screens.vnc_key('password-extra') == bytes.fromhex('0e86ceceeef64e26')
    assert screens.vnc_key('a') == b'\x86' + bytes(7)
    assert screens.vnc_key('') == bytes(8)
    assert screens.vnc_key('é' * 5) == bytes.fromhex('c395c395c395c395')


def test_set_desktop_size_bytes_for_four_screens():
    rectangles, canvas = screens.grid(4)
    assert screens.desktop_size(rectangles, canvas) == bytes.fromhex(
        'fb000a0007080400'
        '00000000000000000500038400000000'
        '00000001050000000500038400000000'
        '00000002000003840500038400000000'
        '00000003050003840500038400000000')


def reply(status=0, reason=1):
    header = struct.pack('>HHHHi', reason, status, 2560, 1800, -308)
    payload = b'\x01\0\0\0' + struct.pack('>IHHHHI', 0, 0, 0, 1280, 900, 0)
    return header, payload


@pytest.mark.parametrize('status', [0, 1, 2, 3])
def test_extended_desktop_reply_returns_success_or_failure_status(status):
    assert screens.extended_desktop_reply(*reply(status)) == status
    assert screens.extended_desktop_reply(*reply(status, reason=0)) is None
    header, payload = reply(status)
    with pytest.raises(ValueError):
        screens.extended_desktop_reply(header, payload[:-1])


class Socket:
    def __init__(self, incoming):
        self.incoming, self.sent, self.timeout = incoming, [], None

    def recv(self, size):
        chunk, self.incoming = self.incoming[:min(size, 3)], self.incoming[min(size, 3):]
        return chunk

    def sendall(self, data):
        self.sent.append(data)

    def settimeout(self, timeout):
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


def update(status=0, reason=1):
    return b'\0\0\0\x01' + b''.join(reply(status, reason))


@pytest.mark.parametrize('status', [0, 3])
def test_rfb_handshake_authenticates_and_waits_for_its_own_layout_reply(monkeypatch, status):
    initial = struct.pack('>HH', 1280, 900) + b'\x20' + bytes(15) + struct.pack('>I', 4) + b'desk'
    sock = Socket(b'RFB 003.008\n\x01\x02' + bytes(range(16)) + bytes(4) + initial + update(reason=0) + update(status))
    connections = []

    def connect(address, timeout):
        connections.append((address, timeout))
        return sock

    monkeypatch.setattr(screens.socket, 'create_connection', connect)
    layout = screens.grid(4)
    assert screens.set_layout(*layout, 'password') == status
    assert connections == [(('127.0.0.1', 5901), 5)] and sock.timeout == 5
    assert sock.sent[:2] == [b'RFB 003.008\n', b'\x02']
    key = screens.vnc_key('password')
    assert sock.sent[2] == screens.des_encrypt(key, bytes(range(8))) + screens.des_encrypt(key, bytes(range(8, 16)))
    assert sock.sent[3:6] == [b'\x01', struct.pack('>BxHi', 2, 1, -308), screens.desktop_size(*layout)]
    assert sock.sent[6] == struct.pack('>BBHHHH', 3, 0, 0, 0, 1, 1)
    assert sock.sent[7:] == ([bytes.fromhex('0500028001c2')] if status == 0 else [])
    assert not sock.incoming


def test_rfb_reader_skips_initial_pixels_bells_and_clipboard():
    raw = b'\0\0\0\x01' + struct.pack('>HHHHi', 0, 0, 1, 1, 0) + bytes(4)
    clipboard = b'\x03' + bytes(3) + struct.pack('>I', 4) + b'text'
    assert screens.read_layout_status(Socket(b'\x02' + clipboard + raw + update()), 4) == 0
    with pytest.raises(EOFError):
        screens.receive(Socket(b'abc'), 4)


@pytest.mark.parametrize('count,expected', [
    (1, 'screen-1: 127.0.0.1:5901\n'),
    (4, 'screen-1: 127.0.0.1:5911\nscreen-2: 127.0.0.1:5912\nscreen-3: 127.0.0.1:5913\nscreen-4: 127.0.0.1:5914\n'),
])
def test_tokens_expose_only_individual_screens(count, expected):
    assert screens.token_text(count) == expected


def test_four_panels_have_independent_outputs_and_unique_launcher_plugins():
    commands = dict((path, (kind, values)) for path, kind, values in screens.panel_commands(4))
    assert commands['/panels'] == ('int', ['1', '2', '3', '4'])
    assert '/panels/panel-1/plugin-ids' not in commands
    for panel in range(1, 5):
        assert commands[f'/panels/panel-{panel}/output-name'] == ('string', [f'VNC-{panel - 1}'])
        if panel == 1:
            continue
        ids = list(range(panel * 3 - 2, panel * 3 + 1))
        assert commands[f'/panels/panel-{panel}/plugin-ids'] == ('int', list(map(str, ids)))
        for plugin, item in zip(ids, ('browser.desktop', 'files.desktop', 'terminal.desktop')):
            assert commands[f'/plugins/plugin-{plugin}'] == ('string', ['launcher'])
            assert commands[f'/plugins/plugin-{plugin}/items'] == ('string', [item])
    assert screens.xfconf_args('xfce4-panel', '/panels', 'int', ['1', '2']) == [
        'xfconf-query', '-c', 'xfce4-panel', '-p', '/panels', '-n', '-a', '-t', 'int', '-s', '1', '-t', 'int', '-s', '2']


def test_existing_panel_configuration_needs_no_writes_or_restart(monkeypatch):
    values = {path: value for path, _, value in screens.panel_commands(4)}
    calls = []

    def command(args):
        calls.append(args)
        assert len(args) == 5
        result = values[args[-1]]
        return ('Value is an array with %d items:\n\n' % len(result) if len(result) > 1 else '') + '\n'.join(result)

    monkeypatch.setattr(screens, 'command', command)
    monkeypatch.setattr(screens, 'wait_for', lambda args: None)
    screens.configure_panels(4)
    assert len(calls) == len(values)


def test_monitor_detection_requires_real_outputs_and_exact_rectangles():
    text = 'Monitors: 2\n 0: +VNC-0 1280/339x900/238+0+0 VNC-0\n 1: +VNC-1 1280/339x900/238+1280+0 VNC-1\n'
    assert screens.monitors_match(text, screens.grid(2)[0])
    assert not screens.monitors_match(text.replace('1280+0', '0+900'), screens.grid(2)[0])
    assert not screens.monitors_match(text.replace(' VNC-1\n', '\n'), screens.grid(2)[0])
    assert not screens.monitors_match(text, screens.grid(1)[0])
    assert not screens.monitors_match(text.replace('Monitors: 2', 'Monitors: 3'), screens.grid(2)[0])


def test_changed_panels_wait_for_xfce_before_writes_and_restart(monkeypatch):
    calls = []
    monkeypatch.setattr(screens, 'wait_for', lambda args: calls.append(('wait', args)))

    def command(args):
        calls.append(('command', args))
        if args[0] == 'xfconf-query' and len(args) == 5:
            raise subprocess.CalledProcessError(1, args)
        return ''

    monkeypatch.setattr(screens, 'command', command)
    screens.configure_panels(4)
    assert calls[0] == ('wait', ['pgrep', '-x', 'xfce4-panel'])
    assert calls[-1] == ('command', ['xfce4-panel', '-r'])
    writes = [args for _, args in calls if '-n' in args]
    assert len(writes) == len(screens.panel_commands(4))


def test_atomic_publication_sets_owner_only_mode_before_rename(tmp_path, monkeypatch):
    destination = tmp_path / 'tokens'
    destination.write_text('old', encoding='utf-8')
    operations = []
    replace_file = screens.os.replace
    monkeypatch.setattr(screens.os, 'fchmod', lambda fd, mode: operations.append(('mode', mode)), raising=False)

    def rename(source, target):
        assert Path(source).read_text(encoding='utf-8') == 'new'
        assert destination.read_text(encoding='utf-8') == 'old'
        operations.append(('replace', target))
        replace_file(source, target)

    monkeypatch.setattr(screens.os, 'replace', rename)
    screens.atomic_write(destination, 'new')
    assert operations == [('mode', 0o600), ('replace', destination)]
    assert destination.read_text(encoding='utf-8') == 'new'
    assert list(tmp_path.iterdir()) == [destination]


@pytest.mark.parametrize('value,already_configured', [('1', True), ('4', False), ('4', True), ('invalid', True)])
def test_helper_start_preserves_boot_mark_and_skips_matching_layout(monkeypatch, tmp_path, value, already_configured):
    ready, tokens = tmp_path / 'ready', tmp_path / 'tokens'
    ready.write_text('stale', encoding='utf-8')
    tokens.write_text('stale', encoding='utf-8')
    monkeypatch.setattr(screens, 'READY', ready)
    monkeypatch.setattr(screens, 'TOKENS', tokens)
    monkeypatch.setenv('RAPHAEL_SCREENS', value)
    monkeypatch.setenv('VNC_PW', 'private')
    monkeypatch.setenv('DISPLAY', ':test')
    calls = []

    def wait(args):
        assert ready.read_text(encoding='utf-8') == 'stale' and not tokens.exists()
        calls.append(('wait', args))

    monkeypatch.setattr(screens, 'wait_for', wait)
    monkeypatch.setattr(screens, 'command', lambda args: calls.append(('command', args)) or 'monitors')
    monkeypatch.setattr(screens, 'monitors_match', lambda text, rects: already_configured)
    if not already_configured:
        monkeypatch.setattr(screens, 'set_layout', lambda *args: calls.append(('layout', args)) or 0)
    monkeypatch.setattr(screens.socket, 'create_connection', lambda *args, **kwargs: pytest.fail('Matching monitors must not send RFB requests or pointer events'))
    monkeypatch.setattr(screens, 'configure_dock_shadow', lambda count: calls.append(('shadow', count)))
    monkeypatch.setattr(screens, 'configure_panels', lambda count: calls.append(('panels', count)))
    monkeypatch.setattr(screens, 'serve', lambda *args: calls.append(('serve', args)))
    assert screens.main() == 0
    assert calls[0] == ('wait', ['xset', 'q'])
    assert calls[1] == ('command', ['xfconf-query', '-c', 'displays', '-p', '/Notify', '-n', '-t', 'int', '-s', '0'])
    assert bool([call for call in calls if call[0] == 'layout']) is not already_configured
    assert bool([call for call in calls if call[0] == 'panels']) is (value == '4')
    assert bool([call for call in calls if call[0] == 'shadow']) is (value == '4')


def test_layout_failures_are_bounded_reported_and_exit_nonzero(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv('DISPLAY', ':test')
    monkeypatch.setattr(screens, 'READY', tmp_path / 'ready')
    monkeypatch.setattr(screens, 'TOKENS', tmp_path / 'tokens')
    monkeypatch.setattr(screens, 'wait_for', lambda args: None)
    monkeypatch.setattr(screens, 'command', lambda args: '')
    monkeypatch.setattr(screens, 'monitors_match', lambda *args: False)
    monkeypatch.setattr(screens, 'set_layout', lambda *args: 3)
    pauses = []
    monkeypatch.setattr(screens.time, 'sleep', pauses.append)
    assert screens.main() == 1
    assert pauses == [2, 2, 2]
    assert capsys.readouterr().err.count('SetDesktopSize failed with status 3') == 3


@pytest.mark.parametrize('count', [1, 4])
def test_views_preserve_boot_mark_during_restart_and_stop(monkeypatch, tmp_path, count):
    monkeypatch.setattr(screens, 'READY', tmp_path / 'ready')
    monkeypatch.setattr(screens, 'TOKENS', tmp_path / 'tokens')
    processes, events, handlers = [], [], {}

    class Child:
        returncode = None

        def poll(self):
            return self.returncode

        def terminate(self):
            self.returncode = -15

        def wait(self, timeout=None):
            return self.returncode

    def spawn(args):
        assert args[:3] == ['/usr/bin/X0tigervnc', '-display', ':1']
        child = Child()
        processes.append(child)
        events.append(('spawn', args))
        return child

    def publish(path, text):
        events.append(('publish', path, text))
        path.write_text(text, encoding='utf-8')

    sleeps = []

    def sleep(duration):
        assert screens.READY.read_text(encoding='utf-8') == str(count) + '\n'
        sleeps.append(duration)
        if len(sleeps) == 1 and count > 1:
            processes[0].returncode = 1
        elif count == 1 or duration == .5 and len(sleeps) > 1:
            handlers[screens.signal.SIGTERM](None, None)

    monkeypatch.setattr(screens.subprocess, 'Popen', spawn)
    monkeypatch.setattr(screens.signal, 'signal', lambda signum, callback: handlers.update({signum: callback}))
    monkeypatch.setattr(screens.time, 'sleep', sleep)
    monkeypatch.setattr(screens, 'atomic_write', publish)
    monkeypatch.setattr(screens, 'wait_for_port', lambda port, child: events.append(('listen', port)))
    monkeypatch.setattr(screens, 'cleanup_views', lambda: events.append(('cleanup',)))
    monkeypatch.setattr(screens, 'monitors_match', lambda text, rectangles: True)
    monkeypatch.setattr(screens, 'command', lambda args: '')
    screens.serve(count, screens.grid(count)[0])
    assert events[0] == ('cleanup',)
    assert screens.READY.read_text(encoding='utf-8') == str(count) + '\n'
    assert screens.TOKENS.read_text(encoding='utf-8') == screens.token_text(count)
    first_publish = next(i for i, event in enumerate(events) if event[0] == 'publish')
    assert len([event for event in events[:first_publish] if event[0] == 'listen']) == (4 if count == 4 else 0)
    publications = [event[1] for event in events if event[0] == 'publish']
    assert publications[:2] == [screens.TOKENS, screens.READY]
    assert len(processes) == (5 if count == 4 else 0)
    assert all(process.poll() is not None for process in processes)
    if count == 4:
        commands = [event[1] for event in events if event[0] == 'spawn']
        assert commands[3][commands[3].index('-Geometry') + 1] == '1280x900+1280+900'
        assert commands[3][commands[3].index('-rfbport') + 1] == '5914'
        assert 1 in sleeps and publications.count(screens.READY) == 1


@pytest.mark.parametrize('count', range(1, 7))
def test_run_args_carry_screen_count_and_matching_canvas(desktop, count):
    vm, target, _ = desktop
    args = run_args(replace(target, screens=count), vm.owner, 'private')
    env = [args[i + 1] for i, arg in enumerate(args) if arg == '-e']
    width, height = screens.grid(count)[1]
    assert f'RAPHAEL_SCREENS={count}' in env and f'VNC_RESOLUTION={width}x{height}' in env


@pytest.mark.parametrize('env', [[], ['RAPHAEL_SCREENS=2'], ['RAPHAEL_SCREENS=bad'], ['RAPHAEL_SCREENS=1', 'RAPHAEL_SCREENS=2']])
def test_compatible_rejects_missing_wrong_or_ambiguous_screen_count(desktop, env):
    vm, target, runtime = desktop
    runtime.raw['Config']['Env'] = env
    assert not compatible(runtime.raw, target, vm.owner, runtime.image_id)


async def test_readiness_needs_screen_mark_without_an_extra_exec(desktop):
    vm, target, runtime = desktop
    runtime.screens_ready = False
    assert not (await vm.status(target))['ready']
    probes = [args for args, _ in runtime.calls if args[0] == 'exec']
    assert len(probes) == 2
    assert vm_module.SCREENS_READY in probes[0]
    runtime.screens_ready = True
    assert (await vm.status(target))['ready']
    assert 'path=websockify?token=screen-1' in (await vm.status(target))['viewer_url']


@pytest.mark.parametrize('change', ['owner', 'mount', 'memory', 'held', 'active', 'screens', 'unexpected-env'])
async def test_layer_four_upgrade_refuses_foreign_weakened_busy_or_multiscreen_targets(desktop, change):
    vm, target, runtime = desktop
    runtime.raw['Image'] = 'sha256:old-image'
    runtime.raw['Config']['Labels'][f'{LABEL}.layer'] = '4'
    runtime.raw['Config']['Env'] = ['VNC_PW=private']
    if change == 'owner':
        runtime.raw['Config']['Labels'][f'{LABEL}.owner'] = 'another-owner'
    elif change == 'mount':
        runtime.raw['Mounts'][0]['Source'] = 'another-workspace'
    elif change == 'memory':
        runtime.raw['HostConfig']['Memory'] = 2 * 1024**3
    elif change == 'held':
        vm.held.add(target.key)
    elif change == 'active':
        vm.active[target.key] = 2
    elif change == 'screens':
        target = replace(target, screens=4)
    else:
        runtime.raw['Config']['Env'].append('RAPHAEL_SCREENS=1')
    with pytest.raises(VmError, match='incompatible|busy'):
        await vm._upgrade_image(target)
    assert not any(args[0] in ('stop', 'rm') for args, _ in runtime.calls)


def test_image_installs_screen_views_and_preserves_the_single_token_port():
    dockerfile = (IMAGE / 'Dockerfile').read_text(encoding='utf-8')
    novnc = (IMAGE / 'desktop/start-novnc.sh').read_text(encoding='utf-8')
    assert 'apt-get install -y --no-install-recommends chromium tigervnc-scraping-server wmctrl;' in dockerfile
    assert 'for panel in 0 1 2 3 4 5' in dockerfile
    assert 'install -d -o cua -g cua /home/cua/.config/xfce4/panel;' in dockerfile
    assert '[program:raphael-screens]' in dockerfile
    assert 'command=/usr/bin/python3 /opt/raphael-desktop/screens.py' in dockerfile
    assert 'org.raphael.computer.layer="5"' in dockerfile
    assert 'stopasgroup' not in dockerfile and 'killasgroup' not in dockerfile
    assert 'supervisor only restarts what exits; the helper ends its own children' in dockerfile
    assert 'Nothing may call supervisorctl stop or restart in a computer' in dockerfile
    assert "Debian's Python runs it without anything from /opt/venv" in dockerfile
    assert 'test -f "$tokens"' in novnc and '5901' in novnc
    assert '--token-plugin TokenFile --token-source "$tokens" "${NOVNC_PORT:-6901}"' in novnc
    assert '127.0.0.1:5901' not in novnc


def test_clipped_server_runs_the_foreground_binary_with_real_parameter_names():
    assert screens.view_command(3, screens.grid(4)[0][3]) == [
        '/usr/bin/X0tigervnc', '-display', ':1', '-Geometry', '1280x900+1280+900',
        '-rfbport', '5914', '-PasswordFile', '/home/cua/.vnc/passwd',
        '-SecurityTypes', 'VncAuth', '-localhost=1', '-AlwaysShared=1']


def tcp_row(port, address='0100007F', state='0A'):
    return f'  0: {address}:{port:04X} 00000000:0000 {state} 00000000:00000000\n'


@pytest.mark.parametrize('text,expected', [
    (tcp_row(5911), True),
    ('  sl  local_address rem_address st\n' + tcp_row(5911) + tcp_row(5916), True),
    (tcp_row(5912), False),
    (tcp_row(5911, address='00000000'), False),
    (tcp_row(5911, address='0200007F'), False),
    (tcp_row(5911, state='01'), False),
    ('  sl  local_address rem_address st\n\nmalformed\n', False),
])
def test_tcp_listener_parser_requires_the_loopback_port_and_listen_state(text, expected):
    assert screens.tcp_listening(text, 5911) is expected


@pytest.mark.parametrize('port', range(5911, 5917))
@pytest.mark.parametrize('absent', [False, True])
def test_leftover_cleanup_kills_exact_binary_and_waits_for_every_view_port(monkeypatch, port, absent):
    calls, pauses = [], []
    states = iter([tcp_row(port), ''])

    def command(args):
        calls.append(args)
        if absent:
            raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(screens, 'command', command)
    monkeypatch.setattr(screens.Path, 'read_text', lambda self, **kwargs: next(states))
    monkeypatch.setattr(screens.time, 'sleep', pauses.append)
    screens.cleanup_views()
    assert calls == [['pkill', '-x', 'X0tigervnc']]
    assert pauses == [.1]


def test_leftover_cleanup_timeout_is_bounded_and_prevents_starting_views(monkeypatch, tmp_path):
    monkeypatch.setattr(screens, 'READY', tmp_path / 'ready')
    monkeypatch.setattr(screens.signal, 'signal', lambda *args: None)
    monkeypatch.setattr(screens, 'command', lambda args: '')
    reads, pauses = [], []

    def read(path, **kwargs):
        reads.append(path.as_posix())
        return tcp_row(5916)

    monkeypatch.setattr(screens.Path, 'read_text', read)
    monkeypatch.setattr(screens.time, 'sleep', pauses.append)
    monkeypatch.setattr(screens.subprocess, 'Popen', lambda *args: pytest.fail('Views started before cleanup completed'))
    monkeypatch.setattr(screens, 'atomic_write', lambda *args: pytest.fail('Published readiness before cleanup completed'))
    with pytest.raises(TimeoutError, match='Leftover clipped servers'):
        screens.serve(4, screens.grid(4)[0])
    assert reads == ['/proc/net/tcp'] * 50
    assert pauses == [.1] * 50


def test_leftover_cleanup_does_not_ignore_a_failed_pkill(monkeypatch):
    def command(args):
        raise subprocess.CalledProcessError(2, args)

    monkeypatch.setattr(screens, 'command', command)
    with pytest.raises(subprocess.CalledProcessError) as error:
        screens.cleanup_views()
    assert error.value.returncode == 2


@pytest.mark.parametrize('state', ['ready', 'timeout', 'exited'])
def test_clipped_listener_wait_uses_proc_without_unauthenticated_connections(monkeypatch, state):
    child = ModuleType('child')
    child.returncode = 1 if state == 'exited' else None
    child.poll = lambda: child.returncode
    reads, pauses = [], []

    def read(path, **kwargs):
        reads.append(path.as_posix())
        return tcp_row(5911) if state == 'ready' and len(reads) == 2 else ''

    monkeypatch.setattr(screens.Path, 'read_text', read)
    monkeypatch.setattr(screens.time, 'sleep', pauses.append)
    monkeypatch.setattr(screens.socket, 'create_connection', lambda *args, **kwargs: pytest.fail('Listener checks must not connect'))
    if state == 'ready':
        screens.wait_for_port(5911, child)
        assert reads == ['/proc/net/tcp'] * 2 and pauses == [.1]
    elif state == 'timeout':
        with pytest.raises(TimeoutError, match='did not listen'):
            screens.wait_for_port(5911, child)
        assert len(reads) == 50 and pauses == [.1] * 50
    else:
        with pytest.raises(RuntimeError, match='exited'):
            screens.wait_for_port(5911, child)
        assert reads == pauses == []


@pytest.mark.parametrize('current', ['false\n', 'true\n', None])
@pytest.mark.parametrize('count', [1, 4])
def test_multiple_screens_disable_only_dock_shadows_when_different(monkeypatch, count, current):
    calls = []

    def command(args):
        calls.append(args)
        if len(args) == 5:
            if current is None:
                raise subprocess.CalledProcessError(1, args)
            return current
        return ''

    monkeypatch.setattr(screens, 'command', command)
    screens.configure_dock_shadow(count)
    if count == 1:
        assert calls == []
    else:
        query = ['xfconf-query', '-c', 'xfwm4', '-p', '/general/show_dock_shadow']
        assert calls == [query] + ([query + ['-n', '-t', 'bool', '-s', 'false']] if current != 'false\n' else [])


def test_host_and_helper_share_the_fresh_tmpfs_readiness_path():
    assert screens.READY.as_posix() == vm_module.SCREENS_READY == '/dev/shm/raphael-screens.ready'
    assert screens.TOKENS.as_posix() == '/run/user/1000/raphael-vnc-tokens'


def test_image_build_context_has_no_bytecode():
    assert not list(IMAGE.rglob('__pycache__'))


@pytest.mark.parametrize('screen,count', [(0, 1), (2, 1), (7, 7), (1, 0), (1, 7), (True, 1), (1, True), ('1', 1), (1, '1')])
def test_target_rejects_invalid_screen_numbers_at_construction(desktop, screen, count):
    _, target, _ = desktop
    with pytest.raises(ValueError):
        replace(target, screen=screen, screens=count)


@pytest.mark.parametrize('phase', ['handshake', 'layout', 'pixels', 'clipboard'])
def test_rfb_layout_has_one_deadline_for_trickling_reads(monkeypatch, phase):
    clock = [0]
    initial = struct.pack('>HH', 1280, 900) + b'\x20' + bytes(15) + struct.pack('>I', 4) + b'desk'
    prefix = b'RFB 003.008\n\x01\x02' + bytes(range(16)) + bytes(4) + initial
    extra = {'handshake': b'', 'layout': b'',
             'pixels': b'\0\0\0\x01' + struct.pack('>HHHHi', 0, 0, 1, 1, 0) + bytes(4),
             'clipboard': b'\x03' + bytes(3) + struct.pack('>I', 4) + b'text'}[phase]

    class SlowSocket(Socket):
        def recv(self, size):
            slow = phase == 'handshake' or len(self.sent) >= 7
            if slow:
                clock[0] += min(4, self.timeout)
                if self.timeout <= 4:
                    raise TimeoutError('Synthetic socket deadline')
                size = 1
            return super().recv(size)

    sock = SlowSocket(prefix + extra + update())
    monkeypatch.setattr(screens, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(screens.socket, 'create_connection', lambda *args, **kwargs: sock)
    with pytest.raises(TimeoutError):
        screens.set_layout(*screens.grid(2), 'private')
    assert clock[0] <= 15


@pytest.mark.parametrize('message', [
    b'\0\0\0\x01' + struct.pack('>HHHHi', 0, 0, 2, 1, 0),
    b'\x03' + bytes(3) + struct.pack('>I', 4097),
    b'\x01' + struct.pack('>xHH', 0, 257),
])
def test_rfb_rejects_oversized_skipped_payload_before_reading_it(message):
    with pytest.raises(ValueError, match='payload'):
        screens.read_layout_status(Socket(message), 4)


@pytest.mark.parametrize('layout_matches', [True, False])
def test_simultaneous_view_exits_keep_boot_mark_unless_layout_is_lost(monkeypatch, tmp_path, layout_matches):
    monkeypatch.setattr(screens, 'READY', tmp_path / 'ready')
    monkeypatch.setattr(screens, 'TOKENS', tmp_path / 'tokens')
    handlers, children, publications, checks = {}, [], [], []

    class Child:
        returncode = None

        def poll(self):
            return self.returncode

        def terminate(self):
            self.returncode = -15

        def wait(self, timeout=None):
            return self.returncode

    def spawn(args):
        if children:
            assert screens.READY.exists() or len(children) < 2
        child = Child()
        children.append(child)
        return child

    def publish(path, text):
        publications.append(path)
        path.write_text(text, encoding='utf-8')

    pauses = []

    def sleep(duration):
        assert screens.READY.exists()
        pauses.append(duration)
        if len(pauses) == 1:
            children[0].returncode = children[1].returncode = 1
        elif duration == .5:
            handlers[screens.signal.SIGTERM](None, None)

    def command(args):
        checks.append(args)
        return 'monitors'

    monkeypatch.setattr(screens.subprocess, 'Popen', spawn)
    monkeypatch.setattr(screens.signal, 'signal', lambda sig, handler: handlers.update({sig: handler}))
    monkeypatch.setattr(screens.time, 'sleep', sleep)
    monkeypatch.setattr(screens, 'cleanup_views', lambda: None)
    monkeypatch.setattr(screens, 'wait_for_port', lambda port, child: None)
    monkeypatch.setattr(screens, 'atomic_write', publish)
    monkeypatch.setattr(screens, 'command', command)
    monkeypatch.setattr(screens, 'monitors_match', lambda text, rectangles: layout_matches)
    if layout_matches:
        screens.serve(2, screens.grid(2)[0])
        assert screens.READY.exists() and len(children) == 4
        assert checks == [['xrandr', '--listmonitors']] * 2
    else:
        with pytest.raises(RuntimeError, match='layout'):
            screens.serve(2, screens.grid(2)[0])
        assert not screens.READY.exists() and len(children) == 2
    assert publications == [screens.TOKENS, screens.READY]
    assert all(child.poll() is not None for child in children)


def test_supervisor_keeps_retrying_screen_setup_instead_of_entering_fatal():
    program = (IMAGE / 'Dockerfile').read_text(encoding='utf-8').split('[program:raphael-screens]', 1)[1]
    assert "'startretries=1000000'" in program
