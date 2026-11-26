"""A refused read_attachment in a conversation tells the model which case it is (no files, a number out of range,
a window that is not valid), never a bare "bad_arguments"."""

import base64

from .test_earlier_files import ask
from .test_narration import chat
from .test_service import make_rig  # noqa: F401


def refusal(client, call_index=1):
    """What the model was shown after its read_attachment call."""
    return str(client.chat_calls[call_index]["messages"])


async def test_a_turn_without_files_says_it_has_none(make_rig, client):
    rig = make_rig()
    client.chats = [chat("", ("read_attachment", {"index": 1})), chat("Nothing to read")]
    await rig.call("agent.ask", ask("s", "Read the screenshot"))
    shown = refusal(client)
    assert "no attachments" in shown and "bad_arguments" not in shown.replace("no attachments", "")


async def test_a_number_out_of_range_names_the_files_it_can_read(make_rig, client):
    rig = make_rig()
    files = [("one.txt", "text/plain", b"first"), ("two.txt", "text/plain", b"second")]
    client.chats = [chat("", ("read_attachment", {"index": 5})), chat("Done")]
    await rig.call("agent.ask", ask("s", "Read file five", files))
    shown = refusal(client)
    assert "2 attachments" in shown and "1 to 2" in shown and "one.txt" in shown and "two.txt" in shown


async def test_a_bad_window_says_what_a_valid_one_is(make_rig, client):
    rig = make_rig()
    client.chats = [chat("", ("read_attachment", {"index": 1, "offset": 0})), chat("Done")]
    await rig.call("agent.ask", ask("s", "Read it", [("one.txt", "text/plain", b"first")]))
    shown = refusal(client)
    assert "offset" in shown and "whole number" in shown
