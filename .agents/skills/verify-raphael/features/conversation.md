# Conversation

## Calm conversations (owner request, 2026-11-05)

R-UI-101 supersedes the older centred routine/event and thirty-minute separator
contracts in R-UI-42/75/76/79. Each private calendar day has one date-only heading,
including pending turns. Message clocks stay in each hover action row. Routine runs
have a muted, clickable routine name inside their first reply, including a failure
without an ordinary reply. Terminal failures have one error sentence; the existing
rerun action sits beside reply/copy, visible for the latest failed turn and on hover
for older failures. The core no longer emits the same terminal CLI sentence as an
event. Historical matching events are omitted from the rendered projection.

Progress, work steps and public routine/calendar/skill/meeting receipts live in the
reply's collapsed work detail. Inspection targets and receipt grouping stay intact;
find reveals the enclosing work detail before visiting a receipt. Colleague exchanges
and handoffs retain one closed line (R-UI-72); unread navigation and cards needing the
owner remain. Groups retain their existing handoff/report/card projection, with
message time in the shared hover actions. No additional room work engine is added.

R-CLI-07 gives premature CLI completion its own cli_stopped kind, preserving
the bounded retry contract. Only real connection errors use network guidance.
The same foreground/background loop carries a bounded, secret-redacted original
CLI error and last stderr lines into the persisted turn detail. A required MCP
startup failure names its server. Fake children prove these boundaries; they do
not establish native, subscription, provider or live recovery acceptance.

Selected rendered verification (both themes, all three sizes):

```powershell
npm run look -- calm-thread calm-thread-days handoff-group-room transcript-action-list thread-new-divider-short owner-question-asked event-routine-line event-routine-find-group event-calendar-opens routine-sentence-webhook centred-system-events --theme both --width 1120,720,1920x1080
```

Also verify direct grouped-receipt disclosure with `event-lines-collapse` in the
same theme/size matrix. Its opened group stays inside reply detail and retains
every inspection target through roster refreshes; the obsolete 32px gap to the
next bubble is no longer a contract. Review its look run with judge as well.

calm-thread uses synthetic zh-TW words for the 07:00 failed routine and 08:00 owner
retry. Its check counts one day heading, three messages and no other centred item,
one failure sentence per turn, inline routine identity and action-row rerun.
calm-thread-days requires two date-only headings. Inspect every contact sheet,
calm-thread light 720 and dark 1120 at full size, plus representative controls.
Run judge on this same selected evidence. Unit brief: targeted Vitest/pytest only;
the integrator runs full verify/core. Native/live remain separate acceptance.

## Streaming composer files (2026-11-05)

Private and room composers share twenty-file admission, 250 MiB document limits and
1 GiB video limits. Exact maxima are admitted and the next byte retains the existing
localized refusal. Files above 4 MiB upload in 1 MiB chunks; draft/sent history retains
opaque store IDs. Cancelling/navigation aborts incomplete uploads. Document readers
retain bounded extraction; media uses the native asset range protocol rather than a
whole-file page Blob. Saved large files restore by metadata without fetching their bytes.

Selected scenes: attachment-limits, attachment-too-large and chat, plus the settings
update/import consumers listed in settings-appearance.md. Both themes at
1120,720,1920x1080, synthetic zh-TW fixtures. Oversize scene metadata is synthetic and
is rejected before any read; exact upper boundaries are covered without allocating a
gigabyte in unit tests. Actual native upload/playback and upgrades remain unverified.

```powershell
npm run look -- attachment-limits attachment-too-large --theme both --width 1120,720,1920x1080
```

## Commands and conversation shortcuts (2026-11-05)

R-NAV-01 reuses the shared popover, cross-conversation search and the existing
chief/member/room finders. Ctrl+K works while typing; other shortcuts leave
editable fields and IME alone. The palette filters names and shortcut labels,
restores focus on dismissal and routes selection through the existing shell.
See [Daily work](daily-work.md) for the full behavior and native limits.
Follow-up 1 authorizes this selected rendered matrix; native/live remain deferred.

```powershell
npm run look -- command-palette command-palette-filter command-palette-member shortcut-find-chief shortcut-find-member shortcut-find-room shortcut-search chat sidebar-rail sidebar-drawer --theme both --width 1120,720,1920x1080
```

Compare palette rows with the existing cross-conversation search popover at
matching theme/width. Inspect all contact sheets and full-size new scenes,
including compact focus, filtering, long names and the room finder.

## Pending conversation questions and readable results (2026-11-04)

R-OWNER-03, R-CARD-09 and R-CARD-10 extend the shared conversation cards.
The existing Other/free-answer field remains in ownerQuestionHTML. A shared
pending-questions controller mounts above each private/room scrollport and uses
a soft filled compact button and shared menu (R-UI-98). The button has no input
outline (R-UI-18 exception), and uses the shared chat icon, truncated title, small
pending count and downward chevron. It observes scroll,
resize and changed card nodes without polling. Only off-screen pending ask_owner
questions float. A page-independent pending_questions projection on the existing
history/messages reads keeps earlier-page questions reachable without changing
pagination. One press calls owner_questions.bring; the existing question and task
move together. The controller waits for the returned turn to render before it
scrolls/focuses, and avoids pulling another conversation after navigation.
Chief history writes member_id=0 and resolves a concrete conversation_id. The
pending projection also accepts NULL chief member rows using IS, while retaining
the conversation/member boundary. Tests cover both representations outside the
loaded page; the nullable case shadows the current NOT NULL schema in a fixture.

The same RPC supports room scope, preserving room/thread ownership and adding a
room receipt with a unique per-move request ID. Repeated bringing at the newest
turn is idempotent. Answers continue the same task. No approval is granted.

Permission detail labels cannot shrink; values wrap into the remaining width.
The permission-detail-label scene opens the existing local-permission-card
disclosure and checks each real label's height against its computed line height.

composio-result.ts projects recognized envelopes into bounded readable
app-brand/outcome/field text with localized outcomes and field separators. Missing
app slugs use the localized result label, and operation verbs are never expanded. Member-authored private/room replies, progress, work
rows and turn details require a tool slug or successful with data/error; an
action hint alone never replaces ordinary fenced/inline JSON config. Composio
permission summaries and step details explicitly use trusted tool mode, which
also projects unmarked JSON objects. isComposioTool shares server/tool detection
across these consumers and composioAction. Raw model messages, persisted replies and original permission objects stay
intact. Synthetic tests cover failure, nesting, long/incomplete output, excluded
fields, ordinary code and owner text. This does not prove live provider behavior.

Selected integration matrix (both themes; 1120,720,1920x1080):

```powershell
npm run look -- owner-question-pending owner-question-brought owner-question-pending-page owner-question-pending-room owner-question-pending-many owner-question-asked owner-question-typed owner-question-text owner-question-answered owner-question-cancelled owner-question-room permission-detail-label local-permission-card card-message-waiting composio-readable-result member-text room-text --theme both --width 1120,720,1920x1080
```

