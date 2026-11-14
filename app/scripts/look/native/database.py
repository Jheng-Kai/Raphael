"""Initialize only a new journey database; inspect the same database through read-only SQLite."""
import json
import sqlite3
import sys
from pathlib import Path

directory = Path(sys.argv[1]).resolve()
database = directory / "raphael.db"
operation = sys.argv[2]
if operation == "window-action":
    import ctypes
    import time
    from ctypes import wintypes as w

    user = ctypes.windll.user32
    user.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
    user.GetWindowTextW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]
    user.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
    user.IsWindowVisible.argtypes = user.IsIconic.argtypes = [w.HWND]
    pid, action = int(sys.argv[3]), sys.argv[4]
    commands = {"close": 0xF060, "minimize": 0xF020, "restore": 0xF120}
    if pid <= 0 or action not in (*commands, "state", "front"):
        raise ValueError("Expected an owned PID and close/minimize/restore/state/front")
    handles = []

    @ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    def visit(hwnd, _):
        owner = w.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        title = ctypes.create_unicode_buffer(512)
        user.GetWindowTextW(hwnd, title, len(title))
        if owner.value == pid and title.value == "Raphael":
            handles.append(hwnd)
        return True

    user.EnumWindows(visit, 0)
    if len(handles) != 1:
        raise RuntimeError(f"Expected one main window for owned PID {pid}, found {len(handles)}")
    hwnd = handles[0]
    user.GetForegroundWindow.restype = w.HWND
    if action == "front":
        # A dictation pastes into the window in front when its key is released: only the owned
        # window may be there. Windows hands the foreground over only from the thread that has it,
        # so this one joins that thread's input for the call. No key or click is sent.
        kernel = ctypes.windll.kernel32
        user.SetForegroundWindow.argtypes = user.BringWindowToTop.argtypes = [w.HWND]
        user.ShowWindow.argtypes = [w.HWND, ctypes.c_int]
        user.AttachThreadInput.argtypes = [w.DWORD, w.DWORD, w.BOOL]
        theirs = user.GetWindowThreadProcessId(user.GetForegroundWindow(), None)
        mine = kernel.GetCurrentThreadId()
        joined = theirs and theirs != mine and user.AttachThreadInput(mine, theirs, True)
        try:
            if user.IsIconic(hwnd):
                user.ShowWindow(hwnd, 9)  # SW_RESTORE
            user.BringWindowToTop(hwnd)
            user.SetForegroundWindow(hwnd)
        finally:
            if joined:
                user.AttachThreadInput(mine, theirs, False)
        deadline = time.monotonic() + 3
        while user.GetForegroundWindow() != hwnd and time.monotonic() < deadline:
            time.sleep(0.05)
        print(json.dumps({"hwnd": hwnd, "pid": pid, "action": action,
                          "front": user.GetForegroundWindow() == hwnd}))
        sys.exit(0)
    if action != "state" and not user.PostMessageW(hwnd, 0x0112, commands[action], 0):
        raise ctypes.WinError()
    deadline = time.monotonic() + 3
    while True:
        visible, minimized = bool(user.IsWindowVisible(hwnd)), bool(user.IsIconic(hwnd))
        reached = action == "state" or (not visible if action == "close" else
                                       minimized if action == "minimize" else visible and not minimized)
        if reached:
            print(json.dumps({"hwnd": hwnd, "pid": pid, "action": action,
                              "visible": visible, "minimized": minimized,
                              "front": user.GetForegroundWindow() == hwnd}))
            break
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Owned main window did not {action}")
        time.sleep(0.05)
