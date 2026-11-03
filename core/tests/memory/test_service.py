"""Tests for the memory as a service: the RPC methods of the settings page, the tools of the
assistant, and when the reflection pass and the consolidation run."""

import asyncio
import logging

import pytest

from raphael_core.brain.openrouter import OpenRouterError
from raphael_core.brain.secrets import MemoryKeyStore
from raphael_core.brain.settings import SettingsStore
from raphael_core.memory.service import CONSOLIDATE_EVERY_MS, REFLECT_AFTER_TURNS, MemoryService
from raphael_core.protocol import INVALID_PARAMS, RpcError
from raphael_core.router import Router

from .conftest import FakeModel, add_turn

SECRET_WORDS = "主人喜歡烏龍茶"
PLAN = {"actions": [{"target": "memory", "action": "add", "content": SECRET_WORDS, "old_text": "", "confidence": 1.0}]}


@pytest.fixture
def model():
    return FakeModel()


@pytest.fixture
def keys():
    store = MemoryKeyStore()
    store.set("sk-or-v1-test")
    return store


@pytest.fixture
async def memory(conn, tmp_path, model, keys, clock):
    service = MemoryService(
        conn, tmp_path / "memory", model, keys, now_ms=clock.ms, clock=clock.mono, now=clock.now,
        quiet_s=0.05, start_delay_s=0.0,
    )  # fmt: skip
    yield service
    await service.aclose()


@pytest.fixture
def rpc(memory):
    router = Router()
    memory.register(router)
    return router


# --- the RPC methods ------------------------------------------------------------------------------


async def test_the_four_methods_are_registered(rpc):
    for method in ("memory.get", "memory.update", "memory.clear", "memory.summary_clear"):
        assert method in rpc.methods(), method


async def test_the_owner_can_confirm_a_claim_in_the_existing_document_editor(memory):
    claim = "The owner prefers amber notebooks."
    assert memory.update_memory(0, {"operations": [{"action": "add", "content": claim}]}, untrusted=True).ok
    view = await memory._get({})
    assert view["text"].startswith("（待確認）")
    saved = await memory._update({"text": claim, "revision": view["revision"]})
    assert saved["text"].strip() == claim


async def test_clear_empties_the_file_and_summary_clear_the_summary(rpc, memory):
    assert memory.update_memory(0, {"target": "memory", "operations": [{"action": "add", "content": "一件事"}]}).ok
    memory.conversation._save("Context:\n...", 3)
    assert (await rpc.call("memory.get", {}))["summary"]["text"] == "Context:\n..."
    assert await rpc.call("memory.clear", {}) == {"cleared": True}
    assert await rpc.call("memory.clear", {}) == {"cleared": False}
    assert await rpc.call("memory.summary_clear", {}) == {"cleared": True}
    view = await rpc.call("memory.get", {})
    assert (view["text"], view["summary"], view["entries"]) == ("", None, 0)


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"text": 5},
        {"text": "x", "revision": 5},
        {"text": "長" * 64_001},
        {"text": "Wi-Fi 密碼是 hunter22"},
        {"text": "x", "space": "everyone"},
        {"text": "x", "member_id": -1},
        {"text": "x", "member_id": "1"},
    ],
)
async def test_an_edit_checks_its_params(rpc, memory, params):
    assert memory.update_memory(0, {"target": "memory", "operations": [{"action": "add", "content": "烏龍茶。"}]}).ok
    with pytest.raises(RpcError) as error:
        await rpc.call("memory.update", params)
    assert error.value.code == INVALID_PARAMS
    assert "hunter22" not in str(error.value)
    assert memory.own(0).read().strip() == "烏龍茶。"  # a refused edit changes nothing


# --- the tools of the assistant ------------------------------------------------------------------


