"""An empty conversation of Raphael's begins its guided tour: its own welcome and one question card, and the owner's
answer goes on with the tour in a turn of its own. Fake brains only, as the new member's set-up chain is tested
(test_setup_chain.py)."""
import json

import pytest

from agent.test_narration import chat
from background.conftest import plugins, until  # noqa: F401
from raphael_core.agent.persona import TOUR, TOUR_ANSWER, greeting_prompt
from raphael_core.agent.speaker import RAPHAEL, Speaker
from raphael_core.protocol import INVALID_PARAMS, RpcError
from .test_answering import client, live_said  # noqa: F401
from .test_setup_chain import answer, chain, offered  # noqa: F401

WELCOME = "Welcome. The slimes do the everyday work; I guide and keep the app."
CARD = {"question": "What would you like to do first?", "options": ["Make my first slime", "Connect an app", "See dictation and usage", "Look at settings"],
        "free_text": True}


async def tour(rig, client, *, language="en", line=WELCOME, card=CARD):
    client.chats.append(chat(line, ("ask_owner", card)))
    started = await rig.call("members.greet", {"id": 0, "ui_language": language})
    await until(lambda: rig.history.get(started["turn_id"]).status != "running")
    return started["turn_id"], (await rig.turns(member_id=0))[0]


async def test_an_empty_raphael_conversation_begins_the_tour_with_its_own_welcome_and_one_card(chain, client):
    rig = chain
    turn_id, turn = await tour(rig, client)
    assert (turn["id"], turn["route"], turn["source"], turn["status"], turn["question"], turn["text"]) == (
        turn_id, "greeting", "greeting", "done", "", WELCOME)
    assert turn["conversation_id"] == rig.service.conversations.main(0)
    [question] = turn["owner_questions"]
    assert (question["kind"], question["state"], question["question"], question["options"], question["free_text"]) == (
        "ask_owner", "asked", CARD["question"], CARD["options"], True)
    assert offered(client.chat_calls[0]) == ["ask_owner"]
    system = client.chat_calls[0]["messages"][0]["content"]
    assert TOUR in system and "<persona>" in system and "the app's own slime" in system
    assert "<new_member" not in system and "newly created assistant" not in system


async def test_the_tour_is_told_where_the_owner_stands_and_speaks_in_the_owners_language_never_the_windows(chain, client):
    rig = chain
    rig.team.members.store.create_member(name="Calendar", role="Manage appointments")
    rig.team.members._connections = lambda: [{"name": "Gmail", "enabled": True, "state": "ready"},
                                             {"name": "Offline", "enabled": True, "state": "unreadable"}]
    rig.settings.set("owner_about", "I run the Filia project")
    rig.settings.set("languages", ["ja-JP", "en-US"])
    await tour(rig, client, language="fr")
    system = client.chat_calls[0]["messages"][0]["content"]
    for known in ("Manage appointments", "Gmail", "Filia", "<languages_spoken>", '["ja-JP", "en-US"]'):
        assert known in system
    assert "Offline" not in system
    assert "never the window's" in system and "The interface language never selects" in system
    assert "fr" not in json.dumps(client.chat_calls[0]["messages"][1:])  # the window's language reaches no model


async def test_a_tour_whose_welcome_is_missing_is_sent_back_for_it(chain, client):
    rig = chain
    client.chats.append(chat("", ("ask_owner", CARD)))
    client.chats.append(chat(WELCOME, ("ask_owner", CARD)))
    started = await rig.call("members.greet", {"id": 0})
    await until(lambda: rig.history.get(started["turn_id"]).status == "done")
    [saved] = await rig.turns(member_id=0)
    assert saved["text"] == WELCOME
    sent_back = [m["content"] for m in client.chat_calls[1]["messages"] if m["role"] == "tool"]
    assert len(sent_back) == 1 and "Your welcome is missing" in sent_back[0] and "greeting" not in sent_back[0]


async def test_a_conversation_with_an_owner_message_in_it_begins_no_tour(chain, client):
    rig = chain
    client.chats.append(live_said("Noted."))
    await rig.call("agent.ask", {"session_id": "typed", "text": "hello", "ui_language": "en", "source": "app", "member_id": 0})
    with pytest.raises(RpcError) as refused:
        await rig.call("members.greet", {"id": 0})
    assert refused.value.code == INVALID_PARAMS
    assert not rig.conn.execute("SELECT 1 FROM agent_turns WHERE source='greeting'").fetchone()


async def test_a_slime_is_greeted_as_a_new_member_and_raphael_is_not(chain, client):
    new_prompt = greeting_prompt(Speaker(id=5, name="Mia", role="Researcher"))
    assert "newly created assistant" in new_prompt and TOUR not in new_prompt
    assert greeting_prompt(RAPHAEL).startswith(TOUR)


async def test_the_owners_pick_goes_on_with_the_tour_in_a_turn_of_raphaels_own(chain, client):
    rig = chain
    turn_id, turn = await tour(rig, client)
    [question] = turn["owner_questions"]
    client.chats.append(chat("The first slime is a colleague who does one kind of work for you. I can make one now; say its job."))
    await answer(rig, question, "Make my first slime")
    await until(lambda: any(item["session_id"].startswith("setup-") for item in rig.conn.execute("SELECT session_id FROM agent_turns WHERE member_id=0")))
    await until(lambda: rig.history.get(next(t["id"] for t in rig.conn.execute("SELECT id, session_id FROM agent_turns WHERE member_id=0")
                                             if t["session_id"].startswith("setup-"))).status == "done")
    turns = await rig.turns(member_id=0)
    follow = next(item for item in turns if item["session_id"].startswith("setup-"))
    assert (follow["source"], follow["question"], follow["conversation_id"]) == ("app", "Make my first slime", turn["conversation_id"])
    assert follow["text"].startswith("The first slime")
    # The turn that goes on reads the tour's words, never a new member's set-up (a job to save), and Raphael still has no job to save.
    prompt = json.dumps(client.chat_calls[-1]["messages"], ensure_ascii=False)
    assert "<tour>" in prompt and TOUR_ANSWER.split("{question}")[0].strip() in prompt
    assert CARD["question"] in prompt
    assert "<new_member_setup>" not in prompt and "set_my_job" not in prompt
    assert follow.get("setup") is True  # the answer is the card's, not a message
