# Group chats and folders

## Room CLI permission callback (core, 2026-11-09)

R-ROOM-01 / R-CLI-07: Claude Code's permission-prompt callback `approve` remains mounted
beside the four speech tools after every MCP catalog refresh. It is a permission decision,
not an additional room action. Permission for an offered Raphael/computer MCP tool admits
only that call to its existing context-specific gate; a board read needs no owner prompt.
Unknown tools, callback recursion and wrong server namespaces are denied. Native shell/file
actions remain denied in speech, including bypass mode, with guidance to hand off private work.
Private/background tool execution still uses exact owner cards and existing protected-data rules.
Codex uses its native permission callback; Antigravity permits only configured MCP servers in
print mode. Neither is offered Claude's approve tool; both keep the same room/private scope.

CLI termination with observed missing-tool or tool-error evidence is tool_broken with a fixed,
localized explanation and bounded redacted private details, rather than a no-response retry.
Bare EOF remains cli_stopped; explicit provider/auth/quota/refusal/network failures retain their
classification. No new RPC, worker, model, schema or approval engine is introduced.

Offline coverage: core/tests/background/test_room_cli.py (real room, authenticated MCP,
three CLI brains, owner approve/deny and a synthetic Claude subprocess checking the actual
permission-prompt flag), core/tests/agent/test_cli_failure_detail.py and existing CLI/security
consumers. Report: app/.look/briefs/room-cli-approve-report.md. Synthetic CLI/MCP evidence does
not establish installed Claude Code, native window or live/provider acceptance.

Live proof on the installed Claude Code (owner's subscription, Haiku at low effort, isolated data):

```powershell
$env:RAPHAEL_NATIVE_BINARY = "<a --debug build of this commit>"; npm run native -- room-cli
```

A room with Raphael and a new member, both addressed, must finish both turns `done` with their words in the room
and no 「暫時沒有回應」. First run 2026-11-09 on 6e371c0c: both answered in 6 s, but the member's words were stored
as the raw `{"text","detail"}` envelope (app/.look/briefs/room-cli-json-envelope.md).

Owner decision 2026-10-30 removes the Team page, route and spatial canvas.
The global sidebar owns folder creation, rename, collapse, member moves and order.
Member brain display remains in the details panel. The plus offers new members
and group chats. Everyone is the existing all-member `is_team` room in the room list.
Opening an uncreated Everyone entry creates it once through production rooms.create.
Composite room avatars use two or three participants' own faces consistently.
Each 40px composite contains complete round faces with their own avatar background
and a 2px ring matching the normal, hovered or selected row, or the header surface.
Keep header and sidebar geometry identical; never crop the composite as one circle.

Keep the existing room composer, mentions, roles, Stop, reply references, source
events and durable handoffs. The same AgentService owns member work.

A room message carries no speaker name (owner, 2026-11-09: 「開會的時候不用有名字…不用顯示拉菲爾」):
the face beside it says who spoke, its name in the face's tooltip and for a screen reader (the author
stays in the markup, visually hidden); a message with nothing else in its meta line has no meta line.
The room's right-click dialogs 參與成員 and 房內角色 (and the new room dialog) are one list of rows
(`.room-list`, owner 2026-11-09): each member's face and name, a check on the right of a chosen member,
a pressed state for a reader; in 房內角色 each row carries its role as a bare dropdown on the right.
No separate list of picked names. Scenes: `primary-room-members`, `room-role-assignment`, `new-room`,
`plus-create-room`, `room-replies`.

Everyone in a room reads each message and decides for themselves, on their own model, through
one small question (`room_listener`); a CLI or local brain reads an owner's message in a real turn
and may pass. An address is always answered. Nothing hands out the floor or sums up unasked, and no
turn is given a template: a meeting closes and finished work reports back in plain words (R-AG-02).
A member's question waits above the room's composer, the room's row says so, and
`question-reminder.ts` says it once when the owner is elsewhere (R-AG-34).

```powershell
npm run look -- room-question-card question-reminder --theme both --width 1120,720,1920x1080
```

