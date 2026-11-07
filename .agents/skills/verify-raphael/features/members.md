# Members and sidebar

## Private member voice chat (2026-11-05)

An empty member composer offers Start voice chat in its existing right-hand slot;
typed words/files retain Send, Raphael retains dictation, and rooms never offer calls.
One call owns the microphone across navigation. Another start opens the shared
confirmation dialog; only End and start ends the previous call. The panel replaces
the composer and exposes Mute, Hang up, a transcript disclosure and shared Voice /
Speed / Language dropdowns (Auto-detect by default). The existing character's
working and waiting motion projects speaking and listening without a second mascot.
During a call the empty-thread hero yields to that single panel character.

The same dictation recorder, device, selected engine and VAD cut a call turn after
0.8 seconds of pause. Ordinary dictation still waits for its key. VAD speech onset
sets the existing speaker stop event synchronously; PCM playback checks it before
each audio block. AgentService keeps the owner question and member reply as ordinary
private turns. The call uses the member voice and existing streamed PCM service;
speed changes its playback sample rate. No new speech vendor/model loop is added.

Hang-up writes one durable voice-call receipt, with duration, expandable literal
transcript and local Good/Bad feedback. Call message rows fold under that receipt
to preserve R-UI-101. Owner questions and pending permission/setup/draft cards remain
actionable through the ordinary turn renderer until settled; folding never removes
a required decision. Microphone/model/voice failures use the existing Settings repair
entry; network failure ends the call and retains its already admitted turns.
Migration 67 stores call metadata and links to existing turns, with scoped cascading
deletion. Restart closes interrupted calls and retains their transcript.

Voice chat is not released yet (owner, 2026-11-06, R-UI-106): the voice button records voice messages only, and the call scenes come back with the feature.

Inspect every contact sheet and each new scene at light 720 and dark 1120. Compare
the busy dialog with dialog-caption-confirm, the settings controls with details-voice, the
receipt shell with card-mcp-done, and the
repair note with the existing missing-service note. A call receipt is a standalone
history card.
The call confirmation uses the shared compact `mb-confirm` shell because it has one
decision, rather than the member chooser's list. Settings put the existing `sel`
controls in shared menu rows because these choices apply only to the current call;
the member's persistent voice remains in Details. The receipt's disclosure includes
the duration and both speakers, so its summary adds a time and uses a trailing
chevron. A failed call keeps its shared missing-service note inside the durable
receipt instead of the transient read-aloud toast; there is only one repair action.
Fake recognizer / streamed TTS / player tests are in tests/services/test_voice_chat.py;
the VAD test uses the real DictationService with fake recorder/segmenter/engine.
The existing native runner's `npm run native -- voice-call` journey checks the real
shell admission, empty-member/draft guard and missing-voice Settings repair with an
isolated profile and no paid speech. It does not exercise a successful audio call.
Rendered fixtures establish UI/IPC behavior only. Native microphone permissions,
headset echo isolation, installed STT/model/device, actual audio-chunk interruption,
live model/provider/network and native restart persistence require separate acceptance.


## Member voice memos removed (2026-11-07)

Member details > Voice keeps the voice choice and the notify switch only; the voice-memo
and read-aloud switches, the reply Play/Pause control and the transcript are gone (owner
decision). Selected scene: details-voice; unit coverage asserts no memo control or toggle.

## Member panel tabs (2026-11-05)

The owner's 2026-11-05 request supersedes the former landing panel. R-PANEL-01/02/03/04 require the existing member identity followed by shared Details / Library / Computer tabs. Details contains work, routines and conversations; Library uses the existing file chip; Computer owns the screen, location and lifecycle controls. Gear keeps identity/resource editing. See [Member computer](member-computer.md#three-tab-member-panel-and-local-engine-recovery-2026-11-05) for the complete selected matrix and deferred native acceptance.

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

Both sides are resized by dragging, as Grok Bot's (owner, 2026-11-06, R-UI-110): there is no fold button and no handle is drawn, only the cursor changes over the edge and a thin line shows while it moves. The list's right edge drags it from 240 to 400 px; narrower than 176 px it folds to the 72 px rail, and the rail dragged out opens it at the width it was let go. The details panel's left edge drags it from 300 to 720 px; narrower than 240 px it closes, and the header's name opens it again at its kept width. Widths and the fold are kept in the browser's storage. Each edge is a keyboard separator (arrows; Enter folds the list or closes the panel); Ctrl+B still folds the list.

