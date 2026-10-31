"""A request that did not finish is part of the conversation: whichever brain answers next is shown the
owner's words, that the request ended without an answer, and what it had already done, so that
「try again」 and 「the thing we were just doing」 mean it. The brain that answers does not matter: the
record is Raphael's own.

These tests read what the models are sent (the prompt of an answer, of the tool-picking call and of a CLI
brain's turn), with fakes for the models, the CLI and the plugins' servers."""

from raphael_core.agent.steps import Step

from .conftest import tool_plan
from .test_plugins import plugins, rig, route  # noqa: F401  (fixtures of the plugins' tests)
from .test_service import make_rig, spoken  # noqa: F401  (make_rig is the fixture the rig uses)


def tool(name, server="Notes", outcome="ok"):
    return Step(kind="tool", tool=name, server=server, outcome=outcome, ms=7)


def fail(rig, question, *, steps=(), model=None, text="The reply took too long.", conversation_id=None):
    """A request that ended in an error, as the history keeps it."""
    return rig.history.add(
        session_id="failed", question=question, route="answer", prefix="否", text=text, status="error",
        model=model, steps=list(steps), conversation_id=conversation_id or rig.service.conversations.quick(),
    )  # fmt: skip


async def test_try_again_reaches_the_answer_and_the_tool_picking_with_the_request_that_failed(rig, plugins, client):
    await plugins.connect(look="T0", note="T1")
    rig.seed("Which pen is better for notes?", "The fine one.")
    fail(rig, "Collect every receipt into one folder", steps=[tool("look")] * 4 + [tool("note")] * 2)
    route(client)
    client.plans.append(tool_plan())
    client.replies.append(spoken("答", "好。"))
    await rig.ask("can you try that again?", language="en")
    for sent in (client.plan_calls[-1]["user"], client.json_calls[-1]["user"]):
        assert sent.index("Which pen is better") < sent.index("Collect every receipt")
        assert "did not finish" in sent
        assert "note (Notes) x2" in sent and "4 calls only read" in sent
        assert "Raphael: The reply took too long." not in sent  # the apology is not an answer
        assert sent.index("Collect every receipt") < sent.index("<question>")


async def test_a_failed_request_and_an_answer_of_other_brains_reach_the_cli_brain_that_resumes(
    make_rig, client, tmp_path, monkeypatch
):
    from raphael_core.agent.cli import loop as production
    from raphael_core.agent.cli.discovery import CliBrains
    from raphael_core.agent.cli.drivers import Event

    runs = []

    class Driver:
        def __init__(self, *args, **kwargs):
            pass

        async def run(self, **kwargs):
            runs.append(kwargs)
            yield Event("session", "native-2")
            yield Event("final", "Picking it up again.")

        async def interrupt(self):
            pass

    monkeypatch.setattr(production, "Driver", Driver)
    brains = CliBrains(home=tmp_path, environ={}, commands={"codex": ["never-spawn"]})
    monkeypatch.setattr(brains, "available", lambda *args, **kwargs: True)
    brains._models["codex"] = [{"id": "cli:codex:deep", "reasoning_efforts": ["high"]}]
    rig = make_rig(cli_brains=brains)
    formal = rig.service.conversations.main()
    model = "cli:codex:deep?effort=high"
    rig.settings.set("agent_model", model)
    # An answer from one brain, then a request that failed on another: the owner changed brains between them.
    rig.history.add(
        session_id="a", question="Which backup disk should I buy?", route="answer", prefix="答",
        text="Get the 2 TB one.", status="done", model="@chatgpt:gpt-6-sol", conversation_id=formal,
    )  # fmt: skip
    fail(rig, "Move every project note into the new workspace", model="cli:claude:sonnet?effort=high",
         steps=[tool("update-page", "Notion")] * 3 + [tool("fetch", "Notion")] * 6, conversation_id=formal)  # fmt: skip
    rig.service._cli_sessions.put(0, model, "native-1", formal)

    result = await rig.call("agent.ask", {
        "session_id": "c", "text": "can you try that again?", "ui_language": "en", "source": "app",
        "conversation_id": formal,
    })  # fmt: skip

    assert result["text"] == "Picking it up again."
    assert runs[0]["session"] == "native-1"  # the CLI's own thread was resumed, and still is told all of it
    sent = runs[0]["user"]
    assert sent.index("Which backup disk") < sent.index("Get the 2 TB one.") < sent.index("Move every project note")
    assert sent.index("Move every project note") < sent.index("<question>\ncan you try that again?")
    assert "did not finish" in sent and "update-page (Notion) x3" in sent
    assert "Raphael: The reply took too long." not in sent
    assert rig.service._cli_sessions.get(0, model, formal) == "native-2"
