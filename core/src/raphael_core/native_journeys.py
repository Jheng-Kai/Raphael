"""Opt-in native diagnostics: only Composio may read an existing credential; writes stay in memory."""
import asyncio
import os
import re
import json
import tomllib
import sys
from datetime import datetime
from pathlib import Path

from .connectors.composio import KEY
from .integrations.vault import CredentialVault, MemoryVault
from .device.models import ModelManager, ModelDownloadError


async def vm_smoke(directory):
    """Existing native runner's Docker journey: fake brain, real tools and engine."""
    import base64
    from .brain.db import connect
    from .brain.settings import SettingsStore
    from .agent.gate import ToolGate
    from .agent.policy import Tier
    from .background.snapshot import take_snapshot
    from .computer.vm import LocalVm, VmError
    from .computer.vm_tools import VmTools
    from .services.attachment_store import AttachmentStore
    from .worker.loop import Call, Turn, ToolOutcome, run_task

    if not native_enabled(True):
        raise RuntimeError("VM smoke requires RAPHAEL_TEST_NATIVE=1 and the native runner")

    class EmptyHub:
        def offered(self): return []
        def tier_of(self, key): return None
        def kind_of(self, server, name): return None
        def record_unrun(self, *args, **kwargs): pass

    directory = Path(directory)
    conn = connect(directory / "raphael.db")
    vm = LocalVm(directory, settings=SettingsStore(conn))
    docker_commands = []
    run = vm.run

    async def record_run(args, **kwargs):
        docker_commands.append(args[0])
        return await run(args, **kwargs)

    vm.run = record_run
    preparation = {"states": [], "last_build_progress": ""}
    progress = vm._progress

    def record_progress(target, state, text=""):
        progress(target, state, text)
        if state not in preparation["states"]:
            preparation["states"].append(state)
        if state == "building" and text:
            preparation["last_build_progress"] = vm.preparation[target.key]["progress"]

    vm._progress = record_progress
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(directory), conn=conn)
    try:
        await hub.prepare()
        assert not docker_commands, "Preparing a turn must not invoke Docker"
        snapshot = take_snapshot(hub)
        # This journey's data folder asks for a computer per member (database.py init): its calls are that mode's.
        shot = next((name for name in snapshot.refs if name == "computer__get_desktop_state"), None)
        if not shot:
            raise VmError("Desktop tool discovery failed: " + str(hub.problem or "unavailable"))
        gate, completed = ToolGate(hub, conn=conn), []
        calls = [(shot, {}), ("computer__click", {"x": 640, "y": 480, "scope": "desktop"}), (shot, {}),
                 ("computer__vm_exec", {"command": "printf 'Raphael VM smoke\\n' > raphael-smoke.txt; cat raphael-smoke.txt"}),
                 ("computer__attach_file", {"path": "/home/cua/workspace/raphael-smoke.txt"})]

        class FakeBrain:
            async def chat(self, messages, tools):
                if len(completed) == len(calls):
                    return Turn("Done")
                name, args = calls[len(completed)]
                return Turn("Checking the desktop.", [Call(str(len(completed)), name, args, json.dumps(args))])

            async def tool(self, identifier, name, arguments):
                ref = snapshot.refs[name]
                assert gate.tier(ref.key) == Tier.T0 and not gate.needs_confirmation(ref.key)
                result = await gate.call_plugin(ref.key, arguments)
                assert result.ok, f"{name}: {result.kind}"
                if name == shot:
                    image = next(block for block in result.blocks if block["type"] == "image")
                    assert image["mimeType"] == "image/png", "Expected a PNG screenshot"
                    data = base64.b64decode(image["data"], validate=True)
                    assert data.startswith(b"\x89PNG\r\n\x1a\n") and data.endswith(b"IEND\xaeB`\x82")
                    (directory.parent / "vm-tool-screenshot.png").write_bytes(data)
                elif name == "computer__vm_exec":
                    assert "Raphael VM smoke" in json.loads(result.text)["output"]
                elif name == "computer__attach_file":
                    attachment = json.loads(result.text)["attachment"]
                    assert hub.attachments.path(attachment["id"]).read_bytes() == b"Raphael VM smoke\n"
                completed.append(name)
                changed = snapshot.refresh_computer(hub, 0)
                if name == shot:
                    assert "computer__click" in snapshot.refs, "Desktop click tool discovery failed"
                return ToolOutcome(True, content=result.text, blocks=result.blocks,
                                   tools=list(snapshot.definitions) if changed else [], replace_tools=changed)

        outcome = await run_task(FakeBrain(), system="Deterministic fake brain; use only the specified test tools.", user="Test the optional desktop", tools=snapshot.definitions)
        assert outcome.status == "done" and completed == [name for name, _ in calls]
        page_tools = await _page_tools(snapshot, gate)
        before = len(docker_commands)
        await hub.prepare()
        assert len(docker_commands) == before, "The next turn must reuse the catalog without Docker"
        target = vm.target()
        vm_signin_fixture(directory, 0)
        vm.hold(target, True)
        refused = []
        for name, arguments in calls:
            assert (await gate.call_plugin(snapshot.refs[name].key, arguments)).kind == "owner_holds_control", name
            refused.append(name)
        vm.hold(target, False)
        state = await vm.status(target)
        assert state["ready"] and state["viewer_url"]
        state.pop("viewer_url", None)
        return {"state": state, "completed": completed, "brain": "fake", "paid_requests": 0,
                "prepare_docker_commands": 0, "next_turn_docker_commands": 0,
                "without_approval": completed, "owner_held_refused": refused,
                "control_gate": "refused while held", "attachment_id": attachment_id(hub.attachments), "page_tools": page_tools,
                "preparation": preparation}
    finally:
        await vm.aclose(stop=False)
        conn.close()


