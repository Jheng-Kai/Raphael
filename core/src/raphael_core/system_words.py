"""The words a model is told about the owner's computer, which differ between Windows and macOS.

The prompts are written for Windows ("the user's Windows computer", "a Windows settings page", "File
Explorer"). On a Mac `for_this_system` puts the Mac's words in their place; on Windows it gives the text
back unchanged, so the Windows prompts stay exactly as they were written and measured. Nothing here
names the interface language (R-LANG-01): only the system.
"""

import sys

MAC = sys.platform == "darwin"

# The Windows words and the Mac's, longest first so that a phrase is replaced before a word inside it.
_MAC_WORDS = (
    ("owner's own Windows computer", "owner's own Mac"),
    ("owner's Windows computer", "owner's Mac"),
    ("owner's Windows PC", "owner's Mac"),
    ("speaker's Windows computer", "speaker's Mac"),
    ("user's Windows computer", "user's Mac"),
    ("their Windows computer", "their Mac"),
    ("Windows settings page", "System Settings page"),
    ("File Explorer", "Finder"),
    ("the Settings app", "System Settings"),
    ("from the Start menu", "from the Applications folder"),
    ("(no Windows key, no alt+tab)", "(no alt chords, no app switching)"),
    ("Windows Credential Manager", "macOS Keychain"),
    ("Credential Manager", "Keychain"),
    ("This PC", "This Mac"),
    ("this PC", "this Mac"),
    ("Windows PC", "Mac"),
    ("Windows computer", "Mac"),
)


def mac_words(text: str) -> str:
    """`text` with the Mac's words in place of Windows'."""
    for windows, mac in _MAC_WORDS:
        text = text.replace(windows, mac)
    return text


def for_this_system(text: str) -> str:
    """`text` as the system the core runs on says it: unchanged on Windows, with the Mac's words on macOS."""
    return mac_words(text) if MAC else text
