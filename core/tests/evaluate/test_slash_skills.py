"""Explicit slash skills reach the first model request, without a model choosing skill_read."""
import pytest

from p15a_brains import Stage
from raphael_core.background.host import WorkerHost
from background.conftest import Links, until

DOCUMENT = "---\nname: review\ndescription: Review synthetic notes\nplugin: Field Notes\n---\nVerify FIELD-6732 against the supplied input."


@pytest.mark.parametrize("brain", ["A", "C"])
async def test_explicit_skill_reaches_first_api_cli_and_background_prompt(tmp_path, monkeypatch, brain):
    owner = Stage(tmp_path, monkeypatch, brain, lambda user, tools, results: ("Finished", []))
    try:
        app = owner.app
        app.background._host = WorkerHost(connect=Links(), grace_s=.1)
        member = (await app.call("members.create", {"name": "Reader"}))["member"]["id"]
        skill = app.members.capabilities.keep_skill(member, "plugin:Field Notes", DOCUMENT)
        app.members.capabilities.homes.keep(member, f"skills/{skill['id']}/references/check.md", "REFERENCE-7821")
        app.members.capabilities.save_command(member, None, "review", "Review template", "TEMPLATE {input}")
        listed = (await app.call("members.skills.list", {"member_id": member}))["skills"]
        assert listed[0]["plugin"] == "Field Notes"
        assert listed[0]["slash_name"] == "field-notes:review"
        result = await owner.driver.ask("/field-notes:review quarter two", member=member, session="slash")
        assert result["status"] == "done"
        assert "FIELD-6732" in owner.prompts[-1] and "quarter two" in owner.prompts[-1]
        assert "REFERENCE-7821" in owner.prompts[-1]
        assert "TEMPLATE" not in owner.prompts[-1]
        imported = app.members.capabilities
        imported.keep_skill(member, "https://github.com/example/notes/blob/main/SKILL.md",
                            "---\nname: outline\ndescription: Outline notes\n---\nIMPORTED-4602")
        await owner.driver.ask("/outline fresh notes", member=member, session="imported")
        assert "IMPORTED-4602" in owner.prompts[-1] and "fresh notes" in owner.prompts[-1]
        routine = (await app.call("routines.create", {"member_id": member, "title": "Review notes",
            "prompt": "/field-notes:review quarter three", "schedule": {"kind": "daily", "time": "09:00"}}))["routine"]
        task_id = app.members._run(app.members.store.routine(routine["id"]))
        await until(lambda: app.background.task(task_id).state in ("done", "failed", "cancelled"))
        assert app.background.task(task_id).state == "done"
        assert any("FIELD-6732" in prompt and "REFERENCE-7821" in prompt and "quarter three" in prompt for prompt in owner.prompts)
        app.members.capabilities.update_skill(member, skill["id"], False)
        await owner.driver.ask("/field-notes:review disabled input", member=member, session="disabled")
        assert "FIELD-6732" not in owner.prompts[-1]
        assert app.members.expand_command(member, "/unknown ordinary words") == "/unknown ordinary words"
    finally:
        await owner.aclose()


async def test_namespaces_keep_plugin_collisions_and_member_scope_distinct(tmp_path, monkeypatch):
    owner = Stage(tmp_path, monkeypatch, "A", lambda user, tools, results: ("Finished", []))
    try:
        cap = owner.app.members.capabilities
        first = cap.keep_skill(0, "plugin:Field Notes", DOCUMENT)
        second = cap.keep_skill(0, "plugin:Desk Notes", DOCUMENT.replace("Field Notes", "Desk Notes").replace("FIELD-6732", "DESK-9104"))
        cap.homes.keep(0, f"skills/{first['id']}/references/check.md", "REFERENCE-7821")
        skills = cap.skills(0)
        assert [skill["slash_name"] for skill in skills] == ["field-notes:review", "desk-notes:review"]
        assert "REFERENCE-7821" in cap.expand(0, "/field-notes:review current input")
        assert "FIELD-6732" not in cap.expand(0, "/desk-notes:review current input")
        assert "DESK-9104" in cap.read_skill(0, "desk-notes:review")
        assert cap.read_skill(0, "review") is None
        other = (await owner.app.call("members.create", {"name": "Other Reader"}))["member"]["id"]
        assert cap.expand(other, "/field-notes:review input") == "/field-notes:review input"
        cap.delete_skill(0, second["id"])
        assert cap.expand(0, "/unknown input") == "/unknown input"
        assert len(cap.skills(0)) == 1 and cap.read_skill(0, "desk-notes:review") is None
    finally:
        await owner.aclose()


