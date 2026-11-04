# Startup rooms (2026-11-04)

R-PERF-13: the sidebar's first room snapshot cannot depend on a readiness event.
`createRoomsSection` retries the real room and roster reads after 100, 250, 500,
1000 and at most 2000 ms, until its first successful snapshot, including an empty
list. Detached sidebars stop retries. Success stops the startup timer; steady
state remains event-driven. A hidden-to-visible transition re-reads the snapshot
through the existing visibility gate. No page, setting, layout or migration changes.

`main_events` subscribes before a `core.hello` probe and sends CoreReady to that
subscriber when the probe succeeds. A core restart also maps to CoreReady. The
frontend type and existing readiness consumers share that event. Previously those
consumers existed but neither the Rust event enum nor its producer could deliver
CoreReady, so a failed initial read could leave an empty list indefinitely.

Manual launch must not suspend the main webview before its first successful show.
The shared show path resumes before showing and marks the successful first show;
subsequent minimize/hide behavior retains R-PERF-11. Explicit --autostart can still
sleep while staying in the tray. This is a structural safeguard: whether the owner
incident actually suspended before first show is not established by offline tests.

## Offline verification

From app/:

```powershell
node node_modules/vitest/vitest.mjs run scripts/look/native/native.test.mjs src/main/group-chats.test.ts --configLoader runner --maxWorkers=1
```

The room tests reproduce failed initial room/roster reads without CoreReady,
successful empty-list termination, detached sidebar termination and return from
hidden state. Native runner tests cover twenty independent launch plans,
request-versus-completion evidence and pre-CDP page instrumentation.
Rust webview_power tests protect manual startup and explicit autostart; commands
tests protect CoreReady's wire shape and restarted-core mapping. Also run the
affected core_process and first_run tests offline, with CARGO_BUILD_JOBS=2 and
CARGO_TARGET_DIR set to this worktree's .fold/cargo-target after wait-heavy.ps1.

## Integrator-owned native acceptance

Build a fresh isolated debug bundle offline as documented in app/scripts/look/README.md,
then run from app/:

```powershell
npm.cmd run native -- startup-rooms
```

The runner uses the existing native workflow, real main entry/core/SQLite and fake
brain. Every launch has its own data and WebView2 directory and seeded three rooms.
Ten normal launches use first_run::start, without a CDP reload or viewport change.
Ten slow launches additionally delay core startup by three seconds and fail the
first rooms.list once through debug-native-only switches. The fault injection is
deliberate recovery coverage, not evidence that the owner's original failure was
caused by that same RPC error or by a three-second delay.

An initialization script records initial visibility, visibility transitions,
CoreReady page delivery, room rows and early errors/toasts. Native traces record
inactive/active requests, skipped pre-show suspension, suspension requests and
completion/decline, first successful show and successful core hello. Report fields
distinguish a suspension request from actual successful suspension. Unknown page
delivery/visibility remains null when the probe is unavailable.

Each launch requires a visible native main window, all three persisted room rows
within five seconds of first show/core readiness, and no runtime errors. Keep
report.json, startupCounts (ten expected per variant), per-launch startup evidence,
app.log/native.log, screenshots, contact sheets and read-only SQLite snapshots.
Compare a pre-fix control retaining this journey/instrumentation/fault injection
with the fixed bundle; record failures and successes separately by variant. A
missing startup probe or incompatible old bundle is a prerequisite failure, not a
reproduction of missing sidebar rooms.

This scoped task forbids native windows and network calls. Native before/after
counts, actual suspension order, selected look images and judge remain unverified
until the integrator runs them. Offline red/green is not native acceptance.