```powershell
npm run look -- sidebar-rail sidebar-rail-dragged-open sidebar-dragged-wider panel-dragged-wider panel-drag-closes --theme both --width 1120,720,1920x1080
```

Select a member, then click the stacked header title for details.
At compact width open the sidebar drawer to select a member first. The same title
closes the panel; its close button updates the same remembered session state. Details holds the face (a press shows
every picture and colour at once, no pencil), the routines, Raphael's conversations, 訊息平台 (each Telegram, Slack and
Discord bot not set up is one row with 設定; a connected one is its card with pairing) and one row 「技能、記憶、聲音和
權限」 with 設定. Every 設定 and the header's share send the owner's words into that member's conversation with an
`intent` (chat-ask.ts): the member sets it up there, with a card for a token, and share answers with a template card.
Nothing is typed into the panel and Settings holds no bot (owner, 2026-11-07). Scenes: details, raphael-details,
member-avatar, slime-picker, work-messaging-setup, work-messaging-pairing, messaging-paired-aligned. The sidebar plus is the member creation entry; verify the
complete flow for creation changes.

## Driving it with look

```powershell
npm run look -- members-expanded sidebar-folders --theme both --width 1120,720,1920x1080
npm run look -- details member-avatar member-edit details-memory details-routines details-skills details-commands details-voice --theme both --width 1120,720,1920x1080
npm run look -- sidebar-folders member-text --theme both --width 1120,720,1920x1080
npm run look -- member-delete member-conversation-sections --theme both --width 1120,720,1920x1080
npm run look -- member-maker member-maker-chosen member-maker-greeting member-maker-made --theme both --width 1120,720,1920x1080
npm run look -- slime-states slime-picker slime-sizes slime-gallery slime-motion-idle slime-motion-busy slime-motion-moments slime-motion-change slime-sharp slime-pointer slime-cost --theme both --width 1120,720,1920x1080
```

These walk the owner's flows to their end: `member-delete`
deletes 小森 from the row's ⋯ menu after the confirmation (the menu had lost 刪除 on
10/24); `member-conversation-sections` checks that a member's details have no
conversation list and nothing that makes one (owner, 2026-11-06: one conversation per
member, like Grok Bot, R-UI-103);
`member-maker*` is 新增成員 as a character maker where the conversation stands, slimes
only (owner, 10/31: no pictures, for copyright; Grok Bot's create page is the reference
at bots/research/grokbot/12-flaviocopes-create-first-bot.jpg, without its suggestions: other
people's bots will come from a library later). It asks only for a name; the
member opens and speaks first, typing while its own model writes the greeting (since
2026-11-06, R-COLLEAGUE-02: no tools, at most two sentences, only known owner context; a
failed one is an ordinary failure line whose 重新產生 calls `members.greet`), and the
owner's answer becomes its job through `set_my_job`, offered only while it has none. Conversations are
never deleted; only Raphael's quick questions can be cleared (`quick-clear-confirm`,
`quick-cleared`).

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
Raphael is the primary until another is chosen, and exactly one is at a time. As in Grok Bot (owner, 2026-11-06, R-UI-107), only the primary's own menu (the
row's more button or a right click; Raphael's while he is the primary) hands it on: its last item, after a hairline, is 換成其他成員. It opens 「選擇主要成員」,
a list of real buttons (Raphael and the other visible members, not the primary now) with nothing chosen, 取消 and the primary 設為主要, which waits for a
choice. Position alone identifies the primary: no star badge is drawn in the column, face strip or details, and the menu uses an up arrow instead of a star.

