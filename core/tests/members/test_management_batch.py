"""Several changes that cannot be undone, asked for in one turn, are one card with one yes (owner, 2026-11-11:
「不要分這麼多卡片，讓我去按同意」).

Before, each change was a question of its own and the model could propose the second only once the first was answered,
so the owner met one card at a time and a card nobody saw ran out. Now they are held until the model's turn is in, shown
as one list, and one yes is spent on exactly that list.
"""

import re

import pytest

from agent.test_narration import chat, use
from .test_answering import client, setup, member, typed, live_said  # noqa: F401
from raphael_core.agent.policy import Action, Confirmations, NotApproved, action_digest
from raphael_core.management import publish
from raphael_core.protocol import RpcError


def make_room(rig, name):
    """A group chat as the rooms service keeps it (this rig has no rooms service; its delete is trapped here)."""
    room = rig.conn.execute("INSERT INTO rooms(name, created) VALUES (?, 0)", (name,)).lastrowid

    async def delete(params):
        rig.conn.execute("DELETE FROM rooms WHERE id=?", (params["room_id"],))
        return {"deleted": True}

    rig.rpc._handlers["rooms.delete"] = delete
    return room


async def three_changes(rig, team, client, *, language="zh-TW"):
    """Two members and a group chat for the model to delete in one message; the card it ends the turn on."""
    team.members.register(rig.rpc)
    engineer, architect = member(team, name="工程師"), member(team, name="架構師")
    kept = member(team, name="保留的人")
    room = {"id": make_room(rig, "Raphael macOS 版規劃")}
    client.chats = [
        chat("Deleting.", use("member_delete", {"id": engineer.id}), use("member_delete", {"id": architect.id}),
             use(*publish("room_delete", {"room_id": room["id"]}))),
        live_said("Waiting for your yes."), live_said("All done."),
    ]
    asked = await typed(rig, "刪除兩個角色和一個群聊", 0, language=language)
    return asked, engineer, architect, kept, room


async def test_three_changes_are_one_card_with_a_line_each_and_one_yes_carries_out_all(setup, client):
    rig, team = setup
    asked, engineer, architect, kept, room = await three_changes(rig, team, client)
    assert asked["status"] == "confirm" and asked["confirm"]["tier"] == "T3"
    # One question waits, not three; nothing is done before the yes.
    assert rig.service._confirmations.waiting == 1
    assert team.members.member_exists(engineer.id) and team.members.member_exists(architect.id)
    lines = asked["confirm"]["text"].split("\n")
    assert lines[0] == "有 3 項變更需要你同意" and lines[-1] == "允許以上所有變更嗎？"
    assert lines[1:-1] == ["永久刪除成員及其所有資料：「工程師」", "永久刪除成員及其所有資料：「架構師」", "刪除群聊及全部訊息：「Raphael macOS 版規劃」"]
    text = asked["confirm"]["text"]
    assert "{" not in text and "ID" not in text and not re.search(r"[A-Za-z]{4,} [A-Za-z]{4,}", text.replace("Raphael macOS", ""))

    done = await rig.confirm(asked["confirm"]["id"])
    assert done["status"] == "done" and done["text"] == "All done."
    assert not team.members.member_exists(engineer.id) and not team.members.member_exists(architect.id)
    assert team.members.member_exists(kept.id)
    assert rig.conn.execute("SELECT COUNT(*) FROM rooms WHERE id=?", (room["id"],)).fetchone()[0] == 0
    # The owner reads what came of each, in order.
    said = [message["text"] for message in rig.service._history.messages([asked["turn_id"]])[asked["turn_id"]] if message["kind"] == "event"]
    assert said[-1].split("\n") == ["已完成：永久刪除成員及其所有資料：「工程師」", "已完成：永久刪除成員及其所有資料：「架構師」", "已完成：刪除群聊及全部訊息：「Raphael macOS 版規劃」"]


