"""Owner-requested avatar candidates through the existing selected image service."""

import asyncio
import base64
import logging

import httpx

from ..agent.ledger import Ledger
from ..brain.model_ref import split_api_ref
from ..brain.providers.presets import OPTIONAL_KEY_KINDS
from ..brain.spend import SpendTracker
from ..failures import Missing
from ..protocol import BUSY, NOT_CONFIGURED, RpcError, invalid_params
from ..services import media_backends
from ..services.attachments import MAX_IMAGE_BYTES, sniff_ok
from ..services.common import ServiceError

MODEL_TARGET = {"pane": "models", "field": "image-model"}
logger = logging.getLogger(__name__)


class AvatarGeneration:
    def __init__(self, members, service):
        self.members, self.service = members, service
        self.inflight = set()

    def failure(self, kind, *, service=None, reference=""):
        data = {"kind": kind, "reason": f"Avatar generation did not finish ({kind})."}
        if service:
            data["service"] = service
        if kind == "image_model_missing":
            data.update(target=MODEL_TARGET, missing=Missing("image", "image_generation", "missing", "models").wire())
        elif kind in ("missing_secret", "auth", "auth_expired", "chatgpt_scope"):
            resource = service or (reference[1:].partition(":")[0] if reference.startswith("@") else "openrouter")
            direct = reference.startswith("@service:")
            data.update(missing=Missing(resource, "key" if kind == "missing_secret" else "provider", "missing", "models").wire(),
                        target={"pane": "models", "field": "service" if direct else "provider", "id": resource})
            if resource == "codex":
                data.update(missing=Missing("codex", "cli", "missing", "models").wire(),
                            target={"pane": "models", "resource": "codex"})
        return RpcError(BUSY if kind == "busy" else NOT_CONFIGURED, "Avatar generation failed", data)

    async def generate(self, params):
        reference = self.members._settings.get("image_model")
        member = params.get("member_id")
        logged_member = member if type(member) is int else "invalid"
        try:
            result = await self._generate(params, reference)
        except asyncio.CancelledError:
            logger.warning("Avatar generation failed kind=cancelled model=%s member_id=%s", reference, logged_member)
            raise
        except RpcError as error:
            kind = (error.data or {}).get("kind", "invalid_params")
            logger.warning("Avatar generation failed kind=%s model=%s member_id=%s", kind, reference, logged_member)
            raise
        except Exception:
            # Never log exception text: it can contain the owner's prompt or provider content.
            logger.warning("Avatar generation failed kind=internal_error model=%s member_id=%s", reference, logged_member)
            raise self.failure("internal_error", reference=reference) from None
        candidate = result["candidate"]
        logger.info("Avatar generation succeeded model=%s member_id=%s mime=%s size=%d",
                    result["model"], member, candidate["mime"], len(base64.b64decode(candidate["data"])))
        return result

    async def _generate(self, params, reference):
        member = params.get("member_id")
        prompt = params.get("prompt")
        if type(member) is not int or member < 0 or not self.members.member_exists(member):
            raise invalid_params("no such member")
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 8000:
            raise invalid_params("prompt must contain 1 to 8000 characters")
        if member in self.inflight:
            raise self.failure("busy")
        # Claim before the first await; cancellation and all failures release the member.
        self.inflight.add(member)
        stage = "catalog"
        try:
            if not reference:
                raise self.failure("image_model_missing")
            service = self.service()
            if service is None:
                raise self.failure("catalog_unavailable")
            try:
                selected, _ = split_api_ref(reference)
                route = media_backends.selected("image", selected)
            except ValueError:
                raise self.failure("image_model_missing") from None
            subscription = hasattr(service, "is_subscription_image") and service.is_subscription_image(selected)
            if route is None and not subscription:
                providers = service.providers
                try:
                    pid, _ = providers.resolve(selected)
                    config = providers.config(pid)
                except ValueError:
                    raise self.failure("image_model_missing") from None
                if not config.get("enabled", True):
                    raise self.failure("image_model_missing")
                if config["kind"] not in OPTIONAL_KEY_KINDS and not providers.view(pid)["has_key"]:
                    raise self.failure("auth_expired" if pid == "chatgpt" else "missing_secret", service=pid, reference=reference)
            choices = service.media_choices("image", reference)
            if not any(row["reference"] == selected for row in choices) and hasattr(service, "refresh_image_choices"):
                choices = await service.refresh_image_choices(reference)
            if not any(row["reference"] == selected for row in choices):
                raise self.failure("image_model_missing")
            stage = "generation"
            speaker = self.members.speaker(member)
            words = ("Create exactly one square (1:1) PNG, JPEG or WebP avatar of a small character. "
                     "Use a clean, centred subject on a plain background, with space around the head, "
                     "suitable for a round avatar crop. No text or collage.\n"
                     f"Member name: {speaker.name}\nMember role: {speaker.role}\nOwner's description: {prompt.strip()}")
            result = await service.make("image", {"prompt": words, "square": True}, selected_model=reference,
                                        ledger=Ledger(SpendTracker(self.members._conn), purpose="image"))
            file = result["attachment"]
            if file["mime"] not in ("image/png", "image/jpeg", "image/webp"):
                raise ServiceError("unsupported_type")
            path = service.store.path(file["id"])
            if path.stat().st_size > MAX_IMAGE_BYTES:
                raise ServiceError("too_large")
            raw = await asyncio.to_thread(path.read_bytes)
            if len(raw) > MAX_IMAGE_BYTES:
                raise ServiceError("too_large")
            if not sniff_ok(file["mime"], raw):
                raise ServiceError("bad_response")
            name = {"image/png": "avatar.png", "image/jpeg": "avatar.jpg", "image/webp": "avatar.webp"}[file["mime"]]
            return {"candidate": {"name": name,
                                  "mime": file["mime"], "data": base64.b64encode(raw).decode("ascii"),
                                  "crop": {"x": 0.5, "y": 0.5, "zoom": 1}}, "model": result["model"]}
        except ServiceError as error:
            raise self.failure("image_model_missing" if error.kind == "not_configured" else error.kind,
                               service=error.service, reference=reference) from None
        except (TimeoutError, httpx.TimeoutException):
            raise self.failure("timeout", reference=reference) from None
        except httpx.TransportError:
            raise self.failure("network", reference=reference) from None
        except (ValueError, KeyError, TypeError, OSError, AttributeError, IndexError):
            raise self.failure("catalog_unavailable" if stage == "catalog" else "bad_response", reference=reference) from None
        finally:
            self.inflight.discard(member)
