# Member computer (Phases A and B)

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
granted browser. Exact Reject all / necessary-only semantic buttons may be
clicked; ambiguous controls never imply consent. Every browser subcall retains
the normal gate and owner-hold checks. No fallback reader/provider is purchased.

Settings checks remote SSH key access, noninteractive Docker PATH, daemon and
installed image architecture through read-only SSH commands. Fixed localized
repair words replace raw diagnostics. Docker operations share an owned SSH
session forwarding the remote Unix socket to loopback; the viewer uses SOCKS on
that same session. Forwarding failure falls back to ssh:// with bounded backoff.
No Windows ControlMaster or remote install/start is required.

Idle/eviction and app shutdown only stop compatible owned computers; workspace
mounts and browser profiles survive. A recognized v3-to-v4 rebuild announces its
workspace/sign-in preservation before removal, never removes a volume and refuses
foreign or weakened containers. Files/installs outside workspace are explicitly
ephemeral in tool/persona text. Member deletion retains computer data by default;
its unchecked option names the host, pins that host for the operation and excludes
shared/team storage. No deletion/host operation was executed in this brief.

Selected future look matrix (both themes, 1120,720,1920x1080): desktop-panel,
desktop-watch, desktop-watch-collapse, desktop-watch-boot, desktop-watch-stopped,
desktop-watch-owner, desktop-takeover, desktop-takeover-owner,
desktop-takeover-done, desktop-owner, desktop-host-remote, desktop-host-invalid,
desktop-host-health, delete-member-computer. Compare Enlarge/collapse/Stop with
the existing icon buttons and card Done/Skip with computer-card controls at the
same theme/size. The owner-typing scene uses synthetic RFB input only.

```powershell
npm run look -- desktop-panel desktop-watch desktop-watch-collapse desktop-watch-boot desktop-watch-stopped desktop-watch-owner desktop-takeover desktop-takeover-owner desktop-takeover-done desktop-owner desktop-host-remote desktop-host-invalid desktop-host-health delete-member-computer --theme both --width 1120,720,1920x1080
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

The v4 image passes --no-overlay only when serve --help advertises it; every
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
request_takeover, fill_login and per-bot dataset are offered offline after a grant.
Permissionless turns still see only request_computer. The first actual driver
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
tests/agent/test_computer_grants.py, tests/background/test_computer_lazy.py and
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
npm run look -- desktop-starting desktop-building desktop-preparing desktop-wallpaper-morning desktop-wallpaper-noon desktop-wallpaper-dusk desktop-wallpaper-evening desktop-wallpaper-night desktop-boot-inline desktop-boot-card desktop-boot-connect desktop-boot-expanded desktop-boot-raphael desktop-own-wallpaper desktop-own-wallpaper-card desktop-stopped desktop-unavailable desktop-absent desktop-panel desktop-viewer --theme both --width 1120,720,1920x1080
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
An unprovisioned/ungranted computer is omitted; unavailable/install/preparation
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
memory-editing/saved and polish-caption-member.

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
npm run look -- desktop-teach-recording desktop-teach-draft desktop-teach-saved desktop-teach-try desktop-teach-discard desktop-teach-shared desktop-owner desktop-absent details-skills skill-private-detail --theme both --width 1120,720,1920x1080
```

The teach-* rendered checks assert lease actions, visible privacy/repair, the
editable draft before Save, explicit publication, discard without publication,
and the ordinary conversation call with skill name and fresh input. Compare the
draft editor with details-skills/skill-private-detail, and teaching controls with
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
tree cleanup on Stop/app close, and the granted Docker path after schema discovery.
Offline fakes and rendered fixture success do not prove Docker, cargo, native
journeys, network, judge or real subscription commands. Rule IDs: R-PC-01/02/03 and R-AG-13.

The optional Docker desktop defaults to `computer_vm_mode=per-bot`: a durable workspace,
container and browser profile per member (3 GiB and two CPUs each), plus a shared team
folder at `/home/cua/team`. Existing explicitly saved shared mode remains supported. Host paths use pathlib and Docker CSV bind
mounts; no host shell or alternate runtime is used. The core starts an installed Docker Desktop through the host adapter on the first actual
computer operation. A granted turn's tool preparation never invokes Docker. When Docker is absent,
no computer tools are offered; the existing Settings computer area has one requirement line and an official download button.

