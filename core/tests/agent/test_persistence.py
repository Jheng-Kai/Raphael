"""A failure is information: a member keeps going until no plausible way is left (owner, 2026-11-14).

Facts behind it: a language-teaching member, told to use its own computer for a news page, ran a search, read the lead of the
page, had its page refused twice, and ended with 「我不會再換方式繞過這個攔截」 without opening its browser. Every word of the
harness on that path pointed at stopping: "inspect once, change approach once, then report the exact blocker", a corrective
note that allowed "a different approach at most once", "Only open a browser when the owner asks", every failure shown as
"The call was refused", and a summary and replayed turns that kept yesterday's failures as today's facts. Hermes Agent keeps
going because nothing tells it to stop, every failure arrives with its cause, and failures never become rules. These tests
use fakes for every model, CLI and service; nothing is sent anywhere.
"""

import pytest

from raphael_core.agent import persona
from raphael_core.agent.cli.context import fresh_user, resumed_user
from raphael_core.agent.cli.loop import CliLoop
from raphael_core.agent.data_floor import WRITE_REFUSAL
from raphael_core.agent.history import AgentHistory
from raphael_core.agent.narration import NARRATION_RULES
from raphael_core.agent.plugins import PluginResult
from raphael_core.agent.self_check import ABOUT_INDEX, DOCTRINE, OWN_CONNECTIONS_RULE, own_connections
from raphael_core.agent.speaker import Speaker
from raphael_core.agent.steps import Step
from raphael_core.agent.tools import READ_CAUSES, READ_NEEDS_BROWSER, Tools
from raphael_core.failures import CORRECTIVE_NOTE
from raphael_core.memory.conversation import SUMMARY_HEADER, Conversation, _SUMMARY_SYSTEM, turn_text
from raphael_core.services.common import ServiceError
from raphael_core.services.web import needs_rendered_read
from raphael_core.worker.loop import FAILURE_CHARS, OTHER_WAYS, Call, ToolOutcome, Turn, result_text, run_task

from .test_service import NOW_MS

FIELDS = dict(name="Shion", role="Japanese teacher", instructions="Teach N1 reading.", personality="Strict.")
RULE = "A failed call is information: read its cause, fix what you can, then take the next plausible way"
CAPS = ("change approach once", "at most once", "Do not try another", "after one check",
        "Only open a browser when the owner asks", "answer with what you have; name the gap")


def every_prompt(language="en"):
    """Every system prompt a brain reads: the chief's and a member's conversation (API, narrated, CLI) and their tasks."""
    return {
        "chief": persona.system_prompt(language, "answer"),
        "chief narrated": persona.system_prompt(language, "answer", narrated=True) + NARRATION_RULES,
        "chief cli": persona.cli_system_prompt(language),
        "member": persona.member_system_prompt(language, "answer", **FIELDS),
        "member narrated": persona.member_system_prompt(language, "answer", narrated=True, **FIELDS) + NARRATION_RULES,
        "member cli": persona.cli_system_prompt(language, **FIELDS),
        "chief task": persona.worker_system_prompt(language, model_calls=20, tool_calls=40),
        "member task": persona.member_worker_system_prompt(language, model_calls=20, tool_calls=40, **FIELDS),
        "member cli task": persona.member_worker_system_prompt(language, model_calls=20, tool_calls=40, cli=True, **FIELDS),
    }


# --- R-PERSIST-01: no caps, one shared rule ---------------------------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "zh-TW", "ja"])
@pytest.mark.parametrize("path", list(every_prompt()))
def test_every_prompt_carries_the_one_rule_and_none_of_the_caps(path, language):
    prompt = every_prompt(language)[path]
    assert prompt.count(RULE) == 1, path
    assert "Ask the owner only for what only\nthey can give, or when the ways left cost far more than the result is worth" in prompt
    assert "your computer's browser when you have one" in prompt
    for cap in CAPS:
        assert cap not in prompt, (path, cap)


def test_the_rule_is_said_once_in_the_shared_contract_and_the_diagnosis_cap_is_gone():
    assert RULE in DOCTRINE and "Diagnosis" not in ABOUT_INDEX and "10. Calendar" in ABOUT_INDEX
    assert "When a tool fails, try another way" not in persona.worker_system_prompt("en", model_calls=1, tool_calls=1)


