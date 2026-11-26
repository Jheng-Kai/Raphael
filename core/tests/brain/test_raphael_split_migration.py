"""Schema 101: what the owner made of member 0 becomes a slime, Raphael starts again, quick questions stay with Raphael."""

import json

import pytest

from raphael_core.agent.conversations import Conversations
from raphael_core.brain import db


@pytest.fixture
def old(tmp_path, monkeypatch):
    with monkeypatch.context() as previous:
        previous.setattr(db, "LATEST_VERSION", 100)
        conn = db.connect(tmp_path / "old.db")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 100
    yield conn
    conn.close()


def setting(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))


def value_of(conn, key):
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return None if row is None else json.loads(row[0])


def turn(conn, member, conversation, text="hello", scope="private"):
    return conn.execute(
        "INSERT INTO agent_turns(created_at_ms,session_id,question,route,prefix,text,status,member_id,conversation_id,scope)"
        " VALUES(100,?,?,'answer','',?, 'done',?,?,?)", (text, text, text, member, conversation, scope),
    ).lastrowid


def task(conn, member, turn_id):
    return conn.execute(
        "INSERT INTO worker_tasks(created_at_ms,state,session_id,language,text,member_id,turn_id)"
        " VALUES(1,'done','s','en','work',?,?)", (member, turn_id),
    ).lastrowid


def customize(conn):
    """A member 0 as an owner's install has it: named, given a job, a model, a tool list, a pin, a routine, a bot."""
    setting(conn, "first_bot_profile", {"name": "Hikari", "role": "Chief of staff", "personality": "Warm",
                                         "instructions": "Plan my week", "avatar": "slime:red-plain"})
    setting(conn, "raphael_tools", ["gmail"])
    setting(conn, "raphael_notify", True)
    setting(conn, "raphael_draft_first", False)
    setting(conn, "chief_pinned", True)
    setting(conn, "raphael_computer_mode", "docker")
    setting(conn, "agent_model", "openai/gpt-x")
    setting(conn, "member_work_folder", {"0": "D:/work", "7": "D:/other"})
    conn.execute("INSERT INTO routines(member_id,title,prompt,schedule,created_at_ms) VALUES (0,'Morning','Brief me','{}',1)")
    conn.commit()


def seed(conn):
    """Both kinds of conversation of member 0, with turns, tasks, a skill, a room, memory and spend."""
    customize(conn)
    main = Conversations(conn).main(0)
    quick = Conversations(conn).quick()
    ids = {"main": main, "quick": quick,
           "t_main": turn(conn, 0, main, "planning"), "t_quick": turn(conn, 0, quick, "quick question")}
    ids["task_main"], ids["task_quick"] = task(conn, 0, ids["t_main"]), task(conn, 0, ids["t_quick"])
    conn.execute("INSERT INTO member_unread(member_id, conversation_id, unread_from) VALUES (0, ?, ?)", (main, ids["t_main"]))
    conn.execute("INSERT INTO member_unread(member_id, conversation_id, unread_from) VALUES (0, ?, ?)", (quick, ids["t_quick"]))
    conn.execute("INSERT INTO member_skills(member_id,name,description,source) VALUES (0,'plan','d','s')")
    conn.execute("INSERT INTO member_commands(member_id,name,description,template) VALUES (0,'go','d','t')")
    conn.execute("INSERT INTO spend(created_at_ms,purpose,cost_usd,prompt_tokens,completion_tokens,member_id) VALUES (1,'a',0.5,1,1,0)")
    conn.execute("INSERT INTO conversation_summaries(member_id,text,through_turn_id,updated_at_ms) VALUES (0,'sum',?,1)", (ids["t_main"],))
    conn.execute("INSERT INTO memory_entry_metadata(scope,entry_id,created_at_ms) VALUES ('member:0','e1',1),('shared','e2',1)")
    conn.execute("INSERT INTO memory_state(key,value) VALUES ('reflected_through',9),('skills:0:through',4)")
    conn.execute("INSERT INTO memory_search_documents(kind,source_key,member_id,body,updated_at_ms) VALUES ('log','memory/log/a.md',0,'x',1)")
    conn.execute("INSERT INTO calendar_events(title,all_day,start_ms,end_ms,added_by,created_at_ms,updated_at_ms) VALUES ('t',0,1,2,0,1,1)")
    conn.execute("INSERT INTO members(id,name,position,created_at_ms) VALUES (5,'Bob',0,1)")
    conn.execute("INSERT INTO rooms(id,name,created,roles,default_responder) VALUES (1,'Team',1,'{\"0\":\"moderator\"}','member:0')")
    conn.execute("INSERT INTO room_members(room_id,member_id) VALUES (1,0),(1,5)")
    thread = conn.execute("SELECT id FROM room_threads WHERE room_id = 1").fetchone()
    thread = thread[0] if thread else conn.execute("INSERT INTO room_threads(room_id,created) VALUES (1,1)").lastrowid
    conn.execute("INSERT INTO room_messages(id,room_id,member_id,text,created,thread_id) VALUES (1,1,5,'hi',1,?)", (thread,))
    conn.execute("INSERT INTO room_messages(id,room_id,member_id,text,created,thread_id,reply_to,reply_to_member) VALUES (2,1,0,'re',2,?,1,5)", (thread,))
    conn.commit()
    return ids


