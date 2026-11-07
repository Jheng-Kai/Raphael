"""The services of Raphael's tools in one place: which one the owner chose for each, their keys,
and the `services.*` methods of the settings page.

`ServiceHub` reads the choices from the settings at each call (`web_search_service`,
`web_read_service`, `pdf_service`, `vision_model`, `searxng_url`, `tts_service`, `tts_fish_voice`,
`tts_fish_model`) and whether each capability is on at all (`web_search_enabled`,
`web_read_enabled`, `vision_enabled`, `pdf_enabled`, `tts_enabled`: `enabled`), so a change the
owner makes takes effect with the next request, and it holds the keys (`keys.ServiceKeys`), the HTTP client the
services are called with, the safe fetch of the built-in page reader (`fetch.PageFetcher`) and the
model that sees (`vision.Vision`). The fast tier (`agent.tools.Tools`) and the background worker's
tools reach the services through it alone.

RPC methods (the choice itself is `settings.set`, like any other setting):

- `services.status {include_backends: true}` adds the complete tool backend inventory
  (`backend_schema: 1`), including rows needing keys, installation, settings or
  engine integration. Each option retains the four legacy fields and adds `name`,
  `description_id`, `billing`, `key_service`, `integration`, `implementation` and
  `selection_supported`. This is metadata, not permission to execute a tool.
  Existing calls without this opt-in retain their original response contract.

- `services.status` -> `{search, read, pdf, vision, voice}`. `search`, `read` and `pdf` are each
  `{enabled, service, options: [{id, needs_key, has_key, key_optional}]}`: whether the capability
  is on (a capability that is off is not used at all), the service chosen, and each one
  that could be, with whether it needs a key of the owner's, whether one is stored and whether a key
  is optional (Jina's: it works without one, with lower limits). SearXNG's option also has
  `url_set`, whether its address is set. `vision` is `{enabled, model, resolved_model, supports_images}`:
  the setting ("" for the answer model), the model that reads images in the end, and whether
  OpenRouter's list says it reads them (null when the list does not say). `voice` is Raphael's
  voice: `{enabled, service, options, fish_voice_set}`, with `enabled`, `service` and `options` as
  above (only "fish", which needs a key) and whether the owner has filled in the Fish Audio voice id (the id
  itself is a setting, `tts_fish_voice`). A key is never in it.
- `services.set_key {service, key}` -> `{ok: true}`: the key of a keyed service, without the
  spaces around it, 1 to 512 characters with no space or control character inside, stored in the
  vault. The key is never echoed back, and a key that is refused is refused by a kind.
- `services.clear_key {service}` -> `{ok: true}`: the key removed.
- `links.preview {url}` -> `{url, site, title, description, thumbnail}` or null: public web
  metadata for the chat. Successful results live for a day in a bounded memory cache; thumbnails
  are safely fetched, capped raster data URLs. Failures are quiet and cached for five minutes.

Nothing here logs a key, a query, an address, a file's name or a result.
"""

import logging
import sqlite3
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from ..agent.ledger import Ledger
from ..brain.catalog import IMAGE_INPUT, LLM, CatalogEntry, find
from ..brain.providers.base import ModelProvider
from ..brain.settings import DEFAULTS, SettingsStore, api_model, hosted_providers
from ..protocol import INTERNAL_ERROR, INVALID_PARAMS, RpcError, invalid_params
from ..router import Router
from . import pdf, tts, web
from . import backends
from .attachments import Attachment
from .file_reader import read_file, Transcribe
from .common import ServiceError
from .fetch import PageFetcher, Resolver, system_resolver
from .links import LinkPreviews, THUMBNAIL_BYTES
from .keys import KEYED_SERVICES, KeyRefused, ServiceKeys
from .vision import Vision

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Option:
    """A service that may be chosen for a tool: whether it needs a key of the owner's, and whether
    one is optional (it works without, and better with)."""

    id: str
    needs_key: bool = False
    key_optional: bool = False


SEARCH_OPTIONS = (
    Option("openrouter"),
    Option("brave", needs_key=True),
    Option("tavily", needs_key=True),
    Option("exa", needs_key=True),
    Option("searxng"),
    *(Option(row.id, bool(row.key_service), row.key_optional) for row in backends.SEARCH),
)
READ_OPTIONS = (
    Option("builtin"),
    Option("jina", key_optional=True),
    Option("firecrawl", needs_key=True),
    Option("tavily", needs_key=True),
    *(Option(row.id, bool(row.key_service), row.key_optional) for row in backends.READ if row.id != "firecrawl"),
)
PDF_OPTIONS = (Option("builtin"), Option("openrouter"))
TTS_OPTIONS = (Option("fish", needs_key=True), *(Option(row.id, bool(row.key_service)) for row in backends.VOICE))

