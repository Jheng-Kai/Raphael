"""Connector cards: the card a chat shows in its own conversation when the task in it needs an app
that is not connected, and the one resume of that task once it is.

A card is a row of `connect_cards`, bound to the turn whose task asked for the app (the model's
`connect_app`). Its state moves only along `MOVES`:

    pending ── Connect ──> authorizing ──> connected
       ^                       |  |
       |                       |  +──> failed (a named cause: `CAUSES`)
       +── Connect again <─────+─────> cancelled (the owner's Cancel)
    pending, failed or cancelled ── CARD_WAIT_MS ──> expired

`integrations.card_connect {id, fields?}` answers at once and signs in in the background: through the owner's
own Google authorization when it is configured (a loopback callback with PKCE and a `state`), else
through Composio; with neither, the card fails with `needs_composio_key` and no browser opens. The app `google`
(`OWN_GOOGLE`) is the owner's own Google on purpose: its card walks the Google Cloud steps and takes the Client ID and
Client secret as `fields` (the secret goes to the vault through `connectors.google.configure`, as the Composio key and
every other secret does), then signs in in the browser, and says which account connected. An app that
signs in with the owner's own key or developer app (`needs` "key", "own_app") is given its `fields` by the
window's form: they go to `connectors.connect` in memory and nowhere else (no row, no event, no log, no
reply), and the model never sees them. A card that failed for want of something says exactly what and where
(`needs_composio_key`, `needs_key`, `needs_own_app`, `key_rejected`), to the owner and to the member. Connected
means the app's read tools can be called now, so a sign-in that granted less (a partial consent) is
`scope`, never connected. `integrations.card_cancel {id}` ends a sign-in under way.

A card that did not connect always says why. Every way an attempt can fail is a cause of `CAUSES`, with a retry flag
(can pressing again help?) and a `fix` where the owner has to put something right first (`settings`: the Composio key in
Connections; `form`: what the card asks for). The window words each cause itself; the member is told the same cause as
data (`cause <name>: <what happened>`), so that it explains rather than says "press again". What the code cannot name is
`unknown`, with a short technical reason (`detail`, never JSON or a trace) that the card folds under its details. The
case that used to be bare was an attempt that failed before any request was sent: another sign-in or the connection
list still held the connector (`busy`), the vault could not be read (`vault`), the browser could not be opened (`browser`).

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
from .apps import APPS, OWN_GOOGLE, SERVER_APPS, App, catalog_apps
from .composio import KEY
from .google import LOOPBACK, PREFIX, TOOLS, scopes_for
from .service import GOOGLE_SERVER
from .toolkits import SIGN_IN
from ..failures import Failure, Missing, classify

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


@dataclass(frozen=True)
class Cause:
    """Why a card did not connect. `said` is what happened and the one thing to do, in English, for the member (the
    window has its own words for the owner). `retry`: pressing again can help. `fix`: what the owner puts right first."""
    name: str
    retry: bool
    kind: str
    said: str
    fix: str = ""  # "settings": the Composio key in Settings > Connections > Store; "form": what the card asks for


CAUSES: dict[str, Cause] = {cause.name: cause for cause in (
    # Nothing was sent: the attempt never left this PC.
    Cause("busy", True, "network", "Another sign-in, or the list of connections, was still working on this PC, so nothing was sent. Wait a moment, then press Connect again."),
    Cause("vault", True, "tool_broken", "Raphael could not read its secure key store on this PC, so nothing was sent. Check that Windows Credential Manager works, then press Connect again."),
    Cause("browser", True, "tool_broken", "Raphael could not open the browser for the sign-in. Open a browser on this PC, then press Connect again."),
    # This PC and the service.
    Cause("network", True, "network", "This PC could not reach the service (offline, a firewall or a proxy). Check the connection, then press Connect again."),
    Cause("no_answer", True, "timeout", "The service did not answer in time. Try again in a moment."),
    Cause("service_down", True, "server", "The service reported a fault on its own side. Try again later."),
    Cause("rate_limit", True, "rate_limit", "The service is limiting requests right now. Try again in a few minutes."),
    Cause("refused", False, "refused", "The service refused the request."),
    Cause("invalid_request", True, "invalid_request", "The service could not accept the format of this version's request. Update Raphael, then try again."),
    Cause("not_found", False, "not_found", "The service has no such app or address any more (it may have been removed)."),
    Cause("bad_response", True, "tool_broken", "The service answered in a form Raphael cannot read. Try again; if it keeps happening the service may have changed."),
    Cause("address", True, "tool_broken", "The service sent a sign-in address that does not belong to it, so Raphael did not open it. Try again."),
    Cause("not_allowed", False, "permission_denied", "Composio does not allow this app for the owner's project. The owner can allow it in the Composio dashboard."),
    # The keys and the owner's own setup.
    Cause("needs_composio_key", False, "auth_expired", "Composio's API key is missing. The owner adds it in Settings > Connections > Store.", "settings"),
    Cause("key_refused", False, "auth_expired", "Composio refused its API key. The owner checks or replaces it in Settings > Connections > Store.", "settings"),
    Cause("not_configured", False, "auth_expired", "Raphael's own Google sign-in is not set up.", "settings"),
    Cause("needs_key", False, "auth_expired", "This app signs in with the owner's own key, which the card asks for.", "form"),
    Cause("needs_own_app", False, "auth_expired", "This app needs a developer app of the owner's own, which the card asks for.", "form"),
    Cause("key_rejected", False, "auth_expired", "The app did not accept the key the owner entered. The owner enters it again on the card.", "form"),
    Cause("needs_own_google", False, "auth_expired", "The owner's own Google needs the Client ID and Client secret of a Desktop client from their Google Cloud project, entered on the card.", "form"),
    Cause("client_rejected", False, "auth_expired", "Google did not accept the Client ID or Client secret. The owner checks them in Google Cloud and enters them again on the card.", "form"),
    # A server of the owner's own (n8n).
    Cause("needs_server_fields", False, "auth_expired", "The server's address and access token are missing; the card asks for both.", "form"),
    Cause("server_address", False, "invalid_request", "The server address is not valid. The owner copies it again from the server's MCP settings.", "form"),
    Cause("server_auth", False, "auth_expired", "The server did not accept the access token. The owner copies a current one from the server's MCP settings.", "form"),
    Cause("server_unreachable", True, "network", "The server could not be reached. Check that it is running and that the address on the card is right."),
    # The sign-in itself.
    Cause("denied", True, "permission_denied", "The owner declined access in the browser."),
    Cause("timeout", True, "timeout", "The sign-in was not finished in time."),
    Cause("state", True, "auth_expired", "The answer to the sign-in did not match this attempt, so it was ignored. Start the sign-in again."),
    Cause("scope", True, "permission_denied", "The sign-in did not grant all the access this app's tools need. Sign in again and allow everything that is asked."),
    Cause("signin_failed", True, "auth_expired", "The service ended the sign-in without connecting."),
    Cause("signin_expired", True, "auth_expired", "Google no longer accepts that sign-in. Sign in again. A Google Cloud project left in Testing makes sign-ins last only 7 days; publishing it to production avoids that."),
    Cause("no_refresh", True, "auth_expired", "Google signed in but gave no long-lived sign-in, so Raphael could not keep the connection. Sign in again and accept everything that is asked."),
    Cause("api_disabled", True, "permission_denied", "Google signed in, but the Gmail API is not turned on in the owner's Google Cloud project. The owner turns on the Gmail API and the Google Calendar API there, then connects again."),
    Cause("mcp_unavailable", False, "tool_broken", "The app connected, but its tools could not be loaded."),
    Cause("interrupted", True, "cli_stopped", "The sign-in was cut off before it finished. Try again."),
    Cause("unknown", True, "unknown", "Raphael could not tell why it did not connect."),
)}
# What a provider calls a failure, as the cause the owner is told. The few that depend on more than their name (a status,
# where it happened, a message) are decided in `_cause_of`.
_RAW = {
    "denied": "denied", "access_denied": "denied", "timeout": "timeout", "expired": "timeout", "state": "state",
    "missing_scopes": "scope", "scope": "scope", "not_configured": "not_configured", "missing_key": "needs_composio_key",
    "needs_key": "needs_key", "needs_own_app": "needs_own_app", "key_rejected": "key_rejected", "busy": "busy",
    "network": "network", "rate_limit": "rate_limit", "gone": "not_found", "protocol": "bad_response",
    "response": "bad_response", "pagination": "bad_response", "account_mismatch": "bad_response", "untrusted_url": "address",
    "reconnect": "signin_expired", "toolkit_not_allowed": "not_allowed", "browser": "browser",
    "missing_refresh_token": "no_refresh", "invalid_client": "client_rejected", "api_disabled": "api_disabled",
    "mcp_unavailable": "mcp_unavailable", "failed": "signin_failed", "inactive": "signin_failed", "revoked": "signin_failed",
    "cancelled": "interrupted", "interrupted": "interrupted", "needs_own_google": "needs_own_google",
}
# The failures that are the owner's to put right, each with a place in the window to do it.
SETUP = frozenset(("needs_composio_key", "key_refused", "needs_key", "needs_own_app", "key_rejected", "needs_own_google", "client_rejected"))
WHERE = "Settings > Connections > Store"
DETAIL_CHARS = 140
# The steps of the owner's own Google, for the member to explain; the card shows the same in the window's language.
GOOGLE_STEPS = (
    "Open console.cloud.google.com and create a project, or pick one.",
    "In APIs & Services > Library, turn on the Gmail API and the Google Calendar API.",
    "In Google Auth Platform > Get started, give the app a name and a support email, choose External as the audience, add a contact email and create.",
    "In Data Access, add the scopes the card lists (copy them from the card).",
    "In Audience, choose Publish app (In production). Left in Testing, a sign-in stops working after 7 days.",
    "In Clients, create a client of the type Desktop app. Copy its Client ID and Client secret into the card. Google accepts Raphael's local return address by itself; nothing has to be registered.",
    "Press Connect Google on the card. The browser asks the owner to sign in; when Google says it has not verified the app, choose Advanced and continue (the project is the owner's own).",
)


def short(text: object, limit: int = DETAIL_CHARS) -> str:
    """A provider's own words for the card: one line, without the marks of what was taken out of it, at most `limit` characters."""
    text = re.sub(r"\[(?:email|url|redacted|credential|profile path)\]", " ", str(text or ""))
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _technical(raw: str, status) -> str:
    """The short reason for what could not be named: its word and status, never the provider's text, JSON or a trace."""
    word = " ".join(re.sub(r"[^\w .-]", " ", raw).split())[:60]
    return " · ".join(part for part in (word, f"HTTP {status}" if status else "") if part)


