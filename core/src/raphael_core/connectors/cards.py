"""Connector cards: the card a chat shows in its own conversation when the task in it needs an app
that is not connected, and the one resume of that task once it is.

A card is a row of `connect_cards`, bound to the turn whose task asked for the app (the model's
`connect_app`). Its state moves only along `MOVES`:

    pending ── Connect ──> authorizing ──> connected
       ^                       |  |
       |                       |  +──> failed (denied, timeout, scope, state, needs_composio_key, needs_key, ...)
       +── Connect again <─────+─────> cancelled (the owner's Cancel)
    pending, failed or cancelled ── CARD_WAIT_MS ──> expired

`integrations.card_connect {id, fields?}` answers at once and signs in in the background: through the owner's
own Google authorization when it is configured (a loopback callback with PKCE and a `state`), else
through Composio; with neither, the card fails with `needs_composio_key` and no browser opens. An app that
signs in with the owner's own key or developer app (`needs` "key", "own_app") is given its `fields` by the
window's form: they go to `connectors.connect` in memory and nowhere else (no row, no event, no log, no
reply), and the model never sees them. A card that failed for want of something says exactly what and where
(`needs_composio_key`, `needs_key`, `needs_own_app`, `key_rejected`), to the owner and to the member. Connected
means the app's read tools can be called now, so a sign-in that granted less (a partial consent) is
`scope`, never connected. `integrations.card_cancel {id}` ends a sign-in under way.

When every card of a turn is connected, that turn's task resumes, once (`resume`, which the agent
supplies): the claim is one conditional update, so a replayed callback or a second Connect finds
nothing to resume. A card holds no authorization URL, code, `state` or token, and none is logged; its public catalog logo is display metadata. The window is
told of a change by `agent.turn`.
"""

import asyncio
import json
import logging
import re
import secrets
import sqlite3
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass

from ..clock import wall_clock_ms
from ..protocol import RpcError, invalid_params
from .apps import APPS, App, catalog_apps
from .composio import KEY
from .google import PREFIX
from .service import GOOGLE_SERVER
from .toolkits import SIGN_IN
from ..failures import Failure, classify

logger = logging.getLogger(__name__)

# How long a card waits for the owner, as a question of the background does.
CARD_WAIT_MS = 24 * 3600 * 1000

# The only moves a card's state makes.
MOVES: dict[str, tuple[str, ...]] = {
    "pending": ("authorizing", "expired"),
    "failed": ("authorizing", "expired"),
    "cancelled": ("authorizing", "expired"),
    "authorizing": ("connected", "failed", "cancelled"),
    "connected": (),
    "expired": (),
}
# What a sign-in that did not connect says, by what the provider called it. Anything else is "error".
_FAILURES = {
    "denied": "denied", "access_denied": "denied", "timeout": "timeout", "expired": "timeout",
    "state": "state", "missing_scopes": "scope", "scope": "scope", "not_configured": "not_configured",
    "missing_key": "needs_composio_key", "needs_key": "needs_key", "needs_own_app": "needs_own_app",
    "key_rejected": "key_rejected",
}
# The failures that are the owner's to put right, each with a place in the window to do it.
SETUP = frozenset(("needs_composio_key", "needs_key", "needs_own_app", "key_rejected"))
WHERE = "Settings > Connections > Store"
_COLUMNS = ("id, turn_id, member_id, conversation_id, app, language, reconnect, state, error, tool_count, done,"
            " created_at_ms, expires_at_ms, resumed_at_ms, app_name, provider, app_logo")


@dataclass(frozen=True)
class Card:
    id: str
    turn_id: int
    member_id: int
    conversation_id: int | None
    app: str
    language: str
    reconnect: bool
    state: str
    error: str
    tool_count: int | None
    done: tuple[tuple[str, str], ...]  # (tool key, argument digest) of what the task did before it asked
    created_at_ms: int
    expires_at_ms: int
    resumed: bool
    app_name: str = ""
    provider: str = "google"
    app_logo: str = ""

    @property
    def name(self):
        return self.app_name or (APPS[self.app].name if self.app in APPS else self.app)

    def view(self) -> dict:
        """The card as the window draws it."""
        return {"id": self.id, "app": self.app, "name": self.name, "logo": self.app_logo, "state": self.state,
                "error": self.error or None, "reconnect": self.reconnect, "tool_count": self.tool_count,
                "expires_at_ms": self.expires_at_ms, "resumed": self.resumed}


