"""A member's tasks begin with the same rules, so the provider reads them from its cache (owner, 2026-11-09)."""

import json
from datetime import timezone

import pytest

from members.conftest import QuietModel
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.members.service import MembersService
from raphael_core.memory.service import MemoryService
from .conftest import turn, until


async def test_a_members_tasks_keep_one_system_prompt_while_the_team_changes(make_rig, conn, tmp_path):
    """Live, a meeting's state changed from one reply to the next, and with the team in the system prompt
    each reply had the provider read the member's whole prefix again at full price."""
    rig = make_rig()
    memory = MemoryService(conn, tmp_path / "memory", QuietModel(), MemoryKeyStore(), quiet_s=3600, start_delay_s=3600)
    members = MembersService(conn, tmp_path, background=rig.service, memory=memory, now_ms=rig.wall, tz=timezone.utc)
    memory.member_exists = members.member_exists

    async def unused(*args, **kwargs):
        pytest.fail("No team tool is needed")

    rig.service.use_memory(memory)
    rig.service.use_team(members, unused)
    teacher = members.store.create_member(name="Teacher", role="Japanese")
    try:
        systems, tasks = [], []
        for number in (1, 2):
            rig.client.replies.append(turn(json.dumps({"prefix": "告", "text": "Ready.", "detail": ""})))
            task_id = rig.service.submit(session_id=f"task-{number}", text="Start.", language="en",
                                         model="fake/model", member_id=teacher.id)
            await until(lambda: rig.task(task_id).state not in ("queued", "running"))
            system, task = (message["content"] for message in rig.client.chat_calls[-1]["messages"][:2])
            systems.append(system)
            tasks.append(task)
            if number == 1:
                members.store.create_member(name="Newcomer", role="Running")  # the team changes between the two tasks
        assert systems[0] == systems[1]
        assert "<team_roster>" not in systems[0] and "Newcomer" not in systems[1]
        # The team as it is when the task starts comes with the task itself, after what was asked.
        assert "<team_roster>" in tasks[0] and "Newcomer" not in tasks[0] and "Newcomer" in tasks[1]
        assert tasks[1].index("<task>") < tasks[1].index("<team_roster>")
    finally:
        await members.aclose()
        await memory.aclose()
