# Conversation

## Owner round 10 connected apps and chosen models

API and CLI brain prompts share the Composio discovery/execution contract:
COMPOSIO_SEARCH_TOOLS returns a tool slug and schema; execute that slug through
COMPOSIO_MULTI_EXECUTE_TOOL with its arguments. Discovery alone does not establish
that the requested app is unavailable. The execute envelope accepts the documented
optional string fields thought/current_step/current_step_metric/session_id and a
boolean sync_response_to_workbench that must stay false. Unknown fields, malformed
per-call objects, disabled slugs and draft-only violations are blocked. The actual
contained slugs use the same read/write classifier as Connections: all enabled
reads are T1 and run without a permission card; any write is T2 and requires one.
Production agent/gate/MCP flow is exercised with a fake MCP and synthetic email.

Owner report 2026-10-31 (a member could not read Gmail): the three Composio router tools are
core-pinned, so a turn's narrowing by the words of the request (`take_snapshot`, more than 40
plugin tools) never hides the executing tool; a CLI brain, which reads its tool list when it
starts, starts again in the same native thread when `find_tools` shows it more tools
(`CliLoop.catalog_changed`, also for a background task). Raphael and every member are offered
the same tools on the API and the CLI path: core/tests/members/test_plugins_everywhere.py.
A step of the app's own tools (server "Raphael") reads 「讀取」, 「修改」 or 「詢問同事」 and
never names Raphael, on a member's turn or his; a connected service keeps its name
(`work-member-builtin`).

Conversation and routing fallback controls are absent from the UI. Only the chosen
model is called; hidden legacy agent_fallbacks/router_fallbacks confer no consent.
Implicit CLEANUP_FALLBACKS are removed from agent, tool-selection, computer and
memory consumer defaults. Dictation cleanup retains its separate documented retry
contract and saved fallback behavior. Each provider attempt receives the complete
caller timeout. A failed answer names the selected model, a localized failure and
an actionable next step; successful history records the actual answering model.

Focused evidence: core/tests/agent/test_composio.py (21), test_persona.py (121),
test_model_choice.py (11), test_service.py (174), test_routing.py (111),
core/tests/test_connectors.py (91), core/tests/brain/test_provider_registry.py (26),
test_providers_more.py (48). All use fakes or mock transports. No live owner
Composio, Gmail, OpenRouter, judge or live verification was exercised. Full verify,
look, native tests and builds await maintainer authorization.


## Owner round 10 contracts (supersedes round 9 message previews)

Only owner messages use eight-line faded previews with a quiet expand action inside
the bubble. Assistant messages render fully; authored reply envelopes retain separate
bubbles and complete Markdown blocks in private and room conversations. Chief,
member and room scrollers hide their scrollbar, retain normal scrolling and expose
an accessible jump-to-latest action only when away from the bottom. New messages do
not move an owner reading older messages. Recording/STT cancels on one Escape;
in-flight in-app answers require two. Menus, dialogs and ordinary overlay keep their
existing Escape handling.

`dictionary.correct` carries bounded dictation snapshots to the same Rust Tracker
used for external editor corrections. Core owns final term acceptance and opaque,
single-use batch Undo, including prior evidence restoration. A separate passive
`learned.html` native window shows the learned batch and localized Undo at the active
monitor's horizontal center, 56% down its work area. It expires after five seconds
without hover. The ordinary overlay remains click-through. Fixture pill evidence
does not establish native hit-testing, positioning, paste or persistence.

`stable-click` records the clicked view control and persistent content above it,
then rejects position/size changes over 1px after settling. Normal look clicks on
tabs, switches, pressed filters, Settings panes and view controls automatically use
it (sidebar/Home excluded for the parallel redesign). Explicit scenes cover
Connections tabs/categories, Dictionary filters and Models/Settings tabs. Existing
Calendar, member and Plugins scene clicks inherit this check. Connections search is
below the fixed Installed/Store switch in both states. A selected look report is
required to establish the actual covered controls and any remaining movements.

Round 10 scenes: `long-owner`, `long-owner-expanded`, `long-member-reply`,
`long-room-messages`, `reply-split-bubbles`, `conversation-chief-up`,
`conversation-chief-bottom`, `conversation-member-up`, `conversation-member-bottom`,
`conversation-room-up`, `conversation-room-bottom`, `overlay-learned-pill`,
`stable-connections-switch`, `stable-dictionary-controls`, `stable-settings-controls`.
Run both themes at 1120,720,1920x1080 only after maintainer authorization. One heavy
process at a time, Vitest --maxWorkers=2, CARGO_BUILD_JOBS=2 and the shared native
CARGO_TARGET_DIR apply. Full verify, look and builds are currently deferred at the
maintainer's request; only focused single-file tests are authorized. Judge and all
OpenRouter/live owner Composio requests are prohibited.


## Sub-features

Named conversations per member; new/rename/delete; public work/event chips; answers,
attachments, reply quoting, message actions, search and composer menus; connector cards for an app a
task needs, and the one resume of that task (see Connecting an app from the chat below); a secret card for a key a
connection needs and a computer card for the owner's turn at a sign-in (see Handing a key or the computer to the owner below);
a permission card for an action that needs the owner's yes and an editable email card for a draft a member wrote (see Asking
the owner's yes and writing mail for them below).
A delivered conversation lists what colleagues asked or handed it as one closed centred line;
previews, search, unread state and every model read exclude those exchanges and room turns. Room answers stay in their room/thread and have no shortcut into private history.
Raphael's single persistent quick-question conversation is created on the first global
voice question, pinned above formal conversations as 快速提問 / Quick questions / クイック質問.
Its fixed title and permanent identity have a Clear history overflow menu; individual messages
can still be deleted. Opening it and typing continues with the quick model and effort.
Alt+Space and a question typed there name the quick destination; nothing reaches quick or
formal by default (see Quick questions below).

## One waiting line (2026-10-28, R-UI-38/42)

Pending typed and spoken requests share the running turn's `work-section think-box is-live`
line: the same three animated dots, `agent.thinking` and `chat.workingFor`, with no answer
bubble or empty toggle. Their clock starts at the owner's send/voice-processing time and
continues across the history announcement, subsequent refreshes and member navigation.
`pages/agent-stop.test.ts` exercises pending rendering, ticking and typed/spoken handoff.
Finished replies still being paced show settled work, never another dots bubble;
`pages/agent-members.test.ts` also covers finish, navigation, search and reduced motion.

The look `pending-work` check requires the shared line, elapsed seconds and no empty
expander; `work-dots` checks the running and pending dots held mid-bounce. The shared
rendered audit rejects `.page-agent .ans.thinking` in every captured conversation.
The affected scene set includes every private-thread pending/live fixture and the
pending/Stop result journeys; room speaking rows use a separate room contract.