def test_a_part_answer_looks_for_the_rest_first():
    assert "look for the rest first; answer with what you have" in persona.system_prompt("en", "answer")


def test_the_data_floor_refusal_points_at_the_right_tools_and_no_longer_forbids_every_other_way():
    assert "Do not try another" not in WRITE_REFUSAL and "skill_read" in WRITE_REFUSAL and "skill_manage" in WRITE_REFUSAL


# --- R-PERSIST-02: refused only for the owner or a rule; any other failure says why -----------------------------------


@pytest.mark.parametrize("kind", ["denied", "declined", "forbidden", "presence_required", "protected_data", "tool_disabled"])
def test_only_the_owner_and_the_safety_rules_refuse(kind):
    shown = result_text("mail_send", ToolOutcome(False, kind, "The owner said no to this call, so it was not made."))
    assert f"The call was refused ({kind})." in shown and OTHER_WAYS not in shown
    assert "The owner said no" in shown


@pytest.mark.parametrize("outcome", [
    ToolOutcome(False, "url_not_seen", instruction="This URL was not seen in the owner's request or a tool result. "
                                                    "Use a URL already supplied or find it with web_search first."),
    ToolOutcome(False, "secret", instruction="html contains a secret; remove credentials and try again"),
    ToolOutcome(False, "computer_asleep", instruction=READ_NEEDS_BROWSER),
    ToolOutcome(False, "docker_stopped", "Docker Desktop is not running, so the computer could not start."),
    ToolOutcome(False, "http_error"),
])
def test_any_other_failure_is_a_failure_with_its_cause_and_another_way(outcome):
    shown = result_text("web_read", outcome)
    assert "refused" not in shown and OTHER_WAYS in shown
    if outcome.instruction:  # the harness's words of what to do instead stand for its code
        assert f"The call failed.\n{outcome.instruction}" in shown and f"({outcome.kind})" not in shown
    else:
        assert f"The call failed ({outcome.kind})." in shown and outcome.content in shown


def test_a_tools_own_words_of_why_are_held_to_a_bound_and_stay_redacted():
    words = "Traceback: the driver said " + "x " * 3000 + "token sk-or-v1-" + "a" * 40
    shown = result_text("vm_exec", ToolOutcome(False, "tool_error", words))
    said = shown.split("\n")[2]
    assert said.startswith("Traceback: the driver said") and len(said) == FAILURE_CHARS
    assert "sk-or-v1-" + "a" * 40 not in result_text("vm_exec", ToolOutcome(False, "tool_error", "key sk-or-v1-" + "a" * 40))
    # Far more than the 240 characters it used to keep: the cause of a failure is what the model needs.
    assert len(said) > 240


@pytest.mark.parametrize("kind", ["expired", "not_made", "already_done", "waiting_for_connection", "limit"])
def test_a_call_the_harness_held_back_is_not_made_and_is_no_way_that_failed(kind):
    shown = result_text("mail_send", ToolOutcome(False, kind, "Nobody answered in time."))
    assert f"The call was not made ({kind})." in shown and OTHER_WAYS not in shown and "refused" not in shown


async def test_a_web_read_turned_away_says_it_is_no_sign_in_of_the_owners():
    class Refused:
        def enabled(self, name):
            return True

        def read_service(self):
            return "builtin"

        async def read(self, url):
            raise ServiceError("auth")

    result = await Tools(object(), services=Refused()).web_read("https://news.example/item")
    assert not result.ok and result.error == "auth" and result.instruction == READ_CAUSES["auth"]
    assert "no sign-in of the owner's is asked for" in result.instruction


# --- R-PERSIST-03: what failed and what was not tried, before the turn may end ----------------------------------------

TOOLS = [{"type": "function", "function": {"name": name, "parameters": {"type": "object"}}}
         for name in ("web_search", "web_read", "show_page", "browser_open", "ask_owner")]


