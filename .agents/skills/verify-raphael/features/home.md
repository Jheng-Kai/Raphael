# Home

## Sub-features

### Product contract (owner, 2026-11-12, R-UI-114)

Home answers one question every time it opens: what do I do now, and what must not be missed
today. The owner said the page of figures, an hours band, a 25-row schedule table and a two-week
chart read like a ledger and did not help his day (「近兩週完成的基本上沒有顯示任何東西，我覺得它沒有什麼用。
再來是今天的行程越來越長…感覺像流水帳一樣，沒辦法吸引到我的注意力」). The words of Raphael's line already
answer it; the page under it answers it in a glance and lets him act. Every element is judged by whether it changes
what he does today.

- **Hero** (unchanged apart from the date's icon). One row read from the left: 拉斐爾大師's emblem on
  a canvas (the desktop's own `Emblem`, surface `transparent`; 96px, 72px when the main area is
  760px or narrower; the canvas is 1.3 times that so the rays have room, held in the emblem's own
  size by negative margins). Shown, he plays the appear animation and, 0.9 s later, speaks his
  line for 2.8 s; then the canvas keeps its last frame, leaves the shared animation loop and
  turns by a CSS transform on the compositor (`.ho-orb.is-turning`, 60 s a turn), so an open Home
  draws no more frames on the main thread (R-PERF-01, the busy-team motion budget). Hidden, it is
  disposed and stops turning. With reduced motion he appears still and nothing turns. The canvas
  stays the same node through refreshes (only the hero's words and the board are patched). Then
  the date with the calendar's icon beside it (`.ho-date [data-home-go="calendar"]`, the way to
  the whole Calendar, which has no sidebar entry; it resumes the Calendar's date and view,
  R-CAL-04), a greeting by the time of day (早安／午安／晚上好，主人) at --fs-h1 and his line:
  `today_plan.narrative` when it is ready, else how many timed events and questions today holds
  in one sentence (今天有 N 個行程，M 件事在等你回答。 and its three other forms; a task of the
  board is all-day and is not counted as an event). A report that needs fixing adds its own line
  and one fix icon; the 《告。…》 wrapper never shows (R-UI-42); no ask-Raphael icon (R-UI-43).
- **The parts** (`app/src/main/home-day.ts` sorts, `pages/home.ts` draws). Each is a section with
  a one- or two-word heading over a hairline and rows of one shared height (`--sp-6`, 32px); a
  part with nothing to say is not drawn, so it leaves no heading, no empty box and no gap. One
  column in this order; two lanes where the page is 1100px wide or more (container query on
  `home`): 接下來, 等你決定 and 今天要做的 at the left, 逾期 and 例行工作 at the right. Every row
  has a rail at the left (a time, a project tag, or a face) at one width, so the words of every
  part line up.
  - **接下來**: the timed things only (an own or connected event that is not all-day; a routine
    run is its member's and goes to the routines line). The one on now first, marked 進行中 with a
    dot, then the next two, each with its time and how long until it (「35 分鐘後」, hours from an
    hour and a half). One that is over is gone. An overdue task that has a time appears here once,
    while it is on or to come; once it is over it is overdue and goes to 逾期.
  - **等你決定**: the questions waiting (`kind: question`), newest first, with the asking member's
    face and name; five rows, then one 「還有 N 件」 row that opens the first of the rest; each row
    opens its conversation at its turn; their number beside the heading.
  - **今天要做的**: the all-day items that are not overdue. The task board's 「今天：」 is stripped
    and its [project] tag is the rail's quiet label; plain all-day items (a trip, a deadline, the
    Notion summary) lead, then the board's tasks, oldest in the store first. Five rows, the rest one
    「還有 N 件」 row that opens today on the Calendar; the number beside the heading.
  - **逾期**: one block of one size whether there are 3 or 40: the count in the warning colour, the
    projects they fall on on the heading's line (the three biggest and the rest and the untagged
    as 其他, always one line), the three oldest as rows with 「逾期：」 stripped, and 「看全部」,
    which opens today on the Calendar.
  - **例行工作**: one line without a heading: the face of the member whose routine failed (else
    the next one), done of due today (the core's `activity.today`), a routine that failed named in
    the error colour (「…」沒完成, or N 次沒完成 for several) and the next one's time and name; 都完成了
    when all ran. Nothing when the day has none. A row opens the failed run's event, else the next
    run's, else the Calendar.
  - With nothing in any part: 今天沒有行程 and 建立 for today, alone. The Google line (R-UI-66)
    stands under the parts when it has something to say.
- **The task board's words.** The owner's task board reaches Raphael as all-day own events whose
  titles carry the board's own words: 「逾期：」 (past its date), 「今天：」 (due today) and a
  [Project] tag. The event has no due date or priority field, so these words are the only
  record: they are read in one function (`readTaskTitle`) and nowhere else. "Most overdue" is the
  oldest in the store (the lowest own event id, a connected event after them); the board writes
  no urgent mark, so none is read. If the core ever sends a real due date, only `readTaskTitle`
  and the ordering change.
- **What is not on the page and why.** The four figures (行程 count, 例行工作 done/due, 等你回答,
  本週完成) are gone: the count of events is the hero's line, routines are one line, questions
  are their own part, and the week's total changes nothing he does today. The two-week chart is
  gone (it was empty and chose no action). The hours band is gone: how long until the next thing
  says more than a picture of 24 hours. No number of tasks done today is shown: nothing in the
  data says which board tasks were done (a done task leaves the calendar).
- **Layout.** No boxes around sections, hairlines only; the page may scroll on a small window,
  nothing inside scrolls, nothing runs out sideways. His real day (25 items: 12 overdue, 8 due
  today, the Notion summary, 4 timed, 12 routine runs, nothing waiting) fits 1120 x 900 without
  scrolling (home-fit); at 720 the page scrolls. The page starts at the top (it is not centred), so
  the hero stays put as parts come and go.

## How to get to it (user POV)

The square Home button at the sidebar's foot (the rail's foot at narrow widths).

