"""Configured providers, vault-only secrets and backwards-compatible model references.

    A model reference is a plain OpenRouter slug or @provider-id:model-id. Configuration is
    stored in private settings rows, requiring no schema rewrite or change to existing choices.
    RPCs accept provider ids, never per-request URLs or arbitrary headers.
"""

import asyncio
import json
import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import replace

import httpx

from ... import keychain
from ...protocol import INTERNAL_ERROR, INVALID_PARAMS, RpcError
from ..catalog import CatalogEntry, ModelPrice
from ..model_ref import split_api_ref
from ..openrouter import OpenRouterError
from ..secrets import KeyStore
from .. import first_models
from ..settings import SettingsStore, api_model
from .base import ModelProvider
from .presets import BY_KIND, KINDS, OPTIONAL_KEY_KINDS
from .clients import AnthropicProvider, CompatibleProvider, is_transcription, media_eligible, model_info, validate_base_url
from .presets import IMAGE_KINDS, VIDEO_KINDS
from .bedrock import BedrockProvider
from .vertex import VertexProvider
from .secrets import ProviderCredentialStore
from .chatgpt import ChatGPTProvider
from .chatgpt_auth import ChatGPTAuth, PLAN_SCOPE

CONFIG_KEY = "providers.config.v1"
MODELS_KEY = "providers.models.v1"
logger = logging.getLogger(__name__)


def _text(value, *, empty=False):
    if not isinstance(value, str) or len(value) > 2048 or (not empty and not value.strip()) or any(ord(c) < 32 for c in value):
        raise ValueError("Invalid provider field")
    return value.strip()


class OpenRouterProvider:
    """An unchanged existing client behind the provider interface."""

    def __init__(self, client):
        self.client = client

    def __getattr__(self, name):
        return getattr(self.client, name)


