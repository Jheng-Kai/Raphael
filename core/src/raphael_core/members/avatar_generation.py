"""Owner-requested avatar candidates through the existing selected image service."""

import asyncio
import base64
import struct

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


def square_image(mime, raw):
    """Check the bounded image header without adding an image decoder or another API call."""
    if mime == 'image/png' and len(raw) >= 24 and raw[12:16] == b'IHDR':
        width, height = struct.unpack('>II', raw[16:24])
    elif mime == 'image/webp' and len(raw) >= 30 and raw[12:16] == b'VP8X':
        width, height = (1 + int.from_bytes(raw[start:start + 3], 'little') for start in (24, 27))
    elif mime == 'image/webp' and len(raw) >= 25 and raw[12:16] == b'VP8L' and raw[20] == 0x2f:
        bits = int.from_bytes(raw[21:25], 'little')
        width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
    elif mime == 'image/webp' and len(raw) >= 30 and raw[12:16] == b'VP8 ' and raw[23:26] == b'\x9d\x01\x2a':
        width, height = (value & 0x3fff for value in struct.unpack('<HH', raw[26:30]))
    else:
        return False
    return 0 < width == height <= 8192


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
        return RpcError(BUSY if kind == "busy" else NOT_CONFIGURED, "Avatar generation failed", data)

    async def generate(self, params):
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
        reference = self.members._settings.get("image_model")
        service = self.service()
        try:
            if not reference or service is None:
                raise self.failure("image_model_missing")
            try:
                selected, _ = split_api_ref(reference)
                route = media_backends.selected("image", selected)
            except ValueError:
                raise self.failure("image_model_missing") from None
            if route is None:
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
            if not any(row["reference"] == selected for row in service.media_choices("image", reference)):
                raise self.failure("image_model_missing")
            speaker = self.members.speaker(member)
            words = ("Create exactly one square (1:1) PNG or WebP avatar of a small character. "
                     "Use a clean, centred subject on a plain background, with space around the head, "
                     "suitable for a round avatar crop. No text or collage.\n"
                     f"Member name: {speaker.name}\nMember role: {speaker.role}\nOwner's description: {prompt.strip()}")
            result = await service.make("image", {"prompt": words, "square": True}, selected_model=reference,
                                        ledger=Ledger(SpendTracker(self.members._conn), purpose="image"))
            file = result["attachment"]
            if file["mime"] not in ("image/png", "image/webp"):
                raise ServiceError("unsupported_type")
            path = service.store.path(file["id"])
            if path.stat().st_size > MAX_IMAGE_BYTES:
                raise ServiceError("too_large")
            raw = await asyncio.to_thread(path.read_bytes)
            if len(raw) > MAX_IMAGE_BYTES or not sniff_ok(file["mime"], raw) or not square_image(file["mime"], raw):
                raise ServiceError("bad_response")
            return {"candidate": {"name": "avatar.png" if file["mime"] == "image/png" else "avatar.webp",
                                  "mime": file["mime"], "data": base64.b64encode(raw).decode("ascii"),
                                  "crop": {"x": 0.5, "y": 0.5, "zoom": 1}}, "model": result["model"]}
        except ServiceError as error:
            raise self.failure("image_model_missing" if error.kind == "not_configured" else error.kind,
                               service=error.service, reference=reference) from None
        except (ValueError, KeyError, TypeError, OSError):
            raise self.failure("bad_response", reference=reference) from None
        finally:
            self.inflight.discard(member)