def test_search_gives_the_turns_with_their_dates_cut_short(memory, history):
    old = add_turn(history, "上次的會議在哪裡", "在三樓的會議室。")
    add_turn(history, "晚餐吃什麼", "拉麵。")
    long = add_turn(history, "長的會議", "會議" + "很長" * 200)
    result = memory.search("會議")
    assert result.ok and result.name == "history_search"
    found = {t["turn"]: t for t in result.data["turns"]}
    assert set(found) == {old, long}
    assert found[old]["when"].startswith("2026-10-22") and found[old]["answer"] == "Raphael: 在三樓的會議室。"
    assert len(found[long]["answer"]) <= 152 + len("Raphael: ")
    assert memory.search("會議", exclude=[old]).data["turns"][0]["turn"] == long


def test_history_search_labels_every_line_and_keeps_exchange_quote_sources(memory, history):
    ordinary = add_turn(history, "日文課\n先生、今日は何を勉強しますか？", "今天用中文練習。\n先介紹自己。")
    exchange = add_turn(
        history, "Raphael: 日文課教了什麼？",
        "owner: 先生、今日は何を勉強しますか？\n紫苑: 那是你問我的句子。",
        route="exchange",
    )
    found = {t["turn"]: t for t in memory.search("日文課").data["turns"]}
    assert found[ordinary]["question"] == "owner: 日文課\nowner: 先生、今日は何を勉強しますか？"
    assert found[ordinary]["answer"] == "Raphael: 今天用中文練習。\nRaphael: 先介紹自己。"
    assert exchange not in found
    assert history.get(exchange).scope == "exchange"


def test_exchange_search_keeps_the_quoted_speaker_when_a_snippet_starts_mid_line(memory, history):
    add_turn(history, "Raphael: 回顧課程", "owner: " + "長" * 200 + "先生、今日は何を勉強しますか？", route="exchange")
    assert memory.search("先生").data["turns"] == []


def test_a_search_that_finds_a_run_on_the_desktop_is_untrusted(memory, history):
    # Raphael's line of a run tells what the screen showed: the reply that reads it writes no note.
    add_turn(history, "會議在哪裡", "在三樓。")
    assert not memory.search("會議").untrusted
    add_turn(history, "打開會議通知", "畫面寫著會議改到五樓。", route="operate")
    found = memory.search("會議")
    assert found.ok and len(found.data["turns"]) == 2 and found.untrusted


def test_search_finds_an_older_turn_behind_the_recent_ones_it_leaves_out(memory, history):
    # The turns already in the context are left out; twelve of them match best (the newest come
    # first), more than the most a search gives, and the older match must still be found.
    old = add_turn(history, "上次的會議在哪裡", "在三樓。")
    recent = [add_turn(history, f"會議 {n}", "好。") for n in range(12)]
    found = memory.search("會議", exclude=recent).data["turns"]
    assert [t["turn"] for t in found] == [old]


# --- when the background runs --------------------------------------------------------------------


@pytest.mark.parametrize("model_id", ["openai/gpt-6-luna", "@local:text"])
@pytest.mark.parametrize("work", ["fold", "reflect", "consolidate"])
async def test_memory_work_keeps_the_selected_brain(memory, history, model, conn, model_id, work):
    settings = SettingsStore(conn)
    settings.set("agent_model", model_id)
    settings.set("assistant_model", "anthropic/claude-haiku-5.5")
    if work == "fold":
        memory.conversation.context_window = 300
        from raphael_core.memory.conversation import FOLD_AT_TURNS
        for number in range(FOLD_AT_TURNS + 1):
            add_turn(history, f"Question {number}")
        model.replies.extend([{"summary": "Context:\n- Earlier questions"}, {"actions": []}])
        memory.after_turn()
        await memory.wait_idle()
        assert memory.conversation.summary().text
    elif work == "reflect":
        add_turn(history, "A preference")
        model.replies.append({"actions": []})
        await memory.reflect()
    else:
        memory.own(0).edit_document("\n\n".join(f"Fact number {n} about the owner and their projects" for n in range(45)), None)
        model.replies.append({"actions": []})
        await memory.consolidate()
    assert model.calls
    assert all(call["model"] == model_id for call in model.calls)