def migrate(conn):
    conn.execute("PRAGMA user_version = 100")
    db.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION >= 101


def slime_of(conn):
    return conn.execute("SELECT * FROM members WHERE name = 'Hikari'").fetchone()


def test_a_customized_member_0_becomes_a_slime_with_everything_it_had(old):
    seed(old)
    migrate(old)
    slime = slime_of(old)
    assert slime is not None and slime["id"] > 0
    assert (slime["role"], slime["personality"], slime["instructions"], slime["avatar"]) == ("Chief of staff", "Warm", "Plan my week", "slime:red-plain")
    assert json.loads(slime["tools"]) == ["gmail"] and slime["model"] == "openai/gpt-x"
    assert (slime["notify"], slime["draft_first"], slime["pinned"], slime["computer_mode"]) == (1, 0, 1, "docker")
    assert slime["primary_contact"] == 1  # Bob was not the chief either, so the slime that was Raphael is
    assert old.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 2


def test_the_slime_gets_the_normal_conversations_and_raphael_keeps_the_quick_one(old):
    ids = seed(old)
    migrate(old)
    slime = slime_of(old)["id"]
    assert old.execute("SELECT member_id FROM conversations WHERE id=?", (ids["main"],)).fetchone()[0] == slime
    assert old.execute("SELECT member_id,kind FROM conversations WHERE id=?", (ids["quick"],)).fetchone()[:] == (0, "quick")
    assert old.execute("SELECT member_id FROM agent_turns WHERE id=?", (ids["t_main"],)).fetchone()[0] == slime
    assert old.execute("SELECT member_id FROM agent_turns WHERE id=?", (ids["t_quick"],)).fetchone()[0] == 0
    assert old.execute("SELECT member_id FROM worker_tasks WHERE id=?", (ids["task_main"],)).fetchone()[0] == slime
    assert old.execute("SELECT member_id FROM worker_tasks WHERE id=?", (ids["task_quick"],)).fetchone()[0] == 0
    assert sorted(tuple(row) for row in old.execute("SELECT member_id,conversation_id FROM member_unread")) == sorted([(slime, ids["main"]), (0, ids["quick"])])
    # Raphael opens its own empty conversation next to the quick one
    fresh = Conversations(old).main(0)
    assert fresh != ids["main"]
    assert [row["kind"] for row in Conversations(old).list(0)] == ["quick", "standard"]


def test_a_database_with_no_quick_conversation_still_moves_every_row_of_the_standard_one(old):
    customize(old)
    main = Conversations(old).main(0)
    assert old.execute("SELECT COUNT(*) FROM conversations WHERE kind = 'quick'").fetchone()[0] == 0
    first, second = turn(old, 0, main, "planning"), turn(old, 0, main, "more planning")
    old.execute("INSERT INTO member_unread(member_id, conversation_id, unread_from) VALUES (0, ?, ?)", (main, first))
    old.commit()
    migrate(old)
    slime = slime_of(old)["id"]
    assert old.execute("SELECT member_id FROM conversations WHERE id=?", (main,)).fetchone()[0] == slime
    assert [row[0] for row in old.execute("SELECT member_id FROM agent_turns WHERE id IN (?, ?)", (first, second))] == [slime, slime]
    assert [tuple(row) for row in old.execute("SELECT member_id, conversation_id FROM member_unread")] == [(slime, main)]


def test_the_routines_skills_memory_summary_spend_and_calendar_follow_the_slime(old):
    seed(old)
    migrate(old)
    slime = slime_of(old)["id"]
    for table in ("routines", "member_skills", "member_commands", "conversation_summaries", "spend"):
        assert [row[0] for row in old.execute(f"SELECT member_id FROM {table}")] == [slime], table
    assert old.execute("SELECT added_by FROM calendar_events").fetchone()[0] == slime
    assert sorted(row[0] for row in old.execute("SELECT scope FROM memory_entry_metadata")) == sorted([f"member:{slime}", "shared"])
    assert sorted(row[0] for row in old.execute("SELECT key FROM memory_state")) == sorted([f"reflected_through:{slime}", f"skills:{slime}:through"])
    assert old.execute("SELECT member_id FROM memory_search_documents WHERE source_key='memory/log/a.md'").fetchone()[0] == slime
    assert value_of(old, "member_work_folder") == {str(slime): "D:/work", "7": "D:/other"}


def test_the_rooms_it_was_in_and_what_it_wrote_there_are_the_slimes(old):
    seed(old)
    migrate(old)
    slime = slime_of(old)["id"]
    assert sorted(row[0] for row in old.execute("SELECT member_id FROM room_members")) == sorted([slime, 5])
    assert [tuple(row) for row in old.execute("SELECT member_id,reply_to_member FROM room_messages ORDER BY id")] == [(5, None), (slime, 5)]
    room = old.execute("SELECT roles, default_responder FROM rooms").fetchone()
    assert (json.loads(room[0]), room[1]) == ({str(slime): "moderator"}, f"member:{slime}")