```powershell
npm run look -- composer-stop-pending composer-stop-pending-result work composer-stop-roster composer-stop-voice composer-stop-voice-result composer-stop-member composer-stop-navigation composer-stop-background composer-stop-background-result composer-task-stop running running-motion quick-stop quick-formal-isolation --theme both --width 1120,720,1920x1080
```

Compare full-size `composer-stop-pending` and `running-motion` images in every size and
theme: identical line/dot/text geometry, with no pending chevron. Inspect every contact
sheet. Group rooms name the current speaker (`rooms.speaking`); onboarding lessons
show their own phase (`onboarding.lessonThinking`); the desktop overlay uses its emblem
and rotating/static waiting caption. These are separate surfaces and remain unchanged.
Offline fixtures do not prove native microphone, providers or transport. Judge requires
network authorization; a no-network brief records it as SKIP.

## How to get to it (user POV)

From Home, click Raphael in the rail or open a member report. Select Raphael or another member in the sidebar (compact width:
member picker). Raphael stays first with his original large bare emblem and name. The column's top-left arrow toggles a remembered 56px face strip, including at compact width. Other expanded rows retain their 40px faces, time and preview. Click the stacked member/conversation title to toggle details. The title displays
the current session only; conversation creation, search, switching and row menus
live in the details list. The top-right gear opens Settings. Use sidebar search, or
the compact picker's search action, for messages.

## Driving it with look

```powershell
npm run look -- composer-task-stop chat running running-motion empty details raphael-details details-closed conversation-filter new-conversation row-menu rename delete --theme both --width 1120,720,1920x1080
npm run look -- quick-conversation-list quick-conversation quick-question-result quick-formal-isolation quick-stop --theme both --width 1120,720,1920x1080
npm run look -- live-scenario-owner-view --theme both --width 1120,720,1920x1080
npm run look -- work work-member-builtin composer mode actions reply search search-target tooltip slash-commands --theme both --width 1120,720,1920x1080
npm run look -- member-composer-empty member-text member-composer-hover conversation-notice --theme both --width 1120,720,1920x1080
npm run look -- composer-learn member-composer-learn room-composer-learn --theme both --width 1120,720,1920x1080
npm run look -- plain-bot-chat centred-system-events --theme both --width 1120,720,1920x1080
```

Keep reports and result PNGs: answer/attachment, expanded work, open menus/dialogs,
quoted draft and highlighted search target. Inspect action-menu placement and
composer clearance at 720. Slash commands use the slash's measured text rectangle, start-aligned above the line with a below-line fallback. The slash-commands scene checks its left edge within 24px of the character. The chat scene also checks 15px/24px message type,
12px bubble radii, a borderless answer and the original Raphael emblem and other members' 40px faces. Owner
messages use the bubble colors; assistant messages use a raised surface. Every thread reads plainly
(R-UI-42): the core stores Raphael's replies and progress as his 《prefix。…》 line, split over messages when long,
and the window shows, copies and quotes them without it; his in-app questions are plain too, while the overlay keeps
the persona. `chat`, `running` and `plain-bot-chat` reject a visible prefix or stray closing mark. Work is one muted
line above the answer and the day is a plain centred word. `running-motion` runs with motion on and holds the live
row's three dots at the top of their bounce (`motion: true`, `freeze-motion`): no box around them may cut them, and a
reply that has just started says 思考中 once, with its seconds, never 處理中 beside it. `centred-system-events` shows a hand-off, a consultation and
a meeting between the question and the answer, each one centred grey line. A real send needs a native journey: submit an innocuous
prompt, observe public progress/final reply, navigate away/back, and verify
conversation persistence. Keep the resulting turn and relevant logs.

The four composer-learning scenes seed synthetic dictation through the existing native event
boundary, correct Open Mouse Bot to OpenMausBot, and send through the real composer.
They assert exactly one dictionary.learn call with the complete correction, exactly one
localized notice clear of the composer, and the unchanged single gold-emblem / bare-plane slot before and after send.
Only dictation seeds learning; ordinary typing and clipboard paste do not. Native microphone,
external-editor correction tracking and persistence still require isolated native acceptance.

## Stopping a private reply (2026-10-28)

The one composer slot is Stop while a typed request awaits its first turn, a persisted turn is
running/confirming, its background task is queued/running/waiting, or the native voice controller
is processing before any turn exists. Roster/avatar redraws retain the actual Stop glyph and
accessible label. The same target chooses the glyph and cancellation: an outgoing request first,
then the newest active turn/task, then pre-turn voice. A repeated Stop is disabled until its call
settles; it never sends a voice key. Request/worker cancellation preserves history.

Composer voice processing belongs to the conversation selected when recording began.
Desktop hotkey voice belongs to Raphael's quick conversation, including navigation into it after Alt+Space. Older voice history cannot settle a new
question whose own history boundary was not on screen. Running turns read on a fresh page do not
need a new send event to show Stop. The happy-dom `pages/agent-stop.test.ts` replays native phases,
running/final turn announcements, roster changes, navigation and delayed ask RPC completion.

```powershell
npm run look -- composer-stop-roster composer-stop-pending composer-stop-pending-result composer-stop-voice composer-stop-voice-result composer-stop-member composer-stop-navigation composer-stop-background composer-stop-background-result running running-motion composer-task-stop quick-stop chat empty member-composer-empty member-text --theme both --width 1120,720,1920x1080
```

`composer-stop-slot` requires the visible Stop SVG, no emblem or hidden voice-animation class,
and no second send control. Result scenes press Stop and assert the exact session/task or native
controller boundary and the returned idle emblem. These fixtures prove the real frontend's
boundary calls; native microphone/hotkey/transport cancellation still needs isolated native
acceptance. Judge and live calls require an authorized network environment.

## Gotchas

Typed requests run independently per request id, including different conversations of
one member, while the voice slot owns microphone and overlay priority. A queued typed
YES/NO card opens in its conversation immediately; either the card or overlay can answer
first, and the question follows foreground focus once voice releases the overlay.
The existing `admin-approval` look scene now opens a second member question through the
native event boundary, visits that member, then returns to Raphael and requires his original
approval card. Window cards retain independent ids across members and conversations.

Typed progress never goes to the overlay. See `DICTATION-NOTES.md` for native concurrency,
Esc, spoken-question and paste-last acceptance; browser fixtures cannot prove these.

Collapsed work contains hidden `.chat-message` elements before the visible reply.
Answer scenes target `.chat-message[data-expandable]`; the driver chooses a visible
match. The title reflects the details panel with aria-expanded; opening rooms preserves
the remembered member-panel preference. Rename/delete scenes open
dialogs, not committed changes. Empty/running are fixture variants, not proof of
streaming, cancellation, persistence or file transfer.

