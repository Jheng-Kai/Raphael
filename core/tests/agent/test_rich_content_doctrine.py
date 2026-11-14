"""Rich reply guidance reaches every production brain without changing tool safety."""
import pytest

from raphael_core.agent.persona import cli_system_prompt, member_system_prompt, system_prompt
from raphael_core.agent.self_check import DOCTRINE


@pytest.mark.parametrize("language", ["zh-TW", "en", "ja"])
def test_rich_reply_doctrine_is_shared_and_retains_command_permissions(language):
    assert "Markdown tables, fenced code and Mermaid" in DOCTRINE
    assert "short sentence" in DOCTRINE
    assert "tool permission flow" in DOCTRINE
    assert "external messaging remain plain text" in DOCTRINE
    for prompt in (
        system_prompt("answer"),
        member_system_prompt("answer", name="Peer", role="Research", instructions=""),
        cli_system_prompt(),
    ):
        assert DOCTRINE in prompt
