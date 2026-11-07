"""Speech adapters with the existing mono PCM contract and no implicit downloads.

Optional local engines are imported only when selected. Their model must already
exist locally; missing packages/models are configuration errors, never a cloud
fallback. Remote responses and decoded audio are bounded before playback.
"""

import asyncio
import base64
import binascii
import io
import re
import wave
from pathlib import Path
from urllib.parse import quote

from .backend_http import bearer, json_request, need_key, request
from .common import ServiceError

MAX_AUDIO = 20_000_000
MAX_SECONDS = 180
RATE = 44_100
TTS_IDS = ("edge", "piper", "kittentts", "openai", "xai", "elevenlabs", "mistral", "gemini", "deepinfra")
STT_IDS = ("whisper", "openai", "groq", "xai", "elevenlabs", "mistral", "deepinfra")


def _base64(value, service):
    try:
        if not isinstance(value, str) or len(value) > MAX_AUDIO * 4 // 3 + 4:
            raise ValueError
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise ServiceError("bad_response", service=service) from None


def pcm(raw, service, *, raw_rate=0):
    import numpy as np
    import soundfile as sf
    import soxr

    try:
        if not raw or len(raw) > MAX_AUDIO:
            raise ValueError
        if raw_rate:
            if len(raw) % 2:
                raise ValueError
            samples, rate = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768, raw_rate
        else:
            with sf.SoundFile(io.BytesIO(raw)) as audio:
                rate = audio.samplerate
                if audio.channels not in (1, 2) or not 8000 <= rate <= 192000 or audio.frames > rate * MAX_SECONDS:
                    raise ValueError
                samples = audio.read(dtype="float32", always_2d=True).mean(axis=1)
        if not len(samples) or len(samples) > rate * MAX_SECONDS or not np.isfinite(samples).all():
            raise ValueError
        if rate != RATE:
            samples = soxr.resample(samples, rate, RATE)
        result = (np.clip(samples, -1, 32767 / 32768) * 32768).astype("<i2").tobytes()
        if len(result) > MAX_AUDIO:
            raise ValueError
        return result
    except (ValueError, RuntimeError, OSError):
        raise ServiceError("bad_response", service=service) from None


def _local_model(model, service):
    path = Path(model).expanduser()
    if not model or not path.exists():
        raise ServiceError("not_configured", service=service)
    return path


def _local_speech(service, text, voice, model):
    path = _local_model(model, service)
    try:
        if service == "piper":
            from piper import PiperVoice
            if not path.is_file() or not path.with_suffix(path.suffix + ".json").is_file():
                raise ServiceError("not_configured", service=service)
            output = io.BytesIO()
            with wave.open(output, "wb") as audio:
                PiperVoice.load(str(path)).synthesize_wav(text, audio)
            return pcm(output.getvalue(), service)
        from kittentts import KittenTTS
        if not path.is_dir() or not (path / "config.json").is_file() or not list(path.glob("*.onnx")):
            raise ServiceError("not_configured", service=service)
        import numpy as np
        samples = KittenTTS(str(path)).generate(text, voice=voice or "Jasper", speed=1.0)
        raw = (np.clip(samples, -1, 32767 / 32768) * 32768).astype("<i2").tobytes()
        return pcm(raw, service, raw_rate=24000)
    except ImportError:
        raise ServiceError("needs_install", service=service) from None
    except ServiceError:
        raise
    except Exception:
        raise ServiceError("local_error", service=service) from None


async def _edge(text, voice):
    try:
        import edge_tts
        raw = bytearray()
        async for part in edge_tts.Communicate(text, voice or "en-US-AriaNeural").stream():
            if part.get("type") == "audio":
                raw.extend(part["data"])
                if len(raw) > MAX_AUDIO:
                    raise ServiceError("too_large", service="edge")
        return await asyncio.to_thread(pcm, raw, "edge")
    except ImportError:
        raise ServiceError("needs_install", service="edge") from None
    except ServiceError:
        raise
    except Exception:
        raise ServiceError("network", service="edge") from None


async def speech(service, text, *, http, key=None, voice="", model=""):
    """Yield bounded 44.1 kHz signed little-endian PCM for the selected provider."""
    if service not in TTS_IDS:
        raise ServiceError("not_configured", service=service)
    if not isinstance(text, str) or not text.strip():
        raise ServiceError("bad_arguments", service=service)
    text = text[:1000]
    try:
        async with asyncio.timeout(60):
            if service == "edge":
                output = await _edge(text, voice)
            elif service in ("piper", "kittentts"):
                output = await asyncio.to_thread(_local_speech, service, text, voice, model)
            else:
                output = await _remote_speech(service, text, http, key, voice, model)
    except TimeoutError:
        raise ServiceError("timeout", service=service) from None
    # Buffered providers share the playback contract; Fish retains its live stream.
    for start in range(0, len(output), 16384):
        yield output[start:start + 16384]


async def _remote_speech(service, text, http, key, voice, model):
    headers = bearer(service, key)
    raw_rate = 0
    if service in ("openai", "deepinfra"):
        if service == "deepinfra" and not model:
            raise ServiceError("not_configured", service=service)
        base = "https://api.openai.com/v1" if service == "openai" else "https://api.deepinfra.com/v1/openai"
        raw, _ = await request(http, service, "POST", base + "/audio/speech", headers=headers,
            json={"model": model or "gpt-4o-mini-tts", "input": text, "voice": voice or "alloy", "response_format": "wav"})
    elif service == "xai":
        raw, _ = await request(http, service, "POST", "https://api.x.ai/v1/tts", headers=headers,
            json={"text": text, "voice_id": voice or "eve", "language": "auto", "output_format": {"codec": "wav"}})
    elif service == "elevenlabs":
        raw, _ = await request(http, service, "POST", "https://api.elevenlabs.io/v1/text-to-speech/" + quote(voice or "pNInz6obpgDQGcFmaJgB", safe="") + "/stream",
            headers={"xi-api-key": need_key(service, key)}, params={"output_format": "pcm_44100"},
            json={"text": text, "model_id": model or "eleven_multilingual_v2"})
        raw_rate = RATE
    elif service == "mistral":
        data = await json_request(http, service, "POST", "https://api.mistral.ai/v1/audio/speech", headers=headers,
            json={"input": text, "voice_id": voice or "c69964a6-ab8b-4f8a-9465-ec0925096ec8", "model": model or "voxtral-mini-tts-2603", "response_format": "wav"})
        raw = _base64(data.get("audio_data"), service)
    else:
        data = await json_request(http, service, "POST", "https://generativelanguage.googleapis.com/v1beta/models/" + quote(model or "gemini-2.5-flash-preview-tts", safe="") + ":generateContent",
            headers={"x-goog-api-key": need_key(service, key)}, json={"contents": [{"parts": [{"text": text}]}],
                "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice or "Kore"}}}}})
        try:
            part = data["candidates"][0]["content"]["parts"][0]["inlineData"]
            if not part.get("mimeType", "").startswith("audio/L16;codec=pcm;rate=24000"):
                raise ValueError
            raw, raw_rate = _base64(part["data"], service), 24000
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            raise ServiceError("bad_response", service=service) from None
    return await asyncio.to_thread(pcm, raw, service, raw_rate=raw_rate)


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