def test_a_chat_the_bot_held_belongs_to_the_slimes_own_account(old):
    seed(old)
    main = Conversations(old).main(0)
    old.execute("UPDATE agent_turns SET session_id='telegram:42' WHERE id=(SELECT MIN(id) FROM agent_turns WHERE conversation_id=?)", (main,))
    old.commit()
    migrate(old)
    slime = slime_of(old)["id"]
    assert old.execute("SELECT session_id FROM agent_turns WHERE session_id LIKE '%telegram:42'").fetchone()[0] == f"member:{slime}:telegram:42"


def test_raphael_returns_to_its_factory_settings(old):
    seed(old)
    migrate(old)
    assert value_of(old, "first_bot_profile") == {}
    assert value_of(old, "raphael_tools") is None
    assert (value_of(old, "raphael_notify"), value_of(old, "raphael_draft_first"), value_of(old, "chief_pinned")) == (False, True, None)
    assert value_of(old, "raphael_computer_mode") == "host"
    assert value_of(old, "agent_model") == "openai/gpt-x"  # the answer model is the app's, Raphael answers on it
    assert value_of(old, "raphael_split") == {"slime": slime_of(old)["id"]}


def test_the_slime_is_the_chief_when_member_0_was_or_nobody_else_was(old):
    old.execute("DELETE FROM members")
    customize(old)
    migrate(old)
    assert [row["id"] for row in old.execute("SELECT id FROM members WHERE primary_contact = 1")] == [slime_of(old)["id"]]


def test_a_chief_that_was_another_member_stays_the_chief(old):
    customize(old)
    old.execute("INSERT INTO members(id,name,position,created_at_ms,primary_contact) VALUES (5,'Bob',0,1,1)")
    old.commit()
    migrate(old)
    assert [row["id"] for row in old.execute("SELECT id FROM members WHERE primary_contact = 1")] == [5]
    assert slime_of(old) is not None


def test_a_member_0_the_owner_never_customized_leaves_raphael_alone_and_makes_no_empty_slime(old):
    main = Conversations(old).main(0)
    turn(old, 0, main, "just chatting")
    old.commit()
    migrate(old)
    assert old.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 0
    assert old.execute("SELECT member_id FROM agent_turns").fetchone()[0] == 0
    assert value_of(old, "raphael_split") is None


def test_a_plain_raphael_that_sat_in_a_group_chat_as_the_chief_leaves_it_to_the_new_chief(old):
    old.execute("INSERT INTO members(id,name,position,created_at_ms) VALUES (5,'Bob',0,1),(6,'Cy',1,1)")
    old.execute("INSERT INTO rooms(id,name,created) VALUES (1,'Team',1)")
    old.execute("INSERT INTO room_members(room_id,member_id) VALUES (1,0),(1,6)")
    old.commit()
    migrate(old)
    assert sorted(row[0] for row in old.execute("SELECT member_id FROM room_members")) == [5, 6]


def test_with_members_and_a_plain_raphael_the_first_visible_slime_becomes_the_chief(old):
    old.execute("INSERT INTO members(id,name,position,created_at_ms,hidden) VALUES (4,'Hidden',0,1,1),(5,'Bob',1,1,0),(6,'Cy',2,1,0)")
    old.commit()
    migrate(old)
    assert [row["id"] for row in old.execute("SELECT id FROM members WHERE primary_contact = 1")] == [5]


def test_running_it_again_neither_makes_a_second_slime_nor_moves_what_raphael_has_since(old):
    ids = seed(old)
    migrate(old)
    again = turn(old, 0, ids["quick"], "later quick")
    old.execute("INSERT INTO routines(member_id,title,prompt,schedule,created_at_ms) VALUES (0,'Raphael own','x','{}',1)")
    old.commit()
    migrate(old)
    assert old.execute("SELECT COUNT(*) FROM members WHERE name = 'Hikari'").fetchone()[0] == 1
    assert old.execute("SELECT member_id FROM agent_turns WHERE id=?", (again,)).fetchone()[0] == 0
    assert old.execute("SELECT COUNT(*) FROM routines WHERE member_id = 0").fetchone()[0] == 1


def test_a_slime_that_would_keep_raphaels_name_or_a_taken_one_gets_a_name_of_its_own(old):
    setting(old, "first_bot_profile", {"name": "拉斐爾", "personality": "Warm"})
    old.execute("INSERT INTO members(id,name,position,created_at_ms) VALUES (5,'Slime',0,1)")
    old.commit()
    migrate(old)
    names = [row[0] for row in old.execute("SELECT name FROM members ORDER BY id")]
    assert names == ["Slime", "Slime 2"] or (len(names) == 2 and "拉斐爾" not in names)


def test_a_database_made_before_it_is_the_only_one_that_needs_the_step(old):
    conn = db.connect(":memory:")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == db.LATEST_VERSION
    assert conn.execute("SELECT COUNT(*) FROM members").fetchone()[0] == 0
