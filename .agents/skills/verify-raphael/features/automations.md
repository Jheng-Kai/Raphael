# Calendar and automations

## Routine guard reasons (2026-11-05)

R-ROUTINE-01/02 share admission across schedule, event and webhook execution.
The existing member details row shows the localized rate/absence reason for
scheduled routines too. A 30-day absence pauses work until explicit re-enable.
See [Daily work](daily-work.md) for limits, receipts and offline/native boundaries.
Follow-up 1 authorizes this representative row/editor rendering:

```powershell
npm run look -- routine-guard-reason automation-edit --theme both --width 1120,720,1920x1080
```

Inspect the full-size paused reason in both themes/all sizes, comparing its
existing row, icon and typography with ordinary routines and event error rows.

## Calendar navigation review (2026-11-01)

The general Home calendar entrance resumes its in-memory date and view. Explicit date/event links still jump. View choice persists in guarded browser storage across reload; the date starts on today in a fresh launch. Week uses all seven columns at content widths of at least 520px, otherwise a short range with an explicit date title. All-day and rhythm bars align with the hour columns. Previous/Today/next share a quiet borderless group; Today dims in its current range without moving.

Selected scenes: calendar-remember, calendar-view-reload, calendar-week-fit, calendar-today-controls. Run both themes at 1120,900,720,1920x1080,480. Check return through Home and conversation, true page reload, seven columns at 1120/720, narrow fallback dates, bar edges, hover surface and stable button geometry. At 480, month overflow counts fit their buttons and the rhythm shows only face and title.

```powershell
npm run look -- calendar-remember calendar-view-reload calendar-week-fit calendar-today-controls --theme both --width 1120,720,1920x1080
npm run look -- calendar-remember calendar-view-reload calendar-week-fit calendar-today-controls --theme both --width 900,480
```

## Calendar rhythms and Composio readings (2026-11-01)

Google through Composio is drawn after its first successful background read.
A readable connection starts connected. Pending/slow reads never hold the page up; failed reads keep old events and say
unreadable. The rail shows Google when connected. Tests cover the observed provider
envelope, every failure level and an empty catalog without changing model auto
permissions. Member calendar_list waits for its first uncovered range, up to 12 seconds; covering empty readings return at once. Cache and attempt history retain the most recent 24 ranges. The owner performs real-account acceptance separately.

An every routine may have from/to, for example every three hours from 08:00 to
23:00. The shared editor uses real time menus in a reserved row, without native
select/time input or new settings. Member rows say the interval and window.
Migration 54 merges eligible historical daily rows.

Several runs a day are one quiet all-day bar across active days, after real all-day
events, with member face/colour, title and brief timing. Month and Home show at most
one rhythm line per day with face and title only (no interval, window or clock). Day/week give the title its full available width, then show timing only when it fits whole; the popover retains full timing. Error/confirm runs retain unfaded timed chips and status icons. Pending ask_owner and background permission cards project to confirm from their real stores; waiting for children alone does not. Both question open/close notifications refresh the calendar. The existing popover shows today's times/states, next run, edit/off
and report navigation. Edit/off share one row height and text baseline at every selected width/theme. The member source checkbox hides both bar and exceptions;
both use existing overflow counts. Daily, weekly, once and every 24 hours stay timed.

```powershell
npm run look -- calendar-rhythm-week calendar-rhythm-day calendar-rhythm-month calendar-rhythm-popover calendar-rhythm-hidden home-calendar-rhythm automations-google-composio automation-window automation-window-menu automation-window-saved automations-calendar automations-all-day automation-edit details-routines home-own-events --theme both --width 1120,720,1920x1080
```

Inspect all contact sheets and full-size narrow/wide bars, month lines, exception
chips, popovers and time menus. Compare editors with automation-edit, member rows
with details-routines, and Home chips with home-own-events. Checks assert no ordinary
rhythm chip in the hours, error/confirm exceptions, daily chips, one month line,
status icons, shared controls and saved window values.

## Connected-app event routines (2026-11-01)

A routine has exactly one of schedule or when. In conversation, the existing
routine_create/update tools accept a connection id, its observed read tool and
arguments, an array/id path and a narrow exact field/value filter. A member must
ask the owner for a sender/channel when the request is too broad. The first poll
records old items without running them. Checks use the production tool gate with
no model, every three minutes, exponential failure backoff up to one hour, and at
most five new tasks per successful poll. Pending matches survive restart even if
the next tool result no longer contains them. A missing/revoked connection or read
permission stops the routine and names Settings > Connections in its conversation
and row. The shared editor offers the existing connection repair entry.

