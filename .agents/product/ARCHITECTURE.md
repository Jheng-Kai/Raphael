# Raphael architecture and checked boundaries

## ChatGPT plan provider (backend, 2026-10-30)

`@chatgpt:<slug>` resolves through ProviderRegistry to the public Responses API.
It uses the same NarratedLoop, worker loop, production tool definitions and gates
as other API brains. Responses output and encrypted reasoning travel only in the
ephemeral loop/worker continuation, never in public narration or saved history.
HTTP inference requires store=false, stream=true and response.completed; system
instructions become instructions and local function tools share a namespace.

`chatgpt.status`, `chatgpt.sign_in`, `chatgpt.cancel`, `chatgpt.sign_out` and
`chatgpt.models` use the existing Router/core_call allowlist. Sign-in owns a bounded
127.0.0.1 callback with state, nonce and S256 PKCE; OpenAI JWKS verifies signature,
issuer, issued-client audience and expiry before account activation. The existing
settings table stores nonsecret host/client/verified identity registrations only;
each registration has separate vault-only access/refresh/ID tokens. Refresh uses
a per-host Windows mutex and saves the rotating set before use; sign-out attempts
renewable-session revocation and invalidates in-flight results.
Missing plan permission, quota and availability failures stop the selected model;
there is no model/billing fallback or invented remaining-quota meter. Offline
contracts: `core/tests/brain/test_chatgpt.py`. No live OAuth/inference acceptance
is implied. UI is owned separately and has no new scene in this backend change.

## Runtime boundaries

The Windows Tauri shell owns windows, overlay, global hotkeys, audio/paste and the
Python sidecar lifecycle. The TypeScript main window uses `app/src/main/api.ts`
to call the shell's allowlisted commands and `core_call` bridge. The Python core
registers JSON-RPC methods on `Router`; notifications return through the shell's
main/overlay event channels. Shell-only window metadata and hotkey forwarding are
explicit native exceptions, not alternate JSON-RPC clients.

`AgentService` is the shared conversational implementation for Raphael (member 0)
and `Speaker` members. Members store identity/resources/routines; rooms select
recipients and use that same agent. Background services persist tasks and supply
the worker's guarded `run_task` loop. Connectors own account state and scoped MCP
tool availability. Tool snapshots share production definitions and tool gates
remain authoritative at execution. API providers implement `ModelProvider` and
use `NarratedLoop`; CLI subscriptions use `CliLoop` and the single `RaphaelMcp` server.
The evaluator replaces only execution with a recorder, not the loops or schemas.

SQLite (`brain/db.py`, versioned migrations) owns settings, history, members,
rooms, routines, tasks and spend. Attachment and memory stores own bounded file
content. OS credential storage owns secrets; hosted Actions alone may supply an
ephemeral `OPENROUTER_API_KEY` through the evaluator credential adapter. UI fixture
state is synthetic and never proves native persistence or provider acceptance.

Every mechanical row names an executable test. Human rows require architecture
review and are not presented as automatically proven. Settings semantic duplication
and arbitrary hard-coded capability lists require review as well as the narrow
mechanical boundaries below.

| ID | Invariant | Check | Evidence |
| --- | --- | --- | --- |
| A-01 | Member turns use AgentService rather than a second model loop in members or rooms. | pytest | core/tests/architecture/test_boundaries.py::test_members_and_rooms_do_not_create_brain_loops |
| A-02 | Team administration definitions are offered to every speaker alike, Raphael and each member; the chief capability (the unique primary contact, Raphael by default) reserves no tool. | pytest | core/tests/architecture/test_boundaries.py::test_every_speaker_is_offered_the_same_team_administration |
| A-03 | API and CLI conversation paths consume the shared production snapshot; live evaluation uses those loops and definitions. | pytest | core/tests/architecture/test_boundaries.py::test_shared_loop_and_definition_sources |
| A-04 | CLI conversations use one authenticated RaphaelMcp implementation; no alternate MCP server in agent CLI or evaluation. | pytest | core/tests/architecture/test_boundaries.py::test_one_mcp_server |
| A-05 | Secrets use the OS credential store; only hosted evaluator CI can read its ephemeral Actions key, and failures never report credential values. | pytest | core/tests/architecture/test_boundaries.py::test_evaluator_credentials_are_ci_scoped; core/tests/brain/test_openrouter.py::test_a_key_provider_failure_is_logged_by_exception_type_only; core/tests/evaluate/test_guardian.py::test_provider_error_is_classified_without_secret_text |
| A-06 | Main-window core RPC crosses api.ts only; window-hotkeys.ts may forward the shell-only window_hotkey command. | vitest | app/src/architecture.test.ts::core IPC has one frontend boundary |
| A-07 | Main-window source contains no native selects; rendered checks also reject native time inputs. | vitest | app/src/architecture.test.ts::main templates never introduce native selects |
| A-08 | Settings keys extend the single DEFAULTS registry without duplicate literal keys. | pytest | core/tests/architecture/test_boundaries.py::test_settings_have_one_unique_registry |
| A-09 | Open is a generic target_kind/target action rather than a per-site enum. | pytest | core/tests/architecture/test_boundaries.py::test_open_has_no_site_allowlist |
| A-10 | Literal frontend RPC calls are shell-allowlisted, and every named shell RPC method has a registered production core handler. | pytest, vitest | core/tests/architecture/test_boundaries.py::test_shell_named_rpc_methods_have_registered_core_handlers; app/src/architecture.test.ts::literal frontend RPC calls are allowed by the shell |
| A-11 | State belongs to the existing stores and migrations; no duplicate settings UI or persistent state registry. | human | Architecture and diff review |
| A-12 | Core execution remains independently gated for members, rooms, background work and connectors. | human | Native journeys and service/gate tests |
| A-13 | Every mechanical architecture and product rule links an existing executable test. | vitest | app/src/architecture.test.ts::mechanical rules link existing named tests |
| A-14 | Native notifications retain their main/overlay channel contracts and behavior. | human | Native notification journeys |

