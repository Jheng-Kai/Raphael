"""Synthetic vault, browser and CSV checks; never inspect Windows credentials."""

import json

import pytest

from .fixtures.semantic_browser import measured, member_ref

from raphael_core.agent.gate import ToolGate
from raphael_core.agent.policy import Action, Confirmations, Tier
from raphael_core.brain.settings import SettingsStore
from raphael_core.computer.vault_entries import VaultEntries
from raphael_core.computer.vm_tools import VmTools, vm_scope
from raphael_core.services.attachment_store import AttachmentStore
from .test_login_vault import Vault as LoginTestVault
from .test_vm import desktop, CatalogBridge, EmptyHub  # noqa: F401
from .fixtures.driver_contract import bind_page, catalog, window_reply


CONTACT = {"name": "private-owner", "address": "private-address", "phone": "private-phone", "email": "private-email"}
CARD = {"name": "private-holder", "number": "4111111111111111", "expiry": "private-expiry", "cvc": "private-cvc"}


class Vault(LoginTestVault):
    def delete(self, key): self.values.pop(key, None)


def test_private_fill_guidance_survives_the_shared_model_description_limit():
    from raphael_core.agent.plugins import DESCRIPTION_CHARS
    from raphael_core.computer.vm_tools import FILL_LOGIN, FILL_CONTACT, FILL_CARD
    for definition in (FILL_LOGIN, FILL_CONTACT, FILL_CARD):
        offered = definition["description"][:DESCRIPTION_CHARS]
        assert "hint" in offered and "ask_owner" in offered and "submit" in offered
    assert "Every use needs owner approval" in FILL_CARD["description"][:DESCRIPTION_CHARS]
    assert "request_takeover" in FILL_CARD["description"][:DESCRIPTION_CHARS]


def test_entry_sharing_revocation_and_legacy_migration_do_not_store_values(conn):
    from raphael_core.brain import db
    from raphael_core.computer.logins import LoginVault
    vault = Vault()
    old = LoginVault(vault, conn=conn)
    reference = old.reference(0, "https://example.com/login")
    old.save(reference, json.dumps({"username": "old-user", "password": "old-password"}), member=0, site="https://example.com")
    # Recreate exactly the metadata-only migration against the earlier login registry.
    conn.execute("DROP TABLE vault_entries")
    conn.execute("DROP TABLE computer_payment_holds")
    conn.commit()
    conn.executescript(db._MIGRATIONS[63])
    entries = VaultEntries(vault, conn=conn)
    assert entries.load(0, "https://example.com", reference)["password"] == "old-password"
    assert entries.entries()[0]["members"] == [0]
    identifier = entries.put({"kind": "contact", "label": "Travel", "hint": "Use for travel", "values": CONTACT})
    assert entries.entry(200, identifier, "contact")[1] == CONTACT
    with conn:
        conn.execute("UPDATE vault_entries SET members='[0]' WHERE id=?", (identifier,))
    with pytest.raises(ValueError): entries.entry(200, identifier, "contact")
    assert entries.choices(200) == []
    for private in (*CONTACT.values(), "old-password", "old-user"):
        assert private not in repr(list(conn.iterdump()))


@pytest.mark.parametrize("header", ["name,url,username,password", "Title,Url,Username,Password", "title,website,username,password"])
async def test_csv_preview_selection_cancel_expiry_and_single_use_never_write_source(conn, header):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    handlers = {}
    class Router:
        def register(self, name, handler): handlers[name] = handler
    entries.register(Router())
    text = header + '\nTravel,https://travel.example,private-user,private-password\nOther,https://other.example,other-user,other-password\nBad,http://insecure.example,x,y\n'
    preview = entries.preview(text)
    assert not entries.vault.values and not entries.entries()
    assert preview["rejected"] == 1 and len(preview["entries"]) == 2
    assert "private-user" not in json.dumps(preview) and "private-password" not in json.dumps(preview)
    result = await handlers["vault.import"]({"token": preview["token"], "ids": [0], "members": [0]})
    assert result == {"saved": 1, "remaining": 0} and len(entries.entries()) == 1
    with pytest.raises(RpcError): await handlers["vault.import"]({"token": preview["token"], "ids": [0]})
    preview = entries.preview(text)
    await handlers["vault.cancel"]({"token": preview["token"]})
    assert not entries.previews and len(entries.entries()) == 1
    preview = entries.preview(text)
    entries.previews[preview["token"]] = (0, [])
    with pytest.raises(RpcError): await handlers["vault.import"]({"token": preview["token"], "ids": []})


