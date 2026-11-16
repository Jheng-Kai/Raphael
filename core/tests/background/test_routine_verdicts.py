"""The app's verdict on finished work, for every kind of thing a routine can be set to make and every ending it judges.

A verdict is the app's own word on work: a wrong one fails a good run ("made nothing" for a reply that held the whole draft) or
passes an empty one. Each table lists instructions that must and must not make a routine need something, in the four languages
the owner writes in, with the near misses (a word that names a page or a draft where the work is words in the reply)."""

import pytest

from raphael_core.agent.persona import PHRASES, phrase
from raphael_core.background.routine_outcome import PRODUCERS, expected, failure, made

PAGE = "page"
DRAFT = "draft"

# (instructions, what a run must make). Each near miss names a page or a draft that is read, checked or said in the reply.
PAGES = [
    # English
    ("Make a web page of today's news and show it with show_page.", PAGE),
    ("Create a page that summarises the day", PAGE),
    ("Build an HTML page with the sales chart every Monday", PAGE),
    ("Publish a weekly report page", PAGE),
    ("Turn the day's results into a web page", PAGE),
    ("Put together a landing page for the launch", PAGE),
    ("Every morning, create a dashboard page of the open tickets", PAGE),
    ("Render the summary as an HTML page", PAGE),
    ("Make me a nice page showing the week's weather", PAGE),
    ("Generate an HTML report page", PAGE),
    ("Use update_page to refresh the dashboard", PAGE),
    ("Do not repeat yesterday's items, make a web page", PAGE),
    ("Do not make a page; only tell me in the conversation", None),
    ("Never write a page, and do not make a draft either", None),
    ("Instead of making a page, reply here", None),
    ("Do not use show_page", None),
    ("Make sure the login page still loads and tell me if it does not", None),
    ("Write a summary of the web page at https://example.com/pricing in the conversation", None),
    ("Create a ticket for each broken page you find", None),
    ("Write a one-page summary and send it to me here", None),
    ("Generate a report on the status page uptime and reply with it", None),
    ("Write a post announcing the new landing page", None),
    ("Check the home page every hour; if it is down, tell me", None),
    ("Read the page and tell me if the price changed", None),
    # Traditional Chinese
    ("每天早上製作今日新聞的網頁", PAGE),
    ("把今天的銷售整理成網頁並顯示", PAGE),
    ("請做一個頁面顯示今天的待辦", PAGE),
    ("製作一個互動頁面讓我選擇，不要太長", PAGE),
    ("把結果輸出成網頁", PAGE),
    ("幫我做一個網頁來看今天的行程", PAGE),
    ("不要重複昨天的內容，做成網頁", PAGE),
    ("不要做網頁，直接回報", None),
    ("不要製作頁面，也不要做草稿，只在對話裡回答", None),
    ("確認登入頁面能正常載入，不能的話回報", None),
    ("檢查官網首頁是否正常，並在對話裡回覆結果", None),
    ("寫一份關於首頁頁面改版的建議給我", None),
    ("寫一篇關於網頁效能的分析，直接回覆我", None),
    # Simplified Chinese
    ("每天早上制作今日新闻的网页", PAGE),
    ("把销售数据整理成网页并展示", PAGE),
    ("生成一个页面显示今天的待办", PAGE),
    ("不要重复昨天的内容，做成网页", PAGE),
    ("不要做网页，直接回报", None),
    ("检查官网首页是否正常并直接回复", None),
    ("写一篇关于网页性能的分析直接回复我", None),
    # Japanese
    ("ニュースをまとめてページを作成する", PAGE),
    ("毎朝、今日のニュースのWebページを作って", PAGE),
    ("レポートページを生成して公開", PAGE),
    ("結果をページにまとめて表示して", PAGE),
    ("HTMLページを作成してください", PAGE),
    ("レポートをページとして公開して", PAGE),
    ("今日のニュースを一つのページにまとめてください", PAGE),
    ("ページは作らないで、会話で報告して", None),
    ("ページを作成しないでください", None),
    ("ページの作成は不要です。会話で答えてください", None),
    ("ホームページを確認して、変更点をまとめて報告して", None),
    ("トップページが開くか確認し、結果を会話で教えて", None),
    ("1ページにまとめて、会話で送って", None),
]

