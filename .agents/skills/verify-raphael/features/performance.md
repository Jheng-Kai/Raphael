# Quiet idle and visibility

## Behavior

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

The calendar's overview shows local data first and starts no allowance read of its own; the account
menu reads `usage.allowances` through the existing API at each opening (another unit owns how that read refreshes).

Conversation events use bounded trailing refresh windows and cheap local turn
revisions. Older cores have no per-turn update timestamp, so a new wire object
receives a new revision only when a scalar or nested wire value changes. Reply
strings are compared directly rather than serialized. An unchanged keyed patch
skips media, preview, desktop, result, page and layout synchronization.

Scroll affordances and full preview resize/font measurements share one frame.
Rich content retains its MutationObserver code list and finds nearby blocks by
halving; disclosure changes rebuild it. The overlay emblem caps animation-loop
updates at 60 per second while its simulation uses elapsed time.

R-PERF-25 and R-PERF-26 cover the two edges the owner drags and the panes they open and close. The list's width and the details
panel's are written for each pointer move as `--side-live` and `--panel-live` (`live-size.ts`), custom properties registered as not
inherited and set only on the grid of the panes, the caption strip, a scrim, the panel and its page. They were `--sidebar-width` on the
root and `--pa-det` on the page, which every element beneath inherits: each move restyled the whole window (1,000 to 1,500 elements,
25 to 45 ms), the layout of the panes was 1 ms, and two frames in three were late. Centred columns of the conversation (`.ra-col`, the composer, ask and draft cards) take a lead rounded down to a whole pixel (`--col-lead`), so they move by whole pixels while a pane is dragged; the centred words of the list's Connections pill still move by half pixels. Holding the edge puts one `.edge-shield` over the
window for its cursor and its press (`edge-drag.ts`); it no longer sets `cursor` and `user-select` on the root. `resize-probe`
(`scripts/look/resize-probe.mjs`) drags an edge out and back, or toggles a pane, and reports frames, style and layout work, the
elements each write restyled (`recalcElementsPerWrite`), ResizeObserver runs and how the words moved (read where the owner sees
them, after the app's own observers). `LOOK_RESIZE_THROTTLE=4` runs it with a CPU four times slower, `LOOK_INVALIDATIONS=1` names
what invalidated the styles and `LOOK_SERIES=1` lists each word's jumps.

## Selected rendered verification

The existing Members, Conversation, Navigation, Automations, Dictation and Settings
maps supply these representative consumers. Use both themes and all three sizes:

```powershell
npm run look -- slime-states slime-gallery slime-liquid-sheet slime-liquid-still slime-parts slime-motion-idle slime-motion-busy slime-motion-moments slime-motion-change slime-characters-at-rest slime-sizes slime-pointer presence-states-sidebar busy-team-thread busy-team-room busy-team-typing busy-team-follow busy-team-anchor thread-new-divider-stays rich-code rich-diagram conversation-chief-up conversation-member-up conversation-room-up automations-calendar dictation-overview dictation-notice cli-account-disconnect-ask overlay-confirm-short-120 overlay-confirm-long-150 --theme both --width 1120,720,1920x1080
```

Pane drags and toggles: `npm run look -- sidebar-resize-smooth sidebar-resize-busy sidebar-toggle-smooth panel-resize-smooth panel-resize-busy panel-toggle-smooth --theme both --width 1120,720,1920x1080`.
The list's scenes skip below 860 px, where it is the rail with no edge. Each scene's report carries the frames and the work behind them.

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
