"""Text normalization: the Chinese written form the user chose, Japanese left alone, and rules.

Speech-to-text writes Chinese in whichever script it likes, while Raphael's Chinese follows the
variant the user chose (raphael_core.languages): Traditional with Taiwan usage for zh-TW (OpenCC
`s2twp`, the default), Traditional with Hong Kong usage for zh-HK and yue-HK (`s2hk`), Simplified
for zh-CN (`t2s`), and no conversion when no Chinese is chosen. OpenCC does no language
detection: it also turns the Japanese kanji that share a code point with Simplified Chinese into
Traditional forms (学 into 學, 会 into 會, 来 into 來). That is why Japanese is skipped, sentence
by sentence. And OpenCC takes its input for Simplified Chinese: over text that is Traditional
already it corrupts some characters (只要 into 隻要, 干擾 into 幹擾). So the Traditional variants
convert only what is still Simplified (`convert_leftover_simplified`), for the cleaned text and for
the raw text alike. A text pasted without cleanup also loses its most obvious stutters
(`remove_stutters`).
"""

import difflib
import functools
import json
import re
import string
from collections.abc import Callable, Sequence

import opencc

# A sentence ends after one of 。！？!? or a line break. A run of them stays attached to the
# sentence before it (a run at the very start of the text forms a piece of its own), so the pieces
# always add up to the whole text.
_SENTENCE = re.compile(r"[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+")


def _in_blocks(*blocks: tuple[int, int]) -> re.Pattern[str]:
    """A pattern for one character from any of the blocks, given as (first, last) code points."""
    return re.compile("[" + "".join(f"{chr(first)}-{chr(last)}" for first, last in blocks) + "]")


_HIRAGANA_BLOCK = (0x3040, 0x309F)
_HIRAGANA = _in_blocks(_HIRAGANA_BLOCK)
# What counts as a CJK character when the share of hiragana is measured: hiragana, katakana, Han.
_CJK = _in_blocks(
    _HIRAGANA_BLOCK,
    (0x30A0, 0x30FF),  # Katakana
    (0x31F0, 0x31FF),  # Katakana Phonetic Extensions
    (0xFF66, 0xFF9F),  # halfwidth Katakana
    (0x3400, 0x4DBF),  # CJK Unified Ideographs Extension A
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
)

# A sentence whose CJK characters are at least this many percent hiragana is Japanese.
_JAPANESE_PERCENT = 10

# What may not stand next to a rule's text when that text starts or ends with one of them.
_ASCII_LETTERS_AND_DIGITS = string.ascii_letters + string.digits


@functools.cache
def _converter() -> opencc.OpenCC:
    """The OpenCC converter, made on first use: it loads its dictionaries, about 100 ms."""
    return opencc.OpenCC("s2twp.json")


# The OpenCC configuration that writes Simplified Chinese as each Traditional variant.
_TO_TRADITIONAL = {"zh-TW": "s2twp.json", "zh-HK": "s2hk.json", "yue-HK": "s2hk.json"}
CHINESE_VARIANTS = ("zh-TW", "zh-HK", "zh-CN", "yue-HK")


@functools.cache
def _opencc(config: str) -> opencc.OpenCC:
    """The OpenCC converter of `config`, made on first use (s2twp is `_converter`)."""
    return _converter() if config == "s2twp.json" else opencc.OpenCC(config)


def _checked_variant(chinese: str | None) -> str | None:
    if chinese is not None and chinese not in CHINESE_VARIANTS:
        raise ValueError(f"Unknown Chinese variant {chinese!r}: use {', '.join(CHINESE_VARIANTS)}")
    return chinese


def _is_japanese(sentence: str) -> bool:
    """Whether at least 10 % of the sentence's CJK characters are hiragana.

    Japanese grammar always brings hiragana. A katakana name inside a Chinese sentence does not,
    and neither does a sentence of kanji alone, which therefore counts as Chinese. Without any
    hiragana a sentence is never Japanese, even when it has no CJK characters to measure.
    """
    hiragana = len(_HIRAGANA.findall(sentence))
    cjk = len(_CJK.findall(sentence))
    return hiragana > 0 and hiragana * 100 >= _JAPANESE_PERCENT * cjk


def to_taiwan_traditional(text: str) -> str:
    """`text` in Traditional Chinese with Taiwan usage ("软件" becomes "軟體"), except Japanese.

    The text is split into sentences after 。！？!? and line breaks, and each sentence is judged on
    its own. A Japanese sentence stays as it is; every other one goes through OpenCC whole, which
    leaves kana and Latin text alone. Spaces and line breaks come back exactly as they were.
    """
    return _convert_sentences(text, _converter())


def _convert_sentences(text: str, converter: opencc.OpenCC) -> str:
    """`text` with each sentence that is not Japanese run through `converter` whole."""
    return "".join(
        sentence if _is_japanese(sentence) else converter.convert(sentence)
        for sentence in _SENTENCE.findall(text)
    )


