"""Persistent first-use seats for the shared computer on each host.

This store is synchronous: a seat changes hands before the caller can yield. The
caller is responsible for closing the displaced member's windows.
"""

import sqlite3
import time


class SeatsFull(Exception):
    """Every seat on this host belongs to a busy member."""


class ComputerSeats:
    def __init__(self, conn=None, *, count=6, clock=time.time):
        if type(count) is not int or count < 1:
            raise ValueError("Seat count must be a positive integer")
        self.conn, self.count, self.clock = conn, count, clock
        self.rows: dict[tuple[str, int], tuple[int, float]] = {}
        self._load()

    def _load(self):
        if self.conn is not None:
            self.rows = {(host, member): (seat, used) for host, member, seat, used in
                         self.conn.execute("SELECT host, member_id, seat, used FROM computer_seats")}

    def _write(self, rows, statements):
        if self.conn is None:
            self.rows = rows
            return
        try:
            with self.conn:
                for sql, params in statements:
                    self.conn.execute(sql, params)
        except sqlite3.Error:
            # Another store may have claimed a seat since this snapshot was loaded.
            # Rollback precedes reload, including any deletion made for eviction.
            self._load()
            raise
        self._load()

    def seat(self, host, member_id):
        row = self.rows.get((host, member_id))
        return row[0] if row is not None else None

    def take(self, host, member_id, *, busy=lambda member_id: False):
        ident = (host, member_id)
        number = self.seat(host, member_id)
        displaced = None
        if number is None:
            occupied = self.holders(host)
            number = next((seat for seat in range(1, self.count + 1) if seat not in occupied), None)
            if number is None:
                candidates = sorted((used, seat, member) for (h, member), (seat, used) in self.rows.items() if h == host)
                victim = next(((seat, member) for _, seat, member in candidates if not busy(member)), None)
                if victim is None:
                    raise SeatsFull("Every seat on this host is busy")
                number, displaced = victim
        used = self.clock()
        rows = self.rows.copy()
        statements = []
        if displaced is not None:
            del rows[(host, displaced)]
            statements.append(("DELETE FROM computer_seats WHERE host=? AND member_id=?", (host, displaced)))
        rows[ident] = (number, used)
        statements.append(("INSERT INTO computer_seats(host, member_id, seat, used) VALUES (?, ?, ?, ?) "
                           "ON CONFLICT(host, member_id) DO UPDATE SET seat=excluded.seat, used=excluded.used",
                           (host, member_id, number, used)))
        self._write(rows, statements)
        return number, displaced

    def touch(self, host, member_id):
        ident = (host, member_id)
        if ident not in self.rows:
            return
        used = self.clock()
        rows = self.rows.copy()
        rows[ident] = (rows[ident][0], used)
        self._write(rows, [("UPDATE computer_seats SET used=? WHERE host=? AND member_id=?", (used, host, member_id))])

    def release(self, host, member_id):
        rows = self.rows.copy()
        row = rows.pop((host, member_id), None)
        self._write(rows, [("DELETE FROM computer_seats WHERE host=? AND member_id=?", (host, member_id))])
        return row[0] if row is not None else None

    def holders(self, host):
        return {seat: member for (h, member), (seat, _) in self.rows.items() if h == host}

    def forget(self, host):
        rows = {ident: row for ident, row in self.rows.items() if ident[0] != host}
        self._write(rows, [("DELETE FROM computer_seats WHERE host=?", (host,))])