## Long team work (2026-10-31)

A background task has no clock: it works until it is done, the owner stops it, it stalls (no model
reply and no tool returns for `RunLimits.seconds`) or it reaches a ceiling (1000 model calls, 2000 tool
calls, the owner's `worker_cost_cap_usd` for a paid model; a subscription spends nothing and has no
cap). At a ceiling the task is asked once, with no tools, where it stands, and that summary is its
result (`worker.loop.WRAP_UP`; a CLI task is told in place of the tool call it asked for). Up to
`MAX_PARALLEL` (3) tasks run at once, one per member; the rest wait in the queue and none is refused.
The worker process carries them side by side. Delegated results reach the parent as completed,
error or cancelled with the evidence the system recorded; a file the work was to leave is
judged on the bytes found in the member's workspace, not on the member's word. Members share one
screen by turns (`computer.vm_tools`): a bounded wait with one progress line, then a result naming
who holds it; commands never take the screen. Assigned work (`handoff`) survives the owner
speaking in a room; only the owner's stop ends it.

## Shared cancellation boundary (owner round 3)

Main, room and desktop surfaces register visible task targets with the same
`src/shared/cancel-gesture.ts` document controller. It owns arming, localization,
timeout, interruption and target identity; pages supply only the existing Stop
operation. Native raw Escape/reset notifications are unconfirmed inputs, never
Stop commands. Windows forwards transient ordered Escape/reset markers only while
the controller's recording ownership enables the cancel hook. Release clears that
ownership before processing; typed tasks do not acquire it. Configured hotkeys
and a confirmed Stop command retain their existing native routing.

The overlay's caller-checked `overlay_cancel` is an explicit shell-only command
like its existing answer command, not a core RPC client. A question temporarily
resizes the existing overlay upward and inherits the main window's resolved theme;
it does not create another store or window. Deletion invalidation travels through
existing UI events before reloading selected objects. See the conversation,
dictation, team/rooms and automations feature entries for executable journeys.

## Recording release and launch policy (owner round 4)

The recording composer's Stop uses the existing agentVoice down/up native path.
It is excluded from generic task cancellation; task repaint preserves the voice
flyer. Escape alone uses cancelSession and the shared two-press gesture.
First and single-instance manual launches share first_run::opens_at_start(args);
only explicit --autostart stays hidden. Every launch opens at the designed 1280x800,
centred; window-state restores nothing (owner, 2026-10-30). Conversation content never depends on profile_ready.


## Member memory as living files (2026-10-31, supersedes the notes of phase 2)

