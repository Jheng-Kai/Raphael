"""Bounded standard-library WebSocket/RFB views of one computer screen."""

import base64
import hashlib
import secrets
import socket
import struct
import time
import zlib


def require(condition, detail):
    if not condition:
        raise AssertionError(detail)


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


def exact(sock, size):
    result = bytearray()
    while len(result) < size:
        chunk = sock.recv(size - len(result))
        if not chunk:
            raise EOFError(f"Expected {size} bytes, received {len(result)} before disconnect")
        result.extend(chunk)
    return bytes(result)


class UpgradeRefused(AssertionError):
    pass


class WebSocket:
    """A bounded binary WebSocket stream, including fragmented messages and ping."""

    def __init__(self, sock, host, path, *, origin=None):
        self.sock, self.pending = sock, bytearray()
        self.fragment = False
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        request = (f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
                   f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                   "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n")
        if origin:
            request += f"Origin: {origin}\r\n"
        sock.sendall((request + "\r\n").encode("ascii"))
        header = bytearray()
        while not header.endswith(b"\r\n\r\n"):
            require(len(header) < 16384, "Expected bounded WebSocket upgrade headers")
            header.extend(exact(sock, 1))
        lines = header.decode("latin1").split("\r\n")
        if lines[0].split()[1] != "101":
            raise UpgradeRefused(f"Expected WebSocket 101, observed {lines[0]}")
        fields = {key.lower(): value for line in lines[1:] if ":" in line for key, value in [line.split(":", 1)]}
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        require(fields.get("sec-websocket-accept", "").strip() == accept,
                "Expected matching Sec-WebSocket-Accept")
        require(fields.get("sec-websocket-protocol", "").strip() == "binary",
                "Expected WebSocket binary subprotocol")

    def send_frame(self, payload, opcode=2):
        length = len(payload)
        header = bytes([128 | opcode, 128 | min(length, 126)]) if length < 65536 else bytes([128 | opcode, 255])
        if length >= 65536:
            header += struct.pack(">Q", length)
        elif length >= 126:
            header += struct.pack(">H", length)
        mask = secrets.token_bytes(4)
        self.sock.sendall(header + mask + bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload)))

    def sendall(self, payload):
        self.send_frame(payload)

    def recv(self, size):
        while not self.pending:
            first, second = exact(self.sock, 2)
            opcode, final = first & 15, bool(first & 128)
            require(not first & 112 and not second & 128, "Expected unmasked server frame without extensions")
            length = second & 127
            if length in (126, 127):
                length = struct.unpack(">H" if length == 126 else ">Q", exact(self.sock, 2 if length == 126 else 8))[0]
            require(length <= 8 * 1024 * 1024, f"Expected frame <= 8 MiB, observed {length}")
            if opcode >= 8:
                require(final and length <= 125, "Expected bounded final control frame")
            payload = exact(self.sock, length)
            if opcode == 8:
                raise EOFError("WebSocket closed before expected RFB data")
            if opcode == 9:
                self.send_frame(payload, 10)
                continue
            if opcode == 10:
                continue
            require(opcode == (0 if self.fragment else 2), f"Expected binary/continuation frame, observed opcode {opcode}")
            self.fragment = not final
            self.pending.extend(payload)
        result = bytes(self.pending[:size])
        del self.pending[:size]
        return result


