"""Anthropic prompt-cache breakpoints for one request (after Hermes agent/prompt_caching.py, read 2026-11-09).

Anthropic reads a request's prefix from its cache only up to a `cache_control` marker, and takes four at most.
They go at the end of the system prompt and on the last three messages that can carry one, so that each call
reads everything the previous call wrote. A one-shot request gets none: a write nobody reads costs 1.25 times
the input (twice for an hour). Markers ride inside content parts, where OpenRouter honors them, on copies: the
conversation the caller keeps is never changed.

The lifetime (owner, 2026-11-09, decision 1) is the system prompt's: an hour for a conversation somebody waits
on, who may come back after five minutes, five minutes for work that calls every few seconds and is done. The
messages always keep five minutes. The next call of the same turn reads them seconds later, and the next turn
does not read them at all: its message is written anew (`agent.answers.build_user_message`), so an hour there
bought nothing and cost twice the input instead of 1.25 times. Anthropic wants the longer lifetime first, which
the system prompt is.
"""

MAX_MARKERS = 4
ONE_HOUR = "1h"


def cache_options(session: str | None, ttl: str | None) -> dict:
    """The `chat_tools` arguments that keep a conversation's prefix cached: only those set, so a client that
    knows nothing of caching is called as before."""
    return {**({"session": session} if session else {}), **({"cache_ttl": ttl} if ttl else {})}


def marker(ttl: str | None) -> dict:
    return {"type": "ephemeral", "ttl": ONE_HOUR} if ttl == ONE_HOUR else {"type": "ephemeral"}


def one_shot(messages, tools) -> bool:
    """A request no later call reads back: no tools, no earlier answer, at most one user turn."""
    if tools:
        return False
    roles = [message.get("role") for message in messages if isinstance(message, dict)]
    return roles.count("user") <= 1 and not any(role in ("assistant", "tool") for role in roles)


def _carries(message: dict) -> bool:
    """Whether a marker on `message` is honored: only inside a content part, so empty content cannot carry one."""
    content = message.get("content")
    if isinstance(content, str):
        return bool(content)
    return isinstance(content, list) and bool(content) and isinstance(content[-1], dict)


def _marked(message: dict, mark: dict) -> dict:
    content = message["content"]
    parts = [{"type": "text", "text": content}] if isinstance(content, str) else [*content[:-1], dict(content[-1])]
    parts[-1]["cache_control"] = mark
    return {**message, "content": parts}


def mark(messages, tools, ttl: str | None) -> list[dict]:
    """`messages` with breakpoints at the end of the system prompt, kept for `ttl`, and on the last three messages
    that can carry one, kept five minutes; unchanged for a one-shot request."""
    messages = list(messages)
    if one_shot(messages, tools):
        return messages
    left = MAX_MARKERS
    system = next((index for index, message in enumerate(messages) if message.get("role") == "system"), None)
    if system is not None and _carries(messages[system]):
        messages[system] = _marked(messages[system], marker(ttl))
        left -= 1
    for index in range(len(messages) - 1, -1, -1):
        if not left:
            break
        if index != system and messages[index].get("role") != "system" and _carries(messages[index]):
            messages[index] = _marked(messages[index], marker(None))
            left -= 1
    return messages
