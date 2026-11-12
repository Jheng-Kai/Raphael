# Calendar and automations

## Routines are read; their members change them (owner, 2026-11-09)

Owner: 「這邊的所有設定都只能透過 Agent 完成 但是我們看的到內容」, and the calendar too. There is no routine editor:
a routine opens to read (`routine-view.ts`: its name, when it runs, who runs it, its instructions, no field and no
footer) from the member panel, a conversation's receipt, the calendar and its popover. A routine is made, changed,
tested, paused for good or deleted by asking its member in the conversation (the routine tools; the member explains
webhooks, tunnels and event filters there). The calendar's 例行任務 at a time, and a member dropped on a slot, open that
member's conversation with the owner's words for it in the composer (`auto.askRoutine`); nothing is created by the
window. The member panel has no plus; a routine row keeps its own switch, inside the row's one lit surface.

```powershell
npm run look -- automations-detail-routine details-routine-view details-routine-hover automation-drag-asks routine-sentence context-menu-routine panel-routine-row --theme both --width 1120,720,1920x1080
```

`routine-view` checks the dialog holds nothing to change; `routine-asked` that the dropped member's composer holds
the words and nothing was created; `routine-row-hover` that the switch stands inside the lit row. The sections below
that describe the editor's rows, menus, test runs, webhook and tunnel cards are history: their scenes were retired with
it, and the core contracts they cite stay.

## Routine runs that tell the truth (owner, 2026-11-11)

A run is done only when it did its work (R-ROUTINE-05): a refused step or a missing page makes it failed, with its reason on
the routine (`last_error`, `last_failed`) and in the member's conversation. The read-only routine view says so as a status with
a dot (`routine-view-failed`), and a routine that is running shows the member's working line in its conversation, with no owner
bubble for its instructions (`routine-running`, R-ROUTINE-08). Existing consumers: `routine-sentence` (a failed run's line and
the same view), `details-routine-view` (a routine that works has no status line).

```powershell
npm run look -- routine-view-failed routine-running routine-sentence details-routine-view --theme both --width 1120,720,1920x1080
```

`routine-view-failed` checks the failed state has words and a dot and the dialog still holds nothing to change;
`routine-running` that the live working line is there and no `.owner-message` is drawn for the routine's instructions.

## Calm conversations (owner, 2026-11-05)

