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

