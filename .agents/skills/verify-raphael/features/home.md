# Home

## Sub-features

### Product contract (owner, 2026-11-07 and that night, R-UI-114)

Home is Raphael as a secretary. The owner asked for today's plans and the team's state,
not quotas, tokens or dictation counts; no boxes; and, that night, everything needed at a
glance: every item of today, what each member does and will do next, a summary of yesterday,
a short word on today and what the health check actually looked at. No slime and no fly-in.

- **Hero.** One row read from the left: 拉斐爾大師's emblem standing still (96px, 72px when the
  main area is 760px or narrower; `avatarHTML` with no picture, never a slime or the owner's
  picture of him, never turning), then the date, a greeting by the time of day
  (早安／午安／晚上好，主人) at --fs-h1 and his line: `today_plan.narrative` when it is ready,
  else the team's health in one sentence (all members are well, or who waits for the owner).
  A report that needs fixing (no key, OpenRouter offline, budget used up) adds its own line and
  one fix icon; a well budget says nothing. The main window never shows the 《告。…》 caption
  wrapper (R-UI-42), so the report's words are unwrapped with `plainReplies`. No ask-Raphael
  icon (R-UI-43). The emblem stays the same DOM node through refreshes.
- **Five sections** without boxes, in a grid: wide (main area over 900px) 今天的行程, 還沒解決的事
  and 成員 in one row (the team narrower), then 昨天 (two columns wide) beside 健康檢查; medium
  (641–900px) two columns with 昨天 across the bottom; narrow (640px or less) one column. Each is
  a heading over a hairline and at most eight rows, the rest counted below them. Rows are plain
  buttons that light their own background under the pointer. The page itself may scroll on a
  small window; nothing inside it scrolls and nothing runs out sideways.
- **Today's schedule** is the core's every item of today (`today` minus questions: calendar,
  own events, routine runs), all-day first, then by time, in 40px rows: the time, the
  calendar's colour as a short tick (own events ink, routines the member's slime colour, Google
  outline grey), the title, a failed or waiting run's mark and the face or Google's mark. A
  routine due more than twice today is one rhythm row (repeat mark, face, title, `N 次`, never a
  time, R-CAL-03); its failed or waiting runs stay rows of their own. What is over is dimmed,
  never a run that failed. The heading's calendar icon resumes Calendar (R-CAL-04); a row opens
  its event; the count opens today. Empty, it says 今天沒有行程 and offers 建立. The Google line
  (not connected, once and closable; could not be read, until it reads) sits under the rows
  (R-UI-66). An older core without `yesterday` falls back to the month projection and its
  daily count.
- **What is still open** lists questions, work that stopped short (a failed, interrupted or
  limited task or owner turn from `today_plan.items`, worded 沒有完成／中途停下／用完額度停下)
  and reports, never routines; a row opens the conversation (at its turn when known).
- **成員** lists every member the owner sees except Raphael, the ones who wait for the owner
  first (in the warning colour), then the ones at work (the core's activity words), unread,
  and standing by. Free, a member says what it did last (`上次：…`, `current_or_last`), else its
  role. Its next enabled routine stands at the row's end (repeat icon and time, the weekday
  when not today; the routine's name in its aria-label). A row opens that member's
  conversation. A `MemberActivity` event redraws the row and the line without a read.
- **昨天** is three numbers (工作, 例行, 訊息) and the faces of who did the work as small framed
  pills with their count (the busiest first; a press opens that member), then Raphael's one
  paragraph. While it is written it says 正在整理昨天的紀錄…; with no model he can use it says so
  with one 選模型 button (Settings › Models); a failed attempt says the numbers stand alone.
  Nothing is retried or worded by another model (the core's rule).
- **健康檢查** shows each check that is not well as a row (a dot in the warning or error colour,
  its name and the core's one-line detail) that opens where it is fixed (connections, or
  models), then one line `N 項正常` naming every check that is fine. With no results it says
  so.

## How to get to it (user POV)

The square Home button at the sidebar's foot. At narrow widths, open the sidebar drawer
first.

## Driving it with look

```powershell
npm run look -- home home-empty home-team home-many home-problem home-calendar-rhythm home-own-events home-report home-member home-calendar home-more home-event-chip home-create home-google-off home-google-closed home-google-failed home-row-hover home-arrival home-motion --theme both --width 1120,720,1920x1080
```

home-hero measures the emblem at the left with the date, greeting and his line beside it;
home-overview requires the five unboxed sections in their grid at each width, at most eight
plain rows each, no money or percentages, no inner scroll or sideways overflow, and the emblem
(never a slime). home-digest checks yesterday's numbers, faces and paragraph, the health line
naming every check and his word on today; home-empty-digest the no-model state and its
button. home-team checks the order, the warning colour, the role fallback and the next routine.
home-arrival (the `home-show-again` action forgets the day and returns to Home) and home-motion
prove that with motion allowed nothing flies, rings, rises or turns. The calendar scenes prove
each way into Calendar; home-more uses a day of more than eight items. Inspect every sheet and
the full-size images in both themes.

Native readable-layout inspects Home at 720, 1920x1080 and 1280x800 and opens Calendar from
the schedule's icon; the calendar journey opens a member's event from today's schedule;
home-timing proves Home paints before the core's live allowance read finishes.

## Gotchas

### Data and refresh boundaries

home.overview carries the schedule, what is open, and since brief 9 `yesterday`, `today_plan`,
`health` and `members[]` (see core `home.py`, `home_digest.py`); `members.list` still gives the
live team, read through the same coalesced event read as the sidebar, and Home joins the two by
id. The two narratives are written in the background once a day by Raphael's own model and
cached; the overview never waits for them, and `home.changed` (forwarded as `HomeChanged`)
reads Home again when one is ready. home.overview also carries usage, allowances and dictation
for other callers; Home draws none of them.
refresh=false reads local records and cached events/allowances without a CLI or provider
request. Home paints it before the coalesced refresh=true read (at most one per five
minutes). Member, question, conversation, routine, calendar, settings, connection and Home
changes refresh Home. Locale changes redraw cached Home even behind Settings without an RPC or
replacing the emblem.

The health list reflects only the offline self-check; until brief 11 lands it can list a CLI
that is not installed or a key nothing uses, and names fall back to the id after its kind.

Google Calendar uses connectors.status(refresh=false) and the existing private
calendar_list_events tool only when ACTIVE/enabled; the `composio:googlecalendar` toolkit
also supplies it through the fixed core read path, and the direct Google sign-in wins when
readable. Unavailable, disabled or expired connections yield no connected events, and
`calendar_google` says which it was; own events and local routines remain available.

Offline pytest covers the projection and HTTP doubles. Browser fixtures prove the UI;
isolated fake-brain native journeys prove the desktop path. Neither proves live
calendar/OAuth/provider scheduling or a real narrative.
Follow the shared [content-width contract](README.md#content-width).