New scenes: owner-question-pending, owner-question-brought,
owner-question-pending-page, owner-question-pending-room,
owner-question-pending-many, permission-detail-label, composio-readable-result.
Compare the floating compact button with conversation controls, its list with shared
menus, and permission details with card-message-waiting at matching sizes/themes.
Follow-up 2 authorizes the selected look matrix and visual review. Judge requires
external references and authorized network access; native and live-provider
acceptance remain deferred. DOM/Vitest and offline core checks alone
do not establish visual/native/provider/design acceptance.


## Visible work sentences (2026-11-02)

R-UI-75 and R-WORK-01/02 use one 28px avatar and one muted action line in private
threads and below each working group member. The current tool wins over public
progress, then the activity label and localized thinking. Long text ellipsizes;
the shared hover holds the whole sentence. Only that text and its tooltip change.
Live work has no list, dots or clock. A plain steps icon opens completed sentences;
old steps receive readable generic past phrases, errors use existing reason words,
and model/cost (including separate media billing) stay in the small footer.

Core `agent/actions.py` is a deterministic three-language table. Sanitized action
records are `event` messages with type `action` inside agent_messages, never step
metadata. API tools and CLI MCP use AgentService's shared execute boundary;
fast planned calls use _make_call; background tools and resumed approvals use
TaskRun. History/model and search readers discard these records. Activity-only
turn notifications refresh the window without unread/room delivery. Background
public narration stays on the active TaskRun, projected through the existing task
view and discarded with it. No RPC, migration, provider call or setting is added.

Selected matrix (both themes, 1120,720,1920x1080):

```powershell
npm run look -- running running-motion transcript-working transcript-hover-detail transcript-clean generated-video-running busy-team-thread busy-team-typing busy-team-room presence-hover-action transcript-action-long group-live-line transcript-action-list transcript-old-list work-member-builtin room-thinking generated-image-bill --theme both --width 1120,720,1920x1080
```

`busy-team-typing` changes the live progress text during real keyboard input and
requires zero replaced lines/faces/cards. Compare the shared live line in
transcript-working and group-live-line, and steps buttons in transcript-action-list
and transcript-old-list with adjacent reply/copy icons at the same size/theme.
`work-steps-own-words`, `room-thinking` and `generated-media-bill` retain their old
coverage with the new sentence/footer markup. Core privacy/path regressions live
in test_action_sentences.py, test_harness.py and background/test_service.py;
work-line.test.ts covers precedence, text-only patches, escaping and detail.

The offline fixtures prove rendered behavior only. Native CLI operations that bypass Raphael
MCP, and legacy quick-voice computer runs before a conversation turn exists,
cannot supply argument-aware sentences through these boundaries; their existing
activity labels remain the fallback.

## Member media (2026-11-01)

The shared image_generate/video_generate tools use only the owner's explicit image_model
and video_model settings. Both default unset: discovery is not consent. These separate
paid API models are independent of every member's conversational brain, including CLI
subscriptions; changing a brain changes neither setting. The owner chooses in existing
Settings > Models & usage rows, with provider, per-image/per-request/token pricing when
known and an explicit API-charge note. Image-only catalog entries remain selectable.
No compatible discovered video model is shown as none available, never invented.

Unset or removed providers show the shared inline notice and repair directly to the
matching row without saving a choice. Paid responses record image/video spend, model and
cost, including delivery failures. Work steps show those public metadata only; unknown
cost is visibly unreported. Video keeps the existing live work, Stop and stored player.
Generated output belongs only in media messages, not fabricated owner attachments.
Data tables and SVG file cards continue using the existing rich reply and attachment UI.

The unchanged dataset consumers remain mapped separately:

```powershell
npm run look -- dataset-table dataset-chart --theme both --width 1120,720,1920x1080
```

```powershell
npm run look -- media-models-unset media-models-set media-models-menu generated-image-bill generated-image generated-video generated-image-missing generated-video-missing generated-image-repair generated-video-repair generated-video-running generated-video-cancelled quick-model-menu generated-audio-member running generated-audio-missing --theme both --width 1120,720,1920x1080
```

Inspect all sheets and full-size controls at both themes and all selected viewports.
Compare media rows/pickers with quick-model-menu, stored media with generated-audio-member,
running video with running, and inline repairs with generated-audio-missing. Fixture
prices and media do not prove live billing, provider compatibility, native playback or
external design acceptance.

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
test_providers_more.py (48). All use fakes or mock transports.


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
Run both themes at 1120,720,1920x1080. One heavy
process at a time, Vitest --maxWorkers=2, CARGO_BUILD_JOBS=2 and the shared native
CARGO_TARGET_DIR apply.


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
Offline fixtures do not prove native microphone, providers or transport.

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

Typed progress never goes to the overlay. Browser fixtures cannot prove native concurrency,
Esc, spoken-question and paste-last behaviour.

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

## Task endings (2026-11-04)

R-BATCH-07/08 use an explicit handoff requires_artifact boolean, default false.
Read-only reviews and file references do not create a file requirement. A required
artifact is verified from bytes in the member/shared workspace or an absolute
owner-PC path named in done_when or the report. Migration 59 defaults existing
tasks to false and preserves their reports; reruns retain the explicit contract.

R-WORK-03/04/05 persist a reason on every blocked step, explain bounded consultation
refusals, preserve completed replies and measured counters on Stop, and store
cancelled independently of denied permission. Conversation history still reads
cancelled owner requests as unfinished work. The existing work list translates
approval, memory-rule, secret-store and unseen-URL refusals for each speaker.

R-CLI-05/06 classify the Codex maximum-character input error as context_overflow,
keep background failure kinds and give an oversized resumed CLI history one fresh
attempt on the same model. The bounded continuation contains the current task,
accepted owner input and execution records; effects are never replayed by the
harness. Another overflow is terminal. New sessions with oversized input do not
enter this retry path.

Selected UI matrix: task-ending-chief, task-ending-member and work-member-builtin,
both themes at 1120,720,1920x1080. Inspect the expanded reasons and preserved
answer/count in both conversation consumers; compare their work lists at equal
theme/width. Run npm run verify and the affected offline pytest suites. Native
history/Stop, real CLI continuation and live tool selection remain separate from
fixture evidence; network and judge calls require the task's authorization.

```powershell
npm run look -- task-ending-chief task-ending-member work-member-builtin --theme both --width 1120,720,1920x1080
```

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
native voice processing before a turn exists), for as long as that runs, and it stops that. Words or files in the field make the
slot Send even while work runs, so the owner can always send another message; the field empties and Stop returns. One control alone
fills the slot in every state, Escape shows the Stop it arms, and `.cmp-voice` stays the selector the native `voice-keys` journey clicks.
A room keeps its browser recorder but uses the same recording/send slot: the next press transcribes and sends the spoken
words together with the typed draft once. Escape discards recording or pending transcription; Stop represents sent work only.
Room speech uses the shared dictation finalizer and dictionary learning (`chat-composer.test.ts`).
See [Owner polish](owner-polish.md) for the group recording comparison and shared conversation-find matrix.