def test_csv_values_expire_without_another_owner_action_even_after_a_rejected_preview(conn, monkeypatch):
    from types import SimpleNamespace
    callbacks = []
    def later(seconds, callback):
        assert seconds == 600
        callbacks.append(callback)
        return SimpleNamespace(cancel=lambda: None)
    monkeypatch.setattr("asyncio.get_running_loop", lambda: SimpleNamespace(call_later=later))
    entries = VaultEntries(Vault(), conn=conn)
    entries.preview("name,url,username,password\nTravel,https://travel.example,private-user,private-password\n")
    with pytest.raises(ValueError): entries.preview("unsupported")
    assert entries.previews
    callbacks[0]()
    assert not entries.previews and not entries.vault.values


async def test_metadata_edit_does_not_read_or_replace_credentials(conn):
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    handlers = {}
    class Router:
        def register(self, name, handler): handlers[name] = handler
    entries.register(Router())
    before = dict(entries.vault.values)
    entries.vault.get = lambda *_: pytest.fail("Metadata edit read a private value")
    await handlers["vault.update"]({"id": identifier, "label": "Company", "hint": "Travel only", "members": [0]})
    assert entries.entries()[0]["hint"] == "Travel only" and entries.vault.values == before
    assert not entries.choices(9)


def owner_router(entries):
    handlers = {}
    class Router:
        def register(self, name, handler): handlers[name] = handler
    entries.register(Router())
    return handlers["vault.update"]


def stored(entries, identifier):
    row = entries.conn.execute("SELECT credential FROM vault_entries WHERE id=?", (identifier,)).fetchone()
    return json.loads(entries.vault.values[row[0]])


def row_of(entries, identifier):
    return tuple(entries.conn.execute("SELECT id,kind,label,hint,origin,members,credential FROM vault_entries WHERE id=?", (identifier,)).fetchone())


async def test_replacing_a_login_password_keeps_the_username_and_the_entry(conn):
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put({"kind": "login", "label": "Shop", "hint": "Buying", "origin": "https://shop.example", "members": [0],
                              "values": {"username": "private-user", "password": "old-password"}})
    update, before = owner_router(entries), row_of(entries, identifier)
    assert await update({"id": identifier, "values": {"password": "new-password", "username": ""}}) == {"updated": True}
    assert stored(entries, identifier) == {"username": "private-user", "password": "new-password"}
    assert row_of(entries, identifier) == before and len(entries.vault.values) == 1
    assert entries.entry(0, identifier, "login")[1]["password"] == "new-password"
    # The username alone, with the label and hint in the same call.
    await update({"id": identifier, "label": "Shop 2", "hint": "Other", "members": "all", "values": {"username": "other-user"}})
    assert stored(entries, identifier) == {"username": "other-user", "password": "new-password"}
    assert [(r["label"], r["hint"], r["members"]) for r in entries.entries()] == [("Shop 2", "Other", "all")]


async def test_replacing_one_card_field_keeps_the_others(conn):
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put({"kind": "card", "label": "Company", "values": CARD})
    await owner_router(entries)({"id": identifier, "values": {"number": "5500000000000004"}})
    assert stored(entries, identifier) == CARD | {"number": "5500000000000004"}


async def test_a_contact_can_have_some_fields_replaced(conn):
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    await owner_router(entries)({"id": identifier, "values": {"phone": "new-phone", "email": "new-email", "name": ""}})
    assert stored(entries, identifier) == CONTACT | {"phone": "new-phone", "email": "new-email"}


