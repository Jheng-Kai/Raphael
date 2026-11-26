"""The files of the member 0 that became a slime follow it, once; Raphael starts again beside them."""

import json
from types import SimpleNamespace

import pytest

from raphael_core.brain.secrets import MemoryKeyStore  # noqa: F401 - the suite's keyring guard is in conftest
from raphael_core.integrations.vault import MemoryVault
from raphael_core.members import raphael_files


@pytest.fixture
def split(conn, tmp_path):
    conn.execute("INSERT INTO settings(key,value) VALUES ('raphael_split', ?)", (json.dumps({"slime": 7}),))
    conn.commit()
    root, data = tmp_path / "local", tmp_path / "data"
    (root / "bots" / "0").mkdir(parents=True)
    (root / "bots" / "0" / "MEMORY.md").write_text("notes", encoding="utf-8")
    (root / "bot-state" / "0").mkdir(parents=True)
    covers = root / "avatars" / "covers"
    covers.mkdir(parents=True)
    (covers / "0-0123456789ab.png").write_bytes(b"png")
    (covers / "0.json").write_text(json.dumps({"kind": "image", "file": "0-0123456789ab.png"}), encoding="utf-8")
    data.mkdir()
    (data / "messaging.json").write_text(json.dumps({"version": 2, "channels": {
        "telegram": {"enabled": True, "identity": {"id": "1", "name": "bot"}, "allowed": []}}}), encoding="utf-8")
    vault = MemoryVault()
    vault.set("messaging:telegram:bot_token", "123:abc")
    machine = tmp_path / "machine"
    keys = {0: "k0", 7: "k7"}
    vm = SimpleNamespace(homes=machine / "members", key_for=lambda host, member: keys[member],
                         shared_members_folder=lambda: machine / "shared" / "members")
    (vm.homes / "k0").mkdir(parents=True)
    (vm.homes / "k0" / "work.txt").write_text("w", encoding="utf-8")
    (machine / "shared" / "members" / "k0").mkdir(parents=True)
    return SimpleNamespace(root=root, data=data, vault=vault, vm=vm, conn=conn)


def run(split):
    raphael_files.adopt(split.conn, root=split.root, data_dir=split.data, vault=split.vault, vm=split.vm)


def test_the_memory_the_cover_the_bot_and_the_computer_follow_the_slime(split):
    run(split)
    root = split.root
    assert (root / "bots" / "7" / "MEMORY.md").read_text(encoding="utf-8") == "notes" and not (root / "bots" / "0").exists()
    assert (root / "bot-state" / "7").is_dir()
    covers = root / "avatars" / "covers"
    assert json.loads((covers / "7.json").read_text(encoding="utf-8")) == {"kind": "image", "file": "7-0123456789ab.png"}
    assert (covers / "7-0123456789ab.png").is_file() and not (covers / "0.json").exists()
    channels = json.loads((split.data / "messaging.json").read_text(encoding="utf-8"))["channels"]
    assert list(channels) == ["member:7:telegram"]
    assert split.vault.get("messaging:member:7:telegram:bot_token") == "123:abc"
    assert split.vault.get("messaging:telegram:bot_token") is None
    assert (split.vm.homes / "k7" / "work.txt").is_file() and not (split.vm.homes / "k0").exists()
    assert (split.vm.shared_members_folder() / "k7").is_dir()
    assert json.loads(split.conn.execute("SELECT value FROM settings WHERE key='raphael_split_files'").fetchone()[0]) is True


def test_a_second_run_moves_nothing_and_never_takes_what_raphael_has_made_since(split):
    run(split)
    (split.root / "bots" / "0").mkdir()
    (split.root / "bots" / "0" / "MEMORY.md").write_text("raphael's own", encoding="utf-8")
    run(split)
    assert (split.root / "bots" / "0" / "MEMORY.md").read_text(encoding="utf-8") == "raphael's own"
    assert (split.root / "bots" / "7" / "MEMORY.md").read_text(encoding="utf-8") == "notes"


def test_a_slime_that_has_its_own_home_already_is_not_overwritten(split):
    (split.root / "bots" / "7").mkdir()
    run(split)
    assert not (split.root / "bots" / "7" / "MEMORY.md").exists()
    assert (split.root / "bots" / "0" / "MEMORY.md").is_file()


def test_nothing_moves_for_an_install_that_was_never_split(conn, tmp_path):
    (tmp_path / "bots" / "0").mkdir(parents=True)
    raphael_files.adopt(conn, root=tmp_path, data_dir=tmp_path)
    assert (tmp_path / "bots" / "0").is_dir()
