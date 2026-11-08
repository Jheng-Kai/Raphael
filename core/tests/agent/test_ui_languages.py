"""Offline contracts for complete localized fixed copy and owner-directed authored speech."""
import pytest
import ast
from pathlib import Path
from string import Formatter

from raphael_core.agent import persona
from raphael_core.agent.actions import _sentence
from raphael_core.agent.public_events import event_record
from raphael_core.agent.speaker import RAPHAEL_NAMES
from raphael_core.agent.team_admin import confirmation
from raphael_core.computer.words import answers, step_line, target
from raphael_core.failures import classify
from raphael_core.messaging.words import compose, plain_replies, words
from raphael_core.ui_languages import LANGUAGES, fixed_language, normalize_language
from raphael_core.ui_words import NEW_LANGUAGES, WORDS, ui_word
from raphael_core.integrations.catalog import SERVICES
from raphael_core.members.event_catalog import available_events
from raphael_core.members.events import failure_message
from raphael_core.sign_in_page import chatgpt_page, language_of
from raphael_core.computer.run import system_prompt as computer_prompt


@pytest.mark.parametrize(("value", "expected"), [
    ("zh-CN", "zh-CN"), ("zh_Hans", "zh-CN"), ("zh-SG", "zh-CN"), ("zh-Hant", "zh-TW"),
    ("ko-KR", "ko"), ("pt", "pt-BR"), ("pt_BR", "pt-BR"), ("es-MX", "es"),
    ("fr-FR", "fr"), ("de-DE", "de"), ("it-IT", "it"), ("ru-RU", "ru"),
    ("vi-VN", "vi"), ("th-TH", "th"), ("id-ID", "id"), ("tr-TR", "tr"),
    ("jargon", "en"), ("zho", "en"), ("ar", "en"),
])
def test_locale_aliases(value, expected):
    assert normalize_language(value) == expected


@pytest.mark.parametrize("language", LANGUAGES)
def test_locale_reaches_all_brain_paths_without_overriding_owner_language(language):
    member = dict(name="Test assistant", role="Assistant", instructions="Answer in the owner's language.")
    prompts = [
        persona.system_prompt(language, "answer"),
        persona.worker_system_prompt(language, model_calls=2, tool_calls=3),
        persona.cli_system_prompt(language),
        persona.cli_system_prompt(language, **member),
        persona.member_system_prompt(language, "answer", **member),
        persona.member_worker_system_prompt(language, **member, model_calls=2, tool_calls=3),
        computer_prompt(language),
    ]
    for prompt in prompts:
        assert persona.REPLY_LANGUAGE in prompt
        assert f"Interface locale: {language} " in prompt
        assert "This selects fixed UI labels only." in prompt
    assert RAPHAEL_NAMES[language]
    assert persona.ACTIVITY_LABELS[language]["working"]
    assert len(persona.PREFIXES[language]) == 5
    text = "word " * 200
    line, rest = persona.fit_text(text, language)
    assert line and rest


@pytest.mark.parametrize("language", LANGUAGES[3:])
def test_new_locales_have_translated_fixed_copy_and_natural_prefixes(language):
    assert fixed_language(language) == language
    assert persona.phrase(language, "offline") != persona.phrase("en", "offline")
    assert persona.fixed_line(language, persona.phrase(language, "copied"), "ja") == persona.phrase("ja", "copied")
    assert answers(language) != answers("en")
    assert target(language, "") != "this item"
    assert step_line(language, "click", target="Test").startswith("《" + persona.PREFIXES[language].notice)
    assert confirmation("group_rename", {"name": "Test"}, language)
    assert words(language, "voice_empty") != words("en", "voice_empty")
    assert classify("offline", record=False).sentence("Test", language)
    assert _sentence("local_exec", {"command": "echo test"}, language)
    message = compose(persona.PREFIXES[language].notice, persona.phrase(language, "copied"), None)
    assert plain_replies([message]) == [persona.phrase(language, "copied")]
    assert message.startswith("《" + persona.PREFIXES[language].notice + ("。" if language == "zh-CN" else ". "))
    assert event_record("routine_create", {"routine": {"id": 1, "title": "Test", "member_id": 0,
                        "schedule": {"kind": "daily", "time": "09:00"}}}, language)


def test_korean_lead_word_and_english_no_alias_are_natural():
    assert persona.PREFIXES["ko"].notice == "알림"
    assert persona.canonical_prefix("No.", "ko", default="unknown") == "거절"


def test_core_catalog_is_complete_and_preserves_every_formatted_field():
    def fields(text):
        return sorted((field, spec, conversion) for _, field, spec, conversion in Formatter().parse(text) if field is not None)
    for source, translations in WORDS.items():
        assert set(translations) == set(NEW_LANGUAGES), source
        for locale, text in translations.items():
            assert text.strip(), (source, locale)
            assert fields(text) == fields(source), (source, locale)
    assert ui_word("Unknown future text", "unknown") == "Unknown future text"
    assert persona.phrase("ar", "offline") == persona.phrase("en", "offline")
    with pytest.raises(KeyError):
        ui_word("Untranslated supported-locale text", "ko")


def test_every_explicit_dynamic_ui_template_has_a_translation():
    root = Path(__file__).resolve().parents[2] / "src/raphael_core"
    for file in root.rglob("*.py"):
        if file.name == "_ui_words_data.py":
            continue
        for node in ast.walk(ast.parse(file.read_text(encoding="utf-8-sig"))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "ui_word":
                if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                    assert node.args[0].value in WORDS, (file.relative_to(root), node.lineno, node.args[0].value)


@pytest.mark.parametrize("language", NEW_LANGUAGES)
def test_store_events_and_signin_pages_are_translated(language):
    for service in SERVICES:
        for table in (service.summary, service.about, service.examples):
            assert set(table) == set(LANGUAGES)
            assert table[language] != table["en"]
    events = available_events([{"id": "test", "source": "composio", "status": "ready", "services": ["gmail"]}], language)
    assert events and events[0]["label"] != "New mail"
    assert failure_message(language, "Test") != failure_message("en", "Test")
    assert failure_message(language, "Test", stop=True) != failure_message("en", "Test", stop=True)
    assert language_of(language) == language
    page = chatgpt_page(language, "ok")
    body = page.body.decode()
    assert "Connected to ChatGPT" not in body
    assert 'lang="' + language + '"' in body
