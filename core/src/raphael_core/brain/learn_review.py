"""Which words an edit of a pasted dictation teaches the dictionary, as the cleanup model judges.

The app watches the field a dictation was pasted into and hands over the dictated part twice: as
it was pasted and as the user left it (`dictionary.learn` with a `revision`). Telling a misheard
term from rewording is a judgement of meaning in whatever language was spoken, so no rule of
spelling or script makes it here: the cleanup model compares the two, with the dictionary, and
names the pairs. What it names is only checked for shape (each side is really in its text, short
and on one line); `DictionaryStore.learn_pair` then applies the dictionary's own rules (dismissed
words, known words, forms of other words).

Nothing is asked when the two are the same. Only the changed stretch with a little context on
each side is sent, so a long field costs no more than a short one, and a stretch that was
rewritten wholesale is no correction and is not sent at all. Any failure of the call learns
nothing. The words are never logged, only counts.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable, Sequence
from importlib import resources

from .cleanup import PROMPT_MAX_CHARS, PROMPT_MAX_FORMS, PROMPT_MAX_WORDS, describe_languages
from .dictionary import DictionaryStore
from .openrouter import Completion, OpenRouterError
from .providers.base import ModelProvider
from .providers.registry import for_purpose
from .settings import SettingsStore
from .spend import SpendTracker

logger = logging.getLogger(__name__)

REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "words": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"word": {"type": "string"}, "misheard": {"type": "string"}},
                "required": ["word", "misheard"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["words"],
    "additionalProperties": False,
}

# Characters of unchanged text kept on each side of the changed stretch.
CONTEXT_CHARS = 120
# A changed stretch longer than this, on either side, was rewritten rather than corrected.
MAX_CHANGED_CHARS = 400
# The longest word and misheard form taken from a reply.
MAX_WORD_CHARS = 60
REVIEW_TIMEOUT_S = 20.0
REVIEW_MAX_TOKENS = 300

_PLACEHOLDER = re.compile(r"\{(dictionary|languages)\}")


def _template() -> str:
    return resources.files(__package__).joinpath("prompts/learn_review.md").read_text("utf-8")


def changed_window(pasted: str, sent: str, context: int = CONTEXT_CHARS) -> tuple[str, str] | None:
    """The stretch where `sent` differs from `pasted`, with up to `context` unchanged characters
    on each side, as `(pasted part, sent part)`; None when nothing changed or the changed stretch
    is longer than MAX_CHANGED_CHARS on either side."""
    if pasted == sent:
        return None
    start = 0
    limit = min(len(pasted), len(sent))
    while start < limit and pasted[start] == sent[start]:
        start += 1
    end = 0
    while end < limit - start and pasted[-1 - end] == sent[-1 - end]:
        end += 1
    if len(pasted) - start - end > MAX_CHANGED_CHARS or len(sent) - start - end > MAX_CHANGED_CHARS:
        return None
    left = max(0, start - context)
    return pasted[left : len(pasted) - max(0, end - context)], sent[left : len(sent) - max(0, end - context)]


def _one_line(text: str) -> str:
    return " ".join(text.split())


def dictionary_block(words: Sequence[str], replacements: Sequence[tuple[str, str]], text: str) -> str:
    """The dictionary as the review reads it: the words that `text` holds in any letter case
    first, then the others, one line each with the forms they are heard as, cut off as the cleanup
    prompt's block is (PROMPT_MAX_WORDS, PROMPT_MAX_FORMS, PROMPT_MAX_CHARS)."""
    forms: dict[str, list[str]] = {}
    for misheard, word in replacements:
        if _one_line(misheard):
            forms.setdefault(_one_line(word), []).append(_one_line(misheard))
    folded = text.casefold()
    ordered = [w for w in map(_one_line, words) if w]
    ordered = [w for w in ordered if w.casefold() in folded] + [w for w in ordered if w.casefold() not in folded]
    lines: list[str] = []
    seen: set[str] = set()
    size = 0
    for word in ordered:
        if word in seen or len(lines) == PROMPT_MAX_WORDS:
            continue
        seen.add(word)
        heard = forms.get(word)
        line = f"- {word} (often misheard as: {', '.join(heard[:PROMPT_MAX_FORMS])})" if heard else f"- {word}"
        if size + len(line) + 1 > PROMPT_MAX_CHARS:
            continue
        lines.append(line)
        size += len(line) + 1
    return "\n".join(lines) or "(empty)"


