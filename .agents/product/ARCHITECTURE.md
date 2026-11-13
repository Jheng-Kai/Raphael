# Raphael architecture and checked boundaries

## Shared computer seats, stages B2 and C (2026-11-12)

R-COMP-SEAT-01 supersedes the old single-screen shared rotation model. The default
remains per-bot. Target.key is key_for(host, member) for both kinds. Target.container
is shared for the common computer and empty for a per-bot computer. Target.unit is
container or key. Shared unit state uses the host as well as the unit, and physical
Target cache keys normalize the seat number. Container labels name the unit.

LocalVm.seats uses ComputerSeats and migration 81. target() reads without assigning:
unassigned members have screen 0 and an empty viewer_url. VmTools.prepare and a real
DesktopViewer._open take a seat. Previews and status reads do not. A displaced idle member is first selected without mutation by ComputerSeats.candidate. Under seat_lock, LocalVm revokes the old holder, disconnects its driver and closes its viewers, then publishes the new holder with ComputerSeats.restore on the exact checked screen only after a successful list shows no window touching that screen other than the desktop's own (LocalVm.DESKTOP_WINDOWS: its panel and the canvas-wide xfdesktop window), or proof that the computer is absent/stopped. Free screens pass the same gate and existing holders only receive touch; a failed cleanup restores the old exact holder and returns seats_full. Cached routes that try to reacquire the screen wait for that transition and return computer_changed. Cleanup, cancellation and final holder-publication failures restore the displaced holder to its exact previous screen before unlocking; if that persistent restoration also fails, the transition reports seat_restore_failed. Restoring the assignment does not reopen windows already closed by cleanup. close_displaced_seat_windows(target) joins wmctrl -lG/-lx rows, gently closes windows with any overlap except the desktop's own, never those, then rereads at most ten times with 50 ms intervals inside LocalVm.seat_clean_seconds (8 s: measured on a Windows host one list is about half a second and each close is another command; four leftover windows took 2.1 s, ten took 3.6 s). Unknown classes remain visible and malformed geometry refuses emptiness. Release is best effort; allocation requires a successful proof, without a durable quarantine. Every busy seat yields seats_full, projected to the existing tool
computer_busy notice or viewer unavailable error. Deletion holds seat_lock through driver/viewer/window cleanup, then releases every host's
seat and keeps the historical ComputerData per-bot deletion path. Window cleanup
rechecks the current holder immediately before each close. Viewer open checks
member/Target/holder after each await and before registration; request, peer registration,
renew and control revoke stale sessions, including after asynchronous probes.

Tools, catalogs, routes, leases between a member's turns/tasks, driver connections
and sessions, viewer tokens and owners, active counts, held keys and private pages
remain keyed by seat. LocalVm.unit_active/unit_held/unit_busy aggregate these seats.
Physical locks, preparation, lifecycle/maintenance, running confirmations, activity,
repair revisions and disk probes are keyed by unit on its host. Capacity, recovery,
idle sweep, timezone reconciliation and shutdown enumerate physical units once.
Shared resources are 6 GiB and 4 CPUs with RAPHAEL_SCREENS=6; per-bot resources stay
3 GiB and 2 CPUs. Known old one-screen shared layer 3/4/5 shapes preserve mounts on
rebuild, including a layer 5 shape already using the current image.

NATIVE_INPUT_TOOLS in vm_catalog.py retains native calls. In shared mode,
shared_native_input also locks every request dispatched with delivery_mode=foreground,
including browser_click, browser_pointer, explicit DOM routes and dialog accept/dismiss.
Read-only dialog inspect has no implicit foreground posture; an explicit foreground
request still locks. Background page input and CDP reads/navigation/type/select/files/
download keep their page route. The unit lock is reentrant only within the same task
for composites and window fitting. All calls from the held seat are refused; peers'
foreground input waits the bounded time then returns computer_busy. Handback removes
only its own seat's hold. Browser prepare preserves delivery_mode. A session timeout
or cancellation closes only that seat's connection and clears its native page bindings.

Stage C makes the seat wall the core's responsibility. vm_catalog.SHARED_ARGUMENTS
classifies every top-level and nested property of all DRIVER_TOOLS as pass, check,
translate or refuse. _seat_driver_call rejects unknown properties, target, from_zoom,
capture_id, screenshot_out_file and caller-supplied desktop scope/coordinate_frame.
A fresh same-session canvas list checks each named window/pid and each target_id's
recorded native window. A centre-owned straddling/oversized window is fitted under
the unit input lock and freshly confirmed wholly inside the seat before reads or
input; otherwise it is refused. Native window-relative gesture points are checked
against the seat rectangle, including both endpoints of the straight interpolated
drag; menus outside the window but within the seat remain reachable. move_cursor
checks seat-local input and offsets it to canvas coordinates. verify_state translates
expect[].window.bounds to canvas and observed_json placements back to the seat.
Lists include only own windows and panel. Structured placements use seat coordinates;
AX and screenshot nodes stay window-local. Driver tree/token prose is preserved,
page JSON is appended once, pointer prose uses seat coordinates and click trailers
naming canvas points are removed. Every page target and private/vault state read
shares the same fresh ownership gate; moved bindings are dropped. The list and dispatch are separate operations in one X server; application-driven geometry changes between them remain possible, so this is not atomic isolation.

Shared get_desktop_state never asks the driver for canvas pixels. LocalVm's
viewer_connection supplies core-only credentials to asyncio.to_thread(rfb_view.capture),
which authenticates /websockify?token=screen-N, requests raw 32-bit pixels and emits
1280x900 8-bit RGB PNG using zlib and filter-zero rows. Acceptance imports the same
WebSocket/Rfb implementation. No image library, service or transport is added.

Layer 7 grants existing-profile attachment. raphael-seat-browser starts the
computer's Chromium outside driver sessions in the existing driver/main workspace
profile. A title-only data page carries a unique launch marker. The launcher selects
now-minus-before windows and matches both marker and browser main pid, then moves,
maximizes and waits for settled seat geometry. Each seat attaches its own window
using existing_profile, binds and navigates in its own session. Per-bot computers
retain driver-owned browser launch. launch_app, under the unit lock, moves new foreign-screen windows matching reply pid/launcher_pid. Only when none match and exactly one other new window appeared is that window moved as a helper fallback; otherwise unmatched windows stay. A lone concurrent peer window can still be misattributed, and matching pids do not distinguish simultaneous same-process peer windows. windows[] is filtered and projected after movement. Owner takeover checks its
own non-command activity and the unit native lock before and after a status await;
other seats' background page/read/command activity is allowed.

Clipboard, files, sign-ins, OS user and physical pointer remain common. Shared foreground/background vm_exec shells remove DISPLAY to avoid accidental windows on the pointer's screen; members use launch_app to open a window. This is not an adversarial shell isolation boundary. VmTools.page_tabs remembers the member-observed tab for each computer/page target in both modes; page_refs remembers each typeable ref and its frame, role and name per computer/page target/tab, replacing that mapping only from member observations. _driver_call feeds _observe_page; fill reads and private probes pass remember=False. If a value-free probe tree is actually returned to the member, its refs are remembered separately without changing the current tab. Fills resolve all supplied refs to one uniquely known tab. Private marks retain the filled target_id and tab_id, and probes read those exact IDs without changing the member current tab. Saved fills first resolve all member refs to original meanings that are unique among the remembered tab refs and have frame main, then uniquely match a main frame/role/name row in each fresh exact-tab read. They always pass replace=true and require non-refused exact delivered_count; unknown refs refuse filling, and frame/ambiguity refusals return fixed takeover guidance. Internal fill reads invalidate member refs through the existing stale/screen_changed gate. _disconnect drops those tabs with the native page bindings. Member-facing fill parameters are unchanged. run_steps validates the observation arguments against its live schema before any action, and verify_state requires a meaningful window or element expectation shared with ComputerVerification. predicates remains a driver reply field and a tracker-only compatibility name for historical records, never a current batch input alias. Shared datasets use the core-selected stable member key under .raphael-data/members/, keeping the common dependency environment and per-bot paths unchanged. Shared teaching uses VmTools.seat_observation (the member window projection and rfb_view.capture) on the core's input/tick, with current private-page protection and no relay observer or canvas-wide driver observation. carry.before_browser, called by LocalVm.seat_browser, runs a read-only Linux helper (carry_runtime, a named container) to carry unhandled historical homes as one background task per shared computer (LocalVm.carry_tasks) that the browser waits for only within a budget: the newest persistent-cookie profile first and only when shared has none, then member files and DuckDB files, with outcomes in the core-written .raphael-carried.json. Each old home's lifecycle lock is held until its copy has ended; it never blocks the browser or notifies the owner. The opt-in --computer acceptance now
includes two real members through LocalVm, VmTools and CuaBridge after the per-count
blocks; --no-shared skips it. Offline fakes prove contracts, while final image,
geometry, native timing, browser lifetime and remote hosts need real acceptance.

## A report shared as a file (2026-11-10)