def to_chinese_variant(text: str, chinese: str | None) -> str:
    """`text` in the script of the Chinese variant `chinese`, Japanese sentences left alone: every
    other sentence goes through OpenCC whole (s2twp, s2hk or t2s). None leaves the text as it is.
    ValueError for a variant that is not one of CHINESE_VARIANTS."""
    chinese = _checked_variant(chinese)
    if chinese is None:
        return text
    if chinese == "zh-CN":
        return _convert_sentences(text, _to_simplified())
    return _convert_sentences(text, _opencc(_TO_TRADITIONAL[chinese]))


# The keys of OpenCC's STCharacters table that are among their own Traditional forms: Simplified
# and Traditional Chinese share them (只 is 只 or 隻, 后 is 后 or 後, 台 is 台 or 臺, 干 is 干,
# 乾 or 幹). Generated from OpenCC 1.4.2; a test regenerates it from the installed dictionary.
_SHARED_CHARACTERS = frozenset(
    "㐹万丑丰了于云亘仆仇价仿伙余佛佣俊修借僵克党具冢冬准凌几凶出划刮制千升卜占卷厂厘"
    "只台叶吁吃合吊同后向吣呆周咨咸咽哄唇喂噪回困坐坯堤夫夸奸姜娘它家尸局岩岳巨布帘席"
    "干幸广庵弦彩征御志念恤愈愿戚扇才扎托扣折抵拐拿挂挨挽捆捍据搜斗斤斫旋昆暗曲札朱朴"
    "杆杠杯杰松板极果柜栗核梁棱檗欲沈沾泛注浚涂涌淀游溪漓澄焰熏狸玩琅璇症皂矩确硷私秋"
    "种穗筑筱糊系累耇胄背胜胡腊腌膻致舍芸苔苹范荐蒙蔑藤虫蚝蜡蝎表谷豆象跖辟适郁酸采里"
    "雇雕面"
)

# Characters below this code point are never Chinese: OpenCC leaves them alone.
_FIRST_CJK = 0x2E80


@functools.cache
def _to_simplified() -> opencc.OpenCC:
    """OpenCC's Traditional-to-Simplified converter, made on first use."""
    return opencc.OpenCC("t2s.json")


def to_simplified(text: str) -> str:
    """`text` with its Traditional Chinese made Simplified, character by character (OpenCC t2s),
    to compare texts whichever script they are in. Not for writing: Japanese is not spared."""
    return _to_simplified().convert(text)


@functools.cache
def _to_mainland() -> opencc.OpenCC:
    """OpenCC's Taiwan-to-Simplified converter with Mainland phrases, made on first use."""
    return opencc.OpenCC("tw2sp.json")


def to_mainland(text: str) -> str:
    """`text` with its Traditional Chinese made Simplified, words as well as characters (OpenCC
    tw2sp: 軟體 into 软件, 影片 into 视频), to compare texts whichever script and regional wording
    they use. Not for writing. Taiwan 資料 becomes 数据, which is not always the Mainland word, so
    `to_simplified` is the better comparison for that one."""
    return _to_mainland().convert(text)


@functools.lru_cache(maxsize=8192)
def _is_simplified_only(char: str, config: str = "s2twp.json") -> bool:
    """Whether the converter of `config` changes `char` on its own and it is no Traditional
    character (软, 发, 开, but not 只 or 后). Traditional forms of another region (裏 for s2twp)
    count too: they are to be converted."""
    return (
        ord(char) >= _FIRST_CJK
        and char not in _SHARED_CHARACTERS
        and _opencc(config).convert(char) != char
    )


@functools.lru_cache(maxsize=8192)
def _is_traditional_only(char: str) -> bool:
    """Whether `char` is written differently in Simplified Chinese (軟, 髮, 後, 隻)."""
    return ord(char) >= _FIRST_CJK and _to_simplified().convert(char) != char


