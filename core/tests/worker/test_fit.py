"""A connected tool's long answer made to fit what a model reads (R-TOOL-06)."""

import base64
import json

from raphael_core.integrations.client import MAX_RESULT_CHARS
from raphael_core.worker.fit import fit

STYLE = "<style>" + "* { padding: 0; margin: 0; } .button { color: #fff; }\n" * 200 + "</style>"


def message(n):
    html = (f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>Newsletter {n}</title>{STYLE}</head><body>"
            f"<table><tr><td><p>Dear reader, issue {n} is here.</p><p>Read the full story.</p></td></tr></table></body></html>")
    return {"messageId": f"id-{n:03d}", "subject": f"Subject {n}", "sender": f"sender{n}@example.com",
            "messageText": html, "attachmentList": [{"filename": "bill.pdf",
                                                    "data": base64.b64encode(bytes(range(256)) * 40).decode()}]}


def mail_answer(count=100):
    # The connector's multi-tool answer carries the tool's own answer as JSON inside a string, as seen in the run.
    inner = json.dumps({"successful": True, "data": {"messages": [message(n) for n in range(count)], "nextPageToken": "page-2"}})
    return json.dumps({"data": {"results": [{"tool_slug": "GMAIL_FETCH_EMAILS", "response": inner}]}, "successful": True})


def test_an_answer_within_its_limit_is_never_touched():
    small = json.dumps({"html": "<p>hi</p>" * 10, "items": list(range(5))})
    assert fit(small, MAX_RESULT_CHARS) == (small, False)


def test_a_hundred_mails_of_html_fit_whole_once_read_as_text():
    # The run's answer: 100 messages whose HTML filled the limit with the first one's style sheet.
    raw = mail_answer()
    assert len(raw) > 20 * MAX_RESULT_CHARS
    text, cut = fit(raw, MAX_RESULT_CHARS)
    assert cut is True and len(text) <= MAX_RESULT_CHARS
    inner = json.loads(json.loads(text)["data"]["results"][0]["response"])
    messages = inner["data"]["messages"]
    assert [m["messageId"] for m in messages] == [f"id-{n:03d}" for n in range(100)]
    first = messages[0]["messageText"]
    assert "issue 0 is here" in first and "<" not in first and "padding" not in first
    assert messages[0]["attachmentList"][0]["data"].endswith("characters of encoded data left out]")
    assert inner["data"]["nextPageToken"] == "page-2"


def test_mails_still_too_long_keep_their_first_whole_messages_and_say_how_to_get_the_rest():
    long = json.loads(mail_answer())
    inner = json.loads(long["data"]["results"][0]["response"])
    for item in inner["data"]["messages"]:
        item["messageText"] = "A real paragraph of mail. " * 140
    long["data"]["results"][0]["response"] = json.dumps(inner)
    text, cut = fit(json.dumps(long), MAX_RESULT_CHARS)
    assert cut is True and len(text) <= MAX_RESULT_CHARS
    shown = json.loads(json.loads(text)["data"]["results"][0]["response"])
    messages = shown["data"]["messages"]
    assert 5 <= len(messages) < 100 and [m["messageId"] for m in messages] == [f"id-{n:03d}" for n in range(len(messages))]
    note = shown["data"]["messages_left_out"]
    assert note == f"{100 - len(messages)} of 100 items left out to fit: ask for fewer at a time, or for the next page"
    assert shown["data"]["nextPageToken"] == "page-2"


def test_a_list_of_many_thousand_items_is_shortened_quickly_and_noted_as_its_last_item():
    import time
    rows = [{"n": n, "text": "row text " * 20} for n in range(20000)]
    started = time.monotonic()
    text, cut = fit(json.dumps(rows), MAX_RESULT_CHARS)
    shown = json.loads(text)
    assert time.monotonic() - started < 5 and cut is True and len(text) <= MAX_RESULT_CHARS
    assert [row["n"] for row in shown[:-1]] == list(range(len(shown) - 1))
    assert shown[-1] == f"{20000 - (len(shown) - 1)} of 20000 items left out to fit: ask for fewer at a time, or for the next page"


def test_the_model_reads_whole_messages_after_the_harness_wraps_the_connected_tools_answer():
    # What a member read: the connected tool's answer inside the harness's own JSON, with the source's note after it.
    from raphael_core.worker.loop import SOURCE_CUT, ToolOutcome, result_text
    long = json.loads(mail_answer())
    inner = json.loads(long["data"]["results"][0]["response"])
    for item in inner["data"]["messages"]:
        item["messageText"] = "A real paragraph of mail. " * 140
    long["data"]["results"][0]["response"] = json.dumps(inner)
    answer = json.dumps({"content": json.dumps(long), "cut_short": False})
    shown = result_text("Composio__COMPOSIO_MULTI_EXECUTE_TOOL", ToolOutcome(True, content=answer, truncated=True))
    body = shown.split("\n", 1)[1].rsplit("\n</tool_result>", 1)[0]
    assert "cut_short=true" in shown.split("\n", 1)[0] and body.endswith(SOURCE_CUT)
    outer = json.loads(body[: -len(SOURCE_CUT)])
    data = json.loads(json.loads(outer["content"])["data"]["results"][0]["response"])["data"]
    kept = data["messages"]
    assert len(kept) >= 5 and all(m["messageText"].startswith("A real paragraph") for m in kept)
    assert data["messages_left_out"].startswith(f"{100 - len(kept)} of 100 items left out")


def test_one_very_long_value_is_cut_by_the_callers_cut_and_its_answer_stays_json():
    text, cut = fit(json.dumps({"path": "notes.txt", "body": "word " * 30000}), MAX_RESULT_CHARS)
    shown = json.loads(text)
    assert cut is True and len(text) <= MAX_RESULT_CHARS and shown["path"] == "notes.txt"
    assert shown["body"].startswith("word word") and shown["body"].endswith("more characters left out]")
    head_and_tail = lambda rest, most: rest[: most // 2] + " [cut] " + rest[-(most // 2):]
    text, cut = fit(json.dumps({"body": "first " + "word " * 30000 + "last"}), MAX_RESULT_CHARS, cut=head_and_tail)
    body = json.loads(text)["body"]
    assert cut is True and body.startswith("first word") and body.endswith("word last") and " [cut] " in body


def test_html_that_is_not_json_is_read_as_its_text():
    page = "<html><head><title>Bill</title>" + STYLE * 30 + "</head><body><p>Amount due: 1,234</p></body></html>"
    assert len(page) > MAX_RESULT_CHARS
    text, cut = fit(page, MAX_RESULT_CHARS)
    assert cut is False and text == "Bill\nAmount due: 1,234"


def test_plain_text_still_too_long_is_cut_and_says_how_much_was_left_out():
    text, cut = fit("x" * (MAX_RESULT_CHARS + 500), MAX_RESULT_CHARS)
    assert cut is True and len(text) <= MAX_RESULT_CHARS and text.startswith("x" * (MAX_RESULT_CHARS - 100))
    kept = text.index("…")
    assert text[kept:] == f"… [{MAX_RESULT_CHARS + 500 - kept} more characters left out]"