class ProviderRegistry:
    def __init__(self, conn, openrouter, keys: KeyStore, *,
                 credential: Callable[[str], KeyStore] | None = None,
                 http: httpx.AsyncClient | None = None, transport=None):
        self._conn, self.openrouter, self.keys = conn, openrouter, keys
        self._credential = credential or (lambda pid: ProviderCredentialStore(f"provider:{pid}"))
        self._own_http = httpx.AsyncClient(transport=transport) if transport is not None else None
        self._http = http if http is not None else self._own_http
        self._clients: dict[str, ModelProvider] = {}
        self._status: dict[str, str] = {}
        self._revisions: dict[str, int] = {}
        self._notify = lambda method, params: None
        self._configs = self._load(CONFIG_KEY, {})
        self._models = self._load(MODELS_KEY, {})
        self._awaiting_models = set()
        self.settings = SettingsStore(conn)
        self.chatgpt = ChatGPTProvider(ChatGPTAuth(conn, self._credential, http=self._http))
        self.image_subscriptions = None
        self.cli_brains = None
        self.chatgpt.auth.on_connected = self.fill_connected
        self.chatgpt.auth.on_models_cleared = self._clear_chatgpt_rows
        try:
            first_models.migrate(conn, self.config("openrouter")["enabled"], keys)
        except Exception as exc:
            logger.warning("Model choices migration deferred: %s", type(exc).__name__)

    def _load(self, key, default):
        row = self._conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        if row is None:
            return default
        try:
            data = json.loads(row["value"])
            return data if isinstance(data, dict) else default
        except (ValueError, TypeError):
            return default

    def _save(self):
        with self._conn:
            for key, value in ((CONFIG_KEY, self._configs), (MODELS_KEY, self._models)):
                self._conn.execute("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                                   (key, json.dumps(value)))

    def config(self, pid):
        if pid == "chatgpt":
            return {"id": pid, "kind": pid, "name": "ChatGPT", "base_url": "https://api.openai.com/v1", "enabled": True}
        if pid == "openrouter":
            return {"id": pid, "kind": pid, "name": "OpenRouter", "base_url": BY_KIND[pid]["default_base_url"],
                    "enabled": True, **self._configs.get(pid, {})}
        if pid not in self._configs:
            raise ValueError("Unknown provider")
        return dict(self._configs[pid])

    def _secret(self, pid):
        return self.keys if pid == "openrouter" else self._credential(pid)

    def ids(self):
        chatgpt = ["chatgpt"] if self.chatgpt.auth._state().get("accounts") else []
        return ["openrouter", *chatgpt, *(pid for pid in self._configs if pid not in ("openrouter", "chatgpt"))]

    def configured_fallbacks(self, purpose):
        """None preserves legacy defaults; an explicitly saved empty array disables them."""
        key = purpose + "_fallbacks"
        saved = self._conn.execute("SELECT 1 FROM settings WHERE key = ?", (key,)).fetchone()
        return self.settings.get(key) if saved else None

    def resolve(self, reference: str) -> tuple[str, str]:
        if not isinstance(reference, str) or not reference or reference.startswith("cli:") or len(reference) > 2048 or any(c.isspace() for c in reference):
            raise ValueError("Invalid model reference")
        if not reference.startswith("@"):
            return "openrouter", reference
        pid, sep, model = reference[1:].partition(":")
        if not sep or not model or not re.fullmatch(r"[A-Za-z0-9_-]+", pid):
            raise ValueError("Invalid model reference")
        self.config(pid)
        return pid, model

    def available(self, reference):
        try:
            pid, _ = self.resolve(reference)
            config = self.config(pid)
            if not config["enabled"]:
                return False
            return self._has_credential(pid, config) or config["kind"] in OPTIONAL_KEY_KINDS
        except ValueError:
            return False

    def _has_credential(self, pid, config):
        if pid == "chatgpt":
            state = self.chatgpt.auth._state()
            account_id = state.get("active", "")
            tokens = self.chatgpt.auth._tokens(account_id) if account_id else {}
            return bool(tokens.get("refresh_token")) and "chatgpt.tokens.use.direct" in tokens.get("scope", "").split()
        # Kept but not read in this run: reading it only to answer "is there a key" would ask the owner (keychain.py).
        value = self._secret(pid).peek()
        if value is keychain.UNREAD:
            return True
        if config["kind"] == "bedrock":
            try:
                credentials = json.loads(value or "{}")
                return all(isinstance(credentials.get(field), str) and credentials[field]
                           for field in ("key_id", "secret"))
            except (ValueError, AttributeError):
                return False
        return bool((value or "").strip())

    def client(self, pid) -> ModelProvider:
        config = self.config(pid)
        if not config["enabled"]:
            raise OpenRouterError(0, "error", "Provider is disabled")
        if pid == "openrouter":
            return OpenRouterProvider(self.openrouter)
        if pid == "chatgpt":
            return self.chatgpt
        if pid not in self._clients:
            cls = {"anthropic": AnthropicProvider, "vertex": VertexProvider,
                   "bedrock": BedrockProvider}.get(config["kind"], CompatibleProvider)
            self._clients[pid] = cls(config["kind"], config["base_url"], self._secret(pid).get,
                api_version=config.get("api_version", ""), http=self._http,
                **({"region": config["region"]} if config["kind"] == "bedrock" else {}))
            self._clients[pid]._prices = {row["id"]: (row["price_in"], row["price_out"])
                                         for row in self._models.get(pid, [])}
        return self._clients[pid]

    def view(self, pid):
        config = self.config(pid)
        try:
            has_key = self._has_credential(pid, config)
            status = self._status.get(pid, "unknown")
        except Exception:
            has_key, status = False, "auth"
        return {k: config[k] for k in ("id", "kind", "name", "base_url", "enabled")} | {
            "has_key": has_key, "status": status, "models": len(self._chatgpt_rows() if pid == "chatgpt" else self._models.get(pid, []))}

    def register(self, router):
        self._notify = router.notify
        async def chatgpt_models(params):
            return {"models": await self.discover("chatgpt")}
        self.chatgpt.auth.register(router, chatgpt_models)
        handlers = {"kinds": self.kinds, "list": self.list, "add": self.add, "update": self.update,
                    "remove": self.remove, "test": self.test, "models": self.models}
        for name, handler in handlers.items():
            async def safe(params, handler=handler):
                try:
                    return await handler(params)
                except (ValueError, TypeError, KeyError):
                    raise RpcError(INVALID_PARAMS, "Invalid provider configuration") from None
                except OpenRouterError as error:
                    raise RpcError(INTERNAL_ERROR, f"Provider request failed: {error.kind}", {"kind": error.kind}) from None
                except TimeoutError:
                    raise RpcError(INTERNAL_ERROR, "Provider request timed out", {"kind": "timeout"}) from None
                except Exception:
                    raise RpcError(INTERNAL_ERROR, "Provider operation failed") from None
            router.register(f"providers.{name}", safe)

    async def kinds(self, params):
        return {"kinds": KINDS}

    async def list(self, params):
        providers = []
        for pid in self.ids():
            view = self.view(pid)
            if pid != "openrouter" or view["has_key"] or pid in self._configs:
                providers.append(view)
        return {"providers": providers}

    def _checked(self, params, old=None):
        allowed = {"id", "kind", "name", "base_url", "key", "enabled", "api_version", "region", "key_id",
                   "secret", "service_account", "project", "location"}
        if set(params) - allowed:
            raise ValueError("Unknown provider field")
        kind = params.get("kind", (old or {}).get("kind"))
        preset = BY_KIND.get(kind)
        if preset is None or not preset["available"] or (old and kind != old["kind"]):
            raise ValueError("Unsupported provider kind")
        config = dict(old or {"kind": kind, "name": preset["name"], "enabled": True})
        config["name"] = _text(params.get("name", config["name"]))
        if set(params) & {"region", "key_id", "secret"} and kind != "bedrock":
            raise ValueError("Unexpected Bedrock field")
        if set(params) & {"project", "location", "service_account"} and kind != "vertex":
            raise ValueError("Unexpected Vertex field")
        if kind in ("bedrock", "vertex"):
            if "base_url" in params or "key" in params:
                raise ValueError("Native provider endpoint and credentials have dedicated fields")
            for field in (("region",) if kind == "bedrock" else ("project", "location")):
                value = params.get(field, config.get(field))
                if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", value):
                    raise ValueError("Invalid native provider field")
                config[field] = value
            if kind == "bedrock":
                suffix = "amazonaws.com.cn" if config["region"].startswith("cn-") else "amazonaws.com"
                config["base_url"] = f"https://bedrock-runtime.{config['region']}.{suffix}"
            else:
                config["base_url"] = (f"https://{config['location']}-aiplatform.googleapis.com/v1/projects/"
                                      f"{config['project']}/locations/{config['location']}/endpoints/openapi")
            for field in ("key_id", "secret"):
                if field in params and (not isinstance(params[field], str) or
                        (params[field] and not re.fullmatch(r"[!-~]{1,2048}", params[field]))):
                    raise ValueError("Invalid Bedrock credential")
            if "service_account" in params:
                value = params["service_account"]
                if not isinstance(value, str) or len(value) > 32768:
                    raise ValueError("Invalid service account")
                if value:
                    try:
                        account = json.loads(value)
                        if not all(isinstance(account[k], str) and account[k] for k in ("client_email", "private_key")):
                            raise ValueError
                    except (ValueError, KeyError, TypeError):
                        raise ValueError("Invalid service account") from None
        else:
            config["base_url"] = validate_base_url(_text(params.get("base_url", config.get("base_url", preset["default_base_url"]))))
        if kind == "openrouter" and config["base_url"] != BY_KIND[kind]["default_base_url"]:
            raise ValueError("OpenRouter endpoint is fixed")
        if kind == "google":
            # The shared contract's root URL is accepted as well as the full compatible URL.
            if url_path(config["base_url"]) in ("", "/"):
                config["base_url"] += "/v1beta/openai"
        if "enabled" in params:
            if type(params["enabled"]) is not bool:
                raise ValueError("Invalid enabled flag")
            config["enabled"] = params["enabled"]
        if "api_version" in params:
            config["api_version"] = _text(params["api_version"], empty=True)
        if kind == "azure_openai" and not config.get("api_version"):
            config["api_version"] = "2024-10-21"
        if "key" in params:
            key = params["key"]
            if not isinstance(key, str) or (key and not re.fullmatch(r"[!-~]+", key)):
                raise ValueError("Invalid provider key")
        return config

    async def add(self, params):
        config = self._checked(params)
        pid = "openrouter" if config["kind"] == "openrouter" else "p" + uuid.uuid4().hex[:12]
        if pid == "openrouter" and (pid in self._configs or self.view(pid)["has_key"]):
            raise ValueError("Provider already exists")
        config["id"] = pid
        await self._write(pid, config, params)
        return {"provider": self.view(pid)}

    async def update(self, params):
        pid = _text(params["id"])
        if pid == "chatgpt":
            raise ValueError("Use ChatGPT sign-in RPCs")
        config = self._checked(params, self.config(pid))
        await self._write(pid, config, params)
        return {"provider": self.view(pid)}

    async def _write(self, pid, config, params):
        secret = self._secret(pid)
        changed_secret = bool(set(params) & {"key", "secret", "key_id", "service_account"})
        old_key = secret.get() if changed_secret else None
        new_key = params.get("service_account", params.get("key"))
        if config["kind"] == "bedrock" and changed_secret:
            credentials = json.loads(old_key) if old_key else {}
            credentials.update({k: params[k] for k in ("key_id", "secret") if k in params})
            new_key = json.dumps(credentials) if any(credentials.values()) else ""
        previous, old_models = dict(self._configs), dict(self._models)
        try:
            if changed_secret:
                secret.set(new_key) if new_key else secret.clear()
            self._configs[pid] = config
            self._models.pop(pid, None)
            self._save()
        except Exception:
            self._configs, self._models = previous, old_models
            if changed_secret:
                secret.set(old_key) if old_key else secret.clear()
            raise
        self._revisions[pid] = self._revisions.get(pid, 0) + 1
        client = self._clients.pop(pid, None)
        if client:
            await client.aclose()
        self._status.pop(pid, None)
        self._notify("providers.changed", {})
        if pid not in previous or changed_secret or (not previous[pid]["enabled"] and config["enabled"]):
            await self.fill_connected(pid)

    async def fill_connected(self, pid):
        if not self.available(f"@{pid}:catalog") or all(self.settings.get(k) for k in first_models.SETTINGS.values()):
            return
        self._awaiting_models.add(pid)
        try:
            await self.discover(pid)
        except Exception as exc:
            logger.info("Connected source catalogue unavailable: %s", type(exc).__name__)

    def _fill_from_catalog(self, pid, rows):
        if pid not in self._awaiting_models or not self.available(f"@{pid}:catalog"):
            return
        choices = first_models.recommendations(rows)
        if not choices:
            return
        if pid != "openrouter":
            choices = {role: f"@{pid}:{model}" for role, model in choices.items()}
        self.settings.fill_models(self.config(pid)["name"], choices, self._notify)
        self._awaiting_models.discard(pid)

    async def remove(self, params):
        pid = _text(params["id"])
        if pid == "chatgpt":
            raise ValueError("Use ChatGPT sign-out RPC")
        self.config(pid)
        secret, previous, old_models = self._secret(pid), dict(self._configs), dict(self._models)
        old_key = secret.get()
        try:
            secret.clear()
            self._configs.pop(pid, None)
            self._models.pop(pid, None)
            self._save()
        except Exception:
            self._configs, self._models = previous, old_models
            if old_key:
                secret.set(old_key)
            raise
        self._revisions[pid] = self._revisions.get(pid, 0) + 1
        client = self._clients.pop(pid, None)
        if client:
            await client.aclose()
        self._status.pop(pid, None)
        self._awaiting_models.discard(pid)
        self._notify("providers.changed", {})
        return {"removed": True}

    async def discover(self, pid):
        revision = self._revisions.get(pid, 0)
        session = self.chatgpt.auth.session() if pid == "chatgpt" else None
        rows = await asyncio.wait_for(self.client(pid).models(timeout_s=5), 6)
        if self._revisions.get(pid, 0) != revision:
            raise OpenRouterError(0, "error", "Provider changed during discovery")
        if pid == "openrouter":
            from ..catalog import parse_catalog, refusal, ROLE_OF_SETTING
            entries = {entry.id: entry for entry in parse_catalog(rows)}
            metadata = [model_info(row, kind="openrouter") for row in rows]
            for row in metadata:
                entry = entries.get(row["id"])
                row["stt"] = entry is not None and entry.kind == "stt"
                row["text_eligible"] = entry is not None and refusal(entry, ROLE_OF_SETTING["cleanup_model"]) is None
            rows = metadata
        if pid == "chatgpt":
            self.chatgpt.auth.check_session(session)
            self._models[pid] = {"account": session[0], "rows": rows}
        else:
            self._models[pid] = rows
        self._status[pid] = "ok"
        self._save()
        self._fill_from_catalog(pid, rows)
        return rows

    async def test(self, params):
        if set(params) - {"id"}:
            return await self._test_draft(params)
        pid = _text(params["id"])
        self.config(pid)
        try:
            # OpenRouter discovery is public, so checking its key is a separate authenticated call.
            if pid == "openrouter":
                await asyncio.wait_for(self.client(pid).key_info(), 6)
            rows = await self.discover(pid)
            return {"ok": True, "models": len(rows)}
        except (OpenRouterError, TimeoutError) as error:
            kind = getattr(error, "kind", "timeout")
            kind = "auth" if kind == "auth" else "offline" if kind in ("offline", "network", "timeout") else "error"
            self._status[pid] = kind if kind != "error" else "unknown"
            return {"ok": False, "kind": kind, "models": 0}

    def _draft_credential(self, config, params, pid):
        """The credential a draft is tested with: what was typed, else (for a saved provider) the stored one. Never stored."""
        kind = config["kind"]
        fields = {"bedrock": ("key_id", "secret"), "vertex": ("service_account",)}.get(kind, ("key",))
        typed = {field: params[field] for field in fields if params.get(field)}
        stored = self._secret(pid).get() if pid and len(typed) < len(fields) else None
        if kind == "bedrock":
            credentials = json.loads(stored) if stored else {}
            credentials.update(typed)
            return json.dumps(credentials) if any(credentials.values()) else ""
        return typed.get(fields[0]) or stored or ""

    async def _test_draft(self, params):
        """Test the fields of a form that is not saved: the typed values over the saved ones, nothing kept.

        No setting, model list, status or secret is written, so a refused key leaves the provider as it was
        and a key typed here is read once, held by the client that asks, and dropped.
        """
        params = dict(params)
        pid = params.pop("id", None)
        old = None
        if pid is not None:
            pid = _text(pid)
            if pid == "chatgpt":
                raise ValueError("Use ChatGPT sign-in RPCs")
            old = self.config(pid)
        config = self._checked(params, old)
        try:
            credential = self._draft_credential(config, params, pid)
        except Exception:
            return {"ok": False, "kind": "auth", "models": 0}
        client = None
        try:
            if config["kind"] == "openrouter":
                # Its list is public: only the key says whether the account answers.
                await asyncio.wait_for(self.openrouter.key_info(credential), 6)
                rows = [model_info(row, kind="openrouter") for row in await asyncio.wait_for(self.openrouter.models(timeout_s=5), 6)]
            else:
                cls = {"anthropic": AnthropicProvider, "vertex": VertexProvider,
                       "bedrock": BedrockProvider}.get(config["kind"], CompatibleProvider)
                client = cls(config["kind"], config["base_url"], lambda: credential or None,
                    api_version=config.get("api_version", ""), http=self._http,
                    **({"region": config["region"]} if config["kind"] == "bedrock" else {}))
                rows = await asyncio.wait_for(client.models(timeout_s=5), 6)
        except (OpenRouterError, TimeoutError) as error:
            kind = getattr(error, "kind", "timeout")
            return {"ok": False, "kind": "auth" if kind == "auth" else "offline" if kind in ("offline", "network", "timeout") else "error", "models": 0}
        finally:
            if client is not None:
                await client.aclose()
        found = [{**row, "context_warning": False} for row in rows if not row.get("generation_only")]
        return {"ok": True, "models": len(rows), "found": found}

    async def models(self, params):
        pid = _text(params["id"])
        rows = await self.discover(pid)
        selected = {self.settings.get("agent_model"), *self.settings.get("agent_fallbacks")}
        selected.update(row[0] for row in self._conn.execute("SELECT model FROM members WHERE model != ''"))
        local = BY_KIND.get(self.config(pid)["kind"], {}).get("local_context_hint", False)
        return {"models": [{**row, "context_warning": bool(local and row["context"] is not None
                           and row["context"] < 65_536 and f"@{pid}:{row['id']}" in selected)} for row in rows if not row.get("generation_only")]}

    def media_choices(self, kind):
        choices = []
        for pid in self.ids():
            config = self.config(pid)
            if config["kind"] not in (VIDEO_KINDS if kind == "video" else IMAGE_KINDS):
                continue
            for row in self._models.get(pid, []):
                reference = row["id"] if pid == "openrouter" else f"@{pid}:{row['id']}"
                if media_eligible(config["kind"], row["id"]) and kind in row.get("media", []) and self.available(reference):
                    choices.append({**row, "reference": reference})
        if kind == "image" and self.image_subscriptions is not None:
            choices.extend(self.image_subscriptions.choices())
        return choices

    def remember_openrouter_media(self, rows):
        metadata = [model_info(row, kind="openrouter") for row in rows]
        self._models["openrouter"] = [row for row in metadata if row["media"]]
        self._save()

    def catalog_entries(self):
        entries = []
        for pid in self.ids():
            if pid == "openrouter" or not self.config(pid)["enabled"]:
                continue
            config = self.config(pid)
            for row in (self._chatgpt_rows() if pid == "chatgpt" else self._models.get(pid, [])):
                if row.get("generation_only"):
                    continue
                caps = {"structured_output", "reasoning", "reasoning_off", "max_tokens"}
                if row["tools"]:
                    caps.add("tool_calling")
                if row["vision"]:
                    caps.add("image_input")
                audio = is_transcription(config["kind"], row["id"])
                entries.append(CatalogEntry(f"@{pid}:{row['id']}", "stt" if audio else "llm", row["name"], config["name"],
                    ModelPrice(input_per_mtok=row["price_in"], output_per_mtok=row["price_out"]), False,
                    row["context"], None, frozenset() if audio else frozenset(caps),
                    reasoning_efforts=tuple(row.get("reasoning_efforts") or ()) or None if not audio else None,
                    default_effort=row.get("default_effort")))
        return entries

    def _clear_chatgpt_rows(self):
        if self._models.pop("chatgpt", None) is not None:
            self._save()

    def _chatgpt_rows(self):
        auth = self.chatgpt.auth
        state = auth._state()
        account = state.get("active")
        kept = self._models.get("chatgpt")
        if not account or not isinstance(kept, dict) or kept.get("account") != account:
            return []
        try:
            # Peek never opens the Keychain. After a restart use the last known plan grant.
            secret = auth._vault(account).peek()
            if secret is keychain.UNREAD:
                allowed = state.get("accounts", {}).get(account, {}).get("plan_scope", False)
            else:
                tokens = json.loads(secret or "{}")
                allowed = tokens.get("refresh_token") and PLAN_SCOPE in tokens.get("scope", "").split()
        except Exception:
            # Credential stores can be locked. An unconfirmed grant exposes no saved rows.
            return []
        return kept["rows"] if allowed else []

    async def refresh_catalog(self, changed):
        async def drawing():
            if self.image_subscriptions is not None:
                before = self.image_subscriptions.choices()
                await self.image_subscriptions.refresh()
                if self.image_subscriptions.choices() != before:
                    changed()
        async def fetch(pid):
            before = self._models.get(pid)
            try:
                await self.discover(pid)
                if self._models.get(pid) != before:
                    changed()
            except (OpenRouterError, TimeoutError):
                pass  # A failed refresh keeps the last known metadata and never resets choices.
        # The Codex drawing check starts a program; the providers' lists never wait for it.
        await asyncio.gather(drawing(), *(fetch(pid) for pid in self.ids()
            if pid != "openrouter" and self.config(pid)["enabled"] and
            (pid != "chatgpt" or self.available("@chatgpt:catalog"))))

    def record_result(self, pid, error=None):
        kind = getattr(error, "kind", None)
        self._status[pid] = ("ok" if error is None else "auth" if kind == "auth" else
                             "offline" if kind in ("offline", "network", "timeout") else "unknown")

    async def aclose(self):
        await self.chatgpt.aclose()
        clients, self._clients = list(self._clients.values()), {}
        for client in clients:
            await client.aclose()
        if self._own_http is not None:
            await self._own_http.aclose()


def url_path(url):
    from urllib.parse import urlsplit
    return urlsplit(url).path


def for_purpose(client, purpose):
    """Scope the real router while retaining simple provider fakes at consumer seams."""
    return client.for_purpose(purpose) if isinstance(client, ProviderRouter) else client


class ProviderRouter:
    """One resolver injected into every model consumer. Plain slugs keep their old wire format.

    OpenRouter's public list/key balance and alpha decision endpoint stay OpenRouter-specific;
    completion methods route by reference and never send OpenRouter fallbacks to another service.
    """

    def __init__(self, registry, openrouter, purpose="agent"):
        self.registry, self.openrouter = registry, openrouter
        self.purpose = purpose

    def for_purpose(self, purpose):
        if purpose not in ("agent", "cleanup", "router", "vision", "pdf", "stt", "memory"):
            raise ValueError("Unknown model purpose")
        return ProviderRouter(self.registry, self.openrouter, purpose)

    def model_for(self, reference):
        if self.purpose in ("router", "memory", "pdf"):
            reference = self.registry.settings.get(self.purpose + "_model") or reference
        if self.purpose in ("cleanup", "vision"):
            return reference
        return api_model(self.registry.settings, reference) if reference.startswith("cli:") else reference

    def available(self, model):
        if self.purpose == "cleanup" and model.startswith("cli:"):
            from ...agent.cli.discovery import brain_ref
            found = brain_ref(model)
            return bool(found and self.registry.cli_brains and self.registry.cli_brains.available(found[0]))
        if not model:
            return False
        if self.purpose != "cleanup" and self.model_for(model).startswith("@chatgpt:"):
            # The provider reports missing sign-in/scope locally with the selected model's
            # classified failure, rather than the legacy OpenRouter missing-key message.
            return True
        references = [self.model_for(model), *self.owner_fallbacks()]
        unreadable = False
        for reference in references:
            try:
                if self.registry.available(reference):
                    return True
            except Exception:
                unreadable = True
        if unreadable:
            raise OpenRouterError(0, "auth", "Could not read provider credential") from None
        return False

    def missing(self, model):
        from ...failures import Failure, Missing
        reference = self.model_for(model)
        pid = reference[1:].partition(":")[0] if reference.startswith("@") else "openrouter"
        try:
            config = self.registry.config(pid)
            state = "off" if not config["enabled"] else "missing"
        except ValueError:
            state = "missing"
        return Failure("auth_expired", "Selected provider unavailable", missing=Missing(pid, "provider", state, "models"))

    def api_providers(self):
        """The services a model reference may name for API work: all but those on this computer."""
        return {pid for pid in self.registry.ids() if BY_KIND.get(self.registry.config(pid)["kind"], {}).get("group") != "local"}

    def owner_fallbacks(self):
        # Conversation fallback controls were removed. Hidden legacy settings do not
        # authorize switching the owner's chosen conversation or routing model.
        if self.purpose == "vision" and self.registry.settings.get("vision_model"):
            return []
        if self.purpose in ("agent", "router", "cleanup"):
            return []
        return self.registry.configured_fallbacks(self.purpose) or []

    async def _call(self, method, kwargs):
        reference = self.model_for(kwargs["model"])
        explicit = self.owner_fallbacks()
        chain = list(dict.fromkeys([reference, *explicit]))
        if reference.startswith("@chatgpt:"):
            chain = [reference]
        # Each selected model receives the complete caller budget, never a fraction
        # determined by the number of possible alternatives.
        timeout = kwargs["timeout_s"]
        for index, target in enumerate(chain):
            attempt = {**kwargs, "model": target, "timeout_s": timeout}
            try:
                # A conversation's call has no deadline of its own: its timeout is how long the connection may stay silent.
                return await asyncio.wait_for(self._attempt(method, attempt), None if method == "chat_tools" else timeout)
            except TimeoutError:
                error = OpenRouterError(0, "timeout", "Provider request timed out")
                pid, _ = self.registry.resolve(target)
                self.registry.record_result(pid, error)
            except OpenRouterError as caught:
                error = caught
            # A 429 that says one provider's quota is spent is still a reason to ask the next one.
            retryable = error.kind in ("offline", "network", "timeout", "rate_limit", "server") or (
                error.kind == "error" and error.status >= 500) or (
                error.kind in ("credits", "usage_limit") and error.status == 429)
            # An auth failure may cross a provider boundary only with an explicitly
            # listed fallback. Content refusals and malformed requests never retry.
            if index + 1 == len(chain) or not (retryable or (error.kind == "auth" and explicit)):
                raise error from None
            source_id = target[1:].partition(":")[0] if target.startswith("@") else "openrouter"
            next_ref = chain[index + 1]
            next_id = next_ref[1:].partition(":")[0] if next_ref.startswith("@") else "openrouter"
            logger.warning("Provider fallback: purpose=%s from=%s to=%s kind=%s attempt=%d",
                           self.purpose, source_id, next_id, error.kind, index + 1)
        raise AssertionError("Empty provider chain")

    async def _attempt(self, method, kwargs):
        reference = kwargs["model"]
        if not reference:
            raise OpenRouterError(0, "no_model", "No model selected for " + self.purpose)
        try:
            reference, effort = split_api_ref(reference)
            pid, model = self.registry.resolve(reference)
            client = self.registry.client(pid)
        except ValueError:
            raise OpenRouterError(0, "error", "Unknown provider or invalid model reference") from None
        kwargs = {**kwargs, "model": model}
        if effort is not None and method != "transcribe":
            kwargs["reasoning_effort"] = effort
        if "fallbacks" in kwargs:
            kwargs["fallbacks"] = []
        try:
            result = await getattr(client, method)(**kwargs)
        except OpenRouterError as error:
            from ...failures import Missing, classify
            diagnostic = classify(error, record=False)
            if diagnostic.kind in ("auth_expired", "chatgpt_scope", "chatgpt_plan_unavailable"):
                error.diagnostic = replace(diagnostic, missing=Missing(pid, "provider", "broken", "models"))
            self.registry.record_result(pid, error)
            raise
        self.registry.record_result(pid)
        if pid != "openrouter":
            result = replace(result, model=f"@{pid}:{result.model}")
        return result

    async def complete_json(self, **kwargs):
        if self.purpose == "cleanup" and kwargs["model"].startswith("cli:"):
            from ...agent.ledger import Ledger
            from ...memory.brain import subscription_json
            from ..spend import SpendTracker
            if not self.available(kwargs["model"]):
                raise OpenRouterError(0, "auth", "Text cleanup model unavailable")
            return await subscription_json(self.registry.cli_brains, 0, "cleanup-" + uuid.uuid4().hex,
                                           Ledger(SpendTracker(self.registry._conn), "cleanup"), **kwargs)
        return await self._call("complete_json", kwargs)

    async def chat_text(self, **kwargs):
        return await self._call("chat_text", kwargs)

    async def plan_tools(self, **kwargs):
        return await self._call("plan_tools", kwargs)

    async def chat_tools(self, **kwargs):
        return await self._call("chat_tools", kwargs)

    async def transcribe(self, **kwargs):
        return await self._call("transcribe", kwargs)

    async def decide(self, **kwargs):
        if kwargs["model"].startswith("@"):
            raise OpenRouterError(0, "unsupported", "Decisions require OpenRouter")
        return await self.registry.client("openrouter").decide(**kwargs)

    async def models(self, timeout_s=5):
        rows = await self.openrouter.models(timeout_s=timeout_s)
        self.registry.remember_openrouter_media(rows)
        return rows

    async def key_info(self, key=None, timeout_s=5):
        return await self.openrouter.key_info(key=key, timeout_s=timeout_s)

    def warm_up(self):
        self.openrouter.warm_up()

    def start_connection_warmup(self):
        reference = self.registry.settings.get("stt_cloud_model")
        try:
            if reference and self.registry.available(reference):
                pid, _ = self.registry.resolve(reference)
                warm = getattr(self.registry.client(pid), "start_connection_warmup", None)
                if warm is not None:
                    warm()
        except Exception as exc:
            logger.debug("Skipped speech connection warmup: %s", type(exc).__name__)

    async def aclose(self):
        await self.registry.aclose()
        await self.openrouter.aclose()