async def _page_tools(snapshot, gate):
    """A page opens and takes real gestures, through the tools as a member has them."""
    page = ("<!doctype html><title>page</title><canvas id=c width=800 height=400 style='display:block'></canvas><script>"
            "let d=0,m=0;c.onpointerdown=e=>{d=1;c.setPointerCapture(e.pointerId)};c.onpointermove=e=>{if(d)m++};"
            "c.onpointerup=()=>{d=0;document.title='dragged '+m}</script>")

    async def use(name, **arguments):
        result = await gate.call_plugin(snapshot.refs["computer__" + name].key, arguments)
        assert result.ok, f"{name}: {result.kind} {str(result.text)[:300]}"
        return result.text

    def structured(text):
        return json.loads(text.split("\n", 1)[1])

    async def chromium():
        return re.search(r'window_id=(\d+) pid=(\d+) "([^"]*)"[^\n]*app=Chromium', await use("list_windows"))

    await use("vm_exec", command=f"mkdir -p page && cat > page/index.html <<'EOF'\n{page}\nEOF\ncd page && (nohup python3 -m http.server 8766 >/dev/null 2>&1 &)")
    prepared = await use("browser_prepare", allow_launch=True, profile={"mode": "isolated_named", "name": "main"})
    assert "endpoint available" in prepared, prepared[:300]
    await asyncio.sleep(3)
    window = await chromium()
    assert window, "The browser browser_prepare opened has no window"
    bound = structured(await use("get_browser_state", pid=int(window[2]), window_id=int(window[1])))
    place = {"target_id": bound["target_id"], "tab_id": bound["tabs"][0]["tab_id"]}
    await use("browser_navigate", **place, url="http://127.0.0.1:8766/")
    await asyncio.sleep(1)
    seen = structured(await use("get_browser_state", **place, snapshot_format="semantic_v2"))
    assert seen["page"]["title"] == "page", seen["page"]
    await use("browser_pointer", **place, action="drag", x=200, y=200, to_x=500, to_y=300)
    await asyncio.sleep(1)
    window = await chromium()
    assert window and window[3].startswith("dragged"), window and window[3]
    # A desktop gesture finds the screenshot read the call before.
    await use("get_window_state", pid=int(window[2]), window_id=int(window[1]))
    await use("drag", pid=int(window[2]), window_id=int(window[1]), from_x=300, from_y=300, to_x=500, to_y=400)
    return {"page_title": window[3]}


