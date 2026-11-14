"""Which microphone 「自動偵測」 (automatic) picks, and how it keeps that choice still.

Pure logic with no audio in it; `audio.py` feeds it the microphones PortAudio lists. The rules
(R-MIC-AUTO-01):

* A loopback ("Stereo Mix", 「立體聲混音」: what the speakers play) is never a microphone, whatever
  else is there.
* An attached microphone (a headset, a USB or a jack microphone) comes before a laptop's built-in
  array. Nothing here names a maker: a built-in array is recognised by what Windows calls it.
* The choice does not move while it stays there. It moves when the microphone it is on goes away,
  or when another external microphone is plugged in (one the previous look did not list). It never
  moves because of a sound level, the order PortAudio lists them in, or the Windows default.
* Nothing that happens at the start of a recording moves it: a headset with a noise gate or a muted
  boom returns digital silence until someone speaks, and nobody speaks in the first moment
  (owner, 2026-11-14: the start of every recording sent automatic from his quiet headset to the
  laptop's array, and it jumped between the two). Only a microphone that gave digital silence for two
  whole recordings in a row (each of `SILENT_RECORDING_S` or more) and was never heard is tried after
  the others, until it is heard or plugged in again.

Windows (MME) numbers microphones that share a name, 「麥克風 (3- HyperX Cloud II Core Wi」, and the
number changes with the port or after a replug, so a microphone is known by its name without it.
"""

import re
import threading
from collections.abc import Iterable
from typing import Protocol, TypeVar

# What the speakers play, in the words Windows uses around the world. Matched on the lower-cased name.
_LOOPBACK = re.compile(
    r"stereo[\s_-]*mix|stereomix|what[\s_-]*(u|you)[\s_-]*hear|loopback|wave[\s_-]*out[\s_-]*mix"
    r"|mixage|mezcla est|mixagem|立體聲混音|立体声混音|立體聲混合|ステレオ\s*ミキサー|스테레오\s*믹스"
    r"|стерео\s*микшер|что\s*слышит"
)
# A laptop's own array, in the words Windows uses around the world.
_BUILT_IN = re.compile(
    r"array|麥克風排列|麥克風陣列|麦克风阵列|マイク\s*アレイ|마이크\s*배열|matrice|matriz de micr"
    r"|mikrofonarray|built[\s-]*in|integrated|internal|內建|内置|内蔵"
)
# How long a recording must be for its silence to say anything about the microphone, and how many silent
# recordings in a row pass one over.
SILENT_RECORDING_S = 2.0
SILENT_RECORDINGS = 2
# 「麥克風 (3- HyperX Cloud II Core Wi」: the number Windows puts in front of a duplicate name.
_ORDINAL = re.compile(r"\(\s*\d+\s*-\s*")


class Microphone(Protocol):
    index: int
    name: str
    is_default: bool


M = TypeVar("M", bound=Microphone)


def device_key(name: str) -> str:
    """The name of a microphone without the number Windows may put in it."""
    return _ORDINAL.sub("(", name).strip().casefold()


def is_loopback(name: str) -> bool:
    return _LOOPBACK.search(name.casefold()) is not None


def is_built_in(name: str) -> bool:
    return _BUILT_IN.search(name.casefold()) is not None


class AutomaticMicrophone:
    """What automatic remembers between looks at the microphones: whom it is on, who was heard, who gave nothing."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._seen: set[str] | None = None  # the keys the previous look listed; None before any
        self._preferred: str | None = None  # the key of the external microphone it is on
        self._heard: set[str] = set()
        self._silent: dict[str, int] = {}  # silent whole recordings in a row, by key

    def rank(self, devices: Iterable[M]) -> list[M]:
        """The usable microphones, the one automatic uses first.

        Every call is a look at the list: a microphone that was not in the previous look is new,
        and one that is gone is forgotten (it is new again when it comes back).
        """
        usable: dict[str, M] = {}
        for device in sorted(devices, key=lambda d: d.index):
            if not is_loopback(device.name):
                usable.setdefault(device_key(device.name), device)
        external = {key: d for key, d in usable.items() if not is_built_in(d.name)}
        built_in = [d for key, d in usable.items() if key not in external]
        with self._lock:
            new = set() if self._seen is None else set(usable) - self._seen
            first_look = self._seen is None
            self._seen = set(usable)
            self._heard &= set(usable)
            # A microphone that went away, or came back, is a new one: its silent recordings are forgotten.
            self._silent = {key: count for key, count in self._silent.items() if key in usable and key not in new}
            arrived = [external[key] for key in external if key in new]
            if arrived and not first_look:
                self._preferred = device_key(max(arrived, key=lambda d: d.index).name)
            elif self._preferred not in external:
                self._preferred = self._first_external(external)
            preferred = self._preferred
        ordered = [external[preferred]] if preferred in external else []
        ordered += [d for key, d in external.items() if key != preferred]
        ordered += built_in
        with self._lock:
            passed = {key for key, count in self._silent.items() if count >= SILENT_RECORDINGS}
        return [d for d in ordered if device_key(d.name) not in passed] + [d for d in ordered if device_key(d.name) in passed]

    @staticmethod
    def _first_external(external: dict[str, M]) -> str | None:
        if not external:
            return None
        flagged = [key for key, d in external.items() if d.is_default]
        return (flagged or list(external))[0]

    def heard(self, name: str) -> None:
        """This microphone gave a real signal: it is not replaced for being quiet."""
        with self._lock:
            self._heard.add(device_key(name))

    def was_heard(self, name: str) -> bool:
        with self._lock:
            return device_key(name) in self._heard

    def recorded(self, name: str, *, loud: bool, seconds: float) -> bool:
        """A recording on this microphone ended: it gave sound (`loud`) or digital silence for `seconds`. Answers
        whether this recording made it one that is tried after the others."""
        key = device_key(name)
        with self._lock:
            if loud:
                self._heard.add(key)
                self._silent.pop(key, None)
                return False
            if key in self._heard or seconds < SILENT_RECORDING_S:
                return False
            self._silent[key] = self._silent.get(key, 0) + 1
            return self._silent[key] == SILENT_RECORDINGS