DRAFTS = [
    # English
    ("Write an email draft to the client about the delay", DRAFT),
    ("Draft an email to the client about the delay", DRAFT),
    ("Save a draft in Gmail for each unread thread", DRAFT),
    ("Create a Slack draft with today's summary", DRAFT),
    ("Use email_draft to prepare the reply", DRAFT),
    ("Write a draft reply to the Slack thread", DRAFT),
    ("Prepare a reply draft in Gmail for each unread email", DRAFT),
    ("Leave a Slack draft for the team", DRAFT),
    ("Compose a draft message to Alice", DRAFT),
    ("Do not write an email draft, tell me here", None),
    ("Do not make a page, or an email draft", None),
    ("Write a draft post about our launch and show it to me here", None),
    ("Draft a blog article about the week", None),
    ("Check whether the email draft to Bob was sent", None),
    ("Review the draft email Bob sent and summarise it", None),
    ("Check my email and tell me if I have a draft", None),
    ("Summarise my Gmail drafts folder in the conversation", None),
    # Traditional Chinese
    ("每天早上先擬好給客戶的郵件草稿", DRAFT),
    ("把 Slack 的回覆先寫成草稿", DRAFT),
    ("幫我把回信寫成草稿", DRAFT),
    ("提醒我記錄今天的進度，並幫我先擬好貼文草稿，讓我 3 分鐘內就能發出去", None),
    ("不要寫郵件草稿，直接在對話裡告訴我", None),
    ("確認郵件草稿夾裡有沒有舊的草稿", None),
    ("檢查郵件草稿有沒有寄出", None),
    # Simplified Chinese
    ("每天早上先拟好给客户的邮件草稿", DRAFT),
    ("帮我写一份文章草稿，直接回复", None),
    ("检查邮件草稿夹", None),
    # Japanese
    ("取引先へのメールの下書きを作って", DRAFT),
    ("返信のメール下書きを用意して", DRAFT),
    ("メールの下書きを保存して", DRAFT),
    ("ブログ記事の下書きを書いて", None),
    ("メールの下書きは作らないで、会話で見せて", None),
    ("メールの下書きフォルダを確認して報告して", None),
]


@pytest.mark.parametrize("prompt, made_kind", PAGES, ids=range(len(PAGES)))
def test_what_makes_a_routine_need_a_page(prompt, made_kind):
    assert expected(prompt) == made_kind, prompt


@pytest.mark.parametrize("prompt, made_kind", DRAFTS, ids=range(len(DRAFTS)))
def test_what_makes_a_routine_need_a_draft(prompt, made_kind):
    assert expected(prompt) == made_kind, prompt


def test_a_page_wins_when_a_routine_makes_both():
    assert expected("Make a web page of the news and write an email draft to Bob") == PAGE


def test_a_routine_that_needs_nothing_made_is_judged_on_what_ran():
    for prompt in ("", None, "Check the team and report", "每天回報今天的行事曆", "今日の予定を教えて"):
        assert expected(prompt) is None


# --- what the run did -------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", [PAGE, DRAFT])
def test_what_a_run_made_is_what_its_tools_say_it_made(kind):
    mine = sorted(PRODUCERS[kind])[0]
    assert made(kind, {mine})
    assert not made(kind, {"web_read", "local_time"})
    assert not made(kind, {"web_read"}, {"slack_post_message"}), "a write that is no page and no draft is not one"


@pytest.mark.parametrize("name", ["notion-update-page", "notion-create-pages", "google_docs_create_document", "createPage"])
def test_a_page_a_connected_app_wrote_is_a_page(name):
    assert made(PAGE, {"web_read"}, {name})
    assert failure("Create a page in Notion with today's summary", {"web_read", name}, None, 3, {name}) is None
    assert failure("Create a page in Notion with today's summary", {"web_read"}, None, 3) == "routine_nothing"


@pytest.mark.parametrize("name", ["gmail_create_draft", "GMAIL_CREATE_EMAIL_DRAFT", "drafts-create"])
def test_a_draft_a_connected_app_wrote_is_a_draft(name):
    assert made(DRAFT, set(), {name})
    assert failure("Write an email draft to the client", {name}, None, 1, {name}) is None


