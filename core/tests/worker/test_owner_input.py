import asyncio

from .test_runner import core, spec, calling, final  # noqa: F401


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
