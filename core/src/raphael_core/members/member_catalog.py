"""Signed, bounded member catalogue; inspired by OpenMausBot (Apache-2.0), see NOTICES.md."""

from raphael_core.ui_words import ui_word, with_ui_words
import asyncio
import base64
import hashlib
import json
import math
import os
import re
import time
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from ..bots.homes import atomic
from ..protocol import INVALID_PARAMS, RpcError, invalid_params
from .templates import MAX_BYTES, checked, findings

DEFAULT_URL = "https://raw.githubusercontent.com/Jheng-Kai/raphael-catalog/main"
# The catalogue's public keys, raw Ed25519 as 64 hex characters, one or two (a second while a key is rotated). There is none
# until the owner has created the catalogue and its key (catalog-template/README.md): with no key the store is not open, asks
# nothing of the network and says so. Fixture keys are supplied only by offline tests.
PUBLIC_KEYS: tuple[str, ...] = ()
INDEX_CAP = 256 * 1024
MAX_INDEX_AGE = 7 * 24 * 60 * 60
STALE_INDEX = with_ui_words({
    "zh-TW": "請連上網路後再加入，以確認範本沒有被撤銷",
    "en": "Connect to the internet before adding this template to check that it has not been revoked",
    "ja": "テンプレートが取り消されていないことを確認するため、インターネットに接続してから追加してください",
})
CATEGORIES = ("engineering", "sales", "marketing", "design", "personal", "hr", "product", "operations")
AVATARS = ("rimuru", "souei", "shuna", "diablo", "benimaru", "hakurou", "shion", "gobta")


