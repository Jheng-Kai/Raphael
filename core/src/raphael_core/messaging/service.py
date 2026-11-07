"""The messaging connections as the app uses them: `messaging.<app>.*`, for each app in `channels`.

What a connection needs to be secret is in the vault (`messaging:<app>:<name>`, or
`messaging:member:<id>:<platform>:<name>`) and nowhere else;
it never comes back to the window. Only the main window may call these methods (the Rust
allowlist); the switchboard has no way to reach them, so a message cannot approve a pairing or
change a setting.
"""

import asyncio
import contextlib
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from ..integrations.vault import SecretVault
from ..protocol import INTERNAL_ERROR, RpcError, invalid_params
from ..router import Router
from .channels import CHANNEL_TYPES
from .channels.base import ChannelError, ChannelType
from .config import MAX_ALLOWED, AllowedUser, ChannelConfig, MessagingStore
from .core import Ask, Stop, Switchboard, Transcribe, chat_hash, session_target
from .pairing import Pairing

logger = logging.getLogger(__name__)


def secret_name(kind: str, name: str) -> str:
    """The vault entry of a secret of a messaging app."""
    return f"messaging:{kind}:{name}"


def member_account(member_id: int, platform: str = "telegram") -> str:
    """An account key shared by the nonsecret config and the existing secret vault."""
    return platform if member_id == 0 else f"member:{member_id}:{platform}"


@dataclass
class _Running:
    switchboard: Switchboard
    task: asyncio.Task[None]


