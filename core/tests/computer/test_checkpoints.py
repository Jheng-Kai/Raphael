import json
from pathlib import Path

from raphael_core.computer.checkpoints import CheckpointStore
from .test_vm import desktop, Bridge, EmptyHub


async def test_restore_asks_for_confirmation_unless_the_owner_allows_everything(desktop, conn):
    from raphael_core.brain.settings import SettingsStore
    from raphael_core.computer.checkpoint_service import Checkpoints
    from raphael_core.protocol import RpcError
    import pytest
    vm, _, _ = desktop
    vm.settings = SettingsStore(conn)
    vm.settings.set("action_mode", "direct")
    service = Checkpoints(vm, lambda member: member == 2)
    assert (await service.call({"member_id": 2}))["confirmation_required"] is True
    with pytest.raises(RpcError):
        await service.call({"member_id": 2, "action": "restore", "id": "1" * 32})
    vm.settings.set("action_mode", "bypass")
    service = Checkpoints(vm, lambda member: member == 2)
    assert (await service.call({"member_id": 2}))["confirmation_required"] is False
    await service.call({"member_id": 2, "action": "restore", "id": "1" * 32})


async def test_workspace_commands_take_the_guest_checkpoint_path(desktop, tmp_path):
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(tool.key, {"command": "echo changed > report.txt"}, approver="auto")).ok
    commands = [args[-1] for args, _ in runtime.calls if "-lc" in args]
    assert commands and commands[0] == "cd /home/cua/workspace && echo changed > report.txt"
    assert any("class CheckpointStore" in str(args) for args, _ in runtime.calls)


async def test_checkpoint_internals_do_not_shorten_the_members_command_budget(desktop, tmp_path):
    from raphael_core.computer.vm_tools import VmTools, vm_scope
    from raphael_core.services.attachment_store import AttachmentStore
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tool.key, {"command": "true #" + "x" * 15000}, approver="auto")
    assert result.ok


def test_a_read_only_operation_leaves_no_checkpoint_and_changes_can_be_reviewed_and_restored(tmp_path):
    work, team, archive = (tmp_path / name for name in ("workspace", "team", "archive"))
    work.mkdir(); team.mkdir()
    file = work / "report.txt"
    file.write_text("before")
    store = CheckpointStore(archive, [work, team])
    ticket = store.begin(member=2, turn=7)
    assert store.list(member=2) == []
    file.write_text("after")
    (team / "new.txt").write_text("new")
    checkpoint = ticket
    view = store.list(member=2)[0]
    assert view["id"] == checkpoint and len(view["files"]) == 2 and "before" in view["files"][0]["diff"]
    result = store.restore(checkpoint, member=2)
    assert len(result["restored"]) == 2 and file.read_text() == "before" and not (team / "new.txt").exists()


def test_each_changed_file_says_whether_it_is_new_gone_or_changed_and_counts_only_lines_it_could_compare(tmp_path):
    # Owner, 2026-11-14: a card said 53 files with +0 -0. A picture or a file past the twentieth has no text to count, and is
    # reported as new, gone or changed with no counts at all, never as zero lines.
    root = tmp_path / "workspace"; root.mkdir()
    (root / "edit.txt").write_text("one\ntwo\nthree\n")
    (root / "gone.txt").write_text("old\n")
    (root / "same-bytes.bin").write_bytes(b"\0\1\2")
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    (root / "edit.txt").write_text("one\nTWO\nthree\nfour\n")
    (root / "gone.txt").unlink()
    (root / "new.txt").write_text("a\nb\n")
    (root / "same-bytes.bin").write_bytes(b"\0\1\2\3")
    (root / "picture.png").write_bytes(b"\x89PNG\0\0")
    files = {Path(file["path"]).name: file for file in store.list(member=2)[0]["files"]}
    assert (files["edit.txt"]["change"], files["edit.txt"]["added"], files["edit.txt"]["removed"]) == ("changed", 2, 1)
    assert (files["gone.txt"]["change"], files["gone.txt"]["added"], files["gone.txt"]["removed"]) == ("removed", 0, 1)
    assert (files["new.txt"]["change"], files["new.txt"]["added"], files["new.txt"]["removed"]) == ("added", 2, 0)
    for name, change in (("same-bytes.bin", "changed"), ("picture.png", "added")):
        assert (files[name]["change"], files[name]["added"], files[name]["removed"], files[name]["diff"]) == (change, None, None, "")