```powershell
npm run look -- composer-voice-recording composer-voice-sent composer-stop-voice composer-stop-voice-result composer-stop-pending composer-send-while-working composer-stop-armed-with-words esc-recording-cancel composer-learn chat --theme both --width 1120,720,1920x1080
```

`composer-send-while-working` sends three messages during running work and checks the slot never moves, each message shows in order and nothing stops.

## The owner's bubble and link cards (2026-11-02)

The owner's bubble in a member's own conversation wears that member's colour (`owner-bubble.ts`, set in `drawFaces` so an avatar change follows at once); Raphael's conversation and group chats stay neutral. A link card under a reply is the media card's width whatever the reply says, and an address with no title reads once, in full.

```powershell
npm run look -- owner-bubble-member owner-bubble-other-member owner-bubble-light-character owner-bubble-long owner-bubble-chief owner-bubble-room link-card-short-reply --theme both --width 1120,720,1920x1080
```

A dialog dims the window caption too and starts below it, and the window buttons still answer:

```powershell
npm run look -- dialog-caption-confirm automation-window --theme both --width 1120,720,1920x1080
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

## Missing prerequisites (2026-11-01)

`failures.Missing` extends the existing diagnostics and connection-card flow with
resource, requirement, state and repair. `agent.steps.step_view` serves both
foreground and background history. Raw errors, credentials and service URLs are
never interpolated into the shared UI note. Known provider and service causes
survive persistence; an unknown cause never asks for a key or credits.
`main/missing.ts` renders the sentence and one existing-settings action, and the
real main entry delegates its navigation to the corresponding provider or service
form. Installation dependencies and file repair steps without an app setting have
no settings button. Local services remain in Settings > Raphael > Services.
A store card opens the Composio form; the native Google client needs an administrator.

npm run look -- missing-card missing-card-repair missing-onboarding-repair missing-store-repair missing-search missing-search-repair missing-voice missing-voice-repair missing-hidden missing-vision missing-model-list missing-provider missing-provider-repair missing-routines missing-learned missing-pdf missing-media missing-expired missing-mail --theme both --width 1120,720,1920x1080

Run both themes at 1120,720,1920x1080. Also cover desktop-absent,
desktop-unavailable, desktop-install, model-choices-answer, plugins-store-key,
messaging, connections-empty and email-draft-edit as affected existing consumers.
Inspect all contact sheets and relevant full-size images. Offline tests cover the
sanitized TTS event and dictation prerequisite routing; Rust/native acceptance,
real microphone/audio, provider/login and judge are separate checks.

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

Core contracts: core/tests/background/test_owner_cards.py and
core/tests/agent/test_owner_questions.py. The shell allowlist and its existing
allowlist test include owner_questions.answer.


## Owner input and deliverable audio (2026-11-01)

```powershell
npm run look -- generated-audio-chief generated-audio-member generated-audio-room generated-audio-missing generated-audio-repair owner-addition missing-voice --theme both --width 1120,720,1920x1080
```

An owner message in an active private conversation is an ordinary owner bubble and
enters the same loop as a user-role message at its next step, after the complete
tool batch. Stop alone cancels the work. The inbox seals atomically at the final
reply; a later message starts a new turn. CLI brains finish their current turn and
resume the existing native session with the addition. Background tasks use the same
inbox inside the worker process, through internal task.steer admission.
Accepted owner-only history rows use owner_input and render no empty member reply.
CLI handoffs preserve accepted input in their saved continuation.
Room messages use that inbox for a single active recipient in the same room and
thread. Several addressees, files or a sealed inbox start a new room turn without
cancelling running tools. Only rooms.stop cancels room work.

generate_audio is offered by the shared snapshot to API/CLI conversations,
background work and routines. It consumes ServiceHub.speech and the configured
voice, key, model and enabled state. It stores bounded mono PCM as a WAV attachment,
using the existing audio card; it does not claim MP3 encoding. A missing voice
service yields the existing localized missing notice and voice settings repair.
Tool receipts from attach_file and generate_audio are checked against AttachmentStore
before publishing media messages. Room cards share the same attachment renderer.

Telegram returns only attachments from the completed turn's stored tool receipts
to the paired chat. PNG/JPEG up to 10 MiB use sendPhoto; MP3/M4A use sendAudio;
other files use sendDocument, with a 50 MiB maximum. An oversized file names the
original Raphael conversation as the place to open it. Revocation is checked again
before delivery. Paths supplied by a model are never uploaded.

Offline contracts: core/tests/agent/test_steering.py,
core/tests/agent/test_cli_steering.py, core/tests/worker/test_owner_input.py,
core/tests/background/test_steering.py, core/tests/messaging/test_outgoing_files.py,
core/tests/services/test_audio_file.py, core/tests/agent/test_audio_file.py,
core/tests/background/test_audio_file.py, core/tests/agent/test_scrub.py,
app/src/main/generated-audio.test.ts.
Selected real-entry scenes: generated-audio-chief, generated-audio-member,
generated-audio-room, generated-audio-missing, generated-audio-repair and owner-addition. Both themes,
1120, 720 and 1920x1080. Compare the incoming and generated audio cards in each
audio scene and compare the repair notice with the existing missing-voice scene.
Fake Telegram, fake CLI and fixture audio are not live or native acceptance.


## CLI recovery after recorded work (2026-11-01)

Conversation members and background tasks share CliLoop's bounded transient
recovery. A new request resumes the latest native session or starts with the
original task, owner additions, recorded tool results and uncertain native steps.
The model must check effects before repeating actions and use answered cards.
No harness-side tool replay or model/billing fallback is allowed. Every post-action
wait is progress; terminal text distinguishes completed/answered, failed and
unconfirmed steps and says the remaining work is incomplete. Exact arguments and
results are private model context, never public progress or final diagnostics.

Offline coverage: `core/tests/agent/test_cli_recovery.py` covers Codex/Claude,
missing/existing/nonpersistent sessions, transient errors/EOF, finite API waits,
provider cooldowns, permanent failures, Stop, owner steering and in-flight receipts.
`test_cli_brains.py::test_member_cli_recovers_after_an_answered_card_and_write`
uses a real fake CLI subprocess, a conversation card and one memory write.
`test_room_cli.py::test_background_cli_recovers_from_receipt_without_reopening_card`
uses a fake CLI subprocess, the background permission card and one plugin call.
Both prove the resumed prompt and final owner-visible result, with no API fallback.
Existing room cancellation and card-expiry tests remain affected consumers.

Core-only change: no new visual scene or frontend change. Run the selected core
agent/background/members/worker/integrations suites.
## Background app discovery (2026-11-01)

Background API and CLI snapshots offer the same read-only find_app catalog contract
as conversation turns. Discovery opens no owner question and exposes no account
data. An app absent from the task snapshot can be found by exact catalog id, then
connect_app uses the existing card in the originating private chat or room. The
owner signs in on that card even in full-permission mode. The same task and turn
resume once with current tools; no extra RPC, table, page or toggle is added.
Offline evidence: core/tests/agent/test_owner_questions.py and
core/tests/background/test_owner_cards.py. Real catalog completeness, provider
consent and live model choice remain unverified; fixtures use fake transports.

Routine event lines distinguish once, weekdays, daily, weekly and every in zh-TW,
ja and en, including start_date, until and max_runs. Evidence:
core/tests/agent/test_routine_event.py and core/tests/members/test_harness.py.
## Existing composer and file consumers (feature-map sync)

```powershell
npm run look -- composer-long-link composer-long-link-sent room-long-link room-composer-files room-composer-drop-sign room-files-sent --theme both --width 1120,720,1920x1080
npm run look -- new-conversation-recording new-conversation-hearing composer-voice-recording composer-voice-sent composer-stop-voice composer-stop-voice-result composer-stop-pending esc-recording-cancel composer-learn chat --theme both --width 1120,720,1920x1080
npm run look -- team-file-reply rich-chief rich-member rich-room rich-code rich-diagram rich-source rich-expand rich-image rich-image-loaded rich-table-example rich-invalid rich-streaming rich-sequence rich-class rich-state rich-er rich-architecture rich-wide-table reply-split-bubbles conversation-chief-up conversation-member-up conversation-room-up long-owner long-owner-expanded long-room-messages chat --theme both --width 1120,720,1920x1080
```


## Answer forms (2026-11-01)

Closed forecast, board and chart fences carry strict JSON. The shared rich reply
path draws them for Raphael, members and rooms with its existing copy-source button.
Invalid, oversized and provisional blocks retain escaped code. Schemas and readable
conversion live in shared/answer-forms.ts; SVG/theme rendering in main/message-forms.ts.
Forecast: place, units, 1-7 days (day/condition/high/low). Board: 1-5 columns
(title/cards), 0-20 cards each (title, optional line/owner). Chart: type bar/line,
title/units, 1-24 labels, 1-2 series (name/values with matching lengths).
Strings are 1-160 characters, JSON at most 24000 characters; finite numbers at
most 1e12 absolute, temperatures -1000..1000 and low <= high. Unknown keys fail.
Boards wrap, never drag; forecast wraps at narrow widths; charts use token-derived
monochrome SVG, distinguish series by dashes and expose each value in hover titles.
No clock, permission, setting, RPC, migration or chart dependency is added.

The one DOCTRINE reaches API, CLI and worker prompts. Weather descriptions nudge
towards forecast; no absent weather facts are invented. Telegram conversation and
background reports, spoken text and dictated captions get readable values; history
keeps the original fences. Existing tables retain their conversion behavior.

```powershell
npm run look -- form-forecast form-board form-chart-bar form-chart-line form-invalid form-streaming form-truncated form-room rich-chief rich-member rich-room rich-code rich-diagram rich-source rich-expand rich-image rich-image-loaded rich-table-example rich-invalid rich-streaming rich-sequence rich-class rich-state rich-er rich-architecture rich-wide-table long-owner long-owner-expanded long-member-reply long-room-messages reply-split-bubbles bot-message-from-centred overlay-long-answer --theme both --width 1120,720,1920x1080
```

There are no message-* scenes in this branch: message-content/message-rich tests,
reply-split-bubbles and bot-message-from-centred cover those existing consumers.
Inspect every contact sheet and relevant full-size form in both themes, compare
the shared header/copy button with rich-code.
Offline evidence never establishes judge, native, cargo, network or real-provider
acceptance.
## Still conversations during team work (2026-11-01)

R-UI-71: unchanged refreshes retain DOM identity and scroll position. Private threads and rooms share the keyed line diff; private carry hooks retain typed, mail and page card state. Live labels paint synchronously through updateLiveTimes and tick independently of HTML identity. Cached previews paint before a frame. Member rows, heading faces, details, Home and Calendar patch or skip unchanged data. Loaded tasks and handoffs refresh promptly; unrelated workers poll at most once per second. Slow private reads coalesce without starving their result. MemberActivity and AgentTurn retain roster state and unread updates.

Pressure scenes: busy-team-thread (quiet control reaches the bottom), busy-team-up, busy-team-steps (one changed turn and ready cached cards), busy-team-typing (real input and caret intact; nearest-rank key-to-frame P90 at most 100 ms, long tasks at most 50 ms; all samples and the slowest key remain in the report), busy-team-follow, busy-team-anchor, busy-team-hover, busy-team-room and busy-team-home. Unchanged thread/room limits: lines/cards/faces 0, all reads 24, member reads 6, long tasks 600 ms, bottom distance 80 px; scrolling-up writes 0. Room messages currently render plain links, so room card identity is vacuous; private scenes exercise actual preview cards. Home keeps faces.

Regression consumers: composer-stop-background, composer-stop-navigation, composer-task-stop, polish-scroll, polish-search-chief, polish-search-room, polish-room-recording, generated-video-running, home-calendar-rhythm, search and calendar-rhythm-week. Run these and the pressure scenes with both themes at 1120, 720 and 1920x1080. Inspect contact sheets and relevant full-size images. Browser fixture evidence does not establish judge, native, live-provider or network acceptance.

Unit evidence: app/scripts/look/event-storm.test.mjs (nearest-rank P90, retained slowest frame and exact threshold), ui-patch.test.ts (identity, focus, listener and keyed reorder), pages/agent-stop.test.ts (same-page skip, task scope, slow reads), timeline.test.ts (clock-independent HTML), chat-work.test.ts (visible ticking labels and queued fallback), group-chats.test.ts (room identity and event scope), automations.test.ts (unchanged Calendar), link-previews.test.ts (synchronous cache paint).

```powershell
npm run look -- busy-team-thread busy-team-up busy-team-steps busy-team-typing busy-team-follow busy-team-anchor busy-team-hover busy-team-room busy-team-home --theme both --width 1120,720,1920x1080
```

Activity listener audit also covers Settings usage: unchanged analytics and allowances retain their nodes; changed values use the shared DOM patch. Evidence: usage-analytics.test.ts and run-analytics.test.ts. Representative additional consumers:
```powershell
npm run look -- slime-states sidebar-unread usage usage-allowances --theme both --width 1120,720,1920x1080
```

Animation clocks are not content identity: retained slimes keep their phase, delight and handover transition; new room messages retain older slime lines. ui-patch.test.ts::a changed row preserves its slime clock and active transition and group-chats.test.ts::a new room message retains older slime lines across animation clocks pin this. slime-states now updates a row preview during WorkerChanged traffic and asserts the actual CSS animation objects, start times and delays remain unchanged before checking the real member states.

The prompt, empty-page hero and active voice flyer also patch their unchanged faces during roster updates. Evidence: pages/agent-members.test.ts::a changed roster preview retains the prompt and empty-page faces and voice-mode.test.ts::an unchanged voice redraw retains the listening picture. Voice consumers:
```powershell
npm run look -- composer-voice-recording new-conversation-recording --theme both --width 1120,720,1920x1080
```


Review follow-up (2026-11-02): unchanged roster loads still restore viewing and read the visible unread thread; CoreReady invalidates both roster and viewing memory. Returning from a room to the same member refreshes retained turns. The page snapshot includes the local date. Evidence: pages/agent-members.test.ts (returning, unread on show, core restart, zero storm viewing and room return) and pages/agent-stop.test.ts (local midnight).

```powershell
npm run look -- busy-team-thread busy-team-up busy-team-steps busy-team-typing busy-team-follow busy-team-anchor busy-team-hover busy-team-room busy-team-home sidebar-unread conversation-midnight --theme both --width 1120,720,1920x1080
```

## Folded colleague exchanges (2026-11-02)

R-UI-72 uses handoff-line.ts and event-line.ts for private turn groups and consecutive room receipts. A message or blocked-intent entry separates room groups. Shared thread-diff.ts retains every handoff-event disclosure and its open state, including received-message lines. Existing individual request, result and artifact controls remain inside the closed-by-default group.

Selected matrix: handoff-group, handoff-group-done, handoff-group-many, handoff-group-open, handoff-group-room, centred-system-events, handoff-centred-line, room-handoff-queued, room-handoff-running, room-handoff-result, room-handoff-failed, room-workflow-blocked, room-immediate-work, room-mention-after-hop-limit, busy-team-thread, busy-team-room. Both themes at 1120,720,1920x1080. The centred-system-events assertion retains the two original handoff receipt labels; the meeting is in reply detail (owner, 2026-11-05).
Additional R-UI-72 coverage: handoff-group-long checks long and unbroken names at all three sizes. Arriving receipts update only the event subtree; the owner question, answer and intervening room message retain their DOM nodes.


```powershell
npm run look -- handoff-group handoff-group-done handoff-group-many handoff-group-long handoff-group-open handoff-group-room --theme both --width 1120,720,1920x1080
```

## Review: one group state and scroll intent (2026-11-02)

The group summary chooses one state in every locale: waiting for the owner, otherwise unfinished, otherwise running; completed work has no state label. Latin names have a CSS gap before Chinese list joins; localized text remains unchanged. Menu scroll intent is handled by the shared ui.ts layer. Outside wheel, touchmove and page-scrolling keys dismiss every level; scrolling inside either menu preserves its own scrolling. Resize dismisses the frozen menus; programmatic/layout scrolling preserves them. Live text completions alone follow their caret anchor. The work-event storm, redraw and unchanged-DOM guarantees remain covered.

```powershell
npm run look -- handoff-group handoff-group-done handoff-group-many handoff-group-long handoff-group-open handoff-group-room menu-wheel-closes menu-resize-closes menu-hide-control menu-settings-redraw menu-pointer-return menu-move-hover menu-move-picked menu-move-keyboard menu-move-flip menu-move-diagonal centred-system-events --theme both --width 1120,720,1920x1080