async def test_one_failing_change_is_said_plainly_and_the_others_still_run(setup, client):
    rig, team = setup
    asked, engineer, architect, kept, room = await three_changes(rig, team, client)
    # The architect goes before the owner answers: its line cannot be carried out, the others can.
    team.members.store.delete_member(architect.id)
    done = await rig.confirm(asked["confirm"]["id"])
    assert done["status"] == "done"
    assert not team.members.member_exists(engineer.id)
    assert rig.conn.execute("SELECT COUNT(*) FROM rooms WHERE id=?", (room["id"],)).fetchone()[0] == 0
    said = [message["text"] for message in rig.service._history.messages([asked["turn_id"]])[asked["turn_id"]] if message["kind"] == "event"][-1].split("\n")
    assert said[0].startswith("已完成：") and said[2].startswith("已完成：")
    assert said[1].startswith("未完成：永久刪除成員及其所有資料：「架構師」")
    # The member is told too: the note it goes on from carries each outcome, the failed one with its reason.
    went_on = repr(client.chat_calls[-1])
    assert "management_changes" in went_on and "not_found" in went_on and "do not try it again" in went_on
    assert went_on.count("'ok': True") + went_on.count('"ok": true') >= 2


async def test_declining_declines_all_of_them(setup, client):
    rig, team = setup
    asked, engineer, architect, kept, room = await three_changes(rig, team, client)
    await rig.confirm(asked["confirm"]["id"], approved=False)
    assert team.members.member_exists(engineer.id) and team.members.member_exists(architect.id)
    assert rig.conn.execute("SELECT COUNT(*) FROM rooms WHERE id=?", (room["id"],)).fetchone()[0] == 1


async def test_a_card_in_the_conversation_has_no_timer_and_a_yes_after_an_hour_still_applies(setup, client):
    rig, team = setup
    asked, engineer, architect, kept, room = await three_changes(rig, team, client)
    assert asked["confirm"]["timeout_ms"] == 0
    rig.clock.now += 3600
    rig.service._expire(rig.service._confirmations.sweep())
    assert rig.service._history.get(asked["turn_id"]).status == "confirm"
    done = await rig.confirm(asked["confirm"]["id"])
    assert done["status"] == "done" and not team.members.member_exists(engineer.id)


async def test_a_card_that_a_newer_message_replaces_is_cancelled_and_its_yes_finds_nothing(setup, client):
    rig, team = setup
    asked, engineer, architect, kept, room = await three_changes(rig, team, client)
    client.chats = [live_said("Hello.")]
    await typed(rig, "never mind", 0)
    assert rig.service._history.get(asked["turn_id"]).status == "cancelled"
    await rig.confirm(asked["confirm"]["id"])
    assert team.members.member_exists(engineer.id)


async def test_one_change_keeps_its_own_card_of_one_line(setup, client):
    rig, team = setup
    team.members.register(rig.rpc)
    only = member(team, name="工程師")
    client.chats = [chat("Deleting.", use("member_delete", {"id": only.id})), live_said("Waiting."), live_said("Done.")]
    asked = await typed(rig, "刪除工程師", 0, language="zh-TW")
    assert asked["confirm"]["text"] == "永久刪除成員及其所有資料：工程師\n允許這項變更嗎？"
    assert (await rig.confirm(asked["confirm"]["id"]))["status"] == "done"
    assert not team.members.member_exists(only.id)


def test_the_same_change_proposed_twice_is_one_line(setup):
    operations = [{"name": "member_delete", "arguments": {"id": 7}}] * 2
    seen = {action_digest(op["name"], op["arguments"]) for op in operations}
    assert len(seen) == 1