# The capabilities that can be turned off, and the setting that holds the switch of each.
CAPABILITIES = {
    "search": "web_search_enabled",
    "read": "web_read_enabled",
    "vision": "vision_enabled",
    "pdf": "pdf_enabled",
    "voice": "tts_enabled",
}


def _setting(settings: SettingsStore, key: str, choices: Sequence[Option]) -> str:
    """The service chosen for a tool; the default when the saved one cannot be read or is none of
    the choices (an older version's, say)."""
    try:
        value = settings.get(key)
    except sqlite3.Error as exc:
        logger.warning("Could not read the setting %s: %s", key, type(exc).__name__)
        value = None
    return value if any(option.id == value for option in choices) else DEFAULTS[key]


class ServiceHub:
    """The services, as the owner chose them. `conn` is the open database (the settings; used on
    the event loop only), `client` the OpenRouter client (the model that sees), `keys` the keys of
    the keyed services, `models` the catalog of OpenRouter's models as it was last read
    (`Brain.known_models`; None or no catalog: what a model reads is not known). `transport` and
    `resolver` are for tests: httpx's transport for every call (the services' and the page
    reader's), and the resolver of the page reader."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        client: ModelProvider,
        keys: ServiceKeys,
        *,
        models: Callable[[], Sequence[CatalogEntry] | None] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        resolver: Resolver = system_resolver,
        transcribe: Transcribe | None = None,
    ) -> None:
        self._transcribe = transcribe
        self._provider = client
        self._settings = SettingsStore(conn)
        self._keys = keys
        self._models = models
        self._transport = transport
        self._http: httpx.AsyncClient | None = None
        self.fetcher = PageFetcher(resolver=resolver, transport=transport)
        self.media_fetcher = PageFetcher(resolver=resolver, transport=transport, media=True)
        self.links = LinkPreviews(self.media_fetcher, PageFetcher(
            resolver=resolver, transport=transport, media=True, max_bytes=THUMBNAIL_BYTES,
        ))
        self.vision = Vision(client, self.vision_model)

    def register(self, router: Router) -> None:
        for method, handler in {
            "services.status": self._status,
            "services.set_key": self._set_key,
            "services.clear_key": self._clear_key,
            "links.preview": self.links.handle,
        }.items():
            router.register(method, handler)

    async def aclose(self) -> None:
        await self.links.aclose()
        http, self._http = self._http, None
        if http is not None:
            await http.aclose()

    def _client(self) -> httpx.AsyncClient:
        """The HTTP client the services are called with, made on first use. It reads no proxy or
        credentials from the environment."""
        if self._http is None:
            self._http = httpx.AsyncClient(transport=self._transport, trust_env=False)
        return self._http

    # --- what is chosen -------------------------------------------------------------------------

    def search_service(self) -> str:
        return _setting(self._settings, "web_search_service", SEARCH_OPTIONS)

    def read_service(self) -> str:
        return _setting(self._settings, "web_read_service", READ_OPTIONS)

    def pdf_service(self) -> str:
        return _setting(self._settings, "pdf_service", PDF_OPTIONS)

    def tts_service(self) -> str:
        """The selected speaker; settings owns which choices can be persisted."""
        return _setting(self._settings, "tts_service", TTS_OPTIONS)

    def enabled(self, capability: str) -> bool:
        """Whether the owner has `capability` ("search", "read", "vision", "pdf" or "voice") on. A
        capability that is off is not used at all, whatever service is chosen for it. A setting
        that cannot be read is its default."""
        key = CAPABILITIES[capability]
        try:
            value = self._settings.get(key)
        except sqlite3.Error as exc:
            logger.warning("Could not read the setting %s: %s", key, type(exc).__name__)
            value = DEFAULTS[key]
        return value is True

    def vision_model(self) -> tuple[str, bool | None]:
        """The model that reads images (the `vision_model` setting, or the answer model when it is
        ""), and whether OpenRouter's list says it reads them: None when the list does not say."""
        chosen = self._text("vision_model")
        model = api_model(self._settings, chosen or self._text("agent_model"), api_providers=hosted_providers(self._provider))
        return model, self._sees(model)

    def _text(self, key: str) -> str:
        try:
            value = self._settings.get(key)
        except sqlite3.Error as exc:
            logger.warning("Could not read the setting %s: %s", key, type(exc).__name__)
            return ""
        return value.strip() if isinstance(value, str) else ""

    def _optional_text(self, key: str) -> str:
        # The sole registry is extended by its owner, not by this service layer.
        return self._text(key) if key in DEFAULTS else ""

    def _sees(self, model: str) -> bool | None:
        try:
            entries = None if self._models is None else self._models()
        except Exception as exc:  # what the catalog knows must not stop a request
            logger.warning("Could not read the catalog of models: %s", type(exc).__name__)
            entries = None
        entry = None if not entries else find(entries, LLM, model)
        return None if entry is None else IMAGE_INPUT in entry.capabilities

    # --- the tools ------------------------------------------------------------------------------

    async def search(self, query: str) -> tuple[str, dict]:
        """(the service, what it found for `query`) with the search service chosen. Not for
        "openrouter", which the answer model's own call is. ServiceError of a kind."""
        service = self.search_service()
        key = self._keys.get(service) if service in KEYED_SERVICES else None
        found = await web.search(
            service, query, http=self._client(), key=key, searxng_url=self._text("searxng_url"),
            firecrawl_url=self._optional_text("firecrawl_url"),
        )
        return service, found

    async def read(self, url: str) -> tuple[str, dict]:
        """(the service, the page at `url`) with the reading service chosen. ServiceError."""
        service = self.read_service()
        key = self._keys.get(service) if service in KEYED_SERVICES else None
        page = await web.read(
            service, url, http=self._client(), fetcher=self.fetcher, read_pdf=pdf.read_pdf, key=key,
            firecrawl_url=self._optional_text("firecrawl_url"),
        )
        return service, page

    def tts_ready(self, *, voice: str = "") -> bool:
        """Whether Raphael can be heard: a voice service is chosen and has what it needs (for
        Fish Audio, a key and the owner's voice id). Nothing is requested to tell."""
        if not self.enabled("voice"):
            return False
        service = self.tts_service()
        if service in KEYED_SERVICES and not self._keys.has(service):
            return False
        return service != "fish" or bool(voice or self._text("tts_fish_voice"))

    def speech(self, text: str, *, voice: str | None = None) -> AsyncIterator[bytes]:
        """The speech of `text` by the voice service chosen (`tts.stream`) as chunks of PCM
        (`tts.PCM_RATE`, mono, 16-bit), with its key, voice and model as the settings and the vault
        hold them now. Close it (`contextlib.aclosing`) unless it is read to its end. ServiceError
        of a kind, among them "not_configured" (no service, or no voice id) and "missing_secret"
        (no key), raised when it is first read."""
        service = self.tts_service()
        key = self._keys.get(service) if service in KEYED_SERVICES else None
        return tts.stream(
            service,
            text,
            http=self._client(),
            key=key,
            voice=(self._text("tts_fish_voice") if service == "fish" else self._optional_text("tts_voice")) if voice is None else voice,
            model=self._text("tts_fish_model") if service == "fish" else self._optional_text("tts_model"),
        )

    async def audio_file(self, text: str, *, voice: str | None = None) -> Attachment:
        import io
        import wave
        from contextlib import aclosing
        from .attachments import MAX_FILE_BYTES

        if not self.enabled("voice"):
            raise ServiceError("disabled")
        pcm = bytearray()
        async with aclosing(self.speech(text, voice=voice)) as stream:
            async for chunk in stream:
                pcm.extend(chunk)
                if len(pcm) > MAX_FILE_BYTES - 44:
                    raise ServiceError("size")
        if not pcm or len(pcm) % 2:
            raise ServiceError("bad_response")
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(tts.PCM_RATE)
            audio.writeframes(pcm)
        return Attachment("speech.wav", "audio/wav", output.getvalue())

    async def read_attachment(
        self, attachment: Attachment, question: str, ledger: Ledger
    ) -> tuple[str, dict]:
        """The reader kind and bounded data for a supplied file. Images/PDFs retain their
        configured services; other files use local extraction or the existing STT callback."""
        if attachment.is_pdf:
            service = self.pdf_service()
            # The scanned pages of a PDF are read as images, so with the images off they stay
            # unread; "openrouter" reads the whole file and needs the model whatever that switch says.
            sees = service == "openrouter" or self.enabled("vision")
            found = await pdf.read_pdf(
                attachment,
                service=service,
                vision=self.vision if sees else None,
                question=question,
                ledger=ledger,
            )
            return "pdf", found
        if attachment.is_image:
            return "image", await self.vision.look([attachment], question, ledger)
        callback = self.transcribe if self._optional_text("stt_service") else self._transcribe
        return await read_file(attachment, callback)

    async def transcribe(self, audio: bytes, language: str = "auto") -> str:
        from .speech_backends import transcribe
        service = self._optional_text("stt_service")
        key = self._keys.get(service) if service in KEYED_SERVICES else None
        return await transcribe(service, audio, language, http=self._client(), key=key,
                                model=self._optional_text("stt_model"))

    async def x_search(self, query: str) -> dict:
        # An agent registration/grant remains the responsibility of the tool owner.
        from .web_backends import x_search
        async def call(method, url, **kwargs):
            return await web._call(self._client(), method, url, **kwargs)
        try:
            return await x_search(query, key=self._keys.get("xai"), call=call)
        except ServiceError as error:
            error.service = "xai"
            raise
        except (ValueError, TypeError, KeyError, AttributeError, IndexError):
            raise ServiceError("bad_response", service="xai") from None

    async def look(self, images: Sequence[Attachment], question: str, ledger: Ledger) -> dict:
        """What the vision model sees in several images at once, for `question`: one call."""
        return await self.vision.look(images, question, ledger)

    # --- services.* -----------------------------------------------------------------------------

    def _options(self, options: Sequence[Option]) -> list[dict[str, Any]]:
        views = []
        for option in options:
            keyed = option.id in KEYED_SERVICES
            view: dict[str, Any] = {
                "id": option.id,
                "needs_key": option.needs_key and not option.key_optional,
                "has_key": keyed and self._keys.has(option.id),
                "key_optional": option.key_optional,
            }
            if option.id == "searxng":
                view["url_set"] = bool(self._text("searxng_url"))
            views.append(view)
        return views

    def status(self, *, include_backends: bool = False) -> dict[str, Any]:
        model, sees = self.vision_model()
        result = {
            "search": {
                "enabled": self.enabled("search"),
                "service": self.search_service(),
                "options": self._options(SEARCH_OPTIONS if include_backends else SEARCH_OPTIONS[:5]),
            },
            "read": {
                "enabled": self.enabled("read"),
                "service": self.read_service(),
                "options": self._options(READ_OPTIONS if include_backends else READ_OPTIONS[:4]),
            },
            "pdf": {
                "enabled": self.enabled("pdf"),
                "service": self.pdf_service(),
                "options": self._options(PDF_OPTIONS),
            },
            "vision": {
                "enabled": self.enabled("vision"),
                "model": self._text("vision_model"),
                "resolved_model": model,
                "supports_images": sees,
            },
            "voice": {
                "enabled": self.enabled("voice"),
                "service": self.tts_service(),
                "options": self._options(TTS_OPTIONS if include_backends else TTS_OPTIONS[:1]),
                "fish_voice_set": bool(self._text("tts_fish_voice")),
            },
        }
        if include_backends:
            from ..brain.settings import WEB_SEARCH_SERVICES, WEB_READ_SERVICES, TTS_SERVICES
            choices = {"search": WEB_SEARCH_SERVICES, "read": WEB_READ_SERVICES, "voice": TTS_SERVICES}
            result["backend_schema"] = 1
            for category, rows in backends.GROUPS.items():
                group = result.setdefault(category, {"enabled": False, "service": "", "options": []})
                options = group["options"]
                for row in rows:
                    view = next((option for option in options if option["id"] == row.id), None)
                    if view is None:
                        view = {"id": row.id, "needs_key": bool(row.key_service) and not row.key_optional,
                                "has_key": bool(row.key_service and self._keys.has(row.key_service)), "key_optional": row.key_optional}
                        options.append(view)
                    view.update({"name": row.name, "description_id": f"tool_backend.{category}.{row.id}",
                        "billing": row.billing, "key_service": row.key_service or None,
                        "integration": row.integration,
                        "selection_supported": row.id in choices.get(category, ()) if category in choices else row.integration == "ready"})
                    view["implementation"] = "missing" if row.integration == "oauth_required" or category == "execution" or category == "browser" and row.id in ("local", "lightpanda") else "adapter"
                    if view["selection_supported"] and row.integration == "settings_required":
                        view["integration"] = "ready"
                    if category in ("image", "video"):
                        view["model_reference_prefix"] = f"@service:{row.id}/" if row.integration == "ready" else None
                        view["model_required"] = True
                        view["configuration_fields"] = [category + "_model"]
                    elif category == "voice":
                        view["configuration_fields"] = ["tts_voice", "tts_model"]
                    elif category == "transcription":
                        view["configuration_fields"] = ["stt_service", "stt_model"]
                    if row.id == "firecrawl-selfhosted":
                        view["configuration_fields"] = ["firecrawl_url"]
                        view["url_set"] = bool(self._optional_text("firecrawl_url"))
                    package = {"edge": "edge_tts", "piper": "piper", "kittentts": "kittentts", "whisper": "faster_whisper"}.get(row.id)
                    if package and category in ("voice", "transcription"):
                        from importlib.util import find_spec
                        view["runtime_dependency"] = package
                        view["runtime_available"] = find_spec(package) is not None
                    if row.id == "browserbase":
                        view["credential_services"] = ["browserbase", "browserbase-project"]
                    elif row.id == "modal":
                        view["credential_services"] = ["modal-token-id", "modal-token-secret"]
                for view in options:
                    view.setdefault("name", {"openrouter": "OpenRouter", "brave": "Brave Search", "tavily": "Tavily", "exa": "Exa", "searxng": "SearXNG", "builtin": "Built-in Reader", "jina": "Jina Reader", "fish": "Fish Audio"}.get(view["id"], view["id"]))
                    view.setdefault("description_id", f"tool_backend.{category}.{view['id']}")
                    view.setdefault("integration", "ready")
                    view.setdefault("selection_supported", True)
                    view.setdefault("billing", {"openrouter": "model", "brave": "free_tier", "tavily": "metered", "exa": "metered", "searxng": "self_hosted", "builtin": "local", "jina": "free_tier", "fish": "metered"}.get(view["id"], "unknown"))
            result["transcription"]["service"] = self._optional_text("stt_service")
            result["transcription"]["enabled"] = bool(result["transcription"]["service"])
            for kind in ("image", "video"):
                result[kind]["model"] = self._text(kind + "_model")
                result[kind]["enabled"] = bool(result[kind]["model"])
            result["toolsets"] = [{"id": id, "name": name, "description_id": f"tool_backend.toolsets.{id}",
                                   "integration": integration} for id, name, integration in backends.TOOLSETS]
        return result

    async def _status(self, params: dict) -> dict:
        if "include_backends" in params and type(params["include_backends"]) is not bool:
            raise invalid_params("include_backends must be a boolean")
        return self.status(include_backends=params.get("include_backends", False))

    @staticmethod
    def _service(params: dict) -> str:
        service = params.get("service")
        if not isinstance(service, str) or service not in KEYED_SERVICES:
            raise invalid_params(f"service must be one of {', '.join(KEYED_SERVICES)}")
        return service

    async def _set_key(self, params: dict) -> dict:
        service = self._service(params)
        key = params.get("key")
        if not isinstance(key, str):
            raise invalid_params("key must be a string")
        try:
            self._keys.set(service, key)
        except KeyRefused as refused:
            message = f"Invalid params: key must be a key ({refused.kind})"
            raise RpcError(INVALID_PARAMS, message, {"kind": refused.kind}) from None
        except Exception as exc:  # the vault's message could hold the key
            logger.warning("Could not store the key of %s: %s", service, type(exc).__name__)
            raise RpcError(INTERNAL_ERROR, "The key could not be stored", {"kind": "vault"}) from None
        logger.info("The key of %s was stored", service)
        return {"ok": True}

    async def _clear_key(self, params: dict) -> dict:
        service = self._service(params)
        try:
            self._keys.clear(service)
        except Exception as exc:
            logger.warning("Could not remove the key of %s: %s", service, type(exc).__name__)
            raise RpcError(INTERNAL_ERROR, "The key could not be removed", {"kind": "vault"}) from None
        logger.info("The key of %s was removed", service)
        return {"ok": True}


def offline_transport() -> httpx.MockTransport:
    """A transport that reaches nothing, for the fake LLM's runs: every service is offline."""

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    return httpx.MockTransport(refuse)


__all__ = ["ServiceError", "ServiceHub", "offline_transport"]