def build_review_prompt(
    words: Sequence[str], replacements: Sequence[tuple[str, str]], languages: Sequence[str], text: str
) -> str:
    values = {
        "dictionary": dictionary_block(words, replacements, text),
        "languages": describe_languages(languages),
    }
    return _PLACEHOLDER.sub(lambda match: values[match.group(1)], _template())


def build_review_message(pasted: str, sent: str) -> str:
    return f"<pasted>{pasted}</pasted>\n<sent>{sent}</sent>"


def checked_pairs(data: object, pasted: str, sent: str, limit: int) -> list[tuple[str, str]]:
    """The `(word, misheard)` pairs of a reply whose word is in `sent` and whose misheard form is
    in `pasted`, each short, on one line and different from the other in more than letter case;
    at most `limit`, in the reply's order, without repeats."""
    items = data.get("words") if isinstance(data, dict) else None
    pairs: list[tuple[str, str]] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        word, misheard = item.get("word"), item.get("misheard")
        if not isinstance(word, str) or not isinstance(misheard, str):
            continue
        word, misheard = word.strip(), misheard.strip()
        if (
            not word
            or not misheard
            or len(word) > MAX_WORD_CHARS
            or len(misheard) > MAX_WORD_CHARS
            or any(c in "\r\n\u2028\u2029" for c in word + misheard)
            or word.casefold() == misheard.casefold()
            or word not in sent
            or misheard not in pasted
            or (word, misheard) in pairs
        ):
            continue
        pairs.append((word, misheard))
        if len(pairs) == limit:
            break
    return pairs


class LearnReviewer:
    """Asks the cleanup model which words an edit teaches (see the module's docstring).

    `has_key` says whether the cleanup model can be called at all. Each answer is recorded in the
    spend, as a cleanup's is, whatever it holds.
    """

    def __init__(
        self,
        client: ModelProvider,
        settings: SettingsStore,
        dictionary: DictionaryStore,
        spend: SpendTracker,
        has_key: Callable[[], bool],
        timeout_s: float = REVIEW_TIMEOUT_S,
    ) -> None:
        self._client = for_purpose(client, "cleanup")
        self._settings = settings
        self._dictionary = dictionary
        self._spend = spend
        self._has_key = has_key
        self._timeout_s = timeout_s

    async def review(self, pasted: str, sent: str, limit: int) -> list[tuple[str, str]]:
        window = changed_window(pasted, sent)
        if window is None:
            logger.info("Learning: nothing to review (unchanged or rewritten)")
            return []
        if not self._settings.get("cleanup_model") or not self._has_key():
            logger.info("Learning: no model to review the edit with")
            return []
        before, after = window
        system = build_review_prompt(
            self._dictionary.hint_words(),
            self._dictionary.hint_forms(),
            self._settings.get("languages"),
            before + "\n" + after,
        )
        model = self._settings.get("cleanup_model")
        try:
            completion = await asyncio.wait_for(
                self._client.complete_json(
                    model=model,
                    fallbacks=[],
                    system=system,
                    user=build_review_message(before, after),
                    schema=REVIEW_SCHEMA,
                    schema_name="dictionary_words",
                    timeout_s=self._timeout_s,
                    max_tokens=REVIEW_MAX_TOKENS,
                ),
                self._timeout_s,
            )
        except TimeoutError:
            logger.warning("Learning: the review timed out after %.1f s", self._timeout_s)
            return []
        except OpenRouterError as error:
            logger.warning("Learning: the review failed: model=%s kind=%s", model, error.kind)
            return []
        except Exception as exc:  # anything else the client lets out learns nothing
            logger.warning("Learning: the review failed: %s", type(exc).__name__)
            return []
        if not model.startswith("cli:"):
            self._record_spend(completion)
        pairs = checked_pairs(completion.data, before, after, limit)
        named = completion.data.get("words") if isinstance(completion.data, dict) else None
        logger.info(
            "Learning: the review named %d word(s), %d kept",
            len(named) if isinstance(named, list) else 0,
            len(pairs),
        )
        return pairs

    def _record_spend(self, completion: Completion) -> None:
        try:
            self._spend.record(
                purpose="cleanup",
                model=completion.model,
                cost_usd=completion.cost_usd,
                prompt_tokens=completion.prompt_tokens,
                completion_tokens=completion.completion_tokens,
                job="dictionary_learn",
            )
        except Exception as exc:  # a cost it refuses, or a database that fails
            logger.warning("Could not record what a learning review cost: %s", type(exc).__name__)


__all__ = [
    "LearnReviewer",
    "build_review_message",
    "build_review_prompt",
    "changed_window",
    "checked_pairs",
    "dictionary_block",
]
