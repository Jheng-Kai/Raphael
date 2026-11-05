"""Owner-only local storage, shared by persistent data and private SSH endpoints."""

import os
from pathlib import Path


def owner_only_directory(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or path.is_junction():
        raise OSError("private_directory")
    if os.name != "nt":
        path.chmod(0o700)
        return
    import ctypes as c
    from ctypes import wintypes as w
    advapi, kernel = c.WinDLL("advapi32", use_last_error=True), c.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    kernel.LocalFree.argtypes = [c.c_void_p]
    advapi.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
    advapi.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
    advapi.ConvertSidToStringSidW.argtypes = [c.c_void_p, c.POINTER(w.LPWSTR)]
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, c.POINTER(c.c_void_p), c.c_void_p]
    advapi.SetFileSecurityW.argtypes = [w.LPCWSTR, w.DWORD, c.c_void_p]
    token = w.HANDLE()
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 8, c.byref(token)):
        raise OSError("private_directory")
    try:
        size = w.DWORD()
        advapi.GetTokenInformation(token, 1, None, 0, c.byref(size))
        buffer = c.create_string_buffer(size.value)
        if not advapi.GetTokenInformation(token, 1, buffer, size, c.byref(size)):
            raise OSError("private_directory")
        sid = c.cast(buffer, c.POINTER(c.c_void_p))[0]
        identity = w.LPWSTR()
        if not advapi.ConvertSidToStringSidW(sid, c.byref(identity)):
            raise OSError("private_directory")
        try:
            # A protected DACL replaces inherited and explicit grants; children inherit only this SID.
            descriptor = c.c_void_p()
            if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    f"D:P(A;OICI;FA;;;{identity.value})", 1, c.byref(descriptor), None):
                raise OSError("private_directory")
            try:
                if not advapi.SetFileSecurityW(str(path), 0x80000004, descriptor):
                    raise OSError("private_directory")
            finally:
                kernel.LocalFree(descriptor)
        finally:
            kernel.LocalFree(identity)
    finally:
        kernel.CloseHandle(token)
