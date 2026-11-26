"""Raphael (member 0) is the app's guide, never a slime: not the chief of staff, not in the roster, and fixed in
its name and look. The chief is a real member, the first one made, or nobody while there is none."""

import pytest

from raphael_core.agent.speaker import RAPHAEL_NAMES
from raphael_core.members.store import MemberError, MemberStore
from raphael_core.protocol import INVALID_PARAMS, RpcError


@pytest.fixture
def store(conn):
    return MemberStore(conn, now_ms=lambda: 5_000)


def flagged(conn):
    return [row[0] for row in conn.execute("SELECT id FROM members WHERE primary_contact = 1 ORDER BY id")]


# --- the store -----------------------------------------------------------------------------------------------------


def test_with_no_slime_there_is_no_chief_and_raphael_is_not_it(store):
    assert store.primary_id() == 0
    assert store.is_chief(0) is False
    assert "chief" not in store.speaker(0).capabilities


def test_the_first_slime_made_is_the_chief_and_a_later_one_is_not(store, conn):
    first = store.create_member(name="Alice")
    second = store.create_member(name="Bob")
    assert flagged(conn) == [first.id] and store.primary_id() == first.id
    assert store.is_chief(first.id) and not store.is_chief(second.id)
    assert "chief" in store.speaker(first.id).capabilities and "chief" not in store.speaker(second.id).capabilities


def test_raphael_cannot_be_chosen_as_the_chief(store):
    store.create_member(name="Alice")
    with pytest.raises(MemberError) as caught:
        store.set_primary(0)
    assert caught.value.kind == "raphael"


def test_a_chief_that_is_hidden_hands_the_role_to_the_next_visible_slime_and_to_nobody_when_none_is_left(store, conn):
    alice, bob = store.create_member(name="Alice"), store.create_member(name="Bob")
    store.update_member(alice.id, hidden=True)
    assert flagged(conn) == [bob.id]
    store.update_member(bob.id, hidden=True)
    assert flagged(conn) == [] and store.primary_id() == 0
    # unhiding the first one with nobody in the chair gives it the role: there is a slime, so there is a chief
    store.update_member(alice.id, hidden=False)
    assert flagged(conn) == [alice.id]


def test_a_chief_that_is_deleted_hands_the_role_on_and_the_last_one_leaves_nobody(store, conn):
    alice, bob = store.create_member(name="Alice"), store.create_member(name="Bob")
    store.delete_member(alice.id)
    assert flagged(conn) == [bob.id]
    store.delete_member(bob.id)
    assert flagged(conn) == [] and store.primary_id() == 0
    again = store.create_member(name="Carol")
    assert flagged(conn) == [again.id]


def test_a_slime_cannot_take_raphaels_name_in_any_language(store):
    for name in set(RAPHAEL_NAMES.values()):
        with pytest.raises(MemberError) as caught:
            store.create_member(name=name)
        assert caught.value.kind == "taken"


# --- the service ---------------------------------------------------------------------------------------------------


async def make(rig, name, **fields):
    return (await rig.call("members.create", {"name": name, "role": name + " role", **fields}))["member"]["id"]


async def refused(rig, method, params):
    with pytest.raises(RpcError) as caught:
        await rig.call(method, params)
    assert caught.value.code == INVALID_PARAMS
    return (caught.value.data or {}).get("kind")


async def test_the_roster_lists_slimes_only_and_names_the_chief_or_nobody(rig):
    alone = rig.service.team_context(0, "en")
    assert (alone["primary_id"], alone["chief_id"]) == (None, None)
    assert [member["id"] for member in alone["members"]] == []
    alice, bob = await make(rig, "Alice"), await make(rig, "Bob")
    context = rig.service.team_context(0, "en")
    assert (context["primary_id"], context["chief_id"]) == (alice, alice)
    assert [member["id"] for member in context["members"]] == [alice, bob]
    listed = await rig.call("members.list", {"ui_language": "en"})
    assert listed["team_context"]["primary_id"] == alice
    assert [member["id"] for member in listed["members"]] == [0, alice, bob]


async def test_raphaels_row_is_flagged_fixed_and_has_no_slime_features(rig):
    await make(rig, "Alice")
    raphael = (await rig.call("members.list", {"ui_language": "ja"}))["members"][0]
    assert raphael["id"] == 0 and raphael["raphael"] is True
    assert raphael["name"] == RAPHAEL_NAMES["ja"] and raphael["role"] == ""
    assert (raphael["chief"], raphael["pinned"], raphael["hidden"], raphael["group_id"], raphael["position"]) == (False, False, False, None, -1)
    assert not {"avatar_rev", "avatar_crop", "profile_ready"} & set(raphael)
    alice = (await rig.call("members.list", {"ui_language": "ja"}))["members"][1]
    assert alice["chief"] is True and "raphael" not in alice


async def test_raphael_keeps_a_personality_and_instructions_and_nothing_else_of_a_profile(rig):
    await rig.call("members.update", {"id": 0, "personality": "Calm and brief.", "instructions": "Explain the app first."})
    raphael = (await rig.call("members.list", {"ui_language": "en"}))["members"][0]
    assert (raphael["personality"], raphael["instructions"]) == ("Calm and brief.", "Explain the app first.")
    speaker = rig.service.speaker(0)
    assert (speaker.name, speaker.personality, speaker.instructions) == ("", "Calm and brief.", "Explain the app first.")


@pytest.mark.parametrize("field,value", [("name", "Mine"), ("role", "Boss"), ("avatar", "slime:red-plain"), ("pinned", True),
                                         ("hidden", True), ("group_id", None), ("position", 3)])
async def test_raphaels_name_look_and_place_are_fixed(rig, field, value):
    assert await refused(rig, "members.update", {"id": 0, field: value}) == "raphael"


async def test_raphael_cannot_be_deleted_or_made_the_chief(rig):
    await make(rig, "Alice")
    assert await refused(rig, "members.delete", {"id": 0}) == "raphael"
    assert await refused(rig, "members.set_primary", {"id": 0}) == "raphael"


async def test_a_name_given_to_the_old_first_bot_does_not_keep_a_slime_from_the_name(rig):
    rig.conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('first_bot_profile', '{\"name\": \"Hikari\"}')")
    rig.conn.commit()
    await make(rig, "Hikari")
    assert rig.service.speaker(0).name == ""
