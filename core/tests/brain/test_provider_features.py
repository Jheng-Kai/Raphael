"""What each provider kind can do (R-DEFAULT-05): one table for the window and for the speech and media paths."""

from raphael_core.brain.providers.clients import is_transcription
from raphael_core.brain.providers.presets import IMAGE_KINDS, KINDS, SPEECH_KINDS, VIDEO_KINDS


def test_every_kind_says_what_it_can_do_beside_text():
    features = {item["kind"]: item["features"] for item in KINDS}
    assert all(values[0] == "text" for values in features.values())
    assert {kind for kind, values in features.items() if "stt" in values} == SPEECH_KINDS == {"openrouter", "openai", "groq"}
    assert {kind for kind, values in features.items() if "image" in values} == IMAGE_KINDS
    assert {kind for kind, values in features.items() if "video" in values} == VIDEO_KINDS == {"openai", "xai"}
    assert features["anthropic"] == ["text"] and features["ollama"] == ["text"]


def test_the_speech_path_reads_the_same_table():
    assert is_transcription("openai", "whisper-1") and is_transcription("groq", "whisper-large-v3")
    assert not is_transcription("anthropic", "whisper-1") and not is_transcription("openrouter", "whisper-1")
