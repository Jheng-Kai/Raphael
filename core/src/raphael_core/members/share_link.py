"""A member's template shared by a link (R-SHARE-01): the recipe goes to the owner's share service, which answers with a link
anyone can open to see the recipe and add it, and a key that only this app keeps, to take the link down again.

The service is the owner's own deployment of share-template/. Until its address is set here, no card offers a link and nothing
is sent anywhere.
"""

import json
import os
import re
from urllib.parse import urlsplit

import httpx

# The address of the owner's share service (share-template/README.md), without a trailing slash. Empty: sharing by link is off.
SHARE_URL = ""
TIMEOUT_S = 120
ANSWER_CAP = 16 * 1024
_ID = re.compile(r"[0-9A-Za-z]{10}")
_TOKEN = re.compile(r"[0-9a-f]{64}")


def address():
    """The share service's root, or "" when none is set. `RAPHAEL_SHARE_URL` stands in for tests and a developer's own service."""
    url = os.environ.get("RAPHAEL_SHARE_URL", SHARE_URL).strip().rstrip("/")
    if not url:
        return ""
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("The share service needs an HTTPS address")
    return url


def _client(transport):
    return httpx.AsyncClient(transport=transport, timeout=TIMEOUT_S, follow_redirects=False)


async def create(template, *, url, transport=None):
    """The link and its key for one recipe. Raises ValueError when the service is unreachable or answers anything else."""
    try:
        async with _client(transport) as http:
            response = await http.post(f"{url}/v1/slimes", json={"template": template})
    except httpx.HTTPError as error:
        raise ValueError("The share service could not be reached") from error
    if response.status_code != 201 or len(response.content) > ANSWER_CAP:
        raise ValueError(f"The share service answered {response.status_code}")
    try:
        answer = json.loads(response.content)
        identifier, link, token = answer["id"], answer["url"], answer["token"]
    except (ValueError, KeyError, TypeError):
        raise ValueError("The share service answered something else") from None
    if not (isinstance(identifier, str) and _ID.fullmatch(identifier) and link == f"{url}/s/{identifier}"
            and isinstance(token, str) and _TOKEN.fullmatch(token)):
        raise ValueError("The share service answered something else")
    return link, token


async def remove(link, token, *, url, transport=None):
    """Takes a link down. A link the service no longer has is down already."""
    identifier = link.rsplit("/", 1)[-1]
    if not link.startswith(f"{url}/s/") or not _ID.fullmatch(identifier):
        raise ValueError("Not a link of this share service")
    try:
        async with _client(transport) as http:
            response = await http.delete(f"{url}/v1/slimes/{identifier}", headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as error:
        raise ValueError("The share service could not be reached") from error
    if response.status_code not in (204, 404):
        raise ValueError(f"The share service answered {response.status_code}")
