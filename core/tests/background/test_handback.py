"""Who a work hand-off speaks to (owner, 2026-11-09: 「他是在跟我說話 但是這邊是兩個史萊姆在溝通才對」).

The worker speaks to the owner in its own conversation; only its <handback> block, written to the member who
asked, reaches the asker's side, the member-to-member view and a parent task. A member's own background work
(handed to itself, as a room speaker starts tool work) is not a colleague's request.
"""

import json
from types import SimpleNamespace

import pytest

from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.background.handback import fallback, split
from raphael_core.brain.settings import SettingsStore
from raphael_core.worker.loop import Outcome
from .conftest import call, report, turn, until
from .test_handoff import args, setup, team_of

HANDBACK = "Raphael, the source is checked and the report is ready; the whole of it is in my conversation with Jack."


def test_split_takes_the_last_block_out_and_keeps_the_owner_words():
    owner, words = split("Jack, the report is done.\n\n<handback>first</handback>\n\nMore for Jack.\n<handback>  second\n line </handback>")
    assert owner == "Jack, the report is done.\n\n\n\nMore for Jack." and words == "second line"
    # A block the model did not close still ends the reply.
    assert split("Done for you.\n<handback>Raphael, done.") == ("Done for you.", "Raphael, done.")
    assert split("No block here.") == ("No block here.", "")
    # A tag left from a block closed in a later reply is not shown either.
    assert split("the rest.</handback>") == ("the rest.", "")


def test_a_block_spread_over_two_messages_is_one_handback(make_rig):
    rig = make_rig()
    task = SimpleNamespace(id=7)
    kept = rig.service._take_handback(task, ["Jack, the report is ready.", "<handback>Raphael, the source", "is checked.</handback>", "More for Jack."])
    assert kept == ["Jack, the report is ready.", "More for Jack."]
    assert rig.service._handbacks[7] == "Raphael, the source is checked."


def test_a_report_without_a_handback_loses_its_greeting_to_the_owner():
    assert fallback("Jack, the review is complete. The rest is detail.", "Jack") == "the review is complete."
    assert fallback("Jack，比對做完了，結果貼在房間 17。其餘細節。", "Jack") == "比對做完了，結果貼在房間 17。"
    assert fallback("主人：已經完成。", "") == "已經完成。"
    assert fallback("The review is complete.", "Jack") == "The review is complete."


@pytest.mark.parametrize("brain", ["api", "cli"])
async def test_the_handback_reaches_the_asker_and_stays_out_of_the_owner_thread(make_rig, monkeypatch, brain):
    rig = make_rig()
    model = "cli:codex:fake" if brain == "cli" else "fake/model"
    SettingsStore(rig.conn).set("agent_model", model)
    SettingsStore(rig.conn).set("owner_name", "Jack")
    target, source = setup(rig, room=False, model=model)
    await rig.plugins.connect(look="T1")
    full = "Jack, I checked the requested source.\n\nOWNER-RESULT: the findings.\n\n<handback>" + HANDBACK + "</handback>"
    captured = []
    if brain == "api":
        def first(**kwargs):
            captured.append(str(kwargs["messages"]))
            return turn(json.dumps({"messages": ["I received the brief."]}), [call("Notes__look", {"topic": "source"})])
        rig.client.replies.extend([first, report(full)])
    else:
        rig.service.use_cli(object())
        async def work(loop):
            captured.append(loop.system)
            assert (await loop._tool("check", "Notes__look", {"topic": "source"})).ok
            loop._queue.put_nowait(Outcome("done", final=full))
        monkeypatch.setattr(CliLoop, "_work", work)
    receipt = rig.service.handoff(RAPHAEL, args(target), source_turn_id=source.id, language="en")
    assert receipt.ok, receipt.error
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    task = rig.task(task_id)
    assert task.state == "done", task.reason
    assert task.handback == HANDBACK
    history = AgentHistory(rig.conn, rig.wall)
    work = history.get(task.turn_id)
    owner_side = str(history.messages([work.id])[work.id]) + work.text + (work.detail or "")
    assert "OWNER-RESULT" in owner_side and "<handback" not in owner_side and HANDBACK not in owner_side
    audit = history.get(rig.service._store.exchange_turn_id(task_id))
    assert audit.text == HANDBACK
    [view] = rig.service.handoff_views(source_turn_id=source.id)
    assert view["result"] == HANDBACK and view["own_work"] is False
    brief = captured[0]
    assert "handed to you by your colleague Raphael" in brief and "as Jack" in brief and "<handback>" in brief
    assert "your own background work" not in brief


async def test_own_background_work_is_not_a_colleagues_request(make_rig, monkeypatch):
    rig = make_rig()
    model = "cli:codex:fake"
    SettingsStore(rig.conn).set("agent_model", model)
    target, source = setup(rig, room=True, model=model)
    rig.service.use_team(team_of(target), lambda *a, **k: None)
    rig.service.use_cli(object())
    await rig.plugins.connect(look="T1")
    history = AgentHistory(rig.conn, rig.wall)
    # The member's own meeting turn: a room speaker starts tool work by handing it to itself.
    source = history.get(history.add(session_id="meeting", question="", route="room", source="room", scope="room",
                                     room_id=source.room_id, thread_id=source.thread_id, member_id=target.id,
                                     prefix="", text="", status="running"))
    captured = []
    async def work(loop):
        captured.append(loop.system)
        assert (await loop._tool("check", "Notes__look", {"topic": "source"})).ok
        loop._queue.put_nowait(Outcome("done", final="Here is the result for you.\n\n<handback>The comparison is done; the result is in my conversation.</handback>"))
    monkeypatch.setattr(CliLoop, "_work", work)
    receipt = rig.service.handoff(target, args(target), source_turn_id=source.id, language="en")
    assert receipt.ok, receipt.error
    task_id = receipt.data["task_id"]
    await until(lambda: rig.task(task_id).state in ("done", "failed"))
    task = rig.task(task_id)
    assert task.state == "done", task.reason
    assert task.from_member_id == task.member_id == target.id
    brief = captured[0]
    assert "your own background work, queued by you from the group chat" in brief
    assert "handed to you by your colleague" not in brief
    [view] = rig.service.handoff_views(source_turn_id=source.id)
    assert view["own_work"] is True and view["result"] == "The comparison is done; the result is in my conversation."
    # The group chat reads the words written for it, not the report written to the owner.
    await until(lambda: rig.conn.execute("SELECT 1 FROM room_messages WHERE kind='report'").fetchone() is not None)
    [room_report] = rig.conn.execute("SELECT text FROM room_messages WHERE kind='report'").fetchall()
    assert room_report[0] == "The comparison is done; the result is in my conversation."
