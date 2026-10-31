# Members and sidebar

Owner decision 2026-10-30: MembersShell's column is global, with a same-sized chief
conversation row, folders and group chats. No face strip or separate Team page.
Folders support add/rename/delete, persistent collapse, member drag/drop and folder
drag reorder using existing groups/members position fields. Member brain selection
stays in details. The plus opens the existing member profile and group chat creation.
Chief swap remains the bot-home primary contact rule. Existing protected Raphael
identity, row actions and context menus remain authoritative.
Selection follows the visible page, independently of the remembered conversation.
Hiding the conversation clears member and room selection immediately; opening it
restores only its active member or room. Home selects only the Raphael brand row.


## Sub-features

Persistent folder collapse, the shared chief conversation row, identity/personality, profile editing, avatar selection, memory, routines, skills,
commands and voice settings, and the Permissions tab's two switches: ask before contacting colleagues, and write mail as a draft for the owner to send
(`draft_first`, on by default; see the P08c section of [Conversation](conversation.md)). Members have independent conversations.
The owner's primary contact (P15b-1, the last section) takes the top display slot in place of Raphael, with the chief role and sidebar star. Details and pickers remain badge-free. `memberRole` uses the single three-language `rooms.chief` key for the current chief in the sidebar, pickers, participant tooltips and member usage; ordinary profiles retain their role text. This does not write profile data; the unique primary contact also holds the chief capability and coordinates rooms.

## How to get to it (user POV)

The fixed sidebar is present on every page. Its chief uses the same compact row as colleagues. Folders preserve their collapsed state; drag members between folders or reorder folders. Below 860px the menu opens the same full sidebar as a drawer. No icon strip or separate Team page remains.

Select a member, then click the stacked header title for details.
At compact width open the sidebar drawer to select a member first. The same title
closes the panel; its close button updates the same remembered session state. Details has the avatar, edit pencil and resource
panes. The sidebar plus is the member creation entry; verify the
complete flow for creation changes.

## Driving it with look

```powershell
npm run look -- members-expanded sidebar-folders --theme both --width 1120,720,1920x1080
npm run look -- details member-avatar member-edit details-memory details-routines details-skills details-commands details-voice --theme both --width 1120,720,1920x1080
npm run look -- sidebar-folders member-text --theme both --width 1120,720,1920x1080
npm run look -- member-delete new-conversation-rests conversation-delete-main --theme both --width 1120,720,1920x1080
npm run look -- member-maker member-maker-chosen member-maker-made --theme both --width 1120,720,1920x1080
npm run look -- slime-states slime-picker --theme both --width 1120,720,1920x1080
```

