"""Initialize only a new journey database; inspect the same database through read-only SQLite."""
import json
import sqlite3
import sys
from pathlib import Path

directory = Path(sys.argv[1]).resolve()
database = directory / "raphael.db"
operation = sys.argv[2]
if operation == "windows":
    import ctypes
    from ctypes import wintypes as w
    user, gdi = ctypes.windll.user32, ctypes.windll.gdi32
    user.GetForegroundWindow.restype = w.HWND
    user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
    user.GetWindowLongW.argtypes = [w.HWND, ctypes.c_int]
    user.GetWindowRect.argtypes = [w.HWND, ctypes.POINTER(w.RECT)]
    user.GetWindowRgn.argtypes = [w.HWND, w.HANDLE]
    user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
    gdi.CreateRectRgn.restype = w.HANDLE
    gdi.PtInRegion.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_int]
    gdi.DeleteObject.argtypes = [w.HANDLE]
    class MonitorInfo(ctypes.Structure):
        _fields_ = [("cbSize", w.DWORD), ("monitor", w.RECT), ("work", w.RECT), ("flags", w.DWORD)]
    user.MonitorFromWindow.argtypes = [w.HWND, w.DWORD]
    user.MonitorFromWindow.restype = w.HANDLE
    user.GetMonitorInfoW.argtypes = [w.HANDLE, ctypes.POINTER(MonitorInfo)]
    monitor = MonitorInfo()
    monitor.cbSize = ctypes.sizeof(monitor)
    user.GetMonitorInfoW(user.MonitorFromWindow(user.GetForegroundWindow(), 2), ctypes.byref(monitor))
    windows = []
    @ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    def visit(hwnd, _):
        pid = w.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != int(sys.argv[3]):
            return True
        title = ctypes.create_unicode_buffer(512)
        user.GetWindowTextW(hwnd, title, len(title))
        rect = w.RECT()
        user.GetWindowRect(hwnd, ctypes.byref(rect))
        region = gdi.CreateRectRgn(0, 0, 0, 0)
        shape = user.GetWindowRgn(hwnd, region)
        windows.append({"title": title.value, "style": user.GetWindowLongW(hwnd, -20),
                        "rect": [rect.left, rect.top, rect.right, rect.bottom],
                        "rounded": bool(shape and not gdi.PtInRegion(region, 0, 0) and gdi.PtInRegion(region, (rect.right-rect.left)//2, (rect.bottom-rect.top)//2))})
        gdi.DeleteObject(region)
        return True
    user.EnumWindows(visit, 0)
    print(json.dumps({"foreground": user.GetForegroundWindow(), "workArea": [monitor.work.left, monitor.work.top, monitor.work.right, monitor.work.bottom], "windows": windows}))
elif operation == "voice-models":
    from raphael_core.device.models import REGISTRY

    root = Path(sys.argv[3]).resolve()
    missing = []
    for name in ("qwen3-asr", "silero-vad"):
        folder = root / name
        files = [file for file in REGISTRY[name].files if not (folder / file).is_file()]
        if files:
            missing.append({"name": name, "folder": str(folder), "files": files})
    print(json.dumps({"missing": missing}))
elif operation == "vm-smoke":
    import asyncio
    from raphael_core.native_journeys import vm_smoke
    print(json.dumps(asyncio.run(vm_smoke(directory))))
elif operation == "vm-stop":
    import asyncio
    from raphael_core.computer.vm import LocalVm
    vm = LocalVm(directory)
    asyncio.run(vm.stop(vm.target()))
    print("{}")
elif operation == "vm-offset":
    import asyncio
    from raphael_core.native_journeys import vm_timezone_smoke
    print(json.dumps(asyncio.run(vm_timezone_smoke(directory))))
elif operation == "init":
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
    if len(sys.argv) > 3 and sys.argv[3] == "home-timing":
        from raphael_core.agent.quota import Quotas
        Quotas(connection).record("codex", {"windows": [{"period": "fiveHour", "remaining_percent": 75,
            "resets_at": 2000000000, "status": "allowed"}], "exhausted": False})
    if len(sys.argv) > 3 and sys.argv[3] == "model-picker":
        import os
        import time
        from raphael_core.brain.catalog import parse_catalog
        from raphael_core.brain.pricing import CACHE_KEY, _Snapshot, _encode
        catalog = json.loads(Path(os.environ["RAPHAEL_NATIVE_MODEL_CATALOG"]).read_text(encoding="utf-8"))
        entries = parse_catalog(catalog["data"])
        if not entries:
            raise RuntimeError("The recorded public model list is empty")
        with connection:
            connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)",
                               (CACHE_KEY, _encode(_Snapshot(int(time.time() * 1000), tuple(entries)))))
    if len(sys.argv) > 3 and sys.argv[3] == "bot-homes":
        import shutil
        from raphael_core.members.store import MemberStore
        from raphael_core.memory.store import MemoryStore
        member = MemberStore(connection).create_member(name="Alice", role="Reviewer", model="cli:codex")
        seed = directory / "migration-copy"
        for relative, name, text in (("memory", "reference-project", "Project review"),
                                     ("memory/shared", "user-profile", "The owner speaks English"),
                                     (f"memory/members/{member.id}", "reference-private-review", "private-review")):
            MemoryStore(seed / relative).write(name, type=name.split("-")[0], description=text, body=text)
        skill = "---\nname: Review\ndescription: Review work\n---\nRead carefully.\n"
        with connection:
            identifier = connection.execute("INSERT INTO member_skills(member_id,name,description,source) VALUES (?, 'Review', 'Review work', 'owner')", (member.id,)).lastrowid
        path = seed / "member-skills" / str(member.id) / f"{identifier}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(skill, encoding="utf-8")
        for name in ("memory", "member-skills"):
            shutil.copytree(seed / name, directory / name)
    connection.close()
    print("{}")
else:
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    if operation == "homes":
        paths = ("bots/0/memory/reference-project.md", "shared/memory/user-profile.md", "bots/1/memory/reference-private-review.md", "bots/1/skills/1/SKILL.md")
        import hashlib
        files = {name: (directory / name).read_text(encoding="utf-8") for name in paths}
        manifest = json.loads((directory / "bot-state/migration.json").read_text(encoding="utf-8"))
        verified = all(hashlib.sha256((directory / item["to"]).read_bytes()).hexdigest() == item["sha256"] for item in manifest["files"] if not item["to"].endswith("MEMORY.md"))
        receipt = directory / "native-cli/receipt.json"
        print(json.dumps({"files": files, "verified": verified, "receipt": json.loads(receipt.read_text()) if receipt.exists() else None}))
    elif operation == "memory-home":
        member_id = int(sys.argv[3])
        relative = f"bots/{member_id}/memory/reference-project-colour.md"
        path = directory / relative
        others = [str(found.relative_to(directory)) for found in directory.glob("bots/*/memory/reference-project-colour.md") if found != path]
        if (directory / "shared/memory/reference-project-colour.md").exists():
            others.append("shared/memory/reference-project-colour.md")
        print(json.dumps({"path": relative, "exists": path.exists(), "body": path.read_text(encoding="utf-8") if path.exists() else "", "otherHomes": others}))
    elif operation == "snapshot":
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        result = {}
        for table in tables:
            columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
            if table in {"conversations", "members", "rooms", "room_messages", "room_exchanges", "agent_steps", "tool_audit", "dictionary", "dictionary_evidence"} or "conversation_id" in columns:
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
