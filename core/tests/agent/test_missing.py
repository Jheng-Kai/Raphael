"""Missing prerequisites stay specific through provider checks and persisted steps."""
import pytest

from raphael_core.failures import Missing, Failure, classify, missing_for
from raphael_core.agent.steps import reason_of
from raphael_core.brain.providers.registry import ProviderRegistry, ProviderRouter
from raphael_core.brain.secrets import MemoryKeyStore
from .test_service import Rig


def test_missing_survives_classification_without_raw_credentials():
    missing = Missing("searxng", "url", "missing", "search")
    failure = Failure("auth_expired", "synthetic", missing=missing)
    assert classify(failure.wire()).missing == missing
    assert "SearXNG" in failure.sentence("Search", "zh-TW")
    assert "網址" in failure.sentence("Search", "zh-TW")
    assert failure.wire()["missing"] == {"resource": "searxng", "requirement": "url", "state": "missing", "repair": "search"}


@pytest.mark.parametrize("kind", ["not_configured", "unavailable", "disabled", "encrypted", "bad_pdf", "no_text", "vision_unsupported"])
def test_steps_never_replace_a_known_cause_with_a_guess(kind):
    assert reason_of("error", kind) == kind


def test_unknown_is_not_a_missing_key():
    assert missing_for("unknown", "web_search", "tavily") is None
    assert missing_for("not_configured", "web_search", "searxng").requirement == "url"
    assert missing_for("disabled", "web_read").state == "off"


async def test_an_unavailable_provider_never_asks_for_an_openrouter_key(conn, actions):
    registry = ProviderRegistry(conn, object(), MemoryKeyStore(), credential=lambda _: MemoryKeyStore())
    registry.settings.set("agent_model", "@removed:chosen")
    rig = Rig(conn, ProviderRouter(registry, object()), actions)
    try:
        result = await rig.call("agent.ask", {"session_id": "missing", "text": "Hello", "ui_language": "zh-TW", "source": "app"})
        assert "OpenRouter" not in result["text"]
        assert "設定 › 模型與用量 › 模型" in result["text"]
        (turn,) = await rig.turns()
        assert turn["steps"][-1]["missing"] == Missing("removed", "provider", "missing", "models").wire()
    finally:
        await rig.aclose()

@pytest.mark.parametrize('reason,detail,requirement,repair', [
    ('no_text', 'pdf', 'no_text', 'vision'),
    ('encrypted', 'pdf', 'encrypted', None),
    ('bad_pdf', 'pdf', 'bad_pdf', None),
    (None, 'audio_ffmpeg', 'audio_ffmpeg', None),
    (None, 'audio_transcriber', 'audio_transcriber', None),
    ('provider_broken', 'chatgpt', 'provider', 'models'),
])
def test_repair_metadata_survives_a_stored_step(reason, detail, requirement, repair, conn):
    from raphael_core.agent.history import AgentHistory
    from raphael_core.agent.steps import Step
    from raphael_core.agent.service import _step_view
    history = AgentHistory(conn)
    tool = 'provider' if reason == 'provider_broken' else 'read_attachment'
    turn = history.add(session_id='prerequisite', question='Read', route='answer', source='app', scope='private', prefix='', text='', status='error')
    history.add_steps(turn, [Step('model' if tool == 'provider' else 'tool', tool, None, 'error' if reason else 'ok', 1, reason, detail=detail)])
    (step,) = history.steps([turn])[turn]
    missing = _step_view(step)['missing']
    assert missing['requirement'] == requirement and missing['repair'] == repair


def test_connection_cards_use_the_same_prerequisite_shape():
    from raphael_core.connectors.cards import _card_missing
    assert _card_missing('needs_composio_key') == Missing('composio', 'composio_key', 'missing', 'store')
    assert _card_missing('mcp_unavailable').repair is None
    assert _card_missing('timeout') is None