def test_the_tool_that_runs_any_other_tool_of_an_app_counts_when_it_went_through():
    assert failure("Write an email draft to the client", {"COMPOSIO_MULTI_EXECUTE_TOOL"}, None, 1,
                   {"COMPOSIO_MULTI_EXECUTE_TOOL"}) is None
    assert failure("Write an email draft to the client", {"COMPOSIO_SEARCH_TOOLS"}, None, 1) == "routine_nothing"


def test_a_read_of_an_app_is_never_what_a_run_made():
    # `written` holds only calls that changed something; reading a page leaves it empty.
    assert failure("Make a web page of the news", {"notion-fetch"}, None, 1, set()) == "routine_nothing"


# --- the words of every judged ending ---------------------------------------------------------------------------------------

JUDGED_PHRASES = ["routine_refused", "routine_nothing", "work_only_words", "work_file_missing", "work_children_open", "no_answer"]


@pytest.mark.parametrize("language", sorted(PHRASES))
@pytest.mark.parametrize("name", JUDGED_PHRASES)
def test_every_judged_ending_says_what_was_missing_in_every_language(language, name):
    words = phrase(language, name)
    assert words.strip() and "{" not in words
    if language != "en":
        assert words != phrase("en", name), f"{language} falls back to English for {name}"


# --- no brain failure for what the app judged ------------------------------------------------------------------------------

from raphael_core.agent.history import AgentHistory  # noqa: E402
from raphael_core.background.service import _APP_ENDINGS, _JUDGED_ENDINGS  # noqa: E402

BRAIN_REASONS = ["usage_limit", "credits", "context_overflow", "model_error", "cli_error"]


@pytest.mark.parametrize("reason", sorted(_JUDGED_ENDINGS | _APP_ENDINGS) + ["worker_ValueError"])
async def test_an_ending_that_the_app_judged_records_no_brain_failure(make_rig, conn, reason):
    """A member asked about the run later reads the turn: a failure recorded for the app's own word is a model error."""
    rig = make_rig()
    history = AgentHistory(conn)
    turn_id = history.add(session_id="s", question="q", route="routine", prefix="", text="", status="running", source="routine")
    task_id = rig.service._store.create(session_id="s", language="en", text="Do the work")
    rig.service.attach_turn(task_id, turn_id)
    rig.service._store.start(task_id)
    rig.service._conclude(rig.task(task_id), None, "failed", "", "What was missing.", None, reason)
    turn = history.get(turn_id)
    assert (turn.status, turn.failure) == ("error", None)
    assert rig.task(task_id).reason == reason


@pytest.mark.parametrize("reason", BRAIN_REASONS)
async def test_an_ending_that_is_the_brains_still_records_its_failure(make_rig, conn, reason):
    rig = make_rig()
    history = AgentHistory(conn)
    turn_id = history.add(session_id="s", question="q", route="routine", prefix="", text="", status="running", source="routine")
    task_id = rig.service._store.create(session_id="s", language="en", text="Do the work")
    rig.service.attach_turn(task_id, turn_id)
    rig.service._store.start(task_id)
    rig.service._conclude(rig.task(task_id), None, "failed", "", "The model failed.", None, reason)
    assert history.get(turn_id).failure is not None



from .test_run import rig  # noqa: E402,F401


async def test_a_run_remembers_the_tools_of_connected_apps_that_changed_something(rig):  # noqa: F811
    """`written` is what the judgement of a routine reads: a write that went through, never a read, and kept across a pause."""
    await rig.plugins.connect(look="T0", note="T0")
    rig.resnap()
    assert (await rig.tool("Notes__look", {"topic": "tea"}))["ok"] and rig.run.written == set()
    assert (await rig.tool("Notes__note", {"text": "x"}, call_id="c2"))["ok"] and rig.run.written == {"note"}
    state = rig.run.continuation_state()
    rig.run.written.clear()
    rig.run.restore_continuation(state)
    assert rig.run.written == {"note"}
    rig.run.restore_continuation({key: value for key, value in state.items() if key != "written"})
    assert rig.run.written == {"note"}, "a continuation written before this was kept leaves what the run was told"


# --- a file the work was to leave ---------------------------------------------------------------------------------------------

import os  # noqa: E402

from raphael_core.background import service as background_service  # noqa: E402

from .conftest import report as said  # noqa: E402
from .test_endings import _finish, _fresh, _team_rig  # noqa: E402
from .test_handoff import setup  # noqa: E402


