"""Place a headed Chrome on a Windows desktop that the owner never switches to."""

import asyncio
import ctypes as c
import secrets
import subprocess
from ctypes import wintypes as w


CREATE_BREAKAWAY_FROM_JOB = 0x01000000
ERROR_ACCESS_DENIED = 5


class StartupInfo(c.Structure):
    _fields_ = [
        ("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR), ("title", w.LPWSTR),
        ("x", w.DWORD), ("y", w.DWORD), ("width", w.DWORD), ("height", w.DWORD),
        ("columns", w.DWORD), ("rows", w.DWORD), ("fill", w.DWORD), ("flags", w.DWORD),
        ("show", w.WORD), ("reserved_size", w.WORD), ("reserved_data", c.c_void_p),
        ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE),
    ]


class ProcessInformation(c.Structure):
    _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE), ("pid", w.DWORD), ("tid", w.DWORD)]


class DesktopChrome:
    def __init__(self, argv, visible=False):
        """`visible`: Chrome starts on the owner's own desktop instead, for the one step where they choose a certificate. That
        Chrome is meant to outlive the app (the certificate lives in its memory), so it also breaks away from the app's job,
        which would otherwise end it with the app (the job allows breakaway, `core_process.rs`); where the job does not
        allow it, Chrome starts in the job as any other and ends with the app."""
        import _winapi as win

        self.win = win
        self.user = c.WinDLL("user32", use_last_error=True)
        self.user.CreateDesktopW.argtypes = [w.LPCWSTR, w.LPCWSTR, c.c_void_p, w.DWORD, w.DWORD, c.c_void_p]
        self.user.CreateDesktopW.restype = w.HANDLE
        self.user.CloseDesktop.argtypes = [w.HANDLE]
        self.kernel = c.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateProcessW.argtypes = [
            w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD,
            c.c_void_p, w.LPCWSTR, c.POINTER(StartupInfo), c.POINTER(ProcessInformation),
        ]
        self.kernel.ResumeThread.argtypes = [w.HANDLE]
        self.kernel.ResumeThread.restype = w.DWORD
        name = f"RaphaelChrome-{secrets.token_hex(8)}"
        # There is no Explorer shell on this desktop to show a taskbar button.
        # Keep the window visible to its compositor without touching the input desktop.
        self.desktop = None if visible else self.user.CreateDesktopW(name, None, None, 0, 0x10000000, None)  # GENERIC_ALL
        if not visible and not self.desktop:
            raise c.WinError(c.get_last_error())
        self.info = ProcessInformation()
        startup = StartupInfo(cb=c.sizeof(StartupInfo), desktop=None if visible else name)
        command = c.create_unicode_buffer(subprocess.list2cmdline(argv))
        # Join the job before Chrome can spawn any children.
        flags = 0x00000004 | subprocess.CREATE_NO_WINDOW  # CREATE_SUSPENDED
        created = self._create(argv[0], command, flags | CREATE_BREAKAWAY_FROM_JOB if visible else flags, startup)
        # A job that does not allow breakaway refuses the flag with "access denied": start without it.
        if not created and visible and c.get_last_error() == ERROR_ACCESS_DENIED:
            created = self._create(argv[0], command, flags, startup)
        if not created:
            error = c.WinError(c.get_last_error())
            self.close()
            raise error

    def _create(self, executable, command, flags, startup):
        return self.kernel.CreateProcessW(executable, command, None, None, False, flags,
                                          None, None, c.byref(startup), c.byref(self.info))

    @property
    def pid(self):
        return self.info.pid

    @property
    def returncode(self):
        if self.win.WaitForSingleObject(self.info.process, 0) == 0:
            return self.win.GetExitCodeProcess(self.info.process)
        return None

    def resume(self):
        if self.kernel.ResumeThread(self.info.thread) == 0xffffffff:
            raise c.WinError(c.get_last_error())
        self.win.CloseHandle(self.info.thread)
        self.info.thread = None

    def kill(self):
        self.win.TerminateProcess(self.info.process, 1)

    async def wait(self):
        while (code := self.returncode) is None:
            await asyncio.sleep(0.05)
        return code

    def close(self):
        if self.info.thread:
            self.win.CloseHandle(self.info.thread)
        if self.info.process:
            self.win.CloseHandle(self.info.process)
        if self.desktop:
            self.user.CloseDesktop(self.desktop)
