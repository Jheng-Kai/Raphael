"""Every sentence the app writes into a conversation is in every interface language (R-COPY-07).

A label that exists in three languages and falls back to English for the other twelve reads as a fault to a Korean
or a Spanish owner, and a lookup that raises ends a turn. Three guards, each one walking what the code can produce:
the action labels, the lines of the conversation the core writes on its own, and a scan for tables of words that were
written for some of the interface languages and never went through the catalogue."""
import ast
from collections import Counter
from pathlib import Path

import pytest

from raphael_core.agent.actions import _WORDS, sentence
from raphael_core.agent.cli.loop import _FILE_CHANGE
from raphael_core.messaging.words import question_text
from raphael_core.ui_languages import LANGUAGES
from raphael_core.ui_words import NEW_LANGUAGES

# One call of every kind of action label (`_WORDS` keys): the table is checked against the labels, so a new kind of label
# cannot be added without a call here, and with it every language.
CALLS = {
    "read": ("read_file", {"path": "a/note.md"}, None),
    "write": ("write_file", {"path": "a/note.md"}, None),
    "edit": ("edit_file", {"path": "a/note.md"}, None),
    "search": ("web_search", {"query": "orchard"}, None),
    "page": ("web_read", {"url": "https://example.com/x"}, None),
    "command": ("local_exec", {"command": "npm test"}, None),
    "computer_command": ("vm_exec", {"command": "ls"}, "computer"),
    "job": ("local_job", {}, None),
    "ask": ("ask_member", {"member": "Sample"}, None),
    "routine": ("routine_update", {"title": "Daily"}, None),
    "calendar": ("calendar_add", {"title": "Lunch"}, None),
    "click": ("computer__click", {}, "computer"),
    "type": ("computer__type", {}, "computer"),
    "computer": ("computer__screenshot", {}, "computer"),
    "use": ("some_tool", {}, None),
    "view": ("NOTION_GET_PAGE", {}, "composio"),
    "create": ("NOTION_CREATE_PAGE", {}, "composio"),
    "update": ("NOTION_UPDATE_PAGE", {}, "composio"),
    "delete": ("NOTION_DELETE_PAGE", {}, "composio"),
    "send": ("GMAIL_SEND_EMAIL", {}, "composio"),
    "private": ("computer_login", {}, None),
}


def test_the_calls_below_make_every_kind_of_action_label():
    reached = {kind: sentence(tool, args, "en", server=server) for kind, (tool, args, server) in CALLS.items()}
    assert set(CALLS) == set(_WORDS["en"])
    assert all(present and past for present, past in reached.values())
    assert len(set(reached.values())) == len(CALLS), "two kinds say the same thing"


@pytest.mark.parametrize("language", LANGUAGES)
@pytest.mark.parametrize("kind", CALLS)
def test_an_action_label_is_said_in_every_language_and_never_raises(kind, language):
    tool, args, server = CALLS[kind]
    present, past = sentence(tool, args, language, server=server)
    assert present.strip() and past.strip() and "{" not in present + past
    if language in NEW_LANGUAGES:
        assert (present, past) != sentence(tool, args, "en", server=server), (kind, language)


@pytest.mark.parametrize("language", LANGUAGES)
def test_the_line_when_a_cli_changed_a_file_is_in_every_language(language):
    line = _FILE_CHANGE[language]
    assert line.strip() and (language not in NEW_LANGUAGES or line != _FILE_CHANGE["en"])


@pytest.mark.parametrize("language", NEW_LANGUAGES)
def test_a_question_card_written_for_a_chat_is_not_english_in_another_language(language):
    card = {"question": "Which day?", "options": ["Mon", "Tue"], "multiple": True, "skip": True, "free_text": True}
    english = question_text("en", card)
    written = question_text(language, card)
    lines = written.splitlines()
    assert written != english and lines[0] == "Which day?" and lines[2:4] == ["A. Mon", "B. Tue"]
    for english_line, line in zip(english.splitlines()[5:], lines[5:], strict=True):
        assert line != english_line
    assert question_text(language, {**card, "multiple": False}).splitlines()[5] != question_text("en", {**card, "multiple": False}).splitlines()[5]


# Tables of words keyed by interface language that are written for some of them and are not the catalogue's: each is not
# a sentence the owner reads (a model's example, a script's letters, a length) or has the catalogue behind it another way.
# A table written for the owner and left out of the catalogue falls back to English in the other languages.
NOT_OWNER_COPY = {
    "agent/persona.py": 5,  # the Mac's own phrases (the catalogue's follow for the rest), how Raphael is addressed and the tone line shown to a model, line lengths
    "brain/cleanup.py": 1, "brain/cloud_stt.py": 1, "device/stt.py": 1,  # language codes of speech services
    "computer/vm_tools.py": 3,  # the wake lines: the catalogue's `with_ui_words` is applied to them by a comprehension
    "conversation_language.py": 1,  # script families
    "management_words.py": 1,  # the closing question of a card: the catalogue takes the other twelve
    "sign_in_page.py": 1,  # the sign-in page's own catalogue of fifteen
}


def test_a_table_of_words_for_some_languages_goes_through_the_catalogue():
    root = Path(__file__).resolve().parents[2] / "src/raphael_core"
    unwrapped: Counter = Counter()
    for file in sorted(root.rglob("*.py")):
        if file.name.endswith("_data.py"):
            continue
        tree = ast.parse(file.read_text(encoding="utf-8-sig"))
        parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        named = {call.args[0].id for call in ast.walk(tree)
                 if isinstance(call, ast.Call) and getattr(call.func, "id", getattr(call.func, "attr", "")) == "with_ui_words"
                 and call.args and isinstance(call.args[0], ast.Name)}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            keys = {key.value for key in node.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)}
            if len(keys & {"zh-TW", "en", "ja", "zh-CN", "ko"}) < 2 or not keys & {"zh-TW", "en", "ja"} or len(keys & set(LANGUAGES)) >= len(LANGUAGES):
                continue
            parent, caught = node, False
            while parent in parents and not caught:
                parent = parents[parent]
                caught = (isinstance(parent, ast.Call) and getattr(parent.func, "id", getattr(parent.func, "attr", "")) == "with_ui_words"
                          or isinstance(parent, ast.Assign) and any(isinstance(target, ast.Name) and target.id in named for target in parent.targets)
                          or isinstance(parent, ast.AnnAssign) and isinstance(parent.target, ast.Name) and parent.target.id in named)
            if not caught:
                unwrapped[file.relative_to(root).as_posix()] += 1
    assert dict(unwrapped) == NOT_OWNER_COPY
