# Home overview

## Sub-features

Startup and first-run landing, Raphael's status report, pending questions across
conversations, today's routines, latest unread member reports, today's calendar,
monthly spend/budget, fourteen-day spend series, subscription allowances and 
dictation charts. The twelve-column grid includes Today, a combined inbox and three stat cards. Today contains routine occurrences and connected
calendar events for the current date. Pending contains questions/approvals; unread
reports belong in Reports.

## How to get to it (user POV)

Launch the app, complete onboarding, click Home (first in the rail), or click the
Raphael brand. A report opens its member's conversation at that exact turn;
routines open Automations. Spend and allowance buttons open Usage, and the dictation card icon opens Dictation. The Today icon and timeline items open the calendar. The status report keeps Raphael's emblem visible and turning: it plays his loop (the one of the 拉斐爾 page) while the window allows motion and is the still picture under reduced motion, following the preference as it changes. Nothing sits right of the report except its one fixing icon when something is wrong: asking Raphael is done on his own page (owner, 2026-10-25), so the hero has no ask icon.
The bottom of the sidebar holds 連結應用程式, above Settings, with the number of connected apps
(at the row end beside its label; a badge on its icon only in the 拉斐爾 page's rail); it opens
Settings > Connections (see [Connections and MCP](connections-mcp.md)).

## Driving it with look

```powershell
npm run look -- home home-empty home-720 home-report home-routine home-calendar home-many home-motion --theme both --width 1120,720,1920x1080
```

Scenes run with reduced motion, so every home scene above shows the emblem's still picture, and its `home-overview` check asserts that (and that the hero has no ask icon).
`home-motion` allows motion (`motion: true`, with `freeze-motion` for the CSS animations) and asserts that the page asks for the loop and that the loop is an animation (a WebP of 144 frames over 6 s):
the loop plays by itself, which a canvas cannot sample, so its screenshot shows whichever frame the clock was at. A refresh of Home does not replace the emblem's node, so his turn is not started over (pages/home.test.ts).

Owner round 4 follows the supplied Home mockup: a borderless 72px emblem/date/headline
lead, Today (7/12) and one inbox (5/12) with pending/report sections, followed by
three equal stat cards. The page is capped at 1080px including 56/40/48 padding;
section/card gaps are 32/24px. At <=1100px the agenda and inbox stack, and at
<=760px all cards stack. Stats share 28px figures and bottom-aligned 48px charts;
CLI meters show used percentages, with unknown windows displayed as an em dash.
Agenda rows use 56px time tracks, a 3px accent tick and 44px row height.
The report remains the widest first element and the three stats fill their row.
Cached data redraws on every locale change without replacing the emblem node.

Inspect every contact sheet and the full-size home/report images. The home-720
scene scrolls to the lower usage and dictation area at all three widths. The home-report
assertion checks member history, conversation 11, around_id 2 and the rendered turn.
The after-onboarding scene also asserts that Home is selected and first in the rail.
Every home scene's `home-overview` check also asserts that each page is named on one line in the
sidebar; at 720px 連結應用程式 keeps its number centred after its label.

Timeline actions keep visible token-based frames (R-UI-18), including calendar events.

## Gotchas

All records come from home.overview; no new persistent store is introduced. Counts
cover all available records; payload limits are 12 today items, 8 reports and 24
calendar occurrences. Subscription windows can be unavailable and show that state.
Google Calendar uses connectors.status with refresh=false and the existing private
calendar_list_events tool only when ACTIVE and enabled. It reads the primary calendar,
expands recurring events and orders by start time, with a seven-day window, 24-result
limit and twelve-second timeout. Unavailable, disabled, missing-scope or expired
connections produce no events; routine occurrences remain available. Home refreshes
on ConnectionsChanged. All-day dates use the calendar's time zone. Reports remain
separate from the timeline. Offline connector tests exercise the real service and an
HTTP double; browser fixtures prove rendered navigation, not live
provider usage, OAuth, native persistence or scheduler execution. For native proof,
use an authorized isolated data directory, create a harmless routine, receive a
member report offscreen, then verify its arrival/read state and exact-turn jump.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Locale changes behind Settings (2026-10-29)

Home immediately redraws its cached overview on every onLocaleChange, including
while Settings retains it behind the modal. Card titles, Raphael's report, empty
states, allowance periods/reset labels, dictation units, chart aria labels and
View all buttons follow en, ja and zh-TW without waiting for another RPC. The
happy-dom regression is in pages/home.test.ts; native locale-sweep exercises the
real Settings selector and keeps its screenshots and exact offending elements.
The sweep accepts the Raphael brand and actual OS microphone names only within
the microphone selector. Home, home-empty and home-720 cover both themes at
1120, 720 and 1920x1080; native locale-sweep supplies the language-switch proof.

## Owner round 6 contracts

Owner round 6: home/home-empty/home-many keep the emblem and report copy side by side at 720. home-redesign checks both boxes rather than only the outer grid. Empty charts retain their owner-approved axis-free state.

## Owner round 7 contracts

The expanded sidebar keeps its connected-app count after the label, vertically centred with the same label inset as other rows, including at 720px; only the icon rail overlays the icon. Home uses pretty line wrapping and two hero columns when no fixing action exists, giving the report all remaining width beside the emblem. A fixing action retains its own third column. home/home-empty/home-many assert the report right edge; home/team/automations-calendar/dictation-overview/chat cover the shared count in expanded and icon-only navigation.
