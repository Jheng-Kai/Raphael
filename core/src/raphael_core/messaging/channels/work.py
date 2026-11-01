"""Bounded HTTP transport shared by the work-chat adapters; no response diagnostics escape."""

import asyncio
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx

from .base import Attachment, ChannelError


def token(params):
    value = params.get("token")
    if not isinstance(value, str):
        raise ValueError("token must be text")
    value = value.strip()
    return {"token": value} if 10 <= len(value) <= 1000 and not any(c.isspace() for c in value) else None


def file_attachment(ref, mime, size, name):
    kind = "image" if isinstance(mime, str) and mime.startswith("image/") else "pdf" if mime == "application/pdf" else "other"
    return Attachment(kind, ref, mime, size if type(size) is int else None, name)


async def request(http, method, url, **kwargs):
    try:
        response = await http.request(method, url, timeout=60, **kwargs)
    except httpx.HTTPError:
        raise ChannelError("network") from None
    if response.status_code in (401, 403):
        raise ChannelError("unauthorized")
    if response.status_code == 429:
        try:
            retry = max(1, min(300, float(response.headers.get("retry-after", "5"))))
        except ValueError:
            retry = 5
        raise ChannelError("rate_limited", retry)
    if response.status_code >= 400:
        raise ChannelError("network" if response.status_code >= 500 else "bad_request")
    return response


def trusted_url(url, hosts):
    try:
        parsed = urlsplit(url)
        return parsed.scheme == "https" and parsed.hostname in hosts and parsed.port in (None, 443) and not parsed.username and not parsed.password
    except (ValueError, TypeError):
        return False


async def download(http, url, limit, *, hosts, headers=None):
    if not trusted_url(url, hosts):
        raise ChannelError("bad_request")
    data = bytearray()
    try:
        async with http.stream("GET", url, headers=headers or {}, follow_redirects=False, timeout=60) as response:
            if response.status_code != 200:
                raise ChannelError("bad_request")
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > limit:
                    raise ChannelError("bad_request")
    except httpx.HTTPError:
        raise ChannelError("network") from None
    return bytes(data)


@asynccontextmanager
async def quiet_busy():
    yield


async def receive(channel, poll, deliver):
    backoff = 1
    while True:
        try:
            await poll(deliver)
            channel.error = None
            backoff = 1
            await asyncio.sleep(3)
        except ChannelError as error:
            channel.error = error.kind
            if error.kind == "unauthorized":
                return
            await asyncio.sleep(error.retry_after or backoff)
            backoff = min(60, backoff * 2)