## Driving it with look

```powershell
npm run look -- home home-day-real home-day-quiet home-day-heavy home-startup-order home-empty home-many home-problem home-calendar-rhythm home-own-events home-calendar home-more home-event-chip home-create home-google-off home-google-closed home-google-failed home-row-hover home-motion busy-team-home daily-press-surfaces --theme both --width 1120,720,1920x1080
```

The scene fixtures are three days and an empty one: `homeDay: "real"` is his real day (25 items from
his task board: 12 overdue, 8 due today, the Notion summary, 4 timed, 12 routine runs, nothing waiting),
`"quiet"` two timed things and nothing else, `"heavy"` 40 overdue, 15 due today, 6 timed, 3 waiting and 12
routine runs, and `homeEmpty` an empty day. home-hero measures the emblem's canvas at the left with the date,
greeting and his line beside it; home-overview requires the parts in order and only when they have
something to say, headings of one or two words, unboxed sections, no figures, chart, band, table or tooltip,
faces only in a row's rail, one space between parts, one width of rail and of words in a lane, every row a
real button with a target at the shared height, no row's words cut without an ellipsis, no inner scroll
or sideways overflow; home-day reads each part against the fixture (the counts, the five and three row
limits, the way to the rest, the stripped prefixes, the overdue block's height as a heading and four
rows whether there are 12 or 40, an item once) and home-fit that his real day fits one screen at a
desk-sized window; home-empty-day the quiet state; home-questions the five rows and the rest; home-calendar-rhythm
the routines line; busy-team-home measures the motion budget with the emblem settled. Inspect every sheet
and the full-size images in both themes.

Native readable-layout inspects Home at 720, 1920x1080 and 1280x800 and opens Calendar from
the date's icon; the calendar journey opens a member's event from Home;
home-timing proves Home paints before the core's live allowance read finishes.

## Gotchas

### Data and refresh boundaries

home.overview carries the schedule (`today`: every item of today, questions included, each with
`kind`, `all_day`, `at_ms`, `end_ms`, `event_id` for an own event, `run_status` for a routine run) and, since
2026-11-08, `activity`: `days[]` (the last 14 local days: not drawn since 2026-11-12) and
`today` (`routines_due`, `routines_done`, `routines_failed`, `events`, `questions`, which the routines line
reads), see core `home_digest.activity`. The core still sends `yesterday`, `health` and `members[]` for other
callers; Home draws none of them, nor usage, allowances, dictation or the days of `activity`. `today_plan` is written in
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
Follow the shared [content-width contract](README.md#content-width). The parts are rows in lanes: they
follow the lane's width, not the reading measure; his line keeps the reading measure.

## First start-up (owner, 2026-11-11)

Owner: 「第一次開 app 的速度還是非常慢，就只有第一次而已」. The first view (Home, the roster, the rooms) is asked
for first; the model, app and Settings read-ahead (`models.catalog`, `brains.cli`, Connect apps, Settings) wait until
the first view is answered and then run one at a time (`app/src/main/startup-reads.ts`, R-START-02). Scene:
`home-startup-order` (a scene stays on Home only when its name starts with `home`) gives the mock core a 60 ms answer time and fails if `models.catalog` or `brains.cli` began while
`home.overview`, `members.list` or `rooms.list` was still waiting for its answer, if those two overlapped, or if a
first-view read was never asked for. The roster carries no pictures (`members.picture`, R-START-06): the look mock
still inlines `avatar_url`, so the picture path is covered by vitest, not by look.