def vm_signin_fixture(directory, member_id):
    """Seed only the isolated journey member's own workspace, without starting Docker."""
    import shutil
    from .computer.vm import LocalVm
    if not native_enabled(True):
        raise RuntimeError("VM sign-in fixture requires the native runner")
    workspace = LocalVm(directory).target(member_id).workspace
    workspace.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).parent / "evaluate/signin_fixture.py", workspace / "native-signin.py")


async def vm_image(directory):
    """Make the computer image before the app starts, so a member's first turn does not wait for a build."""
    from .computer.vm import LocalVm
    if not native_enabled(True):
        raise RuntimeError("VM image requires the native runner")
    vm = LocalVm(directory)
    try:
        target = vm.target()
        await vm.ensure_engine(target)
        built = not await vm.image(target)
        if built:
            await vm.build(target)
        return {"built": built}
    finally:
        await vm.aclose(stop=False)


async def vm_windows(directory):
    """Every window of this journey's shared computer, as the window manager lists it (id, class, geometry)."""
    from .brain.db import connect
    from .brain.settings import SettingsStore
    from .computer.vm import LocalVm, exec_args
    if not native_enabled(True):
        raise RuntimeError("VM windows requires the native runner")
    conn = connect(Path(directory) / "raphael.db")
    vm = LocalVm(directory, settings=SettingsStore(conn), conn=conn)
    try:
        target = vm.shared_target(vm.remote, 0, 1)
        rows = []
        for flags in ("-lG", "-lx"):
            listed = await vm.run_for(target, exec_args(target, ["wmctrl", flags]), timeout=15)
            rows.append(listed.stdout.splitlines() if not listed.code else [f"exit {listed.code}: {listed.stderr[:200]}"])
        return {"geometry": rows[0], "classes": rows[1]}
    finally:
        await vm.aclose(stop=False)
        conn.close()


async def vm_cleanup(directory):
    """Remove all containers owned by this isolated journey data directory."""
    from .computer.vm import LocalVm
    if not native_enabled(True):
        raise RuntimeError("VM cleanup requires the native runner")
    vm = LocalVm(directory)
    try:
        await vm.recover()
        for target in list(vm.targets.values()):
            await vm.stop(target, remove=True)
    finally:
        await vm.aclose()


def computer_speed_summary(samples):
    from statistics import median
    if len(samples) != 5:
        raise ValueError("Computer speed requires exactly five runs")
    budgets = {"first_observation": 8, "browser_open": 6, "run_steps": None}
    return {name: {"median_seconds": median(row[name] for row in samples),
        "worst_seconds": max(row[name] for row in samples), "budget_seconds": budget,
        "passed": all(row[name] < budget for row in samples) if budget else None}
        for name, budget in budgets.items()}


