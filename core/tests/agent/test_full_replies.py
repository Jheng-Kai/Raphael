"""Full visible answers survive envelopes, splitting and delegation contracts."""

import json
import pytest

from raphael_core.agent.answers import parse_reply, split_messages
from raphael_core.agent.team import ANSWER_MAX_CHARS
from raphael_core.background.brief import TaskBrief, background_block


@pytest.mark.parametrize("text", [
    'Here is the cleanup prompt: {"text": "Example only"}. Keep all these instructions.',
    'The example is:\n```json\n{"text": "Example only"}\n```\nThen explain the whole prompt.',
    '```json\n{"text":"First example"}\n```\nCompare these examples.\n```json\n{"text":"Second example"}\n```',
    'First paragraph.\n\n\n\nSecond paragraph.',
])
def test_json_examples_in_prose_are_the_answer(text):
    reply = parse_reply(text, "en", plain=True, long=True)
    assert reply.text == text
    assert "\n\n".join(reply.messages) == text


@pytest.mark.parametrize("wrapped", [lambda s: s, lambda s: "```json\n" + s + "\n```"])
def test_whole_reply_envelope_still_parses(wrapped):
    assert parse_reply(wrapped(json.dumps({"text": "Actual answer"})), "en", long=True).text == "Actual answer"


def test_long_plain_cli_answer_and_fifth_message_survive():
    paragraphs = [str(i) + "x" * 1500 for i in range(6)]
    text = "\n\n".join(paragraphs)
    reply = parse_reply(text, "en", plain=True, long=True)
    assert reply.text == text and reply.messages == paragraphs
    reply = parse_reply({"messages": paragraphs}, "en", long=True)
    assert reply.text == text and reply.messages == paragraphs
    assert ANSWER_MAX_CHARS >= len(text)


def test_raphael_chat_reply_is_full_and_detail_is_only_receipts():
    text = "Complete requested result. " * 100
    reply = parse_reply({"text": text.strip(), "detail": "Checked fixture"}, "en")
    assert reply.text == text.strip()
    assert reply.detail == "Checked fixture"


def test_long_code_block_is_not_cut_or_split():
    text = "```python\n" + "print('complete')\n\n" * 300 + "```"
    assert split_messages(text) == [text]


def test_task_followup_receives_entire_report():
    report = "Result paragraph. " * 500
    assert report in background_block([TaskBrief(1, "Task", "done", 1, (), report, 0)])