Pin/hide and read position persist in SQLite migration 44. Hidden rooms appear in
search and can be restored through their menu. Reading marks only the open room.
Room previews ignore hidden pass replies and unresolved worker status.
The look IPC boundary derives preview, timestamp and unread from room messages,
matching the production rooms.list projection. Reading preserves preview and time.
Home selects only the brand; only a visible conversation selects its member or room.

Run `sidebar-group-avatar`, room-text, room-mentions and the
affected room action scenes. Native readable-layout, locale-sweep and
delete-conversation use the shared sidebar. Keep fake brain, isolated data and one
heavy process at a time.

Owner review regression scenes: sidebar-group-avatar-hover, sidebar-group-avatar-pair,
sidebar-room-home and sidebar-unread. Run every sidebar-prefixed scene plus home,
home-row-hover and chat in both themes at 1120, 720 and 1920x1080. The native
readable-layout journey checks two- and three-face rooms, production RPC summaries,
and selection after leaving each room for Home. Inspect contact sheets and full-size
images separately from automated assertions.
Keep a requested room ID separate from the complete loaded Room while opening.
An update can supersede that first refresh: never render an incomplete placeholder,
leak the previous room's content, or lose the destination of a message sent during
loading. The deferred-refresh regression test covers the native notification race.

## Sub-features

Global folders, Everyone, group avatars, persistent room actions, mentions and work.

## How to get to it (user POV)

Open a room in the global sidebar; use the menu button in a compact window.

## Driving it with look

```powershell
npm run look -- sidebar-folders sidebar-folded sidebar-group-avatar sidebar-chief-pinned sidebar-rail sidebar-rail-folded room-text room-mentions --theme both --width 1120,720,1920x1080,1280x800
npm run look -- sidebar-group-avatar-hover sidebar-group-avatar-pair sidebar-group-avatar-four sidebar-room-home --theme both --width 1120,720,1920x1080
```

The following retained room and sidebar journeys cover their shared consumers:

```powershell
npm run look -- sidebar sidebar-many sidebar-unread sidebar-drawer sidebar-search sidebar-plus sidebar-owner room --theme both --width 1120,720,1920x1080
npm run look -- room-composer-empty room-composer-hover room-workflow-blocked room-final-owner room-progress-status-only room-no-dangling-mention room-short-wrapup room-handoff-queued --theme both --width 1120,720,1920x1080
npm run look -- room-handoff-running room-handoff-result room-handoff-failed room-immediate-work room-source-dates-not-schedule handoff-centred-line mentions-bots-apps plus-create-room --theme both --width 1120,720,1920x1080
npm run look -- room-routing-fallback room-role-assignment room-round-typing room-mention-after-hop-limit room-mention-after-turn-limit room-mention-blocked room-wrapup-after-replies compact-rooms --theme both --width 1120,720,1920x1080
npm run look -- new-room room-group-menu room-draft room-menu room-replies room-discussion room-wrapup new-room-responder --theme both --width 1120,720,1920x1080
npm run look -- room-required-chief room-generated-name room-private-isolation room-reply-owner room-reply-peer room-reply-source-missing room-reply-send room-thinking --theme both --width 1120,720,1920x1080
npm run look -- room-stop room-row-menu room-rename room-members room-delete room-hover esc-room-armed --theme both --width 1120,720,1920x1080
```

The following retained room and sidebar journeys cover their shared consumers:

```powershell
npm run look -- sidebar-owner-upload sidebar-owner-crop sidebar-owner-crop-held --theme both --width 1120,720,1920x1080
```

