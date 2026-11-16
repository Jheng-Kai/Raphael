"""Links a phone cannot open in what goes to an outside chat (R-MSG-LINK-03): the one judgement (`unreachable`), the words
and files that go instead (`deliverable`, `LinkedFiles`), and the real send path to a fake Telegram Bot API. Nothing here
touches the network; every name, path and address is made up."""

import asyncio
import json

import httpx
import pytest

from raphael_core.integrations.vault import MemoryVault
from raphael_core.messaging.config import AllowedUser, MessagingStore
from raphael_core.messaging.core import Switchboard
from raphael_core.messaging.links import (
    ATTACHMENT, LOCAL, PAGE, PATH, LinkedFiles, deliverable, unreachable, unreachable_links,
)
from raphael_core.messaging.service import MessagingService
from raphael_core.messaging.words import words
from raphael_core.services.attachment_store import AttachmentStore
from raphael_core.services.attachments import Attachment

from .test_switchboard import FakeChannel, settle
from .test_telegram import TOKEN
from .test_wiring import app  # noqa: F401

STORED = "0123456789abcdef0123456789abcdef.pdf"
STORED_PNG = "fedcba9876543210fedcba9876543210.png"


@pytest.mark.parametrize("target,kind", [
    ("/home/cua/workspace/notes/plan.md", PATH),
    ("/home/cua/team/projects/summary.pdf", PATH),
    ("/home/cua/team/", PATH),
    ("~/workspace/plan.md", PATH),
    ("/tmp/render/out.png", PATH),
    ("file:///home/cua/team/summary.pdf", PATH),
    ("file:///C:/Users/someone/Desktop/list.txt", PATH),
    ("sandbox:/mnt/data/chart.png", PATH),
    ("C:\\Users\\someone\\Documents\\list.txt", PATH),
    ("D:/Projects/site/index.html", PATH),
    ("\\\\nas\\share\\list.txt", PATH),
    ("http://localhost:3000/preview", LOCAL),
    ("https://localhost/", LOCAL),
    ("localhost:8080", LOCAL),
    ("http://127.0.0.1:8000/index.html", LOCAL),
    ("127.0.0.1:5173", LOCAL),
    ("http://127.1/", LOCAL),
    ("http://[::1]:9000/", LOCAL),
    ("http://0.0.0.0:8000/", LOCAL),
    ("http://192.168.1.20:5000/", LOCAL),
    ("http://10.0.0.7/report", LOCAL),
    ("http://172.17.0.2:8888/lab", LOCAL),
    ("http://169.254.1.1/", LOCAL),
    ("192.168.1.20:5000/files", LOCAL),
    ("http://member-box:8080/", LOCAL),
    ("http://printer.local/", LOCAL),
    ("http://host.docker.internal:3000/", LOCAL),
    ("ws://localhost:9222/devtools", LOCAL),
    ("http://127.0.0.1:51234/p/AbCdEf123456?theme=dark", PAGE),
    (f"attachment:{STORED}", ATTACHMENT),
    (f"attachment:attachments/{STORED}", ATTACHMENT),
    (f"attachments/{STORED}", ATTACHMENT),
    ("attachment:/home/cua/team/summary.pdf", ATTACHMENT),
])
def test_what_a_phone_cannot_open_is_told_apart(target, kind):
    assert unreachable(target) == kind


@pytest.mark.parametrize("target", [
    "https://example.com/news/today", "http://example.org", "https://8.8.8.8/", "https://zh.example.com/wiki/台灣",
    "https://example.com:8443/a", "mailto:someone@example.com", "tel:+15550100", "tg://resolve?domain=example",
    "/api/users", "/r/example", "/stop", "1/2", "and/or", "readme.md", "",
])
def test_a_public_link_and_what_is_no_link_are_left_alone(target):
    assert unreachable(target) is None


def test_links_are_found_where_they_stand_whatever_the_script_around_them():
    text = ("檔案在/home/cua/team/報告.md裡面，預覽http://localhost:3000/a。"
            "See [the plan](/home/cua/workspace/plan.md) and (http://10.0.0.5:8000), or https://example.com/a.\n"
            "```\ncat /home/cua/team/raw.txt\n```\n"
            "ファイルは /home/cua/workspace/表.xlsx です。")
    found = [(link.kind, text[link.start:link.fallback]) for link in unreachable_links(text)]
    assert found == [
        (PATH, "/home/cua/team/報告.md"),
        (LOCAL, "http://localhost:3000/a"),
        (PATH, "[the plan](/home/cua/workspace/plan.md)"),
        (LOCAL, "http://10.0.0.5:8000"),
        (PATH, "/home/cua/workspace/表.xlsx"),
    ]
    assert unreachable_links("Read https://example.com/a and https://example.org/b?x=1, then /api/users.") == []


