# Automations

## Sub-features

Home-owned week/day/empty calendar, once/daily/weekdays/weekly/every schedules,
destination/end conditions, edit/delete and calendar drop prefill.

## How to get to it (user POV)

From Home click the mini week or its detail icon. Home remains highlighted in the rail; there is no separate Automations entry. Switch Day/Week in the toolbar. Use Add, an event, or a member drop onto a calendar slot. All seven days fit the content width without horizontal scrolling. Above 760px of content width, including a 1120px window, the month, draggable members and Keep awake sit on the right. At smaller widths a calendar icon in the toolbar opens the same controls in a dismissible popover. Picking a date or starting a member drag dismisses it. Mini month weekdays use narrow names (one Chinese character each); event titles truncate with full tooltips and times remain complete. Visible event faces remain 20px squares. Advanced
fields are under More. Member details also exposes routines; aggregate usage and CSV are in
Settings > Models > Usage.

## Driving it with look

```powershell
npm run look -- automations-hover automations-empty automations-calendar automations-day --theme both --width 1120,720,1920x1080
npm run look -- automations-tools automations-tools-month automations-tools-date automations-tools-awake --theme both --width 1120,720,1920x1080
npm run look -- automation-once automation-daily automation-weekdays automation-weekly automation-every automation-hours-menu --theme both --width 1120,720,1920x1080
npm run look -- automation-destination automation-end-menu automation-max-runs automation-until automation-edit automation-delete automation-drag-prefill automation-more-bottom --theme both --width 1120,720,1920x1080
```

Keep dialog/calendar/menu PNGs; inspect bottom fields at 720, menu placement, labels
and vertical calendar scroll. `calendar-shell` asserts no horizontal grid overflow and that every day fits. Tools scenes cover month navigation, date selection, keep-awake and the responsive panel. The drag-prefill scene starts the drag from the visible side panel or popover. Current routine mutation scenes capture states, not completed saves.
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

Owner round 6: automations-calendar/automations-day/automations-tools/automations-tools-awake retain the month/member side panel at a 1120px window by narrowing the week grid. The calendar-container breakpoint is 760px; smaller content areas use the existing compact view. calendar-shell asserts both modes.

## Owner round 7 contracts

Every event keeps a fixed visible 20px avatar at the top right. Titles use up to two lines across the full event width below the time/avatar row, with the complete title in the existing accessible name and tooltip. Owner round 9 replaces the old 62px event/64px hour with viewport-derived compact hours and corresponding time/title spacing; narrow-day horizontal padding lets the time and avatar fit at their existing sizes. calendar-chips still asserts the two-line clamp, title bounds, complete time, fixed face and non-overlap. Cover week/day/tools/hover/primary-calendar-members at 1120,720,1920x1080,1280x800.

## Owner round 9 regression coverage

Day and week share a viewport-derived hour height (28-54px), fitting eleven working
hours below the sticky date/all-day header at 1280x800. Initial position shows 08:00
through the working day, or focuses the current/first event hour for off-hours.
Navigation resets the position; refresh and resize retain the viewed hour. All-day
connected events stay above timed events. The existing cached Home event window is
reused; this change does not add another provider query or calendar persistence store.
calendar-shell enforces hour density, working-day fit and the pinned all-day row;
calendar-all-day checks its visible event. Cover empty/sparse/full day and week.

```powershell
npm run look -- automations-day-empty automations-sparse automations-day-sparse automations-all-day --theme both --width 1120,720,1920x1080,1280x800
```
