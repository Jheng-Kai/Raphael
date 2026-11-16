"""A renamed slime face keeps wearing its face: the one table of retired ids, the migration that rewrites what is stored, and
every boundary an old id can arrive through."""
import hashlib
import json

import pytest

from raphael_core import slime_ids
from raphael_core.brain import db
from raphael_core.members.member_catalog import AVATARS, schema
from raphael_core.members.store import MemberError, clean_avatar
from raphael_core.slime_ids import LEGACY, RETIRED, current_avatar, current_id

# A made-up id stands in for the retired ones: the repository never spells them, so a test adds the digest of its own.
OLD = "face-from-before"
NEW = "horns-red"


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


@pytest.fixture
def renamed(monkeypatch):
    monkeypatch.setitem(RETIRED, digest(OLD), NEW)


def test_the_table_has_one_entry_for_each_retired_face_and_every_value_is_a_name_the_app_accepts():
    assert len(RETIRED) == 24
    assert all(len(key) == 64 and set(key) <= set("0123456789abcdef") for key in RETIRED)
    # The keys as a whole: dropping, adding or changing one changes this.
    assert digest("\n".join(sorted(RETIRED))) == "fa8fcb14cc33e624ebc35502f0c206407ba471d2f26a8b8d320cb03cdf7a86a7"
    assert len(set(RETIRED.values())) == 24
    for new in [*RETIRED.values(), *LEGACY.values()]:
        assert clean_avatar(f"slime:{new}") == f"slime:{new}"
        assert current_id(new) == new, "a current id must never be retired itself"


def test_every_catalogue_face_is_a_current_id():
    assert set(AVATARS) <= set(RETIRED.values())


def test_a_retired_id_is_renamed_in_every_form_a_face_is_stored_in(renamed):
    assert current_id(OLD) == NEW
    assert current_avatar(f"slime:{OLD}") == f"slime:{NEW}"
    # The first builds kept a colour after the shape; the face is the first part and the tail stays as it was.
    assert current_avatar(f"slime:{OLD}:coral") == f"slime:{NEW}:coral"


@pytest.mark.parametrize("avatar", ["", "slime:cat-ears", "slime:color:sky", "slime:no-such-face", "slime:no-such-face:coral",
                                    "preset:face-from-before", "file:face-from-before", "face-from-before", "slime:", "slime:Face-From-Before"])
def test_anything_else_comes_back_as_it_was(renamed, avatar):
    assert current_avatar(avatar) == avatar


def test_the_costumes_of_the_first_builds_are_renamed_too():
    assert current_avatar("slime:oni") == "slime:horn-lavender"
    assert current_avatar("slime:demon:teal") == "slime:streaks-charcoal:teal"
    assert current_avatar("slime:oni-red") == "slime:oni-red"


def test_an_unknown_face_is_still_stored_as_it_was(renamed):
    assert clean_avatar("slime:no-such-face") == "slime:no-such-face"
    with pytest.raises(MemberError):
        clean_avatar("slime:No Such Face")


def test_a_member_made_or_changed_with_a_retired_id_gets_the_new_one(renamed, tmp_path):
    conn = db.connect(tmp_path / "members.db")
    from raphael_core.members.store import MemberStore
    store = MemberStore(conn)
    made = store.create_member(name="Ada", avatar=f"slime:{OLD}")
    assert made.avatar == f"slime:{NEW}"
    other = store.create_member(name="Bo", avatar="slime:cat-ears")
    assert store.update_member(other.id, avatar=f"slime:{OLD}").avatar == f"slime:{NEW}"
    conn.close()


def entry(avatar):
    return {"id": "writer", "name": "Writer", "creator": "Example", "category": "marketing", "summary": "Edit a draft", "avatar": avatar,
            "featured": True, "package": "packages/writer/member.raphael-member", "sha256": "0" * 64, "version": "1.0.0",
            "created": "2026-01-01", "updated": "2026-01-01", "skills": 1, "routines": 0, "connections": []}


def test_a_catalogue_that_names_a_face_by_its_old_id_still_loads(renamed, monkeypatch):
    monkeypatch.setattr("raphael_core.members.member_catalog.AVATARS", (NEW,))
    index = {"format": "raphael-catalog", "version": 1, "sequence": 1, "entries": [entry(OLD)], "revoked": []}
    assert schema(index)["entries"][0]["avatar"] == NEW
    index["entries"] = [entry("no-such-face")]
    with pytest.raises(ValueError, match="avatar"):
        schema(index)
    index["entries"] = [entry(7)]
    with pytest.raises(ValueError, match="avatar"):
        schema(index)


def at_85(path):
    from unittest.mock import patch
    with patch.object(db, "LATEST_VERSION", 85):
        return db.connect(path)


def test_the_migration_rewrites_every_stored_face_and_runs_again_without_changing_anything(renamed, tmp_path):
    conn = at_85(tmp_path / "v85.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 85
    faces = {1: f"slime:{OLD}", 2: "slime:cat-ears", 3: "slime:color:teal", 4: "", 5: "file:picture.png", 6: f"slime:{OLD}:coral",
             7: "slime:no-such-face", 8: "slime:oni"}
    with conn:
        for identifier, avatar in faces.items():
            conn.execute("INSERT INTO members (id,name,model,position,created_at_ms,avatar) VALUES (?,?,?,?,?,?)",
                         (identifier, f"m{identifier}", "m", identifier, 1, avatar))
        conn.execute("INSERT INTO member_template_cards (id,turn_id,member_id,template,findings,avatar,state) VALUES ('a',1,1,'{}','[]',?,'draft')", (f"slime:{OLD}",))
        conn.execute("INSERT INTO member_template_cards (id,turn_id,member_id,template,findings,avatar,state) VALUES ('b',1,2,'{}','[]','slime:cat-ears','draft')")
    db.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 86 == db.LATEST_VERSION
    expected = {1: f"slime:{NEW}", 2: "slime:cat-ears", 3: "slime:color:teal", 4: "", 5: "file:picture.png", 6: f"slime:{NEW}:coral",
                7: "slime:no-such-face", 8: "slime:horn-lavender"}
    assert dict(conn.execute("SELECT id,avatar FROM members").fetchall()) == expected
    assert dict(conn.execute("SELECT id,avatar FROM member_template_cards").fetchall()) == {"a": f"slime:{NEW}", "b": "slime:cat-ears"}
    before = list(conn.execute("SELECT * FROM members ORDER BY id").fetchall())
    conn.execute("PRAGMA user_version = 85")
    db._MIGRATIONS[86](conn)
    assert list(conn.execute("SELECT * FROM members ORDER BY id").fetchall()) == before
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 86
    conn.close()


def test_the_migration_leaves_a_database_without_faces_alone(tmp_path):
    conn = at_85(tmp_path / "empty.db")
    db.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 86
    assert conn.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 0
    conn.close()


def test_the_app_keeps_the_same_table():
    """app/src/main/slime-ids.ts holds the second copy; it is read here as text so that neither can drift from the other."""
    from pathlib import Path
    source = (Path(slime_ids.__file__).parents[3] / "app/src/main/slime-ids.ts").read_text(encoding="utf-8")
    table = source[source.index("RETIRED_SLIME_IDS"):source.index("};", source.index("RETIRED_SLIME_IDS"))]
    import re
    assert dict(re.findall(r'"([0-9a-f]{64})": "([a-z-]+)"', table)) == RETIRED
    assert dict(re.findall(r'\["([a-z]+)", "([a-z-]+)"\]', source[source.index("LEGACY_SLIME_IDS"):])) == LEGACY