async def test_a_yes_covers_exactly_the_list_that_was_shown(setup):
    rig, team = setup
    team.members.register(rig.rpc)
    first, second, added = member(team, name="甲"), member(team, name="乙"), member(team, name="丙")
    operations = [{"name": "member_delete", "arguments": {"id": first.id}}, {"name": "member_delete", "arguments": {"id": second.id}}]
    confirmations = Confirmations()
    action = Action("management_batch", {"operations": operations})
    pending = confirmations.open("s", 1, action, rig.service._gate.tier("management_batch", action.args), "zh-TW")
    approval = confirmations.resolve(pending.id, True, pending.digest).approval
    # A list with one more change is not the list that was shown.
    longer = Action("management_batch", {"operations": [*operations, {"name": "member_delete", "arguments": {"id": added.id}}]})
    with pytest.raises(NotApproved):
        rig.service._gate.check_management_batch(longer, approval)
    rig.service._gate.check_management_batch(action, approval)
    with pytest.raises(NotApproved):
        approval.covering(2)
    # Each part opens its own change and nothing else.
    with pytest.raises(RpcError):
        await team.members.admin_tool(0, "member_delete", {"id": added.id}, interactive=True, approval=approval.covering(0))
    assert team.members.member_exists(added.id)
    part = approval.covering(1)
    rig.service._gate.check_for(part.action, "member_delete", {"id": second.id}, part)
    await team.members.admin_tool(0, "member_delete", {"id": second.id}, interactive=True, approval=part)
    assert not team.members.member_exists(second.id)
    # A part is used once.
    with pytest.raises(RpcError):
        await team.members.admin_tool(0, "member_delete", {"id": second.id}, interactive=True, approval=part)


@pytest.mark.parametrize("language", ["en", "zh-TW", "ja", "zh-CN", "ko", "es", "fr", "de", "pt-BR", "it", "ru", "vi", "th", "id", "tr"])
async def test_every_language_words_the_card_without_json_or_ids_or_another_language(setup, language):
    rig, team = setup
    first, second = member(team, name="Ada"), member(team, name="Bo")
    room = {"id": make_room(rig, "Plan")}
    operations = [{"name": "member_delete", "arguments": {"id": first.id}}, {"name": "member_history_clear", "arguments": {"member_id": second.id}},
                  {"name": "room_manage", "arguments": {"action": "room_delete", "arguments": {"room_id": room["id"]}}}]
    text = team.members.admin_batch_confirmation(operations, language)
    lines = text.split("\n")
    assert len(lines) == 5
    for needle in ("Ada", "Bo", "Plan"):
        assert needle in text
    assert "{" not in text and "}" not in text and "ID" not in text and "Affected" not in text
    single = team.members.admin_confirmation("room_manage", {"action": "room_delete", "arguments": {"room_id": room["id"]}}, language)
    assert "Plan" in single and "{" not in single and "room" not in single.lower().replace("plan", "") or language not in ("en",)
    if language == "zh-TW":
        for line in lines:
            assert re.search(r"[一-鿿]", line), line


def test_every_action_that_can_be_held_has_its_own_words_in_every_language():
    # A card of fourteen lines must say what each does; "apply this management change" says nothing.
    from raphael_core.management import ACTIONS
    from raphael_core.management_words import GENERIC, effect
    from raphael_core.members.service import MembersService
    from raphael_core.ui_languages import LANGUAGES

    for action in ACTIONS:
        if action.name in MembersService.TRADITIONAL or action.destructive:
            continue  # these have their own titles / effects, tested above
        english = effect(action.name, "en")
        assert english != GENERIC[0], action.name
        for language in LANGUAGES:
            words = effect(action.name, language)
            assert words and "{" not in words, (action.name, language)
            assert language == "en" or words != english, (action.name, language)


async def test_a_member_of_another_name_asks_and_raphael_does_not_put_its_name_on_a_card(setup, client):
    rig, team = setup
    rig.settings.set("action_mode", "ask")
    ada, bo, cy = member(team, name="Ada"), member(team, name="Bo"), member(team, name="Cy")
    reads = [use(*publish("member_skills_list", {"member_id": one.id})) for one in (bo, cy)]
    client.chats = [chat("Reading.", *reads), live_said("Waiting."), live_said("Done.")]
    asked = await typed(rig, "Check the others", ada.id, language="en")
    assert asked["confirm"]["text"].split("\n")[0] == "“Ada”: 2 changes need your approval"
    client.chats = [chat("Reading.", *reads), live_said("Waiting."), live_said("Done.")]
    again = await typed(rig, "Check the others", 0, language="en")
    assert again["confirm"]["text"].split("\n")[0] == "2 changes need your approval"