async def test_a_login_saved_from_a_sign_in_card_can_have_its_password_replaced(conn):
    entries = VaultEntries(Vault(), conn=conn)
    reference = entries.reference(4, "https://example.com/login")
    entries.save(reference, json.dumps({"username": "card-user", "password": "card-password"}), member=4, site="https://example.com")
    assert entries.entries()[0]["id"] == reference
    await owner_router(entries)({"id": reference, "values": {"password": "changed-password"}})
    assert json.loads(entries.vault.values["computer-login:" + reference]) == {"username": "card-user", "password": "changed-password"}
    assert entries.load(4, "https://example.com", reference)["password"] == "changed-password"
    assert [r["members"] for r in entries.entries()] == [[4]]


async def test_a_key_value_is_replaced_under_the_same_entry_and_plain_mark(conn):
    entries = VaultEntries(Vault(), conn=conn)
    secret = entries.put_key(3, "API_KEY", "the API", "old-key-value-1")
    plain = entries.put_key(3, "JIRA_SITE", "the site", "old", secret=False)
    update, before, before_plain = owner_router(entries), row_of(entries, secret), row_of(entries, plain)
    await update({"id": secret, "values": {"value": "new-key-value-2"}})
    await update({"id": plain, "values": {"value": "new"}})
    assert row_of(entries, secret) == before and row_of(entries, plain) == before_plain and before_plain[4] == "plain"
    assert entries.key_values(3, ["API_KEY", "JIRA_SITE"]) == ({"API_KEY": "new-key-value-2", "JIRA_SITE": "new"}, [])
    assert "new" not in entries.values.get(3, set()) and len(entries.vault.values) == 2


async def test_empty_values_keep_what_is_saved_and_never_read_it_for_a_metadata_edit(conn):
    entries = VaultEntries(Vault(), conn=conn)
    login = entries.put({"kind": "login", "label": "Shop", "origin": "https://shop.example", "values": {"username": "u", "password": "p"}})
    key = entries.put_key(0, "API_KEY", "the API", "kept-key-value")
    update, before = owner_router(entries), dict(entries.vault.values)
    entries.vault.get = lambda *_: pytest.fail("A change that names no new value read a private value")
    for values in ({}, {"username": "", "password": ""}, {"password": ""}):
        await update({"id": login, "values": values})
    await update({"id": key, "label": "API_KEY", "hint": "now", "members": [0], "values": {"value": ""}})
    assert entries.vault.values == before and {r["hint"] for r in entries.entries()} == {"", "now"}


@pytest.mark.parametrize("values", [
    {"unknown": "x"}, {"username": 5}, {"password": None}, "text", ["password"], {"password": "x" * 401},
])
async def test_a_refused_value_change_changes_nothing_and_names_no_value(conn, values):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put({"kind": "login", "label": "Shop", "hint": "keep", "origin": "https://shop.example", "values": {"username": "u", "password": "p"}})
    update, before, rows = owner_router(entries), dict(entries.vault.values), row_of(entries, identifier)
    with pytest.raises(RpcError) as raised:
        await update({"id": identifier, "label": "Changed", "hint": "changed", "members": [0], "values": values})
    assert "vault_values" in repr(raised.value) and "xxxxx" not in repr(raised.value)
    assert entries.vault.values == before and row_of(entries, identifier) == rows


async def test_a_refused_value_change_covers_every_kind_and_a_bad_target(conn):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    card = entries.put({"kind": "card", "label": "Company", "values": CARD})
    key = entries.put_key(0, "API_KEY", "the API", "kept-key-value")
    contact = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    update, before = owner_router(entries), dict(entries.vault.values)
    for target, values in ((contact, {"address": "a" * 400, "phone": "b" * 400, "email": "c" * 400}), (key, {"value": " padded "}), (key, {"value": "line\nbreak"}), (key, {"value": "nul\x00key"}),
                           (key, {"value": "k" * 1100}), (key, {"other": "x"}), (key, {"value": 5}),
                           (card, {"value": "x"}), (card, {"number": "9" * 401}), ("missing", {"password": "x"})):
        with pytest.raises(RpcError):
            await update({"id": target, "values": values})
    assert entries.vault.values == before
    await update({"id": card, "values": {"cvc": "999"}})
    assert stored(entries, card) == CARD | {"cvc": "999"}
    # A stored credential that cannot be read is refused, never replaced blindly.
    entries.vault.values["computer-entry:" + card] = "not json"
    with pytest.raises(RpcError):
        await update({"id": card, "values": {"number": "1"}})
    entries.vault.values.pop("computer-entry:" + key)
    with pytest.raises(RpcError):
        await update({"id": key, "values": {"value": "new-key-value"}})
    assert entries.vault.values == {"computer-entry:" + card: "not json", "computer-entry:" + contact: before["computer-entry:" + contact]}