async def test_the_pass_runs_after_ten_turns_and_moves_its_watermark(memory, history, model, conn):
    model.replies.append(PLAN)
    ids = [add_turn(history, f"q{n}") for n in range(REFLECT_AFTER_TURNS)]
    memory.after_turn()
    await memory.wait_idle()
    assert SECRET_WORDS in memory.own(0).read()
    assert memory.reflected_through() == ids[-1]
    assert [tuple(r) for r in conn.execute("SELECT purpose FROM spend")] == [("memory",)]
    assert memory.reflection_due() is False


async def test_the_pass_runs_once_the_conversation_is_quiet(memory, history, model, clock):
    add_turn(history, "我喜歡烏龍茶")
    model.replies.append(PLAN)
    memory.after_turn()  # arms the quiet timer
    assert memory.reflection_due() is False
    clock.advance(seconds=1)
    assert memory.reflection_due() is True
    for _ in range(200):
        await asyncio.sleep(0.01)
        if SECRET_WORDS in memory.own(0).read():
            break
    await memory.wait_idle()
    assert SECRET_WORDS in memory.own(0).read()


async def test_a_pass_that_failed_leaves_the_turns_for_later(memory, history, model, clock):
    add_turn(history, "q")
    clock.advance(seconds=1)
    model.replies.append({"bad": 1})
    model.replies.append({"bad": 2})
    await memory.run_due()
    assert memory.reflected_through() == 0
    memory._spawn()
    assert memory._running is None  # waits before it tries again


def armed_in(memory):
    """In how many seconds the background's timer fires, or None when none is armed."""
    if memory._timer is None:
        return None
    return memory._timer.when() - asyncio.get_running_loop().time()


async def test_a_turn_waiting_at_startup_is_read_once_it_is_quiet_with_no_new_turn(memory, history, model, clock):
    # One turn waits, and it is not quiet yet when the startup's look comes: the look arms the
    # timer for when it will be, and the pass runs then, though the owner says nothing more.
    add_turn(history, "我喜歡烏龍茶")
    memory.start()
    assert armed_in(memory) is not None
    memory._tick()  # the startup's look: nothing is due yet
    assert memory._running is None
    assert armed_in(memory) == pytest.approx(0.05 + 1.0, abs=0.2)
    clock.advance(seconds=1)
    model.replies.append(PLAN)
    memory._tick()  # the quiet time has come
    await memory.wait_idle()
    assert SECRET_WORDS in memory.own(0).read() and memory.reflection_due() is False


async def test_a_pass_that_failed_is_tried_again_after_its_pause(memory, history, model, clock):
    from raphael_core.memory.service import RETRY_S

    add_turn(history, "我喜歡烏龍茶")
    clock.advance(seconds=1)
    model.replies.append(OpenRouterError(503, "server", "down"))
    await memory.run_due()
    assert memory.reflected_through() == 0
    assert armed_in(memory) == pytest.approx(RETRY_S + 1.0, abs=1.0)
    memory._spawn()  # a turn asks for a pass meanwhile: it waits out the pause, armed for its end
    assert memory._running is None
    assert armed_in(memory) == pytest.approx(RETRY_S + 1.0, abs=1.0)
    clock.advance(seconds=RETRY_S)
    model.replies.append(PLAN)
    memory._tick()
    await memory.wait_idle()
    assert SECRET_WORDS in memory.own(0).read()


async def test_repeated_memory_failures_back_off_and_success_resets_the_pause(memory, history, model, clock, caplog):
    from raphael_core.memory.brain import MemoryBrainError
    from raphael_core.memory.service import RETRY_S

    add_turn(history, "I prefer amber notebooks.")
    clock.advance(seconds=1)
    with caplog.at_level(logging.INFO):
        for count in range(1, 4):
            model.replies.append(MemoryBrainError(0, "usage_limit", "synthetic private prompt excerpt"))
            await memory.run_due()
            assert len(model.calls) == count
            delay = RETRY_S * 2 ** (count - 1)
            assert memory._next_due_s() == delay
            await memory.run_due()
            memory.after_turn()
            assert len(model.calls) == count and memory.reflected_through() == 0
            clock.advance(seconds=delay)
        model.replies.append({"actions": []})
        await memory.run_due()
    assert memory.reflected_through() > 0
    assert memory._failed_at is None and memory._failure_count == 0
    assert "kind=usage_limit reason=Subscription usage limit reached" in caplog.text
    assert "synthetic private" not in caplog.text


