# Raphael feature map

## Sidebar redesign (2026-10-30)

One fixed 296px sidebar contains Home brand, permanent conversation search, plus,
chief, collapsible member folders, group chats, dictation and owner/account settings.
Below 860px the same list opens in a menu drawer, with Escape/scrim dismissal and
focus containment. Team route/canvas are removed. Settings > Connections owns apps;
Home mini calendar owns full calendar navigation. Owner avatar upload reuses the
existing picker/crop component and presets; footer and owner messages share identity.

Selected acceptance: sidebar, sidebar-folders, sidebar-folded, sidebar-many,
sidebar-unread, sidebar-drawer, sidebar-search, sidebar-plus, sidebar-group-avatar,
sidebar-owner, sidebar-owner-preset, sidebar-owner-upload, sidebar-everyone, chat, details, profile, plugins-installed,
all home-* scenes (including full/sparse/empty, edge-only hover and month gestures), both themes at 1120,720,1920x1080,1280x800.
Run `npm run verify -- --core`, then the selected look matrix and inspect every
contact sheet/relevant full-size image. Native readable-layout, locale-sweep and
delete-conversation cover navigation in an isolated fake-brain app. No judge,
OpenRouter or Claude session search; one heavy process at a time.


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
build, one heavy process at a time. The owner prohibits judge and paid/live requests
for this round; report those as SKIP, not design or provider acceptance.

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
$env:RAPHAEL_MODELS_DIR = 'D:/Documentation/github_repos/Raphael/.worktrees/.test-models'
npm run native -- skill-growth readable-layout locale-sweep voice-conversation delete-conversation
```

Keep one heavy process at a time and Vitest at --maxWorkers=2. The owner explicitly
prohibited design judge for round 8; record SKIP instead of design acceptance.

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
| [Member computer](member-computer.md) | Optional Docker sandbox, curated tools pinned outside the plugin cap, shared/per-bot tools without per-action approval, outward-action approval contract, owner-control lease, in-conversation live desktop and native fake-brain journey |
| [Members](members.md) | Identity, resources, voice, the primary contact's star and its chooser, Raphael's approved sidebar administration, and the right click that opens the ⋯ menu of any row (R-UI-44) |
| [Automations](automations.md) | Home-owned day/week calendar, schedules, advanced options and deletion |
| [Group chats and folders](team-and-rooms.md) | Sidebar folders, Everyone room, group identity and mentions |
| [Dictation](dictation.md) | Overview, history, dictionary, shortcuts, microphone and paste |
| [Settings and appearance](settings-appearance.md) | Profile/preferences, skins, languages, models and app information |
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
also need the maintainer live matrix; API-only nightly coverage cannot establish CLI
subscription acceptance. See the parent skill's Guardian hand-off gates and
GUARDIAN-NOTES.md for commands, evidence, budgets and explicit SKIP states.

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
The existing long-choice two-column audit applies to skins, not dictionary entries.

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
| Settings and appearance | locale-sweep drives every locale/settings section. Planned settings-restart: change theme/skin/model/mic/preferences and restart; assert device/core persistence and window behavior; fake brain. |
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
npm run look -- home home-empty home-many home-motion chat details details-closed member-text room-text no-naming sidebar dictation-overview dictation-history dictation-dictionary profile appearance models dictation agent messaging data about plugins-installed plugins-store skins usage automations-calendar onboarding --theme both --width 1120,720,1920x1080,1180x780,1280x800
```

Home, dictation, thread-measure, settings-alignment, sidebar-shell and welcome
checks extend the ordinary scenes. Details checks pointer focus before separately
exercising keyboard focus. The retired first-bot scenarios are replaced by no-naming.
This is local acceptance; the full CI matrix remains 330 scenes x six combinations.

