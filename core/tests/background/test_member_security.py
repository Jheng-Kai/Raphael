"""The real worker offers member tools and waits for approval before a profile write."""

import pytest

from raphael_core.agent.speaker import Speaker
from raphael_core.agent.tools import ToolResult
from raphael_core.background.snapshot import take_snapshot
from raphael_core.management import background_management
from raphael_core.members.service import MembersService
from raphael_core.protocol import RpcError
from .conftest import report, turn, until, use
from .test_run import rig  # noqa: F401


@pytest.mark.parametrize("allowed", [frozenset({"gmail"}), None])
async def test_background_rechecks_connection_grant_at_execution(rig, allowed):
    server = await rig.plugins.connect(name="Notion", look="T0")
    rig.resnap()
    speaker = Speaker(id=1, tools=allowed)
    rig.run.tool_allowed = speaker.uses_plugin
    result = await rig.tool("Notion__look", {"topic": "nothing private"})
    assert result["ok"] == (allowed is None)
    if allowed is not None:
        assert result["kind"] == "tool_disabled" and "owner disabled" in result["content"]
    snapshot = take_snapshot(rig.plugins.hub, speaker=speaker)
    assert ("Notion__look" in snapshot.pool.by_alias) == (allowed is None)
    snapshot.refresh_plugins(rig.plugins.hub, speaker.id)
    assert ("Notion__look" in snapshot.pool.by_alias) == (allowed is None)
    assert (snapshot.reveal("Notion__look") is not None) == (allowed is None)
    assert "ask_owner" in snapshot.refs and "weather" in snapshot.refs
    assert speaker.uses_plugin("mcp:gmail/read")
    assert speaker.uses_plugin(f"mcp:{server}/look") == (allowed is None)


@pytest.mark.parametrize("routine", [False, True])
@pytest.mark.parametrize("mode", ["ask", "plan", "direct", "bypass"])
async def test_background_profile_update_waits_for_exact_owner_approval(make_rig, tmp_path, routine, mode):
    rig = make_rig()
    rig.service._settings.set("action_mode", mode)
    members = MembersService(rig.conn, tmp_path, background=rig.service, memory=None)
    members.register(rig.rpc)
    target = members.store.create_member(name="Writer", role="Write")
    rig.service.use_team(members, None)
    writes = []

    async def execute(task, name, arguments, *, approval=None, action=None):
        with background_management(task.member_id):
            rig.gate.check_for(action, name, arguments, approval)
            data = await members.admin_tool(task.member_id, name, arguments, approval=approval)
        writes.append(data)
        return ToolResult(name, True, data)

    rig.service.use_owner_tools(execute)
    arguments = {"id": target.id, "personality": "Calm and precise"}
    rig.client.replies = [turn("", [use("member_update", arguments, "profile")])]
    task_id = rig.service.submit(session_id="s", text="Update the Writer member personality", language="en",
                                 model="fake/model", routine_id=1 if routine else None)
    from raphael_core.agent.history import AgentHistory
    origin = AgentHistory(rig.conn, rig.wall).add(session_id="s", question="Change personality", route="routine", prefix="", text="", status="running")
    rig.service.attach_turn(task_id, origin)
    await until(lambda: rig.task(task_id).state == "waiting")
    assert not writes and members.store.member(target.id).personality != arguments["personality"]
    with background_management(0), pytest.raises(RpcError):
        await members.admin_tool(0, "member_update", arguments)
    rig.client.replies = [report("Personality updated after approval.")]
    question = [p for m, p in rig.notifications if m == "background.question"][-1]
    await rig.rpc.call("background.answer", {"task_id": task_id, "question_id": question["question_id"], "approved": True})
    await until(lambda: rig.task(task_id).state == "done")
    assert members.store.member(target.id).personality == arguments["personality"], (writes, rig.client.chat_calls[-1]["messages"])
    assert len(writes) == 1


def test_background_member_management_is_discoverable_but_other_owner_settings_stay_sealed():
    snapshot = take_snapshot(None, background_management=True)
    for name in ("member_create", "member_update", "member_manage", "member_command_save"):
        assert name in {item["function"]["name"] for item in snapshot.find(name)[0]}
        assert snapshot.reveal(name) is not None and name not in snapshot.listed()
    assert "settings_update" not in snapshot.management and snapshot.reveal("settings_update") is None
    sealed = take_snapshot(None, background_management=False)
    assert "member_update" not in {item["function"]["name"] for item in sealed.find("member_update")[0]}
    assert sealed.reveal("member_update") is None


async def test_background_native_cli_read_waits_in_allow_all_and_write_is_refused(rig):
    from raphael_core.background.cli import member_loop
    from raphael_core.agent.policy import Action, Confirmations, Tier
    from raphael_core.worker.loop import Stop
    rig.settings.set("action_mode", "bypass")
    rig.run.can_wait = True
    task = rig.store.get(rig.task_id)
    loop = member_loop(None, None, task, rig.run, {"system": "Persona", "user": "Task", "tools": []},
                       wait_s=1, progress=lambda text: None)
    denied = await loop.execute("write", "cli_permission", {"command": "del C:/data/raphael.db"})
    assert not denied.ok and denied.kind == "protected_data" and rig.run.waiting is None
    args = {"command": "Get-Content C:/data/raphael.db"}
    with pytest.raises(Stop):
        await loop.execute("read", "cli_permission", args)
    waiting = rig.run.waiting
    assert waiting.tier == Tier.T3
    action = Action("cli_permission", args)
    confirmations = Confirmations()
    pending = confirmations.open("s", 1, action, Tier.T3, "en")
    yes = confirmations.resolve(pending.id, True).approval
    result = await rig.run.answer_call(waiting, yes, action)
    assert 'status="ok"' in result and yes.spent