Delete confirmations use a compact 480px panel with a fine theme border, a top-right
close control, an announced irreversible-action description and pill actions aligned
right: Cancel then theme-accent Delete. Cancel retains initial focus. The shared
`delete-confirmation` rendered check covers conversation, group, room and routine
deletion, including a confirmation stacked over the routine editor.

## Team administration and progress

Team administration approvals are covered by the member feature's `admin-*`
scenes. Public progress parses complete reply envelopes and drops malformed or
partial JSON; the exact CLI regression is exercised by core tests. The shared
rendered audit also rejects non-finite durations in work summaries.

## Guardian scenario owner view

The live-scenario-owner-view scene replays S17 synthetic history through the shared IPC fixture. It checks the personal conversation, actionable Traditional Chinese failure, and separation of progress from the final answer. This rendered fixture does not prove live model or connector acceptance. Core scenario reports retain digests, scopes, message kinds and test-mode receipts in owner-view.json.

## Meetings and shared inventory

Durable assignments use `handoff`, which returns a task receipt immediately. The requesting
conversation displays one centred grey line (the assignee's face, 已轉交給/已詢問 and the name, then the
state) whose detail shows the request, the result and the produced files, never task numbers. Work runs
in the assignee's isolated work turn; results return only to the requesting source. A quick
`ask_member` question is answered in the same turn and draws the same 已詢問 line, with no task behind it.
Source-document deadlines never schedule work.
The room handoff scenes in [Team and rooms](team-and-rooms.md) cover the shared event renderer;
private and room result destinations are also checked by offline core tests.

Every private/API/CLI/member turn receives the current public TeamContextSnapshot with self,
count, stable IDs, roles, primary/chief and secret-free app connection states. The primary is the owner's chosen primary contact (see [Members](members.md): Raphael
until another is chosen), read from that snapshot fresh on every turn: the primary is told it hands work it is given to the colleague it belongs to with the one hand-off
(S03.primary-dispatch), another member forwards work that is not its own to that colleague or, when it cannot tell whose it is, to the primary, and every speaker can propose team changes that the owner confirms. Meeting requests
use room_meeting; one centred grey line with the group icon, outside Raphael's message, opens the room, and quick ask_member answers are
folded into the requesting assistant reply. Room history remains outside private turns.

```powershell
npm run look -- meeting-open-room meeting-chief-event member-mentions-bots-apps --theme both --width 1120,720,1920x1080
```


## Consulting a colleague and the shared memory (P14)

Grok Bot's two sides of a question: the asker's chat shows 「已詢問 X」 (handoff-line.ts), which opens on
the question that was sent and the answer, and the asked member's own chat shows 「訊息來自 Y」 with Y's
face where the question came (exchange-line.ts); several in a row from one colleague on one day fold into
「N 則訊息往來：Y」, as Grok Bot words it, opening on each question and answer with each speaker named once,
never a pasted transcript or a per-line label. Both ways of asking leave the same record, the asked
member's exchange turn: `ask_member` answers in the asker's turn, a `handoff` in consult mode runs as the
asked member's task with its own notes and conversation, and a private chat turn that consulted that way
comes back once with the answer. An entry of the shared file ends with whom the owner told it to and when, in every
memory panel and in every member's prompt; what the owner told one member stays its own until a colleague asks.

```powershell
npm run look -- bot-ask-centred bot-message-from-centred bot-exchange-count bot-exchange-expanded global-private-memory --theme both --width 1120,720,1920x1080
```

The scenes seed 小森 asking 小晴 through the IPC fixture (`colleagues`, `memoryFiles`); the mock lists
a member's exchanges in their recorded delivery conversation as the core does. Model behaviour is covered by Guardian
S04 and S12: offline with honest fake brains on both brain paths and both ways of asking, live on the API
brain. Rendered fixtures do not prove a live consult.

## Quick questions (P19)

The Alt+Space hotkey sends `agent.ask` with `destination: "quick"`. The composer's voice
button names its selected conversation, like typing; a question in the quick conversation sends that destination
with its conversation ID, and a formal thread sends only its ID. The core refuses a spoken
question to Raphael that names neither, a quick request naming another conversation and a
formal request naming the quick one. The quick model and effort answer quick turns, CLI quick
turns keep no native session, and each turn records the model that actually answered (Raphael's
face tooltip). A request replaces only the YES/NO questions waiting in its own conversation, so
quick use leaves a formal approval waiting and adds no formal rows. A spoken answer with public
progress has no reply message: the thread shows its text after the work line.

```powershell
npm run look -- quick-question-result quick-formal-isolation quick-stop quick-model-selection --theme both --width 1120,720,1920x1080
```

`quick-question-result` announces an Alt+Space answer through the native `AgentTurn` event while
the quick conversation is open and checks its answer and quick model. `quick-formal-isolation`
sends one formal and one quick question through the real composer and checks the destination
each names at the native boundary and that neither thread shows the other. `quick-stop` presses
Stop in the composer slot on a running quick question; only that session stops and the formal turn
is untouched. `quick-model-selection` (Settings › Models) picks a Codex model and High effort for
quick questions, both inside the model chooser, and checks that Raphael's answer model stays. The
existing `quick-conversation`, `quick-model-menu` and `quick-effort-menu` scenes cover opening the
stored quick thread, the quick model chooser and its effort row. Rendered fixtures do not prove the native hotkey, routing or a live model:
core tests and Guardian S16 cover those, and the native Alt+Space entry needs its own live check.

## Connecting an app from the chat (P08a)

When a typed request in Raphael's or a member's private chat needs Gmail or Google Calendar and the app is not
connected (or its sign-in expired), the brain calls `connect_app`. The turn shows that app's card below its reply
and calls nothing else. Connect (`integrations.card_connect`) answers at once and signs in in the background
through the owner's own Google authorization (loopback, PKCE, `state`) or Composio; Cancel
(`integrations.card_cancel`) ends it. The card reads pending, authorizing, connected with the real tool count,
failed with its reason (Open Connections when nothing is set up), cancelled, or expired after 24 hours; an expired
grant shows Reconnect. When every card of the turn is connected, the request runs once more in the same thread as a
`connector` turn: one centred line with the app's mark names the apps in place of the owner's words, the apps'
tools are offered, and an action the task did before its card is refused if repeated with the same arguments. A
replayed callback or a second Connect resumes nothing. No URL, code, `state` or token reaches the card, a model,
the history or a log, and each member's TeamContextSnapshot counts the app's usable tools.

```powershell
npm run look -- chat-connect-gmail chat-connect-calendar connector-authorizing connector-expired connector-reconnected --theme both --width 1120,720,1920x1080
```

The scenes press the real card buttons; the IPC fixture reports the card's states as the core does. They cannot
prove a sign-in. Core tests (`core/tests/test_connect_cards.py`) and Guardian `S14.gmail` run the core's own
loopback sign-in against an automatic Google fixture on both brain paths. A real Google account stays an
owner-approved smoke, and Instagram (P08d) keeps the parent S14 open.