The window draws the file (report-page.ts `reportFile`: the same escaping drawing, the theme's
words read from its stylesheet, its policy first) and hands it with the page id to the shell's
`report_save`. The shell adds its Downloads folder and calls the core's `pages.export`, which the
window's allowlist does not name, so no folder or path comes from the window. The core takes only
a report page and only the drawing's elements and attributes (links within the page, one style
with no tag in it), names the file after the stored title, writes it exclusively in
owner_output_folder or else Downloads, and returns where; the shell selects it in File Explorer.
No page host, frame, migration or model tool is added (R-PAGE-01; core/tests/agent/test_pages.py).

## No voice output (2026-11-10)

The app speaks nothing: no text-to-speech service, spoken Alt+Space answer, generated
audio file or voice call, in the core, the shell or the window. Dictation (speech to
text) is unchanged. Migrations 22, 64 and 67 keep their voice columns and voice_calls
tables, and saved tts_* settings rows and a stored Fish Audio key stay where they are,
unread (core/tests/test_no_voice.py).

## Conversation metadata boundary (2026-11-05)

Migration 64 adds bounded owner reaction tables with message/turn ownership, side
thread root links, the existing draft store's transport kind and member voice_memo.
agent.react and rooms.react only change metadata and notify their existing timeline;
they never enter confirmation, owner-question or draft completion paths. Private
context reads metadata through AgentHistory; room transcripts include the same
explicit non-instruction label. rooms.thread_open validates a main-room root and
reuses room_threads/thread_id, the existing worker and its isolated transcript.

