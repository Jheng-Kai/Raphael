import asyncio

from raphael_core.worker.owner_input import OwnerInput

from .test_runner import core, spec, calling, final  # noqa: F401


def test_each_ticket_is_told_once_at_the_moment_its_words_are_read():
    told = []
    inbox = OwnerInput()
    inbox.on_read = told.append
    inbox.add("Keep the prices", ticket=1)
    inbox.add("Said on a phone")
    assert told == []
    assert [message["content"] for message in inbox.drain()] == ["Keep the prices", "Said on a phone"]
    inbox.mark_consumed(1)
    inbox.add("And the totals", ticket=2)
    inbox.mark_consumed(2)
    assert told == [1, 2] and inbox.consumed(1) and inbox.consumed(2)


def test_a_hand_off_keeps_ticketed_words_unread_for_their_inbox_and_gives_back_the_rest():
    told = []
    inbox = OwnerInput()
    inbox.on_read = told.append
    inbox.add("Said on a phone")
    inbox.add("Keep the prices", ticket=5)
    assert inbox.set_aside() == [{"role": "user", "content": "Said on a phone"}]
    assert inbox.closed and not inbox.add("Too late", ticket=6)
    assert inbox.leftover() == [5] and told == [] and not inbox.consumed(5)


async def test_worker_delivers_owner_words_after_the_running_tool_without_cancelling_it(core):
    started, release = asyncio.Event(), asyncio.Event()

    async def tool():
        started.set()
        await release.wait()
        return {"ok": True, "content": "Saved"}

    core.chats = [calling(), final()]
    core.tools = [tool]
    running = asyncio.create_task(core.a.request("task.run", spec()))
    await asyncio.wait_for(started.wait(), 2)
    assert (await core.a.request("task.steer", {"task_id": 7, "text": "Keep the original file too"}))["accepted"]
    release.set()
    assert (await running)["status"] == "done"
    assert core.chat_requests[-1]["messages"][-1] == {"role": "user", "content": "Keep the original file too"}
    assert len(core.tool_requests) == 1
    assert not (await core.a.request("task.steer", {"task_id": 7, "text": "Too late"}))["accepted"]


async def test_worker_checks_the_inbox_when_a_final_reply_returns(core):
    started, release = asyncio.Event(), asyncio.Event()

    async def finishing():
        started.set()
        await release.wait()
        return final("Old result")

    core.chats = [finishing, final("New result")]
    running = asyncio.create_task(core.a.request("task.run", spec()))
    await asyncio.wait_for(started.wait(), 2)
    assert (await core.a.request("task.steer", {"task_id": 7, "text": "One more condition"}))["accepted"]
    release.set()
    assert "New result" in (await running)["final"]
