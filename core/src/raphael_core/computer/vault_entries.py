"""Owner-managed metadata and transient import previews; private values stay in the OS vault."""

import asyncio
import csv
import io
import json
import time
import uuid

from .logins import LoginVault, origin
from ..protocol import invalid_params


FIELDS = {"login": ("username", "password"), "contact": ("name", "address", "phone", "email"),
          "card": ("name", "number", "expiry", "cvc")}


def payment_question(arguments, language):
    label, site, amount = (str(arguments.get(key, "")) for key in ("label", "site", "amount"))
    return {"zh-TW": f"允許使用「{label}」在 {site} 填入付款資料？金額：{amount or '頁面未顯示'}。最後付款由你完成。",
            "ja": f"{site} で「{label}」を入力しますか？金額：{amount or '表示なし'}。最後の支払いはあなたが行います。"}.get(language,
            f"Allow {label} to fill payment details at {site}? Amount: {amount or 'not shown'}. You complete the final payment.")


class VaultEntries(LoginVault):
    def __init__(self, vault, *, conn):
        super().__init__(vault, conn=conn)
        self.previews = {}
        self.preview_timer = None

    def entries(self, member=None):
        rows = []
        for row in self.conn.execute("SELECT * FROM vault_entries ORDER BY label,id"):
            members = json.loads(row["members"])
            if member is None or members == "all" or member in members:
                rows.append({key: row[key] for key in ("id", "kind", "label", "hint", "origin")} | {"members": members})
        return rows

    def choices(self, member):
        return [{key: row[key] for key in ("id", "kind", "label", "hint")} for row in self.entries(member)]

    def put(self, params):
        kind, label, hint = params.get("kind"), params.get("label"), params.get("hint", "")
        members, values = params.get("members", "all"), params.get("values")
        if (kind not in FIELDS or not isinstance(label, str) or not label.strip() or len(label) > 200
                or not isinstance(hint, str) or len(hint) > 240 or "\n" in hint or "\r" in hint
                or not (members == "all" or isinstance(members, list) and members
                        and all(type(m) is int and m >= 0 for m in members))):
            raise ValueError("invalid_entry")
        if members != "all" and any(m != 0 and not self.conn.execute("SELECT 1 FROM members WHERE id=?", (m,)).fetchone() for m in members):
            raise ValueError("invalid_members")
        if not isinstance(values, dict) or set(values) != set(FIELDS[kind]) or any(not isinstance(v, str) or len(v) > 400 for v in values.values()):
            raise ValueError("invalid_values")
        if kind == "login" and not all(values.values()) or kind != "login" and not any(values.values()):
            raise ValueError("empty_values")
        site = origin(params.get("origin")) if kind == "login" else ""
        identifier = uuid.uuid4().hex
        credential = "computer-entry:" + identifier
        # Bound the encoded blob before any write to Windows Credential Manager.
        encoded = json.dumps(values, ensure_ascii=False)
        if len(encoded.encode("utf-16-le")) > 2000:
            raise ValueError("entry_too_large")
        self.vault.set(credential, encoded)
        try:
            with self.conn:
                self.conn.execute("INSERT INTO vault_entries VALUES (?,?,?,?,?,?,?)",
                                  (identifier, kind, label.strip(), hint.strip(), site, json.dumps(members), credential))
        except Exception:
            self.vault.delete(credential)
            raise
        # Existing readers may already have seen this computer; protect all later reads immediately.
        for member in list(self.values):
            self.remember(member, values)
        return identifier

    def remember(self, member, values):
        self.values.setdefault(member, set()).update(v for v in values.values() if v)

    def entry(self, member, reference, kind):
        row = self.conn.execute("SELECT * FROM vault_entries WHERE id=? AND kind=?", (reference, kind)).fetchone()
        if row is None:
            raise ValueError("entry_missing")
        members = json.loads(row["members"])
        if members != "all" and member not in members:
            raise ValueError("entry_denied")
        raw = self.vault.get(row["credential"])
        values = json.loads(raw) if raw else None
        if not isinstance(values, dict) or set(values) != set(FIELDS[kind]) or any(not isinstance(v, str) for v in values.values()):
            raise ValueError("invalid_entry")
        self.remember(member, values)
        return row, values

    def preload(self, member):
        # Shared desktop output can show any saved entry, including another member's data.
        for row in self.conn.execute("SELECT credential FROM vault_entries"):
            try:
                raw = self.vault.get(row[0])
                if raw:
                    self.remember(member, json.loads(raw))
            except Exception:
                continue

    def load(self, member, site, reference):
        row = self.conn.execute("SELECT origin FROM vault_entries WHERE id=?", (reference,)).fetchone()
        if row is None:
            return super().load(member, site, reference)
        row, values = self.entry(member, reference, "login")
        if row["origin"] != origin(site):
            raise ValueError("wrong_login")
        return values

    def save(self, reference, value, *, member=None, site=None):
        super().save(reference, value, member=member, site=site)
        if member is not None:
            with self.conn:
                self.conn.execute("INSERT OR IGNORE INTO vault_entries VALUES (?,?,?,?,?,?,?)",
                                  (reference, "login", origin(site), "", origin(site), json.dumps([member]), "computer-login:" + reference))

    def remove(self, identifier):
        row = self.conn.execute("SELECT credential FROM vault_entries WHERE id=?", (identifier,)).fetchone()
        if row:
            self.vault.delete(row[0])
            with self.conn:
                self.conn.execute("DELETE FROM vault_entries WHERE id=?", (identifier,))
                self.conn.execute("DELETE FROM computer_logins WHERE reference=?", (identifier,))

    def preview(self, text):
        self.previews = {k: v for k, v in self.previews.items() if v[0] > time.monotonic()}
        if not isinstance(text, str) or len(text) > 2_000_000:
            raise ValueError("invalid_csv")
        reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
        normalize = lambda key: key.casefold().replace(" ", "").replace("_", "")
        headers = {normalize(key) for key in reader.fieldnames or ()}
        if not ({"username", "password"} <= headers and headers & {"url", "website"}):
            raise ValueError("unsupported_csv")
        candidates, rejected = [], 0
        for index, row in enumerate(reader):
            if index >= 2000:
                raise ValueError("too_many_entries")
            try:
                row = {normalize(key): value for key, value in row.items() if key}
                site = origin(row.get("url") or row.get("website"))
                label = (row.get("name") or row.get("title") or site)[:200]
                values = {"username": row.get("username") or "", "password": row.get("password") or ""}
                if not all(values.values()) or any(len(v) > 400 for v in values.values()):
                    raise ValueError()
                candidates.append({"label": label, "origin": site, "kind": "login", "values": values})
            except (ValueError, TypeError):
                rejected += 1
        token = uuid.uuid4().hex
        # A single owner preview replaces the previous one; no source bytes or filename are stored.
        self.previews = {token: (time.monotonic() + 600, candidates)}
        if self.preview_timer:
            self.preview_timer.cancel()
        try:
            self.preview_timer = asyncio.get_running_loop().call_later(600, lambda: self.previews.pop(token, None))
        except RuntimeError:
            self.preview_timer = None
        return {"token": token, "entries": [{"id": i, "label": r["label"], "origin": r["origin"]} for i, r in enumerate(candidates)], "rejected": rejected}

    def register(self, router):
        async def listing(p):
            return {"entries": self.entries()}
        async def write(p):
            try:
                identifier = self.put(p)
                return {"id": identifier}
            except Exception:
                raise invalid_params("vault_entry") from None
        async def remove(p):
            try:
                self.remove(p.get("id"))
                return {"removed": True}
            except Exception:
                raise invalid_params("vault_entry") from None
        async def update(p):
            row = next((r for r in self.entries() if r["id"] == p.get("id")), None)
            label, hint, members = p.get("label"), p.get("hint", ""), p.get("members")
            if (not row or not isinstance(label, str) or not label.strip() or len(label) > 200
                    or not isinstance(hint, str) or len(hint) > 240 or "\n" in hint or "\r" in hint
                    or not (members == "all" or isinstance(members, list) and members
                            and all(type(m) is int and m >= 0 and (m == 0 or self.conn.execute("SELECT 1 FROM members WHERE id=?", (m,)).fetchone()) for m in members))):
                raise invalid_params("vault_metadata")
            with self.conn:
                self.conn.execute("UPDATE vault_entries SET label=?,hint=?,members=? WHERE id=?",
                                  (label.strip(), hint.strip(), json.dumps(members), row["id"]))
            return {"updated": True}
        async def preview(p):
            try:
                return self.preview(p.get("csv"))
            except Exception:
                raise invalid_params("vault_csv") from None
        async def cancel(p):
            self.previews.pop(p.get("token"), None)
            return {"cancelled": True}
        async def confirm(p):
            preview = self.previews.pop(p.get("token"), None)
            selected = p.get("ids")
            if not preview or preview[0] <= time.monotonic() or not isinstance(selected, list) or not all(type(i) is int and 0 <= i < len(preview[1]) for i in selected):
                raise invalid_params("vault_preview")
            saved = 0
            # Partial OS failures report counts only, never echoing CSV values or exception text.
            for index in dict.fromkeys(selected):
                try:
                    self.put(preview[1][index] | {"members": p.get("members", "all")})
                    saved += 1
                except Exception:
                    break
            return {"saved": saved, "remaining": len(set(selected)) - saved}
        for name, handler in {"list": listing, "add": write, "update": update, "remove": remove, "preview": preview,
                              "cancel": cancel, "import": confirm}.items():
            router.register("vault." + name, handler)
