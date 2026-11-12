"""Create real TigerVNC outputs and supervise private, clipped screen views."""

import math
import os
from pathlib import Path
import re
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time


RUN = Path('/run/user/1000')
TOKENS = RUN / 'raphael-vnc-tokens'
READY = Path('/dev/shm/raphael-screens.ready')


def screen_count(value):
    try:
        return max(1, min(6, int(value)))
    except (ValueError, TypeError):
        return 1


def grid(count, width=1280, height=900):
    count = screen_count(count)
    columns = math.ceil(math.sqrt(count))
    rows = math.ceil(count / columns)
    return ([(i % columns * width, i // columns * height, width, height) for i in range(count)],
            (columns * width, rows * height))


# DES permutations and S-boxes (FIPS PUB 46-3). Bit positions are one-based, MSB first.
IP = (
    58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,
    62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,
    57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,
    61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7,
)
FP = (
    40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,
    38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,
    36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,
    34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25,
)
PC1 = (
    57,49,41,33,25,17,9,1,58,50,42,34,26,18,
    10,2,59,51,43,35,27,19,11,3,60,52,44,36,
    63,55,47,39,31,23,15,7,62,54,46,38,30,22,
    14,6,61,53,45,37,29,21,13,5,28,20,12,4,
)
PC2 = (
    14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,
    41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32,
)
EXPAND = (
    32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,
    16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1,
)
P = (16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25)
SBOX = (
    (14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,
     4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13),
    (15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,
     0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9),
    (10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,
     13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12),
    (7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,
     10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14),
    (2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,
     4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3),
    (12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,
     9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13),
    (4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,
     1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12),
    (13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,
     7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11),
)


def permute(value, table, bits):
    result = 0
    for position in table:
        result = result << 1 | (value >> (bits - position) & 1)
    return result


def des_encrypt(key, block):
    """Encrypt one 8-byte block with single DES; used only for VNC authentication."""
    if len(key) != 8 or len(block) != 8:
        raise ValueError('DES needs an 8-byte key and block')
    key = permute(int.from_bytes(key, 'big'), PC1, 64)
    c, d = key >> 28, key & 0xfffffff
    value = permute(int.from_bytes(block, 'big'), IP, 64)
    left, right = value >> 32, value & 0xffffffff
    for shift in (1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1):
        c = (c << shift | c >> (28 - shift)) & 0xfffffff
        d = (d << shift | d >> (28 - shift)) & 0xfffffff
        mixed = permute(right, EXPAND, 32) ^ permute(c << 28 | d, PC2, 56)
        substituted = 0
        for i, box in enumerate(SBOX):
            six = mixed >> (42 - i * 6) & 63
            row, column = (six >> 4 & 2) | (six & 1), six >> 1 & 15
            substituted = substituted << 4 | box[row * 16 + column]
        left, right = right, left ^ permute(substituted, P, 32)
    return permute(right << 32 | left, FP, 64).to_bytes(8, 'big')


def vnc_key(password):
    raw = password.encode('utf-8')[:8].ljust(8, b'\0')
    return bytes(int(f'{byte:08b}'[::-1], 2) for byte in raw)


def desktop_size(rectangles, canvas):
    return struct.pack('>BxHHBx', 251, *canvas, len(rectangles)) + b''.join(
        struct.pack('>IHHHHI', i, *rectangle, 0) for i, rectangle in enumerate(rectangles))


def extended_desktop_reply(header, payload):
    """Return status only for this client's request, validating the screen list."""
    reason, status, width, height, encoding = struct.unpack('>HHHHi', header)
    if encoding != -308 or len(payload) < 4 or len(payload) != 4 + payload[0] * 16:
        raise ValueError('Invalid ExtendedDesktopSize reply')
    return status if reason == 1 else None


# One deadline covers the whole RFB conversation, so a stalled or trickling server cannot hold the helper.
LAYOUT_DEADLINE_S = 15
# What may be skipped while waiting for the layout reply. The helper asks for one pixel, so a raw rectangle is one
# pixel (4 bytes at 32 bits); a colour map has at most 256 entries of 6 bytes; clipboard text it never asked for
# is skipped up to 4096 bytes. Anything larger is refused before it is read.
MAX_RAW_PIXELS, MAX_COLOURS, MAX_CUT_TEXT = 1, 256, 4096


def receive(sock, size, deadline=None):
    data = bytearray()
    while len(data) < size:
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('The VNC layout request passed its deadline')
            sock.settimeout(min(5, remaining))
        chunk = sock.recv(min(size - len(data), 65536))
        if not chunk:
            raise EOFError('VNC server disconnected')
        data.extend(chunk)
    return bytes(data)


def discard(sock, size, deadline=None):
    while size:
        chunk = receive(sock, min(size, 65536), deadline)
        size -= len(chunk)


def read_layout_status(sock, bytes_per_pixel, deadline=None):
    if deadline is None:
        deadline = time.monotonic() + LAYOUT_DEADLINE_S
    while time.monotonic() < deadline:
        kind = receive(sock, 1, deadline)[0]
        if kind == 0:
            rectangles = struct.unpack('>xH', receive(sock, 3, deadline))[0]
            for _ in range(rectangles):
                header = receive(sock, 12, deadline)
                _, _, width, height, encoding = struct.unpack('>HHHHi', header)
                if encoding == -308:
                    payload = receive(sock, 4, deadline)
                    payload += receive(sock, payload[0] * 16, deadline)
                    status = extended_desktop_reply(header, payload)
                    if status is not None:
                        return status
                elif encoding == 0:
                    if width * height > MAX_RAW_PIXELS:
                        raise ValueError(f'Unexpected RFB payload: a {width}x{height} raw rectangle for a one-pixel request')
                    discard(sock, width * height * bytes_per_pixel, deadline)
                else:
                    raise ValueError(f'Unexpected RFB encoding {encoding}')
        elif kind == 1:
            _, colors = struct.unpack('>xHH', receive(sock, 5, deadline))
            if colors > MAX_COLOURS:
                raise ValueError(f'Unexpected RFB payload: a colour map of {colors} entries')
            discard(sock, colors * 6, deadline)
        elif kind == 2:
            continue
        elif kind == 3:
            length = struct.unpack('>xxxI', receive(sock, 7, deadline))[0]
            if length > MAX_CUT_TEXT:
                raise ValueError(f'Unexpected RFB payload: {length} bytes of clipboard text')
            discard(sock, length, deadline)
        else:
            raise ValueError(f'Unexpected RFB message {kind}')
    raise TimeoutError('No ExtendedDesktopSize reply')


def set_layout(rectangles, canvas, password):
    deadline = time.monotonic() + LAYOUT_DEADLINE_S
    with socket.create_connection(('127.0.0.1', 5901), timeout=5) as sock:
        sock.settimeout(5)
        if receive(sock, 12, deadline) != b'RFB 003.008\n':
            raise ValueError('VNC server does not offer RFB 3.8')
        sock.sendall(b'RFB 003.008\n')
        count = receive(sock, 1, deadline)[0]
        if not count or 2 not in receive(sock, count, deadline):
            raise ValueError('VNC authentication unavailable')
        sock.sendall(b'\x02')
        challenge = receive(sock, 16, deadline)
        key = vnc_key(password)
        sock.sendall(des_encrypt(key, challenge[:8]) + des_encrypt(key, challenge[8:]))
        if receive(sock, 4, deadline) != b'\0\0\0\0':
            raise ValueError('VNC authentication failed')
        sock.sendall(b'\x01')  # Shared ClientInit keeps existing viewers connected.
        initial = receive(sock, 24, deadline)
        bits = initial[4]
        if bits not in (8, 16, 32):
            raise ValueError('Invalid RFB pixel format')
        name_length = struct.unpack('>I', initial[20:24])[0]
        if name_length > 65536:
            raise ValueError('VNC desktop name too long')
        discard(sock, name_length, deadline)
        sock.sendall(struct.pack('>BxHi', 2, 1, -308))
        sock.sendall(desktop_size(rectangles, canvas))
        sock.sendall(struct.pack('>BBHHHH', 3, 0, 0, 0, 1, 1))
        status = read_layout_status(sock, bits // 8, deadline)
        if status == 0:
            x, y, width, height = rectangles[0]
            sock.sendall(struct.pack('>BBHH', 5, 0, x + width // 2, y + height // 2))
        return status


def monitors_match(text, rectangles):
    if not text.splitlines() or text.splitlines()[0].strip() != f'Monitors: {len(rectangles)}':
        return False
    found = []
    for line in text.splitlines():
        match = re.search(r'\b(\d+)/\d+x(\d+)/\d+\+(\d+)\+(\d+)\s+(VNC-\d+)\s*$', line)
        if match:
            width, height, x, y = map(int, match.groups()[:4])
            found.append((match[5], (x, y, width, height)))
    return sorted(found) == [(f'VNC-{i}', rect) for i, rect in enumerate(rectangles)]


def panel_commands(count):
    """Return (property, type, values) for xfconf, preserving panel 1's launchers."""
    result = [('/panels', 'int', [str(i) for i in range(1, screen_count(count) + 1)])]
    for panel in range(1, screen_count(count) + 1):
        path = f'/panels/panel-{panel}'
        result.append((path + '/output-name', 'string', [f'VNC-{panel - 1}']))
        if panel == 1:
            continue
        for name, kind, value in (
            ('position', 'string', 'p=10;x=0;y=0'), ('position-locked', 'bool', 'true'),
            ('size', 'uint', '48'), ('length', 'uint', '1'), ('length-adjust', 'bool', 'true'),
            ('autohide-behavior', 'uint', '0'),
        ):
            result.append((path + '/' + name, kind, [value]))
        ids = [str(i) for i in range(panel * 3 - 2, panel * 3 + 1)]
        result.append((path + '/plugin-ids', 'int', ids))
        for plugin, item in zip(ids, ('browser.desktop', 'files.desktop', 'terminal.desktop')):
            result.append((f'/plugins/plugin-{plugin}', 'string', ['launcher']))
            result.append((f'/plugins/plugin-{plugin}/items', 'string', [item]))
    return result


def xfconf_args(channel, property, kind, values):
    args = ['xfconf-query', '-c', channel, '-p', property, '-n']
    if property == '/panels' or property.endswith(('/plugin-ids', '/items')):
        args.append('-a')
    for value in values:
        args += ['-t', kind, '-s', value]
    return args


def token_text(count):
    count = screen_count(count)
    return ''.join(f'screen-{i}: 127.0.0.1:{5901 if count == 1 else 5910 + i}\n' for i in range(1, count + 1))


def atomic_write(path, text):
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(text)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def command(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=10).stdout


def wait_for(args, attempts=45):
    for _ in range(attempts):
        try:
            command(args)
            return
        except (subprocess.SubprocessError, OSError):
            time.sleep(1)
    raise TimeoutError(f'{args[0]} did not become ready within {attempts} seconds')


def configure_panels(count):
    wait_for(['pgrep', '-x', 'xfce4-panel'])
    changed = False
    for property, kind, values in panel_commands(count):
        try:
            current = command(['xfconf-query', '-c', 'xfce4-panel', '-p', property]).splitlines()
        except subprocess.CalledProcessError:
            current = []
        # xfconf prints an array header and blank line before its values.
        current = [line.strip() for line in current if line.strip() and not line.startswith('Value is an array')]
        if current != values:
            command(xfconf_args('xfce4-panel', property, kind, values))
            changed = True
    if changed:
        command(['xfce4-panel', '-r'])


def configure_dock_shadow(count):
    if count <= 1:
        return
    try:
        current = command(['xfconf-query', '-c', 'xfwm4', '-p', '/general/show_dock_shadow']).strip()
    except subprocess.CalledProcessError:
        current = ''
    if current != 'false':
        command(xfconf_args('xfwm4', '/general/show_dock_shadow', 'bool', ['false']))


# What the window manager does to the whole desktop at a key: with these bound, ctrl+F2 (and ctrl+F4, an ordinary
# "close this tab") moved the computer to another workspace and every window was gone from every screen.
WHOLE_DESKTOP_KEYS = re.compile(
    r'^(workspace_\d+|(left|right|up|down)_workspace|move_window_(left|right|up|down)|move_window_(next|prev)_workspace'
    r'|move_window_workspace_\d+|add_workspace|add_adjacent_workspace|del_workspace|del_active_workspace|show_desktop)_key$')
# With several screens these walk over every screen's windows, and a program started by a key opens wherever the
# one pointer happens to be.
EVERY_SCREEN_KEYS = re.compile(r'^(cycle_windows|cycle_reverse_windows|switch_window|switch_application)_key$')
WHOLE_DESKTOP_COMMANDS = ('xfce4-session-logout', 'xflock4', 'xkill', 'xfce4-display-settings')


def shortcut_removals(listing, count):
    """The bound keys to take away, from `xfconf-query -c xfce4-keyboard-shortcuts -l -v`."""
    removals = []
    for line in listing.splitlines():
        property, _, value = line.strip().partition(' ')
        value = value.strip()
        if property.endswith(('/override', '/startup-notify')) or not value:
            continue
        if property.startswith('/xfwm4/custom/'):
            if WHOLE_DESKTOP_KEYS.match(value) or count > 1 and EVERY_SCREEN_KEYS.match(value):
                removals.append(property)
        elif property.startswith('/commands/custom/'):
            if count > 1 or value.split()[0] in WHOLE_DESKTOP_COMMANDS:
                removals.append(property)
    return removals


def configure_shortcuts(count):
    """One workspace, and no key that acts on the whole desktop. Never a reason to hold the screens back."""
    try:
        command(xfconf_args('xfwm4', '/general/workspace_count', 'int', ['1']))
        # The session copies its default keys into these two branches when it starts; before that there is
        # nothing to take away, and what is copied afterwards would all be bound.
        for branch in ('xfwm4', 'commands'):
            wait_for(['xfconf-query', '-c', 'xfce4-keyboard-shortcuts', '-p', f'/{branch}/custom/override'], attempts=20)
        listing = command(['xfconf-query', '-c', 'xfce4-keyboard-shortcuts', '-l', '-v'])
        for property in shortcut_removals(listing, count):
            command(['xfconf-query', '-c', 'xfce4-keyboard-shortcuts', '-p', property, '-r', '-R'])
    except (subprocess.SubprocessError, OSError, TimeoutError) as error:
        print(f'raphael-screens: the keys were left as they were: {error}', file=sys.stderr)


X_SOCKET = '/tmp/.X11-unix/X1'


def x_alive():
    """Whether the X server still takes a connection: a look that starts no process."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(2)
            sock.connect(X_SOCKET)
        return True
    except OSError:
        return False


def view_command(index, rectangle):
    x, y, width, height = rectangle
    return ['/usr/bin/X0tigervnc', '-display', ':1', '-Geometry', f'{width}x{height}+{x}+{y}',
            '-rfbport', str(5911 + index), '-PasswordFile', '/home/cua/.vnc/passwd',
            '-SecurityTypes', 'VncAuth', '-localhost=1', '-AlwaysShared=1']


def tcp_listening(text, port):
    address = f'0100007F:{port:04X}'
    return any(len(fields) >= 4 and fields[1] == address and fields[3] == '0A'
               for fields in (line.split() for line in text.splitlines()))


def cleanup_views():
    try:
        command(['pkill', '-x', 'X0tigervnc'])
    except subprocess.CalledProcessError as error:
        if error.returncode != 1:  # No matching process is already clean.
            raise
    for _ in range(50):
        text = Path('/proc/net/tcp').read_text(encoding='ascii')
        if not any(tcp_listening(text, port) for port in range(5911, 5917)):
            return
        time.sleep(.1)
    raise TimeoutError('Leftover clipped servers still listen after 5 seconds')


def layout_intact(rectangles):
    try:
        return monitors_match(command(['xrandr', '--listmonitors']), rectangles)
    except (subprocess.SubprocessError, OSError):
        return False  # An X server that does not answer has lost the layout too.


def serve(count, rectangles):
    children = {}
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        cleanup_views()
        for i, rectangle in enumerate(rectangles if count > 1 else []):
            children[i] = subprocess.Popen(view_command(i, rectangle))
        # Publish only once every clipped listener has bound its private port.
        for i in children:
            wait_for_port(5911 + i, children[i])
        atomic_write(TOKENS, token_text(count))
        # The mark says this boot's screens are set up. It stays while a view or this helper restarts: the members'
        # work needs the screens, not a view, and a viewer reports a refused connection itself.
        atomic_write(READY, str(count) + '\n')
        ticks = 0
        while not stopping:
            ticks += 1
            # One screen has no view that dies with its X server, and a computer whose X server was gone kept its
            # mark and was called ready for good. Look at the server itself, for any number of screens.
            if ticks % 4 == 0 and not x_alive():
                READY.unlink(missing_ok=True)
                raise RuntimeError('The X server is gone; setting the screens up again')
            for i, child in list(children.items()):
                if child.poll() is not None:
                    # A view also dies with its X server. On a lost layout the mark goes and the set-up runs again.
                    if not layout_intact(rectangles):
                        READY.unlink(missing_ok=True)
                        raise RuntimeError('The screen layout was lost; setting the screens up again')
                    print(f'screen-{i + 1} view exited ({child.returncode}); restarting', file=sys.stderr)
                    time.sleep(1)
                    children[i] = subprocess.Popen(view_command(i, rectangles[i]))
                    wait_for_port(5911 + i, children[i])
            time.sleep(.5)
    finally:
        for child in children.values():
            if child.poll() is None:
                child.terminate()
        for child in children.values():
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def wait_for_port(port, child):
    for _ in range(50):
        if child.poll() is not None:
            raise RuntimeError(f'Clipped server on {port} exited ({child.returncode})')
        if tcp_listening(Path('/proc/net/tcp').read_text(encoding='ascii'), port):
            return
        time.sleep(.1)
    raise TimeoutError(f'Clipped server on {port} did not listen')


def main():
    # The mark lives on a tmpfs that is empty at every boot, so one found here is this boot's: a restarted helper
    # leaves it, and takes it away only when the layout it stands for is gone.
    TOKENS.unlink(missing_ok=True)
    os.environ['DISPLAY'] = ':1'
    count = screen_count(os.environ.get('RAPHAEL_SCREENS', '1'))
    rectangles, canvas = grid(count)
    for attempt in range(3):
        try:
            wait_for(['xset', 'q'])
            command(xfconf_args('displays', '/Notify', 'int', ['0']))
            if not monitors_match(command(['xrandr', '--listmonitors']), rectangles):
                READY.unlink(missing_ok=True)
                status = set_layout(rectangles, canvas, os.environ.get('VNC_PW', ''))
                if status != 0:
                    raise RuntimeError(f'SetDesktopSize failed with status {status}')
            if count > 1:
                configure_dock_shadow(count)
                configure_panels(count)
            configure_shortcuts(count)
            serve(count, rectangles)
            return 0
        except (OSError, EOFError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
            print(f'raphael-screens attempt {attempt + 1}: {error}', file=sys.stderr)
            time.sleep(2)
    return 1


if __name__ == '__main__':
    sys.exit(main())