def _convert_simplified_words(sentence: str, config: str = "s2twp.json") -> str:
    """One sentence that is meant to be Traditional Chinese, with what is still Simplified in it
    converted, and nothing else.

    A sentence without a Simplified-only character stays as it is. One with no character that only
    Traditional Chinese has is Simplified Chinese and goes through s2twp whole, as speech-to-text
    output does. In a sentence that has both, only the words that s2twp changes and that hold a
    Simplified-only character take its result: 「幫我打开」 becomes 「幫我開啟」, but the 只 of
    「就是只要按這個开關」 is not turned into 隻 as s2twp alone would.
    """

    def simplified_only(char: str) -> bool:
        return _is_simplified_only(char, config)

    if not any(map(simplified_only, sentence)):
        return sentence
    converted = _opencc(config).convert(sentence)
    if not any(map(_is_traditional_only, sentence)):
        return converted
    pieces: list[str] = []
    changed_from: list[str] = []  # a run of changes, as it was and as s2twp wrote it
    changed_to: list[str] = []

    def take_changes() -> None:
        before = "".join(changed_from)
        pieces.append("".join(changed_to) if any(map(simplified_only, before)) else before)
        changed_from.clear()
        changed_to.clear()

    matcher = difflib.SequenceMatcher(None, sentence, converted, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            take_changes()
            pieces.append(sentence[i1:i2])
        else:
            changed_from.append(sentence[i1:i2])
            changed_to.append(converted[j1:j2])
    take_changes()
    return "".join(pieces)


def convert_leftover_simplified(text: str, config: str = "s2twp.json") -> str:
    """`text`, written to be Traditional Chinese with Taiwan usage, with what is still Simplified
    in it converted by s2twp, sentence by sentence (Japanese sentences stay as they are). With
    `config` "s2hk.json" the same is done for Hong Kong Traditional.

    s2twp takes its input for Simplified Chinese, and it corrupts some Traditional text:
    「就是只要」 becomes 「就是隻要」, 「干擾」 becomes 「幹擾」. This leaves the Traditional
    parts alone (see `_convert_simplified_words`). Spaces and line breaks come back exactly as
    they were.
    """
    return "".join(
        sentence if _is_japanese(sentence) else _convert_simplified_words(sentence, config)
        for sentence in _SENTENCE.findall(text)
    )


def convert_leftover_traditional(text: str) -> str:
    """`text`, written to be Simplified Chinese, with each sentence that still has a character
    only Traditional Chinese has run through t2s (Japanese sentences stay as they are). t2s leaves
    Simplified characters as they are, so the rest of such a sentence does not change."""
    return "".join(
        _to_simplified().convert(sentence)
        if not _is_japanese(sentence) and any(map(_is_traditional_only, sentence))
        else sentence
        for sentence in _SENTENCE.findall(text)
    )


_ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)


def replacement_key(text: str) -> str:
    """`text` as the replacement rules compare it: ASCII letters in lower case, the rest as it is.
    Two texts with the same key are the same text to `apply_replacements`."""
    return text.translate(_ASCII_LOWER)


def _misheard_pattern(misheard: str) -> re.Pattern[str]:
    """The pattern that finds the text of one rule.

    ASCII letters match in either case, everything else exactly. re.ASCII keeps the case folding
    to the ASCII letters. Otherwise é would match É, and the Kelvin sign (U+212A) would match k.

    A text that starts with an ASCII letter or digit does not match right after another one, and a
    text that ends with one does not match right before another one: "cloud" is not found in
    "iCloud" or "clouds". At an end that is anything else, nothing is checked. Chinese and Japanese
    characters next to a match do not matter either, as there are no spaces between the words.
    """
    letters_and_digits = f"[{_ASCII_LETTERS_AND_DIGITS}]"
    not_after = f"(?<!{letters_and_digits})" if misheard[0] in _ASCII_LETTERS_AND_DIGITS else ""
    not_before = f"(?!{letters_and_digits})" if misheard[-1] in _ASCII_LETTERS_AND_DIGITS else ""
    return re.compile(not_after + re.escape(misheard) + not_before, re.IGNORECASE | re.ASCII)


def _window(start: int, end: int, word: str) -> tuple[int, int]:
    """The stretch of a text that holds every occurrence of `word` sharing a character with
    `text[start:end]`: such an occurrence starts after start - len(word) and before end."""
    return max(0, start - len(word) + 1), end + len(word) - 1


def _overlaps_word(text: str, start: int, end: int, word: str) -> bool:
    """Whether `word`, spelled exactly like that, shares a character with `text[start:end]`."""
    return text.find(word, *_window(start, end, word)) != -1


def _apply_rule(text: str, misheard: str, word: str) -> str:
    """`text` with each match of `misheard` replaced by `word`, but not where `word` is already.

    A match that shares a character with `word` as it is spelled in the text is not a mishearing
    but the word itself, or part of it, and stays. When it shares one with the word in other
    letter case ("claude code" for "Claude Code"), that whole occurrence is written as `word`.
    """
    pattern = _misheard_pattern(misheard)
    # A word that is shorter than the misheard text cannot contain a match, and a rule such as
    # ("Claude Code", "Claude") has to replace matches that contain the word.
    protect_word = len(word) >= len(misheard)
    word_in_any_case = re.compile(re.escape(word), re.IGNORECASE | re.ASCII)
    pieces: list[str] = []
    copied = 0  # text[:copied] is in `pieces`, replaced or not
    position = 0  # where the search for the next match starts
    while (match := pattern.search(text, position)) is not None:
        start, end = match.span()
        first, last = start, end  # what gets replaced: the match, or the word it overlaps
        if protect_word:
            if _overlaps_word(text, start, end, word):
                position = start + 1  # the next match may start inside this one
                continue
            other_case = word_in_any_case.search(text, *_window(start, end, word))
            if other_case is not None:
                first, last = other_case.span()
                # An occurrence that begins in text that is dealt with, or that overlaps the word
                # as spelled, is the end of one word and the start of another, not a word.
                if first < copied or _overlaps_word(text, first, last, word):
                    position = start + 1
                    continue
        pieces.append(text[copied:first])
        # The word itself, so that backslashes in it are not read as escapes or group references.
        pieces.append(word)
        copied = position = last
    pieces.append(text[copied:])
    return "".join(pieces)


