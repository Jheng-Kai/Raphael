"""Initialize only a new journey database; inspect the same database through read-only SQLite."""
import json
import sqlite3
import sys
from pathlib import Path

directory = Path(sys.argv[1]).resolve()
database = directory / "raphael.db"
operation = sys.argv[2]
if operation == "init":
    from raphael_core.brain.db import connect

    if database.exists():
        raise RuntimeError("Refusing to initialize an existing database")
    directory.mkdir(parents=True, exist_ok=True)
    connection = connect(database)
    from raphael_core.agent.conversations import Conversations

    # The persisted quick thread is lazy in production. Seed the prerequisite through its store,
    # then drive all new conversations, turns and deletions from the real UI.
    Conversations(connection).main()
    Conversations(connection).quick()
    voice = len(sys.argv) > 3 and sys.argv[3] == "voice-conversation"
    settings = {"stt_engine": "local" if voice else "cloud", "stt_local_model": "qwen3-asr" if voice else None,
                "tts_enabled": False, "first_bot_profile": {"name": "Raphael", "personality": "Calm", "instructions": "Help with the current request."}}
    if len(sys.argv) > 3 and sys.argv[3] == "gmail-connect":
        from raphael_core.native_journeys import native_codex_model
        settings["agent_model"] = native_codex_model()
    with connection:
        for key, value in settings.items():
            connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", (key, json.dumps(value)))
    connection.close()
    print("{}")
else:
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    if operation == "snapshot":
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        result = {}
        for table in tables:
            columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
            if table in {"conversations", "members", "rooms", "room_messages", "room_exchanges", "agent_steps"} or "conversation_id" in columns:
                result[table] = [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]
        print(json.dumps(result, ensure_ascii=False))
    elif operation == "thread":
        from raphael_core.agent.history import _COLUMNS, _thread

        member_id, conversation_id = map(int, sys.argv[3:5])
        main = connection.execute("SELECT id FROM conversations WHERE member_id=? AND is_default=1", (member_id,)).fetchone()
        where, params = _thread(member_id, conversation_id, bool(main and main[0] == conversation_id))
        sql = f"SELECT {_COLUMNS} FROM agent_turns WHERE {where} ORDER BY id DESC LIMIT ?"
        params.append(200)
        print(json.dumps({"sql": sql, "params": params, "rows": [dict(row) for row in connection.execute(sql, params)]}, ensure_ascii=False))
    else:
        raise RuntimeError("Unknown database operation")
    connection.close()
