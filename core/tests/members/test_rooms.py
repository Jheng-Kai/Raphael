"""Room messages, routing settings, migrations and shared worker dispatch."""
from dataclasses import replace
import pytest
from raphael_core.agent.history import AgentHistory
from raphael_core.members.rooms import RoomsService
from raphael_core.agent.speaker import MAX_DEPTH
from raphael_core.protocol import RpcError

@pytest.fixture
async def rooms(rig):
    service = RoomsService(rig.conn, members=rig.service, background=rig.background,
                           notify=lambda method, params: rig.notes.append((method,params)), now_ms=rig.wall)
    service.register(rig.rpc)
    yield service
    await service.aclose()

async def create(rig, ids, **kwargs):
    if ids == [0] and not kwargs.get("is_team"):
        member = (await rig.call("members.create", {"name":"Room peer"}))["member"]
        ids = [0, member["id"]]
    return (await rig.call("rooms.create", {"name":"Team", "member_ids":ids, **kwargs}))["room"]


async def test_members_find_and_post_into_their_existing_room_with_real_chief_membership(rig, rooms):
    from raphael_core.agent.team import team_tools_for
    peer = (await rig.call("members.create", {"name": "Reviewer"}))["member"]["id"]
    outsider = (await rig.call("members.create", {"name": "Other reviewer"}))["member"]["id"]
    room = await create(rig, [0, peer])
    before = rig.conn.execute("SELECT COUNT(*) FROM rooms").fetchone()[0]
    assert rooms.member_rooms(0)["rooms"][0]["member_ids"] == [0, peer]
    assert rooms.member_rooms(peer)["rooms"][0]["id"] == room["id"]
    assert rooms.member_rooms(outsider) == {"rooms": []}
    offered = team_tools_for(rig.service, replace(rig.service.speaker(peer), depth=MAX_DEPTH), always=True)
    assert {"room_list", "room_post"} <= set(offered) and "ask_member" not in offered
    turn = AgentHistory(rig.conn).add(session_id="review", question="Review", route="exchange", prefix="",
        text="Reviewed", status="done", member_id=peer, peer_id=0, source="member", scope="exchange")
    args = {"room_id": room["id"], "text": "Synthetic review completed."}
    posted = rooms.post(peer, args, turn)
    assert rooms.post(peer, args, turn)["duplicate"]
    with pytest.raises(RpcError, match="only a room member"):
        rooms.post(outsider, args, turn)
    message = (await rig.call("rooms.messages", {"room_id": room["id"]}))["messages"][0]
    assert message["id"] == posted["message_id"] and message["member_id"] == peer
    assert message["text"] == args["text"]
    assert message["status"] == "done" and AgentHistory(rig.conn).get(message["turn_id"]).scope == "room"
    assert rig.conn.execute("SELECT COUNT(*) FROM rooms").fetchone()[0] == before


async def test_sidebar_room_summary_read_position_and_actions_persist(rig, rooms):
    room = await create(rig, [0])
    await rig.call("rooms.send", {"room_id": room["id"], "text": "Please review", "request_id": "sidebar"})
    turn_id = rig.background.attached[-1][1]
    AgentHistory(rig.conn).resolve(turn_id, prefix="", text="The review is complete.", status="done")
    rooms.turn_arrived(turn_id)
    await rooms.wait_idle()
    before = (await rig.call("rooms.list", {}))["rooms"][0]
    assert before["preview"] == "The review is complete."
    assert before["unread"] and before["last_at"] is not None
    await rig.call("rooms.update", {"room_id": room["id"], "pinned": True, "hidden": True, "read": True})
    after = (await rig.call("rooms.list", {}))["rooms"][0]
    assert after["pinned"] and after["hidden"] and not after["unread"]
    latest = [message for message in (await rig.call("rooms.messages", {"room_id": room["id"]}))["messages"]
              if message["member_id"] is None or message["status"] == "done" and message["text"] != "(pass)"][-1]
    assert before["last_at"] == latest["created"]
    assert (after["preview"], after["last_at"]) == (latest["text"][:300], latest["created"])
    assert rig.conn.execute("SELECT read_message_id FROM rooms WHERE id=?", (room["id"],)).fetchone()[0] > 0
    # Repeating the acknowledgement must not create a notification/refresh loop.
    count = len(rig.notes)
    await rig.call("rooms.update", {"room_id": room["id"], "read": True})
    assert len(rig.notes) == count


