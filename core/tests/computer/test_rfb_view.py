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