def apply_replacements(text: str, rules: Sequence[tuple[str, str]]) -> str:
    """Replace each `misheard` text by its `word`, rule after rule in the order given.

    `DictionaryStore.replacements()` returns the rules longest first, so that a long form gets
    its chance before a shorter one inside it. ASCII letters in a rule match in either case,
    everything else exactly. A rule with empty `misheard` text is skipped.

    A text that starts or ends with an ASCII letter or digit matches only as a word of its own:
    "cloud" is not found in "iCloud" or "clouds". And a match that overlaps the `word` itself is
    not a mishearing: with ("Claude", "Claude Code"), the "Claude" in "Claude Code" stays, and
    "claude code" is written as "Claude Code" instead of gaining a second "Code". The brain
    applies the rules to the speech-to-text result and again to the cleaned text, so the second
    time must not add another "Code". For a word at least as long as its misheard text, applying
    the rule to its own result is meant to change nothing more. That does not extend to a word
    shorter than its misheard text, which can leave another match behind, or to rules that build
    on each other (a word that holds the misheard text of an earlier rule).

    The word in other letter case is only rewritten where a match overlaps it. Elsewhere it stays
    as it is: ("cloud", "Claude") leaves "CLAUDE" alone.
    """
    for misheard, word in rules:
        if misheard:
            text = _apply_rule(text, misheard, word)
    return text


# A Latin word of a text, and what may stand between the words of a split one ("Grok Bot", "grok-bot").
_LATIN_TOKEN = re.compile(r"[0-9A-Za-zÀ-ɏ]+")
_SPLIT_GAP = re.compile(r"[ \t\-]+")
_WORD_GAP = re.compile(r"[ \t]+")
# The most words a split dictionary word is found in: "Grok Bot", "tele gram", "Open Ro uter".
_MAX_SPLIT = 3


def _compact_key(text: str) -> str:
    return "".join(char for char in text.casefold() if char.isalnum())


def _cjk_mark(char: str) -> bool:
    """Full-width punctuation (，。「」（）…): it belongs to Chinese or Japanese text."""
    return "　" <= char <= "〿" or "＀" <= char <= "￯"


def _in_cjk_text(text: str, start: int, end: int) -> bool:
    """Whether `text[start:end]` stands in Chinese or Japanese text: the nearest letter or
    full-width mark before it and the nearest after it are CJK or the edge of the text, and at
    least one of them is CJK. Spaces and other punctuation are looked past."""
    from .mishearing import _is_cjk

    def nearest(indices) -> str | None:
        for i in indices:
            if text[i].isalnum() or _cjk_mark(text[i]):
                return text[i]
        return None

    before, after = nearest(range(start - 1, -1, -1)), nearest(range(end, len(text)))
    sides = [char for char in (before, after) if char is not None]
    return bool(sides) and all(_is_cjk(char) or _cjk_mark(char) for char in sides)


# A misspelt name is respelled only for a dictionary word of this many letters or more: shorter ones
# ("cron", "onyx") have too many real words a letter away.
_MIN_RESPELLED_LETTERS = 5


def _spelled_as(
    group: list[re.Match[str]], gaps: list[str], targets: dict[str, str]
) -> str | None:
    """The dictionary word that `group`, one to three Latin words of a text with `gaps` between
    them, writes in other letter case or split apart (see `respell_dictionary_words`)."""
    from .mishearing import _LATIN_FUNCTION_WORDS

    word = targets.get("".join(token.group().casefold() for token in group))
    if word is None:
        return None
    parts = word.split()
    if len(parts) == len(group):
        # The same words in other letter case: only spaces between them.
        same = all(_WORD_GAP.fullmatch(gap) for gap in gaps) and all(
            token.group().casefold() == part.casefold()
            for token, part in zip(group, parts, strict=True)
        )
        return word if same else None
    if len(parts) == 1 and all(_SPLIT_GAP.fullmatch(gap) for gap in gaps) and not any(
        token.group().casefold() in _LATIN_FUNCTION_WORDS for token in group
    ):
        return word
    return None


def _misspelt_name(
    group: list[re.Match[str]], gaps: list[str], span: str, targets: dict[str, str]
) -> str | None:
    """The dictionary word that `span` is a misspelling of as speech-to-text writes a name: a
    capital first, or split apart, and spelled almost like the word (`mishearing._near_spelling`:
    the same first letter, one edit in six letters, two in more, no plural). A word of the text in
    lower case is ordinary English the speaker said ("protect" is no "project"), and is left to
    the cleanup model; so is a text that is a word of the dictionary itself."""
    from .mishearing import _LATIN_FUNCTION_WORDS, _near_spelling

    if _compact_key(span) in targets:
        return None
    if len(group) > 1:
        if not all(_SPLIT_GAP.fullmatch(gap) for gap in gaps) or any(
            token.group().casefold() in _LATIN_FUNCTION_WORDS for token in group
        ):
            return None
    elif not span[0].isupper():
        return None
    for key, word in targets.items():
        if " " not in word and len(key) >= _MIN_RESPELLED_LETTERS and _near_spelling(
            word, span, len(group)
        ):
            return word
    return None


