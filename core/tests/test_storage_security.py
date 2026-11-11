"""Storage permissions and retention only touch temporary folders."""

import os

import pytest

from raphael_core import paths
from raphael_core.memory.legacy import _backup


def test_data_directory_is_secured_before_return_even_when_it_already_exists(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    secured = []
    monkeypatch.setenv("RAPHAEL_DATA_DIR", str(root))
    monkeypatch.setattr(paths, "owner_only_directory", lambda path: secured.append(path), raising=False)
    assert paths.data_dir() == root
    assert secured == [root]


def test_backups_keep_five_versions_per_source_and_leave_unowned_files(tmp_path):
    source, folder = tmp_path / "note.md", tmp_path / "backups"
    folder.mkdir()
    stranger = folder / "note.md"
    stranger.write_text("owner-created")
    for number in range(8):
        source.write_text(f"version-{number}")
        _backup(source, folder)
    assert stranger.read_text() == "owner-created"
    versions = {path.read_text() for path in folder.glob("*.md") if path != stranger}
    assert versions == {f"version-{number}" for number in range(3, 8)}


def test_retention_preserves_a_backup_the_owner_changed(tmp_path):
    source, folder = tmp_path / "note.md", tmp_path / "backups"
    source.write_text("first")
    _backup(source, folder)
    (folder / "note.md").write_text("owner-edited")
    for number in range(7):
        source.write_text(str(number))
        _backup(source, folder)
    assert (folder / "note.md").read_text() == "owner-edited"


def test_acl_failure_prevents_data_directory_use(tmp_path, monkeypatch):
    monkeypatch.setenv("RAPHAEL_DATA_DIR", str(tmp_path / "data"))
    def denied(path): raise OSError("private_directory")
    monkeypatch.setattr(paths, "owner_only_directory", denied)
    with pytest.raises(OSError, match="private_directory"):
        paths.data_dir()


@pytest.mark.skipif(os.name != "nt", reason="Windows DACL contract")
def test_real_temporary_directory_has_a_protected_single_owner_grant(tmp_path):
    import ctypes as c
    from ctypes import wintypes as w
    from raphael_core.storage import owner_only_directory
    root = tmp_path / "private"
    owner_only_directory(root)
    advapi = c.WinDLL("advapi32", use_last_error=True)
    advapi.GetFileSecurityW.argtypes = [w.LPCWSTR, w.DWORD, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
    advapi.GetSecurityDescriptorDacl.argtypes = [c.c_void_p, c.POINTER(w.BOOL), c.POINTER(c.c_void_p), c.POINTER(w.BOOL)]
    advapi.GetSecurityDescriptorControl.argtypes = [c.c_void_p, c.POINTER(w.WORD), c.POINTER(w.DWORD)]
    size = w.DWORD()
    advapi.GetFileSecurityW(str(root), 4, None, 0, c.byref(size))
    descriptor = c.create_string_buffer(size.value)
    assert advapi.GetFileSecurityW(str(root), 4, descriptor, size, c.byref(size))
    control, revision = w.WORD(), w.DWORD()
    assert advapi.GetSecurityDescriptorControl(descriptor, c.byref(control), c.byref(revision))
    assert control.value & 0x1000  # SE_DACL_PROTECTED
    present, defaulted, acl = w.BOOL(), w.BOOL(), c.c_void_p()
    assert advapi.GetSecurityDescriptorDacl(descriptor, c.byref(present), c.byref(acl), c.byref(defaulted))
    assert present.value and acl.value
    assert c.c_ushort.from_address(acl.value + 4).value == 1  # ACL.AceCount
