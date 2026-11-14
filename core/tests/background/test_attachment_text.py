"""Room messages carry readable attachment text through the real background worker."""

import base64

import pytest

from raphael_core.members.rooms import RoomsService
from raphael_core.members.service import MembersService
from .conftest import call, report, turn, until


def test_worker_prompt_names_earlier_files_with_the_shared_budget():
    from raphael_core.agent.history import Turn
    from raphael_core.background.service import _prompts
    from raphael_core.background.run import RunLimits
    turns = [Turn(id=1, created_at_ms=1000, session_id="synthetic", route="answer",
                  question="Read the file", text="Read", prefix="", detail=None, status="done",
                  attachments=[{"id": "stored-sample", "name": "sample.txt", "mime": "text/plain"}])]
    _, user = _prompts("Continue", {}, turns, RunLimits())
    assert "stored-sample" in user and "read_attachment" in user
    assert '<tool_result untrusted="true"' in user


def test_worker_prompt_gives_an_html_file_as_its_source_and_says_where_a_long_one_is_stored():
    from dataclasses import replace
    from raphael_core.background.service import _prompts
    from raphael_core.background.run import RunLimits
    from raphael_core.services.attachments import checked
    page = "<style>.a{color:red}</style><script>go()</script>"
    long = "<style>" + ".a{color:red}\n" * 4000 + "</style>"
    stored = "0123456789abcdef0123456789abcdef.html"
    where = "C:\\data\\attachments\\" + stored
    files = [checked("small.html", "text/html", page.encode()),
             replace(checked("long.html", "text/html", long.encode()), stored_id=stored)]
    _, user = _prompts("Copy the design", {}, [], RunLimits(), attachments=files, paths={stored: where})
    assert page in user and "bytes were cut" in user
    assert where + "." in user


async def test_worker_reads_an_earlier_source_conversation_file_by_index(make_rig, conn, tmp_path):
    from raphael_core.agent.history import AgentHistory
    from raphael_core.services.attachment_store import AttachmentStore
    from raphael_core.services.attachments import checked
    rig = make_rig()
    store = AttachmentStore(tmp_path / "attachments")
    rig.service.use_attachment_store(store)
    history = AgentHistory(conn)
    attachment = store.save(checked("earlier.txt", "text/plain", b"Synthetic earlier file contents"))
    history.add(session_id="first", question="Keep this file", route="answer", prefix="", text="Kept", status="done",
                attachments=[attachment.metadata()])
    foreign = store.save(checked("private.txt", "text/plain", b"Other member private contents"))
    history.add(session_id="other", question="Private", route="answer", prefix="", text="Kept", status="done",
                member_id=1, attachments=[foreign.metadata()])
    origin = history.add(session_id="next", question="Read the earlier file", route="delegate", prefix="", text="Working", status="done")
    rig.client.replies = [turn("", [call("read_attachment", {"index": 1}, "earlier")]), report("Read the earlier file.")]
    task = rig.submit("Read the earlier file")
    rig.service.attach_turn(task, origin)
    await until(lambda: rig.task(task).state not in ("queued", "running"))
    assert rig.task(task).state == "done"
    prompt = rig.client.chat_calls[0]["messages"][1]["content"]
    assert "Synthetic earlier file contents" in prompt and "Other member private contents" not in prompt
    assert rig.steps(task)[-1].outcome == "ok"


@pytest.mark.parametrize("member_id", [0, 1])
async def test_room_html_reaches_the_speaker_without_a_tool_call(make_rig, conn, tmp_path, member_id):
    rig = make_rig()
    members = MembersService(conn, tmp_path, background=rig.service)
    assert members.store.create_member(name="Reader", role="Researcher").id == 1
    rig.service.use_team(members, None)
    rooms = RoomsService(conn, members=members, background=rig.service)
    rooms.register(rig.rpc)
    room = (await rig.rpc.call("rooms.create", {"name": "Reading", "member_ids": [0,1], "default_responder":f"member:{member_id}"}))["room"]
    rig.client.replies = [report("Article received")]
    sent = await rig.rpc.call("rooms.send", {"room_id": room["id"], "request_id": "article",
        "text": "Explain this article", "ui_language": "en", "attachments": [{"name": "article.html",
        "mime": "text/html", "data": base64.b64encode(b"<h1>Room article</h1><p>Readable article body.</p><script>SECRET_SCRIPT</script>").decode()}]})
    await until(lambda: bool(rig.client.chat_calls))
    await until(lambda: not rig.service._executing)
    prompt = rig.client.chat_calls[0]["messages"][1]["content"]
    assert "<h1>Room article</h1><p>Readable article body.</p><script>SECRET_SCRIPT</script>" in prompt
    assert '<tool_result untrusted="true"' in prompt
    messages = (await rig.rpc.call("rooms.messages", {"room_id": room["id"]}))["messages"]
    assert sent["message_id"] == messages[0]["id"]
    assert messages[1]["member_id"] == member_id and messages[1]["text"] == "Article received"
    assert rig.task(1).tool_calls == 0
