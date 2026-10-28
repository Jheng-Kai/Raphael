# Raphael feature map

Use [the verification workflow](../SKILL.md) first. Commands run from `app/` and
request both themes; local UI handoffs select affected scenes at 720/1120/1920x1080.
Reserve the full scene matrix for integration/release acceptance, CI, explicit
requests or genuinely app-wide changes. Shared components select representative
affected consumers rather than unrelated features. Scene definitions in `app/scripts/look/scenes/`
are the executable source: 322 scenes, 1932 combinations across both themes and
1120, 720 and 1920x1080. Explicit viewport heights use the shared `options.heights`
parser; a plain width retains the default 900px height. Native journeys cover
behavior the fixture cannot prove.

| Feature | User-facing scope |
| --- | --- |
| [Home](home.md) | Startup overview, pending work, reports, calendar, usage and dictation totals |
| [Conversation](conversation.md) | Threads, details panel, replies, progress status, search, composer and the cards a task pauses on (an app, a key, the owner's turn at the computer, the owner's yes) and an email draft they edit and send |
| [Members](members.md) | Identity, resources, voice, the primary contact's star and its chooser, Raphael's approved team administration, and the right click that opens the ⋯ menu of any row (R-UI-44) |
| [Automations](automations.md) | Home-owned day/week calendar, schedules, advanced options and deletion |
| [Team and rooms](team-and-rooms.md) | Grouped board, member navigation, rooms and mentions |
| [Dictation](dictation.md) | Overview, history, dictionary, shortcuts, microphone and paste |
| [Settings and appearance](settings-appearance.md) | Profile/preferences, skins, languages, models and app information |
| [Connections and MCP](connections-mcp.md) | Connected apps and their count, the sidebar's connected-apps entry, an app's accounts and tools, members' private skills, managed store, MCP setup/discovery and Home's private Google calendar read |
| [Usage](usage.md) | Spend overview, grouping, CSV and CLI allowances |
| [Onboarding](onboarding.md) | First launch, first Bot choices and confirmed profile |

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
| `--layout-card-min/max` | 9 / 12 spaces = 288 / 384px | Home auto-fill grid; short cards, totals, store cards and calendar events |
| `--layout-reading-max` | 20 spaces = 640px | History, shared lists, settings control rows, connected apps, conversation thread/composer and routines |
| `--layout-page-max` | 3 card maxima + 2 grid gaps + 2 page gutters = 1264px | Ordinary pages and the calendar's own container |
| `--layout-workspace-max` | 55 spaces = 1760px | Spatial team workspace; its member cards still obey the short-card cap |

The word minimum rounds the previous 220px track to seven existing spaces. Its
ten-space cap leaves room for a short term and its actions. A twelve-space card
holds a compact summary; a twenty-space reading column holds about forty CJK
characters at the existing 15px body type size. Three capped cards plus
existing gutters set the ordinary page measure. The spatial workspace keeps its
previous 1760px capacity, expressed on the same scale.

Available width may shrink any measure. Home's report is the first, widest element,
spanning its card grid within the page measure; its prose keeps the reading cap.
The six capped summary cards fill one, two or three columns, with no orphan last
card in a multi-column row or full-width summary stacking breakpoint.
The 1200px page interior fits three cards and two gaps; four minimum-width cards
would need 1224px. Every possible column count therefore divides the six summaries.
Charts/heatmaps contain multiple data columns rather than short
list items; their enclosing page is capped, while totals and shortcut cards retain
the card cap. Team groups are containers of several independently capped member
cards, not individual short items. The canvas and calendar have their own containers;
Settings retains its existing 1000px modal, with shared lists/apps capped inside it.
The shared `.cs-list` cap also covers capability rows reused outside the `.cs` host.

The look runner invokes `checkRendered("content-width")` on **every main-entry scene**
after its interactions (overlay entry is separate). It measures rendered border boxes,
including list rows and offscreen items in a visible scrolling page, and records the
limits and all measurements in `report.json`. Explicit team pan/zoom is normalized
to layout size so 50/100/150% does not masquerade as responsive stretching. Hidden
pages are excluded. A 1px tolerance covers fractional layout rounding. Limits are
calculated from the spacing tokens, not copied from a potentially stretched element.
Home also requires its hero to precede and span the grid, and every summary row to
fill the same number of columns. The lead is a page-level element, not a short card.
The existing long-choice two-column audit applies to skins, not dictionary entries.

Representative main-page acceptance (all consumers of the shared layout):

```powershell
npm run look -- home home-empty home-720 home-many home-motion chat details details-routines team team-crisp-50 team-crisp-100 team-crisp-150 dictation-overview dictation-history dictation-history-day dictation-dictionary dictation-keyboard profile appearance models dictation agent messaging data about plugins-installed plugins-store usage automations-calendar automations-day automation-weekly --theme both --width 1120,720,1920x1080
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
| Conversation | locale-sweep, voice-conversation, delete-conversation; drive locale/composer/sidebar, real member consultations and room reports, delete recipient conversations/source member; reject old rows/date/exchange chrome in replacement defaults and new named threads, compare actual history IPC with read-only production SQL and NULL conversation rows; native fake brain. Planned conversation-cards: approvals, attachments, Stop and reconnect; fake or signed-in Codex CLI. |
| Members | delete-conversation creates/deletes members through UI and checks orphan exchange rows/deleted source names. Planned members-persistence: edit/hide/duplicate/primary/resources/voice and right-click menus, restart; assert member/resource/primary state and shared agent path; fake brain, Codex CLI for administration. |
| Automations | Planned automations-worker: create/edit/delete schedule, trigger worker, cancel/restart; assert schedule, task and report persistence and no late writes; fake brain. |
| Team and rooms | locale-sweep visits team; delete-conversation creates a room, mentions Raphael/member, waits for reports/wrap-up and checks room rows stay out of private history. Legacy quarantine rows cannot be created through current UI and are not fabricated. Planned rooms-routing: group management and stop; assert routing and cancellation; fake brain, Codex CLI for reasoning. |
| Dictation | locale-sweep visits all tabs; voice-conversation uses WAV/local STT. Planned dictation-paste-learning: injected hotkeys in an isolated target, microphone/WAV, paste and correction; assert target text, history, dictionary learning and overlay focus; fake brain/local STT. |
| Settings and appearance | locale-sweep drives every locale/settings section. Planned settings-restart: change theme/skin/model/mic/preferences and restart; assert device/core persistence and window behavior; fake brain. |
| Connections and MCP | gmail-connect (explicit opt-in only): ask/connect card, assert final state/error and redacted CLI event/stderr diagnostics in the run log; configured signed-in Codex model, run-local workspace/state, fake API clients, declared Composio only, stop at authorizing without Google consent approval. Restricted-network failures before a card are not OAuth acceptance. Planned MCP lifecycle/permissions/private skills: assert discovery and real tool gates; local fake server/CLI. |
| Usage | Planned usage-ledger: complete/cancel local fake turns, open grouping/export and allowances; assert SQLite totals, CSV and CLI status classification; fake brain, signed-in Codex CLI for allowance acceptance. |
| Onboarding | Planned onboarding-native: empty data, complete profile/ability steps, hotkey practice and speech exercise, restart; assert completion gating and persisted first-run choices; fake brain/local STT. |