class Host:
    """A model that reads a page, has its page refused, says it will not try again, and, once told what it has not tried,
    opens its own browser."""

    def __init__(self, failing=("show_page",), kind="secret", ends=1):
        self.requests, self.calls, self.failing, self.kind, self.ends = [], [], failing, kind, ends

    async def chat(self, messages, tools, room=1):
        self.requests.append([dict(m) for m in messages])
        n = len(self.requests)
        if n == 1:
            return Turn("", [Call("1", "web_read", {"url": "https://news.example/a"}), Call("2", "show_page", {"html": "<p>x</p>"})])
        if n <= 1 + self.ends:
            return Turn("我不會再換方式繞過這個攔截。")
        if not self.calls or self.calls[-1] != "browser_open":
            return Turn("", [Call("3", "browser_open", {"url": "https://news.example/a"})])
        return Turn("Here is the whole article, read in my browser.")

    async def tool(self, call_id, name, arguments):
        self.calls.append(name)
        if name in self.failing:
            return ToolOutcome(False, self.kind, "the page's text matched a key pattern")
        return ToolOutcome(True, None, "the page")


class Script:
    """A model that says what is queued; the tools in `failing` fail with their kind."""

    def __init__(self, replies, failing):
        self.replies, self.failing, self.requests, self.calls = list(replies), failing, [], []

    async def chat(self, messages, tools, room=1):
        self.requests.append([dict(m) for m in messages])
        return self.replies.pop(0)

    async def tool(self, call_id, name, arguments):
        self.calls.append(name)
        return ToolOutcome(False, self.failing[name], "no") if name in self.failing else ToolOutcome(True, None, "ok")


def ledgers(host):
    return [m["content"] for request in host.requests for m in request[-1:]
            if m["role"] == "user" and str(m["content"]).startswith(CORRECTIVE_NOTE)]


async def test_a_turn_that_gives_up_after_a_failed_call_is_told_what_failed_and_what_it_has_not_tried():
    host = Host()
    outcome = await run_task(host, system="", user="Read today's article in your own computer.", tools=TOOLS, corrective_rounds=1)
    assert outcome.status == "done" and outcome.final == "Here is the whole article, read in my browser."
    [note] = ledgers(host)
    assert "Failed: show_page (secret)." in note
    assert "Offered and not tried yet: web_search, browser_open, ask_owner." in note
    assert "web_read," not in note.split("Offered")[1]  # what it called is not offered again
    assert "at most once" not in note and "bypass" not in note
    assert host.calls == ["web_read", "show_page", "browser_open"]


async def test_the_note_never_follows_an_owners_no_or_a_call_held_back():
    for kind in ("denied", "expired"):
        host = Host(kind=kind)
        outcome = await run_task(host, system="", user="", tools=TOOLS, corrective_rounds=1)
        assert outcome.status == "done" and ledgers(host) == [] and len(host.requests) == 2, kind


async def test_a_background_run_is_told_twice_and_an_interactive_turn_once():
    give_up = Turn("I cannot go on.")
    host = Script([Turn("", [Call("1", "show_page", {})]), give_up, Turn("", [Call("2", "web_search", {})]), give_up,
                   Turn("", [Call("3", "browser_open", {})]), Turn("Done in my browser.")],
                  {"show_page": "secret", "web_search": "timeout"})
    outcome = await run_task(host, system="", user="", tools=TOOLS, corrective_rounds=2)
    assert outcome.final == "Done in my browser." and len(ledgers(host)) == 2
    assert "Failed: show_page (secret), web_search (timeout)." in ledgers(host)[1]
    # A reply to the note that makes no call ends the run: the note comes once for each round of failed calls.
    host = Script([Turn("", [Call("1", "show_page", {})]), give_up, give_up], {"show_page": "secret"})
    outcome = await run_task(host, system="", user="", tools=TOOLS, corrective_rounds=2)
    assert outcome.final == "I cannot go on." and len(ledgers(host)) == 1 and len(host.requests) == 3
    import inspect
    from raphael_core.agent import narration
    from raphael_core.worker import runner
    assert "corrective_rounds=2" in inspect.getsource(runner) and "corrective_rounds=1" in inspect.getsource(narration)