def respell_dictionary_words(text: str, words: Sequence[str]) -> str:
    """`text` with each Latin word of the dictionary written as the dictionary spells it, inside
    Chinese or Japanese text, where the text has it in other letter case ("Grokbot" for
    「grokbot」, "github" for 「GitHub」), split apart ("Grok Bot", "open-router"), or misspelt the
    way speech-to-text writes a name it does not know ("Grokbox", "Grabbot", "Grok Bus" for
    「grokbot」, "Herder" for 「herdr」; `_misspelt_name`).

    Speech-to-text cuts dictation at pauses and starts each piece with a capital, and an English
    name inside Chinese has no sentence of its own whose case could matter: the dictionary's
    spelling is the one meant. The cleanup model was told the same and did not do it (the owner's
    cleanup model kept "Grok Bus" and "Grokbox" with the dictionary word named beside them, five
    times in six, on 2026-11-14), so this is no request but a rule. In English text the case and the
    words belong to the sentence ("Space" is not "space"), so nothing there changes. A split word is
    joined only from words that are no function words ("type less" stays). Words of the dictionary
    come first in the order given: an earlier one wins a text that two of them spell alike.
    """
    from .mishearing import _is_cjk

    targets: dict[str, str] = {}
    for word in words:
        word = " ".join(word.split())
        if word and not any(_is_cjk(char) for char in word) and len(_compact_key(word)) >= 2:
            targets.setdefault(_compact_key(word), word)
    if not targets:
        return text
    tokens = list(_LATIN_TOKEN.finditer(text))
    pieces: list[str] = []
    copied = index = 0
    while index < len(tokens):
        found = None
        for size in range(min(_MAX_SPLIT, len(tokens) - index), 0, -1):
            group = tokens[index : index + size]
            gaps = [text[a.end() : b.start()] for a, b in zip(group, group[1:], strict=False)]
            start, end = group[0].start(), group[-1].end()
            span = text[start:end]
            word = _spelled_as(group, gaps, targets) or _misspelt_name(group, gaps, span, targets)
            if word is None or span == word:
                continue
            if _in_cjk_text(text, start, end):
                found = (start, end, word, size)
                break
        if found is None:
            index += 1
            continue
        start, end, word, size = found
        pieces += [text[copied:start], word]
        copied = end
        index += size
    pieces.append(text[copied:])
    return "".join(pieces)


def normalize_transcript(
    text: str, rules: Sequence[tuple[str, str]], *, chinese: str | None = "zh-TW"
) -> str:
    """Speech-to-text output as the rest of the app sees it: the Chinese of the variant `chinese`
    (Japanese sentences left alone), then the dictionary's replacements. This is the text that is
    saved, and the one pasted when the cleanup fails.

    The speech-to-text engines often write Traditional Chinese already, and OpenCC over a whole
    Traditional sentence corrupts it (只要 into 隻要, 干擾 into 幹擾, and with s2hk 系統 into 係統).
    So for the Traditional variants (zh-TW, zh-HK, yue-HK) only what is still Simplified is
    converted (`convert_leftover_simplified`), as it is for a cleaned text: Traditional text comes
    through as it is, and a sentence that is Simplified Chinese through and through is converted
    whole, as `to_chinese_variant` does. zh-CN goes through `to_chinese_variant` (t2s, which leaves
    Simplified characters alone), and None leaves the text as it is.
    """
    chinese = _checked_variant(chinese)
    if chinese in _TO_TRADITIONAL:
        text = convert_leftover_simplified(text, _TO_TRADITIONAL[chinese])
    else:
        text = to_chinese_variant(text, chinese)
    return apply_replacements(text, rules)


def finish_cleaned_text(
    text: str, rules: Sequence[tuple[str, str]], *, chinese: str | None = "zh-TW"
) -> str:
    """The text the user gets from what the cleanup model wrote: its reply, normalized again.

    The model is told to write Traditional Chinese with Taiwan usage, so only what it left in
    Simplified Chinese is converted (`convert_leftover_simplified`): s2twp over the whole reply
    would turn its 只要 into 隻要. OpenCC would also corrupt the kanji of a Japanese text (学校
    into 學校), so a reply with any hiragana is not converted at all, only given the replacements.
    That gate is on the whole reply, a step beyond the sentence-by-sentence rule of
    `to_taiwan_traditional`. A text that fell back to the raw speech-to-text result is already
    normalized and must not go through this: a second pass could repeat a replacement.

    `chinese` is the variant the model was told to write: zh-TW as above, zh-HK and yue-HK the
    same with s2hk, zh-CN with what is left in Traditional made Simplified by t2s
    (`convert_leftover_traditional`), and None for no conversion.
    """
    chinese = _checked_variant(chinese)
    if chinese is not None and not _HIRAGANA.search(text):
        if chinese == "zh-CN":
            text = convert_leftover_traditional(text)
        else:
            text = convert_leftover_simplified(text, _TO_TRADITIONAL[chinese])
    return apply_replacements(text, rules)


