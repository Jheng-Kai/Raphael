"""Connector RPC contract and managed tool policy, independent of the later UI."""

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import asdict
from datetime import datetime, timezone
from contextvars import ContextVar

from ..agent.policy import Tier
from ..integrations.config import ServerConfig, tool_record
from ..integrations.oauth import open_in_browser
from ..integrations.toolsets import tool_kind
from ..protocol import INTERNAL_ERROR, RpcError, invalid_params
from .apps import APPS
from .composio import KEY, ComposioClient, segment, trusted_url
from .google import PREFIX, READ_TOOLS, TOOLS, GoogleClient, permitted, scopes_for
from .http import ConnectorFailure
from .mcp import GoogleTools, ManagedMcp
from .store import STATUSES, Connector, ConnectorStore
from .toolkits import KEY as NEEDS_KEY, OWN_APP, SIGN_IN, check_values, credentials_of, needs_of_row, plan_of, view_of

META_READ = {"COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS"}
META_EXECUTE = "COMPOSIO_MULTI_EXECUTE_TOOL"
META = META_READ | {META_EXECUTE}
_SLUG = re.compile(r"[a-z0-9][a-z0-9_-]{0,99}")
_TOOL = re.compile(r"[A-Za-z0-9_.-]{1,128}")
COMPOSIO_SERVER = "connectors_composio"
GOOGLE_SERVER = "connectors_google"
_CALENDAR_READ = ContextVar("calendar_read", default=None)
logger = logging.getLogger(__name__)
RPC_TIMEOUT_S = 30.0
# How long the app store's list of apps counts as fresh, and the file that keeps the last good one between runs.
CATALOG_TTL_S = 3600
CATALOG_FILE = "connectors-catalog.json"
# A sign-in that was started and not finished is given up after this long (the wait for the browser ends then too),
# and the account Composio made for it goes with it.
WAITING = ("INITIALIZING", "INITIATED")
SIGN_IN_LIMIT_S = 600


def _created_at(value) -> float | None:
    """When Composio made an account, in seconds since 1970, from its `created_at`; None when it says nothing usable."""
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).timestamp()


def _text(params: dict, key: str, *, optional=False) -> str:
    value = params.get(key, "" if optional else None)
    if not isinstance(value, str) or len(value) > 1000 or any(ord(c) < 32 for c in value) or (not optional and not value):
        raise invalid_params(f"{key} must be valid text")
    return value.strip()


def _slug(params: dict, key="toolkit") -> str:
    value = _text(params, key)
    if not _SLUG.fullmatch(value):
        raise invalid_params("toolkit must be a lowercase slug")
    return value


def _names(value) -> list[str]:
    if not isinstance(value, list) or len(value) > 5000 or any(not isinstance(t, str) or not _TOOL.fullmatch(t) for t in value):
        raise invalid_params("disabled_tools must be a list of tool names")
    return sorted(set(value))


def _validate(value, schema: dict) -> bool:
    """Validate the small private Google surface before creating a request."""
    kind = schema.get("type")
    types = {"string": str, "integer": int, "boolean": bool, "object": dict, "array": list}
    if kind in types and type(value) is not types[kind]:
        return False
    if kind == "object":
        props = schema.get("properties", {})
        return (all(k in value for k in schema.get("required", []))
                and (schema.get("additionalProperties") is not False or all(k in props for k in value))
                and all(_validate(v, props[k]) for k, v in value.items() if k in props))
    if kind == "array":
        return all(_validate(v, schema.get("items", {})) for v in value)
    if kind == "integer":
        return schema.get("minimum", value) <= value <= schema.get("maximum", value)
    return True


def _kind(tool: dict, toolkit: str) -> str:
    tags = tool.get("tags") if isinstance(tool.get("tags"), list) else []
    if any(tag in tags for tag in ("createHint", "updateHint", "destructiveHint")):
        return "write"
    if "readOnlyHint" in tags:
        return "read"
    name = tool["slug"].removeprefix(toolkit.upper() + "_")
    record = tool_record(name, "", {})
    return tool_kind(record) if record else "write"


