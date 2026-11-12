"""Owner demonstrations use a private computer and an explicit publication boundary."""
import json
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from raphael_core.protocol import RpcError
from raphael_core.brain.openrouter import Completion

DOCUMENT = "---\nname: checked-report\ndescription: Produce a checked report\n---\n" + "\n".join(
    f"## {section}\nCheck the requested report." for section in
    ("When to use", "Inputs", "Procedure", "Pitfalls", "Verification"))


async def setup(rig):
    from raphael_core.computer.teaching import Teaching
    member = (await rig.call("members.create", {"name": "Ada"}))["member"]["id"]
    target = SimpleNamespace(key="private", workspace=rig.local / "vm", remote="", container="")
    session = SimpleNamespace(member_id=member, conversation_id=11, target=target, preview=False)
    vm = SimpleNamespace(target=lambda identifier: target, work=SimpleNamespace(pending=lambda target: None))
    viewer = SimpleNamespace(vm=vm, session=lambda params: ("viewer", session), owners={"private": "viewer"},
                             control=AsyncMock(return_value={"control": "owner"}))
    teaching = Teaching(viewer, rig.service, rig.memory)
    teaching.observe = AsyncMock(return_value={"safe": True, "screen": "Report editor", "images": []})
    return teaching, member, session


async def test_teaching_refuses_shared_preview_and_changed_member_computers(rig):
    teaching, member, session = await setup(rig)
    session.target.container = "shared"
    with pytest.raises(RpcError):
        await teaching.call({"action": "start", "session": "viewer"})
    session.target.container = ""
    session.preview = True
    with pytest.raises(RpcError):
        await teaching.call({"action": "start", "session": "viewer"})
    session.preview = False
    teaching.viewer.vm.target = lambda member: SimpleNamespace(key="another-member")
    with pytest.raises(RpcError):
        await teaching.call({"action": "start", "session": "viewer"})
    assert not teaching.items
    teaching.viewer.control.assert_not_called()


async def test_recorded_input_order_password_and_signin_are_redacted_before_disk(rig):
    teaching, member, session = await setup(rig)
    result = await teaching.call({"action": "start", "session": "viewer"})
    await teaching.input("viewer", b"\x05\x01\x00\x0a\x00\x14")
    await teaching.input("viewer", b"\x04\x01\x00\x00\x00\x00\x00A")
    teaching.observe.return_value = {"safe": False, "screen": "password=SECRET", "images": ["SECRET"]}
    await teaching.input("viewer", b"\x04\x01\x00\x00\x00\x00\x00S")
    recording = teaching.items[result["id"]]
    raw = recording.path.read_text(encoding="utf-8")
    assert "SECRET" not in raw
    events = json.loads(raw)["events"]
    assert [event["kind"] for event in events] == ["screen", "click", "text", "private_input"]
    assert events[2]["text"] == "A" and "text" not in events[3]
    assert [event["order"] for event in events] == list(range(1, 5))
    assert rig.service.enabled_skills(member) == []


async def test_recording_size_limit_and_single_press_discard(rig):
    teaching, member, session = await setup(rig)
    teaching.max_bytes = 600
    result = await teaching.call({"action": "start", "session": "viewer"})
    for _ in range(30):
        await teaching.input("viewer", b"\x04\x01\x00\x00\x00\x00\x00A")
    recording = teaching.items[result["id"]]
    assert recording.path.stat().st_size <= 600 and recording.state == "full"
    await teaching.call({"action": "discard", "member_id": member, "id": recording.id})
    assert not recording.path.exists() and recording.id not in teaching.items