## Handing a key or the computer to the owner from the chat (P08b)

Two more cards pause the task that asked for them, in a private chat typed at this computer (Raphael's or a member's),
and resume it once. A room, an exchange between members, a quick question, a spoken request and a message from a phone
never get either, and never carry their payload.

**The secret card.** A connection of the owner's own declares a secret (a header or an environment variable) that the
vault holds no value for: a call of its tool fails with `missing_secret` and the roster shows it as `needs_secret`.
The brain calls `request_secret` with the connection (its id or name from the roster) and, if it declares several,
the secret's name; it never names a place in the vault. The turn shows the connection's card below its reply and calls
nothing else: the connection's own mark, the secret's name, a masked field and 安全儲存. The key goes from the field
to `integrations.card_save`, straight into that slot of the vault (an Authorization header given as a bare token is
kept as a bearer); the field is emptied before the call, and the key is in no row, notification, reply, exception,
history, room, file or log, and the model learns only that a card is shown. Saved and resumed are two states: the card
reads 已儲存 and then 工作已繼續; when the resume failed it reads 金鑰已儲存，這項工作沒有繼續 with 再試一次
(`integrations.card_resume`), which carries the task on without asking for the key again and without repeating what
the failed attempt did. A replayed save does not touch the vault and resumes nothing; Stop, expiry (24 hours) and a
cancelled card never resume; a resume cut off by a restart is saved with `interrupted`.

**The computer card.** A computer task (`computer`) that reaches a password field, a sign-in or a payment does not end
with the hand-off line: it pauses and the turn shows 電腦 · 你正在控制 with 請在「Google Chrome」登入你的帳號，完成後交還控制,
停止 and the primary 我完成了. The computer is the owner's own PC, so the card names the window to use and there is no
開啟電腦 step. While the owner has it the run holds a human lease: it takes itself off the desktop (the overlay and the
watch on the owner's input are down) and asks the shell for no look, step or key, and the owner's own input ends
nothing. 我完成了 (`integrations.card_done`) answers at once and gives the computer back, once: the run looks at the
windows again, checks that the form is gone (once; when it is still there the card says 看起來還沒完成，請再試一次 and the
computer stays the owner's), and carries on with the same task, repeating nothing. When the run ends the task
resumes once in its thread, opening with 電腦 已交還控制，繼續原本的工作. 停止 (`integrations.card_stop`), Stop, a newer
computer task, the time (30 minutes) and closing end the run; a replayed 我完成了, the app closing or the core
restarting (the card is 連線中斷) never resume it or give control back by themselves. Spoken, quick and room runs keep
the hand-off line. A step that needs a yes after the owner gave the computer back asks in a permission card (below).

```powershell
npm run look -- chat-secret-masked chat-secret-saved-not-resumed chat-computer-takeover chat-human-control chat-handback --theme both --width 1120,720,1920x1080
```

The scenes press the real card buttons and type a made-up key into the real masked field; the IPC fixture reports the
cards' states as the core does and receives the key in `integrations.card_save` only (the rendered checks scan the page
and every call for it). They cannot prove the vault, a sign-in or a desktop. Core tests (`core/tests/test_secret_cards.py`,
`core/tests/computer/test_handback*.py`) and Guardian `S15.secret` and `S15.computer` run the production cards, a recorded
MCP server that opens only to the saved key and a fake desktop whose page asks for a sign-in, on both brain paths.
`S15.permission` (below) is the third half of S15. A real key and a real sign-in stay owner-approved native
smokes: type a test key into the card, read the connection's result, and sign in on an isolated test account.

## Asking the owner's yes and writing mail for them (P08c)

**The permission card.** When the gate says an action needs the owner's yes (a connection's tool that changes something
while 先詢問 is on or a rule of theirs says to ask first, the first use of an app on the computer, a step on it that sends,
deletes or buys), a private chat typed at this computer shows a card in that turn as well as the overlay's question: the
service (its own mark, or the computer's), the exact action in plain words as the question asks it, which of the owner's
rules had it asked, and 拒絕, 一律允許 and the primary 允許一次. It is a connector card with a second row for its answers.
The question is the one `agent.confirm` has always answered (the shell holds it); the card follows it
(`agent.permissions`) and the gold card stays away while a card waits on that question, so it is answered once. A
call that cannot be undone (T3) keeps the gold card that is held to confirm. 一律允許 keeps a narrow rule for that one
tool (`safety_rules.scope`, Always) and is offered only where it can take effect: an owner's Ask first always wins
over an Always, so where a rule asks the card names the rule and offers no 一律允許, and a rule of the owner's that is
Never refuses the call without a card. A yes is bound to the digest of the action asked about: changed inputs, a replay,
a card of another action, a restart and time never use an old approval. A question someone sits at lives 30 seconds; the
question of a task that waits unattended (the run that carries on after the owner gave the computer back, a background
task) lives about ten minutes, and the former answers through `integrations.card_allow`, `card_always` and `card_deny`
with the card's digest. A no is for the whole request: the tool is not tried again, no other tool of a connection that
changes something is tried in its place, and the computer and the CLI's own permission question are refused after it,
on the API loop, on the CLI brain's MCP path, on the computer run and in the background worker alike (Guardian
`S15.permission`). Rooms, exchanges between members, quick questions, spoken requests and messages from a phone get no card.

**The email card.** A member that writes an email does not send it: `email_draft` puts a draft in the owner's chat with
寄件者 (a dropdown of the connections that send mail), 收件者, 副本, 主旨 and the body, all editable, and 捨棄 and the
primary 傳送. Every edit is saved as a new version with a new digest on top of the digest the card holds
(`integrations.draft_save`, in order, each on the digest the one before came back with); 傳送 first saves what is
typed, then sends the digest of that version and nothing else (`integrations.draft_send`): once (a single conditional
claim), through the one gate with the owner's click as the yes, a rule of the owner's that is Never still refusing
it; an old digest, a replay and a double click send nothing, and a send that failed is not tried again by itself (an
edit makes a version that can go). 捨棄 touches nothing outside. A member can offer the draft to a colleague with a
choice card (「這封回信可以交給{name}寄嗎？」, 不用 or 可以); on yes the first chat keeps one centred line
(已轉交給 ◎ {name}) and the same version, with its digest, is an editable card in the colleague's private chat
(a `draft` turn that shows no words of its own; the card says whose draft it is); handing over never sends. A member's
profile (Permissions) has a switch for writing mail as a draft first, on by default: while it is on, a fast-tier
request cannot send mail with a connection's tool and is told to write the draft; when it is off the member sends
through the gate like any tool, and a rule of the owner's that asks first has the question asked (the permission card
names the rule). A routine or a background task keeps sending through the gate. Rooms, exchanges, quick questions,
spoken requests and messages from a phone are told to write it in the member's private chat and get no draft.

