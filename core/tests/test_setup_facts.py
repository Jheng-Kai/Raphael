"""R-SETUP-01: a member reads what this computer lacks for a feature, and how to help the owner set it up."""

import pytest

from raphael_core import setup_facts
from raphael_core.computer.vm_tools import ENGINE_FAILURES


class Engine:
    """The member computers' engine as setup_facts asks it: installed, answering, remote, enabled."""

    def __init__(self, *, enabled=True, remote="", installed=True, answers=True):
        self.enabled, self.remote, self._installed, self._answers = enabled, remote, installed, answers
        self.asked = []

    async def installed(self):
        self.asked.append("installed")
        return self._installed

    async def available(self, target=None):
        self.asked.append("available")
        return self._answers


@pytest.mark.parametrize("engine,expected", [
    (Engine(installed=False), "docker_missing"),
    (Engine(answers=False), "docker_stopped"),
    (Engine(), "running"),
    (Engine(remote="box.example", answers=False), "unreachable"),
    (Engine(remote="box.example"), "running"),
    (Engine(enabled=False), "unavailable"),
    (None, "unavailable"),
], ids=["missing", "stopped", "running", "remote-down", "remote-up", "off", "none"])
async def test_the_computer_says_what_its_engine_lacks_without_starting_it(engine, expected):
    facts = await setup_facts.computer(engine)
    assert facts["state"] == expected
    if expected == "docker_missing":
        assert facts["download"] == setup_facts.DOCKER_DOWNLOAD and facts["system"]
        assert engine.asked == ["installed"]  # nothing is asked of an engine that is not there


def test_dictation_names_the_model_it_lacks():
    on_disk = {"silero-vad"}
    assert setup_facts.dictation("cloud", None, on_disk.__contains__, "silero-vad") == {"engine": "cloud", "voice_detector_ready": True}
    local = setup_facts.dictation("local", "qwen3-asr", on_disk.__contains__, "silero-vad")
    assert local == {"engine": "local", "voice_detector_ready": True, "local_model": "qwen3-asr", "local_model_ready": False}
    assert setup_facts.dictation("local", None, set().__contains__, "silero-vad")["voice_detector_ready"] is False


def test_ffmpeg_is_looked_for_on_the_path(monkeypatch):
    monkeypatch.setattr(setup_facts.shutil, "which", lambda name: None)
    assert setup_facts.programs() == {"ffmpeg": False}
    monkeypatch.setattr(setup_facts.shutil, "which", lambda name: "C:/tools/ffmpeg.exe" if name == "ffmpeg" else None)
    assert setup_facts.programs() == {"ffmpeg": True}


@pytest.mark.parametrize("kind", ["absent", "docker_stopped", "docker_start_failed", "docker_start_timeout", "image_missing",
                                  "pull_failed", "build_failed", "local_capacity", "incompatible", "start_failed"])
def test_every_computer_setup_failure_tells_the_member_what_to_do(kind):
    note = ENGINE_FAILURES[kind]
    assert len(note) > 60 and "owner" in note or kind in ("image_missing", "docker_start_timeout")
