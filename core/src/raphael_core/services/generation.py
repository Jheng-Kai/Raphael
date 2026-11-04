"""Configured media capabilities, bounded delivery and cancellable provider jobs.

Capability dispatch was informed by Hermes' MIT image/video tools; see THIRD_PARTY_NOTICES.md.
"""

import asyncio
import base64
import binascii
import json
import re

import httpx

from ..brain.openrouter import OpenRouterError
from ..brain.providers.clients import CompatibleProvider, amount, token_count
from ..brain.model_ref import split_api_ref
from .attachments import Attachment, MAX_FILE_BYTES, sniff_ok
from .common import ServiceError
from .fetch import PageFetcher


class Generation:
    poll_seconds = 1
    timeout_seconds = 1800

    def __init__(self, providers, store, *, fetcher=None):
        self.providers, self.store = providers, store
        self.fetcher = fetcher or PageFetcher(media=True, media_types=("image/png", "image/jpeg", "image/webp", "video/mp4"), max_bytes=MAX_FILE_BYTES, max_seconds=120)

    async def aclose(self):
        # PageFetcher creates and closes its own bounded client for each fetch.
        pass

    async def make(self, kind, arguments, *, selected_model, progress=None, ledger=None):
        choices = self.providers.media_choices(kind)
        selected, _ = split_api_ref(selected_model)
        choice = next((row for row in choices if row["reference"] == selected), None)
        if choice is None:
            raise ServiceError("not_configured")
        if arguments.get("model", selected) != selected or not isinstance(arguments.get("prompt"), str) or not 1 <= len(arguments["prompt"].strip()) <= 12000:
            raise ServiceError("bad_arguments")
        ids = arguments.get("images", [])
        if not isinstance(ids, list) or len(ids) > 4 or ids and not choice.get("image_input"):
            raise ServiceError("bad_arguments")
        images = []
        for key in ids:
            try:
                path = self.store.path(key)
                meta = json.loads(path.with_name(path.name + ".json").read_text(encoding="utf-8"))
                data = path.read_bytes()
            except Exception:
                raise ServiceError("bad_arguments") from None
            if meta.get("mime") not in ("image/png", "image/jpeg", "image/webp") or not sniff_ok(meta["mime"], data) or len(data) > 10 * 1024 * 1024:
                raise ServiceError("bad_arguments")
            images.append(Attachment(path.name, meta["mime"], data))
        pid, model = self.providers.resolve(choice["reference"])
        config = self.providers.config(pid)
        provider = self.providers.client(pid)
        # OpenRouter's chat client predates the shared compatible transport.
        if config["kind"] == "openrouter":
            provider = CompatibleProvider("openrouter", config["base_url"], provider.client._key_provider,
                                          http=provider.client._client())
        billing = {"cost_usd": None, "prompt_tokens": 0, "completion_tokens": 0}
        contacted = False
        def charge(data):
            nonlocal contacted
            contacted = True
            found = media_cost(data, choice)
            if found["cost_usd"] is not None or billing["cost_usd"] is None:
                billing.update(found)
        try:
            async with asyncio.timeout(self.timeout_seconds):
                if kind == "video":
                    attachment = await self._video(provider, model, arguments["prompt"], progress, charge=charge)
                else:
                    attachment = await self._image(provider, model, arguments["prompt"], images,
                                                   image_only=choice.get("generation_only", False), charge=charge)
                # Cancellation before publication never creates a conversation artifact.
                await asyncio.sleep(0)
                saved = self.store.save(attachment)
                return {"attachment": saved.metadata(), "model": choice["reference"], **billing}
        except OpenRouterError as error:
            raise ServiceError(error.kind) from None
        except (binascii.Error, ValueError, KeyError, TypeError, IndexError):
            raise ServiceError("protocol") from None
        except TimeoutError:
            raise ServiceError("timeout") from None
        except httpx.TimeoutException:
            raise ServiceError("timeout") from None
        except httpx.TransportError:
            raise ServiceError("network") from None
        finally:
            # A paid response still counts if decoding, delivery or local cancellation fails.
            if contacted and ledger is not None:
                ledger.add(model=choice["reference"], cost_usd=billing["cost_usd"] or 0,
                           prompt_tokens=billing["prompt_tokens"], completion_tokens=billing["completion_tokens"],
                           outcome="ok" if billing["cost_usd"] is not None else "cost_unknown")

    async def _json(self, provider, method, path, **kwargs):
        body = kwargs.pop("body", None)
        try:
            async with provider._client().stream(method, provider.base_url + path, headers=provider._headers(),
                    json=body, timeout=120, follow_redirects=False, **kwargs) as response:
                if not response.is_success:
                    raise ServiceError("auth" if response.status_code in (401, 403) else "rate_limit" if response.status_code == 429 else "tool_error")
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_FILE_BYTES * 4 // 3 + 1024 * 1024:
                        raise ServiceError("too_large")
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get("error"):
                raise ServiceError("protocol")
            return data
        except httpx.TimeoutException:
            raise ServiceError("timeout") from None
        except httpx.TransportError:
            raise ServiceError("network") from None

    async def _image(self, provider, model, prompt, images, *, image_only=False, charge=lambda data: None):
        if provider.kind == "openrouter":
            content = [{"type": "text", "text": prompt}, *({"type": "image_url", "image_url": {"url": image.data_url()}} for image in images)]
            data = await self._json(provider, "POST", "/chat/completions", body={"model": model, "modalities": ["image"] if image_only else ["image", "text"], "messages": [{"role": "user", "content": content}]})
            charge(data)
            value = data["choices"][0]["message"]["images"][0]["image_url"]["url"]
            return await self._asset(value, "image")
        if provider.kind == "google":
            parts = [{"text": prompt}, *({"inlineData": {"mimeType": image.mime, "data": base64.b64encode(image.data).decode()}} for image in images)]
            base = provider.base_url.removesuffix("/openai").rstrip("/")
            provider = CompatibleProvider("google", base if base.endswith("/v1beta") else base + "/v1beta", provider._key_provider, http=provider._client())
            data = await self._json(provider, "POST", f"/models/{model}:generateContent", body={"contents": [{"parts": parts}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}})
            charge(data)
            image = next((p["inlineData"] for p in data["candidates"][0]["content"]["parts"] if "inlineData" in p), None)
            if image is None:
                raise ServiceError("protocol")
            return self._bytes(base64.b64decode(image["data"], validate=True), image["mimeType"], "image")
        if images and provider.kind != "xai":
            data = await self._json(provider, "POST", "/images/edits", data={"model": model, "prompt": prompt},
                                    files=[("image[]", (image.name, image.data, image.mime)) for image in images])
        else:
            body = {"model": model, "prompt": prompt, "n": 1, "response_format": "b64_json"}
            if images:
                if len(images) != 1:
                    raise ServiceError("bad_arguments")
                body["image"] = {"url": images[0].data_url(), "type": "image_url"}
            data = await self._json(provider, "POST", "/images/edits" if images else "/images/generations", body=body)
        charge(data)
        result = data["data"][0]
        if result.get("b64_json"):
            raw = base64.b64decode(result["b64_json"], validate=True)
            mime = next((m for m in ("image/png", "image/jpeg", "image/webp") if sniff_ok(m, raw)), "application/octet-stream")
            return self._bytes(raw, mime, "image")
        return await self._asset(result["url"], "image")

    async def _video(self, provider, model, prompt, progress, *, charge=lambda data: None):
        if provider.kind not in ("openai", "xai"):
            raise ServiceError("not_configured")
        xai = provider.kind == "xai"
        data = await self._json(provider, "POST", "/videos/generations" if xai else "/videos",
                                **({"body": {"model": model, "prompt": prompt}} if xai else {"files": {"model": (None, model), "prompt": (None, prompt)}}))
        charge(data)
        job = data.get("request_id") if xai else data.get("id")
        if not isinstance(job, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", job):
            raise ServiceError("protocol")
        try:
            for _ in range(900):
                if progress:
                    progress({"status": data.get("status", "pending"), "progress": data.get("progress")})
                if data.get("status") in ("failed", "expired", "cancelled"):
                    raise ServiceError("tool_error")
                if data.get("status") in ("completed", "done"):
                    if xai:
                        return await self._asset(data["video"]["url"], "video")
                    # Auth stays on the configured endpoint, never on a returned download URL.
                    async with provider._client().stream("GET", provider.base_url + f"/videos/{job}/content", headers=provider._headers(), timeout=120, follow_redirects=False) as response:
                        if response.status_code != 200:
                            raise ServiceError("tool_error")
                        value = bytearray()
                        async for chunk in response.aiter_bytes():
                            value.extend(chunk)
                            if len(value) > MAX_FILE_BYTES:
                                raise ServiceError("too_large")
                    return self._bytes(bytes(value), "video/mp4", "video")
                await asyncio.sleep(self.poll_seconds)
                data = await self._json(provider, "GET", f"/videos/{job}")
                charge(data)
            raise ServiceError("timeout")
        except asyncio.CancelledError:
            # OpenAI exposes deletion; xAI has no documented remote cancellation here.
            if not xai:
                try:
                    await asyncio.wait_for(provider._send("DELETE", f"/videos/{job}", 5), 5)
                except Exception:
                    pass
            raise

    async def _asset(self, value, kind):
        if isinstance(value, str) and value.startswith("data:"):
            header, encoded = value.split(",", 1)
            if not header.endswith(";base64") or len(encoded) > MAX_FILE_BYTES * 4 // 3 + 4:
                raise ServiceError("too_large")
            return self._bytes(base64.b64decode(encoded, validate=True), header[5:-7], kind)
        fetched = await self.fetcher.fetch(value)
        return self._bytes(fetched.body, fetched.content_type, kind)

    def _bytes(self, data, mime, kind):
        if not data or len(data) > MAX_FILE_BYTES:
            raise ServiceError("too_large")
        if kind == "image":
            if mime not in ("image/png", "image/jpeg", "image/webp") or not sniff_ok(mime, data):
                raise ServiceError("protocol")
            suffix = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
        else:
            if mime != "video/mp4" or len(data) < 12 or data[4:8] != b"ftyp":
                raise ServiceError("protocol")
            suffix = "mp4"
        return Attachment(f"generated.{suffix}", mime, data)


def media_cost(data, choice):
    """Prefer the provider's actual charge; otherwise use reported usage and published unit prices."""
    usage = data.get("usage") or data.get("usageMetadata") or {}
    if not isinstance(usage, dict):
        usage = {}
    incoming = token_count(usage.get("prompt_tokens", usage.get("input_tokens", usage.get("promptTokenCount")))) or 0
    outgoing = token_count(usage.get("completion_tokens", usage.get("output_tokens", usage.get("candidatesTokenCount")))) or 0
    cost = amount(usage.get("cost", data.get("cost_usd", data.get("cost"))))
    if cost is None:
        unit = amount(choice.get("per_request"))
        image = amount(choice.get("per_image"))
        price_in, price_out = amount(choice.get("price_in")), amount(choice.get("price_out"))
        image_price = amount(choice.get("image_output_per_mtok"))
        fixed = (unit or 0) + (image * len(data['data']) if image is not None and isinstance(data.get('data'), list) else 0)
        token_priced = any(value is not None and value > 0 for value in (price_in, price_out, image_price))
        if not token_priced and (unit is not None or image is not None and isinstance(data.get('data'), list)):
            cost = fixed
        if incoming or outgoing:
            details = usage.get("output_tokens_details") or {}
            image_tokens = token_count(details.get("image_tokens")) if isinstance(details, dict) else None
            if image_tokens is not None:
                text_tokens = max(0, outgoing - image_tokens)
                if (not incoming or price_in is not None) and (not text_tokens or price_out is not None) and (not image_tokens or image_price is not None):
                    cost = fixed + (incoming * (price_in or 0) + text_tokens * (price_out or 0) + image_tokens * (image_price or 0)) / 1_000_000
            elif image_price is None and (not incoming or price_in is not None) and (not outgoing or price_out is not None):
                cost = fixed + (incoming * (price_in or 0) + outgoing * (price_out or 0)) / 1_000_000
    return {"cost_usd": amount(cost), "prompt_tokens": incoming, "completion_tokens": outgoing}
