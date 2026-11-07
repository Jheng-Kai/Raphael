"""Bounded, credential-safe HTTP for explicitly selected tool backends."""

import asyncio
import json

import httpx

from .common import ServiceError

MAX_RESPONSE_BYTES = 24 * 1024 * 1024


def response_failure(status, raw=b''):
    """Classify bounded provider error codes without forwarding remote text or secrets."""
    try:
        error = json.loads(raw).get('error', {})
        code = error.get('code') or error.get('type') if isinstance(error, dict) else None
    except (ValueError, AttributeError, TypeError):
        code = None
    if code in ('content_filter', 'content_policy_violation', 'safety_violation', 'safety', 'moderation_blocked'):
        return 'content_policy'
    if code in ('insufficient_quota', 'insufficient_credits', 'credit_balance_too_low'):
        return 'credits'
    return {401: 'auth', 403: 'auth', 402: 'credits', 429: 'rate_limit', 404: 'not_found'}.get(status, 'http_error')


async def request(http, service, method, url, *, limit=MAX_RESPONSE_BYTES, timeout=30, **kwargs):
    try:
        async with asyncio.timeout(timeout), http.stream(method, url, timeout=timeout, follow_redirects=False, **kwargs) as response:
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if not response.is_success and len(data) > 65536:
                    raise ServiceError(response_failure(response.status_code), service=service)
                if len(data) > limit:
                    raise ServiceError("too_large", service=service)
            if not response.is_success:
                raise ServiceError(response_failure(response.status_code, data), service=service)
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
    if isinstance(result, dict) and result.get("error"):
        kind = response_failure(200, raw)
        raise ServiceError('bad_response' if kind == 'http_error' else kind, service=service)
    if not isinstance(result, dict):
        raise ServiceError("bad_response", service=service)
    return result


def need_key(service, key):
    if not key:
        raise ServiceError("missing_secret", service=service)
    return key


def bearer(service, key):
    return {"Authorization": f"Bearer {need_key(service, key)}"}