Migration 82 (2026-11-14) makes the message the primary key of both reaction tables, so a
message carries one reaction (R-REACT-01), and adds `reaction_asks`, the once-only record of
the messages whose negative reaction a member already asked about. `set_reaction` replaces in
one write and returns what the message carries; `agent/reaction_asks.py` waits 4 seconds on the
latest reaction of each message and then asks the service that owns the message to start the
ask: `AgentService._ask_about_reaction` (a turn of source `reaction`, written like a greeting
with no owner message, on the member's own model with no tool and no fallback) or
`RoomsService._ask_about_reaction` (a one-turn room exchange for the message's author). Only
these two ever read a reaction to start work, and neither treats it as approval.

slack_draft shares EmailDrafts, its version digest, send claim and ToolGate. It refuses
room origins at both tool and service boundaries. Discovered Slack sends obey the
same draft-first/full-permission policy as mail. No second draft engine is added.
All frontend IPC stays in api.ts and the
literal owner-window RPCs use explicit Rust allowlist entries. No worker, provider,
model loop or settings registry is added (A-01/03/04/06/08).

## Member panel and host preflight projection (2026-11-05)

Owner request of 2026-11-05: use Grok Bot's clear Details / Library / Computer hierarchy and explain the actual unavailable-computer reason. This section supersedes earlier landing-panel and first-build-caption guidance for this panel.

member-details.ts reuses ui.tabs and keeps the existing settings/resource pages behind the gear. member-panel-work.ts projects existing worker rows, pages and artifacts; members.list accepts panel_member_id/panel_limit through the existing owner-window allowlist. members/panel.py caps task/page/artifact queries, filesystem entries, depth and visible files; remote volumes are not treated as local folders. No database, migration, model loop or RPC is introduced (A-01/A-03/A-04/A-06/A-08/A-10/A-11).

computer-state.ts owns the full localized screen sentence and the semantically matching short header word, following the owner's 2026-11-05 request to say each thing once. The existing viewer owns its persistent noVNC frame, watch/takeover boundary and screen actions; Enlarge/Take control require a live screen. Location and lifecycle controls live only in the Computer tab; context-menu.ts maps both its header and work-row overflow to the same existing menu path. The member panel owns its one conversation heading and asks the existing conversation list to omit its internal heading. Library file handles resolve through computer.team_file with member/root containment and the shell's existing read-or-reveal behavior; pages return to their existing conversation result.

LocalVm.status preserves fixed preflight reasons and the missing-image flag. ensure_engine defaults to refusing a stopped host engine; since 2026-11-11 a member's own tool call (`engine_start_allowed()` in vm.py, set only in VmTools._call) passes `start_desktop=True`, while status reads and the viewer never do, and `engine_notice` says so in one progress line. An explicit start_docker request on computer.viewer_status pins the current local host, reuses DockerDesktop and the 120-second wait, clears temporary engine progress and returns normal status. Windows launches the installed Docker Desktop.exe, macOS opens the installed Docker.app; no shell/elevation, remote launch, install or image maintenance occurs during a status read. Fake tests do not prove native launch or container operation.

## Calm conversation projection (owner, 2026-11-05)

conversation.ts owns calendar-day dividers; timeline.ts owns inline routine origins, reply actions and collapsed work receipts. The page retains latest-failure visibility as a render dependency. Find opens existing work detail and preserves its state. CliLoop emits one terminal reply, while Driver and Failure carry bounded, redacted stderr diagnostics into the existing foreground/background turn detail. Premature completion uses cli_stopped with the existing retry policy; real connection errors retain network guidance. No RPC, schema, worker, provider or model-loop boundary is added (A-01/03/04/06/08). See R-UI-101 and R-CLI-07.


## Signed updates, owner imports and streamed composer files (2026-11-05)

The updater feed is https://github.com/Jheng-Kai/Raphael/releases/latest/download/latest.json.
Release builds require GITHUB_REPOSITORY=Jheng-Kai/Raphael and publication pins GH_REPO to
that repository; a stale local git remote never selects an updater endpoint.
updates.rs alone uses the official Tauri updater plugin. The public key is a compile-time
RAPHAEL_UPDATER_PUBLIC_KEY, with no fallback key. A missing key returns not_configured before
any feed request. updates.ts maps only that result to the current-version releases-page row;
Settings uses its existing open_external_url plumbing. Configured-key behavior is unchanged. requireSignedVersion binds bytes to
manifest versions. With both owner signing keys, the release workflow retains version-bound
signing, latest.json and its published feed. If either key is absent, it warns once and layers
tauri.release-no-updater.conf.json over the release config to disable updater artifacts; the
installer, notices, BUILD-INFO and SHA256SUMS still build, verify and publish without .sig or
latest.json. prepare-release-assets defaults to signed mode and requires a signature; explicit
--updater disabled omits the feed and records the missing-key reason in BUILD-INFO. Publication
uses the checked version job output rather than reading latest.json, and still requires the
explicit workflow input. DeviceStore owns opt-in and a one-shot
installed-version receipt. A native timer contacts releases only while opted in; a fail-closed
roster read and Windows idle time gate installation. Native installation/rollback acceptance
remains separate from fake-feed tests.

The owner memory import was removed on 2026-11-08. Moving to another PC means keeping
Raphael's data folder. The existing MemoryFile.apply writer remains shared by normal
memory edits and growth; there is no separate owner-import RPC or model authority.

attachments.upload handles bounded sequential chunks, validates offset and declared length,
then atomically publishes an opaque ID. Both conversation and room admissions resolve those
IDs through AttachmentStore, using a read-only memory map. Existing readers keep their budgets;
Office and ffmpeg read stored paths without whole-file copies. The native asset command
resolves an ID through the core before granting access to that exact file. No caller path or
recursive filesystem scope is accepted (A-06/10/11).

## Smooth member computers (2026-11-05)

VmTools owns run_steps in the existing curated catalog; each subcall re-enters
the same ToolGate.call_plugin, lease, action and audit boundary. The shared
worker completion guard is used by API/worker and the existing CLI loop. Tools'
web_read receives the same VmTools rendered-read callback, with current member
scope; no new worker, model loop, service registry or provider fallback is added.

LocalVm owns one RemoteSession per SSH alias. Docker stdio and normal calls use
its owner-only local Unix socket; noVNC uses SSH -W pipes through an owned local
relay, without a general SOCKS listener. Unsupported socket forwarding uses the
existing per-command ssh:// transport with reconnect backoff.
The existing main-window computer.viewer_status RPC accepts check_host for the
read-only diagnostic; no new RPC or Rust allowlist entry is needed (A-01/03/04/08).

DesktopViewer still owns one stream and server-side input lease. Enlarge is an
independent view-only presentation. A private owner request keeps its interactive
screen in the conversation card. Only explicit nonce handback resumes the same
task; owner typing never enters chat/tool results, logs or thumbnail storage.
Member deletion's optional computer cleanup pins host identity and excludes team
storage. Lifecycle/image changes preserve workspace mounts; native speed work
uses a random isolated root and exact target cleanup, never a recovery scan.

## Commands, routine admission and owner delivery (2026-11-05)

shortcuts.ts resolves guarded keyboard intent and renders the existing ui.ts
popover; members-shell, sidebar and the conversation page keep routing ownership.
No native global hotkey or new RPC is added (A-06). MembersService owns admission
before the existing _run for schedules, event receipts and webhooks. Recent
history stays in routine_runs; its projection is limited to 20, not pruned.
The single SettingsStore registry adds internal owner activity/admission state
and owner_output_folder (A-08). Bounded rolling-hour receipts retain member and
time only, surviving routine deletion. Owner activity is accepted only through
the existing owner-window viewing boundary, never from model tools.
The existing shared brain.owner.owner_context carries the escaped output path
and delivery instruction to foreground API/CLI and background prompts. It does
not add a writer, model loop, worker, grant, migration or filesystem side effect
(A-01/03/04). Host and member-computer destinations stay distinct. Actual native
keyboard and model delivery acceptance are deferred by the unit brief.

## Owner management registry (2026-11-05)

core/src/raphael_core/management.py holds owner UI actions, exact RPC/service names, schemas,
destructiveness and tiers, plus owner-only reasons and explicit read/interaction
classification. agent/team_admin.py generates contracts from those rows and keeps
team_overview as shared work context. MembersService executes the same Router
handlers as the UI, with the existing member profile adapter for named folders.
The live store primary_id is checked at execution, not inferred from identity 0.
Interactive private API/CLI offers include management only for that primary;
noninteractive snapshots exclude it. Own routines, memory, skill tools,
connect_app/request_secret cards, room_post, ask_member and handoff remain shared.
Firm destructive confirmation is evaluated by ToolGate/ToolRegistry even under
bypass and cannot be waived by Always. MembersService also requires the exact
consumed Approval and refuses replay. T3 cards carry the full scope in words and are
answered by one press (2026-11-11); the administrative changes of one turn that need a yes (the
ones that cannot be undone, and any other that the mode or a rule asks about) are held
until the turn is in and asked as one `management_batch` card, without a timer in the conversation (R-AG-MGMT-04), whose single yes covers
exactly its listed changes (`Approval.covering`, one part each). A trusted origin-turn context prevents a requested history deletion
from cancelling its own executing tool; completion writes a fresh receipt.

## Bounded transcript rendering and incremental history (2026-11-05)

TranscriptWindow owns the shared private/room mount range: newest 25 turns,
20-turn expansion within 300px of a sentinel, and at most 100 mounted turns.
Search, quote, bring and unread navigation restore the target range before
scrolling. This frontend range does not replace core before/around pagination.
agent.history.list additionally accepts bounded after_id and explicit turn_ids
reads, scoped to the same member and conversation; dirty IDs never advance the
forward-page cursor. Persisted history remains authoritative.

Finished turn HTML is cached by its data and display version. Composio and
mention projections are bounded presentation caches, never changes to raw tool
results. The shared reading controller retains one anchor and invalidates queued
corrections on explicit navigation. End/sentinel observers own following and
paging admission; ordinary content mutations do not measure the entire thread.
Slime transitions retain JS pose clocks, avoid computed-style reads and defer
invisible strips. Parsed cel templates use a bounded 16-entry LRU; mounted clones
keep independent phase and colour. Mount timestamps are not content identity.

## Meeting speech and private work lanes (2026-11-04)

Owner follow-up (2026-11-08): explicit meeting exchanges retain meeting=1 and
submit one participant at a time from a persisted ordered queue. Each next turn
reads the current public snapshot; owner corrections re-open the participant
queue. Ordinary chats retain concurrent snapshot speech. Listener errors retain
redacted kind/attempt evidence and one retry; blocked listener intents feed the
existing room close-out. CLI listeners reuse CliLoop and structured_object with
no tools. Fresh team snapshots and work_status expose persisted meeting state.
No new worker, provider, model loop, RPC or database migration is introduced.

Migration 60 preserves existing room rows and the compatibility active_turn column.
room_exchange_turns is authoritative for per-round concurrent turns and seen_through;
room_member_cursor is scoped to room, thread and member and advances after successful speech.
The background worker remains the sole execution engine. Its ordinary work pool keeps
three slots and one task per member; short room speech and tool-less CLI speak/pass
choices share two separate slots. Selected models are never silently replaced.
A sealed Snapshot prevents tool refresh or discovery from widening the speech offer.
Speech offers handoff, room_post, ask_member and work_status only, with bounded calls
and time; tool work and approvals belong to private conversations.

Room handoff, including self-handoff, creates a private worker turn in Conversations.main
of its assignee. worker_tasks.report_room_id/report_thread_id carry the public destination
separately from execution scope. Children inherit that destination; private work reads its
own member's context. Stage ownership, generation cancellation, task evidence, outbox and
inbox retain their existing authority. Room Stop invalidates every linked tree before any
transport cancellation. Member questions still return only to the asker.
Cancelled, interrupted or invalidated lane reports remain visible but never request another digest.
They wake existing exchanges to settle; owner-stop close-out waits for actual private
work turns to finish, so its status reflects completed cancellation rather than stale work.

Outbox delivery projects one kind=report message with a bounded public summary, verified
evidence and a private turn link; no private turn/card object is returned in rooms.messages.
A durable room_digest_requests key admits at most one digest round per report or post.
Posts from an existing digest cannot create another digest; a queued follow-up never
replaces running work on the computed per-member board. Explicit owner retries retain
their private scope, original stage and room report destination.
Chief decisions use kind=decision through room_post. Member posts and chief agendas keep
their real author; only rooms.send creates owner interjections. Meetings target an existing
room ID or reuse exact membership/name plus superset. Speech has at most three rounds,
ten replies and two replies per directed mention pair; a cap with unserved intents closes
from persisted facts. Restart publishes close-out and re-offers restart-blocked speech
intents once, without replaying uncertain private work.

The room status row shares pending-question styling outside ra-scroll and opens the
shared popover. Reports share conversation-card and message-content's fileChipHTML.
A task-artifact:<task>:<evidence> handle crosses the existing main-window-only
open_team_file command. DesktopViewer resolves it through BackgroundService and
TaskStore, never a caller-supplied filesystem path. The recorded workspace, containment,
file size and current digest are checked before returning the native path. Readable
extensions open; executables retain the existing show-in-folder policy.

This section supersedes older descriptions of sequential speech and room-scope tool work.


## A new member's set-up by cards (2026-11-11)

The greeting turn (`AgentService._greeting_loop`) offers exactly `ask_owner` (an API loop's one tool; a CLI loop's MCP list, with its native tools
still denied) and parks the card through the ordinary `BackgroundService.park_owner_turn`: the member's words with the card are written as a reply
before the card is asked, so the thread reads them in that order. The parked task of a greeting is never continued. When its question is settled,
`BackgroundService._greeting_answered` ends the task without touching the turn; an answer calls the handler `AgentService.begin_setup`, which runs
a turn of its own (session `setup-<greeting turn>-…`, source `app`, the answer as its words, `setup` in its view) with `SETUP_STEPS` beside the answer.
That turn is an ordinary interactive turn: `set_my_job`, the connect card (whose resumption carries `SETUP_AFTER_CONNECT`) and the next `ask_owner`
are the tools it has, and the card after it is parked like any other. A message typed to the member closes the greeting's card like any waiting card (`OwnerQuestions.close_for_message`, unanswered), and the task of a greeting ends there without a set-up. A restart keeps the card (`worker_tasks` continuation) and `AgentService.start` carries on any answer the
last run did not get to. `agent.history.list` sends each owner question's `created_at_ms`, so a settled card stands among the replies where it was asked.

## Pending owner questions in conversation cards (2026-11-04)

OwnerQuestions.in_conversation projects only pending ask_owner rows joined to
their current private conversation/member or room/thread and live task. Existing
agent.history.list and rooms.messages return this as pending_questions alongside
their unchanged page. Chief turns currently store member_id=0; the lookup uses
IS and also matches NULL chief rows within that same conversation. No new RPC or
migration is introduced. The shared frontend
controller combines that projection with mounted cards and waits for the turn ID
returned by owner_questions.bring before scrolling/focusing. Room bring reuses
BackgroundService's move and room-wait receipt path, preserving scope, room,
thread and task identity; a per-move request ID keeps receipts retry-idempotent.

Composio presentation is a frontend-only projection shared by conversation,
permission and step-detail consumers. It does not rewrite raw history, tool data,
model messages, execution arguments or permission digests.
Member-authored content requires a recognized tool slug or successful/data-or-error
envelope; Composio step details and permission summaries explicitly trust their
tool origin. One exported detector identifies Composio server/tool names. Display
lines name only the app brand plus localized outcome and fields, with a localized
result label when no app slug is present.


## Shared calendar reading and rhythm projection (2026-11-01)

ConnectedCalendar owns the most recent 24 in-memory range readings and attempts, one-minute refresh admission and
background provider tasks. calendar.changed invalidates the Calendar;
calendar_list reuses a covering reading, even an empty one, or awaits its first range read under the shared 12-second provider timeout. Readable connections start connected; only a failed read makes them unreadable. App shutdown
cancels refresh tasks before closing services or SQLite. call_calendar pins the
sole read slug and validates ordinary Google list arguments. A task-local core
context lets that one read through the existing managed gate before catalog load;
it changes no grants or model-call classification. Real Composio text is decoded
at data.results[0].response.data; every envelope failure is refused.

Schedule owns local-day window math. Migration 54 retains the lowest id, all runs
and unique receipts; duplicates retain their most advanced state. calendar-view
owns quiet bars and status icons. The calendar's bounded projection emits one rhythm per
local date. routines.runs and the calendar projection share the SQL projection of unfinished turn status and actual pending owner_questions/worker_questions in live background tasks. Owner questions are confirm; waiting for delegated children alone remains running. No new RPC, Rust allowlist entry, setting or brain
loop is introduced.

Calendar page instances retain their current date/view until the app closes. The account menu's 行事曆 resumes that instance without a date argument (Home's icon did before 2026-11-12); explicit date/event links keep their navigation semantics. Only view choice is persisted as raphael.calendar.view, guarded and validated with a week default. Grid width determines seven-day layout (fallback below 520px); all-day and timed grids share column templates. The Today navigation group has a scoped R-UI-18 audit exception, without changing other text actions.
## Member media and datasets (2026-11-01)

GenerationTools wraps the existing hub for API, authenticated RaphaelMcp and background
snapshots (A-03/A-04). The single SettingsStore DEFAULTS registry adds image_model and
video_model, both empty until the owner explicitly chooses. No member/turn model context
or auxiliary API fallback participates. The existing models.catalog response includes
image/video lists from ProviderRegistry.media_choices, retaining generation_only models
and discovered prices without making them conversational brains. Image-only endpoints
receive only image output requests. Existing MODEL_ROWS and
the shared picker render the two rows; repair follows Models and focuses the exact row.

Generation validates the selected reference independently, reaches only configured
credentialed provider endpoints, and keeps authenticated downloads on that endpoint.
Public media URLs use the bounded public-address fetcher without provider credentials.
AttachmentStore and existing media cards deliver validated output. Each response's actual
cost, or reported usage priced with cached published rates, enters Ledger/SpendTracker
under image/video before delivery errors can lose the bill. Usage bills retain those
two purposes instead of grouping them as other. Unknown cost stays null in
the visible receipt; the existing numeric spend records zero known cost, not a free-call
claim. Work-step detail stores only model/cost metadata; the existing step renderer
shows readable words. Parent ledgers include the cost without another spend row.

Video keeps background progress and Stop. Cancellation prevents local publication and
attempts OpenAI deletion; remote cancellation and billing are not guaranteed. Dataset
work remains under the member VM and explicit rules, installs pinned dependencies
only on first workspace use, and needs no Docker layer. No new page, RPC or migration.

## Owner demonstration boundary (2026-11-01)

`computer/teaching.py` binds an owner recording to DesktopViewer's captured target,
member, conversation and lease. RfbInputGate exposes accepted protocol messages in
order; the viewer observes each input before forwarding that message and checks
the lease again afterwards. No owner-PC bridge or screen capture API is used.
For per-bot teaching, the pinned CuaBridge permits only the two exact, argument-free screen/accessibility reads during owner observation. Shared teaching permits only the exact session setup and list_windows requests on its seat connection, and obtains clipped pixels from the viewer connection resolved at recording start. Normal model calls still refuse a held screen.
Per-bot accessibility observations and shared seat-window observations fail closed for private or unavailable content; shared private-page marks also withhold text and pixels and redact typed input.
The existing viewer monitor samples changed screens and enforces the duration limit.

Bounded JSON recordings live under `bots/<member>/demonstrations/` in the member's
host-owned workspace. Safe path checks and atomic replacement protect this data.
Restart restores a draft or interrupted data, never input ownership. Drafts run on
MemoryBrain (API or CLI, without tools), through its normal spend ledger, and stay
outside the skill registry until owner publication through MemberCapabilities.
The shared resource editor supplies Save/Cancel; new-input trial uses the existing
conversation send path. Ordinary skills and routines retain their existing gates.
The single main-window RPC `computer.teach` has a named Rust allowlist entry and
test; it exposes no raw action-upload or arbitrary capture endpoint (A-03/06/10/11).

## Connected-app event routines (2026-11-01)

Migration 49 extends routines with a mutually exclusive when specification and
poll state, plus routine_receipts for baseline ids and pending/fired receipts.
members/events.py runs on MembersService's existing scheduler, without a model.
It resolves current offered tools, connection association and read classification
through the shared hub, then invokes ToolGate.call_plugin. Managed Composio reads
must contain exactly one enabled tool belonging to the selected connection;
another linked app's grant cannot satisfy that association. No RPC is added.
The existing routine tools, history, task engine and worker safety state carry
matches as untrusted external data. A deterministic per-item task session recovers
the interval between committed task submission and its receipt write without
submitting a second task. Baseline and pending item data persist in SQLite.
Event routines have no clock occurrences in the Calendar.
Tests: core/tests/members/test_events.py, test_event_harness.py (API/CLI),
core/tests/brain/test_db.py and the existing member/routine suites.
Offline tests and fixture scenes do not prove real provider result shapes, remote
pagination completeness, native persistence or live model choices.

## Owner-PC command boundary (2026-11-01, narrowed 2026-11-13)

Since 2026-11-13 (R-PC-01) the owner's PC is in reach of a quick question alone. The one switch is
`take_snapshot(owner_pc=...)`, set from `AgentService._owner_pc(ask)` (`ask.quick`, not nested): without it no
snapshot lists, finds or refreshes into `local__local_exec`, `local__local_job`, the harness `computer` tool or a fixed
command, so API turns, the CLI MCP server, rooms, exchanges, phone messages, tasks and routines have none in any permission
mode. `LocalTools.call` refuses every other context, the fast router is asked for a quick question alone, and the prompt of
every other turn carries no owner's-PC words (`persona._OWNER_PC_RULES`). A conversation's work that needs a computer
is done on the member's own computer. What follows describes the adapter as built.

`computer/local_tools.py` wraps the existing `VmTools` hub with two pinned tools:
`local__local_exec` and `local__local_job`. Production API snapshots, authenticated
CLI MCP and worker snapshots share the adapter, ToolGate, SettingsStore,
Confirmations and metadata-only tool_audit. No shell implementation lives in the UI.
The existing shared permission card renders local consent and commands in chat and
background questions. Persisted cards retain existing app/step kinds; the view
exposes local_access/local_command. A chat expiry of zero means no timer throughout
the core and shell; background local questions use 1800 seconds, including the CLI
bridge's own waiting future. The main window holds no-timer consent; it is not an
overlay prompt. External chat answers cannot approve.

`local_host.py` is the Windows adapter. It uses the existing Child Job Object/tree
cleanup, worker_environment filtering and no-window spawn. PowerShell has no profile,
is noninteractive, uses UTF-8, closes stdin and defaults cwd to the owner's home.
Each stream retains at most 10000 bytes plus a truncation marker. Nonzero exits are
results; timeout and host errors are separately audited. Background jobs retain
bounded live stdout/stderr, belong to one conversation/member or task and cancel on
session/task stop or app close. They are process-local and never resume after restart.

The local setting is independent of the sandbox computer and the global tool
mode. Always does not bypass explicit command approval for dangerous patterns,
opaque scripts/subscription CLIs or a turn that consumed outside content. Secret
store patterns refuse even an explicit approval. Patterns are best effort, not a
shell sandbox. Hermes patterns are adapted offline from c419cf7c under MIT with
the notice and license retained. The exact command is persisted only in its card;
public progress and audit retain operation metadata only. Driver discovery removes
session from offered and validation schemas and rejects runtime session injection.

Offline tests cover fake API/CLI models actually calling the tool, worker and routine
approval/resume, scoped jobs, cancellation, environment filtering and harmless
read-only PowerShell. Docker, native shell, real subscriptions and live model tool
selection remain separate acceptance boundaries.

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
| A-02 | Work tools and app management tools are offered to every speaker alike in the owner's private conversation, Raphael and each member (owner, 2026-11-08: every member has the same abilities), found through `find_tools` and called through `use_tool` (the request never changes the fixed tool list, owner 2026-11-09 decision 2), and checked again where they run; destructive actions keep the owner's yes card, and groups, colleague exchanges and nested requests never gain management through it. | pytest | core/tests/architecture/test_boundaries.py::test_every_owner_private_speaker_has_the_same_management_and_work_tools |
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
`MemoryService.snapshot` is what a turn reads, once, at its start, and it comes with the
turn's message for every brain (2026-11-10, see "Prompt prefixes a provider can cache"): an
API brain's system prompt holds the memory's rules alone, and a CLI's session gets the files
whole at first and then their edits. `memory/brain.py` runs the reflection pass, the consolidation and folding on
the selected member brain; CLI uses the production CliLoop with no tools and a separate
ephemeral session. `memory/legacy.py` moves what the row-per-note store left into the files
at every start until none is left, and backs it up under `bot-state/<id>/notes-backup/`.
There is no review queue: `memory/scan.py` refuses instructions and secrets, a turn that
read outside content writes only marked entries, and the reflection pass reads only the
owner's words of such a turn. Reads never call notification or mutation paths (A-01).


## Prompt prefixes a provider can cache (2026-11-10)

A provider reads a request from its cache only as far as it begins like an earlier one:
tools, then the system prompt, then the messages. One changed byte is paid for again, with
everything after it. So a system prompt says who the speaker is and how it works, and
nothing that changes between turns (owner, 2026-11-09). What holds for one turn comes with
that turn's message: the memory files and the team as it is now (`build_user_message`'s
`standing`, after the conversation so far, whose start is so cached as well), who is asking
(`CONSULTED`), the guidance one request needs (`LEADERSHIP`), and for background work the
team and what the one task must deliver (`background.service._execute_scoped`). A CLI's
own session gets the team and the files as sections, whole at first and then their edits
(`agent/cli/context.py`). The owner's permission mode and a new member's first-job note stay
in the system prompt: they change seldom, and a rule a whole turn obeys belongs with the
rules. The tool list is fixed per member (decision 2), a Claude Code member has one working
directory (decision 3), a named conversation stays on one OpenRouter upstream and names
itself to ChatGPT (decision 4), and Anthropic's markers (`brain/prompt_cache.py`) keep the
system prompt for the conversation's lifetime and the messages five minutes (decision 1).
Tests: `core/tests/agent/test_cache_sessions.py`, `core/tests/background/test_task_prefix.py`,
`core/tests/brain/test_prompt_cache.py`. They prove what is sent, not what a provider
bills: the hit rate is read from the usage ledger after real turns.


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
execution (A-01/A-03/A-04); native CLI memory remains disabled; assigned native skills follow Shared installed skills below.

