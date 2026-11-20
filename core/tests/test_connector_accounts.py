"""The accounts of an app (R-ACCT-01): a sign-in that was given up leaves no account, and every account can be removed.
Every request stops at an HTTP double of Composio."""

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import pytest

from raphael_core.connectors.cards import CAUSES, _cause_of
from raphael_core.connectors.google import scopes_for
from raphael_core.connectors.http import ConnectorFailure
from raphael_core.connectors.service import SIGN_IN_LIMIT_S
from raphael_core.connectors.store import Connector, ConnectorStore
from raphael_core.protocol import RpcError

from test_connectors import Platform, no_wait, setup_service

NOW = 1_800_000_000.0


def iso(seconds_ago: float) -> str:
    return datetime.fromtimestamp(NOW - seconds_ago, timezone.utc).isoformat().replace("+00:00", "Z")


class Accounts(Platform):
    """Composio with the connected accounts it lists, and every DELETE of one written down."""

    def __init__(self, listing=(), *, delete_status=200, revoke_ok=True, statuses=("ACTIVE",)):
        super().__init__(list(statuses))
        self.listing, self.deleted = [dict(a) for a in listing], []
        self.delete_status, self.revoke_ok = delete_status, revoke_ok

    def __call__(self, request):
        path = request.url.path.removeprefix("/api/v3.1")
        if request.method == "DELETE" and path.startswith("/connected_accounts/"):
            self.requests.append(request)
            if self.delete_status != 200:
                return httpx.Response(self.delete_status, json={})
            self.deleted.append((path.rsplit("/", 1)[1], request.url.params.get("revoke_on_delete") == "true"))
            return httpx.Response(200, json={"success": self.revoke_ok})
        if request.method == "GET" and path == "/connected_accounts":
            self.requests.append(request)
            return httpx.Response(200, json={"items": self.listing})
        return super().__call__(request)

    def ids_deleted(self):
        return [ident for ident, _ in self.deleted]


def account(ident, status, *, since=None, label=""):
    """A row of the local list; `since` is when Raphael began the sign-in."""
    return {"id": ident, "status": status, "label": label, **({"since": NOW - since} if since is not None else {})}


def listed(ident, status, ago=None):
    return {"id": ident, "status": status, "toolkit": {"slug": "gmail"}, **({"created_at": iso(ago)} if ago is not None else {})}


def make(tmp_path, conn, fake, accounts=(), **options):
    router, service, hub, vault = setup_service(tmp_path, conn, fake, sleep=no_wait, wall=lambda: NOW, **options)
    vault.set("connectors:composio:key", "ak_private")
    entry = Connector("composio:gmail", "composio", status="ACTIVE", name="Gmail", accounts=list(accounts))
    service.store.connectors[entry.id] = entry
    return router, service, hub, entry


async def test_a_waiting_sign_in_older_than_the_limit_is_given_back_when_the_accounts_are_read_from_composio(tmp_path, conn):
    fake = Accounts([listed("ca_active", "ACTIVE", 99999), listed("ca_old", "INITIATED", SIGN_IN_LIMIT_S + 60),
                     listed("ca_older", "INITIALIZING", 5000), listed("ca_young", "INITIATED", 120)])
    router, service, hub, entry = make(tmp_path, conn, fake)
    result = await router.call("connectors.status")
    assert fake.deleted == [("ca_old", False), ("ca_older", False)]
    ids = [a["id"] for a in result["connectors"][0]["accounts"]]
    assert ids == ["ca_active", "ca_young"]
    assert result["connectors"][0]["status"] == "ACTIVE"
    assert [a["id"] for a in hub.connections()[0]["accounts"]] == ["ca_active", "ca_young"]
    assert [a["id"] for a in ConnectorStore(tmp_path).connectors["composio:gmail"].accounts] == ["ca_active", "ca_young"]


async def test_the_local_list_is_swept_too_without_asking_composio_for_everything(tmp_path, conn):
    fake = Accounts()
    router, service, hub, entry = make(tmp_path, conn, fake, [
        account("ca_active", "ACTIVE", since=99999), account("ca_old", "INITIATED", since=SIGN_IN_LIMIT_S + 1),
        account("ca_young", "INITIALIZING", since=30), account("ca_legacy", "INITIATED")])
    result = await router.call("connectors.status", {"refresh": False})
    assert sorted(fake.ids_deleted()) == ["ca_legacy", "ca_old"]  # an earlier build left no time on its rows: they count as old
    assert [a["id"] for a in result["connectors"][0]["accounts"]] == ["ca_active", "ca_young"]
    assert all(not revoke for _, revoke in fake.deleted)
    # nothing is stale now: a second read asks Composio for nothing
    before = len(fake.requests)
    await router.call("connectors.status", {"refresh": False})
    assert len(fake.requests) == before


async def test_an_active_account_is_never_given_back_however_old(tmp_path, conn):
    fake = Accounts([listed("ca_a", "ACTIVE", 10**7), listed("ca_b", "ACTIVE")])
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_a", "ACTIVE", since=10**7), account("ca_b", "ACTIVE")])
    await router.call("connectors.status", {"refresh": False})
    await router.call("connectors.status")
    assert fake.deleted == []
    assert [a["id"] for a in entry.accounts] == ["ca_a", "ca_b"]