async def test_values_and_metadata_change_together_or_not_at_all(conn):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    identifier = entries.put({"kind": "contact", "label": "Travel", "hint": "one", "values": CONTACT})
    update, before = owner_router(entries), dict(entries.vault.values)
    change = {"id": identifier, "label": "Other", "hint": "two", "members": "all", "values": {"phone": "new-phone"}}
    # Bad metadata with good values: nothing is written.
    with pytest.raises(RpcError):
        await update(change | {"label": ""})
    assert entries.vault.values == before and entries.entries()[0]["hint"] == "one"
    # A vault that refuses the write: the metadata stays as it was.
    original = entries.vault.set
    def refuse(*_): raise RuntimeError("private-phone refused")
    entries.vault.set = refuse
    with pytest.raises(RpcError) as raised:
        await update(change)
    assert "private-phone" not in repr(raised.value)
    assert entries.entries()[0]["label"] == "Travel" and entries.vault.values == before
    # A failure after the value was written puts the old value back.
    entries.vault.set = original
    entries.conn.execute("CREATE TRIGGER refuse_update BEFORE UPDATE ON vault_entries BEGIN SELECT RAISE(ABORT, 'no'); END")
    with pytest.raises(RpcError):
        await update(change)
    assert entries.vault.values == before and entries.entries()[0]["label"] == "Travel"


async def test_new_values_are_scrubbed_for_a_reader_already_on_the_computer(conn):
    entries = VaultEntries(Vault(), conn=conn)
    login = entries.put({"kind": "login", "label": "Shop", "origin": "https://shop.example", "values": {"username": "reader-user", "password": "old-password"}})
    key = entries.put_key(0, "API_KEY", "the API", "old-key-value")
    short = entries.put_key(0, "SHORT_KEY", "the other API", "old")
    plain = entries.put_key(0, "JIRA_SITE", "the site", "old-site-name", secret=False)
    entries.preload(7)
    assert entries.redact(7, "x new-password y") == "x new-password y"
    update = owner_router(entries)
    await update({"id": login, "values": {"password": "new-password"}})
    await update({"id": key, "values": {"value": "new-key-value"}})
    await update({"id": short, "values": {"value": "tiny"}})
    await update({"id": plain, "values": {"value": "new-site-name"}})
    assert entries.redact(7, "a new-password b new-key-value c") == "a [private] b [private] c"
    assert entries.redact(7, "old-password") == "[private]"  # earlier values stay registered
    assert entries.redact(7, "tiny new-site-name") == "tiny new-site-name"


def owner_handlers(entries):
    handlers = {}
    class Router:
        def register(self, name, handler): handlers[name] = handler
    entries.register(Router())
    return handlers


