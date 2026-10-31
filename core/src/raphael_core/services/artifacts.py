"""Only tool receipts backed by the attachment store become deliverable files."""

import json

from ..protocol import RpcError
from .attachments import Attachment


def artifact_payload(content, store):
    if store is None:
        return None
    try:
        data = json.loads(content) if isinstance(content, str) else content
        if isinstance(data, dict) and isinstance(data.get("content"), str):
            data = json.loads(data["content"])
        file = data.get("attachment")
        if not isinstance(file, dict) or not isinstance(file.get("name"), str) or not isinstance(file.get("mime"), str):
            return None
        path = store.path(file.get("id"))
        return {"attachment": {"id": path.name, "name": file["name"], "mime": file["mime"], "size": path.stat().st_size}}
    except (ValueError, AttributeError, OSError, RpcError):
        return None


def turn_files(history, turn_id, store):
    seen = set()
    for message in history.messages([turn_id]).get(turn_id, []):
        if message["kind"] != "media":
            continue
        payload = artifact_payload(message["text"], store)
        if payload:
            file = payload["attachment"]
            if file["id"] not in seen:
                seen.add(file["id"])
                try:
                    yield Attachment(file["name"], file["mime"], store.path(file["id"]).read_bytes(), file["id"])
                except (OSError, RpcError):
                    continue
