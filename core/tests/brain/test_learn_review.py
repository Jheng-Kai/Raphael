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


def _rule(number: str) -> str:
    return next(line for line in learn_review._template().splitlines() if line.startswith(number + ". "))


def test_a_misheard_name_is_asked_for_however_well_known_it_is():
    # R-LEARN-REVIEW-01: for days every review of the owner's edits answered an empty list, among
    # them the app's own name written in Chinese characters and a three-letter tool name heard as
    # three English words. The prompt turned away "a globally famous name or a common acronym",
    # which is exactly what speech-to-text gets wrong and the dictionary is for.
    assert _rule("2") == (
        "2. The word is a name or a term: of a person, product, app, tool, project, company, place or "
        "account, jargon, an acronym or a coined term. A well-known name counts as much as a rare one: "
        "speech-to-text got it wrong for this user, and that is what the dictionary is for. Never an "
        "everyday word of any language."
    )
    template = learn_review._template()
    assert "famous" not in template and "common acronym" not in template


def test_a_term_written_inside_a_path_or_a_link_still_counts():
    # The tool name above was written as the first part of a folder path, and the prompt said to
    # never add file paths, links or code.
    template = learn_review._template()
    assert (
        "A term written inside a path, a link, a command or code still counts: add the term alone, "
        "never the path around it."
    ) in template
    assert "- A whole number, date, time, link, email address, file path or piece of code" in template
    assert "- Numbers, dates, times, links, email addresses, file paths or code" not in template


def test_an_empty_list_is_not_the_answer_the_review_leans_to():
    # "Most edits teach nothing, so an empty list is the usual answer" leaned every unsure case to
    # nothing; only an edit that may as well be rewording is left out.
    template = learn_review._template()
    assert "usual answer" not in template and "When unsure, add nothing" not in template
    assert "When an edit could be rewording as well as a mishearing, add nothing for it." in template


_EXAMPLE = re.compile(r'^- pasted "([^"]*)", sent "([^"]*)"(?:, dictionary holds [^:]+)?: (\{.*\})(?: \(.*\))?$')


def test_every_example_of_the_prompt_survives_the_checks_on_a_reply():
    import json

    examples = [_EXAMPLE.match(line) for line in learn_review._template().splitlines() if line.startswith("- pasted ")]
    assert examples and all(examples), "every example has the shape the review is taught"
    named = 0
    for match in examples:
        pasted, sent, reply = match.group(1), match.group(2), json.loads(match.group(3))
        expected = [(item["word"], item["misheard"]) for item in reply["words"]]
        assert checked_pairs(reply, pasted, sent, 3) == expected, match.group(0)
        named += len(expected)
    assert named >= 2
    assert any("/" in m.group(2) and json.loads(m.group(3))["words"] for m in examples), "a term inside a path"


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


@pytest.mark.parametrize(("pasted", "sent", "word", "misheard"), [
    # A tool name heard as three English words and written as the start of a folder path.
    ("那個檔案應該在 kel ver projects 裡面才對", "那個檔案應該在  kelvr/projects 裡面才對", "kelvr", "kel ver"),
    # A product name written in another script by speech-to-text.
    ("這個要跟奇芙蘿一起改", "這個要跟 Kivro一起改", "Kivro", "奇芙蘿"),
])
async def test_a_misheard_term_the_review_names_is_learned_inside_a_path_or_from_another_script(
    keyed_router, fake_client, pasted, sent, word, misheard  # noqa: F811
):
    # R-LEARN-REVIEW-01: nothing after the model stood in the way of the owner's two corrections; the
    # review's answer was the only thing missing.
    fake_client.next_completion = completion({"words": [{"word": word, "misheard": misheard}]})
    reply = await keyed_router.call("dictionary.learn", {"undoable": True, "revision": {"pasted": pasted, "sent": sent}})
    assert reply["learned"] == [word] and reply["undo"]
    [call] = fake_client.calls
    assert misheard in call["user"] and word in call["user"]
    entries = (await keyed_router.call("dictionary.list", {}))["entries"]
    assert [(e["word"], e["heard"]) for e in entries] == [(word, [misheard])]


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