async def test_reveal_gives_the_owner_every_kinds_current_values_and_registers_nothing(conn):
    entries = VaultEntries(Vault(), conn=conn)
    login = entries.put({"kind": "login", "label": "Shop", "origin": "https://shop.example", "members": [0],
                         "values": {"username": "private-user", "password": "old-password"}})
    contact = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT | {"phone": ""}})
    card = entries.put({"kind": "card", "label": "Company", "values": CARD})
    secret = entries.put_key(3, "API_KEY", "the API", "secret-key-value")
    plain = entries.put_key(3, "JIRA_SITE", "the site", "plain-site-name", secret=False)
    reference = entries.reference(4, "https://example.com/login")
    entries.save(reference, json.dumps({"username": "card-user", "password": "card-password"}), member=4, site="https://example.com")
    handlers = owner_handlers(entries)
    reveal = handlers["vault.reveal"]
    assert await reveal({"id": login}) == {"values": {"username": "private-user", "password": "old-password"}}
    assert await reveal({"id": contact}) == {"values": CONTACT | {"phone": ""}}
    assert await reveal({"id": card}) == {"values": CARD}
    assert await reveal({"id": secret}) == {"values": {"value": "secret-key-value"}}
    assert await reveal({"id": plain}) == {"values": {"value": "plain-site-name"}}
    assert await reveal({"id": reference}) == {"values": {"username": "card-user", "password": "card-password"}}
    # What is shown is what was last saved, and showing it tells no reader to scrub anything or changes anything.
    await handlers["vault.update"]({"id": login, "values": {"password": "new-password"}})
    assert await reveal({"id": login}) == {"values": {"username": "private-user", "password": "new-password"}}
    after_update = {member: set(seen) for member, seen in entries.values.items()}
    before = dict(entries.vault.values)
    await reveal({"id": card})
    assert entries.vault.values == before and {member: set(seen) for member, seen in entries.values.items()} == after_update


async def test_reveal_refuses_an_unknown_entry_and_an_unreadable_credential_without_naming_a_value(conn):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    contact = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    reveal = owner_handlers(entries)["vault.reveal"]
    for target in ("missing", None, 5, ["x"]):
        with pytest.raises(RpcError) as raised:
            await reveal({"id": target})
        assert "vault_values" in repr(raised.value)
    with pytest.raises(RpcError):
        await reveal({})
    credential = "computer-entry:" + contact
    for broken in ("not json private-phone", json.dumps(["private-phone"]), json.dumps({"name": "private-owner"}),
                   json.dumps(CONTACT | {"phone": 5}), json.dumps(CONTACT | {"extra": "private-extra"})):
        entries.vault.values[credential] = broken
        with pytest.raises(RpcError) as raised:
            await reveal({"id": contact})
        assert "vault_values" in repr(raised.value) and "private" not in repr(raised.value)
    entries.vault.values.pop(credential)
    with pytest.raises(RpcError):
        await reveal({"id": contact})


async def test_an_exact_update_replaces_the_whole_set_and_an_emptied_field_is_cleared(conn):
    entries = VaultEntries(Vault(), conn=conn)
    contact = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    card = entries.put({"kind": "card", "label": "Company", "values": CARD})
    login = entries.put({"kind": "login", "label": "Shop", "hint": "Buying", "origin": "https://shop.example", "members": [0],
                         "values": {"username": "private-user", "password": "old-password"}})
    secret = entries.put_key(3, "API_KEY", "the API", "old-key-value-1")
    plain = entries.put_key(3, "JIRA_SITE", "the site", "old", secret=False)
    update, rows = owner_router(entries), {i: row_of(entries, i) for i in (login, secret, plain)}
    await update({"id": contact, "values": CONTACT | {"phone": ""}, "exact": True})
    assert stored(entries, contact) == CONTACT | {"phone": ""}
    await update({"id": contact, "values": {"name": "", "address": "", "phone": "", "email": "only-email"}, "exact": True})
    assert stored(entries, contact) == {"name": "", "address": "", "phone": "", "email": "only-email"}
    await update({"id": card, "values": CARD | {"expiry": "", "cvc": ""}, "exact": True})
    assert stored(entries, card) == CARD | {"expiry": "", "cvc": ""}
    entries.preload(7)
    await update({"id": login, "values": {"username": "other-user", "password": "new-password"}, "exact": True})
    await update({"id": secret, "values": {"value": "new-key-value-2"}, "exact": True})
    await update({"id": plain, "values": {"value": "new"}, "exact": True})
    assert stored(entries, login) == {"username": "other-user", "password": "new-password"}
    assert entries.key_values(3, ["API_KEY", "JIRA_SITE"]) == ({"API_KEY": "new-key-value-2", "JIRA_SITE": "new"}, [])
    assert {i: row_of(entries, i) for i in (login, secret, plain)} == rows and rows[plain][4] == "plain"
    assert entries.redact(7, "a new-password b new-key-value-2 c") == "a [private] b [private] c"
    # With the metadata in the same call, and the values still exact.
    await update({"id": contact, "label": "Other", "hint": "two", "members": "all", "values": CONTACT, "exact": True})
    assert stored(entries, contact) == CONTACT and {r["id"]: r["label"] for r in entries.entries()}[contact] == "Other"


