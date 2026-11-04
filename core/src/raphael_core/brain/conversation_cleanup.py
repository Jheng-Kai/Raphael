"""Conversation ownership for delivered exchanges and removal of ambiguous legacy rows."""

import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript("""
BEGIN;
DROP TRIGGER scoped_turn_insert;
DROP TRIGGER scoped_turn_update;
CREATE TRIGGER clear_delivered_turn AFTER DELETE ON agent_turns BEGIN
  UPDATE worker_tasks SET turn_id=NULL WHERE turn_id=OLD.id;
  UPDATE agent_turns SET source_turn_id=NULL WHERE source_turn_id=OLD.id;
  DELETE FROM agent_messages WHERE turn_id=OLD.id;
  DELETE FROM agent_steps WHERE turn_id=OLD.id;
  DELETE FROM agent_turns_fts WHERE rowid=OLD.id;
  DELETE FROM connect_cards WHERE turn_id=OLD.id;
END;
CREATE TRIGGER clear_conversation BEFORE DELETE ON conversations BEGIN
  DELETE FROM agent_turns WHERE conversation_id=OLD.id AND scope IN ('private','exchange');
  DELETE FROM conversation_context_summaries WHERE conversation_id=OLD.id;
  DELETE FROM agent_conversation_cli_sessions WHERE conversation_id=OLD.id;
END;
CREATE TRIGGER clear_member_deliveries BEFORE DELETE ON members BEGIN
  DELETE FROM agent_turns WHERE scope!='room' AND (member_id=OLD.id OR peer_id=OLD.id);
  DELETE FROM conversation_summaries WHERE member_id=OLD.id;
END;
-- A lost delivery ID cannot be inferred from the current default conversation. Drop those
-- ambiguous exchanges/quarantine records, and all non-room rows of removed members.
DELETE FROM agent_turns WHERE scope!='room' AND (
  (member_id!=0 AND NOT EXISTS(SELECT 1 FROM members WHERE id=agent_turns.member_id)) OR
  (peer_id IS NOT NULL AND peer_id!=0 AND NOT EXISTS(SELECT 1 FROM members WHERE id=agent_turns.peer_id)) OR
  (scope IN ('exchange','quarantine') AND conversation_id IS NULL));
UPDATE agent_turns SET conversation_id=(SELECT id FROM conversations
  WHERE member_id=agent_turns.member_id AND is_default=1)
  WHERE scope='private' AND conversation_id IS NULL;
DELETE FROM agent_turns WHERE scope='private' AND conversation_id IS NULL;
DELETE FROM conversations WHERE member_id!=0 AND NOT EXISTS(SELECT 1 FROM members WHERE id=conversations.member_id);
DELETE FROM conversation_summaries WHERE member_id!=0 AND NOT EXISTS(SELECT 1 FROM members WHERE id=conversation_summaries.member_id);
CREATE TRIGGER scoped_turn_insert BEFORE INSERT ON agent_turns
WHEN (NEW.scope='room' AND (NEW.conversation_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM room_threads WHERE id=NEW.thread_id AND room_id=NEW.room_id)))
OR (NEW.scope='quarantine' AND NEW.conversation_id IS NOT NULL)
OR (NEW.scope IN ('private','exchange') AND (NEW.room_id IS NOT NULL OR NEW.thread_id IS NOT NULL OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND member_id=NEW.member_id))))
OR (NEW.scope='exchange' AND NEW.conversation_id IS NULL)
OR (NEW.scope='private' AND (NEW.source IN ('room','member') OR NEW.route IN ('room','exchange')))
BEGIN SELECT RAISE(ABORT,'invalid turn scope'); END;
CREATE TRIGGER scoped_turn_update BEFORE UPDATE OF scope,room_id,thread_id,conversation_id,source,route ON agent_turns
WHEN (NEW.scope='room' AND (NEW.conversation_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM room_threads WHERE id=NEW.thread_id AND room_id=NEW.room_id)))
OR (NEW.scope='quarantine' AND NEW.conversation_id IS NOT NULL)
OR (NEW.scope IN ('private','exchange') AND (NEW.room_id IS NOT NULL OR NEW.thread_id IS NOT NULL OR (NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND member_id=NEW.member_id))))
OR (NEW.scope='exchange' AND NEW.conversation_id IS NULL)
OR (NEW.scope='private' AND (NEW.source IN ('room','member') OR NEW.route IN ('room','exchange')))
BEGIN SELECT RAISE(ABORT,'invalid turn scope'); END;
PRAGMA user_version=40;
COMMIT;
""")
