"""Direct media endpoints behind Generation's existing gate, ledger and store.

The model reference must be set explicitly (``@service:provider/model``).
No default model, live discovery, subscription borrowing or provider fallback.
"""

import asyncio
import re
from urllib.parse import urlsplit

from .backend_http import bearer, json_request, need_key, request
from .common import ServiceError

SERVICES = {"image": ("fal", "krea", "deepinfra", "meta-ai"), "video": ("fal", "deepinfra", "openrouter")}
BASES = {"deepinfra": "https://api.deepinfra.com/v1/openai", "meta-ai": "https://api.meta.ai/v1", "openrouter": "https://openrouter.ai/api/v1"}
KREA_PATHS = {"krea-3": "krea-3", "krea-2-medium": "krea-2/medium", "krea-2-large": "krea-2/large",
              "krea-2-medium-turbo": "krea-2/medium-turbo"}


def selected(kind, reference):
    if not isinstance(reference, str) or not reference.startswith("@service:"):
        return None
    value = reference.removeprefix("@service:")
    service, _, model = value.partition("/")
    if service not in SERVICES.get(kind, ()) or not re.fullmatch(r"[A-Za-z0-9_-]+(?:[./-][A-Za-z0-9_-]+)*", model) or len(model) > 200:
        raise ServiceError("not_configured", service=service)
    if service == "krea" and model not in KREA_PATHS:
        raise ServiceError("not_configured", service=service)
    return service, model


def choice(kind, reference):
    route = selected(kind, reference)
    if route is None:
        return None
    return {"reference": reference, "id": route[1], "provider": route[0], "media": [kind],
            "image_input": False, "generation_only": True}


def _job(value, service):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", value):
        raise ServiceError("bad_response", service=service)
    return value


def _fal_url(value, job):
    try:
        url = urlsplit(value)
        if url.scheme != "https" or url.netloc != "queue.fal.run" or not re.fullmatch(r"/[A-Za-z0-9_/-]+", url.path) or f"/requests/{job}" not in url.path or url.query or url.fragment:
            raise ValueError
    except (TypeError, ValueError):
        raise ServiceError("bad_response", service="fal") from None
    return value


async def _cancel(http, service, method, url, headers):
    try:
        async with asyncio.timeout(5):
            await request(http, service, method, url, headers=headers, timeout=5)
    except Exception:
        pass  # Local cancellation is authoritative even when the remote job has finished.


async def generate(kind, service, model, prompt, *, http, key, asset, raw_asset, charge, progress=None, poll_seconds=1, square=False):
    headers = bearer(service, key)
    if service == "fal":
        headers = {"Authorization": f"Key {need_key(service, key)}"}
        data = await json_request(http, service, "POST", "https://queue.fal.run/" + model, headers=headers,
            json={"prompt": prompt, **({"num_images": 1, "image_size": "square_hd"} if square else {})})
        charge(data)
        job = _job(data.get("request_id"), service)
        status_url = _fal_url(data.get("status_url"), job)
        result_url = _fal_url(data.get("response_url"), job)
        cancel_url = _fal_url(data.get("cancel_url") or result_url + "/cancel", job)
        try:
            for _ in range(900):
                data = await json_request(http, service, "GET", status_url, headers=headers)
                status = data.get("status")
                if progress:
                    progress({"status": status})
                if status == "COMPLETED":
                    result = await json_request(http, service, "GET", result_url, headers=headers)
                    charge(result)
                    value = result.get("video") if kind == "video" else (result.get("images") or [result.get("image")])[0]
                    if not isinstance(value, dict) or not isinstance(value.get("url"), str):
                        raise ServiceError("bad_response", service=service)
                    return await asset(value["url"], kind)
                if status not in ("IN_QUEUE", "IN_PROGRESS"):
                    raise ServiceError("remote_job", service=service)
                await asyncio.sleep(poll_seconds)
            raise ServiceError("timeout", service=service)
        except asyncio.CancelledError:
            await _cancel(http, service, "PUT", cancel_url, headers)
            raise
    if service == "krea":
        data = await json_request(http, service, "POST", "https://api.krea.ai/generate/image/krea/" + KREA_PATHS[model],
            headers=headers, json={"prompt": prompt, "aspect_ratio": "1:1"})
        charge(data)
        job = _job(data.get("job_id"), service)
        for _ in range(900):
            data = await json_request(http, service, "GET", "https://api.krea.ai/jobs/" + job, headers=headers)
            charge(data)
            status = data.get("status")
            if progress:
                progress({"status": status})
            if status == "completed":
                result = data.get("result")
                if not isinstance(result, dict):
                    raise ServiceError("bad_response", service=service)
                urls = result.get("urls") or [result.get("url")]
                if not isinstance(urls, list) or not urls or not isinstance(urls[0], str):
                    raise ServiceError("bad_response", service=service)
                return await asset(urls[0], kind)
            if status in ("failed", "cancelled"):
                raise ServiceError("remote_job", service=service)
            await asyncio.sleep(poll_seconds)
        raise ServiceError("timeout", service=service)
    base = BASES[service]
    if kind == "image":
        data = await json_request(http, service, "POST", base + "/images/generations", headers=headers,
            json={"model": model, "prompt": prompt, "n": 1, **({"size": "1024x1024"} if square else {})}, limit=72 * 1024 * 1024, timeout=120)
        charge(data)
        try:
            result = data["data"][0]
            if result.get("b64_json"):
                import base64
                from .attachments import sniff_ok
                raw = base64.b64decode(result["b64_json"], validate=True)
                mime = next(m for m in ("image/png", "image/jpeg", "image/webp") if sniff_ok(m, raw))
                return raw_asset(raw, mime, kind)
            return await asset(result["url"], kind)
        except (KeyError, IndexError, TypeError, ValueError, StopIteration):
            raise ServiceError("bad_response", service=service) from None
    # DeepInfra's OpenAI multipart API and OpenRouter's JSON API share job states.
    data = await json_request(http, service, "POST", base + "/videos", headers=headers,
        **({"json": {"model": model, "prompt": prompt}} if service == "openrouter" else
           {"files": {"model": (None, model), "prompt": (None, prompt)}}))
    charge(data)
    job = _job(data.get("id"), service)
    try:
        for _ in range(900):
            status = data.get("status")
            if progress:
                progress({"status": status, "progress": data.get("progress")})
            if status in ("completed", "succeeded"):
                raw, _ = await request(http, service, "GET", base + "/videos/" + job + "/content", headers=headers,
                    limit=50 * 1024 * 1024, timeout=120)
                return raw_asset(raw, "video/mp4", kind)
            if status in ("failed", "error", "cancelled", "canceled", "expired"):
                raise ServiceError("remote_job", service=service)
            await asyncio.sleep(poll_seconds)
            data = await json_request(http, service, "GET", base + "/videos/" + job, headers=headers)
            charge(data)
        raise ServiceError("timeout", service=service)
    except asyncio.CancelledError:
        await _cancel(http, service, "DELETE", base + "/videos/" + job, headers)
        raise
