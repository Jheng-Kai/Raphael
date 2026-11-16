"""The ChatGPT sign-in page names the macOS Keychain on a Mac, in every language, where Windows names Credential Manager."""

import pytest

from raphael_core import sign_in_page
from raphael_core.sign_in_page import _CHATGPT_MAC, _CHATGPT_WINDOWS, _KEYCHAIN


@pytest.mark.parametrize("language", sorted(_CHATGPT_WINDOWS))
def test_every_language_names_the_keychain_on_a_mac(language):
    windows, mac = _KEYCHAIN[language]
    for words in (_CHATGPT_WINDOWS[language]["tool_broken"][1], _CHATGPT_WINDOWS[language]["facts"][1]):
        assert windows in words, "the Mac's words replace a phrase the sentence no longer says"
    for words in (_CHATGPT_MAC[language]["tool_broken"][1], _CHATGPT_MAC[language]["facts"][1]):
        assert mac in words
    assert "Windows" not in repr(_CHATGPT_MAC[language])


def test_the_page_follows_the_system():
    expected = _CHATGPT_MAC if sign_in_page.MAC else _CHATGPT_WINDOWS
    assert sign_in_page._CHATGPT is expected
    assert set(_KEYCHAIN) == set(_CHATGPT_WINDOWS)
