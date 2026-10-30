# Member computer (Phases A and B)

The optional Docker desktop is shared by default. `computer_vm_mode=per-bot`
selects a durable workspace per member. Host paths use pathlib and Docker CSV bind
mounts; no host shell or alternate runtime is used. The core starts an installed Docker Desktop through the host adapter when preparing
the computer. Docker absent means no computer entry or tools; the existing Settings
computer area has one requirement line and an official download button.

`computer/vm_catalog.py` curates 30 driver tools plus Raphael's `vm_exec` and
`attach_file` (32 total). Each selection has a one-line reason. Screenshot/window
state, input, application/window discovery, clipboard, verification and the Linux
CDP browser helpers are offered together, regardless of the question. Core-owned
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
exec. Busy desktops never queue another tool action.

Before sending a message or email, publishing or posting, deleting anything outside
the workspace, paying or buying, the member must first call `approve` on CLI brains
or request the equivalent owner approval through the API harness and wait for the
owner's yes for the exact action and target. If that approval is unavailable, denied
or expired, it must stop without acting. Sandbox success is never outward approval.
This contract is in every driver/exec tool description (within the shared offer's
400-character cap) and the shared doctrine in `agent/persona.py`; no click classifier
is used. Contract tests check the actual snapshot and every CLI/API/worker persona.

`vm_exec` defaults to 60 seconds, caps at 300 seconds and 20,000 combined output
characters, and times out in the guest as well as the host. `attach_file` only
copies regular files under `/home/cua/workspace` into the existing attachment
store. Guest directory traversal and symlinks are refused with openat/no-follow.
Screenshot blocks reach CLI and API brains, are treated as untrusted screen
data, and are omitted from saved background continuations and public steps.

New containers reuse the last validated IANA zone sent by the UI to `home.overview`
as `TZ`, falling back to UTC until one is known. The zone stays in memory; no
setting or platform-specific lookup is added. Existing containers are not recreated.

Container reuse checks ownership, image ID/labels, bind mount, loopback publishing
and resource/security limits. Idle shutdown defaults to 480 minutes (5-1440),
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

Phase A adds no application UI. Phase B extends the existing conversation header
and shared dialog with the live desktop. The own-PC cua driver remains Phase C.

Tests: `core/tests/computer/test_vm.py`, existing agent CLI/MCP, background and
worker suites. Attribution: `THIRD_PARTY_NOTICES.md` and `licenses/Apache-2.0.txt`.


## Live desktop (Phase B, 2026-10-30)

One monitor icon in the selected private conversation opens the container's own
noVNC vnc.html inside the existing shared dialog. Docker absent hides the entry;
a stopped desktop or unavailable engine shows a localized state without a blank
frame. Opening the viewer starts preparation through the shared VM lifecycle. The same session reconnects
after the member restarts its desktop, including a changed loopback port.

The dialog deliberately uses the shared thread-width maximum rather than the
small rename form's width, so the remote desktop stays readable. Its screen is
16:10 and capped at 60vh; offline placeholders retain that same screen geometry.
The heading, close icon, footer divider and action buttons remain the existing
dialog components. A failed initial HTML/module load retries after 30 seconds;
an established RFB connection reconnects after interruption without reloading.

The core-only loopback bridge uses the container's noVNC RFB library with an
UI-free library shell, omitting the standalone page's stylesheet, controls and
curved disconnected background. Its native `scaleViewport`, `resizeSession`,
`clipViewport` and `background` options fit the desktop without distortion or
dark side bands; no CSS covers or crops the iframe. Passwords reach RFB memory
through a no-store same-origin response, never HTML, saved URLs, public status,
reports or application logs. NoVNC is supplied by the pinned image; no separate
browser library or upstream source copy is bundled. The iframe uses a sandbox and
no-referrer policy. Host/origin checks and an unpredictable session capability
guard the bridge. Keep it loopback-only for any later phone transport adapter.

Take control acquires Phase A's owner hold only between tool calls. Other viewers
remain read-only; ownership and busy states are authoritative in core. Handback
closes the input sockets before releasing that same hold. Closing, navigating to
another member, leaving the conversation or a 15-second heartbeat expiry releases
only the owning viewer's lease. Opening a room on the same page also closes the
viewer; returning to a private conversation resumes entry polling. A hold owned
by another surface is never cleared.

```powershell
npm run look -- desktop-entry desktop-viewer desktop-owner desktop-handback desktop-stopped desktop-unavailable desktop-starting desktop-building desktop-preparing desktop-absent desktop-install --theme both --width 1120,720,1920x1080
```

These scenes drive the real app, shared icon and dialog through the IPC mock.
The production Python shell and RFB bootstrap run in the look scenes. Only the
remote RFB class is a synthetic transport fixture, labeled as a test desktop.
The synthetic upstream document retains noVNC's curve and controls, so the shared
`desktop-frame` check rejects the original bug. It measures the limiting axis,
framebuffer aspect ratio, clipping, visible controls and unobscured canvas corners.
It does not prove Docker, WebSocket/VNC authentication or native
WebView mixed-content/CSP behavior. Compare desktop-entry's monitor with chat's
existing gear, and desktop-viewer with rename at the same theme
and viewport. Inspect all contact sheets and relevant full-size images.

The member-computer native journey now requires a fresh debug build of this
checkout. It runs the original fake-brain tool/gate assertions, then opens the
real app's conversation entry and connected noVNC canvas, takes control, checks
the core owner state, hands back and checks the member state. Screenshots include
entry, viewer, owner and handback. Cleanup stops only the journey's container.
The pre-launch smoke creates the container before Home knows the owner's zone.
After Home, the journey calls the real `vm_exec` tool with `date +%z` and compares
its result with the host's current UTC offset. The same `desktop-frame` check runs
inside the real noVNC iframe after viewing, taking control and handing back.
Home's timezone notification reconciles recovered running containers: a mismatched
`TZ` recreates only a compatible owned container, preserving its bind workspace.
Busy/held desktops defer reconciliation until the next tool start or monitor pass;
stopped containers are recreated with `docker create`, retaining their stopped
state. The next tool start also reconciles the zone, covering starts racing Home.
Run this native journey only when explicitly authorized and no other heavy process
is running; stop Docker afterward if this run started it. The connect-and-Docker
owner deferred this journey because memory was low, so its current acceptance is
SKIP. Judge and OpenRouter remain prohibited for that brief. Other native journeys
disable the computer adapter.

Unit evidence: core/tests/computer/test_viewer.py and
app/src/main/desktop-viewer.test.ts. The existing test_vm.py suite retains the
actual tool refusal assertions. Shell tests allowlist only the five viewer RPCs.