def _cause_of(raw: str, *, status=None, stage: str = "", message: str = "", via: str = "") -> tuple[str, str]:
    """(cause, detail) of a failure the connectors reported as `raw`: a `ConnectorFailure` kind, or the state an account ended in."""
    status = status if type(status) is int else None
    if raw == "auth":
        return ("key_refused" if via == "composio" else "client_rejected"), ""
    if raw == "timeout" and stage == "request":
        return "no_answer", ""
    if raw == "http_error":
        return ("service_down", "") if (status or 0) >= 500 else ("refused", short(message))
    if raw in ("invalid_request", "conflict"):
        return ("refused", short(message)) if message or raw == "conflict" else ("invalid_request", "")
    if raw in _RAW:
        return _RAW[raw], ""
    return "unknown", _technical(raw, status)


def _pack(cause: str, detail: str = "") -> str:
    """The card's `error` column holds the cause and, after a colon, the short detail that goes with it."""
    return f"{cause}:{detail}" if detail else cause


def _unpack(error: str) -> tuple[str, str]:
    cause, _, detail = (error or "").partition(":")
    return cause, detail


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

    @property
    def cause(self) -> str:
        """Why it failed, as a cause of `CAUSES` ('' while it has not failed). A word an old row carries that no cause
        names is `unknown`, with no reason to show."""
        cause = _unpack(self.error)[0]
        return cause if not cause or cause in CAUSES else "unknown"

    @property
    def detail(self) -> str:
        return _unpack(self.error)[1] if self.cause else ""

    def view(self) -> dict:
        """The card as the window draws it. One that timed out has nothing left to set up."""
        error = _shown_error(self.cause, self.app)
        failed = self.state == "failed" and error in CAUSES
        return {"id": self.id, "app": self.app, "name": self.name, "logo": self.app_logo, "state": self.state,
                "error": error or None, "reconnect": self.reconnect, "tool_count": self.tool_count,
                "expires_at_ms": self.expires_at_ms, "resumed": self.resumed,
                **({"detail": self.detail or None, "retry": CAUSES[error].retry, "fix": CAUSES[error].fix or None} if failed else {}),
                **({"missing": missing.wire()} if self.state != "expired" and (missing := _card_missing(error)) else {})}


