"""Tests for which microphone automatic picks (R-MIC-AUTO-01). No audio device is involved."""

import itertools
from dataclasses import dataclass

import pytest

from raphael_core.device.mic_choice import (
    AutomaticMicrophone,
    device_key,
    is_built_in,
    is_loopback,
)

HEADSET = "麥克風 (3- HyperX Cloud II Core Wi"
MIX = "立體聲混音 (Realtek(R) Audio)"
ARRAY = "麥克風排列 (Realtek(R) Audio)"
USB = "Microphone (USB PnP Sound Device)"


@dataclass(frozen=True)
class Mic:
    index: int
    name: str
    is_default: bool = False


def mics(*names: str, default: str | None = None) -> list[Mic]:
    return [Mic(i, name, name == default) for i, name in enumerate(names)]


def first(auto: AutomaticMicrophone, devices: list[Mic]) -> str | None:
    ranked = auto.rank(devices)
    return ranked[0].name if ranked else None


@pytest.mark.parametrize("order", list(itertools.permutations([HEADSET, MIX, ARRAY])))
def test_the_owners_devices_give_the_headset_in_whatever_order_they_are_listed(order):
    ranked = AutomaticMicrophone().rank(mics(*order))
    assert [d.name for d in ranked] == [HEADSET, ARRAY]


@pytest.mark.parametrize("default", [HEADSET, MIX, ARRAY, None])
def test_the_windows_default_does_not_move_the_choice_off_the_headset(default):
    auto = AutomaticMicrophone()
    devices = mics(MIX, ARRAY, HEADSET, default=default)
    assert [first(auto, devices) for _ in range(5)] == [HEADSET] * 5


def test_the_choice_is_the_same_across_many_looks():
    auto = AutomaticMicrophone()
    devices = mics(HEADSET, MIX, ARRAY)
    assert {first(auto, devices) for _ in range(50)} == {HEADSET}


def test_a_loopback_is_never_chosen_even_when_it_is_all_there_is():
    auto = AutomaticMicrophone()
    assert auto.rank(mics(MIX)) == []
    assert auto.rank(mics(MIX, "Stereo Mix (Realtek(R) Audio)")) == []


@pytest.mark.parametrize(
    "name",
    [
        "Stereo Mix (Realtek High Definition Audio)",
        "立體聲混音 (Realtek(R) Audio)",
        "立体声混音 (Realtek High Definition Audio)",
        "Stereomix (Realtek High Definition Audio)",
        "Mixage stéréo (Realtek High Definition Audio)",
        "Mezcla estéreo (Realtek High Definition Audio)",
        "What U Hear (Sound Blaster)",
        "Loopback (Virtual Device)",
        "ステレオ ミキサー (Realtek High Definition Audio)",
    ],
)
def test_loopbacks_are_recognised_by_the_words_windows_uses(name):
    assert is_loopback(name)
    assert not is_built_in(name)


@pytest.mark.parametrize(
    "name",
    [
        "麥克風排列 (Realtek(R) Audio)",
        "Microphone Array (Realtek High Definition Audio)",
        "Internal Microphone (Conexant)",
    ],
)
def test_a_built_in_array_is_recognised_by_what_windows_calls_it(name):
    assert is_built_in(name)
    assert not is_loopback(name)


@pytest.mark.parametrize(
    "name",
    [HEADSET, "Headset Microphone (USB Audio)", "麥克風 (2- USB PnP Sound Device)", "Microphone (C920)"],
)
def test_an_attached_microphone_is_neither_a_loopback_nor_built_in(name):
    assert not is_loopback(name)
    assert not is_built_in(name)


def test_a_microphone_is_known_by_its_name_without_the_number_windows_adds():
    assert device_key("麥克風 (3- HyperX Cloud II Core Wi") == device_key("麥克風 (5- HyperX Cloud II Core Wi")
    assert device_key("麥克風 (HyperX Cloud II Core Wi") == device_key(HEADSET)
    assert device_key(ARRAY) != device_key(HEADSET)


def test_a_renumbered_headset_is_the_same_microphone_not_a_new_one():
    auto = AutomaticMicrophone()
    other = "Headset Microphone (2- USB Audio)"
    assert first(auto, mics(HEADSET, other, ARRAY)) == HEADSET
    renumbered = "麥克風 (4- HyperX Cloud II Core Wi"
    assert first(auto, mics(other, renumbered, ARRAY)) == renumbered  # not switched to `other`


def test_unplugging_the_headset_gives_the_array_and_plugging_it_back_gives_the_headset():
    auto = AutomaticMicrophone()
    assert first(auto, mics(HEADSET, MIX, ARRAY)) == HEADSET
    assert first(auto, mics(MIX, ARRAY)) == ARRAY
    assert first(auto, mics(MIX, ARRAY)) == ARRAY  # and stays there
    back = "麥克風 (5- HyperX Cloud II Core Wi"
    assert first(auto, mics(MIX, ARRAY, back)) == back
    assert first(auto, mics(MIX, ARRAY, back)) == back


def test_a_second_attached_microphone_plugged_in_takes_over_and_then_stays():
    auto = AutomaticMicrophone()
    assert first(auto, mics(HEADSET, ARRAY)) == HEADSET
    assert first(auto, mics(HEADSET, ARRAY, USB)) == USB
    assert {first(auto, mics(HEADSET, ARRAY, USB)) for _ in range(10)} == {USB}
    # the one it is on goes away: the other attached one, not the array
    assert first(auto, mics(HEADSET, ARRAY)) == HEADSET


def test_the_choice_stays_while_a_later_listed_microphone_is_already_there():
    auto = AutomaticMicrophone()
    devices = mics(HEADSET, USB, ARRAY)
    assert first(auto, devices) == HEADSET
    assert {first(auto, devices) for _ in range(10)} == {HEADSET}


def test_plugging_in_the_array_or_a_loopback_never_moves_the_choice():
    auto = AutomaticMicrophone()
    assert first(auto, mics(HEADSET)) == HEADSET
    assert first(auto, mics(HEADSET, MIX)) == HEADSET
    assert first(auto, mics(HEADSET, MIX, ARRAY)) == HEADSET


def test_with_only_the_array_an_attached_microphone_plugged_in_takes_over():
    auto = AutomaticMicrophone()
    assert first(auto, mics(MIX, ARRAY)) == ARRAY
    assert first(auto, mics(MIX, ARRAY, HEADSET)) == HEADSET


def test_the_first_look_prefers_the_windows_default_among_attached_microphones():
    assert first(AutomaticMicrophone(), mics(HEADSET, USB, ARRAY, default=USB)) == USB
    assert first(AutomaticMicrophone(), mics(HEADSET, USB, ARRAY)) == HEADSET


def test_a_microphone_that_was_heard_is_forgotten_when_it_is_unplugged():
    auto = AutomaticMicrophone()
    auto.rank(mics(HEADSET, ARRAY))
    auto.heard(HEADSET)
    assert auto.was_heard("麥克風 (7- HyperX Cloud II Core Wi")
    assert not auto.was_heard(ARRAY)
    auto.rank(mics(ARRAY))
    assert not auto.was_heard(HEADSET)


def test_no_microphones_gives_nothing():
    assert AutomaticMicrophone().rank([]) == []