def _card(row: sqlite3.Row) -> Card:
    return Card(row["id"], row["turn_id"], row["member_id"], row["conversation_id"], row["app"], row["language"],
                bool(row["reconnect"]), row["state"], row["error"], row["tool_count"],
                tuple((key, digest) for key, digest in json.loads(row["done"])),
                row["created_at_ms"], row["expires_at_ms"], row["resumed_at_ms"] is not None, row["app_name"], row["provider"], row["app_logo"])


class CardStore:
    """The cards, in the database. A sign-in that was under way when the core last ended is over:
    such a card is `failed` with `interrupted`, from which it can be connected again."""

    def __init__(self, conn: sqlite3.Connection, now_ms: Callable[[], int] = wall_clock_ms,
                 wait_ms: int = CARD_WAIT_MS) -> None:
        self._conn, self._now_ms, self._wait_ms = conn, now_ms, wait_ms
        with conn:
            conn.execute("UPDATE connect_cards SET state='failed', error='interrupted', updated_at_ms=?"
                         " WHERE state='authorizing'", (now_ms(),))

    def open(self, *, turn_id: int, member_id: int, conversation_id: int | None, app: str, language: str,
             reconnect: bool, done: Iterable[tuple[str, str]] = (), app_name: str = "", provider: str = "google", app_logo: str = "") -> Card:
        """The card of `app` for `turn_id`: a new one, or the one the turn has (a task asks once per app)."""
        now = self._now_ms()
        with self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO connect_cards (id, turn_id, member_id, conversation_id, app, language, reconnect,"
                " state, done, created_at_ms, updated_at_ms, expires_at_ms, app_name, provider, app_logo) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)",
                (secrets.token_hex(8), turn_id, member_id, conversation_id, app, language, int(reconnect),
                 json.dumps(sorted(set(done))), now, now, now + self._wait_ms, app_name, provider, app_logo))
        row = self._conn.execute(f"SELECT {_COLUMNS} FROM connect_cards WHERE turn_id=? AND app=?",
                                 (turn_id, app)).fetchone()
        return _card(row)

    def expire_due(self) -> None:
        """Cards whose time ran out while they waited for the owner are expired."""
        now = self._now_ms()
        with self._conn:
            self._conn.execute("UPDATE connect_cards SET state='expired', updated_at_ms=?"
                               " WHERE state IN ('pending','failed','cancelled') AND expires_at_ms<=?", (now, now))

    def get(self, card_id: str) -> Card | None:
        self.expire_due()
        row = self._conn.execute(f"SELECT {_COLUMNS} FROM connect_cards WHERE id=?", (card_id,)).fetchone()
        return None if row is None else _card(row)

    def for_turns(self, turn_ids: Iterable[int]) -> dict[int, list[Card]]:
        self.expire_due()
        ids = sorted({int(turn_id) for turn_id in turn_ids})
        found: dict[int, list[Card]] = {}
        for start in range(0, len(ids), 500):
            chunk = ids[start:start + 500]
            rows = self._conn.execute(f"SELECT {_COLUMNS} FROM connect_cards WHERE turn_id IN ({','.join('?' * len(chunk))})"
                                      " ORDER BY created_at_ms, app", chunk)
            for card in map(_card, rows):
                found.setdefault(card.turn_id, []).append(card)
        return found

    def move(self, card_id: str, to: str, *, error: str = "", tool_count: int | None = None) -> Card | None:
        """Move a card to `to` from a state that may move there; None (and nothing changed) otherwise."""
        sources = [state for state, targets in MOVES.items() if to in targets]
        with self._conn:
            moved = self._conn.execute(
                f"UPDATE connect_cards SET state=?, error=?, tool_count=COALESCE(?, tool_count), updated_at_ms=?"
                f" WHERE id=? AND state IN ({','.join('?' * len(sources))})",
                (to, error, tool_count, self._now_ms(), card_id, *sources)).rowcount
        return self.get(card_id) if moved else None

    def claim_resume(self, turn_id: int) -> bool:
        """True once, when every card of the turn is connected and its task has not resumed yet."""
        with self._conn:
            return self._conn.execute(
                "UPDATE connect_cards SET resumed_at_ms=? WHERE turn_id=? AND resumed_at_ms IS NULL"
                " AND NOT EXISTS (SELECT 1 FROM connect_cards WHERE turn_id=? AND state!='connected')",
                (self._now_ms(), turn_id, turn_id)).rowcount > 0