async def computer_speed(directory):
    """Opt-in measurement, never implicit in smoke/verify. Own name, root and exact cleanup."""
    import base64
    import secrets
    import time
    from .agent.gate import ToolGate
    from .computer.vm import LocalVm, VmError
    from .computer.vm_tools import VmTools
    from .services.attachment_store import AttachmentStore

    if not native_enabled(True):
        raise RuntimeError("Computer speed requires the isolated native runner")
    class EmptyHub:
        def offered(self): return []
        def tier_of(self, key): return None
        def kind_of(self, server, name): return None
        def record_unrun(self, *args, **kwargs): pass

    root = Path(directory) / ("computer-speed-" + secrets.token_hex(12))
    root.mkdir(parents=True, exist_ok=False)
    vm = LocalVm(root)
    # Measurement cannot start Docker Desktop, build/pull an image or recover other containers.
    vm.desktop = None
    target = vm.target(0)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(root))
    gate = ToolGate(hub)
    samples, cleanup, owned_target = [], False, False

    async def use(name, args):
        from .agent.plugins import tool_key
        result = await gate.call_plugin(tool_key(f"computer-{target.key}", name), args)
        if not result.ok:
            raise VmError(f"speed_{name}_{result.kind}")
        return result

    def page(text):
        return json.loads(text.splitlines()[-1])

    def fields(value, found):
        if isinstance(value, dict):
            name = value.get("name", value.get("label", ""))
            if value.get("role") == "textbox" and name in [f"Field {i}" for i in range(1, 6)] and isinstance(value.get("ref"), str):
                found[name] = value["ref"]
            for child in value.values(): fields(child, found)
        elif isinstance(value, list):
            for child in value: fields(child, found)

    try:
        if not await vm.available(target) or not await vm.image(target):
            raise VmError("speed_requires_running_docker_and_prepared_image")
        if await vm.inspect(target) is not None:
            raise VmError("speed_name_collision")
        owned_target = True
        await hub.prepare()
        await vm.start(target)
        html = '<!doctype html><title>Computer speed</title>' + ''.join(
            f'<label>Field {i}<input aria-label="Field {i}"></label>' for i in range(1, 6))
        encoded = base64.b64encode(html.encode()).decode()
        await vm.execute(target, f"printf %s {encoded} | base64 -d > form.html")
        await vm.execute(target, "python3 -m http.server 8765 --bind 127.0.0.1", background=True)
        for number in range(5):
            began = time.monotonic()
            windows = await use("list_windows", {})
            match = re.search(r"window_id=(\d+) pid=(\d+)", windows.text)
            if not match:
                raise VmError("speed_window_missing")
            window = {"window_id": int(match[1]), "pid": int(match[2])}
            await use("get_window_state", {**window, "max_elements": 200, "include_screenshot": False})
            observation_s = time.monotonic() - began
            began = time.monotonic()
            opened = await use("browser_open", {"url": "http://127.0.0.1:8765/form.html"})
            browser_s = time.monotonic() - began
            state = page(opened.text)
            tab = {"target_id": state["target_id"], "tab_id": state.get("tab_id") or next(tab["tab_id"] for tab in state["tabs"] if tab.get("active"))}
            refs = {}
            fields(state, refs)
            if len(refs) != 5:
                raise VmError("speed_form_refs_missing")
            steps = [{"name": "browser_type", "arguments": {**tab, "ref": refs[f"Field {i}"], "text": f"run{number}-value{i}"}} for i in range(1, 6)]
            began = time.monotonic()
            final = await use("run_steps", {"steps": steps, "observation": {"name": "get_browser_state", "arguments": {**tab, "include_screenshot": False}}})
            steps_s = time.monotonic() - began
            if not all(f"run{number}-value{i}" in final.text for i in range(1, 6)):
                raise VmError("speed_form_verification_failed")
            samples.append({"first_observation": observation_s, "browser_open": browser_s, "run_steps": steps_s})
    finally:
        await hub.aclose()
        # Never enumerate, stop or remove another target; the random name is verified again.
        try:
            if owned_target:
                raw = await vm.inspect(target)
                from .computer.vm import LABEL
                if raw and (raw.get("Config", {}).get("Labels") or {}).get(f"{LABEL}.owner") == vm.owner:
                    await vm.stop(target, remove=True)
                cleanup = await vm.inspect(target) is None
        finally:
            await vm.aclose(stop=False)
    summary = computer_speed_summary(samples)
    return {"container": target.name, "samples": samples, "summary": summary, "cleanup": cleanup,
            "passed": cleanup and all(item["passed"] is not False for item in summary.values()), "paid_requests": 0}