`computer/vm_catalog.py` curates 30 driver tools plus Raphael's `vm_exec` and
`attach_file` (32 total). Each selection has a one-line reason. Screenshot/window
state, input, application/window discovery, clipboard, verification and the Linux
CDP browser helpers are offered together offline from the first granted turn.
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
npm.cmd run verify -- --core
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

## On-demand member permission (2026-10-31)

Computer access defaults off per member, including Raphael (0). The only computer
capability offered before permission is computer__request_computer(reason), a pinned
T2 request answered by the existing private-chat permission card (YES/NO; no Always).
YES persists a per-member computer_grants row (schema 45), prepares an offline tool offer and updates
the same turn's production snapshot before the next API model step. CLI loops reload
the MCP catalog in a new isolated CLI attempt within the same owner turn, preserving
the native session and without replaying completed actions. NO/expiry explicitly say
that the computer cannot be used. Routines cannot acquire a grant; requesting access
ends the routine as failed with computer_permission_required and an owner-facing reason.

Explicit computer.viewer_open (not preview or status) grants that member before launch.
The maintenance CLI start/run does likewise. Revoke through computer.revoke in core RPC
or python -m raphael_core.computer.vm_cli revoke --data-dir <dir> --member <id>.
The window has no revoke control yet, and the revoke RPC is not shell-allowlisted;
use the maintenance CLI today. Revocation blocks subsequent calls, including stale
snapshots, but does not kill already running commands, containers or owner viewers.

Container state never grants access. Without an explicit per-member grant, prepare
does not probe the engine or container, offer operation tools, or persist any grant
row, even if a compatible VM is already running. The member must request permission.
After permission, prepare offers tools without starting or probing the VM; viewer launch
also rechecks after its status probe. No lifecycle, idle-stop, attachment, takeover
or handback semantics change under a grant. Both native VM journeys grant explicitly.

Offline regressions: core/tests/computer/test_grants.py and
core/tests/agent/test_computer_grants.py, plus the existing computer/agent/background
suites. Native member-computer grants first and starts the installed Docker engine
only when its first screen tool is called. Core-only code
has no changed visual scene or new UI. Fixture/fake results are not native acceptance.

The panel view has a start button for a stopped computer and a take-back button for a granted member. `computer.revoke` keeps the row at 0, so a later request asks again. Looking at the panel never starts a computer.

## Quiet, lazy startup

The Windows host prefers PATH `docker.exe`, then
`%ProgramFiles%/Docker/Docker/resources/bin/docker.exe`. A hidden, read-only
`docker desktop start --help` probe checks the installed CLI. A supported CLI starts
with `docker desktop start --detach`, with no shell and discarded standard streams.
The GUI launcher is a legacy fallback only when the CLI is absent or the probe
fails with an explicit diagnostic that `desktop` is not a Docker command. Other
probe failures do not open the GUI. LocalVm retains its engine readiness polling,
preparation progress, errors, grants, owner holds and leases.

Offline coverage: `tests/computer/test_desktop_host.py`, `test_vm.py`,
`test_grants.py`, `test_takeover.py`, `tests/agent/test_computer_grants.py`,
`tests/background/test_computer_lazy.py`, and the snapshot/CLI/worker consumers.
All startup tests fake processes and Docker.

Owner acceptance: from `app/`, run `npm.cmd run native -- member-computer`
in the authorized native environment. Its pre-launch smoke asserts zero Docker
commands while preparing a granted turn, starts on the first actual screen call,
refreshes controls, and asserts zero Docker commands for the following prepare.
Also run a granted API and CLI greeting with Docker Desktop initially stopped,
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
results pass through untouched. Pictures are withheld only for a just-filled page
until its URL changes or two minutes pass; saving a login alone hides nothing.
Vault read failures log only the exception type and never fail prepare. Login fields
are full-width labelled rows, with Save below. Explicit safety denials still win over
full permission on the API and shared CLI/background gate. Slack uses the supplied
Simple Icons 13.21.0 path through the shared icon renderer, with its brand purple in
the light theme and the text colour in the dark theme. Never use a letter substitute.

Selected matrix, from app/:

```powershell
npm run look -- work-messaging-setup work-messaging-pairing work-slack-connect computer-file-changes computer-file-partial computer-file-confirm computer-file-restored computer-file-bypass computer-login-card computer-login-saved chat-secret-masked delete desktop-owner --theme both --width 1120,720,1920x1080
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