# What may stand around the comma of a stutter: spaces and tabs, not a line break.
_AROUND_COMMA = r"[ \t\u3000]*[,\uff0c\u3001][ \t\u3000]*"
# A Latin word, a comma (",", "，" or "、"), and the same word again. Neither is part of a longer
# word ("the, theory" is no stutter), and the apostrophe belongs to a word.
_LATIN_STUTTER = re.compile(
    r"(?<![A-Za-z0-9])([A-Za-z][A-Za-z']*)" + _AROUND_COMMA + r"(\1)(?![A-Za-z0-9'])",
    re.IGNORECASE | re.ASCII,
)
# Two to four CJK characters, a comma, and the same characters again.
_CJK_STUTTER = re.compile(rf"({_CJK.pattern}{{2,4}})" + _AROUND_COMMA + r"(\1)")
# Words that are said twice on purpose ("very, very good", "no, no"). A single letter is a word
# only as "I" or "a", and a list ("C, C++") is not a stutter.
_SAID_TWICE = frozenset(
    "very so really no yes bye ha oh ok okay hey sorry please well more much".split()
)
_ONE_LETTER_WORDS = frozenset("ia")
# A chain of three ("the, the, the") needs a second pass; this many is more than any speech has.
_STUTTER_PASSES = 4


def _latin_stutter(match: re.Match[str]) -> str:
    word = match.group(1).lower()
    if (len(word) == 1 and word not in _ONE_LETTER_WORDS) or word in _SAID_TWICE:
        return match.group(0)
    return match.group(2)


def remove_stutters(text: str) -> str:
    """`text` without its obvious stutters: a word or a short run that is said again right after a
    comma, where the speaker started over. The first is dropped with the comma and the second
    stays (as it was spelled): "Helion，Helion agent" is "Helion agent", "the, the config" is "the
    config", "任何，任何事情" is "任何事情".

    This is for the text that is pasted without cleanup, which is speech-to-text as it came, and it
    is conservative on purpose. A Latin word of two letters or more (or "I", "a") counts; a run of
    two to four CJK characters (Han and kana) counts. The comma may be "," or "，" or "、", with
    spaces around it but not a line break. Nothing is touched that has no comma between the
    repeats (很好很好, 謝謝謝謝), that restarts only in part (我想要，我想先; "the, theory"), that
    repeats five characters or more, that is a list ("C, C++"), or that is said twice on purpose
    ("very, very good", "no, no").
    """
    for _ in range(_STUTTER_PASSES):
        fixed = _CJK_STUTTER.sub(r"\2", _LATIN_STUTTER.sub(_latin_stutter, text))
        if fixed == text:
            break
        text = fixed
    return text


_HAN = re.compile(r"[㐀-鿿豈-﫿]")
_KANA = re.compile(r"[぀-ヿ]")


# A CJK character is one unit; a Latin word is one unit regardless of its length.
# Digits and punctuation include list markers and do not make a paragraph unsupported.
_CLEANUP_UNITS = re.compile(r"[A-Za-z\u00c0-\u024f]+(?:['’][A-Za-z\u00c0-\u024f]+)*|[^\W\d_]", re.UNICODE)
_CLEANUP_FILLERS = re.compile(r"怎麼講|怎么讲|那個|那个|就是|然後|然后|[嗯呃哦]|\b(?:um|uh)\b", re.IGNORECASE)
MIN_PARAGRAPH_SHARE = 0.5


