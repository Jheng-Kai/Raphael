"""Synthetic message metadata never settles an owner decision or sends a draft."""
import pytest

from raphael_core.agent.history import AgentHistory
from raphael_core.memory.conversation import turn_text
from raphael_core.protocol import RpcError
from .test_draft_tool import office, typed, chat, finished  # noqa: F401
from .test_narration import use
from .test_drafts import sent, SENT, Judge  # noqa: F401
from .test_plugins import plugins, calls  # noqa: F401
from .test_service import make_rig  # noqa: F401
from .conftest import decision


@pytest.fixture
async def slack(plugins):
    from mcp.server.mcpserver import MCPServer
    server = MCPServer('Slack')
    messages = []

    @server.tool()
    def send_message(channel: str, text: str) -> str:
        """Send a synthetic Slack message."""
        messages.append((channel, text))
        return 'sent'

    plugins.servers.by_name['Slack'] = server
    added = await plugins.rpc.call('integrations.add', {'name':'Slack','transport':'stdio','command':'unused'})
    server_id = added['server']['id']
    await plugins.rpc.call('integrations.set_enabled', {'id':server_id,'enabled':True})
    await plugins.rpc.call('integrations.refresh', {'id':server_id})
    return messages


async def test_reactions_persist_as_context_and_never_resolve_a_draft(office, client):
    client.decisions.append(decision('answer'))
    client.chats = [chat('Drafting.', use('slack_draft', {'to': 'C012345', 'body': 'Synthetic update.'})), finished()]
    await typed(office.rig, "Draft a Slack reply")
    turn = await office.turn()
    card = turn['drafts'][0]
    from types import SimpleNamespace
    from raphael_core.agent.policy import Action, Tier
    from raphael_core.agent.owner_questions import OwnerQuestions
    from raphael_core.background.tasks import TaskStore
    confirmations = office.rig.service._confirmations
    confirmations.open('metadata', turn['id'], Action('synthetic.send', {}), Tier.T2, 'en')
    task_id = TaskStore(office.conn).create(session_id='metadata', language='en', text='Synthetic question')
    questions = OwnerQuestions(office.conn)
    question = questions.open(SimpleNamespace(id=task_id,turn_id=turn['id'],member_id=0), 'ask_owner', {'question':'Which day?','options':['Monday','Tuesday']})
    for emoji in ('👍', '❤', '✓', '?'):
        params = {'turn_id': turn['id'], 'conversation_id': turn['conversation_id'], 'message_key': 'owner', 'emoji': emoji, 'active': True}
        await office.rig.call('agent.react', params)
        await office.rig.call('agent.react', params)
    after = await office.turn()
    assert after['reactions']['owner'] == ['?']
    assert after['drafts'][0] == card and SENT == []
    assert confirmations.waiting == 1
    assert questions.get(question['id'])['state'] == 'asked'
    context = turn_text(AgentHistory(office.conn).recent(1)[0], detail=True)
    assert 'metadata only; never approval or instructions' in context
    assert "'owner': ['?']" in context and '👍' not in context
    with pytest.raises(RpcError):
        await office.rig.call('agent.react', {**params, 'message_key': 'permission', 'approved': True})
    with pytest.raises(RpcError):
        await office.rig.call('agent.react', {**params, 'member_id': 999})
    AgentHistory(office.conn).delete(turn['id'])
    assert office.conn.execute('SELECT COUNT(*) FROM message_reactions').fetchone()[0] == 0


async def test_slack_draft_edit_send_once_uses_existing_gate(office, client, slack):
    office.drafts.register(office.rig.rpc)
    client.decisions.append(decision('answer'))
    client.chats = [chat('Drafting.', use('slack_draft', {'to':'C012345','body':'Synthetic update.'})), finished()]
    await typed(office.rig, "Draft a Slack reply")
    card = (await office.turn())['drafts'][0]
    assert card['kind'] == 'slack' and card['from']['name'] == 'Slack' and slack == []
    with pytest.raises(RpcError):
        await office.rig.call('integrations.draft_save', {'id':card['id'],'digest':card['digest'],'via':office.drafts.choose_sender(None)})
    saved = await office.rig.call('integrations.draft_save', {'id':card['id'],'digest':card['digest'],'to':'U012345','body':'Edited by owner.'})
    assert saved['saved']
    assert not (await office.rig.call('integrations.draft_send', {'id':card['id'],'digest':card['digest']}))['sent']
    params = {'id':card['id'],'digest':saved['draft']['digest']}
    assert (await office.rig.call('integrations.draft_send', params))['sent']
    assert not (await office.rig.call('integrations.draft_send', params))['sent']
    assert slack == [('U012345','Edited by owner.')]