A member's row menu is grouped as Grok Bot's, with hairlines between the groups: 釘選, 移到分組 ▸, 標為未讀 | 編輯 | 分享為範本 | 隱藏, 刪除 (red, last).
The primary sits in the top slot, so its menu has no 移到分組 and no 刪除: 釘選, 標為未讀 | 編輯 | 分享為範本 | 隱藏, 換成其他成員. Raphael's row has 釘選 only,
and 換成其他成員 while he is the primary. Clearing a member's conversation, duplicating a member and marking every member read are not in the menu
(one conversation per member, R-UI-103; fewer choices, as Grok's).
The primary takes Raphael's large top slot in the member column, collapsed strip and sidebar board; Raphael takes the primary's former group/pinned position and keeps his emblem. The same identity swap orders member/conversation pickers, mentions, room membership/responder choices, room participant faces/role choices, and calendar/routine choices. It never mutates stored groups, pins, identities, current conversation, default recipient or the core roster.
Raphael's row has no destructive menu wherever it moves; an ordinary primary keeps its member menu at the top. Raphael can be chosen again from another member's primary picker. The primary holds the chief capability, is required in new or edited rooms and writes their single wrap-up. Existing rooms missing a newly selected chief require membership adjustment; in-flight work is not replayed. Opening the Conversation page and Alt+Space quick questions retain their existing thread behavior; this change only exchanges display positions.

```powershell
npm run look -- members-expanded sidebar-folders member-row-menu primary-contact-column primary-contact-menu primary-contact-picker primary-contact-set primary-room-picker primary-room-members primary-calendar-members primary-routine-members primary-room-chief --theme both --width 1120,720,1920x1080
```

`primary-contact-column` and `primary-contact-strip` check the exchanged positions, Raphael's emblem and localized name tooltips; only the sidebar chief has a star. `member-row-menu` asserts the grouped row menu, its hairlines and the red 刪除 last. `primary-contact-menu` opens Raphael's menu while he is the primary and asserts 換成其他成員 last, after a hairline; `primary-contact-picker` opens it from 小晴's menu while she is the primary, excludes her while offering Raphael, and after 小森 is clicked has one checked choice, 取消 immediately before 設為主要 and no write before confirmation. `primary-contact-set` asserts one `members.set_primary` call, the updated top row, badge-free details and no room/task/conversation mutation. The board scene also checks top-card visibility before/after fit, natural panel heights and no overlap. Member/new-conversation/mention/calendar/routine/room scenes assert the exchanged order; room choices require the current chief and routine selection stays unchanged. The member-picker driver uses the compact picker when available and the real new-conversation picker at wide widths.

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
npm run look -- dictation usage-key-menu usage-key-removed context-menu-api-key messaging-paired-aligned messaging-user-menu messaging-user-removed model-choices-local-menu context-menu-local-model --theme both --width 1120,720,1920x1080
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

sidebar-row-time checks that rows carry no time or role pill, sit 58 px apart as Grok Bot's, and show overflow under the pointer;
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
npm run look -- room-group-menu room-required-chief room-generated-name home-empty home-team home-motion --theme both --width 1120,720,1920x1080
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


## Shared installed skills (2026-11-04)

Settings > Connections lists each shared library package once and every member's
private skills. Member details retain shared skills, including Raphael (id 0).
Find installed skills reads only skill folders
under ~/.claude/skills, ~/.codex/skills, ~/.agents/skills and Claude/Codex plugin
caches. Import to shared library copies SKILL.md, scripts, references and assets;
no import runs a command, dependency installer, hook or plugin configuration.
Each package is bounded to 32 MiB/2000 files; linked packages are refused.
Source paths and plugin attribution remain visible. A changed source offers
Re-import, retaining skill identity and individual member choices.

Single-skill discovery opens only bounded SKILL.md documents; plugin-set discovery
also opens bounded plugin manifests. Package fingerprints use relative
file paths, sizes and nanosecond mtimes, without reading scripts/references/assets.
Discovery stops below a skill folder, skips node_modules/dot-folders, and shares a
20,000-entry budget across all roots and metadata walks, with depth at most 12.
Metadata fingerprints skip those ignored folders too; full import still copies
the selected whole package under the existing size/file limits. Plugin entries
collapse by marketplace/plugin/relative skill path, using SemVer precedence then
version-folder mtime (build metadata does not change SemVer precedence).
Source-change checks inspect only that skill's sibling versions and file metadata.
Import validates the chosen folder against installed roots without listing other
plugins, follows the newest version, and preserves identity/grants across versions.
Regression coverage is in test_large_cache_listing_opens_only_skill_documents,
test_import_resolves_only_the_selected_folder,
test_plugin_versions_select_latest_and_reimport_keeps_grants,
test_semver_prerelease_and_build_ties_use_version_then_mtime,
test_source_change_checks_read_no_installed_file_bodies and
test_discovery_walk_is_bounded in core/tests/members/test_skill_library.py.

The existing member_skills table stores library entries with internal member -1;
SkillHomes maps them to shared/skills. The existing owner RPCs select that scope
with shared:true and a real member_id, never a negative public ID. Migration 61
adds individual member_skill_grants; absence means enabled, subject to the
library's global switch. A member can toggle shared access; shared documents are
edited/deleted in the library only. Own skill edits/undo never include inherited
skills. Name collisions share the existing slash namespace.

Raphael gets the same import, command-template, slash discovery and expansion
paths as any member; the chief role adds no skill privilege. Local skill_read
includes the imported folder and directs scripts to local__local_exec. The
ordinary command consent, setting, dangerous-command and outside-content gates
remain authoritative; skill guidance never grants execution permission.

Claude receives a generated plugin containing only enabled skill packages, the
Skill tool plus Raphael MCP, empty setting sources and disabled hooks. Assigned
skill turns keep the normal config directory and CLI-managed login/refresh, without
reading Claude credentials or setting CLAUDE_CONFIG_DIR/CLAUDE_CODE_OAUTH_TOKEN.
Empty setting sources exclude personal skills/plugins. Codex keeps
its existing private home, host-discovery isolation and disabled native shell;
assigned paths use explicit native skill input and skills.config. API/CLI/private,
room and background paths retain their shared production engines.

Offline tests: core/tests/members/test_skill_library.py,
core/tests/agent/test_cli_skill_packages.py,
core/tests/agent/test_local_commands.py::test_imported_skill_script_uses_ordinary_local_command_approval,
app/src/main/connection-skills.test.ts, connections.test.ts, member-profile.test.ts and member-details.test.ts.
The existing app/scripts/look/mock-ipc boundary also models shared scope, local
source selection/import and individual grants; mock-ipc.test.mjs covers that contract.
All package/credential fixtures use temporary synthetic homes. Installed CLIs are
inspected with --help only; fake protocols do not prove installed native loading,
login refresh, provider behavior or rendering.

Affected scenes to list now and capture during authorized integration:
connected-apps-skills, skill-private-detail, raphael-skills, details-skills,
details-commands, completion-slash, completion-plugin, completion-clash,
slash-commands, local-command-consent and local-command-background. Capture both
themes at 1120,720,1920x1080, then judge the same run. Shared rows/buttons/dialogs
must be compared with the ordinary Connections rows and member resource controls.
Follow-up 3 authorizes the selected offline look matrix below. Native, network and
paid API acceptance remain outside this unit's authorization.

### Shared skill import and member choices (review follow-up 3)

Connections has one Skills section in its existing position after apps. Its
data-heading uses the same layout as Settings > Data, with an icon plus short
Import action at the right. Shared and private rows retain cs-item, cs-open and
the document dialog. Private rows retain the member face and ordinary switch.
Shared rows use the existing book icon and summarize enabled member access;
changed sources offer one Re-import action before the chevron.
The import action opens the existing Connections dialog, grouping synthetic
installed sources under Claude Code, Codex and Plugins.

New scenes: skills-installed-sources (real discovery action and three origin groups),
skills-import-shared (real shared import IPC and resulting library/member rows),
skills-member-grants (give one member a shared skill while taking it from another),
skills-source-changed (row-level reimport with existing switches).
checks.mjs verifies the single section, header alignment, neighbouring switch
sizes, row action placement and the real IPC boundary/results. The connected-apps-skills
scene also checks the consolidated section. All fixture copy is synthetic zh-TW.

```powershell
npm run look -- connected-apps-skills skill-private-detail raphael-skills details-skills details-commands completion-slash completion-plugin completion-clash slash-commands local-command-consent local-command-background skills-installed-sources skills-import-shared skills-member-grants skills-source-changed --theme both --width 1120,720,1920x1080
```

Inspect every contact sheet and every full-size image for connected-apps-skills,
skill-private-detail and the four new scenes. Compare owner/source text, row
insets and switches with neighbouring Connections apps, and the header action
with Settings > Data. Vitest: connection-skills.test.ts, connections.test.ts and
app/scripts/look/mock-ipc.test.mjs (scene fixture source propagation).

### One shared package row and readable sources (review follow-up 4)

Connections keeps one library row per shared skill regardless of member count.
Its existing document dialog lists every member, Raphael first, with the same tg
switch as private skill rows and member details. A grant refresh updates the count
without closing the dialog or changing the library original. The library's global
switch remains in the document header; individual member controls are in its list.
Private skill rows retain member faces and member-owned document editing.

skill-source.ts formats provenance for Connections, discovery and the shared member
resource editor. Known home skill roots become ~ paths with forward slashes;
plugin cache sources become the plugin name plus version. Internal local: prefixes
and cache paths never appear as source copy. Source values sent to IPC stay intact.

The four scenes in the command above now assert a single library row, its neutral
icon and enabled member count, readable Claude/Codex/plugin sources, every member's
dialog switch and one changed-source reimport action. skills-member-grants keeps
one private row beside the library and captures the grant dialog after giving one
member access and taking it from another. Inspect all four scenes at every size and
theme, comparing private/app switches with grant switches and source import buttons
with the section action. Member details continue using mountMemberResources.
raphael-skills and details-skills also include an inherited package and assert its
existing switch, readable source copy and library-only edit ownership. Inspect
their full-size images as changed consumers too. Library icons keep the app's 20px
size inside 28px row and 40px header slots, aligned with the existing member faces.

Named regressions in connection-skills.test.ts cover one shared row with Raphael,
changed shared skill reimport and readable source labels. connections.test.ts covers
the real dialog/grant refresh and preserved private rows. member-profile.test.ts
covers Raphael's existing shared switch with readable source copy. Run those files
plus i18n/i18n.test.ts, the mapped look command and one final npm run verify.

## Shared abilities and movable coordination (2026-11-04)

[Speaker parity](speaker-parity.md) refines R-AG-01: the primary contact coordinates,
while every speaker retains the same executable abilities with its own model and grants.
The details settings pane exposes the shared default-on draft preference for Raphael
and members; no naming/job setup is introduced for identity 0 after a primary change.

The selected matrix below is deferred in this unit: its brief prohibits look and native.
Compare the shared draft switch in both details panes with the existing profile Soul row.

```powershell
npm run look -- speaker-draft-chief speaker-draft-member speaker-draft-profile --theme both --width 1120,720,1920x1080
```


## Plugin sets and GitHub marketplaces (2026-11-04)

R-SKILL-06/07 extend the shared library without another settings page. In the existing
import dialog a local plugin shows one name/version/count row and one import; its
disclosure still permits individual skill imports. Add a GitHub owner/repo to read
its marketplace catalog, inspect plugin versions and unsupported-source reasons,
then install a selected plugin. Refresh explicitly checks newer versions. Installed
sets group their shared skills and slash commands, retain individual member grants,
and offer one whole-set reimport. The existing confirmation precedes set removal.
Set details state that hooks, agents and other plugin features are not run and offer
one existing add-MCP card per declared server. Clicking that card opens the existing
custom MCP form; importing or viewing a set never adds/tests a server. Secret values
are absent and must be supplied through existing setup. Set components are read-only
in their document dialog; grant switches remain editable for every member.

Migration 62 preserves rooms 60 and shared grants 61. Stable component paths retain
IDs and grants across updates; removal clears all set components and grants. API and
CLI delivery use the existing skill store/skill_read/native skills rather than plugin
execution. Synthetic HTTP tests check commit pinning, version agreement, byte/file
bounds, link/traversal refusal and unsupported sources. Fake CLI tests cover assigned
skills/commands only, disabled hooks and no automatic shell expansion. They do not
prove an installed CLI or live GitHub behavior.

npm run look -- connected-apps-skills skill-private-detail raphael-skills details-skills details-commands completion-slash completion-plugin completion-clash slash-commands local-command-consent local-command-background skills-installed-sources skills-import-shared skills-member-grants skills-source-changed skills-plugin-entry skills-marketplace skills-plugin-set skills-plugin-update skills-plugin-details --theme both --width 1120,720,1920x1080

New scene checks cover one plugin import, individual import disclosure, market version
and unsupported-source copy, exactly three grouped fixture capabilities, one whole-set
update offer, one existing MCP card per server and zero connection side effects.
Inspect every contact sheet and all six full-size images per new scene. Compare
row/import/update buttons to existing skill-source scenes and MCP cards to their
shared component; record any omissions. Judge uses this same selected run, with
missing references reported as blocked and no unapproved network requests.

Run core/tests/members/test_skill_plugins.py, test_skill_library.py,
core/tests/brain/test_db.py and core/tests/agent/test_cli_skill_packages.py plus the
changed frontend files: connection-skills.test.ts, skill-sets.test.ts,
connections.test.ts, mcp-proposal.test.ts, i18n/i18n.test.ts and look/mock-ipc.test.mjs.
Follow-up 5 additionally requires one frontend verify and one final complete core
suite, each after wait-heavy.ps1. R-SKILL-05 named evidence above remains in force.
## Localized skill origins (2026-11-05)

R-SKILL-08 shares skillOriginLabel across member details, Connections rows and skill
dialogs; discovery uses the same source formatter. Learned rows have exactly one
localized origin/date line. No origin text or title exposes learned/owner/imported,
local:/github:/plugin: prefixes or plugin cache paths. The source fixture includes a
GitHub transport prefix. The growing-skills check asserts the learned line exactly;
the shared source guard checks source labels and row paragraphs, including titles.
Run the twenty-scene skill matrix above in both themes and all three sizes, inspect
every contact sheet and relevant full-size member/detail/source views. Unit evidence
is connection-skills.test.ts and the three localized learned-origin cases in
member-profile.test.ts. This presentation change adds no migration or RPC.


## Colleague recipes and goal-first greeting (2026-11-05)

R-COLLEAGUE-01..03: New member > Start from a template opens eight shipped slime roles; Open template file uses the system file picker and previews profile, skill names, paused routines and one disabled connect card per app. Import creates the colleague without grants; only subsequent per-app Connect requests sign-in and member access. The member row menu exports one .raphael-member file without memory, pictures, credentials or model choices.

Since 2026-11-06 a new member's greeting is written by its own model (see above) and carries no choice form; greetings stored earlier with locally computed suggestions still show them, and sending a choice uses the existing composer words and task route. The shared API/CLI prompt puts the one outcome question rule beside owner input before set_my_job saves the goal. Fake-brain tests prove routing and persistence, not a real model's judgment.

The shared team mount /home/cua/team creates context/, meetings/ and projects/ on first computer use. Existing contents survive. Handoffs and requested wrap-ups may cite successful file writes there.

```powershell
npm run look -- member-template-gallery member-template-preview member-template-imported member-template-export member-greeting-choices member-greeting-goal team-folder-handoff --theme both --width 1120,720,1920x1080
```

Core fakes cover export/import, no-side-effect preview, no grants, disabled routines, local suggestions, goal question/save and first-use directories. Native save/open dialogs, real VM/SSH mounts and real model behavior need separate authorized acceptance.

Follow-up 1 (2026-11-05): Template previews keep one quiet no-grants/privacy notice immediately above the Close/Import actions in the fixed footer. Skills and paused routines use the shared compact list rows with names and muted detail. Templates have no status pill; a connection gains its own signed-in status only after a successful explicit connection. The member-template-preview scene asserts these contracts; compare it with member-panel-details and calm-thread after merging.

## Member store (2026-11-05)

R-STORE-01 through R-STORE-04 extend the existing raphael-member v1 recipe, not a
second package format. New member > Store and sidebar + > Store browse a signed
catalogue. Featured rows, eight categories and local search reuse existing slime
characters and shared buttons. Preview shows full instructions, personality, skill
documents/dependencies, routine schedules and individual disabled app connect cards.
Adding installs skills and routines off and grants no apps; only subsequent per-app
Connect can request login. Export now opens Review contents before Export file or
Publish to store. A secret finding disables both. Publishing prepares only a local
package folder and opens GitHub's prefilled PR page; the owner submits through GitHub.

The catalogue uses Ed25519 over exact index bytes, two compiled trust roots for
rotation, a monotonic sequence, permanent revoked IDs and per-package SHA256. Reads
are HTTPS without redirects, capped at 256 KiB/512 KiB and ten seconds, with ETag and
verified disk cache. Installs revalidate the catalogue and recheck revocation after
download. Offline cache proves last verified state, not current remote revocations.
No production key or account is needed by fake HTTP or the signed synthetic fixture.

npm run look -- store-home store-category store-search store-empty store-offline template-preview template-preview-warning template-export-review member-template-gallery member-template-preview member-template-imported member-template-export sidebar-plus --theme both --width 1120,720,1920x1080

Inspect every contact sheet and each new scene at light 720 and dark 1120. Compare
store chips/buttons with starter gallery and sidebar-plus, and preview/export cards
with member-template-preview at matching dimensions. Run judge on that same run;
missing external reference images/login are blocked, never design acceptance.
Native file picker, OS browser/folder opening, persistence across desktop restart,
public catalogue hosting, production trust-root provisioning and GitHub CI remain
separate acceptance. No live provider calls, public repository creation or tokens.

## Recipe preview polish (2026-11-05)

R-COLLEAGUE-01 and R-STORE-03: local recipes, store previews and export review share
one renderer. Known connection ids use the existing SERVICE_ICONS catalogue's
brand titles (including Gmail, GitHub and Google Calendar); unknown custom ids
retain their exact spelling. Presentation never changes connection ids or grants.
Skill rows show plain name/description metadata; the existing card disclosure
reveals the complete body and dependency files without the opening frontmatter.
Quoted and folded scalar metadata and CRLF files follow the skill store's forms;
missing/incomplete frontmatter preserves all text. Export still retains source bytes.

The routine editor uses shared mp-label field rows with labels above controls,
equal control heights and a bottom-aligned confirmation action. Vault's Traditional
Chinese owner hint is shortened without changing typography (R-VAULT-01).
The existing look checks guard metadata leakage, disclosure state, service names,
Slack control geometry and a single-character final line in the vault hint.

npm run look -- routine-trigger-slack automation-event-channel automation-event-repository automation-event-pick member-template-preview member-template-imported member-template-export member-template-starter template-preview template-preview-warning template-skill-expanded template-export-review member-panel-details calm-thread vault-list store-home member-greeting-choices reaction-row room-thread-open local-permission-card --theme both --width 1120,720,1920x1080

Inspect every contact sheet, full-size light 720/dark 1120 views of the seven
review consumers, the Slack row at all sizes and the folded/expanded previews.
Compare Slack fields with the event selector and ordinary routine fields;
compare preview rows with member panel rows and disclosures with existing cards.
Run the selected tests and frontend verify once at the end. Judge uses the same
selected run; missing external reference images are blocked, never design PASS.
No core, Rust, native, OS vault or live-provider acceptance is implied.

## Conversation setup and sharing: backend contract (2026-11-07)

The panel sends one owner message with optional agent.ask intent: setup-telegram,
setup-slack, setup-discord or share-template. The trusted panel step sits beside
the owner message, like R-JOB-01; visible history retains the owner's original text.
Raphael supports platform setup, while sharing is members-only. The named
member_recipe parity exception documents that restriction; all remaining work
tools retain speaker parity. The four new card RPCs are owner-only boundaries.

connect_messaging is a T0 owner card. The existing secret-card save validates the
speaker's account through the shared messaging service, keeps tokens only in its
existing vault keys, and resumes once with the bot name and pairing instruction.
Failed tokens remain editable; offline checks report offline. Only card-connected
accounts attach pending/approved/rejected/expired pairing cards to the original
turn. agent.turn invalidation carries those updates through the history delta.
Member Telegram, Slack and Discord accounts use member:<id>:<platform> keys and
sessions; omitted platform keeps the Telegram default.

share_template saves a recipe snapshot and findings on a draft card. Review,
export and catalog-publish RPCs use that snapshot even after the member changes.
Secret findings block export and publishing. Optional version-1 description is
trimmed and bounded to 280 characters, and imports become the member's blurb.
Catalog publishing prepares the existing local package and review URL; it does
not upload or approve a catalog entry.

Offline acceptance: core/tests/test_chat_setup_share.py, messaging member-account
and background owner-card/snapshot tests, the full core suite, Rust library tests
and warning-free Clippy. Core/Rust-only ownership leaves frontend scenes, real
app journeys, look/judge and live provider verification to the window integration.
The window landed the same day: chat-setup-cards, chat-pairing-allowed, member-template-export and
template-export-review drive the cards (see conversation.md and the panel notes above).

Guardian maps connect_messaging to S14.messaging.telegram/slack/discord and
share_template to S21.templates.share. These production-loop contracts check
panel intents, owner text, secure-card metadata and immutable snapshot read-back;
they do not save platform credentials or prove a real platform connection.
