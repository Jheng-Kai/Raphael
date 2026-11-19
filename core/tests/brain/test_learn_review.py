"""The cleanup model's review of an edited dictation (`learn_review`), and `dictionary.learn`
with a revision. The model is a fake: these tests pin what is sent and what is kept of a reply,
not the model's judgement (that is measured with the real model in evaluate/)."""

import re

import pytest

from raphael_core.brain import learn_review
from raphael_core.brain.learn_review import (
    MAX_CHANGED_CHARS,
    build_review_message,
    build_review_prompt,
    changed_window,
    checked_pairs,
    dictionary_block,
)
from raphael_core.brain.openrouter import OpenRouterError

from .test_service import KEY, completion, fake_client, keys, clock, make_brain, routed  # noqa: F401

PASTED = "Please ask kwor via about the launch plan tomorrow."
SENT = "Please ask Quorvia about the launch plan tomorrow."


# ---------- what is sent ----------


def test_an_unchanged_text_has_no_window():
    assert changed_window(PASTED, PASTED) is None


def test_the_window_is_the_changed_stretch_with_some_context():
    before, after = changed_window(PASTED, SENT, context=6)
    assert before == "e ask kwor via ab"
    assert after == "e ask Quorvia ab"


def test_a_long_text_sends_only_the_neighbourhood_of_the_edit():
    filler = "word " * 500
    before, after = changed_window(filler + PASTED + filler, filler + SENT + filler)
    assert "kwor via" in before and "Quorvia" in after
    assert len(before) < 400 and len(after) < 400


def test_a_wholesale_rewrite_is_no_correction():
    rewritten = "x" * (MAX_CHANGED_CHARS + 1)
    assert changed_window("a" * 10, rewritten) is None
    assert changed_window(rewritten, "a" * 10) is None


def test_the_window_works_the_same_in_every_script():
    pasted, sent = "我昨天買了一支新的首機，拍照很漂亮", "我昨天買了一支新的手提電話，拍照很漂亮"
    before, after = changed_window(pasted, sent, context=3)
    assert (before, after) == ("支新的首機，拍照", "支新的手提電話，拍照")


def test_the_prompt_names_the_languages_and_holds_no_words_of_any_one_language():
    template = (learn_review._template())
    # Every rule and example of the template is ASCII; the languages come in through a field.
    assert template.isascii()
    prompt = build_review_prompt([], [], ["zh-TW", "en-US"], "")
    assert "{" + "languages}" not in prompt and "(empty)" in prompt
    assert re.search(r"繁體中文", prompt)


def test_the_dictionary_puts_the_words_the_edit_holds_first():
    block = dictionary_block(["Alpha", "Quorvia", "Beta"], [("kwor via", "Quorvia")], SENT)
    assert block.splitlines()[0] == "- Quorvia (often misheard as: kwor via)"
    assert block.splitlines()[1:] == ["- Alpha", "- Beta"]


def test_the_dictionary_block_is_cut_off_like_the_cleanup_prompt():
    block = dictionary_block([f"Word{i}" for i in range(500)], [], "")
    assert len(block.splitlines()) == learn_review.PROMPT_MAX_WORDS


def test_the_message_tags_both_texts():
    assert build_review_message("a", "b") == "<pasted>a</pasted>\n<sent>b</sent>"


# ---------- what is kept of a reply ----------


@pytest.mark.parametrize("item", [
    {"word": "Quorvia"},  # no misheard
    {"word": "Quorvia", "misheard": 3},
    {"word": "Elsewhere", "misheard": "kwor via"},  # not in what was sent
    {"word": "Quorvia", "misheard": "kwor viaa"},  # not in what was pasted
    {"word": "Quorvia", "misheard": "quorvia"},  # letter case only
    {"word": "Quorvia", "misheard": ""},
    {"word": "a" * 61, "misheard": "kwor via"},
    "Quorvia",
])
def test_a_reply_item_that_does_not_fit_the_texts_is_dropped(item):
    assert checked_pairs({"words": [item]}, PASTED + " quorvia", SENT + " " + "a" * 61, 3) == []


def test_kept_pairs_are_unique_trimmed_and_limited():
    data = {"words": [
        {"word": " Quorvia ", "misheard": "kwor via"},
        {"word": "Quorvia", "misheard": "kwor via"},
        {"word": "launch", "misheard": "plan"},
        {"word": "tomorrow", "misheard": "tomorrow."},
    ]}
    assert checked_pairs(data, PASTED, SENT, 2) == [("Quorvia", "kwor via"), ("launch", "plan")]


