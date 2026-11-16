"""Whether a routine's run did its work: a run that ended "done" with nothing made must not look like a good one.

A run is done only when its turn ended without an error AND the work was not refused on the way AND, for a routine whose purpose
is something made (a page, a draft), what it was to make exists. The judgement reads what the run did (`TaskRun.succeeded`,
`TaskRun.last_refused`, `TaskRun.written`) and the routine's instructions; it never reads the words of the model's report.

What a routine is set to make can only be read from its own words, so each part is read on its own: a page or a draft counts
when a verb of making has it as its object, and not when the part says not to make it, when the page is what the routine
reads or checks, or when the draft is words written in the conversation.
"""

import re

# What a call that the app did not allow (or nobody answered) ends with: the member did not get what it asked for. A call that
# fails for another reason (a service that is down, bad arguments) is the member's to retry and report; it counts only when
# nothing else of the run went through. The owner's own no (`declined`) is the owner's decision, not a failure of the run.
REFUSED_KINDS = frozenset({
    "protected_data", "forbidden", "approval_required", "unknown_tool", "unavailable", "unanswered", "blocked",
    "tool_disabled", "presence_required", "computer_changed", "own_routines_only",
})

# What makes each kind of thing a routine can be set to make.
PRODUCERS = {
    "page": frozenset({"show_page", "update_page"}),
    "draft": frozenset({"email_draft", "slack_draft"}),
}
# A connected app makes a page or a draft with a tool of its own (a Notion page, a Gmail draft): its name says what it
# makes, and the one tool that runs any other tool of its app says nothing, so a call of it that went through counts.
APP_PRODUCERS = {
    "page": frozenset({"page", "pages", "doc", "docs", "document", "documents", "wiki", "canvas"}),
    "draft": frozenset({"draft", "drafts"}),
}
APP_EXECUTORS = frozenset({"execute", "executor"})

# Where one thing the instructions say ends: a sentence, then a part of it that has its own verb.
_SENTENCE = re.compile(r"[^;。\n!?！？；]+")
_SENTENCE_END = re.compile(r"\.(?=\s|$)")
_PART = re.compile(r"[,，、:：]|\b(?:but|then|instead|however)\b|但是?|然後|然后|而是|改為|改为|反而", re.I)
# A part that goes on with the list of what is not to be made ("do not make a page, or a draft").
_LISTED = re.compile(r"\s*(?:(?:or|nor|and)\b|或者?|以及|及|和|與|与|還是|还是|也不要?)", re.I)
# What says not to make something: before it in English and Chinese, after it in Japanese.
_NOT_BEFORE = re.compile(
    r"\b(?:do not|don't|dont|never|without|avoid|skip|no need to|need not|must not|mustn't|should not|shouldn't|"
    r"instead of|rather than|not to)\b|不要|不得|勿|無需|无需|不用|不必|請勿|请勿|避免|禁止|不需要|無須|无须|不能|不可", re.I)
_NOT_AFTER = re.compile(r"ないで|なくて|しない|せず|ずに|不要|いらない|禁止|ません|無し|なし|控え|やめ")
_KANA = re.compile(r"[ぁ-んァ-ヶ]")

_PAGE_TOOL = re.compile(r"\b(?:show|update)_page\b")
_DRAFT_TOOL = re.compile(r"\b(?:email|slack)_draft\b")

# A page: made by a verb that has it as its object, a few plain words from it. A word that turns the page into what the
# verb is about ("write a summary of the page", "make sure the page loads", "create a ticket for each page") ends the span.
_MAKE = r"(?:make|create|build|generate|produce|publish|render|write|put together)"
_NOT_OBJECT = (r"(?:of|on|about|for|at|to|from|that|which|with|in|into|sure|every|each|per|when|if|whether|after|before|by|"
               r"regarding|than|who|where|while|so|announcing|describing|explaining|covering|summari[sz]ing|reviewing|"
               r"checking|testing|fixing|monitoring|listing)")
