"""Where a member's next call finds its cached prefix (owner, 2026-11-09, decisions 1, 3 and 4)."""

import json
from types import SimpleNamespace

from raphael_core.background.run import task_cache_session

from .test_cli_recovery import recovery_rig
from .test_narration import chat, typed
from .test_plugins import calls, plugins  # noqa: F401
from .test_service import make_rig  # noqa: F401
from .conftest import decision
from raphael_core.agent.cli.drivers import Event


async def test_a_private_conversation_names_itself_and_keeps_its_cache_for_an_hour(make_rig, plugins, calls, client):
    await plugins.connect(note="T1")
    rig = make_rig(plugins=plugins.hub)
    client.decisions.append(decision("answer"))
    client.chats = [chat(json.dumps({"prefix": "Answer", "text": "Done.", "detail": ""}))]
    done = await typed(rig, "Say done")
    assert done["text"] == "Done."
    call = client.chat_calls[0]
    assert call["session"].startswith("raphael-0-") and call["cache_ttl"] == "1h"


def test_background_work_names_the_group_thread_or_the_task_it_belongs_to():
    room = SimpleNamespace(id=9, member_id=3, scope="room", room_id=4, thread_id=6, root_task_id=9)
    work = SimpleNamespace(id=12, member_id=3, scope="private", room_id=None, thread_id=None, root_task_id=10)
    assert task_cache_session(room) == "raphael-room-4-6-3"
    assert task_cache_session(work) == "raphael-task-10"
    assert task_cache_session(None) is None


async def test_claude_code_keeps_one_working_directory_per_member_and_codex_one_per_conversation(monkeypatch, tmp_path):
    async def play(loop, attempt):
        yield Event("final", "Done.")

    seen = {}
    for brain in ("claude", "codex"):
        for conversation in (7, 8):
            rig = recovery_rig(monkeypatch, tmp_path, play, brain=brain)
            rig.loop.conversation_id = conversation
            await rig.loop.run()
            seen[brain, conversation] = rig.calls[0]["cwd"]
    # Claude Code shares a cached prefix only within one directory: all of member 5's conversations use one.
    assert seen["claude", 7] == seen["claude", 8]
    assert seen["codex", 7] != seen["codex", 8]