## Shared conversation card shell (2026-11-02)

Rules R-CARD-01 through R-CARD-04 map to `app/src/main/card.ts` and `card.css`.
Consumers: mail/offer, durable owner question, main/background approval,
permission, connector and inline credential setup, MCP proposal, team draft and
settled decision, page, computer takeover, checkpoint task result and composer
failure. Rooms reuse the same renderers and services.

Run the `card-*` scenes listed by `npm run look -- --list`, plus existing
`email-draft-*`, `owner-question-*`, `admin-approval*`, `local-permission-card`,
`connector-*`, `chat-secret-*`, `mcp-proposal-*`, `member-draft*`, `computer-*`,
`chat-computer-takeover`, `chat-human-control`, `chat-handback`,
`room-question-card`, and `owner-card-room-*` at both themes and 1120,720,1920x1080.
The shared `card-shell` rendered assertion checks every visible production card
in these consumers. `card-sheet` places production card data in one conversation
column; focused scenes inspect each card/state and its real mock-boundary flow.
Question key/text, once/always/deny, inline key isolation, failed-send retry and
single-stream takeover/handback are explicit journeys. Checkpoint file counts
must use actual stored diffs; no-files tasks remain prose.

Inspect every contact sheet and relevant full-size images against local card-00
through card-10 references. Fixture success does not establish judge, native,
network, cargo or real-provider acceptance.