_PAGE_NOUN = r"(?:web ?pages?|html pages?|pages?)"
_PAGE_EN = re.compile(rf"\b{_MAKE}\b(?:\s+(?!{_NOT_OBJECT}\b)[\w'’-]+){{0,4}}\s+{_PAGE_NOUN}\b"
                      rf"|\bturn\b[^\n]{{0,30}}\binto\b(?:\s+(?!{_NOT_OBJECT}\b)[\w'’-]+){{0,3}}\s+{_PAGE_NOUN}\b", re.I)
# Chinese has no spaces: the verb and the noun are close, and a word that makes the page the subject of a check ends the span.
_ZH_MAKE = (r"(?:做|製作|制作|建立|生成|產生|产生|生出|撰寫|撰写|寫|写|輸出|输出|整理成|做成|變成|变成|成為|成为|整理為|整理为|"
            r"設計|设计|發布|发布|產出|产出)")
_ZH_PAGE = r"(?:網頁|网页|頁面|页面|報告頁|报告页)"
_ZH_GAP = (r"(?:(?!關於|关于|有關|有关|針對|针对|對於|对于|檢查|检查|確認|确认|測試|测试|檢測|检测|監測|监测|是否|能否|可否|能不能|"
           r"有沒有|有没有|如果|每個|每个|所有|各個|各个)[^。\n，,、；;:：])")
_PAGE_ZH = re.compile(rf"{_ZH_MAKE}{_ZH_GAP}{{0,14}}{_ZH_PAGE}|{_ZH_PAGE}{_ZH_GAP}{{0,6}}(?:製作|制作|生成|產生|产生|建立)")
# Japanese: a page of a site ("ホームページ"), or a count of pages ("1ページ"), is no page to make.
_JA_PAGE = r"(?<!ホーム)(?<!トップ)(?<![0-9０-９一二三四五六七八九十])ページ"
_JA_GAP = r"(?:(?!確認|チェック|について|に関する|かどうか|調べ)[^。\n、])"
_PAGE_JA = re.compile(rf"{_JA_PAGE}{_JA_GAP}{{0,10}}(?:作成|作る|作って|作り|生成|公開)|{_JA_PAGE}(?:に|として|へ)まとめ"
                      rf"|(?:作成|作る|作って|作り|生成|公開|まとめ){_JA_GAP}{{0,14}}{_JA_PAGE}")

# A draft is something made only as an email or a Slack draft (`PRODUCERS["draft"]`): a post, an article or a reply drafted in the
# conversation is words, not a thing to find, so 草稿 / 下書き alone say nothing (a routine that drafted a post was failed for it).
# Nor does a part that reads or checks drafts, or names the folder of them: a verb of making is needed.
_MAIL = r"(?:email|e-mail|mail|gmail|outlook|slack|郵件|邮件|信件|回信|封信|電郵|电邮|メール)"
_EN_MAIL = r"(?:email|e-mail|mail|gmail|outlook|slack|message)"
_EN_DRAFTS = r"(?:draft|write|compose|prepare|create|make|put together|generate|produce|save|leave|stage|queue|set up)"
_NOT_DETERMINED = r"(?<!\bthe )(?<!\ba )(?<!\ban )(?<!\bmy )(?<!\bthat )(?<!\bthis )(?<!\bany )(?<!\bevery )(?<!\bno )"
_DRAFT_EN = re.compile(
    rf"{_NOT_DETERMINED}\bdraft\b[^\n]{{0,30}}\b{_EN_MAIL}\b"
    rf"|\b{_EN_DRAFTS}\b[^\n]{{0,40}}?\b{_EN_MAIL}\b[^\n]{{0,30}}?\bdraft\b"
    rf"|\b{_EN_DRAFTS}\b[^\n]{{0,40}}?\bdraft\b[^\n]{{0,30}}?\b{_EN_MAIL}\b", re.I)
_ZH_DRAFT = r"草稿(?!夾|夹|匣|箱|文件夾|文件夹)"
_ZH_DRAFTS = (r"(?:擬|拟|寫|写|撰寫|撰写|準備|准备|建立|生成|產生|产生|製作|制作|起草|草擬|草拟|存成|儲存|储存|保存|"
              r"新增|放進|放进|備好|备好|整理|做)")