def schema(value):
    if not isinstance(value, dict) or set(value) != {"format", "version", "sequence", "entries", "revoked"} or value.get("format") != "raphael-catalog" or type(value.get("version")) is not int or value["version"] != 1:
        raise ValueError("Unsupported catalogue")
    if type(value["sequence"]) is not int or value["sequence"] < 1:
        raise ValueError("Invalid catalogue sequence")
    if not isinstance(value["entries"], list) or len(value["entries"]) > 1000 or not isinstance(value["revoked"], list) or len(value["revoked"]) > 2000:
        raise ValueError("Invalid catalogue lists")
    slug = lambda s: isinstance(s, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", s)
    if any(not slug(s) for s in value["revoked"]) or len(set(value["revoked"])) != len(value["revoked"]):
        raise ValueError("Invalid revocations")
    seen = set()
    for entry in value["entries"]:
        fields = {"id", "name", "creator", "category", "summary", "avatar", "featured", "package", "sha256", "version", "created", "updated", "skills", "routines", "connections"}
        if not isinstance(entry, dict) or set(entry) != fields or not slug(entry["id"]) or entry["id"] in seen:
            raise ValueError("Invalid catalogue entry")
        seen.add(entry["id"])
        for key, cap in (("name", 100), ("creator", 100), ("summary", 300), ("version", 40)):
            if not isinstance(entry[key], str) or not entry[key].strip() or len(entry[key]) > cap or "\n" in entry[key]:
                raise ValueError("Invalid catalogue text")
        if entry["category"] not in CATEGORIES or entry["avatar"] not in AVATARS or type(entry["featured"]) is not bool:
            raise ValueError("Invalid catalogue category or avatar")
        if entry["package"] != f"packages/{entry['id']}/member.raphael-member" or not isinstance(entry["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"]):
            raise ValueError("Invalid package path or digest")
        for key, cap in (("skills", 40), ("routines", 50)):
            if type(entry[key]) is not int or not 0 <= entry[key] <= cap:
                raise ValueError("Invalid package counts")
        if not isinstance(entry["connections"], list) or len(entry["connections"]) > 30 or any(not isinstance(c, str) or not c.strip() or len(c) > 100 for c in entry["connections"]):
            raise ValueError("Invalid connections")
        for key in ("created", "updated"):
            if not isinstance(entry[key], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry[key]):
                raise ValueError("Invalid date")
    return value


class Catalog:
    def __init__(self, folder, *, url=DEFAULT_URL, keys=PUBLIC_KEYS, transport=None, now=time.time, language=lambda: "en"):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Catalogue requires an HTTPS root")
        if len(keys) > 2:
            raise ValueError("At most two public keys")
        if any(not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{64}", key) for key in keys):
            raise ValueError("A public key is 64 hexadecimal characters")
        self.url, self.keys, self.transport = url.rstrip("/"), keys, transport
        self.folder = folder / hashlib.sha256(self.url.encode()).hexdigest()[:16]
        self.lock = asyncio.Lock()
        self.cached = None
        self.now, self.language = now, language
        try:
            saved = json.loads((self.folder / "index-cache.json").read_bytes())
            index = self.verify(base64.b64decode(saved["raw"], validate=True), saved["signature"])
            self.cached = {**saved, "index": index}
        except (OSError, ValueError, KeyError, TypeError):
            pass

    def verify(self, raw, signature):
        if len(raw) > INDEX_CAP:
            raise ValueError("Catalogue too large")
        try:
            sig = base64.b64decode(signature.strip(), validate=True)
        except (ValueError, AttributeError):
            raise ValueError("Invalid catalogue signature") from None
        for key in self.keys:
            try:
                Ed25519PublicKey.from_public_bytes(bytes.fromhex(key)).verify(sig, raw)
                return schema(json.loads(raw))
            except InvalidSignature:
                continue
        raise ValueError("Invalid catalogue signature")

    async def read(self, http, path, cap, headers=None):
        async with http.stream("GET", f"{self.url}/{path}", headers=headers) as response:
            if response.status_code == 304:
                return None, None
            response.raise_for_status()
            if int(response.headers.get("content-length", 0)) > cap:
                raise ValueError("Remote file too large")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > cap:
                    raise ValueError("Remote file too large")
            return bytes(data), response.headers.get("etag")

    @property
    def is_open(self):
        """Without a public key nothing the catalogue says can be believed, so the store stays closed."""
        return bool(self.keys)

    async def fetch(self):
        if not self.is_open:
            return self.view(False)
        async with self.lock:
            try:
                async with asyncio.timeout(10), httpx.AsyncClient(transport=self.transport, timeout=10, follow_redirects=False) as http:
                    headers = {"If-None-Match": self.cached["etag"]} if self.cached and self.cached.get("etag") else {}
                    raw, etag = await self.read(http, "index.json", INDEX_CAP, headers)
                    if raw is None:
                        if not self.cached:
                            raise ValueError("Unexpected unmodified catalogue")
                        # HTTPS conditional revalidation confirms the cached
                        # signed bytes are still the server's current index.
                        self.verify(base64.b64decode(self.cached["raw"], validate=True), self.cached["signature"])
                        saved = {key: value for key, value in self.cached.items() if key != "index"}
                        saved["verified_at"] = self.now()
                        atomic(self.folder / "index-cache.json", json.dumps(saved).encode())
                        self.cached = {**saved, "index": self.cached["index"]}
                        return self.view(False)
                    sig, _ = await self.read(http, "index.json.sig", 1024)
                    index = self.verify(raw, sig.decode("ascii"))
                    if self.cached:
                        previous = self.cached["index"]
                        if index["sequence"] < previous["sequence"] or (index["sequence"] == previous["sequence"] and base64.b64encode(raw).decode() != self.cached["raw"]):
                            raise ValueError("Catalogue rollback refused")
                        if not set(previous["revoked"]) <= set(index["revoked"]):
                            raise ValueError("Revocations cannot be removed")
                    saved = {"raw": base64.b64encode(raw).decode(), "signature": sig.decode("ascii"), "etag": etag,
                             "verified_at": self.now()}
                    atomic(self.folder / "index-cache.json", json.dumps(saved).encode())
                    self.cached = {**saved, "index": index}
                    return self.view(False)
            except (httpx.HTTPError, TimeoutError):
                return self.view(True)

    def view(self, offline):
        index = self.cached["index"] if self.cached else {"entries": [], "revoked": []}
        return {"entries": [e for e in index["entries"] if e["id"] not in index["revoked"]], "offline": offline, "open": self.is_open}

    def require_fresh(self):
        verified = self.cached.get("verified_at") if self.cached else None
        if (type(verified) not in (int, float) or not math.isfinite(verified)
                or not 0 <= self.now() - verified <= MAX_INDEX_AGE):
            raise RpcError(INVALID_PARAMS, STALE_INDEX.get(self.language(), STALE_INDEX["en"]))

    async def package(self, identifier, *, require_fresh=False):
        if not self.is_open:
            raise invalid_params("The store is not open yet")
        await self.fetch()
        if require_fresh:
            self.require_fresh()
        index = self.cached["index"] if self.cached else {"entries": [], "revoked": []}
        entry = next((e for e in index["entries"] if e["id"] == identifier), None)
        if not entry or identifier in index["revoked"]:
            raise invalid_params("Template unavailable or revoked")
        path = self.folder / f"{entry['sha256'][:32]}.json"
        try:
            async with asyncio.timeout(10), httpx.AsyncClient(transport=self.transport, timeout=10, follow_redirects=False) as http:
                raw, _ = await self.read(http, entry["package"], MAX_BYTES)
        except (httpx.HTTPError, TimeoutError):
            try:
                raw = path.read_bytes()
            except OSError:
                raise invalid_params("Template unavailable offline") from None
        if len(raw) > MAX_BYTES or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise invalid_params("Template digest mismatch")
        value = checked(json.loads(raw))
        if entry["skills"] != len(value["skills"]) or entry["routines"] != len(value["routines"]) or entry["connections"] != value["connections"]:
            raise invalid_params("Catalogue metadata does not match the package")
        current = self.cached["index"]
        if identifier in current["revoked"] or not any(e["id"] == identifier and e["sha256"] == entry["sha256"] for e in current["entries"]):
            raise invalid_params("Template changed or revoked during download")
        if require_fresh:
            self.require_fresh()
        atomic(path, raw)
        return value


def export_files(service, value):
    """The bytes a publish request holds, their digest and the folder they are prepared in; one recipe is always the same folder."""
    raw = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
    digest = hashlib.sha256(raw).hexdigest()
    return raw, digest, service._avatars.parent / "template-exports" / digest[:16]


def export_file(service, folder_id):
    """The recipe file of a folder this app prepared, found by the 16 characters its name is made of and by nothing else."""
    if not isinstance(folder_id, str) or not re.fullmatch(r"[0-9a-f]{16}", folder_id):
        raise invalid_params("folder_id must name a prepared publish request")
    file = service._avatars.parent / "template-exports" / folder_id / "member.raphael-member"
    if not file.is_file():
        raise invalid_params("folder_id must name a prepared publish request")
    return file


def client(service):
    if not hasattr(service, "_member_catalog"):
        service._member_catalog = Catalog(service._avatars.parent / "member-catalog", url=os.environ.get("RAPHAEL_CATALOG_URL", DEFAULT_URL),
                                          now=lambda: service._now_ms() / 1000, language=lambda: service._ui_language({}))
    return service._member_catalog


async def handle(service, params):
    action = params["action"]
    if action == "catalog":
        try:
            return await client(service).fetch()
        except (ValueError, OSError):
            # An unavailable or rejected catalogue has the same calm empty state.
            return {"entries": [], "offline": True, "open": client(service).is_open}
    if action == "catalog-preview":
        value = await client(service).package(params.get("catalog_id"))
        return {"template": value, "findings": findings(value)}
    if action == "folder":
        return {"path": str(export_file(service, params.get("folder_id")))}
    value = checked(params.get("template"))
    raw, digest, folder = export_files(service, value)
    atomic(folder / "member.raphael-member", raw)
    atomic(folder / "README.md", b"Submit this recipe by pull request. No credentials or permissions are included.\n")
    query = urlencode({"quick_pull": "1", "title": f"Add member template: {value['name']}", "body": f"Package: member.raphael-member\nSHA256: {digest}\n\nFork the catalogue and add the package, README and index entry. The maintainer reviews and signs the index."})
    return {"folder": str(folder), "folder_id": folder.name, "url": "https://github.com/Jheng-Kai/raphael-catalog/compare/main...main?" + query}
