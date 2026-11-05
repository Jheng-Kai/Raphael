"""Bound expansion before allocating text from hostile Office files."""

import pytest

from raphael_core.services import file_reader
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import checked
from raphael_core.protocol import RpcError
from .test_file_reader import archive


@pytest.mark.parametrize("action", ["read", "save", "upload"])
async def test_attachment_storage_rejects_a_redirected_root(tmp_path, action):
    import os
    outside = tmp_path / "owner-files"
    outside.mkdir()
    key = "a" * 32 + ".txt"
    (outside / key).write_bytes(b"owner-only")
    store = AttachmentStore(tmp_path)
    if os.name == "nt":
        import _winapi
        _winapi.CreateJunction(str(outside), str(store.root))
    else:
        store.root.symlink_to(outside, target_is_directory=True)
    before = set(outside.iterdir())
    with pytest.raises(RpcError):
        if action == "read":
            store.path(key)
        elif action == "save":
            store.save(checked("new.txt", "text/plain", b"new content"))
        else:
            await store.upload({"action": "begin", "name": "new.txt", "mime": "text/plain", "size": 5})
    assert set(outside.iterdir()) == before


def test_shared_string_references_cannot_expand_past_the_extraction_budget(monkeypatch):
    monkeypatch.setattr(file_reader, "MAX_EXTRACT_BYTES", 4096)
    data = archive({
        "xl/sharedStrings.xml": "<sst><si><t>" + "A" * 1024 + "</t></si></sst>",
        "xl/worksheets/sheet1.xml": "<worksheet><row>" + '<c t="s"><v>0</v></c>' * 40 + "</row></worksheet>",
    })
    with pytest.raises(ValueError, match="extraction_limit"):
        file_reader.office_text(data, ".xlsx")
