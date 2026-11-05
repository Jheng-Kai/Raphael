"""Bounded disk uploads use the same admission and readers as existing files."""
import base64
import mmap

import pytest

from raphael_core.protocol import RpcError
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import MAX_ATTACHMENTS, from_wire
from raphael_core.services.file_reader import read_text


@pytest.mark.asyncio
async def test_chunked_upload_is_atomic_mapped_and_read_by_existing_text_reader(tmp_path):
    store = AttachmentStore(tmp_path)
    token = (await store.upload({"action":"begin","name":"notes.txt","mime":"text/plain","size":6}))["token"]
    assert not list(store.root.glob("*.txt"))
    for offset, value in [(0,b"abc"),(3,b"def")]:
        await store.upload({"action":"append","token":token,"offset":offset,"data":base64.b64encode(value).decode()})
    item = await store.upload({"action":"finish","token":token})
    attachment = from_wire([item], store.resolve)[0]
    try:
        assert isinstance(attachment.data, mmap.mmap)
        assert attachment.data[:] == b"abcdef"
        assert "abcdef" in read_text(attachment)["text"]
        assert store.save(attachment) is attachment
        assert attachment.metadata()["size"] == 6
    finally:
        attachment.data.close()


@pytest.mark.asyncio
async def test_upload_refuses_replays_wrong_sizes_and_unfinished_publication(tmp_path):
    store = AttachmentStore(tmp_path)
    token = (await store.upload({"action":"begin","name":"notes.txt","mime":"text/plain","size":3}))["token"]
    for params in [{"action":"finish"},{"action":"append","offset":1,"data":"YQ=="},{"action":"append","offset":0,"data":"YWFhYQ=="}]:
        with pytest.raises(RpcError):
            await store.upload({**params,"token":token})
    await store.upload({"action":"abort","token":token})
    assert not list(store.root.iterdir())
    with pytest.raises(RpcError):
        await store.upload({"action":"append","token":token,"offset":0,"data":"YQ=="})


@pytest.mark.asyncio
async def test_limits_are_checked_from_metadata_before_large_allocation(tmp_path):
    store = AttachmentStore(tmp_path)
    assert MAX_ATTACHMENTS == 20
    for mime, limit in [("application/pdf",250*1024*1024),("video/mp4",1024*1024*1024)]:
        token = (await store.upload({"action":"begin","name":"sample.bin","mime":mime,"size":limit}))["token"]
        # The same base64 length can encode a full chunk or two extra decoded bytes.
        with pytest.raises(RpcError):
            await store.upload({"action":"append","token":token,"offset":0,"data":base64.b64encode(b"a" * (1024*1024+1)).decode()})
        with pytest.raises(RpcError):
            await store.upload({"action":"begin","name":"sample.bin","mime":mime,"size":limit+1})
        await store.upload({"action":"abort","token":token})