def guard_cleanup_text(raw: str, cleaned: str, *, dictionary_words: Sequence[str] = ()) -> str:
    """Retain supported boundary prose and every original middle paragraph.

    An empty return rejects the whole cleanup: the caller must retain normalized raw text with
    a failure reason, never deliver an empty dictation. Both scripts and regional word forms
    count as spoken, as do canonical dictionary names. The threshold is inclusive.
    """
    def units(text: str, convert: Callable[[str], str]) -> list[str]:
        return _CLEANUP_UNITS.findall(_CLEANUP_FILLERS.sub("", convert(text).casefold()))

    conversions = (to_simplified, to_mainland)
    heard = [set(units(raw + "\n" + "\n".join(dictionary_words), convert)) for convert in conversions]

    def supported(text: str) -> bool:
        for convert, present in zip(conversions, heard, strict=True):
            tokens = units(text, convert)
            if not tokens or sum(token in present for token in tokens) / len(tokens) >= MIN_PARAGRAPH_SHARE:
                return True
        return False

    spans = []
    start = 0
    for boundary in re.finditer(r"\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*", cleaned):
        if cleaned[start:boundary.start()].strip():
            spans.append((start, boundary.start()))
        start = boundary.end()
    if cleaned[start:].strip():
        spans.append((start, len(cleaned)))
    if not spans:
        return ""

    # Some models put their preface/note on a single line without a blank separator. Inspect
    # only the outward line of each original edge, never list interiors or fences. Do this
    # before scoring the paragraph: a long note must not overwhelm a short spoken line.
    adjusted = list(spans)
    for index in dict.fromkeys((0, len(spans) - 1)):
        start, end = spans[index]
        paragraph = cleaned[start:end]
        lines = paragraph.splitlines(keepends=True)
        if len(lines) < 2 or re.search(r"(?m)^ {0,3}(?:`{3,}|~{3,})", paragraph):
            continue
        left, right = start, end
        if index == 0 and not supported(lines[0]):
            left = start + len(lines[0])
        if index == len(spans) - 1 and not supported(lines[-1]):
            right = end - len(lines[-1])
            # The removed line owns the preceding line break, not the speaker's paragraph.
            while right > left and cleaned[right - 1] in "\r\n":
                right -= 1
        adjusted[index] = (left, right)

    # Decide on the original edges once. A middle paragraph never becomes a new candidate.
    kept = [index for index, (start, end) in enumerate(adjusted)
            if index not in (0, len(spans) - 1) or
            (end > start and cleaned[start:end].strip() and supported(cleaned[start:end]))]
    if not kept:
        return ""
    left = adjusted[kept[0]][0]
    right = adjusted[kept[-1]][1]
    if kept[0] == 0 and left == spans[0][0]:
        left = 0
    if kept[-1] == len(spans) - 1 and right == spans[-1][1]:
        right = len(cleaned)
    return cleaned[left:right] if right > left else ""


def _dictation_prose(text: str, change: Callable[[str, set[int], int], str], *, skip_kana: bool = True) -> str:
    """Edit prose lines only, retaining kana lines, code fences and inline code byte for byte."""
    fence = ""
    size = 0
    result = []
    offset = 0
    prose: list[tuple[str, int]] = []

    def flush() -> None:
        if not prose:
            return
        block = "".join(line for line, _ in prose)
        protected = set()
        for span in re.finditer(r"(?<![`\\])(`+)(?!`)(.*?)(?<!`)\1(?!`)", block, re.DOTALL):
            protected.update(range(span.start(), span.end()))
        base = prose[0][1]
        for line, start in prose:
            if skip_kana and re.search(r"[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]", line):
                result.append(line)
            else:
                begin = start - base
                local = {index - begin for index in range(begin, begin + len(line)) if index in protected}
                result.append(change(line, local, start))
        prose.clear()

    for line in text.splitlines(keepends=True):
        start = offset
        offset += len(line)
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line.rstrip("\r\n"))
        if fence:
            if marker and marker[1][0] == fence and len(marker[1]) >= size and not marker[2].strip():
                fence = ""
            result.append(line)
            continue
        if marker:
            flush()
            fence, size = marker[1][0], len(marker[1])
            result.append(line)
            continue
        prose.append((line, start))
    flush()
    return "".join(result)


def finish_chinese_dictation(text: str) -> str:
    """Omit only the whole dictation's final prose full stop, preserving its sentences."""
    final = len(text.rstrip()) - 1

    def finish(line: str, protected: set[int], offset: int) -> str:
        index = final - offset
        if 0 <= index < len(line) and line[index] == "。" and index not in protected:
            return line[:index] + line[index + 1:]
        return line

    return _dictation_prose(text, finish)


def remove_dictation_fillers(text: str) -> str:
    """Remove unquoted hesitation syllables and repair their comma boundaries in prose."""
    pairs = {"「": "」", "『": "』", '"': '"', "“": "”"}
    quotes: list[str] = []
    commas = {",", "，"}

    def at_start(prefix: str) -> bool:
        return not prefix.strip() or bool(re.fullmatch(r"[ \t]*(?:\d+[.)]|[-*])[ \t]+", prefix))

    def finish(line: str, protected: set[int], offset: int) -> str:
        for match in re.finditer(
            r'https?://[^\s<>「」『』“”，。？！：；、"]+|www\.[^\s<>「」『』“”，。？！：；、"]+'
            r'|[\w.+-]+@[\w.-]+\.[a-z]{2,}', line, re.I,
        ):
            protected.update(range(match.start(), match.end()))
        for index, char in enumerate(line):
            if index in protected:
                continue
            if quotes:
                protected.add(index)
            if quotes and char == quotes[-1]:
                quotes.pop()
            elif char in pairs:
                protected.add(index)
                quotes.append(pairs[char])
        # Read quote boundaries on kana lines too, but retain the entire line byte for byte.
        if re.search(r"[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]", line):
            return line
        removed = set()
        for match in re.finditer(r"(?<![a-z0-9_-])(?:uh|um)(?![a-z0-9_-])", line, re.I):
            span = set(range(match.start(), match.end()))
            if not span & protected:
                removed.update(span)
        for match in re.finditer(r"[,，][ \t]*(嗯)[ \t]*(?=[,，])", line):
            if not set(range(match.start(), match.end() + 1)) & protected:
                removed.add(match.start(1))
        for index, char in enumerate(line):
            if index in protected:
                continue
            if char == "呃":
                removed.add(index)
            elif char == "欸":
                before, after = line[:index].rstrip(), line[index + 1:]
                if (at_start(line[:index]) or before[-1] in ",，。？！?!;；:：") and (
                    not after.strip() or after[0].isspace() or after[0] in ",，。？！?!;；:："
                ):
                    removed.add(index)
        output: list[tuple[str, bool]] = []
        changed = bool(removed)
        leading_separator = False
        for index, char in enumerate(line):
            if index in removed:
                continue
            keep = index in protected
            if leading_separator and not keep and char in " \t":
                continue
            leading_separator = False
            previous = len(output) - 1
            while previous >= 0 and output[previous][0] in " \t":
                previous -= 1
            if not keep and char in commas:
                if at_start("".join(value for value, _ in output)):
                    changed = True
                    leading_separator = True
                    continue
                if output[previous][0] in commas and not output[previous][1]:
                    del output[previous + 1:]
                    changed = True
                    continue
            if not keep and char in "。？！?!" and previous >= 0 and output[previous][0] in commas and not output[previous][1]:
                del output[previous:]
                changed = True
            output.append((char, keep))
        result = "".join(char for char, _ in output)
        if changed:
            indent = re.match(r"[ \t]*", line)[0]
            result = indent + result.lstrip(" \t")
        return result

    return _dictation_prose(text, finish, skip_kana=False)


