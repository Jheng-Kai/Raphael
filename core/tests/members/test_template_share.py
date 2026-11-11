"""Sharing a member as a template, end to end and offline: what travels, what never does, and the store before it opens."""
import json
import re
from pathlib import Path

import httpx
import pytest

from raphael_core.members import member_catalog
from raphael_core.members.member_catalog import PUBLIC_KEYS, Catalog
from raphael_core.members.store import NAME_MAX, ROLE_MAX
from raphael_core.members.template_author import SCHEMA
from raphael_core.protocol import RpcError

ROOT = Path(__file__).parents[3]


@pytest.fixture
async def rig(rig):
    from agent.conftest import FakeActions, FakeOpenRouter
    from agent.test_service import Rig as AgentRig
    from .test_answering import live_said
    client = FakeOpenRouter()
    client.chats = [live_said("Hello. What would you like me to take off your plate?")]
    agent = AgentRig(rig.conn, client, FakeActions(), team=rig.service, memory=rig.memory)
    yield rig
    await agent.aclose()


async def test_a_member_exported_to_a_file_and_imported_again_is_a_copy_of_the_recipe_only(rig, tmp_path):
    service = rig.service
    original = (await rig.call("members.create", {
        "name": "Editor", "role": "Copy editor", "personality": "Calm and exact", "instructions": "Check every claim twice.",
        "avatar": "slime:shuna", "tools": ["srv-1"], "reply_style": "conversational"}))["member"]
    identifier = original["id"]
    service.capabilities.keep_recipe(identifier, "---\nname: editing\ndescription: Check clarity\n---\nVerify claims.",
                                     {"references/check.md": "Check the source"})
    service.capabilities.homes.keep(identifier, "MEMORY.md", "PRIVATE-MEMORY-NOTE")
    await rig.call("routines.create", {"member_id": identifier, "title": "Review", "prompt": "Review the goal",
                                       "schedule": {"kind": "daily", "time": "09:00"}})
    service._history.add(session_id="private", question="PRIVATE-CONVERSATION-LINE", route="answer", prefix="", text="PRIVATE-REPLY", status="done", member_id=identifier)

    # What the owner reviews is what the file holds; Notepad would add a byte-order mark when it saves the file.
    review = await rig.call("members.template", {"action": "review", "id": identifier})
    assert review["findings"] == []
    file = tmp_path / "editor.raphael-member"
    file.write_bytes(b"\xef\xbb\xbf" + (json.dumps(review["template"], ensure_ascii=False, indent=2) + "\n").encode())
    text = file.read_bytes().decode("utf-8-sig")
    assert "PRIVATE" not in text and "srv-1" not in text and "GitHub" not in json.loads(text)["skills"][0]["text"]

    shown = await rig.call("members.template", {"action": "preview", "template": json.loads(text)})
    made = (await rig.call("members.template", {"action": "import", "template": shown["template"], "name": "Editor copy"}))["member"]
    assert made["id"] != identifier and made["name"] == "Editor copy"

    # carried
    for field in ("role", "personality", "instructions", "reply_style"):
        assert made[field] == original[field], field
    [skill] = service.capabilities.owned_skills(made["id"])
    assert service.capabilities.skills(made["id"])[0]["name"] == "editing"
    folder = service.capabilities._path(made["id"], skill["id"]).parent
    assert (folder / "references/check.md").read_text() == "Check the source"
    [routine] = service.store.routines(made["id"])
    [source] = service.store.routines(identifier)
    assert (routine.title, routine.prompt, routine.schedule) == (source.title, source.prompt, source.schedule)
    assert not routine.enabled and routine.next_run_ms is None
    # not carried: grants, memory, the owner's profile, anything said
    assert made["tools"] == [] and original["tools"] == ["srv-1"]
    for name in ("MEMORY.md",):
        assert "PRIVATE" not in service.capabilities.homes.path(made["id"], name).read_text()
    assert "PRIVATE" not in json.dumps(await rig.call("members.template", {"action": "export", "id": made["id"]}))
    assert [t for t in service._history.list(member_id=made["id"]) if t.source != "greeting"] == []
    # and the copy shares the same recipe again
    assert (await rig.call("members.template", {"action": "export", "id": made["id"]}))["template"]["skills"] == review["template"]["skills"]


async def test_the_names_a_template_may_have_are_the_core_names_everywhere(rig):
    assert SCHEMA["properties"]["name"]["maxLength"] == NAME_MAX == 16
    assert SCHEMA["properties"]["role"]["maxLength"] == ROLE_MAX
    catalog = json.loads((ROOT / "catalog-template/member.schema.json").read_text(encoding="utf-8"))["properties"]
    assert catalog["name"]["maxLength"] == NAME_MAX and catalog["role"]["maxLength"] == ROLE_MAX
    value = (await rig.call("members.template", {"action": "export", "id": (await rig.call("members.create", {"name": "N" * NAME_MAX}))["member"]["id"]}))["template"]
    with pytest.raises(RpcError):
        await rig.call("members.template", {"action": "preview", "template": {**value, "name": "N" * (NAME_MAX + 1)}})


async def test_a_publish_request_says_where_its_files_are_and_only_that_folder_can_be_shown(rig):
    value = json.loads((ROOT / "core/tests/fixtures/member-catalog/packages/research/member.raphael-member").read_bytes())
    result = await rig.call("members.template", {"action": "publish", "template": value})
    assert re.fullmatch(r"[0-9a-f]{16}", result["folder_id"]) and Path(result["folder"]).name == result["folder_id"]
    shown = await rig.call("members.template", {"action": "folder", "folder_id": result["folder_id"]})
    assert Path(shown["path"]) == Path(result["folder"]) / "member.raphael-member" and Path(shown["path"]).is_file()
    for bad in ("../" * 3 + "x", "ABCDEF0123456789", "0" * 16, "", 7, None):
        with pytest.raises(RpcError):
            await rig.call("members.template", {"action": "folder", "folder_id": bad})


def test_the_store_has_no_placeholder_key_that_could_pass_for_a_real_one():
    # Until the owner creates the catalogue and generates its key (catalog-template/README.md) the list is empty.
    assert all(re.fullmatch(r"[0-9a-f]{64}", key) for key in PUBLIC_KEYS)
    assert PUBLIC_KEYS == ()


async def test_a_store_without_a_key_is_not_open_and_never_reaches_the_network(rig, tmp_path):
    requests = []
    def refuse(request):
        requests.append(request)
        raise AssertionError("a store that is not open asked the network")
    rig.service._member_catalog = Catalog(tmp_path, keys=(), transport=httpx.MockTransport(refuse))
    answer = await rig.call("members.template", {"action": "catalog"})
    assert answer == {"entries": [], "offline": False, "open": False}
    for action in ({"action": "catalog-preview", "catalog_id": "research"}, {"action": "import", "catalog_id": "research", "name": "X", "template": {}}):
        with pytest.raises(RpcError, match="not open"):
            await rig.call("members.template", action)
    assert requests == [] and not rig.service.store.members()


def test_a_key_that_is_not_a_key_is_refused_when_the_store_is_made(tmp_path):
    for bad in ("cc1a2f06ea541dc3d558b78ef3d29363ec806e9c42d76340bf08e20c3a563139" + "c", "xyz", "00" * 31, ""):
        with pytest.raises(ValueError, match="public key"):
            Catalog(tmp_path, keys=(bad,))


async def test_the_default_store_of_the_app_is_not_open(rig):
    assert member_catalog.client(rig.service).keys == ()
    assert (await rig.call("members.template", {"action": "catalog"}))["open"] is False
