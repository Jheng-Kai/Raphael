"""A long task through the real worker and host: the model's window comes from the catalog, the
provider's usage comes back with every reply, and the checkpoint is written over the same channel."""

from raphael_core.failures import Failure
from raphael_core.brain.catalog import LLM, CatalogEntry, ModelPrice
from raphael_core.brain.openrouter import OpenRouterError
from raphael_core.memory.conversation import DEFAULT_CONTEXT_WINDOW
from raphael_core.worker.context import DEFAULT_WINDOW

from .conftest import ARGUMENT, call, report, turn


def test_a_model_of_unknown_window_is_taken_for_the_same_small_one_everywhere():
    assert DEFAULT_WINDOW == DEFAULT_CONTEXT_WINDOW


def with_window(tokens):
    return [CatalogEntry(id="fake/model", kind=LLM, name="model", provider="Maker", price=ModelPrice(input_per_mtok=0.1, output_per_mtok=0.5),
                         variable_price=False, context_length=tokens, created_at_ms=None, capabilities=frozenset({"tool_calling"}))]


def looking(n, prompt_tokens, detail=""):
    answer = turn("Looking.", [call("Notes__look", {"topic": f"{ARGUMENT} {n}{detail}"}, f"c{n}")])
    answer.prompt_tokens = prompt_tokens
    return answer


async def test_a_long_task_is_shrunk_by_the_window_of_its_model_and_a_checkpoint_from_the_core(make_rig, plugins, calls):
    rig = make_rig()
    rig.service._known_models = lambda: with_window(8_000)
    rig.client.search_text = "## Goal\nLook it up.\n## Completed actions\n1. LOOK the topic — found it"
    await rig.plugins.connect(look="T0")
    # Real history must exceed the retained tail even when shared prompt text grows.
    # The fake lookup echoes this detail into its result.
    rig.client.replies = [*(looking(n, 7_000, " detail" * 600) for n in range(6)), report("All looked up.")]
    rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "done"
    assert rig.client.text_calls and rig.client.text_calls[0]["model"] == "fake/model"
    last = rig.client.chat_calls[-1]["messages"]
    assert "<context_summary>" in last[1]["content"] and "LOOK the topic" in last[1]["content"]
    # A checkpoint is no step of the task, and no model call of its limits.
    task = rig.task(done["task_id"])
    assert task.model_calls == 7


async def test_a_task_on_a_model_with_a_large_window_keeps_its_results(make_rig, plugins, calls):
    rig = make_rig()
    rig.service._known_models = lambda: with_window(200_000)
    await rig.plugins.connect(look="T0")
    rig.client.replies = [*(looking(n, 7_000) for n in range(6)), report("All looked up.")]
    rig.submit()
    await rig.wait_for_reports()
    assert rig.client.text_calls == []
    assert sum(m["role"] == "tool" for m in rig.client.chat_calls[-1]["messages"]) == 6


async def test_an_overflow_through_the_worker_is_sent_again_and_never_told_as_a_refusal(make_rig, plugins, calls):
    rig = make_rig()
    await rig.plugins.connect(look="T0")
    too_long = OpenRouterError(400, "bad_request", "This endpoint's maximum context length is 20000 tokens. Please reduce the length.")
    long_looks = [turn("Looking.", [call("Notes__look", {"topic": f"{n} " + "t" * 5000}, f"c{n}")]) for n in range(3)]
    rig.client.replies = [*long_looks, too_long, report("All looked up.")]
    rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "done" and done["text"] == "All looked up."
    before, after = rig.client.chat_calls[-2]["messages"], rig.client.chat_calls[-1]["messages"]
    assert len(str(after)) < len(str(before))


async def test_an_overflow_that_cannot_be_shrunk_ends_the_task_as_a_failure_with_a_plain_error(make_rig):
    rig = make_rig()
    rig.client.replies = [OpenRouterError(400, "bad_request", "prompt is too long") for _ in range(5)]
    rig.submit()
    [done] = await rig.wait_for_reports()
    assert done["state"] == "failed" and done["text"] == Failure("context_overflow", "context_overflow").sentence("Raphael", "en")
    assert rig.task(done["task_id"]).reason == "context_overflow"