async def test_a_custom_command_wins_over_a_skill_of_the_same_name(tmp_path, monkeypatch):
    owner = Stage(tmp_path, monkeypatch, "A", lambda user, tools, results: ("Finished", []))
    try:
        cap = owner.app.members.capabilities
        cap.keep_skill(0, "owner", "---\nname: outline\ndescription: Outline notes\n---\nSKILL-BODY-5518")
        assert "SKILL-BODY-5518" in cap.expand(0, "/outline first draft")
        cap.save_command(0, None, "outline", "Outline template", "TEMPLATE-ONLY {input}")
        assert cap.resolve_slash(0, "/outline first draft") == ("TEMPLATE-ONLY first draft", False)
        await owner.driver.ask("/outline second draft", session="same-name")
        assert "TEMPLATE-ONLY second draft" in owner.prompts[-1] and "SKILL-BODY-5518" not in owner.prompts[-1]
    finally:
        await owner.aclose()


@pytest.mark.parametrize("brain", ["A", "C"])
async def test_explicit_skill_keeps_the_skill_read_untrusted_boundary(tmp_path, monkeypatch, brain):
    def act(user, tools, results):
        return ("Finished", []) if results else ("", [("memory_update", {"operations": [{"action": "add", "content": "Synthetic reference marker"}]})])
    owner = Stage(tmp_path, monkeypatch, brain, act)
    try:
        app = owner.app
        app.background._host = WorkerHost(connect=Links(), grace_s=.1)
        app.members.capabilities.keep_skill(0, "owner", "---\nname: notes\ndescription: Review notes\n---\nSynthetic guidance")
        marks = []
        original = app.memory.update_memory
        def update(member, arguments, **kwargs):
            marks.append(kwargs.get("untrusted", False))
            return original(member, arguments, **kwargs)
        monkeypatch.setattr(app.memory, "update_memory", update)
        await owner.driver.ask("/notes current input", session="untrusted-skill")
        assert marks and all(marks)
        marks.clear()
        routine = (await app.call("routines.create", {"member_id": 0, "title": "Review notes",
            "prompt": "/notes next input", "schedule": {"kind": "daily", "time": "09:00"}}))["routine"]
        task = app.members._run(app.members.store.routine(routine["id"]))
        await until(lambda: app.background.task(task).state in ("done", "failed", "cancelled"))
        assert marks and all(marks)
    finally:
        await owner.aclose()


async def test_a_skill_called_after_other_words_loads_with_the_rest_as_the_request(tmp_path, monkeypatch):
    owner = Stage(tmp_path, monkeypatch, "A", lambda user, tools, results: ("Finished", []))
    try:
        cap = owner.app.members.capabilities
        cap.keep_skill(0, "owner", "---\nname: outline\ndescription: Outline notes\n---\nSKILL-BODY-5518")
        cap.save_command(0, None, "weekly", "Weekly template", "WEEKLY: {input}")
        start, skill_loaded = cap.resolve_slash(0, "/outline the quarterly report")
        assert skill_loaded and start.startswith("the quarterly report\n\n") and "SKILL-BODY-5518" in start
        # Mid-text: the words before and after, the token taken out, are the request as at the start.
        mid, skill_loaded = cap.resolve_slash(0, "please /outline the quarterly report")
        assert skill_loaded and mid.startswith("please the quarterly report\n\n") and "SKILL-BODY-5518" in mid
        assert "/outline" not in mid.split("\n\n", 1)[0]
        end, skill_loaded = cap.resolve_slash(0, "the quarterly report /outline")
        assert skill_loaded and end.startswith("the quarterly report\n\n") and "SKILL-BODY-5518" in end
        line, skill_loaded = cap.resolve_slash(0, "first line\n/OUTLINE\nsecond line")
        assert skill_loaded and line.startswith("first line\nsecond line\n\n")
        assert cap.resolve_slash(0, "請幫我整理 /outline 這份報告")[0].startswith("請幫我整理 這份報告\n\n")
        # A custom command is expanded the same way, and wins over a skill of its name.
        assert cap.resolve_slash(0, "so /weekly the news and more") == ("WEEKLY: so the news and more", False)
        cap.save_command(0, None, "outline", "Outline template", "TEMPLATE-ONLY {input}")
        assert cap.resolve_slash(0, "now /outline notes") == ("TEMPLATE-ONLY now notes", False)
        # The loaded text reaches the model as the first request, the original stays the message.
        await owner.driver.ask("please /weekly the news", session="mid-text")
        assert "WEEKLY: please the news" in owner.prompts[-1]
    finally:
        await owner.aclose()


