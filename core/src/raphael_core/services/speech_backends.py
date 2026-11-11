"""Transcription adapters with no implicit downloads.

The optional local engine is imported only when selected. Its model must already
exist locally; a missing package or model is a configuration error, never a cloud
fallback. Audio is bounded before it is sent or decoded.
"""

import asyncio
import io
import re
from pathlib import Path

from .backend_http import bearer, json_request, need_key
from .common import ServiceError

MAX_AUDIO = 20_000_000
STT_IDS = ("whisper", "openai", "groq", "xai", "elevenlabs", "mistral", "deepinfra")


def _local_model(model, service):
    path = Path(model).expanduser()
    if not model or not path.exists():
        raise ServiceError("not_configured", service=service)
    return path


def _whisper(audio, model, language):
    path = _local_model(model, "whisper")
    try:
        from faster_whisper import WhisperModel
        engine = WhisperModel(str(path), device="cpu", compute_type="int8", local_files_only=True)
        segments, _ = engine.transcribe(io.BytesIO(audio), language=None if language == "auto" else language)
        text = ""
        for segment in segments:
            text += segment.text
            if len(text) > 100000:
                raise ServiceError("too_large", service="whisper")
        return text.strip()
    except ImportError:
        raise ServiceError("needs_install", service="whisper") from None
    except ServiceError:
        raise
    except Exception:
        raise ServiceError("local_error", service="whisper") from None


async def transcribe(service, audio, language="auto", *, http, key=None, model=""):
    if service not in STT_IDS:
        raise ServiceError("not_configured", service=service)
    if not audio or len(audio) > MAX_AUDIO:
        raise ServiceError("bad_arguments", service=service)
    if not isinstance(language, str) or not re.fullmatch(r"[A-Za-z-]{2,20}", language):
        raise ServiceError("bad_arguments", service=service)
    if audio.startswith(b"RIFF") and audio[8:12] == b"WAVE":
        filename, mime = "audio.wav", "audio/wav"
    elif audio.startswith(b"OggS"):
        filename, mime = "audio.ogg", "audio/ogg"
    elif audio.startswith(b"fLaC"):
        filename, mime = "audio.flac", "audio/flac"
    elif audio.startswith(b"ID3") or len(audio) > 1 and audio[0] == 255 and audio[1] & 224 == 224:
        filename, mime = "audio.mp3", "audio/mpeg"
    else:
        raise ServiceError("bad_arguments", service=service)
    if service == "whisper":
        text = await asyncio.to_thread(_whisper, audio, model, language)
    else:
        headers = bearer(service, key)
        bases = {"openai": "https://api.openai.com/v1", "groq": "https://api.groq.com/openai/v1", "deepinfra": "https://api.deepinfra.com/v1/openai", "mistral": "https://api.mistral.ai/v1"}
        defaults = {"openai": "whisper-1", "groq": "whisper-large-v3-turbo", "mistral": "voxtral-mini-latest", "xai": "grok-voice-transcribe-2.0"}
        if service == "deepinfra" and not model:
            raise ServiceError("not_configured", service=service)
        data = {"model": model or defaults.get(service, ""), "response_format": "json"}
        if language != "auto":
            data["language"] = language
        if service == "elevenlabs":
            url, headers = "https://api.elevenlabs.io/v1/speech-to-text", {"xi-api-key": need_key(service, key)}
            data = {"model_id": model or "scribe_v2", "tag_audio_events": "false", "diarize": "false"}
            if language != "auto":
                data["language_code"] = language
        elif service == "xai":
            url = "https://api.x.ai/v1/stt"
            data.pop("response_format")
        else:
            url = bases[service] + "/audio/transcriptions"
        result = await json_request(http, service, "POST", url, headers=headers, data=data,
            files={"file": (filename, audio, mime)}, limit=1024 * 1024, timeout=60)
        text = result.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 100000:
        raise ServiceError("bad_response", service=service)
    return text.strip()