def attachment_id(store):
    return next(path.name for path in store.root.iterdir() if not path.name.endswith(".json"))


async def vm_timezone_smoke(directory):
    """Run after the app's Home load, against the same owned desktop."""
    from .computer.vm import LocalVm
    from .computer.vm_tools import VmTools
    from .services.attachment_store import AttachmentStore
    from .agent.gate import ToolGate
    from .agent.policy import Tier

    if not native_enabled(True):
        raise RuntimeError("VM timezone smoke requires the native runner")
    vm = LocalVm(directory)
    class EmptyHub:
        def offered(self): return []
        def tier_of(self, key): return None
        def kind_of(self, server, name): return None
        def record_unrun(self, *args, **kwargs): pass
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(directory))
    try:
        await hub.prepare()
        tool = next(tool for tool in hub.offered() if tool.name == "vm_exec")
        gate = ToolGate(hub)
        assert gate.tier(tool.key) == Tier.T0 and not gate.needs_confirmation(tool.key)
        result = await gate.call_plugin(tool.key, {"command": "date +%z"})
        assert result.ok, f"vm_exec date: {result.kind}"
        return {"command": "date +%z", "offset": json.loads(result.text)["output"].strip()}
    finally:
        await vm.aclose()


def native_enabled(fake_llm: bool) -> bool:
    return fake_llm and os.environ.get("RAPHAEL_TEST_NATIVE") == "1"


async def native_think(messages=None) -> None:
    """A native journey's model that takes as long as the journey says."""
    seconds = os.environ.get("RAPHAEL_NATIVE_THINK_S") if os.environ.get("RAPHAEL_TEST_NATIVE") == "1" else None
    if seconds and any(message.get("role") == "user" and "[native-typing:stream]" in str(message.get("content")) for message in messages or []):
        seconds = "1"
    if seconds:
        await asyncio.sleep(float(seconds))


async def wait_for_native_cancel(messages):
    """Only the isolated fake brain can hold an answer for the native Escape journey."""
    if native_enabled(True) and any(message.get("role") == "user" and "[native-round10:wait]" in str(message.get("content")) for message in messages):
        import asyncio
        await asyncio.Event().wait()


def record_model_request(model, effort):
    """Record only public model/effort metadata at the fake provider boundary."""
    if native_enabled(True) and os.environ.get("RAPHAEL_TEST_NATIVE_MODEL_PICKER") == "1":
        path = Path(os.environ["RAPHAEL_DATA_DIR"]) / "model-requests.jsonl"
        with path.open("a", encoding="utf-8") as output:
            output.write(json.dumps({"model": model, "effort": effort}) + "\n")


def gmail_enabled(fake_llm: bool) -> bool:
    return (native_enabled(fake_llm)
            and os.environ.get("RAPHAEL_TEST_NATIVE_GMAIL") == "1")


def bot_homes_brain(fake_llm: bool, data: Path):
    """An offline child at the CLI transport boundary of the isolated native journey."""
    if not native_enabled(fake_llm) or os.environ.get("RAPHAEL_TEST_NATIVE_HOMES") != "1":
        return None
    from .agent.cli.discovery import CliBrains
    home = data / "native-cli"
    auth = home / ".codex/auth.json"
    auth.parent.mkdir(parents=True, exist_ok=True)
    auth.write_text("{}", encoding="utf-8")
    child = home / "codex.py"
    child.write_text('''import json, sys
from pathlib import Path
def send(value): print(json.dumps(value), flush=True)
if "--version" in sys.argv:
    print("native-fake-codex 1"); sys.exit()
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize": send({"id":msg["id"], "result":{}})
    elif method == "model/list": send({"id":msg["id"], "result":{"data":[]}})
    elif method in ("thread/start", "thread/resume"):
        assert "Review" in msg["params"].get("developerInstructions", "")
        send({"id":msg["id"], "result":{"thread":{"id":"native-home"}}})
    elif method == "turn/start":
        # The member's own file comes with every turn, so that a resumed thread reads it as it is now.
        assert "private-review" in msg["params"]["input"][0]["text"]
        Path(sys.argv[1]).write_text(json.dumps({"member_home":True,"skills":True}), encoding="utf-8")
        send({"method":"item/completed", "params":{"item":{"type":"agentMessage", "id":"final", "phase":"final_answer", "text":"Native Codex home verified."}}})
        send({"method":"turn/completed", "params":{"turn":{"status":"completed"}}})
        break
''', encoding="utf-8")
    return CliBrains(home=home, environ={**os.environ, "CODEX_HOME": str(auth.parent), "PYTHONUTF8": "1"},
                     commands={"codex": [sys.executable, str(child), str(home / "receipt.json")]})