`````sh
npm run look -- card-mail-ready card-mail-discarded card-question-waiting card-question-answered card-question-cancelled card-question-text card-permission-waiting card-approval card-team card-team-done card-connect-waiting card-connect-authorizing card-connect-done card-connect-failed card-connect-expired card-connect-cancelled card-key-waiting card-key-done card-key-failed card-secret card-secret-failed card-computer-done card-mcp-draft card-mcp-tested card-mcp-done card-mcp-cancelled card-permission-once card-permission-always card-permission-deny card-login card-question-key card-computer-waiting card-computer-takeover card-computer-handback card-send-failed card-send-retry card-mail-failed card-mail-retry card-task-result card-task-prose card-sheet --theme both --width 1120,720,1920x1080
```

`````sh
npm run look -- card-page-ready card-page-failed card-background card-task-files card-task-restored --theme both --width 1120,720,1920x1080
```

`````sh
npm run look -- card-task-room --theme both --width 1120,720,1920x1080
```

Additional failed-card exits use the shared local Close action and preserve saved work.

```sh
npm run look -- card-mail-close card-page-close card-connect-close --theme both --width 1120,720,1920x1080
```

```sh
npm run look -- card-key-guide-retry --theme both --width 1120,720,1920x1080
```

| One-card local command consent and folded settings | `npm run look -- local-command-consent local-command-later local-command-background local-command-manage room-question-card card-background --theme both --width 1120,720,1920x1080` | Exact command/directory remain in disclosure; named command consent, original answer and settings boundaries remain. |
| One-card settled local command | `npm run look -- local-command-once --theme both --width 1120,720,1920x1080` | One answer settles the original card and removes decision/settings controls. |
| Connected message draft rows | `npm run look -- card-message-waiting card-message-once card-message-deny card-message-failed card-message-retry --theme both --width 1120,720,1920x1080` | Exact delivery fields and body survive settlement/failure; retry answers only the original approval. |

### Owner card review follow-up (2026-11-02)

R-CARD-06: known approval action with localized member name; new visible disclosure content; one state per card; shared per-kind prompt table; one-line inline credential hints with folded guides. Regression tests: card.test.ts, card-behavior.test.ts, inline-connection.test.ts, task-result.test.ts, timeline.test.ts, pages/agent-cards.test.ts, scripts/look/audit.test.mjs. Selected visual consumers: card-sheet, card-approval, admin-approval*, card-mail-ready, email-draft-handed-off, card-mail-discarded/failed, card-task-result/files/restored/prose/room, card-key-waiting/guide-retry, card-login, card-secret/failed, connector-app/key-form/key-sent, chat-secret-saved-not-resumed, card-question-waiting/key, owner-question-background/room, card-permission-waiting/once, local-command-background, card-message-waiting, card-computer-waiting/handback, mcp-proposal-stdio, card-mcp-done, card-team-done.
```sh
npm run look -- card-message-waiting card-message-once card-message-deny card-message-failed card-message-retry --theme both --width 1120,720,1920x1080
```