class ConnectorsService:
    def __init__(self, directory, vault, integrations, *, transport=None, open_browser=open_in_browser,
                 sleep=asyncio.sleep, now=time.monotonic, poll_timeout=600, google_listener=None, wall=time.time) -> None:
        self.store = ConnectorStore(directory)
        # The list of apps outlives a run: `now` is monotonic and means nothing next time, so the file holds `wall` time.
        self._catalog_path, self._wall = directory / CATALOG_FILE, wall
        self._catalog_read = False  # whether the file was looked at since the key last changed
        self._catalog_renewal: asyncio.Task | None = None
        self.vault = vault
        self.hub = integrations
        self.composio = ComposioClient(lambda: vault.get(KEY), transport=transport, now=now)
        self.google = GoogleClient(vault, transport=transport, **({"listener": google_listener} if google_listener else {}))
        self.open_browser, self.sleep, self.now = open_browser, sleep, now
        self.poll_timeout = poll_timeout
        self._lock = asyncio.Lock()
        self._connect_task: asyncio.Task | None = None
        # The accounts a sign-in of this run is waiting for: a read of the list never gives these up before the wait ends.
        self._signing_in: set[str] = set()
        self._tool_catalog: dict[str, list[dict]] = {}
        self._tool_load_locks: dict[str, asyncio.Lock] = {}
        self._store_catalog: tuple[float, dict] | None = None
        self._important: dict[str, set[str]] = {}
        self._notify = lambda: None
        self._transport = transport
        integrations.managed = self
        integrations._connector.managed_opener = self.open_managed
        # Existing cached tool lists must already obey connector policy before any RPC runs.
        for server in integrations._config.servers():
            if server.managed_by and server.id not in (COMPOSIO_SERVER, GOOGLE_SERVER):
                server.enabled = False

    def register(self, router) -> None:
        methods = {"catalog": self.catalog, "categories": self.categories, "toolkit": self.toolkit, "connect": self.connect,
                   "status": self.status, "disconnect": self.disconnect, "tools": self.tools,
                   "set_tools": self.set_tools, "set_key": self.set_key, "label": self.label,
                   "remove_account": self.remove_account,
                   "google.configure": self.google_configure, "google.connect": self.google_connect}
        for name, handler in methods.items():
            router.register("connectors." + name, self._handler(handler, name))
        self._notify = lambda: router.notify("connectors.changed", {})

    def _handler(self, handler, name):
        async def operation(params):
            # A whole operation has a ceiling, including pagination, lock acquisition and browser launch.
            budget = self.poll_timeout + RPC_TIMEOUT_S if name == "connect" else 120 + RPC_TIMEOUT_S if name == "google.connect" else RPC_TIMEOUT_S
            async with asyncio.timeout(budget):
                if name in {"catalog", "categories", "toolkit", "status"}:
                    return await handler(params)
                async with self._lock:
                    return await handler(params)

        async def run(params):
            try:
                if name not in {"connect", "google.connect"}:
                    return await operation(params)
                builtin = self.hub._login
                if self.login_pending or self._lock.locked() or (builtin is not None and not builtin.done()):
                    raise ConnectorFailure("busy")
                task = asyncio.create_task(operation(params))
                self._connect_task = task
                try:
                    return await task
                except asyncio.CancelledError:
                    if asyncio.current_task().cancelling():
                        raise
                    return {"connected": False, "error": "cancelled"}
                finally:
                    if self._connect_task is task:
                        self._connect_task = None
            except TimeoutError:
                return {"ok": False, "error": "timeout", "http_status": None}
            except ConnectorFailure as error:
                return {"ok": False, "error": error.kind, "http_status": error.status or None,
                        **({"stage": error.stage} if error.stage and name in ("connect", "google.connect") else {}),
                        **({"failure": error.diagnostic.wire()} if error.diagnostic else {})}
            except RpcError:
                raise
            except Exception:
                # The router normally logs exception tracebacks; never let secret-bearing
                # vault, browser, callback or HTTP exception messages reach that path.
                raise RpcError(INTERNAL_ERROR, "Connector operation failed") from None
        return run

    async def _open(self, url: str) -> None:
        """Open a sign-in page for the owner. A browser that cannot be opened is its own named failure, never an
        internal error: the exception may carry the link, which is never shown or logged."""
        try:
            await self.open_browser(url)
        except asyncio.CancelledError:
            raise
        except Exception:
            raise ConnectorFailure("browser") from None

    @property
    def login_pending(self):
        return self._connect_task is not None and not self._connect_task.done()

    def cancel_connect(self):
        if not self.login_pending:
            return False
        self._connect_task.cancel()
        return True

    def _save(self):
        self.store.save()
        self._notify()
        self.hub._changed()

    def _entry(self, params) -> Connector:
        entry = self.store.connectors.get(_text(params, "id"))
        if entry is None:
            raise invalid_params("There is no such connector")
        return entry

    async def label(self, params):
        entry = self._entry(params)
        account_id, label = _text(params, "account_id"), _text(params, "label")
        if not label or len(label) > 100:
            raise invalid_params("A label needs 1 to 100 characters")
        account = next((a for a in entry.accounts if a["id"] == account_id), None)
        if account is None:
            raise invalid_params("No such connected account")
        account["label"] = label
        self._save()
        return {"connector": self._view(entry)}

    @staticmethod
    def account_view(account, previous=()):
        old = next((a for a in previous if a["id"] == account["id"]), {})
        # Keep only public address metadata; never copy provider tokens or auth state.
        data = account.get("data") if isinstance(account.get("data"), dict) else {}
        address = account.get("email") or data.get("email") or ""
        label = old.get("label") or (address if isinstance(address, str) and len(address) <= 100 else "")
        view = {"id": account["id"], "status": account["status"], "label": label}
        if account["status"] in WAITING:
            # When a sign-in began: Composio's own created time, else the time Raphael started it. A sign-in nobody can
            # date (one an earlier build left behind) has none, and counts as old.
            since = _created_at(account.get("created_at")) or old.get("since")
            if since:
                view["since"] = since
        return view

    def _stale(self, account) -> bool:
        """Whether a sign-in still waiting has outlived the limit and is not the one being waited for now."""
        if account["status"] not in WAITING or account["id"] in self._signing_in:
            return False
        since = account.get("since")
        return not since or self._wall() - since > SIGN_IN_LIMIT_S

    async def _delete_account(self, account, *, revoke=False) -> None:
        """Give one connected account back to Composio (an ACTIVE one is revoked there too). An account that is already
        gone counts as given back; any other failure is raised and the account stays."""
        try:
            result = await self.composio.request("DELETE", "/connected_accounts/" + segment(account["id"]),
                                                 **({"params": {"revoke_on_delete": "true"}} if revoke else {}))
            if revoke and result.get("success") is not True:
                raise ConnectorFailure("revocation_failed")
        except ConnectorFailure as error:
            if error.kind != "gone":
                raise

    async def _delete_quietly(self, account) -> bool:
        """The same for an account nobody asked about (a sign-in given up): Composio unreachable leaves it for the next
        read, which tries again."""
        try:
            await self._delete_account(account)
        except ConnectorFailure:
            return False
        return True

    @staticmethod
    def _settle(entry: Connector) -> None:
        """The status of an app from its accounts: connected when any is, else the first one's, else not connected."""
        entry.status = "ACTIVE" if any(a["status"] == "ACTIVE" for a in entry.accounts) else (
            entry.accounts[0]["status"] if entry.accounts else "INACTIVE")

    async def _give_up(self, entry: Connector, account_id: str) -> None:
        """A sign-in that ended without success leaves no account: the one it made, if it is still waiting, goes back to
        Composio and off the list. One that became something else (connected, failed, expired) is not touched."""
        account = next((a for a in entry.accounts if a["id"] == account_id), None)
        if account is not None and account["status"] in WAITING and await self._delete_quietly(account):
            entry.accounts = [a for a in entry.accounts if a["id"] != account_id]

    async def _sweep(self) -> None:
        """Give up every sign-in that waited longer than the limit (the page was closed, or the owner walked away).
        Run whenever the accounts are read; an ACTIVE account is never touched. Composio unreachable: they stay."""
        for entry in self.store.connectors.values():
            if entry.kind != "composio":
                continue
            gone = [a for a in entry.accounts if self._stale(a) and await self._delete_quietly(a)]
            if gone:
                entry.accounts = [a for a in entry.accounts if a not in gone]
                self._settle(entry)
                self._save()

    async def remove_account(self, params):
        """Remove one account of an app. One that is waiting, expired, revoked, failed or not active goes at once; an
        ACTIVE one is revoked at Composio first. The last connected account is the app itself: that is a disconnect."""
        entry = self._entry(params)
        account_id = _text(params, "account_id")
        if entry.kind != "composio":
            raise invalid_params("Only an app of Composio has accounts to remove")
        account = next((a for a in entry.accounts if a["id"] == account_id), None)
        if account is None:
            raise invalid_params("No such connected account")
        active = account["status"] == "ACTIVE"
        if active and sum(a["status"] == "ACTIVE" for a in entry.accounts) == 1:
            return await self.disconnect({"id": entry.id})
        await self._delete_account(account, revoke=active)
        entry.accounts = [a for a in entry.accounts if a["id"] != account_id]
        self._settle(entry)
        self._save()
        return {"connector": self._view(entry)}

    def _view(self, entry: Connector) -> dict:
        view = asdict(entry)
        view.pop("auth_config_id", None)
        if entry.kind == "google":
            view["enabled_tools"] = [name for name in TOOLS if self.tool_available(GOOGLE_SERVER, name)]
        return {**view, "stores_tool_payloads": entry.kind == "composio",
                "payload_retention_days": 365 if entry.kind == "composio" else 0,
                "draft_only_enforced_by": "raphael"}

    async def catalog(self, params):
        # Publish only a complete snapshot; a failed refresh must not replace the last good list.
        if not self.vault.get(KEY):
            raise ConnectorFailure("missing_key")
        before = self._store_catalog
        if before is None and not self._catalog_read:
            # A new run starts from the last good list on disk, which answers at once; an old one is renewed after.
            self._catalog_read = True
            saved = await asyncio.to_thread(self._read_saved_catalog)
            if saved is not None and self._store_catalog is None:  # a fetch that finished meanwhile is newer
                before = self._store_catalog = saved
                if self.now() - saved[0] >= CATALOG_TTL_S:
                    self._renew_catalog()
                return saved[1]
            before = self._store_catalog
        renewing = self._catalog_renewal
        if before and renewing is not None and not renewing.done():
            return before[1]
        if before and self.now() - before[0] < CATALOG_TTL_S:
            return before[1]
        return await self._fetch_catalog(before)

    async def _fetch_catalog(self, before):
        try:
            items, slugs, cursors = [], set(), set()
            cursor, count, truncated = None, 0, False
            for _ in range(100):
                data = await self.composio.page("/toolkits", {"limit": 500, "sort_by": "usage", "cursor": cursor})
                remaining = 3000 - count
                for item in data["items"][:remaining]:
                    count += 1
                    if not isinstance(item, dict) or not isinstance(item.get("slug"), str):
                        raise ConnectorFailure("protocol")
                    if item["slug"] in slugs:
                        continue
                    slugs.add(item["slug"])
                    meta = item.get("meta") or {}
                    if (not isinstance(meta, dict) or not isinstance(meta.get("categories", []), list)
                            or not isinstance(item.get("auth_schemes", []), list)):
                        raise ConnectorFailure("protocol")
                    # Account state and auth configuration never reach the UI.
                    items.append({"slug": item["slug"], "name": item.get("name", item["slug"]),
                        "description": meta.get("description", ""), "logo": meta.get("logo", ""),
                        "categories": meta.get("categories", []), "tools_count": meta.get("tools_count", 0),
                        # Every app can be added; `needs` says what the owner brings (see `toolkits`).
                        "needs": needs_of_row(item),
                        "no_auth": bool(item.get("no_auth")),
                        "auth_schemes": [str(x).lower() for x in item.get("auth_schemes", [])]})
                next_cursor = data.get("next_cursor")
                if count >= 3000 or not next_cursor:
                    truncated = bool(next_cursor or len(data["items"]) > remaining)
                    break
                if not isinstance(next_cursor, str) or next_cursor in cursors:
                    raise ConnectorFailure("pagination")
                cursors.add(next_cursor)
                cursor = next_cursor
            else:
                raise ConnectorFailure("pagination")
            categories = await self.composio.pages("/toolkits/categories")
            result = {"items": items, "categories": categories, "next_cursor": None,
                      "total_items": len(items), "truncated": truncated, "stale": False,
                      "stores_tool_payloads": True, "payload_retention_days": 365}
            self._store_catalog = (self.now(), result)
            await asyncio.to_thread(self._save_catalog, result)
            return result
        except ConnectorFailure:
            if before:
                return {**before[1], "stale": True}
            raise

    def _read_saved_catalog(self):
        """The last good list from an earlier run as (monotonic time it was fetched, list), or None; the file is a cache."""
        try:
            raw = json.loads(self._catalog_path.read_text(encoding="utf-8"))
            result, fetched = raw["result"], raw["fetched_at"]
            if (raw.get("version") != 1 or type(fetched) not in (int, float) or not isinstance(result, dict)
                    or not isinstance(result.get("items"), list) or not isinstance(result.get("categories"), list)
                    or not all(isinstance(item, dict) and isinstance(item.get("slug"), str) for item in result["items"])):
                return None
        except (OSError, ValueError, KeyError, TypeError):
            return None
        # A clock that went back counts the list as old.
        age = self._wall() - fetched
        return self.now() - (age if 0 <= age < CATALOG_TTL_S else CATALOG_TTL_S), {**result, "stale": False}

    def _save_catalog(self, result) -> None:
        try:
            temporary = self._catalog_path.with_suffix(".json.tmp")
            temporary.write_text(json.dumps({"version": 1, "fetched_at": self._wall(), "result": result},
                                            separators=(",", ":")), encoding="utf-8")
            os.replace(temporary, self._catalog_path)
        except OSError as exc:
            logger.warning("Could not save the list of apps: %s", type(exc).__name__)

    def _renew_catalog(self) -> None:
        if self._catalog_renewal is None or self._catalog_renewal.done():
            self._catalog_renewal = asyncio.get_running_loop().create_task(self._renew_catalog_now())

    async def _renew_catalog_now(self) -> None:
        before = self._store_catalog
        try:
            async with asyncio.timeout(120):
                result = await self._fetch_catalog(before)
        except (ConnectorFailure, TimeoutError, OSError) as exc:
            # The old list stays, and the next ask tries again and says what went wrong (`stale`).
            logger.info("The list of apps was not renewed: %s", type(exc).__name__)
            return
        if before is None or (result["items"], result["categories"]) != (before[1]["items"], before[1]["categories"]):
            self._notify()

    async def aclose(self) -> None:
        task, self._catalog_renewal = self._catalog_renewal, None
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def categories(self, params):
        return await self.composio.page("/toolkits/categories", cache=True)

    async def set_key(self, params):
        key = _text(params, "key", optional=True)
        if key.startswith("sk-or-"):
            raise ConnectorFailure("openrouter_key")
        if key.startswith("ck_"):
            raise ConnectorFailure("consumer_key")
        before = self.vault.get(KEY)
        if key:
            probe = ComposioClient(lambda: key, transport=self._transport)
            try:
                await probe.request("GET", "/toolkits", params={"limit": 1})
            except ConnectorFailure as error:
                if error.status in (401, 403):
                    raise ConnectorFailure("auth", error.status) from None
                raise
        if key != before:
            self._remove_managed(COMPOSIO_SERVER)
            self.store.session_id, self.store.config_version = "", None
            self.store.connectors = {k: v for k, v in self.store.connectors.items() if v.kind != "composio"}
            if key:
                self.vault.set(KEY, key)
            else:
                self.vault.delete(KEY)
            self.composio._cache.clear()
            self._store_catalog = None
            self._catalog_read = False
            self._catalog_path.unlink(missing_ok=True)
            self._tool_catalog.clear()
            self._important.clear()
        self._save()
        return {"configured": bool(key)}

    def _config(self):
        active = {c.id.split(":", 1)[1]: c for c in self.store.connectors.values()
                  if c.kind == "composio" and c.status == "ACTIVE" and c.enabled}
        config = {"toolkits": {"enable": sorted(active)},
                  "tools": {slug: {"disable": c.disabled_tools} for slug, c in active.items()},
                  "manage_connections": {"enable": False}, "workbench": {"enable": False},
                  "proxy_execute": {"enable": False}}
        # An app added with a key, or with a developer app of the owner's own, signs in through its auth config.
        own = {slug: c.auth_config_id for slug, c in active.items() if c.auth_config_id}
        return {**config, "auth_configs": own} if own else config

    async def _session(self):
        data = None
        if self.store.session_id:
            try:
                data = await self.composio.request("GET", "/tool_router/session/" + segment(self.store.session_id))
            except ConnectorFailure as error:
                if error.kind != "gone":
                    raise
        if data is None:
            data = await self.composio.request("POST", "/tool_router/session", json={"user_id": self.store.user_id, **self._config()})
        ident = data.get("session_id", self.store.session_id)
        if not isinstance(ident, str) or not ident:
            raise ConnectorFailure("protocol")
        url = trusted_url(data.get("mcp", {}).get("url", ""))
        self.store.session_id = ident
        self.store.config_version = data.get("config_version")
        self._save()
        await self._install_composio(url, refresh=False)
        return data

    async def _patch(self, config=None, *, refresh=True):
        if not self.store.session_id:
            await self._session()
        config = ({**self._config(), "search": {"enable": True}, "execute": {"enable_multi_execute": True}}
                  if config is None else config)
        data = await self.composio.patch(self.store.session_id, config, self.store.config_version)
        self.store.config_version = data.get("config_version", self.store.config_version)
        self._save()
        server = self.hub._config.get(COMPOSIO_SERVER)
        if server and refresh:
            await self._install_composio(server.url)

    async def _install_composio(self, url, *, refresh=True):
        server = self.hub._config.get(COMPOSIO_SERVER)
        active = any(c.kind == "composio" and c.status == "ACTIVE" for c in self.store.connectors.values())
        if server is None:
            server = ServerConfig(id=COMPOSIO_SERVER, name="Composio", transport="http", url=url,
                headers=["x-api-key"], managed_by="composio", header_refs={"x-api-key": KEY}, enabled=False)
            self.hub._config.add(server)
        if server.url != url:
            self.hub._connector.invalidate(server.id)
        server.url, server.enabled = url, active
        if active and refresh:
            try:
                server.tools = await self.hub._connector.list_tools(server)
                server.tools_checked_at_ms = self.hub._now_ms()
            except Exception:
                server.enabled = False
                self.hub._config.save()
                raise ConnectorFailure("mcp_unavailable") from None
        self.hub._config.save()
        self.hub._changed()

    def needs_cached(self, slug: str) -> str | None:
        """What an app of the catalog needs, from the list the store last read (None: it was never read)."""
        if self._store_catalog is None:
            return None
        return next((item["needs"] for item in self._store_catalog[1]["items"] if item["slug"] == slug), None)

    async def toolkit(self, params):
        """What adding the toolkit asks of the owner and where they find it: the fields, never a value."""
        slug = _slug(params)
        data = await self.composio.request("GET", "/toolkits/" + segment(slug))
        return view_of(slug, str(data.get("name") or slug), plan_of(data))

    async def _auth_config(self, slug, name, plan, values) -> str:
        """The auth config Composio keeps for this app: the owner's key goes to Composio here and nowhere else
        (the owner's developer app, when it is that). Its id is all that stays."""
        body = {"toolkit": {"slug": slug}, "auth_config": {
            "type": "use_custom_auth", "authScheme": plan["scheme"] or "API_KEY", "name": f"Raphael {name}"[:60],
            "credentials": credentials_of(plan, values, "app")}}
        try:
            data = await self.composio.request("POST", "/auth_configs", json=body, hide=values.values())
        except ConnectorFailure as error:
            raise ConnectorFailure("key_rejected" if error.kind == "invalid_request" else error.kind, error.status) from None
        ident = (data.get("auth_config") or {}).get("id")
        if not isinstance(ident, str) or not ident:
            raise ConnectorFailure("protocol")
        return ident

    async def _forget_auth_config(self, ident: str) -> None:
        """Give an auth config back to Composio (one that was made for an add that did not finish, or whose app is gone)."""
        if ident:
            try:
                await self.composio.request("DELETE", "/auth_configs/" + segment(ident))
            except ConnectorFailure:
                pass

    async def connect(self, params):
        slug = _slug(params)
        details = await self.composio.request("GET", "/toolkits/" + segment(slug))
        plan = plan_of(details)
        if details.get("no_auth") or details.get("composio_managed_auth_schemes"):
            return await self._connect_link(slug, details, params)
        values = params.get("fields")
        problem = check_values(plan, {} if values is None else values)
        if problem == "bad_fields":
            raise invalid_params("fields must be text for the fields the app asks for")
        if problem and plan["needs"] != SIGN_IN:
            # Nothing was given (or too little): the window asks for it before it asks to connect.
            raise ConnectorFailure("needs_key" if plan["needs"] == NEEDS_KEY else "needs_own_app")
        before = self.store.connectors.get("composio:" + slug)
        auth_id = await self._auth_config(slug, str(details.get("name") or slug), plan, values or {})
        connected = False
        try:
            if plan["needs"] == NEEDS_KEY:
                result = await self._connect_key(slug, details, plan, values, auth_id)
            else:
                result = await self._connect_link(slug, details, params, auth_id=auth_id)
            connected = bool(result.get("connected"))
            return result
        finally:
            if not connected:
                await self._forget_auth_config(auth_id)
            elif before is not None and before.auth_config_id and before.auth_config_id != auth_id:
                await self._forget_auth_config(before.auth_config_id)

    async def _connect_key(self, slug, details, plan, values, auth_id):
        """Add an app that signs in with the owner's own key: Composio makes the account from it, here, at once."""
        await self._session()
        state = {"authScheme": plan["scheme"] or "API_KEY", "val": {**credentials_of(plan, values, "account"), "status": "ACTIVE"}}
        try:
            made = await self.composio.request("POST", "/connected_accounts", hide=list(values.values()), json={
                "auth_config": {"id": auth_id}, "connection": {"user_id": self.store.user_id, "state": state}})
        except ConnectorFailure as error:
            raise ConnectorFailure("key_rejected" if error.kind == "invalid_request" else error.kind, error.status) from None
        state = values = None  # the key leaves this call with the request
        account_id = made.get("id")
        if not isinstance(account_id, str) or not account_id:
            raise ConnectorFailure("protocol")
        status = "INITIALIZING"
        try:
            for _ in range(10):
                account = await self.composio.request("GET", "/connected_accounts/" + segment(account_id))
                status = account.get("status")
                if status not in STATUSES:
                    raise ConnectorFailure("protocol")
                if status != "INITIALIZING":
                    break
                await self.sleep(1)
            if status != "ACTIVE":
                raise ConnectorFailure("key_rejected")
        except BaseException:
            try:
                await self.composio.request("DELETE", "/connected_accounts/" + segment(account_id), params={"revoke_on_delete": "true"})
            except ConnectorFailure:
                pass
            raise
        ident = "composio:" + slug
        entry = self.store.connectors.setdefault(ident, Connector(ident, "composio"))
        entry.name = details.get("name", slug)
        entry.description = (details.get("meta") or {}).get("description", "")
        entry.logo = (details.get("meta") or {}).get("logo", "")
        entry.status, entry.auth_config_id = "ACTIVE", auth_id
        entry.accounts = [self.account_view(account, entry.accounts)]
        self._save()
        await self._load_tools(entry)
        await self._patch()
        return {"connected": True, "connector": self._view(entry)}

    async def _connect_link(self, slug, details, params, *, auth_id=""):
        """Add an app the owner signs in to in the browser: Composio's own login, or the OAuth app of the owner's own
        (`auth_id`, an auth config Composio keeps with its id and secret)."""
        body = {"toolkit": slug}
        if "alias" in params:
            body["alias"] = _text(params, "alias")
        await self._session()
        before = self._config()
        pending = {**before, "toolkits": {"enable": sorted(set(before["toolkits"]["enable"]) | {slug})}}
        if auth_id:
            pending["auth_configs"] = {**before.get("auth_configs", {}), slug: auth_id}
        connected = False
        try:
            # The toolkit must be permitted before the provider can issue a login link.
            await self._patch(pending, refresh=False)
            link = await self.composio.request("POST", "/tool_router/session/" + segment(self.store.session_id) + "/link", json=body)
            url = trusted_url(link.get("redirect_url", ""))
            account_id = link.get("connected_account_id")
            if not isinstance(account_id, str) or not account_id:
                raise ConnectorFailure("protocol")
            ident = "composio:" + slug
            entry = self.store.connectors.setdefault(ident, Connector(ident, "composio"))
            entry.name = details.get("name", slug)
            entry.description = (details.get("meta") or {}).get("description", "")
            entry.logo = (details.get("meta") or {}).get("logo", "")
            prior_active = entry.status == "ACTIVE"
            entry.status = "INITIALIZING"
            entry.accounts = [a for a in entry.accounts if a["id"] != account_id] + [
                {"id": account_id, "status": "INITIALIZING", "since": self._wall()}]
            self._signing_in.add(account_id)
            self._save()
            try:
                await self._open(url)
                deadline = self.now() + self.poll_timeout
                while self.now() < deadline:
                    account = await self.composio.request("GET", "/connected_accounts/" + segment(account_id))
                    status = account.get("status")
                    if status not in STATUSES:
                        raise ConnectorFailure("protocol")
                    if account.get("id") != account_id:
                        raise ConnectorFailure("account_mismatch")
                    if account.get("toolkit", {}).get("slug", slug) != slug:
                        raise ConnectorFailure("account_mismatch")
                    entry.accounts = [a for a in entry.accounts if a["id"] != account_id] + [self.account_view(account, entry.accounts)]
                    entry.status = "ACTIVE" if prior_active else status
                    self._save()
                    if status == "ACTIVE":
                        if auth_id:
                            entry.auth_config_id = auth_id
                        self._save()
                        await self._load_tools(entry)
                        await self._patch()
                        connected = True
                        return {"connected": True, "connector": self._view(entry)}
                    if status not in ("INITIALIZING", "INITIATED"):
                        return {"connected": False, "error": status.lower(), "connector": self._view(entry)}
                    await self.sleep(2)
                entry.status = "ACTIVE" if prior_active else "EXPIRED"
                # Nobody finished it: the account Composio made for it goes back, so none is left waiting.
                await self._give_up(entry, account_id)
                self._save()
                return {"connected": False, "error": "timeout", "connector": self._view(entry)}
            except BaseException:
                entry.status = "ACTIVE" if prior_active else "INACTIVE"
                # Closed, cancelled or failed on the way: the same.
                await self._give_up(entry, account_id)
                self._save()
                raise
            finally:
                self._signing_in.discard(account_id)
        finally:
            if not connected:
                # Restore the prior toolkit permissions on refusal, timeout or cancellation.
                await self._patch(before, refresh=False)

    async def ensure_tools(self, entry):
        """Load provider classification hints once per toolkit, including after restart."""
        if entry.kind != "composio" or entry.id in self._tool_catalog:
            return
        async with self._tool_load_locks.setdefault(entry.id, asyncio.Lock()):
            if entry.id not in self._tool_catalog:
                await self._load_tools(entry)

    async def _load_tools(self, entry):
        slug = entry.id.split(":", 1)[1]
        if entry.id not in self._important:
            featured = await self.composio.pages("/tools", {"toolkit_slug": slug, "limit": 1000, "important": "true"})
            self._important[entry.id] = {t["slug"] for t in featured if isinstance(t.get("slug"), str)}
        tools = await self.composio.pages("/tools", {"toolkit_slug": slug, "limit": 1000})
        checked = [t for t in tools if isinstance(t, dict) and isinstance(t.get("slug"), str) and _TOOL.fullmatch(t["slug"])]
        # New tools are on by default; only the owner's explicit exclusions persist.
        entry.enabled_tools = sorted({t["slug"] for t in checked} - set(entry.disabled_tools))
        self._tool_catalog[entry.id] = checked
        self._save()

    async def tools(self, params):
        entry = self._entry(params)
        if entry.kind == "google":
            items = [{"slug": name, "name": name, "description": description,
                      "enabled": name not in entry.disabled_tools and permitted(name, entry.granted_scopes, entry.draft_only)
                          and permitted(name, scopes_for(entry.gmail, entry.calendar), entry.draft_only),
                      "kind": "read" if name in READ_TOOLS else "write"}
                     for name, (description, _) in TOOLS.items()]
        else:
            await self._load_tools(entry)
            items = [{"slug": t["slug"], "name": t.get("name", t["slug"]), "description": t.get("description", ""),
                      "tags": t.get("tags", []), "enabled": t["slug"] in entry.enabled_tools,
                      "kind": _kind(t, entry.id.split(":", 1)[1]),
                      "important": t["slug"] in self._important.get(entry.id, set())}
                     for t in self._tool_catalog[entry.id]]
        return {"items": items, "total_items": len(items)}

    async def set_tools(self, params):
        entry = self._entry(params)
        names = _names(params.get("disabled_tools", entry.disabled_tools))
        enabled = params.get("enabled", entry.enabled)
        if type(enabled) is not bool:
            raise invalid_params("enabled must be boolean")
        if entry.kind == "google":
            known = set(TOOLS)
        elif "disabled_tools" not in params:
            # A service switch preserves tool decisions and can narrow access offline.
            known = set(entry.enabled_tools) | set(entry.disabled_tools)
        else:
            await self._load_tools(entry)
            known = {t["slug"] for t in self._tool_catalog[entry.id]}
        if set(names) - known:
            raise invalid_params("Unknown tool name")
        before = set(entry.disabled_tools)
        draft_only = params.get("draft_only", entry.draft_only)
        if type(draft_only) is not bool:
            raise invalid_params("draft_only must be boolean")
        # This is a local policy and takes effect even if the remote PATCH is unavailable.
        entry.draft_only = draft_only
        # A failed remote update must never undo a local switch-off.
        entry.enabled = entry.enabled and enabled
        # Narrow locally before a network call. Broaden only after PATCH succeeds.
        entry.disabled_tools = sorted(before | set(names))
        entry.enabled_tools = sorted(known - set(entry.disabled_tools))
        self._save()
        if entry.kind == "composio":
            await self._session()
            config = self._config()
            if entry.status == "ACTIVE" and enabled:
                config["toolkits"]["enable"] = sorted(set(config["toolkits"]["enable"]) | {entry.id.split(":", 1)[1]})
                config["tools"][entry.id.split(":", 1)[1]] = {"disable": names}
            result = await self.composio.patch(self.store.session_id, config, self.store.config_version)
            self.store.config_version = result.get("config_version", self.store.config_version)
        entry.disabled_tools, entry.enabled_tools = names, sorted(known - set(names))
        entry.enabled = enabled
        self.hub._connector.invalidate(COMPOSIO_SERVER if entry.kind == "composio" else GOOGLE_SERVER)
        self._save()
        return {"connector": self._view(entry)}

    async def status(self, params):
        refresh = params.get("refresh", True)
        if type(refresh) is not bool:
            raise invalid_params("refresh must be boolean")
        if refresh and self.vault.get(KEY) and not self._lock.locked():
            async with self._lock:
                accounts = await self.composio.pages("/connected_accounts", {"user_ids": self.store.user_id, "limit": 500})
                by_slug = {}
                for account in accounts:
                    slug = account.get("toolkit", {}).get("slug")
                    status = account.get("status")
                    if isinstance(slug, str) and status in STATUSES and isinstance(account.get("id"), str):
                        prior = self.store.connectors.get("composio:" + slug)
                        view = self.account_view(account, prior.accounts if prior else [])
                        if self._stale(view) and await self._delete_quietly(view):
                            continue  # a sign-in nobody finished is given back, not listed
                        by_slug.setdefault(slug, []).append(view)
                for entry in self.store.connectors.values():
                    if entry.kind == "composio":
                        entry.accounts = by_slug.get(entry.id.split(":", 1)[1], [])
                        self._settle(entry)
                await self._session()
                await self.composio.pages("/tool_router/session/" + segment(self.store.session_id) + "/toolkits",
                                          {"is_connected": "true", "limit": 50})
                await self._patch()
                self._save()
        elif self.vault.get(KEY) and not self._lock.locked() and any(
                self._stale(a) for c in self.store.connectors.values() if c.kind == "composio" for a in c.accounts):
            async with self._lock:
                await self._sweep()
        return {"connectors": [self._view(c) for c in self.store.connectors.values()],
                "composio_configured": bool(self.vault.get(KEY)),
                "google_configured": bool(self.vault.get(PREFIX + "client_id")),
                "duplicate_google_paths": "google" in self.store.connectors and any(
                    c.id in ("composio:gmail", "composio:googlecalendar") and c.status == "ACTIVE"
                    for c in self.store.connectors.values())}

    def _remove_managed(self, ident):
        self.hub._connector.invalidate(ident)
        self.hub._config.remove(ident)
        self.hub._changed()

    async def disconnect(self, params):
        entry = self._entry(params)
        if entry.kind == "google":
            # Disable first even if provider revocation is temporarily unavailable; retain
            # credentials on failure so the owner can retry revocation rather than lose it.
            entry.status = "REVOKED"
            self._remove_managed(GOOGLE_SERVER)
            self._save()
            await self.google.revoke()
            del self.store.connectors[entry.id]
        else:
            entry.status = "INACTIVE"
            self.hub._connector.invalidate(COMPOSIO_SERVER)
            self._save()
            for account in list(entry.accounts):
                try:
                    result = await self.composio.request("DELETE", "/connected_accounts/" + segment(account["id"]),
                                                        params={"revoke_on_delete": "true"})
                    if result.get("success") is not True:
                        raise ConnectorFailure("revocation_failed")
                except ConnectorFailure as error:
                    if error.kind != "gone":
                        raise
                entry.accounts.remove(account)
                self._save()
            del self.store.connectors[entry.id]
            if entry.auth_config_id:
                # A session keeps what it was told of an auth config (an update adds to it, never takes away): it starts again without.
                self.store.session_id, self.store.config_version = "", None
            try:
                await self._session()
                await self._patch()
            finally:
                # What Composio kept for this app goes back with it, even when the session could not be told yet.
                await self._forget_auth_config(entry.auth_config_id)
        self._save()
        return {"disconnected": True}

    async def google_configure(self, params):
        client_id = _text(params, "client_id")
        client_secret = _text(params, "client_secret", optional=True)
        gmail, calendar = params.get("gmail", "write"), params.get("calendar", "write")
        try:
            scopes_for(gmail, calendar)
        except ValueError:
            raise invalid_params("Scope presets must be read or write") from None
        draft_only = params.get("draft_only", False)
        if type(draft_only) is not bool:
            raise invalid_params("draft_only must be boolean")
        entry = self.store.connectors.setdefault("google", Connector("google", "google"))
        changed = (self.vault.get(PREFIX + "client_id") != client_id or entry.gmail != gmail or entry.calendar != calendar
                   or self.vault.get(PREFIX + "client_secret") != (client_secret or None))
        if changed:
            entry.status, entry.granted_scopes = "INACTIVE", []
            self.google.forget_access()
            self.vault.delete(PREFIX + "refresh_token")
        entry.gmail, entry.calendar, entry.draft_only = gmail, calendar, draft_only
        self.vault.set(PREFIX + "client_id", client_id)
        if client_secret:
            self.vault.set(PREFIX + "client_secret", client_secret)
        else:
            self.vault.delete(PREFIX + "client_secret")
        await self.sync_google()
        self._save()
        return {"configured": True, "connector": self._view(entry), "requested_scopes": scopes_for(gmail, calendar),
                "testing_refresh_expires_days": 7, "revocation_affects_whole_project": True}

    async def google_connect(self, params):
        entry = self.store.connectors.get("google")
        if entry is None:
            raise ConnectorFailure("not_configured")
        entry.status = "INITIATED"
        self._save()
        try:
            entry.granted_scopes = await self.google.connect(scopes_for(entry.gmail, entry.calendar), self._open)
            address = await self.google.account_address()
            entry.status, entry.accounts = "ACTIVE", [self.account_view({"id": "me", "status": "ACTIVE", "email": address}, entry.accounts)]
            await self.sync_google()
            self._save()
        except BaseException:
            entry.status = "INACTIVE"
            await self.sync_google()
            self._save()
            raise
        return {"connected": True, "connector": self._view(entry)}

    async def sync_google(self):
        entry = self.store.connectors.get("google")
        if entry is None:
            return
        server = self.hub._config.get(GOOGLE_SERVER)
        if server is None:
            server = ServerConfig(id=GOOGLE_SERVER, name="Google (private)", transport="stdio", managed_by="google", enabled=False)
            self.hub._config.add(server)
        server.enabled = entry.status == "ACTIVE"
        server.tools = [tool_record(name, description, schema, name in READ_TOOLS) for name, (description, schema) in TOOLS.items()]
        server.tools_checked_at_ms = self.hub._now_ms()
        entry.enabled_tools = [name for name in TOOLS if self.tool_available(GOOGLE_SERVER, name)]
        self.hub._connector.invalidate(GOOGLE_SERVER)
        self.hub._config.save()
        self.hub._changed()

    def open_managed(self, server, secrets):
        if server.managed_by == "composio":
            return ManagedMcp(server.url, secrets.headers, transport=self._transport,
                call_guard=lambda name, args: self.allow_call(server.id, name, args, "user"))
        if server.managed_by == "google":
            return GoogleTools(self)
        raise ConnectorFailure("blocked")

    def tool_available(self, server_id, name):
        if server_id == COMPOSIO_SERVER:
            return bool(self.vault.get(KEY)) and name in META and any(
                c.kind == "composio" and c.status == "ACTIVE" and c.enabled and c.enabled_tools for c in self.store.connectors.values())
        if server_id == GOOGLE_SERVER:
            entry = self.store.connectors.get("google")
            return bool(entry and entry.status == "ACTIVE" and entry.enabled and name not in entry.disabled_tools
                        and permitted(name, entry.granted_scopes, entry.draft_only)
                        and permitted(name, scopes_for(entry.gmail, entry.calendar), entry.draft_only))
        return False

    def record_used(self, server_id, name, arguments, at_ms):
        if server_id == GOOGLE_SERVER:
            entries = [self.store.connectors["google"]] if "google" in self.store.connectors else []
        elif server_id == COMPOSIO_SERVER and name == META_EXECUTE:
            slugs = {call.get("tool_slug") for call in arguments.get("tools", [])}
            entries = [entry for entry in self.store.connectors.values() if entry.kind == "composio" and slugs.intersection(entry.enabled_tools)]
        else:
            entries = []
        for entry in entries:
            entry.last_used_at = at_ms
        if entries:
            self.store.save()

    def ready_tools_of(self, entry: Connector) -> list[str]:
        """The tools of one connector that a call can reach now: those the gate itself lets through
        (`tool_available`, `allow_call`) when the connector is signed in, on, and its server is on. The count
        of the owner's apps (`integrations.inventory`) and the cards of a chat both use this."""
        server = self.hub._config.get(GOOGLE_SERVER if entry.kind == "google" else COMPOSIO_SERVER)
        if server is None or not server.enabled:
            return []
        if entry.kind == "google":
            return [name for name in TOOLS if self.tool_available(GOOGLE_SERVER, name)]
        if entry.status != "ACTIVE" or not entry.enabled or not self.tool_available(COMPOSIO_SERVER, META_EXECUTE):
            return []
        return [name for name in entry.enabled_tools if name not in entry.disabled_tools]

    @staticmethod
    def services_of(entry: Connector, ready: list[str]) -> list[str]:
        """The apps a connector reaches now, by the ids a Composio toolkit and the cards share: a toolkit is
        its own slug, the owner's Google is each product whose tools can be called."""
        if entry.kind == "google":
            return [app.id for app in APPS.values() if any(name.startswith(app.prefix) for name in ready)]
        return [entry.id.removeprefix("composio:")]

    def _execution(self, args):
        """Validate the documented envelope and the current policy for every contained slug."""
        optional = {"thought": str, "current_step": str, "current_step_metric": str,
                    "session_id": str, "sync_response_to_workbench": bool}
        if (not isinstance(args, dict) or set(args) - {"tools", *optional}
                or any(type(args[key]) is not kind for key, kind in optional.items() if key in args)
                or args.get("sync_response_to_workbench", False) is not False):
            return None
        calls = args.get("tools")
        if not isinstance(calls, list) or not 1 <= len(calls) <= 50:
            return None
        kinds = []
        for call in calls:
            if (not isinstance(call, dict) or set(call) != {"tool_slug", "arguments"}
                    or not isinstance(call.get("tool_slug"), str) or not _TOOL.fullmatch(call["tool_slug"])
                    or not isinstance(call.get("arguments"), dict)):
                return None
            tool = call["tool_slug"]
            entries = [c for c in self.store.connectors.values() if c.kind == "composio" and c.status == "ACTIVE" and c.enabled
                       and tool in c.enabled_tools and tool not in c.disabled_tools]
            if not entries or all(c.draft_only for c in entries) and re.search(r"(^|_)(SEND|POST|PUBLISH)(_|$)", tool):
                return None
            # Use exactly the classifier shown in Connections, including provider hints.
            kinds.append((_CALENDAR_READ.get() is self and tool == "GOOGLECALENDAR_EVENTS_LIST") or all(_kind(next((t for t in self._tool_catalog.get(c.id, []) if t["slug"] == tool),
                                        {"slug": tool}), c.id.split(":", 1)[1]) == "read" for c in entries))
        return kinds

    def tier(self, server_id, name, args=None):
        if server_id == COMPOSIO_SERVER:
            if name != META_EXECUTE:
                return Tier.T1
            if args is None:
                return Tier.T2  # An offer without an envelope cannot promise read-only execution.
            kinds = self._execution(args)
            return None if kinds is None else Tier.T1 if all(kinds) else Tier.T2
        return Tier.T1 if name in READ_TOOLS else Tier.T2

    def allow_call(self, server_id, name, args, approver):
        if not self.tool_available(server_id, name):
            return False
        tier = self.tier(server_id, name, args)
        if tier is None or tier >= Tier.T2 and approver != "user":
            return False
        if server_id == GOOGLE_SERVER:
            return _validate(args, TOOLS[name][1])
        return name in META_READ or self._execution(args) is not None

    async def auth_failed(self, server_id):
        if server_id != COMPOSIO_SERVER:
            return
        for entry in self.store.connectors.values():
            if entry.kind == "composio" and entry.status == "ACTIVE":
                entry.status = "EXPIRED"
        self.hub._connector.invalidate(COMPOSIO_SERVER)
        self._save()
        try:
            await self.status({"refresh": True})
        except Exception:
            # Status refresh is best effort; tools remain unavailable until reconfirmed.
            pass

    async def call_calendar(self, args):
        """The calendar's sole Composio read; keep its provider envelope and decoding together."""
        from ..agent.plugins import tool_key

        entry = self.store.connectors.get("composio:googlecalendar")
        if (entry is None or entry.status != "ACTIVE" or not entry.enabled
                or "GOOGLECALENDAR_EVENTS_LIST" not in entry.enabled_tools
                or "GOOGLECALENDAR_EVENTS_LIST" in entry.disabled_tools
                or not _validate(args, TOOLS["calendar_list_events"][1])):
            raise ConnectorFailure("blocked")
        envelope = {"tools": [{"tool_slug": "GOOGLECALENDAR_EVENTS_LIST", "arguments": args}]}
        # The catalog may not be loaded at startup. Only this fixed core read carries the exception,
        # in this async context; model calls still use the catalog classifier and ordinary gate.
        token = _CALENDAR_READ.set(self)
        try:
            if self._execution(envelope) != [True] or not self.allow_call(COMPOSIO_SERVER, META_EXECUTE, envelope, "auto"):
                raise ConnectorFailure("blocked")
            result = await self.hub.call(tool_key(COMPOSIO_SERVER, META_EXECUTE), envelope, approver="auto")
        finally:
            _CALENDAR_READ.reset(token)
        if not result.ok:
            raise ConnectorFailure("network")
        from .response import unwrap_read
        try:
            data, _ = unwrap_read(result)
            if not isinstance(data.get("items"), list):
                raise ValueError
            return data
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            raise ConnectorFailure("response") from None

    async def call_google(self, name, args):
        if not self.tool_available(GOOGLE_SERVER, name) or not _validate(args, TOOLS[name][1]):
            raise ConnectorFailure("blocked")
        try:
            await self.google.access_token()
            entry = self.store.connectors["google"]
            if self.google.scopes is not None and entry.granted_scopes != self.google.scopes:
                entry.granted_scopes = self.google.scopes
                await self.sync_google()
                self._save()
            if not self.tool_available(GOOGLE_SERVER, name):
                raise ConnectorFailure("blocked")
            return await self.google.call(name, args)
        except ConnectorFailure as error:
            if error.kind in ("auth", "reconnect"):
                entry = self.store.connectors["google"]
                entry.status = "EXPIRED"
                await self.sync_google()
                self._save()
            raise
