"""Cloud session provisioning for a future guarded computer adapter.

These are not agent tools or RPCs: CDP access must stay behind the existing VM
grant/lifecycle. No arbitrary browser actions or host execution are exposed here.
"""

import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from .backend_http import bearer, json_request, need_key, request
from .common import ServiceError


@dataclass(frozen=True)
class BrowserSession:
    service: str
    id: str
    cdp_url: str = field(repr=False)


def _id(value, service):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,200}", value):
        raise ServiceError("bad_response", service=service)
    return value


def _config(service, key, project):
    if service == "browserbase":
        return "https://api.browserbase.com/v1/sessions", {"X-BB-API-Key": need_key(service, key)}, {"projectId": need_key(service, project)}
    if service == "browser-use":
        return "https://api.browser-use.com/api/v3/browsers", {"X-Browser-Use-API-Key": need_key(service, key)}, {}
    if service == "firecrawl":
        return "https://api.firecrawl.dev/v2/browser", bearer(service, key), {"ttl": 300}
    raise ServiceError("not_configured", service=service)


async def create(service, *, http, key=None, project=None):
    url, headers, body = _config(service, key, project)
    data = await json_request(http, service, "POST", url, headers=headers, json=body)
    session_id = _id(data.get("id"), service)
    cdp = data.get("cdpUrl") or data.get("connectUrl")
    try:
        parsed = urlsplit(cdp)
        if not isinstance(cdp, str) or parsed.scheme not in ("wss", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError
    except (TypeError, ValueError):
        raise ServiceError("bad_response", service=service) from None
    return BrowserSession(service, session_id, cdp)


async def release(session, *, http, key=None, project=None):
    service = session.service
    url, headers, body = _config(service, key, project)
    session_id = _id(session.id, service)
    method = {"browserbase": "POST", "browser-use": "PATCH", "firecrawl": "DELETE"}[service]
    if service == "browserbase":
        body["status"] = "REQUEST_RELEASE"
    elif service == "browser-use":
        body = {"action": "stop"}
    await request(http, service, method, url + "/" + session_id, headers=headers,
        **({"json": body} if method != "DELETE" else {}))