class Rfb:
    def __init__(self, stream, helper=None):
        self.stream, self.helper = stream, helper

    def banner(self):
        banner = exact(self.stream, 12)
        require(banner == b"RFB 003.008\n", f"Expected RFB 3.8 banner, observed {banner!r}")

    def authenticate(self, password):
        self.banner()
        self.stream.sendall(b"RFB 003.008\n")
        count = exact(self.stream, 1)[0]
        require(count and 2 in exact(self.stream, count), "Expected VNC authentication security type 2")
        self.stream.sendall(b"\x02")
        challenge = exact(self.stream, 16)
        key = (self.helper.vnc_key if self.helper else vnc_key)(password)
        encrypt = self.helper.des_encrypt if self.helper else des_encrypt
        self.stream.sendall(encrypt(key, challenge[:8]) + encrypt(key, challenge[8:]))
        status = struct.unpack(">I", exact(self.stream, 4))[0]
        require(status == 0, f"Expected VNC authentication success, observed status {status}")
        self.stream.sendall(b"\x01")
        initial = exact(self.stream, 24)
        width, height = struct.unpack(">HH", initial[:4])
        length = struct.unpack(">I", initial[20:])[0]
        require(length <= 65536, f"Expected bounded ServerInit name, observed {length}")
        exact(self.stream, length)
        require((width, height) == (1280, 900), f"Expected ServerInit 1280x900, observed {width}x{height}")
        return width, height

    def pointer(self, x, y, buttons=0):
        self.stream.sendall(struct.pack(">BBHH", 5, buttons, x, y))

    def keys(self, *keysyms):
        for key in keysyms:
            self.stream.sendall(struct.pack(">BBxxI", 4, 1, key))
        for key in reversed(keysyms):
            self.stream.sendall(struct.pack(">BBxxI", 4, 0, key))

    def close_window(self):
        for key, down in ((0xffe9, 1), (0xffc1, 1), (0xffc1, 0), (0xffe9, 0)):
            self.stream.sendall(struct.pack(">BBxxI", 4, down, key))  # Alt+F4

    def pixels(self, rectangle):
        x, y, width, height = rectangle
        require(0 <= x < x + width <= 1280 and 0 <= y < y + height <= 900,
                f"Expected pixel request inside one screen, observed {rectangle}")
        pixel_format = struct.pack(">BBBBHHHBBBxxx", 32, 24, 0, 1, 255, 255, 255, 16, 8, 0)
        self.stream.sendall(b"\x00\0\0\0" + pixel_format)
        self.stream.sendall(struct.pack(">BxHi", 2, 1, 0))
        self.stream.sendall(struct.pack(">BBHHHH", 3, 0, *rectangle))
        pixels, covered = [None] * (width * height), 0
        for _ in range(64):
            kind = exact(self.stream, 1)[0]
            if kind == 2:
                continue
            if kind == 3:
                length = struct.unpack(">xxxI", exact(self.stream, 7))[0]
                require(length <= 65536, f"Expected bounded clipboard, observed {length}")
                exact(self.stream, length)
                continue
            require(kind == 0, f"Expected framebuffer update, observed RFB message {kind}")
            count = struct.unpack(">xH", exact(self.stream, 3))[0]
            require(count <= 4096, f"Expected bounded rectangles, observed {count}")
            for _ in range(count):
                rx, ry, rw, rh, encoding = struct.unpack(">HHHHi", exact(self.stream, 12))
                require(encoding == 0 and 0 < rw <= 1280 and 0 < rh <= 900 and rx + rw <= 1280 and ry + rh <= 900,
                        f"Expected bounded raw rectangle, observed {(rx, ry, rw, rh, encoding)}")
                data = exact(self.stream, rw * rh * 4)
                for yy in range(max(y, ry), min(y + height, ry + rh)):
                    for xx in range(max(x, rx), min(x + width, rx + rw)):
                        offset = ((yy - ry) * rw + xx - rx) * 4
                        index = (yy - y) * width + xx - x
                        if pixels[index] is None:
                            covered += 1
                        pixels[index] = data[offset:offset + 3]
            if covered == width * height:
                return pixels
        raise AssertionError(f"Expected {width * height} raw pixels, observed {covered}")


def png(pixels, width=1280, height=900):
    """Encode raw BGR pixels as an 8-bit RGB PNG with filter-zero rows."""
    require(len(pixels) == width * height, "Expected a full screen of pixels")
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\0" + b"".join(pixel[::-1] for pixel in pixels[y * width:(y + 1) * width])
                    for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def capture(port, password, screen, *, timeout=10):
    """Blocking capture from the screen's authenticated clipped view; call in a thread."""
    if type(screen) is not int or not 1 <= screen <= 6:
        raise ValueError("Expected screen 1 through 6")
    deadline = time.monotonic() + timeout
    with socket.create_connection(("127.0.0.1", port), timeout=timeout) as sock:
        class BoundedSocket:
            def recv(self, size):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Screen capture timed out")
                sock.settimeout(remaining)
                return sock.recv(size)

            def sendall(self, data):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Screen capture timed out")
                sock.settimeout(remaining)
                sock.sendall(data)

        stream = WebSocket(BoundedSocket(), f"127.0.0.1:{port}", f"/websockify?token=screen-{screen}")
        client = Rfb(stream)
        client.authenticate(password)
        return png(client.pixels((0, 0, 1280, 900)))