async def test_a_slash_word_that_is_no_known_call_stays_words(tmp_path, monkeypatch):
    owner = Stage(tmp_path, monkeypatch, "A", lambda user, tools, results: ("Finished", []))
    try:
        cap = owner.app.members.capabilities
        cap.keep_skill(0, "owner", "---\nname: outline\ndescription: Outline notes\n---\nSKILL-BODY-5518")
        disabled = cap.keep_skill(0, "owner", "---\nname: sleeper\ndescription: Off\n---\nSLEEPER-BODY")
        cap.update_skill(0, disabled["id"], False)
        for text in ["see /unknown words", "open /usr/bin/outline now", "a/outline b", "go to https://example.com/outline today",
                     "C:/outline/notes", "and/or /outlines", "an /outline. sentence", "use /sleeper here", "/unknown /nothing", "no slash at all"]:
            assert cap.resolve_slash(0, text) == (text, False), text
        # Another member has no such skill.
        other = (await owner.app.call("members.create", {"name": "Other Reader"}))["member"]["id"]
        assert cap.resolve_slash(other, "please /outline notes") == ("please /outline notes", False)
        # Start of the message: unchanged, and an unknown name there does not stop a known one later.
        assert cap.resolve_slash(0, "/unknown /outline notes")[1] is True
    finally:
        await owner.aclose()


async def test_only_the_first_call_in_a_message_loads_and_the_others_stay_words(tmp_path, monkeypatch):
    owner = Stage(tmp_path, monkeypatch, "A", lambda user, tools, results: ("Finished", []))
    try:
        cap = owner.app.members.capabilities
        cap.keep_skill(0, "owner", "---\nname: outline\ndescription: Outline notes\n---\nSKILL-BODY-5518")
        cap.save_command(0, None, "weekly", "Weekly template", "WEEKLY: {input}")
        expanded, loaded = cap.resolve_slash(0, "first /outline then /weekly")
        assert loaded and "SKILL-BODY-5518" in expanded and expanded.startswith("first then /weekly\n\n")
        assert cap.resolve_slash(0, "first /weekly then /outline") == ("WEEKLY: first then /outline", False)
        assert cap.resolve_slash(0, "/weekly then /outline") == ("WEEKLY: then /outline", False)
    finally:
        await owner.aclose()


async def test_a_team_skill_reaches_only_the_granted_members_prompt(tmp_path, monkeypatch):
    owner = Stage(tmp_path, monkeypatch, "A", lambda user, tools, results: ("Finished", []))
    try:
        member = (await owner.app.call("members.create", {"name": "Reader"}))["member"]["id"]
        package = (await owner.app.call("skills.library.import", {"text": DOCUMENT, "access": [member]}))["package"]
        for actor, session in [(member, "allowed"), (0, "private")]:
            await owner.driver.ask("/review quarter two", member=actor, session=session)
            assert ("FIELD-6732" in owner.prompts[-1]) == (actor == member)
        await owner.app.call("skills.library.update", {"key": package["key"], "enabled": False})
        await owner.driver.ask("/review quarter three", member=member, session="off")
        assert "FIELD-6732" not in owner.prompts[-1]
    finally:
        await owner.aclose()
