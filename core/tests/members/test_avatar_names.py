"""A member's slime is named as the app names it: lower-case words joined by hyphens."""

import pytest

from raphael_core.members.store import MemberError, clean_avatar


@pytest.mark.parametrize(
    "avatar",
    ["", "slime:rimuru", "slime:oni-red", "slime:cat-ears", "slime:dragon-ice", "slime:knight-helm", "slime:cherry-blossom", "slime:color:sky"],
)
def test_a_slime_is_accepted_by_the_name_the_app_gives_it_hyphens_and_all(avatar):
    assert clean_avatar(avatar) == avatar


@pytest.mark.parametrize(
    "avatar",
    ["slime:", "slime:-red", "slime:oni-", "slime:oni--red", "slime:Oni-Red", "slime:oni red", "slime:../x", "slime:a:b:c", "slime:" + "a" * 40],
)
def test_what_is_not_a_slime_name_is_still_refused(avatar):
    with pytest.raises(MemberError):
        clean_avatar(avatar)


async def test_a_member_takes_a_slime_with_a_hyphen_in_its_name_when_made_and_when_changed(rig):
    # Owner, 2026-11-11: every slime from the red oni onward failed when chosen; the rule took letters alone.
    member = (await rig.call("members.create", {"name": "Oni", "avatar": "slime:oni-red"}))["member"]
    assert member["avatar"] == "slime:oni-red"
    changed = (await rig.call("members.update", {"id": member["id"], "avatar": "slime:cat-ears"}))["member"]
    assert changed["avatar"] == "slime:cat-ears"