async def test_a_cli_brain_reads_the_same_list_with_the_result_of_a_tools_first_failure():
    async def execute(identifier, name, args):
        if name == "web_read":
            return ToolOutcome(True, content="the lead paragraph")
        return ToolOutcome(False, "secret", instruction="html contains a secret; remove credentials and try again")

    loop = CliLoop(brains=None, sessions=None, member_id=3, model="cli:codex", ledger=None, language="en", plain=True,
                   system="", user="", tools=TOOLS, progress=lambda _: None, thinking=lambda _: None,
                   event=lambda _: None, execute=execute, wait_timeout_s=0)
    try:
        await loop._tool("1", "web_read", {"url": "https://news.example/a"})
        first = await loop._tool("2", "show_page", {"html": "<p>x</p>"})
        again = await loop._tool("3", "show_page", {"html": "<p>y</p>"})
    finally:
        await loop.aclose()
    assert "The call failed.\nhtml contains a secret" in first.content and "The call was refused" not in first.content
    # Listed by its tool alone: the harness told it in words what to do instead.
    assert CORRECTIVE_NOTE in first.content and "Failed: show_page." in first.content
    assert "Offered and not tried yet: web_search, browser_open, ask_owner." in first.content
    assert CORRECTIVE_NOTE not in again.content  # once for each tool that fails, not after every failure


async def test_a_cli_brain_is_not_pushed_after_the_owner_said_no():
    async def execute(identifier, name, args):
        return ToolOutcome(False, "denied", "The owner said no to this call, so it was not made.")

    loop = CliLoop(brains=None, sessions=None, member_id=3, model="cli:codex", ledger=None, language="en", plain=True,
                   system="", user="", tools=TOOLS, progress=lambda _: None, thinking=lambda _: None,
                   event=lambda _: None, execute=execute, wait_timeout_s=0)
    try:
        result = await loop._tool("1", "show_page", {})
    finally:
        await loop.aclose()
    assert "The call was refused (denied)." in result.content and CORRECTIVE_NOTE not in result.content


# --- R-PERSIST-05: yesterday's failures are no rule for today ----------------------------------------------------------


def failed_step(tool, reason="secret"):
    return Step(kind="tool", tool=tool, server="Raphael", outcome="error", ms=5, reason=reason)


def ok_step(tool):
    return Step(kind="tool", tool=tool, server="Raphael", outcome="ok", ms=5)


def add(history, text, steps, *, member_id=3, question="Make today's reading page."):
    return history.add(session_id="s", question=question, route="answer", prefix="", text=text, status="done",
                       member_id=member_id, steps=steps)


def context_text(conn, member_id=3):
    context = Conversation(conn, None, now_ms=lambda: NOW_MS, member_id=member_id).context()
    return "\n".join(turn_text(turn, detail=False) for turn in context.turns)


def test_an_answer_that_gave_up_after_a_failed_call_is_read_back_as_unfinished(conn):
    history = AgentHistory(conn, lambda: NOW_MS)
    add(history, "我無法讀到 NHK 的全文，我不會再換方式繞過這個攔截。", [ok_step("web_read"), failed_step("show_page")])
    text = context_text(conn)
    assert "我不會再換方式繞過" not in text and "無法讀到" not in text
    assert "[This request did not finish: it stopped after calls that failed (show_page (secret))" in text
    assert "Other ways were not ruled out" in text


@pytest.mark.parametrize("text,steps", [
    ("我無法讀到原頁，所以用另一個來源做好了今天的頁面。", [failed_step("web_read"), ok_step("web_search")]),  # got past it
    ("Here is the page. " + "Vocabulary and grammar notes. " * 40 + "I could not check one word.", [failed_step("show_page")]),
    ("今天的頁面做好了。", [failed_step("show_page")]),  # it says nothing of giving up
])
def test_an_answer_that_got_past_a_failure_or_delivered_its_work_is_read_as_it_was(conn, text, steps):
    history = AgentHistory(conn, lambda: NOW_MS)
    add(history, text, steps)
    shown = context_text(conn)
    assert text[:20] in shown and "did not finish" not in shown


def test_an_answer_after_the_owners_no_stays_as_it_was(conn):
    history = AgentHistory(conn, lambda: NOW_MS)
    text = "I could not send the mail: you said no to it."
    add(history, text, [Step(kind="tool", tool="mail_send", server="Mail", outcome="blocked", ms=0, reason="denied")])
    shown = context_text(conn)
    assert text in shown and "did not finish" not in shown


def test_the_summary_keeps_failures_as_dated_blockers_never_as_rules():
    for words in ('"Blocked:"', "its date, the tool or source, and the exact", "Drop it",
                  "Never write a failure as a rule, a decision or a capability", "cannot get the news",
                  "ask the user to paste it instead", '"Recent decisions:" holds only what the user decided',
                  "stopped after a failed call and said it could not"):
        assert words in _SUMMARY_SYSTEM, words