@pytest.mark.parametrize("key", ["read", "hidden", "pinned"])
async def test_sidebar_room_actions_reject_non_boolean_flags(rig, rooms, key):
    room = await create(rig, [0])
    with pytest.raises(RpcError):
        await rig.call("rooms.update", {"room_id": room["id"], key: "true"})


async def test_sidebar_summary_excludes_silent_passes_and_other_rooms(rig, rooms):
    first = await create(rig, [0])
    other = await create(rig, first["member_ids"])
    await rig.call("rooms.send", {"room_id": first["id"], "text": "Private room one", "request_id": "summary-pass"})
    turn_id = rig.background.attached[-1][1]
    AgentHistory(rig.conn).resolve(turn_id, prefix="", text="(pass)", status="done")
    rooms.turn_arrived(turn_id)
    await rooms.wait_idle()
    listed = {item["id"]: item for item in (await rig.call("rooms.list", {}))["rooms"]}
    assert listed[first["id"]]["preview"] == "Private room one"
    assert not listed[first["id"]]["unread"]
    assert listed[other["id"]]["preview"] == ""


async def test_sidebar_read_acknowledges_only_messages_the_owner_saw(rig, rooms):
    room = await create(rig, [0])
    other = await create(rig, room["member_ids"])
    for room_id, text in [(room["id"], "Seen"), (room["id"], "Arrived later"), (other["id"], "Other room")]:
        rig.conn.execute("INSERT INTO room_messages (room_id,text,created) VALUES (?,?,?)", (room_id, text, rig.wall()))
    rig.conn.commit()
    ids = [row[0] for row in rig.conn.execute("SELECT id FROM room_messages ORDER BY id")]
    await rig.call("rooms.update", {"room_id": room["id"], "read": True, "read_through": ids[0]})
    assert rig.conn.execute("SELECT read_message_id FROM rooms WHERE id=?", (room["id"],)).fetchone()[0] == ids[0]
    with pytest.raises(RpcError):
        await rig.call("rooms.update", {"room_id": room["id"], "read": True, "read_through": ids[2]})


async def test_mentions_use_whole_names_text_order_and_ignore_email_addresses(rig, rooms):
    ids = [(await rig.call("members.create", {"name":name}))["member"]["id"]
           for name in ("Ops", "Ops Lead", "Sam")]
    room = await create(rig, [0,*ids])
    assert rooms._targets(room, "@Sam then @Ops Lead then @Ops.") == [ids[2],ids[1],ids[0]]
    assert rooms._targets(room, "jo@Sam.com and @Opsgenie are not mentions") == []
    assert rooms._targets(room, "@Ops Lead: please review") == [ids[1]]
    assert rooms._targets(room, "@所有人，請更新") == [0,*ids]
    assert rooms._targets(room, "@拉斐爾，請收束") == [0]
    assert rooms._targets(room, "@ラファエル、お願いします") == [0]
    await rig.call("rooms.send", {"room_id":room["id"], "request_id":"ordered", "text":"@Sam then @Ops Lead"})
    assert [s["member_id"] for s in rig.background.submitted] == [ids[2], ids[1]]
    AgentHistory(rig.conn).resolve(rig.background.attached[-1][1], prefix="", text="Ready", status="done")
    rooms.turn_arrived(rig.background.attached[-1][1])
    await rooms.wait_idle()
    assert rig.background.submitted[-1]["member_id"] == ids[1]