def _shown_error(error, app):
    """`not_configured` is about Raphael's own Google sign-in: any other app waits for the Composio key."""
    google = app in APPS and APPS[app].provider == "google"
    return "needs_composio_key" if error == "not_configured" and not google else error


def _card_missing(error):
    if error == "needs_composio_key":
        return Missing("composio", "composio_key", "missing", "store")
    if error == "not_configured":
        return Missing("google", "google_client", "missing", "store")
    if error == "mcp_unavailable":
        return Missing("mcp", "installation", "missing", None)
    return None


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
    """An attempt that did not connect, as the cause the card names and the short detail that goes with it."""

    def __init__(self, kind: str, detail: str = "") -> None:
        super().__init__(kind)
        self.kind = kind
        self.detail = detail


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
        if ident in SERVER_APPS:
            return SERVER_APPS[ident]
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
            if app.provider == "own_server":
                server = self._own_server(app)
                hub = self._connectors.hub
                return [tool.name for tool in server.tools if server.tool_on(tool)] if server and hub._server_entry(server)["state"] == "ready" else []
            if app.provider == "own_google":
                return [name for name in TOOLS if self._connectors.tool_available(GOOGLE_SERVER, name)]
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
             done: Iterable[tuple[str, str]] = (), reconnect: bool = False) -> Card | None:
        """The card a task asks for, or None when the app is connected already."""
        if self.ready_tools(app) and not reconnect:
            return None
        return self.store.open(turn_id=turn_id, member_id=member_id, conversation_id=conversation_id,
                               app=app.id, language=language, reconnect=reconnect or self._expired(app), done=done,
                               app_name=app.name, provider=app.provider, app_logo=app.logo)

    def _needs_of(self, app: App) -> str:
        """The public setup kind: sign-in, key, developer app or the owner's server."""
        if app.provider in ("own_server", "own_google"):
            return app.provider
        if app.provider != "composio":
            return SIGN_IN
        try:
            return self._connectors.needs_cached(app.composio) or SIGN_IN
        except Exception:
            return SIGN_IN

    def view(self, card: Card) -> dict:
        """The card as the window draws it: its own state, and what pressing Connect needs to be given."""
        known = APPS.get(card.app)
        app = known if known and known.provider == card.provider else App(card.app, card.name, "", card.app, card.provider)
        needs = self._needs_of(app)
        view = {**card.view(), "needs": needs, **({"toolkit": app.composio} if needs in {"key", "own_app"} else {})}
        if needs == "own_server":
            view["fields"] = self._server_fields()
            if card.state == "failed":
                view["error_message"] = self._server_failure(card.cause).reason
        if needs == "own_google":
            view["fields"] = self._google_fields()
            view["google"] = self._google_guide(card)
            if card.state == "connected":
                view["account"] = self._google_account()
        return view

    @staticmethod
    def _google_fields() -> list[dict]:
        """Public form metadata only; the window words the labels and submitted values never become card state."""
        return [{"name": "client_id", "label": "Client ID", "required": True, "secret": False},
                {"name": "client_secret", "label": "Client secret", "required": True, "secret": True}]

    def _google_guide(self, card: Card | None = None) -> dict:
        """What the owner copies into Google Cloud: the return address Raphael uses and the scopes it asks for (the presets
        of the connection when there is one), and whether a Client ID is kept already so that the card asks only for the
        sign-in. A client Google refused is asked for again."""
        entry = self._connectors.store.connectors.get("google")
        try:
            kept = bool(self._connectors.vault.get(PREFIX + "client_id"))
        except Exception:
            kept = False
        refused = card is not None and card.state == "failed" and card.cause in ("needs_own_google", "client_rejected")
        return {"redirect": LOOPBACK, "scopes": scopes_for(entry.gmail, entry.calendar) if entry else scopes_for("write", "write"),
                "configured": kept and not refused}

    def _google_account(self) -> str:
        """The address of the Google account that signed in, when Google gave it."""
        entry = self._connectors.store.connectors.get("google")
        return str(entry.accounts[0].get("label") or "") if entry is not None and entry.accounts else ""

    @staticmethod
    def _server_fields() -> list[dict]:
        """Public form metadata only; submitted values never become card state."""
        return [
            {"name": "url", "label": "MCP server address", "required": True, "secret": False,
             "description": "In n8n Settings, enable MCP access and copy the server address into this card. MCP is the connection other apps use to reach the workflows you expose in n8n."},
            {"name": "token", "label": "Access token", "required": True, "secret": True,
             "description": "Copy the access token from the same n8n MCP settings into this card. It lets Raphael access the workflows you expose; never paste it into chat."},
        ]

    async def setup_guide(self, app: App) -> dict:
        """Give the member instructions and field names, never defaults or entered values."""
        if app.provider == "own_server":
            return {"fields": self._server_fields()}
        if app.provider == "own_google":
            guide = self._google_guide()
            return {"steps": GOOGLE_STEPS, "redirect": guide["redirect"], "scopes": guide["scopes"], "client_kept": guide["configured"],
                    "fields": [{key: field[key] for key in ("name", "label", "required", "secret")} for field in self._google_fields()],
                    "note": "The card shows these steps, the copyable return address and scopes, and the two fields. Explain each step in the owner's "
                            "language, one at a time. The Client ID and Client secret go only into the card, never into chat."}
        if self._needs_of(app) not in {"key", "own_app"}:
            return {}
        try:
            plan = await self._connectors.toolkit({"toolkit": app.composio})
        except Exception:
            # Showing the secure card must still work when its public guide is unavailable.
            return {"note": "The app's setup guide could not be loaded. Explain the card's fields; ask what step the owner needs help with, never for field values."}
        return {**{key: plan.get(key) for key in ("guide_url", "app_url", "redirect_url")},
                "fields": [{key: field.get(key) for key in ("name", "label", "description", "required", "secret")}
                           for field in plan["fields"]]}

    def _own_server(self, app: App):
        return next((server for server in self._connectors.hub._config.servers()
                     if not server.managed_by and not server.catalog_id and server.auth == "none"
                     and server.transport == "http" and server.name.casefold() == app.name.casefold()), None)

    @staticmethod
    def _server_failure(kind: str) -> Failure:
        reason = {
            "needs_server_fields": "Enter the n8n server address and access token in the card. Try again after filling both fields.",
            "server_address": "The n8n server address is not valid. Copy the MCP server address from n8n settings into the card. Try again.",
            "server_auth": "n8n did not accept the access token. Copy a current token from n8n MCP settings into the card. Try again.",
            "scope": "n8n returned no available workflows. Enable MCP access and expose a workflow in n8n settings. Try again from the card.",
        }.get(kind, "Could not connect to n8n. Check that n8n is running and that the card has the MCP server address and current access token from n8n settings. Try again from the card.")
        return Failure("auth_expired" if kind == "server_auth" else "network", reason)

    async def _connect_server(self, app: App, fields: dict | None) -> None:
        """Only the owner's card press reaches this existing add/test path."""
        if not fields or set(fields) != {"url", "token"} or not all(value.strip() for value in fields.values()):
            raise _Failed("needs_server_fields")
        from ..integrations.config import checked_url
        try:
            address = checked_url(fields["url"].strip())
        except ValueError:
            raise _Failed("server_address") from None
        token = fields["token"].strip()
        token = token if token.startswith("Bearer ") else "Bearer " + token
        draft = {"name": app.name, "transport": "http", "url": address,
                 "headers": [{"name": "Authorization", "value": token}]}
        server = self._own_server(app)
        try:
            if server:
                await self._router.call("integrations.set_enabled", {"id": server.id, "enabled": False})
                result = await self._router.call("integrations.update", {"id": server.id, **draft})
            else:
                result = await self._router.call("integrations.add", draft)
            identifier = result["server"]["id"]
            tested = await self._router.call("integrations.test", {"id": identifier})
            if not tested.get("ok"):
                raise _Failed("server_auth" if tested.get("error") == "auth" else "server_unreachable")
            if not tested.get("tools"):
                raise _Failed("scope")
            # Refresh retains the checked schemas; enabling happens only after both checks succeed.
            refreshed = await self._router.call("integrations.refresh", {"id": identifier})
            if refreshed["server"].get("error"):
                raise _Failed("server_unreachable")
            await self._router.call("integrations.set_enabled", {"id": identifier, "enabled": True})
        except _Failed:
            raise
        except Exception:
            # A provider or vault exception may echo the form; never classify its raw text.
            raise _Failed("server_unreachable") from None

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
        if app.provider == "own_google":
            return "connectors.google.connect", {}
        if app.provider == "builtin":
            server = next((s for s in self._connectors.hub._config.servers() if s.catalog_id == app.id), None)
            return "integrations.connect", {"id": server.id} if server else {"catalog_id": app.id}
        if app.provider == "google" and "google" in self._connectors.store.connectors and vault.get(PREFIX + "client_id"):
            return "connectors.google.connect", {}
        if vault.get(KEY):
            return "connectors.connect", {"toolkit": app.composio}
        return None

    async def _missing(self, kind: str, app: App) -> Failure:
        """What a card that could not connect tells the member: exactly what is missing and where the owner adds it
        (the same words the window shows), so that what the member says is never only "not set up"."""
        name = app.name
        if kind == "needs_own_google":
            return Failure("auth_expired", "The owner's own Google needs a Desktop client from their Google Cloud project: its Client ID and Client secret. The card "
                                           "shows the steps with the return address and scopes to copy, and the two fields. Explain each step in the owner's language, "
                                           "one at a time; never ask for the values in chat.")
        if kind == "client_rejected":
            return Failure("auth_expired", "Google did not accept the Client ID or Client secret entered on the card. The owner opens Google Cloud > Google Auth "
                                           "Platform > Clients, checks the Desktop client and enters both again on the card. Never ask for them in chat.")
        if kind in ("needs_composio_key", "key_refused"):
            own = (" Or the owner can connect their own Google account instead: connect_app with the id google, which walks them through a Google Cloud client."
                   if app.provider == "google" else "")
            return Failure("auth_expired", f"No app can be added yet: Composio's API key is {'missing' if kind == 'needs_composio_key' else 'refused'}. The owner "
                                           f"{'adds' if kind == 'needs_composio_key' else 'checks or replaces'} it in Settings > "
                                           f"Connections > Store (Composio key, made at composio.dev); then {name} can be added from the card or from {WHERE}.{own}",
                           missing=_card_missing("needs_composio_key") if kind == "needs_composio_key" else None)
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
                                           "from the card in this conversation, then signs in in the browser. Explain each field step by step; never ask for its value in chat.")
        return Failure("auth_expired", f"{name} needs the owner's own key ({asks}); Composio keeps it.{link} The owner enters it from the "
                                       f"card or with Add on {name} in {WHERE}.")

    def _refusal(self, method: str, result: dict) -> _Failed:
        """The cause of a connector call that answered without connecting (`{"ok": False, "error": ...}`, or an account that ended)."""
        failure = result.get("failure")
        message = classify(failure, record=False).reason if isinstance(failure, dict) else ""
        cause, detail = _cause_of(str(result.get("error") or "unknown"), status=result.get("http_status"),
                                  stage=str(result.get("stage") or ""), message=message,
                                  via="composio" if method == "connectors.connect" else "google")
        return _Failed(cause, detail)

    async def _connect_own_google(self, fields: dict | None) -> None:
        """The owner's own Google: the Client ID and Client secret the card was given go to the vault (`connectors.google.configure`,
        which keeps them as it keeps the refresh token), then the browser sign-in runs. With nothing given, the client kept
        from an earlier try is used, so that a card whose sign-in only needs pressing again asks for nothing."""
        if fields:
            client_id, secret = str(fields.get("client_id", "")).strip(), str(fields.get("client_secret", "")).strip()
            if (set(fields) - {"client_id", "client_secret"} or not client_id or not secret or len(client_id) > 300 or len(secret) > 300
                    or re.search(r"[\s\x00-\x1f]", client_id) or re.search(r"[\x00-\x1f]", secret)):
                raise _Failed("needs_own_google")
            result = await self._router.call("connectors.google.configure", {"client_id": client_id, "client_secret": secret})
            client_id = secret = ""
            if result.get("ok") is False:
                raise self._refusal("connectors.google.configure", result)
        else:
            try:
                kept = bool(self._connectors.vault.get(PREFIX + "client_id"))
            except Exception:
                raise _Failed("vault") from None
            if not kept:
                raise _Failed("needs_own_google")
        result = await self._router.call("connectors.google.connect", {})
        if not result.get("connected"):
            raise self._refusal("connectors.google.connect", result)

    async def _sign_in(self, card: Card, fields: dict | None = None) -> None:
        known = APPS.get(card.app)
        app = known if known and known.provider == card.provider else App(card.app, card.name, "", card.app, card.provider)
        try:
            try:
                if card.reconnect or not self.ready_tools(app):
                    if app.provider == "own_server":
                        await self._connect_server(app, fields)
                        fields = None
                    elif app.provider == "own_google":
                        await self._connect_own_google(fields)
                        fields = None
                    else:
                        try:
                            provider = self._provider(app)
                        except Exception:
                            raise _Failed("vault") from None
                        if provider is None:
                            raise _Failed("needs_composio_key")
                        method, params = provider
                        if method == "connectors.connect" and fields:
                            params = {**params, "fields": fields}
                        fields = None
                        result = await self._router.call(method, params)
                        params = None
                        if not result.get("connected"):
                            raise self._refusal(method, result)
                tools = self.ready_tools(app)
                if not tools:
                    raise _Failed("scope")
                ended = self.store.move(card.id, "connected", tool_count=len(tools))
            except _Failed as failure:
                ended = self.store.move(card.id, "failed", error=_pack(failure.kind, failure.detail))
            except Exception as exc:
                # The class only: what an exception says may hold anything the owner typed.
                logger.warning("A connection card could not connect: %s", type(exc).__name__)
                ended = self.store.move(card.id, "failed", error=_pack("unknown", _technical(type(exc).__name__, None)))
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
            await self._failed(ended, await self._told(ended, app))

    async def _told(self, card: Card, app: App) -> Failure:
        """What the member is told of a card that did not connect: the same cause the card names, as data to explain."""
        cause, detail = card.cause, card.detail
        if app.provider == "own_server":
            return self._server_failure(cause)
        if cause in SETUP:
            setup = await self._missing(cause, app)
            return Failure(setup.kind, f"cause {cause}: {setup.reason}", missing=setup.missing)
        said = CAUSES[cause].said + (f' The service said: "{detail}"' if cause == "refused" and detail else "")
        return Failure(CAUSES[cause].kind, f"{app.name}: cause {cause}: {said}",
                       detail=detail if cause == "unknown" and detail else None, missing=_card_missing(cause))

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