```powershell
npm run look -- local-permission-card draft-preference-ask-first email-draft-edit email-draft-discard email-draft-handed-off --theme both --width 1120,720,1920x1080
```

`local-permission-card` shows Raphael's chat with a pending card for a Gmail send (three answers, the primary last, the
gold card away). `draft-preference-ask-first` first opens 小晴's profile to check the draft switch is a real switch and
off, then shows the card her rule has asked for: it names the rule and has no 一律允許, and there is no draft card.
`email-draft-edit` types in the copy and the subject (two saves, the second on the digest the first came back with,
the card at 第 3 版 holding the newest digest); `email-draft-discard` presses 捨棄 (one quiet line, nothing saved or
sent); `email-draft-handed-off` answers 可以 on the choice card (one centred 已轉交給 小森 line in 小晴's chat), then
opens 小森's chat: the same version, editable, with 來自 小晴 的草稿. None of them presses 傳送, and the checks require
that nothing was sent. The IPC fixture (`permissionCard`, `memberDraftFirst`, `mailDraft`, `mailOffer`) reports the
states and the digests as the core does and keeps no mail. Rendered scenes cannot prove the gate, the shell's
question or a real send: core tests (`core/tests/agent/test_permission_cards.py`, `test_drafts.py`,
`test_draft_tool.py`, `core/tests/computer/test_handback_permission.py`) and Guardian `S15.permission` and
`S05.draft-handoff` run the production cards, gates and the recorded connector on both brain paths with every send
recorded and none real. `S05.gmail` (P08d) keeps the parent S05 open. A real mailbox stays an owner-approved native
smoke.

## P04 task lifecycle

Background narration uses the typed worker.progress status channel and is never appended to
agent_messages. Legacy stored progress remains readable. Terminal replies are separately validated
and published atomically with the task verdict and result outbox. Private Stop calls
agent.history.stop and preserves completed history and tool evidence; ack, running and owner-question
waiting all retain Stop in the existing composer slot. Microphone release never follows task Stop.
The shared composer tests cover IME Enter, Stop acknowledgement races, independent send completion
and the return to the voice emblem/tooltip at idle. Native microphone/controller behavior remains
unverified by rendered fixtures.

## Right click on an answer (R-UI-44)

A right click anywhere on one of Raphael's answers opens the menu of its ⋯ (重新產生, 朗讀, 刪除這則), at the pointer, as a click on the ⋯ opens it: see
[Members](members.md) for the rule and its table. A conversation row in a member's details gives its rename and delete menu the same way; its left click still opens the conversation.

```powershell
npm run look -- context-menu-message context-menu-conversation --theme both --width 1120,720,1920x1080
```

## Conversation ownership and composer voice (2026-10-28)

The composer fixes the member and the selected conversation before recording. Its voice
question, waiting line, pending turn and answer remain there through navigation, including
non-default conversations. Only the desktop question hotkey chooses the quick conversation.
Quick questions have a separate small section above Conversations, using the existing
`mb-dh` heading. Members without quick questions show only Conversations. Both kinds
have the same overflow/context-menu behavior. Quick questions offer Clear history through
`confirmDelete` with the matching clear wording; their identity remains after clearing.
Clearing removes every delivered turn, message, step, summary, card and CLI resume ID.

Private and exchange deliveries belong to one conversation. Queries, paging and deletion
apply that identity to both scopes. Room history remains in its room. Member deletion removes
all non-room rows owned by or exchanged with the member. Migration 40 deletes ambiguous
legacy exchange/quarantine records that lost their delivery ID and non-room records of
removed members; it does not guess a current conversation for a lost delivery. Private
legacy rows use their existing default or are removed if none exists. Empty finished
records never create an exchange line or a date separator. Reopening the database is idempotent.

```powershell
npm run look -- conversation-sections member-conversation-sections quick-clear-confirm quick-cleared new-conversation-empty composer-voice-pending-0 composer-voice-answer-0 composer-voice-pending-1 composer-voice-answer-1 --theme both --width 1120,720,1920x1080
```

Regression coverage: `conversation-list.test.ts`, `conversation.test.ts`,
`pages/agent-stop.test.ts`, `member-voice-api.test.ts`, the native
`composer_voice_keeps_its_named_conversation_for_raphael_and_members` test, and
`core/tests/agent/test_conversation_cleanup.py`. These synthetic boundaries do not prove
native microphone/STT/global hotkeys/provider transport or an actual owner database upgrade.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Two-step cancellation and deletion (owner round 3)

R-UI-46 uses the document-shared `cancelGesture` for pending, running and waiting
replies, including background jobs. Recording and STT cancel on one Escape. First Escape arms
only the visible task's Stop for 1500ms, displaying Esc and the current language's
`common.cancelAgain`. A second Escape cancels once. Typing, other keys, input,
clicks, pointer presses, blur, target changes and expiry clear the hint. Repeats and
IME composition do not count. Menus/dialogs consume Escape before this handler.
Stop and Send use `.task-action` and the same accent-icon/hover tokens; an idle
voice emblem keeps its own appearance. A pending empty typed request retains its
existing retract-and-restore behavior after the second Escape.

```powershell
npm run look -- esc-main-armed esc-member-armed esc-recording-cancel composer-stop-pending-result composer-stop-background-result composer-stop-voice-result composer-stop-navigation composer-stop-roster chat --theme both --width 1120,720,1920x1080
npm run look -- conversation-delete-main delete member-delete --theme both --width 1120,720,1920x1080
npm run look -- page-product page-buy page-expand page-gone --theme both --width 1120,720,1920x1080
npm run look -- composer-model-small composer-model-favorites composer-model-sources composer-model-same composer-model-fold composer-quick-model composer-model-menu model-sync model-sync-member settings-chatgpt-row composer-model-arrives member-brain-saved --theme both --width 1120,720,1920x1080
```

R-UI-47: successful conversation deletion invalidates its outstanding history load
and reloads the member's server-selected default before requesting history. The
cached list predates default promotion and must not select quick history instead. The
existing named success toast remains. A removed member returns to Raphael; stale
roster notifications cannot leave a deleted member selected. Clear-history retains
the still-existing quick conversation. Deleted reply-source references remain
unavailable citations, not active deleted-object pages.

## Owner round 4 measures, focus and immediate use

Raphael/member/room threads and composers share --layout-thread-max = 28 * 32 =
896px; prose retains the 640px reading measure. Details start collapsed below
1440px (rail + member column + details + a comfortable central track); the explicit
toggle always works. Opening from a pointer preserves pointer focus; keyboard
opening focuses Close with the existing keyboard-only focus treatment.
No empty conversation uses profile_ready to hide its ordinary composer.
The composer's send button (shown while recording) releases/transcribes/sends, while only Escape uses two-press cancel.

The ordinary details scene retains its deliberate keyboard-focus screenshot after
asserting pointer behavior. Raphael-details also asserts pointer opening and captures
the ring-free resulting state; its close control shares the same details shell.
## Owner round 5 panel and conversation header

The shared details scroll container owns the 16px horizontal inset. New
conversation, the actual search input, section headings, conversation rows and
the routines/memory block fill that same content width, without nested horizontal
padding. `details-alignment` compares actual rendered field/card edges.

Below the member-picker breakpoint (860px), the picker owns the identity and the
centered trigger shows only the conversation caption. Identity and caption lines
do not vertically shrink; captions reserve a full 1.5em line. The
`conversation-header` check rejects duplicate compact identity and text whose
range/scroll bounds exceed its line box. The reported 1920px half-line clipping
was not reproduced in the baseline chat fixture; baseline evidence must not be
claimed as a reproduction of that specific image.

Native regression: `npm run native -- readable-layout` uses a fresh real SQLite
database and a roster persisted through production RPC. The real WebView opens
Team at 1280x800 before pressing Fit, then inspects details at 1920x1080 and
compact identity at 720x900. It reuses the shared rendered assertions and retains
per-check failures and actual viewport sizes. No page module or DOM geometry is
substituted; fake brain remains enabled and no provider request is needed.

## Failure diagnosis and continuation (2026-10-29)

API and subscription CLI brains share the failure taxonomy in `failures.py`, which also
tells a context that does not fit (`context_overflow`, `is_context_overflow`), a request too
big to send (`payload_too_large`) and a filtered prompt (`content_policy`) from a refusal,
and a spent quota (`credits`, `usage_limit`: never asked again) from a throttle.
A failed API model call is made again at 1/3/8 seconds before any tool has acted; after
that, in an interactive turn or a background task, it is made again at 30/60/120/300
seconds (20% jitter, a provider's `Retry-After` or "retry in N s" when longer, up to 10
minutes) until the owner stops it or the task's time is up, with one progress line per
outage that says when it tries again. A usage limit says when it resets when the provider
does. API replies stream (OpenRouter and the OpenAI-protocol providers in
`STREAMING_KINDS`; ChatGPT as before): connecting may take 30 s, the model may think in
silence for 30 minutes, and once its answer flows a 10-minute gap is a dead connection.
Room/background CLI turns retain their 30/60/120/240-second waits. Failed
connection and secret cards return a redacted diagnostic to the original member
and conversation, preserving completed-action receipts. No card is automatically
reopened and an owner denial never triggers a corrective round. The API harness
allows one corrective round after a failed tool; two equal tool/failure pairs
block further attempts with that tool, even with different arguments.

Every interactive and background brain receives the T0 `self_check` and
`raphael_help` tools plus the shared diagnosis doctrine and About Raphael index.
Self-check reads existing state only and reports key presence, never key values.
Full Codex plan windows remain visible in usage; explicit credits entitlement
allows the turn to continue. A terminal usage limit retains its reset metadata.

Owner replies and retry progress use complete per-kind phrases in Traditional
Chinese, Japanese or English. Diagnostic IDs and provider reasons stay on the
brain/tool wire, never in the chat or sidebar preview; the subject is the failed
service/brain or the speaking member, with Raphael's existing localized name.
`failure-owner-copy` checks both visible surfaces in `connector-failed-continued`
and the native self-diagnosis journey, including underscores rendered as italics.
The native fake brain writes a fixed natural reply independently of this helper.
A connection that fails for want of something names exactly what and where: with no
Composio key the card is `needs_composio_key` (not the old vague `not_configured`) and
the member says to add the Composio key in Settings > Connections; an app that needs the
owner's own key or developer app has its own card states and form (see
connections-mcp.md, 2026-10-31); `card-composio-missing` and `card-key-rejected` check both.