The member's existing routine list shows scheduled and event work together, with
the same switch/menu. Event rows and their shared editor show the readable filter,
last checked and last fired; editing the exact filter establishes a fresh baseline.
Event row details wrap so that the exact match and both times remain readable;
last checked and last fired each start on a separate line, including in the editor.
the additional lines justify their greater height compared with a clock row.
The event editor shows its one fixed member and uses the shared centered dialog
placement: it has no schedule chips or expandable schedule fields. The clock
editor retains its existing top placement for those expanding fields. Both use
the same dialog width, typography, fields and footer actions.
The read tool and arguments are selected by the member, never edited as raw JSON
in the window. The baseline note is essential to explain why old mail does not run.
Events do not invent future calendar times. Each matched item enters the existing
background engine, attributed to its routine in the member's thread, wrapped and
marked as untrusted external data. Polling itself cannot write or send anything.
A dedicated inbox address needs a mail service and remains out of scope (W21).

```powershell
npm run look -- routine-event-row routine-event-edit routine-event-saved routine-event-missing routine-event-reconnect routine-event-profile details-routines automation-edit --theme both --width 1120,720,1920x1080
```

Inspect all contact sheets and event full-size images, comparing row switches and
editor actions with details-routines and automation-edit at the same width/theme.
Core contracts: core/tests/members/test_events.py,
core/tests/members/test_event_harness.py (API and CLI create/list/update),
core/tests/brain/test_db.py (migration 49 schema parity). Frontend edit contract:
app/src/main/member-profile.test.ts::an event routine edits a readable filter without losing its read tool arguments.

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
- **Narrow windows:** at 760px of content width and below, a calendar icon in the toolbar opens the rail as a drawer from the left, + makes an event, and a week still shows all seven days whenever its actual calendar content is at least 520px. Below that it shows one to three days from the date in view and names those dates in the title. Tight chips retain readable times. Picking a date or starting a member drag closes the drawer.

Mini month weekdays use narrow names (one Chinese character each); event titles truncate with full tooltips and times remain complete. Advanced routine fields are under More. Member details also exposes routines; aggregate usage and CSV are in Settings > Models > Usage.

The rail and Home say what Google is, in one quiet line with the place to go (R-UI-66): not connected is offered until its × closes it for good, after which the rail keeps the bare words and Home nothing; could not be read names 設定 › 連接 until it reads again; connected through Composio is drawn from the same cached reading as direct Google sign-in. An empty period stays calm with one line and 建立.

## Driving it with look

