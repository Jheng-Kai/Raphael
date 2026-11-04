# Members and sidebar

## Quiet resting poses (2026-11-04)

[Performance](performance.md) supersedes the idle-strip and droplet descriptions below.
Idle and sleeping use one still original vector at every size, without animation
strips or a breathing loop. Sleeping keeps its closed eyes and resting pose. Pointer
entry may play one finite delight before resting again. No state draws a detached
droplet or bubble; their elements, keyframes and sampled data are removed.
Working retains its 900ms body loop with twelve cels; other body timing is unchanged.
Hidden documents pause animations in phase; offscreen surfaces and descendants
retain `animation: none !important` to avoid long-thread freezes.

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
npm run look -- slime-states slime-picker slime-sizes slime-gallery slime-motion-idle slime-motion-busy slime-motion-moments slime-motion-change slime-sharp slime-pointer slime-cost --theme both --width 1120,720,1920x1080
```

These walk the owner's flows to their end: `member-delete`
deletes 小森 from the row's ⋯ menu after the confirmation (the menu had lost 刪除 on
10/24); `new-conversation-rests` presses 新對話 in the details and the button must rest
while that conversation is unwritten (owner, 10/31: a new conversation is made only from
a member's details, never the sidebar's ＋, and never beside one still empty);
`member-maker*` is 新增成員 as a character maker where the conversation stands, slimes
only (owner, 10/31: no pictures, for copyright; Grok Bot's create page is the reference
at bots/research/grokbot/12-flaviocopes-create-first-bot.jpg, without its suggestions: other
people's bots will come from a library later). It asks only for a name; the
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

Routine, skill and command rows put edit/delete in their overflow menus
(R-UI-11). A memory is a document with one 編輯, and a shared entry ends with whom the owner told it to and when (`global-private-memory`). Routine switches remain on their rows. Existing edit, approval and undo
behavior remains in the shared editors and controllers.

## Gotchas

Fixture member 1 is 小晴 with conversation 11; Raphael has special avatar behavior.
Skills/commands/voices have empty fixture collections. Seed resources before claiming
populated-resource flows. Native avatar picking/cropping, files, audio output and
provider behavior need native evidence. A dialog screenshot does not prove saving.

## How a slime moves, and why it stays sharp

The owner (2026-10-31): the slimes looked blurred, and the motion should be finer and cuter, 「那個是我們 App 的核心精隨」. Judge them on the owner's screen: 1920x1080 at 100%.

Sharpness (R-UI-63). At DPR 1 in software Edge, the original SVG-group `transform` animation broadened the antialiased fringe compared with the same pose drawn without animation. Pausing retained that blur too. The compositor/resampling explanation is an inference from pixels, not a successful layer trace; GPU and WebView2 remain separate acceptance.

Active states deform vectors through individual `translate`, `rotate` and `scale` properties. Arriving has no opacity animation: combining its fade with a squash broadened the fringe again. Idle at up to 72px uses two seven-cel vector strips: the body and the eyes. CSS steps slide HTML strips by three whole avatar widths, with a fixed three-box paint reserve, avoiding both raster resampling and per-frame SVG layout across the sidebar. Larger faces repaint a breathing path and eye motion directly. Small faces fit eye spacing, centre and stroke to the pixel grid. Avatar sizes are rounded to whole pixels. A 120px outer paint reserve prevents a wide landing from contributing scrollable overflow without cutting horns or wings. The surrounding control never changes geometry.

`slime-sharp` captures a nearly stationary running animation and then cancels every animation, preserving only its computed animated properties inline. It covers nineteen idle sizes (18-120px, including the 19px room face), all nine active states at 40/96px, and a transition at 40/72/96px. It records changed pixels and each size's antialiased pixel counts. A wider fringe (over 5% plus two pixels) fails; a different coverage value on the same antialiased edge is retained as evidence, not mislabeled as blur. The four-times nearest-neighbour enlargement includes the entire specimen area, running above static. `LOOK_SLIME_BASELINE=a47aa935` runs the same check on the original local commit and must fail. This is a diagnostic environment override, not a product setting. No network is used.

Motion is CSS keyed on `data-state`; JavaScript runs only at creation, state changes and pointer events. Idle's 23.3s body and 9.7s eyes share no beat, with per-member `--slime-tempo` and clock-based `--slime-delay`. `--slime-since` preserves one-shot progress through redraws. Active states have anticipation, squash, landing and delayed marks; done and arriving play once, error holds its deflate, and sleeping has two separated Zs. `handOver` preserves the current pose through registered numeric transitions. A pair of rotations around a signed scale preserves shear without animating a cached CSS matrix. The first 320ms returning to idle uses that continuous vector before the cel loop takes over. Motion capture waits a rendered frame before freezing a newly created transition. The pointer moves the same surface, so body, marks and eyes stay together; its squish follows press and release. Reduced motion disables the whole surface, including the idle strips.

`slime-sizes` compares actual sizes with the shared search glyph at 20/40px. `slime-gallery` shows every state at sidebar and large sizes. `slime-motion-idle`, `slime-motion-busy`, `slime-motion-moments` and `slime-motion-change` retain timed strips. `slime-pointer` drives real pointer hover/down/up and checks a stationary control. `slime-cost` measures the same twelve-slime sidebar for 12 seconds per variant, original commit then working tree, preserving colours, hats and layout; it records main-thread/style/layout/script and whole-browser CPU as percent of one core, without a machine-dependent pass threshold. R-UI-54 permits an explicit full-box clip margin; the maker additionally checks the visible paths against ancestor clipping bounds.

The selected consumer matrix is sidebar, sidebar-many, sidebar-rail, sidebar-group-avatar-four, details, member-text, member-avatar, member-maker-chosen, member-maker-made and home, plus the eleven slime scenes above, at both themes and 1120/720/1920x1080. Inspect every contact sheet, the state strips and full-size consumers. The native `slime-sharp` journey is implemented for a later isolated WebView2 check; its existence is not a passed native result.

## Sidebar administration

Raphael and every member can administer the sidebar from their own conversation: overview, member creation
and editing, groups, any member's routines, skill imports and command templates (owner decision 2026-10-31:
everyone's abilities are the same; Raphael is the default member and the chief role only decides who the owner brings work to
without authority over who speaks in a group). The owner still confirms every change at the end of the turn.
Management tools, including the legacy create_member alias, are offered to every speaker, never to one that another member asked. Both creation names share the same ten-per-turn limit and member service. Creation uses distinct available
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

Where the owner's setting asks first (先詢問 or 計畫) every brain collects the entire turn's reversible
member/group changes in one card, including eight-member requests across multiple model
rounds or sequential CLI MCP calls (a safety rule that asks does the same in 自動). In 自動 the
changes are made at once, like any other tool of their tier, and the model has the real IDs in
the tool results. Every member lists name, role, blurb and group. Approval applies the entire
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
after 20 s and 60 s with one progress line per outage (a room or background turn, which no one sits
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
back to Raphael, nothing else changes, each room reads the current chief without an automatic conclusion, a roster that kept the old one
is told apart on each path), core/tests/background/test_primary.py, and Guardian S02 (every Bot names the new primary as the chief after the
owner changes it; a brain that keeps the old one, never says it or names a different chief fails on both brain paths), S03.primary-dispatch (the primary hands
the work to 信件助理 itself) and S07.meeting (held with a primary that is not Raphael). Live brains and the native shell (the persisted choice
after a relaunch, the allowlisted `members.set_primary`) need their own acceptance.

## Editable member proposals (P05)

Where the owner's setting asks first, API and sequential authenticated CLI/MCP calls queue the
same turn-end proposal. Pending tool responses have no created IDs and explicitly prohibit
claiming success. Owner confirmation rechecks edited arguments against current safety rules and
applies the transaction once; the turn then goes on in the same turn (the API brain's own
conversation, a CLI brain's native thread) told what now exists with the real IDs, so a chief
asked to create a team and start it can hand the new members their work after the yes. Cancel,
expiry and a superseding turn discard it. Repeated
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
sequential HTTP MCP paths, edits, the turn going on after the yes with the real IDs, the
automatic mode creating at once, a safety rule that asks, cancellation, expiry, resend,
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

## What destroys waits in the ⋯ (R-UI-56)

Clear, clear all, delete and remove never stand open on a page (the owner, 2026-10-31, about the memory tab). They wait in the ⋯ of the row or section title they
act on, and its right click: 全部清除 in the title of each memory document, 清除 in the conversation summary's row, the clears of Settings › 資料 in their rows (所有聽寫紀錄,
所有對話紀錄), 移除金鑰 in the key's row of Settings › 模型 › 用量, a person's removal in their Telegram row and a downloaded local model's deletion in its row of the chooser.
`openConfirmMenu` (app/src/main/ui.ts) keeps the second press the buttons had: the first press asks in the item's place for five seconds, and closing the menu forgets
it. A local model still asks in its row, and a clear of 資料 still gives its ten seconds of 復原.

The audit of every look scene (`R-UI-56`) fails a button named for clearing, deleting or removing, in any of the three languages, unless it stands in a menu, in a
dialog about that one thing (`.mb-dialog`, `.cs-dialog`), in a local model's inline question, or in what is being composed (`.composer`, `.draft-panel`). The Settings window is a page: it is
not excepted. Telegram's 中斷連線, a pending person's reject and a mail draft's 捨棄 use other words and stay where they are.

```powershell
npm run look -- memory-clear-menu memory-clear-done memory-summary-menu memory-summary-done context-menu-memory-title context-menu-memory-summary details-memory global-private-memory --theme both --width 1120,720,1920x1080
npm run look -- data usage-key-menu usage-key-removed context-menu-api-key messaging-user-menu messaging-user-removed model-choices-local-menu context-menu-local-model --theme both --width 1120,720,1920x1080
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