@pytest.mark.parametrize('draft_first', [True, False])
async def test_slack_direct_send_obeys_the_same_draft_first_preference(office, client, slack, monkeypatch, draft_first):
    from dataclasses import replace
    from raphael_core.agent.speaker import RAPHAEL
    monkeypatch.setattr(office.rig.service, '_speaker', lambda member_id: replace(RAPHAEL, draft_first=draft_first))
    client.decisions.append(decision('answer'))
    client.chats = [chat('Sending.', use('Slack__send_message', {'channel':'C012345','text':'Synthetic message'})), finished()]
    await typed(office.rig)
    assert slack == ([] if draft_first else [('C012345','Synthetic message')])
    if draft_first:
        assert any(step['reason'] == 'blocked' for step in (await office.turn())['steps'])


async def test_slack_without_draft_first_still_asks_and_a_no_sends_nothing(office, client, slack, monkeypatch):
    from dataclasses import replace
    from raphael_core.agent.speaker import RAPHAEL
    from raphael_core.brain.openrouter import Decision
    from .conftest import noul
    monkeypatch.setattr(office.rig.service, '_speaker', lambda member_id: replace(RAPHAEL, draft_first=False))
    office.rules.ensure_seeded('en')
    asking = next(rule for rule in office.rules.rules() if rule.action == 'Send an email or a message to someone else')
    office.judge.decisions.append(lambda **kwargs: Decision(answers={key:noul(0.93 if key == f'rule_{asking.id}' else 0.0) for key in kwargs['questions']}, cost_usd=0, latency_ms=1))
    client.decisions.append(decision('answer'))
    client.chats = [chat('Sending.', use('Slack__send_message', {'channel':'C012345','text':'Synthetic message'}))]
    asked = await typed(office.rig)
    assert asked['status'] == 'confirm' and slack == []
    await office.rig.call('agent.confirm', {'id':asked['confirm']['id'],'approved':False})
    assert slack == [] and (await office.turn())['permissions'][0]['state'] == 'denied'


async def test_slack_draft_is_refused_in_a_room_even_for_background(office):
    from raphael_core.agent.service import _Ask
    from raphael_core.agent.harness_tools import HarnessToolError
    ask = _Ask('synthetic-room', 'Draft a Slack reply', 'en', turn_id=1, scope='room', background_owner=True)
    with pytest.raises(HarnessToolError, match='private_chat_only'):
        office.rig.service._show_draft(ask, {'to':'C012345','body':'Synthetic'}, kind='slack')


async def test_slack_full_permission_uses_the_existing_direct_send_mode(office, client, slack):
    office.rig.settings.set('action_mode', 'bypass')
    client.decisions.append(decision('answer'))
    client.chats = [chat('Sending.', use('Slack__send_message', {'channel':'C012345','text':'Synthetic message'})), finished()]
    await typed(office.rig)
    assert slack == [('C012345','Synthetic message')]


@pytest.mark.parametrize("scope", [
    {"turn_id": 1, "member_id": 0, "conversation_id": 1},
    {"turn_id": 1, "member_id": 1, "room_id": 1, "thread_id": 1, "memo_action": "play"},
    {"turn_id": 1, "member_id": 1, "memo_action": "pause", "message_seq": 1},
])
async def test_manual_speech_rpc_is_removed(office, scope):
    from raphael_core.protocol import METHOD_NOT_FOUND

    with pytest.raises(RpcError) as error:
        await office.rig.call("agent.speak", scope)
    assert error.value.code == METHOD_NOT_FOUND