```powershell
npm run look -- automations-calendar automations-day automations-month automations-view-menu automations-empty automations-day-empty automations-month-empty automations-busy automations-busy-day automations-month-busy --theme both --width 1120,720,1920x1080
npm run look -- automations-create-slot automations-create-drag automations-create-button automations-create-time-menu automations-create-all-day automations-create-saved automations-detail-own automations-detail-member automations-detail-routine automations-detail-google automations-edit-own automations-delete-own automations-right-click automations-move automations-resize --theme both --width 1120,720,1920x1080
npm run look -- automations-google-off automations-google-off-closed automations-google-failed automations-google-composio automations-hover --theme both --width 1120,720,1920x1080
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

Owner round 6: automations-calendar/automations-day/automations-tools/automations-tools-awake retain the month/member rail at a 1120px window by narrowing the week grid. The calendar-container breakpoint is 760px; smaller page content uses the drawer; only calendar content below 520px reduces the number of days. calendar-shell asserts both modes.

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

Title priority review: calendar-rhythm-week, calendar-rhythm-day, calendar-rhythm-month and home-calendar-rhythm use a long routine title. Check its visible width at 1120/720 and require timing to be whole or hidden, never truncated. Run the same four scenes in both themes at 1120,720,1920x1080.

## Moving routine triggers (2026-11-01)

Rules R-RT-01 through R-RT-05 extend the existing editor, with no new page. Monthly saves a date 1-31 and clamps per month. The ordinary interval menu includes 5/10/15/30 minutes with the same window; minute rhythms stay in the all-day row. A scheduled slot is consumed while that same routine's preceding task is queued/running/waiting. Migration 55 leaves saved routines intact and snapshots each new run's trigger for its transcript button.

Webhook details show a loopback address, a masked vault secret and explicit show/copy controls. The address is local to this PC; outside services need an owner-managed tunnel. SettingsStore remembers the loopback port. A free saved port is reused after restart; only address-in-use selects a new port and shows an update notice in details. Send the exact body's HMAC-SHA256 in X-Raphael-Signature: sha256=<hex>. The body is capped at 256 KB, rate limited to one admission per 10 seconds per routine, wrapped as untrusted data, and skipped while that same routine has live work. No provider, real vault, public socket or native acceptance is exercised by fake-stream tests.

The catalogue offers only ACTIVE connected toolkits from the supplied slug inventory, never preconfigured result paths. One ordinary gated read at pick time detects the first object list with a common identity breadth first, continuing past unidentified arrays such as Calendar defaultReminders before items. Each entry carries verified small arguments. Owner and member share routine_list detection and create the identical ordinary when; first poll remains baseline-only. Empty/wholly unidentified/failing reads retain the selected event with a visible localized retry. GitHub repository and Slack channel are plain inputs, validated by the read call. Calendar and Gmail observed wrappers use synthetic items; other toolkit upstream fixtures are explicitly unobserved. No provider acceptance is claimed; dictionary order is not normalized or guessed.

Selected matrix: every automation-*, routine-event-*, calendar-rhythm-*, plus routine-sentence and details-routines, both themes at 1120,720,1920x1080. New scenes: automation-monthly, automation-minutes, automation-event-pick, automation-event-none-connected, automation-webhook, automation-webhook-reveal, routine-sentence. Inspect all contact sheets and full-size monthly/minute editors, empty states, both masked/revealed hook cards and transcript. Compare editor controls with automation-edit, switches and sentences with details-routines, and secret controls with the existing masked secret card.

Existing pins updated: member-profile.test.ts recurrence count grows from five to six; test_db.py latest version/schema includes the appended trigger snapshot. Existing event, window and rhythm protections remain. Targeted core and UI tests fail before their changes.

This extension supersedes the earlier centered event-editor placement: all routine editors share a top-aligned, horizontally centered dialog. The outer scrim scrolls as one page; the form and member choices have no inner scroll panel. This prevents flex shrink or vertical recentering from moving the clicked recurrence control as its fields change.

Additional affected consumers: automation-offer shares the same sentence in a suggested routine; automation-monthly-calendar proves November 31 clamps to November 30; automation-minutes-calendar proves the five-minute minimum stays one rhythm bar. routine-sentence-event retains the existing waiting owner-question card and routine-sentence-webhook retains a failed run. Each transcript scene opens and closes its exact routine before capturing the transcript. Compare automation-webhook with mcp-proposal-secret at matching theme/width: both use the existing field/sc-field, lock icon, masked input and shared small buttons. The generated secret is read-only and has Show/Hide/Copy instead of the provider card's owner-entered key and Save. Copying an unchanged value preserves the existing form DOM. The rhythm popover renders the shared trigger once, without repeating a plain timing line; compact rhythm bars keep the existing title-priority timing text.

The automation-offer scene uses the existing Ctrl+N new-member shortcut. The offer matrix does not prove the narrow sidebar plus route. The shared key driver releases Control even if dispatch fails (driver.test.mjs).

```powershell
npm run look -- automation-monthly automation-minutes automation-event-pick automation-event-none-connected automation-webhook automation-webhook-reveal routine-sentence routine-sentence-event routine-sentence-webhook automation-monthly-calendar automation-minutes-calendar automation-offer --theme both --width 1120,720,1920x1080
```


## Review fixes (2026-11-02)

The event-pick scene now selects, reads, creates once, and reopens the saved condition; it no longer pins an empty catalogue. event-undetectable retries without saving. Repository/channel scenes exercise the shared plain-input row. webhook-address-changed explains the working replacement port. The existing no-connected, manual filter, masked/revealed secret and transcript scenes remain representative consumers.

```powershell
npm run look -- automation-event-pick automation-event-undetectable automation-event-none-connected automation-event-repository automation-event-channel automation-webhook automation-webhook-address-changed automation-webhook-reveal routine-event-edit routine-event-saved routine-sentence-event --theme both --width 1120,720,1920x1080
```

## Real-account review fixes (2026-11-02)

R-RT-04/05: Gmail requests twenty items with payload and verbose output off. Calendar discovery samples ten existing items without updatedMin; its saved event carries optional since={arg:updatedMin,format:iso} and polls fifty items from the previous check minus five minutes in UTC. Empty windows succeed quietly. Other catalogue entries use the supplied small arguments and newest-first options where available. Core tests cover fixture sizes against the 50,000-character result limit, real Calendar field order, text/structured numeric envelope paths, first-poll baseline, new-id-only dispatch, unchanged legacy arguments and truncation refusal. These are synthetic fixtures, not real-account acceptance.

The new automation-event-calendar scene uses the same event form as Gmail: pick, create once, then reopen. Its check preserves the ordinary detected path, small arguments and moving window without exposing them in the UI. Selected scope is all six automation-event-* scenes; the UI appearance is unchanged.

```powershell
npm run look -- automation-event-pick automation-event-calendar automation-event-undetectable automation-event-none-connected automation-event-repository automation-event-channel --theme both --width 1120,720,1920x1080
```

## Cold Calendar catalogue review (2026-11-02)

R-RT-06: event discovery and polling ensure the connected Composio toolkit's cached catalogue before classifying its read. The fake HTTP integration uses GOOGLECALENDAR_EVENTS_LIST with readOnlyHint from a cold cache and after clearing process caches to model restart. Startup catalogue failures back off without disabling or adding error turns, then recover. Loaded createHint and missing tools still stop with the existing localized message. A shared deadline includes catalogue loading and reading; other connection kinds never fetch a toolkit catalogue. The separate fixed Calendar reader's exception remains limited to its own slug and async context.

Rerun the six automation-event-* scenes in the Real-account review fixes matrix above. These UI fixtures prove the shared pick/create/reopen and retry presentation; only the production-gate core tests prove cold-catalogue ordering.
