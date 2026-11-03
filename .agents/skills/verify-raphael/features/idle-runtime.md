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
always Low. Overlay lifecycle completion/hide/release requests Low and live
recording, held speech and question events request Normal; the overlay is never
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
npm.cmd run native -- owner-round10 voice-conversation voice-keys locale-sweep delete-conversation
```

owner-round10 covers learned hover/expiry, mouse pass-through, foreground
continuity, monitor positioning and Undo. voice-conversation and voice-keys cover
worker/controller input, release, cancellation and dictation timing; debug native
journeys omit registration on the owner's global keyboard, so a separately
authorized physical-key hold/chord/swallow journey is still required. Check
tray hide/show, OS minimize/restore, rapid show during pending suspend, long-hidden
history/activity catch-up, idle/active overlay memory target, hidden dictation and
floating controls across negative origins and 100/125/150/200 percent DPI.
Retain native logs, screenshots and channel/persistence evidence. These manual
extensions are not yet named native-runner journeys.

The existing member-computer journey verifies the real stream, renewals, takeover,
handback and reconnect, including click latency. It starts/stops Docker and needs
separate integrator authorization; do not run it under a no-Docker brief.

No look, judge, live model or native journey is executed by this scoped unit.
Use affected desktop/overlay scenes at integration if visual evidence is needed.
Offline tests do not establish native latency, CPU savings, WebView suspension
success or real Docker behavior.
