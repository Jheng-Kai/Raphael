"""A team does a job from start to end, on the production app with a scripted model and a fake Docker:
the owner creates two members and the chief hands each a task, both work at the same time, one waits for the
other to finish with the computer, both finish with evidence, and the chief gets the results and answers.

The real app runs: the chief's tools, the member service, the background service with its worker (in
this event loop), the gates, the shared computer's tools. Only the model and the container engine are
scripted. Nothing is spent, no Docker starts."""

import asyncio
import base64
import hashlib
import json
import time

from raphael_core.agent.history import AgentHistory
from raphael_core.background.host import WorkerHost
from raphael_core.brain.openrouter import ChatToolCall, ChatTurn
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.vm import LocalVm, Result
from raphael_core.evaluate.guardian import Budget
from raphael_core.evaluate.guardian_driver import RpcDriver

from computer.test_vm import Runtime, container
from .conftest import Links, until

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nimage").decode()


class Docker(Runtime):
    """The container engine: a command that builds the page writes it where the container's workspace is."""

    workspace = None

    async def __call__(self, args, **kwargs):
        if "-lc" in args and any("build office.html" in part for part in args):
            (self.workspace / "office.html").write_text("<!doctype html><p>3D office</p>", encoding="utf8")
            return Result(0, "built")
        return await super().__call__(args, **kwargs)


class Desktop:
    """The driver inside the container: the first look at the screen takes a while, as a real one can."""

    release = None
    log = []
    alive = True

    def __init__(self, vm, target):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def request(self, method, params=None):
        if method == "tools/list":
            return {"tools": [{"name": name, "description": name, "inputSchema": {"type": "object"}}
                              for name in ("get_desktop_state", "click")]}
        Desktop.log.append(("start", params["name"]))
        if params["name"] == "get_desktop_state" and not Desktop.release.is_set() and ("held", 1) not in Desktop.log:
            Desktop.log.append(("held", 1))
            await Desktop.release.wait()
        Desktop.log.append(("end", params["name"]))
        return {"content": [{"type": "image", "data": PNG, "mimeType": "image/png"}]}


class Crew:
    """The model of the whole team, scripted by who is asking and where the work stands."""

    def __init__(self):
        self.ids = {}
        self.active, self.peak = set(), 0
        self.seen = {}
        self.count = 0

    def call(self, tool, **arguments):
        self.count += 1
        return ChatToolCall(f"call{self.count}", tool, arguments, json.dumps(arguments))

    async def chat_tools(self, **kwargs):
        messages, system = kwargs["messages"], kwargs["messages"][0]["content"]
        me = json.loads(system.split("<team_roster>")[-1].split("</team_roster>")[0])["self_id"]
        told = " ".join(str(message.get("content")) for message in messages if message.get("role") == "user")
        if me == 0 and "handoff_results" in told:
            self.seen["chief"] = messages[-1]["content"]
            reply = json.dumps({"prefix": "告", "text": "Builder and Tester are both done.", "detail": ""})
            return self.turn(reply, [], kwargs)
        if me == 0:
            offered = {tool["function"]["name"] for tool in kwargs["tools"]}
            assert "member_create" in offered and "create_member" not in offered
            work = [("Builder", "build", "Build office.html in the workspace", "office.html exists in the workspace"),
                    ("Tester", "test", "Look at the screen and test the page", "Report what the test run showed")]
            calls = [self.call("handoff", member_id=self.ids[name], stage_id=stage, request=request, done_when=done, requires_artifact=name == "Builder")
                     for name, stage, request, done in work]
            return self.turn("I hand the work over.", calls, kwargs)
        name = next(name for name, number in self.ids.items() if number == me)
        step = sum(bool(message.get("tool_calls")) for message in messages)
        if step == 0:
            for _ in range(1000 if name == "Tester" else 0):  # the Builder is at the screen first
                if ("held", 1) in Desktop.log:
                    break
                await asyncio.sleep(0.01)
            self.active.add(name)
            self.peak = max(self.peak, len(self.active))
            return self.turn("Looking at the screen.", [self.call("computer__get_desktop_state")], kwargs)
        if step == 1:
            command = "build office.html" if name == "Builder" else "run the test"
            return self.turn("Working in the workspace.", [self.call("computer__vm_exec", command=command)], kwargs)
        self.active.discard(name)
        return self.turn(f"{name} is done. The page is /home/cua/workspace/office.html", [], kwargs)

    @staticmethod
    def turn(content, calls, kwargs):
        return ChatTurn(content, calls, kwargs["model"], 0.001, 100, 10, 50, True)