async def test_draft_is_toolless_untrusted_data_and_only_owner_save_publishes(rig):
    teaching, member, session = await setup(rig)
    calls = []
    class Brain:
        async def complete_json(self, **kwargs):
            calls.append(kwargs)
            return Completion(data={"text": DOCUMENT}, model=kwargs["model"], cost_usd=0,
                              prompt_tokens=0, completion_tokens=0, latency_ms=0)
    rig.memory._base_client = Brain()
    result = await teaching.call({"action": "start", "session": "viewer"})
    await teaching.input("viewer", b"\x05\x01\x00\x0a\x00\x14")
    draft = await teaching.call({"action": "stop", "session": "viewer"})
    assert draft["text"] == DOCUMENT and not rig.service.enabled_skills(member)
    assert "untrusted data" in calls[0]["system"] and "pixel" in calls[0]["system"]
    assert json.loads(calls[0]["user"])["events"][0]["screen"] == "Report editor"
    saved = await teaching.call({"action": "save", "member_id": member, "id": result["id"], "text": DOCUMENT})
    assert rig.service.skill_read(member, saved["skill"]["name"]) == DOCUMENT
    assert rig.service.enabled_skills(member)[0]["provenance"] == "owner"
    other = (await rig.call("members.create", {"name": "Other"}))["member"]["id"]
    with pytest.raises(RpcError):
        await teaching.call({"action": "read", "member_id": other, "id": result["id"]})


@pytest.mark.parametrize("screen", ["Password entry", "Sign in to continue", "登入", "ログイン"])
async def test_sensitive_screen_observation_keeps_neither_text_nor_images(rig, screen):
    from raphael_core.computer.teaching import safe_observation
    value = safe_observation({"content": [{"type": "text", "text": screen},
                                          {"type": "image", "data": "SECRET", "mimeType": "image/png"}]})
    assert value == {"safe": False, "screen": "", "images": []}


async def test_changed_screens_are_ordered_deduplicated_and_recover_without_resuming(rig):
    from raphael_core.computer.teaching import Teaching
    teaching, member, session = await setup(rig)
    teaching.observe.return_value = {"safe":True,"screen":"Report editor","images":[{"type":"image","data":"PNG-one","mimeType":"image/png"}]}
    result = await teaching.call({"action":"start","session":"viewer"})
    await teaching.tick("viewer")
    assert len(teaching.items[result["id"]].events) == 1
    teaching.observe.return_value = {"safe":True,"screen":"Saved report","images":[{"type":"image","data":"PNG-two","mimeType":"image/png"}]}
    await teaching.tick("viewer")
    recording = teaching.items[result["id"]]
    assert [e["screen"] for e in recording.events] == ["Report editor","Saved report"]
    await teaching.disconnected("viewer")
    restored = Teaching(teaching.viewer,rig.service,rig.memory)
    state = restored.status(member,11,session.target)["teaching"]
    assert state["state"] == "interrupted" and not restored.active("viewer")
    await restored.call({"action":"discard","member_id":member,"id":state["id"]})
    assert not recording.path.exists()


async def test_discard_cancels_a_slow_draft_without_late_publication(rig):
    teaching, member, session = await setup(rig)
    entered = asyncio.Event()
    class Brain:
        async def complete_json(self, **kwargs):
            entered.set()
            await asyncio.Event().wait()
    rig.memory._base_client = Brain()
    result = await teaching.call({"action":"start","session":"viewer"})
    await teaching.input("viewer", b"\x05\x01\x00\x0a\x00\x14")
    stopping = asyncio.create_task(teaching.call({"action":"stop","session":"viewer"}))
    await entered.wait()
    await teaching.call({"action":"discard","member_id":member,"id":result["id"]})
    with pytest.raises(RpcError, match="discarded"):
        await stopping
    assert not rig.service.enabled_skills(member) and not teaching.items


async def test_time_limit_and_unavailable_observation_never_keep_unchecked_text(rig):
    teaching, member, session = await setup(rig)
    result = await teaching.call({"action":"start","session":"viewer"})
    teaching.observe.return_value = {"safe":False,"screen":"","images":[]}
    await teaching.input("viewer",b"\x04\x01\x00\x00\x00\x00\x00X")
    recording = teaching.items[result["id"]]
    assert recording.events[-1]["kind"] == "private_input"
    recording.started -= teaching.max_seconds + 1
    await teaching.tick("viewer")
    assert recording.state == "full" and recording.path.stat().st_size <= teaching.max_bytes


async def test_draft_and_explicit_save_require_all_skill_sections(rig):
    teaching, member, session = await setup(rig)
    result = await teaching.call({"action":"start","session":"viewer"})
    with pytest.raises(RpcError,match="review"):
        await teaching.call({"action":"save","member_id":member,"id":result["id"],"text":DOCUMENT})
    assert not rig.service.enabled_skills(member)
    with pytest.raises(RpcError,match="at least one"):
        await teaching.call({"action":"stop","session":"viewer"})


