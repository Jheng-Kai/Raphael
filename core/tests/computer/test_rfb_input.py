import struct

import pytest

from raphael_core.computer.rfb_input import RfbInputGate, frame


def payload(wire):
    if not wire:
        return b""
    size, offset = wire[1] & 127, 2
    if size in (126, 127):
        count = 2 if size == 126 else 8
        size = int.from_bytes(wire[offset:offset + count], "big")
        offset += count
    mask = wire[offset:offset + 4]
    return bytes(value ^ mask[index % 4] for index, value in enumerate(wire[offset + 4:offset + 4 + size]))


def ready(allowed):
    gate = RfbInputGate(allowed)
    handshake = b"RFB 003.008\n\x02" + bytes(16) + b"\x01"
    assert payload(gate.feed(frame(handshake))) == handshake
    return gate


def test_persistent_socket_gates_key_pointer_clipboard_and_extended_keys_at_each_lease_switch():
    held = [False]
    gate = ready(lambda: held[0])
    display = b"\x03" + bytes(9)
    inputs = [b"\x04" + bytes(7), b"\x05" + bytes(5), b"\x06\0\0\0" + struct.pack("!I", 4) + b"test", b"\xff" + bytes(11)]
    for state in [False, True, False, True]:
        held[0] = state
        assert payload(gate.feed(frame(display))) == display
        for message in inputs:
            assert payload(gate.feed(frame(message))) == (message if state else b"")


def test_buffered_input_is_denied_when_control_is_returned_before_its_last_byte():
    held = [True]
    gate = ready(lambda: held[0])
    wire = frame(b"\x04" + bytes(7))
    assert gate.feed(wire[:-1]) == b""
    held[0] = False
    assert gate.feed(wire[-1:]) == b""


def test_split_websocket_and_rfb_messages_preserve_display_requests():
    gate = ready(lambda: False)
    wire = frame(b"\x03" + bytes(9))
    output = b"".join(gate.feed(bytes([value])) for value in wire)
    assert payload(output) == b"\x03" + bytes(9)


def test_handback_releases_held_keys_and_buttons_without_reconnecting():
    gate = ready(lambda: True)
    key = b"\x04\x01\0\0\0\0\0a"
    pointer = b"\x05\x01\0\x10\0\x20"
    gate.feed(frame(key + pointer))
    assert payload(gate.release()) == b"\x04\0\0\0\0\0\0a\x05\0\0\x10\0\x20"
    assert gate.release() == b""


@pytest.mark.parametrize("wire", [b"\x82\x00", frame(b"RFB 003.003\n"), b"\x82\xff" + struct.pack("!Q", 2**21)])
def test_unknown_protocol_unmasked_and_oversized_frames_fail_closed(wire):
    with pytest.raises(ValueError):
        RfbInputGate(lambda: True).feed(wire)
