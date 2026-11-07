"""Bounded, credential-safe HTTP for explicitly selected tool backends."""

import asyncio
import json

import httpx

from .common import ServiceError

MAX_RESPONSE_BYTES = 24 * 1024 * 1024


async def request(http, service, method, url, *, limit=MAX_RESPONSE_BYTES, timeout=30, **kwargs):
    try:
        async with asyncio.timeout(timeout), http.stream(method, url, timeout=timeout, follow_redirects=False, **kwargs) as response:
            if not response.is_success:
                kind = {401: "auth", 403: "auth", 402: "credits", 429: "rate_limit",
                        404: "not_found"}.get(response.status_code, "http_error")
                raise ServiceError(kind, service=service)
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > limit:
                    raise ServiceError("too_large", service=service)
            return bytes(data), response.headers.get("content-type", "")
    except (TimeoutError, httpx.TimeoutException):
        raise ServiceError("timeout", service=service) from None
    except (httpx.TransportError, httpx.DecodingError):
        raise ServiceError("network", service=service) from None


async def json_request(http, service, method, url, **kwargs):
    raw, _ = await request(http, service, method, url, **kwargs)
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ServiceError("bad_response", service=service) from None
    if not isinstance(result, dict) or result.get("error"):
        raise ServiceError("bad_response", service=service)
    return result


def need_key(service, key):
    if not key:
        raise ServiceError("missing_secret", service=service)
    return key


def bearer(service, key):
    return {"Authorization": f"Bearer {need_key(service, key)}"}