```sh
npm run look -- card-sheet card-approval admin-approval admin-approval-batch admin-approval-long card-mail-ready email-draft-handed-off card-mail-discarded card-mail-failed card-task-result card-task-files card-task-restored card-task-prose card-task-room card-key-waiting card-key-guide-retry card-login card-secret card-secret-failed connector-app connector-key-form connector-key-sent chat-secret-saved-not-resumed card-question-waiting card-question-key owner-question-background owner-question-room card-permission-waiting card-permission-once local-command-background card-message-waiting card-computer-waiting card-computer-handback mcp-proposal-stdio card-mcp-done card-team-done --theme both --width 1120,720,1920x1080
```

### Real Composio approval and question-head review (2026-11-02)

R-CARD-07 and R-CARD-08: the real COMPOSIO_MULTI_EXECUTE_TOOL envelope is projected by the core before drawing the existing permission card. The member is the subject; the app identity and mark come from the inner slug and connector name. The router action, digest, and all execution arguments stay intact. Unknown actions use the localized member/app title without filler body text. Multiple calls keep the general form. An unanswered owner question has no waiting pill (the explicit shared-shell exception); Close is last in its head. Empty and typed answer controls remain visible, and the enabled primary is white on hover. Settled questions retain their decision status.

```powershell
npm run look -- owner-question-room owner-question-asked owner-question-typed owner-question-answered owner-question-cancelled owner-question-background owner-question-text local-permission-card admin-approval admin-approval-batch admin-approval-long card-page-ready card-page-failed card-background card-mail-ready card-mail-discarded card-question-waiting card-question-answered card-question-cancelled card-question-text card-question-typed card-permission-waiting card-approval card-team card-team-done card-connect-waiting card-connect-authorizing card-connect-done card-connect-failed card-connect-expired card-connect-cancelled card-key-waiting card-key-done card-key-failed card-secret card-secret-failed card-computer-done card-mcp-draft card-mcp-tested card-mcp-done card-mcp-cancelled card-permission-once card-permission-always card-permission-deny card-login card-question-key card-computer-waiting card-computer-takeover card-computer-handback card-send-failed card-send-retry card-mail-failed card-mail-retry card-message-waiting card-message-once card-message-deny card-message-failed card-message-retry card-mail-close card-page-close card-connect-close card-key-guide-retry card-task-result card-task-room card-task-files card-task-restored card-task-prose card-sheet --theme both --width 1120,720,1920x1080
```

### Review image regressions

A cancelled question has a neutral decision and no disclosure when it has no answer to reveal. The viewer's waiting_control work belongs to the same turn: it pauses live thinking/ticking and duplicate task controls, including the path that has no ComputerCard in the turn payload. Viewer renewals notify the thread only when the waiting turn set changes. Handback restores the original work clock and keeps the same frame/session. R-CARD-06 applies to both paths.

After fixes, rerun the affected question states, both desktop-card paths and the full-column comparison, using the real app entry:

```powershell
npm run look -- owner-question-room owner-question-asked owner-question-typed owner-question-answered owner-question-cancelled owner-question-background owner-question-text card-question-waiting card-question-answered card-question-cancelled card-question-text card-question-typed card-computer-done card-question-key card-computer-waiting card-computer-takeover card-computer-handback card-sheet chat-computer-takeover chat-human-control chat-handback --theme both --width 1120,720,1920x1080
```

## Presence and quiet private transcripts (2026-11-02)

R-UI-74/75/76/77 use the existing real entry, shared tooltip, timeline renderer,
event-line.ts and thread-diff. New scenes: presence-states-sidebar,
presence-hover-action, presence-blocked-stays, presence-waiting-colleague,
transcript-clean, transcript-working, transcript-hover-detail, transcript-time-gap,
event-routine-line, event-routine-opens, event-lines-collapse, sidebar-row-time,
sidebar-group-author. Capture both themes at 1120,720,1920x1080.

Affected consumers: busy-team-thread/up/steps/typing/follow/anchor/hover/room/home,
composer-stop scenes, reply, conversation-running/midnight, handoff-group scenes,
centred-system-events, representative room and Home scenes, search and polish-search
scenes. Generated-image-bill opens work through .message-work, while work-dots and
pending-work now assert one live avatar without a second waiting style or clock.
Quick-question-result checks the same model receipt in message hover actions.

Core contracts: tests/members/test_presence.py distinguishes queued, colleague and
owner waits, checks priority, safe localized labels and seen failures;
tests/members/test_harness.py checks persisted routine targets and readable schedule
receipts. MainEvent::MemberActivity forwards waiting/blocked and the public label;
no RPC or migration is added. Historical plain-text events remain readable without
invented inspection IDs.

Additional calendar target journeys: event-calendar-line and event-calendar-opens
verify the named event opens directly in its existing calendar detail.

```powershell
npm run look -- presence-hover-action presence-sidebar-hover presence-rail-hover presence-blocked-stays presence-waiting-colleague transcript-clean transcript-working transcript-hover-detail transcript-time-gap event-routine-line event-routine-opens event-calendar-line event-calendar-opens event-lines-collapse sidebar-row-time sidebar-group-author --theme both --width 1120,720,1920x1080
```

Owner 2026-11-05 supersedes the notes-1 32px between-message event gaps: receipts now live in collapsed reply detail; shared header hovers open below the face, stay clear of window controls, and show no pointer focus ring. Expanded sidebar hovers show the action, collapsed rails show the name then action.

```powershell
npm run look -- event-routine-spacing --theme both --width 1120,720,1920x1080
```

The multi-reply transcript-hover-detail fixture checks that all reply work controls
share aria-expanded. agent-page.test.ts pins opening and closing from either reply.
centred-system-events retains handoff receipt states; historical and meeting receipts now live in reply detail (owner, 2026-11-05).
Private ordered event containers live inside collapsed reply detail (owner, 2026-11-05)
while reply bubbles retain their reading-width limit.


Review regression coverage (R-UI-79): test_event_readers.py exercises both search
RPCs, repaired historical indexes, model context, voice and Telegram delivery;
test_home.py covers Home and sidebar readers. presence-transcript.test.ts covers
find, highlight, copy and rendered thread selection for all four receipt kinds;
message-search.test.ts covers event-only result snippets. event-lines-collapse
checks the receipt group inside reply work detail; receipts add no gap between bubbles (owner, 2026-11-05). Run it with
event-routine-line, event-routine-spacing, event-calendar-line,
centred-system-events, transcript-clean and the existing search scenes.

```powershell
npm run look -- event-routine-find --theme both --width 1120,720,1920x1080
```