```powershell
npm run verify -- --core
npm run look -- connector-failed-continued connector-reconnected chat-secret-saved-not-resumed --theme both --width 1120,720,1920x1080
npm run native -- self-diagnosis
```

`core/tests/agent/test_self_diagnosis.py` covers taxonomy, redaction, credits,
corrective/denial bounds, the tool-loop notes (a failing tool is told to diagnose and is never blocked), reference
names and T0 availability. `core/tests/worker/test_tool_guardrails.py`, `test_stalls.py` and `test_loop.py` cover the
notes for repeated calls (a note after the result, the call still made; a hard stop only for a background task), the
`Continue now` nudge, a reply cut off by the output limit and a reply that loops.
The native fake-brain journey exercises the production connection card, failed
sign-in, self-check and continuation in the original member conversation. Its
screenshots and SQLite assertions are separate from provider/OAuth acceptance.
The October 28 quota regression uses a synthetic protocol fixture because the
original packet is unavailable. Live checks and judge require an authorized
provider; offline results never establish live or design acceptance.

## Owner round 6 contracts

Owner round 6: details/details-closed/raphael-details/details-routines/details-memory assert a visible, hit-testable conversation scrim whenever the panel overlays, and close it with a real pointer click. Inline panels have no scrim. The details scroll container owns the only row inset; routine/memory cards stay within 384px. Keyboard focus remains tested separately before pointer-state capture. no-naming decodes its avatar source and compares source resolution with rendered device pixels; the fixture uses an existing 1024px source, matching avatar_get image data.


## Growing memory context, phase 2 (2026-10-29)

Quick and ordinary private routes retain the full answered conversation until
roughly half the selected model's context window. Folding summarizes the middle
on that member's own brain, preserving the opening and recent turns verbatim.
CLI native sessions remain enabled; the normal context includes the saved summary
when a native session reopens. Cold context/summary reads never save or notify.
Auto-recall is permission-scoped FTS5 data before the question (not in system),
<=6000 characters, <=4 log and <=4 conversation hits. Search/read recheck room
membership and never cross another member's private home or threads. Retrieved
external provenance remains untrusted for later memory writes: they go in marked.
Automatic recall stays in the current conversation; explicit session_search can
retrieve that member's other conversations and currently joined rooms.

See "Memory as living files" in [Members](members.md) for the files and their tool,
selected look scenes and the `memory-growth` native journey. Conversation
context contracts live in `core/tests/memory/test_conversation.py`; shared harness
wiring and recall order in `core/tests/agent/test_memory_turns.py`.

## A long job's context, inside one run (2026-10-31)