_JA_DRAFTS = r"(?:作成|作って|作る|作り|書いて|書く|用意|保存|準備|残して|入れて)"
_DRAFT_ASIA = re.compile(rf"{_MAIL}[^\n]{{0,12}}(?:{_ZH_DRAFT}|下書き)|(?:{_ZH_DRAFT}|下書き)[^\n]{{0,12}}{_MAIL}", re.I)
_DRAFT_ASIA_MAKES = re.compile(f"{_ZH_DRAFTS}|{_JA_DRAFTS}")


def _parts(text: str):
    """Every part of the instructions that has its own verb, as (text, listed): the stretch of a sentence between its commas
    and its words of turning ("but", "then"); `listed` when it goes on with what the part before it said not to make."""
    for sentence in _SENTENCE.finditer(_SENTENCE_END.sub("\n", text)):
        listed = False
        for part in _PART.split(sentence.group()):
            before = listed and bool(_LISTED.match(part))
            yield part, before
            listed = before or bool(_NOT_BEFORE.search(part))


def _made(part: str, negated_before: bool) -> str | None:
    """What one part says to make: "page", "draft" or None. A part that says not to is no instruction to make."""
    found = []
    for kind, patterns in (("page", (_PAGE_TOOL, _PAGE_EN, _PAGE_ZH, _PAGE_JA)),
                           ("draft", (_DRAFT_TOOL, _DRAFT_EN))):
        for pattern in patterns:
            for match in pattern.finditer(part):
                found.append((kind, match))
    if _DRAFT_ASIA_MAKES.search(part):
        for match in _DRAFT_ASIA.finditer(part):
            found.append(("draft", match))
    for kind, match in found:
        after = _NOT_AFTER.search(part[match.end():]) if _KANA.search(part) else None
        if not (negated_before or _NOT_BEFORE.search(part[:match.start()]) or after):
            return kind
    return None


# What a trigger adds after the routine's own words (an email, a webhook's body): data from outside, never what the routine is for.
_OUTSIDE = '<tool_result untrusted="true"'


def expected(prompt: str) -> str | None:
    """What a routine with these instructions is set to make: "page", "draft", or None when its purpose is no
    artefact (a check, a summary said in the conversation). Words a prompt negates ("do not make a page") do not count,
    and nor do the words of the item that started the run: anyone who can send one must not decide what the run is for."""
    kinds = {_made(part, listed) for part, listed in _parts((prompt or "").split(_OUTSIDE, 1)[0])}
    return "page" if "page" in kinds else "draft" if "draft" in kinds else None


def _name_words(name: str) -> set[str]:
    """The words a tool's name is made of: `notion-update-page`, `GMAIL_CREATE_DRAFT` and `createPage` all say them."""
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    return {word.lower() for word in re.split(r"[^A-Za-z0-9]+", spaced) if word}


def made(kind: str, succeeded: set[str], written: frozenset[str] | set[str] = frozenset()) -> bool:
    """Whether the run made what `kind` is: one of Raphael's own tools that makes it went through, or a tool of a connected
    app that writes did and its name says it makes it (or it is the tool that runs any other tool of its app)."""
    if succeeded & PRODUCERS[kind]:
        return True
    return any(words & (APP_PRODUCERS[kind] | APP_EXECUTORS) for words in map(_name_words, written))


def failure(prompt: str, succeeded: set[str], last_refused: tuple[str, str] | None, tool_calls: int,
            written: frozenset[str] | set[str] = frozenset()) -> str | None:
    """Why a run whose turn ended well did not do its work: "routine_refused" when the last tool it tried was refused and
    nothing it did after went through, "routine_nothing" when it was to make something and did not, or when every
    tool it called failed; None when it did its work. `written` is the tools of connected apps that changed something."""
    if last_refused is not None:
        return "routine_refused"
    wanted = expected(prompt)
    if wanted is not None and not made(wanted, succeeded, written):
        return "routine_nothing"
    if tool_calls and not succeeded:
        return "routine_nothing"
    return None
