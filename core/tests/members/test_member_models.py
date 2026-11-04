"""Each member answers on its own model: choosing one for a member, or for Raphael, moves no one else."""

from raphael_core.brain import db
from raphael_core.brain.db import connect


async def test_a_new_member_holds_raphaels_model_and_his_next_change_moves_no_one(rig):
    rig.service._settings.set("agent_model", "cli:codex:one?effort=high")
    first = (await rig.call("members.create", {"name": "Alice"}))["member"]
    assert first["model"] == "cli:codex:one?effort=high"
    rig.service._settings.set("agent_model", "cli:claude:two")
    assert rig.service.speaker(first["id"]).model == "cli:codex:one?effort=high"
    second = (await rig.call("members.create", {"name": "Bob"}))["member"]
    assert second["model"] == "cli:claude:two"


async def test_changing_one_member_moves_neither_another_member_nor_raphael(rig):
    rig.service._settings.set("agent_model", "cli:codex:one")
    alice = (await rig.call("members.create", {"name": "Alice"}))["member"]
    bob = (await rig.call("members.create", {"name": "Bob"}))["member"]
    await rig.call("members.update", {"id": alice["id"], "model": "cli:claude:two"})
    assert rig.service.speaker(alice["id"]).model == "cli:claude:two"
    assert rig.service.speaker(bob["id"]).model == "cli:codex:one"
    assert rig.service._settings.get("agent_model") == "cli:codex:one"


async def test_a_member_made_by_raphael_and_a_copy_hold_a_model_too(rig):
    rig.service._settings.set("agent_model", "cli:codex:one")
    made = rig.service.create(name="Carol", role="r", instructions="i", group=None)
    assert made.model == "cli:codex:one"
    alice = (await rig.call("members.create", {"name": "Alice", "model": "cli:claude:two"}))["member"]
    copy = (await rig.call("members.duplicate", {"id": alice["id"]}))["member"]
    assert copy["model"] == "cli:claude:two"


def test_members_left_without_a_model_keep_what_they_answer_on_today(tmp_path, monkeypatch):
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 50)
        conn = connect(tmp_path / "upgrade.sqlite")
    insert = "INSERT INTO members(name, role, instructions, avatar, model, position, created_at_ms) VALUES(?, '', '', '', ?, ?, 1)"
    conn.execute(insert, ("Cleared", "", 1))
    conn.execute(insert, ("Own", "own/model", 2))
    conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('agent_model', ?)", ('"cli:codex:one?effort=high"',))
    conn.commit()
    db.migrate(conn)
    assert dict(conn.execute("SELECT name, model FROM members").fetchall()) == {"Cleared": "cli:codex:one?effort=high", "Own": "own/model"}


def test_an_owner_who_never_chose_a_model_gets_the_default_of_that_version(tmp_path, monkeypatch):
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 50)
        conn = connect(tmp_path / "upgrade.sqlite")
    conn.execute("INSERT INTO members(name, role, instructions, avatar, model, position, created_at_ms) VALUES('Cleared', '', '', '', '', 1, 1)")
    conn.commit()
    db.migrate(conn)
    assert conn.execute("SELECT model FROM members").fetchone()[0] == "openai/gpt-6-luna"