## Single sidebar (owner decision 2026-10-30)

`main.ts` mounts the agent-owned member column once in `sidebar.ts`, outside the
page container. Dictation, calendar and conversations share that one DOM
and the existing MembersShell, member actions, groups and rooms RPCs. There is
no Team page, route or spatial canvas. Chief swapping remains `memberDisplayList`.
Details owns the member brain picker. The Everyone room uses `is_team` and follows
the current roster without duplicating members or a conversation loop.

Owner identity uses existing `owner_name`/`owner_photo` settings, the shared avatar
picker/cropper and bounded image conversion. Sidebar footer and outgoing messages
consume `owner-avatar.ts`. Settings > Connections is the sole connected-app entry.
The account menu's 行事曆 is the full calendar entry (Home's mini calendar was before 2026-11-12). Migration 44 adds room pin,
hide and read-message position to the existing rooms table; `rooms.list` resolves
previews/unread from the same visible messages, while `rooms.update` saves actions.
The mock IPC boundary projects those same summary fields from fixture messages.
Conversation-row selection also requires the agent page to be visible; hiding it
redraws the shared column immediately without losing the remembered conversation.
Composite faces keep their own round backing and a 2px surface-coloured separator;
only that group context frames Raphael's otherwise bare emblem.
No new RPC boundary, settings registry or provider loop is introduced (A-01/06/08/11).