While recording, the composer's one button shows the send glyph (not Stop, see
[Conversation](conversation.md#the-composers-one-button-send-while-speaking-stop-once-sent-2026-10-31)); clicking it releases recording through the
native question-key path, transcribes and sends. It never calls cancelSession.
Only Escape uses the two-press cancellation gesture. The recording flyer/is-voice
state survives task redraws; pending/member/background tasks still use Stop.
Pointer regression tests cover Raphael and another member in agent-members.test.ts.
Native voice-conversation proves local WAV transcription and persisted turns with
a fake brain; it does not prove a physical microphone or live-provider behavior.

## Owner round 6 contracts

Owner round 6: member-text and the shared details scenes cover conversation consumers of the overlay scrim, single inset and card cap. Existing compact rail badges, selection backgrounds and conversation placement remain owner-approved.


## Bot homes, phase 1 (owner decision 2026-10-29)

Every member, including Raphael, owns `bots/<id>/SOUL.md`, `MEMORY.md`, `memory/log/`
and `skills/<skill>/SKILL.md`. SOUL.md is written by the core from the member's details;
the database remains authoritative and no bot can write it. `skills.json` records enabled
state, provenance and document revision. Atomic, bounded, allowlisted document writes
redact secrets, check optimistic SHA-256 revisions and keep undo journals outside
bot-writable homes. The owner's profile is one file, `shared/USER.md`.

The first move of the folders copies every source and then removes verified sources,
keeping private/shared placement; conflicts abort without overwriting. Tests use a copied
synthetic tree, never owner data. Search/read never cross another member's private memory
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

`member-brain-saved` saves the CLI model on that member and never on Raphael (R-MODEL-01), reopens the chooser,
then checks the stored selection, selected row and one boundary write. `model-sync-member` walks to another member
and to Settings to see that neither moved. The offline
native `bot-homes` journey migrates
three copied notes plus a skill, checks hashes, then answers through a fake Codex
child using the production CLI loop/MCP boundary. It borrows no owner login and makes
no provider calls. Fixture/native/real-provider/judge evidence remain separate.
Phase 2 adds automatic capture, recall/folding and owner pending review below. Learned skills remain phase 3.


## Memory as living files (owner decision 2026-10-31, supersedes phase 2's notes)

The owner, about rows of 待確認 notes that could repeat each other: memory is a file that keeps being edited,
as in Hermes. Each member has `bots/<id>/MEMORY.md` (the pane's 「<name> 的記憶」), which no other member
reads, and all read the one `shared/USER.md` (共同記憶). Limits are Hermes's: 2,200 and 1,375 characters.

Every API/CLI brain edits them through one tool, `memory_update {target: memory|user, operations: [{action:
add|replace|remove, content?, old_text?}]}` (and an API brain's reply field `memory`, the same edits). Useful
durable facts and preferences are recorded without a remember phrase. Reusable task lessons belong in skills;
progress and completed-work logs belong in session_search/memory_log. All writers, including skill review, use
`memory/doctrine.py` and forbid negative capability claims and transient failures. The same fact keeps one line: the same words
are not added again, more words take the place of fewer, another wording is refused with the entry to
replace. A batch is atomic and its limit is checked on its result; a refusal says how much to free and shows the
entries; past three failures in a turn the model is told to stop and answer. `old_text` is a short unique part of
one entry; `replace` changes that span and keeps the rest. Two members writing at once lose nothing.

A model chooses the file; the host checks the choice for USER.md. From a private turn an entry goes there only
when it is about who the owner is, not a conversation, a plan or a task, and the owner did not ask to keep it from
the others; otherwise it goes to the member's own file and the model is told so. An explicit request to tell
everyone, and a room's turn, write there whatever it is about. Every entry that reaches USER.md through a member
ends with whom the owner told it to and when.

There is no review queue. It protected against a web page planting a fact or an order through the model, and it
held nearly every working turn's facts in rows the owner had to approve one by one. Now: instructions and secrets
are refused at every write, and a line that reaches the file by hand is blocked from the prompt and stays for the
owner to remove. Each outside claim (a web page, a file, a connected service, a colleague) goes in with
「（待確認）」 at its start and changes only other marked entries; the model reads it as a claim. In the same
atomic batch, host-verified close restatements of the owner's current private request stay trusted. Matching
preserves negation and clause boundaries; unmatched paraphrases conservatively keep the mark. Exchanges, rooms
and routines do not supply owner evidence. Clean own-history search is not external ingestion; a recalled web
claim or marked log still is. Only the owner's matching words or removing the mark through the existing document
editor confirm a claim; model rewrites, remove/add batches and moves between files retain its mark.
The reflection pass reads only the owner's words of a turn that read outside content, so
what it writes needs no mark.

A turn reads both files once, at its start, in a form nothing it writes changes (`snapshot`), with how full each
is; the tools see the live file. API brains read them in the system prompt. A resumed CLI session keeps the
instructions it began with, so CLI brains read them in every turn's message. A room's turn and work a colleague
handed over read USER.md alone. FTS5 search covers logs, turns and rooms from permitted sources only, without disk
or state writes. Auto-recall precedes the user question, never the system prompt, capped at 6000 characters with
at most four log and four conversation hits. All read paths remain silent.

After quiet time or six answered owner turns, a tool-less pass on the member's own selected brain (including CLI
subscriptions) reads both files whole and answers with edits at confidence >=0.6; a full file sends it back once
with the refusal. Once a day a file past 80% of its limit is consolidated the same way. A pass nobody watches may
not empty a file or take more than half of it, and the journal keeps what any edit replaced. Capture skips
exchange/routine turns.

CLI memory checks the loop's failure state before parsing its final text: an owner-facing quota/login message
is not a successful JSON answer. Claude uses its native JSON schema output without a permission callback absent
from the tool-less catalog. Failures log a known kind and fixed short reason, never model text, stderr, notes
or provider excerpts. Background failures retain the watermark, stop before consolidation and retry after 15,
30, 60 minutes, doubling up to six hours; success resets the pause. Claude member and memory turns use empty
`--setting-sources` and `--disable-slash-commands` (verified with installed CLI help offline).

Core-only regression scope: `tests/memory`, `tests/agent`, plus `tests/background/test_memory_tools.py` and
`tests/members/test_skill_growth.py`. No UI markup/navigation changes require additional look scenes for these
contracts (R-MEM-06–09, R-CLI-04). Live subscription acceptance remains separate and requires authorization.

At every start `memory/legacy.py` moves what the old store left (note files, the review queue, derived documents)
into the files, merging exact and near duplicates, after copying everything to `bot-state/<id>/notes-backup/`. What
waited in the queue enters marked; a note past its date keeps it in its words; a file over its limit stays whole.

The pane (`memory-view.ts`) shows each file as paragraphs, one 編輯 opens all of it in one box that grows with its
text, and 儲存 sends the copy's revision: an edit from an old copy is refused, what was typed stays, and the next
儲存 is made knowing it. 全部清除 and the summary's 清除 wait in their ⋯ (R-UI-56).

```powershell
npm run verify -- --core
npm run look -- details-memory memory-editing memory-saved global-private-memory member-edit-memory settings-memory --theme both --width 1120,720,1920x1080
npm run native -- memory-growth
```

`memory-document` checks paragraphs, no rows or type labels, the 待確認 tag, a real 編輯 and no scroll of its own.
`memory-editor` checks the whole file in a focused box that does not scroll. `memory-saved` checks one write of this
member's file with its revision. `global-private-memory` checks shared provenance and private separation.
`member-edit-memory` and `settings-memory` cover the edit dialog's box and Raphael's tab of Settings.
`core/tests/memory/test_files.py` covers every contract above, `test_reflection.py` the pass, `test_growth.py` silent
reads and bounded recall, `members/test_cli_brains.py` a resumed session and MCP edits. The native fake-brain journey
sends 25 real app turns and checks the member-written file and zero spend. It proves host plumbing, not real-provider
inference or design-judge acceptance. Learned skills remain phase 3.


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
notices and the ordinary command editor comparison. The native journey checks the real
heading, ten persisted tool calls, a background-generated home skill, and a successful
skill_read on the next similar request, with zero fake-provider spend. This proves host
plumbing, not real-provider inference. Core behavior tests are in
core/tests/members/test_skill_growth.py and test_harness.py. Guardian S21.skills.list and
S21.skills.manage are explicitly mapped; live coverage remains unverified until authorized.

When changing the learning notice, also capture member-text and centred-system-events
at the same themes/widths to compare the shared eventLineHTML treatment.

## Group prompt truth (2026-11-01)

R-AG-02 applies with or without room roles. Every participant reads every message
and decides whether to speak. The meeting tool selects the current chief from the
snapshot, never a mandatory Raphael (0), and posts only the owner agenda. No role
creates rounds, dispatched speakers, a template or an automatic conclusion. Roles
stay room-only; assigned work uses handoff and reports its actual result.
Offline evidence: core/tests/members/test_room_listening.py, test_room_intents.py,
test_primary.py and core/tests/evaluate/test_p02_scenarios.py. No UI changed.

## Menus beside their rows (2026-11-02)

R-UI-73 keeps the member Move to group menu beside its own action row using the shared ui.ts submenu behavior. openActions passes that actual row to member-actions.ts. Hover waits 120 ms, click/Right opens, Left/Escape closes only the child, the safe triangle protects diagonal travel, direct sibling travel switches immediately, and leaving both waits 250 ms. Opening rectangles survive background redraw; live caret completions retain their explicit anchorRect. No setting or toggle is added. Hide keeps its eye-off action icon without a navigation chevron.

Selected scenes: menu-move-hover (real hover plus MembersChanged/WorkerChanged redraw), menu-move-picked (existing members.update call and group result), menu-move-keyboard, menu-move-flip (real right click near the compact column edge), menu-move-diagonal (real mouse motion across the neighbouring row), menu-hide-control. submenu-placement checks both menu levels, row highlight/aria-controls, first-row alignment, touching sides, viewport containment and checked choice. Representative existing consumers: context-menu-member, context-menu-conversation, room-menu, polish-effort-composer and local-command-settings. Run both themes at 1120,720,1920x1080. Tests: menu-submenu.test.ts, member-column.test.ts, member-details.test.ts, ui.test.ts and menu-keys.test.ts. The menu-key stand-in learns the shared submenu selector; its keyboard ordering assertions are unchanged. ui.test.ts now pins touching edges instead of the former 4px gap.

menu-settings-redraw also emits SettingsChanged through the fake IPC boundary, waits for the keyed control to be replaced and its new checked value to arrive, and asserts the open menu keeps its coordinates in both themes at all three sizes. menu-submenu.test.ts reproduces the replaced-control case with a moved rectangle before its fix.


```powershell
npm run look -- menu-hide-control menu-settings-redraw menu-move-hover menu-move-picked menu-move-keyboard menu-move-flip menu-move-diagonal --theme both --width 1120,720,1920x1080
```

menu-pointer-return protects a fresh real mouse press on the more button after a right click; its menu returns under that control instead of retaining the pointer rectangle. context-menu.test.ts retains its existing trusted-click assertion.

```powershell
npm run look -- menu-pointer-return --theme both --width 1120,720,1920x1080
```

## Review: shared menu scroll intent (2026-11-02)

Outside wheel/touch scrolling and page-scrolling keys close all open menu levels. Inside input retains menu scrolling and navigation. Resize closes all levels; work-event storms and programmatic/layout scrolling preserve frozen placement. Live completion anchors continue following their caret. See conversation.md for the full selected review matrix.

```powershell
npm run look -- menu-wheel-closes menu-resize-closes menu-hide-control menu-settings-redraw menu-pointer-return menu-move-hover menu-move-picked menu-move-keyboard menu-move-flip menu-move-diagonal --theme both --width 1120,720,1920x1080
```

## Shared presence and sidebar previews (2026-11-02)

R-UI-74/77: slime-states, slime-gallery, slime-motion-idle/busy/moments/change,
slime-sharp and slime-cost accompany presence-states-sidebar, presence-hover-action,
presence-blocked-stays and presence-waiting-colleague. The same SVG parts serve the
sidebar, header and 28px live thread. Reduced motion keeps the thinking dots,
attention mark, lidded waiting eyes and static working ribbons recognizable.

sidebar-row-time checks the reserved time/overflow slot and absence of role pills;
sidebar-group-author checks the latest public author prefix, while owner waiting
keeps its existing preview. Names stay on pinned tiles and roles remain in the
header/details panel. Run both themes at 1120,720,1920x1080. See conversation.md's
presence section for the associated transcript, event-line and core contracts.

```powershell
npm run look -- presence-states-sidebar --theme both --width 1120,720,1920x1080
```

Hidden theme emblem alternatives defer loading until visible (avatar.test.ts).
Presence effects avoid composited opacity animation so the animated SVG keeps
the static pose's edge (slime.test.ts; slime-sharp). Re-run slime-cost after paint changes.
Compact drawer controls start below window controls (sidebar.test.ts); the actual
room-group-menu, room-required-chief and room-generated-name journeys click the
plus button and open group creation at all three mapped widths.

```powershell
npm run look -- room-group-menu room-required-chief room-generated-name home-empty home-720 home-motion --theme both --width 1120,720,1920x1080
```

slime-board.test.mjs guards the static sharpness comparison: freezing animations
retains resolved SVG fill/stroke opacity when registered animation variables are
absent from keyframes. The existing pixel and soft-edge limits remain unchanged.


Review regression coverage (R-UI-78, R-UI-80): slime-parts samples eyes and hats
against body bounds throughout each state loop at 19, 22, 26, 28, 30, 40, 48 and
72px and in the group's 20x19px cell. Run it with slime-sizes, slime-gallery,
slime-motion-idle, slime-motion-busy, slime-motion-moments, slime-motion-change,
slime-sharp, slime-cost and sidebar-group-author, both themes and mapped widths.
core/tests/members/test_presence.py checks viewed/unviewed failures and counts
waiting/task queries through members.list, including queued labels.

```powershell
npm run look -- slime-parts slime-characters-at-rest sidebar-characters-at-rest --theme both --width 1120,720,1920x1080
```


## Our liquid body language (2026-11-02)

This supersedes the symbol-based presence poses and the sleeping Zs above, under
R-UI-74, R-UI-78 and R-UI-SLIME-01. The body and costume remain in every state;
only its shape, eyes and own-colour liquid props change. Thinking sways over 2.8s,
working kneads every .9s with alternating droplets over 1.8s, blocked shivers over
1.8s with a lighter own-colour sweat drop, and error holds a .62-height puddle
with one slow drip. Sleeping uses a crown bubble. Done throws two droplets during
one happy jump, then the existing state timer hands it back to idle.

`slime-liquid-sheet` shows every state at 22, 28 and 40px at four phases of its
loop, including a horned character. `slime-liquid-still` exercises reduced motion
with plain, horned and hatted slimes at the same sizes; it checks eleven distinct
poses, no animations, visible liquid props and an 8% minimum prop width.
`slime-parts` now samples droplet/bubble bounds as well as attached eyes/hats,
including keyframe boundaries and the group's non-square third cell. Existing
slime-state assertions now require kneading/swaying instead of ribbons/dots.
Idle strips and state handover continue to protect R-UI-63/71 and slime-cost.

Selected matrix: slime-states, slime-motion-idle, slime-motion-busy,
slime-motion-moments, slime-motion-change, slime-gallery, slime-parts,
slime-sharp, slime-cost, slime-liquid-sheet, slime-liquid-still,
presence-states-sidebar, presence-blocked-stays, presence-waiting-colleague,
transcript-working and sidebar-group-author, both themes at 1120,720,1920x1080.
Compare the sidebar/header/live-thread consumers at matching theme/width.
Product strings and navigation are unchanged.

Liquid fades animate registered --slime-liquid-alpha into SVG fill-opacity;
direct opacity animation can promote and resample the whole moving SVG.
The new R-UI-63 regression test and unchanged slime-sharp pixel limits protect it.
The old presence-transcript test that pinned dots/exclamation/ribbons now protects
the same body, colour and liquid props; its owner/dependency state-priority tests
are retained unchanged. No timeline or work-detail implementation is changed.

```powershell
npm run look -- slime-liquid-sheet slime-liquid-still slime-states slime-motion-idle slime-motion-busy slime-motion-moments slime-motion-change slime-gallery slime-parts slime-sharp slime-cost presence-states-sidebar presence-blocked-stays presence-waiting-colleague transcript-working sidebar-group-author --theme both --width 1120,720,1920x1080
```

## Motion cost (2026-11-03)

R-PERF-01 extends R-UI-63/71/74/84 and R-UI-SLIME-01. The keyframes in
slime.css remain the vector source; `node scripts/slime-cels.mjs` regenerates
the checked pose data. At 72px and below every loop uses whole-frame HTML cels;
independent axes retain body, props, marks, gaze and blink periods. Each axis has
twelve sampled poses (four lid shapes retain the short blink's boundaries); the
working body keeps 900ms while its droplets keep 1800ms. Only the current state's
strips are mounted. Finite transitions, done, arriving and touch stay vector.
The named `large-avatar-vector` exception applies only above 72px.

`motion-cost` audits running infinite animations and repeats Performance.TaskDuration
under a synthetic eight-working/two-sleeping load. Every sample must stay below
3 percent of one core. It runs on slime-states, presence-states-sidebar,
busy-team-thread, busy-team-home, busy-team-room and running. The separate
motion-cost-details scene isolates the unchanged animated emblem against its still
and measures one 96px working vector. It is measurement, not native acceptance.
motion-idle-cost repeats twelve resting members against starting revision
e2143ec7 twice each. slime-motion-recovery protects error/blocked handovers.

Selected matrix: those six scenes plus slime-gallery, slime-liquid-sheet,
slime-liquid-still, slime-parts, slime-sharp, slime-motion-change,
slime-motion-busy, slime-motion-moments, slime-motion-idle, slime-pointer,
slime-characters-at-rest and the affected question/pending-work consumers,
both themes at 1120,720,1920x1080. Inspect every contact and the full-size small
faces beside the before run and external reference. `slimeParts`, handover and
sharpness inspect the actually painted cel, with their existing geometry/pixel
limits retained. The old idle-only transform allowlist now allows whole-frame
translations for active strips too. Event freshness assertions remain intact.

Event reads follow ConversationsChanged/AgentTurn for conversation metadata and
history, MembersChanged for capabilities, RoomsChanged for room metadata/messages,
MemoryChanged for memory, and relevant WorkerChanged for loaded work history.
The common event reader shares simultaneous consumers, limits starts to 300ms
and always delivers an invalidation that arrived during an in-flight read.
The existing event-storm checks assert no work-triggered rooms/skills/commands
reads, preserved faces/scroll/input and bounded total reads.

No new RPC, migration, product text, preference or navigation is introduced.

The final selection is 33 scenes, both themes,
1120,720,1920x1080. This includes the six additional busy-team variants, recovery, picker,
sizes and pending composer. Benchmarks repeat two 2.5-second windows after
6.5 seconds of warmup, explicitly loading eight visible small working avatars
and two sleeping avatars. Idle comparison records avatar DOM counts. Admission
uses elapsed performance time, independently of the fixture or system wall clock.

Working shares its commensurate 900ms body and 1800ms droplet cycle in
24 combined frames (twelve poses per knead), avoiding a 12 by 12 DOM product.
The representative character DOM budget is protected in slime.test.ts.

```powershell
npm run look -- slime-states presence-states-sidebar busy-team-thread busy-team-home busy-team-room running slime-gallery slime-liquid-sheet slime-liquid-still slime-parts slime-sharp slime-motion-change slime-motion-recovery slime-motion-busy slime-motion-moments slime-motion-idle slime-pointer slime-characters-at-rest slime-picker slime-sizes busy-team-up busy-team-steps busy-team-typing busy-team-follow busy-team-anchor busy-team-hover admin-approval room-question-card composer-stop-voice composer-stop-pending motion-cost-comparison motion-cost-details motion-idle-cost --theme both --width 1120,720,1920x1080
```

Generated surfaces with unchanged identity, colour, member, tempo and state are retained before parsing their cel markup. Newly parsed subtrees are inserted directly without a duplicate clone. ui-patch.test.ts guards allocation, keyed reorder and changed identity/state. The mixed-load setup changes each selected avatar directly to its measured state once; it does not inject an intermediate idle handover. The same setup applies to the baseline and current implementation.

The glyph mask clips the moving gradient's layout overflow. R-UI-55 audits the
painted pseudo-element gradient and requires its glyph mask; its original flat
gradient rejection remains. The native recognising-light check reads that same
painted element. Home's
four-second event storm is bounded to 27 total reads. After the 33-scene matrix,
the local shimmer/limit corrections are rechecked in composer-stop-voice,
composer-stop-pending, running and busy-team-home at both themes and all three sizes.
## Sending a prompt (2026-11-03)

R-PERF-02 times what the owner feels when they press Enter, in `app/scripts/look/send-probe.mjs`: the frame after the key, the longest task and the main-thread share over a whole turn, on a sixty-turn thread, at normal speed and at a quarter of it. Core reads for a computer nobody watches are remembered in `DesktopViewer.unwatched_status`, and a closed details panel neither reads nor draws.

```powershell
npm run look -- send-prompt send-prompt-slow --theme both --width 1120,720,1920x1080
```