Evidence for this owner round: main pages run-mIz8sb (280/280), corrected settings/
dictation edges run-vpwfKi (40/40), interactions run-W6Lm8f (78/90, twelve spatial
wrapper audit false positives) superseded by run-TPWObt (12/12). All contacts and
relevant full-size images were inspected, including mockup and component pairs.
Final verify-uDt0V9 passes 2412 tests. Final native run-ux8wg1 passes locale-sweep,
voice-conversation and delete-conversation with the worktree debug build; WAV/local
ASR and fake brain only. Judge was not run under the owner's explicit instruction.
The complete command/evidence record is OWNER-ROUND-4-NOTES.md in the worktree.

## Owner round 5 acceptance

The historical Team Fit/card checks below were retired with the canvas on
2026-10-30; sidebar-shell now covers chief and folder rows. The details scroll container owns the single horizontal inset.
Compact conversation headers show identity once; caption/identity lines cannot
flex-shrink. Shared checks cover these contracts in browser and native WebView.
The owner's specific 1920 half-line clipping was not reproduced on the baseline;
the full-line guard passes before and after and is preventive coverage only.

Main-page run-KddPl2 passes 296/296 cells: 37 scenes, both themes, widths
1120,720,1920x1080,1280x800. All 19 contact sheets and relevant full-size images
were inspected. verify-KjxZq8 passes tsc, 2413 tests and contrast. Native
readable-layout fails on the previous debug binary (run-Z7BaV5) and passes after
an offline worktree-local debug build; run-TtwBye passes readable-layout,
locale-sweep, voice-conversation and delete-conversation (4/4).

The requested npm judge command exits 2 because this branch does not support
--brain. A read-only invocation of the existing native-worktree subscription
judge, explicitly rooted at this worktree with both supplied references, exits 1
in judge-r7fb_vri: Claude reports ECONNREFUSED, no design feedback is returned,
and OpenRouter requests remain zero. Design acceptance remains unverified.
There are no received findings to accept or reject. Exact commands, inspected
images and the replay script are recorded in OWNER-ROUND-5-NOTES.md.

## Owner round 6 contracts

Owner round 6 keeps the existing 330 scenes. Affected-scene acceptance adds 1280x800 to both themes at 1120,720,1920x1080. The shared checks below extend existing journeys; they do not introduce another harness. Details overlays have a click-to-dismiss scrim; model/source labels wrap fully; explicit Fit restores one automatic group column. See OWNER-ROUND-6-NOTES.md for commands, evidence and native/judge limits.


## Memory growth native acceptance (phase 2, 2026-10-29)

`memory-growth` sends 25 turns in the real isolated app with the fake brain,
checks turn-one recall on turn 25 and a member-written memory in only that
member home. Its implementation and selected memory-pane scenes are mapped in
[Members](members.md). This is separate from live provider and design-judge acceptance.

## Owner round 7 contracts

Owner round 7 extended the affected journeys with home-lead-width, onboarding-abilities-hero, details-quick-once and conversation-scroll-edge. The sidebar decision replaces sidebar-count-alignment and team-card-lines with sidebar-shell and group-avatar checks. calendar-chips requires two title lines and a visible fixed 20px avatar without time overlap. Run the selected scenes in both themes at 1120,720,1920x1080,1280x800. Judge is intentionally left to the owner for this handoff.


## Connect and Docker acceptance (2026-10-30)

The current matrix has 351 scenes and 2106 combinations. CI groups three images
per judge request, with an admission limit of 702. This local brief prohibits judge
and OpenRouter; it selects only the affected connections and member-computer scenes.
See member-computer.md and connections-mcp.md for the lifecycle and native steps.
The host adapter is the sole OS-specific Docker launch boundary. Native catalog
journeys disable the computer adapter, so they cannot start Docker incidentally.

The additional OpenRouter owner report uses the existing settings/quick/member
chooser scenes and the explicit native `model-picker` journey. See
settings-appearance.md for model identity, effort, price and fake-provider boundaries.
Only a public model-list read is authorized; no paid OpenRouter request is accepted.
