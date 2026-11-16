"""A connected tool whose service will answer the same way for a while is not called again until then.

A morning routine's member called a connected app's tool that the owner's plan does not include, every morning (the
service's error: `code: entitlement_required`, `retryability: never`), and its own twenty to thirty queries then used up
the service's hourly allowance for the query tool that works (`code: usage_limit_reached`, `retryability: later`, with
when to try again). Both answers came from the service; nothing on our side remembered them. Nothing here names a
service: the words are the ones plan-gated and rate-limited services use."""

import json

from raphael_core.agent.plugins import tool_key
from raphael_core.failures import allowance_wait, plan_refusal
from raphael_core.integrations.client import CallOutcome
from raphael_core.integrations.service import IntegrationsService
from raphael_core.router import Router

from .test_service import add

PLAN = json.dumps({"error": {"code": "entitlement_required", "message": "This feature is not included in your current plan.",
                             "retryability": "never", "classification": "entitlement"}})
ALLOWANCE = json.dumps({"error": {"code": "usage_limit_reached", "message": "You have reached the hourly limit for this "
                                  "kind of query. Try again in 20 minutes.", "retryability": "later",
                                  "classification": "entitlement"}})
ALLOWANCE_NO_TIME = json.dumps({"error": {"code": "usage_limit_reached", "message": "Usage limit reached."}})
INVALID = json.dumps({"error": {"code": "internal_error", "message": "The server could not finish this request."}})


class Clock:
    def __init__(self):
        self.now = 1_800_000_000_000

    def __call__(self):
        return self.now


async def rig(conn, tmp_path, vault, connector, servers, answers):
    clock = Clock()
    service = IntegrationsService(conn, tmp_path, vault, connector=connector, call_timeout_s=3.0, now_ms=clock)
    router = Router()
    service.register(router)
    server_id = await add(router, servers)
    sent = []

    async def call_tool(server, name, arguments, **_):
        sent.append(name)
        return CallOutcome(answers.get(name, "found"), name in answers)
    service._connector.call_tool = call_tool
    return service, router, server_id, sent, clock


def test_the_words_of_a_plan_and_of_an_allowance_are_told_apart():
    assert plan_refusal(PLAN) and not plan_refusal(ALLOWANCE) and not plan_refusal(INVALID)
    assert allowance_wait(ALLOWANCE) == (True, 1200.0)
    assert allowance_wait(ALLOWANCE_NO_TIME) == (True, None)
    assert allowance_wait(PLAN) == (False, None) and allowance_wait(INVALID) == (False, None)
    assert allowance_wait("Rate limit exceeded, retry after 45 seconds")[1] == 45.0
    assert allowance_wait("You are out of credits: top up your balance") == (False, None)


async def test_a_tool_not_in_the_plan_is_not_sent_again_for_a_day_or_until_the_app_is_refreshed(conn, tmp_path, vault, connector, servers):
    service, router, server_id, sent, clock = await rig(conn, tmp_path, vault, connector, servers, {"look": PLAN})
    key = tool_key(server_id, "look")
    first = await service.call(key, {"topic": "a"}, approver="auto")
    assert (first.ok, first.kind) == (False, "plan_excluded") and sent == ["look"]
    assert "plan does not include look" in first.text and "Tools of this app not refused so:" in first.text
    assert "note" in first.text and "The service said:" in first.text
    again = await service.call(key, {"topic": "other arguments"}, approver="auto")
    assert (again.kind, sent) == ("plan_excluded", ["look"]) and again.text.startswith("Not sent")
    assert (await service.call(tool_key(server_id, "note"), {"text": "x"}, approver="auto")).ok, "its other tools are called"
    await router.call("integrations.refresh", {"id": server_id})
    assert (await service.call(key, {"topic": "a"}, approver="auto")).kind == "plan_excluded" and sent.count("look") == 2
    clock.now += 24 * 3600 * 1000
    await service.call(key, {"topic": "a"}, approver="auto")
    assert sent.count("look") == 3, "a day later it is asked again"


async def test_a_spent_allowance_holds_a_tool_only_until_the_time_the_service_said(conn, tmp_path, vault, connector, servers):
    service, _, server_id, sent, clock = await rig(conn, tmp_path, vault, connector, servers, {"look": ALLOWANCE})
    key = tool_key(server_id, "look")
    first = await service.call(key, {"topic": "a"}, approver="auto")
    assert first.kind == "allowance_spent" and "try again in about 20 min" in first.text
    clock.now += 19 * 60 * 1000
    assert (await service.call(key, {"topic": "a"}, approver="auto")).kind == "allowance_spent" and sent == ["look"]
    clock.now += 2 * 60 * 1000
    await service.call(key, {"topic": "a"}, approver="auto")
    assert sent == ["look", "look"]


async def test_a_failure_that_may_pass_on_the_next_try_holds_nothing(conn, tmp_path, vault, connector, servers):
    answers = {"look": ALLOWANCE_NO_TIME, "note": INVALID}
    service, _, server_id, sent, _ = await rig(conn, tmp_path, vault, connector, servers, answers)
    spent = await service.call(tool_key(server_id, "look"), {"topic": "a"}, approver="auto")
    assert spent.kind == "allowance_spent" and "did not say when" in spent.text
    await service.call(tool_key(server_id, "look"), {"topic": "a"}, approver="auto")
    invalid = await service.call(tool_key(server_id, "note"), {"text": "x"}, approver="auto")
    assert invalid.kind == "tool_error"
    await service.call(tool_key(server_id, "note"), {"text": "x"}, approver="auto")
    assert sent == ["look", "look", "note", "note"]


def test_the_words_of_a_held_tool_reach_the_model_whole():
    from raphael_core.agent.plugins import PlannedCall, PluginResult, PluginTool
    from raphael_core.agent.policy import Tier
    from raphael_core.agent.service import _tool_result
    words = "Not sent: earlier the service answered that this account's plan does not include look. " + "x" * 400
    call = PlannedCall(PluginTool("plugin:s/look", "Notes", "look", "", {"type": "object"}, Tier.T1), {})
    for kind in ("plan_excluded", "allowance_spent"):
        result = _tool_result(call, PluginResult(False, kind, words))
        assert (result.error, result.instruction) == (kind, words), "never cut to a service's 240 characters"