async def test_mentions_are_read_from_the_words_exactly_as_the_composer_draws_its_chips(rig, rooms):
    # The composer shows an address as a chip by the rule below (app/src/main/mention-text.ts, the same table in
    # mention-text.test.ts): the name whole after an @ that no letter or digit precedes, the longest name at each @,
    # nothing inside code or a quotation. The words are sent unchanged; the core alone decides who is addressed.
    ids = {name: (await rig.call("members.create", {"name":name}))["member"]["id"] for name in ("Ops", "Ops Lead", "小森", "小晴")}
    room = await create(rig, [0, *ids.values()])
    cases = [
        ("@Ops Lead ", ["Ops Lead"]),               # what the menu writes: @Name and a space
        ("請 @小森 看一下", ["小森"]),
        ("@小森，@小晴。", ["小森", "小晴"]),
        ("@小森請看一下", []),                       # a letter right after the name: not an address
        ("請@小森 看", []),                          # a letter right before the @: not an address
        ("@ops lead", ["Ops Lead"]),                # case is not part of a name
        ("@Ops Lead and @Ops", ["Ops Lead", "Ops"]),
        ("`@小森` 「@小晴」 \"@Ops\"", []),           # code and quotations are not addresses
        ("\n> @小森\n@小晴 ", ["小晴"]),
        ("＠Ops Lead and @Ops", ["Ops Lead", "Ops"]),
        ("請 ＠小森 看一下", ["小森"]),
        ("＠小森，＠小晴。", ["小森", "小晴"]),
        ("＠小森請看一下", []),
        ("請＠小森 看", []),
        ("jo＠Ops.com and ＠Opsgenie", []),
        ("`＠小森` 「＠小晴」 \"＠Ops\"", []),
        ("\n> ＠小森\n＠小晴 ", ["小晴"]),
    ]
    for words, named in cases:
        assert rooms._targets(room, words) == [ids[name] for name in named], words
    words = "請 ＠小森 看一下"
    await rig.call("rooms.send", {"room_id": room["id"], "request_id": "full-width", "text": words})
    assert rig.background.submitted[-1]["member_id"] == ids["小森"]
    assert rig.conn.execute("SELECT text FROM room_messages WHERE request_id='full-width'").fetchone()[0] == words


async def test_what_the_owner_typed_in_a_room_joins_what_they_typed_for_the_arrow_keys(rig, rooms):
    room = await create(rig, [0])
    history = AgentHistory(rig.conn, rig.wall)
    history.add(session_id="private", question="typed in a private chat", route="answer", prefix="", text="the answer", status="done", source="app")
    rig.wall.now += 1000
    await rig.call("rooms.send", {"room_id": room["id"], "text": "  typed in the room  ", "request_id": "arrow-keys"})
    rig.wall.now += 1000
    rig.conn.execute("INSERT INTO room_messages (room_id, member_id, text, created) VALUES (?, 0, 'a member says', ?)", (room["id"], rig.wall()))
    rig.conn.commit()
    # Only the owner's own words, newest first, from the room and the private chat alike; a member's are never among them.
    assert history.sent(50) == ["typed in the room", "typed in a private chat"]
    assert history.sent(1) == ["typed in the room"]


async def test_hidden_passes_do_not_truncate_visible_history_pages(rig, rooms):
    room = await create(rig, [0])
    for i in range(101):
        rig.conn.execute("INSERT INTO room_messages (room_id,text,created) VALUES (?,?,?)", (room["id"],str(i),i))
    for i in range(110):
        turn = rooms._history.add(session_id=f"pass:{i}", question="Status", route="room", prefix="", text="(pass)", status="done", scope="room", room_id=room["id"], thread_id=rooms._thread(room))
        rig.conn.execute("INSERT INTO room_messages (room_id,member_id,text,created,turn_id) VALUES (?,0,'',?,?)", (room["id"],i,turn))
    rig.conn.commit()
    page = (await rig.call("rooms.messages", {"room_id":room["id"]}))["messages"]
    assert len(page) == 100 and [m["text"] for m in page] == [str(i) for i in range(1,101)]
    older = (await rig.call("rooms.messages", {"room_id":room["id"], "before":page[0]["id"]}))["messages"]
    assert [m["text"] for m in older] == ["0"]

async def test_group_mentions_members_and_duplicate_requests(rig, rooms):
    member = (await rig.call("members.create", {"name":"Alice"}))["member"]
    room = await create(rig, [0,member["id"]])
    request = {"room_id":room["id"], "request_id":"one", "text":"@Alice check progress"}
    sent = await rig.call("rooms.send", request)
    assert not sent["duplicate"]
    assert [s["member_id"] for s in rig.background.submitted] == [member["id"]]
    assert (await rig.call("rooms.send", request))["duplicate"]
    assert len(rig.background.submitted) == 1
    messages = (await rig.call("rooms.messages", {"room_id":room["id"]}))["messages"]
    assert [m["member_id"] for m in messages] == [None,member["id"]]
    AgentHistory(rig.conn).resolve(messages[1]["turn_id"], prefix="", text="@Raphael done", status="done")
    rooms.turn_arrived(messages[1]["turn_id"])
    await rooms.wait_idle()
    assert len(rig.background.submitted) == 2
    assert (await rig.call("rooms.messages", {"room_id":room["id"]}))["messages"][1]["text"] == "@Raphael done"
    assert ("rooms.changed", {"room_id":room["id"]}) in rig.notes