Finding a receipt inside a closed group reveals its disclosure before scrolling
to the selected match, retaining that open group through an unchanged refresh.

```powershell
npm run look -- event-routine-find-group --theme both --width 1120,720,1920x1080
```

## Daily delegation polish (2026-11-03)

R-UI-85..91: fixed sidebar actions, newest window entry, group heading press, copy feedback, isolated drafts, long paste files and bare overlapping room identities. See README daily section for affected existing sidebar consumers and performance assertions.

```powershell
npm run look -- daily-footer-hover daily-footer-marks daily-footer-home daily-press-feedback daily-press-surfaces daily-press-event daily-press-card daily-press-desktop daily-newest daily-folder-heading daily-copy-chief daily-copy-member daily-copy-room daily-copy-setup daily-copy-webhook daily-draft-member daily-draft-room daily-paste-chief daily-paste-room daily-long-draft daily-faces-2-rail daily-faces-3-rail daily-faces-4-rail daily-faces-2 daily-faces-3 daily-faces-4 --theme both --width 1120,720,1920x1080
```

Local unit authorization excludes judge, native, network and providers. Browser fixture evidence remains separate from native and design acceptance.


## First unseen private turn (2026-11-03)

R-UI-96: migration 57 adds nullable unread_from beside member_unread's member key. The first unseen private turn sets it once; read/viewing clears the row. Existing unread rows upgrade with no invented boundary; heard Raphael voice turns remain read. Members list samples boundaries once for all members. No RPC or Rust allowlist change is needed.

The page snapshots the boundary before the existing read/viewing calls clear it, retaining it only for the current visit. A separate keyed line precedes the first visible conversation turn at or after the boundary, outside that turn's HTML. Initial history pages extend backwards until they cover the boundary. A short unread run opens at the bottom; a long one opens with the line 24px below the scroller top. Existing latest navigation remains available. Rooms retain their own unread behavior.

Selected matrix, both themes and widths 1120,720,1920x1080:

```powershell
npm run look -- thread-new-divider thread-new-divider-short thread-new-divider-stays thread-new-divider-return thread-new-divider-latest chat busy-team-thread busy-team-follow send-prompt --theme both --width 1120,720,1920x1080
```

The long fixture covers more than one history page. The short fixture follows a long seen reply, so its scroller must overflow while the unread run fits. The short, arrival, leave/return and latest scenes assert scroll geometry, independent line identity, retained message HTML and no additional members.read on arrivals. Existing busy-team and send-prompt limits remain unchanged. Compare the muted label with adjacent time separators at matching theme/width. Core members and schema tests cover persistence and upgrade; agent-members.test.ts covers visit lifetime and scroll decisions. Existing regenerate tests now exercise the visible menu: eligibility is validated on menu open, so new replies no longer replace an older reply just to change hidden metadata.

## Durable owner inbox (2026-11-03)

R-QUEUE-01 through R-QUEUE-06 refine R-BATCH-01 and R-UI-08. Typed private input
uses migration 58's agent_inbox and existing agent_turns bubbles. No navigation,
settings, queue panel or queue limit is added. Withdraw is the existing retract
action. Stop appends unread queued words and files after the current draft.
CLI acceptance is separate from an answer: queued/steered ends the typed session
silently; a malformed answer still fails. Fast voice, room routing and messaging
remain on their existing paths. Computer replacement is scoped to its owner.

Selected look matrix: composer-send-while-working, composer-queued,
composer-queued-withdraw, composer-queued-stop, owner-addition,
composer-stop-pending, composer-stop-pending-result, room-send-while-working,
send-prompt and send-prompt-slow. Run both themes at 1120,720,1920x1080.
Keep R-PERF-02's existing 120ms/12% limits and R-UI-71's stable node identity.
Compare queued withdraw/action rows with owner-addition and the existing pending
Stop scenes at matching dimensions. See core/tests/agent/test_inbox*.py,
test_steering.py, test_cli_steering.py and app/src/main/pages/agent-stop.test.ts.
Claude and Antigravity input during a turn is unmeasured, so it waits for the
next turn in FIFO order.
```powershell
npm run look -- composer-send-while-working composer-queued composer-queued-withdraw composer-queued-stop owner-addition composer-stop-pending composer-stop-pending-result room-send-while-working send-prompt send-prompt-slow --theme both --width 1120,720,1920x1080
```

### Request ID reuse after settlement (2026-11-03)

R-QUEUE-07 narrows migration 58's request uniqueness to nonterminal inbox rows.
Queued, steering and started duplicates return queued with the existing turn ID;
terminal requests admit a new turn at the FIFO tail, with no cached answer replay.
Restart never replays started work, but its lost request ID can be sent again.
Failed, cancelled and withdrawn requests can also be sent again. Stop and implicit
withdrawal prefer in-flight admissions when that ID also has terminal history.
Cancel before first delivery and a new cancel during retry attachment saving remain effective.

Regression evidence: core/tests/agent/test_inbox_recovery.py covers recovery,
sequential answers, retry outcomes, FIFO placement, in-flight deduplication, the
partial unique index and Stop scope selection; test_message_edits.py preserves
pre-delivery cancellation. Run core/tests/members and core/tests/evaluate, then
the whole core suite with fake brains. No frontend, navigation or rendered scene
changes are needed. The existing composer-queued, composer-queued-withdraw and
composer-queued-stop scenes remain the affected visual consumers.

R-QUEUE-08: while background work runs in a conversation, a typed message with
nothing queued ahead of it, a quick question or a messaging app's message joins
that work when it accepts the text, as before the inbox. test_e2e_worker.py runs
this through a real worker process.

The existing test_retry_turns.py::test_a_colleagues_question_is_answered_while_the_member_is_at_work
also preserves the colleague bypass and verifies that an owner CLI turn waits
for the held conversation lock, then answers after release. It must not wait
for that owner turn while still holding the lock or expect the removed busy reply.

## Long busy conversations and bounded mounting (2026-11-05)

R-PERF-14 through R-PERF-21 separate native latency budgets from deterministic
rendering and reading contracts. `transcript-window.ts` owns the private/room
25/20/100-turn policy and the 300px sentinel margin. Stable keys preserve a reader
across history prepends, capped windows and bottom arrivals. Existing history
before/around paging remains unchanged. A turn contains owner words, reply, work
and cards, so its cold window is smaller than a message-only transcript.

Search indexes loaded wire records and mounts the selected result's surrounding
window before highlighting. Explicit quote jumps, member links and pending-question
bring reveal an unmounted target first; latest restores the tail. Opening an unread
conversation reveals the unread boundary rather than dropping its divider.
Window search and quote-source matching use the rendered Composio projection with
action context; room multi-message parts are projected individually before indexing.
Typing selections inside editable fields never query document selection or message
geometry; message selections retain the existing shared quote pill. Visible slime
occurrences for one member share old-pose reads, new-pose reads and style flushes
instead of forcing layout separately for each avatar.

