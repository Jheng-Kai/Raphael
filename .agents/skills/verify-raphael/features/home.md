# Home

## Sub-features

### Product contract (owner, 2026-11-08, R-UI-114)

Home is the day in numbers and pictures. The owner asked for charts, tables, numbers and a
little text instead of lists (「我比較想要看到一些數據圖…表格啊、數據啊、文字啊」), took out the
member rows, the open-item list, yesterday and the health check (「健康檢查的部分我晚一點會弄」),
asked for no slime, and for Raphael to be alive with effects (「它不是一張圖片」).

- **Hero.** One row read from the left: 拉斐爾大師's emblem on a canvas (the desktop's own
  `Emblem`, surface `transparent`; 96px, 72px when the main area is 760px or narrower; the
  canvas is 1.3 times that so the rays have room, held in the emblem's own size by negative
  margins). Shown, he plays the appear animation and, 0.9 s later, speaks his line for 2.8 s;
  then the canvas keeps its last frame, leaves the shared animation loop and turns by a CSS
  transform on the compositor (`.ho-orb.is-turning`, 60 s a turn), so an open Home draws no more
  frames on the main thread (R-PERF-01, the busy-team motion budget). Hidden, it is disposed and
  stops turning. With reduced motion he appears still and nothing turns. The canvas stays the
  same node through refreshes (only the hero's words and the board are patched). Then the date,
  a greeting by the time of day (早安／午安／晚上好，主人) at --fs-h1 and his line:
  `today_plan.narrative` when it is ready, else today's schedule and what waits for the owner
  in one sentence (今天有 N 個行程，M 件事在等你回答。 and its three other forms). A report that
  needs fixing adds its own line and one fix icon; the 《告。…》 wrapper never shows (R-UI-42);
  no ask-Raphael icon (R-UI-43).
- **Four figures** in a row between hairline dividers (two by two at 760px or narrower), each a
  name, a large number and a few words: 行程 (today's rows; the next timed one, else that the
  day is over; a button to Calendar), 例行工作 (done/due today; what did not finish in the error
  colour, else how many are left), 等你回答 (questions waiting, the newest named; a button that
  opens its conversation at its turn, plain when there are none) and 本週完成 (the last seven
  days against the seven before, ▲ in the good colour). Without the core's `activity` the
  routine and week figures are left out.
- **Today's schedule** (left panel): a band of the day's hours (00–24, a hairline every six
  hours, a calendar event as a bar as long as it lasts, an own event in the calendar's ink, a
  routine run as a tick in the routines' chart colour, a failed run in red, the red line of
  now; a tooltip on each mark) over a table 時間 | 事項 | 類型 in 40px rows: the core's every item
  of today (`today` minus questions), all-day first, then by time. 類型 says 行事曆, 自己的 or
  例行・<member> beside a dot in the band's colour; no faces. A routine due more than twice is one
  rhythm row (repeat mark, title, `N 次`, never a time, R-CAL-03); its failed or waiting runs stay
  rows with their mark. What is over is dimmed. Every row is drawn (no 「還有…」, owner
  2026-11-08); a row opens its event on Calendar; the heading's calendar icon resumes Calendar
  (R-CAL-04). Empty, it says 今天沒有行程 and offers 建立. The Google line sits under the rows
  (R-UI-66).
- **近兩週完成的事** (right panel): fourteen stacked bars (oldest first, today last), bottom
  first 工作, 訊息, 例行 in `--series-1..3` (validated with the dataviz palette script for colour
  blindness in both themes, 2026-11-08), a 2px gap between parts, round tops, a dashed scale at
  half and a round top, today's total over its bar, day labels every other day ending in 今天,
  a legend in the heading, the day under the pointer lit behind its bar with a tooltip of its
  figures (and what did not finish), and the same figures as a visually hidden table. With
  nothing finished it says 近兩週還沒有完成的事 over empty stubs.
- **Layout.** The panels stand side by side at one width when the main area is over 760px,
  else one under the other. No boxes around sections; the page may scroll on a small window,
  nothing inside scrolls, nothing runs out sideways.

## How to get to it (user POV)

The square Home button at the sidebar's foot. At narrow widths, open the sidebar drawer
first.

## Driving it with look

```powershell
npm run look -- home startup-order home-trend-tip home-empty home-many home-problem home-calendar-rhythm home-own-events home-calendar home-more home-event-chip home-create home-google-off home-google-closed home-google-failed home-row-hover home-motion busy-team-home daily-press-surfaces --theme both --width 1120,720,1920x1080
```

home-hero measures the emblem's canvas at the left with the date, greeting and his line beside
it; home-overview requires the figures then the panels, no member rows, open items, yesterday,
health check or faces, unboxed sections, table rows aligned with the heading, nothing out of
its section, no inner scroll or sideways overflow. home-figures reads each figure against the
fixture; home-band places the marks and the line of now; home-trend checks bars on the
baseline, gaps, the legend's colours, today's total, label spacing, the scale and the hidden
table; home-trend-tip the tooltip beside its bar inside the window; home-empty-day the quiet
state; home-motion that the emblem is drawn alive on its canvas; busy-team-home measures the
motion budget with the emblem settled. Inspect every sheet and the full-size images in both
themes.

Native readable-layout inspects Home at 720, 1920x1080 and 1280x800 and opens Calendar from
the schedule's icon; the calendar journey opens a member's event from today's schedule;
home-timing proves Home paints before the core's live allowance read finishes.

## Gotchas

### Data and refresh boundaries

home.overview carries the schedule and, since 2026-11-08, `activity`: `days[]` (the last 14
local days, oldest first: `work`, `routines_ok`, `routines_failed`, `messages`, `failed`, each
piece counted once on the day it ended, deduplicated across routine run, task and turn) and
`today` (`routines_due`, `routines_done`, `routines_failed`, `events`, `questions`), see core
`home_digest.activity`. The core still sends `yesterday`, `health` and `members[]` for other
callers; Home draws none of them, nor usage, allowances or dictation. `today_plan` is written in
the background once a day by Raphael's own model; `home.changed` (`HomeChanged`) reads Home
again when it is ready. Home no longer reads `members.list`.
refresh=false reads local records and cached events/allowances without a CLI or provider
request. Home paints it before the coalesced refresh=true read (at most one per five
minutes). Member, question, conversation, routine, calendar, settings, connection and Home
changes refresh Home. Locale changes redraw cached Home even behind Settings without an RPC or
replacing the canvas.

Google Calendar uses connectors.status(refresh=false) and the existing private
calendar_list_events tool only when ACTIVE/enabled; the `composio:googlecalendar` toolkit
also supplies it through the fixed core read path, and the direct Google sign-in wins when
readable. Unavailable, disabled or expired connections yield no connected events, and
`calendar_google` says which it was; own events and local routines remain available.

Offline pytest covers the projection and HTTP doubles. Browser fixtures prove the UI;
isolated fake-brain native journeys prove the desktop path. Neither proves live
calendar/OAuth/provider scheduling or a real narrative.
Follow the shared [content-width contract](README.md#content-width). The schedule is a table:
its rows follow the panel's width, not the reading measure; his line keeps the reading measure.

## First start-up (owner, 2026-11-11)

Owner: 「第一次開 app 的速度還是非常慢，就只有第一次而已」. The first view (Home, the roster, the rooms) is asked
for first; the model, app and Settings read-ahead (`models.catalog`, `brains.cli`, Connect apps, Settings) wait until
the first view is answered and then run one at a time (`app/src/main/startup-reads.ts`, R-START-02). Scene:
`startup-order` gives the mock core a 60 ms answer time and fails if `models.catalog` or `brains.cli` began while
`home.overview`, `members.list` or `rooms.list` was still waiting for its answer, if those two overlapped, or if a
first-view read was never asked for. The roster carries no pictures (`members.picture`, R-START-06): the look mock
still inlines `avatar_url`, so the picture path is covered by vitest, not by look.
