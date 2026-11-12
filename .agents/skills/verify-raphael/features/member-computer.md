# Member computer (Phases A and B)

## Shared seats, stages B2 and C (2026-11-12)

R-COMP-SEAT-01 replaces shared mode's old one-screen rotation with one six-screen
container and durable first-use seats. Per-bot remains the default. target() does
not assign; screen 0 status describes the unit, viewer_url is empty and the relay
refuses its view with 403. VmTools.prepare and a real viewer open assign a seat;
previews and status do not. The seventh member evicts an idle least-recently-used
seat, disconnects its driver and closes its viewer tokens. The old route returns
computer_changed. All busy seats return the existing computer_busy notice with
"every screen of the computer is in use". close_displaced_seat_windows now closes all displaced screen windows except the
panel with best-effort wmctrl calls after disconnecting the old session. Deletion
holds seat_lock until cleanup finishes before releasing the seat; every close
rechecks the holder. Viewer opens and request/renew/control/peer entry points
recheck member/Target/holder after awaits and revoke stale sessions.

Physical lifecycle, locks, preparation, caches, capacity and idle time use the
unit on its host. Every seat must be idle and unheld for maintenance and restore.
Each seat retains its own tools, catalog, leases, driver connection/session,
viewer sessions, work and hold. Native input and every foreground driver call are serialized per unit, including
composite native substeps, browser_click/pointer and dialog accept/dismiss. Other
seats' background page calls, dialog inspection and reads continue during an owner
hold; foreground page/native input waits then reports computer_busy. Explicit
foreground always locks, including DOM routes; inspect has no implicit foreground. The held seat refuses all calls. Handback releases only that seat.
Shared kind uses six screens, 6 GiB and 4 CPUs; recognized one-screen layer 3/4/5
shared containers rebuild while keeping home and team mounts. Deletion releases
all hosts' seats without erasing shared storage and retains historic per-bot cleanup.
Dataset and teaching remain disabled in shared mode.

Stage C2: SHARED_ARGUMENTS classifies every offered driver's top-level and nested
property. Unreviewed parameters, target/from_zoom/capture_id/screenshot_out_file,
caller desktop scope and desktop coordinate_frame are refused. Fresh same-session
canvas rows check every window/pid and every page target's recorded native window,
including private-picture and vault helper reads. A moved target is revoked. A
centre-owned straddling or oversized window must be fitted and freshly confirmed
wholly inside its seat before reading or input; otherwise it is refused. All native
window-relative points and the straight drag path stay inside the seat, allowing
menus outside the window but inside the screen. move_cursor checks and offsets
seat coordinates. verify_state translates input bounds to canvas and observed_json
placements back. Driver tree/element_token prose stays intact; page replies append
one JSON line. Pointer prose and move summary use seat coordinates; click canvas
trailers are removed. Desktop pictures still use authenticated clipped screen-N
RFB, 1280x900 RGB PNG. AX/screenshot nodes remain window-local. launch_app moves
only new windows attributed by reply pid/launcher_pid or a pid without prior windows,
and filters/projects windows[] after movement.

The browser belongs to the computer. Layer 6 adds the existing-profile grant and
installs raphael-seat-browser. The launcher uses now-minus-before plus a unique
title-only data page marker and the main browser pid to identify this launch's
window, excluding disappeared windows and concurrent same-pid peer popups. It
places/maximizes the window and waits up to five seconds for settled geometry
(the measured panel height is 49 pixels). Each seat attaches with existing_profile,
binds, then browser_open navigates to the requested URL. Shared browser_prepare
normalizes profile/strategy to existing_profile and preserves delivery_mode.
Per-bot launch stays unchanged. Takeover checks the seat's non-command activity
and unit input lock; other seats' background page/read/command work continues.
Foreground page input waits/busy during the hold and resumes after handback.

Offline scope: tests/computer, tests/evaluate/test_computer_acceptance.py and
 tests/members/test_deleted_member_computer.py, with the repository Python,
worktree PYTHONPATH=core/src, RAPHAEL_TEST_MODELS=0, PYTHONUTF8=1,
PYTHONDONTWRITEBYTECODE=1, -q -W error -p no:cacheprovider. New seat-wall tests are in
test_seat_tools.py; RFB fake-server PNG round trips are in test_rfb_view.py. The
acceptance offline fake exercises every named shared check through real product tools,
using separate measured window-bind and tab-snapshot shapes. All driver doubles
validate the reduced measured fixture, with unknown top-level arguments refused
even where the live page schema allows extras. Classification coverage includes
nested properties; driver upgrades require fixture/table review. Vault fill calls
include the current tab_id resolved from the existing page read.

The maintainer runs npm run verify -- --computer on the final tree. Each per-count
block compares every DRIVER_TOOLS live parameter-name set to the pinned 0.37.0
fixture directly after driver connection. The shared block retains the two-member
lists/terminal/typing/browser/picture/control/disconnect/displacement journey and
adds: out-of-seat click refusal before dispatch with the real pointer unchanged;
desktop coordinate_frame and target refusal; seat-2 tree/token prose, one page JSON
line and pointer seat coordinates; satisfied seat-local verify_state bounds; one
workspace, peer mapped windows and own-seat focus after ctrl+F2, ctrl+alt+d and
alt+Tab; foreground browser_click blocked/busy during a peer hold while browser
navigation continues. Unrun dependent checks are explicit skips; successful detail
claims only observed behavior, and an inner shared failure fails the outer block.
--no-shared remains an explicit skip and IsolatedDocker guards guest/bridge calls.
The shortcut image changes and one-screen X-loss changes are maintained separately.

Clipboard, files and sign-ins are shared. Shell/browser still run as cua, but shared
foreground/background vm_exec removes DISPLAY: the shell has no screen here; use
launch_app for a window. Deliberate shell access restoration is outside this
accidental-input boundary. Offline
success proves no real image, driver, XFCE geometry, native timing, remote host or
native app panel behavior. The measured launcher panel height and result shapes,
window mapping delay, profile attachment/lifetime and frame strip thresholds must
be settled by the maintainer's real-container acceptance on this final tree.

## Image screen plumbing, stage A (2026-11-11)