async def made_files(make_rig, tmp_path, condition, make, *, reply="Done."):
    """Run work whose condition is `condition`; `make(workspace, team, fresh)` leaves its files; the task as it ended."""
    rig = make_rig()
    target, source = setup(rig)
    workspace, team = _team_rig(rig, tmp_path)

    def saved(**kwargs):
        make(workspace, team, lambda path, ahead=0: _fresh(rig, path, ahead))
        return said(reply)
    rig.client.replies.append(saved)
    return await _finish(rig, target, source, done_when=condition)


def leave(folder, name, text="Synthetic work"):
    path = folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf8")
    return path


# (what the condition says, the name of the file that is left, whether it counts)
NAMES = [
    ("report.md exists with sources", "report.md", True),
    ("Save the summary as my report.md", "my report.md", True),
    ("Save the summary as 'daily summary.pdf'", "daily summary.pdf", True),
    ("請把結果存成report.md", "report.md", True),
    ("結果は report.md に保存して", "report.md", True),
    ("把摘要存成每日摘要.md", "每日摘要.md", True),
    ("把摘要存成 每日摘要.md 並回報", "每日摘要.md", True),
    ("結果を週報.md として保存", "週報.md", True),
    ("Save the notes as NOTES.MD", "notes.md", True),
    ("Save the result as result.yaml", "result.yaml", True),
    ("Write the log to run.log", "run.log", True),
    ("Save the summary as my report.md", "other.md", False),
    ("請把結果存成report.md", "other.md", False),
    ("把摘要存成每日摘要.md", "其他.md", False),
    ("Save the result as result.yaml", "other.yaml", False),
    ("Write the log to run.log", "other.log", False),
    ("Save a copy as report.md.bak", "report.md", False),
]


@pytest.mark.parametrize("folder", ["workspace", "team", "nested"])
@pytest.mark.parametrize("condition, name, counts", NAMES, ids=range(len(NAMES)))
async def test_the_file_the_condition_names_is_the_one_that_must_exist(make_rig, tmp_path, condition, name, counts, folder):
    def make(workspace, team, fresh):
        where = {"workspace": workspace, "team": team, "nested": team / "projects" / "a b" / "週報"}[folder]
        fresh(leave(where, name))
        fresh(leave(team, "decoy-" + name))
    task = await made_files(make_rig, tmp_path, condition, make)
    assert (task.state, task.reason) == (("done", None) if counts else ("failed", "missing_artifact")), (condition, name)


async def test_a_file_that_was_there_before_and_was_not_touched_is_not_the_work(make_rig, tmp_path):
    def make(workspace, team, fresh):
        old = leave(team, "plan.md")
        os.utime(old, (1_000_000, 1_000_000))
    task = await made_files(make_rig, tmp_path, "plan.md exists", make)
    assert (task.state, task.reason) == ("failed", "missing_artifact")


async def test_a_file_that_was_there_before_and_was_changed_is_the_work(make_rig, tmp_path):
    def make(workspace, team, fresh):
        old = leave(team, "plan.md", "old")
        os.utime(old, (1_000_000, 1_000_000))
        old.write_text("new words", encoding="utf8")
        fresh(old)
    task = await made_files(make_rig, tmp_path, "plan.md exists", make)
    assert (task.state, task.reason) == ("done", None)


async def test_a_file_named_in_the_report_and_not_in_the_condition_does_not_stand_for_the_one_that_is(make_rig, tmp_path):
    def make(workspace, team, fresh):
        fresh(leave(team, "projects/other.md"))
    task = await made_files(make_rig, tmp_path, "plan.md exists", make, reply="Saved to /home/cua/team/projects/other.md")
    assert (task.state, task.reason) == ("failed", "missing_artifact")


async def test_a_file_named_only_in_the_report_counts_when_the_condition_names_none(make_rig, tmp_path):
    def make(workspace, team, fresh):
        fresh(leave(team, "projects/study.md"))
    task = await made_files(make_rig, tmp_path, "the study is written up", make, reply="Saved to /home/cua/team/projects/study.md")
    assert (task.state, task.reason) == ("done", None)