async def test_a_file_found_goes_as_the_file_and_its_link_becomes_its_name():
    plan = Attachment("plan.md", "text/markdown", b"# plan")
    asked = []

    async def find(kind, target):
        asked.append((kind, target))
        return plan if target == "/home/cua/workspace/plan.md" else None

    messages, files = await deliverable(
        ["Done: /home/cua/workspace/plan.md是最終版。", "Also [the plan](/home/cua/workspace/plan.md), see https://example.com/a."],
        find, "en")
    assert messages == ["Done: plan.md是最終版。", "Also the plan (plan.md), see https://example.com/a."]
    assert files == [plan]  # named twice, sent once
    # The longest place the path may end is asked first, then each place a file's extension ends.
    assert asked[:2] == [(PATH, "/home/cua/workspace/plan.md是最終版"), (PATH, "/home/cua/workspace/plan.md")]


@pytest.mark.parametrize("language", ["en", "zh-TW", "ja", "ko", "de"])
async def test_what_is_not_found_is_said_in_plain_words_and_no_dead_link_is_left(language):
    text = (f"Summary /home/cua/team/summary.pdf, preview http://localhost:3000/preview, file:///C:/Users/someone/list.txt, "
            f"http://192.168.1.20:5000/, attachment:{STORED}, attachment:/home/cua/team/old.pdf and https://example.com/news.")

    async def find(kind, target):
        return None

    [message], files = await deliverable([text], find, language)
    assert files == []
    for dead in ("/home/cua", "localhost", "file:", "attachment:", "C:/Users", "192.168"):
        assert dead not in message
    assert "https://example.com/news" in message
    assert words(language, "link_file", name="summary.pdf") in message
    assert words(language, "link_file", name="list.txt") in message
    assert words(language, "link_file", name=STORED) in message
    assert words(language, "link_file", name="old.pdf") in message
    assert message.count(words(language, "link_local")) == 2
    # Without any lookup at all (no app), the same words.
    assert (await deliverable([text], None, language))[0] == [message]


async def test_a_local_address_in_brackets_keeps_one_pair_and_a_page_not_found_is_an_address():
    async def find(kind, target):
        return None

    [message], _ = await deliverable(["Preview (http://localhost:3000) or http://127.0.0.1:5000/p/token1234."], find, "en")
    assert message == "Preview (a link that opens only on the computer) or (a link that opens only on the computer)."


async def test_a_file_already_going_with_the_reply_is_not_sent_twice_and_a_stored_file_takes_its_words():
    delivered = Attachment(STORED_PNG, "image/png", b"\x89PNG chart", STORED_PNG)

    async def find(kind, target):
        assert kind == ATTACHMENT
        return Attachment(STORED_PNG, "image/png", b"\x89PNG chart", STORED_PNG)

    [message], files = await deliverable([f"![chart](attachment:{STORED_PNG}) is ready"], find, "en", sent=[delivered])
    assert message == "chart is ready" and files == []
    [message], [file] = await deliverable([f"Here is [the summary](attachment:{STORED_PNG})."], find, "en")
    assert message == "Here is the summary." and file.name == "the summary.png" and file.stored_id == STORED_PNG


async def test_a_lookup_that_breaks_never_stops_the_message():
    async def find(kind, target):
        raise OSError("the disk went away")

    [message], files = await deliverable(["See /home/cua/team/plan.md"], find, "en")
    assert message == "See " + words("en", "link_file", name="plan.md") and files == []