def home_timing_brain(fake_llm: bool, data: Path):
    """A slow offline quota transport, used only by the isolated Home timing journey."""
    if not native_enabled(fake_llm) or os.environ.get("RAPHAEL_TEST_NATIVE_HOME") != "1":
        return None
    from .agent.cli.discovery import CliBrains
    home = data / "native-cli"
    auth = home / ".codex/auth.json"
    auth.parent.mkdir(parents=True, exist_ok=True)
    auth.write_text("{}", encoding="utf-8")
    child = home / "codex.py"
    child.write_text('''import json, sys, time
def send(value): print(json.dumps(value), flush=True)
if "--version" in sys.argv:
    print("native-fake-codex 1"); sys.exit()
for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize": send({"id":msg["id"], "result":{}})
    elif method == "model/list": send({"id":msg["id"], "result":{"data":[]}})
    elif method == "account/rateLimits/read":
        time.sleep(2)
        send({"id":msg["id"], "result":{"rateLimits":{"primary":{"windowDurationMins":300,"usedPercent":40,"resetsAt":2000000000}}}})
''', encoding="utf-8")
    return CliBrains(home=home, environ={**os.environ, "CODEX_HOME": str(auth.parent), "PYTHONUTF8": "1"},
                     commands={"codex": [sys.executable, str(child)], "claude": [], "gemini": []})


def catalog_enabled(fake_llm: bool) -> bool:
    return native_enabled(fake_llm) and os.environ.get("RAPHAEL_TEST_NATIVE_CATALOG") == "1"


def native_connect(messages, offered, seen):
    """Script only the provider's choice; catalog, card, policy and login remain production code."""
    if not catalog_enabled(True):
        return None
    latest = next((str(message.get("content", "")) for message in reversed(messages) if message.get("role") == "user"), "")
    match = re.search(r"\[native-connect:([a-z0-9_-]{1,100})\]", latest)
    if not match:
        return None
    name = "find_app" if seen == 0 else "connect_app" if seen == 1 else ""
    return (name, {"query" if seen == 0 else "app": match[1]}) if name in offered else None


