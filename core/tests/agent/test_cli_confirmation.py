"""An unanswered card declines one call while the same CLI keeps working."""

import asyncio
import json
from unittest.mock import Mock

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.persona import phrase
from raphael_core.worker.loop import Outcome, Stop, ToolOutcome, WAITING


@pytest.mark.parametrize("swept", [False, True])
@pytest.mark.parametrize("language", ["en", "zh-TW", "ja"])
async def test_an_expired_confirmation_declines_only_its_call(monkeypatch, swept, language):
    expired = Mock()
    calls, replies = [], []

    async def execute(identifier, name, args):
        calls.append(name)
        if name == "routine_create":
            raise Stop(WAITING)
        return ToolOutcome(True, content="The next lookup worked.")

    loop = CliLoop(brains=None, sessions=None, member_id=0, model="cli:codex", ledger=None,
        language=language, plain=True, system="", user="", tools=[], progress=lambda _: None,
        thinking=lambda _: None, event=lambda _: None, execute=execute, expire=expired, wait_timeout_s=0)

    async def work():
        replies.append(await loop._execute("one", "routine_create", {}))
        replies.append(await loop._execute("two", "local_time", {}))
        loop._queue.put_nowait(Outcome("done", final="Finished the rest."))

    monkeypatch.setattr(loop, "_work", work)
    try:
        assert (await loop.run()).kind == WAITING
        if swept:
            loop.continue_with(ToolOutcome(False, "expired", phrase(language, "expired")))
        result = await asyncio.wait_for(loop.run(), 2)
        assert result.final == "Finished the rest."
        assert not replies[0].ok and replies[0].kind == "expired"
        assert replies[0].content == phrase(language, "expired")
        assert replies[1].ok and calls == ["routine_create", "local_time"]
        assert not loop.task.cancelled()
        if not swept:
            expired.assert_called_once()
    finally:
        await loop.aclose()


@pytest.mark.parametrize("language", ["en", "zh-TW", "ja"])
async def test_an_expired_claude_permission_names_the_unanswered_action(language):
    async def execute(identifier, name, args):
        raise Stop(WAITING)

    loop = CliLoop(brains=None, sessions=None, member_id=0, model="cli:claude", ledger=None,
        language=language, plain=True, system="", user="", tools=[], progress=lambda _: None,
        thinking=lambda _: None, event=lambda _: None, execute=execute, wait_timeout_s=0)
    result = await loop._tool("one", "approve", {"tool_name": "Write", "input": {"path": "lesson.txt"}})
    assert json.loads(result.content) == {"behavior": "deny", "message": phrase(language, "expired")}