async def test_the_member_computer_folders_the_store_and_a_page_are_where_files_are_found(tmp_path):
    workspace, team = tmp_path / "ws", tmp_path / "team"
    (workspace / "notes").mkdir(parents=True)
    team.mkdir()
    (workspace / "notes" / "plan.txt").write_bytes(b"the plan")
    (team / "summary.pdf").write_bytes(b"%PDF-1.4 summary")
    (tmp_path / "outside.txt").write_bytes(b"outside")
    store = AttachmentStore(tmp_path / "data")
    saved = store.save(Attachment("chart.png", "image/png", b"\x89PNG\r\n\x1a\nchart"))
    pages = {"http://127.0.0.1:5000/p/known": ("Weekly plan.html", "<!doctype html><p>plan</p>")}
    found = LinkedFiles(folders=lambda member: {"/home/cua/workspace": workspace, "/home/cua/team": team} if member == 3 else {},
                        home="/home/cua", attachments=store, page=pages.get)

    plan = await found(3, PATH, "/home/cua/workspace/notes/plan.txt")
    assert (plan.name, plan.mime, plan.data) == ("plan.txt", "text/plain", b"the plan")
    for target in ("~/team/summary.pdf", "file:///home/cua/team/summary.pdf", "sandbox:/home/cua/team/summary.pdf"):
        assert (await found(3, PATH, target)).data == b"%PDF-1.4 summary"
    stored = await found(3, ATTACHMENT, f"attachment:{saved.stored_id}")
    assert (stored.data, stored.stored_id) == (b"\x89PNG\r\n\x1a\nchart", saved.stored_id)
    assert (await found(3, ATTACHMENT, f"attachments/{saved.stored_id}")).stored_id == saved.stored_id
    page = await found(3, PAGE, "http://127.0.0.1:5000/p/known")
    assert (page.name, page.mime, page.data) == ("Weekly plan.html", "text/html", b"<!doctype html><p>plan</p>")

    for member, kind, target in [
        (3, PATH, "/home/cua/workspace/../outside.txt"),  # never out of the folder
        (3, PATH, "/home/cua/workspace/missing.txt"),
        (3, PATH, "/home/cua/workspace/notes"),  # a folder is no file
        (3, PATH, "/tmp/plan.txt"),  # not a folder this PC keeps
        (3, PATH, str(tmp_path / "outside.txt")),  # a path of this PC is never sent for a link (R-BATCH-02)
        (3, PATH, (tmp_path / "outside.txt").as_uri()),
        (4, PATH, "/home/cua/workspace/notes/plan.txt"),  # another member's computer, or one on another host
        (3, ATTACHMENT, "attachment:../../outside.txt"),
        (3, ATTACHMENT, "attachment:" + "0" * 32 + ".png"),
        (3, PAGE, "http://127.0.0.1:5000/p/unknown"),
        (3, LOCAL, "http://localhost:3000/"),
    ]:
        assert await found(member, kind, target) is None, target
    small = LinkedFiles(folders=lambda member: {"/home/cua/workspace": workspace}, limit=4)
    assert await small(0, PATH, "/home/cua/workspace/notes/plan.txt") is None


async def test_the_switchboard_sends_the_file_a_reply_names_and_asks_in_the_writers_computer():
    channel = FakeChannel()
    uploads, asked = [], []

    async def send_attachment(chat, file):
        uploads.append((chat, file.name, file.data))
        return True

    async def find(member, kind, target):
        asked.append(member)
        return Attachment("plan.md", "text/markdown", b"# plan") if target == "/home/cua/team/plan.md" else None

    channel.send_attachment = send_attachment
    board = Switchboard(channel, ask=None, stop=None, is_allowed=lambda user: True, chat_allowed=lambda chat: chat == "D1",
                        language=lambda: "en", find=find)
    await board.tell("D1", ["Saved /home/cua/team/plan.md", "Preview http://localhost:3000"], member=7)
    assert channel.sent == [("D1", "Saved plan.md"), ("D1", "Preview " + words("en", "link_local"))]
    assert uploads == [("D1", "plan.md", b"# plan")] and asked == [7]
    await board.tell("stranger", "Saved /home/cua/team/plan.md")
    assert len(uploads) == 1 and asked == [7]


class BotApi:
    """The Bot API as far as a reply goes: one owner's message to answer, then every sent message and file recorded. The
    message comes only once the test has allowed its sender (`open`): polling starts as the channel connects, before that."""

    def __init__(self, owner):
        self.owner, self.given, self.open, self.sent, self.files = owner, False, False, [], []

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": {"id": 999, "is_bot": True, "username": "example_bot"}})
        if method == "getUpdates":
            if self.given or not self.open:
                await asyncio.sleep(0.01)
                return httpx.Response(200, json={"ok": True, "result": []})
            self.given = True
            message = {"chat": {"id": self.owner, "type": "private"}, "from": {"id": self.owner, "is_bot": False, "first_name": "A"},
                       "text": "Where is the summary?"}
            return httpx.Response(200, json={"ok": True, "result": [{"update_id": 1, "message": message}]})
        if method == "sendMessage":
            self.sent.append(json.loads(request.content)["text"])
        elif method in ("sendDocument", "sendPhoto", "sendAudio", "sendVideo"):
            self.files.append((method, request.content))
        return httpx.Response(200, json={"ok": True, "result": {}})


