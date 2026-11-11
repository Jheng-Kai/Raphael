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