async def test_an_existing_team_works_at_once_and_waits_for_the_computer(tmp_path):
    crew = Crew()
    driver = RpcDriver(tmp_path, "fake/model", crew, Budget(200))
    app = driver.app
    try:
        app.background._host = WorkerHost(connect=Links(), grace_s=0.3)
        app.gate._safety = None  # no rule of the owner's is in play here
        for name in ("Builder", "Tester"):
            result = await app.members.admin_tool(0, "member_create",
                                                  {"name": name, "role": name, "instructions": f"You are the {name}."},
                                                  interactive=True)
            crew.ids[name] = result["member"]["id"]
        Desktop.release, Desktop.log = asyncio.Event(), []
        # The shared computer, on a container engine that is a fake.
        hub = app.vm_tools
        runtime = Docker()
        settings = SettingsStore(app._conn)
        settings.set("computer_vm_mode", "shared")
        vm = LocalVm(tmp_path / "vm", settings=settings, runner=runtime, clock=time.monotonic)
        workspace = runtime.workspace = vm.target(0).workspace
        workspace.mkdir(parents=True)
        runtime.raw = container(vm, vm.target(0), runtime)
        vm.grants = hub.vm.grants
        vm.grants.allowed = lambda member: True
        vm.busy = lambda key: key in hub.leases and hub.scope_busy(hub.leases[key])
        app.vm = hub.vm = vm
        hub.bridge, hub.busy_poll_s = Desktop, 0.02

        history = AgentHistory(app._conn)
        turn = history.add(session_id="owner", question="Build the 3D office with a team", route="answer", source="app",
                           scope="private", prefix="", text="", status="running")
        parent = app.background.submit(session_id="owner", text="Build the 3D office with a team", language="en",
                                       model="fake/model", member_id=0)
        app.background.attach_turn(parent, turn)

        lines = lambda: [params["text"] for method, params in driver.events if method == "worker.progress"]
        await until(lambda: "Waiting for Builder to finish with the computer" in lines(), timeout=30)
        # Both members are at work, and one is waiting for the other to finish with the screen.
        assert crew.peak == 2 and set(crew.ids) == {"Builder", "Tester"}
        assert ("end", "get_desktop_state") not in Desktop.log
        Desktop.release.set()

        await until(lambda: app.background.task(parent).state in ("done", "failed"), timeout=60)
        assert app.background.task(parent).state == "done", app.background.task(parent).reason
        assert lines().count("Waiting for Builder to finish with the computer") == 1
        children = {name: app.background.task(task.id) for name in crew.ids
                    for task in app.background._store.handoffs(turn) if task.member_id == crew.ids[name]}
        assert {task.state for task in children.values()} == {"done"}
        # The page is the Builder's evidence: the bytes found in the workspace, not the Builder's word.
        [page] = [e for e in app.background._store.evidence(children["Builder"].id) if e["kind"] == "artifact"]
        assert page["uri"] == "office.html"
        assert page["digest"] == hashlib.sha256((workspace / "office.html").read_bytes()).hexdigest()
        # The Tester looked at the screen only once the Builder had finished with it.
        starts = [n for n, (kind, name) in enumerate(Desktop.log) if (kind, name) == ("start", "get_desktop_state")]
        assert Desktop.log.index(("end", "get_desktop_state")) < starts[1]
        # The chief was told how each ended, in three words, and what to rely on.
        told = crew.seen["chief"]
        assert told.count('"state": "completed"') == 2 and "claim" in told and "evidence" in told
        assert app.background.task(parent).report_text == "Builder and Tester are both done."
    finally:
        await driver.aclose()
