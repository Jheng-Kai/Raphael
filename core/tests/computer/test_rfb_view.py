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


def test_one_rectangle_is_held_at_a_time_and_a_picture_is_whole_only_at_an_updates_end():
    # Review D-05: an update may name 4096 rectangles of a whole screen each; holding them all until the update
    # ended let a view's server make the core hold 18 GB.
    def rectangle(x, y, width, height):
        return struct.pack(">HHHHi", x, y, width, height, 0) + bytes(width * height * 4)
    served = struct.pack(">BxH", 0, 3) + rectangle(0, 0, 4, 2) + rectangle(1, 1, 2, 1) + rectangle(5, 5, 1, 1)
    stream = RawStream(served)
    reading = rfb_view.Rfb(stream).updates((0, 0, 1280, 900))
    assert next(reading)[:4] == (0, 0, 4, 2) and len(stream.data) == len(served) - 4 - 12 - 32
    assert next(reading)[:4] == (1, 1, 2, 1) and next(reading)[:4] == (5, 5, 1, 1)
    assert next(reading) is None and not stream.data
    # A screen that is whole before its update ends is still refused when a later rectangle of that update is bad.
    whole = struct.pack(">HHHHi", 0, 0, 1280, 900, 0) + bytes(1280 * 900 * 4)
    bad = struct.pack(">HHHHi", 1279, 0, 2, 1, 0)
    with pytest.raises(AssertionError, match="bounded raw rectangle"):
        rfb_view.Rfb(RawStream(struct.pack(">BxH", 0, 2) + whole + bad)).frame()


class SentStream:
    def __init__(self):
        self.sent = []

    def sendall(self, data):
        self.sent.append(struct.unpack(">BBxxI", data))


def events(text):
    stream = SentStream()
    rfb_view.Rfb(stream).type_text(text)
    assert all(kind == 4 for kind, _, _ in stream.sent)
    return [(key, down) for _, down, key in stream.sent]


SHIFT = 0xffe1


@pytest.mark.parametrize("character", list('~!@#$%^&*()_+{}|:"<>?') + list("ABZ"))
def test_a_character_that_needs_shift_is_sent_with_shift_held_as_a_person_types_it(character):
    # Measured on a real six-screen computer (2026-11-14): a seat's view server dropped `!@#$%^&*_+{}|:>?~` sent as bare
    # keysyms, and delivered every one with Shift_L held around it. A person's browser holds Shift; a script now does too.
    key = ord(character)
    assert events(character) == [(SHIFT, 1), (key, 1), (key, 0), (SHIFT, 0)]


@pytest.mark.parametrize("character,key", [("a", 97), ("7", 55), (" ", 32), ("/", 47), ("-", 45), (".", 46), ("'", 39),
                                           ("\n", 0xff0d), ("\t", 0xff09)])
def test_a_character_that_needs_no_shift_is_sent_alone(character, key):
    assert events(character) == [(key, 1), (key, 0)]


def test_a_line_is_typed_in_order_and_one_shift_never_stays_down():
    sent = events("A@b\n")
    assert [key for key, down in sent if down] == [SHIFT, 65, SHIFT, 64, 98, 0xff0d]
    held = 0
    for key, down in sent:
        if key == SHIFT:
            held += 1 if down else -1
            assert held in (0, 1)
    assert held == 0


@pytest.mark.parametrize("character", ["é", "漢", "\x00", "\r"])
def test_a_character_of_another_layout_is_refused_rather_than_sent_wrong(character):
    with pytest.raises(AssertionError, match="printable ASCII"):
        events(character)
