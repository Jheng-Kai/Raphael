"""Whether a routine's run did its work (owner, 2026-11-11: runs ended "done" with nothing made, and the owner could not tell a
failed run from a good one).

A run is done only when its turn ended without an error AND the work was not refused on the way AND, for a routine whose purpose
is something made (a page, a draft), what it was to make exists. The judgement reads what the run did (`TaskRun.succeeded`,
`TaskRun.last_refused`) and the routine's instructions; it never reads the words of the model's report.
"""

import re

# What a call that the app did not allow (or nobody answered) ends with: the member did not get what it asked for. A call that
# fails for another reason (a service that is down, bad arguments) is the member's to retry and report; it counts only when
# nothing else of the run went through. The owner's own no (`declined`) is the owner's decision, not a failure of the run.
REFUSED_KINDS = frozenset({
    "protected_data", "forbidden", "approval_required", "unknown_tool", "unavailable", "unanswered", "blocked",
    "tool_disabled", "presence_required", "computer_permission_required", "own_routines_only",
})

# What makes each kind of thing a routine can be set to make.
PRODUCERS = {
    "page": frozenset({"show_page", "update_page"}),
    "draft": frozenset({"email_draft", "slack_draft"}),
}

_NEGATED = re.compile(r"(?:do not|don't|never|without|不要|不得|勿|無需|不用|しないで|不要で)[^.;。\n]*", re.I)
_PAGE_TOOL = re.compile(r"\b(?:show|update)_page\b")
_DRAFT_TOOL = re.compile(r"\b(?:email|slack)_draft\b")
_MAKE = r"(?:make|create|build|generate|produce|publish|render|write|put together|turn .{0,30} into)"
_PAGE_EN = re.compile(rf"\b{_MAKE}\b[^.\n]{{0,40}}\b(?:web ?page|html page|report page|page)\b", re.I)
_PAGE_ZH = re.compile(r"(?:做|製作|制作|建立|建立出|生成|產生|生出|撰寫|寫|輸出|整理成|做成|變成|成為|整理為)[^。\n]{0,14}(?:網頁|网页|頁面|页面|報告頁)"
                      r"|(?:網頁|网页|頁面|页面|報告頁)[^。\n]{0,6}(?:製作|制作|生成|產生|建立)", re.I)
_PAGE_JA = re.compile(r"ページ[^。\n]{0,10}(?:作成|作る|作って|生成|まとめ|公開)|(?:作成|作る|作って|生成|まとめ|公開)[^。\n]{0,14}ページ")
_DRAFT = re.compile(r"\b(?:draft)\b[^.\n]{0,30}\b(?:email|mail|message|slack)\b|\b(?:email|mail|slack)\b[^.\n]{0,30}\bdraft\b|草稿|下書き", re.I)


def expected(prompt: str) -> str | None:
    """What a routine with these instructions is set to make: "page", "draft", or None when its purpose is no
    artefact (a check, a summary said in the conversation). Words a prompt negates ("do not make a page") do not count."""
    text = _NEGATED.sub(" ", prompt or "")
    if _PAGE_TOOL.search(text) or _PAGE_EN.search(text) or _PAGE_ZH.search(text) or _PAGE_JA.search(text):
        return "page"
    if _DRAFT_TOOL.search(text) or _DRAFT.search(text):
        return "draft"
    return None


def failure(prompt: str, succeeded: set[str], last_refused: tuple[str, str] | None, tool_calls: int) -> str | None:
    """Why a run whose turn ended well did not do its work: "routine_refused" when the last tool it tried was refused and
    nothing it did after went through, "routine_nothing" when it was to make something and did not, or when every
    tool it called failed; None when it did its work."""
    if last_refused is not None:
        return "routine_refused"
    made = expected(prompt)
    if made is not None and not succeeded & PRODUCERS[made]:
        return "routine_nothing"
    if tool_calls and not succeeded:
        return "routine_nothing"
    return None
