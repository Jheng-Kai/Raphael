# Calendar and automations

## Sub-features

The app's own calendar, modelled on Google Calendar in the app's own look: week (default),
day and month; one-time events the owner and every member make and change; routine
occurrences and Google events read here. Once/daily/weekdays/weekly/every schedules,
destination/end conditions, edit/delete and calendar drop prefill keep their routine editor.

## How to get to it (user POV)

From Home click the calendar block, a date or an event. Home remains highlighted in the rail; there is no separate Automations entry.

- **Top bar:** 今天, the arrows, the title, and on the right the view dropdown (日 週 月) in the shared menu.
- **Left rail:** 建立, the month with its own arrows and today marked, then what the calendar shows with a check for each: 行程, each member's routines, Google when connected. A check hides that source and is remembered. A member's row still drags onto a slot to start a routine. Keep awake stands at its foot, and the line about Google above it.
- **Week and day:** weekday over a big date with today filled, an all-day row, an hour gutter, thin lines, a red line and dot at the time now. It opens scrolled near now. Date numbers open that day.
- **Chips:** time and title, sized by duration, side by side when overlapping (R-UI-65). An own event is ink, a routine its member's slime colour with the member's 20px face, a Google event an outline with Google's mark. Side by side a chip gives up its face to its words. A routine's occurrence has no length and is drawn an hour long.
- **Make:** click a slot for the small form beside it, drag over a range to set the time, or 建立 for the same form. It holds the title, start, end, all-day and notes, and 改成例行任務 for what repeats. Enter or 儲存 saves and draws it. A press outside closes a form with nothing typed; one that holds words stays until 取消 or Escape.
- **Read and change:** click an event for its time, notes and who added it, the pencil and the ⋯ that holds delete, which asks once more. Right click reaches the same menu. Drag moves an own event, its bottom edge resizes it; an all-day bar moves by days and its right edge stretches it; in a month a chip moves to another day. Routine and Google entries are read and say where they come from; a routine opens its existing editor.
- **Month:** six weeks of chips, 還有 N 個 for what does not fit, which opens that day. A click on an empty part of a day makes an all-day event there.
- **Narrow windows:** at 760px of content width and below, a calendar icon in the toolbar opens the rail as a drawer from the left, + makes an event, and a week shows three days from the day in view. With the rail visible, it shows three days below 1100px content width, five below 1500px and seven above, so overlapping chips keep readable times. Picking a date or starting a member drag closes the drawer.

Mini month weekdays use narrow names (one Chinese character each); event titles truncate with full tooltips and times remain complete. Advanced routine fields are under More. Member details also exposes routines; aggregate usage and CSV are in Settings > Models > Usage.

The rail and Home say what Google is, in one quiet line with the place to go (R-UI-66): not connected is offered until its × closes it for good, after which the rail keeps the bare words and Home nothing; could not be read names 設定 › 連接 until it reads again; connected through Composio says members can read it and it is not drawn here. An empty period stays calm with one line and 建立.

## Driving it with look

```powershell
npm run look -- automations-calendar automations-day automations-month automations-view-menu automations-empty automations-day-empty automations-month-empty automations-busy automations-busy-day automations-month-busy --theme both --width 1120,720,1920x1080
npm run look -- automations-create-slot automations-create-drag automations-create-button automations-create-time-menu automations-create-all-day automations-create-saved automations-detail-own automations-detail-member automations-detail-routine automations-detail-google automations-edit-own automations-delete-own automations-right-click automations-move automations-resize --theme both --width 1120,720,1920x1080
npm run look -- automations-google-off automations-google-off-closed automations-google-failed automations-google-members-only automations-hover --theme both --width 1120,720,1920x1080
npm run look -- automations-tools automations-tools-month automations-tools-date automations-tools-awake --theme both --width 1120,720,1920x1080
npm run look -- automation-once automation-daily automation-weekdays automation-weekly automation-every automation-hours-menu --theme both --width 1120,720,1920x1080
npm run look -- automation-destination automation-end-menu automation-max-runs automation-until automation-edit automation-delete automation-drag-prefill automation-more-bottom --theme both --width 1120,720,1920x1080
```

