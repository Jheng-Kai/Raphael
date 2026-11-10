"""The roster names the pictures and does not carry them (owner, 2026-11-11: the list was 9.8 MB and was read about
seven times while the app started). A picture is read through its own call, by the revision the roster names."""

import base64
import json

PNG = b"\x89PNG\r\n\x1a\n"
BOUND = 100 * 1024  # ten members, each with a large cover and avatar


def upload(identifier, size, fill):
    return {"id": identifier, "name": "x.png", "mime": "image/png", "data": base64.b64encode(PNG + bytes([fill]) * size).decode()}


async def test_a_roster_with_large_covers_and_avatars_stays_small_and_the_pictures_come_by_revision(rig):
    folder = rig.local / "avatar"
    folder.mkdir(parents=True)
    (folder / "picture").write_bytes(PNG + b"\x07" * 1_000_000)
    (folder / "picture.json").write_text(json.dumps({"mime": "image/png", "crop": {"x": 0.5, "y": 0.5, "zoom": 1}}))
    await rig.call("members.set_cover", upload(0, 1_500_000, 1))
    ids = []
    for number in range(9):
        member = (await rig.call("members.create", {"name": f"Member {number}", "greet": False}))["member"]
        await rig.call("members.set_avatar", upload(member["id"], 800_000, number + 10))
        await rig.call("members.set_cover", upload(member["id"], 1_500_000, number + 40))
        ids.append(member["id"])

    listed = await rig.call("members.list")
    assert len(listed["members"]) == 10
    wire = len(json.dumps(listed))
    assert wire < BOUND, f"the roster is {wire} bytes"
    assert "data:" not in json.dumps(listed)

    raphael, first = listed["members"][0], listed["members"][1]
    assert raphael["avatar_rev"] and raphael["cover"]["kind"] == "image" and raphael["cover"]["rev"]
    assert first["avatar_rev"] and first["cover"]["rev"] and "avatar_url" not in first and "url" not in first["cover"]
    # Different pictures have different revisions; the same file keeps its own while the roster is read again.
    revs = {member["avatar_rev"] for member in listed["members"][1:]}
    assert len(revs) == 9
    assert [m["avatar_rev"] for m in (await rig.call("members.list"))["members"]] == [m["avatar_rev"] for m in listed["members"]]

    avatar = await rig.call("members.picture", {"id": first["id"], "kind": "avatar"})
    cover = await rig.call("members.picture", {"id": first["id"], "kind": "cover"})
    assert avatar["rev"] == first["avatar_rev"] and avatar["url"].startswith("data:image/png;base64,") and len(avatar["url"]) > 1_000_000
    assert cover["rev"] == first["cover"]["rev"] and len(cover["url"]) > 2_000_000
    assert (await rig.call("members.picture", {"id": 0, "kind": "avatar"}))["rev"] == raphael["avatar_rev"]
    assert (await rig.call("members.picture", {"id": 0, "kind": "cover"}))["rev"] == raphael["cover"]["rev"]


async def test_a_new_picture_has_a_new_revision_and_a_pattern_or_no_picture_has_none(rig):
    member = (await rig.call("members.create", {"name": "A", "greet": False}))["member"]
    assert await rig.call("members.picture", {"id": member["id"], "kind": "cover"}) == {"rev": None, "url": None}
    before = (await rig.call("members.set_avatar", upload(member["id"], 100, 1)))["member"]["avatar_rev"]
    after = (await rig.call("members.set_avatar", upload(member["id"], 100, 2)))["member"]["avatar_rev"]
    assert before != after
    assert (await rig.call("members.picture", {"id": member["id"], "kind": "avatar"}))["rev"] == after
    await rig.call("members.update", {"id": member["id"], "cover": "pattern:dots"})
    assert (await rig.call("members.list"))["members"][1]["cover"] == {"kind": "pattern", "id": "dots"}
    assert await rig.call("members.picture", {"id": member["id"], "kind": "cover"}) == {"rev": None, "url": None}


async def test_the_picture_call_refuses_what_it_cannot_name(rig):
    import pytest

    from raphael_core.protocol import INVALID_PARAMS, RpcError

    for params in ({"id": 999, "kind": "avatar"}, {"id": 0, "kind": "other"}, {"id": "0", "kind": "avatar"}, {"kind": "avatar"}):
        with pytest.raises(RpcError) as caught:
            await rig.call("members.picture", params)
        assert caught.value.code == INVALID_PARAMS