def native_computer(messages, offered, seen):
    """Script only fake-provider choices; the real VM, task, lease and viewer execute them."""
    if not native_enabled(True) or os.environ.get("RAPHAEL_TEST_NATIVE_COMPUTER") != "1":
        return None
    # Desktop screenshots are appended as user image blocks by the shared loop.
    latest = next((message["content"] for message in reversed(messages)
                   if message.get("role") == "user" and isinstance(message.get("content"), str)), "")
    if "[native-computer:signin]" not in latest:
        return None
    calls = [
        ("computer__vm_exec", {"command": """nohup /opt/venv/bin/python /home/cua/workspace/native-signin.py >/dev/null 2>&1 &
sleep 1
profile=/home/cua/workspace/.native-signin-browser
mkdir -p "$profile"
if command -v firefox >/dev/null 2>&1; then
  printf '%s\\n' 'user_pref("browser.shell.checkDefaultBrowser", false);' 'user_pref("browser.aboutwelcome.enabled", false);' 'user_pref("browser.startup.homepage_override.mstone", "ignore");' 'user_pref("signon.rememberSignons", false);' > "$profile/user.js"
  nohup firefox --no-remote --profile "$profile" --width 1280 --height 900 http://127.0.0.1:8765 >/dev/null 2>&1 &
else
  browser=$(command -v chromium || command -v chromium-browser || command -v google-chrome)
  test -n "$browser" || exit 1
  nohup "$browser" --no-sandbox --no-first-run --start-maximized --disable-dev-shm-usage --user-data-dir="$profile" http://127.0.0.1:8765 >/dev/null 2>&1 &
fi
sleep 3"""}),
        ("computer__request_takeover", {"reason": "sign_in"}),
        ("computer__get_desktop_state", {}),
        ("computer__vm_exec", {"command": "/opt/venv/bin/python -c 'import urllib.request,json; s=json.load(urllib.request.urlopen(\"http://127.0.0.1:8765/state\")); assert s[\"signed_in\"] and s[\"continued\"]==0; urllib.request.urlopen(\"http://127.0.0.1:8765/finish\",data=b\"\").read(); print(\"Continued once\")'"}),
    ]
    if seen >= len(calls):
        return "reply", "已登入，原本的工作已繼續一次。"
    name, arguments = calls[seen]
    if name not in offered:
        raise ValueError("Native computer tool is absent")
    return name, arguments


def native_consult(messages: list[dict], offered: set[str], seen: int) -> dict | None:
    if not native_enabled(True) or "ask_member" not in offered or seen:
        return None
    latest = next((str(message.get("content", "")) for message in reversed(messages)
                   if message.get("role") == "user"), "")
    targets = re.findall(r"\[native-consult:([^\]\r\n]+)\]", latest)
    if not targets:
        return None
    return {"member": targets[-1], "request": "NATIVE-AUDIT-EXCHANGE: give a short report for the owner."}


def native_diagnosis(messages, offered, seen):
    """Script only the fake provider; cards, vault checks and continuation stay production code."""
    if not native_enabled(True):
        return None
    task = " ".join(str(message.get("content", "")) for message in messages if message.get("role") == "user")
    if "[native-diagnosis]" not in task:
        return None
    if "card_failure" in task:
        if not seen and "self_check" in offered:
            return "self_check", {}
        reason = re.search(r'"kind":\s*"([a-z_]+)"\s*,\s*"reason":\s*"([^"\\]*)"', task)
        if reason is None:
            raise ValueError("Native diagnosis never received the classified card failure")
        if reason.group(1) != "auth_expired" or "Composio's API key is missing" not in reason.group(2):
            raise ValueError("Native diagnosis received a different connection failure")
        return "reply", "要連上 Gmail，還需要 Composio 金鑰：請到設定 › 連接 貼上它。我已檢查設定，會在連線完成後繼續原本的工作。"
    if not seen and "connect_app" in offered:
        return "connect_app", {"app": "gmail"}
    return "reply", "請從卡片連線 Gmail，完成後我會繼續。"


def native_memory(messages, offered, seen):
    """Script only provider choices; production recall, tools and homes do the work."""
    if not native_enabled(True):
        return None
    latest = next((str(message.get("content", "")) for message in reversed(messages)
                   if message.get("role") == "user"), "")
    questions = re.findall(r"<question>\s*(.*?)\s*</question>", latest, re.S)
    question = questions[-1] if questions else latest
    if "[native-memory:" not in question:
        return None
    if "[native-memory:record]" in question:
        if not seen:
            if "memory_update" not in offered:
                raise ValueError("Native memory tool is absent")
            return "memory_update", {"target": "memory", "operations": [
                {"action": "add", "content": "The project colour is heliotrope."}]}
        return "reply", "The member saved the project colour."
    if "[native-memory:recall]" in question:
        recall = re.findall(r'<tool_result [^>]*tool="auto_recall"[^>]*>(.*?)</tool_result>', latest, re.S)
        if not any("heliotrope" in block for block in recall):
            raise ValueError("Turn one was not automatically recalled at turn twenty-five")
        return "reply", "The project colour is heliotrope."
    return "reply", "Work step recorded."


