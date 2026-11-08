"""Public recipe authors use the existing selected-brain adapters and immutable gate."""

import json

import pytest

from test_chat_setup_share import rig, public_recipe  # noqa: F401
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.ledger import Ledger
from raphael_core.brain.openrouter import TextCompletion
from raphael_core.brain.providers.chatgpt import ChatGPTProvider
from raphael_core.members.template_author import public_findings
from raphael_core.protocol import RpcError
from raphael_core.worker.loop import Outcome


@pytest.mark.parametrize("reference", ["cli:codex:chosen?effort=high", "cli:claude:chosen", "cli:gemini:chosen", "@chatgpt:gpt-6-luna?effort=high"])
async def test_subscription_author_uses_the_member_brain_and_records_once(rig, monkeypatch, reference):
    service = rig.team.members
    service.store.update_member(rig.member.id, model=reference)
    turn = service._history.add(session_id="share", question="Share", route="answer", prefix="", text="", status="running", member_id=rig.member.id)
    ledger = Ledger(rig.team.memory._spend)
    rig.team.memory._cli_brains = object()
    calls = []
    async def answer(loop):
        assert loop.model == reference and loop.ledger is ledger
        assert loop.tools == [] and loop.no_tools and loop.structured
        assert not loop.resume_session and loop.rate_limit_waits == ()
        calls.append(loop.model)
        loop.ledger.add(model=loop.model, cost_usd=0, prompt_tokens=12, completion_tokens=6, billing_source="subscription")
        loop._queue.put_nowait(Outcome("done", final=json.dumps(public_recipe())))
    monkeypatch.setattr(CliLoop, "_work", answer)
    provider = ChatGPTProvider(None)
    async def chat(**kwargs):
        calls.append(kwargs["model"])
        return TextCompletion(json.dumps(public_recipe()), kwargs["model"], 0, 12, 6, 1, [])
    monkeypatch.setattr(provider, "chat_text", chat)
    rig.team.memory._base_client = provider
    card = await service.template_cards.show(turn, rig.member.id, "Share", ledger=ledger)
    assert calls == [reference] and len(ledger.calls) == 1
    assert ledger.calls[0]["billing_source"] == "subscription" and ledger.calls[0]["cost_usd"] is None
    assert ledger.calls[0]["tokens"] == 18
    assert not (await service.template_cards.review({"id": card["id"]}))["findings"]


@pytest.mark.parametrize("text", ["owner@private.example", "account_id: ACCOUNT-123", "C:\\Users\\Owner\\private.txt", "https://localhost/private"])
def test_gate_reasons_never_contain_the_matched_private_identifier(text):
    assert public_findings(public_recipe(instructions=text)) == [{"kind": "secret", "path": "template.instructions"}]


def test_public_documentation_links_are_not_private_addresses():
    assert public_findings(public_recipe(instructions="Check https://docs.example.org/guide for public documentation.")) == []


async def test_private_second_draft_is_blocked_with_the_existing_card_reason(rig):
    from agent.conftest import completion
    service = rig.team.members
    turn = service._history.add(session_id="share", question="Share", route="answer", prefix="", text="", status="running", member_id=rig.member.id)
    rig.brain.replies = [completion(public_recipe(instructions="Email owner@private.example")) for _ in range(2)]
    card = await service.template_cards.show(turn, rig.member.id, "Share")
    assert len(rig.brain.json_calls) == 2
    assert (await service.template_cards.review({"id": card["id"]}))["findings"] == [{"kind": "secret", "path": "template.instructions"}]
    with pytest.raises(RpcError):
        await service.template_cards.publish({"id": card["id"]})
    with pytest.raises(RpcError):
        await service.template_cards.save({"id": card["id"]})