async def test_everyone_starts_only_one_cost_limited_worker(rig, rooms, monkeypatch):
    ids = [(await rig.call("members.create", {"name":f"Person{i}"}))["member"]["id"] for i in range(5)]
    room = await create(rig,[0,*ids])
    called = []
    submit = rig.background.submit
    def capture(**kwargs):
        called.append(kwargs)
        return submit(**kwargs)
    monkeypatch.setattr(rig.background,"submit",capture)
    await rig.call("rooms.send", {"room_id":room["id"], "request_id":"all", "text":"@所有人 report"})
    assert len(called) == 6
    assert called[0]["member_id"] == 0
    for c in called:
        assert c["asked_by"].depth == 0 and c["asked_by"].may_ask
        assert c["model"] == rig.service._settings.get("agent_model")

async def test_group_mentions_stay_inside_room_and_chief_handles_unmentioned(rig, rooms):
    group = (await rig.call("groups.create", {"name":"Engineering"}))["group"]
    a = (await rig.call("members.create", {"name":"Alice", "group_id":group["id"]}))["member"]
    await rig.call("members.create", {"name":"Outside", "group_id":group["id"]})
    room = await create(rig,[0,a["id"]])
    await rig.call("rooms.send", {"room_id":room["id"], "request_id":"group", "text":"@Engineering status"})
    assert [s["member_id"] for s in rig.background.submitted] == [a["id"]]
    turn_id = rig.background.attached[-1][1]
    AgentHistory(rig.conn).resolve(turn_id, prefix="", text="Ready", status="done")
    rooms.turn_arrived(turn_id)
    await rooms.wait_idle()
    await rig.call("rooms.send", {"room_id":room["id"], "request_id":"chief", "text":"Hello"})
    assert rig.background.submitted[-1]["member_id"] == 0
    await rig.call("rooms.send", {"room_id":room["id"], "request_id":"boundary", "text":"@AliceExtra hi"})
    assert rig.background.submitted[-1]["member_id"] == 0

async def test_team_room_reused_and_new_members_join_live(rig, rooms):
    first = await create(rig,[0],is_team=True)
    a = (await rig.call("members.create", {"name":"Alice"}))["member"]
    second = await create(rig,[0],is_team=True)
    assert first["id"] == second["id"] and a["id"] in second["member_ids"]

async def test_existing_worker_refusal_is_a_visible_error_not_a_lost_message(rig, rooms):
    room = await create(rig,[0]); rig.background.refuse = "worker_busy"
    await rig.call("rooms.send", {"room_id":room["id"], "request_id":"busy", "text":"Hi"})
    messages = (await rig.call("rooms.messages", {"room_id":room["id"]}))["messages"]
    assert messages[0]["text"] == "Hi" and messages[1]["status"] == "error" and messages[1]["text"]

async def test_validates_room_members_payload_and_pagination(rig, rooms):
    for ids in ([],[True],[999]):
        with pytest.raises(RpcError): await create(rig,ids)
    room = await create(rig,[0])
    for payload in ({"text":"", "request_id":"x"},{"text":"hi", "request_id":"bad id"},{"text":"x"*10001,"request_id":"x"}):
        with pytest.raises(RpcError): await rig.call("rooms.send", {"room_id":room["id"],**payload})
    with pytest.raises(RpcError): await rig.call("rooms.messages", {"room_id":room["id"],"before":True})
    assert (await rig.call("rooms.delete", {"room_id":room["id"]}))["deleted"]
    with pytest.raises(RpcError): await rig.call("rooms.messages", {"room_id":room["id"]})


async def test_room_management_validates_and_persists_changes(rig, rooms):
    member = (await rig.call("members.create", {"name":"Alice"}))["member"]
    room = await create(rig, [0, member["id"]])
    updated = (await rig.call("rooms.update", {"room_id":room["id"], "name":"Planning", "member_ids":[0,member["id"]]}))["room"]
    assert updated["name"] == "Planning" and updated["member_ids"] == [0,member["id"]]
    for payload in ({"name":""}, {"member_ids":[]}, {"member_ids":[True]}, {"member_ids":[999]}, {"member_ids":[member["id"]]}):
        with pytest.raises(RpcError):
            await rig.call("rooms.update", {"room_id":room["id"], **payload})
    assert (await rig.call("rooms.list", {}))["rooms"][0]["name"] == "Planning"
    team = await create(rig, [0], is_team=True)
    with pytest.raises(RpcError):
        await rig.call("rooms.update", {"room_id":team["id"], "member_ids":[0]})


