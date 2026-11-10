# Idle native runtime

## Behavior and checks (2026-11-04)

R-PERF-09 extends the member-computer boundary. Status reads use a three-second
per-target cache and lock, validated against vm.changes. Preparation is read live;
ownership, work and teaching are composed after the cached VM state. Unwatched
computers retain their ten-second cache. Non-probing VM status inspects the
container and rechecks engine/image at sixty seconds, on VM changes or failed
inspect. Probing status still verifies driver health. Live authenticated sockets
let renewal report running and current lease/work metadata without a status read.
The viewer backs off from two to four, eight and ten seconds on unchanged state.
Lease TTL is fifteen seconds. A connected lease keeps its captured VM target even
if settings change. Stream failure, direct controls and VM invalidation retain their
existing paths.

R-PERF-10 extends Dictation. Backend hotkey events and physical cancel/reset input
wake the worker through the command inbox after queuing data. The worker still
drains backend input before applying commands. An async channel-closure waiter
wakes shutdown when its output receiver disappears, with no idle polling.
The Windows manager blocks on raw
input and shuts down by stopping the hook, which closes the raw sender within
the 100 ms hook-loop bound. Input wakes MsgWaitForMultipleObjects immediately;
the timeout does not add 100 ms to a physical key. The heartbeat maximum remains
250 ms, above two loop periods. Observation drain checks the actual deadline and
scope synchronously; MAX_WATCH is sixty seconds and idle expiry can lag by at
most one loop period. All swallowing/injection/reconciliation code is unchanged.

R-PERF-11 extends the native window boundary. with_webview owns every controller
operation. Hide/minimize orders invisible, Low, TrySuspend; resume orders Resume,
Normal, visible. The callback resumes again when a show raced a pending suspend.
The initial hidden page requests the same policy after subscribing. Learned is
always Low. Overlay lifecycle completion/hide and answers request Low and live
recording and question events request Normal; the overlay is never
suspended. Finite captions/notices use Low throughout, because page-only expiry
has no native callback. Low is a memory target and does not pause animation/input.

Tauri 2.12.4 Channel sends small messages through webview.eval; larger messages
wait in ChannelDataIpcQueue until fetched. Suspension is not a page disconnect or
a durable-delivery guarantee, and Channel::send succeeding does not prove a
JavaScript handler ran. Resume preserves the page/channel. main/main.ts comeBack
on focus or visibilitychange calls the current page's show and re-reads data;
settings intentionally keep unsaved edits. Native acceptance must check actual
delivery/order, history catch-up and existing channel consumers after a long hide.

R-PERF-12 retains the existing R-UI-70 physical bounds, hold and revision tests.
Only cursor reads change: GetCursorPos runs on the worker; origin is cached at
registration and native move/resize/scale events. Windows ticks never wait for
Tauri cursor_position or inner_position. Non-Windows cursor fallback is retained.

## Integration journeys

Run the existing isolated fake-brain journeys, with one heavy job at a time:

```powershell
npm.cmd run native -- hidden-window hidden-window-refused owner-round10 voice-conversation voice-keys locale-sweep delete-conversation
```

owner-round10 covers learned hover/expiry, mouse pass-through, foreground
continuity, monitor positioning and Undo. voice-conversation and voice-keys cover
worker/controller input, release, cancellation and dictation timing; debug native
journeys omit registration on the owner's global keyboard, so a separately
authorized physical-key hold/chord/swallow journey is still required. Check
long-hidden
history/activity catch-up, idle/active overlay memory target, hidden dictation and
floating controls across negative origins and 100/125/150/200 percent DPI.
Retain native logs, screenshots and channel/persistence evidence. These remaining
manual extensions are not yet named native-runner journeys.

hidden-window covers R-PERF-11 and the R-PERF-03 visibility-log boundary with an
isolated member conversation, fake brain and real WebView2. CloseRequested hides
the main window; the never-suspended learned page invokes main_window_forward,
which calls the tray's shared show_main_window routine. A second cycle minimizes
through a Win32 system command scoped to the runner's PID and restores through
that same learned-to-native Resume/show path, never Win32 ShowWindow. Learned may
call this command only in the isolated debug lifecycle journey; production keeps
its main-only caller check. No main-page evaluation occurs while hidden, even to
wake it. CDP's protocol timeout is five seconds; the wake command is bounded to
three seconds. Only this debug-native journey opts into close-to-tray via
RAPHAEL_TEST_NATIVE_WINDOW_LIFECYCLE; it creates no tray icon or global hooks.
The unconditional 100 ms page timer must tick while visible, remain flat over at
least six hidden seconds after a 1.5-second suspension grace, and tick again within
three seconds of showing. No CDP page evaluation occurs during the hidden dwell.
A typed RPC submitted just before hiding completes after the existing fake
brain's four-second core delay; read-only SQLite must show that zero-cost reply
before returning, and the reply row must appear on screen afterward. Each cycle
also requires the main page's hidden-then-visible console logs and no runtime
errors. Timer timestamps, window states, persisted replies and captures stay in
the ordinary native report. A control build retaining this harness but omitting
main-window suspension must fail its counter assertion even with once-per-second
hidden timer throttling. Native before/after evidence remains integrator-owned;
offline native.test.mjs covers selection and rejects throttled counter samples.

After both cycles, six rapid minimize-and-return trips (dwell 0 to 2.5 s, racing a
pending suspension) must each leave a visible page that ticks within three seconds.
hidden-window-refused repeats the journey while the debug-only
RAPHAEL_TEST_NATIVE_POWER_REFUSE makes WebView2 refuse the normal-memory step with
0x8007139F, the owner's frozen return of 2026-11-05: once one step was refused the
old code never reached SetIsVisible, and Resume kept failing with the same error.
The old code fails it at the first return; each step now runs on its own and both
journeys pass (red run-F3lA4L, green run-VdelwA).

The existing member-computer journey verifies the real stream, renewals, takeover,
handback and reconnect, including click latency. It starts/stops Docker and needs
separate integrator authorization; do not run it under a no-Docker brief.

No look, judge, live model or native journey is executed by this scoped unit.
Use affected desktop/overlay scenes at integration if visual evidence is needed.
Offline tests do not establish native latency, CPU savings, WebView suspension
success or real Docker behavior.
