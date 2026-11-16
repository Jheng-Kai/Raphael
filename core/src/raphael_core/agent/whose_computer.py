"""Whose computer a quick question means: the member's own, or the owner's PC.

A quick question (Alt+Space) is the one place the owner's own screen is in reach (R-PC-01), and the fast router can answer
a request to open something with a fixed command that opens it there. The owner also says 「用你的電腦開…」 to mean
Raphael's own computer, the member's seat; read as "open", that sentence opened the page on their own PC and left them an
empty reply. So a request that names the member's computer never takes the owner-PC shortcut: it goes to the member's turn
of the quick question, which holds both computers, and the model reads the words and picks. Nothing here takes a computer
away or reaches one: the words only choose between the shortcut and the model.

The words are matched, not guessed, and a sentence that names both computers is the member's (the model reads it whole).
A request that names no one's computer is the owner's PC's, the quick question's default: it takes the shortcut as ever.
"""

import re
import unicodedata

MEMBER, OWNER = "member", "owner"

# A word for a computer. `pc` is cut out of a longer Latin word by lookarounds, since a Chinese character is a word
# character and `\b` would not stand between 的 and pc.
_PC = r"(?<![a-z0-9])pc(?![a-z0-9])"
# A Mac is a computer too, by its own names.
_MAC = r"(?<![a-z0-9])(?:mac(?! address)|macbook(?: air| pro)?|imac|mac mini|mac studio)(?![a-z0-9])"
_MACHINE_ZH = rf"(?:電腦|电脑|筆電|笔电|筆記型電腦|笔记本|桌機|虛擬機|虚拟机|{_PC}|{_MAC})"
_MACHINE_EN = rf"(?:computer|pc|laptop|machine|{_MAC})"
_MACHINE_JA = rf"(?:パソコン|コンピューター|コンピュータ|ピーシー|{_PC}|{_MAC})"
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


def _plain(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def whose_computer(text: str) -> str | None:
    """MEMBER when the request names the member's own computer, OWNER when it names the owner's PC, and None when it
    names no one's (the owner's PC, the quick question's default)."""
    spoken = _plain(text)
    if _MEMBER.search(spoken):
        return MEMBER  # also when it names the owner's too: the shortcut could not tell them apart, the model reads it whole
    if _OWNER.search(spoken):
        return OWNER
    return None
