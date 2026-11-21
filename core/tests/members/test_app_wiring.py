"""Tests for the members in the whole core: the methods are on the app, a member made by RPC answers
a message typed in its thread with the fake LLM, and the pictures go to the local folder beside the
memory."""

from test_app import make_app  # noqa: F401  (the fixture)

MEMBER_METHODS = {
    "members.avatar_generate", "members.library", "members.library_file",
    "members.list", "members.create", "members.update", "members.delete", "members.set_avatar", "members.set_cover",
    "members.read", "members.viewing", "members.tool_choices", "groups.create",
    "groups.update", "groups.delete", "routines.list", "routines.create", "routines.update",
    "routines.delete", "routines.template", "memory.update",
}  # fmt: skip


async def test_the_members_methods_are_on_the_app(make_app):  # noqa: F811
    assert MEMBER_METHODS <= set(make_app().methods())


async def test_a_member_made_by_rpc_answers_in_its_thread(make_app):  # noqa: F811
    app = make_app()
    heard = []
    app.set_notifier(lambda method, params: heard.append((method, params)))
    member = (await app.call("members.create", {"name": "小行程", "role": "管行程"}))["member"]
    reply = await app.call(
        "agent.ask",
        {"session_id": "s1", "text": "你好", "ui_language": "zh-TW", "source": "app", "member_id": member["id"]},
    )
    assert reply["status"] == "done" and reply["prefix"] == ""
    turns = (await app.call("agent.history.list", {"member_id": member["id"]}))["turns"]
    assert [t["member_id"] for t in turns] == [member["id"]]
    assert (await app.call("agent.history.list", {}))["turns"] == []
    assert ("agent.turn", {"turn_id": turns[0]["id"], "member_id": member["id"], "failure": None}) in heard
    # Nobody viewed the thread: it is news.
    listed = {m["id"]: m for m in (await app.call("members.list", {}))["members"]}
    assert listed[member["id"]]["unread"] is True
    assert await app.call("members.delete", {"id": member["id"]}) == {"deleted": True}


async def test_the_background_names_the_members_and_tells_which_threads_wait(make_app, monkeypatch):  # noqa: F811
    app = make_app()
    member = (await app.call("members.create", {"name": "進度官", "role": "看進度"}))["member"]
    # The overlay's notice of a question names the member whose thread holds it.
    assert app.background._notice("zh-TW", member["id"]) == "進度官 等你處理。"
    assert app.background._notice("zh-TW", 0) == "有一件事等你處理。"
    assert app.members.name_of(member["id"] + 1) is None
    # A question the background waits on makes that thread `waiting` in the member column.
    member_id = member["id"]
    await app.call("agent.ask", {
        "session_id": "s1", "text": "Check progress", "ui_language": "en", "source": "app", "member_id": member_id,
    })
    (turn,) = (await app.call("agent.history.list", {"member_id": member_id}))["turns"]
    tasks = app.background._store
    task_id = tasks.create(session_id="s1", language="en", text="Check progress", member_id=member_id)
    tasks.attach_turn(task_id, turn["id"])
    monkeypatch.setattr(app.background, "waiting_questions", lambda: [
        {"id": "progress-question", "task_id": task_id, "member_id": member_id},
    ])
    listed = {m["id"]: m for m in (await app.call("members.list", {}))["members"]}
    assert {id_: m["waiting"] for id_, m in listed.items()} == {0: False, member_id: True}
    main = listed[member_id]["main_conversation_id"]
    assert main is not None
    assert listed[member_id]["waiting_cards"] == [{"id": "progress-question", "conversation_id": main}]
