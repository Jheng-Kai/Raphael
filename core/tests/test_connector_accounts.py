"""The accounts of an app (R-ACCT-01): a sign-in that was given up leaves no account, and every account can be removed.
Every request stops at an HTTP double of Composio."""

import asyncio
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
