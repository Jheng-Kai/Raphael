"""Public activity separates owner attention from task dependencies."""
import pytest
from raphael_core.members.activity import Activity, step


def test_task_waits_are_distinct_and_blocked_has_first_priority():
    activity = Activity()
    activity.tasks(4, [{"state": "queued"}])
    assert activity.state(4) == "waiting"
    activity.tasks(4, [{"state": "waiting", "waiting_owner": 0}])
    assert activity.state(4) == "waiting"
    with activity.turn(4), step("computer__click"):
        activity.tasks(4, [{"state": "waiting", "waiting_owner": 1}])
        assert activity.state(4) == "blocked"
    activity.tasks(4, [])
    assert activity.state(4) == "idle"


@pytest.mark.parametrize("language", ["zh-TW", "en", "ja"])
def test_public_labels_use_safe_words_never_tool_arguments_or_raw_names(language):
    notes = []
    activity = Activity(lambda method, data: notes.append(data))
    activity.language = lambda: language
    with activity.turn(5), step("unknown_secret_token_C:/private/file"):
        assert activity.label(5)
        assert all(word not in activity.label(5) for word in ("secret", "C:/", "unknown"))
        assert notes[-1]["label"] == activity.label(5)
    assert activity.label(5) == ""


@pytest.mark.parametrize("language", ["zh-TW", "en", "ja"])
def test_queued_and_colleague_labels_only_use_public_identity(language):
    activity = Activity()
    activity.language = lambda: language
    activity.tasks(5, [{"state": "queued"}])
    queued = activity.label(5)
    activity.tasks(5, [{"state": "waiting", "waiting_for": "Sample colleague"}])
    assert "Sample colleague" in activity.label(5)
    assert activity.label(5) != queued


async def test_seen_failure_returns_to_idle_and_list_carries_public_label(rig):
    activity = rig.service.activity
    with pytest.raises(RuntimeError), activity.turn(0):
        raise RuntimeError("sample")
    assert activity.state(0) == "error"
    await rig.call("members.viewing", {"id": 0})
    assert activity.state(0) == "idle"
    with activity.turn(0), step("web_read"):
        row = (await rig.call("members.list"))["members"][0]
        assert row["activity_label"] == activity.label(0)


async def test_failure_landing_in_the_viewed_thread_is_already_seen(rig):
    await rig.call("members.viewing", {"id": 0})
    with pytest.raises(RuntimeError), rig.service.activity.turn(0):
        raise RuntimeError("sample")
    assert rig.service.activity.state(0) == "idle"
    await rig.call("members.viewing", {"id": None})
    with pytest.raises(RuntimeError), rig.service.activity.turn(0):
        raise RuntimeError("sample")
    assert rig.service.activity.state(0) == "error"
    await rig.call("members.viewing", {"id": 0})
    assert rig.service.activity.state(0) == "idle"


async def test_list_reads_waiting_once_and_task_state_once_per_member(rig):
    for index in range(3):
        rig.service.store.create_member(name=f"Sample {index}", role="", personality="", instructions="")
    calls = []
    rig.service.add_waiting_source(lambda: calls.append("waiting") or set())
    rig.service.activity.task_source = lambda member: calls.append(member) or [{"state": "queued"}]
    members = (await rig.call("members.list"))["members"]
    assert calls.count("waiting") == 1
    for member in members:
        assert calls.count(member["id"]) == 1
        assert member["activity"] == "waiting" and member["activity_label"]


def test_task_running_does_not_overwrite_the_real_thinking_or_tool_state():
    activity = Activity()
    activity.tasks(3, [{"state": "running"}])
    assert activity.state(3) == "working"
    with activity.turn(3):
        assert activity.state(3) == "thinking"
        with step("web_search"):
            assert activity.state(3) == "searching"