The calendar page keeps its visible month in page state, requests month-scoped
home.overview data, and uses the shared monthDays local-date grid. It sends a
CalendarDate through the existing app.go boundary to the full day calendar. The
projection retains the bounded seven-day preview and adds compact month date marks
and connected events. Horizontal wheel/touch navigation uses a finite 160ms slide
and respects reduced motion.

## The app's own calendar (owner, 2026-10-31)

`own_calendar.py` holds the one thing in the app that can be changed by hand: one-time
events in the `calendar_events` table, a timed one as two instants and an all-day one as
two local dates. The window's `calendar.*` RPCs and the `calendar_*` tools share its one
check. `home.overview` stays the sole projection for the Calendar page (Home, its other reader, was removed on 2026-11-12, and with it the model-written daily line, the health check, the charts and the allowance, spend, dictation and status figures), and adds
own events to what it computes; `HomeOverview.between` serves a member's `calendar_list`
from the same sources. Tools are offered on every path through `take_snapshot`; the API
and CLI turns reach them through `_harness_call`, a background task through
`TaskRun._lookup`, with the same screening at T1. `calendar_google` says what Google is
(connected, not connected, unreadable) so that none of them reads as an
empty calendar. Everything else the app shows is computed and gets no tools.

The final calendar uses a size container: 900px width plus 460px height selects
the full event-chip month; smaller containers use mini month plus selected-day
agenda (stacked below 680px). Both read the same bounded three-items-per-date
projection and daily counts. Month controls stay outside the animated grid and
six rows prevent month-to-month height changes. A compact date changes page-local
selection; full-grid dates and all event links navigate through the existing app.go
CalendarDate/CalendarEventFocus boundary. Calendar highlights the requested item.

## Computer host transport (2026-11-01)

Layer 6 (2026-11-12, R-COMP-PICTURE-01, R-COMP-KEYS-01, R-COMP-XLOSS-01, R-COMP-LAYER-01):
image `driver-0.37.0-v6`. Three things changed in the image and one in the core, and layer 5
joined 3 and 4 as a shape `known_previous` recognises (one screen that says its count,
3 GiB), so every released computer rebuilds on its next start and keeps its workspace.
The desktop's picture has one starter: `LocalVm._wallpaper`, at the end of a start that
found the computer ready, ends any `wallpaper.py --watch` and starts its own, with the
owner's JPEG when there is one; the session's `prepare-desktop` no longer starts a
watcher, and the image carries `librsvg2-common` so the town's SVG is drawn (its build
checks for the loader). What was started is remembered per computer together with the
picture's time and size, and forgotten when the computer stops or is restarted. The
helper `screens.py`, for any number of screens and before the ready mark, sets one
workspace and unbinds the keys that act on the whole desktop (and, with more than one
screen, those that reach every screen or start a program), after waiting for the session
to have copied its default keys. In its supervising loop it looks at the X server's
socket every two seconds without starting a process; a server that is gone takes the
mark away for one screen as for six, and the 20-poll restart described below brings the
computer back. In the core, `record_repair` only counts: nothing announces a repair.

Stage A (2026-11-11, R-COMP-SCREEN-01): image `driver-0.37.0-v5`, layer 5,
adds the standalone stdlib `image/desktop/screens.py` supervisor helper. It waits
for X, disables XFCE display prompts, authenticates to main VNC using pure Python
DES, and creates 1..6 real outputs through RFB ExtendedDesktopSize. A 1x1 update
request carries the layout reply; only a successful new layout moves the pointer
to the centre of screen 1 on that same connection. Matching monitors skip both.
The row-major grid uses 1280x900 cells (1x1, 2x1, 2x2, 3x2); the host's canvas calculation is
held equal to the helper by an offline test. Panel 1 retains its launchers;
additional panels use unique plugins and pre-owned launcher directories. Multiple
screens disable only xfwm4 dock shadows, writing only when different and without
restarting the panel for that property; window frame shadows stay unchanged.

Only port 6901 is published. Token websockify serves the noVNC assets and routes
`/websockify?token=screen-N` to a loopback clipped `/usr/bin/X0tigervnc` on 5911..5916.
The helper starts this real binary in the foreground, not Debian's detaching wrapper.
For one screen, screen-1 routes directly to main VNC on 5901. There is no token
for the multi-screen canvas. The helper atomically publishes owner-only tokens
at `/run/user/1000/raphael-vnc-tokens`, then `/dev/shm/raphael-screens.ready` on the
fresh-per-start tmpfs, and supervises the clipped servers. The mark says this boot's
screens are set up (layout, panels, every view listening once). It is about the screens,
not about a view being connectable at this instant: it stays while a view or the helper
restarts, because the members' work needs the screens, and a viewer reports a refused
connection itself (`viewer_unreachable`). The helper takes it away only when the layout
is gone (a view exits and the monitors no longer match, or the X server does not answer)
and then sets everything up again. Supervisor never gives up on the helper
(`startretries`), since a FATAL program can be started by nothing here.
Before views start, even for one screen, it ends leftover X0tigervnc processes
and waits up to five seconds for 5911..5916 to stop listening. Listener checks
parse `/proc/net/tcp` without unauthenticated VNC connections. Debian's Python
runs the standard-library-only helper without dependencies from `/opt/venv`.
Supervisor lacks CAP_KILL and only restarts programs that exit; the helper ends
its own children. Nothing may call `supervisorctl stop` or `restart` in a computer.
LocalVm folds the tmpfs mark check into its driver-version exec, retaining two probes;
that exec's exit code tells "driver healthy, mark absent" from "driver not up yet". A
running computer still in the first state after 20 start polls is restarted once, under
the guards of the missing-socket repair. The layout request has one 15 s deadline for the
whole RFB conversation and refuses a payload larger than a one-pixel request can bring.
A `Target` refuses a screen outside 1..screens..6 where it is made.
Targets carry screen/screens with defaults 1/1; viewer preparation passes the
captured screen to the relay. SSH still probes `/vnc.html`, which needs no token.
Recognized layers 3 (2 GiB) and 4 (3 GiB), without RAPHAEL_SCREENS, may rebuild
to layer 5 under the existing ownership, compatibility, hold and activity guards,
preserving the workspace. One function (`known_previous`) knows those shapes: start
upgrades through it, and stop, restart, update, repair, reset and member-data deletion
treat such a computer as this owner's own before it has ever been upgraded (deleting its
data needs neither the new image nor a start). Both existing target modes remain 1/1; member assignment,
leases, browser behavior and the default mode are outside this stage. Offline
tests do not prove actual TigerVNC, XFCE, websockify or container readiness: the
container acceptance of 2026-11-12 is recorded in the member-computer feature file.
The image also carries `wmctrl`, for placing a member's window on its own screen
in the later stages (Chromium opens each new window beside its first).

