"""Bounded, ephemeral RFB input gate for a persistent noVNC WebSocket.

Only negotiated RFB 3.7/3.8 with None/VNC authentication is accepted. Unknown
messages fail closed. Framebuffer requests continue while owner input is denied.
Accepted messages are exposed transiently to the viewer's explicit owner recorder.
This parser never logs or writes payloads to disk.
"""
import secrets
import struct


def frame(payload, opcode=2):
    mask = secrets.token_bytes(4)
    length = len(payload)
    header = bytes((0x80 | opcode, 0x80 | length)) if length < 126 else (
        bytes((0x80 | opcode, 0x80 | 126)) + struct.pack("!H", length) if length < 65536 else
        bytes((0x80 | opcode, 0x80 | 127)) + struct.pack("!Q", length))
    return header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload))


class RfbInputGate:
    def __init__(self, allowed):
        self.allowed = allowed
        self.wire, self.rfb = bytearray(), bytearray()
        self.phase = "version"
        self.fragmented = False
        self.keys = {}
        self.pointer = None
        self.packets = []

    def release(self):
        """Release only currently held keys/buttons before the member can act again."""
        messages = list(self.keys.values())
        if self.pointer:
            messages.append(self.pointer)
        self.keys.clear()
        self.pointer = None
        return frame(b"".join(messages)) if messages else b""

    def feed(self, data):
        self.packets = []
        self.wire.extend(data)
        if len(self.wire) > 2**20:
            raise ValueError("desktop frame too large")
        output = bytearray()
        while len(self.wire) >= 2:
            first, second = self.wire[:2]
            opcode, length, offset = first & 15, second & 127, 2
            if first & 0x70 or not second & 0x80:
                raise ValueError("invalid desktop frame")
            if length in (126, 127):
                size = 2 if length == 126 else 8
                if len(self.wire) < offset + size:
                    break
                length = int.from_bytes(self.wire[offset:offset + size], "big")
                offset += size
            if length > 2**20:
                raise ValueError("desktop frame too large")
            if len(self.wire) < offset + 4 + length:
                break
            mask = self.wire[offset:offset + 4]
            payload = bytes(value ^ mask[index % 4] for index, value in enumerate(self.wire[offset + 4:offset + 4 + length]))
            del self.wire[:offset + 4 + length]
            if opcode in (8, 9, 10):
                if length > 125 or not first & 0x80:
                    raise ValueError("invalid desktop control frame")
                output.extend(frame(payload, opcode))
                self.packets.append((False, payload, opcode))
                continue
            if opcode not in (0, 2) or (opcode == 0) != self.fragmented:
                raise ValueError("invalid desktop data frame")
            self.fragmented = not bool(first & 0x80)
            self.rfb.extend(payload)
            if len(self.rfb) > 2**20:
                raise ValueError("desktop message too large")
            accepted = self._messages()
            if accepted:
                output.extend(frame(accepted))
        return output

    def _messages(self):
        output = bytearray()
        while self.rfb:
            input_message = False
            phase = self.phase
            if phase == "version":
                length = 12
            elif phase in ("security", "init"):
                length = 1
            elif phase == "auth":
                length = 16
            else:
                kind = self.rfb[0]
                length = {0: 20, 3: 10, 4: 8, 5: 6, 150: 10, 255: 12}.get(kind)
                input_message = kind in (4, 5, 6, 255)
                if kind == 2:
                    if len(self.rfb) < 4:
                        break
                    length = 4 + 4 * int.from_bytes(self.rfb[2:4], "big")
                elif kind == 6:
                    if len(self.rfb) < 8:
                        break
                    length = 8 + abs(int.from_bytes(self.rfb[4:8], "big", signed=True))
                elif kind == 248:
                    if len(self.rfb) < 9:
                        break
                    length = 9 + self.rfb[8]
                elif kind == 251:
                    if len(self.rfb) < 8:
                        break
                    length = 8 + 16 * self.rfb[6]
                if length is None or length > 2**20:
                    raise ValueError("unsupported desktop message")
            if len(self.rfb) < length:
                break
            message = bytes(self.rfb[:length])
            del self.rfb[:length]
            if phase == "version":
                if message not in (b"RFB 003.007\n", b"RFB 003.008\n"):
                    raise ValueError("unsupported desktop protocol")
                self.phase = "security"
            elif phase == "security":
                if message[0] not in (1, 2):
                    raise ValueError("unsupported desktop authentication")
                self.phase = "auth" if message[0] == 2 else "init"
            elif phase == "auth":
                self.phase = "init"
            elif phase == "init":
                self.phase = "ready"
            if not input_message or self.allowed():
                self.packets.append((input_message, message, 2))
                if phase == "ready" and message[0] in (4, 255):
                    extended = message[0] == 255
                    down = int.from_bytes(message[2:4], "big") if extended else message[1]
                    key = message[4:]
                    if down:
                        self.keys[key] = message[:2] + b"\0\0" + message[4:] if extended else message[:1] + b"\0" + message[2:]
                    else:
                        self.keys.pop(key, None)
                    if len(self.keys) > 256:
                        raise ValueError("too many held desktop keys")
                elif phase == "ready" and message[0] == 5:
                    self.pointer = b"\x05\0" + message[2:] if message[1] else None
                output.extend(message)
        return output