def remove_unspoken_ma(raw: str, cleaned: str) -> str:
    """Remove only excess question particles whose local context was not spoken."""
    extra = cleaned.count("嗎") - raw.count("嗎")
    if extra <= 0:
        return cleaned
    compact_raw = re.sub(r"[\s,，、]", "", raw)
    positions = [index for index, char in enumerate(cleaned) if not re.fullmatch(r"[\s,，、]", char)]
    compact_cleaned = "".join(cleaned[index] for index in positions)
    spoken = set()
    for block in difflib.SequenceMatcher(None, compact_raw, compact_cleaned, autojunk=False).get_matching_blocks():
        for index in range(block.size):
            if compact_raw[block.a + index] == "嗎":
                spoken.add(positions[block.b + index])

    def finish(line: str, protected: set[int], offset: int) -> str:
        nonlocal extra
        output = []
        skip = -1
        for index, char in enumerate(line):
            if index == skip:
                continue
            if char == "嗎" and index not in protected and offset + index not in spoken and extra > 0:
                context = re.sub(r"[\s,，、]", "", line[:index])[-2:] + "嗎"
                if context not in compact_raw:
                    extra -= 1
                    if line[index + 1:index + 2] == "？" and index + 1 not in protected:
                        skip = index + 1
                        if line[index + 2:].strip():
                            output.append("，")
                    continue
            output.append(char)
        return "".join(output)
    return _dictation_prose(cleaned, finish)


def authored_chinese(text: str, chinese: str | None) -> str:
    """Use the owner's chosen Chinese script without selecting a speaking language.

    Kana lines, fenced code and inline code remain byte for byte. English and whitespace
    are unchanged. Only leftover characters are converted, so existing Traditional prose
    does not acquire ambiguous replacements on a second pass.
    """
    chinese = _checked_variant(chinese)
    if chinese is None:
        return text

    def convert(line: str, protected: set[int], offset: int) -> str:
        if line.startswith(("    ", "\t")):
            return line
        pieces = []
        start = 0
        for end in range(1, len(line) + 1):
            if end < len(line) and (end in protected) == (start in protected):
                continue
            piece = line[start:end]
            if start not in protected:
                piece = (convert_leftover_traditional(piece) if chinese == "zh-CN" else
                         convert_leftover_simplified(piece, _TO_TRADITIONAL[chinese]))
            pieces.append(piece)
            start = end
        return "".join(pieces)

    return _dictation_prose(text, convert)


def public_line(text: str, language: str) -> str:
    """A thinking or progress line as the owner sees it: Traditional characters for zh-TW, and
    nothing at all when the line is not written in the owner's language (a model that drifts into
    English mid-task must not put an English line in a Chinese conversation)."""
    text = text.strip()
    if "{" in text or "}" in text or "```" in text:
        # CLI commentary can contain a reply envelope, including a partial streamed object.
        # Decode the whole object before selecting public text; malformed packets are dropped.
        start = text.find("{")
        if start < 0:
            return ""
        try:
            value, _ = json.JSONDecoder().raw_decode(text, start)
        except ValueError:
            return ""
        if not isinstance(value, dict):
            return ""
        value = value.get("progress", value.get("text", ""))
        if not isinstance(value, str) or any(mark in value for mark in ("{", "}", "```")):
            return ""
        text = value.strip()
    if not text:
        return ""
    if language == "zh-TW":
        return convert_leftover_simplified(text) if _HAN.search(text) else ""
    if language == "ja":
        return text if (_KANA.search(text) or _HAN.search(text)) else ""
    return text