async def test_an_exact_update_is_checked_as_a_new_entry_and_changes_nothing_when_refused(conn):
    from raphael_core.protocol import RpcError
    entries = VaultEntries(Vault(), conn=conn)
    login = entries.put({"kind": "login", "label": "Shop", "origin": "https://shop.example", "values": {"username": "u", "password": "p"}})
    contact = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    card = entries.put({"kind": "card", "label": "Company", "values": CARD})
    key = entries.put_key(0, "API_KEY", "the API", "kept-key-value")
    update, before, rows = owner_router(entries), dict(entries.vault.values), {i: row_of(entries, i) for i in (login, contact, card, key)}
    empty = {"name": "", "address": "", "phone": "", "email": ""}
    for target, values in ((login, {"username": "u", "password": ""}), (login, {"username": "", "password": "p"}),
                           (login, {"username": "u"}), (login, {"password": "private-new"}), (login, {"username": "u", "password": "p", "extra": "x"}),
                           (login, {"username": "u", "password": "x" * 401}), (login, {"username": "u", "password": 5}),
                           (contact, empty), (contact, {"phone": "private-new"}), (contact, CONTACT | {"phone": None}),
                           (contact, {"name": "a" * 400, "address": "b" * 400, "phone": "c" * 400, "email": "d" * 400}),
                           (card, {"name": "", "number": "", "expiry": "", "cvc": ""}), (card, {"value": "x"}), (card, {"number": "5500000000000004"}),
                           (key, {"value": ""}), (key, {}), (key, {"value": " padded "}), (key, {"value": "line\nbreak"}),
                           (key, {"value": "k" * 1100}), (key, {"value": "k", "other": "x"}), (key, {"value": 5}), ("missing", {"value": "x"}),
                           (contact, "text"), (contact, ["phone"])):
        with pytest.raises(RpcError) as raised:
            await update({"id": target, "label": "Changed", "hint": "changed", "members": [0], "values": values, "exact": True})
        assert "vault_values" in repr(raised.value) and "private-new" not in repr(raised.value)
    for exact in ("yes", 1, []):
        with pytest.raises(RpcError):
            await update({"id": contact, "values": CONTACT | {"phone": ""}, "exact": exact})
    assert entries.vault.values == before and {i: row_of(entries, i) for i in (login, contact, card, key)} == rows
    # A credential that cannot be read is refused, never replaced blindly.
    entries.vault.values["computer-entry:" + contact] = "not json"
    with pytest.raises(RpcError):
        await update({"id": contact, "values": CONTACT, "exact": True})


async def test_an_update_without_exact_still_merges_and_keeps_an_emptied_field(conn):
    entries = VaultEntries(Vault(), conn=conn)
    contact = entries.put({"kind": "contact", "label": "Travel", "values": CONTACT})
    login = entries.put({"kind": "login", "label": "Shop", "origin": "https://shop.example", "values": {"username": "u", "password": "p"}})
    update = owner_router(entries)
    for exact in ({}, {"exact": False}):
        await update({"id": contact, "values": {"phone": "new-phone", "email": ""}} | exact)
        assert stored(entries, contact) == CONTACT | {"phone": "new-phone"}
        await update({"id": login, "values": {"password": ""}} | exact)
        assert stored(entries, login) == {"username": "u", "password": "p"}


