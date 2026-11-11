"""Work handed off from a room is bounded, and a refused hand-off is not mended by a new code (owner, 2026-11-11: in a
meeting one member ran about 87 background tasks, and eight refused hand-offs were sent again under new stage codes)."""
import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.agent.speaker import RAPHAEL
from raphael_core.agent.team import HANDOFF_REFUSALS
from raphael_core.background.tasks import MAX_THREAD_HANDOFFS, MAX_TURN_HANDOFFS
from .test_handoff import args, setup


def speech(rig, source, name):
    """Another reply of the same room thread: its own snapshot, so its own bound."""
    return AgentHistory(rig.conn).add(session_id=name, question='Reply', route='room', source='room', prefix='', text='',
        status='running', member_id=source.member_id, scope='room', room_id=source.room_id, thread_id=source.thread_id)


def handoff(rig, target, source_id, number, **changes):
    return rig.service.handoff(RAPHAEL, args(target, stage_id=f'stage-{number}', request=f'Read part {number} of the file.',
                                            **changes), source_turn_id=source_id, language='en')


def test_the_refusal_tells_the_member_not_to_send_it_again_under_another_code():
    said = HANDOFF_REFUSALS['stage_conflict']
    assert 'Do not send it again under another stage_id' in said and 'use a new stage_id' not in said
    assert 'handoff_limit' in HANDOFF_REFUSALS


async def test_the_same_work_for_the_same_colleague_under_a_new_code_is_refused(make_rig, monkeypatch):
    rig = make_rig()
    target, source = setup(rig)
    monkeypatch.setattr(rig.service, '_ensure_pump', lambda: None)
    first = rig.service.handoff(RAPHAEL, args(target, stage_id='one'), source_turn_id=source.id, language='en')
    assert first.ok
    again = rig.service.handoff(RAPHAEL, args(target, stage_id='another-code'), source_turn_id=source.id, language='en')
    assert not again.ok and again.error == 'stage_conflict'
    assert 'Do not send it again' in again.instruction
    assert rig.conn.execute("SELECT COUNT(*) FROM worker_tasks WHERE mode='work'").fetchone()[0] == 1
    # Other work for the same colleague is not the same work.
    other = rig.service.handoff(RAPHAEL, args(target, stage_id='three', request='Write the summary.'), source_turn_id=source.id, language='en')
    assert other.ok


async def test_a_reply_hands_off_at_most_six_pieces(make_rig, monkeypatch):
    rig = make_rig()
    target, source = setup(rig)
    monkeypatch.setattr(rig.service, '_ensure_pump', lambda: None)
    results = [handoff(rig, target, source.id, number) for number in range(MAX_TURN_HANDOFFS + 2)]
    assert [result.ok for result in results] == [True] * MAX_TURN_HANDOFFS + [False, False]
    assert results[-1].error == 'handoff_limit' and 'Do not hand off more' in results[-1].instruction


async def test_a_room_thread_starts_at_most_twenty_four_until_the_owner_writes_again(make_rig, monkeypatch):
    rig = make_rig()
    target, source = setup(rig)
    monkeypatch.setattr(rig.service, '_ensure_pump', lambda: None)
    accepted = 0
    for number in range(MAX_THREAD_HANDOFFS + 3):
        # One reply never reaches its own bound here; the room's does.
        result = handoff(rig, target, _reply(rig, source, number), number)
        accepted += result.ok
    assert accepted == MAX_THREAD_HANDOFFS and result.error == 'handoff_limit'
    # The owner writes in the thread: the count starts again.
    with rig.conn:
        rig.conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created,request_id) VALUES (?,?,?,?,?)",
                         (source.room_id, source.thread_id, 'Carry on', rig.wall() + 10, 'owner-again'))
    later = handoff(rig, target, _reply(rig, source, 'later'), 'later')
    assert later.ok


def _reply(rig, source, name):
    return speech(rig, source, f'reply-{name}')


async def test_work_the_owner_asks_for_again_is_new_work(make_rig, monkeypatch):
    rig = make_rig()
    target, source = setup(rig)
    monkeypatch.setattr(rig.service, '_ensure_pump', lambda: None)
    assert rig.service.handoff(RAPHAEL, args(target, stage_id='one'), source_turn_id=source.id, language='en').ok
    with rig.conn:
        rig.conn.execute("INSERT INTO room_messages(room_id,thread_id,text,created,request_id) VALUES (?,?,?,?,?)",
                         (source.room_id, source.thread_id, 'Do it once more', rig.wall() + 10, 'owner-again'))
    assert rig.service.handoff(RAPHAEL, args(target, stage_id='two'), source_turn_id=source.id, language='en').ok
