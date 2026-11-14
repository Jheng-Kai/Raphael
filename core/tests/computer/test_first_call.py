"""R-COMP-FIRST-01: the first call after a wake waits for the computer to be ready.

Owner, 2026-11-14: a member's first action at its computer failed nine times with `docker_stopped`,
`driver_configuration_failed` or `task_stopped` and 「再試一次」 made it work with nothing changed. A computer on its way up
(the engine not answering, the container not healthy, the driver not configured, a call that was cut short) is waited for
inside the one tool call, a bounded number of times; a real failure is still reported at once and never tried again. Docker
and the driver are fakes.
"""

import asyncio

import pytest

from raphael_core.computer.vm import VmError
from raphael_core.computer.vm_tools import TRANSIENT_CONNECT, TRANSIENT_START, VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_vm import Bridge, EmptyHub, container, per_bot_desktop as desktop  # noqa: F401

# Answers a member must hear as they are: nothing is wrong with waiting, so there is nothing to wait for.
PERMANENT = ["absent", "image_missing", "docker_start_failed", "docker_start_timeout", "incompatible", "local_capacity",
             "outside_workspace", "busy"]


def named(hub, name):
    return next(item for item in hub.offered_for(1) if item.name == name)


async def member_hub(desktop, tmp_path, bridge=Bridge):
    vm, _, runtime = desktop
    target = vm.target(1)
    runtime.raw = container(vm, target, runtime)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=bridge)
    hub.names = lambda member: {1: "Mei"}.get(member)
    hub.start_retry_s = hub.connect_retry_s = 0.0
    await hub.prepare(1)
    vm.invalidate(target)
    return vm, hub, runtime, target


def failing_start(vm, kinds):
    """`vm.start` that refuses with each of `kinds` in turn and then does what it always did."""
    real, seen = vm.start, []

    async def start(target):
        seen.append(len(seen) + 1)
        if len(seen) <= len(kinds):
            raise VmError(kinds[len(seen) - 1])
        return await real(target)
    vm.start = start
    return seen


async def read_screen(hub):
    with vm_scope(("turn", 1, 1), language="en"):
        return await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")


# --- the engine and the container --------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", TRANSIENT_START)
async def test_a_computer_still_on_its_way_up_is_waited_for_inside_the_one_call(desktop, tmp_path, kind):
    vm, hub, _, _ = await member_hub(desktop, tmp_path)
    seen = failing_start(vm, [kind])
    result = await read_screen(hub)
    assert result.ok, (result.kind, result.text)
    assert seen == [1, 2]


async def test_two_starts_in_a_row_that_are_not_ready_are_still_one_call(desktop, tmp_path):
    vm, hub, _, _ = await member_hub(desktop, tmp_path)
    seen = failing_start(vm, ["docker_stopped", "health_timeout"])
    assert (await read_screen(hub)).ok
    assert seen == [1, 2, 3]


async def test_a_computer_that_never_comes_up_is_given_up_on_after_a_bounded_number_of_tries(desktop, tmp_path):
    vm, hub, _, _ = await member_hub(desktop, tmp_path)
    seen = failing_start(vm, ["docker_stopped"] * 20)
    result = await read_screen(hub)
    assert (result.ok, result.kind) == (False, "docker_stopped")
    assert "Docker Desktop is not running" in result.text  # still told plainly
    assert len(seen) == hub.start_attempts


async def test_the_wait_ends_at_its_time_bound_even_with_tries_left(desktop, tmp_path):
    vm, hub, _, _ = await member_hub(desktop, tmp_path)
    hub.start_budget_s = 0.0
    seen = failing_start(vm, ["docker_stopped"] * 20)
    result = await read_screen(hub)
    assert (result.ok, result.kind) == (False, "docker_stopped") and seen == [1]


@pytest.mark.parametrize("kind", PERMANENT)
async def test_a_real_failure_is_reported_at_once_and_never_tried_again(desktop, tmp_path, kind):
    assert kind not in TRANSIENT_START
    vm, hub, _, _ = await member_hub(desktop, tmp_path)
    seen = failing_start(vm, [kind] * 20)
    result = await read_screen(hub)
    assert (result.ok, result.kind) == (False, kind)
    assert seen == [1]


# --- the driver ---------------------------------------------------------------------------------------------------


class FussyDriver(Bridge):
    """A driver that refuses its first set-up calls, as one that is still starting does."""
    refusals = 0
    configured = 0

    async def request(self, method, params=None, **kwargs):
        if method == "tools/call" and params["name"] == "set_config":
            if type(self).refusals > 0:
                type(self).refusals -= 1
                return {"isError": True, "content": [{"type": "text", "text": "not ready"}]}
            type(self).configured += 1
        return await super().request(method, params)


def fussy(refusals):
    return type("Fussy", (FussyDriver,), {"refusals": refusals, "configured": 0, "calls": []})


@pytest.mark.parametrize("refusals", [1, 2])
async def test_a_driver_that_is_not_configured_yet_is_waited_for(desktop, tmp_path, refusals):
    assert "driver_configuration_failed" in TRANSIENT_CONNECT
    driver = fussy(refusals)
    _, hub, _, _ = await member_hub(desktop, tmp_path, driver)
    result = await read_screen(hub)
    assert result.ok, (result.kind, result.text)
    assert driver.configured == 1 and driver.refusals == 0


async def test_a_driver_that_is_never_configured_is_reported_after_a_bounded_number_of_tries(desktop, tmp_path):
    driver = fussy(1000)
    _, hub, _, _ = await member_hub(desktop, tmp_path, driver)
    hub.connect_attempts = 2
    result = await read_screen(hub)
    assert not result.ok and result.kind in ("driver_configuration_failed", "unavailable", "repair_failed", "busy", "error")
    assert driver.refusals > 900  # a handful of tries, not a loop


# --- a call that was cut short -------------------------------------------------------------------------------------


async def test_a_first_call_that_was_cut_short_does_not_stop_the_rest_of_its_turn(desktop, tmp_path):
    # The first call of a turn waited for a sleeping computer and was cancelled by its caller; the call after it, in the
    # same turn, used to be refused as `task_stopped` for the rest of the turn.
    vm, hub, _, _ = await member_hub(desktop, tmp_path)
    first = asyncio.ensure_future(asyncio.sleep(60))
    with vm_scope(("turn", 1, 1), turn_id=7, private=True, task=first, language="en"):
        assert (await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")).ok
    first.cancel()
    await asyncio.gather(first, return_exceptions=True)
    assert [work["state"] for work in vm.work.views(1, 1)] == ["stopped"]
    with vm_scope(("turn", 1, 1), turn_id=7, private=True, language="en"):
        again = await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")
    assert again.ok, again.kind
    assert [work["state"] for work in vm.work.views(1, 1)] == ["running"]


async def test_a_stop_the_owner_said_is_still_a_stop(desktop, tmp_path):
    vm, hub, _, _ = await member_hub(desktop, tmp_path)
    with vm_scope(("turn", 1, 1), turn_id=7, private=True, language="en"):
        assert (await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")).ok
        (work,) = vm.work.items.values()
        work.state = "stopped"  # as `request` leaves it when the owner presses Stop while it waits for him
        stopped = await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")
        work.state = "expired"
        expired = await hub.call(named(hub, "get_desktop_state").key, {}, approver="auto")
    assert (stopped.ok, stopped.kind) == (False, "task_stopped")
    assert (expired.ok, expired.kind) == (False, "task_stopped")