R-COMP-SCREEN-01 covers image `driver-0.37.0-v5` (layer 5). RAPHAEL_SCREENS
selects 1..6 real VNC outputs in 1280x900 cells, with one panel per output.
The standalone stdlib helper owns RFB 3.8/VNC DES authentication, layout, panels,
atomic 0600 token publication and readiness, plus clipped-server supervision.
The helper is standard library only: Debian Python runs it without anything from
`/opt/venv`. Main VNC listens on 5901; multi-screen clipped views use the foreground
binary `/usr/bin/X0tigervnc` (not Debian's detaching wrapper) on loopback 5911..5916.
Before starting views for any count, the helper ends leftovers with
`pkill -x X0tigervnc` and waits up to five seconds for all six view ports to clear.
Listener readiness parses `/proc/net/tcp`, never opening unauthenticated VNC
connections that could blacklist viewers. Only 6901 is published, using TokenFile
routing: `/websockify?token=screen-N`. A single screen
routes directly to 5901; no multi-screen canvas token is exposed. noVNC's static
`/vnc.html` remains available for the existing SSH tunnel check. The viewer relay
receives the session target's captured screen. Readiness checks both the driver
and `/dev/shm/raphael-screens.ready` with the existing two execs; this tmpfs is fresh
on each container start. Tokens stay at `/run/user/1000/raphael-vnc-tokens`.
The mark says this boot's screens are set up. It stays while a view or the helper
restarts (the members' work needs the screens, and a viewer reports a refused
connection itself as `viewer_unreachable`) and goes only when the layout is lost: a
view exits and the monitors no longer match, or the X server does not answer; the
helper then sets everything up again. Supervisor never gives up on the helper
(`startretries`), and a running computer whose driver is healthy but whose mark is
still absent after 20 start polls is restarted once under the repair guards.
A computer of a previous layer is this owner's own for stop, restart, update, repair,
reset and member-data deletion before it has ever been upgraded. A `Target` refuses a
screen outside 1..screens..6; the layout request has one 15 s deadline.
Supervisor lacks CAP_KILL, so it only restarts what exits and cannot stop programs;
the helper ends its own children. Nothing may call `supervisorctl stop` or `restart`
in a computer. A newly set layout requests only a 1x1 update and, after status 0,
sends one pointer event to screen 1's centre on the same RFB connection. A matching
layout sends neither request nor pointer event. For multiple screens, xfwm4
`/general/show_dock_shadow` is false (created as bool if absent), written only when
different with no panel restart; window frame shadows stay unchanged.
Known layer 3/4 rebuilds preserve workspace and keep all compatibility, owner-hold
and active-use guards.

Existing per-bot/shared targets keep screen/screens=1/1. Member assignment,
leases, browser changes and default-mode changes are deferred. Offline scope is
`tests/computer` (including `tests/computer/test_screens.py`), using the
repository interpreter, PYTHONPATH=core/src, RAPHAEL_TEST_MODELS=0, PYTHONUTF8=1,
`-q -W error -p no:cacheprovider`. Offline tests establish contracts only: the
first tree passed 939 of them and failed in a real container seven ways (the
detaching wrapper, the mark outliving a restart, orphaned servers, supervisor
unable to stop programs, the neighbour's panel shadow, the tooltip on screen 5,
the connect probe). A change to `computer/image/`, the container's shape in
`vm.py` or the view path is not done until it has run in real containers.

Container acceptance of 2026-11-12 (the owner's Docker Desktop, a throwaway image
tag and data folder, production capabilities, through the real `LocalVm`; by hand,
now encoded in the opt-in `verify -- --computer` command described below):
- 1, 2, 3, 4, 5 and 6 screens start ready in 24 to 33 s with no helper retry:
  outputs `VNC-0..N-1` at the grid's rectangles, the token file, the mark in
  `/dev/shm`, N clipped servers as children of the helper on loopback only, one
  panel per output, no "Displays" dialog, no tooltip window (5 and 6 screens).
- Through noVNC on the published port every `screen-K` connects at 1280x900 and
  shows only its screen; no token, `bogus`, `screen-0` and `screen-N+1` are refused;
  the hash-form `viewer_url` connects; `/vnc.html` is 200.
- A click at (688,165) through screen 4's view maximised screen 4's window to
  1280x827 at +1280+924; the other screens' windows did not move.
- Pixel difference from the plain wallpaper is 0 along the top of the screen below
  a panel (was 4862 with dock shadows) and 0 at the top of screen 5 of six.
- `docker stop` / start: no mark from the previous boot is ever visible. A real layer 4
  computer (3 GiB, no `RAPHAEL_SCREENS`) reports `incompatible`, is rebuilt on layer 5
  and keeps its workspace and browser profile.
- Six idle screens with no viewer: about 0 % CPU, 425 MiB.

Measured again on the round 3 tree (same day, same way, after `origin/main` 704d3d74
was merged in), because the mark's meaning changed:
- 1 to 6 screens start with no helper retry and no repair restart (the one-pixel
  payload limit holds against the real server). The mark is written 10.5 s (four
  screens) and 15.2 s (six) after the container starts; the driver's socket at 6.5 s.
  The start poll's grace before its one repair restart is 20 polls.
- One clipped server killed: the mark stays, the view is back in 1.3 s. Helper
  `kill -9`: the mark stays, the new helper replaces the views at once. Helper
  SIGTERM: the mark stays, views back in 2.2 s. The X server killed: the mark is gone
  within 1 s ("The screen layout was lost"), the core reports not ready. After
  `docker stop` / start the mark appears about 10 s in and the start is ready.
- The core's own `DesktopViewer` and relay in front of a four-screen computer whose
  seat was set to screen 3: the viewer URL the app loads opened in a headless browser,
  its WebSocket through the relay answered 101 and the canvas showed screen 3 at
  1280x900.
- A layer 4 computer never started since the update: `maintain(update)` goes from
  `incompatible` to ready on layer 5 with its workspace file kept; `LocalVm.erase`
  removes its container and its folder.
Not covered: the app's own window around that viewer page, a remote (SSH) host, a
viewer that stays connected while its clipped server dies, and everything about
members sharing one container (later stages).
`wmctrl` is in the image for those stages: Chromium opens every new window beside
its first and the driver has no tool that moves one.

Round 2 offline evidence:
`core/tests/computer/test_screens.py::test_clipped_server_runs_the_foreground_binary_with_real_parameter_names`,
`core/tests/computer/test_screens.py::test_tcp_listener_parser_requires_the_loopback_port_and_listen_state`,
`core/tests/computer/test_screens.py::test_leftover_cleanup_kills_exact_binary_and_waits_for_every_view_port`,
`core/tests/computer/test_screens.py::test_leftover_cleanup_timeout_is_bounded_and_prevents_starting_views`,
`core/tests/computer/test_screens.py::test_views_preserve_boot_mark_during_restart_and_stop`,
`core/tests/computer/test_screens.py::test_rfb_handshake_authenticates_and_waits_for_its_own_layout_reply`,
`core/tests/computer/test_screens.py::test_helper_start_preserves_boot_mark_and_skips_matching_layout`,
`core/tests/computer/test_screens.py::test_multiple_screens_disable_only_dock_shadows_when_different`,
`core/tests/computer/test_screens.py::test_host_and_helper_share_the_fresh_tmpfs_readiness_path`,
`core/tests/computer/test_screens.py::test_image_installs_screen_views_and_preserves_the_single_token_port`,
`core/tests/computer/test_screens.py::test_image_build_context_has_no_bytecode`.

Round 3 (an independent review of the first commit proved six defects the offline
tests and the container run had both missed; each has a test that was red first):
`core/tests/computer/test_lifecycle.py::test_previous_computer_maintenance_rebuilds_without_starting_old_image`,
`core/tests/computer/test_lifecycle.py::test_previous_member_data_deletion_needs_no_new_image_or_start`,
`core/tests/computer/test_remote_viewer.py::test_old_remote_computer_of_a_previous_layer_still_upgrades`,
`core/tests/computer/test_lifecycle.py::test_missing_screen_setup_repairs_once_after_twenty_polls`,
`core/tests/computer/test_viewer.py::test_viewer_reports_its_connection_failure_independently_of_boot_mark`,
`core/tests/computer/test_screens.py::test_simultaneous_view_exits_keep_boot_mark_unless_layout_is_lost`,
`core/tests/computer/test_screens.py::test_target_rejects_invalid_screen_numbers_at_construction`,
`core/tests/computer/test_screens.py::test_rfb_layout_has_one_deadline_for_trickling_reads`,
`core/tests/computer/test_screens.py::test_rfb_rejects_oversized_skipped_payload_before_reading_it`,
`core/tests/computer/test_screens.py::test_supervisor_keeps_retrying_screen_setup_instead_of_entering_fatal`.

## Scripted container acceptance (2026-11-12)

R-COMP-SCREEN-01: from `app/`, `npm run verify -- --computer` requires an already
running Linux Docker engine. It never starts Docker, never runs implicitly with
`--core` or in CI, and builds only `raphael-acceptance/cua-local-vm:<run id>`.
Every container belongs to a fresh temporary data-directory owner. Cleanup checks
that exact owner label, then removes only this run's containers, image tag and data,
including after failure/interruption. Direct module `--keep` retains them for inspection.
The JSON check report is `computer-acceptance.json` in the verify run's folder.

The default counts 1,3,6 cover a single view, a grid with an empty cell and the
largest layout. Direct module `--screens 1,4,6` selects other distinct counts in 1..6.
Checks drive production start/status/stop/viewer, the image helper's grid/token/DES,
monitor/panel geometry, parented loopback view processes, token refusals, launcher
clicks with isolated framebuffer pixels, boot-mark timing, restart freshness,
clipped-server/helper recovery and X loss. The largest multi-screen target also
opens the real DesktopViewer last-screen relay and rejects an unknown session path.
A locally available layer 4 image additionally exercises start, maintain(update),
and erase with workspace files; its absence is a named skip. Engine absence exits
2, any failed check exits 1. Each check prints expected/observed evidence on failure.

Run this when computer/image/, vm.py's container shape or the view path changes.
Offline framing, authentication, parser and isolation tests live in
`core/tests/evaluate/test_computer_acceptance.py`; no Docker or network is used by
those tests. They establish contracts only. This command exercises the core relay;
the native app's own panel, remote SSH host, a viewer retained across a clipped
server death, and member seat/lease stages remain outside its acceptance scope.

First real runs (2026-11-12, this PC's Docker Desktop): the first found three defects of the
command itself that 179 offline tests had passed (guest paths built with the host's path type
on Windows; a terminal counted as two windows and placed by its frame-relative corner; a
picture check that compared a black terminal with the wallpaper, which is the night picture
at 03:00); the second found that a one-screen computer's panel names no output. The third,
through `npm run verify -- --computer`, is the result recorded in the pull request.

## Deleting a member removes its computer (2026-11-11)

Owner, after deleting a member in the app: the dialog asked whether to delete the member's computer too, and
ticking it hung. The app should know and do it, show nothing when there is no computer, and keep such things
out of the front end (R-COMP-PERF-12, R-UI-27).

What blocked: the old `members.delete` awaited `LocalVm.delete_member_data` before deleting anything. That
stopped the computer through the per-computer lock that `_prepare_start` holds while it waits for Docker
Desktop to launch (120 s) or pulls and builds the image (1800 s each), then ran up to five Docker calls of
15-30 s each, with no bound over the whole and a dialog that had already closed over an unchanged window.
With the engine off the same call raised `unavailable` and the member stayed. The core test
`test_a_computer_still_starting_for_the_deleted_member_does_not_hold_the_deletion` is that case.

The shape now: the dialog is the title, one sentence, Cancel and Delete (`members.deleteForever`), the same
component as every compact delete question; `members.delete {id}` takes no computer parameter. In the core
`MembersService._delete` reads the member's computers (`ComputerData.claim`: a record in `computer_data` or its
folder here; nothing is contacted), deletes the member and writes the removal as owed in the same
transaction, answers, and starts `ComputerData.settle` in the background (`computer/removals.py`).
`LocalVm.erase` stops the container only if it carries this app's owner and target labels, removes it, then the
folder or the host's volume; missing is success; the shared computer and foreign containers are refused. A pass
is paid at the first answer of an engine (`LocalVm.available` tells `ComputerData.engine_up`), on the monitor's
30 s tick and at the core's start, never starting Docker. Limits: 20 s to learn whether an engine answers,
120 s per computer, six counted failures from the timer, a host that does not answer at most every 10
minutes. Computers made before the record existed are found on a host by `LocalVm.recover` (its list of
owned containers) the next time that host answers; a remote volume left with no container is not.

Selected scenes (both themes, 1120,720,1920x1080): member-delete-ask (a member without a computer),
member-delete-ask-computer (one with a computer on a host), member-delete (the result), press-through-delete-dialog,
room-delete and quick-clear-confirm (the shared dialog). `member-delete-ask` asserts the member's name, one
sentence, two buttons, no row, switch or field, and no word about a computer; `member-delete` asserts the call
carries exactly `{"id":2}`. A real Docker engine and host are unverified: the tests use a fake engine.

```powershell
npm run look -- member-delete-ask member-delete-ask-computer member-delete press-through-delete-dialog room-delete quick-clear-confirm --theme both --width 1120,720,1920x1080
```

## Viewer transport isolation, phase 1 (2026-11-09)

`computer/viewer_relay.py` owns the loopback HTTP listener, both WebSocket pumps,
RFB gate, socket writers and teaching observation subprocesses on one dedicated
event-loop thread. Core retains sessions, VM/SSH resolution, SQLite, recording
files and ownership. Immutable revision/monotonic-deadline/control/teaching policies
cross a short threading lock; authorization and each write share that lock.
Session socket sets contain opaque IDs, never writers from another loop.
Close/revoke/revision changes publish denial before awaiting worker cancellation;
the relay independently expires connections even while core is blocked. Revoke
closes that member's viewer sessions but does not stop running commands or containers.
This supersedes the earlier exception for owner viewers under grant revocation.

Teaching captures privacy context before input on a read-only, relay-owned CuaBridge
using an immutable command resolved by core at recording start. Only the existing
accessibility/desktop observation pair is admitted. Privacy-checked immutable JSON
is queued back for core-owned, ordered recording persistence, without awaiting core
on the byte path. The queue is bounded (64 pending payloads / 4 MiB, with a small
full-state notification per overflowing recording); Stop disables new captures and
flushes prior captures/persistence before drafting. Owner/revision/expiry checks
run again before forwarding and before recording; close cancels outstanding capture.
The accepted-input counter increments only for actual forwarded input messages.

BOOTSTRAP snapshots default off. Only parent messages
`{type:'raphael-desktop-frames', on:true}` take one immediate picture and schedule
the existing three-second cadence; `on:false` clears it. `pagehide` takes one final
picture and clears the timer. All pictures require a view-only RFB canvas, retain
JPEG quality 0.6 and a maximum width of 480 pixels, and use the unchanged
`{type:'raphael-desktop', state:'frame', image}` response. The separate app consumer
owns requesting these pictures; this core-only phase changes no app TypeScript.

Offline checks: `tests/computer`, `tests/members/test_teaching.py`,
`tests/evaluate/test_teaching.py` and `tests/architecture/test_boundaries.py`.
The fake VNC and client run independently of core; a synthetic 300 ms main-loop
block must leave framebuffer, owner/teaching input and relay expiry below 200 ms.
Tests also cover both socket ends closing, preview/watch input denial, stale
handshakes, privacy and the 8-session/64-connection caps. Evidence and exact exits:
`app/.look/briefs/viewer-path-report.md`. `npm run verify -- --computer` now covers
local container layout/readiness, authenticated clipped noVNC transport, screen-local
input/raw pixels, recovery/restart, available layer 4 migration/deletion, and the
core's own `DesktopViewer` connection/relay path. The native app's panel around that
relay, remote SSH hosts, native frame pacing and browser canvas performance still
need separate acceptance.

## Library: only what the member delivered (owner, 2026-11-07 night)

This supersedes the Library notes below (team-file chips, the workspace/team scan, This week / Earlier). The owner found
the Library a wall of working screenshots; as Grok Bot's, it now lists only deliverables, read from `members.library`
(core brief 10: media cards and files or links its replies handed over, pages it published with their first day, verified
receipts in the owner's output folder; never owner uploads, scratch files or undelivered screenshots). member-panel-work.ts
groups them by `day`, newest first, under 今天 / 昨天 / a date: pictures as square thumbnails three to a row (a delivered
attachment loads through `attachments.get` like a chat's; one with no stored copy keeps a tile with the picture icon), every
other deliverable a row with its kind's icon (document, page, video, audio, archive, file, link), its title and the time;
nothing framed. Show more adds 12 up to 100. A press opens a picture in the lightbox, a page at the reply that published it,
a link in the browser, an attachment with `open_attachment`, and a delivered file with the new `open_library_file` command,
which hands the member id and the Library handle to `members.library_file` (never a path, never `computer.team_file`).
Delivered file names are data for the look audit's language check (`.lib-title`).

```powershell
npm run look -- member-panel-library member-panel-library-open member-panel-library-empty details --theme both --width 1120,720,1920x1080
```

## Bare screen while the computer is not showing its screen (owner, 2026-11-07)

This supersedes every earlier note below that describes words, the member face, preparation progress, a state sentence,
recovery buttons (Start Docker, Use remote, Download, Retry), the Open pill, the caption under the screen or the header
state word for an offline computer. While a computer is not showing its live screen (sleeping, starting, waking, updating,
repairing, stopped Docker, missing installation, remote failure, missing image) the panel draws only the wallpaper: no text,
face, button, pill or caption inside the screen, and the header state label (computer-lifecycle-state) is hidden until the
computer runs. The state stays in `data-desktop-state`. The location menu and the overflow menu remain.

One press anywhere on the screen (the `[data-desktop="enlarge"]` cover, visible in every state except while it is getting
ready) starts it: asleep wakes it, a stopped engine starts Docker through `computer.viewer_status {start_docker:true}`, a
stalled or unreachable stream reopens, and a running screen opens the larger view as before. Rendered checks use the shared
`requireBareScreen` helper in scripts/look/checks.mjs. desktop-install and member-panel-remote-location keep their names but
now cover the absent computer's bare screen and the header location control; no scene was retired.

## Three-tab member panel and local engine recovery (2026-11-05)

Owner request of 2026-11-05: use Grok Bot's clear Details / Library / Computer hierarchy and explain the actual unavailable-computer reason. This section supersedes earlier landing-panel and first-build-caption guidance for this panel.

R-PANEL-01 through R-PANEL-04 govern the header, shared tabs, live controls and all offline states. Enter from the conversation title for Details; use the monitor for Computer. Gear retains identity, memory, skills, commands and voice. The panel reads the existing private worker-task lane (including delegated private work), newest first. Tasks open their existing results and stop/rerun through the row menu. Library uses the shared team-file chip; file handles are scoped to the selected member's local workspace/team folder, with recorded artifacts/pages retained even without a running computer. Remote volumes are never scanned as local paths. The current scan is capped at 500 entries, depth 3, 100 visible files and 100 task/page/artifact records; ordinary Show more advances by 12.

Owner follow-up of 2026-11-05: say each thing once. Sleeping, starting, waking, updating, repairing, stopped Docker Desktop, missing installation, named remote failure and missing image show the full sentence only inside the screen. The header keeps a matching short state word beside location and overflow, without another face or explanation. Buttons sit after the sentence in normal flow; every offline state has the existing member slime. Only a live screen offers Enlarge and Take control underneath, with no repeated name caption. Details keeps the outer conversation heading and suppresses the list's internal heading. Owner engine recovery starts only the installed local app and reports readiness without implicitly creating a computer (since 2026-11-11 a member's own tool call also starts the installed Docker Desktop and waits up to 120 s, see R-PANEL-04; reads and the viewer still never do); selecting the location recovery opens the existing control. No administrator/app-update advice is shown for a stopped engine.

Consistency comparisons use the existing ui.tabs plain variant, shared fileChipHTML, btn and openMenu. The three member tabs fill the panel to keep equal navigation targets; Connections retains its compact counted tabs within Settings. Work menus have only the applicable action, while maintenance retains its wider descriptive rows and takeover retains its icons. These contextual differences reuse the existing components and tokens. Engine readiness uses the existing viewer notice with role=status and neutral text; failures retain role=alert. Offline recovery buttons retain the screen's existing dark contrast treatment over the wallpaper, while Enlarge and Take control use ordinary panel buttons below it.

```powershell
npm run look -- member-panel-details member-panel-details-empty member-panel-library member-panel-library-empty member-panel-computer-live member-panel-computer-asleep member-panel-computer-starting member-panel-computer-waking member-panel-computer-updating member-panel-computer-repairing member-panel-computer-docker-stopped member-panel-computer-docker-missing member-panel-computer-remote member-panel-computer-image-missing member-panel-docker-start member-panel-remote-location member-panel-location-hover computer-state-sleeping desktop-absent desktop-watch desktop-watch-collapse computer-maintenance-menu takeover-menu connections team-file-reply --theme both --width 1120,720,1920x1080
```

Use synthetic zh-TW fixtures, both themes and 1120/720/1920x1080. panel-state-layout checks sentence/button containment, pairwise nonintersection, ordering, visible face, exactly one visible full sentence and the short header word's agreement with the fixture state. Member-panel checks reject duplicate conversation headings and offline Enlarge/Take control. The task-stop/task-rerun scenes open their shared contextual menus without mutations, and team-file-reply is the shared chip comparison consumer. The library scene exercises ArrowRight, Show more and shared chips; the empty-library scene covers ArrowRight/ArrowLeft; live uses the real chat monitor. Keep the pre-fix desktop-absent overlap failure as red evidence; sleeping did not overlap at the captured baseline widths.

Inspect every contact sheet and full-size computer state at light 720/dark 1120 and Details/Library at 1920x1080. Compare with Grok frames f000442/f000457/f001037, shared Connections tabs, work overflow with maintenance/takeover menus and Library chips with the existing chat file chip. Judge the same selected run with those external reference frames and RAPHAEL_STAGED_DOCS=.fold. Native Windows/macOS launch, remote SSH/container operation and live brain/provider behavior remain unverified; tests never start real Docker. The initial brief overrides generic full-suite guidance: targeted tests only, one heavy waiter before look, no full verify/core suite. Follow-up 1 requires the 18 member-panel scenes above in one both-theme/three-width run, targeted tests plus ui-rules/i18n/architecture, no waiter, and inspection of every sheet, computer states at light 720/dark 1120 and Details at 1920. Exact evidence and omissions live in .fold/report.md.

## Settings and lifecycle merge (2026-11-05)

The member header reads state, shared location, maintenance overflow, settings,
close. A sleeping state gets a full-width line before the controls in the narrow
panel. The same location control moves into takeover without a second copy.
Empty computers retain location and installation guidance. Existing maintenance,
sleep choices, watch-only enlargement, leases and render caching remain intact.
The explicit remote host check and copyable repairs move from the retired settings
pane into the location popover using the existing viewer_status owner RPC.

```powershell
npm run look -- settings-owner safety desktop-host-local desktop-host-remote desktop-panel computer-maintenance-menu computer-state-sleeping owner-output-folder --theme both --width 1120,720,1920x1080
```

## Computer lifecycle in words (2026-11-05)

R-COMP-PERF-01/07/10/11/12 remain authoritative. The member panel header's
overflow offers Wait, Restart, Update, Repair and Reset, in that order. Shared
openMenu descriptions explain preservation/removal. Reset uses the existing
mb-confirm dialog and sends confirmed=true only after the owner's explicit yes;
changing members before confirmation performs no maintenance. Host and target
identity are captured and checked again in the main-window-only computer.lifecycle
RPC. The location control remains owned by the separate header unit.

Restart stops/starts the exact compatible owned container. Update rebuilds the
container on the currently installed image, without pulling or building a shared
image. Repair recovers the exact owned container by rebuilding it. Both retain
workspace mounts and browser profiles; changes outside workspace are ephemeral.
Reset removes only its validated workspace after confirmation, never team/shared
storage. Shared mode is explicitly named. Foreign/weakened, busy and owner-held
computers refuse maintenance. Other members cannot start the target while its
maintenance is running. No broad recovery/removal scan is used.

The header names sleeping, waking, updating and repairing using existing slime
sleeping/working states only. The menu's shared dropdown saves 5/15/60/0 idle
minutes through SettingsStore; zero means never. Shared/per-member mode is
read-only. Both local and SSH computers use the existing idle-stop contract.

VmTools reads bounded fake-testable df/du results at most every five minutes.
At 90 percent disk use, the current member's ordinary persisted conversation reply
names its three largest workspace/cache folders and asks before deletion. One
notice is emitted per pressure episode in the running core; below-threshold
readings admit a future episode. It never deletes, buys a service or calls a model.

Before dispatch, a failed driver connection receives one targeted reconnect or
missing-socket restart. Stopped computers follow existing start. A failed viewer
tunnel is closed and retried once. Repairs preserve workspaces and emit one
localized progress line when a member turn is active. An uncertain action gets
connection repair without replay; its result requires a fresh window/page read.
Grants and holds remain checked, and a second failure is returned to the caller.
Freshly started computers wait for driver readiness without a premature restart;
an already admitted repair also keeps its normal bounded readiness wait.

Synthetic zh-TW matrix, both themes and 1120/720/1920x1080:

```powershell
npm run look -- computer-maintenance-menu computer-maintenance-restart computer-maintenance-update computer-maintenance-repair computer-maintenance-reset computer-maintenance-reset-done computer-sleep-menu computer-state-sleeping computer-state-waking computer-state-updating computer-state-repairing computer-low-disk desktop-panel takeover-menu computer-file-confirm --theme both --width 1120,720,1920x1080
```

Compare maintenance/idle menus to takeover-menu, reset to computer-file-confirm,
and sleeping/working faces and header icon controls to desktop-panel at matching
theme/size. Maintenance descriptions use the shared mdesc rows, so their content
requires a wider/taller menu; reset adds a scope paragraph to the shared dialog.
The header face uses 28px to fit beside the existing icon buttons; its art and
states are unchanged. Tests: test_lifecycle.py, test_vm.py, test_latency.py, test_viewer.py,
test_smooth_computer.py, test_settings.py, desktop-viewer.test.ts and
member-details.test.ts. Only fakes are authorized; never operate real Docker.
The brief defers full verify/core suites and native/live acceptance to integration.
See .fold/report.md for exact exits, visual inspection and judge prerequisites.

The existing read-only SSH repair consumer also remains mapped separately; it is
not part of this brief's selected lifecycle capture:

```powershell
npm run look -- desktop-host-repair --theme both --width 1120,720,1920x1080
```


## Smooth computer work and private inline sign-in (2026-11-05)

The details screen has a separate Enlarge icon. It carries the existing iframe
into the window area beside the sidebar, retains no member-specific expansion,
preserves the guest aspect ratio through noVNC scaleViewport and never acquires
input. Its thin bar reuses the current public action words, Stop and collapse;
Esc collapses with the connection intact. Explicit takeover/teaching/files keep
their earlier behavior. The private request_takeover card now acquires input
inside its own iframe instead of opening full-window takeover. Its Done action
returns the current nonce once; Stop/cancel/disconnect never count as Done.
Owner input travels over RFB only. Held-control screenshots are not forwarded
to the parent thumbnail cache. Existing private work scope and post-handback
fresh-read requirements remain authoritative.

run_steps is a Raphael composite, not a forwarded driver batch. It accepts up
to ten curated driver actions and one targeted observation. Each subcall passes
ToolGate.call_plugin and the existing current tool/schema, grant, action-lock,
owner hold and audit boundary. Stop on the first error/lease notice; identify the
one-based failed step and count completed steps without returning intermediate
screen contents. Never reuse the outer approval for another action. Shell,
takeover, secrets and nested composites are excluded. Shared API/worker and CLI
completion guards require a post-action window/page read or nonempty verify_state
predicates before completion; one correction is allowed, then completion fails.

Thin/empty/consent-wall web_read results escalate through the current member's
member's own browser. Exact Reject all / necessary-only semantic buttons may be
clicked; ambiguous controls never imply consent. Every browser subcall retains
the normal gate and owner-hold checks. No fallback reader/provider is purchased.

Settings checks remote SSH key access, noninteractive Docker PATH, daemon and
installed image architecture through read-only SSH commands. Fixed localized
words replace raw diagnostics. Since 2026-11-11 (R-COMP-HOST-01) each failure class
(`ssh_unreachable`, `ssh_alias_unknown`, `ssh_hostkey`, `ssh_hostkey_changed`, `ssh_key`, `docker_missing`,
`docker_path`, `docker_stopped`, `docker_access`, `architecture`) carries the one command or snippet that
fixes it, built by `remote_host.repair_command` and shown as the core sent it; a host with Docker running and
no image is healthy (`image_pending`, a note that the first start prepares it in roughly 5 to 15 minutes).
The look checks desktop-host-health and desktop-host-repair assert a command that starts with `ssh <alias>`
and no build from the app's project sources. Docker operations share an owned SSH
session forwarding the remote Unix socket to an owner-only local socket; the viewer
uses SSH -W pipes. Unsupported forwarding falls back to ssh:// with bounded backoff.
No Windows ControlMaster or remote install/start is required.

Idle/eviction and app shutdown only stop compatible owned computers; workspace
mounts and browser profiles survive. A recognized v3/v4-to-v5 rebuild announces its
workspace/sign-in preservation before removal, never removes a volume and refuses
foreign or weakened containers. Files/installs outside workspace are explicitly
ephemeral in tool/persona text. Deleting a member removes its computer data too (see
[Deleting a member removes its computer](#deleting-a-member-removes-its-computer-2026-11-11)):
the 2026-11-05 unchecked option that named the host is gone.

Selected future look matrix (both themes, 1120,720,1920x1080): desktop-panel,
desktop-watch, desktop-watch-collapse,
desktop-watch-owner, desktop-takeover, desktop-takeover-owner,
desktop-takeover-done, desktop-owner, desktop-host-remote, desktop-host-invalid,
desktop-host-health, member-delete-ask-computer. Compare Enlarge/collapse/Stop with
the existing icon buttons and card Done/Skip with computer-card controls at the
same theme/size. The owner-typing scene uses synthetic RFB input only.

```powershell
npm run look -- desktop-panel desktop-watch desktop-watch-collapse desktop-watch-owner desktop-takeover desktop-takeover-owner desktop-takeover-done desktop-owner desktop-host-remote desktop-host-invalid desktop-host-health desktop-host-repair member-delete-ask-computer --theme both --width 1120,720,1920x1080
```

Native journeys: member-computer; computer-speed (explicit opt-in, never --all or
verify). computer-speed creates its own random-root/name container, uses an
already running Docker engine and prepared image, serves its own form inside
that computer, measures five warm first observations, browser_open and five
browser_type actions via run_steps, and removes only that exact owned container.
It reports median/worst; every first observation must be <8s and page open <6s.
No unrequested batch budget is invented. Missing refs/results fail measurement.

```powershell
npm.cmd run native -- computer-speed
```

Offline evidence: test_smooth_computer.py, test_web_read_hint.py, existing VM,
takeover and persona tests, desktop-viewer.test.ts and member-dialogs.test.ts.
This brief prohibits look, native, judge, live, network/provider and real Docker
acceptance. These remain SKIP; fake connection counts establish sharing, not real
SSH/macOS/driver compatibility or latency. Check the task report for exact exits.

## Responsive computer tools (2026-11-04)

R-COMP-PERF-01 through R-COMP-PERF-06 supersede the earlier full-screen bootstrap,
mandatory desktop re-check, 2 GiB memory cap and on-call discovery notes.
This unit changes core only; its brief forbids Docker operations, network, paid
models, look and native runs. All current evidence uses fake Docker/driver
boundaries. No measured improvement in a real member computer is claimed.

LocalVm remembers a successfully prepared Target for 45 seconds, including its
transport, lifecycle generation, enable state and timezone signature. Hot calls
skip capacity_lock and all Docker preflight launches. Bridge/VM failures, observed
stopped/unavailable/incompatible status and timezone refresh invalidate that
confidence. The next call performs full preparation; an uncertain action is not
replayed. Existing grant, screen lease and owner-control checks remain authoritative.

The routine first look is list_windows then a targeted get_window_state, bounded
to 200 elements and include_screenshot false by default, with query forwarded.
Screenshots are explicit; get_desktop_state remains available for whole-screen
pixels. Fresh window/browser reads clear takeover and stale-screen requirements;
list_windows alone never clears them. The shared member persona prescribes the
same contract and verification after meaningful changes.

browser_open(url, query?, scope_ref?) performs browser_prepare with the lasting
isolated_named/main profile, chooses one Chromium window, binds its active tab,
navigates and returns semantic_v2 page references without screenshot blocks. Its
subcalls reuse one owned session and check the grant/hold between stages. Window
mapping may lag browser preparation, so missing windows are polled for at most
five seconds inside that same tool call. It
refuses ambiguous windows, missing targets/tabs and non-http/https URLs, and stops
after any failed stage. Browser follow-up tools remain individually available.

The v5 image retains v4's --no-overlay only when serve --help advertises it; every
member driver connection also disables its exact session cursor_id and sets
max_image_dimension 1456. New computers use a 3 GiB
memory/swap cap (not a reservation) and two CPUs, with two local running computers.
Two members can work side by side; a third start evicts the least recently used
idle computer without interrupting active or owner-held computers. Old images/limits fail compatibility;
offline verification never migrates or touches any existing container.

CuaBridge matches replies by request ID with a single reader and a write-only
lock. Screen reads allow 120 seconds; actions allow 60 seconds. Cancelling or
timing out abandons the owned bridge process, fails its pending requests and
invalidates preflight confidence. Member reads emit one localized progress line
at ten seconds. Elapsed time is included in page JSON when present, otherwise in
text; lease notices retain their existing JSON contract.

All 30 curated driver tools and Raphael-owned browser_open, vm_exec, attach_file,
request_takeover, fill_login and per-bot dataset are offered offline to every member.
Every member sees the catalog from turn one. The first actual driver
operation schedules a bounded background listing on a separate bridge, retaining
the action session. Missing driver tools are removed and schemas are replaced in
the existing API/CLI/worker snapshot. Preparing a turn never starts or probes Docker.

Schema provenance limitation: driver_schemas.json is a compatibility offer,
adapted from OpenMausBot's macOS 0.12.6 schemas and 0.22.1 browser_prepare example,
plus reconstructed Linux definitions. Neither the exact Linux 0.37.0 wheel nor
a captured schema list was available offline. It must not be called a verified
Linux snapshot. Capture and compare the pinned driver's full tools/list on an
authorized disposable container before release. Apache attribution and NOTICE
are retained. Packaging explicitly includes this JSON and audits its presence.

Offline scope: tests/computer, tests/agent/test_persona.py,
tests/agent/test_member_computer_use.py, tests/background/test_computer_lazy.py and
packaging tests, followed by the whole core suite once after wait-heavy.ps1.
The task report records exact commands, exits and counts.

Authorized acceptance still needed (audit section 2.5): time cold/warm desktop
capture with XFCE alone and with Chromium, bounded window reads with/without PNG,
docker stats with the 3 GiB/no-overlay image, and host docker info/inspect/exec true.
Also count Docker launches for a warm no-op tool, measure browser_open click-to-page
and ten-second progress/Stop latency, and compare the static/live Linux schemas.
Record elapsed distributions, failures, CPU/memory, image dimensions/bytes and
model steps. Do not claim fake test results as latency or native evidence.

Deferred consumer scenes: desktop-panel, desktop-viewer, desktop-owner,
desktop-takeover, desktop-takeover-owner, desktop-takeover-done and
chat-computer-takeover, both themes at 1120,720,1920x1080. Native member-computer
and vm-smoke should exercise the same tool/lease/browser path on an explicitly
authorized test container. Look, judge, native and live-provider checks are SKIP
in this offline-only brief, with no UI consistency comparison implied.

## Slime town and computer preparation (2026-11-03)

R-UI-92/93/94 replace the monochrome artwork and preparation stage-list assertions
only. The existing hour boundaries, five filenames, XFCE watcher, start/repair
controls, leases and single carried iframe remain authoritative. The approved
original town drawing uses paths, groups, ellipses, circles, rounded rectangles
and SVG 1.1 gradients. A fixed 32-bit LCG replaces Python random; generate both
asset folders through wallpaper.py --generate. The byte ceiling is 20,000, with
the largest current SVG approximately 15,000 bytes. No embedded/external images,
text, scripts, CSS or modern SVG features are shipped.

Preparation keeps the running preview's aspect ratio and bottom-aligned picture.
The member's shared face has local working motion at 64px (96px expanded), with
Raphael's emblem retained. The frame-token translucent pill holds only the
current localized stage, a real percent when supplied and the first-build line
while building. Existing stopped/error/install words and controls stay on small
legible surfaces. The retained wallpaper remains behind the connected iframe;
CSS fades the stream for 240ms only without reduced motion. patchHTML retains
the working face and unchanged renewals touch nothing.

The existing desktop-starting/building/preparing scenes retain the no-blank-stream
and content-containment checks, replacing three numbered steps/indeterminate
progress with the current stage and real-percent assertions. desktopHour fixes
the local fixture date independently of the host time zone. The synthetic RFB
uses that same parent date for its wallpaper. Desktop-viewer tests cover both
data-card-desktop-screen and data-card-screen consumers.

The shared card-shell look check retains its no-face contract everywhere except
the computer screen's explicit desktop-preparation > desktop-boot-face (R-UI-93).
The ordinary card.test.ts shell fixtures remain unchanged and face-free. The first
capture caught first-build pill overflow at 1120/720; shorter three-language build
and first-build words plus tighter pill spacing retain the 64px face and ratio.
desktop-boot-card covers the tool-card data-card-screen consumer; desktop-boot-inline
covers the timeline data-card-desktop-screen consumer. desktop-boot-connect changes
only the mock native readiness, then waits for the real poll/iframe connection. It
compares screen dimensions and period before/after, verifies no reduced-motion
animation, and samples the actual CSS fade at 0/120/240ms under normal motion.

Selected matrix, both themes at 1120,720,1920x1080:

```powershell
npm run look -- desktop-starting desktop-building desktop-preparing desktop-wallpaper-morning desktop-wallpaper-noon desktop-wallpaper-dusk desktop-wallpaper-evening desktop-wallpaper-night desktop-boot-inline desktop-boot-card desktop-boot-connect desktop-boot-raphael desktop-own-wallpaper desktop-own-wallpaper-card desktop-stopped desktop-unavailable desktop-absent desktop-panel desktop-viewer --theme both --width 1120,720,1920x1080
```

Compare the full-size preparation and town-period images and the preview/emblem
with the shared member-header face. Offline look evidence does not prove the
XFCE loader or guest timezone.

## Three computer levels (2026-11-02)

The monitor is always an icon entry and turns purple only for a running computer.
Details opens on the screen/caption, direct routine rows and conversations. The
gear leads to existing identity, fields and resources; Back returns through that
hierarchy. Skills and slash-command templates retain their distinct editors.
File changes opened from a result card offer only Back, which returns to the conversation;
nothing was taken over, so handback and the menu are absent there.
Routine pausing is saved inside the ordinary editor, never on the landing row.
An unprovisioned computer is omitted; unavailable/install/preparation
states retain their existing localized words and repair/start actions.

Screen and conversation-card takeover carry the existing iframe into a full-window
view. Its thin bar uses the member face/name, explicit handback and shared action
menu for files and teaching. Existing restore confirmation/review token and
teaching privacy/draft/save/discard/try flows remain authoritative. Handback closes
the owned stream, releases its current nonce once and retains the conversation
position. Refreshes with unchanged data preserve nodes, animation, focus, menus
and scroll (R-UI-71); action menus use ui.ts dismissal/anchor behavior (R-UI-73).

The original generated monochrome wallpapers are shared by the guest, off preview
and fixture RFB transport. wallpaper.py proves each hour's selection and generated
asset bytes; prepare-desktop runs its 30-second timer under the existing guest TZ.
Unchanged workspaces get no writes; late monitors are initialized on the next tick.

desktop-return-stopped leaves through Home and returns through the real member
entry: the unchanged off screen and Start action must remain visible. Failed opens
clear takeover intent; only a new request nonce resumes watching after handback.
Packaged data includes the Python watcher. Existing computers receive the same
script/art once per start through local/remote transport, with a three-second
best-effort bound and a detached XFCE/DBus watcher guard. Image labels stay fixed.

The handback scene also reopens a fresh stream and takes control only after it
connects. The draft scene returns to the screen and reopens the same unsaved
editor. Stopped renewals after a running stream preserve the no-write contract.
Additional consumers cover context-menu-routine, automation-event-pick,
automation-webhook, routine-event-missing/profile, missing-routines,
polish-caption-member.

Selected scene matrix, both themes at 1120,720,1920x1080:

```powershell
npm run look -- computer-status-active computer-status-idle panel-screen-routines panel-off desktop-start desktop-return-stopped panel-no-computer panel-gear panel-routine-row panel-raphael takeover-bar takeover-menu takeover-handback --theme both --width 1120,720,1920x1080
```

- computer-status-active, computer-status-idle, panel-screen-routines, panel-off,
  panel-no-computer, panel-gear, panel-routine-row, panel-raphael, takeover-bar,
  takeover-menu, takeover-handback.
- Every desktop-*, computer-*, details*, member-edit* and member-avatar scene;
  chat-computer-takeover, chat-human-control, chat-handback and card-computer-*.
- Representative changed consumers: routine-event-row, routine-event-edit,
  routine-event-saved, menu-hide-control and menu-move-hover.

Existing desktop-collapse now closes the preview; desktop-entry explicitly opens
the landing preview; desktop-viewer/owner and card-computer takeover use its screen
press and thin bar. desktop-handback now checks closed transport. Teaching enters
through the shared menu. File scenes enter the same menu and retain all restore
assertions. details-routines keeps its name as the landing routine regression,
without a routines subpage. details-resource, member-edit and member-avatar scenes
enter through the gear. The earlier collapse/separate-computer-page and inline
owner-control assertions are superseded; single-stream and nonce assertions stay.

Compare menu controls to existing shared menus and routine controls to automation editors
at the same theme/width.

## Named datasets (2026-11-01)

The independent computer offers dataset import/query/list/chart. A dataset name
selects a persistent workspace DuckDB file; table defaults to data. CSV, Excel
(.xlsx) and Parquet paths resolve inside that workspace. Stored attachment ids can
be imported with attachment:<id>; the existing vm_exec gate copies bounded chunks.
Multiple sources union by column name; importing a table replaces that table in
one transaction. Queries can save CREATE TABLE/VIEW AS SELECT results and otherwise
return bounded rows. External file/network access and extension loading are disabled
for queries. Charts require label/value columns and return an escaped SVG file.

The first use creates a locked workspace venv and installs duckdb==1.4.1 and
openpyxl==3.1.5. No Dockerfile or image layer changes: owners do not rebuild their
computers for this feature. Installation requires the member computer's package
access, and failure is returned through the ordinary tool result. A stopped task
cancels existing vm_exec, leaving the durable database available for a later turn.

Core evidence includes production API/CLI/routine calls with a fake VM returning
its real output shape. Real DuckDB import/reopen integration is explicitly skipped
when its offline dependencies/Linux lock module are absent. No real installation,
Docker start, host kernel or provider call is exercised.
Selected UI consumers: dataset-table and dataset-chart, both themes and all three
standard sizes; compare with the existing rich table and stored file controls.

Dataset work reaches the ordinary owner-rule screen. In bypass mode it asks no
permission question, but explicit denial still forbids it (R-AG-35).
Every nested exec/file call retains the member grant, target and owner-control checks.

## Teach by demonstration (2026-11-01)

The member computer has one Teach a task / Stop recording button. Starting uses
the existing input lease and shows a persistent privacy line and one-press discard.
Only the member's independent computer can record; a shared computer explains the
missing requirement with the shared computer-settings repair action. Docker absent,
stopped computers and previews retain their existing prerequisite controls.
The independent-computer requirement uses the shared missing notice renderer.
Repair buttons inside the fixed dark desktop frame use that frame's resting, hover and pressed fills,
so the same light text stays readable in either application theme (R-UI-52).

Recording saves ordered clicks, keys, nonprivate text and changed screenshots in
the member's home. Password/sign-in or unavailable accessibility observations omit
both text and images. Clipboard values are omitted. The cap is 4 MiB (including
reserved draft space), 2000 events and ten minutes. Disconnect interrupts recording;
restart can review/discard its data but never resumes control. Discard cancels a
pending draft and removes its recording.

Stop releases control and asks the selected member brain for a tool-less draft.
It reads ordered actions and accessibility text; retained screenshots are evidence,
not model attachments.
The draft treats captured data as untrusted and uses the ordinary skill format
plus Inputs, semantic goals and final Verification. The existing resource editor
holds this unsaved document; only Save publishes it. Afterwards, the owner types
a fresh input and presses Try once in that same conversation. The skill remains
an ordinary private member skill on API, CLI and scheduled routine paths.

Selected local UI matrix:

```powershell
npm run look -- desktop-teach-recording desktop-teach-draft desktop-teach-saved desktop-teach-try desktop-teach-discard desktop-teach-shared desktop-owner desktop-absent details-skills --theme both --width 1120,720,1920x1080
```

The teach-* rendered checks assert lease actions, visible privacy/repair, the
editable draft before Save, explicit publication, discard without publication,
and the ordinary conversation call with skill name and fresh input. Compare the
draft editor with details-skills, and teaching controls with
desktop-owner. Offline proof: members/test_teaching.py, evaluate/test_teaching.py
(API and CLI plus routines), computer/test_rfb_input.py and desktop-viewer.test.ts.
Real Docker/cua accessibility, screenshot privacy across third-party applications,
native shell, live model quality and judge remain separately unverified.

## Owner-PC commands (2026-11-01)

Owner-PC diagnostics and CLI work use local__local_exec rather than the Linux
sandbox or guarded real-desktop mouse/keyboard tool. Every member sees the same
pinned local_exec/local_job definitions on API, CLI MCP and background paths.
Settings > Raphael places Local commands beside Computer use, with Ask every time
(default), Always allow and Never. First consent names the requesting member and
asks for all members, with four real answers. Later command cards show Allow/Skip
and a settings action. Exact multiline commands and cwd appear on the shared
permission card; no command arguments or results appear in public steps. The
background renderer uses the same card. Chat has no timer (also in CLI/shell);
background questions expire after 30 minutes. Esc denies once. Phone/Telegram
answers never approve. Always still asks after outside content or for dangerous,
opaque and subscription CLI commands; the secret-store deny list always refuses.

`local_host.py` uses PowerShell -NoProfile -NonInteractive, UTF-8, hidden windows,
closed stdin, home cwd, worker secret filtering, bounded head/tail stdout/stderr,
model-selected timeout, nonzero exit results and the existing Child tree cleanup.
Background IDs expose output/stop only to the same member conversation or task.
Stop/app close cancels the tree. These regexes are a best effort, not a sandbox;
the owner card remains the permission boundary. cua-driver session is removed
from both schema variants and rejected if injected at execution.

```powershell
npm run look -- local-command-consent local-command-later local-command-background local-command-once local-command-always local-command-never local-command-deny local-command-manage local-command-settings local-command-setting-always local-command-setting-never local-permission-card --theme both --width 1120,720,1920x1080
```

Inspect every contact sheet, all pending/settled/background cards and settings at
both themes and all widths. Compare the existing Gmail permission card with local
cards and the shared dropdown with its settings neighbors. Checks verify exact
command wrapping, four/two functional buttons, no gold duplicate, no timeline echo,
saved modes and card containment. Core tests: agent/test_local_commands.py,
computer/test_local_commands.py and background/test_local_commands.py. Frontend:
permission-card.test.ts, pages/settings-view.test.ts, pages/agent-cards.test.ts,
background-questions.test.ts. Full handoff core scope:
tests/agent tests/background tests/members tests/computer tests/worker.

Acceptance still requires the owner's real CPU question to member 13 on both API
and installed CLI brains, harmless process inspection, explicit approval/dismissal,
tree cleanup on Stop/app close, and the Docker path after schema discovery.
Offline fakes and rendered fixture success do not prove Docker, cargo, native
journeys, network, judge or real subscription commands. Rule IDs: R-PC-01/02/03 and R-AG-13.

The optional Docker desktop defaults to `computer_vm_mode=per-bot`: a durable workspace,
container and browser profile per member (3 GiB and two CPUs each), plus a shared team
folder at `/home/cua/team`. Existing explicitly saved shared mode remains supported. Host paths use pathlib and Docker CSV bind
mounts; no host shell or alternate runtime is used. The core starts an installed Docker Desktop through the host adapter on the first actual
computer operation. A turn's tool preparation never invokes Docker. When Docker is absent,
no computer tools are offered; the existing Settings computer area has one requirement line and an official download button.

`computer/vm_catalog.py` curates 30 driver tools plus Raphael's `vm_exec` and
`attach_file` (32 total). Each selection has a one-line reason. Screenshot/window
state, input, application/window discovery, clipboard, verification and the Linux
CDP browser helpers are offered together offline from the first turn.
The checked-in compatibility schemas and Raphael-owned tools are refreshed on use
by a background driver listing; exact pinned Linux schema capture remains pending
as described above. Missing tools are removed, and changed schemas are validated
before forwarding when the refreshed definition is available. The real catalog
stays in memory for later turns in this process. Core-owned
`PluginTool.pinned` metadata excludes them from the 40-plugin budget, keyword
shortlists, model refinement and the foreground planner's selection. Other plugins
keep their existing cap and discovery. Driver updates/installs, configuration,
recording/replay, escalation, lifecycle and redundant script runners are excluded;
unknown future driver names are excluded too. No backend-supplied flag can pin a
normal plugin tool. The gate and owner-control lease still apply on every call.

The recorded names fixture is `core/tests/computer/fixtures/cua-driver-0.37.0.json`.
It lists 68 unique names (including the two Raphael
tools) and the fixture preserves all 68. The pinned Linux wheel was unavailable
offline, so test schemas are explicitly synthetic objects, not captured schemas.
Browser selection follows Cua's documented Linux CDP support; real image/browser
operation remains pending the owner's native run. The native assertions are intact,
and their fake-runtime test now replays the complete supplied catalog.

The existing `AgentService`, background snapshots, ToolGate, approval cards and
metadata-only audit remain authoritative. Cua MCP runs through `docker exec -i`
as `cua`. The same authenticated `RaphaelMcp` implementation exposes a `computer`
endpoint to Claude/Codex/Antigravity, while API brains receive the same tool
definitions through the production snapshot. Screenshots, clicks, typing, scrolling,
app launches and `vm_exec` are T0 and run without per-action approval, including in
global Ask mode (`agent/gate.py`: the registry asks only above T0 in that mode).
The foreground and background harness skip per-action safety classification for
these sandbox tools. `attach_file` retains its existing T0/workspace contract.
Owner control refuses every call immediately, including screenshots, clicks and
exec. Members share the one screen by turns: a member whose turn comes while another
has the screen waits up to a minute with one progress line (「正在等 <成員> 用完電腦」),
then gets a result, not a failure, that names who holds it and for how long
(`computer_busy`, no evidence of work) so it can do other work or ask again. After
waiting, or after another used the screen, its first action returns `screen_changed`
until it has made a fresh targeted window/browser read (or explicit whole-screen read) again. Commands (`vm_exec`, `attach_file`) never
take or wait for anyone's turn at the screen.

Before sending a message or email, publishing or posting, deleting anything outside
the workspace, paying or buying, the member must first call `approve` on CLI brains
or request the equivalent owner approval through the API harness and wait for the
owner's yes for the exact action and target. If that approval is unavailable, denied
or expired, it must stop without acting. Sandbox success is never outward approval.
This contract is in every driver/exec tool description (within the shared offer's
400-character cap) and the shared doctrine in `agent/persona.py`; no click classifier
is used. Contract tests check the actual snapshot and every CLI/API/worker persona.

`vm_exec` defaults to 60 seconds, caps at 1800 seconds and 20,000 combined output
characters, and times out in the guest as well as the host. With `background` it starts
detached and returns a job, its log and its `.exit` file under `.raphael-jobs/` in the
workspace (at most six hours); the member reads them with later commands. `attach_file` only
copies regular files under `/home/cua/workspace` into the existing attachment
store. Guest directory traversal and symlinks are refused with openat/no-follow.
Screenshot blocks reach CLI and API brains, are treated as untrusted screen
data, and are omitted from saved background continuations and public steps.

New containers reuse the last validated IANA zone sent by the UI to `home.overview`
as `TZ`, falling back to UTC until one is known. The zone stays in memory; no
setting or platform-specific lookup is added. Existing containers are not recreated.

Container reuse checks ownership, image ID/labels, bind mount, loopback publishing
and resource/security limits. Idle shutdown defaults to 15 minutes (5-1440),
preserves the workspace and skips owner-held or active desktops. Startup recovers
only containers owned by this data directory and verifies compatibility before use.

From `app/`, with the installed Python selected via `RAPHAEL_CORE_PYTHON`:

```powershell
npm.cmd run verify -- --contract
npm.cmd run native -- member-computer
```

The native journey starts installed Docker Desktop and builds the pinned image
through the shared lifecycle when needed. It requires explicit authorization and
an idle machine before running. It uses an isolated
journey database and a deterministic fake brain through the real worker loop,
snapshot, gate and Cua tool transport. It checks the shared VM, a valid screenshot,
a click and guest exec without approval, attachment bytes, owner-control refusal
of every call and connected noVNC canvas. It never synthesizes an owner's yes;
`without_approval` and `owner_held_refused` name the asserted calls in the report.
The runner captures the real tool screenshot and the in-app noVNC viewer, then stops only its
own container. It makes no provider requests. Keep and inspect its report and
contact sheets; a missing engine/image is a blocker, never native acceptance.

Phase A adds no application UI. Phase B extends the existing member details side panel with the live desktop. The own-PC cua driver remains Phase C.

Tests: `core/tests/computer/test_vm.py`, existing agent CLI/MCP, background and
worker suites. Attribution: `core/packaging/licenses/NOTICES.md` and `core/packaging/licenses/Apache-2.0.txt`.


## Live desktop (Phase B, 2026-10-30)

Phase B uses the container's noVNC RFB library in a UI-free loopback shell. The
standalone noVNC stylesheet, controls and disconnected curve are omitted. Native
scaleViewport/resizeSession/clipViewport options keep the framebuffer undistorted.
Passwords reach RFB memory only through no-store responses, never HTML, URLs,
status, reports or logs. Host/origin checks, a sandboxed no-referrer iframe and an
unpredictable session capability guard the loopback bridge. No new RFB dependency
or upstream source is bundled. The production shell/bootstrap runs in look with
only the remote RFB class replaced by the synthetic transport fixture.

The desktop-frame check measures the limiting axis, aspect ratio, clipping,
standalone controls and unobscured canvas corners. Browser fixtures cannot prove
Docker, WebSocket/VNC authentication or native CSP. Native member-computer needs
a fresh debug build, real Docker and its isolated local sign-in page. The journey
checks the VM timezone against the host, real screenshot/MCP/exec/attachment paths,
the owner lease, no member call while held and exactly one nonce continuation.
No screens, owner input or credentials are persisted in the continuation or chat.
External commits, payments and messages still require the separate approval path.

```powershell
npm run look -- desktop-entry desktop-viewer desktop-owner desktop-handback desktop-stopped desktop-unavailable desktop-starting desktop-building desktop-preparing desktop-absent desktop-install --theme both --width 1120,720,1920x1080
npm run look -- desktop-panel desktop-takeover desktop-takeover-owner desktop-takeover-done chat-computer-takeover --theme both --width 1120,720,1920x1080
```

## Side-panel computer (owner, 2026-10-30; supersedes inline viewer/card UI)

The existing member details drawer owns one Computer section, including at 720px.
Opening a conversation with active computer work or a new takeover nonce opens that
drawer automatically. The timeline retains one centered metadata-only event for the
private turn; it never mounts screen cards or preview sessions. Help text sits above
the screen, including sign-in/password/2FA/CAPTCHA/payment.

Click the screen to acquire the core lease in place. The iframe, session and noVNC
connection survive acquisition, handback and expansion. A small edge status says
You are in control. One handback action says I'm done for the current pending nonce,
otherwise Hand back. Expansion changes the same section's layout, without a dialog.
Closing the drawer, leaving, disconnecting, timeout or Stop never completes a nonce.
Only explicit I'm done resumes the same suspended call once.

The loopback RFB input gate parses bounded masked WebSocket/RFB messages, forwards
framebuffer negotiation/requests continuously, and permits keyboard/pointer/clipboard
only for the current unexpired session owner. Unknown protocols/messages fail closed.
Control changes retain the owning stream while closing other target sessions. Stale
handshakes remain invalidated. Payloads are transient protocol buffers, never persisted.
The bridge confirms the first accepted pointer after click through an input counter;
native member-computer records click-to-interactive and click-to-accepted-input timings.

Affected scenes: desktop-panel, desktop-takeover, desktop-takeover-owner,
desktop-takeover-done, desktop-entry, desktop-viewer, desktop-owner, desktop-handback,
desktop-stopped, desktop-unavailable, desktop-starting, desktop-building,
desktop-preparing, desktop-absent, desktop-install and chat-computer-takeover.
Capture both themes at 1120,720,1920x1080 and inspect every contact/full-size image.
Native member-computer signs in only to the disposable local page via the real
side-panel noVNC stream, verifies no member calls while held, then one continuation.
Docker runs only in an exclusive heavy slot. Stop only the journey-created container by exact name afterward; never stop Docker Desktop or another member computer.

## A member's computer needs no permission (owner, 2026-11-11; supersedes On-demand member permission of 2026-10-31)

Owner: 「每個 bot 配一台電腦的功能要一模一樣」 (as Grok Bot, where nothing asks and no grant exists) and
「要盡量減少顯示在前端的事情 不要讓使用者需要思考太多不是他們該思考的東西」. Rule: R-COMP-ACCESS-01.

A member uses its computer when its work needs it, as it uses any tool, under the permission mode the owner chose.
Removed: `computer/grants.py`, the pinned `computer__request_computer` T2 request and its 「允許 {member} 使用電腦」
card, the grant written by the owner's open of the viewer and by the maintenance CLI, the member-made-by-a-member
inheritance, the refusal text of a routine without a grant, the panel's take-back button, the `computer.revoke` RPC
(also in the Rust allowlist and `management.py`), `granted` in the status and session answers, and
`computer_permission_required` (a changed target now answers `computer_changed`, an unknown member `blocked`).
The table `computer_grants` (migration 45) and its member-delete trigger stay in the schema, unread and unwritten:
dropping it would need a migration for nothing the owner sees.

`VmTools.offered_for(member)` gives every member (routines and room speakers too) the tools of its own computer
whenever computer tools are on and Docker Desktop is installed (or a remote host is chosen): the offer is offline,
`prepare` probes nothing and a turn that never calls a computer tool never starts Docker. A PC without Docker offers
no VM tool and leaves the owner's own desktop tool on offer (`has_own_computer` is false there). The first real call
may start Docker Desktop on this PC for any member; a remote host never does.

What stays exactly as it was: sandbox gestures pass the screening and need the lease; `fill_login`, `fill_contact`,
`fill_card` and `dataset` still obey the safety rules and the mode (`fill_card` is T3); the worker still cannot
drive the owner's own desktop (`ToolGate.check(worker=True)`); payment holds, takeover, the owner's hold and a
changed target still refuse a call; checkpoint restore still asks for the owner's confirmation unless the mode is
全部允許 (`LocalVm.full_permission()`). In 先詢問 and 計畫 sandbox gestures were never asked after the first yes and
are not now (the one question that is gone was the grant itself).

An explicit non-preview `computer.viewer_open` (the owner's press on the screen) launches a stopped computer;
preview opens and status reads never do. Looking at the panel never starts a computer.

Offline regressions: `core/tests/computer/test_member_computer_access.py` and
`core/tests/agent/test_member_computer_use.py`, plus the existing computer, agent and background suites.
The UI side is R-PANEL-06 (the computer row) and R-COMP-QUIET-01 (nothing but handoff cards in the conversation).

## The computer row and the quiet thread (owner, 2026-11-11, after Grok Bot)

Grok Bot's panel has a computer row that reads Asleep, then Connecting, then a live picture about eight seconds later and
Awake, and Asleep again a few minutes after the last use; a press opens a full-window view whose pill reads
Watching / Take control and then You're in control / Stop; in the thread the Bot's computer use is two short bubbles
and a quiet label naming the step; nothing asks for permission to have a computer.

Raphael now: Details has one tinted row after the routines, 「{name}的電腦」, its state (休眠中 / 連線中 / 已喚醒) and
a 72 x 45 screen at the right (dark with the monitor until a picture of the live screen is held) (`computer-row.ts`; the viewer publishes, `member-details.ts` draws). While Details is
open and the computer is already running, the viewer opens its stream unseen (`rowShown`, the panel laid out off the
window) and the stream's three-second pictures are the row's live picture; nothing is streamed for a sleeping computer
and looking never starts one. A press fires `member-computer-open`: the page selects the Computer tab and presses the
screen (`desktop.watch()`), so a sleeping or stopped computer starts and a running one opens large. A PC that cannot
give a computer replaces the state and the screen by one line (the existing state sentence) and, where the app has
one, a word: 下載 (no Docker Desktop, opens the download page) or 啟動 (stopped engine). An unreachable host or switched
off computer tools has no action. An absent image is a first start, so the row reads asleep and the same press
prepares it. The Computer tab, its host control and its maintenance menu stay as they were (their move to Settings is
a decision for the owner, not made here).

The larger view's pill: watching offers Take control; in control reads 你正在控制 with a quiet 停止 that hands the
computer back through the same takeover (the sign-in request's button stays 我完成了).

The conversation shows no line or card for a running, finished or stopped computer task any more
(`desktop-timeline.ts`); only a handoff the owner must act on is a card.

```
npm run look -- member-panel-details member-panel-details-computer-asleep member-panel-details-computer-connecting member-panel-details-computer-awake member-panel-details-computer-docker-missing member-panel-details-computer-docker-stopped member-panel-details-computer-remote member-panel-details-computer-open member-panel-details-computer-wake desktop-watch desktop-watch-owner takeover-bar desktop-panel chat-computer-takeover --theme both --width 1120,720,1920x1080
```

Not built, needs a real engine: one computer with a screen per member (see the unit report and
`bots/research/shared-computer-2026-11-09.md`); the live picture of the row against a real noVNC stream; the engine
start from the 啟動 word on a PC with Docker Desktop stopped.

## Quiet, lazy startup

The Windows host prefers PATH `docker.exe`, then
`%ProgramFiles%/Docker/Docker/resources/bin/docker.exe`. A hidden, read-only
`docker desktop start --help` probe checks the installed CLI. A supported CLI starts
with `docker desktop start --detach`, with no shell and discarded standard streams.
The GUI launcher is a legacy fallback only when the CLI is absent or the probe
fails with an explicit diagnostic that `desktop` is not a Docker command. Other
probe failures do not open the GUI. LocalVm retains its engine readiness polling,
preparation progress, errors, owner holds and leases.

Offline coverage: `tests/computer/test_desktop_host.py`, `test_vm.py`,
`test_member_computer_access.py`, `test_takeover.py`, `tests/agent/test_member_computer_use.py`,
`tests/background/test_computer_lazy.py`, and the snapshot/CLI/worker consumers.
All startup tests fake processes and Docker.

Owner acceptance: from `app/`, run `npm.cmd run native -- member-computer`
in the authorized native environment. Its pre-launch smoke asserts zero Docker
commands while preparing a turn, starts on the first actual screen call,
refreshes controls, and asserts zero Docker commands for the following prepare.
Also run an API and CLI greeting with Docker Desktop initially stopped,
then request a screen operation: greetings must leave it stopped, the screen
operation must complete without a Docker Desktop window appearing or taking focus,
and a following greeting must not start anything. Inspect the report and captures;
CLI fakes cannot establish real Windows window/focus behavior.

## Per-member hosts (2026-11-01, supersedes earlier local/shared assumptions)

The existing Settings > Raphael computer area uses the shared dropdown for This
computer / Another computer and shows an SSH alias input for the latter. It explains
separate sign-ins and the team folder. The remote choice never offers a local Docker
requirement. Invalid aliases stay in the field with an inline error that wraps
inside the settings column at narrow widths and never reaches storage. With local
Docker absent, installation remains in that same area; all other capabilities work.
Alias changes take effect for new targets without restarting the app; captured old
targets retain their original engine. Nothing reads SSH keys or starts a remote host.
Remote workspace/team volumes belong to that Docker engine; attachments use the
guest reader. The viewer uses an ephemeral loopback SSH forward, no remote published
port. Remote computers stay awake; local idle-stop and a two-computer capacity bound
apply only locally. Busy/held machines cannot be evicted; old running owned
containers count toward capacity but are never stopped automatically. Real Docker/SSH acceptance,
image startup and resource measurements are pending the owner's build/setup.

The frame adds the member's name and bare collapse action in a dark shell, in both
themes. Collapse retains the stream and never completes a takeover request. Compare
Settings dropdown/input with existing city and language fields, and frame controls
with the member details header at the same width/theme. References were supplied
outside git; trademarks and task teaching are excluded. The noVNC fixture proves
only the frame and real app interaction, not pixels from the unbuilt desktop image.

Selected scenes: desktop-host-remote, desktop-host-invalid, desktop-collapse,
desktop-panel, desktop-viewer, desktop-owner, desktop-handback, desktop-takeover,
desktop-takeover-owner, desktop-takeover-done, desktop-stopped, desktop-unavailable,
desktop-starting, desktop-building, desktop-preparing, desktop-absent, desktop-install.
Run both themes at 1120,720,1920x1080. Core: tests/computer/test_hosts.py plus
computer, grant/choice, lazy background, settings, native cleanup and architecture
consumers. Native cleanup recovers and removes every container owned by the isolated
journey data directory, retaining its workspaces. Each test member gets its own
sign-in fixture; native frame checks still run inside the cross-origin viewer.
Cleanup never stops Docker Desktop.

```powershell
npm run look -- desktop-host-remote desktop-host-invalid desktop-collapse desktop-panel desktop-viewer desktop-owner desktop-handback desktop-takeover desktop-takeover-owner desktop-takeover-done desktop-stopped desktop-unavailable desktop-starting desktop-building desktop-preparing desktop-absent desktop-install --theme both --width 1120,720,1920x1080
```


## Work channels, file restore and private page login (2026-11-01)

Slack and Discord join Telegram in Settings > Messaging, using the same rows,
separate Credential Manager tokens and the existing local pairing allowlist.
Only direct messages enter a conversation. Incoming captions and bounded files
reach the same assistant together; stored reply files return to the paired chat.
No remote message can approve pairing or execution. Slack uses paginated polling;
Discord uses the bounded TLS gateway and direct-message intent.

Before a turn's first non-read vm_exec, the computer takes one independent bounded
snapshot. Commands retain their original bytes and executor; gestures take none.
The pure Python guest archive stores SHA256 objects and manifests; unchanged size
and mtime avoid rereading a file, and identical manifests add no checkpoint.
Failures/timeouts never fail the command. Files above 20 MiB and partial walks are
named as uncovered in the panel. The archive retains 20 checkpoints per member
within approximately 500 MiB of objects per computer, pruning unreferenced objects.
Changes are compared on request against the next manifest or live folder. Restore
checks the reviewed after-state digest/mode and names later edits it leaves alone.
There is no pending/finish state. Full permission skips the additional confirmation;
grants/revocation still apply. Caches, repositories and browser profiles are excluded.
The existing panel uses relative folder words, compact time and signed added/removed
lines without diff headers; incomplete coverage never promises a complete restore.

request_secret(site) extends the existing secure card with username/password.
Credential Manager holds the values; SQLite holds only member/origin/reference
metadata, independently of the requesting turn. fill_login checks the exact HTTPS
origin and current grant before each field through the computer's lasting browser
connection. It never submits. Takeover remains available. Driver results and all
fill exceptions yield only filled true/false. Later page text/errors redact plain
and JSON-escaped values on computer results before model/history/events. Delegate
results pass through untouched. Filled-page pictures stay hidden until a different
origin and a complete tree prove the filled refs absent; no timer or other-tab
read lifts suppression. Saving a login alone hides nothing.
Vault read failures log only the exception type and never fail prepare. Login fields
are full-width labelled rows, with Save below. Explicit safety denials still win over
full permission on the API and shared CLI/background gate. Slack uses the supplied
Simple Icons 13.21.0 path through the shared icon renderer, with its brand purple in
the light theme and the text colour in the dark theme. Never use a letter substitute.

Selected matrix, from app/:

```powershell
npm run look -- work-messaging-setup work-messaging-pairing computer-file-changes computer-file-partial computer-file-confirm computer-file-restored computer-file-bypass computer-login-card computer-login-saved chat-secret-masked delete desktop-owner --theme both --width 1120,720,1920x1080
```

Compare login with chat-secret-masked, restore confirmation with delete, and panel
controls with desktop-owner at the same theme/width. Inspect every contact sheet
and full-size changed controls. Extend scripts/look rather than adding a harness.
Focused tests: messaging/test_work_channels.py, computer/test_checkpoints.py,
computer/test_checkpoint_revision.py, computer/test_login_visibility.py,
computer/test_login_vault.py, agent/test_private_login.py, brain/test_db.py,
work-channels.test.ts and scripts/look/audit.test.mjs. The review follow-up runs
computer, messaging, agent and background in full once, then targets any fixes.
Report explicitly if that full run preceded the last change. Frontend verify uses
two Vitest workers.


## Computer location moves to its panel (2026-11-05)

The former Settings > Raphael location and Docker installation area is superseded
by [Settings by purpose](settings-appearance.md#settings-by-purpose-2026-11-05).
The compact header/empty-state location popover is shared by all members. See that
entry for scenes, existing setting/RPC contracts and offline acceptance limits.


## Offline root and dispatch security (2026-11-05)

R-SEC-FILES-01/02: core/tests/computer/test_security_boundaries.py uses real temporary
Windows junctions (symlinks on other systems) and a fake Docker runner. It verifies
workspace/shared/parent redirection, both team-file handle forms, library root rejection,
and grant revocation, target change or owner hold during preparation/checkpointing.
The same checks apply to cached starts. Existing test_vm.py/test_takeover.py assertions
include vault_entries/fill_contact and the firm T3 fill_card exception, without weakening
owner-hold or single-use approval tests. No UI markup, scene or navigation changes.
Follow-up 1 resolves the Docker forwarding and screenshot-lifetime decisions;
see the approved hardening entry below and .fold/report.md. Do not call offline fake tests authorized SSH or native acceptance.

R-SEC-FILES-04 additionally checks artifact receipt roots and bounds bytes before
hashing. Include background/test_tasks.py, test_handoff.py and test_team_flow.py
alongside the security regressions and architecture suite for that consumer boundary.

## Private SSH and filled-page lifetime (2026-11-05 follow-up 1)

R-SEC-SSH-01 and R-SEC-PRIVATE-01 supersede the pending D01/D02 decision above.
Run tests/computer/test_followup_security.py, test_smooth_computer.py,
test_login_visibility.py and test_vault_entries.py with tests/computer,
tests/services and tests/architecture. Fake SSH covers socket success, unsupported
transport fallback, directory protection/cleanup and absence of TCP/SOCKS forwarding.
Fake browser states cover time, same-origin URL changes, other tabs, filled refs,
complete cross-origin clearance and incomplete/unknown/error observations. Only a
complete safe observation restores screenshots; payment holds remain independent.
No UI markup/navigation changes; real Windows OpenSSH/Docker AF_UNIX compatibility
and live browser behavior require separate native acceptance.

The private-picture capture race also requires test_navigation_after_capture_cannot_release_the_captured_private_picture:
a safe observation authorizes the next read, never earlier captured pixels. Recheck
grant/target before and after the final observation; revoked reads return no tree.