async def test_failed_reflection_does_not_launch_consolidation_in_the_same_pass(memory, history, model, clock):
    add_turn(history, "A synthetic question")
    memory.own(0).edit_document("\n\n".join(f"Durable environment fact {n} uses a separate amber pipeline" for n in range(40)), None)
    clock.advance(seconds=1)
    model.replies.append(OpenRouterError(503, "server", "private provider text"))
    await memory.run_due()
    assert len(model.calls) == 1 and memory.consolidation_due()


async def test_without_a_key_the_background_looks_again_later_not_at_once(memory, history, model, keys, clock):
    from raphael_core.memory.service import RETRY_S

    add_turn(history, "q")
    clock.advance(seconds=1)
    keys.clear()
    await memory.run_due()
    assert model.calls == [] and armed_in(memory) >= RETRY_S


async def test_a_key_is_required_but_budget_does_not_block_memory(memory, history, model, keys, conn, clock):
    for n in range(REFLECT_AFTER_TURNS):
        add_turn(history, f"q{n}")
    keys.clear()
    await memory.run_due()
    assert model.calls == []
    keys.set("sk-or-v1-test")
    SettingsStore(conn).set("monthly_limit_usd", 0.0)
    assert memory.may_spend() is True


async def test_the_consolidation_of_a_full_file_runs_daily(memory, model, clock):
    memory.own(0).edit_document("\n\n".join(f"Fact number {n} about the owner and their projects" for n in range(45)), None)
    assert memory.consolidation_due() is True
    model.replies.append({"actions": []})
    await memory.run_due()
    assert memory.consolidation_due() is False
    clock.advance(milliseconds=CONSOLIDATE_EVERY_MS)
    assert memory.consolidation_due() is True


async def test_clearing_the_conversation_starts_the_pass_again_from_the_first_turn(memory, history, model):
    model.replies.append({"actions": []})
    for n in range(REFLECT_AFTER_TURNS):
        add_turn(history, f"q{n}")
    await memory.reflect()
    assert memory.reflected_through() > 0
    history.clear()
    memory.forget_turns()
    assert memory.reflected_through() == 0


async def test_a_pass_that_waited_while_the_conversation_was_cleared_moves_nothing(memory, history, model):
    for n in range(REFLECT_AFTER_TURNS):
        add_turn(history, f"q{n}")

    def clear_while_waiting(**_):
        history.clear()
        memory.forget_turns()
        add_turn(history, "新的對話")  # turn 1 again
        return PLAN

    model.replies.append(clear_while_waiting)
    await memory.reflect()
    # The new conversation is still to be read, and nothing came of the one that was cleared.
    assert memory.reflected_through() == 0 and memory.own(0).read() == ""


async def test_a_pass_that_waited_while_the_memory_was_cleared_writes_nothing(rpc, memory, history, model):
    assert memory.update_memory(0, {"target": "memory", "operations": [{"action": "add", "content": "主人住在台北"}]}).ok
    for n in range(REFLECT_AFTER_TURNS):
        add_turn(history, f"q{n}")

    async def clear_while_waiting(**_):
        await rpc.call("memory.clear", {})
        return PLAN

    model.replies.append(clear_while_waiting)
    applied = await memory.reflect()
    assert applied.changed == 0 and memory.own(0).read() == ""
    assert memory.reflected_through() > 0  # the turns were read; the clear was of the file, not of them


async def test_the_memory_logs_no_memory_and_no_turn(memory, history, model, caplog):
    for n in range(REFLECT_AFTER_TURNS):
        add_turn(history, f"秘密的問題 {n}")
    model.replies.append(PLAN)
    with caplog.at_level(logging.DEBUG):
        await memory.reflect()
        memory.snapshot(0)
        memory.search("秘密")
    assert SECRET_WORDS in memory.own(0).read()
    assert "秘密" not in caplog.text and SECRET_WORDS not in caplog.text and "烏龍" not in caplog.text
