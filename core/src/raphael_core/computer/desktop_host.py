"""Host adapter for starting an installed Docker Desktop; VM code stays portable."""

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Windows only; the other systems have no console window to hide and refuse the flag.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class DockerDesktop:
    def cli(self):
        found = shutil.which("docker.exe" if sys.platform == "win32" else "docker")
        if found:
            return Path(found)
        if sys.platform == "win32":
            path = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Docker/Docker/resources/bin/docker.exe"
            if path.is_file():
                return path
        if sys.platform == "darwin":
            path = Path("/Applications/Docker.app/Contents/Resources/bin/docker")
            if path.is_file():
                return path
        return None

    def executable(self):
        if sys.platform == "win32":
            for root in (os.environ.get("ProgramFiles", "C:/Program Files"), os.environ.get("LOCALAPPDATA", "")):
                path = Path(root) / "Docker" / "Docker" / "Docker Desktop.exe"
                if path.is_file():
                    return path
        return None

    def installed(self):
        return self.cli() is not None or self.executable() is not None or sys.platform == "darwin" and Path("/Applications/Docker.app").is_dir()

    async def start(self):
        executable = self.executable() if sys.platform == "win32" else None
        if executable is not None:
            process = await asyncio.create_subprocess_exec(
                str(executable), stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                creationflags=NO_WINDOW,
            )
            asyncio.create_task(process.wait())
            return
        if sys.platform == "darwin" and Path("/Applications/Docker.app").is_dir():
            process = await asyncio.create_subprocess_exec(
                "/usr/bin/open", "-a", "/Applications/Docker.app",
                stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            asyncio.create_task(process.wait())
            return
        cli = self.cli()
        if cli is not None:
            # Probe capabilities without waking the engine. Only an explicitly
            # missing desktop command permits the legacy GUI launcher.
            probe = await asyncio.create_subprocess_exec(
                str(cli), "desktop", "start", "--help", stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
                creationflags=NO_WINDOW,
            )
            try:
                _, diagnostic = await asyncio.wait_for(probe.communicate(), 15)
            except BaseException:
                if probe.returncode is None:
                    probe.kill()
                await probe.wait()
                raise
            unsupported = any(line.strip() in (
                "docker: 'desktop' is not a docker command.",
                'unknown command "desktop" for "docker"',
                "docker: unknown command: docker desktop",
            ) for line in diagnostic.decode("utf-8", errors="replace").splitlines())
            if probe.returncode == 0:
                process = await asyncio.create_subprocess_exec(
                    str(cli), "desktop", "start", "--detach", stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    creationflags=NO_WINDOW,
                )
                asyncio.create_task(process.wait())
                return
            if not unsupported:
                raise OSError("docker_start_failed")
        executable = self.executable()
        if executable is None:
            raise OSError("docker_desktop_unavailable")
        # Only this adapter knows the host OS. Do not invoke a shell, elevate,
        # change daemon configuration or install anything on the owner's PC.
        process = await asyncio.create_subprocess_exec(
            str(executable), stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        )
        # Docker's launcher may forward to an existing instance. Engine readiness
        # is polled by LocalVm, independently of this launcher's lifetime.
        asyncio.create_task(process.wait())