@pytest.mark.parametrize("data", [None, [], {"words": None}, {"words": "x"}, {}])
def test_a_reply_without_a_list_keeps_nothing(data):
    assert checked_pairs(data, PASTED, SENT, 3) == []


# ---------- dictionary.learn with a revision ----------


@pytest.fixture
def keyed_router(make_brain, keys):  # noqa: F811
    keys.set(KEY)
    return routed(make_brain())


async def test_a_reviewed_word_is_learned_and_its_call_is_paid_for(keyed_router, fake_client, conn):  # noqa: F811
    fake_client.next_completion = completion({"words": [{"word": "Quorvia", "misheard": "kwor via"}]})
    reply = await keyed_router.call(
        "dictionary.learn", {"undoable": True, "revision": {"pasted": PASTED, "sent": SENT}}
    )
    assert reply["learned"] == ["Quorvia"] and reply["undo"]
    [call] = fake_client.calls
    assert call["schema"] == learn_review.REVIEW_SCHEMA
    assert call["user"] == build_review_message(*changed_window(PASTED, SENT))
    assert "Quorvia" not in call["system"], "an unknown word is not in the dictionary block"
    entries = (await keyed_router.call("dictionary.list", {}))["entries"]
    assert [(e["word"], e["source"]) for e in entries] == [("Quorvia", "learned")]
    [(purpose, job)] = conn.execute("SELECT purpose, job FROM spend").fetchall()
    assert (purpose, job) == ("cleanup", "dictionary_learn")


async def test_an_unchanged_revision_asks_no_model(keyed_router, fake_client):  # noqa: F811
    reply = await keyed_router.call("dictionary.learn", {"revision": {"pasted": PASTED, "sent": PASTED}})
    assert reply == {"learned": []}
    assert fake_client.calls == []


async def test_without_a_model_nothing_is_asked(make_brain, fake_client):  # noqa: F811
    router = routed(make_brain())
    reply = await router.call("dictionary.learn", {"revision": {"pasted": PASTED, "sent": SENT}})
    assert reply == {"learned": []}
    assert fake_client.calls == []


async def test_a_failed_review_learns_nothing(keyed_router, fake_client):  # noqa: F811
    fake_client.next_error = OpenRouterError(503, "unavailable", "down")
    reply = await keyed_router.call("dictionary.learn", {"revision": {"pasted": PASTED, "sent": SENT}})
    assert reply == {"learned": []}


async def test_a_word_the_model_names_that_the_dictionary_knows_is_not_learned_again(keyed_router, fake_client):  # noqa: F811
    await keyed_router.call("dictionary.add", {"word": "Quorvia"})
    fake_client.next_completion = completion({"words": [{"word": "Quorvia", "misheard": "kwor via"}]})
    reply = await keyed_router.call("dictionary.learn", {"revision": {"pasted": PASTED, "sent": SENT}})
    # A known word gains the pair as a hint; it is not a new word.
    entries = (await keyed_router.call("dictionary.list", {}))["entries"]
    assert [e["word"] for e in entries] == ["Quorvia"]
    assert "- Quorvia" in fake_client.calls[0]["system"]
    assert reply["learned"] in ([], ["Quorvia"])


async def test_a_rule_the_owner_changed_back_is_withdrawn_without_the_model(keyed_router, fake_client):  # noqa: F811
    for _ in range(2):  # the second sighting makes it a rule
        await keyed_router.call(
            "dictionary.learn", {"corrections": [{"word": "Quorvia", "misheard": "kwor via"}]}
        )
    [entry] = (await keyed_router.call("dictionary.list", {}))["entries"]
    assert entry["misheard"] == ["kwor via"]
    fake_client.next_completion = completion({"words": []})
    reply = await keyed_router.call("dictionary.learn", {"revision": {"pasted": SENT, "sent": PASTED}})
    assert reply.get("reverted") == ["Quorvia"]
    [entry] = (await keyed_router.call("dictionary.list", {}))["entries"]
    assert entry["misheard"] == []


@pytest.mark.parametrize("params", [
    {"revision": "x"},
    {"revision": {"pasted": "a"}},
    {"revision": {"pasted": 1, "sent": "b"}},
    {"revision": {"pasted": "a" * 20_001, "sent": "b"}},
])
async def test_a_malformed_revision_is_refused(keyed_router, params):  # noqa: F811
    from raphael_core.protocol import RpcError

    with pytest.raises(RpcError):
        await keyed_router.call("dictionary.learn", params)
