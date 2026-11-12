"""The computers the app made, and what a deleted member's leaves behind.

(owner, 2026-11-11: 「理論上不會問這個問題，應該是知道他可能有這個東西，會自動刪掉；如果還沒開起就不用顯示」)
Deleting a member never asks about its computer and never waits for it. The member goes first; if it had a computer,
that is written down as owed, and removed afterwards in the background, as soon as its engine can be reached and no
sooner: an engine is never started to delete data, and a failure is neither shown nor allowed to touch the deletion.

`computer_data` (migration 80) keeps, by host ("" is this PC, else the SSH alias) and target key, the computers this
app made, and which of them are owed. The table has no tie to the members: it outlives them by design.
"""

import asyncio
import logging
import os

from .vm import VmError

logger = logging.getLogger(__name__)

# How many failed tries a removal gets from the timer before only an engine coming back retries it.
RETRY_LIMIT = 6
# The least time between two tries at a host that does not answer.
RETRY_AFTER_S = 600.0
# The longest the engine may take to say whether it is there, and one computer to be removed. Every Docker call in
# the pass has its own limit besides; these bound the whole step, the tunnel to a host included.
PROBE_S = 20.0
ERASE_S = 120.0
# A removal that did not fail, only had to wait (the computer is in use, the engine went away): not a failed try.
WAITS = ("busy", "unavailable")


class ComputerData:
    def __init__(self, vm, conn=None):
        self.vm, self.conn = vm, conn
        self.rows: dict[tuple[str, str], list[int]] = {}  # (host, key) -> [owed, attempts]
        if conn is not None:
            for host, key, owed, attempts in conn.execute("SELECT host, key, owed, attempts FROM computer_data"):
                self.rows[(host, key)] = [owed, attempts]
        self.task: asyncio.Task | None = None
        self.settling = False
        self.again = False
        self.tried: dict[str, float] = {}
        self.answering: set[str] = set()

    # --- the record ---------------------------------------------------------------------------------

    def made(self, target) -> None:
        """A computer is about to exist on `target.remote`. The shared one is never recorded: no member's deletion owes it."""
        ident = (target.remote or "", target.key)
        if target.container == "shared" or target.unit == "shared" or ident in self.rows:
            return
        self.rows[ident] = [0, 0]
        self._write(ident, commit=True)

    def claim(self, member_id: int) -> list[tuple[str, str]]:
        """The computers `member_id` has (this PC's folder, or a host the app made one on), read before the member goes.
        Nothing is contacted: a member with none yields nothing, and nothing is owed."""
        vm = self.vm
        found = []
        for host in sorted({"", vm.remote or "", *(host for host, _ in self.rows)}):
            key = vm.key_for(host, member_id)
            if (host, key) in self.rows or (not host and os.path.lexists(vm.target_for("", key).workspace)):
                found.append((host, key))
        return found

    def owe(self, claims) -> None:
        """Write the claims as owed. It does not commit: the caller's transaction deletes the member in the same one."""
        for ident in claims:
            self.rows[ident] = [1, 0]
            self._write(ident, commit=False)

    def has_owed(self, host: str | None = None) -> bool:
        return any(owed and (host is None or key[0] == host) for key, (owed, _) in self.rows.items())

    def _write(self, ident, *, commit: bool) -> None:
        if self.conn is None:
            return
        owed, attempts = self.rows[ident]
        sql = ("INSERT INTO computer_data(host, key, owed, attempts) VALUES (?, ?, ?, ?) "
               "ON CONFLICT(host, key) DO UPDATE SET owed=excluded.owed, attempts=excluded.attempts")
        if commit:
            with self.conn:
                self.conn.execute(sql, (*ident, owed, attempts))
        else:
            self.conn.execute(sql, (*ident, owed, attempts))

    def _settled(self, ident) -> None:
        self.rows.pop(ident, None)
        if self.conn is not None:
            with self.conn:
                self.conn.execute("DELETE FROM computer_data WHERE host=? AND key=?", ident)

    def _failed(self, ident, error) -> None:
        row = self.rows.get(ident)
        if row is None:
            return
        row[1] += 1
        self._write(ident, commit=True)
        # A VmError names a fixed public kind; nothing else is logged of the failure.
        logger.warning("A deleted member's computer data could not be removed yet (%s, try %d)",
                       error if isinstance(error, str) else str(error) if isinstance(error, VmError) else type(error).__name__, row[1])
        if row[1] == RETRY_LIMIT:
            logger.warning("A deleted member's computer data is left for when its engine comes back")

    # --- the removal --------------------------------------------------------------------------------

    def settle_soon(self, up: str | None = None) -> None:
        """Start a pass in the background if something is owed. Never waits, never raises."""
        if self.settling:
            self.again = True
            return
        if not self.has_owed() or (self.task is not None and not self.task.done()):
            return
        try:
            self.task = asyncio.get_running_loop().create_task(self.settle(up))
        except RuntimeError:
            return

    def engine_up(self, host: str | None) -> None:
        """An engine has answered. The first answer after it was away gets what it is owed, whatever failed before."""
        host = host or ""
        if host in self.answering:
            return
        self.answering.add(host)
        if not self.settling and self.has_owed(host):
            self.settle_soon(host)

    def engine_down(self, host: str | None) -> None:
        self.answering.discard(host or "")

    async def settle(self, up: str | None = None) -> None:
        """One pass over everything owed. A host whose engine does not answer is skipped and tried again later."""
        if self.settling:
            self.again = True
            return
        if not self.vm.enabled:
            return
        self.settling = True
        try:
            while True:
                self.again = False
                for host in sorted({key[0] for key, (owed, _) in self.rows.items() if owed}):
                    await self._settle_host(host, reached=host == up)
                if not self.again:
                    break
        except asyncio.CancelledError:
            raise
        except Exception as error:  # the deletion is long done; nothing here may surface
            logger.warning("Removing a deleted member's computer data stopped (%s)", type(error).__name__)
        finally:
            self.settling = False

    async def _settle_host(self, host: str, *, reached: bool) -> None:
        vm = self.vm
        keys = [key for (h, key), (owed, attempts) in sorted(self.rows.items()) if h == host and owed and (reached or attempts < RETRY_LIMIT)]
        if not keys:
            return
        now = vm.clock()
        if host and not reached and now - self.tried.get(host, float("-inf")) < RETRY_AFTER_S:
            return
        self.tried[host] = now
        try:
            async with asyncio.timeout(PROBE_S):
                engine = reached or await vm.available(vm.target_for(host, keys[0]))
        except TimeoutError:
            engine = False
        if not engine:
            if host:
                for key in keys:
                    self._failed((host, key), "host_unreachable")
                return
            if await vm.local_installed():
                return  # Docker Desktop is there but not running: wait for it, and never start it for this
            # Not installed: no container can exist, so only the folder remains.
        for key in keys:
            ident = (host, key)
            try:
                async with asyncio.timeout(ERASE_S):
                    await vm.erase(vm.target_for(host, key), engine=engine)
            except Exception as error:
                if not (isinstance(error, VmError) and str(error) in WAITS):
                    self._failed(ident, error)
            else:
                self._settled(ident)

    async def aclose(self) -> None:
        if self.task is not None:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