async def test_the_sign_in_being_waited_for_is_not_swept_even_past_the_limit(tmp_path, conn):
    fake = Accounts()
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_now", "INITIATED", since=SIGN_IN_LIMIT_S + 5)])
    service._signing_in.add("ca_now")
    await router.call("connectors.status", {"refresh": False})
    assert fake.deleted == [] and [a["id"] for a in entry.accounts] == ["ca_now"]


async def test_composio_unreachable_leaves_the_old_row_for_the_next_read(tmp_path, conn):
    fake = Accounts(delete_status=503)
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_old", "INITIATED", since=SIGN_IN_LIMIT_S + 1)])
    result = await router.call("connectors.status", {"refresh": False})
    assert "error" not in result and [a["id"] for a in result["connectors"][0]["accounts"]] == ["ca_old"]
    fake.delete_status = 200
    result = await router.call("connectors.status", {"refresh": False})
    assert fake.ids_deleted() == ["ca_old"] and result["connectors"][0]["accounts"] == []
    assert result["connectors"][0]["status"] == "INACTIVE"


async def test_a_sign_in_nobody_finishes_ends_at_the_limit_and_leaves_no_account(tmp_path, conn):
    clock = [0]

    async def wait(seconds):
        clock[0] += seconds

    async def browser(url):
        pass

    fake = Accounts(statuses=("INITIATED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, open_browser=browser, sleep=wait,
                                                now=lambda: clock[0], wall=lambda: NOW + clock[0])
    await router.call("connectors.set_key", {"key": "ak_private"})
    result = await router.call("connectors.connect", {"toolkit": "gmail"})
    assert result["error"] == "timeout" and clock[0] == 600
    assert fake.deleted == [("ca_test", False)]
    assert result["connector"]["accounts"] == []
    assert service.store.connectors["composio:gmail"].accounts == []
    assert service._signing_in == set()


@pytest.mark.parametrize("how", ["cancel", "browser-error", "protocol"])
async def test_a_sign_in_that_is_closed_or_fails_on_the_way_leaves_no_account(tmp_path, conn, how):
    entered, opened = asyncio.Event(), []

    async def browser(url):
        opened.append(url)
        if len(opened) > 1:
            return  # the sign-in that follows is let through
        if how == "browser-error":
            raise RuntimeError("private")
        entered.set()
        if how == "cancel":
            await asyncio.Event().wait()

    fake = Accounts(statuses=("INITIATED", "SURPRISE") if how == "protocol" else ("INITIATED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, open_browser=browser, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    task = asyncio.create_task(router.call("connectors.connect", {"toolkit": "gmail"}))
    if how == "cancel":
        await asyncio.wait_for(entered.wait(), 2)
        assert [a["status"] for a in service.store.connectors["composio:gmail"].accounts] == ["INITIALIZING"]
        assert (await router.call("integrations.connect_cancel")) == {"cancelled": True}
    result = await task
    assert result.get("connected") is not True
    assert result["error"] == {"cancel": "cancelled", "browser-error": "browser", "protocol": "protocol"}[how]
    assert fake.deleted == [("ca_test", False)]
    assert service.store.connectors["composio:gmail"].accounts == []
    assert not service.login_pending and service._signing_in == set()
    # the wait is over, so another sign-in can begin at once
    fake.statuses = ["ACTIVE"]
    assert (await router.call("connectors.connect", {"toolkit": "gmail"}))["connected"] is True


async def test_a_sign_in_that_failed_at_composio_keeps_its_row_to_be_removed_by_hand(tmp_path, conn):
    async def browser(url):
        pass

    fake = Accounts(statuses=("FAILED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, open_browser=browser, sleep=no_wait)
    await router.call("connectors.set_key", {"key": "ak_private"})
    result = await router.call("connectors.connect", {"toolkit": "gmail"})
    assert result["error"] == "failed" and fake.deleted == []
    assert [a["status"] for a in result["connector"]["accounts"]] == ["FAILED"]
    await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_test"})
    assert fake.deleted == [("ca_test", False)]


@pytest.mark.parametrize("status", ["INITIATED", "INITIALIZING", "EXPIRED", "REVOKED", "FAILED", "INACTIVE"])
async def test_a_row_that_is_not_active_is_removed_at_once(tmp_path, conn, status):
    fake = Accounts()
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_keep", "ACTIVE"), account("ca_row", status, since=10)])
    result = await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_row"})
    assert fake.deleted == [("ca_row", False)]  # nothing to revoke: it never held a login
    assert [a["id"] for a in result["connector"]["accounts"]] == ["ca_keep"]
    assert result["connector"]["status"] == "ACTIVE"
    assert [a["id"] for a in ConnectorStore(tmp_path).connectors["composio:gmail"].accounts] == ["ca_keep"]


async def test_removing_an_account_of_an_app_with_no_other_leaves_the_app_not_connected(tmp_path, conn):
    fake = Accounts()
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_row", "EXPIRED")])
    entry.status = "EXPIRED"
    result = await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_row"})
    assert result["connector"]["accounts"] == [] and result["connector"]["status"] == "INACTIVE"


async def test_removing_an_active_account_revokes_it_and_the_others_carry_on(tmp_path, conn):
    fake = Accounts()
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_work", "ACTIVE", label="Work"),
                                                              account("ca_me", "ACTIVE", label="Me"),
                                                              account("ca_wait", "INITIATED", since=5)])
    entry.enabled_tools = ["GMAIL_FETCH_EMAILS"]
    result = await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_work"})
    assert fake.deleted == [("ca_work", True)]
    assert [(a["id"], a["label"]) for a in result["connector"]["accounts"]] == [("ca_me", "Me"), ("ca_wait", "")]
    assert [a["id"] for a in hub.connections()[0]["accounts"]] == ["ca_me", "ca_wait"]
    assert entry.status == "ACTIVE" and entry.enabled_tools == ["GMAIL_FETCH_EMAILS"]


async def test_an_active_account_that_composio_would_not_revoke_stays(tmp_path, conn):
    fake = Accounts(revoke_ok=False)
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_work", "ACTIVE"), account("ca_me", "ACTIVE")])
    result = await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_work"})
    assert result["ok"] is False and result["error"] == "revocation_failed"
    assert [a["id"] for a in entry.accounts] == ["ca_work", "ca_me"]
    fake.revoke_ok, fake.delete_status = True, 503
    result = await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_work"})
    assert result["ok"] is False and [a["id"] for a in entry.accounts] == ["ca_work", "ca_me"]


async def test_the_last_active_account_is_the_app_and_removing_it_disconnects_the_app(tmp_path, conn):
    fake = Accounts()
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_me", "ACTIVE"), account("ca_wait", "INITIATED", since=5)])
    result = await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_me"})
    assert result == {"disconnected": True}
    assert "composio:gmail" not in service.store.connectors
    assert sorted(fake.deleted) == [("ca_me", True), ("ca_wait", True)]  # the app's existing disconnect path: all of them go


async def test_remove_account_checks_what_it_is_asked_to_remove(tmp_path, conn):
    router, service, hub, entry = make(tmp_path, conn, Accounts(), [account("ca_me", "ACTIVE")])
    for params in ({"id": "composio:gmail", "account_id": "nobody"}, {"id": "composio:nothing", "account_id": "ca_me"},
                   {"id": "composio:gmail"}):
        with pytest.raises(RpcError):
            await router.call("connectors.remove_account", params)
    service.store.connectors["google"] = Connector("google", "google", accounts=[account("me", "ACTIVE")])
    with pytest.raises(RpcError):
        await router.call("connectors.remove_account", {"id": "google", "account_id": "me"})


async def test_a_waiting_sign_in_does_not_stop_the_list_from_being_read(tmp_path, conn):
    """The app reads the list while a sign-in waits in the browser; the read neither waits for it nor touches its account."""
    entered = asyncio.Event()

    async def browser(url):
        entered.set()
        await asyncio.Event().wait()

    fake = Accounts(statuses=("INITIATED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, open_browser=browser, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    task = asyncio.create_task(router.call("connectors.connect", {"toolkit": "gmail"}))
    await asyncio.wait_for(entered.wait(), 2)
    service.store.connectors["composio:gmail"].accounts[0]["since"] = NOW - SIGN_IN_LIMIT_S - 1  # past the limit, still waited for
    result = await asyncio.wait_for(router.call("connectors.status", {"refresh": False}), 2)
    assert [a["status"] for a in result["connectors"][0]["accounts"]] == ["INITIALIZING"] and fake.deleted == []
    await router.call("integrations.connect_cancel")
    assert (await task)["error"] == "cancelled" and fake.deleted == [("ca_test", False)]

async def test_removing_the_account_whose_sign_in_is_waiting_ends_that_sign_in_and_removes_it_at_once(tmp_path, conn):
    """The owner pressed 移除 on 帳號 2 (等待登入) again and again and it stayed: the sign-in waiting in the browser holds the
    connector lock for its whole wait, so the removal queued behind it until it timed out. It ends that sign-in instead."""
    entered = asyncio.Event()

    async def browser(url):
        entered.set()
        await asyncio.Event().wait()

    fake = Accounts(statuses=("INITIATED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, open_browser=browser, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    alex = Connector("composio:gmail", "composio", status="ACTIVE", name="Gmail", accounts=[account("ca_main", "ACTIVE", label="Alex")])
    service.store.connectors[alex.id] = alex
    task = asyncio.create_task(router.call("connectors.connect", {"toolkit": "gmail"}))
    await asyncio.wait_for(entered.wait(), 2)
    assert [(a["id"], a["status"]) for a in alex.accounts] == [("ca_main", "ACTIVE"), ("ca_test", "INITIALIZING")]
    result = await asyncio.wait_for(router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_test"}), 2)
    assert fake.deleted == [("ca_test", False)]  # given back at Composio, never revoked: it held no login
    assert [a["id"] for a in result["connector"]["accounts"]] == ["ca_main"] and result["connector"]["status"] == "ACTIVE"
    assert [a["id"] for a in ConnectorStore(tmp_path).connectors["composio:gmail"].accounts] == ["ca_main"]
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"  # the page that waited for it is told it ended
    assert not service.login_pending and service._signing_in == set()
    # and it stays gone: the next read of Composio lists nothing waiting
    fake.listing = [listed("ca_main", "ACTIVE", 99999)]
    result = await router.call("connectors.status")
    assert [a["id"] for a in result["connectors"][0]["accounts"]] == ["ca_main"]


async def test_removing_another_account_while_a_sign_in_waits_leaves_that_sign_in_alone(tmp_path, conn):
    entered = asyncio.Event()

    async def browser(url):
        entered.set()
        await asyncio.Event().wait()

    fake = Accounts(statuses=("INITIATED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, open_browser=browser, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    old = Connector("composio:gmail", "composio", status="ACTIVE", name="Gmail",
                    accounts=[account("ca_main", "ACTIVE"), account("ca_gone", "EXPIRED", since=3000)])
    service.store.connectors[old.id] = old
    task = asyncio.create_task(router.call("connectors.connect", {"toolkit": "gmail"}))
    await asyncio.wait_for(entered.wait(), 2)
    result = await asyncio.wait_for(router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_gone"}), 2)
    assert fake.deleted == [("ca_gone", False)] and service.login_pending and not task.done()
    assert [a["id"] for a in result["connector"]["accounts"]] == ["ca_main", "ca_test"]
    await router.call("integrations.connect_cancel")
    assert (await task)["error"] == "cancelled"


async def sign_in_waiting_for(tmp_path, conn, *, stage="browser", accounts=()):
    """A Gmail sign-in that waits (in the browser, or for Composio to say it is done), with GitHub connected beside it."""
    entered = asyncio.Event()

    async def browser(url):
        if stage == "browser":
            entered.set()
            await asyncio.Event().wait()

    class Waiting(Accounts):
        def __call__(self, request):
            if stage == "polling" and request.method == "GET" and request.url.path.endswith("/connected_accounts/ca_test"):
                entered.set()
            return super().__call__(request)

    async def sleep(seconds):
        await asyncio.sleep(0.01)

    fake = Waiting(statuses=("INITIATED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, open_browser=browser, sleep=sleep, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    github = Connector("composio:github", "composio", status="ACTIVE", name="GitHub", accounts=[account("ca_gh", "ACTIVE", label="Me")])
    github.enabled_tools = ["GITHUB_A"]
    service.store.connectors[github.id] = github
    if accounts:
        service.store.connectors["composio:gmail"] = Connector("composio:gmail", "composio", status="ACTIVE", name="Gmail", accounts=list(accounts))
    task = asyncio.create_task(router.call("connectors.connect", {"toolkit": "gmail"}))
    await asyncio.wait_for(entered.wait(), 2)
    return router, service, fake, task


@pytest.mark.parametrize("stage", ["browser", "polling"])
@pytest.mark.parametrize("method,params", [
    ("connectors.disconnect", {"id": "composio:github"}),
    ("connectors.label", {"id": "composio:github", "account_id": "ca_gh", "label": "Work"}),
    ("connectors.set_tools", {"id": "composio:github", "enabled": False}),
    ("connectors.tools", {"id": "composio:github"}),
], ids=["disconnect", "rename", "switch", "tools"])
async def test_nothing_else_of_the_connections_waits_behind_a_sign_in_that_waits(tmp_path, conn, stage, method, params):
    """The owner works on the apps while a sign-in waits in the browser (up to ten minutes): what they press is done, not queued
    behind the lock until it runs out its 30 seconds and fails."""
    router, service, fake, task = await sign_in_waiting_for(tmp_path, conn, stage=stage)
    try:
        result = await asyncio.wait_for(router.call(method, params), 2)
        assert not (isinstance(result, dict) and result.get("ok") is False), result
        assert service.login_pending and not task.done()  # and the sign-in goes on
    finally:
        await router.call("integrations.connect_cancel")
        assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"
    expected = [("ca_gh", True), ("ca_test", False)] if method == "connectors.disconnect" else [("ca_test", False)]
    assert sorted(fake.deleted) == sorted(expected)


async def test_a_switch_pressed_while_a_sign_in_waits_is_not_undone_when_the_sign_in_ends(tmp_path, conn):
    router, service, fake, task = await sign_in_waiting_for(tmp_path, conn)
    try:
        result = await asyncio.wait_for(router.call("connectors.set_tools", {"id": "composio:github", "enabled": False}), 2)
        assert result["connector"]["enabled"] is False
    finally:
        await router.call("integrations.connect_cancel")
        await asyncio.wait_for(task, 2)
    assert service.store.connectors["composio:github"].enabled is False
    patched = [json.loads(r.content) for r in fake.requests if r.method == "PATCH" and "/tool_router/session/" in r.url.path]
    assert patched and "github" not in patched[-1]["toolkits"]["enable"]  # the permission the sign-in gave back is the switched state, not the old one


@pytest.mark.parametrize("stage", ["browser", "polling"])
async def test_disconnecting_the_app_a_sign_in_waits_for_ends_that_sign_in_too(tmp_path, conn, stage):
    """Alex is connected and a second account waits: disconnecting the app is the owner's last word on all of it."""
    router, service, fake, task = await sign_in_waiting_for(tmp_path, conn, stage=stage, accounts=[account("ca_main", "ACTIVE", label="Alex")])
    result = await asyncio.wait_for(router.call("connectors.disconnect", {"id": "composio:gmail"}), 2)
    assert result == {"disconnected": True}
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"  # no failure shown for a wait that was ended on purpose
    assert "composio:gmail" not in service.store.connectors and not service.login_pending and service._signing_in == set()
    assert sorted(a for a, _ in fake.deleted) == ["ca_main", "ca_test"]
    assert "composio:gmail" not in ConnectorStore(tmp_path).connectors


@pytest.mark.parametrize("stage", ["browser", "polling"])
async def test_removing_the_waiting_account_works_in_every_stage_of_the_wait(tmp_path, conn, stage):
    router, service, fake, task = await sign_in_waiting_for(tmp_path, conn, stage=stage)
    result = await asyncio.wait_for(router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_test"}), 2)
    assert result["connector"]["accounts"] == [] and result["connector"]["status"] == "INACTIVE"
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"
    assert fake.deleted == [("ca_test", False)] and not service.login_pending


async def test_removing_the_waiting_account_twice_is_one_removal(tmp_path, conn):
    """The owner presses 移除 again while the first press is still ending the sign-in."""
    router, service, fake, task = await sign_in_waiting_for(tmp_path, conn)
    params = {"id": "composio:gmail", "account_id": "ca_test"}
    first, second = await asyncio.wait_for(asyncio.gather(router.call("connectors.remove_account", params),
                                                          router.call("connectors.remove_account", params), return_exceptions=True), 5)
    assert not isinstance(first, Exception) and first["connector"]["accounts"] == []
    assert not isinstance(second, Exception) or "No such connected account" in str(second)  # the account is already gone
    assert fake.deleted == [("ca_test", False)]  # given back once
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"


async def test_disconnecting_an_app_twice_at_once_is_one_disconnect_and_one_plain_refusal(tmp_path, conn):
    router, service, hub, entry = make(tmp_path, conn, Accounts(), [account("ca_me", "ACTIVE")])
    async with service._lock:  # both presses find the app, and both wait for the lock
        presses = [asyncio.create_task(service.disconnect({"id": "composio:gmail"})) for _ in range(2)]
        await asyncio.sleep(0.05)
    first, second = await asyncio.gather(*presses, return_exceptions=True)
    assert first == {"disconnected": True}
    assert isinstance(second, RpcError) and "no such connector" in str(second).lower()  # not an internal error


async def test_a_waiting_account_that_composio_will_not_give_back_stays_and_says_so(tmp_path, conn):
    """Composio cannot be reached when the sign-in is ended: the row stays, the removal fails in the usual way, a later one works."""
    router, service, fake, task = await sign_in_waiting_for(tmp_path, conn)
    fake.delete_status = 503
    result = await asyncio.wait_for(router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_test"}), 5)
    assert result["ok"] is False
    assert [a["id"] for a in service.store.connectors["composio:gmail"].accounts] == ["ca_test"]
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"
    fake.delete_status = 200
    result = await router.call("connectors.remove_account", {"id": "composio:gmail", "account_id": "ca_test"})
    assert result["connector"]["accounts"] == [] and fake.deleted == [("ca_test", False)]


# ---- The built-in Google sign-in waits in the browser too (R-ACCT-03): it takes the lock to set up and to finish, never for the wait.

class GoogleBrowser:
    """The two outside parties of the Google sign-in, without a browser or a socket: the page the owner is sent to and the
    loopback address the answer comes back to. `answer` is what the owner does in the browser."""

    def __init__(self):
        self.opened, self.listeners, self.closed = [], 0, 0
        self.again()

    def again(self):
        self.entered = asyncio.Event()
        self.answer = asyncio.get_running_loop().create_future()

    async def open(self, url):
        self.opened.append(url)

    def listener(self, state, timeout):
        browser = self

        class Callback:
            redirect_uri = "http://127.0.0.1:1/callback"

            async def wait(self):
                browser.entered.set()
                return await browser.answer

        @asynccontextmanager
        async def loopback():
            browser.listeners += 1
            try:
                yield Callback()
            finally:
                browser.closed += 1
        return loopback()


class GoogleWorld(Accounts):
    """Composio, and Google's token, profile and revocation, as HTTP doubles."""

    def __call__(self, request):
        if request.url.host == "oauth2.googleapis.com":
            if request.url.path == "/revoke":
                return httpx.Response(200, json={})
            return httpx.Response(200, json={"access_token": "access-private", "expires_in": 3600, "token_type": "Bearer",
                                             "refresh_token": "refresh-private", "scope": " ".join(scopes_for("write", "write"))})
        if request.url.host == "gmail.googleapis.com":
            return httpx.Response(200, json={"emailAddress": "me@example.com"})
        return super().__call__(request)


REFRESH = "connectors:google:refresh_token"


async def google_sign_in_waiting(tmp_path, conn):
    """The owner's own Google, signing in (the answer not yet given), with GitHub connected beside it."""
    browser = GoogleBrowser()
    router, service, hub, vault = setup_service(tmp_path, conn, GoogleWorld(statuses=("ACTIVE",)), open_browser=browser.open,
                                                google_listener=browser.listener, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    await router.call("connectors.google.configure", {"client_id": "desktop"})
    github = Connector("composio:github", "composio", status="ACTIVE", name="GitHub", accounts=[account("ca_gh", "ACTIVE", label="Me")])
    github.enabled_tools = ["GITHUB_A"]
    service.store.connectors[github.id] = github
    task = asyncio.create_task(router.call("connectors.google.connect"))
    await asyncio.wait_for(browser.entered.wait(), 2)
    return router, service, browser, vault, task


def nothing_half_written(tmp_path, service, browser, vault, *, token=None):
    """What an ended sign-in leaves: the app not connected (on disk too), no waiting marker, the lock free, the callback closed."""
    assert service.store.connectors["google"].status == "INACTIVE" and ConnectorStore(tmp_path).connectors["google"].status == "INACTIVE"
    assert service._signing_in == set() and not service.login_pending and not service._lock.locked()
    assert browser.closed == browser.listeners
    assert vault.get(REFRESH) == token
    assert not service.hub._config.get("connectors_google").enabled


@pytest.mark.parametrize("method,params", [
    ("connectors.disconnect", {"id": "composio:github"}),
    ("connectors.label", {"id": "composio:github", "account_id": "ca_gh", "label": "Work"}),
    ("connectors.set_tools", {"id": "composio:github", "enabled": False}),
    ("connectors.tools", {"id": "composio:github"}),
    ("connectors.set_tools", {"id": "google", "enabled": False}),
    ("connectors.tools", {"id": "google"}),
], ids=["disconnect", "rename", "switch", "tools", "google-switch", "google-tools"])
async def test_nothing_else_of_the_connections_waits_behind_a_google_sign_in_that_waits(tmp_path, conn, method, params):
    """The Google sign-in waits two minutes for the browser; what the owner presses meanwhile is done, not queued behind the
    lock until it runs out its 30 seconds and fails."""
    router, service, browser, vault, task = await google_sign_in_waiting(tmp_path, conn)
    try:
        result = await asyncio.wait_for(router.call(method, params), 2)
        assert not (isinstance(result, dict) and result.get("ok") is False), result
        assert service.login_pending and not task.done()  # and the sign-in goes on
    finally:
        await router.call("integrations.connect_cancel")
        assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"


async def test_a_second_sign_in_asked_for_while_a_google_sign_in_waits_starts_no_second_browser_flow(tmp_path, conn):
    """The same answer as for an app of Composio: busy, and the sign-in that waits is the only one (one page, one callback)."""
    router, service, browser, vault, task = await google_sign_in_waiting(tmp_path, conn)
    try:
        again = await asyncio.wait_for(router.call("connectors.google.connect"), 2)
        other = await asyncio.wait_for(router.call("connectors.connect", {"toolkit": "gmail"}), 2)
        assert again["ok"] is False and again["error"] == "busy" and other["ok"] is False and other["error"] == "busy"
        assert len(browser.opened) == 1 and browser.listeners == 1
        assert service.login_pending and not task.done()
    finally:
        await router.call("integrations.connect_cancel")
        assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"


async def test_cancelling_a_google_sign_in_ends_it_and_leaves_nothing_half_written(tmp_path, conn):
    """Cancelled while it waits for the browser, and again after the answer came back but before it could finish (another
    request had the lock): no grant is kept, the app is not connected, and the next sign-in starts clean."""
    router, service, browser, vault, task = await google_sign_in_waiting(tmp_path, conn)
    assert service.store.connectors["google"].status == "INITIATED" and service._signing_in == {"google"}
    await router.call("integrations.connect_cancel")
    assert (await asyncio.wait_for(task, 2)) == {"connected": False, "error": "cancelled"}
    nothing_half_written(tmp_path, service, browser, vault)
    browser.again()
    task = asyncio.create_task(router.call("connectors.google.connect"))
    await asyncio.wait_for(browser.entered.wait(), 2)
    await service._lock.acquire()  # another request is in the middle of its work when the answer comes back
    try:
        browser.answer.set_result("code-private")
        for _ in range(300):
            if vault.get(REFRESH):
                break
            await asyncio.sleep(0.01)
        assert vault.get(REFRESH) == "refresh-private"  # the answer was taken; the sign-in waits for its turn to finish
        await router.call("integrations.connect_cancel")
    finally:
        service._lock.release()
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"
    nothing_half_written(tmp_path, service, browser, vault)
    assert service.store.connectors["google"].accounts == [] and service.google._access == ""


@pytest.mark.parametrize("kind", ["google", "composio"])
async def test_closing_the_core_ends_a_sign_in_that_waits_and_leaves_nothing_half_written(tmp_path, conn, kind):
    if kind == "google":
        router, service, browser, vault, task = await google_sign_in_waiting(tmp_path, conn)
    else:
        router, service, fake, task = await sign_in_waiting_for(tmp_path, conn)
    await asyncio.wait_for(service.aclose(), 5)
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"
    assert not service.login_pending and service._signing_in == set() and not service._lock.locked()
    if kind == "google":
        nothing_half_written(tmp_path, service, browser, vault)
    else:
        assert fake.deleted == [("ca_test", False)]  # the account Composio made for it goes back
        assert [a["id"] for a in ConnectorStore(tmp_path).connectors["composio:gmail"].accounts] == []


async def test_a_google_sign_in_that_runs_out_of_time_says_so_and_keeps_what_was_pressed_meanwhile(tmp_path, conn):
    """The wait ends without an answer: the same sentence as any sign-in that was not finished in time, the app is not
    connected, and the switch the owner pressed while it waited stays as pressed."""
    router, service, browser, vault, task = await google_sign_in_waiting(tmp_path, conn)
    switched = await asyncio.wait_for(router.call("connectors.set_tools", {"id": "google", "enabled": False}), 2)
    assert switched["connector"]["enabled"] is False
    browser.answer.set_exception(ConnectorFailure("timeout"))
    result = await asyncio.wait_for(task, 2)
    assert result == {"ok": False, "error": "timeout", "http_status": None}
    cause, _ = _cause_of(result["error"], stage=str(result.get("stage") or ""), via="google")
    assert cause == "timeout" and CAUSES[cause].said
    nothing_half_written(tmp_path, service, browser, vault)
    assert service.store.connectors["google"].enabled is False


@pytest.mark.parametrize("method,params,after", [
    ("connectors.disconnect", {"id": "google"}, "gone"),
    ("connectors.google.configure", {"client_id": "another"}, "configured"),
], ids=["disconnect", "configure"])
async def test_changing_or_taking_away_the_google_app_ends_the_sign_in_that_waits_for_it(tmp_path, conn, method, params, after):
    router, service, browser, vault, task = await google_sign_in_waiting(tmp_path, conn)
    result = await asyncio.wait_for(router.call(method, params), 5)
    assert not (isinstance(result, dict) and result.get("ok") is False), result
    assert (await asyncio.wait_for(task, 2))["error"] == "cancelled"  # no failure shown for a wait that was ended on purpose
    assert not service.login_pending and service._signing_in == set() and browser.closed == browser.listeners
    if after == "gone":
        assert "google" not in service.store.connectors and vault.get("connectors:google:client_id") is None
    else:
        assert service.store.connectors["google"].status == "INACTIVE" and vault.get("connectors:google:client_id") == "another"


async def test_a_google_sign_in_finishes_and_keeps_the_switch_pressed_while_it_waited(tmp_path, conn):
    router, service, browser, vault, task = await google_sign_in_waiting(tmp_path, conn)
    await asyncio.wait_for(router.call("connectors.set_tools", {"id": "google", "enabled": False}), 2)
    browser.answer.set_result("code-private")
    result = await asyncio.wait_for(task, 2)
    assert result["connected"] is True and result["connector"]["status"] == "ACTIVE"
    entry = service.store.connectors["google"]
    assert entry.enabled is False and [a["label"] for a in entry.accounts] == ["me@example.com"]  # not undone by the finish
    assert vault.get(REFRESH) == "refresh-private" and service._signing_in == set() and not service._lock.locked()
    assert ConnectorStore(tmp_path).connectors["google"].status == "ACTIVE"


# R-ACCT-04: signing in again takes the place of a dead account, and a connection that stopped is told once.

async def test_signing_in_again_replaces_the_expired_account_and_keeps_its_name(tmp_path, conn):
    fake = Accounts(statuses=("ACTIVE",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    old = Connector("composio:gmail", "composio", status="EXPIRED", name="Gmail",
                    accounts=[account("ca_work", "EXPIRED", label="公司信箱"), account("ca_home", "ACTIVE", label="家裡")])
    service.store.connectors[old.id] = old
    result = await router.call("connectors.connect", {"toolkit": "gmail", "replace": ["ca_work"]})
    assert result["connected"] is True
    assert fake.deleted == [("ca_work", False)]  # given back at Composio; an expired login holds nothing to revoke
    assert [(a["id"], a["status"], a["label"]) for a in result["connector"]["accounts"]] == [("ca_home", "ACTIVE", "家裡"), ("ca_test", "ACTIVE", "公司信箱")]
    assert [a["id"] for a in ConnectorStore(tmp_path).connectors["composio:gmail"].accounts] == ["ca_home", "ca_test"]


async def test_replace_never_removes_a_connected_account_or_one_composio_will_not_take_back(tmp_path, conn):
    fake = Accounts(statuses=("ACTIVE",), delete_status=503)
    router, service, hub, vault = setup_service(tmp_path, conn, fake, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    service.store.connectors["composio:gmail"] = Connector("composio:gmail", "composio", status="ACTIVE", name="Gmail",
        accounts=[account("ca_live", "ACTIVE"), account("ca_dead", "EXPIRED")])
    result = await router.call("connectors.connect", {"toolkit": "gmail", "replace": ["ca_live", "ca_dead"]})
    assert result["connected"] is True
    assert [a["id"] for a in result["connector"]["accounts"]] == ["ca_live", "ca_dead", "ca_test"]  # nothing given back: it stays as it was
    with pytest.raises(RpcError):
        await router.call("connectors.connect", {"toolkit": "gmail", "replace": "ca_dead"})


async def test_a_sign_in_that_fails_replaces_nothing(tmp_path, conn):
    fake = Accounts(statuses=("FAILED",))
    router, service, hub, vault = setup_service(tmp_path, conn, fake, sleep=no_wait, wall=lambda: NOW)
    await router.call("connectors.set_key", {"key": "ak_private"})
    service.store.connectors["composio:gmail"] = Connector("composio:gmail", "composio", status="EXPIRED", name="Gmail",
        accounts=[account("ca_dead", "EXPIRED", label="公司信箱")])
    result = await router.call("connectors.connect", {"toolkit": "gmail", "replace": ["ca_dead"]})
    assert result["connected"] is False and fake.deleted == []
    assert "ca_dead" in [a["id"] for a in service.store.connectors["composio:gmail"].accounts]


def told(service):
    seen = []
    service._tell_lost = lambda entry: seen.append(entry.id)
    return seen


async def test_a_connection_that_stops_is_told_once_and_again_only_after_it_worked(tmp_path, conn):
    fake = Accounts([listed("ca_main", "EXPIRED")])
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_main", "ACTIVE")])
    seen = told(service)
    assert await service.watch_once() == "read"
    assert seen == ["composio:gmail"] and entry.status == "EXPIRED"
    assert await service.watch_once() == "skipped"  # nothing is connected any more: Composio is not asked
    await router.call("connectors.status")
    assert seen == ["composio:gmail"]  # told once
    fake.listing = [listed("ca_main", "ACTIVE")]
    await router.call("connectors.status")
    fake.listing = [listed("ca_main", "REVOKED")]
    await service.watch_once()
    assert seen == ["composio:gmail", "composio:gmail"]


async def test_an_account_gone_from_composio_is_told_and_one_still_working_is_not(tmp_path, conn):
    fake = Accounts([listed("ca_b", "ACTIVE")])
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_a", "ACTIVE"), account("ca_b", "ACTIVE")])
    seen = told(service)
    await service.watch_once()
    assert seen == ["composio:gmail"] and entry.status == "ACTIVE"
    await service.watch_once()
    assert seen == ["composio:gmail"]


async def test_an_app_turned_off_is_not_told_and_a_sign_in_ending_is_no_loss(tmp_path, conn):
    fake = Accounts([listed("ca_main", "EXPIRED")])
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_main", "ACTIVE")])
    entry.enabled = False
    seen = told(service)
    await service.watch_once()
    assert seen == []
    entry.enabled, entry.accounts = True, [account("ca_wait", "INITIATED", since=30)]
    fake.listing = [listed("ca_wait", "EXPIRED")]
    await router.call("connectors.status")
    assert seen == []  # a sign-in that never connected was not a connection


async def test_the_watch_reads_only_when_it_may(tmp_path, conn, monkeypatch):
    from raphael_core import keychain
    fake = Accounts([listed("ca_main", "ACTIVE")])
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_main", "ACTIVE")])
    monkeypatch.setattr(keychain, "asks", lambda: True)
    read = {"key": False}
    monkeypatch.setattr(service.vault, "read_in_run", lambda name: read["key"])
    assert await service.watch_once() == "skipped"  # a Mac: the key was not read in this run, so the watch asks nothing
    read["key"] = True  # the members' tools read it (not Composio's own calls): that is a read in this run too
    assert await service.watch_once() == "read"
    read["key"], service.composio.key_read = False, True
    assert await service.watch_once() == "read"
    async with service._lock:
        assert await service.watch_once() == "skipped"
    service.vault.delete("connectors:composio:key")
    assert await service.watch_once() == "skipped"
    reads = [r for r in fake.requests if r.method == "GET" and r.url.path.endswith("/connected_accounts")]
    assert len(reads) == 2 and not [r for r in fake.requests if "/tool_router/" in r.url.path]  # nothing changed: no patch


async def test_an_app_the_watch_finds_working_again_gives_the_members_its_tools_back(tmp_path, conn):
    """A refused call marked every app expired while Composio still lists the account as connected: the watch's read puts
    the app back, and the session's toolkits and the managed server follow (the members are offered its tools again)."""
    from raphael_core.connectors.service import COMPOSIO_SERVER
    fake = Accounts([listed("ca_main", "ACTIVE")])
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_main", "ACTIVE")])
    entry.status = "EXPIRED"
    await service._session()
    assert hub._config.get(COMPOSIO_SERVER).enabled is False
    assert await service.watch_once() == "read"
    assert entry.status == "ACTIVE" and hub._config.get(COMPOSIO_SERVER).enabled is True
    assert [r for r in fake.requests if r.method == "PATCH" and "/tool_router/session/" in r.url.path]


async def test_the_list_still_answers_when_a_stale_sign_in_cannot_be_given_back_for_want_of_the_key(tmp_path, conn, monkeypatch):
    """On a Mac the key may be refused: the sweep that a plain read of the list runs leaves the stale row for the next read,
    and the list answers instead of failing whole."""
    from raphael_core import keychain
    fake = Accounts()
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_main", "ACTIVE"), account("ca_old", "INITIATED", since=SIGN_IN_LIMIT_S + 60)])

    def refused():
        raise keychain.Refused("The owner refused Raphael the Keychain")

    monkeypatch.setattr(service.composio, "_key", refused)
    result = await router.call("connectors.status", {"refresh": False})
    assert [a["id"] for a in result["connectors"][0]["accounts"]] == ["ca_main", "ca_old"] and fake.deleted == []


async def test_the_loss_is_told_to_the_window_with_the_apps_name(tmp_path, conn):
    fake = Accounts([listed("ca_main", "EXPIRED")])
    router, service, hub, entry = make(tmp_path, conn, fake, [account("ca_main", "ACTIVE")])
    sent = []
    router.notify = lambda method, params: sent.append((method, params))
    await service.watch_once()
    assert ("connectors.lost", {"id": "composio:gmail", "name": "Gmail"}) in sent
