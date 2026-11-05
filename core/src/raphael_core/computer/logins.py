"""Vault references for private page filling."""
# Adapted from OpenMausBot (Apache-2.0); see core/packaging/licenses/NOTICES.md.

import hashlib
import json
from urllib.parse import urlsplit


def origin(site):
    try:
        url = urlsplit(site)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443):
            raise ValueError()
        return "https://" + url.hostname.encode("idna").decode().lower()
    except (TypeError, UnicodeError, ValueError):
        raise ValueError("https_origin_required") from None


class LoginVault:
    def __init__(self, vault, *, conn=None):
        self.vault, self.conn = vault, conn
        self.values = {}

    def reference(self, member, site):
        identifier = hashlib.sha256(f"{member}:{origin(site)}".encode()).hexdigest()
        self.values.setdefault(member, set())
        return identifier

    def save(self, reference, value, *, member=None, site=None):
        if member is not None and reference != self.reference(member, site):
            raise ValueError("wrong_login")
        try:
            data = json.loads(value)
            if set(data) != {"username", "password"} or any(not isinstance(data[key], str) or not data[key] or len(data[key]) > 400 for key in data):
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError("invalid_login") from None
        self.vault.set("computer-login:" + reference, value)
        if self.conn is not None and member is not None:
            with self.conn:
                self.conn.execute("INSERT OR REPLACE INTO computer_logins(member_id, origin, reference) VALUES (?, ?, ?)",
                                  (member, origin(site), reference))

    def references(self, member=None):
        if self.conn is None:
            return []
        return self.conn.execute("SELECT member_id, origin, reference FROM computer_logins" +
                                 (" WHERE member_id=?" if member is not None else ""),
                                 (member,) if member is not None else ()).fetchall()

    def load(self, member, site, reference):
        if reference != self.reference(member, site):
            raise ValueError("wrong_login")
        value = self.vault.get("computer-login:" + reference)
        if not value:
            raise ValueError("login_missing")
        try:
            data = json.loads(value)
            if set(data) != {"username", "password"} or any(not isinstance(data[key], str) or not data[key] for key in data):
                raise ValueError()
        except (TypeError, ValueError):
            raise ValueError("invalid_login") from None
        self.values.setdefault(member, set()).update(data.values())
        return data

    def redact(self, member, text):
        for value in sorted(self.values.get(member, ()), key=len, reverse=True):
            for representation in {value, json.dumps(value)[1:-1], json.dumps(value, ensure_ascii=False)[1:-1]}:
                text = text.replace(representation, "[private]")
        return text
