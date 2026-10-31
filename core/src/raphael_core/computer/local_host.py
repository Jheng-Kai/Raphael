"""The Windows command boundary; subprocess ownership stays in the core."""

import asyncio
import os
from pathlib import Path

from ..agent.cli.process import Child

OUTPUT_LIMIT = 20_000
# Windows PowerShell prints all that a command outputs as one table, in the columns of what came first: a load figure and
# then a process list leaves the list as blank lines. So each statement prints by itself, line by line as it comes. A
# command that does not parse runs as written, which reports why.
RUNNER = (
    "$raphael_text = $env:RAPHAEL_LOCAL_COMMAND; Remove-Item Env:RAPHAEL_LOCAL_COMMAND; $raphael_errors = $null; "
    "$raphael_ast = [System.Management.Automation.Language.Parser]::ParseInput($raphael_text, [ref]$null, [ref]$raphael_errors); "
    "if ($raphael_errors.Count -or $raphael_ast.ParamBlock -or $raphael_ast.BeginBlock -or $raphael_ast.ProcessBlock) { Invoke-Expression $raphael_text } "
    "else { foreach ($raphael_statement in $raphael_ast.EndBlock.Statements) { "
    ". ([scriptblock]::Create($raphael_statement.Extent.Text)) | Out-String -Stream -Width 240 } }"
)


class Output:
    def __init__(self, limit=OUTPUT_LIMIT // 2):
        self.limit, self.total = limit, 0
        self.head, self.tail = b"", b""

    def add(self, chunk):
        self.total += len(chunk)
        missing = self.limit // 2 - len(self.head)
        self.head += chunk[:max(0, missing)]
        self.tail = (self.tail + chunk[max(0, missing):])[-(self.limit // 2):]

    @property
    def truncated(self):
        return self.total > self.limit

    def text(self):
        return (self.head + (b"\n... output truncated ...\n" if self.truncated else b"") + self.tail).decode("utf-8", errors="replace")


class CommandChild(Child):
    def __init__(self, *args, errors=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.errors = errors if errors is not None else Output()

    async def _drain(self):
        while chunk := await self.process.stderr.read(8192):
            self.errors.add(chunk)


class LocalHost:
    async def execute(self, command, *, cwd=None, timeout_seconds=60, output=None, errors=None):
        from ..background.host import worker_environment
        if os.name != "nt":
            raise OSError("windows_required")
        shell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
        script = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; " + RUNNER
        child = CommandChild([str(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
                             environ={**worker_environment(), "RAPHAEL_LOCAL_COMMAND": command}, cwd=cwd or str(Path.home()), errors=errors)
        stdout = output if output is not None else Output()
        timed_out = False
        try:
            await child.start()
            child.process.stdin.close()
            async with asyncio.timeout(timeout_seconds):
                while chunk := await child.process.stdout.read(8192):
                    stdout.add(chunk)
                await child.process.wait()
                await child._stderr
        except TimeoutError:
            timed_out = True
        finally:
            await child.kill()
        return {"exit_code": child.process.returncode, "stdout": stdout.text(), "stderr": child.errors.text(),
                "truncated": stdout.truncated or child.errors.truncated, "timed_out": timed_out}