API brains only: a turn and a background task keep every tool result while the
provider's real usage stays under the trigger (75% of the window, 50% from 512K;
unknown window: 32K). Then old results become one-liners that mark failed and refused
calls, and if that is not enough a checkpoint replaces the older rounds, inside the
owner's request message. A failed summary falls back to a static checkpoint; a
provider's "too long" shrinks and sends again, at most three times. Contracts:
`core/tests/worker/test_context.py`, `core/tests/background/test_long_job.py`, and for
the ChatGPT plan's Responses items `core/tests/brain/test_chatgpt.py`. No fake here
proves what the real Responses API accepts: run one real long round on a sign-in.

## Owner round 7 contracts

Quick questions is named once by its actionable persistent conversation row; its duplicate section heading is removed. Ordinary conversations retain their heading, overflow actions, search and quick-history clearing. conversation-sections and details-quick-once enforce that distinction. The shared private and room conversation scrollport fades its top 24px to soften partial message fragments beneath the fixed header; connector-reconnected, chat/member-text/room-text and details consumers cover this boundary. The compact sheet/scrim behavior remains unchanged.


## Learned skill notices (phase 3, 2026-10-29)

A skill_learned event is persisted on the originating member turn, rendered once as a
localized conversation-event-line using the shared eventLineHTML (quiet text and a small
icon), and excluded from public work narration. member-text
asserts the notice and absence of internal event data. Native skill-growth verifies the
notice after production background review, then reads that skill in the next task.

## Acceptance fixes (2026-10-30)

Conversation approval cards use the shared 640px reading cap, independently of the
896px composer/thread. The selected matrix covers admin-approval,
admin-approval-batch, admin-approval-long, admin-delete-approval, admin-approved
and admin-denied, plus chat as the neighbouring ordinary composer consumer.
Run both themes at 1120,720,1920x1080. The shared content-width check rejects
stretched approval cards. Desktop overlay confirmation geometry is unchanged.

## Owner round 9 regression coverage

Owner, member and room messages share message-preview.ts and data-act=expand-message.
Owner text preserves numbered paragraphs and blank lines. Room toggles update the
existing button and message node so keyboard focus survives expansion and collapse.
Collapsed text shows at most eight lines with a two-line fade. One framed action
expands the complete body in place and collapses it again; no message or code block
has its own vertical or horizontal scroll container. Page/thread scrolling remains.
The runner checks every main-entry scene for message-no-inner-scroll and
message-no-raw-envelope. Shared CLI parsing covers normal, quick, resumed, failed
continuation, room and background replies. Legacy stored envelopes are unwrapped
at rendering without rewriting historical data. Authored code remains plain content.

```powershell
npm run look -- long-owner long-owner-expanded long-member-reply long-room-messages reply-envelope --theme both --width 1120,720,1920x1080,1280x800
```

## Executable round 10 matrix

```powershell
npm run look -- esc-main-armed esc-member-armed esc-room-armed conversation-chief-up conversation-chief-bottom conversation-member-up conversation-member-bottom conversation-room-up conversation-room-bottom reply-split-bubbles overlay-learned-pill stable-connections-switch stable-dictionary-controls stable-settings-controls --theme both --width 1120,720,1920x1080
```

## Native round 10 regression journey

```powershell
npm.cmd run native -- owner-round10 voice-conversation locale-sweep delete-conversation
```

`owner-round10` uses the bundled debug shell, real Rust correction Tracker, core
acceptance and SQLite evidence. It checks owner expansion, conversation scrolling,
two Escape presses for a pending fake answer, a complete learned batch, five-second
hover retention, exact batch/evidence Undo and expiry. Read-only Win32 inspection
checks the learned window's NOACTIVATE style, rounded click region, click-through
expiry, active-monitor placement and foreground continuity. The passive learned
window starts independently of the ordinary overlay, including native isolation.
`voice-conversation` additionally verifies one Escape cancels a new native recording.
Its speech path still requires installed local Qwen3 ASR and VAD; missing models
are BLOCKED. The pending-answer marker is inert outside isolated fake native runs.
No real provider, owner data, Gmail, Composio or OpenRouter is used.

The armed Escape hint replaces the ordinary hovered Stop tooltip. The main,
member and room Escape scenes hover Stop before arming; cancel-armed rejects
stacked tooltips. The native pending-answer journey checks the same rendered rule.

The floating latest action uses a round panel surface and edge over message content,
unlike ordinary borderless icon actions (R-UI-50 exception to R-UI-16/18). Browser
checks enforce its round shape and separate surface in chief, member and room views.

Composer learning retains bounded consecutive input snapshots, replayed through the
same Rust Tracker as external editors. Two corrections separated by unchanged
words remain two terms in one batch; the final core acceptance stays authoritative.

## Mentions as chips, and the input method (2026-10-31)

An address in the owner's words (`@Raphael`, a member, `@everyone`, a group in a private chat, a connected app) is drawn as a
chip: the mark where the @ is (the member's slime, the service's own logo, the team grid), then the name, in a quiet pill, apart
from the words. It is drawn in the composer's field and in the owner's sent bubble (private chat, pending and sent, and rooms).
The words stay the plain text `@Name` everywhere else: what the core receives, what is copied or quoted, the draft, voice input,
composer learning, the slash menu and the length limit all read the textarea's `value`. A chip is derived from the words by the
core's own rule (`members/rooms.py::_targets`: the whole name after an @ that no letter or digit precedes, the longest name at
each @, nothing inside code or a quotation), so a name that matches nothing, or a letter typed against a chip, is plain text
again. Backspace or Delete beside a chip removes it whole, an arrow key crosses it in one step, Shift takes it into the
selection whole, and a caret or selection edge dropped inside one goes to its nearer edge. While the words hold a chip the
textarea paints no text and an aria-hidden copy (`.cmp-mirror`, no click) is drawn over it; the caret, selection and input
method stay the textarea's own.

The mention menu never takes the focus while an input method composes: it is drawn as the words are composed and takes the
focus, as before, once they are committed (`bindTeamMentions`). The old behaviour typed an @ twice with a Chinese input method:
the composing `input` opened the menu, the menu took the focus, the focus change ended the composition (events:
compositionstart, compositionupdate, input(composing), compositionend, blur, focus), and the commit that arrived next found
nothing to replace and inserted its text again.

```powershell
npm run look -- mention-ime-open mention-ime-at mention-ime-filter mention-ime-compose mention-ime-commit mention-chip-composer mention-chip-sent mention-chip-delete mention-chip-arrow mention-chip-room --theme both --width 1120,720,1920x1080
```

The `ime` step drives the browser's own input-method path (CDP `Input.imeSetComposition` and `Input.insertText`) with the
events a WebView2 input method sends, and `mention-ime-at` fails on the old code with `@@`. It cannot be a Windows input
method: the Bopomofo editor itself, its candidate window and TSF are not driven, so a real Zhuyin session stays a manual
check. The consumers of the shared composer are covered by `composer-learn`, `slash-commands`, `member-mentions-bots-apps`,
`mentions-bots-apps`, `room-mentions` and `chat`.

