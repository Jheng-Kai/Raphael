"""A key the owner pasted on a card for a program in a member's computer (R-KEY-01..03): kept in the vault, given to one
command's environment and never to its command line, and withheld from everything that command or a later read returns.
Every key here is generated for the test; nothing reaches Docker, a network or a model."""

import asyncio
import json
import secrets

import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.brain import db
from raphael_core.computer import vm as vm_module
from raphael_core.computer.logins import redact_values
from raphael_core.computer.vault_entries import VaultEntries, key_name_ok
from raphael_core.computer.vm import Docker, Result, VmError, exec_args
from raphael_core.computer.vm_tools import EXEC, VmTools, vm_scope
from raphael_core.connectors.secret_cards import SecretCards
from raphael_core.integrations.vault import SecretTooLong
from raphael_core.router import Router
from raphael_core.services.attachment_store import AttachmentStore

from .test_vm import Bridge, EmptyHub, desktop  # noqa: F401


class Vault:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value):
        self.values[key] = value

    def delete(self, key):
        self.values.pop(key, None)


def make_key():
    return "sk-or-v1-" + secrets.token_hex(16)


def everything(conn, *extra):
    """Every row the app holds, and whatever else the caller passes, as one text."""
    rows = [[list(row) for row in conn.execute(f'SELECT * FROM "{table}"')]
            for (table,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    return json.dumps([rows, extra], default=str)


# --- the saved key -----------------------------------------------------------------------------------------------


def test_a_key_is_kept_in_the_vault_and_listed_without_its_value(conn):
    vault, value = Vault(), make_key()
    entries = VaultEntries(vault, conn=conn)
    identifier = entries.put_key(3, "OPENROUTER_API_KEY", "the price script", value)
    assert [(row["kind"], row["label"], row["hint"], row["members"]) for row in entries.entries()] == [
        ("key", "OPENROUTER_API_KEY", "the price script", [3])]
    assert value not in everything(conn, entries.entries(), entries.choices(3))
    assert value in "".join(vault.values.values())  # only the vault holds it
    assert entries.key_values(3, ["OPENROUTER_API_KEY"]) == ({"OPENROUTER_API_KEY": value}, [])
    # Saving it again replaces the old one: one entry, one credential.
    again = make_key()
    entries.put_key(3, "OPENROUTER_API_KEY", "the price script", again)
    assert len(entries.entries()) == 1 and len(vault.values) == 1 and identifier not in {row["id"] for row in entries.entries()}
    assert entries.key_values(3, ["OPENROUTER_API_KEY"])[0] == {"OPENROUTER_API_KEY": again}
    # The owner deletes it where the other saved entries are listed.
    entries.remove(entries.entries()[0]["id"])
    assert entries.entries() == [] and vault.values == {}
    assert entries.key_values(3, ["OPENROUTER_API_KEY"]) == ({}, ["OPENROUTER_API_KEY"])


def test_a_key_belongs_to_its_member_unless_the_owner_shares_it(conn):
    entries = VaultEntries(Vault(), conn=conn)
    value = make_key()
    identifier = entries.put_key(3, "OPENROUTER_API_KEY", "p", value)
    assert entries.key_values(4, ["OPENROUTER_API_KEY"]) == ({}, ["OPENROUTER_API_KEY"])
    with conn:
        conn.execute("UPDATE vault_entries SET members='\"all\"' WHERE id=?", (identifier,))
    assert entries.key_values(4, ["OPENROUTER_API_KEY"])[0] == {"OPENROUTER_API_KEY": value}


@pytest.mark.parametrize("name", ["PATH", "home", "LD_PRELOAD", "BASH_ENV", "RAPHAEL_X", "VNC_PW", "bad name", "A=B", "1KEY", "", "x" * 65, None, 5])
def test_a_key_is_never_given_under_a_name_the_shell_or_the_computer_reads(conn, name):
    assert not key_name_ok(name)
    with pytest.raises(ValueError):
        VaultEntries(Vault(), conn=conn).put_key(0, name, "p", make_key())


@pytest.mark.parametrize("value", ["", "short", " padded-key-value ", "line\nbreak-key-value", "nul\x00-key-value", 5])
def test_a_value_that_is_not_a_key_is_refused_and_nothing_is_kept(conn, value):
    vault = Vault()
    with pytest.raises(ValueError):
        VaultEntries(vault, conn=conn).put_key(0, "SOME_KEY", "p", value)
    assert vault.values == {} and conn.execute("SELECT COUNT(*) FROM vault_entries").fetchone()[0] == 0


def test_a_key_longer_than_the_vault_can_hold_is_refused(conn):
    vault = Vault()
    with pytest.raises(SecretTooLong):
        VaultEntries(vault, conn=conn).put_key(0, "SOME_KEY", "p", "k" * 801)
    assert vault.values == {}


def test_the_owner_may_rename_a_key_only_to_a_valid_name(conn):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put_key(0, "SOME_KEY", "p", make_key())
    handlers = {}

    class Catcher:
        def register(self, name, handler):
            handlers[name] = handler
    entries.register(Catcher())
    asyncio.run(handlers["vault.update"]({"id": identifier, "label": "OTHER_KEY", "hint": "now this", "members": [0]}))
    assert entries.entries()[0]["label"] == "OTHER_KEY"
    with pytest.raises(RpcError):
        asyncio.run(handlers["vault.update"]({"id": identifier, "label": "PATH", "hint": "", "members": [0]}))
    with pytest.raises(RpcError):
        asyncio.run(handlers["vault.add"]({"kind": "key", "label": "X_KEY", "values": {"value": make_key()}, "members": "all"}))


def test_migration_85_widens_both_kinds_and_keeps_what_was_saved(monkeypatch, tmp_path):
    path = tmp_path / "before-keys.db"
    with monkeypatch.context() as old:
        old.setattr(db, "LATEST_VERSION", 84)
        conn = db.connect(path)
    turn = AgentHistory(conn).add(session_id="s", question="q", route="answer", prefix="", text="", status="running", source="app", member_id=0)
    with conn:
        conn.execute("INSERT INTO secret_cards VALUES ('c1',?,0,NULL,'srv','env','TOKEN','Weather','en','pending','',0,'[]',1,1,2,NULL)", (turn,))
        conn.execute("INSERT INTO vault_entries VALUES ('v1','login','Mail','hint','https://mail.example','[0]','computer-entry:v1')")
    with pytest.raises(Exception):
        conn.execute("INSERT INTO vault_entries VALUES ('v2','key','K','','','[0]','c')")
    db.migrate(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 85
    assert conn.execute("SELECT id, kind, name FROM secret_cards").fetchall()[0][:] == ("c1", "env", "Weather")
    assert tuple(conn.execute("SELECT id, kind, label, hint, origin, members, credential FROM vault_entries").fetchone()) == (
        "v1", "login", "Mail", "hint", "https://mail.example", "[0]", "computer-entry:v1")
    with conn:
        conn.execute("INSERT INTO vault_entries VALUES ('v2','key','K','','','[0]','c')")
        conn.execute("INSERT INTO secret_cards VALUES ('c2',?,0,NULL,'K','key','key','why','en','pending','',0,'[]',1,1,2,NULL)", (turn,))
    # The card still goes with its turn.
    with conn:
        conn.execute("DELETE FROM agent_turns WHERE id=?", (turn,))
    assert conn.execute("SELECT COUNT(*) FROM secret_cards").fetchone()[0] == 0
    conn.close()


# --- withholding -------------------------------------------------------------------------------------------------


def test_redaction_covers_a_value_whole_escaped_and_cut_by_a_limit():
    value = "sk-or-v1-" + "ab12" * 8
    assert redact_values([value], f"a {value} b") == "a [private] b"
    assert redact_values(["quote\"d-secret-value"], 'x {"k": "quote\\"d-secret-value"}') == 'x {"k": "[private]"}'
    # A limit that cut the value leaves its head at the end, or its tail at the start, of what is read.
    assert redact_values([value], "out: " + value[:20]) == "out: [private]"
    assert redact_values([value], value[-20:] + " more") == "[private] more"
    assert redact_values([value], "nothing here") == "nothing here"


def test_exec_args_name_the_variables_and_never_carry_a_value():
    target = type("T", (), {"name": "box"})()
    args = exec_args(target, ["sh", "-c", "true"], env=("OPENROUTER_API_KEY", "OTHER_KEY"))
    assert args[args.index("OPENROUTER_API_KEY") - 1] == "-e" and args[args.index("OTHER_KEY") - 1] == "-e"
    assert args.index("OTHER_KEY") < args.index("box")  # an option of exec, before the container
    assert not any("=" in arg and arg.startswith(("OPENROUTER", "OTHER")) for arg in args)


class Stream:
    def __init__(self, chunks):
        self.chunks = list(chunks)

    async def read(self, _size):
        return self.chunks.pop(0) if self.chunks else b""


class Process:
    returncode = 0
    stdin = None

    def __init__(self, out, err=()):
        self.stdout, self.stderr = Stream(out), Stream(err)

    async def wait(self):
        return 0

    def kill(self):
        pass


async def test_docker_gives_a_value_by_environment_and_withholds_it_across_chunks(monkeypatch):
    value = make_key()
    seen = {}

    async def spawn(*argv, **kwargs):
        seen["argv"], seen["kwargs"] = argv, kwargs
        half = len(value) // 2
        return Process([b"calling with " + value[:half].encode(), value[half:].encode() + b" now\nsecond " + value.encode() + b"\n"],
                       [b"warn " + value[:5].encode(), value[5:].encode() + b"\n"])
    monkeypatch.setattr(vm_module.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(vm_module, "docker_cli", lambda: "docker")
    lines = []
    docker = Docker()
    result = await docker(["exec", "-e", "SOME_KEY", "box", "run"], env={"SOME_KEY": value}, progress=lines.append,
                          redact=lambda text: redact_values([value], text))
    assert seen["kwargs"]["env"]["SOME_KEY"] == value
    assert value not in " ".join(seen["argv"]) and not any(value[:8] in part for part in seen["argv"])
    for text in (result.stdout, result.stderr, *lines):
        assert value[:8] not in text and value[-8:] not in text
    assert result.stdout == "calling with [private] now\nsecond [private]\n" and result.stderr == "warn [private]\n"
    assert set(lines) == {"calling with [private] now", "second [private]", "warn [private]"}


async def test_a_value_the_limit_would_cut_is_withheld_before_the_cut(monkeypatch):
    value = make_key()

    async def spawn(*argv, **kwargs):
        return Process([b"x" * 20 + value.encode()])
    monkeypatch.setattr(vm_module.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(vm_module, "docker_cli", lambda: "docker")
    result = await Docker()(["exec"], limit=30, env={"K": value}, redact=lambda text: redact_values([value], text))
    assert value[:6] not in result.stdout and result.stdout == "x" * 20 + "[private]"


async def test_a_docker_call_without_keys_leaves_the_environment_alone(monkeypatch):
    seen = {}

    async def spawn(*argv, **kwargs):
        seen.update(kwargs)
        return Process([b"ok"])
    monkeypatch.setattr(vm_module.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(vm_module, "docker_cli", lambda: "docker")
    assert (await Docker()(["info"])).stdout == "ok" and "env" not in seen


# --- vm_exec -----------------------------------------------------------------------------------------------------


async def hub_with(desktop, tmp_path, conn):
    vm, target, runtime = desktop
    entries = VaultEntries(Vault(), conn=conn)
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    hub.logins = entries
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    return vm, runtime, entries, hub, tool


def runs_of(runtime, command):
    """The docker calls that carry this command (in the foreground or a detached job)."""
    return [(args, kwargs) for args, kwargs in runtime.calls if command in " ".join(map(str, args))]


@pytest.mark.parametrize("background", [False, True])
async def test_vm_exec_gives_a_saved_key_to_that_one_command_only(desktop, tmp_path, conn, background):
    vm, runtime, entries, hub, tool = await hub_with(desktop, tmp_path, conn)
    value = make_key()
    entries.put_key(0, "OPENROUTER_API_KEY", "price script", value)
    command = 'curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://example.invalid'
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tool.key, {"command": command, "keys": ["OPENROUTER_API_KEY"], "background": background}, approver="auto")
        later = await hub.call(tool.key, {"command": "echo plain"}, approver="auto")
    assert result.ok and later.ok
    (args, kwargs), = runs_of(runtime, command)
    assert kwargs["env"] == {"OPENROUTER_API_KEY": value}
    # The name travels on the command line; the value never does, and the command is the model's own text.
    assert args[args.index("OPENROUTER_API_KEY") - 1] == "-e" and value not in " ".join(args)
    # A command that names no key gets none.
    assert runs_of(runtime, "echo plain") and all("env" not in kwargs for args, kwargs in runs_of(runtime, "echo plain"))
    for call in runtime.calls:
        assert value not in repr(call[0])
    assert value not in result.text and value not in everything(conn, result.text)


async def test_what_a_command_or_a_later_read_returns_has_the_value_replaced(desktop, tmp_path, conn):
    vm, runtime, entries, hub, tool = await hub_with(desktop, tmp_path, conn)
    value = make_key()
    entries.put_key(0, "OPENROUTER_API_KEY", "price script", value)
    run = vm.run

    async def echoing(args, **kwargs):
        if "-lc" in args:
            return Result(0, f"key is {value}\n", f"debug {value}")
        return await run(args, **kwargs)
    vm.run = echoing
    with vm_scope(("turn", 0, 7), turn_id=7):
        used = await hub.call(tool.key, {"command": "env", "keys": ["OPENROUTER_API_KEY"]}, approver="auto")
        # The job log is read later, by a command that is given no key at all.
        later = await hub.call(tool.key, {"command": "cat .raphael-jobs/a.log"}, approver="auto")
    for result in (used, later):
        assert value not in result.text and value[:12] not in result.text and "[private]" in result.text


async def test_a_key_that_is_not_saved_is_an_error_that_says_to_ask_for_it(desktop, tmp_path, conn):
    vm, runtime, entries, hub, tool = await hub_with(desktop, tmp_path, conn)
    entries.put_key(0, "OPENROUTER_API_KEY", "price script", make_key())
    with vm_scope(("turn", 0, 7), turn_id=7):
        missing = await hub.call(tool.key, {"command": "run", "keys": ["OPENROUTER_API_KEY", "OTHER_API_KEY"]}, approver="auto")
        refused = await hub.call(tool.key, {"command": "run", "keys": ["PATH=/x"]}, approver="auto")
    assert (missing.ok, missing.kind) == (False, "key_not_saved")
    assert "OTHER_API_KEY" in missing.text and "request_secret" in missing.text and "OPENROUTER_API_KEY" not in missing.text
    assert not refused.ok
    # Nothing ran, and the computer was not woken for it.
    assert not runs_of(runtime, "cd /home/cua/workspace && run")


async def test_a_member_cannot_use_another_members_key(desktop, tmp_path, conn):
    vm, runtime, entries, hub, tool = await hub_with(desktop, tmp_path, conn)
    entries.put_key(5, "OPENROUTER_API_KEY", "p", make_key())
    with vm_scope(("turn", 0, 7), turn_id=7):
        result = await hub.call(tool.key, {"command": "run", "keys": ["OPENROUTER_API_KEY"]}, approver="auto")
    assert result.kind == "key_not_saved"


async def test_vm_exec_refuses_keys_without_a_vault_and_a_vm_refuses_bad_names(desktop, tmp_path, conn):
    vm, target, runtime = desktop
    hub = VmTools(EmptyHub(), vm, attachments=AttachmentStore(tmp_path), bridge=Bridge)
    await hub.prepare()
    tool = next(item for item in hub.offered() if item.name == "vm_exec")
    with vm_scope(("turn", 0, 7), turn_id=7):
        assert (await hub.call(tool.key, {"command": "run", "keys": ["A_KEY_1"]}, approver="auto")).kind == "key_not_saved"
    for keys in ({}, {"bad name": "value-1234"}, {"OK_KEY": ""}, {"OK_KEY": "nul\x00value"}, {"OK_KEY": 5}):
        with pytest.raises(VmError):
            await vm.execute(target, "true", keys=keys)


def test_the_keys_parameter_is_short_and_bounded():
    schema = EXEC["parameters"]["properties"]["keys"]
    assert schema["type"] == "array" and schema["maxItems"] <= 8 and "pattern" in schema["items"]
    assert "request_secret" in EXEC["description"] and len(EXEC["description"]) < 1200


# --- the card ----------------------------------------------------------------------------------------------------


class CardRig:
    def __init__(self, conn):
        self.conn = conn
        self.vault = Vault()
        self.entries = VaultEntries(self.vault, conn=conn)
        self.router = Router()
        self.events, self.resumed = [], []
        self.cards = SecretCards(conn, None, notify=lambda method, params: self.events.append((method, params)))
        self.cards.logins = self.entries

        async def resume(turn_id, attempt):
            self.resumed.append(turn_id)
            return type("Outcome", (), {"ok": True, "made": ()})()
        self.cards.resume = resume
        self.cards.register(self.router)
        self.turn = AgentHistory(conn).add(session_id="s", question="q", route="answer", prefix="", text="", status="running",
                                           source="app", member_id=0)

    def show(self, name="OPENROUTER_API_KEY", purpose="the price script", member=0):
        return self.cards.show_key(turn_id=self.turn, member_id=member, conversation_id=None, name=name, purpose=purpose, language="zh-TW")

    async def save(self, card, value):
        result = await self.router.call("integrations.card_save", {"id": card.id, "value": value})
        await self.cards.idle()
        return result, self.cards.store.get(card.id)


async def test_the_owner_pastes_a_key_on_the_card_and_only_the_vault_gets_it(conn):
    rig, value = CardRig(conn), make_key()
    card = rig.show()
    view = rig.cards.views([rig.turn])[rig.turn][0]
    assert (view["key"], view["name"], view["purpose"], view["state"]) == (True, "OPENROUTER_API_KEY", "the price script", "pending")
    result, card = await rig.save(card, value)
    assert result["saved"] is True and card.state == "resumed" and rig.resumed == [rig.turn]
    assert rig.entries.key_values(0, ["OPENROUTER_API_KEY"])[0] == {"OPENROUTER_API_KEY": value}
    assert value not in everything(rig.conn, rig.events, rig.cards.views([rig.turn]), result)
    # Asked again, it is already saved: no second card.
    assert rig.show() is None


@pytest.mark.parametrize("value,error", [("short", "invalid"), ("with space inside-but-ok-" + "k" * 4, None), ("k" * 900, "too_long"), ("ctrl\x07-key-value", "invalid")])
async def test_a_bad_value_leaves_the_card_waiting_and_the_vault_alone(conn, value, error):
    rig = CardRig(conn)
    card = rig.show()
    result, card = await rig.save(card, value)
    if error is None:
        assert result["saved"] is True
        return
    assert (result["saved"], card.state, card.error) == (False, "failed", error)
    assert rig.vault.values == {} and rig.resumed == []


async def test_a_key_card_refuses_names_and_purposes_it_cannot_show(conn):
    rig = CardRig(conn)
    for name, purpose in (("PATH", "x"), ("bad name", "x"), ("OK_KEY", ""), ("OK_KEY", "two\nlines"), ("OK_KEY", "x" * 121), ("OK_KEY", None)):
        with pytest.raises(ValueError):
            rig.show(name, purpose)
    assert conn.execute("SELECT COUNT(*) FROM secret_cards").fetchone()[0] == 0