def test_a_long_change_is_counted_whole_while_only_its_first_part_is_kept_to_read(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    (root / "log.txt").write_text("")
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    (root / "log.txt").write_text("".join(f"line number {number}\n" for number in range(3000)))
    file = store.list(member=2)[0]["files"][0]
    assert len(file["diff"]) == 12000 and file["added"] == 3000 and file["removed"] == 0


def test_more_than_twenty_files_still_list_each_one_with_a_plain_kind(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    for number in range(53):
        (root / f"file-{number:02d}.txt").write_text("text\n")
    files = store.list(member=2)[0]["files"]
    assert len(files) == 53 and {file["change"] for file in files} == {"added"}
    assert sum(file["added"] is None for file in files) == 33 and all(file["diff"] == "" for file in files if file["added"] is None)


def test_restore_preserves_later_owner_changes_and_refuses_another_member(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    file = root / "a.txt"; file.write_text("original")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    file.write_text("member")
    checkpoint = ticket
    store.list(member=2)
    file.write_text("owner later")
    assert store.restore(checkpoint, member=2)["skipped"] == [str(file)]
    assert file.read_text() == "owner later"
    import pytest
    with pytest.raises(ValueError):
        store.restore(checkpoint, member=3)


async def test_restore_is_an_owner_action_and_refuses_active_work():
    from types import SimpleNamespace
    import pytest
    from raphael_core.computer.checkpoint_service import Checkpoints
    from raphael_core.protocol import RpcError
    calls = []
    async def checkpoint(*args, **kwargs): calls.append((args, kwargs)); return []
    vm = SimpleNamespace(target=lambda _: SimpleNamespace(key="one"), full_permission=lambda: False,
                         active={"one": 1}, busy=lambda _: False, checkpoint=checkpoint)
    service = Checkpoints(vm, lambda member: member == 2)
    with pytest.raises(RpcError): await service.call({"member_id": 2, "action": "restore", "id": "1" * 32})
    with pytest.raises(RpcError): await service.call({"member_id": 2, "action": "restore", "id": "1" * 32, "confirmed": True})
    assert not calls
    assert (await service.call({"member_id": 2}))["busy"] is True
    vm.active.clear()
    await service.call({"member_id": 2, "action": "restore", "id": "1" * 32, "confirmed": True})
    assert calls[-1][1] == {"id": "1" * 32, "member": 2}


def test_a_forged_restore_path_cannot_change_anything_outside_the_workspace(tmp_path):
    import json
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    outside = tmp_path / "owner.txt"; outside.write_text("owner")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7); file.write_text("after"); store.list(member=2)
    path = store.archive / (ticket + ".json")
    data = json.loads(path.read_text()); data["review"][0]["path"] = str(outside); path.write_text(json.dumps(data))
    assert store.restore(ticket, member=2)["skipped"] == [str(outside)]
    assert outside.read_text() == "owner"


def test_background_work_has_no_pending_state_and_later_changes_are_kept(tmp_path):
    root = tmp_path / "work"; root.mkdir()
    file = root / "a"; file.write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    file.write_text("after"); store.list(member=2)
    store.begin(member=2, turn=8)
    file.write_text("background update")
    assert store.restore(ticket, member=2)["skipped"] == [str(file)]
    assert file.read_text() == "background update"


def chrome_profile(base, files=12):
    """What a Chrome user-data directory holds after a first run, as the owner's card showed it (2026-11-14)."""
    (base / "Default" / "Extensions" / "abc" / "1.0" / "_metadata").mkdir(parents=True)
    (base / "OptGuideOnDeviceModel" / "2025.1").mkdir(parents=True)
    (base / "Local State").write_text("{}")
    (base / "First Run").write_text("")
    (base / "Default" / "Preferences").write_text("{}")
    (base / "Default" / "Extensions" / "abc" / "1.0" / "_metadata" / "verified_contents.json").write_text("{}")
    (base / "SingletonLock").write_text("host-1")
    for number in range(files):
        (base / "OptGuideOnDeviceModel" / "2025.1" / f"summarizer_{number}_solution_config.binarypb").write_bytes(b"\0\1" * 50)


def test_a_turn_whose_only_changes_are_a_browsers_own_files_leaves_no_work_card(tmp_path):
    # Owner, 2026-11-14: a member read an email and its card said "Added 110 files", all of them its Chrome's profile.
    root = tmp_path / "workspace"; root.mkdir()
    (root / "doc.odt").write_text("kept")
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    # The profile may be anywhere under any name; a folder of an app's own state and cache is no work either.
    chrome_profile(root / "member-b17ef6d19c0a4e11" / "chrome-data")
    (root / ".config" / "google-chrome").mkdir(parents=True)
    (root / ".config" / "google-chrome" / "Local State").write_text("{}")
    (root / ".cache" / "pip").mkdir(parents=True)
    (root / ".cache" / "pip" / "wheel").write_bytes(b"x")
    (root / ".~lock.doc.odt#").write_text("member,host,1")
    assert store.list(member=2) == []


def test_a_file_the_member_wrote_is_listed_and_the_browsers_files_beside_it_are_not(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    chrome_profile(root / "profile")
    (root / "OptGuideOnDeviceModel" / "x").mkdir(parents=True)
    (root / "OptGuideOnDeviceModel" / "x" / "model.binarypb").write_bytes(b"\0")
    (root / "Downloads").mkdir()
    (root / "Downloads" / "invoice.pdf").write_bytes(b"%PDF\0")
    (root / "report.txt").write_text("done\n")
    checkpoints = store.list(member=2)
    assert [Path(file["path"]).name for file in checkpoints[0]["files"]] == ["invoice.pdf", "report.txt"]
    assert not checkpoints[0]["partial"]


def test_a_browsers_folder_is_not_walked_so_it_cannot_make_a_checkpoint_partial(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    chrome_profile(root / "profile", files=60)
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    record = json.loads(next(store.archive.glob("*.json")).read_text())
    assert record["manifest"] == {} and not record["partial"] and record["uncovered"] == []


def test_undoing_the_changes_leaves_the_browsers_profile_alone_even_in_a_review_kept_before(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    (root / "a.txt").write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    (root / "a.txt").write_text("after")
    (root / "new.txt").write_text("new")
    chrome_profile(root / "profile")
    store.list(member=2)
    # A checkpoint kept by an older core lists the profile among the changes: it is still not touched.
    path = store.archive / (ticket + ".json")
    data = json.loads(path.read_text())
    profile = sorted(str(file) for file in (root / "profile").rglob("*") if file.is_file())
    real = data["review"][0]
    data["review"] += [{**real, "path": name, "before": None, "after": real["after"]} for name in profile]
    data["reviews"] = {key: data["review"] for key in data["reviews"]}
    path.write_text(json.dumps(data))
    token = next(iter(data["reviews"]))
    result = store.restore(ticket, member=2, review_token=token)
    assert (root / "a.txt").read_text() == "before" and not (root / "new.txt").exists()
    assert all(Path(name).exists() for name in profile) and set(result["restored"]) == {str(root / "a.txt"), str(root / "new.txt")}
    assert result["skipped"] == []


def test_a_checkpoint_kept_before_shows_no_browser_files_once_read_again(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    (root / "a.txt").write_text("a")
    chrome_profile(root / "member-1" / "profile")
    store.list(member=2)
    path = store.archive / (ticket + ".json")
    data = json.loads(path.read_text())
    # The review an older core kept: the profile's files are in it, and it was read without the new rule.
    for file in (root / "member-1").rglob("*"):
        if file.is_file():
            info = file.stat()
            data["review"].append({"path": str(file), "before": None, "diff": "", "added": None, "removed": None,
                                   "after": {"digest": "0" * 64, "mode": 0o644, "size": info.st_size, "mtime": info.st_mtime_ns}})
    data.pop("review_after", None)
    path.write_text(json.dumps(data))
    assert [Path(file["path"]).name for file in store.list(member=2)[0]["files"]] == ["a.txt"]


def test_a_folder_the_carry_over_published_is_not_the_members_work_but_later_edits_to_it_are(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    carried = root / "member-b17ef6d19c0a4e11"
    (carried / "notes").mkdir(parents=True)
    (carried / ".raphael-carried-member").write_text("b17ef6d19c0a4e11")
    (carried / "notes" / "old.txt").write_text("from the old computer\n")
    (root / "mine.txt").write_text("mine\n")
    assert [Path(file["path"]).name for file in store.list(member=2)[0]["files"]] == ["mine.txt"]
    store.begin(member=2, turn=8)
    (carried / "notes" / "old.txt").write_text("edited by the member\n")
    (carried / "notes" / "new.txt").write_text("written by the member\n")
    names = {Path(file["path"]).name: file["change"] for file in store.list(member=2)[0]["files"]}
    assert names == {"old.txt": "changed", "new.txt": "added"}


def test_a_marker_that_is_not_the_carry_overs_hides_nothing(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    (root / "folder").mkdir()
    (root / "folder" / ".raphael-carried-member").write_text("anything but sixteen bytes long")
    (root / "folder" / "work.txt").write_text("work\n")
    assert {Path(file["path"]).name for file in store.list(member=2)[0]["files"]} == {".raphael-carried-member", "work.txt"}


def test_the_change_view_does_not_read_a_binary_or_a_large_file_to_compare_it(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    for number in range(110):
        (root / f"model-{number:03d}.bin").write_bytes(b"\0" * 2048)
    (root / "large.txt").write_text("line\n" * 400_000)
    (root / "small.txt").write_text("one\ntwo\n")
    read = []
    original = store._bytes
    store._bytes = lambda value: read.append(value) or original(value)
    files = {Path(file["path"]).name: file for file in store.list(member=2)[0]["files"]}
    assert len(files) == 112
    # Only the small text file was read to compare; a file with a NUL byte or over a megabyte is only named.
    assert len(read) == 1 and files["small.txt"]["added"] == 2
    assert all(files[name]["diff"] == "" and files[name]["added"] is None for name in files if name != "small.txt")


def test_binary_files_do_not_use_up_the_twenty_text_comparisons(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    for number in range(30):
        (root / f"a-{number:02d}.bin").write_bytes(b"\0\1")
    for number in range(25):
        (root / f"b-{number:02d}.txt").write_text("text\n")
    files = store.list(member=2)[0]["files"]
    assert sum(file["added"] == 1 for file in files) == 20


def test_what_lies_between_two_checkpoints_is_compared_once(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    calls = []
    original = store._changes
    store._changes = lambda *args: calls.append(args[1:]) or original(*args)
    store.begin(member=2, turn=7)
    (root / "a.txt").write_text("a\n")
    store.begin(member=2, turn=8)
    (root / "b.txt").write_text("b\n")
    first = store.list(member=2)
    assert len(calls) == 2
    again = store.list(member=2)
    # Turn 7's window is closed: it is not compared again; only the newest one, which is still open, is.
    assert len(calls) == 3 and again == first
    assert [Path(file["path"]).name for file in again[0]["files"]] == ["b.txt"] and [Path(file["path"]).name for file in again[1]["files"]] == ["a.txt"]


def test_the_checkpoints_marker_for_a_carried_folder_is_the_one_the_carry_over_writes():
    # checkpoints.py runs alone in the computer and cannot import carry_runtime.py; the two must name the same file and a key as long.
    from raphael_core.computer import carry_runtime, checkpoints
    source = Path(carry_runtime.__file__).read_text(encoding="utf-8")
    assert f"folder / '{checkpoints.CARRIED}'" in source and "write_text(args['key'])" in source
    assert checkpoints.CARRIED == ".raphael-carried-member"


def tool_leftovers(root):
    """What tools leave in a workspace while a member works, as the owner's card showed it (2026-11-14: thirty files named by bare
    hashes, the content store of `npm i --cache /home/cua/workspace/.npm-cache`), with other stores, caches and temporary files."""
    digest = "acc20f9519bca6400afa6a868abca8258e7bc15ef7d0b1e2" * 2
    leftovers = [
        ".npm-cache/_cacache/content-v2/sha512/ac/c2/" + digest[4:], ".npm-cache/_cacache/index-v5/5f/d9/" + digest[:60],
        "npm-store/_cacache/tmp/a1b2c3", "film/node_modules/remotion/package.json", "film/src/__pycache__/render.cpython-313.pyc",
        "venv/lib/python3.13/site-packages/numpy/__init__.py", "film/.next/cache/webpack/client.pack", "film/.git/objects/3f/" + digest[:38],
        "film/tool.egg-info/PKG-INFO", "film/tmp/frame-0001.png", "film/Cache/state.bin", "film/package-lock.json", "film/yarn.lock",
        "film/draft.mp4.part", "Downloads/clip.mp4.crdownload", "film/.Promo.tsx.swp", "film/render.pid", "notes.txt~",
        digest[:64], digest[:32] + ".json", digest[:40].upper() + ".tar.gz",
    ]
    for name in leftovers:
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_bytes(b"\0tool")
    return [str(root / name) for name in leftovers]


def test_a_turn_whose_only_changes_are_what_tools_leave_behind_has_no_work_card(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    (root / "brief.md").write_text("kept\n")
    store = CheckpointStore(tmp_path / "archive", [root])
    store.begin(member=2, turn=7)
    tool_leftovers(root)
    assert store.list(member=2) == []


def test_the_card_lists_the_works_files_and_none_of_what_tools_left_beside_them(tmp_path):
    root, team = tmp_path / "workspace", tmp_path / "team"
    root.mkdir(); team.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root, team])
    store.begin(member=2, turn=7)
    tool_leftovers(root)
    tool_leftovers(team)
    (root / "film" / "src" / "Promo.tsx").write_text("export const Promo = () => null;\n")
    (root / "film" / "package.json").write_text("{}\n")
    (root / "film" / ".gitignore").write_text("node_modules\n")
    (team / "film" / "launch-film.mp4").write_bytes(b"\0video")
    (team / "film" / "frames").mkdir()
    (team / "film" / "frames" / "0001.png").write_bytes(b"\0png")
    work = {".gitignore", "0001.png", "Promo.tsx", "launch-film.mp4", "package.json"}
    view = store.list(member=2)[0]
    assert sorted(Path(file["path"]).name for file in view["files"]) == sorted(work)
    assert not view["partial"] and view["uncovered"] == []
    # What tools keep is not even walked or stored: it cannot fill the walk's bound or the archive.
    store.begin(member=2, turn=8)
    record = max((json.loads(path.read_text()) for path in store.archive.glob("*.json")), key=lambda item: item["order"])
    assert {Path(path).name for path in record["manifest"]} == work


def test_a_name_is_a_bare_hash_only_when_it_is_all_hex_of_thirty_two_or_more():
    from raphael_core.computer.checkpoints import noise_file, noise_folder
    hashed = ["a" * 32, "0123456789ABCDEF" * 2 + ".mp4", "5fd9c360eeb8025899f109d27e177577f4ef2285bdfb" + ".tar.gz"]
    named = ["0123456789abcdef0123456789abcde.png", "report-" + "a" * 32 + ".png", "g" * 40, "launch-film.mp4", "README", ".gitignore"]
    assert all(noise_file(name) for name in hashed) and not any(noise_file(name) for name in named)
    assert all(noise_folder(name) for name in [".npm-cache", "node_modules", "__pycache__", "venv", "_cacache", "Cache", "TMP", "pkg.egg-info"])
    assert not any(noise_folder(name) for name in ["src", "film", "frames", "dist", "build", "out", "Downloads"])


def test_undoing_the_changes_leaves_what_tools_left_alone_even_in_a_review_kept_before(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    (root / "a.txt").write_text("before")
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    (root / "a.txt").write_text("after")
    (root / "new.txt").write_text("new")
    leftovers = tool_leftovers(root)
    store.list(member=2)
    # A review an older core kept lists the npm store and the other leftovers as new files: undo still deletes none of them.
    path = store.archive / (ticket + ".json")
    data = json.loads(path.read_text())
    real = next(file for file in data["review"] if file["path"].endswith("new.txt"))
    data["review"] += [{**real, "path": name} for name in leftovers]
    data["reviews"] = {key: data["review"] for key in data["reviews"]}
    path.write_text(json.dumps(data))
    result = store.restore(ticket, member=2, review_token=next(iter(data["reviews"])))
    assert (root / "a.txt").read_text() == "before" and not (root / "new.txt").exists()
    assert all(Path(name).exists() for name in leftovers) and set(result["restored"]) == {str(root / "a.txt"), str(root / "new.txt")}
    assert result["skipped"] == []


def test_a_review_kept_before_lists_none_of_what_tools_left_once_read_again(tmp_path):
    root = tmp_path / "workspace"; root.mkdir()
    store = CheckpointStore(tmp_path / "archive", [root])
    ticket = store.begin(member=2, turn=7)
    (root / "a.txt").write_text("a\n")
    store.begin(member=2, turn=8)
    (root / "b.txt").write_text("b\n")
    store.list(member=2)
    # Turn 7's window is closed, so its review is kept and handed back as it is: the npm store an older core put in it is left out.
    path = store.archive / (ticket + ".json")
    data = json.loads(path.read_text())
    assert data["review_after"]
    data["review"] += [{"path": name, "before": None, "diff": "", "added": None, "removed": None,
                        "after": {"digest": "0" * 64, "mode": 0o644, "size": 5, "mtime": 1}} for name in tool_leftovers(root)]
    path.write_text(json.dumps(data))
    views = store.list(member=2)
    assert [Path(file["path"]).name for file in views[1]["files"]] == ["a.txt"]
    assert views[1]["review_token"] in json.loads(path.read_text())["reviews"]