## Up and down arrows bring back what was typed (2026-10-31)

In a composer (a private chat's and a room's) the up arrow brings back what the owner typed, newest first, and the down arrow
walks forward and ends on the draft that was in the field before the first up arrow, so nothing typed is lost. The history
is what the core keeps (`agent.history.sent`: the typed turns, source `app`, of every private conversation and of every
room's owner messages, repeats in a row once), across conversations, so a conversation just made still has the last thing
typed, and it survives a restart. It is read when the first up arrow is pressed, never when a conversation opens, and it is
not a setting. The arrows are the field's own where they would move the caret (the up arrow acts only on the first line of
the words, the down arrow only on the last, and only while a walk is under way), they belong to a mention or slash menu that
is open, and they do nothing while an input method composes or with a modifier or a selection. A recalled line is edited and
sent as edited; the original stays in the history, and a line edited and walked past keeps its edit until the walk ends. A
write of the words by anything else (a send, another conversation, a dictation) ends the walk. A recalled address is a chip.
Unit tests: `composer-history.test.ts` (the walk, the draft, the guards), the core `agent.history.sent` tests in
`core/tests/agent/test_conversations.py` and `core/tests/members/test_rooms.py`.

```powershell
npm run look -- composer-history-recall composer-history-send composer-history-menu composer-history-room --theme both --width 1120,720,1920x1080
```

The fixture states the history (`typedHistory`) or derives it from its typed turns as the core does. These scenes do not prove
a restart or a real database; the core tests do.

## The composer's one button: send while speaking, Stop once sent (2026-10-31)

The composer's right-hand slot is one real button (`.cmp-voice`, 32px, the same in every state, so a press never moves it): the
voice emblem at rest; while the owner speaks into the composer (`data-task-state="recording"`) the send glyph, labelled with the send
label, because pressing it ends the recording and sends what was said (the question key goes down and up; nothing is cancelled,
and Escape still cancels at once); the Stop square only once something has been sent (`ack`, `running`, `waiting`, including the
native voice processing before a turn exists), for as long as that runs, and it stops that. `.cmp-send` stays hidden in the
non-idle states, so one control alone fills the slot, and `.cmp-voice` stays the selector the native `voice-keys` journey clicks.
A room's composer is unchanged: its recording is its own browser recorder, whose end puts the transcript into the field to be
read and sent, so its button stays Stop until then (`chat-composer.test.ts`).

```powershell
npm run look -- composer-voice-recording composer-voice-sent composer-stop-voice composer-stop-voice-result composer-stop-pending esc-recording-cancel composer-learn chat --theme both --width 1120,720,1920x1080
```

`composer-voice-recording` measures the button at rest and while recording (same place and size, send glyph and label, no Stop,
no second control); `composer-voice-sent` presses it and checks the same button is Stop once the recording is sent, with one
question key down and up and no cancellation. The unit tests are `agent-stop.test.ts` (the whole sequence in the real page),
`agent-members.test.ts` and `chat-composer.test.ts` (`drawTaskSlot`). The fixture cannot prove a microphone or the native key.

## Rich replies

See the feature map. Selected acceptance:

```powershell
npm run look -- rich-chief rich-member rich-room rich-code rich-diagram rich-source rich-expand rich-image rich-image-loaded rich-table-example rich-invalid rich-streaming rich-sequence rich-class rich-state rich-er rich-architecture rich-wide-table reply-split-bubbles conversation-chief-up conversation-member-up conversation-room-up long-owner long-owner-expanded long-room-messages chat --theme both --width 1120,720,1920x1080
```

## Small core regressions (2026-10-31)

The mention menu, chips, mirror and room recipients accept both ASCII `@` and full-width
`＠` (U+FF20). Both sides retain the same whole-name, longest-match and quotation rules.
The original prefix and owner text stay unchanged, including in the mirror and when sent;
Backspace/Delete still remove a whole chip. Offline contracts are the shared case tables in
`core/tests/members/test_rooms.py` and `app/src/main/mention-text.test.ts`, plus
`mention-field.test.ts` and `team-mentions.test.ts`.

Direct search services share one provider queue across hubs, members and turns on the
core event loop. Starts are at least 1.1 seconds apart; HTTP 429 observes Retry-After
(seconds or HTTP date), with at most three attempts. Queueing, waits and requests share
a 12-second deadline and remain cancellable. `core/tests/services/test_web.py` and
`core/tests/agent/test_services_turns.py` cover mock transport and tool consumers.

An expired CLI owner confirmation declines only its call, using the existing localized
expired wording. The same CLI continues, its answer is saved, subsequent cards wait for
their own answers, and Stop still cancels it. The card lifetime and non-CLI expiry stay
unchanged. Offline contracts are `core/tests/agent/test_cli_confirmation.py` and the
fake-child expiry/Stop regressions in `core/tests/members/test_cli_brains.py`.

## Durable owner questions and background cards (2026-11-01)

The shared permission-card component renders ask_owner with at most four real
choice buttons, optional text, submit and cancel. Its settled state is persisted
on the same turn. The existing task summary reports the number waiting for the
owner. API turns and authenticated CLI MCP transfer their continuation to the
existing background worker; no model or worker slot is held during the wait.
Background and routine connect/key/mail/page cards use the existing services
and components, including in rooms. Page sends answer a waiting page before
starting any new message. Cancellation is a tool outcome, never an approval.
Room redraws keep the iframe connected while moving it into the new message, so
answering a page does not reload it or lose its state. Room draft revisions stay
inside their room and thread instead of sharing the null private-conversation key.

Selected scenes: owner-question-asked, owner-question-answered,
owner-question-cancelled, owner-question-background, owner-question-text, owner-question-room;
Room consumers: owner-card-room-connect, owner-card-room-secret, owner-card-room-mail,
owner-card-room-page; representative consumers: local-permission-card, page-product,
chat-connect-gmail, chat-secret-masked, email-draft-edit, member-text, room-text.
Run both themes at 1120,720,1920x1080. Inspect every sheet and relevant full-size
card and compare its spacing and controls with the existing permission card.

```powershell
npm run look -- owner-question-asked owner-question-answered owner-question-cancelled owner-question-background owner-question-text owner-question-room owner-card-room-connect owner-card-room-secret owner-card-room-mail owner-card-room-page local-permission-card page-product chat-connect-gmail chat-secret-masked email-draft-edit member-text room-text --theme both --width 1120,720,1920x1080
```

The task explicitly prohibits network, cargo, native journeys and npm run judge;
record these as unverified, never as design/live/native acceptance.

Core contracts: core/tests/background/test_owner_cards.py and
core/tests/agent/test_owner_questions.py. The shell allowlist and its existing
allowlist test include owner_questions.answer; cargo remains the owner's check.
