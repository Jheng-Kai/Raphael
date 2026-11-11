"""Shared-computer seat allocation and transaction contracts, without containers."""

import sqlite3

import pytest

from raphael_core.brain import db
from raphael_core.computer.seats import ComputerSeats, SeatsFull


@pytest.fixture(params=[False, True], ids=["memory", "database"])
def store(request, conn):
    now = [10.0]
    return ComputerSeats(conn if request.param else None, clock=lambda: now[0]), now


def snapshot(seats):
    return seats.rows.copy()


def assert_database_matches(seats, conn):
    actual = {(host, member): (seat, used) for host, member, seat, used in
              conn.execute("SELECT host, member_id, seat, used FROM computer_seats")}
    assert seats.rows == actual


def test_first_use_takes_the_lowest_free_seat_and_reading_never_assigns(store):
    seats, _ = store
    assert seats.seat("", 1) is None
    assert seats.holders("") == {}
    for member in range(1, 7):
        assert seats.take("", member) == (member, None)
        assert seats.seat("", member) == member
    assert seats.holders("") == {member: member for member in range(1, 7)}


def test_existing_holder_keeps_its_seat_and_take_updates_recency(store):
    seats, now = store
    seats.take("", 1)
    seats.take("", 2)
    now[0] = 20.0

    def never_called(member):
        pytest.fail("An existing holder must not be checked for eviction")

    assert seats.take("", 1, busy=never_called) == (1, None)
    assert seats.rows[("", 1)] == (1, 20.0)
    assert seats.holders("") == {1: 1, 2: 2}


def test_release_frees_only_that_seat_and_the_next_taker_reuses_the_lowest(store):
    seats, _ = store
    for member in range(1, 5):
        seats.take("", member)
    assert seats.release("", 2) == 2
    assert seats.release("", 4) == 4
    assert seats.release("", 99) is None
    assert seats.holders("") == {1: 1, 3: 3}
    assert seats.take("", 8) == (2, None)
    assert seats.take("", 9) == (4, None)


def fill(seats, now):
    for member in range(1, seats.count + 1):
        now[0] = float(member)
        seats.take("", member)


def test_seventh_member_displaces_the_least_recent_holder_and_gets_a_fresh_time(store):
    seats, now = store
    fill(seats, now)
    now[0] = 20.0
    seats.touch("", 1)
    now[0] = 30.0
    assert seats.take("", 7) == (2, 2)
    assert seats.seat("", 2) is None
    assert seats.rows[("", 7)] == (2, 30.0)
    assert seats.take("", 8) == (3, 3)


def test_busy_holders_are_skipped_in_least_recent_order(store):
    seats, now = store
    fill(seats, now)
    checked = []

    def busy(member):
        checked.append(member)
        return member in {1, 2, 4}

    assert seats.take("", 7, busy=busy) == (3, 3)
    assert checked == [1, 2, 3]
    assert seats.seat("", 1) == 1
    assert seats.seat("", 2) == 2


def test_all_busy_raises_without_changing_seats_or_used_times(store):
    seats, now = store
    fill(seats, now)
    before = snapshot(seats)
    now[0] = 100.0
    with pytest.raises(SeatsFull):
        seats.take("", 7, busy=lambda member: True)
    assert snapshot(seats) == before
    if seats.conn is not None:
        assert_database_matches(seats, seats.conn)


def test_a_failed_busy_callback_changes_nothing(store):
    seats, now = store
    fill(seats, now)
    before = snapshot(seats)

    def broken(member):
        raise RuntimeError("Busy lookup failed")

    with pytest.raises(RuntimeError, match="Busy lookup failed"):
        seats.take("", 7, busy=broken)
    assert snapshot(seats) == before


def test_equal_used_times_evict_the_lowest_seat(store):
    seats, _ = store
    for member in (8, 3, 9, 2, 7, 1):
        seats.take("", member)
    assert seats.take("", 10) == (1, 8)


def test_hosts_are_independent_and_the_chief_uses_an_ordinary_seat(store):
    seats, now = store
    assert seats.take("", 8) == (1, None)
    assert seats.take("", 0) == (2, None)
    assert seats.take("remote", 0) == (1, None)
    now[0] = 40.0
    seats.touch("remote", 0)
    assert seats.rows[("", 0)][1] == 10.0
    assert seats.rows[("remote", 0)][1] == 40.0
    assert seats.release("remote", 0) == 1
    assert seats.seat("", 0) == 2
    for member in range(1, 5):
        seats.take("", member)
    assert seats.take("", 10) == (1, 8)
    assert seats.take("", 11) == (2, 0)


