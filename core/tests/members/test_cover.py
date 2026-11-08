"""Owner-local member covers use the same checked uploads as avatars."""

import asyncio
import base64
import json
import struct
import zlib

import pytest

from raphael_core.protocol import INVALID_PARAMS, RpcError
from raphael_core.services.attachments import MAX_IMAGE_BYTES
from .test_service import PNG, WEBP


def wide_picture():
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 4, 1, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00' + b'\xff\x80\x00' * 4)) + chunk(b'IEND', b''))


def upload(identifier, raw=PNG, mime='image/png', name='C:/Owner/cover.png'):
    return {'id': identifier, 'name': name, 'mime': mime, 'data': base64.b64encode(raw).decode('ascii')}


@pytest.mark.parametrize('builtin', [False, True])
async def test_upload_replacement_pattern_and_clear_preserve_original_bytes(rig, builtin):
    member = (await rig.call('members.create', {'name': 'Cover owner'}))['member']
    identifier = 0 if builtin else member['id']
    assert all('cover' not in item for item in (await rig.call('members.list'))['members'])
    raw = wide_picture()
    shown = (await rig.call('members.set_cover', upload(identifier, raw)))['member']
    assert shown['id'] == identifier and shown['cover'] == {'kind': 'image', 'url': 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')}
    folder = rig.local / 'avatars' / 'covers'
    [first] = list(folder.glob('*.png'))
    assert first.read_bytes() == raw and 'Owner' not in first.name
    assert struct.unpack('>II', first.read_bytes()[16:24]) == (4, 1)
    again = (await rig.call('members.set_cover', upload(identifier, WEBP, 'image/webp', 'new.webp')))['member']
    assert not first.exists() and len(list(folder.glob('*.webp'))) == 1
    assert again['avatar'] == shown['avatar'] and again['cover']['url'].startswith('data:image/webp;base64,')
    pattern = (await rig.call('members.update', {'id': identifier, 'cover': 'pattern:unknown-future-pattern'}))['member']
    assert pattern['cover'] == {'kind': 'pattern', 'id': 'unknown-future-pattern'}
    assert not list(folder.glob('*.webp'))
    listed = next(item for item in (await rig.call('members.list'))['members'] if item['id'] == identifier)
    assert listed['cover'] == pattern['cover']
    assert 'cover' not in (await rig.call('members.update', {'id': identifier, 'cover': None}))['member']
    assert list(folder.iterdir()) == []
    assert ('members.changed', {}) in rig.notes


async def test_deleting_a_member_removes_only_its_cover(rig):
    a = (await rig.call('members.create', {'name': 'A'}))['member']['id']
    b = (await rig.call('members.create', {'name': 'B'}))['member']['id']
    await rig.call('members.set_cover', upload(a))
    await rig.call('members.set_cover', upload(b))
    folder = rig.local / 'avatars' / 'covers'
    assert len(list(folder.iterdir())) == 4
    await rig.call('members.delete', {'id': a})
    assert len(list(folder.iterdir())) == 2
    assert next(item for item in (await rig.call('members.list'))['members'] if item['id'] == b)['cover']['kind'] == 'image'


@pytest.mark.parametrize('value', ['', 'pattern:', 'pattern:Upper', 'pattern:spaces here', 'pattern:a/b', 'pattern:' + 'a' * 25, 'file:cover.png', 1, {}, True])
async def test_invalid_cover_update_does_not_mutate_the_member(rig, value):
    member = (await rig.call('members.create', {'name': 'Keep name'}))['member']['id']
    await rig.call('members.set_cover', upload(member))
    before = sorted((rig.local / 'avatars' / 'covers').iterdir())
    with pytest.raises(RpcError) as caught:
        await rig.call('members.update', {'id': member, 'name': 'Changed name', 'cover': value})
    assert caught.value.code == INVALID_PARAMS and caught.value.data['kind'] == 'cover'
    assert rig.service.store.member(member).name == 'Keep name'
    assert all(path.exists() for path in before)


@pytest.mark.parametrize('patch', [
    {'mime': 'application/pdf', 'data': base64.b64encode(b'%PDF-1.7').decode()},
    {'mime': 'image/png', 'data': base64.b64encode(b'<svg/>').decode()},
    {'mime': 'image/jpeg', 'data': base64.b64encode(PNG).decode()},
    {'data': 'not base64!'}, {'data': ''}, {'name': None},
    {'data': 'A' * ((MAX_IMAGE_BYTES * 4) // 3 + 9)},
    {'data': base64.b64encode(PNG + b'\x00' * (MAX_IMAGE_BYTES + 1 - len(PNG))).decode()},
])
async def test_cover_upload_refusals_match_avatar_and_preserve_existing_cover(rig, patch):
    member = (await rig.call('members.create', {'name': 'Safe cover'}))['member']['id']
    expected = (await rig.call('members.set_cover', upload(member)))['member']['cover']
    errors = []
    for method in ('members.set_avatar', 'members.set_cover'):
        with pytest.raises(RpcError) as caught:
            await rig.call(method, {**upload(member), **patch})
        errors.append((caught.value.code, caught.value.data))
    assert errors[0] == errors[1] and errors[0][0] == INVALID_PARAMS
    shown = next(item for item in (await rig.call('members.list'))['members'] if item['id'] == member)
    assert shown['cover'] == expected
    assert len(list((rig.local / 'avatars' / 'covers').iterdir())) == 2


async def test_cover_survives_reload_and_a_missing_picture_is_unset(rig):
    from raphael_core.members.covers import Covers
    member = (await rig.call('members.create', {'name': 'Persistent'}))['member']['id']
    expected = (await rig.call('members.set_cover', upload(member)))['member']['cover']
    rig.service._covers = Covers(rig.local / 'avatars' / 'covers', rig.service._data_url, rig.service._pictures.pop)
    assert rig.service.view_of(rig.service.store.member(member))['cover'] == expected
    next((rig.local / 'avatars' / 'covers').glob('*.png')).unlink()
    assert 'cover' not in rig.service.view_of(rig.service.store.member(member))


async def test_concurrent_uploads_keep_only_the_current_cover(rig):
    member = (await rig.call('members.create', {'name': 'Concurrent'}))['member']['id']
    await asyncio.gather(rig.call('members.set_cover', upload(member)),
                         rig.call('members.set_cover', upload(member, WEBP, 'image/webp')))
    folder = rig.local / 'avatars' / 'covers'
    assert len(list(folder.iterdir())) == 2 and not list(folder.glob('*.part'))
    assert rig.service.view_of(rig.service.store.member(member))['cover']['kind'] == 'image'


async def test_chat_management_uses_the_same_cover_rpc_and_pattern_update(rig):
    from raphael_core.management import REGISTRY, publish, self_action, self_definitions, tools_for_request
    assert REGISTRY['member_cover'].rpc == 'members.set_cover'
    assert self_action(0, 'member_cover', upload(0))
    assert not self_action(1, 'member_cover', upload(0))
    public, arguments = publish('member_cover', upload(0))
    assert arguments['action'] == 'member_cover'
    assert 'member_cover' in self_definitions(0)[public]['parameters']['properties']['action']['enum']
    for prompt in ('Change your cover', '\u66f4\u63db\u5c01\u9762', '\u30ab\u30d0\u30fc\u3092\u5909\u66f4'):
        assert public in tools_for_request(prompt)
    image = await rig.service.admin_tool(0, 'member_cover', upload(0), interactive=True)
    assert image['member']['cover']['kind'] == 'image'
    before = rig.service.first_bot_profile()
    pattern = await rig.service.admin_tool(0, 'member_update', {'id': 0, 'cover': 'pattern:dots'}, interactive=True)
    assert pattern['member']['cover'] == {'kind': 'pattern', 'id': 'dots'}
    assert rig.service.first_bot_profile() == before
    with pytest.raises(RpcError):
        await rig.service.admin_tool(0, 'member_cover', upload(0), interactive=False)


async def test_cover_is_not_a_template_field_or_imported_owner_state(rig):
    rig.service.greeting = lambda *args: None
    member = (await rig.call('members.create', {'name': 'Exported'}))['member']['id']
    await rig.call('members.set_cover', upload(member))
    value = (await rig.call('members.template', {'action': 'export', 'id': member}))['template']
    assert 'cover' not in value and 'data:image' not in json.dumps(value)
    copied = (await rig.call('members.template', {'action': 'import', 'template': value, 'name': 'Imported', 'greet': False}))['member']
    assert 'cover' not in copied
    with pytest.raises(RpcError):
        await rig.call('members.template', {'action': 'import', 'template': {**value, 'cover': 'pattern:dots'}, 'name': 'Injected'})


@pytest.mark.parametrize('step', ['stage', 'save'])
async def test_io_failure_preserves_old_cover_without_leaking_new_files(rig, monkeypatch, step):
    member = (await rig.call('members.create', {'name': 'Keeps cover'}))['member']['id']
    expected = (await rig.call('members.set_cover', upload(member)))['member']['cover']
    before = set((rig.local / 'avatars' / 'covers').iterdir())
    def broken(*args):
        raise OSError('synthetic disk refusal')
    monkeypatch.setattr(rig.service._covers, step, broken)
    with pytest.raises(RpcError) as caught:
        await rig.call('members.set_cover', upload(member, WEBP, 'image/webp'))
    assert caught.value.data == {'kind': 'io'}
    assert set((rig.local / 'avatars' / 'covers').iterdir()) == before
    assert rig.service.view_of(rig.service.store.member(member))['cover'] == expected


@pytest.mark.parametrize('cancel', [False, True])
async def test_inflight_upload_is_cleaned_after_delete_or_cancellation(rig, monkeypatch, cancel):
    member = (await rig.call('members.create', {'name': 'Inflight'}))['member']['id']
    entered, release = asyncio.Event(), asyncio.Event()
    original = asyncio.to_thread
    async def paused(function, *args, **kwargs):
        if function == rig.service._covers.stage:
            entered.set()
            await release.wait()
        return await original(function, *args, **kwargs)
    monkeypatch.setattr('raphael_core.members.service.asyncio.to_thread', paused)
    task = asyncio.create_task(rig.call('members.set_cover', upload(member)))
    await entered.wait()
    if cancel:
        task.cancel()
    else:
        await rig.call('members.delete', {'id': member})
    release.set()
    with pytest.raises(asyncio.CancelledError if cancel else RpcError):
        await task
    assert list((rig.local / 'avatars' / 'covers').iterdir()) == []


async def test_untrusted_cover_metadata_cannot_read_or_delete_another_file(rig, tmp_path):
    member = (await rig.call('members.create', {'name': 'Metadata'}))['member']['id']
    await rig.call('members.update', {'id': member, 'cover': 'pattern:dots'})
    outside = tmp_path / 'outside.png'
    outside.write_bytes(PNG)
    meta = rig.local / 'avatars' / 'covers' / f'{member}.json'
    meta.write_text(json.dumps({'kind': 'image', 'file': str(outside)}), encoding='utf-8')
    assert 'cover' not in rig.service.view_of(rig.service.store.member(member))
    await rig.call('members.update', {'id': member, 'cover': None})
    assert outside.read_bytes() == PNG
