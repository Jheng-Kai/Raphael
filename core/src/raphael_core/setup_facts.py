"""What the app needs from this computer, as a member reads it in self_check's `setup` (R-SETUP-01).

A member asked why its computer, dictation or an audio attachment does not work answers from these facts and helps the
owner set the missing piece up in the conversation (the steps are in self_check's ABOUT, read through raphael_help).
Reading them never starts, installs or downloads anything: Docker is looked up and asked whether it answers, the speech
models are looked for on disk, and ffmpeg on the PATH.
"""

import shutil
import sys

DOCKER_DOWNLOAD = "https://www.docker.com/products/docker-desktop/"


async def computer(vm) -> dict:
    """The member computers' engine: on this PC Docker Desktop installed or not and running or not, or a remote host that
    answers or not. `state` is the one word a member explains; `download` is where Docker Desktop comes from."""
    if vm is None or not vm.enabled:
        return {"state": "unavailable"}
    if vm.remote:
        return {"host": "remote", "state": "running" if await vm.available() else "unreachable"}
    if not await vm.installed():
        return {"host": "this_pc", "state": "docker_missing", "download": DOCKER_DOWNLOAD,
                "system": "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else sys.platform}
    return {"host": "this_pc", "state": "running" if await vm.available() else "docker_stopped"}


def dictation(engine: str | None, local_model: str | None, ready, voice_detector: str) -> dict:
    """Dictation's own pieces: the voice detector every dictation needs, and the local speech model when the engine is
    local. `ready(name)` says whether a model is on disk or loaded."""
    facts = {"engine": engine, "voice_detector_ready": bool(ready(voice_detector))}
    if local_model is not None:
        facts["local_model"] = local_model
        facts["local_model_ready"] = bool(ready(local_model))
    return facts


def programs() -> dict:
    """The programs the app calls on this PC: ffmpeg reads audio and video attachments."""
    return {"ffmpeg": shutil.which("ffmpeg") is not None}