@pytest.mark.parametrize("where", ["workspace", "team"])
async def test_a_huge_folder_beside_the_file_does_not_hide_it(make_rig, tmp_path, monkeypatch, where):
    """The scan has a budget so that a tree of thousands of files cannot stall the end of a task; it must not be spent on
    the files whose names are not the one the condition names."""
    monkeypatch.setattr(background_service, "ARTIFACT_SCAN", 5)

    def make(workspace, team, fresh):
        folder = workspace if where == "workspace" else team
        fresh(leave(folder, "zzz/plan.txt"))
        for number in range(12):  # made after it, so this folder is the one touched last, and the scan comes to it first
            leave(folder, f"aaa/part{number}/file.txt")
    task = await made_files(make_rig, tmp_path, "plan.txt exists", make)
    assert (task.state, task.reason) == ("done", None)


async def test_a_run_of_unreadable_files_does_not_hide_the_file_the_report_names(make_rig, tmp_path, monkeypatch):
    """The newest files being ones this PC cannot read must not use the places kept as evidence, nor the budget of tries
    (R-WORK-FILE-01), when the condition names no file and the report names the path."""
    from raphael_core.background import tasks
    digest = tasks._artifact_digest

    def readable(path):
        if "cache" in path.parts:
            raise PermissionError(path)
        return digest(path)
    monkeypatch.setattr(tasks, "_artifact_digest", readable)

    def make(workspace, team, fresh):
        for number in range(260):
            fresh(leave(workspace, f"cache/data_{number}"), ahead=5)
        fresh(leave(team, "projects/research/findings.md"))
    task = await made_files(make_rig, tmp_path, "the findings are written up", make,
                            reply="Written to /home/cua/team/projects/research/findings.md")
    assert (task.state, task.reason) == ("done", None)


async def test_the_newest_files_being_unreadable_take_none_of_the_places_kept_as_evidence(make_rig, tmp_path, monkeypatch):
    """R-WORK-FILE-01 (2): a browser's cache this PC cannot read was the newest of the member's files, and took every place."""
    from raphael_core.background import tasks
    digest = tasks._artifact_digest

    def readable(path):
        if "cache" in path.parts:
            raise PermissionError(path)
        return digest(path)
    monkeypatch.setattr(tasks, "_artifact_digest", readable)

    def make(workspace, team, fresh):
        for number in range(30):
            fresh(leave(workspace, f"cache/data_{number}"), ahead=5)
        fresh(leave(team, "projects/findings.md"))
    task = await made_files(make_rig, tmp_path, "the findings are written up", make)
    assert (task.state, task.reason) == ("done", None)


async def test_a_tree_nothing_touched_does_not_use_the_budget_before_the_folder_that_was(make_rig, tmp_path, monkeypatch):
    """When the condition names no file the scan reads every file it comes to; the folders touched last come first."""
    monkeypatch.setattr(background_service, "ARTIFACT_SCAN", 5)

    def make(workspace, team, fresh):
        for number in range(12):
            leave(workspace, f"aaa/part{number}.txt")
            os.utime(workspace / f"aaa/part{number}.txt", (1_000_000, 1_000_000))
        os.utime(workspace / "aaa", (1_000_000, 1_000_000))
        fresh(leave(workspace, "zzz/new.txt"))
    task = await made_files(make_rig, tmp_path, "the notes are written up", make)
    assert (task.state, task.reason) == ("done", None)


@pytest.mark.parametrize("writes, state", [(True, "done"), (False, "failed")])
async def test_a_routine_that_wrote_what_it_was_set_to_make_in_a_connected_app_is_done(make_rig, monkeypatch, writes, state):
    """The run's own record of what a connected app changed reaches the judgement of how it ended."""
    from raphael_core.background import routine_outcome
    from .conftest import turn, use
    from .test_members import ended
    from .test_routine_health import routine_run
    monkeypatch.setitem(routine_outcome.APP_PRODUCERS, "page", frozenset({"note"}))
    rig = make_rig()
    await rig.plugins.connect(look="T0", note="T0")
    tool = use("Notes__note", {"text": "x"}, "c1") if writes else use("Notes__look", {"topic": "tea"}, "c1")
    rig.client.replies = [turn("", [tool]), said("Made it.")]
    task = await ended(rig, routine_run(rig, "Create a page in Notion with today's summary"))
    assert (task.state, task.reason) == (state, None if writes else "routine_nothing")
