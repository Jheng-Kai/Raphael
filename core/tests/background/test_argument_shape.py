"""A connector's arguments sent in a wrong wrapper are answered with the shape that fits, and are not sent again and again
(owner's real use, 2026-11-10 to 2026-11-14: a routine on a ChatGPT brain wrapped a Notion query's arguments in a `data` object
five times, then ran 143 steps until the connector's query allowance was spent, with no card changed). Nothing here
reaches a real connector."""
import json

from raphael_core.agent.plugins import argument_shape, shape_advice, shape_problem
from raphael_core.worker.loop import ToolOutcome, result_text

from .test_run import rig  # noqa: F401
from integrations import fake_server

QUERY = {"type": "object", "required": ["data_source_id"], "properties": {
    "data_source_id": {"type": "string"}, "filter": {"type": "object"}, "page_size": {"type": "integer"},
    "sorts": {"type": "array", "items": {"type": "object"}}, "format": {"enum": ["json", "markdown"]}}}


def test_the_shape_says_each_name_its_type_and_whether_it_is_required():
    shape = argument_shape(QUERY)
    assert shape.startswith("data_source_id (string, required); filter (object); page_size (integer)")
    assert "sorts (array of object)" in shape and "format (one of json|markdown)" in shape
    assert argument_shape({"type": "object"}) == "" and argument_shape({"properties": {}}) == ""
    many = {"properties": {f"p{n}": {"type": "string"} for n in range(40)}}
    assert argument_shape(many).endswith("; and 16 more") and len(argument_shape(many)) < 1000


def test_arguments_wrapped_in_another_object_are_said_to_belong_at_the_top_level_and_no_value_is_repeated():
    wrapped = {"data": {"data_source_id": "PRIVATE-VALUE", "filter": {"x": "PRIVATE-VALUE"}}}
    said = shape_problem("notion-query-data-sources", QUERY, wrapped)
    assert "was not called" in said and "needs data_source_id at the top level" in said and "You sent: data." in said
    assert "inside `data`" in said and "belong at the top level" in said
    assert "never inside another object" in said and "data_source_id (string, required)" in said
    assert "PRIVATE-VALUE" not in said
    # Nothing missing, or nothing known of the tool's schema: nothing is said, and the call is made.
    assert shape_problem("t", QUERY, {"data_source_id": "x"}) is None
    assert shape_problem("t", {"type": "object"}, {"anything": 1}) is None
    assert shape_problem("t", {"properties": {"a": {}}}, {}) is None


def test_a_servers_refusal_of_arguments_is_answered_with_what_it_said_and_the_shape_but_another_failure_is_not():
    said = shape_advice("look", QUERY, "Error executing tool look: 1 validation error for lookArguments\ndata_source_id\n  Field required")
    assert said.startswith("look refused these arguments. It said: Error executing tool look: 1 validation error")
    assert "never inside another object" in said and "The top-level arguments of look are: data_source_id (string, required)" in said
    assert shape_advice("look", QUERY, "Rate limit exceeded: 3 requests per second") is None
    assert shape_advice("look", {"type": "object"}, "validation error") is None  # no shape to tell
    long = shape_advice("look", QUERY, "Invalid arguments " + "x" * 2000)
    assert len(long) < 1500 and long.count("x") <= 300


async def test_a_wrapped_call_is_not_sent_and_the_model_is_told_the_shape_whole(rig):  # noqa: F811
    await rig.plugins.connect(look="T0")
    rig.resnap()
    fake_server.CALLS.clear()
    reply = await rig.tool("Notes__look", {"data": {"topic": "PRIVATE-VALUE"}})
    assert (reply["ok"], reply["kind"]) == (False, "bad_arguments") and fake_server.CALLS == []
    assert "needs topic at the top level" in reply["instruction"] and "PRIVATE-VALUE" not in reply["instruction"]
    assert rig.steps()[0].reason == "bad_arguments"
    shown = result_text("Notes__look", ToolOutcome(False, reply["kind"], reply["content"], instruction=reply["instruction"]))
    assert "topic (string, required)" in shown and "never inside another object" in shown
    # The same call, right, is made.
    good = await rig.tool("Notes__look", {"topic": "tea"}, call_id="c2")
    assert good["ok"] and fake_server.CALLS == ["look"]