elif operation == "windows":
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
        windows.append({"title": title.value, "style": user.GetWindowLongW(hwnd, -20), "frame": user.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF,
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
elif operation == "computer-speed":
    import asyncio
    from raphael_core.native_journeys import computer_speed
    result = asyncio.run(computer_speed(directory))
    print(json.dumps(result))
    if not result["passed"]:
        sys.exit(1)
elif operation == "vm-image":
    import asyncio
    from raphael_core.native_journeys import vm_image
    print(json.dumps(asyncio.run(vm_image(directory))))
elif operation == "vm-windows":
    import asyncio
    from raphael_core.native_journeys import vm_windows
    print(json.dumps(asyncio.run(vm_windows(directory))))
elif operation == "vm-stop":
    import asyncio
    from raphael_core.native_journeys import vm_cleanup
    asyncio.run(vm_cleanup(directory))
    print("{}")
elif operation == "vm-signin":
    from raphael_core.native_journeys import vm_signin_fixture
    vm_signin_fixture(directory, int(sys.argv[3]))
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
    if len(sys.argv) > 3 and sys.argv[3] == "startup-rooms":
        from raphael_core.members.store import MemberStore
        store = MemberStore(connection)
        people = [store.create_member(name=name, role="Startup fixture").id for name in ("Startup Alice", "Startup Bob")]
        with connection:
            for index in range(1, 4):
                room = connection.execute("INSERT INTO rooms(name, created, is_team) VALUES (?, ?, 0)",
                                          (f"Startup room {index}", index)).lastrowid
                connection.executemany("INSERT INTO room_members(room_id, member_id) VALUES (?, ?)",
                                       [(room, member) for member in people])
    voice = len(sys.argv) > 3 and sys.argv[3] in ("voice-conversation", "voice-keys")
    settings = {"stt_engine": "local" if voice else "cloud", "stt_local_model": "qwen3-asr" if voice else None,
                "first_bot_profile": {"name": "Raphael", "personality": "Calm", "instructions": "Help with the current request."}}
    if len(sys.argv) > 3 and sys.argv[3] == "gmail-connect":
        from raphael_core.native_journeys import native_codex_model
        settings["agent_model"] = native_codex_model()
    if len(sys.argv) > 3 and sys.argv[3] == "shared-computer":
        # Two members that already have a job: a new member's greeting and set-up card are member-job's subject,
        # and on a real model they are one more thing that can go another way.
        from raphael_core.members.store import MemberStore
        for name in ("NativeSeatA", "NativeSeatB"):
            MemberStore(connection).create_member(name=name, role="Computer jobs", instructions="Do the small job asked, on your own computer: files, commands and web pages.")
        # A third on the scripted brain (the journey gives the other two the real Codex): what it does is fixed, so
        # that what is watched is the owner taking its seat.
        from raphael_core.brain.settings import DEFAULTS
        MemberStore(connection).create_member(name="NativeSeatC", role="Computer jobs", model=DEFAULTS["agent_model"],
                                              instructions="Do the small job asked, on your own computer: files, commands and web pages.")
    if len(sys.argv) > 3 and sys.argv[3] == "member-computer":
        # This journey is the computer-per-member mode's: its smoke uses that mode's own tool forms.
        settings["computer_vm_mode"] = "per-bot"
    if len(sys.argv) > 3 and sys.argv[3] == "dictation-dictionary":
        # The owner's dictation as he has it set: MAI-Transcribe 2 in the cloud, Taiwan Chinese,
        # his cleanup model. His dictionary holds 「grokbot」; 「herdr」 is the word he corrects.
        # The corrected message reaches a real model: it may only plan, every step asks first (nobody
        # answers), and the journey stops the turn once the correction is learned.
        settings.update({"stt_engine": "cloud", "stt_cloud_model": "microsoft/mai-transcribe-2",
                         "languages": ["zh-TW"], "cleanup_model": "~deepseek/deepseek-v4-flash-latest",
                         "action_mode": "plan"})
        from raphael_core.brain.dictionary import DictionaryStore
        DictionaryStore(connection).add("grokbot")
    with connection:
        for key, value in settings.items():
            connection.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", (key, json.dumps(value)))
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
        member = MemberStore(connection).create_member(name="Alice", role="Reviewer", model="cli:codex")
        seed = directory / "migration-copy"
        for relative, name, text in (("memory", "reference-project", "Project review"),
                                     ("memory/shared", "user-profile", "The owner speaks English"),
                                     (f"memory/members/{member.id}", "reference-private-review", "private-review")):
            # A note as the store before the living files wrote it: the app moves it into them at its start.
            note = seed / relative / f"{name}.md"
            note.parent.mkdir(parents=True, exist_ok=True)
            note.write_text(f'---\nname: {name}\ndescription: "{text}"\ntype: {name.split("-")[0]}\ncreated: 2026-10-01T10:00:00+08:00\nupdated: 2026-10-01T10:00:00+08:00\norigin: said\nturns: []\n---\n{text}\n', encoding="utf-8")
        skill = "---\nname: Review\ndescription: Review work\n---\nRead carefully.\n"
        with connection:
            identifier = connection.execute("INSERT INTO member_skills(member_id,name,description,source) VALUES (?, 'Review', 'Review work', 'owner')", (member.id,)).lastrowid
        path = seed / "member-skills" / str(member.id) / f"{identifier}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(skill, encoding="utf-8")
        for name in ("memory", "member-skills"):
            shutil.copytree(seed / name, directory / name)
    if len(sys.argv) > 3 and sys.argv[3] == "typing":
        from raphael_core.agent.history import AgentHistory
        from raphael_core.agent.steps import Step
        from raphael_core.members.store import MemberStore

        people = [MemberStore(connection).create_member(name=f"Typing {index}", role="離線檢閱員") for index in range(8)]
        history = AgentHistory(connection)
        for index in range(150):
            text = f"檢閱紀錄 {index}：量測結果已保留，可隨時回頭查閱。\n\n| 項目 | 結果 |\n| --- | --- |\n| 草稿 | 已保留 |\n\n```python\nresult = {index}\nprint(result)\n```"
            turn_id = history.add(session_id=f"native-typing-{index}", member_id=people[0].id,
                                  question=f"{'@Typing 1 ' if index % 3 == 0 else ''}請檢閱第 {index} 筆紀錄。", route="answer", prefix="", text=text,
                                  status="done", source="app", model="fake/echo",
                                  steps=[Step("tool", "local_time", "builtin", "ok", 5)])
            history.add_message(turn_id, "reply", text)
    if len(sys.argv) > 3 and sys.argv[3] == "rich-content":
        from raphael_core.agent.history import AgentHistory

        fixture = json.loads((Path(__file__).resolve().parent.parent / "fixture.json").read_text(encoding="utf-8"))
        AgentHistory(connection).add(
            session_id="native-rich-content", question="Review the research summary.", route="answer",
            prefix="", text=fixture["richContent"]["reply"], status="done", source="app",
        )
    if len(sys.argv) > 3 and sys.argv[3] == "pages":
        from raphael_core.agent.history import AgentHistory
        from raphael_core.agent.pages import PageStore

        fixture = json.loads((Path(__file__).resolve().parent.parent / "fixture.json").read_text(encoding="utf-8"))
        turn_id = AgentHistory(connection).add(
            session_id="native-pages", question="Show me the shoe.", route="answer",
            prefix="", text="Here it is.", status="done", source="app",
        )
        turn = connection.execute("SELECT member_id, conversation_id FROM agent_turns WHERE id=?", (turn_id,)).fetchone()
        PageStore(connection).write(turn_id=turn_id, member_id=turn[0], conversation_id=turn[1],
                                    title="Trail shoe", html=fixture["nativePage"], fallback_text="A trail shoe.")
    connection.close()
    print("{}")
else:
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    if operation == "homes":
        paths = ("bots/0/MEMORY.md", "shared/USER.md", "bots/1/MEMORY.md", "bots/1/skills/1/SKILL.md")
        import hashlib
        files = {name: (directory / name).read_text(encoding="utf-8") for name in paths}
        manifest = json.loads((directory / "bot-state/migration.json").read_text(encoding="utf-8"))
        verified = all(hashlib.sha256((directory / item["to"]).read_bytes()).hexdigest() == item["sha256"] for item in manifest["files"] if item["to"].endswith("SKILL.md")) and "Project review" in files["bots/0/MEMORY.md"] and "The owner speaks English" in files["shared/USER.md"] and "private-review" in files["bots/1/MEMORY.md"]
        receipt = directory / "native-cli/receipt.json"
        print(json.dumps({"files": files, "verified": verified, "receipt": json.loads(receipt.read_text()) if receipt.exists() else None}))
    elif operation == "memory-home":
        member_id = int(sys.argv[3])
        relative = f"bots/{member_id}/MEMORY.md"
        path = directory / relative
        others = [str(found.relative_to(directory)) for found in directory.glob("bots/*/MEMORY.md") if found != path and "heliotrope" in found.read_text(encoding="utf-8")]
        if (directory / "shared/USER.md").exists() and "heliotrope" in (directory / "shared/USER.md").read_text(encoding="utf-8"):
            others.append("shared/USER.md")
        print(json.dumps({"path": relative, "exists": path.exists(), "body": path.read_text(encoding="utf-8") if path.exists() else "", "otherHomes": others}))
    elif operation == "snapshot":
        tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        result = {}
        for table in tables:
            columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
            if table in {"calendar_events", "conversations", "members", "worker_tasks", "rooms", "room_messages", "room_exchanges", "agent_steps", "tool_audit", "dictionary", "dictionary_evidence", "computer_seats"} or "conversation_id" in columns:
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