async def test_a_reply_and_a_report_over_telegram_carry_the_file_and_no_dead_link(tmp_path):
    owner, token = 4242, TOKEN
    workspace, team = tmp_path / "ws", tmp_path / "team"
    workspace.mkdir()
    team.mkdir()
    (team / "summary.pdf").write_bytes(b"%PDF-1.4 the summary")
    (workspace / "notes.txt").write_bytes(b"member three's notes")
    folders = {0: {"/home/cua/workspace": tmp_path / "raphael", "/home/cua/team": team},
               3: {"/home/cua/workspace": workspace, "/home/cua/team": team}}
    api = BotApi(owner)
    reply = ("The summary is at /home/cua/team/summary.pdf, a preview runs on http://localhost:3000/preview "
             "and the source is https://example.com/article.")

    async def ask(session, text, language, source):
        return reply

    async def stop(session):
        return False

    async with httpx.AsyncClient(transport=httpx.MockTransport(api)) as http:
        service = MessagingService(MessagingStore(tmp_path / "config"), MemoryVault(), ask=ask, stop=stop,
                                   language=lambda: "en", http=http)
        service.linked_files = LinkedFiles(folders=lambda member: folders.get(member, {}), home="/home/cua")
        assert (await service._connect("telegram", {"token": token}))["ok"]
        service._config.channel("telegram").allowed.append(AllowedUser(str(owner), "A"))
        api.open = True
        try:
            await settle(lambda: api.sent and api.files, tries=2000)
            [text] = api.sent
            assert "/home/cua" not in text and "localhost" not in text
            assert "summary.pdf" in text and "https://example.com/article" in text
            assert words("en", "link_local") in text
            [(method, body)] = api.files
            assert method == "sendDocument" and b"%PDF-1.4 the summary" in body and str(owner).encode() in body
            # A member's work handed over in Raphael's chat names that member's computer.
            await service.report(f"telegram:{owner}", "Notes: /home/cua/workspace/notes.txt", member=3)
            assert api.sent[-1] == "Notes: notes.txt"
            assert b"member three's notes" in api.files[-1][1]
        finally:
            await service.aclose()


async def test_the_app_finds_a_members_file_a_stored_file_and_a_page_and_names_the_member_of_a_report(app, monkeypatch):
    linked = app.messaging.linked_files
    (app.vm.target(0).workspace / "drafts").mkdir(parents=True, exist_ok=True)
    (app.vm.target(0).workspace / "drafts" / "plan.txt").write_bytes(b"the plan")
    assert (await linked(0, PATH, "/home/cua/workspace/drafts/plan.txt")).data == b"the plan"
    saved = app.attachment_store.save(Attachment("report.pdf", "application/pdf", b"%PDF-1.4 report"))
    assert (await linked(0, ATTACHMENT, f"attachment:{saved.stored_id}")).data == b"%PDF-1.4 report"
    history = app.agent._history
    turn_id = history.add(session_id="telegram:42", question="Plan", route="answer", prefix="", text="Done", status="done", cost_usd=0)
    turn = history.get(turn_id)
    page = app.agent.pages.store.write(turn_id=turn_id, member_id=turn.member_id, conversation_id=turn.conversation_id,
                                       title="Weekly plan", html="<p>Monday: write</p>")
    url = (await app.agent.pages.open({"id": page["id"], "theme": "light"}))["url"]
    made = await linked(0, PAGE, url)
    assert made.name == "Weekly plan.html" and b"Monday: write" in made.data
    assert await linked(0, PAGE, url.replace("/p/", "/p/x")) is None

    member = app.members.store.create_member(name="Example member", role="Writer")
    reports = []

    async def report(session, text, **options):
        reports.append(options)

    monkeypatch.setattr(app.messaging, "report", report)
    store = app.background._store
    for owner in (member.id, 0):
        task = store.create(session_id="telegram:42", language="en", text="Write it", member_id=owner)
        store.finish(task, "done", prefix="", text="Saved /home/cua/workspace/a.txt", detail=None, reason=None)
        app._worker_notice("worker.report", {"task_id": task})
        await asyncio.sleep(0)
    assert reports == [{"member": member.id}, {}]
