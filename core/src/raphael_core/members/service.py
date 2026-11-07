"""The members of the owner's team as RPC methods, with their pictures, their routines' scheduler and
the team as the assistant sees it.

The RPC methods (the main window only, through the shell's allow-list):

- `members.list {ui_language?}` -> `{members, groups}`. `members` is Raphael first (`id` 0, his name
  in the language, his picture when the owner chose one: `avatar_url`, a data URL, and
  `avatar_crop`), then every member in its place: `{id, name, role, personality, instructions, avatar,
  avatar_url?, group_id, model, tools, position, created, unread, unread_from, waiting, preview, last_at}`.
  `preview` is the last line of its thread (one line, cut) and `last_at` when it was said; `unread`
  says the thread has news the owner has not seen (`members.read` clears it), `unread_from` names
  its first unseen turn when known, and `waiting` that a
  question waits for the owner there. `groups` is `[{id, name, position, sources}]`.
- `members.create {name, role?, personality?, instructions?, group_id?, avatar?, tools?, model?, ui_language?, greet?}` ->
  `{member, routine_offer}`. `routine_offer` is the routine offered to a member of a group that
  has places to look (`sources`): `{title, prompt, schedule}` for 「每天早上的進度」 at 09:00, or
  null. It is offered, not made: `routines.create` makes it.
- `members.greet {id}` -> `{turn_id}`: start another hidden, tool-free greeting before any owner
  message, replacing failed greetings. Only the member's own interactive brain answers it.
- `members.update {id, name?, role?, personality?, instructions?, group_id?, avatar?, tools?, model?, position?}`
  -> `{member}`. `avatar` here is "" or a slime, "slime:<character>" or "slime:color:<color>". Raphael (0) is not changed here: his picture is the app's to change.
- `members.delete {id}` -> `{deleted}`: the member, its conversation (and the exchanges of other
  threads with it), its memory folder, its routines, its tasks and its picture. The app asks first.
- `members.set_primary {id}` -> `{primary_id}`: the owner's primary contact, the Bot that new work is brought
  to and that hands it to the colleague it belongs to. Raphael (0) until the owner chooses another; exactly one
  at a time. The roster says who it is to every model and to the window (`members.list`'s `team_context`,
  `primary_id`), which is the one place it is read from. It is Raphael again when the member is hidden or
  deleted. This unique contact holds the chief capability; changing it transfers team administration
  and the required room role without rewriting conversations or tasks.
- `members.set_avatar {id, name, mime, data}` -> `{member}`: a picture of the owner's own, in
  base64, checked as the images of a request are (`services.attachments`), copied into
  `<local>\\avatars\\members\\` under a name of its own: the path it came from is never known here.
- `members.read {id}` -> `{}`; `members.viewing {id | null}` -> `{}`: which thread is on screen now
  (null for none), so that what arrives there is not news.
- `members.tool_choices {}` -> `{tools, connections}`: Raphael's own tools a member may be given, by
  id, and the connections, `{id, name, enabled}`.
- `groups.create {name}` -> `{group}`, `groups.update {id, name?, position?, sources?}` -> `{group}`,
  `groups.delete {id}` -> `{deleted}` (its members go to 未分組).
- `routines.list {member_id}` -> `{routines}`, `routines.create {member_id, title, prompt, schedule,
  enabled?}` -> `{routine}`, `routines.update {id, title?, prompt?, schedule?, enabled?}` ->
  `{routine}`, `routines.delete {id}` -> `{deleted}`, `routines.template {member_id, ui_language?}`
  -> `{offer}`. A routine is `{id, member_id, title, prompt, schedule, enabled, last_run, next_run}`,
  the times in ms (or null).

A refusal of what the owner wrote is a bad request whose `data.kind` names the field
(`store.MemberError`), never what was in it.

The routines. A scheduler ticks every TICK_S while the core runs (`start`). A routine that is due is
moved to its next time first and only then run, so it runs at most once each time it is due, however
the run goes. One that was due while the core was not running runs once if it was due within the
last CATCH_UP_MS (12 hours), and not at all if longer ago. A run is a background task of the
routine's member (`BackgroundService.submit`, `routine_id`), with the routine's prompt: it is written
as a turn of that thread (`route` and `source` "routine", the routine's title as its `question`) and
completed with the report. It never uses the desktop (the worker has no tool for it) and never asks
the owner at the overlay; every run counts toward the month's limit, as every task does.

Unread. A turn written or completed in a thread that is not on screen (`members.viewing`) marks it
unread, unless it is Raphael's reply heard on the voice overlay.

Waiting. A thread is waiting while a question for a yes waits in it: a turn with the status
"confirm" (a question of the fast tier), or a question that a background task of that member waits
on (`add_waiting_source`, which the app gives `BackgroundService.waiting_members`), answered in the
app alone.

Nothing here logs a name, a role, an instruction, a routine's title or prompt, or a result.
"""

import asyncio
import base64
import binascii
import logging
import re
import json
import secrets
import sqlite3
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import tzinfo
from pathlib import Path
from typing import Any

from ..agent.history import AgentHistory, Turn
from ..agent.persona import normalize_language, phrase
from ..agent.speaker import BUILTIN_TOOL_IDS, RAPHAEL_NAMES, Speaker, is_raphael_name
from ..background.tasks import Refused
from ..brain.settings import DEFAULTS, SettingsStore
from ..clock import wall_clock_ms
from ..protocol import INVALID_PARAMS, RpcError, invalid_params
from ..router import Router
from ..services.attachments import IMAGE_TYPES, MAX_IMAGE_BYTES, AttachmentError, checked, sniff_ok
from .capabilities import MemberCapabilities, download_skills
from .schedule import Schedule, next_run
from .store import (
    ROUTINE_RUN_STATUS_SQL,
    PROMPT_MAX,
    PROFILE_FIELDS,
    NAME_MAX,
    Group,
    Member,
    MemberError,
    MemberStore,
    Routine,
    Source,
    clean_schedule,
)

logger = logging.getLogger(__name__)

TICK_S = 30.0
# A routine due while the core was not running runs once if it was due within this long.
CATCH_UP_MS = 12 * 3_600_000
ROUTINE_HOURLY_TOTAL = 300
ROUTINE_HOURLY_MEMBER = 200
OWNER_ABSENCE_MS = 30 * 24 * 3_600_000
# What the member column shows of the last line of a thread, at most.
PREVIEW_CHARS = 80
# The folders of the pictures, in the app's local folder.
AVATARS_DIR = "avatars"
SLIME = "slime:"
MEMBERS_DIR = "members"
# Raphael's own picture, kept by the shell (app/src-tauri/src/avatar.rs): read here, never written.
RAPHAEL_AVATAR_DIR = "avatar"
_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
# The template of the routine offered to a member of a group with places to look.
TEMPLATE_TIME = "09:00"
_TEMPLATE_TITLE = {"zh-TW": "每天早上的進度", "en": "Morning progress", "ja": "毎朝の進捗"}
_TEMPLATE_PROMPT = {
    "zh-TW": "用已連接的 GitHub 與 Notion 工具，查看下列地方從昨天到現在的進度，整理成一份簡短的進度報告：",
    "en": (
        "Using the connected GitHub and Notion tools, check the progress since yesterday at the "
        "places below and write a short progress report:"
    ),
    "ja": "接続済みの GitHub と Notion のツールで、以下の場所の昨日からの進捗を確認し、短い進捗報告にまとめてください：",
}
_SOURCE_LABEL = {"github": "GitHub", "notion": "Notion"}
_COLON = {"zh-TW": "：", "en": ": ", "ja": "："}
_ASCII_WORD = re.compile(r"[A-Za-z0-9 ._-]+")


def _rpc_error(error: MemberError) -> RpcError:
    """A refusal of the store as a bad request whose data names the field."""
    return RpcError(INVALID_PARAMS, f"Invalid params: {error}", {"kind": error.kind})


def _whole(params: dict, name: str, *, least: int = 0) -> int:
    value = params.get(name)
    if type(value) is not int or value < least:
        raise invalid_params(f"{name} must be a whole number of {least} or more")
    return value


def _line(text: str) -> str:
    one = " ".join((text or "").split())
    return one if len(one) <= PREVIEW_CHARS else one[: PREVIEW_CHARS - 1] + "…"


def _preview(turn: Turn) -> str:
    """The last line of a thread as the member column shows it: what was answered, or what was
    asked while there is no answer yet (a routine's title, while it runs)."""
    return _line(turn.text or turn.question)


def routine_view(routine: Routine) -> dict[str, Any]:
    return {
        "id": routine.id,
        "member_id": routine.member_id,
        "title": routine.title,
        "prompt": routine.prompt,
        "schedule": routine.schedule.to_json() if routine.schedule else None,
        "when": routine.when,
        "app_name": routine.app_name,
        "last_checked": routine.last_checked_ms,
        "last_error": routine.last_error,
        "enabled": routine.enabled,
        "last_run": routine.last_run_ms,
        "next_run": routine.next_run_ms,
    }


def group_view(group: Group) -> dict[str, Any]:
    return {
        "id": group.id,
        "name": group.name,
        "position": group.position,
        "sources": [source.to_json() for source in group.sources],
    }


def routine_template(sources: Sequence[Source], language: str) -> dict[str, Any] | None:
    """The routine offered to a member of a group with places to look: every morning at 09:00, a
    progress report read from those places through the connected GitHub and Notion tools. None
    when the group has no place."""
    if not sources:
        return None
    prompt = _TEMPLATE_PROMPT[language]
    for source in sources:
        line = f"\n- {_SOURCE_LABEL[source.kind]}{_COLON[language]}{source.ref}"
        if len(prompt) + len(line) > PROMPT_MAX:
            break
        prompt += line
    return {
        "title": _TEMPLATE_TITLE[language],
        "prompt": prompt,
        "schedule": {"kind": "daily", "time": TEMPLATE_TIME},
    }


@dataclass
class _Picture:
    key: tuple[int, int]  # the file's mtime and size when it was read
    url: str


def soul_document(speaker: Speaker) -> str:
    """Who a member is, as a plain document. Only what the owner filled in has a heading. It says where it
    comes from, since an edit of the file itself is replaced the next time the member changes."""
    parts = [f"# {speaker.name or 'Raphael'}"]
    if speaker.role:
        parts.append(speaker.role)
    if speaker.blurb:
        parts.append(speaker.blurb)
    if speaker.personality:
        parts.append(f"## Personality\n\n{speaker.personality}")
    if speaker.instructions:
        parts.append(f"## Instructions\n\n{speaker.instructions}")
    parts.append("<!-- Written from this member's details in Raphael. Change them there. -->")
    return "\n\n".join(part.strip() for part in parts) + "\n"