`computer/vm.py` owns the single Docker argv boundary for local and SSH engines,
including `vm_bridge.py` MCP stdio. Targets capture their transport so a settings
change cannot redirect an in-flight operation to another host. New per-member
remote target keys include the alias; stale tool routes fail closed. SSH aliases
are validated in settings and before argv construction. Remote workspace and team
storage are engine-owned named volumes; compatibility checks compare volume names,
never Windows `Path.resolve()`. Attachments still traverse the bounded guest read.
`ssh_tunnel.py` forwards only a validated private container address to a random
IPv4 loopback port, with noninteractive SSH and managed process cleanup. Viewer
session expiry/close, container stop and VM shutdown dispose of owned forwards.

`LocalVm.mode` decides the computer's kind: a saved `computer_vm_mode` wins; with none saved it is `shared`
(one computer, a seat per member) on this PC and `per-bot` on a remote host, where shared mode has not yet
been run. The paragraphs below describe the per-bot kind. The existing lease and
per-target lease remain authoritative. A serialized local start checks owned
compatible running containers, retains last-use order, and stops only an idle
computer to make room; held or active computers yield local_capacity. Remote
computers skip idle sweep and local capacity limits. Native journey teardown
removes its own container by exact target after validation, retaining workspace.


## Durable owner input (2026-11-01)

OwnerQuestions stores nonsecret question/card references and a conditional final answer.
Its partial unique index permits only one unanswered question per worker task. The
existing Stop("waiting"), Waiting, worker messages and worker_tasks.continuation
release the carrier and persist the continuation, counters, cost, declined tools,
seen URLs and untrusted-content marker. An answered question conditionally queues
that task once; unanswered questions remain waiting through restart. Crash recovery
never replays uncertain running effects.

AgentService supplies the existing connect, secret, draft and page services to the
worker through a limited callback. It returns only card completion metadata, never
secret material. Room work projects its waiting turn into room_messages and uses
shared room notes without private history or member memory. Draft revisions use
the originating room and thread, and private draft lookup excludes room turns.
Background snapshots
explicitly add read-only find_app, owner cards and own-member routine tools, without interactive=True.
find_app uses the same catalog service and T0 gate as interactive discovery, opens no
question and grants no connection. connect_app still waits for the owner to sign in,
even in full-permission mode. The same task resumes with freshly offered app tools.
Shared worker persona rules guide Raphael and named members through that discovery
and owner-card path; they no longer prohibit all owner questions.
The native allowlist exposes owner_questions.answer; it grants no execution approval.
API and CLI/MCP conversation questions transfer the same turn to this worker rather
than retaining a CLI process. All question states reuse the conversation card component.


## CLI recovery after recorded work (2026-11-01)

`agent/cli/loop.py` remains the single CLI engine used by AgentService and
`background/cli.py`. A loop retains its latest native session even for turns that
must not persist a conversation session. Its in-memory receipts record MCP tool
arguments, bounded model-visible results and owner-card answers; native stream
steps retain their status. Matching is scoped to each attempt so a later success
cannot certify an earlier uncertain operation. A retry waits for an in-flight MCP
call to settle before taking its context snapshot. Recovery requests carry the
original task plus all accepted owner additions and treat receipts as untrusted
data. The harness starts a new CLI request, never a tool replay.

Post-action recovery uses the existing RETRY_WAITS and PATIENT_WAITS once each,
with shared jitter and provider cooldown handling. This is finite (eight attempts
at current defaults), unlike the API loop's indefinite patient tail. Before any
action, existing private/background quick waits and the explicit no-retry option
remain in force. Child EOF/incomplete reads use cli_stopped while retaining the same bounded retry admission (owner, 2026-11-05); protocol
errors remain terminal. Each post-action wait is localized progress. Permanent
failures and cancellation stop on the same model and billing source. Terminal
summaries expose counts/status only; exact receipts stay out of public events.

