"""HTTP boundary with deliberately value-free failures and diagnostics."""

import logging
import zlib
from typing import Any

import httpx
from ..failures import classify


class ConnectorFailure(Exception):
    def __init__(self, kind: str, status: int = 0, diagnostic=None) -> None:
        self.kind = kind
        self.status = status
        self.diagnostic = diagnostic
        super().__init__(kind)


class _PrivateRequests(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return not any(host in record.getMessage() for host in (
            "composio.dev", "googleapis.com", "accounts.google.com"))


logging.getLogger("httpx").addFilter(_PrivateRequests())
# Debug transport traces may include authorization headers. Match the MCP boundary's policy.
logging.getLogger("httpcore").setLevel(logging.CRITICAL)


class PrivateHttp:
    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.transport = transport

    async def response(self, method: str, url: str, *, max_bytes: int | None = None, **kwargs: Any) -> httpx.Response:
        try:
            headers = {"Accept-Encoding": "gzip"} if max_bytes is not None else None
            async with httpx.AsyncClient(transport=self.transport, timeout=20, follow_redirects=False, headers=headers) as client:
                if max_bytes is not None:
                    async with client.stream(method, url, **kwargs) as response:
                        encoding = response.headers.get("content-encoding", "identity").lower().strip()
                        if encoding not in ("identity", "gzip"):
                            raise ConnectorFailure("protocol")
                        # Injected transports may return an already decoded response.
                        cached = response.is_stream_consumed
                        decoder = zlib.decompressobj(31) if encoding == "gzip" and not cached else None
                        data = bytearray()
                        received = 0
                        chunks = response.aiter_bytes() if cached else response.aiter_raw()
                        async for chunk in chunks:
                            received += len(chunk)
                            if received > max_bytes:
                                raise ConnectorFailure("protocol")
                            if decoder:
                                try:
                                    chunk = decoder.decompress(chunk, max_bytes - len(data) + 1)
                                except zlib.error:
                                    raise ConnectorFailure("protocol") from None
                            if len(data) + len(chunk) > max_bytes:
                                raise ConnectorFailure("protocol")
                            data.extend(chunk)
                        if decoder and (not decoder.eof or decoder.unused_data):
                            raise ConnectorFailure("protocol")
                        # The body is already decoded; do not decode Content-Encoding again.
                        headers = dict(response.headers)
                        headers.pop("content-encoding", None)
                        headers["content-length"] = str(len(data))
                        return httpx.Response(response.status_code, headers=headers, content=bytes(data), request=response.request)
                response = await client.request(method, url, **kwargs)
        except ConnectorFailure:
            raise
        except httpx.TimeoutException:
            raise ConnectorFailure("timeout") from None
        except Exception:
            raise ConnectorFailure("network") from None
        return response

    async def json(self, method: str, url: str, **kwargs: Any) -> dict:
        # `hide`: values the owner gave for this very request (a key); a message that echoes one is redacted of it.
        hide = [value for value in kwargs.pop("hide", ()) if isinstance(value, str) and value]
        response = await self.response(method, url, **kwargs)
        if response.status_code >= 300:
            # Only a bounded, redacted provider message crosses the private boundary.
            diagnostic = None
            kind = {400: "invalid_request", 401: "auth", 403: "auth", 404: "gone", 409: "conflict", 422: "invalid_request", 429: "rate_limit"}.get(
                response.status_code, "http_error")
            try:
                data = response.json()
                error = data.get("error")
                if error == "invalid_grant":
                    kind = "reconnect"
                detail = error if isinstance(error, dict) else data
                if response.status_code == 400 and (detail.get("slug") == "ToolRouterV2_ToolkitNotAllowed"
                        or detail.get("code") == "ToolRouterV2_ToolkitNotAllowed"):
                    kind = "toolkit_not_allowed"
                if isinstance(detail.get("message"), str):
                    diagnostic = classify({"kind": kind, "status": response.status_code, "message": detail["message"]},
                                          secrets=[*kwargs.get("headers", {}).values(), *hide])
            except (ValueError, AttributeError):
                pass
            raise ConnectorFailure(kind, response.status_code, diagnostic)
        try:
            data = response.json()
        except ValueError:
            raise ConnectorFailure("protocol") from None
        if not isinstance(data, dict):
            raise ConnectorFailure("protocol")
        return data
