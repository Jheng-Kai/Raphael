"""The accounts of an app (R-ACCT-01): a sign-in that was given up leaves no account, and every account can be removed.
Every request stops at an HTTP double of Composio."""

import asyncio
import json
from datetime import datetime, timezone

import httpx
import pytest

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
