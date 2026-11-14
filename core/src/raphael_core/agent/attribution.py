"""Speaker labels for model-facing conversation data, including quoted source evidence."""

from collections.abc import Sequence

from .history import Turn, is_readable

# The most of the words a failed turn ended with that its note quotes.
WHY_CHARS = 120


def unfinished_note(turn: Turn) -> str:
    """What stands for Raphael's words in a turn that ended without an answer: that it did not finish
    and why, and what it already did (`Turn.work`). The line it ended with is an apology or a refusal,
    not an answer, so it is only quoted as the reason of a failure."""
    said = " ".join((turn.text or turn.prefix or "").split())[:WHY_CHARS]
    if turn.status == "denied":
        why = "the owner said no or stopped it"
    elif turn.status == "expired":
        why = "nobody answered it before the app closed or time ran out"
    elif turn.stopped:
        # An answer that gave up after a failed call (R-PERSIST-05): what failed then is no rule for now.
        why = f"it stopped after calls that failed ({turn.stopped}) and said it could not go on. Other ways were not ruled out"
    else:
        why = f'it failed ("{said}")' if said else "it failed"
    return f"[This request did not finish: {why}.{' ' + turn.work if turn.work else ''}]"


def from_colleague(turn: Turn) -> bool:
    """Whether another member handed this turn's words to the member (a question, a hand-off): they are that member's,
    never the owner's, whichever way the turn was written down (owner, 2026-11-11: Raphael's brief to a member stood in its
    conversation as the owner's own message). A hand-off into the member's own work (`worker`, `delegate`) names who handed
    it over in `peer_id`; the owner's own requests name nobody."""
    return turn.source == "member" or (turn.route in ("worker", "delegate") and turn.peer_id is not None
                                      and turn.peer_id != turn.member_id)


def turn_speakers(turn: Turn) -> tuple[str, str]:
    """Stable role labels for old turns as well as newly attributed exchanges."""
    if turn.route == "exchange":
        return "requesting assistant", "responding assistant"
    speaker = f"assistant (member {turn.member_id})" if turn.member_id else "Raphael"
    if turn.route == "routine" or turn.source == "routine":
        return "routine", speaker
    if from_colleague(turn):
        requester = "requesting assistant" if turn.peer_id is None else (
            f"assistant (member {turn.peer_id})" if turn.peer_id else "Raphael"
        )
        return requester, speaker
    return "owner", speaker


def labelled_lines(speaker: str, text: str) -> str:
    """Label every line without changing an existing quotation's inner speaker marking."""
    label = " ".join(speaker.splitlines())
    return "\n".join(f"{label}: {line}" for line in text.splitlines())


def _said_by_owner(turn: Turn) -> bool:
    return (is_readable(turn) and turn.route not in ("exchange", "routine")
            and turn.source not in ("member", "routine") and not from_colleague(turn))


def owner_lines(turns: Sequence[Turn]) -> tuple[str, ...]:
    """Verbatim owner lines from the turns the model reads (answered, or a request that did not
    finish); assistant requests and routines are excluded."""
    return tuple(dict.fromkeys(
        line
        for turn in turns if _said_by_owner(turn)
        for line in turn.question.splitlines() if line.strip()
    ))


def owner_words(turns: Sequence[Turn]) -> list[tuple[int, str]]:
    """The owner's own questions of the turns the model reads, oldest first, each with its turn's id and its
    speaker label: what a fresh native session keeps of them when the turns themselves do not fit."""
    return [(turn.id, labelled_lines("owner", turn.question)) for turn in turns
            if turn.id is not None and _said_by_owner(turn) and turn.question.strip()]


def relayed_answer(speaker: str, text: str, owner_sources: Sequence[str] = ()) -> str:
    """Keep the respondent's words and exact matching owner-source lines distinct.

    Matching is evidence of what the owner said, not an attempt to infer quotation semantics.
    Only lines present verbatim in the reply cross the thread boundary.
    """
    quoted = [line for line in owner_sources if line in text]
    evidence = ""
    if quoted:
        evidence = (
            "source: The owner also said these exact lines; preserve their original attribution.\n"
            + labelled_lines("owner", "\n".join(quoted)) + "\n"
        )
    return evidence + labelled_lines(speaker, text)