Post-action means acted (R-CLI-08, 2026-11-11): a call that succeeded and was not a read, told
by the signal the conversation already keeps (`ask.made`, from `gate.reads_only` and tier T0; a
task's `TaskRun.acted`), or a command or file change the CLI started that no MCP receipt
accounts for. A turn that only read takes the quick waits. A private CLI turn passes `stall_s`
and `tool_s` to `CliLoop` (R-CLI-09): `_events` ends the attempt after 1,800 s of silence
(7,200 s while a call is out, no clock while the owner's yes is awaited); a stalled CLI is asked
again once, and never after an action or with a call out. Tasks pass neither: `TaskRun.watch`
is their watchdog. `Driver._read` gives up after 3 h in any case.

No RPC, Rust allowlist entry, migration, new worker, settings or frontend is added.
Tests use generic fake CLI subprocesses and the existing authenticated MCP/gates.
Real CLI subscription/service recovery and native UX require separate acceptance.
## Group discussion contract (2026-11-01)

Room roles are metadata, never a scheduled speaking plan. API, CLI and background
tool definitions and roster prompts follow R-AG-02: everyone reads every message
and decides whether to speak; explicit addresses are answered. room_meeting reuses
the exact membership with the current chief and posts only the agenda. It adds no
addresses, rounds or automatic conclusion. Concrete assigned work retains the
shared handoff gate and completed-work report path. Legacy meeting columns remain
in SQLite for compatibility and confer no tool or speaking restriction.

## Conversation connection proposals (2026-11-01)

integrations/proposals.py owns the editable proposal state in migration 53 (52 is reserved by another worktree). It validates public fields through integrations/config.py, stores secret names only, tests through the existing McpConnector, enables through IntegrationsService and resumes the original turn through AgentService. SecretCards may defer task resumption until the proposal is enabled. Revision plus tested configuration/tool digests reject stale confirmation. The existing connector RPC wrapper supplies locks and redacted errors for managed app mutations.

Snapshot.refresh_plugins rebuilds the current offer before each API model step and authenticated CLI tools/list. The worker receives replacement definitions with the model turn; the gate independently checks current grants on execution. Background owner waits reuse OwnerQuestions, release the worker and settle with completion metadata only. The private and room timelines share mcp-proposal.ts and the existing connector-card controls.

After a CLI tool result changes the offer, the existing catalog-change restart carries completed results into the same task and makes the native CLI read the current list. Refresh preserves the CLI's native approve and cli_permission definitions.

Migration 52 installs login cards and computer_logins before migration 53 installs connection_proposals; schema contracts include both. No live, provider or native acceptance is implied by fixture evidence.

## Moving routine triggers (2026-11-01)

Schedule JSON extends the existing registry with monthly day and every minutes, without rewriting routines. The Calendar retains R-CAL-03 rhythm projection; the bounded month projection now covers the five-minute minimum. MembersService advances skipped schedule slots while its existing TaskStore says that same routine has queued/running/waiting work.

The internal routine_webhook_port setting reuses SettingsStore, with no UI switch or migration. The listener rebinds that port across restarts; only address-in-use permits a random replacement and address_changed notice. members/webhooks.py owns the lazy loopback asyncio listener, exact-body HMAC, bounded requests, rate admission and vault-only per-routine secrets. App passes its existing OS vault. The existing when_json stores only {webhook:true}; polling ignores it. Shutdown cancels only its own clients and closes its own listener. POST feeds wrap_untrusted into the existing member/background engine. No relay, tunnel, public listener or provider is introduced. routines.webhook is an owner-window RPC on the Rust allowlist; model tools never expose its secret.

Migration 55 appends routine_runs.trigger_json, preserving saved routines and existing run fields. AgentService projects the immutable trigger into history. The frontend's routineSentence feeds the panel, editor, calendar detail and transcript; the transcript opens the existing editor. The event catalogue contains words/toolkit/slug and small read arguments, never paths. routines.list and member routine_list share one gated pick operation. connectors/response.py shares calendar envelope decoding while retaining its full raw path. Pure breadth-first detection continues past unidentified lists and supplies an ordinary when; an explicit empty field/equals filter matches each new item without changing receipt/baseline/queue behavior. No new RPC or table is needed. Only ACTIVE connections are offered; failures create no routine.

Optional event.since stores only the read argument name and ISO format. EventPoller copies the arguments, fills the previous check minus five minutes in UTC (now on the first poll), and classifies/checks that exact call through the existing gate. Composio fills the single nested tool's arguments; other reads use their ordinary argument object. Calendar discovery uses ten existing events without updatedMin; saved polls use fifty with the moving window. Empty windows are successful checks. No since means unchanged argument handling. Stored when, baseline receipts, deduplication and truncation refusal remain intact.

Suggested routine cards also consume routineSentenceHTML. Generated webhook credentials reuse the existing masked field/sc-field and lock icon, with read-only Show/Hide/Copy controls. Copy leaves unchanged form nodes intact; rhythm details show the trigger once. Removing a member synchronizes the listener and removes the deleted routines' vault entries immediately.

Review 3 cold-catalogue correction: ConnectorsService.ensure_tools uses the existing _load_tools and _tool_catalog, with a toolkit lock to share concurrent initial loads. EventPoller.read is shared by pick and poll: for a managed Composio entry it ensures the catalogue before the ordinary _tool classification and gated call, all under one wait_for deadline. Non-Composio reads skip catalogue loading. Load exceptions reach the existing transient poll backoff; only a completed preflight refusal returns None and takes the existing stop path. No new read policy, calendar exception, RPC, migration or stored routine field is introduced.

## Responsive computer boundary (2026-11-04)

computer/vm.py owns the 45-second ready-target confirmation and invalidates it
against lifecycle/host/timezone changes and observed failures. The hot path never
takes capacity_lock. vm_tools.py keeps the existing gate, per-target action lock,
screen lease, private-page redaction and takeover boundaries, and adds only
the browser_open composite to its shared registry. No second worker, RPC, setting
registry or model loop is introduced (A-01/A-03/A-04/A-08).

The checked-in driver_schemas.json is the pinned driver's own tools/list for the
offered tools, captured from a running computer: it is the offer before any driver
is asked. vm_catalog.definition reads it and a running driver's list alike, so
driver discovery, which runs on an owned background bridge after actual computer
use, changes nothing for the pinned driver and takes another driver's list in the
same production snapshot (R-COMP-DRIVER-02). A computer tool's description is
Raphael's own line on what the tool is for, then the approval rule, shown whole.
The persistent action connection retains its session and receives the image/cursor
configuration once.

vm_bridge.py serializes writes only; one reader resolves pending request IDs.
Screen reads get 120 seconds, actions 60. Cancellation closes only that owned
stdio process, fails pending requests and invalidates confidence; no uncertain
action is replayed. New v5 computers retain the v4 3 GiB memory/swap cap (not a reservation)
and two CPUs with two local slots. A third start evicts only the least recently
used idle computer; active and owner-held computers remain protected.
Offline tests establish contracts, not container latency or driver compatibility.


## Shared installed skills (2026-11-04)

MemberCapabilities remains the one skill/command store. skill_library.py adds
bounded local snapshots and internal shared scope to that same store; SkillHomes
maps shared packages beside shared USER.md without broadening BotHomes bot-write
allowlists. Migration 61 stores per-member shared grants. Existing members.skills.*
RPCs carry shared/discover parameters; no RPC, native allowlist, settings registry,
worker or brain loop is added (A-01/A-03/A-04/A-06/A-08).

Installed-source discovery reads SKILL.md and plugin manifest metadata plus bounded path/size/mtime
fingerprints, never package bodies. It skips dependency/hidden directories and
prunes discovery below skills. Plugin identity excludes the cache version; SemVer
then version-folder mtime selects one source. Import validates that source under
an installed root and snapshots only its selected package. Source-change checks
resolve sibling versions without rediscovering unrelated caches; re-import updates
provenance while preserving the existing skill ID and grants.

Generated native Claude plugins copy only assigned skill folders and use the normal
configuration directory, empty settings sources, disabled hooks and no native
command tool. Claude Code manages its own login and refresh; Raphael never reads
Claude credentials or injects an OAuth token or private configuration directory. Codex
keeps its isolated home and disabled host discovery/native shell, with explicit
skill input and enabled path configuration. API and background skill scripts use
the existing local command gate. Import itself never executes code. Offline fake
protocols and synthetic file tests are not live or installed-CLI acceptance.

## Shared speaker capabilities and private self-work (2026-11-04)

agent/capabilities.py owns the shared capability statement and the reasoned exception
registry. Persona builders consume it for API, CLI and workers; the real production
offer tests compare complete tool definitions after excluding only named coordination
tools. The same speaker profile reaches the quick answer and worker/routine prompts.
TeamContextSnapshot retains the stored role and adds coordination_duty separately.

A foreground private self-handoff uses BackgroundService.handoff and TaskStore.accept_handoff,
with the existing asker continuation, stage/outbox/inbox and cancellation tree. The worker
turn is private in the source conversation rather than Conversations.main; ordinary
colleague delegation and room report routing retain their existing semantics. A task
cannot recursively self-handoff. The assignee's selected model still wins. No new loop,
RPC, provider, permission bypass or migration is introduced (A-01/03/04/06/08).

Raphael's draft preference is raphael_draft_first in the single SettingsStore registry,
default true; members.update accepts only that preference for identity 0. The details
panel uses the same switch and words for all members. Worker reports share the member
text contract; the existing fit_text projection derives the quick overlay caption.


## Routine test and saved timezone boundary (2026-11-05)

The explicit main-window `routines.run` allowlist entry calls MembersService._run
with manual admission; it shares the existing background worker, routine_runs,
agent history/conversation routing and spend. It neither enables paused schedules
nor advances next_run. Frontend routine-run.ts keeps pending state and observes
the existing routines.runs projection until finished, including confirmations.

Schedule JSON gains validated optional IANA timezone metadata; the shared registry
adds routine_timezone and internal routine_detected_timezone. Owner-window
members.viewing reports the detected zone and pins legacy schedules before future
zone changes. The calendar projection remains read-only. Existing schedule parsing/next_run and the
calendar occurrence engine own saved-zone/DST behavior, with no separate scheduler.
The shared timezones.ts selector uses ui.ts popovers and the existing settings.set.

Event filters add an optional literal contains operator for Slack text after the
existing selected-channel read; shared routine tool schemas retain the production
gate and baseline receipts. The loopback webhook listener accepts its existing
vault key via constant-time Bearer comparison as well as HMAC. Recipes describe
user-managed HTTPS forwarding and provider payload fields without provisioning
cloud infrastructure or storing a second provider credential.

## Plugin sets and marketplaces (2026-11-04)

Migration 62 adds skill_sets/skill_marketplaces and component ownership columns to
member_skills; rooms 60 and grants 61 remain unchanged. skill_plugins.py owns
manifest parsing, bounded HTTPS reads, commit pinning and shared set lifecycle.
The existing members.skills.list/import/delete RPCs carry these operations through
api.ts. There is no new native allowlist, model loop, worker or settings registry.
A fully validated generation is staged under shared/skill-sets before one database
transaction replaces its pointers. Stable component paths retain IDs and grants;
removed components trigger the existing grant cleanup. Existing local single-skill
imports remain available and plugin components are edited through whole-set refresh.
Commands become documents in that same store, preserving slash discovery, skill_read
and assigned native skill delivery. Native guidance escapes automatic shell
substitutions and resolves plugin-root references to the owned set; it never loads
the source plugin's MCP/hook/agent configuration. Scripts retain ordinary approval.

Marketplace records cache the explicit owner-requested catalog. Refresh checks for
newer listed versions; normal member reads perform no network. Source strings and
GitHub/url/git-subdir declarations resolve to an immutable commit before reading
manifests and downloading the selected regular-file subtree. Redirects, truncated
trees, path aliases, links, file-count/byte limits and mismatched versions fail closed.
MCP values are never returned: only public fields and secret names feed one existing
mcpProposalHTML card per server. Its explicit setup action opens the existing custom
MCP form and test/save path. Import, listing and card rendering never connect it.
The UI keeps one Skills section, groups shared rows beneath their set, and adds
marketplaces to the existing import dialog. Tests use only tmp folders, fake HTTP
and fake CLI processes; native/live/provider acceptance remains separate.
Skill source rendering uses skill-source.ts in member resources, Connections rows,
discovery and document dialogs. skillOriginLabel owns the single localized origin
and learned date line; skillSourceLabel removes transport prefixes and collapses
plugin cache paths to name/version. Stored source identifiers remain unchanged.


## Colleague recipes, accounts and tunnel probes (2026-11-05)

MembersService owns the main-window-only members.template RPC. The allowlisted recipe codec never reads memory, credentials, pictures or model settings; it validates bounded data before mutations. MemberCapabilities remains the skill writer and MemberStore remains the routine writer. Import grants no app tools and schedules no runs. Existing member creation, AgentHistory greetings, ownerQuestionHTML and the existing sendFromPage composer path supply the local greeting form; NEW_MEMBER_STEP stays next to the owner input. There is no second model loop (A-01/03/04/11).

ConnectorStore keeps account labels in its existing accounts rows. The owner-only connectors.label RPC updates one current account; refresh preserves names by account ID and copies only a returned public email. IntegrationsService projects these labels to members and connections_list. The shared persona instructs account disambiguation. No token or provider auth blob crosses that projection (A-05/12).

An account row of a Composio app may carry `since`, the time a sign-in began, and only while it waits (INITIALIZING, INITIATED). ConnectorsService gives such an account back (DELETE at Composio, and off the list) when its flow ends without success, and a read of the accounts (`connectors.status`) gives back any older than `SIGN_IN_LIMIT_S` that no open flow is waiting for; an ACTIVE account is never given back this way. The owner-only `connectors.remove_account` removes one row (a connected one is revoked first; the last connected account is `connectors.disconnect`). `integrations.connect_cancel` ends a managed sign-in as well as a built-in one, and the window cancels before it starts another (R-ACCT-01, R-ACCT-02).

LocalVm creates the three team directories on the existing shared mount when a computer first becomes ready, locally or through an exact remote mkdir command. Handoffs and requested wrap-ups can cite this shared contract; no new file store or renderer is added.

The existing routines.webhook RPC accepts an owner-requested URL probe. PageFetcher pins a public HTTPS address without redirects. A short-lived authenticated nonce reaches Webhooks._receive and returns 204 before admission or background work, including for paused routines. No tunnel subprocess is launched. Existing loopback binding, HMAC/Bearer validation, rate limits and untrusted body handling remain authoritative.

The main-window-only pick_output_folder and member_template_file shell commands reuse tauri_plugin_dialog. No webview-supplied path is accepted; recipe files are bounded text (UTF-8 or UTF-16, with or without a byte-order mark) and filtered to .raphael-member. The installer gives .raphael-member files to Raphael (bundle.fileAssociations): template_file.rs reads the file a launch or the single-instance handover names, keeps its text, and the main window takes it once through member_template_pending (the TemplateFile event only nudges it) to show the import review; show_template_export reveals a prepared publish folder by its 16-character id, which the core resolves (members.template, action folder). Native dialog and installed file-opening acceptance remain separate from IPC fixtures (A-06/10).


## Signed member store (2026-11-05)

members.template retains the sole owner-window RPC and raphael-member v1 codec.
members/member_catalog.py owns bounded catalogue HTTP, Ed25519, sequence/revocation
and verified disk cache. Imports refetch by catalogue identity and ignore caller
package bytes, then use MembersService, MemberCapabilities and MemberStore with
skills/routines off. Preview never creates a member, grant, routine or skill.
templates.py owns structural caps and scan locations without credential excerpts.
Review precedes native file save. Publish writes only an owned local export folder
and returns the prefilled GitHub URL through the existing openExternalUrl API; it also returns the folder, which the card shows.
The store is open only with a compiled public key (PUBLIC_KEYS is empty until the owner has made the catalogue and its key); without one it says so and never asks the network.
No new RPC, migration, settings registry, worker or brain loop (A-01/05/06/08/10/11/12).
catalog-template/ holds the future public repository's schema/scan/signing CI;
PRs never receive the signing secret. Production trust roots require owner setup.

## Shared owner vault (2026-11-05)

VaultEntries extends LoginVault at the existing Windows Credential Manager
boundary. Migration 63 adds nonsecret metadata/member grants and a durable payment
action hold; no value moves into SQLite. Existing per-member credential keys stay
readable and are projected into metadata without reading the OS vault. Owner-only
vault RPCs are enumerated in management.py and the main-window Rust allowlist;
no model management tool can read, import, edit sharing or delete credentials.

The existing VmTools adapter owns choices/contact/card fill tools, per-field
HTTPS/grant checks, driver-echo suppression and shared redaction. ToolGate's firm
confirmation applies to fill_card across foreground API, CLI and worker paths.
The ordinary conversation permission card and background question remain the
approval surfaces. No new model loop, worker, provider, MCP server, browser
service or feature-specific test harness is introduced (A-01/03/04).

The real Settings Safety pane owns the vault controller and uses shared controls.
The owner's file input reads a bounded CSV into a transient core preview with
a single-use token and ten-minute expiry; no source path/copy is retained. The
metadata preview is separate from private import candidates. Core RPC failures
return fixed field identifiers and counts, never secret-bearing exception text.

## Desktop security review (2026-11-05)

AttachmentStore.open_path is the authoritative native file-association boundary for
open_attachment and attachment_source. Its reviewed extension allowlist does not
restrict upload, opaque ID storage or bounded model readers. Unknown associations
fail before Rust receives a native path. Existing team-file read-or-reveal behavior
remains separate. This does not certify third-party document viewers or custom owner
file associations.

prepare-release-assets validates the version before writes. The existing publication
job resolves an exact existing tag to its commit (including annotated tags), refuses
a mismatch or API failure, and supplies github.sha as gh release create --target.
Signature/version verification in updates.rs and the pinned updater plugin remains
authoritative at runtime. No new RPC, provider, registry or execution engine is added
(A-01/03/04/06/08/10/11).

See ../skills/verify-raphael/features/security-boundary.md in the verification map for coverage, evidence,
remaining consent decisions and offline/native boundaries.

The shell drains oversized child-process lines without retaining their content:
stdout admits at most 64 MiB per JSON-RPC line and stderr at most 16 KiB per log
line, including the delimiter. Discarding a line preserves framing and emits only
a fixed diagnostic. The RPC waits for its existing timeout if its reply was dropped.
This bounds shell buffering; it does not bound all Python/provider allocations.

### Page composer boundary (follow-up 1)

mountPages now accepts only a place(pageId, text) callback. Neither HTML send nor
MCP ui/message calls an owner send or owner-question answer. The existing shared
composer owns append, focus and the localized page provenance note; its existing
draft store retains the page ID alongside words and quotes. Owner submission uses
the existing delivery or waiting-question controller. No new RPC, transport or
provider loop is introduced (A-01/03/04/06). Voice transcription leaves page drafts
unsent, and an expanded page closes back to the focused composer on placement.


## Offline storage security review (2026-11-05)

paths.local_storage_root keeps the lexical identity of local roots instead of accepting a
new trust root after resolve. LocalVm validates mounts on cached and fresh starts and again
before creation; DesktopViewer, member library scans and AttachmentStore use the same check.
Guest file reads retain their descriptor walk and no-follow checks. This is defense against
persistent redirection, not a cross-process handle-pinned TOCTOU guarantee.

VmTools rechecks captured targets and owner holds after preparation and checkpoint
awaits. file_reader bounds emitted Office text before joining repeated XLSX shared strings.
native_diagnostics reuses failures.scrub for complete quoted and Basic/Bearer credentials;
known secrets also cover JSON escaping and longest-first replacement. Existing state,
RPCs, OS vault keys and approval surfaces remain authoritative (A-03/A-04/A-05/A-08/A-11/A-12).
The offline review's owner decisions and evidence are in .fold/report.md; no network,
real credentials, native desktop or release acceptance is implied.

TaskStore also uses paths.local_storage_root for artifact receipt admission, completion
and opening. MAX_ARTIFACT_BYTES shares the existing 50 MiB opening budget across
all three paths before hashing bytes; no additional evidence store is introduced.

## Approved native and persistent security boundaries (2026-11-05 follow-up 1)

RemoteSession owns one SSH local Unix socket and its private temporary directory. The
owner-only ACL is applied before SSH starts; Docker CLI probes endpoint support, and
failure uses the existing per-command ssh:// adapter without a privileged TCP listener.
Viewer streams use SSH -W pipes rather than a general local SOCKS proxy; the existing
capability-protected viewer surface remains the only local viewer listener.

VmTools retains filled origins, refs and field meanings per exact page target/tab without a timer. Only a complete observation of that same tab showing a different HTTP(S) origin and no filled refs, or the private-picture probe's reply that the tab is gone (closed_private_tab: the two measured forms, an error for an attached browser and a non-error browser_tab_not_found refusal for a launched one), can lift its mark. Same-origin navigation, lost fields, incomplete reads and every other error fail closed. Whole means snapshot.complete with no continuation; the existing explicit whole legacy shape remains accepted. Reads and binds of other tabs cannot lift it. While any private page remains,
computer screen reads return value-free semantic nodes and a reason, without pixels.
Payment action holds remain independent and require explicit owner completion.

core_process feeds stderr through core_stderr before log::info. Bounded BufRead chunks
discard an overlong line completely, and a linear scanner ports failures.scrub patterns
without new dependencies or native-library imports into the core startup path.

storage.owner_only_directory applies a protected owner-SID DACL using existing Windows
APIs (0700 elsewhere). Both explicit/default app data and memory roots use it before
opening stores. Legacy migration's existing backup path records created-file identity,
mtime and digest in a local ledger; only unchanged tracked versions beyond five per
source are removed. Existing untracked copies and revision/undo journals are retained.
Shell/browser privilege separation remains a separate hardening unit (D03 in report).

First start-up (2026-11-11, owner: 「第一次開 app 的速度還是非常慢，就只有第一次而已」). The core is spawned
before any window (lib.rs); the windows are created and shown without waiting for it, and the window's calls queue
in the core's pipe until `core.hello` is answered. `__main__` starts a thread that imports the speech libraries
while the main thread imports the application and builds it, and joins that thread before the stdin reader starts
(numpy hangs if it first loads while stdin is being read; app.py). The window (`startup-reads.ts`) holds optional
reads until the first view is asked for and answered; `models.catalog`, `brains.cli`, the Connect apps lists and
the Settings read-ahead then run one at a time. `api.ts` reuses a shared read answered in the last 1.5 s while the
window starts up. `connectors.catalog` keeps its last list in `connectors-catalog.json` beside `connectors.json`;
`models.catalog` answers from the providers' saved lists (registry `_models`) and renews them in the background,
telling the window with `providers.changed`. Members carry pictures by revision: views have `avatar_rev` and
`cover.rev`, `members.picture` returns the data URL, `member-pictures.ts` caches by revision and `api.ts` puts
`avatar_url` and `cover.url` into every members answer, so pages read the same fields as before. The shell's
`members.picture` is in the main window's method list (commands.rs).

A member's computer needs no grant (2026-11-11, R-COMP-ACCESS-01). `computer/grants.py`, `request_computer`, the grant card, the panel's take-back button and `computer.revoke` are gone;
`VmTools.offered_for` offers every member its computer's tools whenever computer tools are on and a catalog exists for its target, and `LocalVm.full_permission()` (the 全部允許 mode) is all
that is left of the old check, for the checkpoint restore's confirmation. The table `computer_grants` (migration 45) stays in the schema, unread and unwritten, with its member-delete trigger.
The panel's computer row (R-PANEL-06) reads the viewer's state through `computer-row.ts`; the viewer publishes it and the details view draws it.
