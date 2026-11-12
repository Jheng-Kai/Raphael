"""Product screen capture uses the acceptance protocol peer, without real sockets."""

import struct
import zlib

import pytest

from raphael_core.computer import rfb_view
from raphael_core.evaluate import computer_acceptance
from evaluate.test_computer_acceptance import MemoryServer


def decode_png(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    offset, compressed = 8, bytearray()
    while offset < len(data):
        length = int.from_bytes(data[offset:offset + 4], "big")
        kind, payload = data[offset + 4:offset + 8], data[offset + 8:offset + 8 + length]
        assert zlib.crc32(kind + payload) == int.from_bytes(data[offset + 8 + length:offset + 12 + length], "big")
        offset += length + 12
        if kind == b"IHDR":
            width, height, depth, color, *rest = struct.unpack(">IIBBBBB", payload)
            assert (depth, color, rest) == (8, 2, [0, 0, 0])
        elif kind == b"IDAT":
            compressed.extend(payload)
    raw = zlib.decompress(compressed)
    stride = width * 3 + 1
    assert len(raw) == stride * height
    assert all(raw[y * stride] == 0 for y in range(height))
    return width, height, b"".join(raw[y * stride + 1:(y + 1) * stride] for y in range(height))


class CaptureServer(MemoryServer):
    closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def settimeout(self, timeout):
        assert 0 < timeout <= 10

    def recv(self, size):
        if self.state == "ready":
            result = bytes(self.output[:size])
            del self.output[:size]
            return result
        return super().recv(size)


@pytest.mark.parametrize("failure", [None, "auth", "size", "upgrade"])
def test_capture_authenticated_clipped_screen_png_and_closes_on_failure(monkeypatch, failure):
    server = CaptureServer(refused=failure == "upgrade", failed_auth=failure == "auth",
                           size=(2560, 1800) if failure == "size" else (1280, 900))
    def connect(address, *, timeout):
        assert address == ("127.0.0.1", 12345) and timeout == 10
        return server
    monkeypatch.setattr(rfb_view.socket, "create_connection", connect)
    if failure:
        with pytest.raises(AssertionError):
            rfb_view.capture(12345, "password", 3)
    else:
        width, height, pixels = decode_png(rfb_view.capture(12345, "password", 3))
        assert (width, height) == (1280, 900)
        assert pixels == b"\x56\x34\x12" * (1280 * 900)
        assert sum(message[0] == 3 for message in server.messages) == 1
        assert server.messages[-1] == struct.pack(">BBHHHH", 3, 0, 0, 0, 1280, 900)
    assert server.closed


def test_acceptance_and_product_share_one_protocol_implementation():
    assert computer_acceptance.Rfb is rfb_view.Rfb
    assert computer_acceptance.WebSocket is rfb_view.WebSocket


def test_capture_has_an_overall_deadline_and_rejects_screen_zero(monkeypatch):
    server = CaptureServer()
    monkeypatch.setattr(rfb_view.socket, "create_connection", lambda *args, **kwargs: server)
    ticks = iter([0, 11])
    monkeypatch.setattr(rfb_view.time, "monotonic", lambda: next(ticks))
    with pytest.raises(TimeoutError):
        rfb_view.capture(12345, "password", 3)
    assert server.closed
    with pytest.raises(ValueError):
        rfb_view.capture(12345, "password", 0)


class RawStream:
    """A server that has already upgraded and authenticated: only the RFB bytes after ServerInit."""

    def __init__(self, data):
        self.data, self.sent = bytearray(data), []

    def recv(self, size):
        result = bytes(self.data[:size])
        del self.data[:size]
        return result

    def sendall(self, data):
        self.sent.append(data)


def test_the_whole_frame_path_makes_the_same_picture_as_the_per_pixel_path():
    def update(*rectangles):
        return struct.pack(">BxH", 0, len(rectangles)) + b"".join(
            struct.pack(">HHHHi", x, y, width, height, 0) + data for x, y, width, height, data in rectangles)
    small = bytes((index * 7 + 3) % 256 for index in range(7 * 3 * 4))
    # Half a screen, a bell, a clipboard, then the other half and a rectangle that overwrites part of both.
    served = (update((0, 0, 640, 900, b"\x10\x20\x30\xff" * (640 * 900))) + b"\x02"
              + b"\x03\0\0\0" + struct.pack(">I", 4) + b"clip"
              + update((640, 0, 640, 900, b"\x01\x02\x03\x00" * (640 * 900)), (637, 50, 7, 3, small)))
    fast, slow = rfb_view.Rfb(RawStream(served)), rfb_view.Rfb(RawStream(served))
    frame = fast.frame()
    assert fast.stream.sent == slow.stream.sent or not slow.stream.sent
    assert len(frame) == 1280 * 900 * 4 and not fast.stream.data
    assert frame[:4] == b"\x10\x20\x30\xff" and frame[-4:] == b"\x01\x02\x03\x00"
    for row in range(3):
        start = ((50 + row) * 1280 + 637) * 4
        assert frame[start:start + 28] == small[row * 28:(row + 1) * 28]
    picture = rfb_view.png_frame(frame)
    assert picture == rfb_view.png(slow.pixels((0, 0, 1280, 900)))
    assert fast.stream.sent == slow.stream.sent
    width, height, colours = decode_png(picture)
    assert (width, height) == (1280, 900) and colours[:3] == b"\x30\x20\x10" and colours[-3:] == b"\x03\x02\x01"


def test_a_frame_that_never_arrives_whole_is_refused():
    served = (struct.pack(">BxH", 0, 1) + struct.pack(">HHHHi", 5, 6, 2, 1, 0) + bytes(8)) * 64
    with pytest.raises(AssertionError, match="Expected 1152000 raw pixels, observed 2"):
        rfb_view.Rfb(RawStream(served)).frame()
