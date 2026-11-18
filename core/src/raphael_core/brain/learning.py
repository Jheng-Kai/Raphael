"""Shape checks for learned dictionary entries.

Which edit is a misheard term and which is rewording is judged by the cleanup model
(`learn_review`), in whatever language was spoken. What is stored here is only checked for shape,
the same in every language and script: a short term on one line without sentence punctuation, and
a misheard form that is not merely the term with letters cut off.
"""

_SENTENCE_MARKS = "，。！？、；：,.!?;:\r\n\u2028\u2029"
# The longest learned word, and the longest form it may be heard as.
MAX_TERM_CHARS = 40
MAX_FORM_CHARS = 60
# The most space-separated parts of a learned word: a name of a few words, never a clause.
MAX_TERM_PARTS = 3


def term(text: str, *, target: bool = True) -> bool:
    """Whether `text` has the shape of a dictionary term (`target`) or of a form one is heard as."""
    if not text or len(text) > (MAX_TERM_CHARS if target else MAX_FORM_CHARS):
        return False
    if any(c in _SENTENCE_MARKS for c in text):
        return False
    return not target or (any(c.isalpha() for c in text) and len(text.split()) <= MAX_TERM_PARTS)


def target_term(word: str) -> bool:
    return term(word)


def accepted(word: str, misheard: str) -> bool:
    """Whether a reviewed pair may be stored."""
    if not target_term(word) or not term(misheard, target=False) or word.casefold() == misheard.casefold():
        return False
    # A pure shortening carries no replacement term.
    old, new = misheard.casefold(), word.casefold()
    return not (len(new) < len(old) and (old.startswith(new) or old.endswith(new)))
