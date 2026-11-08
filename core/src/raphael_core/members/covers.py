"""Owner-local cover selections and original image bytes beside the avatars."""

import json
import logging
import re

from ..protocol import INVALID_PARAMS, RpcError


logger = logging.getLogger(__name__)
PATTERN = re.compile(r"[a-z0-9-]{1,24}")


def selection(value):
    if value is None:
        return None
    if isinstance(value, str) and value.startswith('pattern:') and PATTERN.fullmatch(value[8:]):
        return {'kind': 'pattern', 'id': value[8:]}
    raise RpcError(INVALID_PARAMS, 'Invalid params: cover', {'kind': 'cover'})


class Covers:
    def __init__(self, folder, data_url, evict):
        self.folder, self._data_url, self._evict = folder, data_url, evict

    def _metadata(self, member_id):
        return self.folder / f'{member_id}.json'

    def reference(self, member_id):
        path = self._metadata(member_id)
        try:
            if path.stat().st_size > 256:
                return None
            value = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None
        if not isinstance(value, dict):
            return None
        if value.get('kind') == 'pattern' and isinstance(value.get('id'), str) and PATTERN.fullmatch(value['id']):
            return {'kind': 'pattern', 'id': value['id']}
        name = value.get('file')
        if value.get('kind') == 'image' and isinstance(name, str) and re.fullmatch(rf'{member_id}-[a-f0-9]{{12}}\.(?:png|jpg|webp|gif)', name):
            return {'kind': 'image', 'file': name}
        return None

    def view(self, member_id):
        value = self.reference(member_id)
        if value and value['kind'] == 'image':
            path = self.folder / value['file']
            try:
                if path.resolve().parent != self.folder.resolve():
                    return None
            except (OSError, ValueError):
                return None
            url = self._data_url(path)
            return {'kind': 'image', 'url': url} if url else None
        return value

    def remove_image(self, name):
        path = self.folder / name
        self._evict(path, None)
        try:
            path.unlink(missing_ok=True)
        except OSError as error:
            logger.warning("Could not remove a member's cover image: %s", type(error).__name__)

    def save(self, member_id, value):
        previous = self.reference(member_id)
        path = self._metadata(member_id)
        part = path.with_suffix('.json.part')
        try:
            if value is None:
                path.unlink(missing_ok=True)
            else:
                self.folder.mkdir(parents=True, exist_ok=True)
                part.write_text(json.dumps(value), encoding='utf-8')
                part.replace(path)
        finally:
            part.unlink(missing_ok=True)
        if previous and previous['kind'] == 'image' and previous != value:
            self.remove_image(previous['file'])

    def stage(self, name, raw):
        self.folder.mkdir(parents=True, exist_ok=True)
        path = self.folder / name
        part = path.with_suffix(path.suffix + '.part')
        try:
            part.write_bytes(raw)
            part.replace(path)
        finally:
            part.unlink(missing_ok=True)