def native_calendar(messages, offered, seen):
    """Script only the provider's choice; the tool, its gate, the store and Home are production code."""
    if not native_enabled(True):
        return None
    latest = next((str(message.get("content", "")) for message in reversed(messages)
                   if message.get("role") == "user"), "")
    if "[native-calendar]" not in latest:
        return None
    if seen:
        return "reply", "已加到今天的行程。"
    if "calendar_add" not in offered:
        raise ValueError("Native calendar tool is absent")
    return "calendar_add", {"title": "NativeMember", "start": datetime.now().strftime("%Y-%m-%dT15:00"), "notes": "From the member"}


def native_skill_review(user):
    """The offline provider proposes a skill; the real reviewer validates and persists it."""
    if not native_enabled(True) or "[native-skills:learn]" not in user:
        return {"changes": []}
    return {"changes": [{"text": "---\nname: clock-audit\ndescription: Audit repeated clock observations\n---\n"
                        "## When to use\nUse for a clock audit.\n## Procedure\nRead and compare ten observations.\n"
                        "## Pitfalls\nKeep time zones consistent.\n## Verification\nCheck all observations."}]}


def native_skills(messages, offered, seen):
    if not native_enabled(True):
        return None
    latest = next((str(m.get("content", "")) for m in reversed(messages) if m.get("role") == "user"), "")
    questions = re.findall(r"<question>\s*(.*?)\s*</question>", latest, re.S)
    latest = questions[-1] if questions else latest
    if "[native-skills:" not in latest:
        return None
    if "[native-skills:learn]" in latest:
        if not seen:
            return "local_time", {}
        if seen < 10:
            return "history_search", {"query": f"Clock audit observation {seen}"}
        return "reply", "Clock audit completed."
    if not seen:
        if "skill_read" not in offered:
            raise ValueError("Native skills reader is missing")
        return "skill_read", {"name": "clock-audit"}
    tool_data = " ".join(str(m.get("content", "")) for m in messages if m.get("role") == "tool")
    if "Read and compare ten observations" not in tool_data:
        raise ValueError("The next task did not read the learned procedure")
    return "reply", "The learned clock audit procedure was read."


def native_codex_model(environ=None):
    """Use the owner's public model selection, never a guessed CLI model alias."""
    environ = os.environ if environ is None else environ
    home = Path(environ.get("CODEX_HOME") or Path(environ.get("USERPROFILE") or environ.get("HOME") or Path.home()) / ".codex")
    config = home / "config.toml"
    settings = tomllib.loads(config.read_text(encoding="utf-8-sig")) if config.exists() else {}
    model = environ.get("RAPHAEL_NATIVE_CODEX_MODEL") or settings.get("model")
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,199}", model):
        raise ValueError("Set RAPHAEL_NATIVE_CODEX_MODEL to an installed Codex model id")
    cache = home / "models_cache.json"
    if cache.exists():
        models = json.loads(cache.read_text(encoding="utf-8-sig")).get("models", [])
        known = {row.get("slug") for row in models if isinstance(row, dict)}
        if known and model not in known:
            raise ValueError("Native Codex model is absent from the CLI model cache; choose an available model id")
    return f"cli:codex:{model}"


class OfflineModelManager(ModelManager):
    def ensure_spec(self, spec, progress=None):
        if not self.is_ready_spec(spec):
            raise ModelDownloadError(f"Native journeys require the preinstalled model {spec.name}; downloads are disabled")
        return self.dir(spec.name)


class GmailJourneyVault(MemoryVault):
    def get(self, name: str) -> str | None:
        if name == KEY:
            return CredentialVault().get(name)
        return super().get(name)