async def test_shared_login_revocation_between_fields_stops_before_the_password(desktop, conn, tmp_path):
    vm, target, _ = desktop
    filled = []
    class Browser(CatalogBridge):
        @measured(("name", "number", "expiry", "cvc", "username", "password"))
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "list_windows":
                return window_reply(self.target)
            if method == "tools/list":
                return catalog(("get_browser_state", "browser_type"))
            if params["name"] == "browser_type":
                filled.append(params["arguments"]["text"])
                with conn:
                    conn.execute("UPDATE vault_entries SET members='[]' WHERE id=?", (identifier,))
            return {"structuredContent": {"target_id": "tab", "tab_id": "tab-1", "page": {"url": "https://shop.example/login"}}}
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "login", "label": "Travel", "origin": "https://shop.example", "values": {"username": "private-user", "password": "private-password"}})
    await hub.prepare()
    await bind_page(hub, target)
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        result = await hub.call(next(t.key for t in hub.offered() if t.name == "fill_login"), {"reference": identifier, "site": "https://shop.example", "target_id": "tab", "username_ref": member_ref(hub, vm.target(0), "tab", "username"), "password_ref": member_ref(hub, vm.target(0), "tab", "password")}, approver="user")
    assert not result.ok and filled == ["private-user"]
    await hub.aclose()


@pytest.mark.parametrize("mode", ["normal", "ask", "plan", "bypass"])
async def test_card_always_needs_an_exact_single_use_approval_and_never_submits(desktop, conn, tmp_path, caplog, mode):
    vm, target, _ = desktop
    calls = []
    class Browser(CatalogBridge):
        @measured(("name", "number", "expiry", "cvc", "username", "password"))
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "list_windows":
                return window_reply(self.target)
            if method == "tools/list":
                return catalog(("get_browser_state", "browser_type", "browser_pointer", "browser_navigate"))
            calls.append(params)
            return {"structuredContent": {"target_id": "tab", "tab_id": "tab-1", "page": {"url": "https://shop.example/checkout"}, "total": "NT$ 1,280", **CARD},
                    "content": [{"type": "text", "text": json.dumps(CARD)}]}
    SettingsStore(conn).set("action_mode", "direct" if mode == "normal" else mode)
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "card", "label": "Company", "hint": "Travel only", "values": CARD})
    gate = ToolGate(hub, conn=conn)
    await hub.prepare()
    await bind_page(hub, target)
    calls.clear()
    tools = {t.name: t.key for t in hub.offered()}
    args = {"reference": identifier, "label": "Company", "site": "https://shop.example", "amount": "NT$ 1,280", "target_id": "tab", "fields": {key: member_ref(hub, vm.target(0), "tab", key) for key in CARD}}
    assert gate.needs_confirmation(tools["fill_card"], args)
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        assert not (await gate.call_plugin(tools["fill_card"], args)).ok
        assert not calls
        action = Action(tools["fill_card"], args)
        confirmations = Confirmations(lambda: 0)
        pending = confirmations.open("test", 7, action, Tier.T3, "en")
        approval = confirmations.resolve(pending.id, True, pending.digest).approval
        result = await gate.call_plugin(tools["fill_card"], args, action=action, approval=approval)
        assert result.ok and json.loads(result.text)["owner_finishes"]
        assert not (await gate.call_plugin(tools["fill_card"], args, action=action, approval=approval)).ok
        for name, arguments in (("browser_pointer", {}), ("browser_navigate", {"url": "https://shop.example/pay"}), ("vm_exec", {"command": "echo submit"}), ("run_steps", {"steps": [{"name": "browser_pointer", "arguments": {}}], "observe": {"name": "get_browser_state", "arguments": {}}})):
            blocked = await hub.call(tools[name], arguments, approver="user")
            assert not blocked.ok
        observed = await hub.call(tools["get_browser_state"], {"target_id": "tab", "tab_id": "tab-1"}, approver="user")
        assert observed.ok
    assert [call["name"] for call in calls].count("browser_type") == 4
    assert all(call["arguments"]["tab_id"] == "tab-1" for call in calls if call["name"] == "browser_type")
    assert all(call["name"] in ("browser_type", "get_browser_state", "set_config", "set_agent_cursor_enabled") for call in calls)
    seen = repr(result) + repr(observed) + caplog.text + repr(list(conn.iterdump()))
    for value in CARD.values(): assert value not in seen
    restarted = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    assert target.key in restarted.payment_holds
    await hub.aclose()


