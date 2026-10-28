# Raphael feature map

Use [the verification workflow](../SKILL.md) first. Commands run from `app/` and
request both themes; local UI handoffs select affected scenes at 720/1120/1920x1080.
Reserve the full scene matrix for integration/release acceptance, CI, explicit
requests or genuinely app-wide changes. Shared components select representative
affected consumers rather than unrelated features. Scene definitions in `app/scripts/look/scenes/`
are the executable source: 307 scenes, 1842 combinations across both themes and
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
