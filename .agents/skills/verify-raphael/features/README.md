# Raphael feature map

## Responsive member computer (2026-11-04)

See [Member computer](member-computer.md#responsive-computer-tools-2026-11-04)
for R-COMP-PERF-01 through R-COMP-PERF-06: 45-second preflight confirmation,
bounded targeted reads, browser_open, resource/image limits, cancellable timed
reads and the full offline offer. The brief requires fake-only checks and forbids
Docker, network, look and native. Exact Linux 0.37.0 schema capture and real
container timing remain unverified; compatibility definitions disclose provenance.

## Pending questions and readable Composio results (2026-11-04)

See [Conversation](conversation.md#pending-conversation-questions-and-readable-results-2026-11-04)
for R-OWNER-03, R-CARD-09/10, page-independent pending questions, the existing
bring RPC in private/room scope, one-line permission labels and readable result
projection. The selected seven new scenes and representative shared consumers
are listed there. Follow-up 2 authorizes the selected look matrix and visual review; native and
live-provider acceptance remain deferred. Judge requires external references and
authorized network access.


## Startup room recovery (2026-11-04)

See [Startup rooms](startup-rooms.md) for R-PERF-13, failed first-read recovery,
subscriber readiness replay, manual first-show protection and the twenty-launch
native journey. Offline tests do not establish native before/after acceptance;
the integrator retains normal/slow counts and pre-first-show suspension evidence.

## Delegated work and run endings (2026-11-04)

See [Work truth](work-truth.md) for R-WORK-06 through R-WORK-15: private/exchange history, earlier files, local commands, task recovery, existing room posts, search cooldowns, CLI progress, routine steps and capability inventory. This core-only unit uses offline tests; no UI, native or live-provider acceptance is implied.

## Idle native runtime (2026-11-04)

See [Idle native runtime](idle-runtime.md) for R-PERF-09 through R-PERF-12:
computer status/leases, blocking hotkeys, suspended main webview and off-thread
floating-control cursor sampling. This scoped unit uses fake core tests and
offline Rust/frontend checks. Its brief defers look, judge and native journeys
to integration; those boundaries remain unverified here.

## Quiet idle and visibility (2026-11-04)

See [Performance](performance.md) for R-UI-99/100 and R-PERF-03 through R-PERF-08,
the affected scene selection, hidden-window polling and native visibility boundaries.

## Three computer levels (2026-11-02)

See [Member computer](member-computer.md#three-computer-levels-2026-11-02) for
R-COMP-3-01 through R-COMP-3-04, the selected matrix and replaced scene contracts.

## Owner polish (2026-11-01)

See [owner-polish.md](owner-polish.md) for R-MP-01 through R-MP-06 and their selected matrix.

## Calendar navigation review (2026-11-01)

See [Automations](automations.md#calendar-navigation-review-2026-11-01). Scenes: calendar-remember, calendar-view-reload, calendar-week-fit, calendar-today-controls, both themes at 1120,900,720,1920x1080,480. The date lives only in the page instance; view choice survives reload. Seven columns use the actual calendar width, with a dated fallback only below 520px.

## Calendar rhythms and Composio readings (2026-11-01)

See [Automations](automations.md#calendar-rhythms-and-composio-readings-2026-11-01)
and [Home](home.md#calendar-rhythm-2026-11-01). Selected scenes:
calendar-rhythm-week, calendar-rhythm-day, calendar-rhythm-month,
calendar-rhythm-popover, calendar-rhythm-hidden, home-calendar-rhythm,
automations-google-composio, automation-window, automation-window-menu,
automation-window-saved, automations-calendar, automations-all-day,
automation-edit, details-routines and home-own-events. Run both themes at
1120,720,1920x1080. Fixtures do not prove network, live/provider, cargo,
native-journey or judge boundaries.
## Work channels, file restore and private login (2026-11-01)

See [Member computer](member-computer.md#work-channels-file-restore-and-private-page-login-2026-11-01) for the selected
13-scene matrix, shared-component comparisons, privacy/gate tests and acceptance
boundaries.
## Member media and datasets (2026-11-01)

See [Conversation](conversation.md#member-media-2026-11-01) for explicit paid model
selection, image-only choices, work-step billing, repair and CLI/API/background consumers.
See [Member computer](member-computer.md#named-datasets-2026-11-01) for datasets.
The selected media matrix and its shared-component comparison scenes are listed there.

## Connected-app event routines (2026-11-01)

See [Automations](automations.md#connected-app-event-routines-2026-11-01).
Conversation routine tools accept when instead of schedule; existing member
routine rows/editors show the condition, check/fire times and existing switch.
Selected scenes: routine-event-row, routine-event-edit, routine-event-saved,
routine-event-missing, routine-event-reconnect, routine-event-profile,
details-routines and automation-edit. Use both themes at
1120,720,1920x1080.

## Owner-PC commands (2026-11-01)

See [member-computer.md](member-computer.md#owner-pc-commands-2026-11-01) for the
shared command setting, first consent, subsequent approvals and background job gate.
Selected scenes: local-command-consent, local-command-later,
local-command-background, local-command-once, local-command-always,
local-command-never, local-command-deny, local-command-manage,
local-command-settings, local-command-setting-always, local-command-setting-never
and the existing local-permission-card consumer. Run both themes at
1120,720,1920x1080.

## Mascots and the composer (2026-10-31)

Members are slimes drawn in code (`app/src/main/slime.ts`), not pictures: one body plus colour, costume and a
seasonal hat by date (Halloween and Christmas weeks). A member's `avatar` is `slime:<id>`; a member without a
picture gets a colour from its id; the owner's own pictures and presets still win. Raphael keeps his emblem.
Idle slimes stand still; motion in other states says what they are doing (`slime.css`, see [Members](members.md#how-a-slime-moves-and-why-it-stays-sharp));
all of it stops under reduced motion. The picture menu shows them bareheaded so a costume stays visible.
The composer is the words above a bar: plus attaches a file at once, a named control sets the action policy, and
the open conversation's model sits beside send (`composer-brain.ts`). Groups have no model control.

```powershell
npm run look -- chat member-brain-saved member-avatar sidebar-group-avatar --theme both --width 1120,720,1920x1080
```

## Rich replies (2026-10-30)

One parser in `message-content.ts` returns ordered text, table, code, diagram and
image blocks for chief, member and group replies, stored/streamed content, search
and copy. Text keeps the round 10 authored bubbles; rich cards are siblings outside
bubbles. Owner content stays plain with its existing collapse. Tables wrap first,
copy as TSV and preserve Markdown in whole-reply copy. Code scrolls locally, never
executes, and loads only eight small highlighting grammars when needed. Mermaid
loads on demand with strict security, SVG labels, no directives, HTML, clicks or
external resources. Invalid/unclosed diagrams retain escaped source with a quiet
note. Source, copy and expand use shared controls and dialogs. Colors derive only
from theme tokens, including a future black palette. Markdown images initially
have no src; only Load image assigns a source, always without a referrer.

```powershell
npm run verify -- --core
npm run look -- rich-chief rich-member rich-room rich-code rich-diagram rich-source rich-expand rich-image rich-image-loaded rich-table-example rich-invalid rich-streaming rich-sequence rich-class rich-state rich-er rich-architecture rich-wide-table reply-split-bubbles conversation-chief-up conversation-member-up conversation-room-up long-owner long-owner-expanded long-room-messages chat --theme both --width 1120,720,1920x1080
```

Native regression: `npm run native -- rich-content` reads a synthetic persisted
reply from the existing history store, verifies the same rendered checks at all
three widths and retains source/expanded captures. It makes no provider request
and leaves Markdown image consent unclicked. Build offline with two Cargo jobs;
copy the completed binary immediately and select it with RAPHAEL_NATIVE_BINARY.

Inspect every contact sheet and full-size table, code, diagram, source, image and
expanded dialog. Compare rich controls with link/media cards and shared dialogs at
the same theme/width. The rendered rich-* checks reject page overflow, rich cards
inside bubbles, active SVG content and image requests before consent; the runner
records consented image referrer headers. Parser tests cover alignment, code pipes,
unclosed fences, cut tables and escaped cells. Diagram tests enforce strict settings
and fail-quietly behavior. The shared doctrine advertises blocks to every brain;
offline core verification does not establish live provider acceptance. One heavy
process at a time, Vitest maxWorkers=2, explicit process checks, and shared Python
apply.

## Sidebar redesign (2026-10-30)

One 296px sidebar has no brand: a collapse icon and a plus share the top row, with a
standing search box below. It collapses to a 72px rail of faces (hover names a face; the plus moves
above the owner). The chief, without a star, is the first ordinary row; any pinned member leaves the
rows for a larger centered face above its name at the top, over one continuous list of member rows and unframed group face grids (up to four faces).
Only owner-created folders have headings; their chevrons appear on hover. Times
appear on hover, and current-page selection remains unique. The footer is a Notion-like list without a
separator: a dictation row above the owner's face and name, which open Settings, beside a square Home. Native `owner-face`
proves a window that loaded before the core still hears it and shows the saved photo.
Groups are the owner's own: there is no everyone entry, and an empty former team room is not listed.
Below 860px the same list opens in a menu drawer, with Escape/scrim dismissal and
focus containment. Team route/canvas are removed. Settings > Connections owns apps;
Home mini calendar owns full calendar navigation. Owner avatar upload reuses the
existing picker/crop component and presets; footer and owner messages share identity.

Selected acceptance: sidebar, sidebar-folders, sidebar-folded, sidebar-many,
sidebar-unread, sidebar-drawer, sidebar-search, sidebar-chief-pinned, sidebar-rail, sidebar-plus, sidebar-group-avatar,
sidebar-group-avatar-pair, sidebar-group-avatar-four, sidebar-owner, sidebar-owner-upload, chat, details, profile, plugins-installed,
all home-* scenes (including full/sparse/empty, edge-only hover and month gestures), both themes at 1120,720,1920x1080,1280x800. Home's emblem is 128px (96px compact), its report is --fs-h1 and its date is unchanged. Check these scenes in black at 1120,720,1920x1080 too.
Run `npm run verify -- --core`, then the selected look matrix and inspect every
contact sheet/relevant full-size image. Native readable-layout, locale-sweep and
delete-conversation cover navigation in an isolated fake-brain app. No judge,
OpenRouter or Claude session search; one heavy process at a time.

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
Composio, Gmail, OpenRouter, judge or live verification was exercised.


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
monitor's horizontal center, 16 px above its taskbar. It expires after five seconds
without hover. The ordinary overlay remains click-through. Fixture pill evidence
does not establish native hit-testing, positioning, paste or persistence.

`stable-click` records the clicked view control and persistent content above it,
then rejects position/size changes over 1px after settling. Normal look clicks on
tabs, switches, pressed filters, Settings panes and view controls automatically use
it (sidebar and Home excluded). Explicit scenes cover
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


## Owner round 9 contracts

Home paints local records before live allowances and calendar data. Four fixed equal
summary blocks and a full month calendar retain their geometry in empty, sparse and
full states. Every whole block navigates, including keyboard operation, while inner
report controls retain their actions. See [Home](home.md). Day/week working hours
fit the viewport below a pinned all-day row; see [Automations](automations.md).
Owner/member/room messages share eight-line faded previews and the existing
expand-message control, without inner scrolling. CLI envelope parsing is shared by
normal, quick, resumed, failure, room and background routes; see
[Conversation](conversation.md). The ordinary orb has no Stop; focused double-Escape
and permission/question actions remain. See [Dictation](dictation.md).

Native readable-layout includes Home, compact week/day and long owner expansion;
home-timing measures stored allowance first paint before a two-second offline CLI
transport. Run these with self-diagnosis and memory-growth after an offline debug
build, one heavy process at a time.

## Owner round 8 contracts

Details controls, including the shared brain picker, fill the same panel content width.
The conversation mask has a fully transparent top band before its fade in both themes.
Home wraps its report at CJK sentence boundaries. Owner round 9 supersedes the old
Today/stat arrangement with four fixed equal blocks and a mini calendar. Compact dictation
orders totals, activity, then a column-filling shortcut card; that card is a page-level
overview section, exempt from the generic short-card cap, with exact column alignment
checked by dictation-overview. Conversation toasts reserve the bottom composer's space; when
details are open, the shared toaster also reserves the panel's responsive width,
including for long or stacked notices. They never cover resource/conversation rows
or the composer. Learned-skill
notices follow the producing reply; member skills and memory provenance use formatDate
from format.ts, with explicit zh-TW, ja and en expectations.

The existing details-alignment, conversation-scroll-edge, home-lead-width,
dictation-overview, dictation-layout, skill-learned-notice and growing-skills checks
cover these contracts. toast-clearance covers quick-cleared, composer-learn,
conversation-delete-main and member-delete. Native deletion audit uses the same
rendered clearance check at every member checkpoint. Native skill-growth rejects a
notice before its producing reply and checks the learned skill's Chinese date.
No brain, tool, core or Rust behavior changed.

```powershell
npm run verify
npm run look -- details member-conversation-sections connector-reconnected home-empty home-many dictation-overview quick-cleared member-text details-skills raphael-skills details-memory global-private-memory centred-system-events composer-learn conversation-delete-main member-delete --theme both --width 1120,720,1920x1080
npm run look -- home-many quick-cleared --theme both --width 1280x800
$env:RAPHAEL_MODELS_DIR = '<a folder holding the local speech models>'
npm run native -- skill-growth readable-layout locale-sweep voice-conversation delete-conversation
```

Keep one heavy process at a time and Vitest at --maxWorkers=2.

Use [the verification workflow](../SKILL.md) first. Commands run from `app/` and
request both themes; local UI handoffs select affected scenes at 720/1120/1920x1080.
Reserve the full scene matrix for integration/release acceptance, CI, explicit
requests or genuinely app-wide changes. Shared components select representative
affected consumers rather than unrelated features. Scene definitions in `app/scripts/look/scenes/`
are the executable source: 351 scenes, 2106 combinations across both themes and
1120, 720 and 1920x1080. Explicit viewport heights use the shared `options.heights`
parser; a plain width retains the default 900px height. Native journeys cover
behavior the fixture cannot prove.

| Feature | User-facing scope |
| --- | --- |
| [Home](home.md) | Startup overview, pending work, reports, calendar, usage and dictation totals |
| [Conversation](conversation.md) | Threads, details panel, replies, progress status, search, composer and the cards a task pauses on (an app, a key, the owner's turn at the computer, the owner's yes) and an email draft they edit and send |
| [Member computer](member-computer.md) | Optional Docker sandbox, curated tools pinned outside the plugin cap, shared/per-bot tools without per-action approval, outward-action approval contract, owner-control lease, side-panel live desktop and native fake-brain journey |
| [Members](members.md) | Identity, resources, voice, the primary contact's star and its chooser, Raphael's approved sidebar administration, and the right click that opens the ⋯ menu of any row (R-UI-44) |
| [Automations](automations.md) | Home-owned day/week calendar, schedules, advanced options and deletion |
| [Group chats and folders](team-and-rooms.md) | Sidebar folders, Everyone room, group identity and mentions |
| [Dictation](dictation.md) | Overview, history, dictionary, shortcuts, microphone and paste |
| [Settings and appearance](settings-appearance.md) | Profile/preferences, black and white themes, languages, models and app information |
| [Connections and MCP](connections-mcp.md) | Connected apps and their count, Settings-only connected-app entry, an app's accounts and tools, members' private skills, managed store, MCP setup/discovery and Home's private Google calendar read |
| [Usage](usage.md) | Spend overview, grouping, CSV and CLI allowances |
| [Onboarding](onboarding.md) | Welcome, optional setup and immediate conversation |

Keep entry points, prerequisites and observable end states current. If data is
missing, add it at the existing fixture boundary or report the failure; do not drop
the journey. Native/manual steps remain pending until exercised. This map alone is
not verification proof: a run's report and images are.


## Repository Guardian coverage

All feature scenes participate in the three-size, two-theme look matrix. Each scene's
entry above is included with judge rules in the design review prompt. Product and
architecture rule references run through normal Vitest/pytest. Brain/tool changes
also need the live matrix; API-only nightly coverage cannot establish CLI
subscription acceptance. See the parent skill's Guardian hand-off gates.

## Content width

Owner item 9 (2026-10-28), R-UI-45: no page becomes a stripe at any window size.
`styles.css` owns the content measures, derived from the existing spacing scale
(`--sp-6 = 32px`, `--sp-5 = 24px`). They do not grow with viewport width:

| Token | Measure | Consumers |
| --- | --- | --- |
| `--layout-word-min/max` | 7 / 10 spaces = 224 / 320px | Dictionary auto-fill grid; a sparse grid keeps empty tracks |
| `--layout-card-min/max` | 9 / 12 spaces = 288 / 384px | Short cards, totals, store cards and calendar events |
| `--layout-reading-max` | 20 spaces = 640px | History, shared lists, aligned settings panes, connected apps and routines |
| `--layout-thread-max` | 28 spaces = 896px | Raphael/member/room threads and composers; outer sidebar group column |
| `--layout-page-max` | 3 card maxima + 2 grid gaps + 2 page gutters = 1264px | Ordinary pages and the calendar's own container |
| `--layout-workspace-max` | 55 spaces = 1760px | Spatial sidebar workspace; its member cards still obey the short-card cap |

The word minimum rounds the previous 220px track to seven existing spaces. Its
ten-space cap leaves room for a short term and its actions. A twelve-space card
holds a compact summary; a twenty-space reading column holds about forty CJK
characters at the existing 15px body type size. Three capped cards plus
existing gutters set the ordinary page measure. The spatial workspace keeps its
previous 1760px capacity, expressed on the same scale.

Available width may shrink any measure. Home uses a 1080px page (including 40px
gutters), a borderless full-grid emblem/date/headline lead, two rows of two equal
blocks, then an adaptive six-week month (owner refinement, 2026-10-30). Blocks retain size and position for
empty/sparse/full data, including at 720px. This composition uses page-level
summary containers instead of the generic short-card cap. Short inbox rows remain
reading-capped; checks reject unequal blocks, overflow and a narrow/reordered lead.
The 896px thread measure is 28 existing 32px spaces, adding room for conversation
content while prose keeps 20 spaces. The fixed 296px sidebar holds chief, folders
and group chats; below 860px the same list opens in a 320px drawer. Settings retains its 1000px modal and uses one
640px content measure for every pane header, toolbar, row and grid. Charts and
heatmaps contain several data columns inside their capped containers.

The look runner invokes `checkRendered("content-width")` on **every main-entry scene**
after its interactions (overlay entry is separate). It measures rendered border boxes,
including list rows and offscreen items in a visible scrolling page, and records the
limits and all measurements in `report.json`. Explicit sidebar pan/zoom is normalized
to layout size so 50/100/150% does not masquerade as responsive stretching. Hidden
pages are excluded. A 1px tolerance covers fractional layout rounding. Limits are
calculated from the spacing tokens, not copied from a potentially stretched element.
Home requires its hero to precede and span the grid and both block rows to fill
two equal columns. The lead is a page-level element, not a short card.
Appearance uses the shared theme/language dropdown rows; dictionary entries retain their own grid contract.

Representative main-page acceptance (all consumers of the shared layout):

```powershell
npm run look -- home home-empty home-720 home-many home-motion chat details details-routines sidebar sidebar-folders dictation-overview dictation-history dictation-history-day dictation-dictionary dictation-keyboard profile appearance models dictation agent messaging data about plugins-installed plugins-store usage automations-calendar automations-day automation-weekly --theme both --width 1120,720,1920x1080
```

The dictionary scene uses twelve words to expose column count and wrapping; the
keyboard scene retains the two-word fixture to expose sparse-grid stretching.
Compare same-theme card surfaces between Home/dictionary/store and reading columns
between history/conversation/settings. Unit checks reject the measured 97fa61bd
word (694px) and Home card (618px) geometries; baseline browser evidence must also
show those failures before CSS changes. Native zoom, live data and design judge
remain separate acceptance boundaries.

## Native journey coverage and next assignments

These entries specify the native driver and assertion boundary. Planned journeys
are assignments, not coverage claims. Current executions live in app/.native/run-*.

| Feature | Native journey needed: drive, assert, brain |
| --- | --- |
| Home | Planned home-persistence: start/restart, open report/calendar/pending work; assert real aggregates and navigation against SQLite; fake brain. |
| Conversation | readable-layout checks shared details edges and compact identity; locale-sweep, voice-conversation, delete-conversation; drive locale/composer/sidebar, real member consultations and room reports, delete recipient conversations/source member; reject old rows/date/exchange chrome in replacement defaults and new named threads, compare actual history IPC with read-only production SQL and NULL conversation rows; native fake brain. Planned conversation-cards: approvals, attachments, Stop and reconnect; fake or signed-in Codex CLI. |
| Members | delete-conversation creates/deletes members through UI and checks orphan exchange rows/deleted source names. Planned members-persistence: edit/hide/duplicate/primary/resources/voice and right-click menus, restart; assert member/resource/primary state and shared agent path; fake brain, Codex CLI for administration. |
| Automations | Planned automations-worker: create/edit/delete schedule, trigger worker, cancel/restart; assert schedule, task and report persistence and no late writes; fake brain. |
| Team and rooms | readable-layout checks the fixed sidebar and folded folders on a persisted roster; locale-sweep visits the current main pages; delete-conversation creates a room, mentions Raphael/member, waits for reports/wrap-up and checks room rows stay out of private history. Legacy quarantine rows cannot be created through current UI and are not fabricated. Planned rooms-routing: group management and stop; assert routing and cancellation; fake brain, Codex CLI for reasoning. |
| Dictation | locale-sweep visits all tabs; voice-conversation uses WAV/local STT. Planned dictation-paste-learning: injected hotkeys in an isolated target, microphone/WAV, paste and correction; assert target text, history, dictionary learning and overlay focus; fake brain/local STT. |
| Settings and appearance | locale-sweep drives every locale/settings section. Planned settings-restart: change theme/model/mic/preferences and restart; assert device/core persistence and window behavior; fake brain. |
| Connections and MCP | gmail-connect (explicit opt-in only): ask/connect card, assert final state/error and redacted CLI event/stderr diagnostics in the run log; configured signed-in Codex model, run-local workspace/state, fake API clients, declared Composio only, stop at authorizing without Google consent approval. Restricted-network failures before a card are not OAuth acceptance. Planned MCP lifecycle/permissions/private skills: assert discovery and real tool gates; local fake server/CLI. |
| Usage | Planned usage-ledger: complete/cancel local fake turns, open grouping/export and allowances; assert SQLite totals, CSV and CLI status classification; fake brain, signed-in Codex CLI for allowance acceptance. |
| Onboarding | Planned onboarding-native: empty data, complete profile/ability steps, hotkey practice and speech exercise, restart; assert completion gating and persisted first-run choices; fake brain/local STT. |

## Owner round 3 shared interactions

The conversation, dictation and team/rooms entries map the shared two-step Escape
contract (R-UI-46), deleted-object fallback (R-UI-47), opaque desktop confirmation
(R-UI-48), and recording-only global Escape (R-AG-16). Desktop scenes record their
actual native-sized viewport as well as the requested matrix size; see dictation.
CI's judge request admission limit is 1998 for the 1980 combinations (330 scenes x six), below
the unchanged 2000-request hard cap; the monetary limit is unchanged.

## Owner round 4 acceptance

The designed default is 1280x800 with the 720x480 minimum; every launch opens at it,
centred, and window-state restores nothing. The unspecified look viewport reads the main-window size
from tauri.conf.json. Plain --width entries still use a 900px height. Candidate
comparison covers every main page at 1180x780, 1280x800, 1280x840 and 1366x860 in
both themes. 1280x800 leaves 64 logical pixels for a taskbar on a 1536x864 desktop;
840/860 heights leave only 24/4px. Long Settings catalogs intentionally scroll.

```powershell
npm run look -- home home-empty home-many home-motion chat details details-closed member-text room-text no-naming sidebar dictation-overview dictation-history dictation-dictionary profile appearance models dictation agent messaging data about plugins-installed plugins-store appearance-menu appearance-black theme-clarity usage automations-calendar onboarding --theme both --width 1120,720,1920x1080,1180x780,1280x800
```

Home, dictation, thread-measure, settings-alignment, sidebar-shell and welcome
checks extend the ordinary scenes. Details checks pointer focus before separately
exercising keyboard focus. The retired first-bot scenarios are replaced by no-naming.
This is local acceptance; the full CI matrix remains 330 scenes x six combinations.


## Owner round 5 acceptance

The historical Team Fit/card checks below were retired with the canvas on
2026-10-30; sidebar-shell now covers chief and folder rows. The details scroll container owns the single horizontal inset.
Compact conversation headers show identity once; caption/identity lines cannot
flex-shrink. Shared checks cover these contracts in browser and native WebView.
The owner's specific 1920 half-line clipping was not reproduced on the baseline;
the full-line guard passes before and after and is preventive coverage only.


## Owner round 6 contracts

Owner round 6 keeps the existing 330 scenes. Affected-scene acceptance adds 1280x800 to both themes at 1120,720,1920x1080. The shared checks below extend existing journeys; they do not introduce another harness. Details overlays have a click-to-dismiss scrim; model/source labels wrap fully; explicit Fit restores one automatic group column.


## Memory growth native acceptance (phase 2, 2026-10-29)

`memory-growth` sends 25 turns in the real isolated app with the fake brain,
checks turn-one recall on turn 25 and an entry in only that member's MEMORY.md. Its implementation and selected memory-pane scenes are mapped in
[Members](members.md). This is separate from live provider and design-judge acceptance.

## Owner round 7 contracts

Owner round 7 extended the affected journeys with home-lead-width, onboarding-abilities-hero, details-quick-once and conversation-scroll-edge. The sidebar decision replaces sidebar-count-alignment and team-card-lines with sidebar-shell and group-avatar checks. calendar-chips requires two title lines and a visible fixed 20px avatar without time overlap. Run the selected scenes in both themes at 1120,720,1920x1080,1280x800.

## Connect and Docker acceptance (2026-10-30)

The current matrix has 351 scenes and 2106 combinations. CI groups three images
per judge request, with an admission limit of 702. This acceptance selects only
the affected connections and member-computer scenes.
See member-computer.md and connections-mcp.md for the lifecycle and native steps.
The host adapter is the sole OS-specific Docker launch boundary. Native catalog
journeys disable the computer adapter, so they cannot start Docker incidentally.

The additional OpenRouter owner report uses the existing settings/quick/member
chooser scenes and the explicit native `model-picker` journey. See
settings-appearance.md for model identity, effort, price and fake-provider boundaries.
Only a public model-list read is authorized; no paid OpenRouter request is accepted.

## Theme and computer side panel (2026-10-30)

See settings-appearance.md for the single system/light/dark selector and clarity
evidence. See member-computer.md for the persistent
side-panel noVNC stream, click-to-input timing, nonce handback and Docker journey.
This global-token change authorizes one final --all two-theme/three-size look matrix,
plus black Home/sidebar/chat/settings/calendar/dictionary representatives. Use
RAPHAEL_CORE_PYTHON set to the core virtual environment's python.
One heavy process at a time; check other worktrees with Get-CimInstance Win32_Process
before every heavy step. Vitest uses --maxWorkers=2, native CARGO_BUILD_JOBS=2 and the
shared .worktrees/.target.

## Backend: Sign in with ChatGPT

`@chatgpt:<slug>` uses Raphael's shared guarded API loop. The backend RPC contract
is `chatgpt.status`, `chatgpt.sign_in`, `chatgpt.cancel`, `chatgpt.sign_out`,
`chatgpt.models`. `sign_in` accepts optional `account_id` (empty adds an account),
`enable_plan` (explicit consent) and `timeout_s` (greater than 0, at most 540, default 180).
Status reports signed_in, account_id, email, plan_scope_granted, models,
signing_in and separate saved registrations. Models preserve server ordering and
only visibility=list. Sign-out reports whether remote revocation was confirmed.

The sign-in ends on a page of `core/src/raphael_core/sign_in_page.py` that says what really became of it,
served by the one-shot listener with a strict CSP and no external load. The listener answers only its own
`Host` and path, one state, once. The ID token allows five minutes of clock difference (the owner's PC ran
3 s behind OpenAI, which failed every sign-in and signed the account out at the next renewal). Tokens are
forgotten only for a refresh error OpenAI's docs call terminal. Failures log their step and kind, never a word
the server or the owner sent. The chooser and Settings say `Continue with ChatGPT`, what it means, and why it
stopped; the composer's card says `Using ChatGPT plan` with Manage usage (OpenAI's UI/UX requirements at
developers.openai.com/siwc/ui-ux-guidelines).

Every source is proven by a real turn: `npm run native -- every-source` (the CLIs, on their subscriptions),
`npm run native -- openrouter-turn` (the owner's key, a free model, nothing else paid). ChatGPT needs the
owner's own consent click once; a sign-in in the real app, then one tool round, is its proof.

Offline evidence lives in `core/tests/brain/test_chatgpt.py`: loopback callback,
JWT validation, account separation, rotation-before-use, Responses tool round trip
through NarratedLoop/run_task, gate rejection, terminal stream errors, classified
turn failures, redaction and revocation. Select these core tests plus the existing
provider, worker and architecture consumers, then `npm run verify -- --core`.
No UI/look/judge scope applies. Real sign-in, OS vault/browser, plan inference and
live tool round trips require separately authorized acceptance; fake HTTP is not
live proof. Never run the owner probe or borrow another application's credentials.

## Member computer hosts (2026-11-01)

[Member computer](member-computer.md) maps the per-member default, shared team
folder, local/SSH selection and resource policy. Local UI scope is its 17 listed
scenes in both themes at 1120,720,1920x1080. `computer-host-remote` verifies settings
through the existing shared menu/input; `desktop-frame` now guards a dark frame
and top-right collapse in both themes.

## Missing prerequisites (2026-11-01)

See [conversation.md](conversation.md#missing-prerequisites-2026-11-01) for the shared failure data, localized note, affected scenes and explicit native/judge limits. Rule R-UI-69 rejects reasons held only in a disabled control title.

## Durable owner questions (2026-11-01)

See [Conversation](conversation.md#durable-owner-questions-and-background-cards-2026-11-01)
for ask_owner, background card completion and the selected question-card matrix.


## Owner input, Telegram files and deliverable audio (2026-11-01)

See [Conversation](conversation.md#owner-input-and-deliverable-audio-2026-11-01).
Selected scenes: generated-audio-chief, generated-audio-member,
generated-audio-room, generated-audio-missing, generated-audio-repair and owner-addition.


## CLI failure recovery (2026-11-01)

See [Conversation](conversation.md#cli-recovery-after-recorded-work-2026-11-01)
for shared conversation/background CLI recovery, receipt context, bounded retries,
answered-card continuity and fake-subprocess tests. Core-only; no new UI scene.
## Group and background tool truth (2026-11-01)

See [Members](members.md#group-prompt-truth-2026-11-01) for R-AG-02 roles without
fixed rounds or automatic conclusions, and
[Conversation](conversation.md#background-app-discovery-2026-11-01) for background
find_app, owner sign-in and same-task resumption, plus localized routine events.
This is a core-only contract change; no rendered scene or frontend is changed.
## Passive floating controls (2026-11-01)

See [Dictation](dictation.md#passive-control-hit-regions-2026-11-01) for R-UI-70,
physical hit rectangles, held-button release, revision invalidation and the selected
existing overlay/learned scene matrix. Fixture acceptance does not prove OS clicks.
# Composer discovery (2026-11-01)

[Composer discovery](composer-discovery.md) covers grouped @ and / completion in conversations and team rooms, including enabled skill invocation on API, CLI and background paths.

## Conversation connection management (2026-11-01)

See [Connections/MCP](connections-mcp.md#connections-from-a-conversation-2026-11-01) for the editable proposal, shared secret/local consent cards, dynamic API/CLI/background offers and selected look matrix. R-MCP-CHAT-01/02 extend the existing allow-all and durable owner-card contracts.


## Answer forms (2026-11-01)

See [Conversation](conversation.md#answer-forms-2026-11-01) for R-FORM-01/02, schemas, scene coverage and external-text boundaries.
## Still conversations during team work (2026-11-01)

See [Conversation](conversation.md#still-conversations-during-team-work-2026-11-01) for R-UI-71, the shared keyed line diff, synchronous cached previews, preserved face nodes, bounded event reads and the busy-team scene matrix.

The still-thread review follow-up adds conversation-midnight to the conversation map: shared look clock rollover with unchanged history and retained conversation nodes. Viewing, unread-on-show, core restart and room return are covered by pages/agent-members.test.ts.

## Exchanges and menus (2026-11-02)

R-UI-72: [conversation.md](conversation.md#folded-colleague-exchanges-2026-11-02) and [team-and-rooms.md](team-and-rooms.md#folded-room-receipts-2026-11-02) cover folded colleague receipts. handoff-group-long adds long and unbroken names to the selected matrix.

R-UI-73: [members.md](members.md#menus-beside-their-rows-2026-11-02) covers shared submenu hover, keyboard, diagonal travel, flipping and anchored redraw. Run the selected scenes in both themes at 1120,720,1920x1080.

Review follow-up (2026-11-02): conversation.md and members.md map the single highest-priority group state, CSS list-join spacing, outside scroll-intent dismissal, frozen programmatic placement and resize dismissal. The selected matrix includes all handoff-group and menu scenes plus centred-system-events.

### Shared conversation cards (2026-11-02)

R-CARD-01..75: see the appended shared-card section in `conversation.md` and
`app/scripts/look/scenes/cards.mjs`. The common `card-shell` assertion applies to
new and existing card consumers. Run only the mapped card matrix, both themes,
1120,720,1920x1080; inspect sheets and full-size controls.

R-CARD-05..77: conversation.md also maps exact connected-message previews and the owner review follow-up (localized action titles, meaningful disclosures, one state, per-kind prompt words and one-line credential hints).

Conversation review: R-CARD-07 covers single-call Composio draft projection and localized member/app identity while preserving approval semantics. R-CARD-08 exempts unanswered owner questions from the waiting pill and covers the rightmost Close plus visible empty/typed submit states. See conversation.md for the selected card, question and approval matrix.

R-CARD-06 review coverage also includes neutral cancelled questions without redundant disclosures and viewer-driven computer waits without a second live work line. conversation.md records the selected 21-scene recheck and the unchanged-renewal/same-stream regression tests.

## Slime town and computer preparation (2026-11-03)

See [Member computer](member-computer.md#slime-town-and-computer-preparation-2026-11-03)
for R-UI-92/93/94, deterministic period fixtures, preparation in all three viewing
locations, retained motion and wallpaper-to-stream continuity.

## Daily delegation polish (2026-11-03)

R-UI-85..91: sidebar.ts owns the existing Connections door and inventory marks;
conversation-list.ts owns window-entry ordering, without changing core routing.
member-column.ts keeps heading fold, keyboard, search and drag semantics together.
ui.ts owns copyButton feedback for all existing copy consumers. composer-drafts.ts
persists only words/quotes under raphael.composer.drafts; member and room composers
retain files in memory. attachments.ts intercepts long paste in capture before
mention-field.ts. composer-links.ts preserves full restored URLs and avoids quadratic overlap scans. sidebar.css and automations.css share bare character composites
and the single participant row. No new page, setting, RPC or migration.

Selected look scenes: all existing sidebar.mjs scenes; busy-team-typing;
daily-footer-hover, daily-footer-marks, daily-footer-home, daily-press-feedback,
daily-press-surfaces, daily-press-event, daily-press-card, daily-press-desktop, daily-newest,
daily-folder-heading, daily-copy-chief, daily-copy-member, daily-copy-room, daily-copy-setup, daily-copy-webhook,
daily-draft-member, daily-draft-room, daily-paste-chief, daily-paste-room,
daily-long-draft, daily-faces-2, daily-faces-3, daily-faces-4,
daily-faces-2-rail, daily-faces-3-rail, daily-faces-4-rail.
Each uses both themes at 1120,720,1920x1080. sidebar-selection remains an assertion
in sidebar-rail and daily-footer-home, daily-press-feedback. Composer performance steps retain long-task,
storage-write, field-length and chip-count evidence in the existing look report.
The old footer word alignment and square Home checks now protect sensible name
insets and equal 36px icon actions. The old nonoverlapping round face grid check
now protects bare overlapping clusters, fixed bounds and one header row. The
emblem audit includes composite faces; only sidebar controls have a scoped soft
surface exception to the general transparent icon policy. Service marks are 18px,
and the emblem scales to its composite slot, as explicit owner requirements.

Press feedback follows actual pointer down/up on the real controls, recording
computed colors and fixed bounds. Source audit preserves working default,
primary and calendar states; explicit hover overrides receive a distinct pressed
state. Representative consumers include the sidebar, composer, Home, connections,
calendar, model sources, event receipts, conversation cards and desktop preview. Button surfaces
that delegate painting to their parent are measured with that parent too.

Run npm.cmd run verify and the targeted attachment core tests.

Long draft profiling also covers idempotent drawer close: closing a closed
drawer never steals the destination focus. Unchanged member controls keep focus
without another layout, and newest-page reads skip the earlier-page scroll anchor.
## Motion cost (2026-11-03)

[Members](members.md#motion-cost-2026-11-03) maps R-PERF-01, bounded event reads, sampled loops and the mixed-state main-thread budget.


## First unseen private turn (2026-11-03)

See [Conversation](conversation.md#first-unseen-private-turn-2026-11-03) for R-UI-96, migration 57, visit lifetime, paging, scroll and unchanged-line contracts. Selected scenes: thread-new-divider, thread-new-divider-short, thread-new-divider-stays, thread-new-divider-return, thread-new-divider-latest, chat, busy-team-thread, busy-team-follow and send-prompt, both themes at 1120,720,1920x1080.

## Durable owner inbox (2026-11-03)

See [Conversation](conversation.md#durable-owner-inbox-2026-11-03) for R-QUEUE-01
through R-QUEUE-06 and refinements to R-BATCH-01/R-UI-08. See
[Team and rooms](team-and-rooms.md#send-while-rooms-work-2026-11-03) for the shared
room composer. The send-prompt and send-prompt-slow scenes keep their performance limits.