async def test_worker_pauses_for_card_even_when_all_actions_are_allowed(desktop, conn, tmp_path):
    from types import SimpleNamespace
    from background.test_run import Rig
    from raphael_core.protocol import RpcError
    vm, _, _ = desktop
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=CatalogBridge)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "card", "label": "Company", "values": CARD})
    SettingsStore(conn).set("action_mode", "bypass")
    await hub.prepare()
    rig = Rig(conn, SimpleNamespace(hub=hub), can_wait=True)
    try:
        found = await rig.tool("find_tools", {"query": "fill_card"})
        # Found, and called through use_tool: it is never listed (decision 2).
        assert found["ok"] and "computer__fill_card" in found["content"] and "computer__fill_card" not in rig.run.snapshot.listed()
        with vm_scope(("turn", 0, 7), turn_id=7, private=True):
            with pytest.raises(RpcError):
                await rig.tool("use_tool", {"name": "computer__fill_card", "arguments": {
                    "reference": identifier, "label": "Company", "site": "https://shop.example", "target_id": "tab",
                    "amount": "NT$ 1,280", "fields": {"number": "n"}}})
        assert rig.run.waiting is not None and rig.run.waiting.ref.name == "fill_card"
        assert not hub.connections
    finally:
        await rig.meteo.http.aclose()
        await hub.aclose()


@pytest.mark.parametrize("failure", [None, "origin", "amount", "echo", "revoked", "revoked_during_fill"])
async def test_private_fill_fails_closed_and_never_returns_driver_values(desktop, conn, tmp_path, caplog, failure):
    vm, target, _ = desktop
    calls = []
    values = {key: value + '-"\\\n密碼' for key, value in CARD.items()}
    class Browser(CatalogBridge):
        @measured(("name", "number", "expiry", "cvc", "username", "password"))
        async def request(self, method, params=None):
            if method == "tools/call" and params["name"] == "list_windows":
                return window_reply(self.target)
            if method == "tools/list":
                return catalog(("get_browser_state", "browser_type"))
            calls.append(params)
            if params["name"] == "browser_type" and failure == "echo": raise ValueError(json.dumps(values))
            if params["name"] == "browser_type" and failure == "revoked_during_fill":
                with conn:
                    conn.execute("UPDATE vault_entries SET members='[]' WHERE id=?", (identifier,))
            return {"structuredContent": {"target_id": "tab", "tabs": [{"tab_id": "tab-1", "active": True, "url": "https://evil.example" if failure == "origin" else "https://shop.example/checkout"}], "total": "NT$ 1,280"}}
    hub = VmTools(EmptyHub(), vm, conn=conn, attachments=AttachmentStore(tmp_path), bridge=Browser)
    hub.logins = VaultEntries(Vault(), conn=conn)
    identifier = hub.logins.put({"kind": "card", "label": "Company", "values": values, "members": [0]})
    await hub.prepare()
    await bind_page(hub, target)
    if failure == "revoked": conn.execute("UPDATE vault_entries SET members='[]' WHERE id=?", (identifier,)); conn.commit()
    with vm_scope(("turn", 0, 7), turn_id=7, private=True):
        result = await hub.call(next(t.key for t in hub.offered() if t.name == "fill_card"), {"reference": identifier, "label": "Company", "site": "https://shop.example", "target_id": "tab", "amount": "NT$ 99" if failure == "amount" else "NT$ 1,280", "fields": {key: member_ref(hub, vm.target(0), "tab", key) for key in values}}, approver="user")
    assert result.ok is (failure is None)
    if failure in ("origin", "amount", "revoked"): assert not any(call["name"] == "browser_type" for call in calls)
    if failure == "revoked_during_fill": assert sum(call["name"] == "browser_type" for call in calls) == 1
    seen = repr(result) + caplog.text + repr(list(conn.iterdump()))
    for value in values.values():
        assert value not in seen and json.dumps(value)[1:-1] not in seen
    await hub.aclose()
