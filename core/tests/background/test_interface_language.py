"""A routine or a task is told nothing of the interface language (owner, 2026-11-14): 「它的 UI 語言就是單純 UI 語言而已，
它也不會去到 system prompt，什麼事都不會發生」. It writes in the language the owner writes in, which its own words show;
the notices the app draws of it keep the interface language. Fake models only."""

import json
from datetime import timezone

import pytest

from members.conftest import QuietModel
from raphael_core.background.service import TASK_LANGUAGE
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.members.service import MembersService
from raphael_core.memory.service import MemoryService
from .conftest import turn, until

ROUTINE = "每天早上整理三則科技新聞，每則附上來源連結。"
INTERFACE_HINTS = ("configured reply language", "Interface locale", "This selects fixed UI labels only")


@pytest.mark.parametrize("routine_id", [1, None])
async def test_a_routine_written_in_chinese_is_told_nothing_of_a_japanese_interface(make_rig, conn, tmp_path, routine_id):
    rig = make_rig()
    memory = MemoryService(conn, tmp_path / "memory", QuietModel(), MemoryKeyStore(), quiet_s=3600, start_delay_s=3600)
    members = MembersService(conn, tmp_path, background=rig.service, memory=memory, now_ms=rig.wall, tz=timezone.utc)
    memory.member_exists = members.member_exists

    async def unused(*args, **kwargs):
        pytest.fail("No team tool is needed")

    rig.service.use_memory(memory)
    rig.service.use_team(members, unused)
    reader = members.store.create_member(name="Reader", role="News reader")
    try:
        sent, languages = {}, {}
        for number, interface in enumerate(("ja", "en")):
            rig.service.owner_language = lambda interface=interface: interface
            rig.client.replies.append(turn(json.dumps({"prefix": "notice", "text": "今天的三則重點。", "detail": ""})))
            task_id = rig.service.submit(session_id=f"routine:{number}", text=ROUTINE, language=interface,
                                         model="fake/model", member_id=reader.id, routine_id=routine_id)
            await until(lambda: rig.task(task_id).state not in ("queued", "running"))
            sent[interface] = tuple(message["content"] for message in rig.client.chat_calls[-1]["messages"][:2])
            languages[interface] = rig.task(task_id).language
        system, task = sent["ja"]
        for hint in INTERFACE_HINTS:
            assert hint not in system and hint not in task
        # The task says which language with no language named: the owner's words, else the task's own text.
        assert TASK_LANGUAGE in task and ROUTINE in task
        assert "拉斐爾" in task and "ラファエル" not in task
        assert sent["ja"] == sent["en"]
        # What the app draws of the run (its notices, its waiting line) keeps the interface language.
        assert languages == {"ja": "ja", "en": "en"}
    finally:
        await members.aclose()
        await memory.aclose()
