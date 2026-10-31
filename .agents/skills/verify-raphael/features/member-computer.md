# Member computer (Phases A and B)

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
This brief prohibits Docker, cargo, native journeys, network, judge and real
subscription commands. Offline fakes and rendered fixture success do not prove
those boundaries. Rule IDs: R-PC-01/02/03 and R-AG-13.

The optional Docker desktop is shared by default. `computer_vm_mode=per-bot`
selects a durable workspace per member (and its own container, 4 GB and 2 CPUs each; members
then no longer share files, which a team building one program needs). Host paths use pathlib and Docker CSV bind
mounts; no host shell or alternate runtime is used. The core starts an installed Docker Desktop through the host adapter on the first actual
computer operation. A granted turn's tool preparation never invokes Docker. When Docker is absent,
no computer tools are offered; the existing Settings computer area has one requirement line and an official download button.

`computer/vm_catalog.py` curates 30 driver tools plus Raphael's `vm_exec` and
`attach_file` (32 total). Each selection has a one-line reason. Screenshot/window
state, input, application/window discovery, clipboard, verification and the Linux
CDP browser helpers are offered together after the first real driver listing, regardless of the question. Before that listing, an offline
bootstrap offers `get_desktop_state`, `vm_exec`, `attach_file` and `request_takeover`.
The screen tool discovers the actual driver schemas on use and refreshes the same
API/CLI/background turn's catalog; missing tools are removed and changed schemas
are validated before forwarding an action. The real catalog stays in memory for
later turns in this process. Core-owned
`PluginTool.pinned` metadata excludes them from the 40-plugin budget, keyword
shortlists, model refinement and the foreground planner's selection. Other plugins
keep their existing cap and discovery. Driver updates/installs, configuration,
recording/replay, escalation, lifecycle and redundant script runners are excluded;
unknown future driver names are excluded too. No backend-supplied flag can pin a
normal plugin tool. The gate and owner-control lease still apply on every call.

The recorded names fixture is `core/tests/computer/fixtures/cua-driver-0.37.0.json`.
The owner's brief says 67 but lists 68 unique names (including the two Raphael
tools); the fixture preserves all 68. The pinned Linux wheel was unavailable
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
until it has called `get_desktop_state` again. Commands (`vm_exec`, `attach_file`) never
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
worker suites. Attribution: `THIRD_PARTY_NOTICES.md` and `licenses/Apache-2.0.txt`.


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
Docker runs only in an exclusive heavy slot. Stop only the journey-created container by exact name afterward; never stop Docker Desktop or another member computer. No paid/live provider
or judge request is authorized.

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
only when its first screen tool is called. This brief prohibits judge and live/paid providers; core-only code
has no changed visual scene or new UI. Fixture/fake results are not native acceptance.

The panel view has a start button for a stopped computer and a take-back button for a granted member. `computer.revoke` keeps the row at 0, so a later request asks again. Looking at the panel never starts a computer.

## Quiet, lazy startup (CODEX_BRIEF2)

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
All startup tests fake processes and Docker. No real Docker/native run was made
for this brief.

Owner acceptance: from `app/`, run `npm.cmd run native -- member-computer`
in the authorized native environment. Its pre-launch smoke asserts zero Docker
commands while preparing a granted turn, starts on the first actual screen call,
refreshes controls, and asserts zero Docker commands for the following prepare.
Also run a granted API and CLI greeting with Docker Desktop initially stopped,
then request a screen operation: greetings must leave it stopped, the screen
operation must complete without a Docker Desktop window appearing or taking focus,
and a following greeting must not start anything. Inspect the report and captures;
CLI fakes cannot establish real Windows window/focus behavior.