Mounted finished private/room records retain HTML by wire revision and presentation
dependencies; unmounted HTML entries are released. Roster identity ignores activity-only changes. Bounded Composio and
mention caches avoid repeated projection and regular-expression construction.
Event reads append new turns and refresh only invalidated/active IDs through the
optional `agent.history.list` delta query. Legacy cores retain their ordinary page
response. New query parameters never cross member/conversation scope.

Selected local matrix (both themes; 1120,720,1920x1080):

```powershell
npm run look -- thread-window-open thread-window-earlier thread-window-find thread-window-quote room-window-open room-window-earlier room-window-find room-window-quote thread-window-composio-find room-window-composio-find busy-team-typing busy-team-follow busy-team-anchor thread-new-divider thread-new-divider-latest thread-new-divider-remount thread-new-divider-stays rich-code rich-streaming conversation-chief-up conversation-member-up conversation-room-up composio-readable-result owner-question-pending-page owner-question-brought owner-question-pending-room reply room-reply-send slime-states presence-states-sidebar --theme both --width 1120,720,1920x1080
```

The new window scenes exercise the real entry and native-boundary fixtures with
150 records; earlier scenes retain the same DOM anchor within one pixel, and old
search scenes reveal record 9005 while at most 100 turns remain mounted. Keep all
existing reading scenes available. Compare private/room latest buttons and quote
excerpts at matching themes/sizes; no second window treatment is introduced.

`npm run native -- typing` seeds 150 persisted rich turns and eight isolated fake
members, checks 25 mounted on open, 45 after one prepend and 65 across a core page, types 200 keys at
120ms intervals while seven brains work and four authored multi-message replies
use ordinary pacing. It retains raw Event Timing, long-animation-frame entries
and a 1ms sampled CPU profile under its existing native report directory. This is
offline app reply pacing, not live provider token transport. Native performance, look layout and external judge acceptance are separate; failures stay failures.

Only when recording an old binary, set `RAPHAEL_NATIVE_TYPING_BASELINE=1` to retain
its original mounting policy; remove it for the changed build's strict 25/45/100
guards. Use the same recorder and alert observer for both measurements. The alert
observer inspects changed alerts, coalesced to one frame, so animated slime styles
cannot trigger a document-wide layout scan inside the measurement harness.


Follow-up 2 records all 200 capturing-keydown `performance.now()` timestamps and
both subsequent rAF callback times. `keyToSecondFrame` retains median, p95 and
worst without Event Timing's 16ms censoring; do not subtract a refresh interval.
Keep the older Event Timing fields as a cross-check. The typing raw artifact also
logs per-call rich-scroll measurements and every `agent.history.list` /
`rooms.messages` response's UTF-8 byte size, returned IDs and timed JSON parse.
The recorder reads the response body once and parses it once; decoding/waiting,
byte counting and callback/render work are outside `parseMs`. Both binaries use
the identical instrumentation. Long-thread fixtures use synthetic zh-TW prose.
Compare old/changed builds three times each in alternating order, retaining every
run and the median of the three run statistics, plus per-run free memory and busy
process count (`RAPHAEL_NATIVE_LOAD` is recorded in the native report).

The rich-scroll controller initializes its container metrics at mount and scroll,
then measures at most one retained content anchor per coalesced update. Explicit
quote/search/bring navigation releases queued corrections before choosing its
new destination. Latest-button visibility uses an IntersectionObserver on the
end marker; only a viewport/stage resize measures its control position. Visible
slime handovers retain JS clocks and finite bridge poses; presence bursts parse
at most one visible cel strip per frame instead of blocking one IPC callback.
Admission compensates loop delay for elapsed time and holds the vector through
that surface's own reveal, so deferred surfaces neither go blank nor all reveal
in the same frame after a presence burst.
Slime mount timestamps are phase metadata, not content identity: private/room
lines, member details, desktop panels and sidebar search must ignore them when
comparing generated markup. Moving between children of one live tooltip target
does not measure that target again. Regression evidence includes
presence-transcript.test.ts, message-search.test.ts and message-tooltip.test.ts.
The rich-scroll listener shares the end observer's cached following state, so
automatic following does not synchronously read container geometry. The private
page invokes forced following only for initial display or explicit follow;
metadata-only reply updates preserve their nodes and do not write scrollTop.
Actual content changes retain one coalesced following/reading correction.
Pending questions measure the viewport only when an asked card is actually mounted.
Finite slime bridges animate native translate/rotate/scale properties, avoiding
per-tick custom-property resolution while retaining the same JS pose clock.
Window scroll callbacks use sentinel intersections to skip position reads far
from either edge; browsers without IntersectionObserver retain the coalesced
position fallback. Cover pending-question bring and old-content reading in the
selected visual consumers after changing these shared observers.
Code highlighting tracks completed blocks; ordinary text mutations and automatic
following do not remeasure untouched offscreen code. Newly mounted code, reading
scrolls, container resize, disclosure and theme invalidation still refresh it.
Diagram theme versions retain token-derived rerendering without repeated style
reads on unrelated messages. Cover rich-code, rich-diagram and rich-source.
Thinking/searching plain bodies and printed marks do not allocate a second body
axis for nonexistent independent marks; animated character marks retain that
axis. The twelve body poses, eye/blink grid, loop periods and phases are unchanged.
Repeated state/drawing geometry uses a 16-entry LRU of inert parsed templates;
each surface gets independent clones and per-instance colour/phase. Do not
reparse identical strips for every member, or retain an unbounded DOM cache.
Pending-question bring invalidates queued rich-scroll corrections immediately
before scrolling the moved card; restoring the target window alone is insufficient.
The native typing window observer starts before earlier-page preparation, so its
maximum includes the 45/65-turn setup as well as typing and reply updates.
Fixed-size clipped slime atlases establish layout/paint containment; motion
periods, sampled poses and the existing visible clipping reserve remain unchanged.
Finite pointer delight and press/release use native translate/rotate/scale,
retaining their angles, durations, easing and reduced-motion cancellation.
Slime visibility uses a zero-margin viewport observer; unseen atlases do not
animate in a preload band. Restoring visibility uses the retained JS phase.
The transcript's independent 300px earlier-page sentinel remains unchanged.
Typing in a composer also closes a sibling sidebar tooltip. Animated pointer
retargets must not reopen or remeasure it until the pointer actually moves;
keyboard focus must still expose the tooltip. Global listeners retain no host.
Small slime atlases keep a 1.5-avatar clipping reserve with the same SVG units
per CSS pixel, loop samples and timing, guarded by sampled accessory-envelope
checks. Cover slime-gallery, slime-parts and
slime-motion-recovery when changing the reserve or cel coordinate origin.
Eye atlases inherit typed pixel-fit scale, offsets and stroke from their shared
parent. The 576 thinking poses must not each carry the vector face's fitting
class. Keep the same pixel formulas, all poses and periods; cover the gallery,
parts, presence hovers and handovers when changing this shared style boundary.