async def test_disconnect_does_not_wait_on_the_recording_lock_while_closing_control(rig):
    teaching, member, session = await setup(rig)
    result = await teaching.call({"action":"start","session":"viewer"})
    recording = teaching.items[result["id"]]
    async with recording.lock:
        await asyncio.wait_for(teaching.disconnected("viewer"), .2)
    assert recording.state == "interrupted"
    assert json.loads(recording.path.read_text(encoding="utf-8"))["state"] == "interrupted"


@pytest.mark.parametrize("sensitive,clipboard", [(False, False), (True, False), (False, True)])
async def test_relay_observation_checks_privacy_before_queuing_core_persistence(rig, monkeypatch, sensitive, clipboard):
    import threading
    import time
    from raphael_core.computer.teaching import RelayTeaching
    from raphael_core.computer import vm_bridge
    teaching, member, _ = await setup(rig)
    result = await teaching.call({"action": "start", "session": "viewer"})
    main_thread, capture_threads, calls = threading.get_ident(), [], []
    class Observer:
        def __init__(self, vm, target, *, observation_command):
            assert vm is None and target is None and observation_command == ("synthetic-observer",)
            capture_threads.append(threading.get_ident())
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def request(self, method, params, *, owner_observation):
            assert method == "tools/call" and owner_observation
            calls.append(params["name"])
            return {"content": [{"type": "text", "text": "Password SECRET" if sensitive else "Report editor"}]}
    monkeypatch.setattr(vm_bridge, "CuaBridge", Observer)
    hook = RelayTeaching(result["id"], ("synthetic-observer",), time.monotonic() + 30)
    message = b"\x06\0\0\0\0\0\0\x06SECRET" if clipboard else b"\x04\x01\0\0\0\0\0A"
    payload = await asyncio.to_thread(lambda: asyncio.run(hook.capture(message)))
    assert all(identifier != main_thread for identifier in capture_threads)
    assert "SECRET" not in payload
    assert calls == (["get_accessibility_tree"] if sensitive else ["get_accessibility_tree", "get_desktop_state"])
    await teaching.relay_input("viewer", result["id"], payload)
    recording = teaching.items[result["id"]]
    expected = {"kind": "private_input"} if sensitive or clipboard else {"kind": "text", "text": "A"}
    assert {key: value for key, value in recording.events[-1].items() if key != "order"} == expected
    assert "SECRET" not in recording.path.read_text(encoding="utf-8")
    await teaching.disconnected("viewer")
    before = recording.path.read_bytes()
    await teaching.relay_input("viewer", result["id"], payload)
    assert recording.path.read_bytes() == before


@pytest.mark.parametrize("method,params", [("tools/list", {}), ("tools/call", {"name": "vm_exec", "arguments": {}})])
async def test_relay_observer_cannot_issue_actions(method, params):
    from raphael_core.computer.vm_bridge import CuaBridge
    from raphael_core.computer.vm import VmError
    bridge = CuaBridge(None, None, observation_command=("synthetic-observer",))
    with pytest.raises(VmError, match="^observation_only$"):
        await bridge.request(method, params, owner_observation=True)


async def test_stop_flushes_pending_relay_events_before_drafting(rig):
    teaching, _, _ = await setup(rig)
    result = await teaching.call({"action": "start", "session": "viewer"})
    recording = teaching.items[result["id"]]
    steps = []
    def publish(token):
        assert not recording.relay_enabled
        steps.append("disable")
    async def flush(token):
        steps.append("flush")
        await teaching.relay_input(token, recording.id,
            '{"observation":{"safe":false,"screen":"","images":[]},"event":{"kind":"click","buttons":1,"x":10,"y":20}}')
    async def draft(item):
        assert item.state == "stopped" and item.events[-1]["kind"] == "click"
        steps.append("draft")
        return item.view()
    teaching.viewer.publish_session = publish
    teaching.viewer.flush_teaching = flush
    teaching.draft = draft
    await teaching.call({"action": "stop", "session": "viewer"})
    assert steps == ["disable", "flush", "draft"]