async def test_attachment_only_room_message_is_saved_and_retry_does_not_resave(rig, rooms, tmp_path, monkeypatch):
    import base64
    from raphael_core.services.attachment_store import AttachmentStore
    rooms._attachment_store = AttachmentStore(tmp_path / "attachments")
    room = await create(rig, [0])
    submitted = []
    original = rig.background.submit
    def capture(**kwargs):
        submitted.append(kwargs)
        return original(**kwargs)
    monkeypatch.setattr(rig.background, "submit", capture)
    request = {"room_id":room["id"], "request_id":"file", "text":"", "attachments":[{"name":"notes.txt", "mime":"text/plain", "data":base64.b64encode(b"notes").decode()}]}
    await rig.call("rooms.send", request)
    messages = (await rig.call("rooms.messages", {"room_id":room["id"]}))["messages"]
    attachment = messages[0]["attachments"][0]
    assert attachment["name"] == "notes.txt" and attachment["id"] and attachment["size"] == 5
    assert submitted[0]["attachments"][0].data == b"notes"
    assert (await rig.call("rooms.send", request))["duplicate"]
    assert len(submitted) == 1
    with pytest.raises(RpcError):
        await rig.call("rooms.send", {**request, "request_id":"bad", "attachments":[{"data":"bad"}]})


async def test_voice_uses_existing_transcriber_and_rejects_invalid_audio(rig, rooms):
    import base64
    import io
    import wave
    from unittest.mock import AsyncMock
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 10)
    rooms._transcribe_audio = AsyncMock(return_value="Draft transcript")
    assert await rig.call("rooms.transcribe", {"data":base64.b64encode(audio.getvalue()).decode(), "ui_language":"en"}) == {"text":"Draft transcript"}
    rooms._transcribe_audio.assert_awaited_once_with(audio.getvalue(), "en")
    for value in (None, "!", base64.b64encode(b"not audio").decode()):
        with pytest.raises(RpcError):
            await rig.call("rooms.transcribe", {"data":value})


async def test_room_reply_metadata_defaults_and_persisted_recipient_zero(rig, rooms):
    room = await create(rig, [0])
    await rig.call("rooms.send", {"room_id":room["id"], "request_id":"metadata", "text":"Hello"})
    history = (await rig.call("rooms.messages", {"room_id":room["id"]}))["messages"]
    assert all(m["reply_to_member"] is None and m["kind"] == "message" for m in history)
    with rig.conn:
        rig.conn.execute("UPDATE room_messages SET reply_to_member = 0, kind = 'wrapup' WHERE id = ?", (history[1]["id"],))
    message = (await rig.call("rooms.messages", {"room_id":room["id"]}))["messages"][1]
    assert message["reply_to_member"] == 0 and message["kind"] == "wrapup"
    # Metadata must never trigger a new member dispatch.
    assert len(rig.background.submitted) == 1


def test_room_message_metadata_migrates_existing_rows_and_reopens(tmp_path):
    import sqlite3
    from raphael_core.brain.db import _MIGRATIONS, connect
    path = tmp_path / "rooms.db"
    conn = sqlite3.connect(path)
    for version in range(1, 27):
        step = _MIGRATIONS[version]
        step(conn) if callable(step) else conn.executescript(step)
    conn.execute("INSERT INTO rooms (name, created) VALUES ('Existing', 1)")
    conn.execute("INSERT INTO room_messages (room_id, text, created) VALUES (1, 'Preserved', 1)")
    conn.commit()
    conn.close()
    conn = connect(path)
    row = conn.execute("SELECT * FROM room_messages").fetchone()
    assert row["text"] == "Preserved" and row["reply_to_member"] is None and row["kind"] == "message"
    with conn:
        conn.execute("UPDATE room_messages SET reply_to_member = 0, kind = 'wrapup'")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE room_messages SET kind = 'invalid'")
    conn.close()
    conn = connect(path)
    row = conn.execute("SELECT * FROM room_messages").fetchone()
    assert row["reply_to_member"] == 0 and row["kind"] == "wrapup"
    conn.close()