class _Failed(Exception):
    def __init__(self, kind: str, diagnostic=None) -> None:
        super().__init__(kind)
        self.kind = kind
        self.diagnostic = diagnostic


class ConnectorCards:
    """The cards' flow. `router` calls the connectors' own sign-in methods (their lock and their
    value-free failures included); `connectors` says which tools can be called now; `resume`, set by
    the agent, carries on the task of a turn once its cards are connected."""

    def __init__(self, conn: sqlite3.Connection, router, connectors, *,
                 notify: Callable[[str, dict], None] | None = None, now_ms: Callable[[], int] = wall_clock_ms,
                 wait_ms: int = CARD_WAIT_MS) -> None:
        self.store = CardStore(conn, now_ms, wait_ms)
        self._conn, self._router, self._connectors, self._notify = conn, router, connectors, notify
        self.resume: Callable[[int], Awaitable[None]] | None = None
        self.failure = None
        self._reported_failures = set()
        self._login: tuple[str, asyncio.Task] | None = None
        self._owner_cancelled = False
        self._tasks: set[asyncio.Task] = set()

    def register(self, router) -> None:
        router.register("integrations.card_connect", self._connect)
        router.register("integrations.card_cancel", self._cancel)

    # --- what the agent asks ----------------------------------------------------------------------

    async def resolve(self, ident):
        if not isinstance(ident, str):
            return None
        if ident in APPS:
            return APPS[ident]
        return next((app for app, _ in await catalog_apps(self._connectors) if app.id == ident), None)

    async def find(self, query):
        from .finder import normalize
        if not isinstance(query, str) or not query.strip() or len(query) > 200:
            raise ValueError("invalid app query")
        tokens = normalize(query).split()
        matches = []
        for app, text in await catalog_apps(self._connectors):
            if all(token in text for token in tokens):
                provider = self._provider(app)
                name = "composio" if provider and provider[0] == "connectors.connect" else app.provider
                match = {"id": app.id, "name": app.name, "provider": name, "connected": bool(self.ready_tools(app))}
                needs = self._needs_of(app)
                # What adding it asks of the owner, so that the member can say so plainly before showing the card.
                if needs != SIGN_IN and not match["connected"]:
                    match["needs"] = needs
                matches.append(match)
                if len(matches) == 20:
                    break
        return {"apps": matches}

    def ready_tools(self, app: App) -> list[str]:
        """The tools of `app` that can be called now, through either provider; none while its read
        tools cannot, or when the connections cannot be read (unknown is never connected)."""
        try:
            if app.provider == "builtin":
                hub = self._connectors.hub
                return [tool.name for server in hub._config.servers() if server.catalog_id == app.id
                        and hub._server_entry(server)["state"] == "ready" for tool in server.tools if server.tool_on(tool)]
            google = [name for name in app.google_tools if self._connectors.tool_available(GOOGLE_SERVER, name)]
            if app.reads and set(app.reads) <= set(google):
                return google
            # The same test the count of the owner's apps makes (`ConnectorsService.ready_tools_of`).
            entry = self._connectors.store.connectors.get("composio:" + app.composio)
            if entry is not None and (ready := self._connectors.ready_tools_of(entry)):
                return ready
        except Exception as exc:
            logger.warning("Could not read an app's connection: %s", type(exc).__name__)
        return []

    def _expired(self, app: App) -> bool:
        """Whether the app was connected and its sign-in has run out."""
        try:
            entries = self._connectors.store.connectors
            return any(entry is not None and entry.status == "EXPIRED"
                       for entry in (entries.get("google"), entries.get("composio:" + app.composio)))
        except Exception:
            return False

    def show(self, *, turn_id: int, member_id: int, conversation_id: int | None, app: App, language: str,
             done: Iterable[tuple[str, str]] = ()) -> Card | None:
        """The card a task asks for, or None when the app is connected already."""
        if self.ready_tools(app):
            return None
        return self.store.open(turn_id=turn_id, member_id=member_id, conversation_id=conversation_id,
                               app=app.id, language=language, reconnect=self._expired(app), done=done,
                               app_name=app.name, provider=app.provider, app_logo=app.logo)

    def _needs_of(self, app: App) -> str:
        """What adding the app asks of the owner (`toolkits`): a sign-in, their own key, or a developer app of
        their own. Only an app of Composio's catalog can ask for more than a sign-in."""
        if app.provider != "composio":
            return SIGN_IN
        try:
            return self._connectors.needs_cached(app.composio) or SIGN_IN
        except Exception:
            return SIGN_IN

    def view(self, card: Card) -> dict:
        """The card as the window draws it: its own state, and what pressing Connect needs to be given."""
        app = APPS.get(card.app) or App(card.app, card.name, "", card.app, card.provider)
        needs = self._needs_of(app)
        return {**card.view(), "needs": needs, **({"toolkit": app.composio} if needs != SIGN_IN else {})}

    def views(self, turn_ids: Iterable[int]) -> dict[int, list[dict]]:
        return {turn_id: [self.view(card) for card in cards] for turn_id, cards in self.store.for_turns(turn_ids).items()}

    def cards_of(self, turn_id: int) -> list[Card]:
        return self.store.for_turns([turn_id]).get(turn_id, [])

    # --- the window's methods ---------------------------------------------------------------------

    def _card(self, params: dict) -> Card:
        card_id = params.get("id")
        card = self.store.get(card_id) if isinstance(card_id, str) and card_id else None
        if card is None or self._conn.execute("SELECT 1 FROM agent_turns WHERE id=?", (card.turn_id,)).fetchone() is None:
            raise invalid_params("There is no such card")
        return card

    async def _connect(self, params: dict) -> dict:
        """Start the sign-in of a card that waits (a connected or expired card stays as it is). `fields`, for an
        app that wants the owner's own key or developer app, are what its form asked for: they are handed on and
        not kept."""
        card = self._card(params)
        fields = params.get("fields")
        if fields is not None and (not isinstance(fields, dict) or len(fields) > 12
                                   or any(not isinstance(k, str) or not isinstance(v, str) for k, v in fields.items())):
            raise invalid_params("fields must be a map of text")
        if self._login is not None and not self._login[1].done():
            return {"card": self.view(card), "started": False}
        moved = self.store.move(card.id, "authorizing")
        if moved is None:
            return {"card": self.view(card), "started": False}
        self._owner_cancelled = False
        task = asyncio.create_task(self._sign_in(moved, fields))
        fields = None
        self._login = (moved.id, task)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        self._changed(moved)
        return {"card": self.view(moved), "started": True}

    async def _cancel(self, params: dict) -> dict:
        card = self._card(params)
        if self._login is None or self._login[0] != card.id or self._login[1].done():
            return {"cancelled": False}
        self._owner_cancelled = True
        self._login[1].cancel()
        return {"cancelled": True}

    def _provider(self, app: App) -> tuple[str, dict] | None:
        """The sign-in to use: the owner's own Google authorization first, then Composio."""
        vault = self._connectors.vault
        if app.provider == "builtin":
            return "integrations.connect", {"catalog_id": app.id}
        if app.provider == "google" and "google" in self._connectors.store.connectors and vault.get(PREFIX + "client_id"):
            return "connectors.google.connect", {}
        if vault.get(KEY):
            return "connectors.connect", {"toolkit": app.composio}
        return None

    async def _missing(self, kind: str, app: App) -> Failure:
        """What a card that could not connect tells the member: exactly what is missing and where the owner adds it
        (the same words the window shows), so that what the member says is never only "not set up"."""
        name = app.name
        if kind == "needs_composio_key":
            return Failure("auth_expired", f"No app can be added yet: Composio's API key is missing or was refused. The owner adds it in Settings > "
                                           f"Connections (Composio key, made at composio.dev); then {name} can be added from the card or from {WHERE}.")
        if kind == "key_rejected":
            return Failure("auth_expired", f"{name} did not accept the key the owner entered. The owner checks it and enters it again "
                                           f"from the card or with Add on {name} in {WHERE}.")
        asks, link = "an API key", ""
        try:
            plan = await self._connectors.toolkit({"toolkit": app.composio})
            # The labels are the catalog's words; only plain ones go into what the member reads.
            labels = [re.sub(r"[^\w .()/-]", "", field["label"])[:40].strip() for field in plan["fields"] if field["required"]]
            labels = [label for label in labels if label]
            if kind == "needs_own_app":
                asks = "a developer app of their own (" + (", ".join(labels) or "client id and secret") + ")"
            elif labels:
                asks = ", ".join(labels)
            where = plan["guide_url"] or plan["app_url"]
            link = f" The owner gets it at {where}." if where else ""
        except Exception:
            pass
        if kind == "needs_own_app":
            return Failure("auth_expired", f"{name} needs {asks}: its provider gives Composio no shared sign-in.{link} The owner adds it "
                                           f"from the card or with Add on {name} in {WHERE}, then signs in in the browser.")
        return Failure("auth_expired", f"{name} needs the owner's own key ({asks}); Composio keeps it.{link} The owner enters it from the "
                                       f"card or with Add on {name} in {WHERE}.")

    async def _sign_in(self, card: Card, fields: dict | None = None) -> None:
        app = APPS.get(card.app) or App(card.app, card.name, "", card.app, card.provider)
        diagnostic = None
        try:
            try:
                if not self.ready_tools(app):
                    provider = self._provider(app)
                    if provider is None:
                        raise _Failed("needs_composio_key")
                    method, params = provider
                    if method == "connectors.connect" and fields:
                        params = {**params, "fields": fields}
                    fields = None
                    result = await self._router.call(method, params)
                    params = None
                    if not result.get("connected"):
                        raw = str(result.get("error") or "unknown")
                        if method == "connectors.connect" and raw == "auth":
                            raw = "missing_key"  # Composio refused its own key: as good as none
                        raise _Failed(_FAILURES.get(raw, classify(raw).kind),
                                      classify(result["failure"]) if result.get("failure") else None)
                tools = self.ready_tools(app)
                if not tools:
                    raise _Failed("scope")
                ended = self.store.move(card.id, "connected", tool_count=len(tools))
            except _Failed as failure:
                diagnostic = failure.diagnostic
                ended = self.store.move(card.id, "failed", error=failure.kind)
            except Exception as exc:
                failure = classify(exc)
                diagnostic = failure
                ended = self.store.move(card.id, "failed", error=failure.kind)
            except asyncio.CancelledError:
                if not self._owner_cancelled:
                    self.store.move(card.id, "failed", error="interrupted")
                    raise
                ended = self.store.move(card.id, "cancelled")
        finally:
            if self._login is not None and self._login[0] == card.id:
                self._login = None
            self._changed(self.store.get(card.id) or card)
        if ended is not None and ended.state == "connected" and self.store.claim_resume(ended.turn_id) and self.resume:
            try:
                outcome = await self.resume(ended.turn_id)
                if getattr(outcome, "ok", True) is False:
                    await self._failed(ended, classify("resume_failed"))
            except Exception as exc:
                await self._failed(ended, classify(exc))
        elif ended is not None and ended.state == "failed":
            if diagnostic is None and ended.error in SETUP:
                diagnostic = await self._missing(ended.error, app)
            await self._failed(ended, diagnostic or classify(ended.error))

    async def _failed(self, card, failure):
        if self.failure is not None and card.turn_id not in self._reported_failures:
            self._reported_failures.add(card.turn_id)
            try:
                await self.failure(card.turn_id, failure)
            except Exception as exc:
                classify(exc)

    def _changed(self, card: Card) -> None:
        if self._notify is not None:
            self._notify("agent.turn", {"turn_id": card.turn_id, "member_id": card.member_id})

    async def idle(self) -> None:
        """Wait until no sign-in and no resume is under way (for a test or a scenario that reads back)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def aclose(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)