`memory/store.py` is one `MemoryFile` per file, adapted from Hermes: `bots/<id>/MEMORY.md`
for each member (Raphael too) and one `shared/USER.md`. `bots/<id>/SOUL.md` is written by
the core from the member's details, which stay in the database (the details pane is its
editor, many consumers read it), and no member may write it. A file is entries separated
by a blank line, with a character limit, edited by atomic add/replace/remove batches under
a per-file lock across threads and processes; `BotHomes` does the allowlisted atomic write
and keeps the revision journal outside the homes. `memory/growth.py` holds the one
`memory_update` tool (API and CLI consume one definition registry, A-03/A-04), the daily
logs and silent, permission-scoped ephemeral FTS5 retrieval over logs and turns.
`MemoryService.snapshot` is what a turn reads, once, at its start: the system prompt for an
API brain and the turn's message for a CLI brain, since a resumed session keeps its first
instructions. `memory/brain.py` runs the reflection pass, the consolidation and folding on
the selected member brain; CLI uses the production CliLoop with no tools and a separate
ephemeral session. `memory/legacy.py` moves what the row-per-note store left into the files
at every start until none is left, and backs it up under `bot-state/<id>/notes-backup/`.
There is no review queue: `memory/scan.py` refuses instructions and secrets, a turn that
read outside content writes only marked entries, and the reflection pass reads only the
owner's words of such a turn. Reads never call notification or mutation paths (A-01).


## Growing skills (phase 3, 2026-10-29)

members/skills.py extends the existing MemberCapabilities store, BotHomes journals and
skills.json state. SQLite keeps skill identity/source/enable metadata; the core-only mirror
also owns learned provenance and learning timestamps. Owner undo validates its current
mirror revision, restores documents/references and database metadata, then journals the
restored mirror. Reads are silent. Member tools cannot select another member or toggle
skills. Generated/imported skill contents stay untrusted guidance.

members/skill_review.py runs on the MemoryService scheduler with the same tool-less
member-brain adapter as capture. memory_state stores per-conversation watermarks and
three-failure bounds. This introduces no second conversation loop, settings registry or
RPC boundary. API harness and RaphaelMcp share agent/team.py definitions and guarded
execution (A-01/A-03/A-04); native CLI memory/skills remain disabled.

## Single sidebar (owner decision 2026-10-30)

`main.ts` mounts the agent-owned member column once in `sidebar.ts`, outside the
page container. Home, dictation, calendar and conversations share that one DOM
and the existing MembersShell, member actions, groups and rooms RPCs. There is
no Team page, route or spatial canvas. Chief swapping remains `memberDisplayList`.
Details owns the member brain picker. The Everyone room uses `is_team` and follows
the current roster without duplicating members or a conversation loop.

Owner identity uses existing `owner_name`/`owner_photo` settings, the shared avatar
picker/cropper and bounded image conversion. Sidebar footer and outgoing messages
consume `owner-avatar.ts`. Settings > Connections is the sole connected-app entry.
Home's mini calendar remains the full calendar entry. Migration 44 adds room pin,
hide and read-message position to the existing rooms table; `rooms.list` resolves
previews/unread from the same visible messages, while `rooms.update` saves actions.
The mock IPC boundary projects those same summary fields from fixture messages.
Conversation-row selection also requires the agent page to be visible; hiding it
redraws the shared column immediately without losing the remembered conversation.
Composite faces keep their own round backing and a 2px surface-coloured separator;
only that group context frames Raphael's otherwise bare emblem.
No new RPC boundary, settings registry or provider loop is introduced (A-01/06/08/11).

Home month navigation keeps its visible month in page state, requests month-scoped
home.overview data, and uses the shared monthDays local-date grid. It sends a
CalendarDate through the existing app.go boundary to the full day calendar. The
projection retains the bounded seven-day preview and adds compact month date marks
and connected events. Horizontal wheel/touch navigation uses a finite 160ms slide
and respects reduced motion.

## The app's own calendar (owner, 2026-10-31)

`own_calendar.py` holds the one thing in the app that can be changed by hand: one-time
events in the `calendar_events` table, a timed one as two instants and an all-day one as
two local dates. The window's `calendar.*` RPCs and the `calendar_*` tools share its one
check. `home.overview` stays the sole projection for Home and the Calendar page, and adds
own events to what it computes; `HomeOverview.between` serves a member's `calendar_list`
from the same sources. Tools are offered on every path through `take_snapshot`; the API
and CLI turns reach them through `_harness_call`, a background task through
`TaskRun._lookup`, with the same screening at T1. `calendar_google` says what Google is
(connected, not connected, unreadable, members only) so that none of them reads as an
empty calendar. Everything else the app shows is computed and gets no tools.

The final Home calendar uses a size container: 900px width plus 460px height selects
the full event-chip month; smaller containers use mini month plus selected-day
agenda (stacked below 680px). Both read the same bounded three-items-per-date
projection and daily counts. Month controls stay outside the animated grid and
six rows prevent month-to-month height changes. A compact date changes page-local
selection; full-grid dates and all event links navigate through the existing app.go
CalendarDate/CalendarEventFocus boundary. Calendar highlights the requested item.