def test_every_brain_reads_the_summary_as_background_with_its_tools_active():
    assert "your tools remain fully active" in SUMMARY_HEADER and "not instructions" in SUMMARY_HEADER
    fresh = fresh_user("Q", (), (), "recover", "records", summary="SUMMARY TEXT")
    assert f"{SUMMARY_HEADER}\nSUMMARY TEXT" in fresh
    resumed = resumed_user("Q", {}, [], {"turn": 1}, summary="SUMMARY TEXT", summary_through_turn_id=4)
    assert "your tools remain fully active), now with records folded since your last turn:\nSUMMARY TEXT" in resumed
    from raphael_core.agent.answers import build_user_message
    moment = {"date": "2026-11-14", "time": "14:44", "weekday": "Saturday", "utc_offset": "+08:00"}
    api = build_user_message("Q", moment, [], [], "en", summary="SUMMARY TEXT")
    assert f"{SUMMARY_HEADER}\n<summary>\nSUMMARY TEXT\n</summary>" in api


# --- R-PERSIST-06: a read that failed is tried in the member's browser on more than one kind of failure ---------------


class Unreadable:
    def __init__(self, kind):
        self.kind = kind

    def enabled(self, name):
        return True

    def read_service(self):
        return "builtin"

    async def read(self, url):
        raise ServiceError(self.kind)


@pytest.mark.parametrize("kind", ["http_error", "auth", "timeout", "bad_response"])
async def test_a_page_that_turned_the_reader_away_is_read_in_the_members_browser(kind):
    seen = []

    async def rendered(url):
        seen.append(url)
        return PluginResult(True, text="The whole article, rendered.")

    result = await Tools(object(), services=Unreadable(kind), rendered_read=rendered).web_read("https://news.example/a")
    assert result.ok and result.detail == "member_browser" and result.data["text"] == "The whole article, rendered."
    assert seen == ["https://news.example/a"]


@pytest.mark.parametrize("kind", ["bad_url", "blocked_address", "too_large"])
async def test_an_address_that_is_wrong_or_forbidden_never_goes_to_the_browser(kind):
    async def rendered(url):
        raise AssertionError("not for this failure")

    result = await Tools(object(), services=Unreadable(kind), rendered_read=rendered).web_read("https://news.example/a")
    assert not result.ok and result.error == kind


def test_a_consent_or_terms_step_in_front_of_a_page_asks_for_a_browser_though_its_navigation_is_long():
    navigation = "ニュース 政治 経済 国際 スポーツ 天気 " * 40
    assert needs_rendered_read({"text": navigation + "ご利用にあたって 内容について確認しました"})
    assert needs_rendered_read({"text": "Menu " * 200 + " Terms of use. Please read before you go on."})
    article = "The council agreed on the budget today after a long debate. " * 60
    assert not needs_rendered_read({"text": article + " Terms of use | Privacy"})  # a footer link of a whole article


# --- R-PERSIST-08: the live turn's rules no longer keep the member's own browser shut ---------------------------------


def test_the_narrated_turn_no_longer_forbids_the_members_own_browser():
    assert "Only open a browser" not in NARRATION_RULES and "show its link card" in NARRATION_RULES
    # What the contract says of a page a reader could not read stays: it goes to the member's own browser.
    assert "Thin web_read pages escalate to this browser" in persona.system_prompt("en", "answer")


# --- R-PERSIST-07: a member sees its own connection restriction -------------------------------------------------------


def test_self_check_tells_a_limited_member_which_apps_it_may_use_and_who_changes_that():
    connections = [{"id": "50a816b0b31c", "name": "Notion"}, {"id": "gmail1", "name": "Gmail"}]
    limited = own_connections(Speaker(id=1, tools=frozenset({"web_search", "50a816b0b31c"})), connections)
    assert limited == {"limited": True, "allowed": ["Notion"], "hidden": ["Gmail"], "rule": OWN_CONNECTIONS_RULE}
    assert "not broken" in OWN_CONNECTIONS_RULE and "member's panel" in OWN_CONNECTIONS_RULE
    assert own_connections(Speaker(id=2), connections) == {"limited": False}
