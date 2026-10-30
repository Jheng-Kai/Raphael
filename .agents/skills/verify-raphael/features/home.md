# Home overview

## Sub-features

### Product contract (owner refinement, 2026-10-30)

The borderless hero has a 112px emblem, 32px report and date on one horizontal row,
including at 720. Home retains its 1080px maximum. The emblem loops when allowed,
follows reduced motion and retains its DOM node during refreshes. Only a repair
report has a fixing icon; Raphael is asked in his conversation.

Four equal blocks remain in a two-by-two grid for full, sparse and empty data:
needs-you, monthly spend, allowances and dictation. Heights are 200px, or 224px below
760px. Quiet copy replaces flat zero charts and lone dashes. Three inbox items and
one window per CLI fit the same tracks. No descendant scrolls internally.
Spend/allowances open Usage; dictation opens Dictation; reports open the exact turn.

Named, keyboard-focusable transparent full-size click layers cover all five blocks.
Inner controls are separate buttons. Hover changes only border-color to
var(--hover-edge), matching the former sidebar spend card. Background, transparent
layer, geometry and inner content remain unchanged. Press never paints a fill;
keyboard focus remains visible. home-hover-content compares actual measurements.

### Adaptive calendar

One calendar adapts to available container width and height, without a toggle.
Six weeks, seven weekday initials and dimmed neighbouring dates remain in every
month. Today has a filled accent circle. Month/year stays left; previous/next icon
buttons and Today stay right. Arrows, horizontal trackpad wheel and touch swipe
change month with a 160ms grid-only slide; reduced motion skips it. Header controls
and block height stay fixed. There is no Coming up label.

At 1120 and 1280x800, a compact mini month is left and selected-day agenda is right.
Today is initially selected; dates update the agenda in place. Rows show time,
title and responsible face; an empty day has one quiet line. Event/routine days
have a dot. At 720 the agenda sits below the mini month without an inner scroll.
Full, sparse and empty states retain identical tracks and dimensions.

At container width >=900px and height >=460px (1920x1080), a full month fills the
remaining Home area. Days show two chips, or three above 600px of calendar height,
with colour bar, time, title and a remaining count. Chips open their event on
Calendar with the occurrence highlighted; full-grid dates open that Calendar day.
Compact agenda rows use the event action. Blank space opens the selected day.
Calendar remains reachable from Home rather than the sidebar.

## How to get to it (user POV)

Click the Raphael brand in the sidebar to open Home. At narrow widths, open the
sidebar with the window menu first. Pick dates in the mini month to see that day's
agenda; click an agenda event, a full-grid event or day, or the calendar background
to open Calendar. Use the month arrows, Today, trackpad or touch swipe to navigate.

## Driving it with look

```powershell
npm run look -- home home-empty home-sparse home-720 home-report home-routine home-calendar home-adaptive-calendar home-selected-day home-event-chip home-month home-month-navigation home-month-swipe home-calendar-background home-many home-block-navigation home-block-interactions home-hover home-motion --theme both --width 1120,720,1920x1080,1280x800
```

home-redesign measures equal blocks, horizontal hero and nine hit-test points per
surface. home-month checks 42 days, headings, dimming, fixed controls, container mode,
agenda visibility, chip limits and no inner scroll. home-selected-day distinguishes
compact selection from full-grid navigation; home-event-chip checks Calendar focus.
Month navigation/swipe scenes exercise arrows, wheel and real CDP touch dispatch.
Calendar scenes prove exact-day and blank-space navigation. Block scenes exercise
both corners, inner reports, hover, press and keyboard/pointer focus. home-motion
verifies the animated WebP; month-navigation allows the finite slide.

Inspect every sheet and relevant full-size image in both themes and requested sizes.
Compare controls with Calendar and edge states with the shared hover-edge contract.
Native readable-layout covers sidebar, drawer, details, month changes and Calendar;
locale-sweep changes en/ja/zh-TW through real Settings.

## Gotchas

### Data and refresh boundaries

home.overview remains the sole projection; there is no new calendar store.
refresh=false reads local records and cached events/allowances without a CLI or
provider request. Home paints it before the coalesced refresh=true read. Generation
guards reject stale month responses. Allowance persistence uses notify=false.
Member, question, conversation, routine, quota, settings and connection changes
refresh Home. Locale changes redraw cached Home even behind Settings without an RPC
or replacing the emblem; owner profile changes redraw the agenda face.

Optional month uses strict YYYY-MM validation. CalendarDate/CalendarEventFocus use
existing app.go, and Calendar requests the corresponding month. At most the three
earliest items per local date (126 over 42 days), full daily counts and marked dates
are projected independently of the seven-day preview. Existing schedules/history
supply routines. Preview limits remain 12 today items, eight reports and 24 events.

Google Calendar uses connectors.status(refresh=false) and the existing private
calendar_list_events tool only when ACTIVE/enabled. It reads primary calendar,
expands recurrences and orders by start time over the visible 42 days, capped at
2500 results with the existing twelve-second timeout. Unavailable, disabled or
expired connections yield no connected events; local routines remain available.
All-day dates use calendar time zone. Reports stay separate from the timeline.

Offline pytest covers projection and HTTP doubles. Browser fixtures prove UI;
isolated fake-brain native journeys prove the desktop path. Neither proves live
calendar/OAuth/provider scheduling. Judge is excluded by this task's explicit brief.
Follow the shared [content-width contract](README.md#content-width).
