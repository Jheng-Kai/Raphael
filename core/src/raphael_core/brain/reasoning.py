"""A model's reasoning, told apart from its answer.

Some models put their reasoning in the same channel as the answer: a `<think>…</think>` block (or `<thinking>`) leading
the content, a closing tag with no opening one (the chat template opened it), or a harmony-style stream whose
`analysis` channel comes before the `final` one. The owner reads the answer; the reasoning goes to the turn's thinking
part, and a reply that is only reasoning has no answer at all.

Only structure that leads the text counts, never a tag further in: a reply that talks about `<think>` in the middle
of its prose, or shows it in a code block, is the model's own words.
"""

import re

# Parts of a message's content list that hold reasoning, and the field each keeps its words in.
REASONING_PARTS = ("reasoning", "thinking", "reasoning_text", "reasoning.text", "reasoning.summary", "redacted_thinking")
TEXT_PARTS = (None, "text", "output_text")

_TAGS = r"think|thinking|thought|reasoning"
_LEADING = re.compile(rf"\s*<({_TAGS})>(.*?)</\1>", re.S | re.I)
_UNCLOSED = re.compile(rf"\s*<({_TAGS})>(.*)\Z", re.S | re.I)
_STRAY_CLOSE = re.compile(r"(.*?)</think(?:ing)?>", re.S | re.I)
_OPENING = re.compile(rf"<(?:{_TAGS})>", re.I)

_HARMONY = re.compile(r"<\|channel\|>\s*(\w+)[^<]*?<\|message\|>(.*?)(?=<\|end\|>|<\|return\|>|<\|call\|>|<\|start\|>|<\|channel\|>|\Z)", re.S)
_HARMONY_TOKENS = re.compile(r"<\|(?:start|end|return|call|channel|message|constrain)\|>")


def split_reasoning(text: str) -> tuple[str, str]:
    """(the answer, the reasoning) of a text. The answer is the text unchanged when nothing leads it that is reasoning."""
    if not text:
        return text, ""
    if "<|channel|>" in text:
        found = _HARMONY.findall(text)
        if found:
            answer = "".join(body for channel, body in found if channel == "final")
            thought = "\n".join(body.strip() for channel, body in found if channel != "final")
            return _HARMONY_TOKENS.sub("", answer).strip(), thought.strip()
    thoughts, rest = [], text
    while match := _LEADING.match(rest):
        thoughts.append(match.group(2).strip())
        rest = rest[match.end():]
    if match := _UNCLOSED.match(rest):  # it began to think and never answered
        thoughts.append(match.group(2).strip())
        rest = ""
    elif not thoughts and (stray := _STRAY_CLOSE.match(rest)) and not _OPENING.search(stray.group(1)) and "`" not in stray.group(1):
        thoughts.append(stray.group(1).strip())
        rest = rest[stray.end():]
    if not thoughts:
        return text, ""
    return rest.strip(), "\n".join(thought for thought in thoughts if thought)


# --- planning notes written as the first words of a reply -----------------------------------------------------------------
# A model that is not given a channel for its reasoning sometimes writes a note to itself where its reply begins ("The user
# answered both. I should confirm Q1, explain Q2, then ask W-8BEN.") and the answer straight after it. It is no reply of the
# owner's: it is English in a conversation held in Chinese, Japanese or Korean, and it is about the owner in the third person.

_CJK_OWNER = ("zh-TW", "zh-CN", "ja", "ko")
_OWNER_SCRIPT = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]")
_FRAME_OPEN = re.compile(r"\s*《[^》\n。.：:]{1,12}[。.：:]\s*")
# The boundary of a Latin-script sentence that runs into the owner's language on the same line.
_RUN_ON = re.compile(r"((?<=[.!?:)\]])[ \t]*(?=[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]))")
_PLANNING = re.compile(
    r"\b(?:I (?:should|need to|must|will|want to) (?:respond|reply|answer|explain|confirm|ask|check|compute|calculate|say|tell|mention|"
    r"give|offer|keep|avoid|first|also|then|not)\b|(?:the|this) (?:user|owner)\b|"
    r"(?:he|she|they|Jack) (?:says?|said|wants?|asked|answered|is asking|mentioned)\b|plan\s*:|next,? I\b)", re.I)
_NOTE_WORDS = 8


def _latin_note(piece: str) -> bool:
    """Whether a piece of a reply is Latin-script prose: a few words of the owner's language in it (his title, a name) are
    allowed, a sentence of it is not."""
    latin, owner = len(re.findall(r"[A-Za-z]", piece)), len(_OWNER_SCRIPT.findall(piece))
    return (latin >= 3 and owner * 3 <= latin and "```" not in piece
            and not piece.lstrip().startswith(("#", "|", "-", "*", "{", "[", ">", "    ")))


def split_notes(text: str, language: str) -> tuple[str, str]:
    """(the reply, the notes) of a text in a conversation held in Chinese, Japanese or Korean: the notes are what leads the
    reply when that is English planning (a first-person plan or the owner spoken of as "the user", at least eight words) and
    the owner's language follows it. A reply that opens with English the owner asked for, a quotation or code is the reply
    whole; so is every other language, where the notes cannot be told apart from the answer by their script."""
    if language not in _CJK_OWNER or not text:
        return text, ""
    frame = _FRAME_OPEN.match(text)
    body = text[frame.end():] if frame else text
    pieces = [piece for part in re.split(r"(\n\s*\n)", body) for piece in re.split(_RUN_ON, part)]
    taken = 0
    for piece in pieces:
        if not piece.strip() or _latin_note(piece):
            taken += len(piece)
            continue
        break
    note = body[:taken]
    if (not note.strip() or len(re.findall(r"[A-Za-z]{2,}", note)) < _NOTE_WORDS or not _PLANNING.search(note)
            or len(_OWNER_SCRIPT.findall(body[taken:])) < 2):
        return text, ""
    return (text[:frame.end()] if frame else "") + body[taken:].lstrip(), note.strip()