class MessagingService:
    """`ask` and `stop` are what a switchboard reaches the assistant by, `transcribe` turns the
    audio of a voice message into text, and `language` is the language Raphael answers in. `http`
    is a client for tests (a fake server); otherwise one is made."""

    def __init__(
        self,
        store: MessagingStore,
        vault: SecretVault,
        *,
        ask: Ask,
        stop: Stop,
        language: Callable[[], str],
        transcribe: Transcribe | None = None,
        http: httpx.AsyncClient | None = None,
        types: dict[str, ChannelType] | None = None,
        members: Callable[[], dict[int, str]] = lambda: {0: "Raphael"},
    ) -> None:
        self._store = store
        self._vault = vault
        self._ask = ask
        self._stop = stop
        self._transcribe = transcribe
        self._language = language
        self._http = http
        self._owns_http = http is None
        self._base_types = dict(CHANNEL_TYPES if types is None else types)
        self._types = dict(self._base_types)
        self._members = members
        self._config = store.load()
        self._running: dict[str, _Running] = {}
        self._ended = False
        self.cards = None
        # One lock for the changes of the connections, so a switch and a disconnect cannot cross.
        self._lock = asyncio.Lock()

    def register(self, router: Router) -> None:
        for kind in self._base_types:
            for method, handler in {
                "status": self._status,
                "connect": self._connect,
                "set_enabled": self._set_enabled,
                "approve": self._approve,
                "reject": self._reject,
                "remove_user": self._remove_user,
                "disconnect": self._disconnect,
            }.items():
                router.register(f"messaging.{kind}.{method}", self._for(kind, handler))
        for method in ("status", "connect", "disconnect", "set_enabled", "approve", "reject", "remove_user"):
            router.register(f"messaging.member.{method}", self._member_handler(method))
        router.register("messaging.accounts", self._accounts)

    def _member_handler(self, method: str) -> Callable[[dict], Any]:
        async def handle(params: dict) -> dict:
            member = params.get("member_id")
            if type(member) is not int or member < 0 or member not in self._members():
                raise invalid_params("member_id must name an existing member")
            platform = params.get("platform", "telegram")
            kind = self._member_type(member, platform)
            result = await getattr(self, "_" + method)(kind, params)
            if "status" in result:
                return {**result, "status": self._member_view(member, platform)}
            return result if method == "connect" else self._member_view(member, platform)
        return handle

    def _member_type(self, member: int, platform: str = "telegram") -> str:
        if not isinstance(platform, str) or platform not in self._base_types:
            raise invalid_params("platform must be telegram, slack or discord")
        kind = member_account(member, platform)
        self._types[kind] = self._base_types[platform]
        return kind

    def _member_view(self, member: int, platform: str = "telegram") -> dict[str, Any]:
        view = self._view(self._member_type(member, platform))
        return {**view, "member_id": member, "kind": platform, "platform": platform, "paired": bool(view["allowed"])}

    async def _accounts(self, params: dict) -> dict:
        return {"accounts": [{**self._member_view(member, platform), "member_name": name}
                             for member, name in self._members().items() for platform in self._base_types
                             if (member == 0 and platform == "telegram") or self._config.channel(member_account(member, platform)).connected]}

    @staticmethod
    def _for(kind: str, handler: Callable[..., Any]) -> Callable[[dict], Any]:
        return lambda params: handler(kind, params)

    # --- lifecycle ---

    def start(self) -> None:
        """Begin receiving on the connections that are on. Needs the running loop."""
        for member in self._members():
            for platform in self._base_types:
                self._member_type(member, platform)
        for kind in self._types:
            if self._config.channel(kind).enabled and self._secrets(kind) is not None:
                self._launch(kind)

    async def aclose(self) -> None:
        self._ended = True
        if self.cards:
            self.cards.close()
        for kind in list(self._running):
            await self._stop_receiving(kind)
        if self._http is not None and self._owns_http:
            await self._http.aclose()
            self._http = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient()
        return self._http

    def _secrets(self, kind: str) -> dict[str, str] | None:
        """What the vault keeps for an app, or None when any of it is missing."""
        found: dict[str, str] = {}
        for name in self._types[kind].secrets:
            try:
                value = self._vault.get(secret_name(kind, name))
            except Exception as exc:
                logger.warning("The vault could not be read for %s: %s", kind, type(exc).__name__)
                return None
            if value is None:
                return None
            found[name] = value
        return found

    def _launch(self, kind: str) -> None:
        running = self._running.get(kind)
        if self._ended or (running is not None and not running.task.done()):
            return
        secrets = self._secrets(kind)
        if secrets is None:
            return
        target = session_target(kind + ":chat")
        member = target[0] if target else 0
        if member and member not in self._members():
            return

        async def ask(session, text, language, source, **options):
            scoped = f"member:{member}:{session}" if member else session
            return await self._ask(scoped, text, language, source, **options)

        async def stop(session):
            return await self._stop(f"member:{member}:{session}" if member else session)

        switchboard = Switchboard(
            self._types[kind].make(secrets, self._client()),
            ask=ask,
            stop=stop,
            transcribe=self._transcribe,
            is_allowed=lambda user: self._config.channel(kind).is_allowed(user),
            chat_allowed=lambda chat: self._config.channel(kind).chat_allowed(chat),
            language=self._language,
            pairing=Pairing(changed=lambda event, pairing: self.cards.event(kind, event, pairing) if self.cards else None),
        )
        self._running[kind] = _Running(switchboard, asyncio.ensure_future(switchboard.run()))

    async def _stop_receiving(self, kind: str) -> None:
        running = self._running.pop(kind, None)
        if running is None:
            return
        running.task.cancel()
        await asyncio.gather(running.task, return_exceptions=True)
        await running.switchboard.aclose()

    # --- what the worker says when a task ends ---

    def handles(self, session: str) -> bool:
        """Whether a session is a conversation with a chat of one of the apps."""
        target = session_target(session)
        return target is not None and target[1] in self._base_types and (target[0] == 0 or target[0] in self._members())

    async def report(self, session: str, text: "str | Sequence[str]", *, files=()) -> None:
        """A background task of a chat has ended: tell that chat (one message, or several in order)."""
        target = session_target(session)
        if target is None or not self.handles(session):
            return
        member, kind, chat = target
        running = self._running.get(member_account(member, kind))
        if running is not None:
            await running.switchboard.tell(chat, text, files=files)

    async def remove_member(self, member: int) -> None:
        """Stop the member's owned poller and in-flight requests before its history is removed."""
        if member <= 0:
            return
        for platform in self._base_types:
            kind = self._member_type(member, platform)
            await self._disconnect(kind, {})
            self._config.channels.pop(kind, None)
            self._types.pop(kind, None)
        self._store.save(self._config)

    # --- the methods ---

    def _view(self, kind: str) -> dict[str, Any]:
        running = self._running.get(kind)
        receiving = running is not None and not running.task.done()
        pending = (
            []
            if running is None
            else [
                {"code": p.code, "name": p.name, "expires_in_s": max(0, int(left))}
                for p, left in running.switchboard.pairing.pending()
            ]
        )
        config = self._config.channel(kind)
        return {
            "connected": config.connected,
            "enabled": config.enabled,
            "running": receiving,
            "error": None if running is None else running.switchboard.error,
            "bot": {"username": config.bot_username} if config.connected else None,
            "allowed": [{"user_id": u.user_id, "name": u.name} for u in config.allowed],
            "pending": pending,
        }

    async def _status(self, kind: str, params: dict) -> dict:
        return self._view(kind)

    async def _connect(self, kind: str, params: dict, *, guard=None, card_id=None) -> dict:
        """Check the credentials, keep them in the vault and turn the connection on. They are
        never returned. Credentials that do not work come back as `ok: false` with the reason."""
        channel_type = self._types[kind]
        try:
            secrets = channel_type.read_secrets(params)
        except ValueError as error:
            raise invalid_params(str(error)) from None
        if secrets is None:
            return {"ok": False, "reason": "invalid_token"}
        try:
            identity = await channel_type.check(secrets, self._client())
        except ChannelError as error:
            logger.info("%s credentials check failed: %s", kind, error.kind)
            return {"ok": False, "reason": "network" if error.kind == "network" else "invalid_token"}
        async with self._lock:
            if guard is not None and not guard():
                return {"ok": False, "reason": "cancelled"}
            target = session_target(kind + ":chat")
            if target and target[0] and target[0] not in self._members():
                raise invalid_params("member_id must name an existing member")
            if any(
                key != kind and config.bot_id == identity.id and
                self._types.get(key) is not None and self._types[key].kind == self._types[kind].kind
                for key, config in self._config.channels.items()
            ):
                return {"ok": False, "reason": "bot_in_use"}
            await self._stop_receiving(kind)
            previous = self._config.channel(kind)
            for name, value in secrets.items():
                self._vault.set(secret_name(kind, name), value)
            same_bot = previous.bot_id == identity.id
            self._config.channels[kind] = ChannelConfig(
                enabled=True,
                bot_id=identity.id,
                bot_username=identity.name,
                # A different bot has other people talking to it: the allowlist starts empty.
                allowed=previous.allowed if same_bot else [],
            )
            self._store.save(self._config)
            if self.cards:
                self.cards.detached(kind)
                if card_id:
                    self.cards.connected(kind, card_id)
            self._launch(kind)
        return {"ok": True, "status": self._view(kind)}

    async def _set_enabled(self, kind: str, params: dict) -> dict:
        enabled = params.get("enabled")
        if type(enabled) is not bool:
            raise invalid_params("enabled must be true or false")
        async with self._lock:
            config = self._config.channel(kind)
            if not config.connected:
                raise invalid_params(f"{kind} is not connected")
            config.enabled = enabled
            self._store.save(self._config)
            if enabled:
                self._launch(kind)
            else:
                await self._stop_receiving(kind)
        return self._view(kind)

    async def _approve(self, kind: str, params: dict) -> dict:
        code = params.get("code")
        if not isinstance(code, str):
            raise invalid_params("code must be a string")
        running = self._running.get(kind)
        pairing = None if running is None else running.switchboard.pairing.take(code)
        if running is None or pairing is None:
            return {"approved": False, "status": self._view(kind)}
        config = self._config.channel(kind)
        if not config.is_allowed(pairing.user):
            if len(config.allowed) >= MAX_ALLOWED:
                raise invalid_params("too many people are allowed")
            config.allowed.append(AllowedUser(pairing.user, pairing.name, pairing.chat))
            self._store.save(self._config)
        if self.cards:
            self.cards.finish_code(kind, code, "approved")
        logger.info("%s: a pairing was approved, chat=%s", kind, chat_hash(pairing.chat))
        task = asyncio.ensure_future(running.switchboard.welcome(pairing.chat))
        task.add_done_callback(lambda t: t.cancelled() or t.exception())
        return {"approved": True, "status": self._view(kind)}

    async def _reject(self, kind: str, params: dict) -> dict:
        code = params.get("code")
        if not isinstance(code, str):
            raise invalid_params("code must be a string")
        running = self._running.get(kind)
        if running is not None:
            running.switchboard.pairing.take(code)
        if self.cards:
            self.cards.finish_code(kind, code, "rejected")
        return self._view(kind)

    async def _remove_user(self, kind: str, params: dict) -> dict:
        user_id = params.get("user_id")
        if not isinstance(user_id, str):
            raise invalid_params("user_id must be a string")
        config = self._config.channel(kind)
        config.allowed = [u for u in config.allowed if u.user_id != user_id]
        self._store.save(self._config)
        return self._view(kind)

    async def _disconnect(self, kind: str, params: dict) -> dict:
        """Forget the connection: its secrets are deleted from the vault and nobody stays allowed."""
        async with self._lock:
            await self._stop_receiving(kind)
            if self.cards:
                self.cards.detached(kind)
            for name in self._types[kind].secrets:
                with contextlib.suppress(Exception):
                    self._vault.delete(secret_name(kind, name))
            if self._any_left(kind):
                raise RpcError(INTERNAL_ERROR, "The secrets could not be removed from the vault")
            self._config.channels[kind] = ChannelConfig()
            self._store.save(self._config)
        return self._view(kind)

    def _any_left(self, kind: str) -> bool:
        for name in self._types[kind].secrets:
            try:
                if self._vault.get(secret_name(kind, name)) is not None:
                    return True
            except Exception:
                return True
        return False
