"""Startup grace and phase telemetry never require a live model or owner database."""

import asyncio
import logging

import pytest

from raphael_core import app as app_module
from raphael_core.app import App


@pytest.mark.parametrize('close_first', [False, True])
async def test_hello_keeps_ingress_immediate_and_defers_maintenance(tmp_path, monkeypatch, close_first):
    assert app_module.STARTUP_GRACE_S == 8
    app = App(data_dir=tmp_path, fake_llm=True)
    monkeypatch.setattr(app_module, 'STARTUP_GRACE_S', 0.03)
    started, ready = [], asyncio.Event()
    for component, method, label in (
        (app.messaging, 'start', 'messaging'), (app.agent, 'start', 'agent'), (app.members, 'start_ingress', 'webhooks'),
        (app.vm, 'start_monitor', 'vm'), (app.agent, 'prewarm', 'prewarm'),
        (app.memory, 'start', 'memory'), (app.members, 'start', 'members'), (app.rooms, 'start', 'rooms'),
    ):
        def start(label=label):
            started.append(label)
            if label == 'rooms':
                ready.set()
        monkeypatch.setattr(component, method, start)
    try:
        await app.call('core.hello')
        handle = app._startup_handle
        assert started == ['messaging', 'agent', 'webhooks']
        assert handle is not None
        await app.call('core.hello')
        assert app._startup_handle is handle
        assert started == ['messaging', 'agent', 'webhooks'] * 2
        if close_first:
            await app.aclose()
            assert handle.cancelled() and app._startup_handle is None
            await asyncio.sleep(0.06)
            app._start_deferred()  # A callback already taken from the timer queue must also be harmless.
            await app.call('core.hello')
            assert started == ['messaging', 'agent', 'webhooks'] * 2
        else:
            await asyncio.wait_for(ready.wait(), 2)
            assert started == ['messaging', 'agent', 'webhooks'] * 2 + ['vm', 'prewarm', 'memory', 'members', 'rooms']
            await app.call('core.hello')
            assert app._startup_handle is None
            assert started.count('rooms') == 1
    finally:
        await app.aclose()


async def test_database_and_services_have_separate_startup_phases(tmp_path, caplog):
    with caplog.at_level(logging.INFO, logger=app_module.__name__):
        app = App(data_dir=tmp_path, fake_llm=True)
    try:
        phases = [record for record in caplog.records if record.msg.startswith('Startup phase=')]
        assert [record.msg.split()[1] for record in phases] == ['phase=database', 'phase=services']
        assert all(record.args[0] >= 0 for record in phases)
        assert str(tmp_path) not in '\n'.join(record.getMessage() for record in phases)
    finally:
        await app.aclose()


async def test_webhook_ingress_runs_without_scheduler_and_is_owned_by_shutdown(tmp_path, monkeypatch):
    app = App(data_dir=tmp_path, fake_llm=True)
    ready = asyncio.Event()
    async def sync():
        ready.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(app.members.webhooks, 'sync', sync)
    try:
        await app.call('core.hello')
        ingress = app.members._ingress_start
        await asyncio.wait_for(ready.wait(), 2)
        await app.call('core.hello')
        assert ingress is app.members._ingress_start
        assert app.members._ticking is None and app.members._event_poll_task is None
        await app.aclose()
        assert ingress.cancelled()
        assert app.members._ingress_start is None and app._startup_handle is None
    finally:
        await app.aclose()