async def test_a_server_that_refuses_the_arguments_is_told_to_the_model_with_the_shape_and_other_failures_keep_their_kind(rig):  # noqa: F811
    await rig.plugins.connect(look="T0", broken="T0")
    rig.resnap()
    refused = await rig.tool("Notes__look", {"topic": 5})  # the right name, a number for text: the server's own validation
    assert (refused["ok"], refused["kind"]) == (False, "bad_arguments")
    assert "The top-level arguments of look are: topic (string, required)" in refused["instruction"]
    assert "validation error" in refused["instruction"]
    broken = await rig.tool("Notes__broken", call_id="c2")
    assert (broken["ok"], broken["kind"]) == (False, "tool_error") and "instruction" not in broken
    assert json.dumps(rig.steps()[0].__dict__).find("validation error") < 0, "a step keeps the kind, never the words"



async def test_the_same_call_that_failed_twice_with_the_same_error_is_not_made_again_and_the_run_goes_on(rig):  # noqa: F811
    """R-TOOL-02: it is told why, what shape fits and to find another way; nothing ends the run but its own budget."""
    await rig.plugins.connect(look="T0", broken="T0")
    rig.resnap()
    fake_server.CALLS.clear()
    first = await rig.tool("Notes__broken", {}, call_id="c1")
    second = await rig.tool("Notes__broken", {}, call_id="c2")
    assert first["kind"] == second["kind"] == "tool_error" and fake_server.CALLS == ["broken", "broken"]
    third = await rig.tool("Notes__broken", {}, call_id="c3")
    assert (third["ok"], third["kind"]) == (False, "repeat_failed") and fake_server.CALLS == ["broken", "broken"], "not sent"
    assert "already failed 2 times with the same error" in third["instruction"]
    assert "Try a different way: other arguments, another tool, or another source" in third["instruction"]
    assert "It said: " in third["instruction"], "what it said is told"
    shown = result_text("Notes__broken", ToolOutcome(False, third["kind"], third["content"], instruction=third["instruction"]))
    assert "different way" in shown
    # The same tool with other arguments, or another tool, is made; so is a call that goes well, and nothing was ended.
    assert (await rig.tool("Notes__look", {"topic": "tea"}, call_id="c4"))["ok"]
    again = await rig.tool("Notes__broken", {}, call_id="c5")
    assert again["kind"] == "repeat_failed", "a call that went well elsewhere does not make the failed one new"
    # A refused repeat is a call like any other for the budget, and is no refusal that fails the routine.
    assert rig.run.tool_calls == 5 and rig.run.last_refused is None


async def test_a_call_that_fails_in_the_shape_it_takes_is_told_the_shape_again_when_it_is_repeated(rig):  # noqa: F811
    await rig.plugins.connect(look="T0")
    rig.resnap()
    for number in (1, 2):
        wrapped = await rig.tool("Notes__look", {"data": {"topic": "x"}}, call_id=f"c{number}")
        assert wrapped["kind"] == "bad_arguments"
    third = await rig.tool("Notes__look", {"data": {"topic": "x"}}, call_id="c3")
    assert third["kind"] == "repeat_failed" and "topic (string, required)" in third["instruction"]
    assert (await rig.tool("Notes__look", {"topic": "x"}, call_id="c4"))["ok"]


async def test_a_background_task_goes_on_after_a_repeated_failure_and_ends_only_by_its_own_report(make_rig):
    from .conftest import report, turn, until, use

    rig = make_rig()
    await rig.plugins.connect(look="T0", broken="T0")
    rig.client.replies = [*[turn("", [use("Notes__broken", {}, f"c{n}")]) for n in range(4)],
                          turn("", [use("Notes__look", {"topic": "tea"}, "c5")]), report("Found it another way.")]
    task = rig.submit(language="en")
    await until(lambda: rig.task(task).state == "done", timeout=20)
    assert rig.task(task).report_text == "Found it another way."
    assert len(rig.client.chat_calls) == 6
