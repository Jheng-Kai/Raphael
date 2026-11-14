"""Whose computer a quick question means: the member's own, or the owner's PC.

A quick question (Alt+Space) is the one place the owner's own PC is in reach (R-PC-01), and the fast router can answer
a request to open something with a fixed command that opens it there. The owner also says 「用你的電腦開…」 to mean
Raphael's own computer, the member's seat; read as "open", that sentence opened the page on his own PC and left him an
empty reply (2026-11-13 and -14). So a request that names the member's computer never takes the owner-PC shortcut: it
goes to the member's ordinary turn, which uses its own computer. The owner's PC is only ever *kept* from such a request;
nothing here reaches it.

The words are matched, not guessed, and a sentence that names both computers is the member's (the safe way). A request
to open something on "the computer" or "use a computer", with no one's name on it, could be either: that is asked once.
"""

import re
import unicodedata

MEMBER, OWNER, UNSURE = "member", "owner", "unsure"

# A word for a computer. `pc` is cut out of a longer Latin word by lookarounds, since a Chinese character is a word
# character and `\b` would not stand between 的 and pc.
_PC = r"(?<![a-z0-9])pc(?![a-z0-9])"
_MACHINE_ZH = rf"(?:電腦|电脑|筆電|笔电|筆記型電腦|笔记本|桌機|虛擬機|虚拟机|{_PC})"
_MACHINE_EN = r"(?:computer|pc|laptop|machine)"
_MACHINE_JA = rf"(?:パソコン|コンピューター|コンピュータ|ピーシー|{_PC})"
# What stands between a person and their computer: 的, 自己, 這台.
_ZH_BETWEEN = r"\s*(?:自己|本人|自身)?\s*的?\s*(?:那台|這台|那部|這部|那個|這個|虛擬|虚拟|雲端|云端)?\s*"
_NAME_ZH = r"(?:拉斐爾|拉菲爾|拉斐尔|raphael)"

# The member's own computer. Raphael is addressed as 你 (or by name), so 你的電腦 is its computer, and so is 「你去用電腦」.
_MEMBER = re.compile("|".join([
    rf"(?:你|妳|您|{_NAME_ZH}){_ZH_BETWEEN}{_MACHINE_ZH}",
    rf"(?:你|妳|您)\s*(?:自己|去|來|来|幫我|帮我|先)?\s*(?:用|使用)\s*(?:一下)?\s*{_MACHINE_ZH}",
    rf"\b(?:your|ur|raphael'?s?)\s+(?:own\s+)?(?:virtual\s+)?{_MACHINE_EN}\b",
    rf"\byou\s+(?:use|using|can use|should use)\s+(?:the\s+|a\s+)?{_MACHINE_EN}\b",
    rf"(?:あなた|貴方|君|きみ|ラファエル)\s*(?:自身|自分)?\s*の\s*{_MACHINE_JA}",
]))

# The owner's PC: 我的電腦, 這台電腦, 本機.
_OWNER = re.compile("|".join([
    rf"(?:我|咱|咱們|我們|俺){_ZH_BETWEEN}{_MACHINE_ZH}",
    rf"(?:這台|這部|这台|这部|本機|本机|本地|本端){_MACHINE_ZH}?",
    rf"\b(?:my|this|our)\s+(?:own\s+)?{_MACHINE_EN}\b",
    r"\b(?:locally|on this one)\b",
    rf"(?:私|僕|ぼく|わたし|俺|うち)\s*の\s*{_MACHINE_JA}",
    rf"この\s*{_MACHINE_JA}",
]))

# A computer named with no one's name on it, and a verb that opens something: 「用電腦開 YouTube」, 「open it on the computer」.
_BARE = re.compile("|".join([_MACHINE_ZH, r"\b(?:computer|pc|laptop)\b", _MACHINE_JA]))
_OPENS = re.compile("|".join([
    r"開|开|打開|打开|啟動|启动|瀏覽|浏览|前往|開い|開く|起動|立ち上げ",
    r"\b(?:open|launch|start|visit|go to|browse|pull up|bring up)\b",
]))

# The words that answer the question (`which_computer`): a short reply that names a side, and one that only agrees.
_SHORT = 16
_OWN_WORD = re.compile(r"自己|本人|自身|你的|你那|妳|你這|你用|\bown\b|\byour|\byours\b|あなた|自分|そっち|そちら")
_THIS_WORD = re.compile(r"這台|這部|这台|这部|這邊|这边|本機|本机|我的|我這|我这|我們|我们|\bthis\b|\bmy\b|\bmine\b|私|この|こっち|こちら|ここ")
_AGREES = re.compile(r"^(?:好|好的|可以|嗯|對|对|都可以|隨便|随便|ok|okay|yes|yeah|sure|any|either|はい|うん|どちらでも)[.!。！ ]*$")


def _plain(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def whose_computer(text: str) -> str | None:
    """MEMBER when the request names the member's own computer, OWNER when it names the owner's PC, UNSURE when it asks to
    open something on "the computer" with no one's name on it, and None when it is about neither."""
    spoken = _plain(text)
    if _MEMBER.search(spoken):
        return MEMBER  # also when it names the owner's too: the member's computer is the one that can do no harm to his PC
    if _OWNER.search(spoken):
        return OWNER
    if _BARE.search(spoken) and _OPENS.search(spoken):
        return UNSURE
    return None


def answer_to_the_question(text: str) -> str | None:
    """Which computer a short reply to `which_computer` chose: MEMBER, OWNER, or None when the reply is something else (a
    longer sentence is a new request, read as any other). A reply that only agrees is the member's: it was asked once,
    and the member's computer is the one that cannot touch the owner's PC."""
    spoken = _plain(text)
    if not spoken or len(spoken) > _SHORT:
        return None
    if _MEMBER.search(spoken):
        return MEMBER
    if _OWN_WORD.search(spoken) and not _THIS_WORD.search(spoken):
        return MEMBER
    if _OWNER.search(spoken) or _THIS_WORD.search(spoken):
        return OWNER
    return MEMBER if _AGREES.match(spoken) else None