These walk the owner's flows to their end: `member-delete`
deletes 小森 from the row's ⋯ menu after the confirmation (the menu had lost 刪除 on
10/24); `new-conversation-rests` presses 新對話 in the details and the button must rest
while that conversation is unwritten (owner, 10/31: a new conversation is made only from
a member's details, never the sidebar's ＋, and never beside one still empty);
`member-maker*` is 新增成員 as a character maker where the conversation stands, slimes
only (owner, 10/31: no pictures, for copyright; Grok Bot's create page is the reference
at bots/research/grokbot/12-flaviocopes-create-first-bot.jpg). It asks only for a name; the
member opens and speaks first (the core's greeting, no model), and the owner's answer
becomes its job through `set_my_job`, offered only while it has none;
`conversation-delete-main` deletes Raphael's main conversation, and the
latest one must take over with no empty 新對話 in its place (the look mock keeps the main
conversation as the core's `Conversations.main` does).

Keep details/resource-pane/avatar-menu/edit-dialog PNGs; check layering, focus and
scroll access. Current scenes open editing but do not save. For creation work extend
shared scenes to create a synthetic member, open its avatar picker while the dialog
is open, save, open its conversation and reopen details. Assert identity/avatar and
selection. Native proof must also relaunch the isolated dev instance and confirm
persistence, then remove test data.

Memory, routine, skill and command rows put edit/delete in their overflow menus
(R-UI-11). A shared note's row names whom the owner told it to and when (`global-private-memory`). Routine switches remain on their rows. Existing edit, approval and undo
behavior remains in the shared editors and controllers.

## Gotchas

Fixture member 1 is 小晴 with conversation 11; Raphael has special avatar behavior.
Skills/commands/voices have empty fixture collections. Seed resources before claiming
populated-resource flows. Native avatar picking/cropping, files, audio output and
provider behavior need native evidence. A dialog screenshot does not prove saving.

## Raphael sidebar administration

The current chief can administer the sidebar from their conversation: overview, member creation
and editing, groups, any member's routines, skill imports and command templates.
Management tools, including the legacy create_member alias, are offered only to the current chief capability holder. Both creation names share the same ten-per-turn limit and member service. Creation uses distinct available
presets, then the neutral silhouette, and the create dialog defaults.

```powershell
npm run look -- admin-approval admin-approval-batch admin-approval-long admin-delete-approval admin-approved admin-denied --theme both --width 1120,720,1920x1080
npm run look -- member-draft member-draft-edit member-draft-done --theme both --width 1120,720,1920x1080
```

The scenes retain full approval fields, allow long instructions to scroll by
keyboard, keep actions below the details, select the member after approval and
assert that rejection leaves the roster unchanged. Deletion uses the existing T3
held approval even in Direct mode. The boundary fixture does not prove model
selection or persistence: core tests drive API turns and authenticated HTTP MCP
turns through the real member service. Live provider/CLI and native relaunch
checks remain separate.

Every action mode and brain collects the entire turn's reversible member/group changes in one card,
including eight-member requests across multiple model rounds or sequential CLI MCP
calls. Every member lists name, role, blurb and group. Approval applies the entire
transaction; rejection or expiry applies none. An invalid operation rolls everything
back without publishing partial roster changes. Deletions retain per-member T3 cards.
Chinese and Japanese labels use full-width colons; English uses colon-space.
The admin-approval-batch scene checks all eight entries, internal keyboard scrolling
and the one pair of actions in both themes and widths. When structured `drafts` are
present on `team_admin_batch`, the conversation renders `.draft-panel` with an
editable `.draft-card` per proposed member (face/preset picker, name, role, blurb,
group dropdown, expandable personality/instructions, remove button) and primary
count CTA (`建立 N 位成員`), then settles into an expandable `.draft-done` summary
(`已建立 COO、PM、RD`) once confirmed (`member-draft`, `member-draft-edit`, `member-draft-done`).

## Codex subscription isolation

Codex brains use a private home and empty working directory for each conversation.
Only Raphael's MCP server is configured; its tools are direct, with personal apps,
plugins, hooks, skill discovery, memories and project documents disabled. Existing
personal Codex rollouts are not imported. Isolated sessions resume independently.

Offline proof: core/tests/agent/test_cli_brains.py checks the actual fake child's
command, environment, login snapshot, cleanup and session migration. The login
snapshot has no refresh token; an expired access token requires the owner's Codex
to refresh its login before the next Raphael turn. Browser fixtures cannot prove
this boundary. For live acceptance on a Codex brain, ask Raphael to create members
and check the turn's MCP steps show team_overview and member_create, not other tools.

A subscription turn that ends with HTTP 429 (Codex "Too Many Requests", Claude Code
`api_error_status` 429) is rate-limited unless the quota windows say the plan is used up.
A turn that has not started a tool, asked a permission or called Raphael's tools runs again
after 20 s and 60 s with one progress line per wait (a room or background turn, which no one sits
waiting on, after 30, 60, 120 and 240 s); quick questions and turns that already
acted end at once with a specific rate-limit message, and a background task keeps that message
with the reason `cli_rate_limited`. Offline proof: core/tests/agent/test_cli_brains.py,
core/tests/background/test_room_cli.py and core/tests/members/test_cli_brains.py.

## The primary contact (P15b-1)

The owner chooses which member is their primary contact, the Bot that new work is brought to and that hands it to the colleague it belongs to.
Raphael is the primary until another is chosen, and exactly one is at a time. Choosing is 設為主要 in a member's menu (the row's more button
or a right click): it opens 「選擇主要成員」, a list of real buttons (Raphael and the other visible members, not the primary now) with the member whose menu
it was chosen already, 取消 and the primary 設為主要. Position alone identifies the primary: no star badge is drawn in the column, face strip or details, and the menu uses an up arrow instead of a star.
The primary takes Raphael's large top slot in the member column, collapsed strip and sidebar board; Raphael takes the primary's former group/pinned position and keeps his emblem. The same identity swap orders member/conversation pickers, mentions, room membership/responder choices, room participant faces/role choices, and calendar/routine choices. It never mutates stored groups, pins, identities, current conversation, default recipient or the core roster.
Raphael's row has no destructive menu wherever it moves; an ordinary primary keeps its member menu at the top. Raphael can be chosen again from another member's primary picker. The primary holds the chief capability, is required in new or edited rooms and writes their single wrap-up. Existing rooms missing a newly selected chief require membership adjustment; in-flight work is not replayed. Opening the Conversation page and Alt+Space quick questions retain their existing thread behavior; this change only exchanges display positions.

```powershell
npm run look -- members-expanded sidebar-folders primary-contact-column primary-contact-menu primary-contact-picker primary-contact-set primary-room-picker primary-room-members primary-calendar-members primary-routine-members primary-room-chief --theme both --width 1120,720,1920x1080
```

`primary-contact-column` and `primary-contact-strip` check the exchanged positions, Raphael's emblem and localized name tooltips; only the sidebar chief has a star. `primary-contact-menu` retains 設為主要 after 移到分組; `primary-contact-picker` excludes the current primary while offering Raphael, with one checked choice, 取消 immediately before 設為主要 and no write before confirmation. `primary-contact-set` asserts one `members.set_primary` call, the updated top row, badge-free details and no room/task/conversation mutation. The board scene also checks top-card visibility before/after fit, natural panel heights and no overlap. Member/new-conversation/mention/calendar/routine/room scenes assert the exchanged order; room choices require the current chief and routine selection stays unchanged. The member-picker driver uses the compact picker when available and the real new-conversation picker at wide widths.

The IPC double keeps `primaryId` as the core keeps the flag: the list's `team_context.primary_id` says it, a hidden or deleted primary is Raphael again, and a hidden member cannot be chosen. Unit cases cover default/explicit Raphael, valid and absent primary IDs, grouped/pinned/ungrouped slots, source immutability, details drafts, picker identities and restricted mentions.

The core keeps the flag on the member's row (schema v39, a unique index) and the roster is the one place it is read from: the snapshot's `primary_id`
(and equal `chief_id`) is in its revision, and every prompt (an API turn, a resumed CLI thread's per-turn sidebar block, a background task or
routine, each room turn) is built from it fresh. Offline proof: core/tests/members/test_primary.py (one at a time and its persistence, hide and delete hand it
back to Raphael, nothing else changes, each room uses the current chief and concludes once when the chief changes, a roster that kept the old one
is told apart on each path), core/tests/background/test_primary.py, and Guardian S02 (every Bot names the new primary as the chief after the
owner changes it; a brain that keeps the old one, never says it or names a different chief fails on both brain paths), S03.primary-dispatch (the primary hands
the work to 信件助理 itself) and S07.meeting (held with a primary that is not Raphael). Live brains and the native shell (the persisted choice
after a relaunch, the allowlisted `members.set_primary`) need their own acceptance.

## Editable member proposals (P05)

API and sequential authenticated CLI/MCP calls queue the same turn-end proposal.
Pending tool responses have no created IDs and explicitly prohibit claiming success.
Owner confirmation rechecks edited arguments against current safety rules and applies
the transaction once. Cancel, expiry and a superseding turn discard it. Repeated
updates to one target merge their fields into one card. Nested member work cannot
administer the roster; deletion retains its separate held T3 confirmation.

The conversation creation picker offers Create from description for a nonempty
search. It opens the chief's ordinary composer with a proposal request. Raphael's
conversation no longer has a naming/personality/work setup step. Editable
proposals and explicit profile updates remain protected by normal confirmation.
Group proposal names are editable and follow the existing native confirmation route.

```powershell
npm run look -- admin-cli-draft-edit admin-draft-cancel admin-draft-apply-result no-naming --theme both --width 1120,720,1920x1080
```

Core evidence: tests/members/test_admin_proposals.py covers both fake API and
sequential HTTP MCP paths, edits, direct/ask modes, cancellation, expiry, resend,
atomic rollback, target scope, current safety, saved first Bot identity and replay.
Guardian S01 runs the production loops for both fake brains. Browser IPC fixtures
prove rendered interactions only; live brains and native persistence remain separate.

## Right click is the ⋯ (R-UI-44)

Every row, card or item that has a ⋯ opens that button's menu when it is right-clicked anywhere on it, at the pointer (the owner, 2026-10-27, about every
overflow menu and the conversation list of a member's details): member rows and group headers in the column, conversations and routines in a member's details,
the notes, routines, skills and commands of a member's profile, rooms (the sidebar's rows and the room's header), the sidebar board's group headers, a custom
server's header and a subscription account's card in Settings, memory notes, safety rules, computer apps, History rows, dictionary words and Raphael's answers.
The menu is the very one the ⋯ opens, because the button is pressed and its own handler runs, so a menu that replaces the first from the same button
(「移到分組」) stands at the pointer too. Shift+F10 and the Menu key open it under the ⋯ of the focused row. A right button dragged more than a few pixels opens
nothing, so that a drag (the sidebar board's pan, later) is not a click. Anywhere else there is no browser menu, and a text field keeps its own. A left click on a conversation row
still opens that conversation: it is the row's own action, and a menu on it would leave no way to open one from the list.

`OVERFLOW_ROWS` in app/src/main/context-menu.ts is the one table of every ⋯ and its row. A ⋯ drawn without a line in it fails app/src/main/context-menu.test.ts,
and the audit of every look scene (`R-UI-44`) fails a rendered ⋯ that no row reaches.

```powershell
npm run look -- context-menu-member context-menu-conversation context-menu-routine context-menu-key --theme both --width 1120,720,1920x1080
```

Each scene presses the real right button (the `right-click` driver step, which keeps the point it pressed) and its `context-menu` check asserts that the menu is open, starts
at the pointer, does not cover it, and has the same items as the menu a click on the ⋯ opens. It closes the menu on the way, and the scene presses again so that the picture
shows it. `context-menu-key` presses Shift+F10 (`key` with `shift`) on the focused member row and asserts that the menu stands under its ⋯. The connection and message
scenes are in [Connections and MCP](connections-mcp.md) and [Conversation](conversation.md).

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Deleting the selected member or resource (owner round 3)

R-UI-47: deleting the open member selects Raphael before repainting. Missing roster
entries also fall back to Raphael with the existing success notice. Deleting a
saved resource or routine refreshes its containing list and uses the shared toast;
unsaved draft removals stay local. The selected member scene deletes the member
whose conversation is open, not an unrelated roster row.

```powershell
npm run look -- member-delete --theme both --width 1120,720,1920x1080
```

## Recording Stop regression (2026-10-29)

While recording, clicking the composer voice/Stop releases recording through the
native question-key path, transcribes and sends. It never calls cancelSession.
Only Escape uses the two-press cancellation gesture. The recording flyer/is-voice
state survives task redraws; pending/member/background tasks still use Stop.
Pointer regression tests cover Raphael and another member in agent-members.test.ts.
Native voice-conversation proves local WAV transcription and persisted turns with
a fake brain; it does not prove a physical microphone or live-provider behavior.

## Owner round 6 contracts

Owner round 6: member-text and the shared details scenes cover conversation consumers of the overlay scrim, single inset and card cap. Existing compact rail badges, selection backgrounds and conversation placement remain owner-approved.


## Bot homes, phase 1 (owner decision 2026-10-29)

Every member, including Raphael, owns `bots/<id>/MEMORY.md`, `memory/` and
`skills/<skill>/SKILL.md`. `bot-state/<id>/SOUL.md` is a derived persona mirror;
the database remains authoritative. `skills.json` records enabled state, provenance
and document revision. Atomic, bounded, allowlisted document writes redact secrets,
check optimistic SHA-256 revisions and keep undo journals outside bot-writable homes.
Core metadata undo restores the database before regenerating the mirror; no bot can
write SOUL or role/enable metadata. Shared owner/team documents are `shared/USER.md`
and `shared/team.md`; migrated shared notes remain under `shared/memory/`.

Migration first verifies destinations and copies every source, then removes verified
sources. It preserves legacy private/shared placement and bytes; conflicts abort
without overwriting. Tests use a copied synthetic three-memory tree, never owner data.
Private-chat writes and reflection stay in that member's home even when a model
requests shared space. Only an explicit owner sharing request promotes a private
request to shared memory. Search/read never cross another member's private memory
or thread; `ask_member` returns the asked member's own answer.

Member details uses the existing model picker once, with inherit-global plus API/CLI
choices. Empty `members.model` inherits global; otherwise private turns, routines
and background work honor that brain, including CLI. Raphael's global brain remains
in Settings. Raphael now has the ordinary Skills tab. Native CLI memory/skills stay
disabled; the host provides the member's own memory/skill context and tools.

```powershell
npm run look -- details raphael-details details-memory details-skills raphael-skills member-brain-saved primary-contact-column primary-contact-set sidebar-folders primary-room-picker primary-room-members primary-room-chief quick-model-menu --theme both --width 1120,720,1920x1080
npm run native -- bot-homes
```

`member-brain-saved` saves the CLI model, reopens details and the shared chooser,
then checks the stored selection, selected row and one boundary write. The offline
native `bot-homes` journey migrates
three copied notes plus a skill, checks hashes, then answers through a fake Codex
child using the production CLI loop/MCP boundary. It borrows no owner login and makes
no provider calls. Fixture/native/real-provider/judge evidence remain separate.
Phase 2 adds automatic capture, recall/folding and owner pending review below. Learned skills remain phase 3.


## Memory that grows, phase 2 (owner decision 2026-10-29)

Every API/CLI brain receives the same `memory_update`, `memory_log`,
`session_search` and `session_read` definitions through the production harness and
RaphaelMcp. Tool writes are limited to 1000 characters. Useful private facts and
work outcomes may be recorded without a remember phrase. After external ingestion
(including external history retrieved later), writes stay outside the home under
`bot-state/<id>/pending/` until the owner approves them. Pending entries appear in
the existing member Memory pane; View shows a read-only proposal, operation,
target and destination, Approve applies it, Delete rejects it. Approval rechecks
the target revision; conflicting proposals remain pending. Pending data never
enters prompts, recall or member-visible search.

Private owner conversations, including owner facts and background capture, write
only to that member's own home. Shared notes contain the shared owner profile,
owner words in rooms/group chats and facts explicitly shared with everyone.
Search/read/recall never inspect another member's private thread or home. Room
turns cannot retrieve a member's private sources. `ask_member` lets the target
member choose what to answer. All read paths, including cold index construction,
recall and history reads, remain silent: they never emit change notifications.

The prompt includes the bounded main memory (200 lines / 24000 UTF-8 bytes), a
topic index of at most 40 lines / 2000 characters, shared owner/team facts and the
existing skills index. Overflow is archived; canonical topic files remain intact
and searchable even when the archive must use references to stay within the home
file limit. FTS5 is built in memory from permitted sources only, without disk or
state writes. Automatic recall stays in the current thread; explicit session_search can find
the member's other own threads and joined rooms. Auto-recall precedes the user question, never the system prompt,
and is capped at 6000 characters with at most four memory and four conversation
hits. Logs stay out of the system prompt.

After quiet time or six answered owner turns, a tool-less pass on the member's
own selected brain (including CLI subscriptions) captures up to eight preferences,
facts, decisions or outcomes with confidence >=0.6, deduplicating exact facts.
Daily tidy removes expiry, merges duplicates/corrects contradictions and permits
topic splitting while preserving sources after refused replacements. Capture
skips exchange/routine turns; room capture is optional and remains disabled.

```powershell
npm run verify -- --core
npm run look -- details-memory global-private-memory --theme both --width 1120,720,1920x1080
npm run native -- memory-growth
```

`details-memory` opens the pending proposal; `pending-memory` checks read-only
controls, the owner action, contextual external-content notice and zero writes
on opening. `global-private-memory` checks shared provenance/private separation,
then opens an ordinary editable note for same-component comparison. No new scene
is added to the Guardian matrix. `core/tests/memory/test_growth.py` covers silent
reads, own-home isolation, pending review/conflicts, bounded tools/recall, turn-one
retrieval on turn 25, member-brain capture and tool-less CLI capture. The native
fake-brain journey sends 25 real app turns and checks the member-written home and
zero spend. It proves host plumbing, not real-provider inference or design-judge
acceptance. Learned skills remain phase 3.


## Skills that grow, phase 3 (2026-10-29)

Every member, including Raphael, receives skills_list, skill_read and skill_manage through
one shared team-tool definition and the production API/CLI paths. Skill indexes contain
only names/descriptions; complete documents and bounded references are read on demand as
untrusted guidance. Generated documents require When to use / Procedure / Pitfalls /
Verification sections, name/description frontmatter, <=128 KiB and <=8 references of
<=8000 UTF-8 bytes each. Updates check the current document SHA-256. Bot tools never
change enable switches or another member's skills.

The existing memory background scheduler serializes tool-less review with capture/tidy.
Each private conversation has its own watermark and persisted failure count. At >=10 tool
steps since review, the selected member brain proposes <=3 reusable class-level changes,
preferring updates. Three consecutive failures stop that thread's review across restarts.
Cleared/deleted work and stale document revisions are rechecked after the brain returns.
No tools, provider fallback or normal CLI resume session are used for review.

The existing member Skills pane shows provenance and learning date, opens an editable
document, deletes and undoes the latest change (including deletion) through existing RPCs.
The owner editor supplies its read revision to prevent overwriting a background update.
The host journal/mirror records revisions outside bot-writable homes; read/list/index and
undo discovery never mutate or notify. A learned skill adds one localized conversation
event line without exposing its internal event payload. zh-TW and Japanese memory headings
join the member name directly to the possessive particle.

```powershell
npm run verify -- --core
npm run look -- details-skills raphael-skills member-text details-memory global-private-memory details-commands --theme both --width 1120,720,1920x1080
npm run native -- skill-growth
```

The selected scenes cover learned provenance, silent reading, delete/undo, conversation
notices and the ordinary memory/command editor comparisons. The native journey checks the real
heading, ten persisted tool calls, a background-generated home skill, and a successful
skill_read on the next similar request, with zero fake-provider spend. This proves host
plumbing, not real-provider inference. Core behavior tests are in
core/tests/members/test_skill_growth.py and test_harness.py. Guardian S21.skills.list and
S21.skills.manage are explicitly mapped; live coverage remains unverified until authorized.

When changing the learning notice, also capture member-text and centred-system-events
at the same themes/widths to compare the shared eventLineHTML treatment.
