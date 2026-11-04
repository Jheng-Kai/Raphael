import asyncio

from .test_service import make_rig, until  # noqa: F401
from .test_narration import chat, typed


async def test_owner_input_reaches_the_next_step_without_cancelling_the_tool(make_rig, client):
    rig = make_rig()
    started, release = asyncio.Event(), asyncio.Event()

    async def slow(**kwargs):
        started.set()
        await release.wait()
        return chat("Checking", ("local_time", {}))

    client.chats = [slow, chat("Done with the extra condition")]
    first = asyncio.create_task(typed(rig, "Start the work"))
    await started.wait()
    addition = await typed(rig, "Also include the extra condition")
    assert addition["steered"] is True
    turns = await rig.turns()
    assert any(t["question"] == "Also include the extra condition" for t in turns)
    assert next(t for t in turns if t["question"] == "Also include the extra condition")["route"] == "owner_input"
    assert not first.done()
    release.set()
    await first
    assert any(m == {"role": "user", "content": "Also include the extra condition"}
               for m in client.chat_calls[-1]["messages"])


async def test_input_after_the_loop_finishes_starts_a_new_turn(make_rig, client):
    rig = make_rig()
    client.chats = [chat("First answer"), chat("Second answer")]
    await typed(rig, "First request")
    result = await typed(rig, "Arrived at the finish boundary")
    assert not result.get("steered")
    assert result["text"] == "Second answer"


async def test_input_during_the_final_model_reply_is_not_lost(make_rig, client):
    rig = make_rig()
    started, release = asyncio.Event(), asyncio.Event()

    async def finishing(**kwargs):
        started.set()
        await release.wait()
        return chat("The old answer")

    client.chats = [finishing, chat("Answer including the addition")]
    first = asyncio.create_task(typed(rig, "Start"))
    await asyncio.wait_for(started.wait(), 2)
    assert (await typed(rig, "The final condition"))["steered"]
    release.set()
    assert (await first)["text"] == "Answer including the addition"
    assert client.chat_calls[-1]["messages"][-1] == {"role": "user", "content": "The final condition"}


async def test_a_running_tool_finishes_once_before_owner_input_reaches_the_model(make_rig, client, monkeypatch):
    from raphael_core.agent.tools import ToolResult
    rig = make_rig()
    started, release = asyncio.Event(), asyncio.Event()
    completed = []

    async def search(*args):
        started.set()
        await release.wait()
        completed.append("search")
        return ToolResult("web_search", True, {"answer": "Found"})

    monkeypatch.setattr(rig.service._tools, "web_search", search)
    client.chats = [chat("Searching", ("web_search", {"query": "original"})), chat("Done")]
    first = asyncio.create_task(typed(rig, "Search"))
    await asyncio.wait_for(started.wait(), 2)
    assert (await typed(rig, "Include 2026"))["steered"]
    assert not first.done()
    release.set()
    await first
    assert completed == ["search"]
    assert [message["role"] for message in client.chat_calls[-1]["messages"]][-3:] == ["assistant", "tool", "user"]


async def test_input_after_admission_closes_becomes_a_new_turn_even_before_the_old_rpc_returns(make_rig, client, monkeypatch):
    rig = make_rig()
    finalizing, release = asyncio.Event(), asyncio.Event()
    said = rig.service._said

    async def hold(reply, *args):
        if reply.get("text") == "First answer":
            finalizing.set()
            await release.wait()
        return await said(reply, *args)

    monkeypatch.setattr(rig.service, "_said", hold)
    client.chats = [chat("First answer"), chat("Second answer")]
    first = asyncio.create_task(typed(rig, "First request"))
    await asyncio.wait_for(finalizing.wait(), 2)
    second = asyncio.create_task(typed(rig, "Last instant"))
    release.set()
    await first
    assert (await second)["status"] == "queued"
    await until(lambda: any(t.text == "Second answer" for t in rig.service._history.list()))
    assert {turn["question"] for turn in await rig.turns()} == {"First request", "Last instant"}