See [Conversation](conversation.md#calm-conversations-owner-request-2026-11-05) for R-UI-101/R-CLI-07 and the selected matrix. Routine origins now name the routine inside its reply, with the existing editor target. Failures appear once; rerun shares reply/copy actions. Public work receipts collapse into reply detail; calendars and owner cards retain their behavior. This supersedes older transcript trigger-chip and between-message receipt descriptions.


## Routine guard reasons (2026-11-05)

R-ROUTINE-01/02 share admission across schedule, event and webhook execution.
The existing member details row shows the localized rate/absence reason for
scheduled routines too. A 30-day absence pauses work until explicit re-enable.
See [Daily work](daily-work.md) for limits, receipts and offline/native boundaries.
Follow-up 1 authorizes this representative row/editor rendering:

```powershell
npm run look -- routine-guard-reason --theme both --width 1120,720,1920x1080
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
npm run look -- calendar-rhythm-week calendar-rhythm-day calendar-rhythm-month calendar-rhythm-popover calendar-rhythm-hidden home-calendar-rhythm automations-google-composio automations-calendar automations-all-day details-routines home-own-events --theme both --width 1120,720,1920x1080
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
npm run look -- routine-event-row routine-event-profile details-routines --theme both --width 1120,720,1920x1080
```

Inspect all contact sheets and event full-size images, comparing row switches and
editor actions with details-routines and automation-edit at the same width/theme.
Core contracts: core/tests/members/test_events.py,
core/tests/members/test_event_harness.py (API and CLI create/list/update),
core/tests/brain/test_db.py (migration 49 schema parity). The frontend edit contract
(member-profile.test.ts) was retired with the routine editor on 2026-11-09.

## Sub-features

The app's own calendar, modelled on Google Calendar in the app's own look: week (default),
day and month; one-time events the owner and every member make and change; routine
occurrences and Google events read here. Once/daily/weekdays/weekly/every schedules,
destination/end conditions are what the member sets when the owner asks; the window only reads them (2026-11-09).

## How to get to it (user POV)

From Home click the calendar block, a date or an event. Home remains highlighted in the rail; there is no separate Automations entry.

- **Top bar:** 今天, the arrows, the title, and on the right the view dropdown (日 週 月) in the shared menu.
- **Left rail:** 建立, the month with its own arrows and today marked, then what the calendar shows with a check for each: 行程, each member's routines, Google when connected. A check hides that source and is remembered. A member's row still drags onto a slot to start a routine. Keep awake stands at its foot, and the line about Google above it.
- **Week and day:** weekday over a big date with today filled, an all-day row, an hour gutter, thin lines, a red line and dot at the time now. It opens scrolled near now. Date numbers open that day.
- **Chips:** time and title, sized by duration, side by side when overlapping (R-UI-65). An own event is ink, a routine its member's slime colour with the member's 20px face, a Google event an outline with Google's mark. Side by side a chip gives up its face to its words. A routine's occurrence has no length and is drawn an hour long. A failed or waiting run's mark stands in a corner (beside the time, or the foot corner under a face), so the title keeps its lines; titles balance their two lines. The event whose panel is open, or that Home opened, lifts with a shadow; a ring stays keyboard focus's (R-UI-31).
- **Panels:** the form or detail stands beside its slot or event, on the right, else on the left while that stays on the calendar; a slot too wide for either side (the day view) has it centred over it, never over the rail or the sidebar. The notes grow with their words up to six lines, with no drag grip.
- **Make:** click a slot for the small form beside it, drag over a range to set the time, or 建立 for the same form. It holds the title, start, end, all-day and notes, and 改成例行任務 for what repeats. Enter or 儲存 saves and draws it. A press outside closes a form with nothing typed; one that holds words stays until 取消 or Escape.
- **Read and change:** click an event for its time, notes and who added it, the pencil and the ⋯ that holds delete, which asks once more. Right click reaches the same menu. Drag moves an own event, its bottom edge resizes it; an all-day bar moves by days and its right edge stretches it; in a month a chip moves to another day. Routine and Google entries are read and say where they come from; a routine opens to read, and its member changes it in the conversation (2026-11-09).
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

(Its scenes were retired with the routine editor on 2026-11-09.)

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

## A busy day: every all-day item in reach (owner, 2026-11-12)

R-CAL-07. The all-day band of the day and week view draws three rows and one button per day that has more, 「還有 N 個」,
N being the items not drawn. Pressing it opens the band in place to every all-day item of the days in view (the hours move down by
what it grew and keep their height, the day names stay on top, the page scrolls, there is no scrollbar of the band's own); its one
button then reads 「收合」 and folds it. It is the same toggle for Tab, Enter and Space, with aria-expanded, and the choice
(`openBand` in `pages/automations.ts`: the view and first day it was made on) is folded again on any other day or week. A month's
count (a separate `.cal-more`, still `data-au="open-day"`) opens that day in the day view with the band already open. The words are
`overview.moreEvents` and `common.showLess`, both in the fifteen languages. The gutter's `+8` is the time zone (GMT+8) and is no count.
Fixture: `calendarManyAllDay: N` puts N all-day items on 2026-10-24. Checks: calendar-more-folded (the count equals the hidden items),
calendar-more-open (every item in the document, scrolled to and pressable, the hours moved by the band's growth, the first timed event and
the last hour reachable), calendar-more-closed, calendar-more-month, calendar-more-focus.

```powershell
npm run look -- automations-more-day automations-more-day-open automations-more-day-closed automations-more-week automations-more-many automations-more-sixty automations-more-month-cell automations-more-month automations-more-keyboard automations-month-busy automations-all-day automations-busy-day --theme both --width 1120,720,1920x1080
```

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
npm run look -- routine-sentence routine-sentence-event routine-sentence-webhook automation-monthly-calendar automation-minutes-calendar automation-offer --theme both --width 1120,720,1920x1080
```


## Review fixes (2026-11-02)

The event-pick scene now selects, reads, creates once, and reopens the saved condition; it no longer pins an empty catalogue. event-undetectable retries without saving. Repository/channel scenes exercise the shared plain-input row. webhook-address-changed explains the working replacement port. The existing no-connected, manual filter, masked/revealed secret and transcript scenes remain representative consumers.

```powershell
npm run look -- routine-sentence-event --theme both --width 1120,720,1920x1080
```

## Real-account review fixes (2026-11-02)

R-RT-04/05: Gmail requests twenty items with payload and verbose output off. Calendar discovery samples ten existing items without updatedMin; its saved event carries optional since={arg:updatedMin,format:iso} and polls fifty items from the previous check minus five minutes in UTC. Empty windows succeed quietly. Other catalogue entries use the supplied small arguments and newest-first options where available. Core tests cover fixture sizes against the 50,000-character result limit, real Calendar field order, text/structured numeric envelope paths, first-poll baseline, new-id-only dispatch, unchanged legacy arguments and truncation refusal. These are synthetic fixtures, not real-account acceptance.

The new automation-event-calendar scene uses the same event form as Gmail: pick, create once, then reopen. Its check preserves the ordinary detected path, small arguments and moving window without exposing them in the UI. Selected scope is all six automation-event-* scenes; the UI appearance is unchanged.

(Its scenes were retired with the routine editor on 2026-11-09.)

## Cold Calendar catalogue review (2026-11-02)

R-RT-06: event discovery and polling ensure the connected Composio toolkit's cached catalogue before classifying its read. The fake HTTP integration uses GOOGLECALENDAR_EVENTS_LIST with readOnlyHint from a cold cache and after clearing process caches to model restart. Startup catalogue failures back off without disabling or adding error turns, then recover. Loaded createHint and missing tools still stop with the existing localized message. A shared deadline includes catalogue loading and reading; other connection kinds never fetch a toolkit catalogue. The separate fixed Calendar reader's exception remains limited to its own slug and async context.

Rerun the six automation-event-* scenes in the Real-account review fixes matrix above. These UI fixtures prove the shared pick/create/reopen and retry presentation; only the production-gate core tests prove cold-catalogue ordering.


## Manual tests, saved zones and trigger recipes (2026-11-05)

The shared routine editor and both existing member row menus offer Test once.
`routines.run` sends the saved instruction through the existing worker and history
of the owning member. It shares R-ROUTINE-01 admission and normal worker spend.
An explicit test can run a paused routine without enabling it or advancing its
next scheduled occurrence. Pending state survives closing/reopening the editor;
confirmation remains running until the history row has a finished timestamp.
Readable refusal and recent running/success/failure rows stay in the editor.
The empty list asks the owner to create a routine in the conversation, retaining
its existing add button.

Schedule JSON stores an IANA `timezone`. New editor schedules use General's
preference or browser detection. Member owner-viewing reports pin legacy unzoned
schedules before following a changed PC zone. Existing saved zones survive
preference changes, edits and restart. Calendar occurrences and the scheduler
both use that saved zone. Nonexistent DST wall times are skipped; ambiguous wall
times use the earlier occurrence once. Test spring/fall, sparse weekly/monthly
DST gaps, preference changes and later owner zone reports.

Sentry and PagerDuty recipes show their respective JSON paths and URL/key setup.
The existing loopback listener also accepts Authorization: Bearer with its vault
key, retaining HMAC compatibility and existing admission/untrusted-data gates.
A user-managed HTTPS forwarder is required for external delivery. Sentry signature
verification belongs at that forwarder; no tunnel or cloud endpoint is provisioned.
Slack's existing selected-channel read optionally adds a literal text substring
(including a raw <@USER_ID> mention); it retains baseline, deduplication and gates.

Selected rendered matrix (synthetic fixtures and IPC, real app entry):

```powershell
npm run look -- routine-when-words routine-empty-words routine-zone routine-zone-search routine-zone-saved details-routines --theme both --width 1120,720,1920x1080
```

Inspect every contact sheet and relevant full-size editor, row menu, conversation,
settings/search, history and recipe image. Compare editor controls with automation-edit,
member rows with details-routines, and General's timezone control with its existing
size control at matching theme/width. Run judge on the same selected run, or record
missing external references as blocked/SKIP. The brief skips full verify/core suites;
fake acceptance does not prove native, live brain or provider delivery.

Targeted contracts: test_routine_test_run.py, test_schedule.py, test_routine_guards.py,
test_events.py, test_event_catalog.py, test_event_harness.py, test_webhooks.py,
test_settings.py; routine-run.test.ts, timezones.test.ts, automations.test.ts,
member-details.test.ts, routine-sentence.test.ts,
settings-view.test.ts, agent-members.test.ts and look audit/app tests.


## Owner-provided external webhook tunnels (2026-11-05)

R-COLLEAGUE-05: Edit a saved webhook routine > External URL. Choose Tailscale Funnel, Cloudflare Tunnel or ngrok, copy the exact command and run the already-installed tool yourself. Paste its HTTPS URL and Test external URL. The PC-on reminder stays beside auth choices. Explicit key generation rotates the key; copy uses the displayed value and closing clears it. HMAC and Bearer share the existing receiver.

(Its scenes were retired with the routine editor on 2026-11-09.)

The self-post uses a short-lived authenticated nonce and must reach this exact hook without executing its work or consuming admission. Private addresses, redirects, credentials and unrelated endpoints fail. Fakes prove these boundaries; no tunnel, public network or live form service is started during offline checks.
