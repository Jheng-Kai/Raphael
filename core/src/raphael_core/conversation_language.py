"""The language a conversation is written in, read from its own words, never from the interface.

The owner, 2026-11-14: 「我不是說過系統的 UI 語言並不會影響到使用者內部聊天的語言嗎？它的 UI 語言就是單純 UI 語言而已，它也
不會去到 system prompt，什麼事都不會發生」. The interface language (device.json `ui_language`) picks the words the app draws
and nothing that a model reads. Where code must still choose a per-language piece for a model (Raphael's name in the
team roster, the language a weather tool names a place in, the mark the memory host writes beside an entry), it picks it
from the words of the conversation with `detect_language`: kana is Japanese, Hangul Korean, Han Chinese (Traditional or
Simplified by its characters), Thai and Cyrillic their own; Latin text is the language its common words and letters
point to, else English. It is small and deterministic, and None when the text has no letters to read.
"""

import re
from collections import Counter

# What says nothing about the language a person writes in: links, addresses, code, @names.
_NOISE = re.compile(r"```.*?```|`[^`]*`|https?://\S+|www\.\S+|\S+@\S+\.\S+|@\S+", re.S)
# What a person quotes is the matter, not the language they ask in (「翻譯 'good morning'」 is a Chinese request).
_QUOTED = re.compile(r"「[^」]*」|『[^』]*』|“[^”]*”|\"[^\"\n]*\"|«[^»]*»|(?<!\w)'[^'\n]+'(?!\w)")

_HIRAGANA = re.compile(r"[぀-ゟ]")
_KATAKANA = re.compile(r"[゠-ヿㇰ-ㇿｦ-ﾟ]")
_HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
_HANGUL = re.compile(r"[가-힯ᄀ-ᇿ㄰-㆏]")
_THAI = re.compile(r"[฀-๿]")
_CYRILLIC = re.compile(r"[Ѐ-ӿ]")
_LATIN = re.compile(r"[A-Za-zÀ-ɏḀ-ỿ]")
_WORD = re.compile(r"[A-Za-zÀ-ɏḀ-ỿ]+")

# One CJK character carries about as much of a sentence as a Latin word of three letters: a Chinese request that
# quotes an English phrase is still Chinese, and an English one that names 你好 is still English.
_CJK_WEIGHT = 3

# Common characters whose Simplified and Traditional forms differ, as pairs.
_HAN_PAIRS = (
    "这這们們来來说說时時会會个個为為对對么麼过過还還没沒发發后後问問里裡现現经經动動开開关關长長东東车車书書"
    "学學见見觉覺让讓话話请請谢謝认認识識试試语語读讀写寫听聽买買卖賣钱錢号號门門间間题題页頁头頭电電脑腦网網"
    "络絡机機应應该該实實业業务務处處体體点點种種样樣边邊进進运運国國际際华華气氣数數据據设設计計软軟帮幫记記"
    "忆憶级級线線视視频頻图圖资資讯訊报報纸紙闻聞节節课課练練习習词詞单單满滿难難欢歡乐樂爱愛钟鐘历曆与與从從"
    "众眾优優传傳价價将將当當总總战戰决決况況准準几幾无無产產亲親养養风風飞飛马馬鱼魚鸟鳥龙龍给給们們吗嗎"
)
_SIMPLIFIED = frozenset(_HAN_PAIRS[0::2])
_TRADITIONAL = frozenset(_HAN_PAIRS[1::2])

# The common words of the Latin-script languages Raphael's interface has, and the letters only some of them use.
_LATIN_WORDS = {
    "en": "the and is are you to of what please can this that with for my it how do your have will".split(),
    "es": "el los las que es por para una con qué cómo está hola gracias puedes mi del pero muy también".split(),
    "fr": "le les des est et une pour avec vous je tu pas ce qui dans bonjour merci peux mon sur".split(),
    "de": "der die das und ist nicht ich du sie ein eine mit für auf bitte danke wie was kannst mir".split(),
    "pt-BR": "os uma para com não você obrigado olá como está meu minha por isso muito também".split(),
    "it": "il lo gli che di è un per con non sono ciao grazie come puoi questo della anche".split(),
    "id": "yang dan di ini itu dengan untuk tidak saya anda apa bisa ke dari ada terima kasih tolong aku kamu".split(),
    "vi": "là của và có không tôi bạn được cho này những một với người".split(),
    "tr": "ve bir bu için ile değil ne ben sen nasıl lütfen teşekkür çok daha".split(),
}
_LATIN_LETTERS = {
    "es": "ñ¿¡", "pt-BR": "ãõ", "de": "ßäöü", "fr": "œçèêëîïûù", "it": "ìò",
    "vi": "ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ", "tr": "ğış",
}


def _chinese(text: str) -> str:
    simplified = sum(char in _SIMPLIFIED for char in text)
    traditional = sum(char in _TRADITIONAL for char in text)
    return "zh-CN" if simplified > traditional else "zh-TW"


def _latin(text: str) -> str:
    lowered = text.casefold()
    words = Counter(_WORD.findall(lowered))
    scores = {language: sum(words[word] for word in common) for language, common in _LATIN_WORDS.items()}
    for language, letters in _LATIN_LETTERS.items():
        scores[language] += 2 * sum(lowered.count(letter) for letter in letters)
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    (best, top), (_, second) = ranked[0], ranked[1]
    return best if top >= 2 and top > second else "en"


def detect_language(text: object) -> str | None:
    """The language `text` is written in, as an interface language code (`ui_languages.LANGUAGES`), or None when it
    has no letters to read (an emoji, a number, a bare link). The same text always gives the same answer."""
    if not isinstance(text, str):
        return None
    text = _NOISE.sub(" ", text)
    unquoted = _QUOTED.sub(" ", text)
    return _language(unquoted) or _language(text)


def _language(text: str) -> str | None:
    hiragana, katakana = len(_HIRAGANA.findall(text)), len(_KATAKANA.findall(text))
    han, hangul = len(_HAN.findall(text)), len(_HANGUL.findall(text))
    counts = {
        "cjk": (hiragana + katakana + han) * _CJK_WEIGHT, "ko": hangul * _CJK_WEIGHT,
        "th": len(_THAI.findall(text)), "ru": len(_CYRILLIC.findall(text)), "latin": len(_LATIN.findall(text)),
    }
    script, amount = max(counts.items(), key=lambda item: item[1])
    if amount == 0:
        return None
    if script == "cjk":
        # Japanese grammar always brings hiragana (a tenth of its CJK characters or more); katakana alone, with no Han,
        # is Japanese too. A katakana name inside a Chinese sentence is not.
        japanese = hiragana > 0 and hiragana * 10 >= hiragana + katakana + han or katakana > 0 and han == 0
        return "ja" if japanese else _chinese(text)
    if script == "latin":
        return _latin(text)
    return script


def chat_language(*texts: object, default: str = "en") -> str:
    """The language of the first of `texts` that has one (the owner's latest words, then what stands for them), else
    `default`. Never the interface language: a caller passes the conversation's own words."""
    for text in texts:
        if (language := detect_language(text)) is not None:
            return language
    return default