The picture crop dialog (owner photo and Raphael's picture share it) shows the whole picture under a
square frame: the left button drags the picture or, on a corner, resizes the frame; the wheel zooms;
the thirds show only while the button is held; there is no slider (owner, 2026-11-07).

## Gotchas

Synthetic IPC does not establish native persistence, provider or design acceptance.

## Folded room receipts (2026-11-02)

R-UI-72 groups consecutive handoff rows using the same renderer as private turns. handoff-group-room places a message between two receipt runs and requires two groups; handoff-group-open keeps the line node and the open conversation between members through WorkerChanged delivery and arriving data. See conversation.md for the selected shared matrix. Room workflow checks read the request, result, files and reason in that conversation (peer-chat.ts, 2026-11-07).
## Send while rooms work (2026-11-03)

R-QUEUE-06 uses the shared chat composer: clear the submitted draft immediately,
preserve new typing and files, and serialize rooms.send per room without changing
speaker selection. Failed delivery keeps its request identity for retry. Scene:
room-send-while-working, both themes at 1120,720,1920x1080. Shared private
consumers and the selected matrix are in conversation.md#durable-owner-inbox-2026-11-03.


## Meetings and private work (2026-11-04)

Owner follow-up (2026-11-08, meetings-and-delegation): an explicit meeting keeps
meeting=1 and gives every participant a speech turn in order, even when earlier
members pass. The agenda author also receives a review turn. Owner corrections re-open
that ordered queue; an explicitly addressed follow-up schedules only its recipients.
Serial meeting rounds use the existing turn budget, including follow-up mentions,
so the smaller parallel-round cap cannot truncate a normal meeting. Ordinary room chats
retain their independent speak/pass listeners. A failed listener records only its
exception kind, retries once, and retains routing evidence; persistent failure
creates a blocked intent and a public unavailable reason rather than being heard.
CLI structured listeners allow three Claude turns and read structured_output.
Listeners use nonpersistent native sessions; persistent turns sharing a member and
conversation serialize through the existing session lock. An early CLI exit retains
bounded, scrubbed stderr in private failure details; normal logs retain only the kind.
A missing resume session gets one fresh attempt
with bounded recovery receipts, without replaying completed tool effects.
Completed room rows preserve authored text with a trailing (pass) suffix removed;
an exact pass stays silent. Fresh TeamContextSnapshot.meetings and work_status
carry persisted exchange state so a finished meeting cannot be reported as running.
Regression evidence: core/tests/members/test_meetings_followup.py,
core/tests/background/test_room_meeting.py and core/tests/agent/test_cli_brains.py.
Core-only behavior; no new UI scene or provider acceptance is claimed.

R-ROOM-01 through R-ROOM-07 supersede sequential-speech/normal-room-tools clauses.
Selected speakers share one snapshot. Their private work can continue beside speech;
status is computed per member, chief decisions are pinned, and short report cards link
to the assignee's actual private turn. Approval content stays private. Member-to-member
questions retain asker-only presentation. CLI members choose speak/pass themselves,
without a dispatcher, templates, or model substitution.

Offline evidence: core/tests/background/test_room_meeting.py,
core/tests/members/test_room_meeting.py, core/tests/brain/test_room_meeting_migration.py,
app/src/main/room-meeting.test.ts and group-chats.test.ts.
The existing Guardian driver reads private work/report destinations and report_task_id,
seeds meetings from actual private chief turns, and stops self-handoff work through
the same production path. Its fake CLI listeners return their own structured choice.
The driver also verifies the work turn belongs to the assignee's main private conversation even
when the hand-off started in another member's private chat. The exchange remains an audit.
Owner-private management discovery is shared by members; it does not authorize
delegating member management through handoff or ask_member, which remains refused.
guardian_manifest.json maps the read-only work_status tool to S08.completion.

Follow-up 1 authorizes the selected offline look matrix below. Network and paid APIs
remain forbidden. The status board is a compact pending-question-style row pinned
under the header, outside the scrolling thread. It opens the shared popover with
member faces, current stages, shared state pills and plain decision lines. Empty
meetings hide the row. Report cards reuse conversation-card and the shared file chip,
never display digests, and retain the private work destination. A chip uses an opaque
task/evidence handle through the existing native open_team_file boundary; TaskStore
resolves only recorded artifacts inside their stored root whose bytes still match.
Executable files retain the existing show-in-folder policy. Tests also cover
core/tests/background/test_tasks.py and core/tests/computer/test_team_file.py.
The existing runner and mock IPC boundary include deterministic assertions:


```powershell
npm run look -- room-concurrent-replies room-status-board room-report-card group-live-line room-handoff-running room-handoff-result room-handoff-failed handoff-centred-line --theme both --width 1120,720,1920x1080
```

Inspect every contact sheet and relevant full-size image. Compare with private
owner-question-pending, card-task-result and team-file-reply scenes at the same
themes and widths, then judge the
same run with authorized external references. Formal subscription judge remains
SKIP without references and network authorization. Manual image review is required
by the follow-up; offline fixtures do not establish native file opening or live calls.