class MembersService:
    """The members (see the module). `conn` is the open database (used on the event loop only),
    `local_dir` the app's local folder (the pictures: `avatars\\`, and Raphael's own in `avatar\\`),
    `background` the background worker the routines run on, `memory` the memory (a member's
    folder and summary go with it). `language` is the language of the latest request (the
    assistant's), `notify` sends a notification to the app, `connections` lists the connections
    (`IntegrationsService.connections`). `now_ms` is the wall clock and `tz` the time zone of the
    routines' times (this PC's, by default)."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        local_dir: Path,
        *,
        background: Any,
        memory: Any = None,
        language: Callable[[], str] = lambda: "zh-TW",
        notify: Callable[[str, dict], None] | None = None,
        connections: Callable[[], list[dict[str, Any]]] = lambda: [],
        now_ms: Callable[[], int] = wall_clock_ms,
        tz: tzinfo | None = None,
        tick_s: float = TICK_S,
        vault=None,
    ) -> None:
        self.store = MemberStore(conn, now_ms)
        self.capabilities = MemberCapabilities(conn, local_dir / "member-skills", self.store)
        self._speech = None
        self.greeting = None  # Bound by the interactive AgentService, never the routine worker.
        self._delivered: set[tuple[int, int, str]] = set()
        self._conn = conn
        self._history = AgentHistory(conn, now_ms)
        self._settings = SettingsStore(conn)
        from .activity import Activity
        self.activity = getattr(background, "activity", None) or Activity(notify)
        self.activity.owner_waiting = self.waiting_members
        self.activity.language = lambda: self._ui_language({})
        self._background = background
        self._memory = memory
        self._language = language
        self._notify = notify
        # Told of each member made through the tools: who made it, and which it is.
        self.member_made = lambda maker, made: None
        self.remove_computer_data = None
        self.remove_messaging = None
        self.deleting: set[int] = set()
        self._connections = connections
        self._now_ms = now_ms
        if not self._settings.get("routine_owner_seen_ms"):
            self._settings.set("routine_owner_seen_ms", now_ms())
        self._tz = tz
        self._tick_s = tick_s
        self._avatars = local_dir / AVATARS_DIR
        self._raphael_avatar = local_dir / RAPHAEL_AVATAR_DIR
        self._pictures: dict[Path, _Picture] = {}
        self._viewing: int | None = None
        self.activity.viewing = lambda: self._viewing
        self._waiting_sources: list[Callable[[], Iterable[int]]] = []
        self._events = None
        self._event_poll_task: asyncio.Task | None = None
        self._ticking: asyncio.Task[None] | None = None
        from .webhooks import Webhooks
        from ..integrations.vault import MemoryVault
        self.webhooks = Webhooks(self, vault if vault is not None else MemoryVault())
        from .template_cards import TemplateCards
        self.template_cards = TemplateCards(self)
        self.sync_homes()
        if memory is not None:
            from .skill_review import SkillReview
            memory.skill_review = SkillReview(self, memory)

    def sync_homes(self) -> None:
        """Keep every member's home as it should be, the built-in member's too: its SOUL.md, written from
        its details (the details pane is where the owner edits who it is, and the file is how it reads
        anywhere else), its skills' mirror and a MEMORY.md."""
        homes = self.capabilities.homes
        for identifier in [0, *(member.id for member in self.store.members())]:
            homes.soul(identifier, soul_document(self.speaker(identifier)))
            self.capabilities._mirror(identifier)
            if not (homes.home(identifier) / "MEMORY.md").exists():
                homes.keep(identifier, "MEMORY.md", "")
            homes.safe(homes.state(identifier) / "SOUL.md").unlink(missing_ok=True)  # the old JSON mirror

    def register(self, router: Router) -> None:
        self._management_rpc = router.call
        self.template_cards.register(router)
        methods = {
            "members.skills.list": self._skills_list,
            "members.skills.read": self._skills_read,
            "members.skills.import": self._skills_import,
            "members.skills.update": self._skills_update,
            "members.skills.delete": self._skills_delete,
            "members.commands.list": self._commands_list,
            "members.commands.save": self._commands_save,
            "members.commands.delete": self._commands_delete,
            "members.duplicate": self._duplicate,
            "members.template": self._member_template,
            "members.mark_all_read": self._mark_all_read,
            "members.voices": self._voices,
            "members.list": self._list,
            "members.create": self._create,
            "members.greet": self._greet,
            "members.update": self._update,
            "members.delete": self._delete,
            "members.set_primary": self._set_primary,
            "members.set_avatar": self._set_avatar,
            "members.read": self._read,
            "members.unread": self._unread,
            "members.viewing": self._viewing_now,
            "members.tool_choices": self._tool_choices,
            "groups.create": self._group_create,
            "groups.update": self._group_update,
            "groups.delete": self._group_delete,
            "routines.list": self._routines_list,
            "routines.create": self._routine_create,
            "routines.update": self._routine_update,
            "routines.delete": self._routine_delete,
            "routines.template": self._routine_template,
            "routines.runs": self._routine_runs,
            "routines.run": self._routine_run,
            "routines.webhook": self._routine_webhook,
        }
        for method, handler in methods.items():
            router.register(method, handler)

    # --- the team, as the assistant sees it (agent.team.Team) ----------------------------------------

    def speaker(self, member_id: int) -> Speaker | None:
        if member_id == 0:
            return Speaker(**self.first_bot_profile(), draft_first=self._settings.get("raphael_draft_first"),
                           capabilities=frozenset({"chief"}) if self.store.is_chief(member_id) else frozenset())
        return self.store.speaker(member_id)

    def _chief_pinned(self) -> bool:
        from ..brain.settings import SettingsStore

        return bool(SettingsStore(self._conn).get("chief_pinned"))

    def first_bot_profile(self) -> dict:
        from ..brain.settings import SettingsStore

        return SettingsStore(self._conn).get("first_bot_profile")

    def find(self, name: str) -> Speaker | None:
        if not isinstance(name, str) or not name.strip():
            return None
        if is_raphael_name(name) or name.casefold() == self.first_bot_profile().get("name", "").casefold():
            return self.speaker(0)
        member = self.store.by_name(name)
        return None if member is None else self.speaker(member.id)

    def named_in(self, text: str) -> list[Speaker]:
        """The members whose names `text` holds: a name in Latin letters as a whole word, any
        other name of two characters or more as it is written."""
        folded = (text or "").casefold()
        if not folded:
            return []
        found = []
        for member in self.store.members():
            name = member.name.casefold()
            if _ASCII_WORD.fullmatch(name):
                hit = re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", folded)
            else:
                hit = len(name) >= 2 and name in folded
            if hit:
                found.append(self.speaker(member.id))
        return found

    def has_members(self) -> bool:
        return self._conn.execute("SELECT 1 FROM members LIMIT 1").fetchone() is not None

    def roster(self) -> list[Speaker]:
        """Public inventory never carries another member's private persona or brain."""
        return [Speaker(id=speaker.id, name=speaker.name, role=speaker.role, blurb=speaker.blurb,
                        capabilities=speaker.capabilities)
                for identifier in [0, *(member.id for member in self.store.members())]
                if (speaker := self.speaker(identifier)) is not None]

    def primary_id(self) -> int:
        """The owner's primary contact (0 for Raphael): the one place the roster, the window and the prompts read it from."""
        return self.store.primary_id()

    def team_context(self, self_id=0, language="zh-TW", room_member_ids=None):
        from ..agent.team_context import snapshot
        return snapshot(self, self_id, language, room_member_ids).wire()

    def create(self, *, name: Any, role: Any, instructions: Any, group: Any, personality: Any = "") -> Speaker:
        """Add a member at the owner's request (`create_member`): in the group of that name, made
        when there is none, or in none. MemberError when it cannot be added."""
        group_id = None
        if isinstance(group, str) and group.strip():
            found = self.store.group_by_name(group)
            if found is None:
                found = self.store.create_group(group)
                self._changed()
            group_id = found.id
        member = self.store.create_member(
            name=name, role=role or "", instructions=instructions or "", group_id=group_id,
            personality=personality, model=self._starting_model(),
        )
        self._changed()
        return member.speaker()

    def _starting_model(self) -> str:
        """A new member starts on Raphael's model and holds it as its own, so that his next change moves no one else."""
        model = self._settings.get("agent_model")
        return model.strip() if isinstance(model, str) and model.strip() else DEFAULTS["agent_model"]

    def _changed(self, method: str = "members.changed", member_id: int | None = None) -> None:
        """Announce committed data changes using identifiers only."""
        if method == "members.changed":
            self.sync_homes()
        if self._notify is not None:
            self._notify(method, {} if member_id is None else {"member_id": member_id})

    def member_exists(self, member_id: int) -> bool:
        return self.store.exists(member_id)

    def name_of(self, member_id: int) -> str | None:
        """What the member `member_id` is called (for the overlay's notice of a question that waits
        in its thread); None for one that is not there."""
        try:
            speaker = self.speaker(member_id)
        except sqlite3.Error as exc:
            logger.warning("Could not read a member: %s", type(exc).__name__)
            return None
        return None if speaker is None else speaker.name

    # --- unread and waiting --------------------------------------------------------------------------

    def turn_arrived(self, turn_id: int) -> None:
        """A turn was written or completed: its thread is unread, unless it is on screen or the
        owner heard Raphael's turn said (`source` "voice", member 0)."""
        try:
            self._finish_run(turn_id)
            turn = self._history.get(turn_id)
            if turn is not None and turn.scope != "private":
                return
            if turn is not None and turn.member_id:
                self._deliver_turn(turn)
            if turn is None or (turn.source == "voice" and turn.member_id == 0) or turn.member_id == self._viewing:
                return
            was_unread = turn.member_id in self.store.unread()
            self.store.mark_unread(turn.member_id, turn_id)
            if not was_unread:
                self._changed()
        except sqlite3.Error as exc:
            logger.warning("Could not mark a thread unread: %s", type(exc).__name__)

    def _deliver_turn(self, turn: Turn) -> None:
        kind = "needs_input" if turn.status == "confirm" else "finished" if turn.status == "done" else None
        if kind is None or turn.id is None or (turn.id, turn.created_at_ms, kind) in self._delivered:
            return
        self._delivered.add((turn.id, turn.created_at_ms, kind))
        # Bound the delivery cache without retaining any message contents.
        if len(self._delivered) > 2000:
            self._delivered = {(turn.id, turn.created_at_ms, kind)}
        member = self.store.member(turn.member_id)
        if member is None:
            return
        self._notice(member, kind)

    def _notice(self, member: Member, kind: str) -> None:
        if member.notify and self._notify is not None:
            self._notify("member.notice", {"member_id": member.id, "name": member.name,
                                          "kind": kind, "notify": True})

    def needs_input(self, member_id: int) -> None:
        member = self.store.member(member_id)
        if member is not None:
            self._notice(member, "needs_input")

    def add_waiting_source(self, source: Callable[[], Iterable[int]]) -> None:
        """Add a source of threads with a question waiting for the owner: the members it names
        are `waiting` too. The safety rules' questions from the background come in here."""
        self._waiting_sources.append(source)

    def waiting_members(self) -> set[int]:
        """The members (Raphael as 0) in whose thread a question waits for the owner."""
        waiting = {
            int(row[0])
            for row in self._conn.execute(
                "SELECT DISTINCT member_id FROM agent_turns WHERE scope = 'private' AND status = 'confirm'"
            )
        }
        for source in self._waiting_sources:
            try:
                waiting |= {member for member in source() if type(member) is int}
            except Exception as exc:  # a source that breaks must not break the list
                logger.warning("A source of waiting questions failed: %s", type(exc).__name__)
        return waiting

    # --- the pictures --------------------------------------------------------------------------------

    def _data_url(self, path: Path) -> str | None:
        """The picture at `path` as a data URL, if it is one of the four kinds and not too large.
        Read again only when the file changed."""
        try:
            stat = path.stat()
        except OSError:
            return None
        key = (stat.st_mtime_ns, stat.st_size)
        known = self._pictures.get(path)
        if known is not None and known.key == key:
            return known.url
        if stat.st_size > MAX_IMAGE_BYTES:
            return None
        try:
            data = path.read_bytes()
        except OSError:
            return None
        mime = next((kind for kind in IMAGE_TYPES if sniff_ok(kind, data)), None)
        if mime is None:
            return None
        url = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
        self._pictures[path] = _Picture(key, url)
        return url

    def _avatar_url(self, avatar: str) -> str | None:
        """The picture a member's `avatar` names, as a data URL; None for none, or one that is
        gone (the app shows the default silhouette)."""
        kind, _, name = avatar.partition(":")
        if kind == "file" and name:
            return self._data_url(self._avatars / MEMBERS_DIR / name)
        return None

    def _raphael_picture(self) -> tuple[str, dict] | None:
        """Raphael's picture of the owner's own and its crop, as the shell keeps them; None while he
        is his emblem."""
        try:
            meta = json.loads((self._raphael_avatar / "picture.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        url = self._data_url(self._raphael_avatar / "picture")
        crop = meta.get("crop") if isinstance(meta, dict) else None
        if url is None or not isinstance(crop, dict):
            return None
        return url, {key: crop.get(key) for key in ("x", "y", "zoom")}

    def _remove_picture(self, avatar: str) -> None:
        kind, _, name = avatar.partition(":")
        if kind != "file" or not name:
            return
        path = self._avatars / MEMBERS_DIR / name
        self._pictures.pop(path, None)
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.warning("Could not delete a member's picture: %s", type(exc).__name__)

    # --- views ---------------------------------------------------------------------------------------

    def _member_view(
        self, member: Member, unread: dict[int, int | None], waiting: set[int], latest: dict[int, Turn]
    ) -> dict[str, Any]:
        last = latest.get(member.id)
        activity, activity_label = self.activity.describe(member.id, waiting)
        view: dict[str, Any] = {
            **{field: getattr(member, field) for field in PROFILE_FIELDS},
            "id": member.id,
            "chief": self.store.is_chief(member.id),
            "name": member.name,
            "role": member.role,
            "personality": member.personality,
            "instructions": member.instructions,
            "avatar": member.avatar,
            "group_id": member.group_id,
            "model": member.model,
            "tools": None if member.tools is None else list(member.tools),
            "position": member.position,
            "created": member.created_at_ms,
            "unread": member.id in unread,
            "unread_from": unread.get(member.id),
            "waiting": member.id in waiting,
            "activity": activity,
            "activity_label": activity_label,
            "preview": "" if last is None else _preview(last),
            "last_at": None if last is None else last.created_at_ms,
        }
        url = self._avatar_url(member.avatar) if member.avatar else None
        if url is not None:
            view["avatar_url"] = url
        return view

    def _raphael_view(
        self, language: str, unread: dict[int, int | None], waiting: set[int], latest: dict[int, Turn]
    ) -> dict[str, Any]:
        last = latest.get(0)
        activity, activity_label = self.activity.describe(0, waiting)
        view: dict[str, Any] = {
            "blurb": "", "reply_style": "full", "voice": "",
            "notify": False, "ask_before_members": False, "pinned": self._chief_pinned(), "hidden": False, "draft_first": self._settings.get("raphael_draft_first"),
            "id": 0,
            "chief": self.store.is_chief(0),
            "name": RAPHAEL_NAMES[language],
            "role": "",
            "personality": "",
            "instructions": "",
            "avatar": "",
            "group_id": None,
            "model": "",
            "tools": None,
            "position": -1,
            "created": 0,
            "unread": 0 in unread,
            "unread_from": unread.get(0),
            "waiting": 0 in waiting,
            "activity": activity,
            "activity_label": activity_label,
            "preview": "" if last is None else _preview(last),
            "last_at": None if last is None else last.created_at_ms,
        }
        picture = self._raphael_picture()
        profile = self.first_bot_profile()
        view.update(profile)
        view["profile_ready"] = bool(profile)
        if picture is not None:
            view["avatar_url"], view["avatar_crop"] = picture
        return view

    def view_of(self, member: Member) -> dict[str, Any]:
        """One member as `members.list` shows it."""
        latest = {}
        last = self._history.list(1, member_id=member.id)
        if last:
            latest[member.id] = last[0]
        return self._member_view(member, self.store.unread_from(), self.waiting_members(), latest)

    def _ui_language(self, params: dict) -> str:
        language = params.get("ui_language")
        if language is None:
            return normalize_language(self._language())
        if not isinstance(language, str):
            raise invalid_params("ui_language must be a string")
        return normalize_language(language)

    # --- members.* -----------------------------------------------------------------------------------

    def expand_command(self, member_id: int, text: str) -> str:
        return self.capabilities.expand(member_id, text)

    def resolve_slash(self, member_id: int, text: str) -> tuple[str, bool]:
        return self.capabilities.resolve_slash(member_id, text)

    def enabled_skills(self, member_id: int) -> list[dict]:
        return [skill for skill in self.capabilities.skills(member_id) if skill["enabled"]]

    def native_skills(self, member_id: int) -> list[dict]:
        return self.capabilities.native_skills(member_id)

    def skill_learned(self, member_id, skill, turn_id=None):
        self._changed("members.skills.changed", member_id)
        self._changed()
        if turn_id and skill["provenance"] == "learned":
            turn = self._history.get(turn_id)
            if turn is not None and turn.member_id == member_id:
                self._history.add_message(turn_id, "event", json.dumps({"type": "skill_learned", "name": skill["name"]}, ensure_ascii=False))
                if self._notify:
                    self._notify("agent.turn", {"turn_id": turn_id, "member_id": member_id})

    def skill_read(self, member_id: int, name: object) -> str | None:
        try:
            return self.capabilities.read_skill(member_id, name)
        except (OSError, MemberError):
            return None

    def _cap(self, method, *args):
        from ..bots.homes import HomeError
        try:
            return method(*args)
        except MemberError as error:
            raise _rpc_error(error) from None
        except HomeError as error:
            raise invalid_params(str(error)) from None

    def _cap_member(self, params: dict) -> int:
        member_id = _whole(params, "member_id")
        self._cap(self.capabilities.check, member_id)
        return member_id

    def _skill_scope(self, params: dict) -> int:
        member_id = self._cap_member(params)
        if type(params.get("shared", False)) is not bool:
            raise invalid_params("shared must be true or false")
        return -1 if params.get("shared") else member_id

    async def _skills_list(self, params: dict) -> dict:
        member_id = self._skill_scope(params)
        result = {"skills": self._cap(self.capabilities.skills, member_id), "undo": self.capabilities.undo_revision(member_id)}
        result["sets"] = self._cap(self.capabilities.plugin_sets) if member_id == -1 or params.get("discover") is True else []
        if params.get("discover") is True:
            result["sources"] = self._cap(self.capabilities.plugin_sources)
            result["marketplaces"] = [json.loads(row[0]) for row in self._conn.execute("SELECT catalog FROM skill_marketplaces ORDER BY repo")]
        if "marketplace" in params:
            try:
                result["marketplace"] = await self.capabilities.add_marketplace(params["marketplace"])
                result["sets"] = self.capabilities.plugin_sets()
            except MemberError as error:
                raise _rpc_error(error) from None
        return result

    async def _skills_import(self, params: dict) -> dict:
        member_id = self._skill_scope(params)
        added = []
        try:
            source = params.get("source")
            if params.get("plugin") is True or "set_id" in params or "marketplace" in params:
                if member_id != -1:
                    raise MemberError("scope", "plugin sets belong to the shared library")
                identifier = _whole(params, "set_id", least=1) if "set_id" in params else None
                installed = await self.capabilities.import_plugin(source, set_id=identifier, marketplace=params.get("marketplace"), name=params.get("name"))
                self._changed("members.skills.changed", 0)
                self._changed()
                return {"set": installed, "skills": self.capabilities.skills(-1)}
            if isinstance(source, str) and source.startswith("local:"):
                skill = self.capabilities.import_local(member_id, source)
                self._changed("members.skills.changed", 0 if member_id == -1 else member_id)
                self._changed()
                return {"skill": skill, "skills": [skill]}
            documents = await download_skills(source)
            for source, text in documents:
                added.append(self.capabilities.keep_skill(member_id, source, text))
        except MemberError as error:
            for skill in added:
                self.capabilities.delete_skill(member_id, skill["id"])
            raise _rpc_error(error) from None
        self._changed("members.skills.changed", member_id)
        self._changed()
        return {"skill": added[0], "skills": added}

    async def _skills_read(self, params: dict) -> dict:
        """A skill and its whole document, for the owner's page of it (the model reads one by `skill_read`)."""
        skill, text = self._cap(self.capabilities.document, self._skill_scope(params), _whole(params, "id", least=1))
        return {"skill": skill, "text": text}

    async def _skills_update(self, params: dict) -> dict:
        """The skill switched on or off (`enabled`), its document edited (`text`), or both: the switch is
        checked first, so that a refused edit changes nothing."""
        member_id = self._skill_scope(params)
        if "undo" in params:
            self._cap(self.capabilities.undo_skills, member_id, params["undo"])
            self._changed("members.skills.changed", member_id)
            self._changed()
            return {"skills": self.capabilities.skills(member_id), "undo": self.capabilities.undo_revision(member_id)}
        skill_id = _whole(params, "id", least=1)
        enabled = params.get("enabled")
        if "text" in params:
            if "enabled" in params and type(enabled) is not bool:
                raise _rpc_error(MemberError("enabled", "enabled must be true or false"))
            if "expected_hash" in params:
                current = self._cap(self.capabilities.document, member_id, skill_id)[0]
                if params["expected_hash"] != current["revision"]:
                    raise invalid_params("skill changed; read it again before writing")
            skill = self._cap(self.capabilities.rewrite_skill, member_id, skill_id, params["text"])
            if "enabled" in params:
                skill = self._cap(self.capabilities.update_skill, member_id, skill_id, enabled)
        else:
            skill = self._cap(self.capabilities.update_skill, member_id, skill_id, enabled)
        self._changed("members.skills.changed", member_id)
        self._changed()
        return {"skill": skill}

    async def _skills_delete(self, params: dict) -> dict:
        member_id = self._skill_scope(params)
        if "set_id" in params:
            if member_id != -1:
                raise invalid_params("plugin sets belong to the shared library")
            deleted = self._cap(self.capabilities.delete_set, _whole(params, "set_id", least=1))
            self._changed("members.skills.changed", 0)
            self._changed()
            return {"deleted": deleted}
        deleted = self._cap(self.capabilities.delete_skill, member_id, _whole(params, "id", least=1))
        self._changed("members.skills.changed", member_id)
        self._changed()
        return {"deleted": deleted}

    async def _commands_list(self, params: dict) -> dict:
        return {"commands": self._cap(self.capabilities.commands, self._cap_member(params))}

    async def _commands_save(self, params: dict) -> dict:
        member_id = self._cap_member(params)
        command_id = _whole(params, "id", least=1) if "id" in params else None
        command = self._cap(self.capabilities.save_command, member_id, command_id,
                            params.get("name"), params.get("description", ""), params.get("template"))
        self._changed("members.commands.changed", member_id)
        self._changed()
        return {"command": command}

    async def _commands_delete(self, params: dict) -> dict:
        member_id = self._cap_member(params)
        deleted = self._cap(self.capabilities.delete_command, member_id, _whole(params, "id", least=1))
        self._changed("members.commands.changed", member_id)
        self._changed()
        return {"deleted": deleted}

    async def _mark_all_read(self, params: dict) -> dict:
        with self._conn:
            self._conn.execute("DELETE FROM member_unread")
        self._changed()
        return {}

    async def _duplicate(self, params: dict) -> dict:
        member_id = self._member_id(params)
        original = self.store.member(member_id)
        assert original is not None
        for number in range(2, 1000):
            suffix = f" ({number})"
            name = original.name[:NAME_MAX - len(suffix)] + suffix
            if self.store.by_name(name) is None:
                break
        fields = {field: getattr(original, field) for field in
                  ("role", "personality", "instructions", "group_id", "avatar", "model", *PROFILE_FIELDS)}
        copy = None
        try:
            copy = self.store.create_member(name=name, **fields)
            for command in self.capabilities.commands(member_id):
                self.capabilities.save_command(copy.id, None, command["name"], command["description"], command["template"])
            for skill in self.capabilities.skills(member_id):
                text = self.capabilities._path(member_id, skill["id"]).read_text(encoding="utf-8")
                saved = self.capabilities.keep_skill(copy.id, skill["source"], text)
                self.capabilities.update_skill(copy.id, saved["id"], skill["enabled"])
        except (MemberError, OSError) as error:
            if copy is not None:
                for skill in self.capabilities.skills(copy.id):
                    self.capabilities.delete_skill(copy.id, skill["id"])
                self.store.delete_member(copy.id)
            raise _rpc_error(error if isinstance(error, MemberError) else MemberError("io", "could not copy skills")) from None
        self._changed()
        return {"member": self.view_of(copy)}

    def use_speech(self, speech) -> None:
        self._speech = speech

    async def _voices(self, params: dict) -> dict:
        voice = self._settings.get("tts_fish_voice")
        configured = bool(self._speech and self._speech.speaks())
        return {"voices": [{"id": voice, "name": "Fish Audio"}] if voice else [], "configured": configured}

    async def _list(self, params: dict) -> dict:
        if "panel_member_id" in params:
            member = _whole(params, "panel_member_id")
            if not self.member_exists(member):
                raise invalid_params("no such member")
            from .panel import snapshot
            workspaces = getattr(self, "panel_workspaces", lambda member: [])(member)
            return snapshot(self._conn, member, workspaces, _whole({"panel_limit": 12, **params}, "panel_limit", least=1))
        language = self._ui_language(params)
        unread = self.store.unread_from()
        waiting = self.waiting_members()
        latest = self._history.latest_by_member()
        members = [self._raphael_view(language, unread, waiting, latest)]
        members += [self._member_view(m, unread, waiting, latest) for m in self.store.members()]
        return {"members": members, "groups": [group_view(g) for g in self.store.groups()],
                "team_context": self.team_context(0, language)}

    def _member_id(self, params: dict) -> int:
        """The `id` of a member that is there (never Raphael's: he is not changed here)."""
        member_id = _whole(params, "id")
        if member_id == 0:
            raise RpcError(
                INVALID_PARAMS, "Invalid params: Raphael is not changed here", {"kind": "raphael"}
            )
        if self.store.member(member_id) is None:
            raise RpcError(INVALID_PARAMS, "Invalid params: no such member", {"kind": "not_found"})
        return member_id

    async def _create(self, params: dict) -> dict:
        avatar = params.get("avatar", "")
        if isinstance(avatar, str) and avatar.startswith("file:"):
            raise RpcError(
                INVALID_PARAMS, "Invalid params: a picture comes by members.set_avatar",
                {"kind": "avatar"},
            )  # fmt: skip
        try:
            member = self.store.create_member(
                name=params.get("name"),
                role=params.get("role", ""),
                instructions=params.get("instructions", ""),
                personality=params.get("personality", ""),
                group_id=params.get("group_id"),
                avatar=avatar if avatar is not None else "",
                tools=params.get("tools"),
                model=params.get("model", "") or self._starting_model(),
                **{field: params[field] for field in PROFILE_FIELDS if field in params},
            )
        except MemberError as error:
            raise _rpc_error(error) from None
        logger.info("A member was added")
        group = None if member.group_id is None else self.store.group(member.group_id)
        language = self._ui_language(params)
        offer = routine_template(group.sources if group else (), language)
        if params.get("greet") is True:
            self.greeting(member.id, language)
        self._changed()
        return {"member": self.view_of(member), "routine_offer": offer}

    async def _greet(self, params: dict) -> dict:
        member_id = self._member_id(params)
        owner = self._conn.execute(
            "SELECT 1 FROM agent_turns WHERE member_id=? AND scope='private' AND trim(question)<>'' "
            "AND source NOT IN ('greeting','member','routine','resumed') LIMIT 1", (member_id,),
        ).fetchone()
        running = self._conn.execute(
            "SELECT 1 FROM agent_turns WHERE member_id=? AND source='greeting' AND status='running' LIMIT 1",
            (member_id,),
        ).fetchone()
        if owner or running:
            raise invalid_params("greeting requires a conversation without an owner message or running greeting")
        failed = self._conn.execute(
            "SELECT id FROM agent_turns WHERE member_id=? AND source='greeting' AND status='error'", (member_id,),
        ).fetchall()
        result = self.greeting(member_id, self._ui_language(params))
        for row in failed:
            self._history.delete(row['id'])
            if self._notify is not None:
                self._notify("agent.turn", {"turn_id": row['id'], "member_id": member_id})
        return result

    async def _member_template(self, params):
        from .templates import handle
        try:
            return await handle(self, params)
        except MemberError as error:
            raise _rpc_error(error) from None

    async def set_my_job(self, member_id: int, arguments: dict) -> dict:
        """A new member saves the job its owner has just given it. Once only: after that the job is the owner's to edit."""
        member = self.store.member(member_id)
        if member is None or self.store.is_chief(member_id):
            raise invalid_params("only a member can take a job")
        if member.role or member.instructions:
            raise invalid_params("this member has a job already")
        saved = await self._update({"id": member_id, "role": arguments.get("role"), "instructions": arguments.get("instructions")})
        return {"role": saved["member"]["role"], "note": "Saved. The owner can see it in your details."}

    async def _update(self, params: dict) -> dict:
        if type(params.get("id")) is int and params["id"] == 0 and set(params) == {"id", "draft_first"}:
            try:
                self._settings.set("raphael_draft_first", params["draft_first"])
            except (ValueError, TypeError):
                raise invalid_params("draft_first must be a boolean") from None
            self._changed()
            return {"member": self._raphael_view(self._language(), {}, set(), {})}
        member_id = self._member_id(params)
        fields = {
            name: params[name]
            for name in ("name", "role", "personality", "instructions", "group_id", "avatar", "tools", "model", "position", *PROFILE_FIELDS)
            if name in params
        }
        avatar = fields.get("avatar")
        if isinstance(avatar, str) and avatar.startswith("file:"):
            raise RpcError(
                INVALID_PARAMS, "Invalid params: a picture comes by members.set_avatar",
                {"kind": "avatar"},
            )  # fmt: skip
        if fields.get("model", "") is None:
            fields["model"] = ""
        old = self.store.member(member_id)
        try:
            member = self.store.update_member(member_id, **fields)
        except MemberError as error:
            raise _rpc_error(error) from None
        if old is not None and "avatar" in fields and old.avatar != member.avatar:
            if not any(other.id != member_id and other.avatar == old.avatar for other in self.store.members()):
                self._remove_picture(old.avatar)
        self._changed()
        return {"member": self.view_of(member)}

    async def _delete(self, params: dict) -> dict:
        member_id = self._member_id(params)
        if type(params.get("remove_computer_data", False)) is not bool:
            raise invalid_params("remove_computer_data must be a boolean")
        if params.get("remove_computer_data"):
            if self.remove_computer_data is None:
                raise invalid_params("Computer data removal unavailable")
            await self.remove_computer_data(member_id, params.get("computer_host"))
        member = self.store.member(member_id)
        assert member is not None
        self.deleting.add(member_id)
        try:
            if self.remove_messaging is not None:
                await self.remove_messaging(member_id)
            self._background.forget_member(member_id)
            try:
                self._history.clear_member(member_id)
            except sqlite3.Error as exc:
                logger.warning("Could not delete a member's conversation: %s", type(exc).__name__)
            if self._memory is not None:
                await self._memory.forget_member(member_id)
            for skill in self.capabilities.skills(member_id):
                self.capabilities.delete_skill(member_id, skill["id"])
            # Uploaded avatars can be shared by a duplicated profile.
            if not any(other.id != member_id and other.avatar == member.avatar for other in self.store.members()):
                self._remove_picture(member.avatar)
            deleted = self.store.delete_member(member_id)
            if self._viewing == member_id:
                self._viewing = None
            if deleted:
                await self.webhooks.sync()
                self._changed()
                self._changed("routines.changed", member_id)
            logger.info("A member was deleted")
            return {"deleted": deleted}
        finally:
            self.deleting.discard(member_id)

    async def _set_primary(self, params: dict) -> dict:
        member_id = _whole(params, "id")
        try:
            changed = self.store.set_primary(member_id)
        except MemberError as error:
            raise _rpc_error(error) from None
        if changed:
            logger.info("The primary contact was changed")
            self._changed()
        return {"primary_id": member_id}

    async def _set_avatar(self, params: dict) -> dict:
        member_id = self._member_id(params)
        name, mime, data = params.get("name"), params.get("mime"), params.get("data")
        if not isinstance(name, str) or not isinstance(mime, str) or not isinstance(data, str):
            raise invalid_params("name, mime and data must be strings")
        if len(data) > (MAX_IMAGE_BYTES * 4) // 3 + 8:
            raise RpcError(INVALID_PARAMS, "Invalid params: avatar (size)", {"kind": "size"})
        try:
            raw = base64.b64decode(data, validate=True)
            picture = checked(name, mime, raw, max_bytes=MAX_IMAGE_BYTES)
        except (binascii.Error, ValueError) as error:
            kind = error.kind if isinstance(error, AttachmentError) else "data"
            raise RpcError(INVALID_PARAMS, f"Invalid params: avatar ({kind})", {"kind": kind}) from None
        if not picture.is_image:
            raise RpcError(INVALID_PARAMS, "Invalid params: avatar (type)", {"kind": "type"})
        folder = self._avatars / MEMBERS_DIR
        stored = f"{member_id}-{secrets.token_hex(6)}.{_EXTENSIONS[picture.mime]}"

        def write() -> None:
            folder.mkdir(parents=True, exist_ok=True)
            part = folder / f"{stored}.part"
            part.write_bytes(picture.data)
            part.replace(folder / stored)

        try:
            await asyncio.to_thread(write)
        except OSError as exc:
            logger.warning("Could not keep a member's picture: %s", type(exc).__name__)
            raise RpcError(INVALID_PARAMS, "Invalid params: avatar (io)", {"kind": "io"}) from None
        old = self.store.member(member_id)
        member = self.store.update_member(member_id, avatar=f"file:{stored}")
        if old is not None and old.avatar != member.avatar:
            if not any(other.id != member_id and other.avatar == old.avatar for other in self.store.members()):
                self._remove_picture(old.avatar)
        logger.info("A member's picture was set (%s, %d bytes)", picture.mime, len(picture.data))
        self._changed()
        return {"member": self.view_of(member)}

    async def _unread(self, params: dict) -> dict:
        member_id = _whole(params, "id")
        if not self.store.exists(member_id):
            raise invalid_params("no such member")
        self.store.mark_unread(member_id)
        self._changed()
        return {}

    async def _read(self, params: dict) -> dict:
        member_id = _whole(params, "id")
        if not self.store.exists(member_id):
            raise RpcError(INVALID_PARAMS, "Invalid params: no such member", {"kind": "not_found"})
        self.activity.seen(member_id)
        if self.store.mark_read(member_id):
            self._changed()
        return {}

    async def _viewing_now(self, params: dict) -> dict:
        if "tz" in params:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
            try:
                name = params["tz"]
                if not isinstance(name, str) or len(name) > 100:
                    raise ValueError
                ZoneInfo(name)
            except (ValueError, ZoneInfoNotFoundError):
                raise invalid_params("tz must be an IANA time zone") from None
        if params.get("activity_only") is True:
            self.pause_absent_routines()
            if "tz" in params:
                self.observe_timezone(name)
            self._settings.set("routine_owner_seen_ms", self._now_ms())
            return {}
        member_id = params.get("id")
        if member_id is not None:
            member_id = _whole(params, "id")
            if not self.store.exists(member_id):
                raise RpcError(
                    INVALID_PARAMS, "Invalid params: no such member", {"kind": "not_found"}
                )
            self.activity.seen(member_id)
            if self.store.mark_read(member_id):
                self._changed()
        self.pause_absent_routines()
        if "tz" in params:
            self.observe_timezone(name)
        self._settings.set("routine_owner_seen_ms", self._now_ms())
        self._viewing = member_id
        return {}

    async def _tool_choices(self, params: dict) -> dict:
        try:
            connections = self._connections()
        except Exception as exc:  # the list of connections must not break the panel
            logger.warning("Could not list the connections: %s", type(exc).__name__)
            connections = []
        return {"tools": list(BUILTIN_TOOL_IDS), "connections": connections}

    # --- groups.* ------------------------------------------------------------------------------------

    def _group_id(self, params: dict) -> int:
        group_id = _whole(params, "id", least=1)
        if self.store.group(group_id) is None:
            raise RpcError(INVALID_PARAMS, "Invalid params: no such group", {"kind": "not_found"})
        return group_id

    async def _group_create(self, params: dict) -> dict:
        try:
            group = self.store.create_group(params.get("name"))
        except MemberError as error:
            raise _rpc_error(error) from None
        self._changed()
        return {"group": group_view(group)}

    async def _group_update(self, params: dict) -> dict:
        group_id = self._group_id(params)
        try:
            group = self.store.update_group(
                group_id,
                name=params.get("name"),
                position=params.get("position"),
                sources=params.get("sources"),
            )
        except MemberError as error:
            raise _rpc_error(error) from None
        self._changed()
        return {"group": group_view(group)}

    async def _group_delete(self, params: dict) -> dict:
        deleted = self.store.delete_group(self._group_id(params))
        if deleted:
            self._changed()
        return {"deleted": deleted}

    # --- routines.* ----------------------------------------------------------------------------------

    def observe_timezone(self, name: str) -> None:
        """Pin legacy schedules before following a changed computer zone for new routines."""
        previous = self._settings.get("routine_detected_timezone") or name
        if self._settings.get("routine_detected_timezone") == name:
            return
        with self._conn:
            for routine in self.store.routines():
                if routine.schedule and not routine.schedule.timezone:
                    plan = replace(routine.schedule, timezone=self._settings.get("routine_timezone") or previous)
                    self._conn.execute("UPDATE routines SET schedule=? WHERE id=?", (json.dumps(plan.to_json()), routine.id))
        self._settings.set("routine_detected_timezone", name)

    def _saved_schedule(self, value, existing=None):
        if not isinstance(value, dict):
            return value
        zone = (existing.schedule.timezone if existing and existing.schedule else "") or value.get("timezone") or self._settings.get("routine_timezone") or self._settings.get("routine_detected_timezone") or getattr(self._tz, "key", "")
        return {**value, **({"timezone": zone} if zone else {})}

    def _next(self, schedule: Schedule) -> int | None:
        return next_run(schedule, self._now_ms(), tz=self._tz)

    def _routine_member(self, params: dict) -> int:
        member_id = _whole(params, "member_id")
        if not self.store.exists(member_id):
            raise RpcError(INVALID_PARAMS, "Invalid params: no such member", {"kind": "not_found"})
        return member_id

    def _routine_id(self, params: dict) -> int:
        routine_id = _whole(params, "id", least=1)
        if self.store.routine(routine_id) is None:
            raise RpcError(INVALID_PARAMS, "Invalid params: no such routine", {"kind": "not_found"})
        return routine_id

    async def routine_tool(self, member_id: int, name: str, arguments: dict) -> dict:
        """Shared work tools act on the speaker's own routines only."""
        handlers = {"routine_list": self._routines_list, "routine_create": self._routine_create,
                    "routine_update": self._routine_update, "routine_delete": self._routine_delete}
        if name not in handlers:
            raise invalid_params("unknown routine tool")
        target = _whole(arguments, "member_id") if "member_id" in arguments else member_id
        if target != member_id:
            raise invalid_params("Use primary-contact management tools in the owner's interactive chat for another member's routines")
        params = {**arguments, "member_id": target}
        if name in ("routine_update", "routine_delete"):
            routine_id = self._routine_id(params)
            routine = self.store.routine(routine_id)
            if routine.member_id != target:
                raise invalid_params("routine belongs to another speaker")
        result = await handlers[name](params)
        if name == "routine_delete":
            result["routine"] = {"id": routine.id, "title": routine.title, "member_id": routine.member_id}
        return result

    def admin_confirmation(self, name: str, arguments: dict, language: str, *, question: bool = True) -> str:
        from ..agent.team_admin import confirmation
        from ..management import resolve

        action, values = resolve(name, arguments)
        traditional = {"member_create", "member_update", "member_delete", "group_create", "group_rename",
                       "member_skill_import", "member_command_save"}
        if action is not None and name not in traditional:
            labels = {"en": "Affected target", "zh-TW": "影響對象", "ja": "対象"}
            target = self.management_target(name, arguments)
            values = {key: value for key, value in values.items() if key != "data"}
            if "data" in arguments:
                values["image"] = arguments.get("name", "uploaded image")
            heading = {"en": "Requested change", "zh-TW": "要求的變更", "ja": "変更内容"}[language]
            scope = action.description if language == "en" else self.management_label(action.name, language)
            return (f"{heading}: {scope}\n{labels[language]}: {target}\n"
                    + json.dumps(values, ensure_ascii=False, indent=2)
                    + ({"en": "\nAllow this change?", "zh-TW": "\n允許這項變更嗎？", "ja": "\nこの変更を許可しますか？"}[language] if question else ""))

        identifier = arguments.get("member_id", 0) if name.startswith("routine_") else arguments.get("member_id", arguments.get("id"))
        target = ""
        if type(identifier) is int:
            if name == "group_rename":
                group = self.store.group(identifier)
                target = group.name if group else ""
            else:
                target = self.name_of(identifier) or ""
        if name in ("routine_update", "routine_delete") and type(arguments.get("id")) is int:
            routine = self.store.routine(arguments["id"])
            if routine:
                target += f" / {routine.title}"
        if name in ("member_create", "create_member", "member_update"):
            current = self.store.member(identifier) if name == "member_update" and type(identifier) is int else None
            group = self.store.group(current.group_id) if current and current.group_id else None
            arguments = {"name": current.name if current else "", "role": current.role if current else "",
                         "blurb": current.blurb if current else "", "group": group.name if group else "", **arguments}
        text = confirmation(name, arguments, language, target, question=False)
        original_fields = {"id", "name", "role", "blurb", "personality", "instructions", "group", "avatar_preset", "source", "member_id", "description", "template"}
        extra = {key: value for key, value in arguments.items() if key not in original_fields}
        if extra:
            text += "\n" + json.dumps(extra, ensure_ascii=False, indent=2)
        return text + ({"en": "\nAllow this change?", "zh-TW": "\n允許這項變更嗎？", "ja": "\nこの変更を許可しますか？"}[language] if question else "")

    async def admin_drafts(self, operations: list[dict]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Build structured member and group drafts for a pending team administration batch."""
        from ..agent.team_admin import GroupDraft, MemberDraft

        existing_groups = {group.name.casefold() for group in self.store.groups()}
        drafts: list[dict[str, Any]] = []
        groups: list[dict[str, Any]] = []
        seen_groups: set[str] = set()
        for op in operations:
            name = op.get("name")
            arguments = dict(op.get("arguments") or {})
            if name in ("member_create", "create_member", "member_update"):
                is_update = name == "member_update"
                target_id = arguments.get("id") if is_update else None
                current = self.store.member(target_id) if is_update and type(target_id) is int else None
                if is_update and target_id == 0:
                    from types import SimpleNamespace
                    current = SimpleNamespace(name=RAPHAEL_NAMES[self._language()], role="", personality="", instructions="",
                                              blurb="", avatar="", group_id=None)
                    for field, value in self.first_bot_profile().items():
                        setattr(current, field, value)
                current_group = self.store.group(current.group_id) if current and current.group_id else None
                group_val = arguments.get("group", current_group.name if current_group else "")
                group_name = group_val.strip() if isinstance(group_val, str) else ""
                wanted = arguments.get("avatar_preset", current.avatar if current else "")
                avatar_preset = wanted if isinstance(wanted, str) and wanted.startswith(SLIME) else ""
                draft = MemberDraft(
                    id=f"draft-{len(drafts) + 1}",
                    name=str(arguments.get("name", current.name if current else "") or ""),
                    role=str(arguments.get("role", current.role if current else "") or ""),
                    blurb=str(arguments.get("blurb", current.blurb if current else "") or ""),
                    personality=str(arguments.get("personality", current.personality if current else "") or ""),
                    instructions=str(arguments.get("instructions", current.instructions if current else "") or ""),
                    group=group_name,
                    avatar_preset=avatar_preset,
                    member_id=target_id if is_update and type(target_id) is int else None,
                )
                drafts.append(draft.to_json())
                if group_name and group_name.casefold() not in existing_groups and group_name.casefold() not in seen_groups:
                    seen_groups.add(group_name.casefold())
                    groups.append(GroupDraft(id=f"group-{len(groups) + 1}", name=group_name).to_json())
            elif name == "group_create":
                raw_gname = arguments.get("name")
                group_name = raw_gname.strip() if isinstance(raw_gname, str) else ""
                if group_name and group_name.casefold() not in seen_groups:
                    seen_groups.add(group_name.casefold())
                    groups.append(GroupDraft(id=f"group-{len(groups) + 1}", name=group_name).to_json())
            elif name == "group_rename":
                raw_gname = arguments.get("name")
                group_name = raw_gname.strip() if isinstance(raw_gname, str) else ""
                gid = arguments.get("id")
                groups.append(
                    GroupDraft(
                        id=f"group-{len(groups) + 1}",
                        name=group_name,
                        group_id=gid if type(gid) is int else None,
                    ).to_json()
                )
        return drafts, groups

    def plan_admin_batch(
        self,
        operations: list[dict],
        *,
        drafts: list[dict] | None = None,
        groups: list[dict] | None = None,
    ) -> list[dict]:
        """Resolve a batch into the operations to execute, applying any owner edits to drafts."""
        if drafts is None and groups is None:
            return list(operations)
        planned: list[dict] = []
        if groups is not None:
            if not isinstance(groups, list):
                raise invalid_params("groups must be a list")
            for item in groups:
                if not isinstance(item, dict):
                    raise invalid_params("invalid group draft")
                raw = dict(item)
                raw_id = raw.pop("id", None)
                gid = raw.pop("group_id", raw_id if type(raw_id) is int else None)
                if gid is not None:
                    raw["id"] = gid
                    planned.append({"name": "group_rename", "arguments": raw})
                else:
                    planned.append({"name": "group_create", "arguments": raw})
        else:
            had_member_ops = any(
                op["name"] in ("member_create", "create_member", "member_update") for op in operations
            )
            member_groups = {
                op["arguments"].get("group", "").strip().casefold()
                for op in operations
                if op["name"] in ("member_create", "create_member", "member_update")
                and isinstance(op["arguments"].get("group"), str)
            }
            for op in operations:
                if op["name"] == "group_rename" and (drafts or not had_member_ops):
                    planned.append(op)
                elif op["name"] == "group_create":
                    raw_name = op["arguments"].get("name")
                    gname = raw_name.strip().casefold() if isinstance(raw_name, str) else ""
                    if gname not in member_groups and (drafts or not had_member_ops):
                        planned.append(op)
        if drafts is not None:
            if not isinstance(drafts, list):
                raise invalid_params("drafts must be a list")
            creates = sum(
                1
                for item in drafts
                if isinstance(item, dict) and item.get("member_id") is None and type(item.get("id")) is not int
            )
            if creates > 10:
                raise invalid_params("member_create_limit")
            for item in drafts:
                if not isinstance(item, dict):
                    raise invalid_params("invalid member draft")
                raw = dict(item)
                raw_id = raw.pop("id", None)
                target_id = raw.pop("member_id", raw_id if type(raw_id) is int else None)
                if target_id is not None:
                    original = next((op["arguments"] for op in operations
                                     if op["name"] == "member_update" and op["arguments"].get("id") == target_id), {})
                    # The editable draft contains persona fields. Preserve the
                    # other fields the owner saw in the full permission details.
                    raw = {**original, **raw}
                    raw["id"] = target_id
                    planned.append({"name": "member_update", "arguments": raw})
                else:
                    index = sum(op["name"] == "member_create" for op in planned)
                    originals = [op["arguments"] for op in operations if op["name"] in ("member_create", "create_member")]
                    if index < len(originals):
                        raw = {**originals[index], **raw}
                    raw.setdefault("role", "")
                    planned.append({"name": "member_create", "arguments": raw})
        else:
            planned.extend(
                op for op in operations if op["name"] in ("member_create", "create_member", "member_update")
            )
        return planned

    async def admin_batch(
        self,
        member_id: int,
        operations: list[dict],
        *,
        drafts: list[dict] | None = None,
        groups: list[dict] | None = None,
        interactive: bool = False,
    ) -> list[dict]:
        """Apply the approved list atomically and publish only committed roster changes."""
        from ..agent.team_admin import BATCH_TOOLS

        if not interactive or not self.store.is_chief(member_id) or not operations or any(op["name"] not in BATCH_TOOLS for op in operations):
            raise invalid_params("invalid team administration batch")
        planned = self.plan_admin_batch(operations, drafts=drafts, groups=groups)
        allowed_targets = {op["arguments"].get("id") for op in operations if op["name"] == "member_update"}
        allowed_groups = {op["arguments"].get("id") for op in operations if op["name"] == "group_rename"}
        create_limit = sum(op["name"] in ("member_create", "create_member") for op in operations)
        if (sum(op["name"] == "member_create" for op in planned) > create_limit
                or any(op["arguments"].get("id") not in allowed_targets for op in planned if op["name"] == "member_update")
                or any(op["arguments"].get("id") not in allowed_groups for op in planned if op["name"] == "group_rename")):
            raise invalid_params("edited drafts exceed the proposed scope")
        if not planned:
            return []
        notifications, pictures = [], []
        notify, remove_picture = self._notify, self._remove_picture
        self._notify = lambda method, data: notifications.append((method, data))
        self._remove_picture = pictures.append
        try:
            with self.store.transaction():
                results = [await self.admin_tool(member_id, "member_create" if op["name"] == "create_member" else op["name"], op["arguments"], interactive=True)
                           for op in planned]
        finally:
            self._notify, self._remove_picture = notify, remove_picture
        for picture in pictures:
            remove_picture(picture)
        if notify is not None:
            for method, data in notifications:
                notify(method, data)
        return results

    @staticmethod
    def management_label(name, language):
        labels = {
            "member_primary": ("移轉主要聯絡人與管理權", "主担当と管理権限を移動"),
            "member_history_clear": ("清除此成員的全部對話紀錄", "メンバーの全会話履歴を消去"),
            "member_history_delete": ("刪除此則對話紀錄", "会話記録を削除"),
            "group_delete": ("刪除資料夾；成員保留並移至未分類", "フォルダーを削除しメンバーは保持"),
            "room_members": ("替換群聊成員；移除下列成員", "グループのメンバーを置換"),
            "room_delete": ("刪除群聊及全部訊息", "グループと全メッセージを削除"),
            "conversation_clear": ("清除此對話的全部紀錄", "会話の全記録を消去"),
            "member_skill_delete": ("刪除技能套件與授權", "スキルと権限を削除"),
            "member_skill_undo": ("???????????????", "???????????????????"),
            "member_command_delete": ("刪除成員指令", "コマンドを削除"),
            "member_routine_delete": ("刪除例行任務及排程", "定期タスクと予定を削除"),
            "connection_disconnect": ("中斷連線並撤銷認證", "接続と認証を解除"),
            "connector_disconnect": ("中斷應用程式連線並撤銷認證", "アプリ接続と認証を解除"),
            "manage_connection": ("變更連線；中斷連線會撤銷認證", "接続を変更・認証を解除"),
            "dictionary_delete": ("刪除字典詞彙", "辞書の単語を削除"),
            "dictation_delete": ("刪除此則聽寫紀錄", "音声入力記録を削除"),
            "dictation_clear": ("刪除全部聽寫紀錄", "音声入力の全記録を削除"),
            "memory_clear": ("清除記憶文件", "メモリ文書を消去"),
            "memory_summary_clear": ("清除對話摘要", "会話の要約を消去"),
            "settings_history_retention_days": ("變更保留天數；較舊紀錄會被永久刪除", "保持期間を変更・古い記録を完全削除"),
        }
        return labels.get(name, ("套用下列管理變更", "次の管理変更を適用"))[0 if language == "zh-TW" else 1]

    def management_target(self, name: str, arguments: dict) -> str:
        """Resolve the target at card time; retain exact IDs and all removal scope."""
        from ..management import resolve

        item, arguments = resolve(name, arguments)
        name = item.name
        identifier = arguments.get("room_id", arguments.get("member_id", arguments.get("id")))
        routine = None
        if item.rpc.startswith("routines."):
            identifier = arguments.get("id")
            routine = self.store.routine(identifier) if type(identifier) is int else None
        target = (f"ID {identifier}" if identifier is not None else
                  str(arguments.get("name", arguments.get("title", "all relevant records"))))
        if item.rpc.startswith("members.") or name.startswith(("member_history", "member_routine")):
            member_id = (arguments.get("member_id", routine.member_id if routine else None)
                         if item.rpc.startswith("routines.") else arguments.get("member_id", arguments.get("id")))
            if type(member_id) is int:
                target += f" / {self.name_of(member_id)}"
        table = ("member_groups" if item.rpc.startswith("groups.") else "rooms" if item.rpc.startswith("rooms.")
                 else "conversations" if item.rpc.startswith("conversations.") else "routines" if item.rpc.startswith("routines.") else None)
        if table and type(identifier) is int:
            # Table names are fixed above, never model input.
            record = self._conn.execute(f"SELECT * FROM {table} WHERE id=?", (identifier,)).fetchone()
            if record:
                data = dict(record)
                target += " / " + str(data.get("name", data.get("title", "")))
        if name == "member_delete":
            target += " / conversations, memory, routines, skills, commands and resources"
        if name == "member_history_delete":
            turn = self._history.get(arguments.get("turn_id"))
            target += f" / turn {arguments.get('turn_id')}"
            if turn is not None:
                target += " / " + turn.question
        if name == "member_primary":
            target += f" / authority moves from {self.name_of(self.primary_id())}"
        if name == "group_delete":
            target += " / folder only; members remain ungrouped"
        if name == "room_delete":
            target += " / all room messages and room state"
        if name == "room_members":
            previous = [row[0] for row in self._conn.execute("SELECT member_id FROM room_members WHERE room_id=?", (identifier,))]
            removed = sorted(set(previous) - set(arguments.get("member_ids", [])))
            target += " / removed: " + ", ".join(f"{i} ({self.name_of(i)})" for i in removed)
        if name == "dictionary_delete":
            record = self._conn.execute("SELECT word FROM dictionary WHERE id=?", (identifier,)).fetchone()
            if record:
                target += " / " + record[0]
        if name in ("member_skill_delete", "member_command_delete"):
            member = arguments.get("member_id", 0)
            try:
                resources = (self.capabilities.skills(-1 if arguments.get("shared") else member)
                             if name == "member_skill_delete" else self.capabilities.commands(member))
            except MemberError:
                resources = []
            target += f" / {self.name_of(member)} / " + ", ".join(item["name"] for item in resources if item["id"] == arguments.get("id"))
        if name == "member_skill_undo":
            target += " / restore the last skill snapshot, replacing its current documents"
        if item.setting:
            target = f"{item.setting}: {self._settings.get(item.setting)} -> {arguments.get('value')}"
        if item.rpc in ("integrations.disconnect", "connectors.disconnect") or name == "manage_connection":
            connection = arguments.get("id", arguments.get("connection"))
            label = next((entry.get("name", connection) for entry in self._connections() if entry.get("id") == connection), connection)
            target = f"{label} (ID {connection}) / connection and stored authorization"
        return target

    def authorize_management(self, member_id, name, arguments, *, interactive=False, approval=None):
        """Recheck live authority and the consumed exact-action gate token before a write."""
        from ..agent.team_admin import DEFINITIONS
        from ..management import REGISTRY, destructive
        from ..agent.policy import Approval, action_digest

        if not self.store.exists(member_id) or name not in DEFINITIONS and name not in REGISTRY:
            raise invalid_params("unknown team administration tool")
        if name != "team_overview" and (not self.store.is_chief(member_id) or not interactive):
            raise invalid_params("Only the current primary contact can manage the team in the owner's interactive private chat")
        schema = DEFINITIONS[name]["parameters"] if name in DEFINITIONS else REGISTRY[name].schema
        if (set(arguments) - set(schema["properties"]) or
                any(field not in arguments for field in schema["required"])):
            raise invalid_params("invalid team administration fields")
        if name != "team_overview":
            from ..management import validate, resolve
            validate(arguments, schema)
            item, values = resolve(name, arguments)
            validate(values, item.schema)
            if destructive(name, arguments, self._settings.get("history_retention_days")):
                if (not isinstance(approval, Approval) or not approval.spent
                        or approval.digest != action_digest(name, arguments)):
                    raise invalid_params("This destructive change requires the owner's approval for this exact action")
                used = getattr(self, "_management_approvals", set())
                if approval.pending_id in used:
                    raise invalid_params("This approval has already been used")
                used.add(approval.pending_id)
                self._management_approvals = used

    async def admin_tool(self, member_id: int, name: str, arguments: dict, *, interactive: bool = False, approval=None) -> dict:
        """Run the same services as the UI after live authorization."""
        from ..management import REGISTRY, resolve
        self.authorize_management(member_id, name, arguments, interactive=interactive, approval=approval)
        if name == "team_overview":
            from ..computer.grants import ComputerGrants
            roster = await self._list({})
            groups = {group["id"]: group["name"] for group in roster["groups"]}
            members = []
            for item in roster["members"]:
                identifier = item["id"]
                speaker = self.speaker(identifier)
                model = speaker.model or self._starting_model()
                capabilities = getattr(self._background, "capabilities_for", lambda speaker: {"tools": [], "brain": {"model": model}})(speaker)
                members.append({**{field: item[field] for field in ("id", "name", "role", "blurb")},
                                **capabilities,
                                "computer": {"allowed": ComputerGrants(self._conn).allowed(identifier),
                                             "local_commands": self._settings.get("local_commands_mode")},
                                "group": groups.get(item["group_id"]),
                                "skills_count": len(self.capabilities.skills(identifier)),
                                "commands_count": len(self.capabilities.commands(identifier)) if identifier else 0,
                                "routines": (await self._routines_list({"member_id": identifier}))["routines"]})
            rooms = getattr(self, "rooms", None)
            return {"members": members, "groups": roster["groups"], "primary_id": roster["team_context"]["primary_id"],
                    "rooms": rooms.member_rooms(member_id)["rooms"] if rooms else []}
        if name in ("member_create", "member_update"):
            params = dict(arguments)
            if "effort" in params:
                identifier = params.get("id", 0)
                current = self.speaker(identifier)
                model = params.get("model", current.model if current else "") or self._starting_model()
                params["model"] = model.partition("?effort=")[0] + "?effort=" + params.pop("effort")
            if name == "member_update" and params.get("id") == 0:
                from ..brain.settings import checked

                changes = {key: value for key, value in params.items() if key in ("name", "role", "personality", "instructions")}
                preferences = {"draft_first": "raphael_draft_first", "model": "agent_model", "pinned": "chief_pinned",
                               "voice": "tts_fish_voice"}
                # Profile drafts include these empty fields for ordinary members.
                for field in ("blurb", "group", "avatar_preset"):
                    if params.get(field) == "":
                        params.pop(field)
                if set(params) - {"id", "name", "role", "personality", "instructions", *preferences}:
                    raise invalid_params("This field is not editable for the first Bot")
                # Validate the whole request before any profile/preference write.
                for field, setting in preferences.items():
                    if field in params:
                        checked(setting, params[field])
                profile = {"name": RAPHAEL_NAMES[self._language()], **self.first_bot_profile(), **changes}
                try:
                    key, profile = checked("first_bot_profile", profile)
                except (ValueError, TypeError):
                    raise invalid_params("invalid first Bot profile") from None
                if any(member.name.casefold() == profile["name"].casefold() for member in self.store.members()):
                    raise invalid_params("duplicate first Bot name")
                # Join the batch transaction: SettingsStore.set would commit it prematurely.
                with self.store.transaction():
                    self._conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                                       (key, json.dumps(profile)))
                self._changed()
                for field, setting in preferences.items():
                    if field in params:
                        await self._management_rpc("settings.set", {"key": setting, "value": params[field]})
                return {"member": self._raphael_view(self._language(), {}, set(), {})}
            if name == "member_update":
                self._member_id(params)
            if "avatar_preset" in params:
                avatar = params.pop("avatar_preset")
                if not isinstance(avatar, str) or (avatar and not avatar.startswith(SLIME)):
                    raise invalid_params("a member's avatar is a slime")
                params["avatar"] = avatar
            created_group = None
            if "group" in params:
                group_name = params.pop("group")
                if not isinstance(group_name, str):
                    raise invalid_params("invalid group name")
                group_name = group_name.strip()
                group = self.store.group_by_name(group_name) if group_name else None
                if group_name and group is None:
                    created_group = (await self._group_create({"name": group_name}))["group"]
                params["group_id"] = group.id if group else created_group["id"] if created_group else None
            try:
                result = await (self._create(params) if name == "member_create" else self._update(params))
                if name == "member_create":
                    self.member_made(member_id, result["member"]["id"])
                return result
            except RpcError:
                # Failed validation must not leave behind the automatically created group.
                if created_group:
                    await self._group_delete({"id": created_group["id"]})
                raise
        action, arguments = resolve(name, arguments)
        if action.service != "rpc":
            raise invalid_params("This action requires its existing owner card service")
        params = {"key": action.setting, "value": arguments["value"]} if action.setting else dict(arguments)
        result = await self._management_rpc(action.rpc, params)
        if action.setting or name == "settings_read":
            # The UI response includes internal provider/device/authority state.
            # Management tools return only the explicitly managed preferences.
            managed = {item.setting for item in REGISTRY.values() if item.setting}
            result = {**result, "settings": {key: value for key, value in result.get("settings", {}).items() if key in managed}}
        return result

    async def _routines_list(self, params: dict) -> dict:
        member_id = self._routine_member(params) if "member_id" in params else None
        from .event_catalog import available_events, connected_apps, pick_event
        connections = self._connections()
        result = {"routines": [routine_view(r) for r in self.store.routines(member_id)], "events": available_events(connections, self._language()),
                  "event_apps": [c.get("name", c["id"]) for c in connected_apps(connections)]}
        if "event" in params:
            result.update(await pick_event(self, self._routine_member(params), params["event"], params.get("value", ""), params.get("contains", "")))
        return result

    async def _routine_webhook(self, params: dict) -> dict:
        from .webhooks import is_webhook
        routine = self.store.routine(self._routine_id(params))
        if not is_webhook(routine.when):
            raise invalid_params("This routine is not a webhook")
        if type(params.get("reveal", False)) is not bool:
            raise invalid_params("reveal must be a boolean")
        if "url" in params:
            return await self.webhooks.test_external(routine.id, params["url"])
        if type(params.get("rotate", False)) is not bool:
            raise invalid_params("rotate must be a boolean")
        return await self.webhooks.details(routine.id, reveal=params.get("reveal", False), rotate=params.get("rotate", False))

    def _finish_run(self, turn_id: int) -> None:
        run = self._conn.execute(
            "SELECT id, routine_id FROM routine_runs WHERE turn_id = ? AND finished IS NULL", (turn_id,)
        ).fetchone()
        if run is None:
            return
        turn = self._history.get(turn_id)
        if turn is None or turn.status in ("running", "confirm"):
            return
        with self._conn:
            self._conn.execute(
                "UPDATE routine_runs SET finished = ?, status = ?, summary = ?, cost = ? WHERE id = ?",
                (self._now_ms(), turn.status, _line(turn.text or turn.detail or ""), turn.cost_usd, run["id"]),
            )
        routine = self.store.routine(run["routine_id"])
        if routine is not None:
            self._changed("routines.changed", routine.member_id)

    async def _routine_run(self, params: dict) -> dict:
        routine = self.store.routine(self._routine_id(params))
        if self.routine_busy(routine.id):
            words = {"zh-TW": "這個例行任務仍在執行，請等候完成。", "ja": "このルーティンは実行中です。完了をお待ちください。", "en": "This routine is still running. Wait for it to finish."}
            return {"status": "refused", "reason": words.get(self._language(), words["en"])}
        before = self._conn.execute("SELECT COALESCE(MAX(id),0) FROM routine_runs").fetchone()[0]
        self._run(routine, test_run=True)
        row = self._conn.execute("SELECT id,turn_id FROM routine_runs WHERE id>? AND routine_id=?", (before, routine.id)).fetchone()
        if row is None:
            reason = self.store.routine(routine.id).last_error or self._guard_reason("member")
            return {"status": "refused", "reason": reason}
        self._finish_run(row["turn_id"])
        self._changed("routines.changed", routine.member_id)
        return {"run_id": row["id"], "turn_id": row["turn_id"]}

    async def _routine_runs(self, params: dict) -> dict:
        routine_id = _whole(params, "routine_id", least=1)
        if self.store.routine(routine_id) is None:
            raise invalid_params("no such routine")
        for row in self._conn.execute(
            "SELECT turn_id FROM routine_runs WHERE routine_id = ? AND finished IS NULL", (routine_id,)
        ).fetchall():
            if row[0] is not None:
                self._finish_run(row[0])
        rows = self._conn.execute(
            "SELECT r.id, r.routine_id, r.scheduled, r.started, r.finished,"
            f" {ROUTINE_RUN_STATUS_SQL} AS status, r.turn_id, r.summary, r.cost"
            " FROM routine_runs r LEFT JOIN agent_turns t ON t.id=r.turn_id WHERE r.routine_id = ? ORDER BY r.id DESC LIMIT 20", (routine_id,)
        )
        runs = [dict(row) for row in rows]
        total = self._conn.execute("SELECT COUNT(*) FROM routine_runs WHERE routine_id = ?", (routine_id,)).fetchone()[0]
        return {"runs": runs, "total": total}

    def _event_name(self, when) -> str:
        app = when.get("app") if isinstance(when, dict) else None
        return next((c.get("name", app) for c in self._connections() if c["id"] == app), app or "")

    async def _routine_create(self, params: dict) -> dict:
        member_id = self._routine_member(params)
        if params.get("schedule") is not None and params.get("when") is not None:
            raise invalid_params("Choose either a schedule or when")
        params = {**params, "schedule": self._saved_schedule(params.get("schedule"))}
        try:
            schedule = clean_schedule(params.get("schedule")) if params.get("when") is None else None
            routine = self.store.create_routine(
                member_id=member_id,
                title=params.get("title"),
                prompt=params.get("prompt"),
                schedule=params.get("schedule") if schedule else None,
                when=params.get("when"),
                app_name=self._event_name(params.get("when")),
                enabled=params.get("enabled", True),
                next_run_ms=self._next(schedule) if schedule else self._now_ms(),
            )
        except MemberError as error:
            raise _rpc_error(error) from None
        self._changed("routines.changed", routine.member_id)
        await self.webhooks.sync()
        return {"routine": routine_view(routine)}

    async def _routine_update(self, params: dict) -> dict:
        routine_id = self._routine_id(params)
        existing = self.store.routine(routine_id)
        params = {**params, "schedule": self._saved_schedule(params.get("schedule"), existing)}
        was_webhook = existing.when == {"webhook": True}
        try:
            routine = self.store.update_routine(
                routine_id,
                title=params.get("title"),
                prompt=params.get("prompt"),
                schedule=params.get("schedule"),
                when=params.get("when"),
                app_name=self._event_name(params.get("when")),
                enabled=params.get("enabled"),
                next_run=self._next,
            )
        except MemberError as error:
            raise _rpc_error(error) from None
        self._changed("routines.changed", routine.member_id)
        if was_webhook and routine.when != {"webhook": True}:
            self.webhooks.vault.delete(self.webhooks.key(routine.id))
        await self.webhooks.sync()
        return {"routine": routine_view(routine)}

    async def _routine_delete(self, params: dict) -> dict:
        routine = self.store.routine(self._routine_id(params))
        assert routine is not None
        deleted = self.store.delete_routine(routine.id)
        if deleted:
            if routine.when == {"webhook": True}:
                self.webhooks.vault.delete(self.webhooks.key(routine.id))
            self.webhooks.last_fire.pop(routine.id, None)
            await self.webhooks.sync()
            self._changed("routines.changed", routine.member_id)
        return {"deleted": deleted}

    async def _routine_template(self, params: dict) -> dict:
        member_id = self._routine_member(params)
        member = self.store.member(member_id) if member_id else None
        group = None if member is None or member.group_id is None else self.store.group(member.group_id)
        return {"offer": routine_template(group.sources if group else (), self._ui_language(params))}

    # --- the scheduler -------------------------------------------------------------------------------

    def use_event_tools(self, gate) -> None:
        from .events import EventPoller
        self._events = EventPoller(self, gate)

    async def poll_events(self) -> None:
        self.pause_absent_routines()
        if self._events is not None:
            try:
                await self._events.poll()
            except Exception as exc:
                logger.warning("The event routines could not be checked: %s", type(exc).__name__)

    def start(self) -> None:
        """Tick from now on, every TICK_S, the first time at once (a routine that was missed while
        the core was not running). Needs the running loop; does nothing without one, or twice."""
        if self._ticking is not None and not self._ticking.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._ticking = loop.create_task(self._tick_forever())

    async def _tick_forever(self) -> None:
        while True:
            try:
                self.tick()
                await self.webhooks.sync()
                if self._event_poll_task is None or self._event_poll_task.done():
                    self._event_poll_task = asyncio.create_task(self.poll_events())
            except Exception as exc:  # one bad tick must not stop the routines for good
                logger.warning("The routines could not be run: %s", type(exc).__name__)
            await asyncio.sleep(self._tick_s)

    def tick(self, now_ms: int | None = None) -> list[int]:
        """Run the routines that are due now; the ids of those that were run. Each is moved to its
        next time before it runs. One due longer ago than CATCH_UP_MS is not run, only moved."""
        now = self._now_ms() if now_ms is None else now_ms
        self.pause_absent_routines()
        ran: list[int] = []
        for routine in self.store.due(now):
            assert routine.next_run_ms is not None
            missed_ms = now - routine.next_run_ms
            catch_up = missed_ms <= CATCH_UP_MS and not self.routine_busy(routine.id)
            following = next_run(routine.schedule, now, tz=self._tz)
            count = self._conn.execute(
                "SELECT COUNT(*) FROM routine_runs WHERE routine_id = ?", (routine.id,)
            ).fetchone()[0]
            if routine.schedule.max_runs is not None and count >= routine.schedule.max_runs:
                self.store.advance(routine.id, next_run_ms=None, ran_at_ms=None)
                self._changed("routines.changed", routine.member_id)
                continue
            if catch_up and not self.admit_routine(routine):
                self.store.advance(routine.id, next_run_ms=now + 60_000, ran_at_ms=None)
                continue
            if catch_up and routine.schedule.max_runs is not None and count + 1 >= routine.schedule.max_runs:
                following = None
            still_there = self.store.advance(
                routine.id, next_run_ms=following, ran_at_ms=now if catch_up else None
            )
            if not still_there:
                continue
            self._changed("routines.changed", routine.member_id)
            if not catch_up:
                logger.info("A routine was missed too long ago to run: %d", routine.id)
                continue
            self._run(routine)
            ran.append(routine.id)
        return ran

    def _guard_reason(self, kind: str) -> str:
        messages = {
            "zh-TW": {"absence": "已暫停：擁有者超過 30 天未使用。請確認後重新開啟。", "member": "此成員最近一小時已執行 200 次，稍後自動重試。", "total": "團隊最近一小時已執行 300 次，稍後自動重試。"},
            "ja": {"absence": "30 日間利用がないため停止しました。確認して再開してください。", "member": "このメンバーは過去 1 時間に 200 回実行しました。後で再試行します。", "total": "チームは過去 1 時間に 300 回実行しました。後で再試行します。"},
            "en": {"absence": "Paused after 30 days without owner activity. Review and enable to resume.", "member": "This member reached 200 runs in the last hour. Retrying later.", "total": "The team reached 300 runs in the last hour. Retrying later."},
        }
        return messages.get(self._language(), messages["en"])[kind]

    def pause_absent_routines(self) -> None:
        if self._now_ms() - self._settings.get("routine_owner_seen_ms") < OWNER_ABSENCE_MS:
            return
        members = {routine.member_id for routine in self.store.routines() if routine.enabled}
        with self._conn:
            self._conn.execute("UPDATE routines SET enabled=0,next_run_ms=NULL,last_error=? WHERE enabled=1", (self._guard_reason("absence"),))
        for member in members:
            self._changed("routines.changed", member)

    def admit_routine(self, routine: Routine, *, allow_paused: bool = False) -> bool:
        self.pause_absent_routines()
        current = self.store.routine(routine.id)
        if current is None or (not current.enabled and not allow_paused):
            return False
        counts = self._conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(r.member_id=?),0) FROM routine_runs rr JOIN routines r ON r.id=rr.routine_id WHERE rr.started>?",
            (routine.member_id, self._now_ms() - 3_600_000),
        ).fetchone()
        window = self._run_window()
        total = max(counts[0], len(window))
        member = max(counts[1], sum(entry[0] == routine.member_id for entry in window))
        kind = "total" if total >= ROUTINE_HOURLY_TOTAL else "member" if member >= ROUTINE_HOURLY_MEMBER else None
        if kind:
            with self._conn:
                self._conn.execute("UPDATE routines SET last_error=? WHERE id=?", (self._guard_reason(kind), routine.id))
            self._changed("routines.changed", routine.member_id)
            return False
        return True

    def _run_window(self) -> list[list[int]]:
        """Keep admission receipts across restarts and routine deletion; at most 300 per hour."""
        since = self._now_ms() - 3_600_000
        return [entry for entry in self._settings.get("routine_run_window")
                if isinstance(entry, list) and len(entry) == 2
                and all(type(value) is int for value in entry) and entry[1] > since]

    def routine_busy(self, routine_id: int) -> bool:
        return self._conn.execute("SELECT 1 FROM worker_tasks WHERE routine_id=? AND state IN ('queued','running','waiting') LIMIT 1", (routine_id,)).fetchone() is not None

    def _run(self, routine: Routine, *, text: str | None = None, session: str | None = None, test_run: bool = False) -> int | None:
        """A routine's run: a turn of its thread, and a background task of its member that
        completes it."""
        if not self.admit_routine(routine, allow_paused=test_run):
            return None
        self._settings.set("routine_run_window", [*self._run_window(), [routine.member_id, self._now_ms()]])
        with self._conn:
            self._conn.execute("UPDATE routines SET last_error='' WHERE id=?", (routine.id,))
        speaker = self.store.speaker(routine.member_id)
        if speaker is None:
            return
        language = normalize_language(self._language())
        session_id = session or f"routine:{routine.id}"
        turn_id = self._history.add(
            session_id=session_id,
            question=routine.title,
            route="routine",
            prefix="",
            text="",
            status="running",
            source="routine",
            member_id=routine.member_id,
        )
        model = speaker.model or self._settings.get("agent_model")
        with self._conn:
            self._conn.execute(
                "INSERT INTO routine_runs (routine_id, scheduled, started, status, turn_id, trigger_json) VALUES (?, ?, ?, 'running', ?, ?)",
                (routine.id, routine.next_run_ms, self._now_ms(), turn_id, json.dumps({key: value for key, value in routine_view(routine).items() if key in ("id", "member_id", "title", "schedule", "when", "app_name")})),
            )
        model = model.strip() if isinstance(model, str) and model.strip() else DEFAULTS["agent_model"]
        task_id = None
        try:
            task_id = self._background.submit(
                session_id=session_id,
                text=routine.prompt if text is None else text,
                language=language,
                model=model,
                member_id=routine.member_id,
                routine_id=routine.id,
            )
        except Refused as refused:
            self._history.resolve(
                turn_id, prefix="", text=phrase(language, refused.kind), status="error"
            )
            logger.info("A routine could not run: %s", refused.kind)
        else:
            self._background.attach_turn(task_id, turn_id)
            logger.info("A routine runs: %d (task %d)", routine.id, task_id)
        self.turn_arrived(turn_id)
        if self._notify is not None:
            self._notify("agent.turn", {"turn_id": turn_id, "member_id": routine.member_id})
        return task_id

    async def aclose(self) -> None:
        ticking, self._ticking = self._ticking, None
        if ticking is not None and not ticking.done():
            ticking.cancel()
            await asyncio.gather(ticking, return_exceptions=True)
        polling, self._event_poll_task = self._event_poll_task, None
        if polling is not None:
            polling.cancel()
            await asyncio.gather(polling, return_exceptions=True)
        await self.webhooks.close()