Keep dialog/calendar/menu PNGs; inspect bottom fields at 720, menu placement, labels
and vertical calendar scroll. `calendar-shell` asserts no horizontal grid overflow, no visible scrollbar, the rail on the left and that every day fits. `calendar-overlaps`, `calendar-month`, `calendar-editor`, `calendar-detail-*`, `calendar-saved`, `calendar-moved`, `calendar-resized`, `calendar-now`, `calendar-empty` and `calendar-google-*` assert their states. Tools scenes cover month navigation, date selection, keep-awake and the responsive drawer. The drag-prefill scene starts the drag from the visible side panel or drawer. Current routine mutation scenes capture states, not completed saves.

`calendar-empty` also keeps the empty-month hint clear of every date; `calendar-resized`
keeps a long event's time beside its start. The save scene waits for the editor to close
and the new title to appear before checking the persisted fixture event, so an existing chip cannot satisfy its wait.

`npm run native -- calendar` drives the real core and SQLite: the owner makes, moves and resizes an event, a member told 加到今天的行程 adds one through the real tool on a scripted provider choice, Home draws them, and the ⋯ deletes one.
For scheduling work extend scenes through save/reopen and assert fixture records.
In an authorized isolated native run, schedule a harmless task, observe its actual
due-time execution and persisted accounting, disable/delete it and verify it does not run again.

## Gotchas

Time is fixed to 2026-10-24, Asia/Taipei. Synthetic drop proves the handler's result,
not physical pointer dragging. Mock routines never execute jobs or OS wake behavior.
A calendar PNG cannot prove scheduler reliability. The old separate run-log UI is
gone; Usage retains aggregate summaries and CSV only.

## UI audit regression coverage

The rendered audit rejects mismatched controls in one schedule column and selected
mini-calendar dates with insufficient contrast, including while hovered.

## Shared content measures (2026-10-28)

Follow the [content-width contract](README.md#content-width), including its token derivation, per-scene browser check and representative main-page matrix. Short items retain their cap when the page has spare width; reading columns and spatial workspaces use their documented measures.

## Leaving a deleted routine (owner round 3)

R-UI-47: confirming deletion in an open routine editor closes it, refreshes the
calendar/list and shows the existing localized named success toast. The journey
continues through confirmation to the returned page, instead of ending at the
confirmation dialog. Saved routines removed in member details also refresh the
list and show the shared success notice.

The shared toast stays at the bottom-right on the calendar. The existing
`.page-agent` presentation raises that same notice above the composer, so the
conversation/member/room and calendar comparisons intentionally differ in vertical
offset, while retaining the same text pattern, surface, type and spacing.

```powershell
npm run look -- automation-delete --theme both --width 1120,720,1920x1080
```

## Owner round 6 contracts

Owner round 6: automations-calendar/automations-day/automations-tools/automations-tools-awake retain the month/member rail at a 1120px window by narrowing the week grid. The calendar-container breakpoint is 760px; smaller content areas use the drawer and fewer days. calendar-shell asserts both modes.

## Owner round 7 contracts

A routine's chip keeps a fixed visible 20px avatar at the top right, except side by side. Titles use up to two lines across the full event width below the time/avatar row, with the complete title in the existing accessible name and tooltip. Owner round 9 replaces the old 62px event/64px hour with viewport-derived compact hours and corresponding time/title spacing; narrow-day horizontal padding lets the time and avatar fit at their existing sizes. calendar-chips still asserts the two-line clamp, title bounds, complete time, fixed face and non-overlap. Cover week/day/tools/hover/primary-calendar-members at 1120,720,1920x1080,1280x800.

## Owner round 9 regression coverage

Day and week share a viewport-derived hour height (28-54px), fitting eleven working
hours below the sticky date/all-day header at 1280x800. Initial position shows the time
now, two and a half hours down, or the first event of a period that does not hold today.
Navigation resets the position; refresh and resize retain the viewed hour. All-day
events stay above timed events. The cached Home event window paints first, and when
Google is connected one live read of the month in view follows.
calendar-shell enforces hour density, working-day fit and the pinned all-day row;
calendar-all-day checks its visible event. Cover empty/sparse/full day and week.

```powershell
npm run look -- automations-day-empty automations-sparse automations-day-sparse automations-all-day --theme both --width 1120,720,1920x1080,1280x800
```