def test_forget_clears_only_its_host_and_holders_is_a_snapshot(store):
    seats, _ = store
    seats.take("", 1)
    seats.take("", 2)
    seats.take("remote", 1)
    seats.holders("").clear()
    assert seats.holders("") == {1: 1, 2: 2}
    seats.forget("")
    seats.forget("unknown")
    assert seats.holders("") == {}
    assert seats.holders("remote") == {1: 1}
    assert seats.take("", 9) == (1, None)


def test_touch_of_an_unknown_member_never_assigns(store):
    seats, _ = store
    seats.touch("", 0)
    assert seats.holders("") == {}


@pytest.mark.parametrize("count", [1, 2, 4, 8])
@pytest.mark.parametrize("persistent", [False, True], ids=["memory", "database"])
def test_configurable_count_controls_capacity(conn, count, persistent):
    seats = ComputerSeats(conn if persistent else None, count=count, clock=lambda: 1.0)
    for member in range(count):
        assert seats.take("", member) == (member + 1, None)
    with pytest.raises(SeatsFull):
        seats.take("", 100, busy=lambda member: True)
    assert seats.take("", 100) == (1, 0)


@pytest.mark.parametrize("count", [0, -1, 1.5, True, "6"])
def test_count_must_be_a_positive_integer(count):
    with pytest.raises(ValueError, match="positive integer"):
        ComputerSeats(count=count)


def test_restart_preserves_every_host_seat_and_timestamp(conn):
    seats = ComputerSeats(conn, clock=lambda: 7.0)
    for host in ("", "remote"):
        for member in (0, 8, 3):
            seats.take(host, member)
    restarted = ComputerSeats(conn, clock=lambda: 12.0)
    assert restarted.rows == seats.rows
    restarted.touch("", 8)
    assert ComputerSeats(conn).rows[("", 8)] == (2, 12.0)
    assert restarted.release("", 0) == 1
    restarted.forget("remote")
    assert ComputerSeats(conn).holders("") == {2: 8, 3: 3}
    assert ComputerSeats(conn).holders("remote") == {}
    assert not conn.in_transaction


def test_committed_seats_survive_closing_and_reopening_the_database(tmp_path):
    path = tmp_path / "seats.db"
    conn = db.connect(path)
    try:
        seats = ComputerSeats(conn, clock=lambda: 8.0)
        seats.take("", 0)
        seats.take("remote", 4)
    finally:
        conn.close()
    reopened = db.connect(path)
    try:
        assert ComputerSeats(reopened).rows == {("", 0): (1, 8.0), ("remote", 4): (1, 8.0)}
    finally:
        reopened.close()


def test_a_second_store_claiming_a_seat_leaves_memory_equal_to_the_table_on_conflict(conn):
    first, second = ComputerSeats(conn), ComputerSeats(conn)
    assert second.take("", 2) == (1, None)
    with pytest.raises(sqlite3.IntegrityError):
        first.take("", 1)
    assert_database_matches(first, conn)
    assert first.holders("") == {1: 2}
    assert not conn.in_transaction
    assert first.take("", 1) == (2, None)


def test_a_conflicting_eviction_rolls_back_its_delete_before_reloading(conn):
    first = ComputerSeats(conn, count=2, clock=lambda: 1.0)
    first.take("", 1)
    first.take("", 2)
    second = ComputerSeats(conn, count=2)
    second.release("", 1)
    second.release("", 2)
    second.take("", 2)
    second.take("", 3)
    # The stale first store deletes member 2, then finds member 3 in its chosen seat.
    # That delete must roll back, even though it succeeded before the insert failed.
    with pytest.raises(sqlite3.IntegrityError):
        first.take("", 4, busy=lambda member: member == 1)
    assert_database_matches(first, conn)
    assert first.holders("") == {1: 2, 2: 3}
    assert not conn.in_transaction


def test_database_constraints_keep_member_and_seat_unique_per_host_without_a_foreign_key(conn):
    assert list(conn.execute("PRAGMA foreign_key_list(computer_seats)")) == []
    with conn:
        conn.execute("INSERT INTO computer_seats VALUES ('', 0, 1, 1.0)")
        conn.execute("INSERT INTO computer_seats VALUES ('remote', 0, 1, 1.0)")
    for values in (("", 0, 2, 1.0), ("", 8, 1, 1.0), (None, 8, 2, 1.0), ("", 8, 2, None)):
        with pytest.raises(sqlite3.IntegrityError), conn:
            conn.execute("INSERT INTO computer_seats VALUES (?, ?, ?, ?)", values)
    assert_database_matches(ComputerSeats(conn), conn)
