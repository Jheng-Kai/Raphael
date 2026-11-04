# Quiet idle and visibility

## Behavior (2026-11-04)

R-UI-99/100 and R-PERF-03 through R-PERF-08 cover this cross-feature change.
Idle and sleeping slimes retain their resting vector and costume with no animation strips or breathing loop. Sleeping keeps closed eyes.
Pointer entry starts one finite delight on the static vector, then it rests again. No state draws a droplet or a bubble; no detached elements, keyframes or sampled cel data remain.
Active body motion and finite handover remain. Working needs only twelve cels.

`window-visibility.ts` gates interval work independently of focus and refreshes
active consumers once after a hidden-to-visible transition. The real main entry
sets `html[data-window-hidden]` to pause main-window animations and pseudo
elements while hidden, preserving their phase on return. Offscreen slime surfaces
and descendants independently keep `animation: none !important` to avoid
long-thread freezes. The main console logs
`main page: document <visibilityState>` once per visibility event.

Home shows local data first. Its timer requests cached allowances within five
minutes; Home's core service enforces the same TTL across page instances and
shares in-flight live reads. Month navigation may refresh calendar data inside
the TTL; the core still uses cached allowances.

Conversation events use bounded trailing refresh windows and cheap local turn
revisions. Older cores have no per-turn update timestamp, so a new wire object
receives a new revision only when a scalar or nested wire value changes. Reply
strings are compared directly rather than serialized. An unchanged keyed patch
skips media, preview, desktop, result, page and layout synchronization.

Scroll affordances and full preview resize/font measurements share one frame.
Rich content retains its MutationObserver code list and finds nearby blocks by
halving; disclosure changes rebuild it. The overlay emblem caps animation-loop
updates at 60 per second while its simulation uses elapsed time.

## Selected rendered verification

The existing Members, Conversation, Home, Automations, Dictation and Settings
maps supply these representative consumers. Use both themes and all three sizes:

```powershell
npm run look -- slime-states slime-gallery slime-liquid-sheet slime-liquid-still slime-parts slime-motion-idle slime-motion-busy slime-motion-moments slime-motion-change slime-characters-at-rest slime-sizes slime-pointer presence-states-sidebar busy-team-thread busy-team-home busy-team-room busy-team-typing busy-team-follow busy-team-anchor thread-new-divider-stays rich-code rich-diagram conversation-chief-up conversation-member-up conversation-room-up home-empty home-many automations-calendar dictation-overview dictation-notice cli-account-menu messaging overlay-confirm-short-120 overlay-confirm-long-150 --theme both --width 1120,720,1920x1080
```

Run judge against that same selected run. The implementation brief delegates look
and judge to the integrator; unit tests do not establish rendered acceptance.
Compare the same resting characters in the picker, sidebar and group faces; compare
moving presence in private threads and rooms, and latest controls in all three
conversation consumers. No new visual treatment is introduced.

## Native and performance boundaries

In an isolated real WebView2 run, retain console visibility logs while minimizing,
restoring, hiding to tray and returning. Confirm `hidden` is actually reported;
CSS cannot infer complete occlusion if the platform reports `visible`. Leave the
window visible while typing in another app and confirm work keeps moving and
polling. Verify stream lease renewal after a hidden period and the latest control
and reading anchor after returning. This unit does not change Docker polling,
hotkeys, tray suspension or native cursor loops.

No CPU saving percentage is claimed without a real measurement. Existing motion
cost scenes remain available to the integrator. DOM/fake-process tests establish
only offline behavior, not native visibility, lease recovery or design acceptance.
