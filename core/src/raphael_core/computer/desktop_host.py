"""Host adapter for starting an installed Docker Desktop; VM code stays portable."""

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path


class DockerDesktop:
    def executable(self):
        if sys.platform == "win32":
            for root in (os.environ.get("ProgramFiles", "C:/Program Files"), os.environ.get("LOCALAPPDATA", "")):
                path = Path(root) / "Docker" / "Docker" / "Docker Desktop.exe"
                if path.is_file():
                    return path
        return None

    def installed(self):
        return self.executable() is not None or shutil.which("docker") is not None

    async def start(self):
        executable = self.executable()
        if executable is None:
            raise OSError("docker_desktop_unavailable")
        # Only this adapter knows the host OS. Do not invoke a shell, elevate,
        # change daemon configuration or install anything on the owner's PC.
        process = await asyncio.create_subprocess_exec(
            str(executable), stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        # Docker's launcher may forward to an existing instance. Engine readiness
        # is polled by LocalVm, independently of this launcher's lifetime.
        asyncio.create_task(process.wait())
